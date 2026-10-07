'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { MIME, TEXT_SOURCE_EXTENSIONS, safeFilename, validateTextSource, validateExport, providerUploadAdvice } = require('../src/browser/files');
const { createDownloadBroker } = require('../src/browser/downloads');
const { createFileStore, readFileHead, verifyStoredFile, copyStoredFile } = require('../src/browser/file-store');
const { createProjectStore, runVerificationLab, parseTSV } = require('../src/studio-services');
const { normalizeCandidate } = require('../src/studio-services/identity');

const name = 'ced_scope_manifest.tsv';
const text = 'scope,note\tstatus\r\n"L1-20, বাংলা"\tchecked\r\n';
const bytes = Buffer.from(text);
const sha = value => createHash('sha256').update(value).digest('hex');
const payload = { runId: 'ced-cycle-1', requestId: 'worker-b', id: 'media-2', name, mimeType: MIME.tsv };
const unicodeVariants = () => {
  const little = Buffer.concat([Buffer.from([255, 254]), Buffer.from(text, 'utf16le')]);
  return [bytes, little, Buffer.from(little).swap16()];
};
async function temporary(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'converge-tsv-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}
class DownloadItem extends EventEmitter {
  constructor(actualName = name, mimeType = MIME.tsv) { super(); this.name = actualName; this.mimeType = mimeType; this.savePath = null; this.canceled = false; }
  getFilename() { return this.name; }
  getMimeType() { return this.mimeType; }
  getTotalBytes() { return 0; }
  getReceivedBytes() { return 0; }
  setSavePath(value) { this.savePath = value; }
  cancel() { this.canceled = true; this.emit('done', {}, 'cancelled'); }
  async complete(data) { await fs.writeFile(this.savePath, data); this.emit('done', {}, 'completed'); }
}
async function brokerFixture(t, options = {}) {
  const directory = await temporary(t), browserSession = new EventEmitter();
  const broker = createDownloadBroker({ browserSession, sideForContents: contents => contents?.side,
    authorize: () => true, tempRoot: directory, ...options });
  t.after(() => broker.dispose());
  return { broker, browserSession };
}

test('TSV is canonical inert tabular text and saving preserves its reviewed name and bytes', () => {
  assert.equal(MIME.tsv, 'text/tab-separated-values');
  assert.equal(TEXT_SOURCE_EXTENSIONS.includes('tsv'), false, 'A table is not a source program.');
  assert.equal(safeFilename(name, MIME.tsv), name);
  assert.match(providerUploadAdvice(name, MIME.tsv, 51 * 1024 * 1024), /approximately 50 MB/);
  for (const data of unicodeVariants()) {
    validateTextSource(name, MIME.tsv, data);
    const descriptor = { ...payload, fingerprint: 'native-card:manifest', contentSha256: sha(data), byteLength: data.length };
    const candidate = { side: 'right', runId: payload.runId, requestId: payload.requestId, files: [descriptor] };
    const exported = { ok: true, files: [{ ...descriptor, base64: data.toString('base64') }] };
    const saved = validateExport(candidate, exported)[0];
    assert.equal(saved.name, name); assert.equal(saved.mimeType, MIME.tsv); assert.deepEqual(saved.bytes, data);
    assert.throws(() => validateExport(candidate, { ...exported, files: [{ ...exported.files[0], base64: Buffer.from('scope\tstatus\nchanged\tno\n').toString('base64') }] }), /contents changed/);
  }
  for (const [fileName, mimeType] of [[name, 'text/plain'], [name, 'image/png'], ['manifest.txt', MIME.tsv], ['program.js', MIME.tsv], ['unknown.bin', MIME.tsv]]) {
    assert.throws(() => validateTextSource(fileName, mimeType, bytes), /TSV file type/);
  }
  assert.throws(() => validateTextSource(name, MIME.tsv, Buffer.from([65, 9, 0, 10])), /binary data/);
  assert.throws(() => validateTextSource(name, MIME.tsv, Buffer.from([0xc3, 0x28])), /Unicode/);
});

test('native TSV downloads accept provider plain-text aliases only for the exact selected table', async t => {
  const { broker, browserSession } = await brokerFixture(t);
  for (const mimeType of [MIME.tsv, 'TEXT/TAB-SEPARATED-VALUES; charset=utf-8', 'text/plain', 'TEXT/PLAIN; charset=utf-8']) {
    const started = await broker.begin('right', payload); assert.equal(started.ok, true, started.error);
    const unrelated = new DownloadItem(name, mimeType); browserSession.emit('will-download', {}, unrelated, { side: 'left' });
    assert.equal(unrelated.savePath, null); assert.equal(unrelated.canceled, false);
    const item = new DownloadItem(name, mimeType); browserSession.emit('will-download', {}, item, { side: 'right' });
    assert.ok(item.savePath); await item.complete(bytes);
    const result = await broker.read('right', started.token);
    assert.equal(result.ok, true, result.error); assert.equal(result.mimeType, MIME.tsv);
    assert.deepEqual(Buffer.from(result.base64, 'base64'), bytes);
  }
  for (const [actualName, mimeType, error] of [['different.tsv', 'text/plain', /filename/], ['ced_scope_manifest.tsv.txt', 'text/plain', /filename/], ['ced_scope_manifest', 'text/plain', /filename/], ['', 'text/plain', /filename/], [name, 'text/html', /unexpected file type/], [name, 'application/xhtml+xml', /unexpected file type/], [name, 'text/csv', /unexpected file type/]]) {
    const started = await broker.begin('right', payload);
    const item = new DownloadItem(actualName, mimeType); browserSession.emit('will-download', {}, item, { side: 'right' });
    const result = await broker.read('right', started.token);
    assert.equal(result.ok, false); assert.match(result.error, error); assert.equal(item.savePath, null);
  }
  for (const descriptor of [{ ...payload, mimeType: 'text/plain' }, { ...payload, name: 'manifest.csv' }, { ...payload, name: 'program.js' }]) {
    assert.equal((await broker.begin('right', descriptor)).ok, false);
  }
  const started = await broker.begin('right', { ...payload, name: 'reviewed.txt', mimeType: 'text/plain' });
  const item = new DownloadItem('reviewed.txt', MIME.tsv); browserSession.emit('will-download', {}, item, { side: 'right' });
  assert.match((await broker.read('right', started.token)).error, /unexpected file type/);
});

test('native TSV aliases reject malformed Unicode and binary payloads after reading real bytes', async t => {
  const { broker, browserSession } = await brokerFixture(t);
  for (const data of [Buffer.from([0xc3, 0x28]), Buffer.from([65, 9, 0, 10])]) {
    const started = await broker.begin('right', payload), item = new DownloadItem(name, 'text/plain');
    browserSession.emit('will-download', {}, item, { side: 'right' }); await item.complete(data);
    const result = await broker.read('right', started.token);
    assert.equal(result.ok, false); assert.match(result.error, /Unicode|binary data/);
    await assert.rejects(fs.stat(item.savePath), { code: 'ENOENT' });
  }
});

test('streamed TSV verifies split Unicode and rejects malformed tails without committing a blob', async t => {
  const directory = await temporary(t), store = createFileStore({ directory }); t.after(() => store.close());
  const little = unicodeVariants()[1];
  const streamed = data => (async function* () { for (const byte of data) yield Buffer.from([byte]); })();
  const file = await store.ingestStream(streamed(little), { name, mimeType: MIME.tsv });
  assert.equal(file.name, name); assert.equal(file.contentSha256, sha(little));
  assert.deepEqual(await readFileHead(file), little); await verifyStoredFile(file);
  const destination = path.join(directory, name); await copyStoredFile(file, destination);
  assert.deepEqual(await fs.readFile(destination), little);
  for (const data of [Buffer.from([65, 9, 0]), Buffer.from([0xc3]), Buffer.from([255, 254, 65])]) {
    await assert.rejects(store.ingestStream(streamed(data), { name, mimeType: MIME.tsv }), /Unicode|binary data/);
  }
  assert.deepEqual(await fs.readdir(path.join(directory, 'staging')), []);
});

test('large native TSV downloads retain their canonical stored identity and validate the final bytes', async t => {
  const directory = await temporary(t), store = createFileStore({ directory: path.join(directory, 'store') }); t.after(() => store.close());
  const { broker, browserSession } = await brokerFixture(t, { ingestFile: (filename, metadata) => store.ingest(filename, metadata) });
  const data = Buffer.from('scope\tstatus\n' + 'L1\tchecked\n'.repeat(450_000));
  assert.ok(data.length > 4 * 1024 * 1024);
  const started = await broker.begin('right', payload), item = new DownloadItem(name, 'text/plain');
  browserSession.emit('will-download', {}, item, { side: 'right' }); await item.complete(data);
  const result = await broker.read('right', started.token);
  assert.equal(result.ok, true, result.error); assert.equal(result.name, name); assert.equal(result.mimeType, MIME.tsv);
  assert.equal(result.contentSha256, sha(data)); assert.equal(result.byteLength, data.length); assert.equal(result.base64, undefined);
  await verifyStoredFile(result);
  const descriptor = { ...payload, fingerprint: 'native-card:manifest', contentSha256: result.contentSha256, byteLength: result.byteLength };
  const reviewed = { side: 'right', runId: payload.runId, requestId: payload.requestId, files: [descriptor] };
  const saved = validateExport(reviewed, { ok: true, files: [{ ...descriptor, ...result }] })[0];
  assert.equal(saved.name, name); assert.equal(saved.contentSha256, sha(data));
  const renamed = { ...descriptor, ...result, name: 'manifest.txt' };
  assert.throws(() => validateExport({ ...reviewed, files: [{ ...descriptor, name: renamed.name }] }, { ok: true, files: [renamed] }), /TSV file type/);
  data[data.length - 1] = 0;
  const next = await broker.begin('right', payload), corrupt = new DownloadItem(name, 'text/plain');
  browserSession.emit('will-download', {}, corrupt, { side: 'right' }); await corrupt.complete(data);
  assert.match((await broker.read('right', next.token)).error, /binary data/);
});

test('local TSV structure uses tabs despite commas and never invokes a program runner', async () => {
  assert.deepEqual(parseTSV(text), { rows: 2, columns: 2, delimiter: 'tab' });
  assert.deepEqual(parseTSV('name\tnote\nA\t"comma, tab\tand\nnewline"\n'), { rows: 2, columns: 2, delimiter: 'tab' });
  assert.throws(() => parseTSV('a\tb\n1\t2\t3\n'), /TSV row 2.*expected 2/);
  assert.throws(() => parseTSV('a\tb\n"unfinished\t2'), /TSV.*unterminated/);
  for (const data of unicodeVariants()) {
    const candidate = normalizeCandidate({ id: 'C1', answer: 'Forensic manifest', files: [{ name, mimeType: MIME.tsv, bytes: data }] });
    const report = await runVerificationLab({ candidate, processRunner() { throw new Error('TSV must remain inert.'); } });
    const check = report.checks.find(item => item.id === `tsv-parse:${name}`);
    assert.equal(check.status, 'passed'); assert.equal(check.contentSha256, sha(data)); assert.equal(check.byteLength, data.length);
    assert.match(check.evidence, /2 rows, 2 consistent columns, delimiter tab/);
    assert.equal(report.checks.some(item => /syntax:/.test(item.id)), false);
  }
  const invalid = await runVerificationLab({ candidate: normalizeCandidate({ id: 'C2', answer: 'Bad table', files: [{ name, mimeType: MIME.tsv, bytes: Buffer.from('a\tb\n1\t2\t3\n') }] }) });
  assert.equal(invalid.status, 'failed'); assert.match(invalid.checks.find(item => item.status === 'failed').evidence, /TSV row/);
});

test('TSV project save, reload and portable import retain the canonical filename, bytes and SHA-256', async t => {
  const directory = await temporary(t), store = createProjectStore({ directory });
  const candidate = normalizeCandidate({ id: 'C1', answer: 'Forensic manifest', files: [{ name, mimeType: MIME.tsv, bytes }] });
  const saved = await store.save({ name: 'CED audit', files: candidate.files, revisions: [candidate] });
  const loaded = await store.load(saved.id);
  assert.equal(loaded.files[0].name, name); assert.equal(loaded.files[0].mimeType, MIME.tsv);
  assert.deepEqual(Buffer.from(loaded.files[0].base64, 'base64'), bytes); assert.equal(loaded.files[0].contentSha256, sha(bytes));
  const imported = await store.import(await store.export(saved.id)), restored = await store.load(imported.id);
  assert.deepEqual(restored.files, loaded.files);
  await assert.rejects(store.save({ files: [{ ...candidate.files[0], contentSha256: 'f'.repeat(64) }] }), /changed after review/);
});
