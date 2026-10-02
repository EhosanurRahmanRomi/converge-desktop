const test = require('node:test');
const assert = require('node:assert/strict');
const {
  initialState, normalizePage, validateStartPages, parseDraft, parseReview,
  draftPrompt, reviewPrompt, setCandidate, applyReview, hasAgreement, stateFingerprint,
  replyMedia, draftWithMedia, reviewWithMedia, seedDraftUncertainties, mediaFingerprint,
  hasRequiredFiles,
} = require('../background');

const accept = (candidateId, resolvedIssueIds = []) => ({
  candidateId, verdict: 'accept', issues: [], revisedAnswer: '', resolvedIssueIds, uncertainties: [],
});

test('two drafts are independent and user guidance cannot replace review rules', () => {
  const state = initialState();
  state.question = 'What is 2 + 2?';
  state.protocol = 'Use short explanations.';
  state.drafts.left = { answer: 'Four.', uncertainties: [] };
  const left = draftPrompt(state, 'left');
  const right = draftPrompt(state, 'right');
  assert.match(left, /independent draft/);
  assert.match(right, /independent draft/);
  assert.doesNotMatch(right, /Four\./);
  assert.match(right, /Do not claim 100% certainty/);
  assert.match(right, /Use short explanations/);
});

test('both pages must be ready and Temporary mode must be verified or confirmed', () => {
  const state = initialState();
  state.tabIds = { left: 10, right: 11 };
  state.pages.left = normalizePage({ ok: true, ready: true, authenticated: true, temporary: null, unpersonalized: null, busy: false });
  state.pages.right = normalizePage({ ok: true, ready: true, authenticated: true, temporary: null, unpersonalized: null, busy: false });
  assert.throws(() => validateStartPages(state, false), /Confirm/);
  assert.doesNotThrow(() => validateStartPages(state, true));
  state.pages.right.temporary = false;
  assert.throws(() => validateStartPages(state, true), /outside Temporary/);
  state.pages.right.temporary = true;
  state.pages.right.unpersonalized = true;
  state.pages.left.temporary = true;
  state.pages.left.unpersonalized = true;
  assert.doesNotThrow(() => validateStartPages(state, false));
  state.pages.left.busy = true;
  assert.throws(() => validateStartPages(state, true), /still generating/);
});

test('draft and review parsing rejects prose, mismatched candidates, and malformed accept', () => {
  assert.deepEqual(parseDraft('```json\n{"answer":"4","uncertainties":[]}\n```'), { answer: '4', uncertainties: [] });
  assert.throws(() => parseDraft('The answer is four.'), /required JSON/);
  assert.throws(() => parseReview(JSON.stringify(accept('C2')), 'C1'), /different candidate/);
  assert.throws(() => parseReview('{"candidateId":"C1","verdict":"accept"}', 'C1'), /issues list/);
  assert.throws(() => parseReview(JSON.stringify({ ...accept('C1'), issues: [{
    severity: 'minor', problem: ' \n\t ', evidence: 'An actual finding', correction: 'A correction',
  }] }), 'C1'), /issues list/);
  assert.deepEqual(parseReview(JSON.stringify(accept('C1')), 'C1'), accept('C1'));
});

test('the synthetic fourteen-check public fixture retains every check and native citation token', () => {
  const raw = require('node:fs').readFileSync(require('node:path').join(__dirname, 'fixtures', 'live-fourteen-checks-review.txt'), 'utf8');
  const checksJson = raw.match(/"checks"\s*:\s*(\[[\s\S]*?\])/)[1];
  const expectedChecks = JSON.parse(checksJson.replace(/:chatgpt-content-reference\{index="[0-9]{1,6}"\}/g,
    token => JSON.stringify(token).slice(1, -1)));
  // These assertions cover bounded parsing and preservation of the synthetic fixture;
  // the public fixture contains no live conversation or private trading source.
  const parsed = parseReview(raw, 'C1');
  assert.equal(expectedChecks.length, 14);
  assert.deepEqual(parsed.checks, expectedChecks);
  assert.equal(parsed.verdict, 'uncertain');
  assert.equal(parsed.taskEvidence.find(item => item.requirementId === 'mt5-backtest').status, 'unavailable');
  assert.match(parsed.checks[8], /:chatgpt-content-reference\{index="10"\}/);
});

test('review checks allow thirty-two without truncation while rejecting thirty-three, nonstrings and oversized whole replies', () => {
  const checks = Array.from({ length: 32 }, (_, index) => `Check ${index + 1}: recorded result, not a confidence claim.`);
  const report = { ...accept('C1'), verdict: 'uncertain', checks };
  assert.deepEqual(parseReview(JSON.stringify(report), 'C1').checks, checks);
  assert.throws(() => parseReview(JSON.stringify({ ...report, checks: [...checks, 'Check 33: overflow.'] }), 'C1'), /invalid checks list/);
  for (const invalid of [null, 12, {}, ['nested string']]) {
    assert.throws(() => parseReview(JSON.stringify({ ...report, checks: ['A valid check.', invalid] }), 'C1'), /invalid checks list/);
  }
  // Existing item semantics stay intact: only the complete reply has the 100k
  // bound. Do not introduce an undocumented per-check text cap here.
  const largeCheck = 'A'.repeat(90_000);
  assert.deepEqual(parseReview(JSON.stringify({ ...report, checks: [largeCheck] }), 'C1').checks, [largeCheck]);
  assert.throws(() => parseReview(JSON.stringify({ ...report, checks: ['A'.repeat(100_001)] }), 'C1'), /Reviewer reply is too long/);
});

test('improvements still require two nonblank checks with blank filtering and the same thirty-two-check cap', () => {
  const report = { ...accept('C1'), verdict: 'improve', revisedAnswer: 'A corrected source guard.',
    improvements: [{ change: 'Reject invalid indicator values.', benefit: 'Prevent invalid signal data.', evidence: 'The revised guard returns false for the invalid buffer.' }] };
  for (const checks of [[], [''], [' \n\t '], ['One recorded check.'], ['', 'One recorded check.', ' ']]) {
    assert.throws(() => parseReview(JSON.stringify({ ...report, checks }), 'C1'), /at least two specific checks/);
  }
  const twoChecks = ['Guard branch returns false for invalid data.', 'Finite valid input reaches the normal branch.'];
  assert.deepEqual(parseReview(JSON.stringify({ ...report, checks: ['', ` ${twoChecks[0]} `, '\n', twoChecks[1]] }), 'C1').checks, twoChecks);
  const checks = Array.from({ length: 32 }, (_, index) => `Independent check ${index + 1}: observed result.`);
  assert.deepEqual(parseReview(JSON.stringify({ ...report, checks }), 'C1').checks, checks);
  assert.throws(() => parseReview(JSON.stringify({ ...report, checks: [...checks, 'Check 33.'] }), 'C1'), /invalid checks list/);
});

const imageMetadata = (fingerprint = 'image-version-1', id = 'image-1') => ({
  id, name: 'generated-cat.png', mimeType: 'image/png', fingerprint,
});

function mediaDescriptor(state, side, fingerprint, id = 'image-1') {
  return replyMedia({ requestId: `request-${side}`, media: [imageMetadata(fingerprint, id)] }, state, side);
}

test('a changed generated image requires two fresh reviews even when the text is unchanged', () => {
  const state = initialState();
  state.relayMedia = true;
  state.runId = 'media-run';
  const first = mediaDescriptor(state, 'left', 'image-version-1');
  const second = mediaDescriptor(state, 'right', 'image-version-2');
  setCandidate(state, 'A realistic cat in a field.', first);
  applyReview(state, 'left', accept('C1'));
  assert.equal(state.acceptedBy.left, 'C1');
  applyReview(state, 'right', { ...accept('C1'), media: second });
  assert.equal(state.candidate.id, 'C2');
  assert.equal(state.candidate.text, 'A realistic cat in a field.');
  assert.equal(mediaFingerprint(state.candidate.media), mediaFingerprint(second));
  assert.deepEqual(state.acceptedBy, {});
  assert.equal(hasAgreement(state), false);
  applyReview(state, 'left', accept('C2'));
  assert.equal(hasAgreement(state), false);
  applyReview(state, 'right', accept('C2'));
  assert.equal(hasAgreement(state), true);
  // Reusing a URL marker in a later response still means a new output source.
  applyReview(state, 'left', { ...accept('C2'), media: { ...second, requestId: 'a-new-response' } });
  assert.equal(state.candidate.id, 'C3');
  assert.deepEqual(state.acceptedBy, {});
});

test('required PDF output cannot agree as text or treat a prose correction as a changed file', () => {
  const state = initialState();
  state.requireFiles = true; state.requirePdf = true; state.relayMedia = true; state.runId = 'pdf-run';
  state.candidate = { id: 'C0', text: 'A text-only proposed correction.', media: null };
  state.acceptedBy = { left: 'C0', right: 'C0' };
  assert.equal(hasAgreement(state), false);
  assert.equal(hasRequiredFiles(state, { files: [imageMetadata()] }), false);
  assert.throws(() => setCandidate(state, 'Text without an actual PDF.'), /required corrected PDF is missing/);
  const pdf = (fingerprint) => replyMedia({ requestId: `pdf-${fingerprint}`, media: [{
    id: 'pdf-1', name: 'corrected.pdf', mimeType: 'application/pdf', fingerprint,
  }] }, state, 'left');
  const first = pdf('version-1');
  setCandidate(state, 'Corrected source document.', first);
  const originalId = state.candidate.id;
  applyReview(state, 'right', { ...accept(originalId), verdict: 'challenge', revisedAnswer: 'The document is now corrected.' });
  assert.equal(state.candidate.id, originalId);
  assert.equal(state.candidate.text, 'Corrected source document.');
  assert.equal(mediaFingerprint(state.candidate.media), mediaFingerprint(first));
  assert.ok(state.issues.some((issue) => /without an updated PDF/.test(issue.problem) && !issue.resolved));
  applyReview(state, 'left', accept(originalId));
  applyReview(state, 'right', accept(originalId));
  assert.equal(hasAgreement(state), false);
  applyReview(state, 'right', { ...accept(originalId), media: pdf('version-2') });
  assert.notEqual(state.candidate.id, originalId);
  const newId = state.candidate.id;
  applyReview(state, 'left', accept(newId, state.issues.map((issue) => issue.id)));
  assert.equal(hasAgreement(state), false);
  applyReview(state, 'right', accept(newId));
  assert.equal(hasAgreement(state), true);
});

test('image-only and malformed accompanying text propose outputs without accepting them', () => {
  const state = initialState();
  state.relayMedia = true;
  state.runId = 'media-run';
  const media = mediaDescriptor(state, 'left', 'image-version-1');
  const draft = draftWithMedia('', media);
  assert.match(draft.answer, /Generated output attached/);
  assert.equal(draft.media, media);
  const review = reviewWithMedia('100% agree!', 'C1', media);
  assert.equal(review.verdict, 'challenge');
  assert.equal(review.candidateId, 'C1');
  assert.deepEqual(review.resolvedIssueIds, []);
  setCandidate(state, 'Original text');
  applyReview(state, 'left', review);
  assert.deepEqual(state.acceptedBy, {});
  assert.equal(hasAgreement(state), false);
  assert.throws(() => draftWithMedia('', null), /required/);
  assert.throws(() => reviewWithMedia('100% agree!', 'C1', null), /required JSON/);
  assert.throws(() => draftWithMedia('x'.repeat(80_001), media), /oversized/);
  assert.throws(() => reviewWithMedia('x'.repeat(80_001), 'C1', media), /oversized/);
});

test('media metadata rejects duplicates, unsupported types, unsafe names, and malformed identity', () => {
  const state = initialState();
  state.relayMedia = true;
  state.runId = 'media-run';
  const good = imageMetadata();
  assert.deepEqual(replyMedia({ requestId: 'request-1', media: [good] }, state, 'left'), {
    side: 'left', runId: 'media-run', requestId: 'request-1', files: [good],
  });
  for (const invalid of [
    null, {}, Array(6).fill(good), [good, good],
    [{ ...good, id: '' }], [{ ...good, id: 'x'.repeat(201) }],
    [{ ...good, name: '../cat.png' }], [{ ...good, name: 'cat\u0000.png' }],
    [{ ...good, mimeType: 'application/x-msdownload' }],
    [{ ...good, fingerprint: '' }], [{ ...good, fingerprint: 1 }],
  ]) {
    assert.throws(() => replyMedia({ requestId: 'request-1', media: invalid }, state, 'left'), /invalid media metadata/);
  }
  state.relayMedia = false;
  assert.equal(replyMedia({ media: [good] }, state, 'left'), null);
});

test('uncertainties from drafts and later reviews remain open until explicitly resolved', () => {
  const state = initialState();
  state.drafts = {
    left: { answer: 'The claim is plausible.', uncertainties: ['The measurement has not been verified.'] },
    right: { answer: 'The claim is plausible.', uncertainties: ['The measurement has not been verified.'] },
  };
  setCandidate(state, state.drafts.left.answer);
  seedDraftUncertainties(state);
  assert.equal(state.issues.length, 1);
  assert.match(reviewPrompt(state, 'left'), /The measurement has not been verified/);
  applyReview(state, 'right', accept('C1'));
  applyReview(state, 'left', accept('C1'));
  assert.equal(hasAgreement(state), false);
  applyReview(state, 'right', accept('C1', ['I1']));
  assert.equal(hasAgreement(state), true);
  applyReview(state, 'left', { ...accept('C1'), verdict: 'uncertain',
    uncertainties: ['The source date has not been verified.'] });
  assert.equal(state.issues.length, 2);
  assert.equal(state.issues[1].resolved, false);
  applyReview(state, 'right', accept('C1'));
  applyReview(state, 'left', accept('C1'));
  assert.equal(hasAgreement(state), false);
  applyReview(state, 'right', accept('C1', ['I2']));
  assert.equal(hasAgreement(state), true);
});

test('agreement requires both reviewers to accept one exact candidate', () => {
  const state = initialState();
  state.question = 'What is 2 + 2?';
  state.round = 1;
  state.drafts = { left: { answer: '4', uncertainties: [] }, right: { answer: 'Four', uncertainties: [] } };
  setCandidate(state, '4');
  assert.match(reviewPrompt(state, 'right'), /Current candidate ID: C1/);
  applyReview(state, 'right', accept('C1'));
  assert.equal(hasAgreement(state), false);
  applyReview(state, 'left', accept('C1'));
  assert.equal(hasAgreement(state), true);
  assert.equal(state.answer, '4');
});

test('a proposed replacement invalidates the earlier acceptance and needs two fresh checks', () => {
  const state = initialState();
  setCandidate(state, 'The total is 3.');
  applyReview(state, 'right', {
    candidateId: 'C1', verdict: 'challenge',
    issues: [{ severity: 'major', problem: 'Arithmetic is wrong.', evidence: '2 + 2 = 4.', correction: 'Use 4.' }],
    revisedAnswer: 'The total is 4.', resolvedIssueIds: [], uncertainties: [],
  });
  assert.equal(state.candidate.id, 'C2');
  assert.equal(state.acceptedBy.right, undefined);
  assert.equal(hasAgreement(state), false);
  applyReview(state, 'left', accept('C2', ['I1']));
  assert.equal(state.issues[0].resolved, true);
  assert.equal(hasAgreement(state), false);
  applyReview(state, 'right', accept('C2'));
  assert.equal(hasAgreement(state), true);
});

test('an unresolved repeated issue blocks agreement even with accept verdicts', () => {
  const state = initialState();
  setCandidate(state, '3');
  const issue = { severity: 'major', problem: 'The sum is wrong.', evidence: '2 + 2', correction: '4' };
  applyReview(state, 'right', { candidateId: 'C1', verdict: 'challenge', issues: [issue], revisedAnswer: '', resolvedIssueIds: [], uncertainties: [] });
  applyReview(state, 'left', accept('C1'));
  applyReview(state, 'right', accept('C1'));
  assert.equal(hasAgreement(state), false);
  assert.equal(state.issues[0].resolved, false);
  applyReview(state, 'left', { ...accept('C1', ['I1']), issues: [issue] });
  assert.equal(state.issues[0].resolved, false);
});

test('a replacement reopens previously resolved findings for a regression check', () => {
  const state = initialState();
  setCandidate(state, 'Correct total: 4');
  state.issues.push({ id: 'I1', problem: 'Check the total', severity: 'major', resolved: true });
  applyReview(state, 'right', { ...accept('C1'), verdict: 'challenge', revisedAnswer: 'A longer answer with total: 4' });
  assert.equal(state.candidate.id, 'C2');
  assert.equal(state.issues[0].resolved, false);
  applyReview(state, 'left', accept('C2'));
  applyReview(state, 'right', accept('C2'));
  assert.equal(hasAgreement(state), false);
  applyReview(state, 'left', accept('C2', ['I1']));
  assert.equal(hasAgreement(state), true);
});

test('uncertainty and contradictory accept are not counted as acceptance', () => {
  const state = initialState();
  setCandidate(state, 'A possible answer');
  applyReview(state, 'right', { ...accept('C1'), uncertainties: ['Not verified'] });
  assert.equal(state.acceptedBy.right, undefined);
  applyReview(state, 'left', { ...accept('C1'), revisedAnswer: 'A different answer' });
  assert.equal(state.candidate.id, 'C2');
  assert.equal(hasAgreement(state), false);
  assert.equal(stateFingerprint(state), JSON.stringify({ answer: 'A different answer', issues: ['not verified'] }));
});

async function withMediaCoordinator(exportMedia, runTest, startOptions = {}) {
  const state = initialState();
  state.status = 'setup';
  state.tabIds = { left: 10, right: 11 };
  const stored = { convergeState: state };
  const sent = [];
  let messageListener;
  const oldChrome = global.chrome;
  const backgroundPath = require.resolve('../background');
  global.chrome = {
    runtime: {
      onMessage: { addListener(fn) { messageListener = fn; } },
      onInstalled: { addListener() {} },
    },
    sidePanel: { async setPanelBehavior() {} },
    storage: { session: {
      async get(key) { return { [key]: structuredClone(stored[key]) }; },
      async set(data) { Object.assign(stored, structuredClone(data)); },
    } },
    tabs: {
      async get(id) { return { id, url: 'https://chatgpt.com/' }; },
      async sendMessage(id, message) {
        sent.push({ id, message: structuredClone(message) });
        if (message.type === 'PREPARE' || message.type === 'INSPECT') return {
          ok: true, ready: true, authenticated: true, temporary: true, unpersonalized: true, busy: false,
        };
        if (message.type === 'EXPORT_MEDIA') return exportMedia(id, message);
        return { ok: true };
      },
      onRemoved: { addListener() {} },
      onUpdated: { addListener() {} },
    },
    alarms: { async clear() {}, async create() {}, onAlarm: { addListener() {} } },
  };
  delete require.cache[backgroundPath];
  require('../background');
  const send = (message, tabId) => new Promise((resolve) => {
    messageListener(message, tabId ? { tab: { id: tabId, url: 'https://chatgpt.com/' } } : {}, resolve);
  });
  const settle = async () => {
    await new Promise((resolve) => setImmediate(resolve));
    return send({ type: 'GET_STATE' });
  };
  const awaitCondition = async (condition) => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (condition()) return;
      await settle();
    }
    assert.fail('The coordinator did not reach the expected event.');
  };
  const draftReply = (request, text, media) => send({
    type: 'REPLY', runId: request.message.runId, requestId: request.message.requestId,
    text, ...(media ? { media } : {}),
  }, request.id);
  try {
    const started = await send({ type: 'START', question: 'Draw a cat in a field.',
      relayMedia: true, confirmTemporary: true, maxRounds: 4, ...startOptions });
    assert.equal(started.ok, true);
    const drafts = sent.filter(({ message }) => message.type === 'SEND_PROMPT');
    assert.equal(drafts.length, 2);
    await runTest({ stored, sent, send, settle, awaitCondition, drafts, draftReply });
  } finally {
    if (stored.convergeState.status === 'running') await send({ type: 'STOP' });
    await settle();
    if (oldChrome === undefined) delete global.chrome;
    else global.chrome = oldChrome;
    delete require.cache[backgroundPath];
  }
}

test('a required corrected PDF gets one actual creation attempt, then stops clearly if still only text', async () => {
  await withMediaCoordinator(async () => { assert.fail('Missing file must not be exported.'); },
    async ({ drafts, draftReply, stored, sent, settle }) => {
      await draftReply(drafts[0], JSON.stringify({ answer: 'I found the mistakes and corrected them.', uncertainties: [] }));
      await settle();
      assert.equal(stored.convergeState.status, 'running');
      const followup = sent.filter(({ message }) => message.type === 'SEND_PROMPT').at(-1);
      assert.match(followup.message.text, /required draft output creation/);
      await draftReply(followup, JSON.stringify({ answer: 'I still only described the corrections.', uncertainties: [] }));
      assert.equal(stored.convergeState.status, 'error');
      assert.match(stored.convergeState.error, /did not produce the required corrected PDF/);
      assert.equal(hasAgreement(stored.convergeState), false);
      assert.equal(sent.filter(({ message }) => message.type === 'SEND_PROMPT').length, 3);
      assert.equal(sent.filter(({ message }) => message.type === 'CANCEL').length, 2);
    }, { question: 'Correct and return this PDF.', requireFiles: true });
});

test('generated output exports from its original request and is attached to review without storing bytes', async () => {
  const metadata = imageMetadata();
  await withMediaCoordinator(async (id, message) => {
    assert.equal(id, 10);
    assert.deepEqual(message.ids, [metadata.id]);
    return { ok: true, files: [{ ...metadata, base64: 'YQ==' }] };
  }, async ({ stored, sent, awaitCondition, drafts, draftReply }) => {
    await draftReply(drafts[0], '', [metadata]);
    await draftReply(drafts[1], JSON.stringify({ answer: 'My independent cat.', uncertainties: [] }));
    await awaitCondition(() => sent.filter(({ message }) => message.type === 'SEND_PROMPT').length === 3);
    const exported = sent.find(({ message }) => message.type === 'EXPORT_MEDIA');
    assert.equal(exported.message.runId, drafts[0].message.runId);
    assert.equal(exported.message.requestId, drafts[0].message.requestId);
    const review = sent.filter(({ message }) => message.type === 'SEND_PROMPT').at(-1);
    assert.equal(review.id, 11);
    assert.match(review.message.text, /Inspect the actual (?:corresponding )?attachments/);
    assert.deepEqual(review.message.files, [{ name: metadata.name, mimeType: metadata.mimeType, base64: 'YQ==' }]);
    assert.deepEqual(stored.convergeState.candidate.media.files, [metadata]);
    assert.doesNotMatch(JSON.stringify(stored), /base64|YQ==/);
    assert.deepEqual(stored.convergeState.acceptedBy, {});
  });
});

test('Stop during pending output export prevents a late review prompt', async () => {
  const metadata = imageMetadata();
  let finishExport;
  await withMediaCoordinator(() => new Promise((resolve) => { finishExport = resolve; }),
    async ({ stored, sent, send, settle, awaitCondition, drafts, draftReply }) => {
      await draftReply(drafts[0], '', [metadata]);
      await draftReply(drafts[1], JSON.stringify({ answer: 'Another image prompt', uncertainties: [] }));
      await awaitCondition(() => typeof finishExport === 'function');
      const stopped = await send({ type: 'STOP' });
      assert.equal(stopped.state.status, 'stopped');
      assert.equal(sent.filter(({ message }) => message.type === 'CANCEL').length, 2);
      finishExport({ ok: true, files: [{ ...metadata, base64: 'YQ==' }] });
      await settle();
      await settle();
      assert.equal(stored.convergeState.status, 'stopped');
      assert.deepEqual(stored.convergeState.pending, {});
      assert.equal(sent.filter(({ message }) => message.type === 'SEND_PROMPT').length, 2);
    });
});

test('failed or changed generated output cancels both pages instead of reviewing unavailable bytes', async () => {
  const metadata = imageMetadata();
  for (const exported of [
    { ok: false, error: 'This generated output is no longer visible.' },
    { ok: true, files: [{ ...metadata, fingerprint: 'different-version', base64: 'YQ==' }] },
  ]) {
    await withMediaCoordinator(async () => exported,
      async ({ stored, sent, awaitCondition, drafts, draftReply }) => {
        await draftReply(drafts[0], '', [metadata]);
        await draftReply(drafts[1], JSON.stringify({ answer: 'My independent cat', uncertainties: [] }));
        await awaitCondition(() => stored.convergeState.status === 'error');
        assert.match(stored.convergeState.error, /no longer visible|changed before/);
        assert.deepEqual(stored.convergeState.pending, {});
        assert.deepEqual(sent.filter(({ message }) => message.type === 'CANCEL').map(({ id }) => id), [10, 11]);
        assert.equal(sent.filter(({ message }) => message.type === 'SEND_PROMPT').length, 2);
        assert.doesNotMatch(JSON.stringify(stored), /base64|YQ==/);
      });
  }
});

test('event-driven coordinator relays two independent drafts and stops at dual acceptance', async () => {
  const listeners = {};
  const stored = { convergeState: initialState() };
  const sent = [];
  const windowUpdates = [];
  const createdWindows = [];
  let failRightUpload = false;
  let layoutIndex = 0;
  const oldChrome = global.chrome;
  global.chrome = {
    runtime: { onMessage: { addListener: (fn) => { listeners.message = fn; } }, onInstalled: { addListener() {} } },
    sidePanel: { async setPanelBehavior() {} },
    storage: { session: {
      async get(key) { return { [key]: structuredClone(stored[key]) }; },
      async set(data) { Object.assign(stored, structuredClone(data)); },
    } },
    tabs: {
      async get(id) { return { id, url: 'https://chatgpt.com/' }; },
      async create(options) {
        assert.equal(options.windowId, 1);
        assert.equal(options.active, true);
        return { id: 10 + layoutIndex * 10, url: options.url };
      },
      async sendMessage(id, message) {
        if (message.type === 'PREPARE' || message.type === 'INSPECT') {
          return { ok: true, ready: true, authenticated: true, temporary: true, unpersonalized: true, busy: false };
        }
        if (message.type === 'UPLOAD_FILES') {
          if (id % 10 === 1 && failRightUpload) return { ok: false, error: 'File chip did not appear.' };
          return { ok: true, attached: message.files.length };
        }
        sent.push({ id, message });
        return { ok: true };
      },
      onRemoved: { addListener() {} },
      onUpdated: { addListener: (fn) => { listeners.updated = fn; } },
    },
    alarms: { async clear() {}, async create() {}, onAlarm: { addListener: (fn) => { listeners.alarm = fn; } } },
    windows: {
      async getLastFocused() { return { id: 1, left: 0, top: 0, width: 1200, height: 800 }; },
      async get(id) { assert.equal(id, 1); return { id, type: 'normal', left: 0, top: 0, width: 1200, height: 800 }; },
      async update(id, options) { windowUpdates.push({ id, options }); },
      async create(options) {
        createdWindows.push(options);
        const id = 11 + layoutIndex * 10;
        layoutIndex += 1;
        return { tabs: [{ id, url: options.url }] };
      },
    },
  };
  const backgroundPath = require.resolve('../background');
  delete require.cache[backgroundPath];
  require('../background');
  async function send(message, tabId) {
    const result = await new Promise((resolve) => {
      listeners.message(message, tabId ? { tab: { id: tabId, url: 'https://chatgpt.com/' } } : {}, resolve);
    });
    // Source/candidate transfer dispatch is deliberately outside the queue so
    // Stop stays responsive. Let that asynchronous delivery settle before
    // inspecting its actual outbound prompt instead of a preceding draft.
    await new Promise(resolve => setImmediate(resolve));
    return result;
  }
  try {
    const layout = await send({ type: 'OPEN_LAYOUT', windowId: 1,
      screenBounds: { left: -1366, top: 0, width: 1366, height: 768 } });
    assert.equal(layout.ok, true);
    assert.deepEqual(layout.state.tabIds, { left: 10, right: 11 });
    assert.deepEqual(layout.state.layout, { left: -1366, top: 0, width: 1366, height: 768, leftWidth: 819 });
    assert.equal(createdWindows.length, 1);
    assert.equal(windowUpdates[0].id, 1);
    assert.equal(windowUpdates[0].options.width, 819);
    assert.equal(windowUpdates[0].options.left, -1366);
    assert.equal(createdWindows[0].left, -547);
    await send({ type: 'PAGE_STATUS', status: {
      ready: true, authenticated: true, temporary: true, unpersonalized: true, busy: false,
    } }, 10);
    assert.equal(stored.convergeState.pages.left.temporary, true);
    const attached = await send({ type: 'ATTACH_FILES', files: [{ name: 'notes.txt', mimeType: 'text/plain', base64: 'YQ==' }] });
    assert.equal(attached.ok, true);
    assert.equal(attached.state.attachments.status, 'attached');
    assert.equal(JSON.stringify(stored.convergeState).includes('YQ=='), false);
    const started = await send({ type: 'START', question: 'What is 2 + 2?', protocol: '', maxRounds: 2, confirmTemporary: true });
    assert.equal(started.ok, true);
    assert.equal(started.state.status, 'running');
    assert.equal(sent.filter((entry) => entry.message.type === 'SEND_PROMPT').length, 2);
    const leftDraft = sent.find((entry) => entry.id === 10).message;
    const rightDraft = sent.find((entry) => entry.id === 11).message;
    assert.ok(leftDraft.text.includes(leftDraft.requestId));
    assert.ok(rightDraft.text.includes(rightDraft.requestId));
    assert.notEqual(leftDraft.requestId, rightDraft.requestId);
    assert.doesNotMatch(rightDraft.text, /Left reviewer answered/);
    await send({ type: 'REPLY', runId: leftDraft.runId, requestId: leftDraft.requestId,
      text: JSON.stringify({ answer: 'The answer is 4.', uncertainties: [] }) }, 10);
    await send({ type: 'REPLY', runId: rightDraft.runId, requestId: rightDraft.requestId,
      text: JSON.stringify({ answer: 'Four.', uncertainties: [] }) }, 11);
    const rightReview = sent.at(-1).message;
    assert.equal(sent.at(-1).id, 11);
    assert.match(rightReview.text, /Current candidate ID: C1/);
    await send({ type: 'REPLY', runId: rightReview.runId, requestId: rightReview.requestId,
      text: JSON.stringify(accept('C1')) }, 11);
    const leftReview = sent.at(-1).message;
    assert.equal(sent.at(-1).id, 10);
    await send({ type: 'REPLY', runId: leftReview.runId, requestId: leftReview.requestId,
      text: JSON.stringify(accept('C1')) }, 10);
    assert.equal(stored.convergeState.status, 'agreed');
    assert.equal(stored.convergeState.answer, 'The answer is 4.');
    assert.equal(stored.convergeState.transcript.length, 4);

    const reuse = await send({ type: 'START', question: 'A second task', confirmTemporary: true });
    assert.equal(reuse.ok, true);
    assert.deepEqual(reuse.state.tabIds, { left: 10, right: 11 });
    assert.notEqual(reuse.state.runId, started.state.runId);
    assert.equal(reuse.state.transcript.length, 0);
    await send({ type: 'STOP' });
    const secondLayout = await send({ type: 'OPEN_LAYOUT' });
    assert.deepEqual(secondLayout.state.tabIds, { left: 20, right: 21 });
    const restarted = await send({ type: 'START', question: 'A second task', protocol: '', maxRounds: 2, confirmTemporary: true });
    assert.equal(restarted.ok, true);
    const staleRequest = sent.at(-2).message;
    const stopMessagesBefore = sent.length;
    const stopped = await send({ type: 'STOP' });
    assert.equal(stopped.state.status, 'stopped');
    assert.deepEqual(sent.slice(stopMessagesBefore).map(({ id, message }) => ({
      id, type: message.type, runId: message.runId,
    })), [
      { id: 20, type: 'CANCEL', runId: restarted.state.runId },
      { id: 21, type: 'CANCEL', runId: restarted.state.runId },
    ]);
    await send({ type: 'REPLY', runId: staleRequest.runId, requestId: staleRequest.requestId,
      text: JSON.stringify({ answer: 'Late reply', uncertainties: [] }) }, 20);
    assert.equal(stored.convergeState.status, 'stopped');
    assert.equal(stored.convergeState.transcript.length, 0);

    failRightUpload = true;
    await send({ type: 'OPEN_LAYOUT' });
    const partial = await send({ type: 'ATTACH_FILES', files: [{ name: 'next.txt', mimeType: 'text/plain', base64: 'Yg==' }] });
    assert.equal(partial.ok, false);
    assert.match(partial.error, /Files reached left only/);
    assert.equal(stored.convergeState.attachments.status, 'partial');
    const blocked = await send({ type: 'START', question: 'Another question', confirmTemporary: true });
    assert.equal(blocked.ok, false);
    assert.match(blocked.error, /Attachments were not confirmed on both pages/);

    const narrow = await send({ type: 'OPEN_LAYOUT', windowId: 1,
      screenBounds: { left: 0, top: 0, width: 1000, height: 768 } });
    assert.equal(narrow.ok, false);
    assert.match(narrow.error, /too narrow/);

    await send({ type: 'OPEN_LAYOUT' });
    const timed = await send({ type: 'START', question: 'A slow question', confirmTemporary: true });
    assert.equal(timed.ok, true);
    const timedRequests = sent.slice(-2);
    const alarmMessagesBefore = sent.length;
    stored.convergeState.deadline = Date.now() - 1;
    listeners.alarm({ name: 'converge-watchdog' });
    const afterAlarm = await send({ type: 'GET_STATE' });
    assert.equal(afterAlarm.state.status, 'limit_reached');
    assert.match(afterAlarm.state.error, /time limit/);
    assert.deepEqual(sent.slice(alarmMessagesBefore).map(({ id, message }) => ({
      id, type: message.type, runId: message.runId, requestId: message.requestId,
    })), timedRequests.map(({ id, message }) => ({
      id, type: 'CANCEL', runId: message.runId, requestId: message.requestId,
    })));

    await send({ type: 'OPEN_LAYOUT' });
    const errorRun = await send({ type: 'START', question: 'A failing question', confirmTemporary: true });
    const errorRequests = sent.slice(-2);
    const errorMessagesBefore = sent.length;
    const failed = await send({
      type: 'ERROR', runId: errorRequests[0].message.runId,
      requestId: errorRequests[0].message.requestId, error: 'The response failed.',
    }, errorRequests[0].id);
    assert.equal(errorRun.ok, true);
    assert.equal(failed.state.status, 'error');
    assert.match(failed.state.error, /The response failed/);
    assert.deepEqual(failed.state.pending, {});
    assert.deepEqual(sent.slice(errorMessagesBefore).map(({ id, message }) => ({
      id, type: message.type, runId: message.runId, requestId: message.requestId,
    })), errorRequests.map(({ id, message }) => ({
      id, type: 'CANCEL', runId: message.runId, requestId: message.requestId,
    })));
    const latePeer = errorRequests[1];
    await send({
      type: 'REPLY', runId: latePeer.message.runId, requestId: latePeer.message.requestId,
      text: JSON.stringify({ answer: 'A late peer response', uncertainties: [] }),
    }, latePeer.id);
    assert.equal(stored.convergeState.status, 'error');
    assert.equal(stored.convergeState.transcript.length, 0);
    assert.equal(sent.length, errorMessagesBefore + 2);
  } finally {
    if (oldChrome === undefined) delete global.chrome;
    else global.chrome = oldChrome;
    delete require.cache[backgroundPath];
  }
});
