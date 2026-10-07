'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { createProjectStore, runVerificationLab, createDeliveryPackage, sanitizeSnapshot, parseCSV } = require('../src/studio-services');
const { normalizeCandidate, sha256 } = require('../src/studio-services/identity');
const { createZip, readZip } = require('../src/studio-services/archive');
const { runProcess } = require('../src/studio-services/process-runner');
const { buildContainerCommand, runContainerTests, IMAGES } = require('../src/studio-services/container-tests');

const textFile = (name, text) => ({ name, mimeType: 'text/plain', bytes: Buffer.from(text) });
const candidate = files => normalizeCandidate({ id: 'C1', answer: 'Reviewed output', files });

async function temporary(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'converge-services-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

test('atomic project checkpoints keep exact file bytes and strip browser secrets and pending state', async t => {
  const directory = await temporary(t), store = createProjectStore({ directory });
  const bytes = Buffer.from([0, 1, 2, 255]);
  const saved = await store.save({ name: 'Physics report', files: [{ name: 'image.png', mimeType: 'image/png', bytes }],
    snapshot: { task: 'Prepare a report', status: 'running', runId: 'do-not-save-run', pages: { boss: { cookie: 'do-not-save-cookie' } },
      candidate: { id: 'C1', answer: 'Result', media: { runId: 'do-not-save-media', requestId: 'old-request', files: [{ name: 'image.png', csrfToken: 'do-not-save-csrf', base64: 'omitted' }] } },
      boss: { instructions: ['Use accessible labels'], queue: ['do-not-restore-queue'], access_token: 'do-not-save-token' },
      candidateHistory: [{ id: 'C1', text: 'First revision', author: 'left' }] },
    decisionHistory: [{ change: 'Added labels', benefit: 'Readable', session_id: 'do-not-save-session' }] });
  const loaded = await store.load(saved.id);
  assert.deepEqual(Buffer.from(loaded.files[0].base64, 'base64'), bytes);
  assert.equal(loaded.files[0].contentSha256, sha256(bytes));
  assert.equal(loaded.snapshot.status, 'saved'); assert.equal(loaded.snapshot.savedStatus, 'running');
  assert.equal(loaded.snapshot.restoreMode, 'completed-result');
  assert.equal(loaded.revisions[0].author, 'left');
  assert.doesNotMatch(JSON.stringify(loaded), /do-not-|old-request|"base64":"omitted"/);
  assert.deepEqual((await store.list()).map(item => item.id), [saved.id]);
  assert.ok((await fs.readdir(path.join(directory, 'projects'))).every(name => name.endsWith('.json')));
  const archive = await store.export(saved.id), portable = readZip(archive);
  assert.deepEqual(portable.get(`blobs/${sha256(bytes)}.blob`), bytes);
  const imported = await store.import(archive);
  assert.notEqual(imported.id, saved.id);
  assert.equal((await store.load(imported.id)).snapshot.savedStatus, 'running');
  assert.equal((await store.list()).length, 2);
});

test('store rejects traversal, excessive metadata, malformed revisions and substituted or corrupted blobs', async t => {
  const directory = await temporary(t), store = createProjectStore({ directory });
  await assert.rejects(store.load('../outside'), /Invalid project ID/);
  await assert.rejects(store.save({ name: 'bad', files: [textFile('../bad.js', 'x')] }), /safe, unique/);
  await assert.rejects(store.save({ files: [textFile('README.md', 'a'), textFile('readme.md', 'b')] }), /unique/);
  await assert.rejects(store.save({ revisions: {} }), /must be arrays/);
  await assert.rejects(store.save({ snapshot: { task: 'a'.repeat(200_001) } }), /field limit/);
  await assert.rejects(store.save({ files: [{ ...textFile('file.txt', 'changed'), contentSha256: 'a'.repeat(64) }] }), /changed after review/);
  const saved = await store.save({ files: [textFile('file.txt', 'exact')] });
  await fs.writeFile(path.join(directory, 'blobs', `${sha256('exact')}.blob`), 'other');
  await assert.rejects(store.load(saved.id), /SHA-256 check/);
});

test('coordinator envelope checkpoints round-trip sources and each exact revision and selected state', async t => {
  const directory = await temporary(t), store = createProjectStore({ directory });
  const first = candidate([textFile('result.js', 'const answer = 41;')]);
  const second = normalizeCandidate({ id: 'C2', answer: 'Corrected output', files: [textFile('result.js', 'const answer = 42;')] });
  const source = textFile('original.txt', 'User requirements');
  const snapshot = { schema: 'converge-studio-project', version: 1, savedAt: new Date().toISOString(),
    state: { question: 'Create a program', protocol: 'studio', transcript: [{ author: 'boss', text: 'Review units' }],
      boss: { instructions: ['Use proper units'], finalSummary: 'Corrected' }, studio: { preferredRevisionId: 'R2', verification: { status: 'unverified' }, runtimeId: 'must-remove' }, pages: { authenticated: true }, pending: { requestId: 'must-remove' } },
    sources: [source], revisions: [first, second].map((value, index) => ({ id: `R${index + 1}`, round: index + 1, createdAt: new Date().toISOString(),
      candidate: { id: value.id, answer: value.answer, sha256: value.sha256, author: 'left', userRevision: index }, files: value.files })) };
  const saved = await store.save({ name: 'Envelope project', snapshot });
  assert.equal(saved.candidateId, 'C2'); assert.equal(saved.revisionCount, 2); assert.equal(saved.fileCount, 3);
  const loaded = await store.load(saved.id);
  assert.equal(loaded.snapshot.schema, 'converge-studio-project');
  assert.equal(loaded.snapshot.state.studio.preferredRevisionId, 'R2');
  assert.equal(loaded.snapshot.state.studio.runtimeId, undefined);
  assert.equal(loaded.snapshot.state.pending, undefined);
  assert.deepEqual(Buffer.from(loaded.snapshot.sources[0].base64, 'base64'), source.bytes);
  for (let index = 0; index < 2; index += 1) {
    const expected = [first, second][index], revision = loaded.snapshot.revisions[index];
    assert.deepEqual(Buffer.from(revision.files[0].base64, 'base64'), expected.files[0].bytes);
    assert.equal(normalizeCandidate({ ...revision.candidate, files: revision.files }).sha256, expected.sha256);
  }
  const archive = await store.export(saved.id), imported = await store.import(archive), importedSnapshot = (await store.load(imported.id)).snapshot;
  assert.deepEqual(importedSnapshot, loaded.snapshot);
  const changed = await store.save({ id: saved.id, name: 'Updated envelope', snapshot });
  assert.equal(changed.id, saved.id); assert.equal((await store.list()).length, 2);
});

test('completed worker files survive checkpoints before boss selection and portable import with honest draft summaries', async t => {
  const directory = await temporary(t), store = createProjectStore({ directory });
  const source = textFile('source.txt', 'User input'), output = normalizeCandidate({ id: 'W7', answer: 'Completed worker draft', files: [textFile('draft.txt', 'Retained exact bytes')] });
  const snapshot = { schema: 'converge-studio-project', version: 1, savedAt: new Date().toISOString(),
    state: { question: 'Create a document', status: 'blocked', stage: 'Boss review interrupted', completionContext: { status: 'blocked', stage: 'Boss review interrupted' } },
    sources: [source], revisions: [], completedResults: [{ id: 'W7', side: 'right', kind: 'work', round: 3, userRevision: 1,
      text: output.answer, sha256: output.sha256, files: output.files, requestId: 'must-not-restore' }] };
  const saved = await store.save({ name: 'Retained worker output', snapshot });
  assert.equal(saved.outputFileCount, 1); assert.equal(saved.outputStatus, 'draft'); assert.equal(saved.savedStatus, 'blocked');
  assert.equal(saved.completedResultCount, 1); assert.deepEqual(saved.outputNames, ['draft.txt']);
  const loaded = await store.load(saved.id);
  assert.deepEqual(Buffer.from(loaded.snapshot.completedResults[0].files[0].base64, 'base64'), output.files[0].bytes);
  assert.equal(loaded.snapshot.completedResults[0].sha256, output.sha256);
  assert.equal(loaded.snapshot.completedResults[0].requestId, undefined);
  const imported = await store.import(await store.export(saved.id));
  assert.deepEqual((await store.load(imported.id)).snapshot, loaded.snapshot);
  const filename = path.join(directory, 'streamed-project.zip'); await store.exportTo(saved.id, filename);
  const streamed = await store.importFrom(filename);
  assert.deepEqual((await store.load(streamed.id)).snapshot, loaded.snapshot);
  const invalid = structuredClone(snapshot); invalid.completedResults[0].sha256 = 'f'.repeat(64);
  await assert.rejects(store.save({ name: 'Altered draft', snapshot: invalid }), /identity/);
  const sourcesOnly = await store.save({ name: 'Source only', snapshot: { ...snapshot, completedResults: [] } });
  assert.equal(sourcesOnly.fileCount, 1); assert.equal(sourcesOnly.outputFileCount, 0); assert.equal(sourcesOnly.outputStatus, 'none');
  for (const status of ['running', 'blocked', 'idle']) {
    const continued = { ...snapshot, state: { ...snapshot.state, status, completionContext: { status: 'agreed' } } };
    const summary = await store.save({ name: `Continued ${status}`, snapshot: continued });
    assert.equal(summary.savedStatus, status === 'idle' ? 'agreed' : status);
    assert.equal(summary.outputStatus, 'draft', 'Historical completion labels continued work reviewed');
  }
});

test('portable ZIP rejects corrupted CRC, traversal and unexpected project archive members', async t => {
  const directory = await temporary(t), store = createProjectStore({ directory });
  const saved = await store.save({ files: [textFile('data.txt', 'exact data')] });
  const original = await store.export(saved.id), broken = Buffer.from(original);
  const entry = [...readZip(original).entries()].find(([name]) => name.startsWith('blobs/'));
  const offset = broken.indexOf(entry[1]); broken[offset] ^= 1;
  await assert.rejects(store.import(broken), /integrity check/);
  const entries = [...readZip(original)].map(([name, bytes]) => ({ name, bytes }));
  entries.push({ name: 'surprise.txt', bytes: Buffer.from('unwanted') });
  await assert.rejects(store.import(createZip(entries)), /unexpected members/);
  const unsafe = createZip([{ name: 'a/b', bytes: Buffer.from('inert') }]);
  const name = Buffer.from('a/b');
  let at = unsafe.indexOf(name);
  while (at >= 0) { unsafe.write('../', at, 'utf8'); at = unsafe.indexOf(name, at + 3); }
  assert.throws(() => readZip(unsafe), /Invalid project archive/);
});

test('static lab uses actual JavaScript parser without executing candidate side effects and ties every check to exact bytes', async t => {
  const directory = await temporary(t), marker = path.join(directory, 'must-not-exist.txt');
  const good = candidate([textFile('result.js', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'executed');`),
    { name: 'data.json', mimeType: 'application/json', bytes: Buffer.from('{"ok":true}') }]);
  const report = await runVerificationLab({ candidate: good });
  assert.equal(report.status, 'unverified');
  assert.equal(report.checks.find(check => check.id === 'javascript-syntax:result.js').status, 'passed');
  assert.equal(report.checks.find(check => check.id === 'json-parse:data.json').status, 'passed');
  assert.ok(report.checks.every(check => check.candidateSha256 === good.sha256 && check.source === 'executed'));
  await assert.rejects(fs.access(marker), { code: 'ENOENT' });
  const invalid = await runVerificationLab({ candidate: candidate([textFile('broken.js', 'const = ;')]) });
  assert.equal(invalid.status, 'failed');
  assert.match(invalid.checks.find(check => check.id === 'javascript-syntax:broken.js').evidence, /SyntaxError/);
  const substituted = await runVerificationLab({ candidate: { ...good, sha256: 'f'.repeat(64) } });
  assert.equal(substituted.status, 'failed'); assert.equal(substituted.checks.length, 1);
});

test('Python syntax checks parse actual AST without executing candidate code', async t => {
  const probe = spawnSync('python', ['-I', '-S', '-c', 'import sys;print(sys.executable)'], { encoding: 'utf8', windowsHide: true });
  if (probe.status !== 0) { t.skip('No Python interpreter is installed.'); return; }
  const directory = await temporary(t), marker = path.join(directory, 'must-not-exist.txt');
  const report = await runVerificationLab({ pythonExecutable: probe.stdout.trim(), candidate: candidate([textFile('result.py', `open(${JSON.stringify(marker)}, 'w').write('executed')\n`)]) });
  assert.equal(report.checks.find(check => check.id === 'python-syntax:result.py').status, 'passed');
  await assert.rejects(fs.access(marker), { code: 'ENOENT' });
  const invalid = await runVerificationLab({ pythonExecutable: probe.stdout.trim(), candidate: candidate([textFile('broken.py', 'def invalid(:\n')]) });
  assert.equal(invalid.status, 'failed');
});

function tinyPDF() {
  const pieces = ['%PDF-1.4\n'];
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Count 1 /Kids [3 0 R] >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> /Contents 4 0 R >>', '<< /Length 0 >>\nstream\n\nendstream'];
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) { offsets.push(Buffer.byteLength(pieces.join(''))); pieces.push(`${index + 1} 0 obj\n${objects[index]}\nendobj\n`); }
  const start = Buffer.byteLength(pieces.join(''));
  pieces.push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Root 1 0 R /Size 5 >>\nstartxref\n${start}\n%%EOF\n`);
  return Buffer.from(pieces.join(''));
}

test('PDF verification parses real pages in a trusted worker and rejects malformed files', async () => {
  const good = await runVerificationLab({ candidate: candidate([{ name: 'report.pdf', mimeType: 'application/pdf', bytes: tinyPDF() }]) });
  const structure = good.checks.find(check => check.id === 'pdf-structure:report.pdf');
  assert.equal(structure.status, 'passed', structure.evidence);
  assert.match(structure.evidence, /1 pages parsed/);
  assert.equal(structure.pageCount, 1);
  assert.equal(structure.contentSha256, candidate([{ name: 'report.pdf', mimeType: 'application/pdf', bytes: tinyPDF() }]).files[0].contentSha256);
  const rendering = good.checks.find(check => check.id === 'pdf-rendering:report.pdf');
  assert.equal(rendering.status, 'passed', rendering.evidence);
  assert.match(rendering.label, /appearance not reviewed/);
  assert.match(rendering.evidence, /Aesthetic quality, clipping, content accuracy and unrendered pages were not reviewed/);
  assert.equal(good.checks.some(check => check.requirementId === 'document-layout' && check.status === 'passed'), false);
  assert.equal(rendering.rendering.pagesRendered, 1); assert.equal(rendering.rendering.totalPages, 1);
  const bad = await runVerificationLab({ candidate: candidate([{ name: 'broken.pdf', mimeType: 'application/pdf', bytes: Buffer.from('%PDF-1.4\ngarbage') }]) });
  assert.equal(bad.checks.find(check => check.id === 'pdf-structure:broken.pdf').status, 'failed');
});

test('CSV structure catches truncated quotes and row errors; markdown local checks report missing and unavailable remote links', async () => {
  assert.deepEqual(parseCSV('name,value\n"A, B",3\n'), { rows: 2, columns: 2, delimiter: ',' });
  assert.throws(() => parseCSV('a,b\n"broken,3'), /unterminated/);
  assert.throws(() => parseCSV('a,b\n1,2,3'), /expected 2/);
  assert.throws(() => parseCSV('a,b\n"x"junk,3'), /closing quote/);
  const report = await runVerificationLab({ candidate: candidate([{ name: 'README.md', mimeType: 'text/markdown', bytes: Buffer.from('[Missing](missing.txt) [External](https://example.com)') }]) });
  assert.equal(report.checks.find(check => check.id === 'markdown-links:README.md').status, 'failed');
  assert.equal(report.checks.find(check => check.id === 'markdown-remote-links:README.md').status, 'unverified');
});

test('unavailable interpreters and decoders never receive a passed result', async () => {
  const report = await runVerificationLab({ nodeExecutable: '/does-not-exist/converge-node', candidate: candidate([textFile('result.js', 'const answer = 42;'),
    { name: 'result.png', mimeType: 'image/png', bytes: Buffer.from('opaque image') }]) });
  assert.equal(report.checks.find(check => check.id === 'javascript-syntax:result.js').status, 'unverified');
  assert.equal(report.checks.find(check => check.id === 'image-decode:result.png').status, 'unverified');
});

test('oversized image headers are rejected before calling the native decoder', async () => {
  const bytes = Buffer.alloc(24); Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
  bytes.writeUInt32BE(100_000, 16); bytes.writeUInt32BE(100_000, 20);
  let decodeCalled = false;
  const report = await runVerificationLab({ candidate: candidate([{ name: 'huge.png', mimeType: 'image/png', bytes }]),
    nativeImage: { createFromBuffer() { decodeCalled = true; throw new Error('Decoder must not receive this input.'); } } });
  assert.equal(report.status, 'failed'); assert.equal(decodeCalled, false);
  assert.match(report.checks.find(check => check.id === 'file-check:huge.png').evidence, /50 megapixel/);
});

test('isolated container commands enforce resource limits and immutable installed image; timeouts force cleanup', async () => {
  const args = buildContainerCommand({ directory: path.resolve('input'), language: 'javascript', testFiles: ['answer.test.js'], name: 'converge-check-aabb' });
  for (const option of ['--network', '--read-only', '--cap-drop', '--security-opt', '--pids-limit', '--memory', '--memory-swap', '--cpus', '--tmpfs', '--mount', '--pull', '--user']) assert.ok(args.includes(option));
  assert.equal(args[args.indexOf('--network') + 1], 'none'); assert.equal(args[args.indexOf('--pull') + 1], 'never');
  assert.equal(args[args.indexOf('--cap-drop') + 1], 'ALL'); assert.match(args[args.indexOf('--mount') + 1], /readonly$/);
  assert.throws(() => buildContainerCommand({ directory: '/tmp/input', language: 'javascript', testFiles: ['--eval.test.js'], name: 'converge-check-aabb' }), /No supported/);
  const calls = [], imageId = `sha256:${'a'.repeat(64)}`;
  const mockRunner = async (executable, command) => {
    calls.push({ executable, command });
    if (command[0] === 'image') return { code: 0, stdout: `${imageId}\n`, stderr: '' };
    if (command[0] === 'run') return { code: null, stdout: 'partial log', stderr: '', timedOut: true };
    return { code: 0, stdout: '', stderr: '' };
  };
  const checks = await runContainerTests({ directory: path.resolve('input'), files: [textFile('answer.test.js', 'test')], processRunner: mockRunner });
  assert.equal(checks[0].status, 'failed'); assert.match(checks[0].evidence, /timed out/);
  assert.ok(calls.find(call => call.command[0] === 'run').command.includes(imageId));
  assert.ok(!calls.find(call => call.command[0] === 'run').command.includes(IMAGES.javascript));
  assert.deepEqual(calls.slice(-2).map(call => call.command[0]), ['kill', 'rm']);
  const unavailable = await runContainerTests({ directory: path.resolve('input'), files: [textFile('answer.test.js', '')], processRunner: async () => ({ code: null, unavailable: true, stdout: '', stderr: '', error: 'Docker missing' }) });
  assert.equal(unavailable[0].status, 'unverified');
});

test('trusted checker subprocess timeout terminates work and bounds captured output', async () => {
  const timeout = await runProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { timeoutMs: 75 });
  assert.equal(timeout.timedOut, true);
  const flood = await runProcess(process.execPath, ['-e', 'process.stdout.write("x".repeat(50000));'], { maxOutput: 100 });
  assert.equal(flood.outputLimited, true); assert.equal(flood.stdout.length, 100);
});

test('delivery ZIP preserves current bytes, verifiable manifest hashes and honest statuses and rejects stale verification', async () => {
  const current = candidate([{ name: 'data.json', mimeType: 'application/json', bytes: Buffer.from('{"answer":42}') }]);
  const report = await runVerificationLab({ candidate: current });
  const delivery = createDeliveryPackage({ candidate: current, verification: report, project: { name: 'Research result', revisions: [{ change: 'Corrected units' }], snapshot: { task: 'Create JSON' } },
    workflowStatus: 'blocked', bossSummary: 'Native tool unavailable', limitations: ['No runtime verification'],
    requirementStatuses: [{ id: 'runtime', status: 'unverified', source: 'local' }], unresolvedIssues: ['Runtime behavior has not been exercised.'] });
  const entries = readZip(delivery.bytes), manifestText = entries.get('manifest.json'), manifest = JSON.parse(manifestText);
  assert.equal(manifest.candidateSha256, current.sha256); assert.equal(manifest.verificationStatus, 'unverified');
  assert.deepEqual(entries.get('files/data.json'), current.files[0].bytes);
  for (const file of manifest.files) { assert.equal(sha256(entries.get(file.name)), file.sha256); assert.equal(entries.get(file.name).length, file.byteLength); }
  assert.equal(entries.get('manifest.sha256').toString(), `${sha256(manifestText)}  manifest.json\n`);
  assert.match(entries.get('README.md').toString(), /\*\*unverified\*\*/);
  assert.equal(JSON.parse(entries.get('delivery-summary.json')).workflowStatus, 'blocked');
  assert.equal(JSON.parse(entries.get('delivery-summary.json')).bossSummary, 'Native tool unavailable');
  assert.equal(createDeliveryPackage({ candidate: current, verification: { status: 'idle', candidateId: null } }).status, 'unverified');
  assert.throws(() => createDeliveryPackage({ candidate: current, verification: { ...report, candidateSha256: 'b'.repeat(64) } }), /another candidate/);
  const changed = candidate([{ name: 'data.json', mimeType: 'application/json', bytes: Buffer.from('{"answer":43}') }]);
  assert.throws(() => createDeliveryPackage({ candidate: changed, verification: report }), /another candidate/);
});

test('a delivery requested during local verification records unverified in-progress coverage', () => {
  const current = candidate([textFile('answer.js', 'const answer = 42;')]);
  const delivered = createDeliveryPackage({ candidate: current, verification: { status: 'running', candidateId: current.id,
    candidateSha256: current.sha256, checks: [], summary: 'Checking the exact files.' } });
  const report = JSON.parse(readZip(delivered.bytes).get('verification.json'));
  assert.equal(report.status, 'unverified'); assert.match(report.summary, /still running/);
});

test('large tool diagnostic logs remain bounded and keep their real failed status', async () => {
  const current = candidate([textFile('broken.js', 'invalid')]);
  const report = await runVerificationLab({ candidate: current, processRunner: async () => ({ code: 1, stdout: '', stderr: 'SyntaxError: '.repeat(2_000), timedOut: false, outputLimited: false }) });
  const check = report.checks.find(item => item.id === 'javascript-syntax:broken.js');
  assert.equal(check.status, 'failed'); assert.ok(check.evidence.length <= 16_000);
  assert.match(check.evidence, /truncated/);
});

test('long supported filenames produce valid bounded check IDs and contradictory report success is never exported', async () => {
  const current = candidate([textFile(`${'a'.repeat(176)}.js`, 'const answer = 42;')]);
  const report = await runVerificationLab({ candidate: current });
  assert.ok(report.checks.every(check => check.id.length <= 180));
  const delivery = createDeliveryPackage({ candidate: current, verification: { ...report, status: 'passed',
    checks: [{ id: 'syntax', label: 'Syntax', status: 'failed', source: 'executed', evidence: 'Actual parser failed.' }] } });
  assert.equal(delivery.status, 'failed');
});

test('an aborted trusted parser process is terminated and cancelled candidate checks remain unverified', async () => {
  const controller = new AbortController();
  const pending = runProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { signal: controller.signal, timeoutMs: 10_000 });
  controller.abort();
  const run = await pending;
  assert.equal(run.aborted, true); assert.equal(run.timedOut, false);
  const current = candidate([textFile('answer.js', 'const answer = 42;')]);
  const report = await runVerificationLab({ candidate: current, signal: controller.signal });
  assert.equal(report.status, 'unverified');
  assert.equal(report.checks.find(check => check.id === 'verification-cancelled').status, 'unverified');
  assert.ok(!report.checks.some(check => check.id.startsWith('javascript-syntax:')));
});

test('snapshot whitelist keeps useful author decisions while rejecting prototype and nested secrets', () => {
  const source = JSON.parse('{"task":"x","candidate":{"author":"left","apiKey":"private","pageAuthentication":"private","refreshToken":"private","__proto__":{"bad":true}},"unknown":{"cookies":"private"}}');
  const safe = sanitizeSnapshot(source);
  assert.equal(safe.candidate.author, 'left'); assert.equal(safe.candidate.apiKey, undefined); assert.equal(safe.unknown, undefined);
  assert.equal(safe.candidate.pageAuthentication, undefined); assert.equal(safe.candidate.refreshToken, undefined);
  assert.equal(safe.candidate.__proto__, undefined);
});
