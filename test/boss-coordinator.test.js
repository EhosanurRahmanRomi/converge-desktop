'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createFileStore } = require('../src/browser/file-store');
const { createProjectStore } = require('../src/studio-services/project-store');
const { sendUpload } = require('../src/browser/upload-transport');
const { createBossCoordinator, parseBossReply, parseVerification, validateFiles, candidateDigest } = require('../src/browser/boss-coordinator');

const READY = { ok: true, ready: true, authenticated: true, temporary: false, unpersonalized: false, work: false, busy: false };
const pause = () => new Promise(resolve => setImmediate(resolve));
const hash = value => createHash('sha256').update(value).digest('hex');

async function until(check, label = 'Expected coordinator state was not reached') {
  for (let attempt = 0; attempt < 200; attempt += 1) { if (await check()) return; await pause(); }
  assert.fail(label);
}

function marker(body, name) {
  const source = body.split(`BEGIN_${name}_JSON\n`)[1]?.split(`\nEND_${name}_JSON`)[0];
  return source ? JSON.parse(source) : null;
}

function harness(options = {}) {
  const sent = [], opened = [], exported = new Map();
  const urls = { left: 'about:blank', right: 'about:blank', boss: 'about:blank' };
  const pages = Object.fromEntries(Object.keys(urls).map(side => [side, { ...READY, ...(options.page || {}) }]));
  let coordinator;
  let workCount = 0;

  function generatedFile(side, message, bytes = Buffer.from(`value = ${++workCount}\n`)) {
    const digest = hash(bytes);
    const file = { id: `output-${message.requestId}`, name: 'answer.py', mimeType: 'text/plain',
      fingerprint: `fp-${message.requestId}`, contentSha256: digest, byteLength: bytes.length, base64: bytes.toString('base64') };
    exported.set(`${message.runId}:${message.requestId}`, [file]);
    return { ...file, base64: undefined };
  }

  coordinator = createBossCoordinator({
    requestTimeoutMs: options.requestTimeoutMs,
    runTimeoutMs: options.runTimeoutMs,
    supervisionIntervalMs: options.supervisionIntervalMs,
    freshAuditReadyTimeoutMs: options.freshAuditReadyTimeoutMs,
    freshAuditReadyIntervalMs: options.freshAuditReadyIntervalMs,
    onState: options.onState,
    onCheckpoint: options.onCheckpoint,
    runVerification: options.runVerification,
    async openPage(side, url) { opened.push(side); urls[side] = url; if (options.openPage) await options.openPage(side, url, { opened }); },
    getPageUrl(side) { return urls[side]; },
    async sendToPage(side, message) {
      sent.push({ side, message });
      if (options.transport) {
        const supplied = await options.transport(side, message, { sent, exported, generatedFile });
        if (supplied !== undefined) return supplied;
      }
      if (['INSPECT', 'PREPARE'].includes(message.type)) return { ...pages[side] };
      if (message.type === 'UPLOAD_FILES') return { ok: true, attached: message.files.length };
      if (message.type === 'RESUME_RUN') return { ok: true };
      if (message.type === 'EXPORT_MEDIA') return { ok: true, files: structuredClone(exported.get(`${message.runId}:${message.requestId}`) || []) };
      if (message.type === 'SEND_PROMPT' && options.reply) {
        const response = options.reply(side, message, { sent, exported, generatedFile });
        if (response !== undefined && response !== null) queueMicrotask(() => coordinator.pageEvent(side, {
          type: 'REPLY', runId: message.runId, requestId: message.requestId,
          ...(typeof response === 'string' ? { text: response } : response),
        }));
      }
      return { ok: true };
    },
  });
  return { coordinator, sent, opened, exported, urls, pages, generatedFile,
    prompts: () => sent.filter(item => item.message.type === 'SEND_PROMPT'),
    async reply(call, value) { return coordinator.pageEvent(call.side, { type: 'REPLY', runId: call.message.runId,
      requestId: call.message.requestId, ...(typeof value === 'string' ? { text: value } : { text: JSON.stringify(value) }) }); },
  };
}

function normalReply(side, message, { generatedFile }, withFiles = false) {
  if (side === 'boss') {
    const context = marker(message.text, 'BOSS_CONTEXT');
    if (context.recovery_task) return { text: JSON.stringify({ request_id: message.requestId, action: 'repair',
      side: context.recovery_task.side, assignment: `Continue saved useful work, repair ${context.recovery_task.category}, and deliver the actual checkpoint. ${context.recovery_task.original_assignment}`,
      summary: 'Focused recovery; the healthy peer keeps working.' }) };
    const latest = [...context.result_index].reverse().find(result => result.side === 'left' && result.kind === 'work');
    let plan;
    if (context.final_verification && Object.values(context.final_verification.workers).length === 2 &&
        Object.values(context.final_verification.workers).every(worker => worker.verdict === 'accept')) {
      plan = { request_id: message.requestId, action: 'finish', candidate_id: context.candidate.id,
        answer: 'Boss summary of the completed work.', checks: ['Both exact candidate checks passed.'], limitations: ['Model agreement alone is not proof.'] };
    } else if (context.completed_work_cycles >= context.min_work_cycles) {
      plan = { request_id: message.requestId, action: 'verify', candidate_result_id: latest.id,
        assignments: { left: 'Check the exact implementation and its boundaries.', right: 'Independently check the selected result and edge cases.' } };
    } else {
      plan = { request_id: message.requestId, action: 'dispatch', summary: `Dynamic plan ${context.completed_work_cycles + 1}`,
        assignments: { left: `Investigate failure case A in cycle ${context.completed_work_cycles + 1}.`,
          right: `Find useful independent improvement B in cycle ${context.completed_work_cycles + 1}.` },
        candidate_result_id: latest?.id || null };
    }
    return { text: JSON.stringify(plan) };
  }
  if (message.text.includes('Perform an independent final check')) {
    const candidate = marker(message.text, 'FINAL_CANDIDATE');
    return { text: JSON.stringify({ candidate_id: candidate.id, candidate_sha256: candidate.sha256,
      verdict: 'accept', checks: ['Checked the supplied value and a boundary case.'], issues: [], answer: 'Check passed.' }) };
  }
  return { text: `Worker ${side} useful result for ${message.requestId}`,
    ...(withFiles ? { media: [generatedFile(side, message)] } : {}) };
}

test('control and verification JSON remain exact while a real download link appears beside one object', () => {
  const control = { request_id: 'owned', action: 'dispatch', assignments: { left: 'Inspect a { literal }.', right: 'Check escaped "quotes".' } };
  assert.equal(parseBossReply(`Here is the plan.\n\`\`\`json\n${JSON.stringify(control)}\n\`\`\`\n[Download report](sandbox:/mnt/data/report.txt)`, 'owned').action, 'dispatch');
  const candidate = { id: 'C1', sha256: hash('exact') };
  const review = { candidate_id: candidate.id, candidate_sha256: candidate.sha256,
    verdict: 'revise', checks: ['Checked the exact original'], issues: ['A figure label required correction.'] };
  assert.equal(parseVerification(`\`\`\`json\n${JSON.stringify(review)}\n\`\`\`\nDownload corrected.pdf`, candidate).verdict, 'revise');
  assert.throws(() => parseBossReply(`${JSON.stringify(control)}\n${JSON.stringify({ ...control, action: 'blocked', reason: 'Contradictory plan' })}`, 'owned'), /one valid JSON/);
  assert.throws(() => parseBossReply(`\`\`\`json\n${JSON.stringify({ ...control, request_id: 'stale' })}\n\`\`\`\nDownload report.txt`, 'owned'), /does not match/);
  assert.throws(() => parseVerification(`\`\`\`json\n${JSON.stringify({ ...review, candidate_sha256: hash('different') })}\n\`\`\`\nDownload corrected.pdf`, candidate), /exact candidate/);
  assert.throws(() => parseBossReply(`\`\`\`json\n{ invalid }\n\`\`\`\n\`\`\`json\n${JSON.stringify(control)}\n\`\`\``, 'owned'), /Multiple control blocks/);
  assert.throws(() => parseBossReply(`I suggest this arbitrary object: ${JSON.stringify(control)}`, 'owned'), /one valid JSON/);
});

test('PDF acceptance needs exact rendered-page evidence and rejects another PDF identity', () => {
  const pdf = { name: 'lecture-notes.pdf', mimeType: 'application/pdf', contentSha256: hash('PDF bytes'), byteLength: 20 };
  const candidate = { id: 'C1', sha256: hash('candidate'), media: { files: [pdf] } };
  const review = { candidate_id: candidate.id, candidate_sha256: candidate.sha256,
    verdict: 'accept', checks: ['Observed the complete candidate'], issues: [] };
  assert.throws(() => parseVerification(JSON.stringify(review), candidate), /PDF acceptance requires/);
  review.documentReview = { files: [{ name: pdf.name, contentSha256: pdf.contentSha256, pageCount: 2,
    renderedPages: [1, 2], inspectedPages: [1, 2] }], checks: { typography: 'Embedded body fonts and mathematical glyphs were legible on both pages.',
      spacing: 'Both pages retain consistent margins and equation spacing without overlaps.',
      mathematics: 'Every displayed derivation is aligned and Greek symbols render correctly.',
      figures: 'The figure on page 2 has clear labels and a readable numbered caption.',
      referenceStyle: 'No reference was supplied; the academic design uses restrained headings.' }, limitations: [] };
  assert.equal(parseVerification(JSON.stringify(review), candidate).documentReview.source, 'model');
  review.documentReview.files[0].contentSha256 = hash('other bytes');
  assert.throws(() => parseVerification(JSON.stringify(review), candidate), /exact candidate PDF/);
});

test('style-reference uploads commit exact names and design identity without inferring PDF output', async t => {
  const h = harness(); t.after(() => h.coordinator.dispose());
  await h.coordinator.request('OPEN_LAYOUT', { chatMode: 'normal' });
  const bytes = Buffer.from('%PDF-1.7 style only');
  const uploaded = await h.coordinator.request('ATTACH_FILES', { fileRole: 'style-reference', files: [
    { name: 'Good Notes.pdf', mimeType: 'application/pdf', base64: bytes.toString('base64') }] });
  assert.equal(uploaded.ok, true, uploaded.error);
  assert.deepEqual(uploaded.state.studio.settings.documentDesign.referenceNames, ['Good Notes.pdf']);
  assert.equal(uploaded.state.attachments.fileRole, 'style-reference');
  const started = await h.coordinator.request('START', { question: 'Explain the principles of legible typography. Do not create any files.' });
  assert.equal(started.ok, true, started.error);
  await until(() => h.prompts().length === 1);
  const context = marker(h.prompts()[0].message.text, 'BOSS_CONTEXT');
  assert.equal(context.required_outputs.pdf, false); assert.equal(context.required_outputs.files, false);
  assert.equal(context.originals[0].role, 'style-reference');
  assert.equal(context.studio.documentDesign.styleReferences[0].contentSha256, hash(bytes));
  assert.equal(context.studio.documentDesign.contentSources.length, 0);
  const saved = await h.coordinator.exportProject();
  const restored = harness(); t.after(() => restored.coordinator.dispose());
  const loaded = await restored.coordinator.restoreProject(saved);
  assert.equal(loaded.ok, true, loaded.error);
  assert.equal(loaded.state.requireFiles, false); assert.equal(loaded.state.requirePdf, false);
  assert.deepEqual(loaded.state.studio.settings.documentDesign.referenceNames, ['Good Notes.pdf']);
});

test('style-reference role survives receipt recovery without premature preference commit or duplicate upload', async t => {
  let receiptReady = false;
  const h = harness({ transport(side, message) {
    if (side === 'boss' && message.type === 'UPLOAD_FILES') return { ok: false, error: 'Upload acknowledgement timed out.' };
    if (message.type === 'CHECK_ATTACHMENTS') return { ok: receiptReady, attached: receiptReady ? message.names.length : 0, error: 'Still processing.' };
  } }); t.after(() => h.coordinator.dispose());
  await h.coordinator.request('OPEN_LAYOUT', { chatMode: 'normal' });
  const attached = await h.coordinator.request('ATTACH_FILES', { fileRole: 'style-reference', files: [
    { name: 'Reference.pdf', mimeType: 'application/pdf', base64: Buffer.from('%PDF-1.7 ref').toString('base64') }] });
  assert.equal(attached.ok, false);
  const state = await h.coordinator.getState();
  assert.deepEqual(state.studio.settings.documentDesign?.referenceNames || [], []);
  assert.deepEqual(state.attachments.referenceNames, ['Reference.pdf']); assert.equal(state.attachments.fileRole, 'style-reference');
  assert.equal((await h.coordinator.request('RECHECK_ATTACHMENTS')).ok, false);
  receiptReady = true;
  const recovered = await h.coordinator.request('RECHECK_ATTACHMENTS');
  assert.equal(recovered.ok, true, recovered.error);
  assert.deepEqual(recovered.state.studio.settings.documentDesign.referenceNames, ['Reference.pdf']);
  assert.equal(recovered.state.attachments.fileRole, 'style-reference');
  assert.equal(h.sent.filter(call => call.message.type === 'UPLOAD_FILES').length, 3);
});

test('PDF production prompts preserve content scope, style-reference identities and page inspection contract', async t => {
  const h = harness(); t.after(() => h.coordinator.dispose());
  await h.coordinator.request('OPEN_LAYOUT', { chatMode: 'normal' });
  await h.coordinator.request('ATTACH_FILES', { fileRole: 'content-source', files: [
    { name: 'notes.txt', mimeType: 'text/plain', base64: Buffer.from('Lecture 1: electrostatics.').toString('base64') }] });
  await h.coordinator.request('ATTACH_FILES', { fileRole: 'style-reference', files: [
    { name: 'Good Notes.pdf', mimeType: 'application/pdf', base64: Buffer.from('%PDF-1.7 reference').toString('base64') }] });
  const started = await h.coordinator.request('START', { question: 'Create expanded lecture notes as a downloadable PDF using the attached notes.', relayMedia: true });
  assert.equal(started.ok, true, started.error);
  await until(() => h.prompts().length === 1);
  const boss = h.prompts()[0];
  assert.match(boss.message.text, /representative design sample/);
  assert.match(boss.message.text, /documentReview for exact PDF identities/);
  const context = marker(boss.message.text, 'BOSS_CONTEXT');
  assert.deepEqual(context.originals.map(file => file.role), ['content-source', 'style-reference']);
  await h.reply(boss, { request_id: boss.message.requestId, action: 'dispatch', assignments: {
    left: 'Produce the designed full notes.', right: 'Check lecture completeness and design.' } });
  await until(() => h.prompts().length === 3);
  for (const worker of h.prompts().slice(1)) {
    assert.match(worker.message.text, /Good Notes\.pdf \(SHA-256 [a-f0-9]{64}\)/);
    assert.match(worker.message.text, /not a compulsory extra round/);
    assert.match(worker.message.text, /Style references guide appearance only/);
    assert.equal(marker(worker.message.text, 'STUDIO_CONTRACT').documentDesign.styleReferences[0].name, 'Good Notes.pdf');
  }
});

async function begin(h, settings = {}) {
  assert.equal((await h.coordinator.request('OPEN_LAYOUT', { chatMode: 'normal' })).ok, true);
  const result = await h.coordinator.request('START', { question: 'Develop an improved explanation.', reviewMode: 'auto', maxRounds: 6, ...settings });
  assert.equal(result.ok, true, result.error);
  return result;
}

async function pendingWorkerPair(h) {
  await begin(h, { relayMedia: true }); await until(() => h.prompts().length === 1);
  const boss = h.prompts()[0];
  await h.reply(boss, { request_id: boss.message.requestId, action: 'dispatch',
    assignments: { left: 'Produce the improved deliverable.', right: 'Independently check the sources.' } });
  await until(() => h.prompts().length === 3); await pause();
  return h.prompts().slice(1);
}

test('a completed worker file is downloadable and persisted while its peer is still working, before boss selection', async t => {
  const checkpoints = [];
  const h = harness({ onCheckpoint(snapshot) { checkpoints.push(snapshot); } }); t.after(() => h.coordinator.dispose());
  const [left, right] = await pendingWorkerPair(h);
  const bytes = Buffer.from('def weighted_mean(values, uncertainties):\n    return 10.8\n');
  const media = h.generatedFile('left', left.message, bytes);
  assert.equal((await h.coordinator.pageEvent('left', { type: 'REPLY', runId: left.message.runId,
    requestId: left.message.requestId, text: 'Working checkpoint; independent review remains.', media: [media] })).ok, true);
  await until(async () => (await h.coordinator.getState()).workerResults.length === 1);
  const state = await h.coordinator.getState();
  assert.equal(state.status, 'running'); assert.equal(state.candidate, null);
  assert.equal(state.pending.right.requestId, right.message.requestId);
  assert.equal(state.delivery.id, 'W1'); assert.equal(state.delivery.candidateId, null);
  assert.equal(state.delivery.draft, true); assert.equal(state.delivery.source, 'worker-checkpoint');
  assert.equal(state.delivery.files[0].contentSha256, hash(bytes));
  assert.equal(JSON.stringify(state.delivery).includes(bytes.toString('base64')), false);
  const transportCount = h.sent.length;
  const captured = await h.coordinator.getDeliverySnapshot();
  assert.equal(captured.files[0].base64, bytes.toString('base64'));
  assert.equal(h.sent.length, transportCount, 'Saving a completed snapshot contacted or cancelled a live page.');
  captured.files[0].base64 = Buffer.from('changed caller copy').toString('base64');
  assert.equal((await h.coordinator.getDeliverySnapshot()).files[0].base64, bytes.toString('base64'));
  const saved = await h.coordinator.exportProject();
  assert.equal(saved.revisions.length, 0); assert.equal(saved.completedResults.length, 1);
  assert.equal(saved.completedResults[0].files[0].contentSha256, hash(bytes));
  assert.equal(saved.state.status, 'running'); assert.equal(saved.state.stage, state.stage);
  assert.ok(checkpoints.some(snapshot => snapshot.completedResults?.length === 1));

  const restored = harness(); t.after(() => restored.coordinator.dispose());
  assert.equal((await restored.coordinator.restoreProject(saved)).ok, true);
  const retained = await restored.coordinator.getDeliverySnapshot();
  const after = await restored.coordinator.getState();
  assert.equal(retained.id, 'W1'); assert.equal(retained.files[0].base64, bytes.toString('base64'));
  assert.equal(retained.draft, true); assert.equal(after.status, 'idle');
  assert.equal(after.completionContext.status, 'running');
  assert.deepEqual(after.pending, {}); assert.deepEqual(after.acceptedBy, {});
  assert.equal(after.finalVerification, null); assert.equal(after.pages.left.ready, false);
  assert.equal(restored.sent.length, 0, 'Loading and saving retained drafts requires no live browser connection.');
});

test('restored completed outputs reject changed bytes and do not turn saved completion into acceptance', async t => {
  const h = harness(); t.after(() => h.coordinator.dispose());
  const [left] = await pendingWorkerPair(h);
  const media = h.generatedFile('left', left.message);
  await h.coordinator.pageEvent('left', { type: 'REPLY', runId: left.message.runId,
    requestId: left.message.requestId, text: 'Recoverable incomplete draft.', media: [media] });
  await until(async () => (await h.coordinator.getState()).workerResults.length === 1);
  const saved = await h.coordinator.exportProject();
  const changed = structuredClone(saved);
  changed.completedResults[0].files[0].base64 = Buffer.from('forged completed output\n').toString('base64');
  const other = harness(); t.after(() => other.coordinator.dispose());
  assert.equal((await other.coordinator.restoreProject(changed)).ok, false);
  saved.state.status = 'agreed'; saved.state.stage = 'Historically finished'; saved.state.finishedAt = 12345;
  assert.equal((await other.coordinator.restoreProject(saved)).ok, true);
  const current = await other.coordinator.getState();
  assert.equal(current.completionContext.status, 'agreed'); assert.equal(current.completionContext.finishedAt, 12345);
  assert.equal(current.status, 'idle'); assert.equal(current.delivery.draft, true);
  assert.equal(current.finalVerification, null); assert.deepEqual(current.acceptedBy, {});
});

test('newer completed worker files remain separately downloadable without replacing the selected candidate', async t => {
  const h = harness(); t.after(() => h.coordinator.dispose());
  const pair = await pendingWorkerPair(h);
  for (const call of pair) {
    const file = h.generatedFile(call.side, call.message);
    await h.coordinator.pageEvent(call.side, { type: 'REPLY', runId: call.message.runId,
      requestId: call.message.requestId, text: `First ${call.side} file checkpoint.`, media: [file] });
  }
  await until(() => h.prompts().length === 4);
  const boss = h.prompts()[3];
  await h.reply(boss, { request_id: boss.message.requestId, action: 'dispatch', candidate_result_id: 'W1',
    assignments: { left: 'Revise only real issues and produce the replacement files.', right: 'Independently audit the candidate.' } });
  await until(() => h.prompts().length === 6);
  const selected = await h.coordinator.getCurrentCandidate();
  const next = h.prompts()[4];
  const bytes = Buffer.from('newer completed file checkpoint\n');
  const file = h.generatedFile('left', next.message, bytes);
  await h.coordinator.pageEvent('left', { type: 'REPLY', runId: next.message.runId,
    requestId: next.message.requestId, text: 'Newer replacement; independent review not yet completed.', media: [file] });
  await until(async () => (await h.coordinator.getState()).workerResults.length === 3);
  const state = await h.coordinator.getState();
  assert.equal(state.delivery.id, selected.id); assert.equal(state.candidate.sha256, selected.sha256);
  assert.equal(state.delivery.checkpoints[0].id, 'W3');
  assert.equal(state.delivery.checkpoints[0].draft, true);
  assert.equal(state.delivery.checkpoints[0].files[0].contentSha256, hash(bytes));
  const count = h.sent.length;
  assert.equal((await h.coordinator.getDeliverySnapshot({ deliveryId: 'W3' })).files[0].base64, bytes.toString('base64'));
  assert.equal((await h.coordinator.getDeliverySnapshot({ deliveryId: selected.id })).sha256, selected.sha256);
  assert.equal(h.sent.length, count);
  await assert.rejects(h.coordinator.getDeliverySnapshot({ deliveryId: 'W999' }), /no longer available/);

  const restored = harness(); t.after(() => restored.coordinator.dispose());
  assert.equal((await restored.coordinator.restoreProject(await h.coordinator.exportProject())).ok, true);
  assert.equal((await restored.coordinator.getDeliverySnapshot({ deliveryId: 'W3' })).files[0].contentSha256, hash(bytes));
  assert.equal((await restored.coordinator.getCurrentCandidate()).sha256, selected.sha256);
  const savedAgain = await restored.coordinator.exportProject();
  const twice = harness(); t.after(() => twice.coordinator.dispose());
  assert.equal((await twice.coordinator.restoreProject(savedAgain)).ok, true, 'A restored revision leaked its synthetic result identity into a completed worker checkpoint.');
  assert.equal((await twice.coordinator.getDeliverySnapshot({ deliveryId: 'W3' })).files[0].base64, bytes.toString('base64'));
});

test('a terminal workflow cause survives readiness checks and restores only as historical diagnostics', async t => {
  const h = harness(); t.after(() => h.coordinator.dispose());
  await begin(h); await until(() => h.prompts().length === 1);
  await h.reply(h.prompts()[0], { request_id: h.prompts()[0].message.requestId, action: 'blocked',
    reason: 'Source pages 4 and 5 require a readable replacement before the full lecture PDF can be completed.' });
  const blocked = await h.coordinator.getState();
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.completionContext.stage, 'Boss needs your help');
  assert.match(blocked.completionContext.error, /Source pages 4 and 5/);
  const finishedAt = blocked.completionContext.finishedAt;
  await h.coordinator.request('PREPARE');
  const saved = await h.coordinator.exportProject();
  assert.equal(saved.state.status, 'blocked'); assert.equal(saved.state.finishedAt, finishedAt);
  assert.equal(saved.state.completionContext.stage, 'Boss needs your help');
  assert.match(saved.state.error, /Source pages 4 and 5/);
  // The disk store may retain the historical diagnostic envelope while
  // omitting the top-level transient error. That must not erase the cause.
  delete saved.state.error;
  const restored = harness(); t.after(() => restored.coordinator.dispose());
  assert.equal((await restored.coordinator.restoreProject(saved)).ok, true);
  const state = await restored.coordinator.getState();
  assert.equal(state.status, 'idle'); assert.equal(state.completionContext.status, 'blocked');
  assert.equal(state.completionContext.finishedAt, finishedAt);
  assert.equal(state.completionContext.stage, 'Boss needs your help');
  assert.match(state.completionContext.error, /Source pages 4 and 5/);
  assert.deepEqual(state.pending, {});
});

test('an unconfirmed observer retains the original source preflight error instead of replacing its cause', async t => {
  const initialError = 'An expected source document is no longer attached. Verify every required attachment in this chat before starting.';
  const observerError = 'The newest user turn does not match the complete tracked request. No prompt was resent and no generation was stopped.';
  const h = harness({ transport(side, message) {
    if (side === 'boss' && message.type === 'SEND_PROMPT') return { ok: false, error: initialError };
    if (message.type === 'RESUME_OBSERVATION') return { ok: false, error: observerError };
  } }); t.after(() => h.coordinator.dispose());
  await begin(h);
  await until(async () => (await h.coordinator.getState()).status === 'blocked');
  const state = await h.coordinator.getState();
  assert.ok(state.error.includes(initialError)); assert.ok(state.error.includes(observerError));
  assert.equal(h.prompts().length, 1, 'An uncertain failed submission was sent again.');
  assert.equal(state.round, 0); assert.deepEqual(state.pending, {});
  assert.ok(h.sent.filter(call => call.message.type === 'CANCEL').every(call => call.message.stopGeneration === false));
  const saved = await h.coordinator.exportProject();
  assert.ok(saved.state.completionContext.error.includes(initialError));
  assert.ok(saved.state.completionContext.diagnostics.some(record => record.detail.includes(initialError)));
});

test('page reload reconnects the same pending turn without duplicate prompts, peer cancellation or renewed deadlines', async t => {
  let resolveResume;
  const h = harness({ transport(_side, message) {
    if (message.type === 'RESUME_OBSERVATION') return new Promise(resolve => { resolveResume = resolve; });
  } }); t.after(() => h.coordinator.dispose());
  const [left, right] = await pendingWorkerPair(h);
  const before = (await h.coordinator.getState()).pending;
  await h.coordinator.pageReload('left'); await h.coordinator.pageReload('left');
  await until(() => resolveResume);
  const resumed = h.sent.filter(call => call.message.type === 'RESUME_OBSERVATION');
  assert.equal(resumed.length, 1);
  assert.equal(resumed[0].message.text, left.message.text);
  assert.equal(resumed[0].message.requestId, left.message.requestId);
  assert.equal(resumed[0].message.files, undefined);
  assert.equal(h.prompts().length, 3);
  assert.deepEqual((await h.coordinator.getState()).pending, before);
  assert.equal(h.sent.some(call=>call.message.type==='CANCEL'), false);
  assert.equal(JSON.stringify(await h.coordinator.exportProject()).includes(left.message.text), false, 'A saved project acquired live observation authority.');
  await h.reply(right, 'Healthy peer work retained while A reconnects.');
  assert.ok((await h.coordinator.getState()).pending.left);
  resolveResume({ ok: true, resumed: true });
  await until(async () => (await h.coordinator.getState()).supervision.events.some(event=>event.type==='observation-reconnected'));
  await h.reply(left, 'Exact owned reply after reload.');
  await until(()=>h.prompts().length===4);
  const context = marker(h.prompts()[3].message.text, 'BOSS_CONTEXT');
  assert.equal(context.completed_work_cycles, 1);
  assert.equal(context.worker_results.length, 2);
  assert.equal(context.min_work_cycles, 4);
  assert.equal(h.sent.some(call=>call.message.type==='CANCEL'), false);
});

test('navigation error during an ambiguous Send acknowledgement reconnects instead of resending', async t => {
  const h = harness({ transport(side, message) {
    if (message.type === 'SEND_PROMPT' && side === 'left') throw Object.assign(new Error('ChatGPT navigated.'), { code: 'page-navigation' });
    if (message.type === 'RESUME_OBSERVATION') return { ok: true, resumed: true };
  } }); t.after(() => h.coordinator.dispose());
  const [left, right] = await pendingWorkerPair(h);
  await until(()=>h.sent.some(call=>call.message.type==='RESUME_OBSERVATION'));
  assert.equal((await h.coordinator.getState()).status, 'running');
  assert.equal(h.prompts().filter(call=>call.side==='left').length, 1);
  assert.equal(h.sent.some(call=>call.message.type==='CANCEL'), false);
  await h.reply(left, 'Confirmed result from the only submitted turn.');
  await h.reply(right, 'Independent peer result.');
  await until(()=>h.prompts().length===4);
});

test('an unconfirmed changed conversation retains a healthy peer artifact and blocks any automatic reprompt', async t => {
  const h = harness({ transport(_side, message) {
    if (message.type === 'RESUME_OBSERVATION') return { ok: false, error: 'The newest human turn belongs to another conversation.' };
  } }); t.after(() => h.coordinator.dispose());
  const [left, right] = await pendingWorkerPair(h);
  await h.coordinator.pageEvent('left', { type: 'ERROR', runId: left.message.runId, requestId: left.message.requestId,
    observationLost: true, error: 'The chat navigated before the reply completed.' });
  await until(async()=>!(await h.coordinator.getState()).pending.left);
  const waiting = await h.coordinator.getState();
  assert.equal(waiting.status, 'running'); assert.ok(waiting.pending.right);
  const cancelled = h.sent.filter(call=>call.message.type==='CANCEL');
  assert.equal(cancelled.length, 1); assert.equal(cancelled[0].side, 'left');
  assert.equal(cancelled[0].message.stopGeneration, false);
  const artifact = h.generatedFile('right', right.message, Buffer.from('Retained exact peer artifact\n'));
  await h.coordinator.pageEvent('right', { type: 'REPLY', runId: right.message.runId, requestId: right.message.requestId,
    text: 'Healthy peer completed its actual file.', media: [artifact] });
  await until(async()=>(await h.coordinator.getState()).status==='blocked');
  const state = await h.coordinator.getState();
  assert.equal(state.workerResults.length, 1); assert.equal(state.workerResults[0].media.files[0].contentSha256, artifact.contentSha256);
  assert.equal(state.completedWorkCycles, 0); assert.equal(h.prompts().length, 3);
  assert.equal(h.sent.filter(call=>call.message.type==='CANCEL' && call.side==='right').length, 0);
});

test('Stop retires a delayed observer reconnect and stale navigation cannot revive it', async t => {
  let resolveResume;
  const h = harness({ transport(_side, message) {
    if (message.type === 'RESUME_OBSERVATION') return new Promise(resolve=>{resolveResume=resolve;});
  } }); t.after(()=>h.coordinator.dispose());
  const [left] = await pendingWorkerPair(h);
  await h.coordinator.pageReload('left'); await until(()=>resolveResume);
  await h.coordinator.stop(); resolveResume({ ok: true, resumed: true }); await pause(); await pause();
  assert.equal((await h.coordinator.getState()).status, 'stopped');
  assert.deepEqual((await h.coordinator.getState()).pending, {});
  assert.equal((await h.coordinator.pageEvent('left', { type: 'ERROR', runId: left.message.runId,
    requestId: left.message.requestId, observationLost: true })).ignored, true);
  assert.equal(h.prompts().length, 3);
});

test('a second classified redirect retries only observation while generic failures never retry Send', async t => {
  let attempts = 0;
  const h = harness({ transport(_side, message) {
    if (message.type !== 'RESUME_OBSERVATION') return;
    attempts += 1;
    if (attempts === 1) throw Object.assign(new Error('Second page transition.'), { code: 'page-navigation' });
    return { ok: true, resumed: true };
  } }); t.after(()=>h.coordinator.dispose());
  await pendingWorkerPair(h); await h.coordinator.pageReload('left');
  await until(async()=>(await h.coordinator.getState()).supervision.events.some(event=>event.type==='observation-reconnected'));
  assert.equal(attempts, 2); assert.equal(h.prompts().length, 3);
  assert.equal(h.sent.some(call=>call.message.type==='CANCEL'), false);
});

test('boss writes dynamic assignments for four cycles, receives every worker result, and verifies the same candidate before finish', async t => {
  const h = harness({ reply: normalReply }); t.after(() => h.coordinator.dispose());
  await begin(h);
  await until(async () => (await h.coordinator.getState()).status === 'agreed');
  const state = await h.coordinator.getState();
  assert.deepEqual(h.opened, ['left', 'right', 'boss']);
  assert.equal(state.coordinatorMode, 'boss');
  assert.equal(state.round, 4);
  assert.equal(state.verificationRounds, 1);
  assert.equal(state.workerResults.length, 10);
  assert.deepEqual(state.acceptedBy, { left: state.candidate.id, right: state.candidate.id });
  assert.equal(state.boss.finalSummary, 'Boss summary of the completed work.');
  assert.equal(state.supervision.nextCheckAt, null);
  assert.equal(state.answer, state.candidate.answer);
  assert.notEqual(state.answer, state.boss.finalSummary);
  const bossContexts = h.prompts().filter(call => call.side === 'boss').map(call => marker(call.message.text, 'BOSS_CONTEXT'));
  assert.deepEqual(bossContexts.slice(1).flatMap(context => context.worker_results.map(result => result.id)), state.workerResults.map(result => result.id));
  assert.ok(h.prompts().some(call => call.side === 'left' && call.message.text.includes('failure case A in cycle 3')));
  assert.ok(h.prompts().some(call => call.side === 'right' && call.message.text.includes('improvement B in cycle 4')));
  const checks = h.prompts().filter(call => call.side !== 'boss' && call.message.text.includes('Perform an independent final check'));
  assert.equal(checks.length, 2);
  assert.ok(checks.every(call => call.message.responseFormat === 'control-json'));
  assert.ok(checks.every(call => call.message.text.includes('Return exactly one fenced ```json code block')));
  assert.ok(checks.every(call => call.message.text.includes('Keep citations, tool reference markers, download links and file cards outside that code block')));
  assert.ok(h.prompts().filter(call => call.side === 'boss').every(call => call.message.responseFormat === 'control-json'));
  assert.ok(h.prompts().filter(call => call.side !== 'boss' && !call.message.text.includes('Perform an independent final check')).every(call => call.message.responseFormat === undefined));
  assert.deepEqual(checks.map(call => marker(call.message.text, 'FINAL_CANDIDATE').sha256), [state.candidate.sha256, state.candidate.sha256]);
});

test('immutable arithmetic uses one independent work pair and one final checking pair', async t => {
  const h = harness({ reply: normalReply }); t.after(() => h.coordinator.dispose());
  await begin(h, { question: 'What is 4 + 6?', studio: { verificationEnabled: false, freshAudit: false } });
  await until(async () => (await h.coordinator.getState()).status === 'agreed');
  const state = await h.coordinator.getState();
  assert.equal(state.minReviewRounds, 1);
  assert.equal(state.round, 1);
  assert.equal(state.workerResults.length, 4);
  const instruction = h.prompts().find(call => call.side === 'boss').message.text;
  assert.match(instruction, /verificationEnabled setting controls OPTIONAL LOCAL TOOL CHECKS only/);
  assert.match(instruction, /Both workers must ALWAYS perform the action:"verify" final pair/);
  assert.match(instruction, /immutable basic arithmetic[\s\S]*action:"verify" immediately/);
});

test('a user addition during a boss reply supersedes that plan before any worker receives it', async t => {
  const h = harness(); t.after(() => h.coordinator.dispose());
  await begin(h);
  await until(() => h.prompts().length === 1);
  const prior = h.prompts()[0];
  const addition = await h.coordinator.request('BOSS_MESSAGE', { text: 'Also assess the failure of the third step.' });
  assert.equal(addition.state.boss.queue.length, 1);
  await h.reply(prior, { request_id: prior.message.requestId, action: 'dispatch', assignments: { left: 'OLD task', right: 'OLD task' } });
  await until(() => h.prompts().length === 2);
  assert.ok(h.prompts().every(call => call.side === 'boss'));
  const context = marker(h.prompts()[1].message.text, 'BOSS_CONTEXT');
  assert.equal(context.user_revision, 1);
  assert.equal(context.user_instructions[0].text, 'Also assess the failure of the third step.');
  assert.equal((await h.coordinator.getState()).boss.queue.length, 0);
});

test('worker-phase additions queue safely and reach the boss after both actual answers', async t => {
  const h = harness(); t.after(() => h.coordinator.dispose());
  await begin(h);
  await until(() => h.prompts().length === 1);
  const plan = h.prompts()[0];
  await h.reply(plan, { request_id: plan.message.requestId, action: 'dispatch', assignments: { left: 'Task A.', right: 'Task B.' } });
  await until(() => h.prompts().length === 3);
  await h.coordinator.request('BOSS_MESSAGE', { text: 'Keep the original behavior and add a boundary example.' });
  const workers = h.prompts().filter(call => call.side !== 'boss');
  await h.reply(workers[0], 'First worker evidence.');
  assert.equal(h.prompts().length, 3);
  await h.reply(workers[1], 'Second worker evidence.');
  await until(() => h.prompts().length === 4);
  const context = marker(h.prompts()[3].message.text, 'BOSS_CONTEXT');
  assert.equal(context.worker_results.length, 2);
  assert.equal(context.user_instructions[0].text, 'Keep the original behavior and add a boundary example.');
  assert.equal(context.user_revision, 1);
});

test('file, PDF and image additions are rejected before altering a running task when sharing is off', async t => {
  const h = harness(); t.after(() => h.coordinator.dispose());
  await begin(h, { question: 'What is 4 + 6?', relayMedia: false });
  await until(() => h.prompts().length === 1);
  const before = await h.coordinator.getState();
  for (const addition of ['Also create two downloadable Python files.', 'Create a PDF report of your answer.', 'Generate an image illustrating this result.']) {
    const rejected = await h.coordinator.request('BOSS_MESSAGE', { text: addition });
    assert.equal(rejected.ok, false);
    assert.match(rejected.error, /Stop the task, enable file and image exchange/);
    assert.deepEqual(await h.coordinator.getState(), before);
  }
  assert.equal(h.prompts().length, 1);
  assert.equal(h.sent.some(call => call.message.type === 'CANCEL'), false);
  const boss = h.prompts()[0];
  await h.reply(boss, { request_id: boss.message.requestId, action: 'dispatch', assignments: { left: 'Calculate independently.', right: 'Check the arithmetic.' } });
  await until(() => h.prompts().length === 3);
  assert.equal((await h.coordinator.getState()).status, 'running');
  assert.equal((await h.coordinator.getState()).relayMedia, false);
});

test('a queued PDF addition upgrades the output gate and text or another file type cannot satisfy it', async t => {
  let firstBoss = true;
  const h = harness({ reply(side, message, context) {
    if (side === 'boss') {
      if (firstBoss) { firstBoss = false; return null; }
      const boss = marker(message.text, 'BOSS_CONTEXT');
      if (boss.control_repair?.error.includes('required downloadable output')) return { text: JSON.stringify({ request_id: message.requestId,
        action: 'blocked', reason: 'The required PDF has not been generated.' }) };
    }
    return normalReply(side, message, context, true);
  } }); t.after(() => h.coordinator.dispose());
  await begin(h, { question: 'What is 4 + 6?', relayMedia: true });
  await until(() => h.prompts().length === 1);
  const originalBoss = h.prompts()[0];
  const queued = await h.coordinator.request('BOSS_MESSAGE', { text: 'Also create a PDF report of the complete result.' });
  assert.equal(queued.ok, true, queued.error);
  assert.equal(queued.state.boss.queue.length, 1);
  await h.reply(originalBoss, { request_id: originalBoss.message.requestId, action: 'dispatch', assignments: { left: 'Old arithmetic.', right: 'Old arithmetic.' } });
  await until(async () => (await h.coordinator.getState()).status === 'blocked');
  const state = await h.coordinator.getState();
  assert.equal(state.requireFiles, true);
  assert.equal(state.requirePdf, true);
  assert.equal(state.relayMedia, true);
  assert.equal(state.minReviewRounds, 4);
  assert.equal(state.verificationRounds, 0);
  assert.ok(state.workerResults.every(result => result.media.files.every(file => file.mimeType !== 'application/pdf')));
  const updated = h.prompts().filter(call => call.side === 'boss').map(call => marker(call.message.text, 'BOSS_CONTEXT'))
    .find(context => context.user_revision === 1);
  assert.deepEqual(updated.required_outputs, { files: true, images: false, pdf: true, code_extension: '' });
  assert.match(state.error, /required PDF/);
});

test('early finish and too-early verification are bounded control repairs rather than false success', async t => {
  for (const action of ['finish', 'verify']) {
    const h = harness({ reply(side, message) {
      assert.equal(side, 'boss');
      return { text: JSON.stringify(action === 'finish' ? { request_id: message.requestId, action,
        candidate_id: 'C1', answer: '100% correct', checks: [], limitations: [] } :
      { request_id: message.requestId, action, candidate_result_id: 'W1' }) };
    } }); t.after(() => h.coordinator.dispose());
    await begin(h, { maxRounds: 1 });
    await until(async () => (await h.coordinator.getState()).status === 'blocked');
    assert.equal(h.prompts().length, 3);
    assert.ok(h.prompts().every(call => call.side === 'boss'));
    assert.equal((await h.coordinator.getState()).minReviewRounds, 4);
  }
});

test('boss malformed control gets one repair and an honest failure if still malformed', async t => {
  const h = harness({ reply: () => 'plain prose without a control object' }); t.after(() => h.coordinator.dispose());
  await begin(h);
  await until(async () => (await h.coordinator.getState()).status === 'error');
  assert.equal(h.prompts().length, 2);
  assert.match((await h.coordinator.getState()).error, /valid JSON/);
});

test('stale request IDs and worker-side impersonation cannot dispatch a boss plan', async t => {
  const h = harness(); t.after(() => h.coordinator.dispose());
  await begin(h);
  await until(() => h.prompts().length === 1);
  const plan = h.prompts()[0];
  const message = { type: 'REPLY', runId: plan.message.runId, requestId: plan.message.requestId,
    text: JSON.stringify({ request_id: plan.message.requestId, action: 'dispatch', assignments: { left: 'Spoof.', right: 'Spoof.' } }) };
  assert.equal((await h.coordinator.pageEvent('left', message)).ignored, true);
  assert.equal((await h.coordinator.pageEvent('boss', { ...message, requestId: 'obsolete' })).ignored, true);
  assert.equal(h.prompts().length, 1);
  const state = await h.coordinator.getState();
  assert.equal(state.transcript.length, 0);
  assert.equal(state.pending.boss.requestId, plan.message.requestId);
});

test('Stop invalidates in-flight work immediately, clears additions, and ignores late replies and acknowledgements', async t => {
  let release;
  const held = new Promise(resolve => { release = resolve; });
  const h = harness({ transport(_side, message) { if (message.type === 'SEND_PROMPT') return held; } });
  t.after(() => h.coordinator.dispose());
  await begin(h);
  await until(() => h.prompts().length === 1);
  const old = h.prompts()[0];
  await h.coordinator.request('BOSS_MESSAGE', { text: 'This should not restart after Stop.' });
  const stopped = await h.coordinator.stop();
  assert.equal(stopped.state.status, 'stopped');
  assert.deepEqual(stopped.state.pending, {});
  assert.deepEqual(stopped.state.boss.queue, []);
  release({ ok: true });
  const stale = await h.reply(old, { request_id: old.message.requestId, action: 'dispatch', assignments: { left: 'Late.', right: 'Late.' } });
  assert.equal(stale.ignored, true);
  assert.equal(h.prompts().length, 1);
  assert.ok(h.sent.some(call => call.message.type === 'CANCEL' && call.side === 'boss'));
});

test('Reset clears the three-page identities, results, original attachments and late reply ownership', async t => {
  const h = harness(); t.after(() => h.coordinator.dispose());
  await begin(h);
  await until(() => h.prompts().length === 1);
  const old = h.prompts()[0];
  const reset = await h.coordinator.reset();
  assert.equal(reset.status, 'idle');
  assert.deepEqual(reset.tabIds, { left: null, right: null, boss: null });
  assert.deepEqual(reset.workerResults, []);
  assert.equal((await h.reply(old, 'old result')).ignored, true);
  assert.equal((await h.coordinator.request('START', { question: 'A task.' })).ok, false);
});

test('host verifies generated file bytes before relaying both worker outputs and exact candidate files', async t => {
  const h = harness({ reply(side, message, context) { return normalReply(side, message, context, true); } });
  t.after(() => h.coordinator.dispose());
  await begin(h, { question: 'Create a complete Python file explaining this calculation.', relayMedia: true, requireFiles: true });
  await until(async () => ['agreed', 'error'].includes((await h.coordinator.getState()).status));
  const state = await h.coordinator.getState();
  assert.equal(state.status, 'agreed', state.error);
  assert.equal(state.candidate.media.files[0].name, 'answer.py');
  assert.match(state.candidate.media.files[0].contentSha256, /^[a-f0-9]{64}$/);
  const bossTransfers = h.prompts().filter(call => call.side === 'boss' && call.message.files?.length);
  assert.equal(bossTransfers.length, 4);
  assert.ok(bossTransfers.every(call => call.message.files.length === 2));
  assert.ok(bossTransfers.every(call => new Set(call.message.files.map(file => file.name)).size === 2));
  assert.ok(bossTransfers.every(call => call.message.files.every(file => /^RESULT_W\d+_answer\.py\.txt$/.test(file.name))));
  const workerChecks = h.prompts().filter(call => call.side !== 'boss' && call.message.text.includes('Perform an independent final check'));
  assert.equal(workerChecks.length, 2);
  assert.ok(workerChecks.every(call => call.message.files[0].name === `CANDIDATE_${state.candidate.id}_answer.py.txt`));
  const bytes = Buffer.from(workerChecks[0].message.files[0].base64, 'base64');
  assert.equal(hash(bytes), state.candidate.media.files[0].contentSha256);
  assert.equal(workerChecks[0].message.files[0].base64, workerChecks[1].message.files[0].base64);
  assert.doesNotMatch(JSON.stringify(state), /base64/);
});

test('forged generated output digest is quarantined before the boss receives any file', async t => {
  const h = harness({ reply(side, message, context) { return normalReply(side, message, context, true); },
    transport(_side, message, { exported }) {
      if (message.type === 'EXPORT_MEDIA') return { ok: true, files: (exported.get(`${message.runId}:${message.requestId}`) || [])
        .map(file => ({ ...file, contentSha256: '0'.repeat(64) })) };
    } }); t.after(() => h.coordinator.dispose());
  await begin(h, { relayMedia: true });
  await until(async () => (await h.coordinator.getState()).status === 'blocked');
  assert.match((await h.coordinator.getState()).error, /hash/);
  assert.equal(h.prompts().filter(call => call.side === 'boss').length, 1);
  assert.equal((await h.coordinator.getState()).candidate, null);
  assert.ok(h.sent.filter(call => call.message.type === 'CANCEL').every(call=>call.message.stopGeneration === false));
});

test('changed output bytes on a fresh relay export are rejected against the previously verified identity', async t => {
  const counts = new Map();
  const h = harness({ reply(side, message, context) { return normalReply(side, message, context, true); },
    transport(_side, message, { exported }) {
      if (message.type !== 'EXPORT_MEDIA') return;
      const key = `${message.runId}:${message.requestId}`;
      counts.set(key, (counts.get(key) || 0) + 1);
      const files = structuredClone(exported.get(key) || []);
      if (counts.get(key) > 1) {
        const changed = Buffer.from('unreviewed replacement bytes\n');
        for (const file of files) Object.assign(file, { base64: changed.toString('base64'), contentSha256: hash(changed), byteLength: changed.length });
      }
      return { ok: true, files };
    } }); t.after(() => h.coordinator.dispose());
  await begin(h, { relayMedia: true });
  await until(async () => (await h.coordinator.getState()).status === 'blocked');
  assert.match((await h.coordinator.getState()).error, /contents changed/);
  assert.equal(h.prompts().filter(call => call.side === 'boss').length, 1);
});

test('original uploads reach all three pages with code aliases, private bytes, and an explicit original-source context', async t => {
  const h = harness(); t.after(() => h.coordinator.dispose());
  await h.coordinator.request('OPEN_LAYOUT', { chatMode: 'normal' });
  const source = 'def calculate(x):\n    return x + 1\n';
  const attached = await h.coordinator.request('ATTACH_FILES', { files: [{ name: 'original.py', mimeType: 'text/plain', base64: Buffer.from(source).toString('base64') }] });
  assert.equal(attached.ok, true, attached.error);
  assert.deepEqual(h.sent.filter(call => call.message.type === 'UPLOAD_FILES').map(call => call.side), ['left', 'right', 'boss']);
  assert.ok(h.sent.filter(call => call.message.type === 'UPLOAD_FILES').every(call => call.message.files[0].name === 'original.py.txt'));
  assert.equal((await h.coordinator.request('START', { question: 'Improve the implementation.', relayMedia: true })).ok, true);
  await until(() => h.prompts().length === 1);
  const boss = h.prompts()[0];
  assert.deepEqual(boss.message.expectedSourceNames, ['original.py.txt']);
  const context = marker(boss.message.text, 'BOSS_CONTEXT');
  assert.equal(context.originals[0].name, 'original.py');
  assert.equal(context.complete_readable_sources[0].text, source);
  assert.equal(context.originals[0].contentSha256, hash(Buffer.from(source)));
  assert.doesNotMatch(JSON.stringify(await h.coordinator.getState()), /base64|def calculate/);
});

test('partial attachment confirmation prevents starting an apparently complete run', async t => {
  const h = harness({ transport(side, message) { if (message.type === 'UPLOAD_FILES' && side === 'boss') return { ok: false, error: 'Boss attachment failed.' }; } });
  t.after(() => h.coordinator.dispose());
  await h.coordinator.request('OPEN_LAYOUT', { chatMode: 'normal' });
  const attached = await h.coordinator.request('ATTACH_FILES', { files: [{ name: 'source.txt', mimeType: 'text/plain', base64: 'YQ==' }] });
  assert.equal(attached.ok, false);
  assert.equal((await h.coordinator.getState()).attachments.status, 'partial');
  assert.equal((await h.coordinator.request('START', { question: 'Fix it.' })).ok, false);
  assert.equal(h.prompts().length, 0);
});

test('an incomplete upload is recovered by exact receipt checks without resetting or uploading duplicate files', async t => {
  let receiptReady = false;
  const h = harness({ transport(side, message) {
    if (side === 'boss' && message.type === 'UPLOAD_FILES') return { ok: false, error: 'Upload acknowledgement timed out.' };
    if (message.type === 'CHECK_ATTACHMENTS') return receiptReady ? { ok: true, attached: message.names.length } :
      { ok: false, error: 'This upload is still processing.' };
  } }); t.after(() => h.coordinator.dispose());
  await h.coordinator.request('OPEN_LAYOUT', { chatMode: 'normal' });
  const attached = await h.coordinator.request('ATTACH_FILES', { files: [{ name: 'original.py', mimeType: 'text/plain', base64: 'eCA9IDEK' }] });
  assert.equal(attached.ok, false);
  const original = await h.coordinator.getState();
  const waiting = await h.coordinator.request('RECHECK_ATTACHMENTS');
  assert.equal(waiting.ok, false);
  assert.equal(waiting.error.includes('still processing'), true);
  assert.equal((await h.coordinator.request('START', { question: 'Analyze the source.' })).ok, false);
  receiptReady = true;
  const checked = await h.coordinator.request('RECHECK_ATTACHMENTS');
  assert.equal(checked.ok, true, checked.error);
  assert.equal(checked.state.attachments.status, 'attached');
  assert.deepEqual(checked.state.tabIds, original.tabIds);
  assert.equal(h.opened.length, 3);
  assert.equal(h.sent.filter(call => call.message.type === 'UPLOAD_FILES').length, 3);
  assert.ok(h.sent.filter(call => call.message.type === 'CHECK_ATTACHMENTS')
    .every(call => JSON.stringify(call.message.names) === JSON.stringify(['original.py.txt'])));
  assert.doesNotMatch(JSON.stringify(checked.state), /base64|eCA9IDEK/);
  const started = await h.coordinator.request('START', { question: 'Analyze the source without rewriting it.' });
  assert.equal(started.ok, true, started.error);
  await until(() => h.prompts().length === 1);
  assert.equal(marker(h.prompts()[0].message.text, 'BOSS_CONTEXT').complete_readable_sources[0].text, 'x = 1\n');
});

test('upload recovery requires every actual page receipt and cannot promote a missing file by a generic acknowledgement', async t => {
  const h = harness({ transport(side, message) {
    if (message.type === 'UPLOAD_FILES' && side === 'right') return { ok: false, error: 'Delivery not confirmed.' };
    if (message.type === 'CHECK_ATTACHMENTS') return { ok: true, attached: side === 'right' ? 0 : message.names.length };
  } }); t.after(() => h.coordinator.dispose());
  await h.coordinator.request('OPEN_LAYOUT', { chatMode: 'normal' });
  await h.coordinator.request('ATTACH_FILES', { files: [{ name: 'source.txt', mimeType: 'text/plain', base64: 'YQ==' }] });
  const check = await h.coordinator.request('RECHECK_ATTACHMENTS');
  assert.equal(check.ok, false);
  assert.match(check.error, /right:.*not confirmed/);
  assert.equal((await h.coordinator.getState()).attachments.status, 'partial');
  assert.equal((await h.coordinator.request('START', { question: 'Analyze the source.' })).ok, false);
  assert.equal(h.sent.filter(call => call.message.type === 'UPLOAD_FILES').length, 3);
});

test('Stop during receipt checking retains partial delivery for a new receipt check while late receipts cannot revive it', async t => {
  const receipts = [];
  let receiptReady = false;
  const h = harness({ transport(side, message) {
    if (message.type === 'UPLOAD_FILES' && side === 'right') return { ok: false, error: 'Delivery not confirmed.' };
    if (message.type === 'CHECK_ATTACHMENTS') return receiptReady ? { ok: true, attached: message.names.length } :
      new Promise(resolve => receipts.push(() => resolve({ ok: true, attached: message.names.length })));
  } }); t.after(() => h.coordinator.dispose());
  await h.coordinator.request('OPEN_LAYOUT', { chatMode: 'normal' });
  await h.coordinator.request('ATTACH_FILES', { files: [{ name: 'source.txt', mimeType: 'text/plain', base64: 'YQ==' }] });
  const checking = h.coordinator.request('RECHECK_ATTACHMENTS');
  await until(() => receipts.length === 3);
  const stopped = await h.coordinator.request('STOP');
  assert.equal(stopped.state.status, 'stopped');
  assert.equal(stopped.state.attachments.status, 'partial');
  for (const finish of receipts) finish();
  await checking;
  assert.equal((await h.coordinator.getState()).status, 'stopped');
  assert.equal((await h.coordinator.getState()).attachments.status, 'partial');
  assert.equal((await h.coordinator.request('START', { question: 'Analyze the source.' })).ok, false);
  receiptReady = true;
  const again = await h.coordinator.request('RECHECK_ATTACHMENTS');
  assert.equal(again.ok, true, again.error);
  assert.equal(again.state.attachments.status, 'attached');
  assert.equal(h.sent.filter(call => call.message.type === 'UPLOAD_FILES').length, 3);
});

test('required downloadable code cannot be replaced by a text-only candidate', async t => {
  const h = harness({ reply(side, message, context) {
    if (side === 'boss' && marker(message.text, 'BOSS_CONTEXT').control_repair) return { text: JSON.stringify({ request_id: message.requestId,
      action: 'blocked', reason: 'The workers have not produced the required complete file.' }) };
    return normalReply(side, message, context);
  } }); t.after(() => h.coordinator.dispose());
  await begin(h, { question: 'Create the complete Python program.', relayMedia: true, requireFiles: true });
  await until(async () => (await h.coordinator.getState()).status === 'blocked');
  assert.match((await h.coordinator.getState()).error, /complete file/);
  assert.equal((await h.coordinator.getState()).verificationRounds, 0);
});

test('native MT5 backtesting is still required even if the workers both claim to accept the source', async t => {
  const h = harness({ reply(side, message, context) {
    if (side === 'boss') {
      const boss = marker(message.text, 'BOSS_CONTEXT');
      if (boss.control_repair?.error.includes('native test evidence')) return { text: JSON.stringify({ request_id: message.requestId,
        action: 'blocked', reason: 'The actual six-month native MT5 report is unavailable.' }) };
    }
    const response = normalReply(side, message, context, true);
    if (side !== 'boss' && !message.text.includes('Perform an independent final check')) {
      const key = `${message.runId}:${message.requestId}`;
      const file = context.exported.get(key)[0]; file.name = 'strategy.mq5';
      response.media[0].name = file.name;
    }
    return response;
  } }); t.after(() => h.coordinator.dispose());
  await begin(h, { question: 'Create an MQL5 MT5 EA and backtest it with six months of real ticks.', relayMedia: true, requireFiles: true });
  await until(async () => ['blocked', 'error'].includes((await h.coordinator.getState()).status));
  const state = await h.coordinator.getState();
  assert.equal(state.status, 'blocked', state.error);
  assert.equal(state.requiredWork[0].id, 'mt5-backtest');
  assert.equal(state.requiredWork[0].minMonths, 6);
  assert.deepEqual(state.acceptedBy, { left: state.candidate.id, right: state.candidate.id });
  assert.match(state.error, /native MT5 report/);
});

test('blocked boss resumes the same task, conversations and worker artifacts when the user supplies missing information', async t => {
  const h = harness(); t.after(() => h.coordinator.dispose());
  await begin(h);
  await until(() => h.prompts().length === 1);
  const prior = h.prompts()[0];
  await h.reply(prior, { request_id: prior.message.requestId, action: 'blocked', reason: 'Which input units should I use?' });
  const blocked = await h.coordinator.getState();
  assert.equal(blocked.status, 'blocked');
  const resumed = await h.coordinator.request('BOSS_MESSAGE', { text: 'Use centimeters.' });
  assert.equal(resumed.ok, true, resumed.error);
  assert.equal(resumed.state.runId, blocked.runId);
  assert.equal(resumed.state.question, blocked.question);
  assert.equal(resumed.state.status, 'running');
  assert.deepEqual(resumed.state.tabIds, blocked.tabIds);
  assert.equal(h.opened.length, 3);
  await until(() => h.prompts().length === 2);
  const context = marker(h.prompts()[1].message.text, 'BOSS_CONTEXT');
  assert.equal(context.user_instructions[0].text, 'Use centimeters.');
  assert.match(context.control_repair.error, /follow-up/);
});

test('final verification requires exact candidate identity and concrete checks; issues invalidate acceptance', () => {
  const candidate = { id: 'C7', sha256: hash('exact') };
  const review = { candidate_id: candidate.id, candidate_sha256: candidate.sha256, verdict: 'accept', checks: ['Actual boundary check.'], issues: [] };
  assert.equal(parseVerification(JSON.stringify(review), candidate).verdict, 'accept');
  assert.throws(() => parseVerification(JSON.stringify({ ...review, candidate_sha256: hash('stale') }), candidate), /exact candidate/);
  assert.throws(() => parseVerification(JSON.stringify({ ...review, checks: [] }), candidate), /concrete check/);
  assert.throws(() => parseVerification(JSON.stringify({ ...review, issues: ['Not fixed.'] }), candidate), /unresolved/);
});

test('boss control validates request identity and both substantive assignments', () => {
  const plan = { request_id: 'owned', action: 'dispatch', assignments: { left: 'Research A.', right: 'Research B.' } };
  assert.equal(parseBossReply(JSON.stringify(plan), 'owned').action, 'dispatch');
  assert.throws(() => parseBossReply(JSON.stringify(plan), 'stale'), /request_id/);
  assert.throws(() => parseBossReply(JSON.stringify({ ...plan, assignments: { left: 'A.' } }), 'owned'), /right assignment/);
  assert.throws(() => parseBossReply(JSON.stringify({ ...plan, action: 'execute' }), 'owned'), /dispatch, repair, verify/);
});

test('file validation rejects binary masquerading as source and candidate digest binds actual file identities', () => {
  assert.throws(() => validateFiles([{ name: 'source.py', mimeType: 'text/plain', base64: Buffer.from([0, 1, 2]).toString('base64') }]), /binary/);
  assert.throws(() => validateFiles([{ name: '../source.txt', mimeType: 'text/plain', base64: 'YQ==' }]), /directory paths/);
  assert.notEqual(candidateDigest('same text', { files: [{ name: 'a.txt', contentSha256: hash('A'), byteLength: 1 }] }),
    candidateDigest('same text', { files: [{ name: 'a.txt', contentSha256: hash('B'), byteLength: 1 }] }));
});

test('watchdog bounds a silent model response without blocking Stop', async t => {
  const h = harness({ requestTimeoutMs: 20, runTimeoutMs: 30 }); t.after(() => h.coordinator.dispose());
  await begin(h);
  await new Promise(resolve => setTimeout(resolve, 40));
  const state = await h.coordinator.getState();
  assert.equal(state.status, 'limit_reached');
  assert.deepEqual(state.pending, {});
});

test('four long work cycles and final checks survive hour-long boss and worker turns without automatic cancellation', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.UTC(2026, 9, 6) });
  const h = harness(); t.after(() => h.coordinator.dispose());
  const initial = await begin(h);
  assert.equal(initial.state.deadline - initial.state.startedAt, 24 * 60 * 60 * 1000);
  const answered = new Set();
  for (let boundary = 0; boundary < 16; boundary += 1) {
    await pause();
    const calls = h.prompts().filter(call => !answered.has(call.message.requestId));
    assert.ok(calls.length, 'A running workflow must own a boss or worker request.');
    assert.ok(calls.every(call => call.message.timeoutMs === 2 * 60 * 60 * 1000));
    // PAGE_STATUS can fluctuate while a thinking/tool UI is remounted. It is
    // presentation evidence, never permission to abandon the owned turn.
    for (const call of calls) {
      await h.coordinator.pageEvent(call.side, { type: 'PAGE_STATUS', ...READY, busy: true });
      await h.coordinator.pageEvent(call.side, { type: 'PAGE_STATUS', ...READY, busy: false });
    }
    t.mock.timers.tick(65 * 60 * 1000);
    assert.equal((await h.coordinator.getState()).status, 'running');
    for (const call of calls) {
      answered.add(call.message.requestId);
      await h.reply(call, normalReply(call.side, call.message, { generatedFile: h.generatedFile }).text);
    }
    await pause();
    if ((await h.coordinator.getState()).status === 'agreed') break;
  }
  const final = await h.coordinator.getState();
  assert.equal(final.status, 'agreed', final.error);
  assert.equal(final.round, 4);
  assert.equal(final.verificationRounds, 1);
  assert.ok(Date.now() - final.startedAt > 10 * 60 * 60 * 1000);
  assert.equal(h.sent.some(call => call.message.type === 'CANCEL'), false);
});

test('the response budget starts after the transport confirms its attached prompt was submitted', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.UTC(2026, 9, 6) });
  let acknowledge;
  const h = harness({ transport(side, message) {
    if (side === 'boss' && message.type === 'SEND_PROMPT') {
      return new Promise(resolve => { acknowledge = () => resolve({ ok: true }); });
    }
  } }); t.after(() => h.coordinator.dispose());
  await begin(h);
  await until(() => Boolean(acknowledge));
  const call = h.prompts()[0];
  t.mock.timers.tick(5 * 60 * 1000);
  acknowledge(); await pause(); await pause();
  const submitted = await h.coordinator.getState();
  assert.equal(submitted.pending.boss.deadline - Date.now(), 2 * 60 * 60 * 1000);
  t.mock.timers.tick(118 * 60 * 1000);
  assert.equal((await h.coordinator.getState()).status, 'running');
  await h.reply(call, { request_id: call.message.requestId, action: 'dispatch',
    assignments: { left: 'First long task.', right: 'Second long task.' } });
  await until(() => h.prompts().length === 3);
  assert.equal((await h.coordinator.getState()).phase, 'boss-workers');
  assert.equal(h.sent.some(item => item.message.type === 'CANCEL'), false);
});

test('the response observation allowance checks a still-generating original request without stopping or resending it', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.UTC(2026, 9, 6) });
  const h = harness({ transport(_side, message) {
    if (message.type === 'INSPECT_PROGRESS') return { ok: true, requestId: message.requestId,
      owned: true, active: true, generationBusy: true, interrupted: false, newerUserMessage: false };
  } }); t.after(() => h.coordinator.dispose());
  await begin(h); await until(() => h.prompts().length === 1); await pause();
  const call = h.prompts()[0];
  t.mock.timers.tick(119 * 60 * 1000);
  assert.equal((await h.coordinator.getState()).status, 'running');
  t.mock.timers.tick(2 * 60 * 1000);
  const expired = await h.coordinator.getState();
  assert.equal(expired.status, 'running');
  assert.equal(expired.pending.boss.requestId, call.message.requestId);
  assert.ok(expired.pending.boss.deadline > Date.now());
  assert.ok(expired.supervision.events.some(event => event.type === 'response-budget-check'));
  assert.equal(h.prompts().length, 1);
  assert.equal(h.sent.filter(item => item.message.type === 'CANCEL').length, 0);
});

test('the whole workflow cap has a distinct visible reason and Stop still cancels a long running request immediately', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.UTC(2026, 9, 6) });
  const limited = harness({ requestTimeoutMs: 10_000, runTimeoutMs: 1_000 });
  const stopped = harness();
  t.after(async () => { await limited.coordinator.dispose(); await stopped.coordinator.dispose(); });
  await begin(limited); await pause();
  t.mock.timers.tick(1_001);
  assert.equal((await limited.coordinator.getState()).status, 'limit_reached');
  assert.match((await limited.coordinator.getState()).error, /complete workflow time limit/);
  await begin(stopped); await pause();
  const call = stopped.prompts()[0];
  t.mock.timers.tick(65 * 60 * 1000);
  const result = await stopped.coordinator.request('STOP');
  assert.equal(result.state.status, 'stopped');
  assert.deepEqual(result.state.pending, {});
  assert.equal((await stopped.reply(call, 'Late result after Stop')).ignored, true);
  assert.equal(stopped.sent.filter(item => item.message.type === 'CANCEL').length, 1);
});

test('explicit continuation after a clock pause retains the exact candidate files and queued instructions without resending a cancelled worker request', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.UTC(2026, 9, 6) });
  const h = harness({ runTimeoutMs: 2 * 60 * 60 * 1000 }); t.after(() => h.coordinator.dispose());
  await begin(h, { question: 'Create an improved Python file.', relayMedia: true });
  await until(() => h.prompts().length === 1);
  const firstBoss = h.prompts()[0];
  await h.reply(firstBoss, { request_id: firstBoss.message.requestId, action: 'dispatch',
    assignments: { left: 'Create the first complete program.', right: 'Build an independent program.' } });
  await until(() => h.prompts().length === 3);
  for (const call of h.prompts().slice(1)) {
    const output = h.generatedFile(call.side, call.message);
    await h.coordinator.pageEvent(call.side, { type: 'REPLY', runId: call.message.runId,
      requestId: call.message.requestId, text: `First ${call.side} complete result.`, media: [output] });
  }
  await until(() => h.prompts().length === 4);
  const selectingBoss = h.prompts()[3];
  await h.reply(selectingBoss, { request_id: selectingBoss.message.requestId, action: 'dispatch',
    candidate_result_id: 'W1', assignments: { left: 'Audit the candidate.', right: 'Inspect its boundaries.' } });
  await until(() => h.prompts().length === 6); await pause();
  await h.coordinator.request('BOSS_MESSAGE', { text: 'Preserve its public function names.' });
  const before = await h.coordinator.getState();
  const oldWorkers = h.prompts().slice(4);
  t.mock.timers.tick(2 * 60 * 60 * 1000 + 1);
  const paused = await h.coordinator.getState();
  assert.equal(paused.status, 'limit_reached');
  assert.deepEqual(paused.candidate, before.candidate);
  assert.equal(paused.boss.queue[0].text, 'Preserve its public function names.');
  const resumed = await h.coordinator.request('BOSS_MESSAGE', { text: 'Continue from the saved candidate.' });
  assert.equal(resumed.ok, true, resumed.error);
  assert.equal(resumed.state.runId, before.runId);
  assert.deepEqual(resumed.state.candidate, before.candidate);
  assert.deepEqual(resumed.state.workerResults, before.workerResults);
  assert.equal(resumed.state.round, 1);
  await until(() => h.prompts().length === 7);
  const nextBoss = h.prompts()[6];
  assert.equal(nextBoss.side, 'boss');
  assert.deepEqual(h.sent.filter(call => call.message.type === 'RESUME_RUN').map(call => call.side), ['left', 'right', 'boss']);
  const context = marker(nextBoss.message.text, 'BOSS_CONTEXT');
  assert.match(context.control_repair.error, /clock pause.*Any unfinished request was cancelled/);
  assert.deepEqual(context.user_instructions.map(item => item.text), ['Preserve its public function names.', 'Continue from the saved candidate.']);
  assert.equal(context.candidate.sha256, before.candidate.sha256);
  assert.ok(nextBoss.message.files.some(file => file.contentSha256 === before.candidate.media.files[0].contentSha256 && file.base64 ===
    h.exported.get(`${before.candidate.media.runId}:${before.candidate.media.requestId}`)[0].base64));
  for (const old of oldWorkers) assert.equal((await h.reply(old, 'Late cancelled audit result.')).ignored, true);
  assert.equal(h.prompts().filter(call => call.side !== 'boss').length, 4);
});

test('a paused run cannot restart while a page has not acknowledged releasing its cancellation', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.UTC(2026, 9, 6) });
  const h = harness({ runTimeoutMs: 2 * 60 * 60 * 1000, transport(side, message) {
    if (message.type === 'RESUME_RUN' && side === 'right') return { ok: false, error: 'The old request is still cancelling.' };
  } }); t.after(() => h.coordinator.dispose());
  await begin(h); await until(() => h.prompts().length === 1); await pause();
  t.mock.timers.tick(2 * 60 * 60 * 1000 + 1);
  const paused = await h.coordinator.getState();
  const resumed = await h.coordinator.request('BOSS_MESSAGE', { text: 'Continue working.' });
  assert.equal(resumed.ok, false);
  assert.match(resumed.error, /still cancelling/);
  assert.deepEqual(await h.coordinator.getState(), paused);
  assert.equal(h.prompts().length, 1);
});

test('work-cycle exhaustion pauses at a completed boundary and only an explicit increased limit permits more work', async t => {
  const h = harness({ reply(side, message) {
    if (side !== 'boss') return { text: `Useful ${side} result.` };
    const context = marker(message.text, 'BOSS_CONTEXT');
    if (context.user_revision) return null;
    return { text: JSON.stringify({ request_id: message.requestId, action: 'dispatch',
      assignments: { left: 'Improve the current result.', right: 'Inspect one more concrete case.' } }) };
  } }); t.after(() => h.coordinator.dispose());
  await begin(h, { maxRounds: 4 });
  await until(async () => (await h.coordinator.getState()).status === 'blocked');
  const paused = await h.coordinator.getState();
  assert.equal(paused.round, 4);
  assert.deepEqual(paused.pending, {});
  assert.equal(h.sent.some(call => call.message.type === 'CANCEL'), false);
  const resumed = await h.coordinator.request('BOSS_MESSAGE', { text: 'Allow two more useful work cycles.', maxRounds: 6 });
  assert.equal(resumed.ok, true, resumed.error);
  assert.equal(resumed.state.runId, paused.runId);
  assert.equal(resumed.state.maxRounds, 6);
  await until(() => h.prompts().at(-1).side === 'boss' && marker(h.prompts().at(-1).message.text, 'BOSS_CONTEXT').user_revision === 1);
  const boss = h.prompts().at(-1);
  await h.reply(boss, { request_id: boss.message.requestId, action: 'dispatch', assignments: { left: 'Concrete next audit.', right: 'Independent edge case.' } });
  await until(async () => (await h.coordinator.getState()).round === 5);
  assert.equal((await h.coordinator.getState()).status, 'running');
  assert.equal(h.sent.some(call => call.message.type === 'CANCEL'), false);
});

test('five-minute supervision checks continue through page updates and leave healthy long-running workers untouched', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.UTC(2026, 9, 6) });
  const h = harness({ transport(_side, message) {
    if (message.type === 'INSPECT_PROGRESS') return { ok: true, requestId: message.requestId, owned: true,
      active: true, generationBusy: true, interrupted: false, newerUserMessage: false, visibleResult: 'Research is still running.', status: 'Working' };
  } }); t.after(() => h.coordinator.dispose());
  await begin(h); await until(() => h.prompts().length === 1);
  const boss = h.prompts()[0];
  await h.reply(boss, { request_id: boss.message.requestId, action: 'dispatch', assignments: { left: 'Research carefully.', right: 'Check independently.' } });
  await until(() => h.prompts().length === 3); await pause();
  const pending = (await h.coordinator.getState()).pending;
  t.mock.timers.tick(2 * 60 * 1000);
  await h.coordinator.pageEvent('left', { type: 'PAGE_STATUS', ...READY, busy: true });
  t.mock.timers.tick(3 * 60 * 1000);
  await until(async () => (await h.coordinator.getState()).supervision.checks === 1);
  const first = await h.coordinator.getState();
  assert.deepEqual(first.pending, pending);
  assert.equal(first.supervision.checkedAt, Date.now());
  assert.equal(first.supervision.nextCheckAt, Date.now() + 5 * 60 * 1000);
  assert.equal(first.supervision.workers.left.generating, true);
  assert.deepEqual(first.supervision.events.map(event => event.type), ['generating', 'generating']);
  assert.match(first.supervision.events[0].detail, /Worker A is still working\. Working/);
  assert.match(first.supervision.events[1].detail, /Worker B is still working\. Working/);
  assert.ok(first.supervision.events.every(event => event.at === first.supervision.checkedAt));
  t.mock.timers.tick(5 * 60 * 1000);
  await until(async () => (await h.coordinator.getState()).supervision.checks === 2);
  assert.equal(h.sent.filter(call => call.message.type === 'INSPECT_PROGRESS').length, 4);
  assert.equal(h.sent.some(call => call.message.type === 'CANCEL'), false);
  assert.equal(h.prompts().length, 3);
  assert.equal((await h.coordinator.getState()).status, 'running');
  const checked = await h.coordinator.getState();
  assert.equal(checked.supervision.events.length, 4);
  assert.ok(checked.supervision.events[0].at < checked.supervision.events[2].at);
  await h.coordinator.request('STOP');
  assert.equal((await h.coordinator.getState()).supervision.nextCheckAt, null);
  t.mock.timers.tick(5 * 60 * 1000);
  await pause();
  assert.equal(h.sent.filter(call => call.message.type === 'INSPECT_PROGRESS').length, 4);
});

test('confirmed interruption immediately asks the boss to repair only the failed worker while its healthy peer continues', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.UTC(2026, 9, 6) });
  const h = harness({ transport(side, message) {
    if (message.type === 'INSPECT_PROGRESS') return { ok: true, requestId: message.requestId, owned: true,
      active: side === 'right', generationBusy: side === 'right', interrupted: side === 'left', newerUserMessage: false,
      status: side === 'left' ? 'The provider interrupted this exact request.' : 'Still analyzing', visibleResult: 'Partial tool summary.' };
  } }); t.after(() => h.coordinator.dispose());
  await begin(h); await until(() => h.prompts().length === 1);
  const boss = h.prompts()[0];
  await h.reply(boss, { request_id: boss.message.requestId, action: 'dispatch', assignments: { left: 'Research.', right: 'Analyze.' } });
  await until(() => h.prompts().length === 3); await pause();
  const [left, right] = h.prompts().slice(1);
  t.mock.timers.tick(5 * 60 * 1000);
  await until(() => h.prompts().length === 4);
  const paused = await h.coordinator.getState();
  assert.equal(paused.status, 'running');
  assert.deepEqual(paused.supervision.events.filter(event=>['interrupted','generating'].includes(event.type)).map(event => event.type), ['interrupted', 'generating']);
  assert.match(paused.supervision.events[0].detail, /Worker A response was confirmed interrupted/);
  assert.deepEqual(Object.keys(paused.pending), ['right', 'boss']);
  assert.equal(h.prompts().length, 4);
  const cancellation = h.sent.find(call => call.message.type === 'CANCEL');
  assert.equal(cancellation.side, 'left');
  assert.equal(cancellation.message.requestId, left.message.requestId);
  assert.equal(cancellation.message.cancelRun, false);
  assert.equal(cancellation.message.stopGeneration, false);
  assert.equal((await h.reply(left, 'Late answer from retired observer.')).ignored, true);
  const recovery = h.prompts()[3];
  const context = marker(h.prompts()[3].message.text, 'BOSS_CONTEXT');
  assert.equal(context.completed_work_cycles, 0, 'An interrupted pair is not a completed work cycle.');
  assert.equal(context.worker_results.length, 0, 'Healthy unfinished work must not be invented in recovery evidence.');
  assert.equal(context.recovery_task.side, 'left');
  assert.deepEqual(context.recovery_task.healthy_requests.map(item=>item.side), ['right']);
  assert.equal(context.worker_interruption_reports[0].side, 'left');
  assert.equal(context.worker_interruption_reports[0].partial_visible_result, 'Partial tool summary.');
  assert.equal(context.supervision.checks, 1);
  assert.equal((await h.coordinator.getState()).supervision.nextCheckAt, Date.now() + 5 * 60 * 1000);
  assert.equal(h.prompts().filter(call => call.side !== 'boss').length, 2);
  await h.reply(recovery, { request_id: recovery.message.requestId, action: 'repair', side: 'left', assignment: 'Resume the saved research checkpoint.' });
  await until(()=>h.prompts().length===5);
  assert.equal(h.prompts()[4].side,'left');
  assert.equal(h.prompts().filter(call=>call.side==='right').length,1);
  await h.reply(right, 'Actual completed independent analysis.');
  await h.reply(h.prompts()[4], 'Completed resumed research, not partial output.');
  await until(()=>h.prompts().length===6);
  assert.equal((await h.coordinator.getState()).completedWorkCycles,1);
});

test('idle UI, a human replacement, incorrect identities and failed progress inspection never authorize automatic recovery', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.UTC(2026, 9, 6) });
  let scenario = 0;
  const replies = [
    { interrupted: false }, { newerUserMessage: true }, { requestId: 'old-request' }, { owned: false }, { ok: false }, { active: true }, { generationBusy: true },
  ];
  const h = harness({ transport(_side, message) {
    if (message.type === 'INSPECT_PROGRESS') return { ok: true, requestId: message.requestId, owned: true,
      active: false, generationBusy: false, interrupted: true, newerUserMessage: false, ...replies[scenario] };
  } }); t.after(() => h.coordinator.dispose());
  await begin(h); await until(() => h.prompts().length === 1);
  const boss = h.prompts()[0];
  await h.reply(boss, { request_id: boss.message.requestId, action: 'dispatch', assignments: { left: 'Research.', right: 'Analyze.' } });
  await until(() => h.prompts().length === 3); await pause();
  const pending = (await h.coordinator.getState()).pending;
  for (scenario = 0; scenario < replies.length; scenario += 1) {
    t.mock.timers.tick(5 * 60 * 1000);
    await until(async () => (await h.coordinator.getState()).supervision.checks === scenario + 1);
    assert.deepEqual((await h.coordinator.getState()).pending, pending);
  }
  assert.equal(h.sent.some(call => call.message.type === 'CANCEL'), false);
  assert.equal(h.prompts().length, 3);
});

test('two confirmed worker interruptions create exactly one boss recovery request and the replacement work has fresh identities', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.UTC(2026, 9, 6) });
  const h = harness({ transport(_side, message) {
    if (message.type === 'INSPECT_PROGRESS') return { ok: true, requestId: message.requestId, owned: true,
      active: false, generationBusy: false, interrupted: true, newerUserMessage: false, status: 'Response interrupted.' };
  } }); t.after(() => h.coordinator.dispose());
  await begin(h); await until(() => h.prompts().length === 1);
  const initialBoss = h.prompts()[0];
  await h.reply(initialBoss, { request_id: initialBoss.message.requestId, action: 'dispatch', assignments: { left: 'Original A.', right: 'Original B.' } });
  await until(() => h.prompts().length === 3); await pause();
  const originalIds = h.prompts().slice(1).map(call => call.message.requestId);
  t.mock.timers.tick(5 * 60 * 1000);
  await until(() => h.prompts().length === 4);
  const recovery = h.prompts()[3];
  assert.equal(recovery.side, 'boss');
  const context = marker(recovery.message.text, 'BOSS_CONTEXT');
  assert.equal(context.worker_interruption_reports.length, 2);
  assert.equal(context.recovery_task.side, 'left');
  assert.deepEqual(Object.keys((await h.coordinator.getState()).pending), ['boss']);
  assert.equal(h.sent.filter(call => call.message.type === 'CANCEL').length, 2);
  await h.reply(recovery, { request_id: recovery.message.requestId, action: 'repair', side: 'left', assignment: 'Fresh independent recovery task A.' });
  await until(() => h.prompts().length === 6);
  const secondRepair = h.prompts()[5];
  assert.equal(secondRepair.side,'boss');
  await h.reply(secondRepair, { request_id:secondRepair.message.requestId,action:'repair',side:'right',assignment:'Fresh recovery task B.' });
  await until(()=>h.prompts().length===7);
  const replacements = [h.prompts()[4],h.prompts()[6]];
  assert.ok(replacements.every(call => !originalIds.includes(call.message.requestId)));
  assert.ok(replacements.every(call => /Fresh/.test(call.message.text)));
  assert.equal((await h.coordinator.getState()).round, 0);
});

test('the boss itself is supervised and three interrupted replans cannot loop indefinitely', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.UTC(2026, 9, 6) });
  const h = harness({ transport(_side, message) {
    if (message.type === 'INSPECT_PROGRESS') return { ok: true, requestId: message.requestId, owned: true,
      active: false, generationBusy: false, interrupted: true, newerUserMessage: false, status: 'Resume stream unavailable.' };
  } }); t.after(() => h.coordinator.dispose());
  await begin(h); await until(() => h.prompts().length === 1); await pause();
  for (let check = 1; check <= 4; check += 1) {
    t.mock.timers.tick(5 * 60 * 1000);
    await until(async () => (await h.coordinator.getState()).supervision.checks === check);
    await pause();
  }
  const state = await h.coordinator.getState();
  assert.equal(state.status, 'blocked');
  assert.match(state.error, /provider interrupted repeated recovery attempts/);
  assert.equal(h.prompts().length, 4, 'Only three fresh boss recovery requests are allowed.');
  assert.equal(new Set(h.prompts().map(call => call.message.requestId)).size, 4);
  assert.ok(h.prompts().every(call => call.side === 'boss'));
  assert.deepEqual(state.pending, {});
  assert.equal(state.round, 0);
  assert.ok(h.sent.filter(call => call.message.type === 'CANCEL').every(call => call.message.stopGeneration === false && call.message.cancelRun === false));
});

test('a structured exact interruption error preserves the healthy peer and replans from its real result', async t => {
  const h = harness(); t.after(() => h.coordinator.dispose());
  await begin(h); await until(() => h.prompts().length === 1);
  const boss = h.prompts()[0];
  await h.reply(boss, { request_id: boss.message.requestId, action: 'dispatch', assignments: { left: 'Create the document.', right: 'Inspect its source.' } });
  await until(() => h.prompts().length === 3);
  const [left, right] = h.prompts().slice(1);
  await h.coordinator.pageEvent('left', { type: 'PAGE_STATUS', ...READY, ready: false, busy: true, generating: true });
  const interrupted = { type: 'ERROR', runId: left.message.runId, requestId: left.message.requestId,
    interrupted: true, owned: true, active: false, generationBusy: false, newerUserMessage: false,
    interruptionKind: 'stream-interrupted', error: 'Resume stream unavailable.' };
  await h.coordinator.pageEvent('left', interrupted);
  const waiting = await h.coordinator.getState();
  assert.equal(waiting.status, 'running');
  assert.deepEqual(Object.keys(waiting.pending), ['right', 'boss']);
  assert.equal(waiting.pages.left.busy, false, 'The renderer must not retain the old Generating status.');
  assert.equal(waiting.pages.left.generating, false);
  assert.equal(waiting.pages.left.interrupted, true);
  assert.equal(waiting.pages.left.requestOwned, true);
  assert.equal(waiting.pages.left.activeRequestId, left.message.requestId);
  assert.equal(waiting.pages.left.interruptionKind, 'stream-interrupted');
  assert.equal(waiting.pages.left.reason, 'Resume stream unavailable.');
  assert.equal(h.sent.filter(call => call.message.type === 'CANCEL').length, 1);
  assert.equal((await h.coordinator.pageEvent('left', interrupted)).ignored, true);
  await h.reply(right, 'Actual source inventory saved in this completed response.');
  await until(() => h.prompts().length === 4);
  const context = marker(h.prompts()[3].message.text, 'BOSS_CONTEXT');
  assert.equal(context.completed_work_cycles, 0);
  assert.equal(context.worker_results.length, 0, 'The immediate plan cannot invent an unfinished peer result.');
  assert.equal((await h.coordinator.getState()).workerResults[0].text, 'Actual source inventory saved in this completed response.');
  assert.equal(context.worker_interruption_reports[0].side, 'left');
  assert.equal(context.recovery_task.attempt, 1);
  assert.equal(context.recovery_task.side, 'left');
});

test('a reconnecting owned request remains pending through missing Stop controls and retains its completed peer before resuming', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.UTC(2026, 9, 6) });
  let reconnecting = true;
  const h = harness({ transport(side, message) {
    if (message.type !== 'INSPECT_PROGRESS') return;
    return { ok: true, requestId: message.requestId, owned: true, active: true,
      generationBusy: side === 'left' ? !reconnecting : true, reconnecting: side === 'left' && reconnecting,
      interrupted: false, newerUserMessage: false,
      reason: side === 'left' && reconnecting ? 'Connection interrupted. Waiting for the complete answer…' : 'Current owned request is working.' };
  } }); t.after(() => h.coordinator.dispose());
  await begin(h); await until(() => h.prompts().length === 1);
  const boss = h.prompts()[0];
  await h.reply(boss, { request_id: boss.message.requestId, action: 'dispatch', assignments: { left: 'Produce the PDF.', right: 'Audit the sources.' } });
  await until(() => h.prompts().length === 3); await pause();
  const [left, right] = h.prompts().slice(1);
  const original = (await h.coordinator.getState()).pending;
  t.mock.timers.tick(5 * 60 * 1000);
  await until(async () => (await h.coordinator.getState()).supervision.checks === 1);
  const waiting = await h.coordinator.getState();
  assert.deepEqual(waiting.pending, original);
  assert.equal(waiting.pages.left.reconnecting, true); assert.equal(waiting.pages.left.interrupted, false);
  assert.equal(waiting.pages.left.busy, true); assert.equal(waiting.pages.left.generating, false);
  assert.match(waiting.stage, /waiting for ChatGPT to reconnect/);
  assert.equal(waiting.supervision.events[0].type, 'reconnecting');
  assert.doesNotMatch(waiting.supervision.events[0].detail, /still working|confirmed interrupted/);
  assert.equal(waiting.supervision.nextCheckAt, Date.now() + 30_000);
  await h.reply(right, 'Completed source audit retained while the PDF stream reconnects.');
  assert.deepEqual(Object.keys((await h.coordinator.getState()).pending), ['left']);
  assert.equal((await h.coordinator.getState()).workerResults.length, 1);
  t.mock.timers.tick(30_000);
  await until(async () => (await h.coordinator.getState()).supervision.checks === 2);
  assert.equal(h.sent.some(call => call.message.type === 'CANCEL'), false);
  assert.equal(h.prompts().length, 3);
  reconnecting = false;
  t.mock.timers.tick(30_000);
  await until(async () => (await h.coordinator.getState()).supervision.checks === 3);
  const resumed = await h.coordinator.getState();
  assert.equal(resumed.pages.left.reconnecting, false); assert.equal(resumed.pages.left.generating, true);
  assert.match(resumed.stage, /connection recovered/);
  assert.equal(resumed.supervision.nextCheckAt, Date.now() + 5 * 60 * 1000);
  await h.reply(left, 'Completed PDF work after the original stream reconnected.');
  await until(() => h.prompts().length === 4);
  const complete = await h.coordinator.getState();
  assert.equal(complete.completedWorkCycles, 1); assert.equal(complete.workerResults.length, 2);
  assert.equal(h.sent.some(call => call.message.type === 'CANCEL'), false);
});

test('a terminal owned stream failure after reconnecting retires only the idle affected request', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.UTC(2026, 9, 6) });
  let terminal = false;
  const h = harness({ transport(side, message) {
    if (message.type !== 'INSPECT_PROGRESS') return;
    const affected = side === 'left';
    return { ok: true, requestId: message.requestId, owned: true, active: !(affected && terminal),
      generationBusy: !(affected && terminal), reconnecting: affected && !terminal,
      interrupted: affected && terminal, interruptionKind: affected && terminal ? 'stream-interrupted' : '', newerUserMessage: false,
      reason: affected ? terminal ? 'Resume stream is not available.' : 'Connection interrupted. Waiting for the complete answer…' : 'Healthy peer is working.' };
  } }); t.after(() => h.coordinator.dispose());
  await begin(h); await until(() => h.prompts().length === 1);
  const boss = h.prompts()[0];
  await h.reply(boss, { request_id: boss.message.requestId, action: 'dispatch', assignments: { left: 'Produce the PDF.', right: 'Audit the sources.' } });
  await until(() => h.prompts().length === 3); await pause();
  t.mock.timers.tick(5 * 60 * 1000);
  await until(async () => (await h.coordinator.getState()).supervision.checks === 1);
  terminal = true; t.mock.timers.tick(30_000);
  await until(async () => (await h.coordinator.getState()).supervision.checks === 2);
  const interrupted = await h.coordinator.getState();
  assert.equal(interrupted.pages.left.reconnecting, false); assert.equal(interrupted.pages.left.interrupted, true);
  assert.deepEqual(Object.keys(interrupted.pending), ['right', 'boss']);
  const cancel = h.sent.filter(call => call.message.type === 'CANCEL');
  assert.equal(cancel.length, 1); assert.equal(cancel[0].side, 'left'); assert.equal(cancel[0].message.stopGeneration, false);
  assert.equal(h.prompts().length, 4);
});

test('an owned stream error with active generation controls is shown as interrupted without cancelling or pretending idle', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.UTC(2026, 9, 6) });
  let nativeBusy = true;
  const h = harness({ transport(side, message) {
    if (message.type !== 'INSPECT_PROGRESS') return;
    return { ok: true, requestId: message.requestId, owned: true, active: side === 'left' ? nativeBusy : true,
      generationBusy: side === 'left' ? nativeBusy : true, interrupted: side === 'left',
      awaitingProviderIdle: side === 'left' && nativeBusy, interruptionKind: 'stream-interrupted', newerUserMessage: false,
      reason: side === 'left' ? 'Resume stream unavailable; waiting for the active generation control.' : 'Healthy tool run' };
  } }); t.after(() => h.coordinator.dispose());
  await begin(h); await until(() => h.prompts().length === 1);
  const boss = h.prompts()[0];
  await h.reply(boss, { request_id: boss.message.requestId, action: 'dispatch', assignments: { left: 'Produce the draft.', right: 'Check the sources.' } });
  await until(() => h.prompts().length === 3); await pause();
  const original = (await h.coordinator.getState()).pending;
  t.mock.timers.tick(5 * 60 * 1000);
  await until(async () => (await h.coordinator.getState()).supervision.checks === 1);
  const waiting = await h.coordinator.getState();
  assert.deepEqual(waiting.pending, original);
  assert.equal(waiting.status, 'running');
  assert.equal(waiting.pages.left.interrupted, true);
  assert.equal(waiting.pages.left.busy, true);
  assert.equal(waiting.pages.left.generating, true);
  assert.match(waiting.stage, /interrupted; waiting for generation controls to become idle/);
  assert.equal(waiting.supervision.events[0].type, 'interrupted-waiting-idle');
  assert.doesNotMatch(waiting.supervision.events[0].detail, /still working/);
  assert.equal(waiting.supervision.nextCheckAt, Date.now() + 30_000);
  assert.equal(h.sent.some(call => call.message.type === 'CANCEL'), false);
  nativeBusy = false;
  t.mock.timers.tick(30_000);
  await until(async () => (await h.coordinator.getState()).supervision.checks === 2);
  const confirmed = await h.coordinator.getState();
  assert.deepEqual(Object.keys(confirmed.pending), ['right', 'boss']);
  assert.equal(confirmed.pages.left.busy, false);
  assert.equal(confirmed.pages.left.interrupted, true);
  assert.equal(confirmed.supervision.nextCheckAt, Date.now() + 5 * 60 * 1000);
  assert.equal(h.sent.filter(call => call.message.type === 'CANCEL').length, 1);
  assert.equal(h.sent.find(call => call.message.type === 'CANCEL').message.stopGeneration, false);
});

test('after initial inspection a file task prompts for real production checkpoints and compact current review state', async t => {
  const h = harness(); t.after(() => h.coordinator.dispose());
  await begin(h, { question: 'Create a complete downloadable PDF document from the notes.', relayMedia: true });
  await until(() => h.prompts().length === 1);
  const firstBoss = h.prompts()[0];
  await h.reply(firstBoss, { request_id: firstBoss.message.requestId, action: 'dispatch', assignments: { left: 'Map the source.', right: 'Check coverage.' } });
  await until(() => h.prompts().length === 3);
  await h.reply(h.prompts()[1], 'Concrete source map.'); await h.reply(h.prompts()[2], 'Independent source coverage map.');
  await until(() => h.prompts().length === 4);
  const nextBoss = h.prompts()[3];
  assert.equal(marker(nextBoss.message.text, 'BOSS_CONTEXT').delivery.production_checkpoint_due, true);
  assert.match(nextBoss.message.text, /rather than another analysis-only pair/);
  await h.reply(nextBoss, { request_id: nextBoss.message.requestId, action: 'dispatch', candidate_result_id: 'W1',
    assignments: { left: 'Produce the PDF.', right: 'Produce the diagrams.' } });
  await until(() => h.prompts().length === 6);
  const candidate = (await h.coordinator.getState()).candidate;
  for (let index = 0; index < 35; index += 1) {
    assert.equal((await h.coordinator.setRequirementReview({ id: 'task-complete', status: 'unverified', evidence: `History ${index}: ` + 'x'.repeat(5_000) })).ok, true);
    assert.equal((await h.coordinator.setIssueReview({ ...(index ? { id: 'I1' } : { title: 'Figure labels' }), status: 'found', evidence: `Inspection ${index}: ` + 'x'.repeat(5_000) })).ok, true);
  }
  await h.reply(h.prompts()[4], 'Progress without a file is still intermediate.'); await h.reply(h.prompts()[5], 'The required file is not produced yet.');
  await until(() => h.prompts().length === 7);
  const thirdBoss = h.prompts()[6];
  await h.reply(thirdBoss, { request_id: thirdBoss.message.requestId, action: 'dispatch', candidate_result_id: 'W1',
    assignments: { left: 'Create the actual artifact.', right: 'Create the diagram artifact.' } });
  await until(() => h.prompts().length === 9);
  const worker = h.prompts()[7];
  assert.match(worker.message.text, /Production checkpoint is due/);
  assert.match(worker.message.text, /Requested deliverable: PDF/);
  assert.match(worker.message.text, /including every requested derivation step/);
  assert.match(worker.message.text, /keep the chat reply to a brief coverage and check summary/);
  assert.match(worker.message.text, /A code block, filename, outline, or claim that a file exists is not a delivered file/);
  const contract = marker(worker.message.text, 'STUDIO_CONTRACT');
  assert.equal(contract.requirements[0].evidence.length, 1);
  assert.equal(contract.issues[0].history, undefined);
  assert.ok(worker.message.text.length < 30_000, 'Historical records must not exhaust the current prompt.');
  assert.equal((await h.coordinator.getState()).candidate.id, candidate.id);
  assert.equal((await h.coordinator.getState()).studio.requirements[0].evidence.length, 30, 'Full history stays in the saved project.');
});

test('audit Markdown and TSV attachments retain their indexes without suppressing required PDF production', async t => {
  const h = harness(); t.after(() => h.coordinator.dispose());
  await begin(h, { question: 'Create a complete downloadable PDF from these notes.', relayMedia: true });
  async function replyFile(call, name, mimeType, content) {
    const bytes = Buffer.from(content), file = { id: `${call.message.requestId}-file`, name, mimeType,
      fingerprint: hash(bytes), contentSha256: hash(bytes), byteLength: bytes.length, base64: bytes.toString('base64') };
    h.exported.set(`${call.message.runId}:${call.message.requestId}`, [file]);
    await h.coordinator.pageEvent(call.side, { type: 'REPLY', runId: call.message.runId,
      requestId: call.message.requestId, text: `Attached ${name}.`, media: [{ ...file, base64: undefined }] });
  }
  await until(() => h.prompts().length === 1);
  const first = h.prompts()[0];
  await h.reply(first, { request_id: first.message.requestId, action: 'dispatch',
    assignments: { left: 'Map the source.', right: 'Check coverage.' } });
  await until(() => h.prompts().length === 3);
  await replyFile(h.prompts()[1], 'audit.md', 'text/markdown', '# Audit\nSource mapped.\n');
  await replyFile(h.prompts()[2], 'coverage.tsv', 'text/tab-separated-values', 'section\tstatus\n1\tmapped\n');
  await until(() => h.prompts().length === 4);
  const checkpoint = h.prompts()[3], context = marker(checkpoint.message.text, 'BOSS_CONTEXT');
  assert.deepEqual(context.delivery.results_with_downloadable_files, ['W1', 'W2']);
  assert.deepEqual(context.delivery.results_with_required_outputs, []);
  assert.equal(context.delivery.production_checkpoint_due, true);
  assert.deepEqual(context.result_index.map(result => result.files[0].name), ['audit.md', 'coverage.tsv']);
  await h.reply(checkpoint, { request_id: checkpoint.message.requestId, action: 'dispatch',
    assignments: { left: 'Create the PDF checkpoint.', right: 'Check its coverage.' } });
  await until(() => h.prompts().length === 6);
  assert.match(h.prompts()[4].message.text, /Production checkpoint is due/);
  await replyFile(h.prompts()[4], 'draft.pdf', 'application/pdf', '%PDF-1.7 draft fixture');
  await replyFile(h.prompts()[5], 'review.md', 'text/markdown', '# Review\nCheck the draft.\n');
  await until(() => h.prompts().length === 7);
  const produced = marker(h.prompts()[6].message.text, 'BOSS_CONTEXT');
  assert.deepEqual(produced.delivery.results_with_downloadable_files, ['W1', 'W2', 'W3', 'W4']);
  assert.deepEqual(produced.delivery.results_with_required_outputs, ['W3']);
  assert.equal(produced.delivery.production_checkpoint_due, false);
});

test('late supervision snapshots cannot retire completed workers or interfere with the next boss request', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.UTC(2026, 9, 6) });
  const finish = [];
  const h = harness({ transport(_side, message) {
    if (message.type === 'INSPECT_PROGRESS') return new Promise(resolve => finish.push(() => resolve({ ok: true,
      requestId: message.requestId, owned: true, active: false, generationBusy: false, interrupted: true, newerUserMessage: false })));
  } }); t.after(() => h.coordinator.dispose());
  await begin(h); await until(() => h.prompts().length === 1);
  const boss = h.prompts()[0];
  await h.reply(boss, { request_id: boss.message.requestId, action: 'dispatch', assignments: { left: 'Research.', right: 'Analyze.' } });
  await until(() => h.prompts().length === 3); await pause();
  t.mock.timers.tick(5 * 60 * 1000);
  await until(() => finish.length === 2);
  const workers = h.prompts().slice(1);
  await h.reply(workers[0], 'Actual completed result A.');
  await h.reply(workers[1], 'Actual completed result B.');
  await until(() => h.prompts().length === 4);
  for (const resolve of finish) resolve();
  await pause(); await pause();
  const state = await h.coordinator.getState();
  assert.equal(state.round, 1);
  assert.deepEqual(Object.keys(state.pending), ['boss']);
  assert.equal(state.supervision.events.length, 0);
  assert.equal(h.sent.some(call => call.message.type === 'CANCEL'), false);
  assert.equal(h.prompts().length, 4);
});

test('supervision history reports waiting, unavailable ownership and check failures with reasons and retains only its latest 32 events', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.UTC(2026, 9, 6) });
  let check = 0;
  const h = harness({ transport(side, message) {
    if (message.type !== 'INSPECT_PROGRESS') return;
    if (check === 1 && side === 'left') throw new Error('Progress connection temporarily unavailable.');
    return { ok: true, requestId: message.requestId, owned: check !== 2, active: false,
      generationBusy: false, interrupted: false, newerUserMessage: false,
      reason: check === 2 ? 'The newest turn cannot be matched.' : 'Waiting for the provider to finish its tool.' };
  } }); t.after(() => h.coordinator.dispose());
  await begin(h); await until(() => h.prompts().length === 1);
  const boss = h.prompts()[0];
  await h.reply(boss, { request_id: boss.message.requestId, action: 'dispatch', assignments: { left: 'Research.', right: 'Analyze.' } });
  await until(() => h.prompts().length === 3); await pause();
  for (check = 0; check < 20; check += 1) {
    t.mock.timers.tick(5 * 60 * 1000);
    await until(async () => (await h.coordinator.getState()).supervision.checks === check + 1);
    if (check === 0) {
      const events = (await h.coordinator.getState()).supervision.events;
      assert.deepEqual(events.map(event => event.type), ['waiting', 'waiting']);
      assert.match(events[0].detail, /Worker A is waiting.*Waiting for the provider/);
    }
    if (check === 1) assert.match((await h.coordinator.getState()).supervision.events.at(-2).detail,
      /Worker A progress check failed\. Progress connection temporarily unavailable/);
    if (check === 2) assert.match((await h.coordinator.getState()).supervision.events.at(-1).detail,
      /Worker B request ownership could not be confirmed\. The newest turn cannot be matched/);
  }
  const state = await h.coordinator.getState();
  assert.equal(state.supervision.events.length, 32);
  assert.ok(state.supervision.events.every((event, index, events) => !index || event.at >= events[index - 1].at));
  assert.equal(state.supervision.events[0].at, state.startedAt + 25 * 60 * 1000);
  assert.equal(state.supervision.events.at(-1).at, state.supervision.checkedAt);
  assert.equal(state.supervision.nextCheckAt, Date.now() + 5 * 60 * 1000);
  assert.equal(h.sent.some(call => call.message.type === 'CANCEL'), false);
});

test('confirmed interruption evidence survives more than 32 later healthy checks in bounded chronological final history', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.UTC(2026, 9, 6) });
  let interrupt = true;
  const h = harness({ transport(_side, message) {
    if (message.type !== 'INSPECT_PROGRESS') return;
    return { ok: true, requestId: message.requestId, owned: true,
      active: !interrupt, generationBusy: !interrupt, interrupted: interrupt, newerUserMessage: false,
      reason: interrupt ? 'The provider stopped this request.' : 'Working normally after recovery.' };
  } }); t.after(() => h.coordinator.dispose());
  await begin(h); await until(() => h.prompts().length === 1);
  const firstBoss = h.prompts()[0];
  await h.reply(firstBoss, { request_id: firstBoss.message.requestId, action: 'dispatch', assignments: { left: 'Research.', right: 'Analyze.' } });
  await until(() => h.prompts().length === 3); await pause();
  t.mock.timers.tick(5 * 60 * 1000);
  await until(() => h.prompts().length === 4);
  const incidents = (await h.coordinator.getState()).supervision.events.filter(event => event.type === 'interrupted');
  assert.equal(incidents.length, 2);
  interrupt = false;
  const recoveryBoss = h.prompts()[3];
  await h.reply(recoveryBoss, { request_id: recoveryBoss.message.requestId, action: 'repair', side: 'left', assignment: 'Continue useful saved research.' });
  await until(() => h.prompts().length === 6);
  await h.reply(h.prompts()[5], { request_id: h.prompts()[5].message.requestId, action: 'repair', side: 'right', assignment: 'Continue independent saved analysis.' });
  await until(() => h.prompts().length === 7); await pause();
  for (let check = 0; check < 20; check += 1) {
    t.mock.timers.tick(5 * 60 * 1000);
    await until(async () => (await h.coordinator.getState()).supervision.checks === check + 2);
  }
  const observed = await h.coordinator.getState();
  assert.equal(observed.supervision.events.length, 32);
  assert.deepEqual(observed.supervision.events.filter(event => event.type === 'interrupted'), incidents);
  assert.ok(observed.supervision.events.filter(event => event.type === 'generating').length >= 26);
  assert.ok(observed.supervision.events.every((event, index, events) => !index || event.at >= events[index - 1].at));
  await h.reply(h.prompts()[4], 'Completed recovered analysis A.');
  await h.reply(h.prompts()[6], 'Completed recovered analysis B.');
  await until(() => h.prompts().length === 8);
  const boss = h.prompts()[7];
  await h.reply(boss, { request_id: boss.message.requestId, action: 'blocked', reason: 'Waiting for the user to inspect the actual recovered results.' });
  const final = await h.coordinator.getState();
  assert.equal(final.status, 'blocked');
  assert.equal(final.supervision.nextCheckAt, null);
  assert.deepEqual(final.supervision.events.filter(event => event.type === 'interrupted'), incidents);
});

test('second independent task reuses all conversations and resets old result/attachment ownership', async t => {
  const h = harness({ reply: normalReply }); t.after(() => h.coordinator.dispose());
  await begin(h, { question: 'What is 4+6?' });
  await until(async () => (await h.coordinator.getState()).status === 'agreed');
  const old = await h.coordinator.getState();
  const next = await h.coordinator.request('BOSS_MESSAGE', { text: 'Design a creative new explanation.' });
  assert.equal(next.ok, true, next.error);
  assert.notEqual(next.state.runId, old.runId);
  assert.deepEqual(next.state.tabIds, old.tabIds);
  assert.deepEqual(next.state.workerResults, []);
  assert.equal(next.state.minReviewRounds, 4);
  await until(async () => (await h.coordinator.getState()).status === 'agreed');
  assert.equal(h.opened.length, 3);
});

test('initial explicit file and image requests enforce exchange and actual output before final verification', async t => {
  for (const question of ['Create a PDF report.', 'Create two downloadable Python files.', 'Generate an image illustrating a galaxy.']) {
    const h = harness(); t.after(() => h.coordinator.dispose());
    await h.coordinator.request('OPEN_LAYOUT', { chatMode: 'normal' });
    const rejected = await h.coordinator.request('START', { question, relayMedia: false });
    assert.equal(rejected.ok, false, question);
    assert.match(rejected.error, /Enable file and image exchange/);
    assert.equal((await h.coordinator.getState()).status, 'setup');
    assert.equal(h.prompts().length, 0);
  }
  const h = harness({ reply(side, message, context) {
    if (side === 'boss' && marker(message.text, 'BOSS_CONTEXT').control_repair) return { text: JSON.stringify({ request_id: message.requestId,
      action: 'blocked', reason: 'The requested PDF output is unavailable.' }) };
    return normalReply(side, message, context);
  } }); t.after(() => h.coordinator.dispose());
  await begin(h, { question: 'Create a PDF report.', relayMedia: true });
  await until(async () => (await h.coordinator.getState()).status === 'blocked');
  const state = await h.coordinator.getState();
  assert.equal(state.requireFiles, true);
  assert.equal(state.requirePdf, true);
  assert.equal(state.verificationRounds, 0);
});

test('analysis of a PDF or image without creation does not infer an output artifact', async t => {
  for (const question of ['Explain why PDF compression works.', 'Describe this galaxy image.', 'Do not create a PDF. Explain the answer only.']) {
    const h = harness(); t.after(() => h.coordinator.dispose());
    const started = await begin(h, { question, relayMedia: false });
    assert.equal(started.state.requireFiles, false, question);
    assert.equal(started.state.requirePdf, false, question);
    assert.equal(started.state.requireImages, false, question);
  }
});

const mixedAuditSources = () => [
  { name: 'verification-input.txt', mimeType: 'text/plain', base64: Buffer.from('5, -2, 7, 4, 6\n').toString('base64') },
  { name: 'verification-record.pdf', mimeType: 'application/pdf', base64: Buffer.from('%PDF-1.7 original fixture with recorded sum').toString('base64') },
  { name: 'verification-chart.png', mimeType: 'image/png', base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==' },
];
const jsonAuditTask = 'Audit the five integers in the attached verification-input.txt, verification-record.pdf and verification-chart.png. Inspect all three sources, including the image labels, and check whether their values and recorded sum agree. Independently calculate their count, sum, mean, minimum and maximum, and determine whether recorded_sum is correct. Produce a complete downloadable summary.json with exactly these fields: count, sum, mean, min, max, recorded_sum_correct. Use JSON numbers and a boolean. Preserve all five values, including the negative value. The final result must include the actual downloadable JSON file, not only a code block.';
function jsonAuditReply(side, message, context) {
  const response = normalReply(side, message, context, !message.text.includes('Perform an independent final check'));
  if (side !== 'boss' && response.media) {
    const file = context.exported.get(`${message.runId}:${message.requestId}`)[0];
    const bytes = Buffer.from('{"count":5,"sum":20,"mean":4,"min":-2,"max":7,"recorded_sum_correct":false}\n');
    Object.assign(file, { name: 'summary.json', mimeType: 'application/json', base64: bytes.toString('base64'), contentSha256: hash(bytes), byteLength: bytes.length });
    Object.assign(response.media[0], { name: file.name, mimeType: file.mimeType, contentSha256: file.contentSha256, byteLength: file.byteLength });
  }
  return response;
}

test('mixed TXT PDF PNG input with an explicit summary.json output finishes four cycles without demanding a PDF', async t => {
  const h = harness({ reply: jsonAuditReply }); t.after(() => h.coordinator.dispose());
  await h.coordinator.request('OPEN_LAYOUT', { chatMode: 'normal' });
  assert.equal((await h.coordinator.request('ATTACH_FILES', { files: mixedAuditSources() })).ok, true);
  const started = await h.coordinator.request('START', { question: jsonAuditTask, requireFiles: true, relayMedia: true });
  assert.equal(started.ok, true, started.error); assert.equal(started.state.requirePdf, false);
  await until(async () => ['agreed', 'blocked', 'error'].includes((await h.coordinator.getState()).status));
  const state = await h.coordinator.getState();
  assert.equal(state.status, 'agreed', state.error); assert.equal(state.round, 4); assert.equal(state.verificationRounds, 1);
  assert.equal(state.requireFiles, true); assert.equal(state.requirePdf, false); assert.equal(state.requireImages, false);
  assert.deepEqual(state.candidate.media.files.map(file => file.name), ['summary.json']);
  assert.ok(h.prompts().filter(call => call.side === 'boss').every(call => marker(call.message.text, 'BOSS_CONTEXT').required_outputs.pdf === false));
  const saved = await h.coordinator.exportProject(); saved.state.requirePdf = true; // A project saved by the affected earlier version.
  const restored = harness(); t.after(() => restored.coordinator.dispose());
  const loaded = await restored.coordinator.restoreProject(saved);
  assert.equal(loaded.ok, true, loaded.error); assert.equal(loaded.state.requirePdf, false);
  assert.equal(loaded.state.candidate.sha256, state.candidate.sha256);
  await restored.coordinator.request('OPEN_LAYOUT', { chatMode: 'normal' });
  assert.equal((await restored.coordinator.request('BOSS_MESSAGE', { text: 'Continue reviewing the JSON file against the sources.' })).ok, true);
  assert.equal((await restored.coordinator.getState()).requirePdf, false);
  await until(() => restored.prompts().length > 0);
  const resumed = marker(restored.prompts().at(-1).message.text, 'BOSS_CONTEXT');
  assert.equal(resumed.required_outputs.pdf, false); assert.equal(resumed.candidate.sha256, state.candidate.sha256);
});

test('a queued explicit JSON deliverable clears only the attached-PDF fallback and preserves the real output', async t => {
  let firstBoss = true;
  const h = harness({ reply(side, message, context) {
    if (side === 'boss' && firstBoss) { firstBoss = false; return null; }
    return jsonAuditReply(side, message, context);
  } }); t.after(() => h.coordinator.dispose());
  await h.coordinator.request('OPEN_LAYOUT', { chatMode: 'normal' });
  await h.coordinator.request('ATTACH_FILES', { files: mixedAuditSources() });
  const started = await h.coordinator.request('START', { question: 'Audit the sources and prepare a complete downloadable file.', requireFiles: true, relayMedia: true });
  assert.equal(started.state.requirePdf, true, 'An unspecified corrected document keeps the original PDF fallback.');
  await until(() => h.prompts().length === 1);
  const originalBoss = h.prompts()[0];
  await h.coordinator.request('BOSS_MESSAGE', { text: 'Produce only summary.json from the attached PDF and other sources.' });
  await h.reply(originalBoss, { request_id: originalBoss.message.requestId, action: 'dispatch', assignments: { left: 'Old task.', right: 'Old task.' } });
  await until(async () => ['agreed', 'blocked', 'error'].includes((await h.coordinator.getState()).status));
  const state = await h.coordinator.getState();
  assert.equal(state.status, 'agreed', state.error); assert.equal(state.requirePdf, false); assert.equal(state.boss.appliedRevision, 1);
  assert.equal(state.round, 4); assert.deepEqual(state.candidate.media.files.map(file => file.name), ['summary.json']);
});

test('PDF inputs preserve corrected-PDF fallback and an explicit dual PDF plus JSON output remains enforced', async t => {
  for (const question of ['Fix the attached PDF.', 'Improve the attached document and return a downloadable file.',
    'Create summary.json and a PDF report from the attached sources.']) {
    const h = harness(); t.after(() => h.coordinator.dispose());
    await h.coordinator.request('OPEN_LAYOUT', { chatMode: 'normal' });
    await h.coordinator.request('ATTACH_FILES', { files: mixedAuditSources() });
    const started = await h.coordinator.request('START', { question, requireFiles: true, relayMedia: true });
    assert.equal(started.ok, true, started.error); assert.equal(started.state.requirePdf, true, question);
  }
});

test('real candidate-bound native compile and six-month backtest evidence can satisfy the finish gate', async t => {
  const h = harness({ reply(side, message, context) {
    if (side === 'boss') return normalReply(side, message, context);
    if (message.text.includes('Perform an independent final check')) {
      const candidate = marker(message.text, 'FINAL_CANDIDATE');
      const source = candidate.media.files.find(file => file.name === 'strategy.mq5');
      return { text: JSON.stringify({ candidate_id: candidate.id, candidate_sha256: candidate.sha256, verdict: 'accept',
        checks: ['Inspected the attached native log and complete tester report against the exact source hash.'], issues: [],
        taskEvidence: [{ requirementId: 'mt5-compile', status: 'completed', sourceSha256: source.contentSha256,
          reportName: 'compiler.log', tool: 'MetaEditor', results: '0 errors, 0 warnings', evidence: 'Native compilation log tied to the exact source.' },
        { requirementId: 'mt5-backtest', status: 'completed', sourceSha256: source.contentSha256,
          reportName: 'tester.html', tool: 'MT5 Strategy Tester', symbol: 'XAUUSDm', broker: 'Fixture broker', timeframe: 'M3',
          start: '2026-01-01', end: '2026-07-01', tickModel: 'Every tick based on real ticks',
          costs: 'Actual broker spread and commissions from fixture settings', results: 'Fixture native report fields checked.',
          evidence: 'Inspected the attached native tester report and run settings.' }] }) };
    }
    const bytes = [Buffer.from('void OnTick() {}\n'), Buffer.from('0 errors, 0 warnings\n'), Buffer.from('<html>MT5 tester report fixture</html>')];
    const files = ['strategy.mq5', 'compiler.log', 'tester.html'].map((name, index) => ({
      id: `${message.requestId}-${index}`, name, mimeType: 'text/plain', fingerprint: `native-${message.requestId}-${index}`,
      contentSha256: hash(bytes[index]), byteLength: bytes[index].length, base64: bytes[index].toString('base64'),
    }));
    context.exported.set(`${message.runId}:${message.requestId}`, files);
    return { text: 'Complete candidate and native evidence fixture.', media: files.map(({ base64: _base64, ...file }) => file) };
  } }); t.after(() => h.coordinator.dispose());
  await begin(h, { question: 'Create an MQL5 MT5 EA, compile with MetaEditor, and backtest with six months of real ticks.', relayMedia: true });
  await until(async () => ['agreed', 'error', 'limit_reached'].includes((await h.coordinator.getState()).status));
  const state = await h.coordinator.getState();
  assert.equal(state.status, 'agreed', state.error);
  assert.deepEqual(state.requiredWork.map(work => work.id), ['mt5-compile', 'mt5-backtest']);
  assert.ok(Object.values(state.workEvidence).every(evidence => evidence.candidateId === state.candidate.id && evidence.taskEvidence.length === 2));
});

test('full 15-file boss boundary is staged in three bounded batches and verified before one prompt', async t => {
  const h = harness({ reply(side, message, context) {
    if (side === 'boss' || message.text.includes('Perform an independent final check')) return normalReply(side, message, context);
    const files = Array.from({ length: 5 }, (_, index) => {
      const bytes = Buffer.from(`Output ${side} ${index}\n`);
      return { id: `${message.requestId}-${index}`, name: `output-${index}.txt`, mimeType: 'text/plain',
        fingerprint: `result-${message.requestId}-${index}`, contentSha256: hash(bytes), byteLength: bytes.length, base64: bytes.toString('base64') };
    });
    context.exported.set(`${message.runId}:${message.requestId}`, files);
    return { text: `${side} complete results.`, media: files.map(({ base64: _base64, ...file }) => file) };
  } }); t.after(() => h.coordinator.dispose());
  await h.coordinator.request('OPEN_LAYOUT', { chatMode: 'normal' });
  const originals = Array.from({ length: 5 }, (_, index) => ({ name: `source-${index}.pdf`, mimeType: 'application/pdf',
    base64: Buffer.from(`%PDF-1.7 original fixture ${index}`).toString('base64') }));
  assert.equal((await h.coordinator.request('ATTACH_FILES', { files: originals })).ok, true);
  assert.equal((await h.coordinator.request('START', { question: 'Analyze the originals and produce text explanations.', relayMedia: true })).ok, true);
  await until(async () => ['agreed', 'error'].includes((await h.coordinator.getState()).status));
  const state = await h.coordinator.getState();
  assert.equal(state.status, 'agreed', state.error);
  const boss = h.prompts().find(call => call.side === 'boss' && call.message.expectedSourceNames?.length === 15);
  assert.ok(boss);
  assert.equal(boss.message.files, undefined);
  const staged = h.sent.filter(call => call.side === 'boss' && call.message.type === 'UPLOAD_FILES' && call.message.requestId === boss.message.requestId);
  assert.deepEqual(staged.map(call => call.message.files.length), [5, 5, 5]);
  assert.deepEqual(boss.message.expectedSourceNames, staged.flatMap(call => call.message.files.map(file => file.name)));
  assert.equal(new Set(boss.message.expectedSourceNames).size, 15);
  assert.ok(staged.every(call => h.sent.indexOf(call) < h.sent.indexOf(boss)));
});

test('two complete 100k replies and a different candidate reach the boss with all fifteen ordinary files intact', async t => {
  const h = harness(); t.after(() => h.coordinator.dispose());
  await h.coordinator.request('OPEN_LAYOUT', { chatMode: 'normal' });
  const originals = Array.from({ length: 5 }, (_, index) => ({ name: `source-${index}.pdf`, mimeType: 'application/pdf',
    base64: Buffer.from(`%PDF-1.7 original fixture ${index}`).toString('base64') }));
  assert.equal((await h.coordinator.request('ATTACH_FILES', { files: originals })).ok, true);
  assert.equal((await h.coordinator.request('START', { question: 'Analyze the originals and produce complete explanations.', relayMedia: true,
    reviewMode: 'improve', maxRounds: 6 })).ok, true);
  const replies = ['L', 'R', 'P', 'Q'].map(label => `${label}"\\\nΩ`.repeat(20_000));
  assert.ok(replies.every(value => value.length === 100_000));
  async function dispatchPair(boss, candidateResultId = null) {
    const count = h.prompts().length;
    await h.reply(boss, { request_id: boss.message.requestId, action: 'dispatch', candidate_result_id: candidateResultId,
      assignments: { left: 'Complete the assigned analysis.', right: 'Check and extend its evidence.' } });
    await until(() => h.prompts().length === count + 2);
    return h.prompts().slice(-2);
  }
  async function replyWithFiles(call, fullText) {
    const files = Array.from({ length: 5 }, (_, index) => {
      const bytes = Buffer.from(`Output ${call.side} ${index}\n`);
      return { id: `${call.message.requestId}-${index}`, name: `output-${index}.txt`, mimeType: 'text/plain',
        fingerprint: hash(bytes), contentSha256: hash(bytes), byteLength: bytes.length, base64: bytes.toString('base64') };
    });
    h.exported.set(`${call.message.runId}:${call.message.requestId}`, files);
    await h.coordinator.pageEvent(call.side, { type: 'REPLY', runId: call.message.runId,
      requestId: call.message.requestId, text: fullText, media: files.map(({ base64: _base64, ...file }) => file) });
  }
  function assertCompleteEvidence(boss, expectedTexts, expectedBatchSizes) {
    const context = marker(boss.message.text, 'BOSS_CONTEXT');
    const staged = h.sent.filter(call => call.side === 'boss' && call.message.type === 'UPLOAD_FILES' && call.message.requestId === boss.message.requestId);
    assert.deepEqual(staged.map(call => call.message.files.length), expectedBatchSizes);
    const files = staged.flatMap(call => call.message.files);
    assert.deepEqual(boss.message.expectedSourceNames, files.map(file => file.name));
    assert.ok(staged.every(call => h.sent.indexOf(call) < h.sent.indexOf(boss)));
    assert.equal(files.filter(file => !file.name.startsWith('CONVERGE_')).length, 15);
    assert.equal(context.result_index.at(-1).files.length, 5);
    assert.ok(boss.message.text.length < 30_000, 'Complete long replies must not consume the inline planning budget.');
    const descriptors = [...context.worker_results.map(result => result.text_attachment), context.candidate?.answer_attachment].filter(Boolean);
    assert.equal(descriptors.length, expectedTexts.length);
    descriptors.forEach((descriptor, index) => {
      const bytes = Buffer.from(expectedTexts[index], 'utf8');
      const attached = files.find(file => file.name === descriptor.upload_name);
      assert.ok(attached, 'Every full-text descriptor must identify an actual staged attachment.');
      assert.equal(descriptor.contentSha256, hash(bytes));
      assert.equal(descriptor.byteLength, bytes.length);
      assert.equal(descriptor.encoding, 'utf-8');
      assert.deepEqual(Buffer.from(attached.base64, 'base64'), bytes);
      assert.equal(attached.contentSha256, descriptor.contentSha256);
      assert.equal(attached.byteLength, descriptor.byteLength);
    });
  }
  await until(() => h.prompts().length === 1);
  const pair = await dispatchPair(h.prompts()[0]);
  await replyWithFiles(pair[0], replies[0]); await replyWithFiles(pair[1], replies[1]);
  await until(() => h.prompts().length === 4);
  const firstBoss = h.prompts()[3];
  assertCompleteEvidence(firstBoss, replies.slice(0, 2), [5, 5, 5, 2]);
  const next = await dispatchPair(firstBoss, 'W1');
  await replyWithFiles(next[0], replies[2]); await replyWithFiles(next[1], replies[3]);
  await until(() => h.prompts().length === 7);
  assertCompleteEvidence(h.prompts()[6], [replies[2], replies[3], replies[0]], [5, 5, 5, 3]);
  const state = await h.coordinator.getState();
  assert.equal(state.status, 'running', state.error);
  assert.deepEqual(state.workerResults.map(result => result.text), replies);
  assert.equal(state.candidate.answer, replies[0]);
  const saved = await h.coordinator.exportProject();
  assert.deepEqual(saved.state.transcript.filter(item => item.role === 'work').map(item => item.text), replies);
});

test('maximum-size verification lists retain complete structured evidence while the boss receives a bounded planning context', async t => {
  const h = harness(); t.after(() => h.coordinator.dispose());
  await begin(h, { question: 'What is 4 + 6?', studio: { verificationEnabled: false, freshAudit: false,
    acceptanceCriteria: ['Show the addition.', 'State the result.'] } });
  await until(() => h.prompts().length === 1);
  const first = h.prompts()[0];
  await h.reply(first, { request_id: first.message.requestId, action: 'dispatch',
    assignments: { left: 'Compute the sum.', right: 'Independently check the addition.' } });
  await until(() => h.prompts().length === 3);
  await h.reply(h.prompts()[1], '10'); await h.reply(h.prompts()[2], 'The independently checked sum is 10.');
  await until(() => h.prompts().length === 4);
  const ready = h.prompts()[3];
  await h.reply(ready, { request_id: ready.message.requestId, action: 'verify', candidate_result_id: 'W1',
    assignments: { left: 'Check this exact result.', right: 'Independently inspect this exact result.' } });
  await until(() => h.prompts().length === 6);
  const checks = h.prompts().slice(-2), expected = [];
  for (const call of checks) {
    const candidate = marker(call.message.text, 'FINAL_CANDIDATE');
    const requirements = marker(call.message.text, 'STUDIO_CONTRACT').requirements;
    const review = { candidate_id: candidate.id, candidate_sha256: candidate.sha256, verdict: 'revise',
      checks: Array.from({ length: 40 }, (_, index) => `${call.side} check ${index}: ` + 'c'.repeat(1_600)),
      issues: Array.from({ length: 40 }, (_, index) => `${call.side} issue ${index}: ` + 'i'.repeat(550)),
      answer: 'The detailed review records unresolved evidence.',
      requirementReviews: requirements.map(item => ({ id: item.id, status: 'failed', evidence: 'e'.repeat(3_500) })) };
    const raw = JSON.stringify(review);
    assert.ok(raw.length > 95_000 && raw.length <= 100_000, 'Each review must approach the valid reply limit.');
    assert.equal(parseVerification(raw, candidate).checks.length, 40);
    expected.push(review);
    await h.reply(call, review);
  }
  await until(() => h.prompts().length === 7);
  const boss = h.prompts()[6], context = marker(boss.message.text, 'BOSS_CONTEXT');
  assert.ok(boss.message.text.length <= 190_000);
  assert.ok(boss.message.text.length < 80_000, 'Repeated long structured evidence belongs in its complete attachment.');
  const descriptor = context.structured_verification_attachment;
  assert.ok(descriptor);
  const attached = boss.message.files.find(file => file.name === descriptor.upload_name);
  assert.ok(attached);
  const bytes = Buffer.from(attached.base64, 'base64');
  assert.equal(descriptor.byteLength, bytes.length);
  assert.equal(descriptor.contentSha256, hash(bytes));
  const complete = JSON.parse(bytes.toString('utf8'));
  const resolve = reference => {
    assert.equal(reference.attachment, 'structured_verification_attachment');
    return reference.pointer.split('/').slice(1).reduce((value, key) => value[key], complete);
  };
  const state = await h.coordinator.getState();
  assert.deepEqual(complete.worker_results.map(result => result.verification), expected);
  assert.deepEqual(complete.final_verification, state.finalVerification);
  assert.equal(context.final_verification.candidateId, state.candidate.id);
  assert.equal(context.final_verification.sha256, state.candidate.sha256);
  for (const [index, result] of context.worker_results.entries()) {
    assert.equal(result.verification.candidate_id, state.candidate.id);
    assert.equal(result.verification.candidate_sha256, state.candidate.sha256);
    assert.equal(result.verification.verdict, 'revise');
    assert.equal(resolve(result.text_reference), JSON.stringify(expected[index]));
    assert.deepEqual(result.verification.checks.map(item => resolve(item.record_reference)), expected[index].checks);
    assert.deepEqual(result.verification.issues.map(item => resolve(item.record_reference)), expected[index].issues);
    assert.deepEqual(result.verification.requirementReviews.map(({ id, status }) => ({ id, status })),
      expected[index].requirementReviews.map(({ id, status }) => ({ id, status })));
    result.verification.requirementReviews.forEach((item, requirementIndex) =>
      assert.deepEqual(resolve(item.record_reference), expected[index].requirementReviews[requirementIndex]));
    assert.deepEqual(resolve(result.verification.record_reference), expected[index]);
    const final = context.final_verification.workers[result.side];
    assert.equal(final.verdict, 'revise');
    assert.deepEqual(final.issues.map(item => resolve(item.record_reference)), expected[index].issues);
  }
  assert.equal(context.studio.issues.length, 80);
  context.studio.issues.forEach((issue, index) => {
    assert.equal(issue.status, 'found');
    assert.equal(resolve(issue.title_reference), state.studio.issues[index].title);
    assert.equal(resolve(issue.evidence_reference), state.studio.issues[index].evidence);
  });
  const saved = await h.coordinator.exportProject();
  assert.deepEqual(saved.state.verificationEvidence.workerReviews.map(result => result.verification), expected);
  assert.deepEqual(saved.state.verificationEvidence.finalVerification, state.finalVerification);
  await h.reply(boss, { request_id: boss.message.requestId, action: 'finish', candidate_id: state.candidate.id,
    answer: 'Premature completion.', checks: ['Claimed complete.'], limitations: [] });
  await until(() => h.prompts().length === 8);
  const repair = marker(h.prompts()[7].message.text, 'BOSS_CONTEXT');
  assert.match(repair.control_repair.error, /Both workers must independently accept/);
  assert.ok(repair.structured_verification_attachment, 'Formatting/gate repair must retain the complete structured evidence.');
  assert.equal((await h.coordinator.getState()).status, 'running');
});

test('an incomplete staged transfer stops visibly without submitting a partial work message', async t => {
  let stageCount = 0;
  const h = harness({ reply(side, message, context) { return normalReply(side, message, context, true); },
    transport(side, message) {
      if (side === 'boss' && message.type === 'UPLOAD_FILES' && message.requestId) {
        stageCount += 1;
        if (stageCount === 2) return { ok: false, error: 'Provider rejected the second attachment batch.' };
      }
    } }); t.after(() => h.coordinator.dispose());
  await h.coordinator.request('OPEN_LAYOUT', { chatMode: 'normal' });
  assert.equal((await h.coordinator.request('ATTACH_FILES', { files: Array.from({ length: 5 }, (_, index) => ({
    name: `source-${index}.pdf`, mimeType: 'application/pdf', base64: Buffer.from(`%PDF-1.7 ${index}`).toString('base64'),
  })) })).ok, true);
  assert.equal((await h.coordinator.request('START', { question: 'Analyze the files.', relayMedia: true })).ok, true);
  await until(async () => (await h.coordinator.getState()).status === 'blocked');
  assert.match((await h.coordinator.getState()).error, /second attachment batch/);
  assert.equal(stageCount, 2);
  assert.equal(h.prompts().filter(call => call.side === 'boss').length, 1);
});

test('large text excluded from readable snapshots is fully refreshed for boss and workers', async t => {
  const h = harness({ reply: normalReply }); t.after(() => h.coordinator.dispose());
  await h.coordinator.request('OPEN_LAYOUT', { chatMode: 'normal' });
  const source = 'large original text\n'.repeat(4_000);
  assert.equal((await h.coordinator.request('ATTACH_FILES', { files: [{ name: 'large.txt', mimeType: 'text/plain',
    base64: Buffer.from(source).toString('base64') }] })).ok, true);
  assert.equal((await h.coordinator.request('START', { question: 'Analyze this text without changing it.', relayMedia: true })).ok, true);
  await until(async () => ['agreed', 'error'].includes((await h.coordinator.getState()).status));
  const state = await h.coordinator.getState();
  assert.equal(state.status, 'agreed', state.error);
  const initial = marker(h.prompts().find(call => call.side === 'boss').message.text, 'BOSS_CONTEXT');
  assert.deepEqual(initial.complete_readable_sources, []);
  for (const side of ['boss', 'left', 'right']) {
    const refreshed = h.prompts().filter(call => call.side === side).slice(1).flatMap(call => call.message.files || []);
    assert.ok(refreshed.some(file => file.name === 'ORIGINAL_large.txt' && file.base64 === Buffer.from(source).toString('base64')), side);
  }
});

test('format repair preserves a changed verified file and prevents accepting the original candidate', async t => {
  let malformed = false;
  const h = harness({ reply(side, message, context) {
    if (side === 'boss') {
      const boss = marker(message.text, 'BOSS_CONTEXT');
      if (boss.final_verification?.workers.left?.verdict === 'revise') return { text: JSON.stringify({
        request_id: message.requestId, action: 'blocked', reason: 'The replacement file must be selected and checked before completion.' }) };
    }
    if (side === 'left' && message.text.includes('Perform an independent final check') && !malformed) {
      malformed = true;
      return { text: 'A revised file is attached but JSON formatting failed.', media: [context.generatedFile(side, message, Buffer.from('changed = True\n'))] };
    }
    return normalReply(side, message, context, true);
  } }); t.after(() => h.coordinator.dispose());
  await begin(h, { question: 'Create an improved Python file.', relayMedia: true });
  await until(async () => ['blocked', 'error'].includes((await h.coordinator.getState()).status));
  const state = await h.coordinator.getState();
  assert.equal(state.status, 'blocked', state.error);
  const repaired = state.workerResults.find(result => result.side === 'left' && result.kind === 'verify');
  assert.equal(repaired.verification.verdict, 'revise');
  assert.equal(repaired.media.files[0].contentSha256, hash(Buffer.from('changed = True\n')));
  assert.notEqual(repaired.media.requestId, repaired.requestId);
  assert.equal(state.acceptedBy.left, undefined);
  const boss = h.prompts().filter(call => call.side === 'boss').at(-1);
  assert.ok(boss.message.files.some(file => Buffer.from(file.base64, 'base64').toString() === 'changed = True\n'));
});

test('preparing an oversized second worker prompt neither dispatches the first nor erases the last actual results', async t => {
  const h = harness({ reply(side, message) {
    if (side !== 'boss') return { text: side === 'left' ? 'x'.repeat(78_000) : 'Brief independent result.' };
    const boss = marker(message.text, 'BOSS_CONTEXT');
    if (boss.control_repair) return null;
    return { text: JSON.stringify({ request_id: message.requestId, action: 'dispatch',
      assignments: { left: 'A.', right: boss.completed_work_cycles ? 'B'.repeat(24_000) : 'B.' },
      candidate_result_id: boss.completed_work_cycles ? 'W1' : null }) };
  } }); t.after(() => h.coordinator.dispose());
  await h.coordinator.request('OPEN_LAYOUT', { chatMode: 'normal' });
  assert.equal((await h.coordinator.request('ATTACH_FILES', { files: [{ name: 'quoted.txt', mimeType: 'text/plain',
    base64: Buffer.from('"'.repeat(44_000)).toString('base64') }] })).ok, true);
  assert.equal((await h.coordinator.request('START', { question: 'Analyze this text.', relayMedia: true })).ok, true);
  await until(() => h.prompts().some(call => call.side === 'boss' && marker(call.message.text, 'BOSS_CONTEXT').control_repair));
  const state = await h.coordinator.getState();
  assert.equal(state.status, 'running', state.error);
  assert.deepEqual(Object.keys(state.pending), ['boss']);
  assert.deepEqual(state.lastBatch, ['W1', 'W2']);
  assert.equal(h.prompts().filter(call => call.side !== 'boss').length, 2);
  const repair = marker(h.prompts().filter(call => call.side === 'boss').at(-1).message.text, 'BOSS_CONTEXT');
  assert.match(repair.control_repair.error, /transport budget/);
  assert.equal(state.candidate.answer.length, 78_000);
  assert.equal(repair.candidate.answer, undefined);
  assert.equal(repair.candidate.answer_attachment.byteLength, 78_000);
  assert.equal(repair.candidate.text, undefined);
  assert.equal(repair.worker_results.length, 2);
  assert.equal(repair.worker_results[0].text, undefined);
  assert.deepEqual(repair.worker_results[0].text_reference, { candidate_id: repair.candidate.id, field: 'answer_attachment' });
  const complete = h.prompts().filter(call => call.side === 'boss').at(-1).message.files.find(file => file.name === repair.candidate.answer_attachment.upload_name);
  assert.equal(Buffer.from(complete.base64, 'base64').toString('utf8'), state.candidate.answer);
});

test('Stop during a staged batch cancels the run and prevents later batches or prompt submission', async t => {
  let finishUpload;
  const h = harness({ reply(side, message, context) { return normalReply(side, message, context, true); },
    transport(side, message) {
      if (side === 'boss' && message.type === 'UPLOAD_FILES' && message.requestId) {
        return new Promise(resolve => { finishUpload = () => resolve({ ok: true, attached: message.files.length }); });
      }
    } }); t.after(() => h.coordinator.dispose());
  await h.coordinator.request('OPEN_LAYOUT', { chatMode: 'normal' });
  assert.equal((await h.coordinator.request('ATTACH_FILES', { files: Array.from({ length: 5 }, (_, index) => ({
    name: `source-${index}.pdf`, mimeType: 'application/pdf', base64: Buffer.from(`%PDF-1.7 ${index}`).toString('base64'),
  })) })).ok, true);
  assert.equal((await h.coordinator.request('START', { question: 'Analyze the files.', relayMedia: true })).ok, true);
  await until(() => Boolean(finishUpload));
  const stopped = await h.coordinator.request('STOP');
  assert.equal(stopped.state.status, 'stopped');
  assert.deepEqual(stopped.state.pending, {});
  assert.ok(h.sent.some(call => call.side === 'boss' && call.message.type === 'CANCEL'));
  finishUpload(); await pause(); await pause();
  assert.equal(h.sent.filter(call => call.side === 'boss' && call.message.type === 'UPLOAD_FILES' && call.message.requestId).length, 1);
  assert.equal(h.prompts().filter(call => call.side === 'boss').length, 1);
  assert.equal((await h.coordinator.getState()).status, 'stopped');
});

test('a requested PDF analysis of code sources requires the PDF without demanding an unrequested revised program', async t => {
  const h = harness({ reply(side, message, context) {
    const response = normalReply(side, message, context, !message.text.includes('Perform an independent final check'));
    if (side !== 'boss' && response.media) {
      const file = context.exported.get(`${message.runId}:${message.requestId}`)[0];
      const bytes = Buffer.from('%PDF-1.7 fixture analysis of the original source');
      Object.assign(file, { name: 'analysis.pdf', mimeType: 'application/pdf', base64: bytes.toString('base64'),
        contentSha256: hash(bytes), byteLength: bytes.length });
      Object.assign(response.media[0], { name: file.name, mimeType: file.mimeType, contentSha256: file.contentSha256, byteLength: file.byteLength });
    }
    if (side !== 'boss' && message.text.includes('Perform an independent final check')) {
      // This deterministic model fixture reports visual evidence. It does not
      // pretend the fake transport PDF was rendered by a local checker.
      const candidate = marker(message.text, 'FINAL_CANDIDATE');
      const review = JSON.parse(response.text);
      review.documentReview = { files: candidate.media.files.map(file => ({ name: file.name,
        contentSha256: file.contentSha256, pageCount: 1, renderedPages: [1], inspectedPages: [1] })),
      checks: { typography: 'The fixture reports a readable serif body and aligned heading hierarchy on page 1.',
        spacing: 'The fixture reports consistent margins and no overlapping paragraphs on page 1.',
        mathematics: 'This source-analysis report has no requested derivations; code notation remains readable.',
        figures: 'This source-analysis report needs no figures; its complete explanations are present.',
        referenceStyle: 'No style reference was supplied; the fixture reports a coherent academic page design.' }, limitations: [] };
      review.requirementReviews = [{ id: 'document-content', status: 'met',
        evidence: 'The full source-analysis scope is covered, including the original program behavior and its limitations without modifying the source.' }];
      response.text = JSON.stringify(review);
    }
    return response;
  } }); t.after(() => h.coordinator.dispose());
  await h.coordinator.request('OPEN_LAYOUT', { chatMode: 'normal' });
  assert.equal((await h.coordinator.request('ATTACH_FILES', { files: [{ name: 'original.py', mimeType: 'text/plain',
    base64: Buffer.from('def original(x):\n    return x\n').toString('base64') }] })).ok, true);
  assert.equal((await h.coordinator.request('START', { question: 'Create a PDF report analyzing the source. Do not modify the code.', relayMedia: true })).ok, true);
  await until(async () => ['agreed', 'error', 'limit_reached'].includes((await h.coordinator.getState()).status));
  const state = await h.coordinator.getState();
  assert.equal(state.status, 'agreed', state.error);
  assert.equal(state.codeTask, true);
  assert.equal(state.requireCodeFile, false);
  assert.equal(state.requirePdf, true);
  assert.deepEqual(state.candidate.media.files.map(file => file.name), ['analysis.pdf']);
  assert.ok(h.prompts().filter(call => call.side === 'boss').every(call => marker(call.message.text, 'BOSS_CONTEXT').required_outputs.code_extension === ''));
});

test('explicit acceptance criteria block generic worker agreement until candidate evidence is supplied', async t => {
  const h = harness({ reply: normalReply }); t.after(() => h.coordinator.dispose());
  await begin(h, { studio: { acceptanceCriteria: ['Explain the empty-input behavior.'] } });
  await until(async () => ['blocked', 'error'].includes((await h.coordinator.getState()).status));
  const state = await h.coordinator.getState();
  assert.equal(state.status, 'blocked');
  assert.equal(state.studio.requirements.find(item => item.id === 'criterion-1').status, 'unverified');
  assert.match(state.error, /Studio acceptance evidence/);
  assert.equal((await h.coordinator.setRequirementReview({ id: 'criterion-1', status: 'met', evidence: 'I inspected the current candidate and its empty-input explanation.' })).ok, true);
  assert.equal((await h.coordinator.getState()).studio.requirements.find(item => item.id === 'criterion-1').source, 'user');
});

test('actual injected checks receive private candidate bytes and model claims cannot satisfy a failed tool gate', async t => {
  let inspected;
  const h = harness({ runVerification(candidate, context) {
    inspected = { candidate, context };
    return { candidateId: candidate.id, candidateSha256: candidate.sha256,
      checks: [{ id: 'syntax', label: 'Python syntax', source: 'executed', requirementId: 'source-validation', status: 'failed', evidence: 'Compiler exit code 1.' },
        { id: 'bytes', label: 'Artifact bytes', source: 'executed', requirementId: 'artifact-integrity', status: 'passed', evidence: 'Hash and length matched.' }] };
  }, reply(side, message, context) {
    const response = normalReply(side, message, context, !message.text.includes('Perform an independent final check'));
    if (side !== 'boss' && message.text.includes('Perform an independent final check')) {
      const review = JSON.parse(response.text);
      review.requirementReviews = marker(message.text, 'STUDIO_CONTRACT').requirements.map(item =>
        ({ id: item.id, status: 'met', evidence: 'Worker claims all requirements passed.' }));
      response.text = JSON.stringify(review);
    }
    return response;
  } }); t.after(() => h.coordinator.dispose());
  await begin(h, { question: 'Create a Python source file.', relayMedia: true,
    studio: { preset: 'software', verificationEnabled: true } });
  await until(async () => ['blocked', 'error'].includes((await h.coordinator.getState()).status));
  const state = await h.coordinator.getState();
  assert.equal(state.status, 'blocked', state.error);
  assert.ok(inspected.candidate.files[0].base64);
  assert.equal(inspected.context.preset, 'software');
  assert.equal(inspected.context.verificationMode, 'static');
  assert.equal(state.studio.verification.status, 'failed');
  assert.notEqual(state.studio.requirements.find(item => item.id === 'source-validation').status, 'met');
  assert.equal(JSON.stringify(state).includes('base64'), false);
});

test('exact candidate tool checks and structured criteria reviews permit completion', async t => {
  const h = harness({ runVerification(candidate) {
    return { candidateId: candidate.id, candidateSha256: candidate.sha256, checks: [
      { id: 'syntax', label: 'Python syntax', kind: 'executed', requirementId: 'source-validation', status: 'passed', evidence: 'Actual compiler exit code 0.' },
      { id: 'bytes', label: 'Artifact integrity', kind: 'executed', requirementId: 'artifact-integrity', status: 'passed', evidence: 'Decoded bytes match SHA-256.' },
    ] };
  }, reply(side, message, context) {
    const response = normalReply(side, message, context, !message.text.includes('Perform an independent final check'));
    if (side !== 'boss' && message.text.includes('Perform an independent final check')) {
      const local = marker(message.text, 'LOCAL_VERIFICATION');
      assert.equal(local.status, 'passed', 'Final worker instructions must be built after the local report applies.');
      assert.equal(local.candidateSha256, marker(message.text, 'FINAL_CANDIDATE').sha256);
      const executed = marker(message.text, 'STUDIO_CONTRACT').requirements.filter(item => item.gate === 'executed');
      assert.ok(executed.every(item => item.status === 'met' && item.source === 'executed'));
      const review = JSON.parse(response.text);
      review.requirementReviews = marker(message.text, 'STUDIO_CONTRACT').requirements.filter(item => item.gate === 'review').map(item =>
        ({ id: item.id, status: 'met', evidence: 'Inspected the supplied candidate and the requested boundary behavior.' }));
      response.text = JSON.stringify(review);
    }
    return response;
  } }); t.after(() => h.coordinator.dispose());
  await begin(h, { question: 'Create a Python source file.', relayMedia: true,
    studio: { preset: 'software', verificationEnabled: true, acceptanceCriteria: ['Handle empty input.'] } });
  await until(async () => ['agreed', 'blocked', 'error'].includes((await h.coordinator.getState()).status));
  const state = await h.coordinator.getState();
  assert.equal(state.status, 'agreed', state.error);
  assert.ok(state.studio.requirements.every(item => item.status === 'met'));
  assert.equal(state.studio.requirements.find(item => item.id === 'source-validation').source, 'executed');
  assert.equal(state.studio.requirements.find(item => item.id === 'criterion-1').source, 'model');
});

test('private snapshots preserve exact revisions while public state and restored candidates invalidate acceptance', async t => {
  const snapshots = [];
  const h = harness({ onCheckpoint: snapshot => snapshots.push(snapshot), reply(side, message, context) {
    return normalReply(side, message, context, !message.text.includes('Perform an independent final check'));
  } }); t.after(() => h.coordinator.dispose());
  await begin(h, { question: 'Create an improved Python file.', relayMedia: true });
  await until(async () => (await h.coordinator.getState()).status === 'agreed');
  const state = await h.coordinator.getState();
  const snapshot = await h.coordinator.exportProject();
  assert.equal(snapshot.schema, 'converge-studio-project');
  assert.equal(snapshot.revisions.length, state.studio.revisions.length);
  assert.ok(snapshot.revisions.every(item => item.files[0].base64));
  assert.equal(snapshot.state.pending, undefined); assert.equal(snapshot.state.pages, undefined); assert.equal(snapshot.state.runId, undefined);
  assert.equal(JSON.stringify(state).includes('base64'), false);
  assert.ok(snapshots.some(item => item.revisions.length > 0));
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'converge-project-evidence-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = createProjectStore({ directory });
  const saved = await store.save({ name: 'Reviewed coordinator project', snapshot });
  const loaded = await store.load(saved.id);
  assert.ok(loaded.snapshot.state.verificationEvidence, 'Disk persistence must retain the complete historical verification records.');
  assert.deepEqual(JSON.parse(JSON.stringify(loaded.snapshot.state.verificationEvidence)), snapshot.state.verificationEvidence);
  assert.equal(loaded.snapshot.state.verificationEvidence.workerReviews.length, 2);
  assert.ok(Object.values(loaded.snapshot.state.verificationEvidence.finalVerification.workers).every(review => review.verdict === 'accept'));
  const imported = harness(); t.after(() => imported.coordinator.dispose());
  const restoredProject = await imported.coordinator.restoreProject(loaded.snapshot);
  assert.equal(restoredProject.ok, true, restoredProject.error);
  assert.equal(restoredProject.state.status, 'idle');
  assert.equal(restoredProject.state.runId, null);
  assert.deepEqual(restoredProject.state.pending, {});
  assert.deepEqual(restoredProject.state.acceptedBy, {});
  assert.equal(restoredProject.state.finalVerification, null);
  assert.equal(restoredProject.state.studio.verification.status, 'idle');
  assert.equal(restoredProject.state.studio.freshAudit.status, 'idle');
  assert.ok(restoredProject.state.studio.requirements.every(item => item.status === 'unverified'));
  assert.ok(restoredProject.state.workerResults.every(result => !result.verification));
  const count = snapshots.length;
  await h.coordinator.pageEvent('left', { type: 'PAGE_STATUS', ...READY });
  assert.equal(snapshots.length, count, 'Page readiness alone must not duplicate a full byte checkpoint.');
  const first = state.studio.revisions[0];
  const restored = await h.coordinator.restoreRevision({ id: first.id });
  assert.equal(restored.ok, true); assert.equal(restored.state.candidate.sha256, first.sha256);
  assert.equal(restored.state.status, 'blocked'); assert.deepEqual(restored.state.acceptedBy, {});
  assert.ok(restored.state.studio.requirements.every(item => item.status === 'unverified'));
  const actual = await h.coordinator.getCurrentCandidate();
  assert.equal(actual.files[0].base64, snapshot.revisions[0].files[0].base64);
});

test('a saved project survives reconnect and resumes its brief and byte candidate under a fresh run identity', async t => {
  const source = harness({ reply(side, message, context) { return normalReply(side, message, context, !message.text.includes('Perform an independent final check')); } });
  t.after(() => source.coordinator.dispose());
  await source.coordinator.request('OPEN_LAYOUT', { chatMode: 'normal' });
  await source.coordinator.request('ATTACH_FILES', { files: [{ name: 'original.py', mimeType: 'text/plain', base64: Buffer.from('print(1)\n').toString('base64') }] });
  await source.coordinator.request('START', { question: 'Improve this Python file.', relayMedia: true });
  await until(async () => (await source.coordinator.getState()).status === 'agreed');
  const original = await source.coordinator.getState(); const snapshot = await source.coordinator.exportProject();
  const h = harness(); t.after(() => h.coordinator.dispose());
  const loaded = await h.coordinator.restoreProject(snapshot);
  assert.equal(loaded.ok, true, loaded.error); assert.equal(loaded.state.status, 'idle');
  assert.equal(loaded.state.runId, null); assert.deepEqual(loaded.state.pending, {});
  assert.equal(loaded.state.studio.verification.status, 'idle');
  const connected = await h.coordinator.request('OPEN_LAYOUT', { chatMode: 'normal' });
  assert.equal(connected.ok, true, connected.error);
  assert.equal(connected.state.status, 'blocked'); assert.equal(connected.state.question, original.question);
  assert.equal(connected.state.candidate.sha256, original.candidate.sha256);
  assert.ok(h.sent.filter(call => call.message.type === 'UPLOAD_FILES').length >= 3);
  const resumed = await h.coordinator.request('BOSS_MESSAGE', { text: 'Continue with the saved acceptance contract.' });
  assert.equal(resumed.ok, true, resumed.error); assert.equal(resumed.state.status, 'running');
  assert.notEqual(resumed.state.runId, original.runId);
  await until(() => h.prompts().some(call => call.side === 'boss'));
  const call = h.prompts().find(item => item.side === 'boss');
  const context = marker(call.message.text, 'BOSS_CONTEXT');
  assert.equal(context.user_task, original.question); assert.equal(context.candidate.sha256, original.candidate.sha256);
  assert.ok(call.message.files.some(file => file.base64 === snapshot.revisions.at(-1).files[0].base64));
  const tampered = structuredClone(snapshot); tampered.revisions[0].files[0].base64 = Buffer.from('forged source').toString('base64');
  await h.coordinator.stop();
  assert.equal((await h.coordinator.restoreProject(tampered)).ok, false);
});

test('fresh audit opens a new worker conversation and verifies the preserved exact candidate before completion', async t => {
  const h = harness({ reply(side, message, context) { return normalReply(side, message, context, !message.text.includes('Perform an independent final check')); } });
  t.after(() => h.coordinator.dispose());
  await begin(h, { question: 'Create a Python file.', relayMedia: true, studio: { freshAudit: true } });
  await until(async () => ['agreed', 'error', 'blocked'].includes((await h.coordinator.getState()).status));
  const state = await h.coordinator.getState();
  assert.equal(state.status, 'agreed', state.error);
  assert.deepEqual(h.opened, ['left', 'right', 'boss', 'right']);
  assert.equal(state.studio.freshAudit.status, 'passed');
  assert.equal(state.studio.freshAudit.candidateSha256, state.candidate.sha256);
  assert.equal(state.workerResults.filter(item => item.kind === 'fresh-audit').length, 1);
  const audit = h.prompts().find(call => call.message.text.includes('newly opened conversation'));
  assert.equal(marker(audit.message.text, 'FINAL_CANDIDATE').sha256, state.candidate.sha256);
  assert.equal(audit.message.files[0].base64, (await h.coordinator.getCurrentCandidate()).files[0].base64);
});

test('Stop while a fresh audit conversation is opening prevents its late prompt and final acceptance', async t => {
  let release;
  const h = harness({ openPage(side, _url, { opened }) {
    if (side === 'right' && opened.length === 4) return new Promise(resolve => { release = resolve; });
  }, reply: normalReply }); t.after(() => h.coordinator.dispose());
  await begin(h, { studio: { freshAudit: true } });
  await until(() => Boolean(release));
  const count = h.prompts().length;
  assert.equal((await h.coordinator.stop()).state.status, 'stopped');
  release(); await pause(); await pause(); await pause();
  assert.equal(h.prompts().length, count);
  assert.equal((await h.coordinator.getState()).status, 'stopped');
  assert.notEqual((await h.coordinator.getState()).studio.freshAudit.status, 'passed');
});

test('a late local report cannot accept a candidate after revision restore or Stop', async t => {
  let finish;
  const h = harness({ reply: normalReply, runVerification: candidate => new Promise(resolve => {
    finish = () => resolve({ candidateId: candidate.id, candidateSha256: candidate.sha256,
      checks: [{ id: 'actual', label: 'Fixture execution', source: 'executed', status: 'passed', evidence: 'Real fixture exit code 0.' }] });
  }) }); t.after(() => h.coordinator.dispose());
  await begin(h); await until(async () => (await h.coordinator.getState()).status === 'agreed');
  assert.equal((await h.coordinator.runVerification()).ok, true); await until(() => Boolean(finish));
  const id = (await h.coordinator.getState()).studio.revisions[0].id;
  assert.equal((await h.coordinator.restoreRevision(id)).ok, true);
  finish(); await pause(); await pause();
  assert.equal((await h.coordinator.getState()).studio.verification.status, 'idle');
  assert.deepEqual((await h.coordinator.getState()).acceptedBy, {});
});

test('new human instructions during fresh audit opening wait for navigation and force current final checks', async t => {
  let release;
  const h = harness({ openPage(side, _url, { opened }) {
    if (side === 'right' && opened.length === 4) return new Promise(resolve => { release = resolve; });
  }, reply: normalReply }); t.after(() => h.coordinator.dispose());
  await begin(h, { studio: { freshAudit: true } });
  await until(() => Boolean(release));
  const count = h.prompts().length;
  const addition = await h.coordinator.request('BOSS_MESSAGE', { text: 'Also explain the boundary behavior.' });
  assert.equal(addition.ok, true); assert.equal(addition.state.boss.queue.length, 1);
  await pause(); assert.equal(h.prompts().length, count, 'No new prompt may race a conversation still opening.');
  release();
  await until(async () => ['agreed', 'blocked', 'error'].includes((await h.coordinator.getState()).status));
  const state = await h.coordinator.getState();
  assert.equal(state.status, 'agreed', state.error);
  assert.equal(state.finalVerification.userRevision, 1);
  assert.equal(state.studio.contract.userRevision, 1);
  assert.equal(state.studio.freshAudit.status, 'passed');
  assert.equal(h.opened.filter(side => side === 'right').length, 3, 'The superseded audit requires another fresh conversation.');
  const audits = h.prompts().filter(call => call.message.text.includes('newly opened conversation'));
  assert.equal(audits.length, 1, 'The superseded opening must never receive its stale audit prompt.');
});

test('queued instructions supersede a pending local report before old final worker prompts can be submitted', async t => {
  let releaseReport;
  const h = harness({ runVerification(candidate, context) {
    const report = { candidateId: candidate.id, candidateSha256: candidate.sha256,
      checks: [{ id: 'identity', label: 'Exact candidate identity', source: 'executed', status: 'passed', evidence: 'Actual identity matched.' }] };
    if (context.userRevision === 0) return new Promise(resolve => { releaseReport = () => resolve(report); });
    return report;
  }, reply: normalReply }); t.after(() => h.coordinator.dispose());
  await begin(h, { studio: { verificationEnabled: true } });
  await until(() => Boolean(releaseReport));
  assert.equal((await h.coordinator.getState()).phase, 'boss-local-verification');
  assert.equal(h.prompts().filter(call => call.side !== 'boss' && call.message.text.includes('Perform an independent final check')).length, 0);
  const count = h.prompts().length;
  assert.equal((await h.coordinator.request('BOSS_MESSAGE', { text: 'Also explain the boundary case.' })).ok, true);
  await pause(); assert.equal(h.prompts().length, count, 'A user addition remains queued while the superseded local report settles.');
  releaseReport(); await pause(); await pause();
  await until(async () => ['agreed', 'blocked', 'error'].includes((await h.coordinator.getState()).status));
  const state = await h.coordinator.getState();
  assert.equal(state.status, 'agreed', state.error); assert.equal(state.boss.appliedRevision, 1);
  assert.equal(state.finalVerification.userRevision, 1); assert.equal(state.studio.verification.status, 'passed');
});

test('invalid new-task review settings retain the previous completed task and its exact revisions', async t => {
  const h = harness({ reply: normalReply }); t.after(() => h.coordinator.dispose());
  await begin(h); await until(async () => (await h.coordinator.getState()).status === 'agreed');
  const original = await h.coordinator.getState(); const snapshot = await h.coordinator.exportProject();
  const rejected = await h.coordinator.request('START', { question: 'Start another task.', reviewMode: 'invalid' });
  assert.equal(rejected.ok, false); assert.match(rejected.error, /review mode/);
  const state = await h.coordinator.getState();
  assert.equal(state.status, 'agreed'); assert.equal(state.runId, original.runId);
  assert.equal(state.question, original.question); assert.equal(state.candidate.sha256, original.candidate.sha256);
  assert.deepEqual((await h.coordinator.exportProject()).revisions, snapshot.revisions);
});

test('Stop retires local verification indicators immediately and ignores its late result', async t => {
  let release;
  const h = harness({ reply: normalReply, runVerification(candidate) {
    return new Promise(resolve => { release = () => resolve({ candidateId: candidate.id, candidateSha256: candidate.sha256,
      checks: [{ id: 'identity', label: 'Exact identity', source: 'executed', status: 'passed', evidence: 'Actual identity matched.' }] }); });
  } }); t.after(() => h.coordinator.dispose());
  await begin(h); await until(async () => (await h.coordinator.getState()).status === 'agreed');
  await h.coordinator.runVerification(); await until(() => Boolean(release));
  const stopped = await h.coordinator.stop();
  assert.equal(stopped.state.studio.verification.status, 'unverified');
  assert.match(stopped.state.studio.verification.summary, /stopped/i);
  release(); await pause(); await pause();
  assert.equal((await h.coordinator.getState()).studio.verification.status, 'unverified');
});

test('fresh audit cannot dispatch when its newly opened page is in the wrong chat mode', async t => {
  let h;
  h = harness({ openPage(side, _url, { opened }) { if (side === 'right' && opened.length === 4) h.pages.right.work = true; }, reply: normalReply });
  t.after(() => h.coordinator.dispose());
  await begin(h, { studio: { freshAudit: true } });
  await until(async () => ['agreed', 'blocked', 'error'].includes((await h.coordinator.getState()).status));
  const state = await h.coordinator.getState();
  assert.equal(state.status, 'blocked', state.error); assert.equal(state.studio.freshAudit.status, 'unverified');
  assert.equal(h.prompts().some(call => call.message.text.includes('newly opened conversation')), false);
  assert.match(state.studio.freshAudit.review.issues[0], /mode/i);
});

test('a failed manual tool report invalidates an already completed candidate', async t => {
  const h = harness({ reply: normalReply, runVerification(candidate) {
    return { candidateId: candidate.id, candidateSha256: candidate.sha256,
      checks: [{ id: 'identity', label: 'Exact identity', source: 'executed', status: 'failed', evidence: 'The actual parser found a malformed artifact.' }] };
  } }); t.after(() => h.coordinator.dispose());
  await begin(h); await until(async () => (await h.coordinator.getState()).status === 'agreed');
  await h.coordinator.runVerification();
  await until(async () => (await h.coordinator.getState()).studio.verification.status === 'failed');
  const state = await h.coordinator.getState();
  assert.equal(state.status, 'blocked'); assert.deepEqual(state.acceptedBy, {});
  assert.match(state.stage, /verification/i);
});

test('stopping a required verification rerun cannot leave the candidate final while its current report is unverified', async t => {
  let checks = 0, release;
  const h = harness({ reply: normalReply, runVerification(candidate) {
    const report = { candidateId: candidate.id, candidateSha256: candidate.sha256,
      checks: [{ id: 'identity', label: 'Exact identity', source: 'executed', status: 'passed', evidence: 'The actual identity matched.' }] };
    checks += 1;
    if (checks === 1) return report;
    return new Promise(resolve => { release = () => resolve(report); });
  } }); t.after(() => h.coordinator.dispose());
  await begin(h, { studio: { verificationEnabled: true } });
  await until(async () => (await h.coordinator.getState()).status === 'agreed');
  await h.coordinator.runVerification(); await until(() => Boolean(release));
  const stopped = await h.coordinator.stop();
  assert.equal(stopped.state.studio.verification.status, 'unverified');
  assert.equal(stopped.state.status, 'blocked'); assert.deepEqual(stopped.state.acceptedBy, {});
  release(); await pause(); await pause();
  assert.equal((await h.coordinator.getState()).status, 'blocked');
});

test('restoring a revision after Stop retains its task and source bytes for an explicit fresh-run continuation', async t => {
  let holdFinal = true, holdBoss = false;
  const h = harness({ reply(side, message, context) {
    if (side === 'boss' && holdBoss) return null;
    if (side !== 'boss' && message.text.includes('Perform an independent final check') && holdFinal) return null;
    return normalReply(side, message, context, !message.text.includes('Perform an independent final check'));
  } }); t.after(() => h.coordinator.dispose());
  await h.coordinator.request('OPEN_LAYOUT', { chatMode: 'normal' });
  const sourceBytes = Buffer.from('original = True\n');
  await h.coordinator.request('ATTACH_FILES', { files: [{ name: 'original.py', mimeType: 'text/plain', base64: sourceBytes.toString('base64') }] });
  await h.coordinator.request('START', { question: 'Improve the complete Python source file.', relayMedia: true });
  await until(async () => (await h.coordinator.getState()).phase === 'boss-verification');
  const original = await h.coordinator.getState();
  const first = original.studio.revisions[0];
  const saved = await h.coordinator.exportProject();
  await h.coordinator.stop();
  const restored = await h.coordinator.restoreRevision(first.id);
  assert.equal(restored.ok, true); assert.equal(restored.state.status, 'blocked');
  assert.equal(restored.state.runId, null); assert.equal(restored.state.question, original.question);
  const count = h.prompts().length;
  holdBoss = true;
  await h.coordinator.request('BOSS_MESSAGE', { text: 'Continue with the restored revision and acceptance contract.' });
  await until(() => h.prompts().length > count);
  const resumed = await h.coordinator.getState();
  assert.notEqual(resumed.runId, original.runId); assert.equal(resumed.question, original.question);
  assert.equal(resumed.candidate.sha256, first.sha256);
  assert.equal(resumed.studio.revisions.length, original.studio.revisions.length);
  const call = h.prompts().slice(count).find(item => item.side === 'boss');
  assert.ok(call.message.files.some(file => file.name === 'ORIGINAL_original.py.txt' && file.base64 === sourceBytes.toString('base64')));
  assert.ok(call.message.files.some(file => file.base64 === saved.revisions[0].files[0].base64));
  assert.equal(call.message.expectedSourceNames, undefined, 'Already consumed source composer receipts cannot be reused by a fresh run.');
  assert.equal(call.message.runId, resumed.runId);
  holdFinal = false;
});

test('fresh audit waits for bounded actual page readiness after transient provider startup', async t => {
  let fresh = false, inspections = 0;
  const h = harness({ freshAuditReadyTimeoutMs: 100, freshAuditReadyIntervalMs: 5,
    openPage(side, _url, { opened }) { if (side === 'right' && opened.length === 4) fresh = true; },
    transport(side, message) {
      if (fresh && side === 'right' && ['PREPARE', 'INSPECT'].includes(message.type)) {
        inspections += 1;
        if (inspections < 3) return { ...READY, ready: false, busy: true, reason: 'This chat is uploading an attachment. Wait until its preview is ready.' };
      }
    }, reply: normalReply }); t.after(() => h.coordinator.dispose());
  await begin(h, { studio: { freshAudit: true } });
  await until(async () => ['agreed', 'blocked', 'error'].includes((await h.coordinator.getState()).status));
  const state = await h.coordinator.getState();
  assert.equal(state.status, 'agreed', state.error); assert.equal(state.round, 4);
  assert.equal(state.studio.freshAudit.status, 'passed'); assert.equal(inspections, 3);
  assert.equal(h.prompts().filter(call => call.message.text.includes('newly opened conversation')).length, 1);
  const auditIndex = h.sent.findIndex(call => call.message.text?.includes('newly opened conversation'));
  assert.equal(h.sent.slice(0, auditIndex).filter(call => call.side === 'right' && call.message.type === 'INSPECT').length >= 3, true);
});

test('fresh audit readiness timeout cannot bypass a genuine upload, draft or active generation', async t => {
  const h = harness({ freshAuditReadyTimeoutMs: 15, freshAuditReadyIntervalMs: 5,
    transport(side, message) {
      if (side === 'right' && h.opened.length >= 4 && ['PREPARE', 'INSPECT'].includes(message.type)) return {
        ...READY, ready: false, busy: true, reason: 'This chat is generating a response or has an unsent draft.' };
    }, reply: normalReply }); t.after(() => h.coordinator.dispose());
  await begin(h, { studio: { freshAudit: true } });
  await until(async () => ['agreed', 'blocked', 'error'].includes((await h.coordinator.getState()).status));
  const state = await h.coordinator.getState();
  assert.equal(state.status, 'blocked'); assert.equal(state.studio.freshAudit.status, 'unverified');
  assert.equal(h.prompts().some(call => call.message.text.includes('newly opened conversation')), false);
  assert.match(state.studio.freshAudit.review.issues[0], /generating.*draft/);
});

test('Stop during fresh audit readiness settling retires the pending inspection and prevents its late prompt', async t => {
  let waiting = false;
  const h = harness({ freshAuditReadyTimeoutMs: 100, freshAuditReadyIntervalMs: 5,
    transport(side, message) {
      if (side === 'right' && h.opened.length >= 4 && ['PREPARE', 'INSPECT'].includes(message.type)) {
        waiting = true; return { ...READY, ready: false, busy: true, reason: 'New page is still loading.' };
      }
    }, reply: normalReply }); t.after(() => h.coordinator.dispose());
  await begin(h, { studio: { freshAudit: true } });
  await until(() => waiting);
  const count = h.prompts().length;
  await h.coordinator.stop();
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(h.prompts().length, count); assert.equal((await h.coordinator.getState()).status, 'stopped');
});

test('owned stored sources and candidate revisions retain opaque disk identities privately through checkpoint and restore', async t => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'converge-coordinator-stored-'));
  const store = createFileStore({ directory: folder });
  t.after(async () => { await store.close(); await fs.rm(folder, { recursive: true, force: true }); });
  const source = await store.ingestStream((async function* () { yield Buffer.from('def original():\n    return 1\n'); })(), { name: 'original.py', mimeType: 'text/plain' });
  const output = await store.ingestStream((async function* () { yield Buffer.from('def improved():\n    return 2\n'); })(), { name: 'answer.py', mimeType: 'text/plain' });
  const checkpoints = [];
  const h = harness({ onCheckpoint: snapshot => checkpoints.push(snapshot), reply(side, message, context) {
    const response = normalReply(side, message, context, !message.text.includes('Perform an independent final check'));
    if (side !== 'boss' && response.media) {
      const exported = context.exported.get(`${message.runId}:${message.requestId}`)[0];
      delete exported.base64; Object.assign(exported, output);
      Object.assign(response.media[0], { name: output.name, mimeType: output.mimeType, contentSha256: output.contentSha256, byteLength: output.byteLength });
    }
    return response;
  } }); t.after(() => h.coordinator.dispose());
  await h.coordinator.request('OPEN_LAYOUT', { chatMode: 'normal' });
  assert.equal((await h.coordinator.request('ATTACH_FILES', { files: [source] })).ok, true);
  assert.equal((await h.coordinator.request('START', { question: 'Improve the complete Python source.', relayMedia: true })).ok, true);
  await until(async () => ['agreed', 'error', 'blocked'].includes((await h.coordinator.getState()).status));
  const state = await h.coordinator.getState(); assert.equal(state.status, 'agreed', state.error);
  assert.doesNotMatch(JSON.stringify(state), /blobId|base64|\.blob/);
  const candidate = await h.coordinator.getCurrentCandidate(); assert.equal(candidate.files[0].blobId, output.blobId);
  const snapshot = await h.coordinator.exportProject(); assert.equal(snapshot.sources[0].blobId, source.blobId);
  assert.equal(snapshot.revisions[0].files[0].blobId, output.blobId); assert.doesNotMatch(JSON.stringify(snapshot), /base64|filename|\.blob/);
  assert.ok(checkpoints.some(saved => saved.sources[0]?.blobId === source.blobId && saved.revisions[0]?.files[0]?.blobId === output.blobId));
  const restored = harness(); t.after(() => restored.coordinator.dispose());
  const loaded = await restored.coordinator.restoreProject(snapshot); assert.equal(loaded.ok, true, loaded.error);
  assert.doesNotMatch(JSON.stringify(loaded.state), /blobId|base64|\.blob/);
  assert.equal((await restored.coordinator.getCurrentCandidate()).files[0].blobId, output.blobId);
});

test('initial source delivery is sequential and Stop retires it before another page receives files', async t => {
  let release;
  const h = harness({ transport(side, message) {
    if (message.type === 'UPLOAD_FILES' && side === 'left' && !release) {
      h.coordinator.sourceUploadProgress({ phase: 'staging', side });
      return new Promise(resolve => { release = () => resolve({ ok: true, attached: 1 }); });
    }
  } }); t.after(() => h.coordinator.dispose());
  await h.coordinator.request('OPEN_LAYOUT', { chatMode: 'normal' });
  const attached = h.coordinator.request('ATTACH_FILES', { files: [{ name: 'source.txt', mimeType: 'text/plain', base64: 'YQ==' }] });
  await until(() => Boolean(release));
  assert.deepEqual(h.sent.filter(call => call.message.type === 'UPLOAD_FILES').map(call => call.side), ['left']);
  const stopped = await h.coordinator.stop();
  assert.equal(stopped.state.attachments.status, 'none');
  assert.deepEqual(stopped.state.attachments.names, []);
  release(); await attached;
  assert.deepEqual(h.sent.filter(call => call.message.type === 'UPLOAD_FILES').map(call => call.side), ['left']);
  assert.equal((await h.coordinator.getState()).status, 'stopped');
  assert.equal((await h.coordinator.getState()).attachments.status, 'none');
  assert.deepEqual((await h.coordinator.exportProject()).sources, []);
  assert.equal((await h.coordinator.request('RECHECK_ATTACHMENTS')).ok, false);
  const replacement = await h.coordinator.request('ATTACH_FILES', { files: [{ name: 'replacement.txt', mimeType: 'text/plain', base64: 'Yg==' }] });
  assert.equal(replacement.ok, true, replacement.error);
  assert.equal(replacement.state.attachments.status, 'attached');
  assert.deepEqual(replacement.state.attachments.names, ['replacement.txt']);
});

test('Stop after a page confirms a source preserves partial bytes for receipt-only recovery and never repeats the upload', async t => {
  let release, receiptReady = false;
  const h = harness({ transport(side, message) {
    if (message.type === 'UPLOAD_FILES' && side === 'right') return new Promise(resolve => { release = () => resolve({ ok: true, attached: 1 }); });
    if (message.type === 'CHECK_ATTACHMENTS') return { ok: true, attached: receiptReady ? 1 : side === 'left' ? 1 : 0 };
  } }); t.after(() => h.coordinator.dispose());
  await h.coordinator.request('OPEN_LAYOUT', { chatMode: 'normal' });
  const attached = h.coordinator.request('ATTACH_FILES', { files: [{ name: 'source.py', mimeType: 'text/plain', base64: Buffer.from('answer = 10\n').toString('base64') }] });
  await until(() => Boolean(release));
  const stopped = await h.coordinator.stop();
  assert.equal(stopped.state.status, 'stopped');
  assert.equal(stopped.state.attachments.status, 'partial');
  assert.deepEqual(stopped.state.attachments.names, ['source.py']);
  release(); await attached;
  assert.deepEqual(h.sent.filter(call => call.message.type === 'UPLOAD_FILES').map(call => call.side), ['left', 'right']);
  assert.equal((await h.coordinator.request('ATTACH_FILES', { files: [{ name: 'other.txt', mimeType: 'text/plain', base64: 'YQ==' }] })).ok, false);
  assert.equal((await h.coordinator.request('START', { question: 'Analyze the source.' })).ok, false);
  assert.equal((await h.coordinator.request('RECHECK_ATTACHMENTS')).ok, false);
  assert.equal((await h.coordinator.getState()).attachments.status, 'partial');
  receiptReady = true;
  const recovered = await h.coordinator.request('RECHECK_ATTACHMENTS');
  assert.equal(recovered.ok, true, recovered.error);
  assert.equal(recovered.state.attachments.status, 'attached');
  assert.equal(h.sent.filter(call => call.message.type === 'UPLOAD_FILES').length, 2);
  assert.equal((await h.coordinator.request('START', { question: 'Analyze the source without rewriting it.' })).ok, true);
  await until(() => h.prompts().length === 1);
  assert.equal(marker(h.prompts()[0].message.text, 'BOSS_CONTEXT').complete_readable_sources[0].text, 'answer = 10\n');
});

test('Stop while reconnecting saved source attachments cannot be overwritten by a late Open completion', async t => {
  const source = harness({ reply: normalReply }); t.after(() => source.coordinator.dispose());
  await source.coordinator.request('OPEN_LAYOUT', { chatMode: 'normal' });
  await source.coordinator.request('ATTACH_FILES', { files: [{ name: 'note.txt', mimeType: 'text/plain', base64: 'YQ==' }] });
  assert.equal((await source.coordinator.request('START', { question: 'Review the attached note.', relayMedia: true })).ok, true);
  await until(async () => (await source.coordinator.getState()).status === 'agreed');
  const snapshot = await source.coordinator.exportProject();
  const original = await source.coordinator.getState();
  let release;
  const h = harness({ transport(side, message) {
    if (message.type === 'UPLOAD_FILES' && side === 'left') {
      h.coordinator.sourceUploadProgress({ phase: 'staging', side });
      return new Promise(resolve => { release = () => resolve({ ok: true, attached: 1 }); });
    }
  } }); t.after(() => h.coordinator.dispose());
  assert.equal((await h.coordinator.restoreProject(snapshot)).ok, true);
  const opening = h.coordinator.request('OPEN_LAYOUT', { chatMode: 'normal' });
  await until(() => Boolean(release));
  await h.coordinator.stop(); release(); await opening;
  const state = await h.coordinator.getState();
  assert.equal(state.status, 'stopped'); assert.equal(state.attachments.status, 'none');
  assert.equal(state.runId, null); assert.deepEqual(state.pending, {});
  assert.deepEqual(h.sent.filter(call => call.message.type === 'UPLOAD_FILES').map(call => call.side), ['left']);
  assert.equal(state.candidate.sha256, original.candidate.sha256);
});

test('Stop after direct submission or staged COMMIT without its ACK preserves receipt-only recovery', async t => {
  for (const staged of [false, true]) {
    let release, receiptReady = false;
    const pageCalls = [], progress = [];
    const bytes = Buffer.alloc(staged ? 4 * 1024 * 1024 : 1, 65);
    const source = { name: 'source.txt', mimeType: 'text/plain', base64: bytes.toString('base64') };
    const h = harness({ transport(side, message) {
      if (message.type === 'UPLOAD_FILES') return sendUpload(async (_side, sent) => {
        pageCalls.push(sent.type);
        if (['UPLOAD_FILES', 'FILE_STAGE_COMMIT'].includes(sent.type)) return new Promise(resolve => { release = () => resolve({ ok: true, attached: 1 }); });
        return { ok: true };
      }, side, message, { onProgress: event => { progress.push(event); h.coordinator.sourceUploadProgress(event); } });
      if (message.type === 'CHECK_ATTACHMENTS') return { ok: true, attached: receiptReady || side === 'left' ? 1 : 0 };
    } }); t.after(() => h.coordinator.dispose());
    await h.coordinator.request('OPEN_LAYOUT', { chatMode: 'normal' });
    const attaching = h.coordinator.request('ATTACH_FILES', { files: [source] });
    await until(() => Boolean(release));
    assert.equal(progress.at(-1).phase, 'processing', 'Ownership must mark possible selection before awaiting the provider receipt.');
    assert.equal(pageCalls.at(-1), staged ? 'FILE_STAGE_COMMIT' : 'UPLOAD_FILES');
    const stopped = await h.coordinator.stop();
    assert.equal(stopped.state.status, 'stopped'); assert.equal(stopped.state.attachments.status, 'partial');
    release(); await attaching;
    assert.equal((await h.coordinator.getState()).attachments.status, 'partial');
    assert.equal(h.sent.filter(call => call.message.type === 'UPLOAD_FILES').length, 1);
    assert.equal((await h.coordinator.request('START', { question: 'Review the source.' })).ok, false);
    assert.equal((await h.coordinator.request('RECHECK_ATTACHMENTS')).ok, false);
    receiptReady = true;
    const recovered = await h.coordinator.request('RECHECK_ATTACHMENTS');
    assert.equal(recovered.ok, true, recovered.error);
    assert.equal(h.sent.filter(call => call.message.type === 'UPLOAD_FILES').length, 1, 'Checking receipts must never upload files again.');
    assert.equal((await h.coordinator.exportProject()).sources[0].base64, source.base64);
  }
});

test('canceling an added batch before COMMIT retains older confirmed originals and discards only the added bytes', async t => {
  let release;
  const h = harness({ transport(side, message) {
    if (message.type === 'UPLOAD_FILES' && message.files[0].name === 'added.txt' && side === 'left') {
      h.coordinator.sourceUploadProgress({ side, phase: 'staging' });
      return new Promise(resolve => { release = () => resolve({ ok: true, attached: 1 }); });
    }
  } }); t.after(() => h.coordinator.dispose());
  await h.coordinator.request('OPEN_LAYOUT', { chatMode: 'normal' });
  assert.equal((await h.coordinator.request('ATTACH_FILES', { files: [{ name: 'original.txt', mimeType: 'text/plain', base64: 'YQ==' }] })).ok, true);
  const adding = h.coordinator.request('ATTACH_FILES', { files: [{ name: 'added.txt', mimeType: 'text/plain', base64: 'Yg==' }] });
  await until(() => Boolean(release));
  const stopped = await h.coordinator.stop();
  assert.equal(stopped.state.attachments.status, 'attached');
  assert.deepEqual(stopped.state.attachments.names, ['original.txt']);
  release(); await adding;
  const snapshot = await h.coordinator.exportProject();
  assert.deepEqual(snapshot.sources.map(file => file.name), ['original.txt']);
  assert.equal((await h.coordinator.request('RECHECK_ATTACHMENTS')).ok, false);
  assert.equal((await h.coordinator.request('START', { question: 'Review the original note.' })).ok, true);
  await until(() => h.prompts().length === 1);
  assert.deepEqual(marker(h.prompts()[0].message.text, 'BOSS_CONTEXT').originals.map(file => file.name), ['original.txt']);
});

test('an owned unsupported output requests a file repair after its healthy peer completes', async t => {
  const h = harness(); t.after(() => h.coordinator.dispose());
  await begin(h); await until(() => h.prompts().length === 1);
  const boss = h.prompts()[0];
  await h.reply(boss, { request_id: boss.message.requestId, action: 'dispatch',
    assignments: { left: 'Produce the source inspection.', right: 'Audit its coverage.' } });
  await until(() => h.prompts().length === 3);
  const [left, right] = h.prompts().slice(1);
  const failed = { type: 'ERROR', runId: right.message.runId, requestId: right.message.requestId,
    recoverableOutputFailure: true, owned: true, active: false, generationBusy: false, newerUserMessage: false,
    error: 'The generated audit attachment uses an unsupported file format.' };
  await h.coordinator.pageEvent('right', failed);
  const waiting = await h.coordinator.getState();
  assert.equal(waiting.status, 'running');
  assert.deepEqual(Object.keys(waiting.pending), ['left', 'boss']);
  assert.equal(waiting.pages.right.interrupted, false, 'File delivery failure is not a provider stream interruption.');
  assert.equal(waiting.round, 0);
  assert.equal(h.sent.filter(call => call.message.type === 'CANCEL' && call.side === 'left').length, 0);
  assert.ok(h.sent.filter(call => call.message.type === 'CANCEL').every(call => call.message.stopGeneration === false));
  assert.equal((await h.coordinator.pageEvent('right', failed)).ignored, true);
  await h.reply(left, 'Completed source map from the healthy worker.');
  await until(() => h.prompts().length === 4);
  const context = marker(h.prompts()[3].message.text, 'BOSS_CONTEXT');
  assert.equal(context.worker_results.length, 0);
  assert.equal((await h.coordinator.getState()).workerResults[0].text, 'Completed source map from the healthy worker.');
  assert.equal(context.worker_interruption_reports[0].failure_kind, 'output-delivery');
  assert.equal(context.recovery_task.category, 'output-delivery');
  assert.equal(context.completed_work_cycles, 0);
  assert.deepEqual(Object.keys((await h.coordinator.getState()).pending), ['boss']);
});

test('failed byte verification retains the completed response only as diagnostics and never accepts a candidate', async t => {
  const h = harness({ transport(_side, message) {
    if (message.type === 'EXPORT_MEDIA') return { ok: false, error: 'The exact owned download was interrupted.' };
  } }); t.after(() => h.coordinator.dispose());
  await begin(h, { relayMedia: true }); await until(() => h.prompts().length === 1);
  const boss = h.prompts()[0];
  await h.reply(boss, { request_id: boss.message.requestId, action: 'dispatch',
    assignments: { left: 'Create the PDF checkpoint.', right: 'Audit the source.' } });
  await until(() => h.prompts().length === 3);
  const [left, right] = h.prompts().slice(1);
  const metadata = h.generatedFile('left', left.message);
  await h.coordinator.pageEvent('left', { type: 'REPLY', runId: left.message.runId, requestId: left.message.requestId,
    text: 'The existing saved checkpoint should be re-exported without repeating its source analysis.', media: [metadata] });
  await until(async () => !(await h.coordinator.getState()).pending.left);
  assert.deepEqual(Object.keys((await h.coordinator.getState()).pending), ['right', 'boss']);
  const waiting = await h.coordinator.getState();
  assert.equal(waiting.status, 'running');
  assert.deepEqual(Object.keys(waiting.pending), ['right', 'boss']);
  assert.equal(waiting.workerResults.length, 0);
  assert.equal(waiting.candidate, null);
  await h.reply(right, 'Completed independent audit.');
  await until(() => h.prompts().length === 4);
  const context = marker(h.prompts()[3].message.text, 'BOSS_CONTEXT');
  assert.equal(context.worker_results.length, 0);
  assert.equal((await h.coordinator.getState()).workerResults.length, 1);
  assert.match(context.worker_interruption_reports[0].partial_visible_result, /existing saved checkpoint/);
  assert.equal(context.worker_interruption_reports[0].failure_kind, 'output-delivery');
  assert.equal(context.completed_work_cycles, 0);
});

test('repeated output repairs remain bounded and report missing file delivery honestly', async t => {
  const h = harness(); t.after(() => h.coordinator.dispose());
  await begin(h); await until(() => h.prompts().length === 1);
  const boss = h.prompts()[0];
  await h.reply(boss, { request_id: boss.message.requestId, action: 'dispatch',
    assignments: { left: 'Re-export the existing artifact in a supported format.', right: 'Check its coverage.' } });
  await until(() => h.prompts().length === 3);
  let failed = h.prompts()[1];
  await h.reply(h.prompts()[2], 'Actual healthy audit is preserved across every repair.');
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const before = h.prompts().length;
    await h.coordinator.pageEvent('left', { type: 'ERROR', runId: failed.message.runId, requestId: failed.message.requestId,
      recoverableOutputFailure: true, owned: true, active: false, generationBusy: false, newerUserMessage: false, error: 'Artifact was not delivered.' });
    if (attempt === 4) break;
    await until(() => h.prompts().length === before + 1);
    const repair = h.prompts().at(-1);
    assert.equal(marker(repair.message.text, 'BOSS_CONTEXT').recovery_task.attempt, attempt);
    await h.reply(repair, { request_id: repair.message.requestId, action: 'repair', side: 'left', assignment: 'Re-export the saved artifact in a supported format.' });
    await until(() => h.prompts().length === before + 2);
    failed = h.prompts().at(-1);
    assert.equal(failed.side, 'left');
  }
  const state = await h.coordinator.getState();
  assert.equal(state.status, 'blocked');
  assert.match(state.error, /Repeated output-delivery repairs exhausted three/);
  assert.equal(state.round, 0);
  assert.equal(state.workerResults.length, 1);
  assert.equal(h.prompts().filter(call => call.side === 'right').length, 1);
  assert.equal(state.candidate, null);
  assert.ok(h.sent.filter(call => call.message.type === 'CANCEL').every(call => call.message.stopGeneration === false));
});

test('an owned failed PAGE_STATUS triggers a proof check and boss repair immediately without waiting five minutes', async t => {
  const h = harness({ transport(side, message) {
    if (message.type === 'INSPECT_PROGRESS') return { ok: true, requestId: message.requestId, owned: true,
      active: side !== 'left', generationBusy: side !== 'left', interrupted: side === 'left',
      interruptionKind: 'delivery-error', newerUserMessage: false, reason: 'Message delivery failed.' };
  } }); t.after(() => h.coordinator.dispose());
  await begin(h); await until(() => h.prompts().length === 1);
  await h.reply(h.prompts()[0], { request_id: h.prompts()[0].message.requestId, action: 'dispatch',
    assignments: { left: 'Produce the full document.', right: 'Audit the original sources.' } });
  await until(() => h.prompts().length === 3);
  const before=await h.coordinator.getState();
  await h.coordinator.pageEvent('left', { type: 'PAGE_STATUS', ...READY, requestOwned: true,
    activeRequestId: before.pending.left.requestId, interrupted: true, interruptionKind: 'delivery-error' });
  await until(() => h.prompts().length === 4);
  const context=marker(h.prompts()[3].message.text,'BOSS_CONTEXT');
  assert.equal(context.recovery_task.side,'left'); assert.equal(context.recovery_task.category,'delivery-error');
  assert.deepEqual((await h.coordinator.getState()).pending.right,before.pending.right);
  assert.equal(h.sent.filter(call=>call.message.type==='CANCEL'&&call.side==='right').length,0);
});

test('healthy completed files are published and checkpointed while the boss recovery request remains live', async t => {
  const checkpoints = [], changes = [];
  const h = harness({ onCheckpoint(value) { checkpoints.push(value); }, onState(value) { changes.push(value); } });
  t.after(() => h.coordinator.dispose());
  const [left, right] = await pendingWorkerPair(h);
  await h.coordinator.pageEvent('left', { type: 'ERROR', runId: left.message.runId, requestId: left.message.requestId,
    interrupted: true, owned: true, active: false, generationBusy: false, newerUserMessage: false,
    interruptionKind: 'timeout', error: 'Request timed out.' });
  await until(() => h.prompts().length === 4);
  const repair = h.prompts()[3];
  const file = h.generatedFile('right', right.message, Buffer.from('healthy completed exact bytes\n'));
  await h.coordinator.pageEvent('right', { type: 'REPLY', runId: right.message.runId, requestId: right.message.requestId,
    text: 'The healthy worker completed its full assigned scope; A remains interrupted.', media: [file] });
  await until(async () => (await h.coordinator.getState()).workerResults.length === 1);
  assert.equal((await h.coordinator.getState()).pending.boss.requestId, repair.message.requestId);
  assert.ok(changes.some(state => state.delivery?.files[0].contentSha256 === file.contentSha256));
  assert.ok(checkpoints.some(saved => saved.completedResults?.[0]?.files[0].contentSha256 === file.contentSha256));
  assert.equal((await h.coordinator.getState()).round, 0, 'An incomplete pair must not count as completed work.');
  assert.equal(h.prompts().filter(call => call.side === 'right').length, 1);
  assert.equal(h.sent.some(call => call.side === 'right' && call.message.type === 'CANCEL'), false);
});

test('a failed boss recovery itself is retried without cancelling its healthy worker or losing the failed job', async t => {
  const h=harness();t.after(()=>h.coordinator.dispose());
  await begin(h);await until(()=>h.prompts().length===1);
  await h.reply(h.prompts()[0],{request_id:h.prompts()[0].message.requestId,action:'dispatch',assignments:{left:'Produce the file.',right:'Audit the sources.'}});
  await until(()=>h.prompts().length===3);
  const left=h.prompts()[1],right=h.prompts()[2];
  await h.coordinator.pageEvent('left',{type:'ERROR',runId:left.message.runId,requestId:left.message.requestId,
    interrupted:true,owned:true,active:false,generationBusy:false,newerUserMessage:false,interruptionKind:'timeout',error:'Request timed out.'});
  await until(()=>h.prompts().length===4);
  const repair=h.prompts()[3];
  await h.coordinator.pageEvent('boss',{type:'ERROR',runId:repair.message.runId,requestId:repair.message.requestId,
    interrupted:true,owned:true,active:false,generationBusy:false,newerUserMessage:false,interruptionKind:'server-error',error:'Something went wrong.'});
  await until(()=>h.prompts().length===5);
  assert.equal(marker(h.prompts()[4].message.text,'BOSS_CONTEXT').recovery_task.side,'left');
  await h.reply(right,'Actual healthy source audit while the boss recovers.');
  assert.equal((await h.coordinator.getState()).workerResults.length,1);
  await h.reply(h.prompts()[4],{request_id:h.prompts()[4].message.requestId,action:'repair',side:'left',assignment:'Continue the saved file and expose the completed checkpoint.'});
  await until(()=>h.prompts().length===6);
  await h.reply(h.prompts()[5],'Actual resumed file-work response.');
  await until(()=>h.prompts().length===7);
  assert.equal((await h.coordinator.getState()).round,1);
  assert.equal(h.prompts().filter(call=>call.side==='right').length,1);
  assert.equal(h.sent.some(call=>call.side==='right'&&call.message.type==='CANCEL'),false);
});

test('a corrupt file is quarantined without cancelling its healthy peer or accepting its claimed result', async t => {
  const h=harness({transport(side,message,{exported}){
    if(side==='left'&&message.type==='EXPORT_MEDIA')return{ok:true,files:(exported.get(`${message.runId}:${message.requestId}`)||[]).map(file=>({...file,contentSha256:'0'.repeat(64)}))};
  }});t.after(()=>h.coordinator.dispose());
  const [left,right]=await pendingWorkerPair(h);
  const bad=h.generatedFile('left',left.message,Buffer.from('untrusted claimed bytes\n'));
  await h.coordinator.pageEvent('left',{type:'REPLY',runId:left.message.runId,requestId:left.message.requestId,text:'Purported result',media:[bad]});
  await until(async()=>!(await h.coordinator.getState()).pending.left);
  assert.ok((await h.coordinator.getState()).pending.right);
  assert.equal((await h.coordinator.getState()).workerResults.length,0);
  assert.equal(h.sent.some(call=>call.side==='right'&&call.message.type==='CANCEL'),false);
  const good=h.generatedFile('right',right.message,Buffer.from('actual retained healthy bytes\n'));
  await h.coordinator.pageEvent('right',{type:'REPLY',runId:right.message.runId,requestId:right.message.requestId,text:'Actual healthy result',media:[good]});
  await until(async()=>(await h.coordinator.getState()).status==='blocked');
  assert.equal((await h.coordinator.getState()).workerResults[0].media.files[0].contentSha256,good.contentSha256);
  assert.equal((await h.coordinator.getState()).candidate,null);
});

test('a bridge observation timeout arriving before the host clock callback reconnects instead of being lost at the budget boundary', async t => {
  t.mock.timers.enable({apis:['Date','setTimeout'],now:Date.UTC(2026,9,7)});
  const h=harness({requestTimeoutMs:1000,runTimeoutMs:10000,transport(_side,message){
    if(message.type==='RESUME_OBSERVATION')return{ok:true,resumed:true};
  }});t.after(()=>h.coordinator.dispose());
  await begin(h);await until(()=>h.prompts().length===1);await pause();
  const original=h.prompts()[0];
  const deadline=(await h.coordinator.getState()).pending.boss.deadline;
  // Advance Date alone: the bridge receipt wins the race with the host timer.
  t.mock.timers.setTime(deadline);
  const receipt=await h.coordinator.pageEvent('boss',{type:'ERROR',runId:original.message.runId,requestId:original.message.requestId,
    observationLost:true,error:'Timed out waiting for the ChatGPT page.'});
  assert.notEqual(receipt.ignored,true);
  await until(()=>h.sent.some(call=>call.message.type==='RESUME_OBSERVATION'));
  const observer=h.sent.find(call=>call.message.type==='RESUME_OBSERVATION');
  assert.equal(observer.message.timeoutMs,10000-1000,'The renewed observation remains bounded by the workflow cap.');
  assert.equal(observer.message.text,original.message.text);
  assert.equal(h.prompts().length,1);
  assert.equal(h.sent.some(call=>call.message.type==='CANCEL'),false);
});

test('an exact completed reply at an elapsed observation budget is retained until the workflow hard cap', async t=>{
  t.mock.timers.enable({apis:['Date','setTimeout'],now:Date.UTC(2026,9,7)});
  const h=harness({requestTimeoutMs:1000,runTimeoutMs:10000});t.after(()=>h.coordinator.dispose());
  const [left,right]=await pendingWorkerPair(h);
  t.mock.timers.setTime((await h.coordinator.getState()).pending.left.deadline);
  assert.notEqual((await h.reply(left,'Actual complete result at the observation boundary.')).ignored,true);
  assert.notEqual((await h.reply(right,'Actual independent complete peer result.')).ignored,true);
  assert.equal((await h.coordinator.getState()).workerResults.length,2);
  assert.equal((await h.coordinator.getState()).round,1);
});
