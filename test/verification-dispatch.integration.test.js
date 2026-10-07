'use strict';

// Offline transport integration. A deliberately delayed production file
// verification operation exercises workflow boundaries without live accounts.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createBossCoordinator } = require('../src/browser/boss-coordinator');
const { runVerificationLab } = require('../src/studio-services/verification-lab');

const READY = { ok: true, ready: true, authenticated: true, temporary: false, work: false,
  unpersonalized: false, busy: false };
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function block(text, name) {
  const value = text.split(`BEGIN_${name}_JSON\n`)[1]?.split(`\nEND_${name}_JSON`)[0];
  assert.ok(value, `Missing ${name} context.`);
  return JSON.parse(value);
}

function fixture({ holdReplanning = false, freshAudit = false, holdFreshOpen = false, holdSecondVerification = false, holdFreshReview = false } = {}) {
  const sent = [], exports = new Map(), verificationCalls = [], finalContexts = [];
  const urls = { left: 'about:blank', right: 'about:blank', boss: 'about:blank' };
  let coordinator, release, releaseFreshOpen, releaseSecondVerification;
  let rightOpenCount = 0, freshOpenStarted = false, verificationCompletionCount = 0;
  let heldFreshReply = null;
  const verificationGate = new Promise(resolve => { release = resolve; });
  const freshOpenGate = new Promise(resolve => { releaseFreshOpen = resolve; });
  const secondVerificationGate = new Promise(resolve => { releaseSecondVerification = resolve; });
  let completion;
  const verificationFinished = new Promise(resolve => { completion = resolve; });
  const bytes = Buffer.from('10\n');
  coordinator = createBossCoordinator({
    requestTimeoutMs: 10_000, runTimeoutMs: 20_000,
    async openPage(side, url) {
      if (side === 'right' && ++rightOpenCount > 1 && holdFreshOpen) {
        freshOpenStarted = true;
        await freshOpenGate;
      }
      urls[side] = url;
    }, getPageUrl(side) { return urls[side]; },
    async runVerification(candidate) {
      verificationCalls.push(structuredClone(candidate));
      if (holdSecondVerification && verificationCalls.length > 1) await secondVerificationGate;
      else await verificationGate;
      try { return await runVerificationLab({ candidate, timeoutMs: 2_000 }); }
      finally { verificationCompletionCount += 1; completion(); }
    },
    async sendToPage(side, message) {
      sent.push({ side, message: structuredClone(message) });
      if (['PREPARE', 'INSPECT'].includes(message.type)) return { ...READY };
      if (message.type === 'EXPORT_MEDIA') return { ok: true, files: structuredClone(exports.get(message.requestId) || []) };
      if (message.type !== 'SEND_PROMPT') return { ok: true };
      let reply;
      if (side === 'boss') {
        const context = block(message.text, 'BOSS_CONTEXT');
        if (holdReplanning && context.user_revision > 0) return { ok: true };
        if (context.completed_work_cycles < context.min_work_cycles) reply = {
          request_id: message.requestId, action: 'dispatch',
          assignments: { left: 'Calculate the exact sum and create answer.txt.', right: 'Independently calculate the sum and create answer.txt.' },
        };
        else if (context.final_verification && Object.values(context.final_verification.workers).length === 2 &&
          Object.values(context.final_verification.workers).every(review => review.verdict === 'accept')) reply = {
          request_id: message.requestId, action: 'finish', candidate_id: context.candidate.id,
          answer: '10, delivered in answer.txt and checked independently.', checks: ['Exact bytes checked locally and by both workers.'], limitations: ['Offline deterministic model fixture.'],
        };
        else reply = { request_id: message.requestId, action: 'verify',
          candidate_result_id: context.result_index.find(result => result.side === 'left' && result.kind === 'work').id };
      } else if (message.text.includes('Perform an independent final check')) {
        const candidate = block(message.text, 'FINAL_CANDIDATE');
        finalContexts.push({ side, candidate, studio: block(message.text, 'STUDIO_CONTRACT') });
        reply = { candidate_id: candidate.id, candidate_sha256: candidate.sha256, verdict: 'accept',
          checks: ['The exact attached answer.txt contains 10 and the independent arithmetic agrees.'], issues: [] };
      } else {
        const file = { id: `output-${message.requestId}`, name: 'answer.txt', mimeType: 'text/plain',
          fingerprint: `fixture-${message.requestId}`, contentSha256: hash(bytes), byteLength: bytes.length,
          base64: bytes.toString('base64') };
        exports.set(message.requestId, [file]);
        queueMicrotask(() => coordinator.pageEvent(side, { type: 'REPLY', runId: message.runId,
          requestId: message.requestId, text: '10; the complete answer.txt is attached.', media: [{ ...file, base64: undefined }] }));
        return { ok: true };
      }
      const response = { type: 'REPLY', runId: message.runId,
        requestId: message.requestId, text: JSON.stringify(reply) };
      if (holdFreshReview && side === 'right' && rightOpenCount > 1) heldFreshReply = response;
      else queueMicrotask(() => coordinator.pageEvent(side, response));
      return { ok: true };
    },
  });

  async function waitFor(predicate, label) {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      if (await predicate()) return;
      const state = await coordinator.getState();
      assert.ok(!['error', 'blocked', 'limit_reached'].includes(state.status), `${label}: ${state.error || state.stage}`);
      await delay(5);
    }
    assert.fail(`${label}: timed out`);
  }
  return { coordinator, sent, finalContexts, verificationCalls, release, releaseFreshOpen, releaseSecondVerification,
    freshReviewHeld: () => heldFreshReply !== null,
    releaseFreshReview: () => coordinator.pageEvent('right', heldFreshReply),
    verificationFinished, waitFor, freshOpenStarted: () => freshOpenStarted, verificationCompletionCount: () => verificationCompletionCount,
    finalPrompts: () => sent.filter(call => call.side !== 'boss' && call.message.type === 'SEND_PROMPT' && call.message.text.includes('Perform an independent final check')),
    async begin() {
      assert.equal((await coordinator.request('OPEN_LAYOUT', { chatMode: 'normal' })).ok, true);
      const start = await coordinator.request('START', { question: 'What is 4 + 6?', requireFiles: true, relayMedia: true,
        studio: { verificationEnabled: true, freshAudit } });
      assert.equal(start.ok, true, start.error);
      await waitFor(() => verificationCalls.length === 1, 'Delayed exact-file verification did not start');
      return coordinator.getState();
    },
  };
}

test('final worker prompts wait for actual local verification and contain its fresh executed file evidence', { timeout: 10_000 }, async t => {
  const h = fixture(); t.after(() => h.coordinator.dispose());
  const waiting = await h.begin();
  assert.equal(waiting.phase, 'boss-local-verification');
  assert.equal(waiting.verificationRounds, 0);
  assert.deepEqual(waiting.pending, {});
  assert.equal(h.finalPrompts().length, 0);
  await delay(30);
  assert.equal(h.finalPrompts().length, 0, 'A slow checker must not expose a stale running receipt to the workers.');
  h.release();
  await h.waitFor(async () => (await h.coordinator.getState()).status === 'agreed', 'Exact file verification and final review did not complete');
  assert.equal(h.finalPrompts().length, 2);
  for (const context of h.finalContexts) {
    assert.equal(context.candidate.sha256, waiting.candidate.sha256);
    const integrity = context.studio.requirements.find(requirement => requirement.id === 'artifact-integrity');
    assert.equal(integrity.status, 'met');
    assert.equal(integrity.source, 'executed');
    assert.equal(integrity.evidence.at(-1).candidateSha256, waiting.candidate.sha256);
  }
  const completed = await h.coordinator.getState();
  assert.equal(completed.verificationRounds, 1);
  assert.equal(completed.candidate.media.files[0].contentSha256, hash(Buffer.from('10\n')));
});

test('Stop remains immediate during a slow local check and its late receipt cannot dispatch final prompts or resurrect the run',
  { timeout: 10_000 }, async t => {
    const h = fixture(); t.after(() => h.coordinator.dispose());
    const before = await h.begin();
    const startedAt = Date.now();
    const stopped = await h.coordinator.stop();
    assert.ok(Date.now() - startedAt < 500, 'Stop was held behind the verification service.');
    assert.equal(stopped.state.status, 'stopped');
    assert.equal(stopped.state.candidate.sha256, before.candidate.sha256);
    assert.equal(h.finalPrompts().length, 0);
    h.release(); await h.verificationFinished;
    await delay(20);
    const after = await h.coordinator.getState();
    assert.equal(after.status, 'stopped');
    assert.equal(after.candidate.sha256, before.candidate.sha256);
    assert.equal(after.studio.verification.status, 'unverified');
    assert.deepEqual(after.pending, {});
    assert.equal(h.finalPrompts().length, 0);
  });

test('a manual local verification receipt during fresh audit opening cannot start a competing boss plan',
  { timeout: 10_000 }, async t => {
    const h = fixture({ freshAudit: true, holdFreshOpen: true, holdSecondVerification: true });
    t.after(() => h.coordinator.dispose());
    await h.begin(); h.release();
    await h.waitFor(h.freshOpenStarted, 'The fresh audit opening did not start');
    const bossCount = h.sent.filter(call => call.side === 'boss' && call.message.type === 'SEND_PROMPT').length;
    const pendingOpen = await h.coordinator.getState();
    assert.equal(pendingOpen.phase, 'boss-fresh-audit');
    assert.deepEqual(pendingOpen.pending, {});
    const manual = await h.coordinator.runVerification();
    assert.equal(manual.ok, true, manual.error);
    await h.waitFor(() => h.verificationCalls.length === 2, 'Manual exact-candidate verification did not start');
    h.releaseSecondVerification();
    await h.waitFor(() => h.verificationCompletionCount() === 2, 'Manual verification did not complete');
    await delay(20);
    assert.equal(h.sent.filter(call => call.side === 'boss' && call.message.type === 'SEND_PROMPT').length, bossCount,
      'A local report started boss planning before the fresh audit finished opening.');
    assert.equal((await h.coordinator.getState()).phase, 'boss-fresh-audit');
    h.releaseFreshOpen();
    await h.waitFor(async () => (await h.coordinator.getState()).status === 'agreed', 'The fresh audit did not finish after its legitimate opening completed');
    assert.equal(h.finalPrompts().length, 3);
    assert.equal((await h.coordinator.getState()).studio.freshAudit.status, 'passed');
  });

test('a completed fresh audit waits for an active manual local verification before boss finalization',
  { timeout: 10_000 }, async t => {
    const h = fixture({ freshAudit: true, holdFreshReview: true, holdSecondVerification: true });
    t.after(() => h.coordinator.dispose());
    await h.begin(); h.release();
    await h.waitFor(h.freshReviewHeld, 'The fresh audit review did not start');
    const bossCount = h.sent.filter(call => call.side === 'boss' && call.message.type === 'SEND_PROMPT').length;
    assert.equal((await h.coordinator.runVerification()).ok, true);
    await h.waitFor(() => h.verificationCalls.length === 2, 'Manual verification did not start');
    await h.releaseFreshReview();
    await delay(20);
    const waiting = await h.coordinator.getState();
    assert.equal(waiting.status, 'running');
    assert.equal(waiting.studio.freshAudit.status, 'passed');
    assert.equal(waiting.studio.verification.status, 'running');
    assert.deepEqual(waiting.pending, {});
    assert.equal(h.sent.filter(call => call.side === 'boss' && call.message.type === 'SEND_PROMPT').length, bossCount);
    h.releaseSecondVerification();
    await h.waitFor(async () => (await h.coordinator.getState()).status === 'agreed', 'The completed local report did not release legitimate finalization');
  });

test('a new user instruction while local verification waits reaches a fresh boss plan without dispatching stale worker checks',
  { timeout: 10_000 }, async t => {
    const h = fixture({ holdReplanning: true }); t.after(() => h.coordinator.dispose());
    const before = await h.begin();
    const addition = await h.coordinator.request('BOSS_MESSAGE', { text: 'Also put a one-line explanation in the same output file.' });
    assert.equal(addition.ok, true, addition.error);
    assert.equal(addition.state.boss.queue.length, 1);
    assert.equal(h.finalPrompts().length, 0);
    h.release();
    await h.waitFor(() => h.sent.some(call => call.side === 'boss' && call.message.type === 'SEND_PROMPT' &&
      block(call.message.text, 'BOSS_CONTEXT').user_revision === 1), 'The latest instruction did not reach a fresh boss planning boundary');
    assert.equal(h.finalPrompts().length, 0);
    const current = await h.coordinator.getState();
    assert.equal(current.status, 'running');
    assert.equal(current.candidate.sha256, before.candidate.sha256);
    assert.equal(current.boss.appliedRevision, 1);
    assert.equal(current.verificationRounds, 0);
    assert.deepEqual(Object.keys(current.pending), ['boss']);
    const prompt = h.sent.filter(call => call.side === 'boss' && call.message.type === 'SEND_PROMPT').at(-1);
    const context = block(prompt.message.text, 'BOSS_CONTEXT');
    assert.match(context.user_instructions.at(-1).text, /one-line explanation/);
    assert.equal(context.studio.verification.status, 'idle', 'The receipt from the superseded instruction revision must not be treated as current.');
    assert.equal(context.studio.requirements.find(requirement => requirement.id === 'artifact-integrity').status, 'unverified');
  });
