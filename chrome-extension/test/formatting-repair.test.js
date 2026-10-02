'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { installCoordinator, initialState, draftPrompt, reviewPrompt, parseReview } = require('../background');

const ready = { ok: true, ready: true, authenticated: true, temporary: true, unpersonalized: true, busy: false };
const accepted = (candidateId = 'C1') => ({ candidateId, verdict: 'accept', issues: [], revisedAnswer: '',
  resolvedIssueIds: [], uncertainties: [] });
const missingCorrections = () => ({ ...accepted(), verdict: 'challenge', revisedAnswer: 'Complete revised implementation.',
  issues: [
    { severity: 'critical', problem: 'An invalid input bypasses validation.', evidence: 'Input null reaches property access instead of the required ValueError.' },
    { severity: 'major', problem: 'The empty case returns the wrong type.', evidence: 'An empty list returns null instead of an empty list.' },
  ], checks: ['Traced the null input.', 'Traced the empty list.'],
  improvements: [{ change: 'Correct validation and the empty return.', benefit: 'Both specified boundary cases behave correctly.', evidence: 'The complete revised code handles both cases.' }],
});
const correctedReport = (original = missingCorrections()) => ({ ...original, issues: original.issues.map((issue, index) => ({
  ...issue, correction: index === 0 ? 'Reject null with ValueError before reading properties.' : 'Return an empty list for an empty input.',
})) });

function harness(t) {
  const initial = initialState();
  initial.status = 'setup'; initial.tabIds = { left: 10, right: 11 };
  const stored = { convergeState: initial };
  const sent = [];
  let listener;
  let blockNextDispatch = false;
  let resumeDispatch;
  const chrome = {
    runtime: { onMessage: { addListener(value) { listener = value; } }, onInstalled: { addListener() {} } },
    sidePanel: { async setPanelBehavior() {} },
    storage: { session: {
      async get(key) {
        if (blockNextDispatch) {
          blockNextDispatch = false;
          await new Promise((resolve) => { resumeDispatch = resolve; });
        }
        return { [key]: structuredClone(stored[key]) };
      },
      async set(value) { Object.assign(stored, structuredClone(value)); },
    } },
    tabs: {
      async get(id) { return { id, url: 'https://chatgpt.com/' }; },
      async sendMessage(id, message) {
        sent.push({ id, message: structuredClone(message) });
        if (message.type === 'INSPECT' || message.type === 'PREPARE') return ready;
        if (message.type === 'EXPORT_MEDIA') return { ok: true, files: [{ id: 'pdf1', name: 'result.pdf',
          mimeType: 'application/pdf', fingerprint: 'pdf-v1', base64: 'YQ==' }] };
        return { ok: true };
      },
      onRemoved: { addListener() {} }, onUpdated: { addListener() {} },
    },
    alarms: { async clear() {}, async create() {}, onAlarm: { addListener() {} } },
  };
  installCoordinator(chrome);
  const send = (message, tabId) => new Promise((resolve) => listener(message,
    tabId ? { tab: { id: tabId, url: 'https://chatgpt.com/' } } : {}, resolve));
  const reply = (request, text, extra = {}) => send({ type: 'REPLY', runId: request.message.runId,
    requestId: request.message.requestId, text, ...extra }, request.id);
  const prompts = () => sent.filter(({ message }) => message.type === 'SEND_PROMPT');
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  const start = async (options = {}) => {
    const result = await send({ type: 'START', question: 'Write and test a Python function.',
      maxRounds: 4, confirmTemporary: true, ...options });
    assert.equal(result.ok, true); await settle();
    assert.equal(prompts().length, 2);
    return prompts();
  };
  t.after(async () => {
    resumeDispatch?.();
    if (stored.convergeState.status === 'running') await send({ type: 'STOP' });
  });
  return { stored, sent, send, reply, prompts, settle, start,
    blockRepairDispatch() {
      const originalSet = chrome.storage.session.set;
      chrome.storage.session.set = async (value) => {
        await originalSet(value);
        if (Object.values(value.convergeState.pending).some((pending) => pending.formattingRepairAttempts === 1)) {
          blockNextDispatch = true;
          chrome.storage.session.set = originalSet;
        }
      };
    },
    resumeDispatch() { resumeDispatch?.(); },
  };
}

test('prompts instruct correct JSON encoding of code quotes, backslashes, and newlines', () => {
  const state = initialState(); state.question = 'Return Python code.';
  state.candidate = { id: 'C1', text: 'code' };
  for (const prompt of [draftPrompt(state, 'left'), reviewPrompt(state, 'right')]) {
    assert.match(prompt, /Escape double quotes, backslashes, and control characters/);
    assert.match(prompt, /encoding line breaks as \\n/);
  }
  assert.match(reviewPrompt(state, 'right'), /specific failing input, the expected result independently derived/);
  assert.match(reviewPrompt(state, 'right'), /Distinguish missing tests or maintainability concerns/);
});

test('only malformed fields of existing issue objects are classified as repairable schema errors', () => {
  assert.throws(() => parseReview(JSON.stringify(missingCorrections()), 'C1'), (error) =>
    error.code === 'REPLY_JSON_SCHEMA' && /issues\[0\]: correction; issues\[1\]: correction/.test(error.message));
  const badFields = correctedReport(); badFields.issues[0].severity = 'urgent'; badFields.issues[1].evidence = null;
  assert.throws(() => parseReview(JSON.stringify(badFields), 'C1'), (error) =>
    error.code === 'REPLY_JSON_SCHEMA' && /severity/.test(error.message) && /evidence/.test(error.message));
  for (const report of [{ ...missingCorrections(), candidateId: 'C99' },
    { ...missingCorrections(), verdict: 'approved' }, { ...accepted(), issues: [null] }, { ...accepted(), issues: undefined }]) {
    assert.throws(() => parseReview(JSON.stringify(report), 'C1'), (error) => !error.code);
  }
});

test('missing correction fields get one same-candidate repair, preserve the full ledger, then require fresh reviews', async (t) => {
  const h = harness(t); const [left, right] = await h.start();
  for (const request of [left, right]) await h.reply(request, JSON.stringify({ answer: 'Initial implementation.', uncertainties: [] }));
  await h.settle(); const review = h.prompts().at(-1);
  const originalDeadline = h.stored.convergeState.pending.right.deadline;
  const original = missingCorrections(); const raw = JSON.stringify(original);
  await h.reply(review, raw); await h.settle(); const repair = h.prompts().at(-1);
  assert.equal(h.stored.convergeState.status, 'running');
  assert.equal(repair.id, review.id);
  assert.notEqual(repair.message.requestId, review.message.requestId);
  assert.equal(h.stored.convergeState.pending.right.candidateId, 'C1');
  assert.equal(h.stored.convergeState.pending.right.deadline, originalDeadline);
  assert.equal(h.stored.convergeState.pending.right.formattingRepairAttempts, 1);
  assert.deepEqual(h.stored.convergeState.pending.right.schemaReview, original);
  assert.match(repair.message.text, /issues\[0\]: correction; issues\[1\]: correction/);
  assert.match(repair.message.text, /Supply an actual correction suggestion grounded in the existing finding/);
  assert.ok(repair.message.text.includes(raw));
  assert.equal(repair.message.files, undefined);
  assert.deepEqual(h.stored.convergeState.issues, []);
  assert.deepEqual(h.stored.convergeState.acceptedBy, {});
  await h.reply(review, JSON.stringify(correctedReport()));
  assert.equal(h.stored.convergeState.candidate.id, 'C1');
  await h.reply(repair, JSON.stringify(correctedReport())); await h.settle();
  assert.equal(h.stored.convergeState.candidate.id, 'C2');
  assert.equal(h.stored.convergeState.candidate.text, original.revisedAnswer);
  assert.deepEqual(h.stored.convergeState.acceptedBy, {});
  assert.deepEqual(h.stored.convergeState.issues.map(({ severity, problem, evidence, correction }) => ({ severity, problem, evidence, correction })), correctedReport().issues);
  assert.ok(h.stored.convergeState.issues.every((issue) => !issue.resolved));
  assert.equal(h.prompts().at(-1).id, 10);
  await h.reply(h.prompts().at(-1), JSON.stringify({ ...accepted('C2'), resolvedIssueIds: ['I1', 'I2'] })); await h.settle();
  assert.equal(h.stored.convergeState.status, 'running');
  assert.deepEqual(h.stored.convergeState.acceptedBy, { left: 'C2' });
  await h.reply(h.prompts().at(-1), JSON.stringify(accepted('C2')));
  assert.equal(h.stored.convergeState.status, 'agreed');
  assert.deepEqual(h.stored.convergeState.acceptedBy, { left: 'C2', right: 'C2' });
  assert.ok(h.stored.convergeState.issues.every((issue) => issue.resolved));
  assert.equal(h.prompts().length, 6);
});

test('a schema retry cannot erase findings, change existing review fields, or invent acceptance', async (t) => {
  const changes = [
    ['dropped issue', (report) => { report.issues.pop(); }],
    ['accept verdict', (report) => { report.verdict = 'accept'; }],
    ['evidence', (report) => { report.issues[0].evidence = 'The issue is now checked successfully.'; }],
    ['severity', (report) => { report.issues[0].severity = 'minor'; }],
    ['revised answer', (report) => { report.revisedAnswer = 'A different answer.'; }],
    ['checks', (report) => { report.checks = ['A different successful check.']; }],
    ['uncertainty', (report) => { report.uncertainties = []; }],
    ['empty correction', (report) => { report.issues[0].correction = ' '; }],
  ];
  for (const [name, change] of changes) await t.test(name, async (t) => {
    const h = harness(t); const [left, right] = await h.start();
    for (const request of [left, right]) await h.reply(request, JSON.stringify({ answer: 'Initial implementation.', uncertainties: [] }));
    await h.settle(); const original = missingCorrections(); original.uncertainties = ['External dependency not checked.'];
    await h.reply(h.prompts().at(-1), JSON.stringify(original)); await h.settle();
    const repaired = correctedReport(original); change(repaired);
    await h.reply(h.prompts().at(-1), JSON.stringify(repaired)); await h.settle();
    assert.equal(h.stored.convergeState.status, 'error');
    assert.match(h.stored.convergeState.error, /schema repair/);
    assert.equal(h.stored.convergeState.candidate.id, 'C1');
    assert.deepEqual(h.stored.convergeState.acceptedBy, {});
    assert.equal(h.prompts().length, 4);
  });
});

test('a second missing-field or syntax failure ends the schema retry without acceptance', async (t) => {
  for (const raw of [JSON.stringify(missingCorrections()), '{still broken']) {
    const h = harness(t); const [left, right] = await h.start();
    for (const request of [left, right]) await h.reply(request, JSON.stringify({ answer: 'Initial implementation.', uncertainties: [] }));
    await h.settle(); await h.reply(h.prompts().at(-1), JSON.stringify(missingCorrections())); await h.settle();
    await h.reply(h.prompts().at(-1), raw); await h.settle();
    assert.equal(h.stored.convergeState.status, 'error');
    assert.match(h.stored.convergeState.error, /after one formatting repair/);
    assert.deepEqual(h.stored.convergeState.pending, {});
    assert.deepEqual(h.stored.convergeState.acceptedBy, {});
    assert.equal(h.prompts().length, 4);
  }
});

test('Stop cancels a queued schema retry and its late valid report cannot change the candidate', async (t) => {
  const h = harness(t); const [left, right] = await h.start();
  for (const request of [left, right]) await h.reply(request, JSON.stringify({ answer: 'Initial implementation.', uncertainties: [] }));
  await h.settle(); const review = h.prompts().at(-1);
  h.blockRepairDispatch();
  const result = await h.reply(review, JSON.stringify(missingCorrections()));
  const repairPending = result.state.pending.right;
  await h.send({ type: 'STOP' }); h.resumeDispatch(); await h.settle();
  assert.equal(h.prompts().length, 3);
  await h.reply({ id: 11, message: { runId: review.message.runId, requestId: repairPending.requestId } }, JSON.stringify(correctedReport()));
  assert.equal(h.stored.convergeState.status, 'stopped');
  assert.equal(h.stored.convergeState.candidate.id, 'C1');
  assert.deepEqual(h.stored.convergeState.pending, {});
  assert.deepEqual(h.stored.convergeState.acceptedBy, {});
});

test('a repaired candidate mismatch or changed pinned candidate still fails before applying findings', async (t) => {
  for (const changedPinnedCandidate of [false, true]) {
    const h = harness(t); const [left, right] = await h.start();
    for (const request of [left, right]) await h.reply(request, JSON.stringify({ answer: 'Initial implementation.', uncertainties: [] }));
    await h.settle(); await h.reply(h.prompts().at(-1), JSON.stringify(missingCorrections())); await h.settle();
    const report = correctedReport();
    if (changedPinnedCandidate) h.stored.convergeState.candidate = { id: 'C2', text: 'Different candidate.' };
    report.candidateId = changedPinnedCandidate ? 'C2' : 'C99';
    await h.reply(h.prompts().at(-1), JSON.stringify(report)); await h.settle();
    assert.equal(h.stored.convergeState.status, 'error');
    assert.match(h.stored.convergeState.error, /different candidate|outdated candidate/);
    assert.deepEqual(h.stored.convergeState.issues, []);
    assert.deepEqual(h.stored.convergeState.acceptedBy, {});
    assert.equal(h.prompts().length, 4);
  }
});

test('an unescaped code draft gets one fresh formatting request, then two full reviews', async (t) => {
  const h = harness(t);
  const [left, right] = await h.start();
  const originalDeadline = h.stored.convergeState.pending.left.deadline;
  const malformed = '{"answer":"def checked(x):\\n    raise ValueError("bad input")","uncertainties":[]}';
  await h.reply(left, malformed); await h.settle();
  const repair = h.prompts().at(-1);
  assert.equal(h.stored.convergeState.status, 'running');
  assert.equal(repair.id, 10);
  assert.notEqual(repair.message.requestId, left.message.requestId);
  assert.match(repair.message.text, /formatting repair for the previous draft/);
  assert.match(repair.message.text, /Fix only JSON syntax and escaping/);
  assert.ok(repair.message.text.includes(malformed));
  assert.equal(h.stored.convergeState.pending.left.deadline, originalDeadline);
  assert.equal(h.stored.convergeState.pending.left.formattingRepairAttempts, 1);
  assert.equal(repair.message.expectedSourceNames, undefined);
  assert.equal(h.stored.convergeState.candidate, null);

  // The original request cannot supply the repaired reply under its old ID.
  await h.reply(left, JSON.stringify({ answer: 'stale content', uncertainties: [] }));
  assert.equal(h.stored.convergeState.drafts.left, undefined);
  await h.reply(right, JSON.stringify({ answer: 'An independent implementation.', uncertainties: [] }));
  const answer = 'def checked(x):\n    raise ValueError("bad input")';
  await h.reply(repair, JSON.stringify({ answer, uncertainties: [] })); await h.settle();
  const rightReview = h.prompts().at(-1);
  assert.equal(rightReview.id, 11);
  assert.match(rightReview.message.text, /Phase: independent review/);
  assert.equal(h.stored.convergeState.candidate.text, answer);
  assert.deepEqual(h.stored.convergeState.acceptedBy, {});
  await h.reply(rightReview, JSON.stringify(accepted())); await h.settle();
  await h.reply(h.prompts().at(-1), JSON.stringify(accepted()));
  assert.equal(h.stored.convergeState.status, 'agreed');
  assert.equal(h.stored.convergeState.answer, answer);
  assert.deepEqual(h.stored.convergeState.acceptedBy, { right: 'C1', left: 'C1' });
  assert.equal(h.stored.convergeState.transcript.filter((entry) => entry.role === 'invalid').length, 1);
  assert.equal(h.prompts().length, 5);
});

test('a review formatting request pins the candidate and does not reupload its already attached PDF', async (t) => {
  const h = harness(t);
  const [left, right] = await h.start({ relayMedia: true, requireFiles: true, question: 'Create a corrected PDF.' });
  const metadata = [{ id: 'pdf1', name: 'result.pdf', mimeType: 'application/pdf', fingerprint: 'pdf-v1' }];
  await h.reply(left, JSON.stringify({ answer: 'Corrected document.', uncertainties: [] }), { media: metadata });
  await h.reply(right, JSON.stringify({ answer: 'Independent corrected document.', uncertainties: [] }), { media: metadata });
  await h.settle();
  const review = h.prompts().at(-1);
  assert.ok(review.message.files);
  const mediaIdentity = structuredClone(h.stored.convergeState.candidate.media);
  const exportCount = h.sent.filter(({ message }) => message.type === 'EXPORT_MEDIA').length;
  await h.reply(review, '{"candidateId":"C1","verdict":"accept","issues":[],"revisedAnswer":"","resolvedIssueIds":[],"uncertainties":[],}');
  await h.settle();
  const repair = h.prompts().at(-1);
  assert.match(repair.message.text, /formatting repair for the previous review/);
  assert.match(repair.message.text, /Preserve the candidateId you actually returned/);
  assert.equal(h.stored.convergeState.pending.right.candidateId, 'C1');
  assert.equal(repair.message.files, undefined);
  assert.equal(h.sent.filter(({ message }) => message.type === 'EXPORT_MEDIA').length, exportCount);
  assert.deepEqual(h.stored.convergeState.candidate.media, mediaIdentity);
  assert.deepEqual(h.stored.convergeState.acceptedBy, {});
  await h.reply(repair, JSON.stringify(accepted())); await h.settle();
  assert.deepEqual(h.stored.convergeState.acceptedBy, { right: 'C1' });
  assert.deepEqual(h.stored.convergeState.candidate.media, mediaIdentity);
});

test('a second malformed response stops instead of entering an unbounded formatting loop', async (t) => {
  const h = harness(t); const [left] = await h.start();
  await h.reply(left, '{broken'); await h.settle();
  const repair = h.prompts().at(-1);
  await h.reply(repair, '{still broken'); await h.settle();
  assert.equal(h.stored.convergeState.status, 'error');
  assert.match(h.stored.convergeState.error, /still invalid JSON after one formatting repair/);
  assert.equal(h.prompts().length, 3);
  assert.deepEqual(h.stored.convergeState.pending, {});
  assert.deepEqual(h.stored.convergeState.acceptedBy, {});
});

test('Stop wins while a repair dispatch is pending and ignores a late repaired response', async (t) => {
  const h = harness(t); const [left] = await h.start();
  h.blockRepairDispatch();
  const result = await h.reply(left, '{broken');
  const repairPending = result.state.pending.left;
  const stopped = await h.send({ type: 'STOP' });
  assert.equal(stopped.state.status, 'stopped');
  h.resumeDispatch(); await h.settle();
  assert.equal(h.prompts().length, 2);
  await h.reply({ id: 10, message: { runId: left.message.runId, requestId: repairPending.requestId } },
    JSON.stringify({ answer: 'late answer', uncertainties: [] }));
  assert.equal(h.stored.convergeState.status, 'stopped');
  assert.equal(h.stored.convergeState.drafts.left, undefined);
  assert.deepEqual(h.stored.convergeState.pending, {});
});

test('expired run or original request deadline prevents a formatting retry', async (t) => {
  for (const field of ['run', 'request']) {
    const h = harness(t); const [left] = await h.start();
    if (field === 'run') h.stored.convergeState.deadline = Date.now() - 1;
    else h.stored.convergeState.pending.left.deadline = Date.now() - 1;
    await h.reply(left, '{broken'); await h.settle();
    assert.equal(h.stored.convergeState.status, 'limit_reached');
    assert.match(h.stored.convergeState.error, /time limit/);
    assert.equal(h.prompts().length, 2);
  }
});

test('nonrepairable schemas, invalid verdicts, and wrong candidate IDs fail without a formatting retry', async (t) => {
  for (const response of [JSON.stringify({ ...missingCorrections(), candidateId: 'C99' }),
    JSON.stringify({ ...missingCorrections(), verdict: 'approved' }), '{"candidateId":"C1","verdict":"accept"}']) {
    const h = harness(t); const [left, right] = await h.start();
    for (const request of [left, right]) await h.reply(request, JSON.stringify({ answer: 'Working code.', uncertainties: [] }));
    await h.settle(); const review = h.prompts().at(-1);
    await h.reply(review, response); await h.settle();
    assert.equal(h.stored.convergeState.status, 'error');
    assert.match(h.stored.convergeState.error, /different candidate|issues list|invalid verdict/);
    assert.equal(h.prompts().length, 3);
    assert.deepEqual(h.stored.convergeState.acceptedBy, {});
  }
});

test('a repaired wrong candidate or a changed pinned candidate cannot create acceptance', async (t) => {
  for (const changedPinnedCandidate of [false, true]) {
    const h = harness(t); const [left, right] = await h.start();
    for (const request of [left, right]) await h.reply(request, JSON.stringify({ answer: 'Working code.', uncertainties: [] }));
    await h.settle();
    await h.reply(h.prompts().at(-1), '{"candidateId":"C99","verdict":"accept",'); await h.settle();
    const repair = h.prompts().at(-1);
    if (changedPinnedCandidate) h.stored.convergeState.candidate = { id: 'C2', text: 'Different answer.' };
    await h.reply(repair, JSON.stringify(accepted(changedPinnedCandidate ? 'C2' : 'C99'))); await h.settle();
    assert.equal(h.stored.convergeState.status, 'error');
    assert.match(h.stored.convergeState.error, /different candidate|outdated candidate/);
    assert.deepEqual(h.stored.convergeState.acceptedBy, {});
    assert.equal(h.prompts().length, 4);
  }
});
