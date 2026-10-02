'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createDesktopCoordinator } = require('../src/browser/desktop-coordinator');

const ready = { ok: true, ready: true, authenticated: true, temporary: true, unpersonalized: true, busy: false, reason: '' };
const pause = () => new Promise((resolve) => setImmediate(resolve));

async function until(check, message = 'Expected state was not reached.') {
  for (let i = 0; i < 100; i += 1) {
    if (await check()) return;
    await pause();
  }
  assert.fail(message);
}

function harness({ page = ready, reply, failSend, onState, acknowledge } = {}) {
  const sent = [];
  const opened = [];
  const urls = { left: 'about:blank', right: 'about:blank' };
  let coordinator;
  coordinator = createDesktopCoordinator({
    async openPage(side, url) { opened.push(side); urls[side] = url; },
    getPageUrl(side) { return urls[side]; },
    onState,
    async sendToPage(side, message) {
      sent.push({ side, message });
      if (message.type === 'PREPARE' || message.type === 'INSPECT') return { ...page };
      if (message.type === 'UPLOAD_FILES') return { ok: true, attached: message.files.length };
      if (message.type === 'SEND_PROMPT') {
        if (failSend) throw new Error(failSend);
        if (reply) {
          const value = reply(side, message);
          if (value) queueMicrotask(() => coordinator.pageEvent(side, {
            type: 'REPLY', runId: message.runId, requestId: message.requestId, text: JSON.stringify(value),
          }));
        }
        if (acknowledge) return acknowledge(side, message);
      }
      return { ok: true };
    },
  });
  return { coordinator, sent, opened, urls };
}

function draftOrAccept(side, message) {
  const candidate = message.text.match(/Current candidate ID: (C\d+)/)?.[1];
  return candidate ? {
    candidateId: candidate, verdict: 'accept', issues: [], revisedAnswer: '', resolvedIssueIds: [], uncertainties: [],
  } : { answer: side === 'left' ? '2 + 2 = 4.' : 'The sum is four.', uncertainties: [] };
}

test('embedded desktop pages automatically exchange two drafts and reviews until exact agreement', async (t) => {
  const { coordinator, sent, opened } = harness({ reply: draftOrAccept });
  t.after(() => coordinator.dispose());
  const setup = await coordinator.request('OPEN_LAYOUT');
  assert.equal(setup.ok, true);
  assert.equal(setup.state.status, 'setup');
  assert.deepEqual(opened, ['left', 'right']);
  const started = await coordinator.request('START', { question: 'What is 2 + 2?', maxRounds: 3 });
  assert.equal(started.ok, true);
  await until(async () => (await coordinator.getState()).status === 'agreed');
  const state = await coordinator.getState();
  assert.equal(state.answer, '2 + 2 = 4.');
  assert.deepEqual(state.acceptedBy, { right: 'C1', left: 'C1' });
  assert.deepEqual(sent.filter((item) => item.message.type === 'SEND_PROMPT').map((item) => item.side), ['left', 'right', 'right', 'left']);
  assert.equal(state.transcript.length, 4);
});

test('explicit Normal and Temporary modes permit personalization and propagate the chosen mode', async (t) => {
  for (const chatMode of ['normal', 'temporary']) {
    const { coordinator, sent } = harness({ page: { ...ready, temporary: chatMode === 'temporary', unpersonalized: false, work: false }, reply: draftOrAccept });
    t.after(() => coordinator.dispose());
    const setup = await coordinator.request('OPEN_LAYOUT', { chatMode });
    assert.equal(setup.state.chatMode, chatMode);
    assert.equal(setup.state.requireUnpersonalized, false);
    const started = await coordinator.request('START', { question: 'What is 2 + 2?' });
    assert.equal(started.ok, true, started.error);
    await until(async () => (await coordinator.getState()).status === 'agreed');
    assert.ok(sent.filter(({ message }) => ['PREPARE', 'INSPECT', 'SEND_PROMPT'].includes(message.type)).every(({ message }) =>
      message.chatMode === chatMode && message.requireUnpersonalized === false));
  }
});

test('Work mode requires observable selected state and invalid mode creates no pages', async (t) => {
  const invalid = harness(); t.after(() => invalid.coordinator.dispose());
  const rejected = await invalid.coordinator.request('OPEN_LAYOUT', { chatMode: 'invented' });
  assert.equal(rejected.ok, false);
  assert.equal(invalid.opened.length, 0);
  for (const work of [null, false, true]) {
    const { coordinator } = harness({ page: { ...ready, temporary: false, unpersonalized: false, work }, reply: draftOrAccept });
    t.after(() => coordinator.dispose());
    await coordinator.request('OPEN_LAYOUT', { chatMode: 'work' });
    const started = await coordinator.request('START', { question: 'What is 2 + 2?', confirmTemporary: true });
    assert.equal(started.ok, work === true);
    if (work !== true) assert.match(started.error, /verified Work mode/);
    else await until(async () => (await coordinator.getState()).status === 'agreed');
  }
});

test('required corrected output cannot start while file exchange is disabled', async (t) => {
  const { coordinator, sent } = harness();
  t.after(() => coordinator.dispose());
  await coordinator.request('OPEN_LAYOUT', { chatMode: 'normal' });
  const started = await coordinator.request('START', { question: 'Correct this PDF.', requireFiles: true, relayMedia: false });
  assert.equal(started.ok, false);
  assert.match(started.error, /Enable file and image exchange/);
  assert.equal(sent.filter(({ message }) => message.type === 'SEND_PROMPT').length, 0);
});

test('a second question keeps both conversations and resets run identity, result, issues, and source attachments', async (t) => {
  const { coordinator, sent, opened } = harness({ reply: draftOrAccept });
  t.after(() => coordinator.dispose());
  await coordinator.request('OPEN_LAYOUT', { chatMode: 'normal' });
  await coordinator.request('ATTACH_FILES', { files: [{ name: 'source.pdf', mimeType: 'application/pdf', base64: 'YQ==' }] });
  await coordinator.request('START', { question: 'Correct this source document.', relayMedia: true });
  await until(async () => (await coordinator.getState()).status === 'agreed');
  const first = await coordinator.getState();
  const oldRequest = sent.find(({ message }) => message.type === 'SEND_PROMPT');
  assert.match(oldRequest.message.text, /source\.pdf/);
  assert.match(oldRequest.message.text, /produce the corrected document/);
  const preparationCount = sent.filter(({ message }) => message.type === 'PREPARE').length;
  const second = await coordinator.request('START', { question: 'Now explain the calculation.' });
  assert.equal(second.ok, true);
  assert.notEqual(second.state.runId, first.runId);
  assert.deepEqual(second.state.tabIds, first.tabIds);
  assert.equal(second.state.answer, '');
  assert.equal(second.state.candidate, null);
  assert.deepEqual(second.state.issues, []);
  assert.deepEqual(second.state.acceptedBy, {});
  const newDrafts = sent.filter(({ message }) => message.type === 'SEND_PROMPT' && message.runId === second.state.runId);
  assert.equal(newDrafts.length, 2);
  assert.ok(newDrafts.every(({ message }) => !message.text.includes('source.pdf')));
  assert.equal(sent.filter(({ message }) => message.type === 'PREPARE').length, preparationCount);
  assert.deepEqual(opened, ['left', 'right']);
  await coordinator.pageEvent(oldRequest.side, { type: 'REPLY', runId: oldRequest.message.runId,
    requestId: oldRequest.message.requestId, text: JSON.stringify({ answer: 'Stale source answer.', uncertainties: [] }) });
  await until(async () => (await coordinator.getState()).status === 'agreed');
  const last = await coordinator.getState();
  assert.equal(last.question, 'Now explain the calculation.');
  assert.doesNotMatch(JSON.stringify(last.transcript), /Stale source answer/);
});

test('new source files can be added to the same stopped pair before restarting', async (t) => {
  const { coordinator, opened } = harness();
  t.after(() => coordinator.dispose());
  await coordinator.request('OPEN_LAYOUT', { chatMode: 'normal' });
  await coordinator.request('START', { question: 'A first question.' });
  await coordinator.stop();
  const attached = await coordinator.request('ATTACH_FILES', { files: [{ name: 'second.pdf', mimeType: 'application/pdf', base64: 'Yg==' }] });
  assert.equal(attached.ok, true);
  const restarted = await coordinator.request('START', { question: 'Review the second file.', relayMedia: true });
  assert.equal(restarted.ok, true);
  assert.deepEqual(opened, ['left', 'right']);
});

test('desktop transport forwards a revision and requires both sides to check the replacement', async (t) => {
  let challenged = false;
  const { coordinator, sent } = harness({ reply(side, message) {
    const response = draftOrAccept(side, message);
    if (response.candidateId === 'C1' && side === 'right' && !challenged) {
      challenged = true;
      return { ...response, verdict: 'challenge', revisedAnswer: 'Two plus two equals four.',
        issues: [{ severity: 'minor', problem: 'Explain the calculation.', evidence: 'The answer lacks words.', correction: 'Spell it out.' }] };
    }
    if (response.candidateId === 'C2') response.resolvedIssueIds = ['I1'];
    return response;
  } });
  t.after(() => coordinator.dispose());
  await coordinator.request('OPEN_LAYOUT');
  await coordinator.request('START', { question: 'What is 2 + 2?' });
  await until(async () => (await coordinator.getState()).status === 'agreed');
  const state = await coordinator.getState();
  assert.equal(state.candidate.id, 'C2');
  assert.equal(state.answer, 'Two plus two equals four.');
  assert.deepEqual(state.acceptedBy, { left: 'C2', right: 'C2' });
  assert.equal(sent.filter((item) => item.message.type === 'SEND_PROMPT').length, 5);
});

test('attachments reach both embedded pages and binary contents do not enter coordinator state', async (t) => {
  const { coordinator, sent } = harness();
  t.after(() => coordinator.dispose());
  await coordinator.request('OPEN_LAYOUT');
  const files = [{ name: 'sample.txt', mimeType: 'text/plain', base64: Buffer.from('A file to review').toString('base64') }];
  const result = await coordinator.request('ATTACH_FILES', { files });
  assert.equal(result.ok, true);
  assert.deepEqual(sent.filter((item) => item.message.type === 'UPLOAD_FILES').map((item) => item.side), ['left', 'right']);
  assert.equal(result.state.attachments.status, 'attached');
  assert.doesNotMatch(JSON.stringify(result.state), /A file to review|base64/);
});

test('Stop cancels both pages and ignores replies from the stopped run', async (t) => {
  const { coordinator, sent } = harness();
  t.after(() => coordinator.dispose());
  await coordinator.request('OPEN_LAYOUT');
  await coordinator.request('START', { question: 'Solve a slow problem.' });
  const first = sent.find((item) => item.message.type === 'SEND_PROMPT');
  assert.ok(first);
  const stopped = await coordinator.stop();
  assert.equal(stopped.state.status, 'stopped');
  assert.deepEqual(sent.filter((item) => item.message.type === 'CANCEL').map((item) => item.side), ['left', 'right']);
  await coordinator.pageEvent(first.side, { type: 'REPLY', runId: first.message.runId, requestId: first.message.requestId,
    text: JSON.stringify({ answer: 'A late answer.', uncertainties: [] }) });
  assert.equal((await coordinator.getState()).answer, '');
  assert.equal((await coordinator.getState()).status, 'stopped');
});

test('navigation or a closed page stops a running exchange instead of waiting forever', async (t) => {
  for (const trigger of ['navigation', 'closed']) {
    const { coordinator } = harness();
    t.after(() => coordinator.dispose());
    await coordinator.request('OPEN_LAYOUT');
    await coordinator.request('START', { question: 'Solve a slow problem.' });
    if (trigger === 'navigation') coordinator.pageNavigation('right', 'https://example.com/');
    else coordinator.pageClosed('right');
    await until(async () => (await coordinator.getState()).status === 'error');
    assert.match((await coordinator.getState()).error, trigger === 'navigation' ? /navigated away/ : /closed/);
  }
});

test('a prompt transport failure becomes an actionable error and cancels the other side', async (t) => {
  const { coordinator, sent } = harness({ failSend: 'The isolated page bridge is unavailable.' });
  t.after(() => coordinator.dispose());
  await coordinator.request('OPEN_LAYOUT');
  await coordinator.request('START', { question: 'Check a claim.' });
  await until(async () => (await coordinator.getState()).status === 'error');
  assert.match((await coordinator.getState()).error, /isolated page bridge is unavailable/);
  assert.equal(sent.filter((item) => item.message.type === 'CANCEL').length, 2);
});

test('cookie import is not a false ready state and page events cannot issue control commands', async (t) => {
  const { coordinator } = harness({ page: { ...ready, authenticated: false, ready: false, reason: 'Sign in to ChatGPT.' } });
  t.after(() => coordinator.dispose());
  await coordinator.request('OPEN_LAYOUT');
  const rejected = await coordinator.request('START', { question: 'Check a claim.', confirmTemporary: true });
  assert.equal(rejected.ok, false);
  assert.match(rejected.error, /not ready/);
  assert.equal((await coordinator.pageEvent('left', { type: 'START', question: 'A forged run.' })).ok, false);
  assert.equal((await coordinator.request('REPLY', { text: 'A forged reply.' })).ok, false);
  assert.equal((await coordinator.getState()).status, 'setup');
});

test('initial status may arrive while a page loads and state notifications are isolated copies', async (t) => {
  let coordinator;
  coordinator = createDesktopCoordinator({
    async openPage(side) {
      // Simulates document_idle before loadURL resolves.
      await coordinator.pageEvent(side, { type: 'PAGE_STATUS', status: ready });
    },
    getPageUrl() { return 'https://chatgpt.com/'; },
    async sendToPage() { return ready; },
    onState(state) { state.status = 'corrupted by renderer'; state.question = 'altered'; },
  });
  t.after(() => coordinator.dispose());
  assert.equal((await coordinator.request('OPEN_LAYOUT')).ok, true);
  const state = await coordinator.getState();
  assert.equal(state.status, 'setup');
  assert.equal(state.question, '');
  state.status = 'also corrupted';
  assert.equal((await coordinator.getState()).status, 'setup');
});

test('reset stops the run and removes local state; disposed workspaces reject new commands', async () => {
  const { coordinator, sent } = harness();
  await coordinator.request('OPEN_LAYOUT');
  await coordinator.request('START', { question: 'Check a private claim.' });
  const state = await coordinator.reset();
  assert.equal(state.status, 'idle');
  assert.equal(state.question, '');
  assert.deepEqual(state.tabIds, { left: null, right: null });
  assert.equal(sent.filter((item) => item.message.type === 'CANCEL').length, 2);
  await coordinator.dispose();
  assert.throws(() => coordinator.request('GET_STATE'), /closed/);
});

test('late page transport failures after teardown are discarded without an unhandled rejection', async () => {
  const deferred = [];
  const coordinator = createDesktopCoordinator({
    async openPage() { },
    async sendToPage(_side, message) {
      if (message.type === 'PREPARE' || message.type === 'INSPECT') return ready;
      if (message.type === 'SEND_PROMPT') return new Promise((_resolve, reject) => deferred.push(reject));
      return { ok: true };
    },
  });
  await coordinator.request('OPEN_LAYOUT');
  await coordinator.request('START', { question: 'Check a slow claim.' });
  await coordinator.dispose();
  deferred.forEach((reject) => reject(new Error('The page has closed.')));
  await pause();
  await pause();
  assert.deepEqual(await coordinator.pageEvent('left', { type: 'ERROR', error: 'late' }), { ok: true, ignored: true });
});

function transferHarness(t, options = {}) {
  const h = harness(options);
  t.after(() => h.coordinator.dispose());
  h.prompts = () => h.sent.filter(({ message }) => message.type === 'SEND_PROMPT');
  h.respond = (call, value) => h.coordinator.pageEvent(call.side, { type: 'REPLY',
    runId: call.message.runId, requestId: call.message.requestId,
    text: typeof value === 'string' ? value : JSON.stringify(value) });
  h.startDrafts = async () => {
    await h.coordinator.request('OPEN_LAYOUT', { chatMode: 'normal' });
    assert.equal((await h.coordinator.request('START', {
      question: 'Review and improve this design.', reviewMode: 'improve', maxRounds: 4,
    })).ok, true);
    await until(() => h.prompts().length === 2);
    assert.equal((await h.coordinator.getState()).lastTransfer, null, 'draft acknowledgements are not peer transfers');
    const [left, right] = h.prompts();
    await h.respond(left, { answer: 'Initial left design.', uncertainties: [] });
    await h.respond(right, { answer: 'Independent right design.', uncertainties: [] });
    await until(() => h.prompts().length === 3);
    return h.prompts().at(-1);
  };
  return h;
}

test('peer transfer metadata waits for acknowledged submission and uses exact text-only authorship', async t => {
  let release;
  const h = transferHarness(t, { acknowledge(_side, message) {
    return /Current candidate ID:/.test(message.text) && !release
      ? new Promise(resolve => { release = resolve; }) : { ok: true };
  } });
  const review = await h.startDrafts();
  await h.coordinator.pageEvent('right', { type: 'PAGE_STATUS', status: { ...ready, busy: true } });
  assert.equal((await h.coordinator.getState()).lastTransfer, null, 'busy includes an unsent draft or upload and cannot certify delivery');
  release({ ok: true });
  await until(async () => (await h.coordinator.getState()).lastTransfer?.requestId === review.message.requestId);
  const transfer = (await h.coordinator.getState()).lastTransfer;
  assert.deepEqual(transfer, { runId: review.message.runId, requestId: review.message.requestId,
    from: 'left', to: 'right', candidateId: 'C1', hasFiles: false });
  await h.respond(review, draftOrAccept(review.side, review.message));
  await until(() => h.prompts().length === 4);
  await pause();
  assert.deepEqual((await h.coordinator.getState()).lastTransfer, transfer,
    'a reviewer inspecting its own unchanged candidate is not an opposite-direction handoff');
});

test('a changed text-only candidate acknowledges the actual replacement author', async t => {
  const h = transferHarness(t);
  const review = await h.startDrafts();
  await until(async () => (await h.coordinator.getState()).lastTransfer?.requestId === review.message.requestId);
  await h.respond(review, { ...draftOrAccept(review.side, review.message), verdict: 'challenge',
    revisedAnswer: 'Corrected right design.', issues: [{ severity: 'minor', problem: 'Missing detail.',
      evidence: 'The draft omitted the design step.', correction: 'Include that step.' }] });
  await until(async () => (await h.coordinator.getState()).lastTransfer?.candidateId === 'C2');
  const next = h.prompts().at(-1);
  assert.deepEqual((await h.coordinator.getState()).lastTransfer, { runId: next.message.runId,
    requestId: next.message.requestId, from: 'right', to: 'left', candidateId: 'C2', hasFiles: false });
});

test('formatting retries do not create a new peer handoff', async t => {
  const h = transferHarness(t);
  const review = await h.startDrafts();
  await until(async () => (await h.coordinator.getState()).lastTransfer?.requestId === review.message.requestId);
  const acknowledged = (await h.coordinator.getState()).lastTransfer;
  await h.respond(review, 'The design looks good, but this is not the required JSON.');
  await until(() => h.prompts().length === 4);
  await pause();
  assert.notEqual(h.prompts().at(-1).message.requestId, review.message.requestId);
  assert.deepEqual((await h.coordinator.getState()).lastTransfer, acknowledged);
});

test('failed, cancelled and unacknowledged review sends never certify a peer transfer', async t => {
  for (const [label, response] of [
    ['failed', { ok: false, error: 'Submission failed.' }],
    ['cancelled', { ok: true, cancelled: true }],
    ['unacknowledged', undefined],
  ]) await t.test(label, async t => {
    const h = transferHarness(t, { acknowledge(_side, message) {
      return /Current candidate ID:/.test(message.text) ? response : { ok: true };
    } });
    await h.startDrafts();
    await pause(); await pause();
    assert.equal((await h.coordinator.getState()).lastTransfer, null);
    if (label === 'failed') assert.equal((await h.coordinator.getState()).status, 'error');
  });
});

test('late review acknowledgements cannot overwrite Stop, Reset or a subsequent run', async t => {
  for (const action of ['stop', 'reset', 'new run']) await t.test(action, async t => {
    let release;
    const h = transferHarness(t, { acknowledge(_side, message) {
      return /Current candidate ID:/.test(message.text) && !release
        ? new Promise(resolve => { release = resolve; }) : { ok: true };
    } });
    const oldReview = await h.startDrafts();
    if (action === 'reset') await h.coordinator.reset();
    else await h.coordinator.stop();
    if (action === 'new run') {
      const fresh = await h.coordinator.request('START', { question: 'A new question.' });
      assert.equal(fresh.ok, true);
      assert.notEqual(fresh.state.runId, oldReview.message.runId);
      assert.equal(fresh.state.lastTransfer, null);
    }
    release({ ok: true });
    await pause(); await pause();
    assert.equal((await h.coordinator.getState()).lastTransfer, null);
  });
});

test('an outdated acknowledgement cannot overwrite a replacement candidate transfer', async t => {
  let release;
  const h = transferHarness(t, { acknowledge(_side, message) {
    return /Current candidate ID: C1/.test(message.text) && !release
      ? new Promise(resolve => { release = resolve; }) : { ok: true };
  } });
  const oldReview = await h.startDrafts();
  await h.respond(oldReview, { ...draftOrAccept(oldReview.side, oldReview.message), verdict: 'challenge',
    revisedAnswer: 'Replacement right design.', issues: [{ severity: 'minor', problem: 'Missing step.',
      evidence: 'The initial draft lacks the step.', correction: 'Include the step.' }] });
  await until(async () => (await h.coordinator.getState()).lastTransfer?.candidateId === 'C2');
  const replacement = (await h.coordinator.getState()).lastTransfer;
  release({ ok: true });
  await pause(); await pause();
  assert.deepEqual((await h.coordinator.getState()).lastTransfer, replacement);
});
