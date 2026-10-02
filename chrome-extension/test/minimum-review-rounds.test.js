'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { installCoordinator, initialState, reviewPolicy, reviewPrompt } = require('../background');

function harness(t) {
  const state = initialState(); state.status = 'setup'; state.tabIds = { left: 10, right: 11 };
  const stored = { convergeState: state }, sent = []; let listener;
  const chrome = {
    runtime: { onMessage: { addListener(fn) { listener = fn; } }, onInstalled: { addListener() {} } },
    sidePanel: { async setPanelBehavior() {} },
    storage: { session: { async get(key) { return { [key]: structuredClone(stored[key]) }; }, async set(value) { Object.assign(stored, structuredClone(value)); } } },
    tabs: { async get(id) { return { id, url: 'https://chatgpt.com/' }; }, async sendMessage(id, message) {
      sent.push({ id, message: structuredClone(message) });
      return { ok: true, ready: true, authenticated: true, temporary: true, unpersonalized: true, busy: false };
    }, onRemoved: { addListener() {} }, onUpdated: { addListener() {} } },
    alarms: { async clear() {}, async create() {}, onAlarm: { addListener() {} } },
  };
  installCoordinator(chrome);
  const send = (message, id) => new Promise(resolve => listener(message, id ? { tab: { id, url: 'https://chatgpt.com/' } } : {}, resolve));
  const prompts = () => sent.filter(x => x.message.type === 'SEND_PROMPT');
  const settle = () => new Promise(resolve => setImmediate(resolve));
  const reply = async (request, value) => { const result = await send({ type: 'REPLY', runId: request.message.runId, requestId: request.message.requestId, text: JSON.stringify(value) }, request.id); await settle(); return result; };
  t.after(async () => { if(stored.convergeState.status === 'running') await send({ type: 'STOP' }); });
  return { stored, send, prompts, settle, reply, async draft(question, reviewMode) {
    assert.equal((await send({ type: 'START', question, reviewMode, maxRounds: 2, confirmTemporary: true })).ok, true); await settle();
    const [left, right] = prompts();
    await reply(left, { answer: 'A useful candidate.', uncertainties: [] }); await reply(right, { answer: 'Independent candidate.', uncertainties: [] });
  } };
}
const accept = candidateId => ({ candidateId, verdict: 'accept', issues: [], revisedAnswer: '', resolvedIssueIds: [], uncertainties: [] });

test('auto skips creative refinement only for a simple exact expression without source files', () => {
  assert.deepEqual(reviewPolicy('what is 4 + 6?', 'auto'), { reviewMode: 'verify', minReviewRounds: 1 });
  assert.equal(reviewPolicy('4 + 6', 'auto', true).minReviewRounds, 4);
  for (const q of ['Create a cat image.', 'Improve this PDF.', 'Repair a Python function.', 'Prove a difficult theorem.']) assert.equal(reviewPolicy(q, 'auto').minReviewRounds, 4);
  assert.equal(reviewPolicy('4+6', 'improve').minReviewRounds, 4);
  assert.equal(reviewPolicy('An exact combinatorial result.', 'verify').minReviewRounds, 1);
  assert.throws(() => reviewPolicy('task', 'unknown'), /Choose Auto/);
});

test('four complete rounds require eight fresh reviews even if every reviewer accepts', async t => {
  const h = harness(t); await h.draft('Create a useful visual.', 'improve');
  assert.equal(h.stored.convergeState.maxRounds, 4);
  for(let step = 0; step < 8; step++) {
    const call = h.prompts().at(-1); assert.equal(call.id, step % 2 ? 10 : 11);
    assert.match(call.message.text, /at least 4 complete review rounds/);
    await h.reply(call, accept('C1'));
    if(step < 7) assert.equal(h.stored.convergeState.status, 'running');
    if(step % 2 && step < 7) assert.deepEqual(h.stored.convergeState.acceptedBy, {});
  }
  assert.equal(h.stored.convergeState.status, 'agreed'); assert.equal(h.stored.convergeState.round, 4);
  assert.equal(h.stored.convergeState.transcript.filter(x => x.role === 'review').length, 8);
  assert.equal(h.prompts().length, 10);
});

test('unchanged uncertain reviews still complete four full rounds before stalling without false acceptance', async t => {
  const h = harness(t); await h.draft('Verify this implementation and improve it with all actual required checks.', 'improve');
  const candidate = structuredClone(h.stored.convergeState.candidate);
  for (let step = 0; step < 8; step++) {
    const call = h.prompts().at(-1);
    assert.equal(call.id, step % 2 ? 10 : 11);
    assert.equal(h.stored.convergeState.round, Math.floor(step / 2) + 1);
    await h.reply(call, { ...accept('C1'), verdict: 'uncertain',
      uncertainties: ['Required external execution is unavailable; only manual inspection was possible.'],
      checks: ['Manually inspected the unchanged candidate; no substantiated source defect was found.',
        'Independent boundary trace retained the same candidate; external execution remains unavailable.'] });
    if (step < 7) assert.equal(h.stored.convergeState.status, 'running', 'repetition cannot bypass the user minimum');
  }
  assert.equal(h.stored.convergeState.status, 'stalled');
  assert.equal(h.stored.convergeState.round, 4);
  assert.equal(h.stored.convergeState.transcript.filter(item => item.role === 'review').length, 8);
  assert.equal(h.prompts().length, 10);
  assert.equal(h.stored.convergeState.candidate.id, candidate.id);
  assert.equal(h.stored.convergeState.candidate.text, candidate.text);
  assert.deepEqual(h.stored.convergeState.acceptedBy, {});
  assert.ok(h.stored.convergeState.issues.some(issue => !issue.resolved));
  assert.match(h.stored.convergeState.error, /unresolved issues/);
});

test('fixed arithmetic has two independent reviews and Stop still ends an improvement run early', async t => {
  const h = harness(t); await h.draft('what is 4+6?', 'auto');
  await h.reply(h.prompts().at(-1), accept('C1')); assert.equal(h.stored.convergeState.status, 'running');
  await h.reply(h.prompts().at(-1), accept('C1')); assert.equal(h.stored.convergeState.status, 'agreed');
  const h2 = harness(t); await h2.draft('Create a visual.', 'improve');
  const pending = h2.prompts().at(-1); await h2.send({ type: 'STOP' }); await h2.reply(pending, accept('C1'));
  assert.equal(h2.stored.convergeState.status, 'stopped'); assert.equal(h2.prompts().length, 3);
});

test('improvement rounds seek specific useful changes without requiring invented defects', () => {
  const state = initialState(); Object.assign(state, { reviewMode: 'improve', minReviewRounds: 4, round: 2, candidate: { id: 'C1', text: 'A visual.' } });
  const prompt = reviewPrompt(state, 'right');
  assert.match(prompt, /composition/); assert.match(prompt, /create the revised output itself/);
  assert.match(prompt, /Do not invent factual errors/); assert.match(prompt, /no worthwhile improvement/);
});
