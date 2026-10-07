'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createDownloadBroker } = require('../src/browser/downloads');
const { MAX_FILE_BYTES } = require('../src/browser/files');
const archives = require('./fixtures/archive-bytes.json');
const limitDescription = `${MAX_FILE_BYTES / (1024 * 1024)} MB`;

class DownloadItem extends EventEmitter {
  constructor({ name = 'reviewed.pdf', mimeType = 'application/pdf', total = 0 } = {}) {
    super(); this.name = name; this.mimeType = mimeType; this.total = total; this.received = 0; this.canceled = false; this.savePath = null;
  }
  getFilename() { return this.name; }
  getMimeType() { return this.mimeType; }
  getTotalBytes() { return this.total; }
  getReceivedBytes() { return this.received; }
  setSavePath(value) { this.savePath = value; }
  cancel() { this.canceled = true; this.emit('done', {}, 'cancelled'); }
  async complete(bytes) { await fs.writeFile(this.savePath, bytes); this.received = bytes.length; this.emit('done', {}, 'completed'); }
}

const payload = { runId: 'run-1', requestId: 'request-1', id: 'media-1', name: 'reviewed.pdf', mimeType: 'application/pdf' };

test('boss downloads cannot be read or canceled by either worker', async (t) => {
  const { broker, browserSession } = await harness(t);
  const started = await broker.begin('boss', payload);
  assert.equal(started.ok, true);
  assert.equal((await broker.cancel('left', started.token)).ok, false);
  assert.equal((await broker.read('right', started.token)).ok, false);
  const item = new DownloadItem();
  browserSession.emit('will-download', {}, item, { side: 'boss' });
  const reading = broker.read('boss', started.token);
  const bytes = Buffer.from('%PDF-1.4\nboss approved\n%%EOF');
  await item.complete(bytes);
  assert.deepEqual(Buffer.from((await reading).base64, 'base64'), bytes);
});

async function harness(t, authorize = () => true) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'converge-broker-test-'));
  const browserSession = new EventEmitter();
  const left = { side: 'left' }; const right = { side: 'right' };
  const broker = createDownloadBroker({ browserSession, sideForContents: (contents) => contents?.side, authorize, tempRoot });
  t.after(async () => {
    await broker.dispose();
    assert.deepEqual(await fs.readdir(tempRoot), [], 'The broker must remove its owned temporary directory and files.');
    await fs.rmdir(tempRoot);
  });
  return { broker, browserSession, left, right, tempRoot };
}

test('authorized native PDF downloads return exact bytes and clean their private temporary paths', async (t) => {
  const authorized = [];
  const { broker, browserSession, left, tempRoot } = await harness(t, (side, metadata) => { authorized.push({ side, metadata }); return true; });
  const started = await broker.begin('left', { ...payload, remoteUrl: 'not used', outputPath: 'not used' });
  assert.equal(started.ok, true);
  assert.deepEqual(authorized, [{ side: 'left', metadata: payload }]);
  const item = new DownloadItem({ mimeType: 'application/octet-stream' });
  browserSession.emit('will-download', {}, item, left);
  assert.ok(path.relative(tempRoot, item.savePath).startsWith('converge-download-'));
  assert.notEqual(path.basename(item.savePath), payload.name);
  const bytes = Buffer.from('%PDF-1.4\nAn exact reviewed fixture\n%%EOF');
  const reading = broker.read('left', started.token);
  await item.complete(bytes);
  const result = await reading;
  assert.equal(result.ok, true); assert.equal(result.mimeType, 'application/pdf');
  assert.deepEqual(Buffer.from(result.base64, 'base64'), bytes);
  await assert.rejects(fs.stat(item.savePath), { code: 'ENOENT' });
});

test('initial size and streamed progress enforce the current native download limit', async (t) => {
  const { broker, browserSession, left } = await harness(t);
  for (const initial of [true, false]) {
    const started = await broker.begin('left', payload);
    const item = new DownloadItem({ total: initial ? MAX_FILE_BYTES + 1 : 0 });
    browserSession.emit('will-download', {}, item, left);
    if (!initial) { item.received = MAX_FILE_BYTES + 1; item.emit('updated', {}, 'progressing'); }
    const result = await broker.read('left', started.token);
    assert.equal(result.ok, false); assert.ok(result.error.includes(limitDescription), result.error); assert.equal(item.canceled, true);
  }
});

test('native download accepts the 512 MB boundary and retains larger artifacts on disk', async (t) => {
  const { createFileStore, readFileChunks } = require('../src/browser/file-store');
  const cache = await fs.mkdtemp(path.join(os.tmpdir(), 'converge-download-cache-test-'));
  const store = createFileStore({ directory: cache });
  t.after(async () => {
    await store.close();
    assert.equal(path.dirname(cache), path.resolve(os.tmpdir()));
    assert.ok(path.basename(cache).startsWith('converge-download-cache-test-'));
    await fs.rm(cache, { recursive: true, force: true });
  });
  const { broker, browserSession, left } = await harness(t);
  assert.equal(MAX_FILE_BYTES, 512 * 1024 * 1024);
  const boundary = await broker.begin('left', payload);
  const boundaryItem = new DownloadItem({ total: MAX_FILE_BYTES });
  browserSession.emit('will-download', {}, boundaryItem, left);
  assert.ok(boundaryItem.savePath, 'A file exactly at the permitted boundary was rejected.');
  assert.equal(boundaryItem.canceled, false);
  assert.equal(broker.cancel('left', boundary.token).ok, true);
  assert.equal((await broker.read('left', boundary.token)).ok, false);

  const started = await broker.begin('left', payload);
  const bytes = Buffer.alloc(20 * 1024 * 1024, 0x20);
  bytes.write('%PDF-1.4\nLarge reviewed artifact\n', 0);
  bytes.write('\n%%EOF', bytes.length - 6);
  const item = new DownloadItem({ total: bytes.length });
  browserSession.emit('will-download', {}, item, left);
  assert.ok(item.savePath, 'The old 12 MB size gate still rejected the actual large artifact.');
  await item.complete(bytes);
  const result = await broker.read('left', started.token);
  assert.equal(result.ok, true, result.error);
  assert.equal(result.base64, undefined);
  assert.equal(result.byteLength, bytes.length);
  const digest = createHash('sha256'); let decodedLength = 0;
  for await (const chunk of readFileChunks(result)) { assert.ok(chunk.length <= 786432); decodedLength += chunk.length; digest.update(chunk); }
  assert.equal(decodedLength, bytes.length);
  assert.equal(digest.digest('hex'), createHash('sha256').update(bytes).digest('hex'));
  await assert.rejects(fs.stat(item.savePath), { code: 'ENOENT' });
});

test('completed files exceeding the cap are rejected even when provider progress omitted the size', async (t) => {
  const { broker, browserSession, left } = await harness(t);
  const started = await broker.begin('left', payload);
  const item = new DownloadItem({ total: 0 });
  browserSession.emit('will-download', {}, item, left);
  await fs.writeFile(item.savePath, '%PDF-1.4\n');
  // A sparse file exercises the actual stat guard without allocating or
  // transporting an oversized payload into the main process.
  await fs.truncate(item.savePath, MAX_FILE_BYTES + 1);
  item.emit('done', {}, 'completed');
  const result = await broker.read('left', started.token);
  assert.equal(result.ok, false);
  assert.ok(result.error.includes(limitDescription), result.error);
  assert.equal(item.canceled, true);
  await assert.rejects(fs.stat(item.savePath), { code: 'ENOENT' });
});

test('tokens are bound to their chat and unrelated download events remain untouched', async (t) => {
  const { broker, browserSession, left, right } = await harness(t);
  const started = await broker.begin('left', payload);
  assert.equal((await broker.read('right', started.token)).ok, false);
  assert.equal((await broker.read('left', 'wrong-token')).ok, false);
  assert.equal(broker.cancel('right', started.token).ok, false);
  assert.equal((await broker.begin('left', payload)).ok, false);
  const unrelated = new DownloadItem();
  browserSession.emit('will-download', {}, unrelated, right);
  assert.equal(unrelated.savePath, null); assert.equal(unrelated.canceled, false);
  const owned = new DownloadItem(); browserSession.emit('will-download', {}, owned, left);
  await owned.complete(Buffer.from('%PDF real owned bytes'));
  assert.equal((await broker.read('left', started.token)).ok, true);
});

test('cancel aborts only the owned item, returns a failed read, and permits the next file', async (t) => {
  const { broker, browserSession, left } = await harness(t);
  const started = await broker.begin('left', payload);
  const item = new DownloadItem(); browserSession.emit('will-download', {}, item, left);
  await fs.writeFile(item.savePath, 'Partial download');
  assert.deepEqual(broker.cancel('left', started.token), { ok: true, canceled: true });
  const result = await broker.read('left', started.token);
  assert.equal(result.ok, false); assert.match(result.error, /canceled/); assert.equal(item.canceled, true);
  await assert.rejects(fs.stat(item.savePath), { code: 'ENOENT' });
  const next = await broker.begin('left', payload);
  assert.equal(next.ok, true);
  broker.cancel('left', next.token);
});

test('HTML, mismatched native filenames, and unauthorised metadata cannot become a reviewed PDF', async (t) => {
  const { broker, browserSession, left } = await harness(t, (_side, metadata) => metadata.id === payload.id);
  assert.equal((await broker.begin('left', { ...payload, id: 'different' })).ok, false);
  assert.equal((await broker.begin('left', { ...payload, name: '../../outside.pdf' })).ok, false);
  for (const options of [{ mimeType: 'text/html' }, { name: 'another.pdf' }]) {
    const started = await broker.begin('left', payload);
    const item = new DownloadItem(options); browserSession.emit('will-download', {}, item, left);
    const result = await broker.read('left', started.token);
    assert.equal(result.ok, false); assert.equal(item.canceled, true); assert.equal(item.savePath, null);
  }
});

test('dispose cancels pending work, removes its session listener, and rejects new jobs', async (t) => {
  const { broker, browserSession, left } = await harness(t);
  const started = await broker.begin('left', payload);
  const item = new DownloadItem(); browserSession.emit('will-download', {}, item, left);
  await fs.writeFile(item.savePath, 'Incomplete file');
  const reading = broker.read('left', started.token);
  await broker.dispose();
  assert.equal((await reading).ok, false); assert.equal(item.canceled, true);
  assert.equal(browserSession.listenerCount('will-download'), 0);
  assert.equal((await broker.begin('left', payload)).ok, false);
});

test('native MQL5 downloads retain exact source bytes and verify the actual source filename', async (t) => {
  const { broker, browserSession, left } = await harness(t);
  const sourcePayload = { ...payload, name: 'NovaTrail_RiskControlled_v2.mq5', mimeType: 'text/plain' };
  const bytes = Buffer.from('#property strict\r\nvoid OnTick() {}\r\n');
  for (const mimeType of ['text/plain', 'application/octet-stream']) {
    const started = await broker.begin('left', sourcePayload);
    assert.equal(started.ok, true);
    const item = new DownloadItem({ name: sourcePayload.name, mimeType });
    browserSession.emit('will-download', {}, item, left);
    await item.complete(bytes);
    const result = await broker.read('left', started.token);
    assert.equal(result.ok, true);
    assert.equal(result.mimeType, 'text/plain');
    assert.deepEqual(Buffer.from(result.base64, 'base64'), bytes);
  }
  const started = await broker.begin('left', sourcePayload);
  const wrong = new DownloadItem({ name: 'NovaTrail_RiskControlled_v2.txt', mimeType: 'text/plain' });
  browserSession.emit('will-download', {}, wrong, left);
  assert.equal((await broker.read('left', started.token)).ok, false);
  assert.equal(wrong.canceled, true);
  assert.equal(wrong.savePath, null);
});

test('native Python MIME aliases return exact source bytes only for the authorized .py candidate', async (t) => {
  const { broker, browserSession, left, right } = await harness(t);
  const sourcePayload = { ...payload, name: 'merge_busy_windows.py', mimeType: 'text/plain' };
  const bytes = Buffer.from('# Exact Unicode source: বাংলা\r\ndef merge_busy_windows(windows):\r\n    return []\r\n');
  for (const mimeType of ['text/x-python', 'TEXT/X-PYTHON; charset=utf-8']) {
    const started = await broker.begin('left', sourcePayload);
    assert.equal(started.ok, true, started.error);
    const unrelated = new DownloadItem({ name: sourcePayload.name, mimeType });
    browserSession.emit('will-download', {}, unrelated, right);
    assert.equal(unrelated.savePath, null);
    assert.equal(unrelated.canceled, false);
    const item = new DownloadItem({ name: sourcePayload.name, mimeType });
    browserSession.emit('will-download', {}, item, left);
    assert.ok(item.savePath, 'The owned Python alias must use the authorized native download path.');
    await item.complete(bytes);
    const result = await broker.read('left', started.token);
    assert.equal(result.ok, true, result.error);
    assert.equal(result.mimeType, 'text/plain');
    assert.deepEqual(Buffer.from(result.base64, 'base64'), bytes);
    await assert.rejects(fs.stat(item.savePath), { code: 'ENOENT' });
  }
});

test('Python MIME aliases cannot authorize another extension, a different filename, or an HTML download', async (t) => {
  const { broker, browserSession, left } = await harness(t);
  const scenarios = [
    { selected: 'reviewed.txt', actual: 'reviewed.txt', mimeType: 'text/x-python', error: /unexpected file type/ },
    { selected: 'reviewed.js', actual: 'reviewed.js', mimeType: 'text/x-python', error: /unexpected file type/ },
    { selected: 'reviewed.py', actual: 'different.py', mimeType: 'text/x-python', error: /filename does not match/ },
    { selected: 'reviewed.py', actual: 'reviewed.txt', mimeType: 'text/x-python', error: /filename does not match/ },
    { selected: 'reviewed.py', actual: 'reviewed.py', mimeType: 'text/html', error: /unexpected file type/ },
    { selected: 'reviewed.py', actual: 'reviewed.py', mimeType: 'application/xhtml+xml', error: /unexpected file type/ },
    { selected: 'reviewed.py', actual: 'reviewed.py', mimeType: 'text/x-other-source', error: /unexpected file type/ },
  ];
  for (const scenario of scenarios) {
    const started = await broker.begin('left', { ...payload, name: scenario.selected, mimeType: 'text/plain' });
    assert.equal(started.ok, true, started.error);
    const item = new DownloadItem({ name: scenario.actual, mimeType: scenario.mimeType });
    browserSession.emit('will-download', {}, item, left);
    const result = await broker.read('left', started.token);
    assert.equal(result.ok, false);
    assert.match(result.error, scenario.error);
    assert.equal(item.canceled, true);
    assert.equal(item.savePath, null);
  }
});

test('Python MIME aliases still reject binary and malformed Unicode source bytes', async (t) => {
  const { broker, browserSession, left } = await harness(t);
  for (const [bytes, error] of [
    [Buffer.from([0x4d, 0x5a, 0, 1, 2]), /binary data/],
    [Buffer.from([0xc3, 0x28]), /not readable Unicode/],
  ]) {
    const started = await broker.begin('left', { ...payload, name: 'reviewed.py', mimeType: 'text/plain' });
    const item = new DownloadItem({ name: 'reviewed.py', mimeType: 'text/x-python' });
    browserSession.emit('will-download', {}, item, left);
    assert.ok(item.savePath);
    await item.complete(bytes);
    const result = await broker.read('left', started.token);
    assert.equal(result.ok, false);
    assert.match(result.error, error);
    assert.equal(item.canceled, true);
    await assert.rejects(fs.stat(item.savePath), { code: 'ENOENT' });
  }
});

test('native source broker rejects forged source MIME and unknown binary fallback before clicking', async (t) => {
  const { broker } = await harness(t);
  for (const [name, mimeType] of [['reviewed.mq5', 'image/png'], ['payload.exe', 'text/plain'], ['payload.bin', 'application/octet-stream']]) {
    assert.equal((await broker.begin('left', { ...payload, name, mimeType })).ok, false);
  }
});

test('native source broker rejects downloaded binary data even under a known .mq5 filename', async (t) => {
  const { broker, browserSession, left } = await harness(t);
  const sourcePayload = { ...payload, name: 'reviewed.mq5', mimeType: 'text/plain' };
  const started = await broker.begin('left', sourcePayload);
  const item = new DownloadItem({ name: sourcePayload.name, mimeType: 'application/octet-stream' });
  browserSession.emit('will-download', {}, item, left);
  await item.complete(Buffer.from([0x4d, 0x5a, 0, 1, 2]));
  const result = await broker.read('left', started.token);
  assert.equal(result.ok, false); assert.match(result.error, /binary data/);
  await assert.rejects(fs.stat(item.savePath), { code: 'ENOENT' });
});

test('a native artifact prepared after two minutes still belongs to its authorized job and returns exact bytes', async (t) => {
  const { broker, browserSession, left } = await harness(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const started = await broker.begin('left', payload);
  const reading = broker.read('left', started.token);
  let settled = false;
  reading.then(() => { settled = true; });
  // The old 45-second broker deadline expired before this delayed artifact.
  t.mock.timers.tick(120_000);
  await new Promise(setImmediate);
  assert.equal(settled, false);
  const item = new DownloadItem();
  browserSession.emit('will-download', {}, item, left);
  assert.ok(item.savePath, 'Delayed owned artifacts must not fall through to a native Save dialog.');
  const bytes = Buffer.from('%PDF-1.4\nDelayed exact reviewed fixture\n%%EOF');
  await item.complete(bytes);
  const result = await reading;
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(Buffer.from(result.base64, 'base64'), bytes);
  t.mock.timers.reset();
});

test('the native preparation deadline stays bounded and Stop returns promptly before a delayed file arrives', async (t) => {
  const { broker } = await harness(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const expired = await broker.begin('left', payload);
  const expiring = broker.read('left', expired.token);
  t.mock.timers.tick(30 * 60_000);
  const failure = await expiring;
  assert.equal(failure.ok, false);
  assert.match(failure.error, /30 minutes/);
  const stopped = await broker.begin('left', payload);
  const waiting = broker.read('left', stopped.token);
  t.mock.timers.tick(120_000);
  assert.equal(broker.cancel('left', stopped.token).ok, true);
  const result = await waiting;
  assert.equal(result.ok, false);
  assert.match(result.error, /canceled/);
  t.mock.timers.reset();
});

test('native ZIP package downloads accept explicit ZIP or generic types and preserve exact opaque bytes', async (t) => {
  const {broker, browserSession, left} = await harness(t);
  const zipPayload = {...payload, name:'NovaTrail_MTF_Safe_Package.zip', mimeType:'application/zip'};
  const bytes = Buffer.from(archives.packageBase64, 'base64');
  for (const mimeType of ['application/zip', 'application/x-zip-compressed', 'application/octet-stream']) {
    const started = await broker.begin('left', zipPayload);
    assert.equal(started.ok, true, started.error);
    const item = new DownloadItem({name:zipPayload.name, mimeType});
    browserSession.emit('will-download', {}, item, left);
    await item.complete(bytes);
    const result = await broker.read('left', started.token);
    assert.equal(result.ok, true, result.error);
    assert.equal(result.mimeType, 'application/zip');
    assert.deepEqual(Buffer.from(result.base64, 'base64'), bytes);
    await assert.rejects(fs.stat(item.savePath), {code:'ENOENT'});
  }
});

test('native ZIP broker rejects forged metadata, wrong filenames, HTML and malformed containers', async (t) => {
  const {broker, browserSession, left} = await harness(t);
  for (const [name,mimeType] of [['payload.exe','application/zip'], ['package.zip','application/pdf'], ['payload.exe','text/plain']]) {
    assert.equal((await broker.begin('left', {...payload,name,mimeType})).ok, false);
  }
  const zipPayload = {...payload, name:'package.zip', mimeType:'application/zip'};
  for (const options of [{name:'different.zip', mimeType:'application/zip'}, {name:zipPayload.name,mimeType:'text/html'}, {name:zipPayload.name,mimeType:'image/png'}]) {
    const started = await broker.begin('left', zipPayload);
    const item = new DownloadItem(options);
    browserSession.emit('will-download', {}, item, left);
    const result = await broker.read('left', started.token);
    assert.equal(result.ok, false); assert.equal(item.canceled, true); assert.equal(item.savePath, null);
  }
  for (const bytes of [Buffer.from('MZ not a ZIP'), Buffer.from('PK\x03\x04'), Buffer.from(archives.packageBase64,'base64').subarray(0,-1)]) {
    const started = await broker.begin('left', zipPayload);
    const item = new DownloadItem({name:zipPayload.name,mimeType:'application/zip'});
    browserSession.emit('will-download', {}, item, left);
    await item.complete(bytes);
    const result = await broker.read('left', started.token);
    assert.equal(result.ok,false); assert.match(result.error,/ZIP file is malformed/);
    await assert.rejects(fs.stat(item.savePath), {code:'ENOENT'});
  }
});

test('native .set settings downloads retain their canonical name and Unicode source bytes', async (t) => {
  const {broker,browserSession,left} = await harness(t);
  const settingsPayload = {...payload,name:'NovaTrail_safe_defaults.set',mimeType:'text/plain'};
  const text = '; বাংলা\r\nRiskPercent=0.5\r\n';
  const little = Buffer.concat([Buffer.from([0xff,0xfe]),Buffer.from(text,'utf16le')]);
  const big = Buffer.from(little); big.swap16();
  for (const bytes of [Buffer.from(text),little,big]) {
    const started = await broker.begin('left',settingsPayload);
    const item = new DownloadItem({name:settingsPayload.name,mimeType:'application/octet-stream'});
    browserSession.emit('will-download',{},item,left);
    await item.complete(bytes);
    const result = await broker.read('left',started.token);
    assert.equal(result.ok,true,result.error);
    assert.equal(result.mimeType,'text/plain');
    assert.deepEqual(Buffer.from(result.base64,'base64'),bytes);
  }
  const started = await broker.begin('left',settingsPayload);
  const wrong = new DownloadItem({name:'NovaTrail_safe_defaults.set.txt',mimeType:'text/plain'});
  browserSession.emit('will-download',{},wrong,left);
  assert.equal((await broker.read('left',started.token)).ok,false);
  assert.equal(wrong.savePath,null);
});

test('ZIP and .set downloads keep side ownership, Stop and current byte limits', async (t) => {
  const {broker,browserSession,left,right} = await harness(t);
  for (const [name,mimeType] of [['package.zip','application/zip'],['defaults.set','text/plain']]) {
    const started = await broker.begin('left',{...payload,name,mimeType});
    assert.equal((await broker.read('right',started.token)).ok,false);
    const unrelated = new DownloadItem({name,mimeType});
    browserSession.emit('will-download',{},unrelated,right);
    assert.equal(unrelated.savePath,null); assert.equal(unrelated.canceled,false);
    const owned = new DownloadItem({name,mimeType,total:MAX_FILE_BYTES+1});
    browserSession.emit('will-download',{},owned,left);
    assert.ok((await broker.read('left',started.token)).error.includes(limitDescription));
    assert.equal(owned.canceled,true);
    const waiting = await broker.begin('left',{...payload,name,mimeType});
    assert.equal(broker.cancel('left',waiting.token).ok,true);
    assert.match((await broker.read('left',waiting.token)).error,/canceled/);
  }
});
