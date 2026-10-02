'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { installCoordinator, initialState, draftPrompt, reviewPrompt } = require('../background');
const issue = { severity: 'major', problem: 'The supplied boundary assertion is false.',
  evidence: 'The final interval is shorter than the specified minimum.', correction: 'Fix the assertion and retain the correct function.' };
const challenge = (revisedAnswer = '', candidateId = 'C1') => ({ candidateId, verdict: 'challenge',
  issues: [issue], revisedAnswer, resolvedIssueIds: [], uncertainties: [] });
const accept = (candidateId, resolvedIssueIds = []) => ({ candidateId, verdict: 'accept', issues: [],
  revisedAnswer: '', resolvedIssueIds, uncertainties: [] });
const pdf = { id: 'pdf1', name: 'candidate.pdf', mimeType: 'application/pdf', fingerprint: 'pdf-original-v1' };

function harness(t) {
  const state = initialState(); state.status = 'setup'; state.tabIds = { left: 10, right: 11 };
  const stored = { convergeState: state }, sent = [];
  let listener, alarmListener, blockDispatch = false, resume;
  const chrome = {
    runtime: { onMessage: { addListener(fn) { listener = fn; } }, onInstalled: { addListener() {} } },
    sidePanel: { async setPanelBehavior() {} },
    storage: { session: {
      async get(key) {
        if (blockDispatch) { blockDispatch = false; await new Promise((resolve) => { resume = resolve; }); }
        return { [key]: structuredClone(stored[key]) };
      },
      async set(value) { Object.assign(stored, structuredClone(value)); },
    } },
    tabs: {
      async get(id) { return { id, url: 'https://chatgpt.com/' }; },
      async sendMessage(id, message) {
        sent.push({ id, message: structuredClone(message) });
        if (message.type === 'INSPECT' || message.type === 'PREPARE') return {
          ok: true, ready: true, authenticated: true, temporary: true, unpersonalized: true, busy: false,
        };
        if (message.type === 'EXPORT_MEDIA') return { ok: true, files: [{ ...pdf, base64: 'YQ==' }] };
        return { ok: true };
      },
      onRemoved: { addListener() {} }, onUpdated: { addListener() {} },
    },
    alarms: { async clear() {}, async create() {}, onAlarm: { addListener(fn) { alarmListener = fn; } } },
  };
  installCoordinator(chrome);
  const send = (message, id) => new Promise((resolve) => listener(message,
    id ? { tab: { id, url: 'https://chatgpt.com/' } } : {}, resolve));
  const reply = (request, value, extra = {}) => send({ type: 'REPLY', runId: request.message.runId,
    requestId: request.message.requestId, text: typeof value === 'string' ? value : JSON.stringify(value), ...extra }, request.id);
  const prompts = () => sent.filter(({ message }) => message.type === 'SEND_PROMPT');
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  const startReview = async ({ media = false, requireFiles = false } = {}) => {
    assert.equal((await send({ type: 'START', question: requireFiles ? 'Correct this PDF.' : 'Repair the complete code answer.',
      maxRounds: 4, confirmTemporary: true, relayMedia: media, requireFiles })).ok, true);
    await settle();
    const [left, right] = prompts();
    await reply(left, { answer: 'A correct function with an incorrect supplied test.', uncertainties: [] }, media ? { media: [pdf] } : {});
    await reply(right, { answer: 'Independent code analysis.', uncertainties: [] }, media ? { media: [pdf] } : {});
    await settle();
    return prompts().at(-1);
  };
  t.after(async () => { resume?.(); if (stored.convergeState.status === 'running') await send({ type: 'STOP' }); });
  return { stored, sent, send, reply, prompts, settle, startReview,
    async runWatchdog() { alarmListener({ name: 'converge-watchdog' }); return send({ type: 'GET_STATE' }); },
    blockCorrectionDispatch() {
      const originalSet = chrome.storage.session.set;
      chrome.storage.session.set = async (value) => {
        await originalSet(value);
        if (Object.values(value.convergeState.pending).some((pending) => pending.substantiveCorrectionAttempts === 1)) {
          blockDispatch = true; chrome.storage.session.set = originalSet;
        }
      };
    },
    resume() { resume?.(); },
  };
}

test('prompts require completed challenge corrections and exclude unrelated earlier requirements', () => {
  const state = initialState(); state.question = 'Repair the code.'; state.candidate = { id: 'C1', text: 'code' };
  for (const prompt of [draftPrompt(state, 'left'), reviewPrompt(state, 'right')]) {
    assert.match(prompt, /Do not carry requirements from unrelated earlier tasks/);
  }
  assert.match(reviewPrompt(state, 'right'), /must include the entire corrected answer in revisedAnswer/);
});

test('issue-only challenge requests one same-reviewer correction and both reviewers must check the resulting C2', async (t) => {
  const h = harness(t), review = await h.startReview();
  const originalDeadline = h.stored.convergeState.pending.right.deadline;
  await h.reply(review, challenge()); await h.settle();
  const correction = h.prompts().at(-1);
  assert.equal(correction.id, review.id);
  assert.notEqual(correction.message.requestId, review.message.requestId);
  assert.match(correction.message.text, /Phase: substantive correction followup/);
  assert.match(correction.message.text, /not a JSON formatting retry/);
  assert.match(correction.message.text, /complete corrected answer in revisedAnswer/);
  assert.equal(h.stored.convergeState.round, 1);
  assert.equal(h.stored.convergeState.candidate.id, 'C1');
  assert.equal(h.stored.convergeState.pending.right.deadline, originalDeadline);
  assert.equal(h.stored.convergeState.pending.right.substantiveCorrectionAttempts, 1);
  assert.equal(h.stored.convergeState.pending.right.candidateId, 'C1');
  assert.equal(h.stored.convergeState.issues[0].id, 'I1');
  assert.deepEqual(h.stored.convergeState.acceptedBy, {});
  // Neither the preceding request nor its late error can supersede this request.
  await h.reply(review, accept('C1'));
  await h.send({ type: 'ERROR', runId: review.message.runId, requestId: review.message.requestId, error: 'stale failure' }, review.id);
  assert.equal(h.stored.convergeState.pending.right.requestId, correction.message.requestId);
  await h.reply(correction, challenge('The complete corrected implementation, examples, and tests.')); await h.settle();
  assert.equal(h.stored.convergeState.candidate.id, 'C2');
  assert.deepEqual(h.stored.convergeState.acceptedBy, {});
  const leftReview = h.prompts().at(-1);
  assert.equal(leftReview.id, 10); assert.match(leftReview.message.text, /Current candidate ID: C2/);
  await h.reply(leftReview, accept('C2', ['I1'])); await h.settle();
  assert.equal(h.stored.convergeState.status, 'running');
  assert.deepEqual(h.stored.convergeState.acceptedBy, { left: 'C2' });
  const rightReview = h.prompts().at(-1);
  assert.equal(rightReview.id, 11); assert.match(rightReview.message.text, /Current candidate ID: C2/);
  await h.reply(rightReview, accept('C2'));
  assert.equal(h.stored.convergeState.status, 'agreed');
  assert.deepEqual(h.stored.convergeState.acceptedBy, { left: 'C2', right: 'C2' });
  assert.equal(h.prompts().filter(({ message }) => /Phase: substantive correction followup/.test(message.text)).length, 1);
});

test('another empty, unchanged, or unsupported accept correction fails without a followup loop', async (t) => {
  for (const response of [challenge(), challenge('A correct function with an incorrect supplied test.'), accept('C1')]) {
    const h = harness(t), review = await h.startReview();
    await h.reply(review, challenge()); await h.settle();
    await h.reply(h.prompts().at(-1), response); await h.settle();
    assert.equal(h.stored.convergeState.status, 'error');
    assert.match(h.stored.convergeState.error, /after one substantive correction followup/);
    assert.equal(h.prompts().length, 4);
    assert.equal(h.stored.convergeState.candidate.id, 'C1');
    assert.deepEqual(h.stored.convergeState.acceptedBy, {});
  }
});

test('Stop prevents a delayed substantive correction dispatch and late correction acceptance', async (t) => {
  const h = harness(t), review = await h.startReview();
  h.blockCorrectionDispatch();
  const response = await h.reply(review, challenge());
  const pending = response.state.pending.right;
  assert.equal((await h.send({ type: 'STOP' })).state.status, 'stopped');
  h.resume(); await h.settle();
  assert.equal(h.prompts().length, 3);
  await h.reply({ id: 11, message: { runId: review.message.runId, requestId: pending.requestId } }, challenge('Late corrected text.'));
  assert.equal(h.stored.convergeState.status, 'stopped');
  assert.equal(h.stored.convergeState.candidate.id, 'C1');
  assert.deepEqual(h.stored.convergeState.pending, {});
});

test('original run/request deadlines block correction dispatch or a late complete replacement', async (t) => {
  for (const atCorrection of [false, true]) for (const field of ['run', 'request']) {
    const h = harness(t), review = await h.startReview();
    let request = review;
    if (atCorrection) { await h.reply(review, challenge()); await h.settle(); request = h.prompts().at(-1); }
    if (field === 'run') h.stored.convergeState.deadline = Date.now() - 1;
    else h.stored.convergeState.pending.right.deadline = Date.now() - 1;
    await h.reply(request, atCorrection ? challenge('Complete late replacement.') : challenge()); await h.settle();
    assert.equal(h.stored.convergeState.status, 'limit_reached');
    assert.equal(h.stored.convergeState.candidate.id, 'C1');
    assert.deepEqual(h.stored.convergeState.acceptedBy, {});
    assert.equal(h.prompts().length, atCorrection ? 4 : 3);
  }
});

test('a correction waiting on committed storage never dispatches after its original deadline expires', async (t) => {
  for (const field of ['run', 'request']) {
    const h = harness(t), review = await h.startReview();
    h.blockCorrectionDispatch();
    await h.reply(review, challenge());
    // The correction has been committed, but delivery is still awaiting its
    // storage read. Expiring either deadline must prevent the page send.
    if (field === 'run') h.stored.convergeState.deadline = Date.now() - 1;
    else h.stored.convergeState.pending.right.deadline = Date.now() - 1;
    h.resume(); await h.settle();
    assert.equal(h.prompts().length, 3);
    await h.runWatchdog();
    assert.equal(h.stored.convergeState.status, 'limit_reached');
    assert.equal(h.prompts().length, 3);
    assert.deepEqual(h.stored.convergeState.pending, {});
  }
});

test('candidate file ownership survives issue-only correction with a fresh exact upload to that reviewer', async (t) => {
  const h = harness(t), review = await h.startReview({ media: true });
  const originalMedia = structuredClone(h.stored.convergeState.candidate.media);
  const exports = h.sent.filter(({ message }) => message.type === 'EXPORT_MEDIA').length;
  assert.ok(review.message.files);
  await h.reply(review, challenge()); await h.settle();
  const correction = h.prompts().at(-1);
  assert.deepEqual(correction.message.files, [{ name: pdf.name, mimeType: pdf.mimeType, base64: 'YQ==' }]);
  assert.equal(correction.id, review.id);
  assert.equal(h.sent.filter(({ message }) => message.type === 'EXPORT_MEDIA').length, exports + 1);
  const correctionExport = h.sent.filter(({ message }) => message.type === 'EXPORT_MEDIA').at(-1);
  assert.equal(correctionExport.message.requestId, originalMedia.requestId);
  assert.equal(correctionExport.message.runId, originalMedia.runId);
  assert.match(correction.message.text, /fresh byte-identical copies/i);
  assert.deepEqual(h.stored.convergeState.candidate.media, originalMedia);
  await h.reply(correction, challenge('Corrected accompanying explanation; original attachment is unchanged.')); await h.settle();
  assert.equal(h.stored.convergeState.candidate.id, 'C2');
  assert.deepEqual(h.stored.convergeState.candidate.media, originalMedia);
  assert.deepEqual(h.stored.convergeState.acceptedBy, {});
  const laterExport = h.sent.filter(({ message }) => message.type === 'EXPORT_MEDIA').at(-1);
  assert.equal(laterExport.message.requestId, originalMedia.requestId);
  assert.equal(laterExport.message.runId, originalMedia.runId);
});

test('a corrected PDF cannot be replaced with text alone during the substantive followup', async (t) => {
  const h = harness(t), review = await h.startReview({ media: true, requireFiles: true });
  const original = structuredClone(h.stored.convergeState.candidate);
  await h.reply(review, challenge()); await h.settle();
  await h.reply(h.prompts().at(-1), challenge('A prose claim that the PDF is corrected.')); await h.settle();
  assert.equal(h.stored.convergeState.status, 'error');
  assert.match(h.stored.convergeState.error, /required corrected PDF after one substantive correction/);
  assert.deepEqual(h.stored.convergeState.candidate, original);
  assert.deepEqual(h.stored.convergeState.acceptedBy, {});
});

test('formatting repair preserves the correction limit; valid empty or wrong-candidate repair cannot accept', async (t) => {
  for (const response of [challenge(), challenge('Complete corrected answer.', 'C99')]) {
    const h = harness(t), review = await h.startReview();
    await h.reply(review, challenge()); await h.settle();
    const correction = h.prompts().at(-1);
    await h.reply(correction, '{malformed'); await h.settle();
    const formatting = h.prompts().at(-1);
    assert.match(formatting.message.text, /Phase: formatting repair/);
    assert.equal(h.stored.convergeState.pending.right.substantiveCorrectionAttempts, 1);
    assert.equal(h.stored.convergeState.pending.right.formattingRepairAttempts, 1);
    await h.reply(formatting, response); await h.settle();
    assert.equal(h.stored.convergeState.status, 'error');
    assert.match(h.stored.convergeState.error, /substantive correction followup|different candidate/);
    assert.equal(h.prompts().length, 5);
    assert.deepEqual(h.stored.convergeState.acceptedBy, {});
  }
});
