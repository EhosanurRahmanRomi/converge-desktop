'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { installCoordinator, initialState } = require('../background');

const source = (name = 'worksheet.pdf', bytes = Buffer.from('ORIGINAL: every problem, subpart, given input and initial condition.')) => ({
  name, mimeType: 'application/pdf', base64: bytes.toString('base64'),
});
const accept = candidateId => ({ candidateId, verdict: 'accept', issues: [], revisedAnswer: '',
  resolvedIssueIds: [], uncertainties: [], checks: ['Checked all original source subparts.', 'Recomputed the source inputs with their original units.'] });

function harness(t, { blockReviewExport = false, failInitialSide, failReviewUpload = false } = {}) {
  const initial = initialState(); initial.status = 'setup'; initial.chatMode = 'normal'; initial.tabIds = { left: 10, right: 11 };
  const stored = { convergeState: initial }, sent = [], typed = [], exported = new Map();
  let listener, releaseExport, exportCount = 0;
  const chrome = {
    runtime: { onMessage: { addListener(fn) { listener = fn; } }, onInstalled: { addListener() {} } },
    sidePanel: { async setPanelBehavior() {} },
    storage: { session: { async get(key) { return { [key]: structuredClone(stored[key]) }; },
      async set(value) { Object.assign(stored, structuredClone(value)); } } },
    tabs: { async get(id) { return { id, url: 'https://chatgpt.com/' }; }, async sendMessage(id, message) {
      sent.push({ id, message: structuredClone(message) });
      if (message.type === 'UPLOAD_FILES') return id === failInitialSide ? { ok: false, error: 'Source upload failed.' } : { ok: true, attached: message.files.length };
      if (message.type === 'EXPORT_MEDIA') {
        exportCount++;
        const files = message.ids.map(key => structuredClone(exported.get(key)));
        if (blockReviewExport && exportCount === 3) return new Promise(resolve => { releaseExport = () => resolve({ ok: true, files }); });
        return { ok: true, files };
      }
      if (message.type === 'SEND_PROMPT') {
        if (failReviewUpload && message.files?.some(file => file.name.startsWith('ORIGINAL_SOURCE_'))) {
          // The page bridge reports the partial upload and does not type/Send.
          return { ok: false, error: 'Only one of the two review attachments uploaded. Prompt was not sent.' };
        }
        typed.push({ id, message: structuredClone(message) });
      }
      return { ok: true, ready: true, authenticated: true, busy: false, temporary: true, unpersonalized: true };
    }, onRemoved: { addListener() {} }, onUpdated: { addListener() {} } },
    alarms: { async create() {}, async clear() {}, onAlarm: { addListener() {} } },
  };
  installCoordinator(chrome);
  const send = (message, id) => new Promise(resolve => listener(message, id ? { tab: { id, url: 'https://chatgpt.com/' } } : {}, resolve));
  const settle = () => new Promise(resolve => setImmediate(resolve));
  const wait = async condition => { for (let count = 0; count < 100 && !condition(); count++) await settle(); assert.ok(condition(), 'Expected coordinator transition did not happen.'); };
  const prompts = () => typed.filter(call => call.message.type === 'SEND_PROMPT');
  const output = (name, bytes = Buffer.from(`generated complete candidate: ${name}`)) => {
    const meta = { id: name, name, mimeType: 'application/pdf', fingerprint: name };
    exported.set(name, { ...meta, base64: bytes.toString('base64'), byteLength: bytes.length,
      contentSha256: createHash('sha256').update(bytes).digest('hex') });
    return meta;
  };
  const reply = async (call, value, files) => {
    const response = await send({ type: 'REPLY', runId: call.message.runId, requestId: call.message.requestId,
      text: typeof value === 'string' ? value : JSON.stringify(value), ...(files ? { media: files } : {}) }, call.id);
    await settle(); return response;
  };
  const attach = files => send({ type: 'ATTACH_FILES', files });
  const start = async ({ files = true } = {}) => {
    const result = await send({ type: 'START', question: files ? 'Correct every problem and subpart in the original PDF.' : 'Explain a different procedure.',
      reviewMode: 'improve', maxRounds: 4, relayMedia: true, requireFiles: files });
    await settle(); return result;
  };
  const drafts = async ({ left = 'worksheet.pdf', right = 'independent.pdf', bytes } = {}) => {
    const [first, second] = prompts().slice(-2);
    await reply(first, 'A complete initial PDF.', [output(left, bytes)]);
    await reply(second, 'An independent complete PDF.', [output(right, bytes)]);
    await wait(() => stored.convergeState.phase === 'review' || stored.convergeState.status === 'error');
    await settle();
  };
  t.after(async () => { releaseExport?.(); await send({ type: 'STOP' }); });
  return { stored, sent, typed, send, settle, wait, prompts, output, reply, attach, start, drafts,
    releaseExport: () => releaseExport?.(), exportCount: () => exportCount };
}

test('every fresh review receives the original bytes and exact candidate, with different source provenance names', async t => {
  const h = harness(t), original = source();
  assert.equal((await h.attach([original])).ok, true);
  assert.doesNotMatch(JSON.stringify(h.stored), /base64|T1JJR0lOQUw/);
  await h.start();
  assert.ok(h.prompts().slice(0, 2).every(call => call.message.files === undefined), 'drafts consume the original upload without duplicating it');
  await h.drafts(); await h.wait(() => h.prompts().length === 3);
  await h.wait(() => h.stored.convergeState.lastTransfer?.requestId === h.prompts().at(-1).message.requestId);
  const firstReview = h.prompts().at(-1);
  assert.deepEqual(h.stored.convergeState.lastTransfer, { runId: firstReview.message.runId,
    requestId: firstReview.message.requestId, from: 'left', to: 'right', candidateId: 'C1', hasFiles: true });
  for (let i = 0; i < 8; i++) {
    const review = h.prompts().at(-1), files = review.message.files;
    assert.deepEqual(files.map(file => file.name), ['ORIGINAL_SOURCE_1__worksheet.pdf', 'worksheet.pdf']);
    assert.equal(files[0].base64, original.base64);
    assert.notEqual(files[1].base64, original.base64);
    assert.match(review.message.text, /worksheet.pdf -> ORIGINAL_SOURCE_1__worksheet.pdf/);
    assert.match(review.message.text, /fresh byte-identical copies/);
    assert.match(review.message.text, /transcribe the original source inputs, units, initial conditions/);
    assert.match(review.message.text, /finite-time versus equilibrium/);
    assert.match(review.message.text, /kinetic-energy versus total-energy/);
    assert.doesNotMatch(JSON.stringify(h.stored), /base64|T1JJR0lOQUw/);
    await h.reply(review, accept('C1'));
    if (i < 7) await h.wait(() => h.prompts().length === 4 + i);
  }
  assert.equal(h.stored.convergeState.status, 'agreed');
  assert.equal(h.stored.convergeState.round, 4);
});

test('substantive creation refreshes the ORIGINAL and exact candidate bytes and replacement gets fresh dual checks', async t => {
  const h = harness(t), original = source(); await h.attach([original]); await h.start(); await h.drafts();
  await h.wait(() => h.prompts().length === 3);
  const candidateMedia = structuredClone(h.stored.convergeState.candidate.media);
  const exportsBefore = h.exportCount();
  await h.reply(h.prompts().at(-1), { ...accept('C1'), verdict: 'challenge',
    issues: [{ severity: 'major', problem: 'The original initial condition was not used.', evidence: 'The candidate assumed equilibrium.', correction: 'Solve the finite-time source condition.' }],
    revisedAnswer: 'I corrected the complete PDF.' });
  await h.wait(() => h.prompts().length === 4);
  const creation = h.prompts().at(-1);
  assert.deepEqual(creation.message.files, [{ ...original, name: 'ORIGINAL_SOURCE_1__worksheet.pdf' },
    source('worksheet.pdf', Buffer.from('generated complete candidate: worksheet.pdf'))]);
  assert.equal(h.exportCount(), exportsBefore + 1);
  const freshExport = h.sent.filter(call => call.message.type === 'EXPORT_MEDIA').at(-1);
  assert.equal(freshExport.message.runId, candidateMedia.runId);
  assert.equal(freshExport.message.requestId, candidateMedia.requestId);
  assert.deepEqual(h.stored.convergeState.candidate.media, candidateMedia);
  assert.match(creation.message.text, /fresh byte-identical copies/);
  assert.match(creation.message.text, /original initial condition/); assert.match(creation.message.text, /No JSON is required/);
  await h.reply(creation, 'Created the complete corrected PDF with all original subparts.', [h.output('corrected.pdf')]);
  await h.wait(() => h.stored.convergeState.candidate?.id === 'C2' && h.prompts().length === 5);
  assert.deepEqual(h.stored.convergeState.acceptedBy, {});
  assert.deepEqual(h.prompts().at(-1).message.files.map(file => file.name), ['ORIGINAL_SOURCE_1__worksheet.pdf', 'corrected.pdf']);
  await h.reply(h.prompts().at(-1), { ...accept('C2'), resolvedIssueIds: h.stored.convergeState.issues.map(issue => issue.id) });
  await h.wait(() => h.prompts().length === 6);
  assert.equal(h.stored.convergeState.improvementTrail[0].verified, false);
  await h.reply(h.prompts().at(-1), accept('C2')); await h.wait(() => h.prompts().length === 7);
  assert.equal(h.stored.convergeState.improvementTrail[0].verified, false, 'the next-round check cannot reuse an earlier round acceptance');
  await h.reply(h.prompts().at(-1), accept('C2')); await h.wait(() => h.prompts().length === 8);
  assert.equal(h.stored.convergeState.improvementTrail[0].verified, true);
});

test('draft production recovery refreshes the original bytes while preserving the one-followup deadline', async t => {
  const h = harness(t), original = source(); await h.attach([original]); await h.start();
  const left = h.prompts()[0], deadline = h.stored.convergeState.pending.left.deadline;
  await h.reply(left, 'I described the PDF but did not create it.'); await h.wait(() => h.prompts().length === 3);
  const creation = h.prompts().at(-1);
  assert.deepEqual(creation.message.files, [{ ...original, name: 'ORIGINAL_SOURCE_1__worksheet.pdf' }]);
  assert.match(creation.message.text, /fresh byte-identical copies/);
  assert.equal(h.stored.convergeState.pending.left.deadline, deadline);
});

test('Stop wins while a review candidate export is blocked and no retained original is sent afterward', async t => {
  const h = harness(t, { blockReviewExport: true }); await h.attach([source()]); await h.start(); await h.drafts();
  await h.wait(() => h.exportCount() === 3);
  assert.equal((await h.send({ type: 'STOP' })).state.status, 'stopped');
  h.releaseExport(); await h.settle(); await h.settle();
  assert.equal(h.prompts().length, 2); assert.deepEqual(h.stored.convergeState.pending, {});
  assert.equal(h.stored.convergeState.lastTransfer, null);
  await h.start({ files: false });
  assert.deepEqual(h.stored.convergeState.sourceNames, []);
  assert.ok(h.prompts().slice(-2).every(call => !call.message.files && !/ORIGINAL_SOURCE/.test(call.message.text)));
});

test('a new command on the same chat pair does not inherit originals from the preceding finished task', async t => {
  const h = harness(t); await h.attach([source()]); await h.start(); await h.drafts(); await h.wait(() => h.prompts().length === 3);
  for (let i = 0; i < 8; i++) {
    await h.reply(h.prompts().at(-1), accept('C1'));
    if (i < 7) await h.wait(() => h.prompts().length === 4 + i);
  }
  await h.start({ files: false }); const [left, right] = h.prompts().slice(-2);
  assert.equal(h.stored.convergeState.lastTransfer, null, 'a later question cannot inherit the preceding peer transfer');
  await h.reply(left, { answer: 'A new unrelated procedure.', uncertainties: [] });
  await h.reply(right, { answer: 'An independent new procedure.', uncertainties: [] });
  await h.wait(() => h.prompts().length === 13);
  assert.equal(h.prompts().at(-1).message.files, undefined);
  assert.doesNotMatch(h.prompts().at(-1).message.text, /worksheet.pdf|ORIGINAL_SOURCE/);
  assert.deepEqual(h.stored.convergeState.sourceNames, []);
});

test('idle Reset-through-Stop and a coordinator restart invalidate unavailable private source bytes honestly', async t => {
  const h = harness(t); await h.attach([source()]); await h.send({ type: 'STOP' });
  const stopped = await h.start();
  assert.equal(stopped.ok, false); assert.match(stopped.error, /Reattach the original files/);
  assert.equal(h.prompts().length, 0);
  await h.attach([source()]); assert.equal((await h.start()).ok, true);
  assert.equal(h.prompts().length, 2);
  const restarted = harness(t);
  restarted.stored.convergeState.attachments = { status: 'attached', names: ['worksheet.pdf'], error: '' };
  const missing = await restarted.start();
  assert.equal(missing.ok, false); assert.match(missing.error, /no longer available in this app session/);
  assert.equal(restarted.prompts().length, 0);
});

test('partial original upload cannot be consumed as a task and blocks every draft send', async t => {
  const h = harness(t, { failInitialSide: 11 }); const attached = await h.attach([source()]);
  assert.equal(attached.ok, false); assert.equal(h.stored.convergeState.attachments.status, 'partial');
  assert.equal((await h.start()).ok, false); assert.equal(h.prompts().length, 0);
});

test('a failed combined source/candidate upload stops the run without typing a review or falsely accepting', async t => {
  const h = harness(t, { failReviewUpload: true }); await h.attach([source()]); await h.start(); await h.drafts();
  await h.wait(() => h.stored.convergeState.status === 'error');
  assert.match(h.stored.convergeState.error, /Prompt was not sent/);
  assert.equal(h.prompts().length, 2); assert.deepEqual(h.stored.convergeState.acceptedBy, {});
  assert.equal(h.stored.convergeState.lastTransfer, null, 'a failed combined upload is not an acknowledged peer handoff');
  assert.equal(h.sent.filter(call => call.message.type === 'CANCEL').length, 2);
});

test('originals plus candidate exceed the combined file count honestly instead of silently dropping sources', async t => {
  const h = harness(t); await h.attach(Array.from({ length: 5 }, (_, i) => source(`source-${i}.pdf`)));
  await h.start(); await h.drafts(); await h.wait(() => h.stored.convergeState.status === 'error');
  assert.match(h.stored.convergeState.error, /Original sources plus candidate outputs exceed the review transfer limit \(5 files, 12 MB per file, 24 MB combined\)/);
  assert.equal(h.prompts().length, 2); assert.equal(h.stored.convergeState.candidate.id, 'C1');
});

test('combined source/candidate bytes stay within 24 MB even when every individual file meets 12 MB', async t => {
  const h = harness(t), max = 12 * 1024 * 1024;
  await h.attach([source('large-source.pdf', Buffer.alloc(max, 65)), source('extra-source.pdf', Buffer.from('B'))]);
  await h.start(); await h.drafts({ bytes: Buffer.alloc(max, 67) });
  await h.wait(() => h.stored.convergeState.status === 'error');
  assert.match(h.stored.convergeState.error, /Original sources plus candidate outputs exceed the review transfer limit/);
  assert.match(h.stored.convergeState.error, /24 MB combined/); assert.equal(h.prompts().length, 2);
});

test('source upload aliases preserve the extension and safe length for long original names', async t => {
  const h = harness(t), name = 'a'.repeat(176) + '.pdf'; await h.attach([source(name)]); await h.start(); await h.drafts();
  await h.wait(() => h.prompts().length === 3);
  const uploaded = h.prompts().at(-1).message.files[0].name;
  assert.ok(uploaded.startsWith('ORIGINAL_SOURCE_1__')); assert.ok(uploaded.endsWith('.pdf')); assert.equal(uploaded.length, 180);
});

test('adding another source before Start retains both original batches and limits the full composer batch', async t => {
  const h = harness(t), first = source('first.pdf'), second = source('second.pdf');
  await h.attach([first]); await h.attach([second]);
  assert.deepEqual(h.stored.convergeState.attachments.names, ['first.pdf', 'second.pdf']);
  const uploads = h.sent.filter(call => call.message.type === 'UPLOAD_FILES');
  assert.deepEqual(uploads.map(call => call.message.files.map(file => file.name)), [['first.pdf'], ['first.pdf'], ['second.pdf'], ['second.pdf']]);
  const rejected = await h.attach(Array.from({ length: 4 }, (_, i) => source(`extra-${i}.pdf`)));
  assert.equal(rejected.ok, false); assert.match(rejected.error, /1 to 5 files/);
  assert.equal(h.sent.filter(call => call.message.type === 'UPLOAD_FILES').length, uploads.length);
  await h.start(); await h.drafts(); await h.wait(() => h.prompts().length === 3);
  assert.deepEqual(h.prompts().at(-1).message.files.slice(0, 2), [
    { ...first, name: 'ORIGINAL_SOURCE_1__first.pdf' }, { ...second, name: 'ORIGINAL_SOURCE_2__second.pdf' },
  ]);
});
