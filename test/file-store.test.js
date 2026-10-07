'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { createFileStore, isStoredFile, storedFile, readFileChunks, readFileHead, getStoredFileHead,
  getStoredFilePath, copyStoredFile, verifyStoredFile } = require('../src/browser/file-store');
const { createProjectStore, runVerificationLab, createDeliveryPackageTo } = require('../src/studio-services');
const { normalizeCandidate } = require('../src/studio-services/identity');
const { readZipFile, createZip } = require('../src/studio-services/archive');

async function temporary(t) { const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'converge-file-store-')); t.after(() => fs.rm(directory, { recursive: true, force: true })); return directory; }
async function makeFile(filename, byteLength) {
  const handle = await fs.open(filename, 'wx'), chunk = Buffer.alloc(786432, 65), digest = createHash('sha256');
  try { for (let offset = 0; offset < byteLength; offset += chunk.length) { const part = chunk.subarray(0, Math.min(chunk.length, byteLength - offset)); await handle.writeFile(part); digest.update(part); } }
  finally { await handle.close(); } return digest.digest('hex');
}
test('disk ingest retains immutable exact bytes with small chunks and rejects unknown, altered and renamed MIME capabilities', async t => {
  const directory = await temporary(t), store = createFileStore({ directory: path.join(directory, 'cache') }); t.after(() => store.close());
  const source = path.join(directory, 'source.txt'), size = 5 * 1024 * 1024 + 7, digest = await makeFile(source, size), progress = [];
  const file = await store.ingest(source, { name: 'source.txt', mimeType: 'text/plain', onProgress: value => progress.push(value) });
  assert.equal(file.base64, undefined); assert.equal(file.contentSha256, digest); assert.equal(file.byteLength, size);
  assert.equal(isStoredFile(file), true); assert.equal(isStoredFile({ ...file, blobId: 'unowned' }), false);
  for (const key of ['mimeType', 'contentSha256', 'byteLength']) assert.equal(isStoredFile({ ...file, [key]: 'tampered' }), false);
  assert.equal(storedFile({ ...file, name: 'alias.txt' }).name, 'alias.txt');
  assert.equal(progress.at(-1).processedBytes, size); assert.equal(progress[0].phase, 'reading');
  let maximum = 0, count = 0; const streamed = createHash('sha256');
  for await (const chunk of readFileChunks(file)) { maximum = Math.max(maximum, chunk.length); count += chunk.length; streamed.update(chunk); }
  assert.equal(count, size); assert.ok(maximum <= 786432); assert.equal(streamed.digest('hex'), digest);
  assert.equal((await readFileHead(file, 31)).length, 31); assert.equal(getStoredFileHead(file).length, 65536);
  const destination = path.join(directory, 'copy.txt'); await copyStoredFile(file, destination); assert.equal((await fs.stat(destination)).size, size);
  await fs.writeFile(source, 'changed user file'); await verifyStoredFile(file);
  const handle = await fs.open(getStoredFilePath(file), 'r+'); await handle.write(Buffer.from('B'), 0, 1, 0); await handle.close();
  await assert.rejects(verifyStoredFile(file), /SHA-256/); await assert.rejects(copyStoredFile(file, destination), /contents changed/);
  assert.equal((await fs.stat(destination)).size, size); assert.equal((await fs.readdir(directory)).some(name => name.endsWith('.part')), false);
});
test('short disk reads still produce aligned bounded upload chunks with exact reconstructed content and hash', async t => {
  const directory = await temporary(t), store = createFileStore({ directory: path.join(directory, 'cache') }); t.after(() => store.close());
  const source = path.join(directory, 'source.txt'), size = 2 * 786432 + 19, digest = await makeFile(source, size);
  const file = await store.ingest(source, { name: 'source.txt', mimeType: 'text/plain' }), blobPath = getStoredFilePath(file), originalOpen = fs.open;
  let readCalls = 0;
  fs.open = async (...args) => {
    const handle = await originalOpen(...args);
    if (args[0] === blobPath) {
      const originalRead = handle.read.bind(handle);
      handle.read = (buffer, offset, length, position) => { readCalls += 1; return originalRead(buffer, offset, Math.min(length, 65537), position); };
    }
    return handle;
  };
  const chunks = [];
  try { for await (const bytes of readFileChunks(file)) chunks.push(bytes.toString('base64')); }
  finally { fs.open = originalOpen; }
  assert.ok(readCalls > chunks.length);
  chunks.slice(0, -1).forEach(chunk => assert.equal(Buffer.from(chunk, 'base64').length % 3, 0));
  const reconstructed = Buffer.from(chunks.join(''), 'base64');
  assert.equal(reconstructed.length, size); assert.equal(createHash('sha256').update(reconstructed).digest('hex'), digest);
  assert.ok(reconstructed.every(byte => byte === 65));
});
test('stream ingest validates split Unicode, malformed ZIP and Stop cleanup without committing partial files', async t => {
  const directory = await temporary(t), store = createFileStore({ directory }); t.after(() => store.close());
  const utf16 = Buffer.from([255, 254, 65, 0, 66, 0]);
  const valid = await store.ingestStream((async function* () { for (const byte of utf16) yield Buffer.from([byte]); })(), { name: 'source.mq5', mimeType: 'text/plain' });
  assert.equal(valid.byteLength, 6);
  await assert.rejects(store.ingestStream((async function* () { yield Buffer.from([65, 0]); })(), { name: 'bad.txt', mimeType: 'text/plain' }), /binary data/);
  await assert.rejects(store.ingestStream((async function* () { yield Buffer.from('not a zip'); })(), { name: 'bad.zip', mimeType: 'application/zip' }), /ZIP/);
  const zip = createZip([{ name: 'readme.txt', bytes: Buffer.from('inert data') }]);
  await store.ingestStream((async function* () { yield zip; })(), { name: 'valid.zip', mimeType: 'application/zip' });
  const controller = new AbortController();
  await assert.rejects(store.ingestStream((async function* () { yield Buffer.from('first'); controller.abort(new Error('Stopped test upload')); yield Buffer.from('later'); })(), { name: 'stopped.txt', mimeType: 'text/plain', signal: controller.signal }), /Stopped test upload/);
  assert.deepEqual(await fs.readdir(path.join(directory, 'staging')), []);
});
test('Close revokes only its store references and waits for a stopped ingest to remove partial data', async t => {
  const directory = await temporary(t), first = createFileStore({ directory: path.join(directory, 'first') }), second = createFileStore({ directory: path.join(directory, 'second') });
  t.after(() => second.close());
  const stream = () => (async function* () { yield Buffer.from('retained text'); })();
  const firstFile = await first.ingestStream(stream(), { name: 'first.txt', mimeType: 'text/plain' });
  const secondFile = await second.ingestStream(stream(), { name: 'second.txt', mimeType: 'text/plain' });
  let continueRead, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const pending = first.ingestStream((async function* () { yield Buffer.from('before'); entered(); await new Promise(resolve => { continueRead = resolve; }); yield Buffer.from('after'); })(), { name: 'pending.txt', mimeType: 'text/plain' });
  const rejected = assert.rejects(pending, /store is closed/);
  await started;
  const closing = first.close(); continueRead(); await rejected; await closing;
  assert.equal(isStoredFile(firstFile), false); assert.equal(isStoredFile(secondFile), true); await verifyStoredFile(secondFile);
  assert.deepEqual(await fs.readdir(path.join(directory, 'first/staging')), []);
  await assert.rejects(readFileHead(firstFile), /unavailable or changed/);
  const reopened = createFileStore({ directory: path.join(directory, 'first') }); t.after(() => reopened.close());
  const currentFile = await reopened.ingestStream(stream(), { name: 'current.txt', mimeType: 'text/plain' });
  await first.close();
  assert.equal(isStoredFile(currentFile), true); await verifyStoredFile(currentFile);
});
test('cancellation during output sync preserves the destination and Close during blob linking cannot mint a late reference', async t => {
  const directory = await temporary(t), store = createFileStore({ directory: path.join(directory, 'store') }); t.after(() => store.close());
  const file = await store.ingestStream((async function* () { yield Buffer.from('verified data'); })(), { name: 'data.txt', mimeType: 'text/plain' });
  const destination = path.join(directory, 'output.txt'); await fs.writeFile(destination, 'existing output');
  const originalOpen = fs.open, originalLink = fs.link;
  let synced, releaseSync;
  const reachedSync = new Promise(resolve => { synced = resolve; });
  fs.open = async (...args) => {
    const handle = await originalOpen(...args);
    if (String(args[0]).startsWith(`${destination}.`) && String(args[0]).endsWith('.part')) {
      const originalSync = handle.sync.bind(handle);
      handle.sync = async () => { await originalSync(); synced(); await new Promise(resolve => { releaseSync = resolve; }); };
    }
    return handle;
  };
  const controller = new AbortController(), copying = copyStoredFile(file, destination, { signal: controller.signal });
  const rejectedCopy = assert.rejects(copying, /closed during sync/);
  try { await reachedSync; controller.abort(new Error('Workspace closed during sync')); releaseSync(); await rejectedCopy; }
  finally { fs.open = originalOpen; }
  assert.equal(await fs.readFile(destination, 'utf8'), 'existing output');
  assert.equal((await fs.readdir(directory)).some(name => name.endsWith('.part')), false);
  let linked, releaseLink;
  const reachedLink = new Promise(resolve => { linked = resolve; });
  fs.link = async (...args) => { await originalLink(...args); linked(); await new Promise(resolve => { releaseLink = resolve; }); };
  const ingest = store.ingestStream((async function* () { yield Buffer.from('late data'); })(), { name: 'late.txt', mimeType: 'text/plain' });
  const rejectedIngest = assert.rejects(ingest, /store is closed/);
  try { await reachedLink; const closing = store.close(); releaseLink(); await rejectedIngest; await closing; }
  finally { fs.link = originalLink; }
  assert.equal(isStoredFile(file), false); assert.deepEqual(await fs.readdir(path.join(directory, 'store/staging')), []);
});
test('large project revisions round-trip opaque references and streaming archives and delivery retain exact hashes', async t => {
  const directory = await temporary(t), cache = createFileStore({ directory: path.join(directory, 'cache') }); t.after(() => cache.close());
  const source = path.join(directory, 'result.txt'), size = 5 * 1024 * 1024 + 3, digest = await makeFile(source, size);
  const file = await cache.ingest(source, { name: 'result.txt', mimeType: 'text/plain' }), candidate = normalizeCandidate({ id: 'C1', answer: 'Exact result', files: [file] });
  const jsonAlias = await cache.ingest(source, { name: 'data.json', mimeType: 'application/json' });
  const snapshot = { schema: 'converge-studio-project', version: 1, state: { question: 'Save large data', studio: { preferredRevisionId: 'R1' } }, sources: [file, jsonAlias], revisions: [{ id: 'R1', candidate, files: [file] }] };
  const store = createProjectStore({ directory: path.join(directory, 'projects') }), saved = await store.save({ name: 'Large project', snapshot });
  const metadata = JSON.parse(await fs.readFile(path.join(directory, 'projects/projects', `${saved.id}.json`), 'utf8'));
  assert.equal(metadata.snapshot.sources[0].blobId, undefined); assert.ok(JSON.stringify(metadata).length < 10000);
  const loaded = await store.load(saved.id); assert.equal(isStoredFile(loaded.snapshot.sources[0]), true); assert.equal(loaded.snapshot.sources[0].base64, undefined);
  const boundedArchive = await store.export(saved.id);
  const boundedMembers = require('../src/studio-services/archive').readZip(boundedArchive);
  assert.equal(createHash('sha256').update(boundedMembers.get(`blobs/${digest}.blob`)).digest('hex'), digest);
  const archivePath = path.join(directory, 'project.zip'); await store.exportTo(saved.id, archivePath);
  const received = new Map();
  await readZipFile(archivePath, { async onEntry(entry) { const hashed = createHash('sha256'); for await (const chunk of entry.stream) hashed.update(chunk); received.set(entry.name, hashed.digest('hex')); } });
  assert.equal(received.get(`blobs/${digest}.blob`), digest);
  const restored = await store.importFrom(archivePath), reopened = await store.load(restored.id);
  assert.equal(reopened.snapshot.revisions[0].files[0].contentSha256, digest); await verifyStoredFile(reopened.snapshot.revisions[0].files[0]);
  assert.equal(reopened.snapshot.sources[1].mimeType, 'application/json'); assert.equal(isStoredFile(reopened.snapshot.sources[1]), true);
  const deliveryPath = path.join(directory, 'delivery.zip'); const delivered = await createDeliveryPackageTo({ candidate, workflowStatus: 'blocked' }, deliveryPath);
  assert.equal(delivered.manifest.files.find(item => item.name === 'files/result.txt').sha256, digest);
  await readZipFile(deliveryPath, { async onEntry(entry) { const hashed = createHash('sha256'); for await (const chunk of entry.stream) hashed.update(chunk); if (entry.name === 'files/result.txt') assert.equal(hashed.digest('hex'), digest); } });
});
test('oversized stored text receives real incremental identity checks and honest unavailable parser coverage', async t => {
  const directory = await temporary(t), store = createFileStore({ directory }); t.after(() => store.close());
  const source = path.join(directory, 'large.js'); await makeFile(source, 17 * 1024 * 1024);
  const file = await store.ingest(source, { name: 'large.js', mimeType: 'text/plain' }), candidate = normalizeCandidate({ id: 'C1', answer: 'Large source', files: [file] });
  let parserCalls = 0;
  const report = await runVerificationLab({ candidate, nodeExecutable: process.execPath, processRunner: async () => { parserCalls += 1; return { code: 0 }; } });
  assert.equal(parserCalls, 0); assert.equal(report.checks[0].status, 'passed');
  assert.equal(report.checks.find(check => check.id.startsWith('javascript-syntax')).status, 'unverified');
  assert.equal(report.status, 'unverified');
});
