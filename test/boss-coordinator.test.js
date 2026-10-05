'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
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
    onState: options.onState,
    async openPage(side, url) { opened.push(side); urls[side] = url; },
    getPageUrl(side) { return urls[side]; },
    async sendToPage(side, message) {
      sent.push({ side, message });
      if (options.transport) {
        const supplied = await options.transport(side, message, { sent, exported, generatedFile });
        if (supplied !== undefined) return supplied;
      }
      if (['INSPECT', 'PREPARE'].includes(message.type)) return { ...pages[side] };
      if (message.type === 'UPLOAD_FILES') return { ok: true, attached: message.files.length };
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

async function begin(h, settings = {}) {
  assert.equal((await h.coordinator.request('OPEN_LAYOUT', { chatMode: 'normal' })).ok, true);
  const result = await h.coordinator.request('START', { question: 'Develop an improved explanation.', reviewMode: 'auto', maxRounds: 6, ...settings });
  assert.equal(result.ok, true, result.error);
  return result;
}

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
  assert.equal(state.answer, state.candidate.answer);
  assert.notEqual(state.answer, state.boss.finalSummary);
  const bossContexts = h.prompts().filter(call => call.side === 'boss').map(call => marker(call.message.text, 'BOSS_CONTEXT'));
  assert.deepEqual(bossContexts.slice(1).flatMap(context => context.worker_results.map(result => result.id)), state.workerResults.map(result => result.id));
  assert.ok(h.prompts().some(call => call.side === 'left' && call.message.text.includes('failure case A in cycle 3')));
  assert.ok(h.prompts().some(call => call.side === 'right' && call.message.text.includes('improvement B in cycle 4')));
  const checks = h.prompts().filter(call => call.side !== 'boss' && call.message.text.includes('Perform an independent final check'));
  assert.equal(checks.length, 2);
  assert.deepEqual(checks.map(call => marker(call.message.text, 'FINAL_CANDIDATE').sha256), [state.candidate.sha256, state.candidate.sha256]);
});

test('immutable arithmetic uses one independent work pair and one final checking pair', async t => {
  const h = harness({ reply: normalReply }); t.after(() => h.coordinator.dispose());
  await begin(h, { question: 'What is 4 + 6?' });
  await until(async () => (await h.coordinator.getState()).status === 'agreed');
  const state = await h.coordinator.getState();
  assert.equal(state.minReviewRounds, 1);
  assert.equal(state.round, 1);
  assert.equal(state.workerResults.length, 4);
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
    await until(async () => (await h.coordinator.getState()).status === 'limit_reached');
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

test('forged generated output digest stops the run before the boss receives any file', async t => {
  const h = harness({ reply(side, message, context) { return normalReply(side, message, context, true); },
    transport(_side, message, { exported }) {
      if (message.type === 'EXPORT_MEDIA') return { ok: true, files: (exported.get(`${message.runId}:${message.requestId}`) || [])
        .map(file => ({ ...file, contentSha256: '0'.repeat(64) })) };
    } }); t.after(() => h.coordinator.dispose());
  await begin(h, { relayMedia: true });
  await until(async () => (await h.coordinator.getState()).status === 'error');
  assert.match((await h.coordinator.getState()).error, /hash/);
  assert.equal(h.prompts().filter(call => call.side === 'boss').length, 1);
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
  await until(async () => (await h.coordinator.getState()).status === 'error');
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
  assert.throws(() => parseBossReply(JSON.stringify({ ...plan, action: 'execute' }), 'owned'), /dispatch, verify/);
});

test('file validation rejects binary masquerading as source and candidate digest binds actual file identities', () => {
  assert.throws(() => validateFiles([{ name: 'source.py', mimeType: 'text/plain', base64: Buffer.from([0, 1, 2]).toString('base64') }]), /binary/);
  assert.throws(() => validateFiles([{ name: '../source.txt', mimeType: 'text/plain', base64: 'YQ==' }]), /directory paths/);
  assert.notEqual(candidateDigest('same text', { files: [{ name: 'a.txt', contentSha256: hash('A'), byteLength: 1 }] }),
    candidateDigest('same text', { files: [{ name: 'a.txt', contentSha256: hash('B'), byteLength: 1 }] }));
});

test('watchdog bounds a silent model response without blocking Stop', async t => {
  const h = harness({ requestTimeoutMs: 20, runTimeoutMs: 100 }); t.after(() => h.coordinator.dispose());
  await begin(h);
  await new Promise(resolve => setTimeout(resolve, 40));
  const state = await h.coordinator.getState();
  assert.equal(state.status, 'limit_reached');
  assert.deepEqual(state.pending, {});
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
  await until(async () => (await h.coordinator.getState()).status === 'error');
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
  assert.equal(repair.candidate.answer.length, 78_000);
  assert.equal(repair.candidate.text, undefined);
  assert.equal(repair.worker_results.length, 2);
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
