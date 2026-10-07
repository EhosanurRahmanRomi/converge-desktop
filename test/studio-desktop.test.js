'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { createStudioDesktop } = require('../src/platform/studio-desktop');
const { candidateDigest } = require('../src/browser/boss-coordinator');
const { emptyStudio } = require('../src/studio/workflow');
const { readZip } = require('../src/studio-services/archive');
const sha = value => createHash('sha256').update(value).digest('hex');

function project(question = 'Repair and validate the JSON output.') {
  const bytes = Buffer.from('{"count":2}\n');
  const file = { name: 'answer.json', mimeType: 'application/json', base64: bytes.toString('base64'), contentSha256: sha(bytes), byteLength: bytes.length };
  const candidate = { id: 'C1', answer: 'Corrected JSON.', author: 'left', resultId: 'W1', userRevision: 1,
    sha256: candidateDigest('Corrected JSON.', { files: [file] }), media: { files: [{ ...file, base64: undefined }] } };
  return { schema: 'converge-studio-project', version: 1, savedAt: new Date().toISOString(),
    state: { question, answer: candidate.answer, status: 'blocked', candidate, userRevision: 1, chatMode: 'normal',
      studio: { ...emptyStudio({ verificationEnabled: true }), preferredRevisionId: 'R1', contract: { task: question, acceptanceCriteria: [] } } },
    sources: [], revisions: [{ id: 'R1', candidate, files: [file] }] };
}
async function harness(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'converge-studio-desktop-test-'));
  t.after(async () => {
    const relative = path.relative(os.tmpdir(), directory);
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative) && path.basename(directory).startsWith('converge-studio-desktop-test-'));
    await fs.rm(directory, { recursive: true, force: true });
  });
  let snapshot = project(), unloads = 0;
  const handlers = new Map(), notices = [];
  const coordinator = {
    getState: async () => structuredClone(snapshot.state), exportProject: async () => structuredClone(snapshot),
    restoreProject: async value => { snapshot = structuredClone(value); },
    getCurrentCandidate: async () => ({ ...snapshot.revisions[0].candidate, files: snapshot.revisions[0].files }),
    updateStudioSettings: async () => {}, setRequirementReview: async () => {}, setIssueReview: async () => {},
    restoreRevision: async () => {}, runVerification: async () => {},
  };
  const savePath = path.join(directory, 'delivery.zip');
  const studio = createStudioDesktop({ directory, dialogs: { showSaveDialog: options.showSaveDialog || (async () => ({ filePath: savePath, canceled: false })) },
    shell: { openPath: async () => '' }, onChange: info => notices.push(info), pythonExecutable: null,
    ...(options.verificationRunner ? { verificationRunner: options.verificationRunner } : {}) });
  studio.register({ handle: (name, callback) => handlers.set(name, callback), getCoordinator: () => coordinator,
    assertIdle: async () => assert.notEqual(snapshot.state.status, 'running'), unloadPages: async () => { unloads++; } });
  t.after(() => studio.dispose());
  return { studio, directory, handlers, notices, coordinator, savePath, get unloads() { return unloads; }, setSnapshot: value => { snapshot = value; } };
}

test('desktop saves and reloads the private project envelope with exact revision bytes', async t => {
  const h = await harness(t);
  const saved = await h.handlers.get('studio:project-save')({ name: 'JSON repair' });
  assert.equal(saved.ok, true); assert.equal(saved.project.name, 'JSON repair');
  const listed = await h.handlers.get('studio:project-list')();
  assert.equal(listed.projects.length, 1);
  const loaded = await h.handlers.get('studio:project-load')({ id: saved.project.id });
  assert.equal(loaded.reconnectRequired, true); assert.equal(h.unloads, 1);
  const restored = await h.coordinator.exportProject();
  assert.equal(restored.state.question, project().state.question);
  assert.equal(restored.revisions[0].files[0].base64, project().revisions[0].files[0].base64);
  assert.equal(loaded.state.projectInfo.name, 'JSON repair');
});

test('desktop previews only an owned revision file and retains exact file identity', async t => {
  const h = await harness(t);
  const preview = await h.handlers.get('studio:revision-preview')({ revisionId: 'R1', fileId: 'answer.json' });
  assert.equal(preview.kind, 'text'); assert.match(preview.text, /"count":2/);
  assert.equal(preview.sha256, project().revisions[0].files[0].contentSha256);
  await assert.rejects(h.handlers.get('studio:revision-preview')({ revisionId: 'R1', fileId: '../../secrets.txt' }), /unavailable/);
  await assert.rejects(h.handlers.get('studio:revision-open')({ revisionId: 'R1', fileId: 'answer.json' }), /Only PDF/);
});

test('saved project downloads work without reconnecting or disturbing a running task and preserve review status', async t => {
  const h = await harness(t), saved = await h.handlers.get('studio:project-save')({ name: 'Earlier draft' });
  const active = project('A different task is still working.'); active.state.status = 'running'; h.setSnapshot(active);
  const downloaded = await h.handlers.get('studio:project-download')({ id: saved.project.id });
  assert.equal(downloaded.saved, true); assert.equal(downloaded.outputStatus, 'draft'); assert.equal(downloaded.fileCount, 1);
  assert.equal(h.unloads, 0); assert.equal((await h.coordinator.getState()).status, 'running');
  assert.equal((await h.coordinator.getState()).question, active.state.question);
  const archive = readZip(await fs.readFile(h.savePath));
  assert.deepEqual(archive.get('files/answer.json'), Buffer.from(project().revisions[0].files[0].base64, 'base64'));
  assert.equal(JSON.parse(archive.get('delivery-summary.json')).workflowStatus, 'blocked');
  assert.equal(JSON.parse(archive.get('delivery-summary.json')).localVerificationStatus, 'unverified');
  await assert.rejects(h.handlers.get('studio:project-download')({ id: '../other-project' }), /Invalid project ID/);
  for (const status of ['running', 'blocked', 'idle']) {
    const continued = project(); continued.state.status = status; continued.state.completionContext = { status: 'agreed' };
    h.setSnapshot(continued); const checkpoint = await h.handlers.get('studio:project-save')({ name: `Continued ${status}` });
    const exported = await h.handlers.get('studio:project-download')({ id: checkpoint.project.id });
    assert.equal(exported.outputStatus, 'draft');
    assert.equal(JSON.parse(readZip(await fs.readFile(h.savePath)).get('delivery-summary.json')).workflowStatus, status === 'idle' ? 'saved-review-required' : status);
  }
});

test('owned revision downloads capture exact selected bytes while work continues through the dialog', async t => {
  let choose, opened;
  const ready = new Promise(resolve => { opened = resolve; });
  const h = await harness(t, { showSaveDialog: async () => { opened(); return new Promise(resolve => { choose = resolve; }); } });
  const active = project(); active.state.status = 'running'; h.setSnapshot(active);
  const operation = h.handlers.get('studio:revision-save')({ revisionId: 'R1', fileId: 'answer.json', fileIndex: 0 });
  await ready; h.setSnapshot(project('The next revision is working.'));
  choose({ canceled: false, filePath: h.savePath });
  const downloaded = await operation;
  assert.equal(downloaded.saved, true); assert.equal(downloaded.sha256, active.revisions[0].files[0].contentSha256);
  assert.deepEqual(await fs.readFile(h.savePath), Buffer.from(active.revisions[0].files[0].base64, 'base64'));
  assert.equal(h.unloads, 0); assert.equal((await h.coordinator.getState()).question, 'The next revision is working.');
  await assert.rejects(h.handlers.get('studio:revision-save')({ revisionId: 'R1', fileId: 'not-owned.txt' }), /unavailable/);
});

test('closing a saved-file dialog cannot commit a late revision download', async t => {
  let choose, opened; const ready = new Promise(resolve => { opened = resolve; });
  const h = await harness(t, { showSaveDialog: async () => { opened(); return new Promise(resolve => { choose = resolve; }); } });
  const operation = h.handlers.get('studio:revision-save')({ revisionId: 'R1', fileId: 'answer.json' });
  await ready; const closed = h.studio.dispose(); choose({ canceled: false, filePath: h.savePath });
  await assert.rejects(operation, /closed/); await closed;
  await assert.rejects(fs.access(h.savePath), { code: 'ENOENT' });
});

test('desktop previews an owned Unicode TSV revision with its exact canonical name and hash', async t => {
  const h = await harness(t), snapshot = project('Audit the CED scope manifest.');
  const name = 'ced_scope_manifest.tsv', text = 'scope\tstatus\nবাংলা\tchecked\n';
  const bytes = Buffer.concat([Buffer.from([255, 254]), Buffer.from(text, 'utf16le')]);
  const file = { name, mimeType: 'text/tab-separated-values', base64: bytes.toString('base64'), contentSha256: sha(bytes), byteLength: bytes.length };
  snapshot.revisions[0].files = [file]; h.setSnapshot(snapshot);
  const preview = await h.handlers.get('studio:revision-preview')({ revisionId: 'R1', fileId: name });
  assert.equal(preview.kind, 'text'); assert.equal(preview.name, name); assert.equal(preview.sha256, sha(bytes));
  assert.equal(preview.text, text);
});

test('an invalid saved envelope cannot reset the current pages or project', async t => {
  const h = await harness(t);
  const snapshot = project(); snapshot.state.chatMode = 'invalid'; h.setSnapshot(snapshot);
  const saved = await h.handlers.get('studio:project-save')({ name: 'Invalid imported envelope' });
  const before = h.studio.getInfo();
  h.setSnapshot(project('Current work must stay intact.'));
  await assert.rejects(h.handlers.get('studio:project-load')({ id: saved.project.id }), /chat mode/);
  assert.equal(h.unloads, 0);
  assert.equal((await h.coordinator.getState()).question, 'Current work must stay intact.');
  assert.deepEqual(h.studio.getInfo(), before);
});

test('checkpoint persistence is separate from live browser authentication', async t => {
  const h = await harness(t);
  const snapshot = project();
  snapshot.state.cookies = [{ value: 'private-cookie' }];
  snapshot.state.pending = { boss: { requestId: 'stale-request' } };
  h.studio.checkpoint(snapshot);
  await h.studio.flush();
  const projects = await h.handlers.get('studio:project-list')();
  assert.equal(projects.projects.length, 1);
  const metadata = await fs.readFile(path.join(h.directory, 'projects', projects.projects[0].id + '.json'), 'utf8');
  assert.doesNotMatch(metadata, /private-cookie|stale-request/);
  assert.ok(h.notices.some(value => value.status === 'saved'));
});

test('Reset and a repeated brief create a separate saved project and preserve earlier revisions', async t => {
  const h = await harness(t);
  const first = project('Fix the same task.'); first.state.studio.contract.createdAt = 100;
  h.studio.checkpoint(first); await h.studio.flush();
  const previousId = h.studio.getInfo().id;
  h.studio.checkpoint({ state: { question: '' } });
  const second = project('Fix the same task.'); second.state.studio.contract.createdAt = 200;
  h.studio.checkpoint(second); await h.studio.flush();
  assert.notEqual(h.studio.getInfo().id, previousId);
  assert.equal((await h.handlers.get('studio:project-list')()).projects.length, 2);
  const previous = await fs.readFile(path.join(h.directory, 'projects', previousId + '.json'), 'utf8');
  assert.match(previous, /"createdAt":100/);
});

test('native delivery export writes a real archive and running tasks cannot replace a revision', async t => {
  const h = await harness(t);
  const delivered = await h.handlers.get('studio:delivery-export')();
  assert.equal(delivered.saved, true);
  const bytes = await fs.readFile(h.savePath);
  assert.equal(bytes.readUInt32LE(0), 0x04034b50);
  const active = project(); active.state.status = 'running'; h.setSnapshot(active);
  await assert.rejects(h.handlers.get('studio:restore-revision')({ id: 'R1' }), /Stop the current task/);
  await assert.rejects(h.handlers.get('studio:delivery-export')(), /Stop the current task/);
});

test('project export cannot silently return an older checkpoint after the current autosave failed', async t => {
  const h = await harness(t);
  const saved = await h.handlers.get('studio:project-save')({ name: 'Original project' });
  const invalid = project(); invalid.revisions[0].candidate.sha256 = 'f'.repeat(64);
  h.setSnapshot(invalid); h.studio.checkpoint(invalid); await h.studio.flush();
  assert.equal(h.studio.getInfo().status, 'error');
  await assert.rejects(h.handlers.get('studio:project-export')(), /identity/);
  assert.equal(h.studio.getInfo().id, saved.project.id);
  await assert.rejects(fs.access(h.savePath), { code: 'ENOENT' });
});

test('failed Save as preserves the current saved project identity and a valid retry recovers', async t => {
  const h = await harness(t);
  const saved = await h.handlers.get('studio:project-save')({ name: 'Current project' });
  const invalid = project(); invalid.revisions[0].candidate.sha256 = 'f'.repeat(64); h.setSnapshot(invalid);
  await assert.rejects(h.handlers.get('studio:project-save')({ saveAs: true, name: 'Broken copy' }), /identity/);
  assert.equal(h.studio.getInfo().id, saved.project.id);
  h.setSnapshot(project());
  const retry = await h.handlers.get('studio:project-save')({ name: 'Recovered project' });
  assert.equal(retry.project.id, saved.project.id); assert.equal(h.studio.getInfo().status, 'saved');
});

test('closing while a delivery dialog is open prevents its late result from writing a file', async t => {
  let choose, opened;
  const ready = new Promise(resolve => { opened = resolve; });
  const h = await harness(t, { showSaveDialog: async () => { opened(); return new Promise(resolve => { choose = resolve; }); } });
  const operation = h.handlers.get('studio:delivery-export')(); await ready;
  const closed = h.studio.dispose();
  choose({ canceled: false, filePath: h.savePath });
  await assert.rejects(operation, /closed/); await closed;
  await assert.rejects(fs.access(h.savePath), { code: 'ENOENT' });
  await assert.rejects(h.handlers.get('studio:project-save')({ name: 'Too late' }), /closed/);
});

test('file previews use their requested index when two filenames have identical byte hashes', async t => {
  const h = await harness(t), snapshot = project();
  const first = snapshot.revisions[0].files[0], second = { ...first, name: 'second.json' };
  snapshot.revisions[0].files.push(second); h.setSnapshot(snapshot);
  const preview = await h.handlers.get('studio:revision-preview')({ revisionId: 'R1', fileId: second.contentSha256, fileIndex: 1 });
  assert.equal(preview.name, 'second.json');
});

test('delivery rejects a candidate changed during its dialog and project operations cannot overlap', async t => {
  let choose, opened;
  const ready = new Promise(resolve => { opened = resolve; });
  const h = await harness(t, { showSaveDialog: async () => { opened(); return new Promise(resolve => { choose = resolve; }); } });
  const operation = h.handlers.get('studio:delivery-export')(); await ready;
  await assert.rejects(h.handlers.get('studio:project-save')({ name: 'Concurrent save' }), /current project operation/);
  const changed = project(); changed.state.studio.contract.acceptanceCriteria.push('New acceptance condition'); h.setSnapshot(changed);
  choose({ canceled: false, filePath: h.savePath });
  await assert.rejects(operation, /review changed/);
  await assert.rejects(fs.access(h.savePath), { code: 'ENOENT' });
});

test('delivery identity ignores fresh snapshot timestamps but retains stable content', async t => {
  const h = await harness(t);
  const original = h.coordinator.exportProject;
  let serial = 0;
  h.coordinator.exportProject = async () => ({ ...await original(), savedAt: new Date(Date.now() + serial++).toISOString() });
  assert.equal((await h.handlers.get('studio:delivery-export')()).saved, true);
});

test('Close cancels owned verification work and waits for its cleanup', async t => {
  let began, completed = false;
  const ready = new Promise(resolve => { began = resolve; });
  const h = await harness(t, { verificationRunner: async ({ signal }) => {
    began();
    await new Promise(resolve => { signal.addEventListener('abort', resolve, { once: true }); });
    completed = true; return { status: 'unverified', checks: [] };
  } });
  const pending = h.studio.verification({ id: 'C1' }); await ready;
  await h.studio.dispose(); await pending;
  assert.equal(completed, true);
  assert.throws(() => h.studio.verification({ id: 'C1' }), /closed/);
});
