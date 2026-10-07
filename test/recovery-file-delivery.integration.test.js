'use strict';

// This is an offline transport integration regression. It runs the production
// coordinator, immutable file store and PDF verification worker. Deterministic
// model replies do not establish live-provider behavior or content quality.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { createBossCoordinator } = require('../src/browser/boss-coordinator');
const { createFileStore, readFileChunks } = require('../src/browser/file-store');
const { runVerificationLab } = require('../src/studio-services/verification-lab');

const READY = { ok: true, ready: true, authenticated: true, temporary: false, work: false,
  unpersonalized: false, busy: false };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function contextOf(message, name = 'BOSS_CONTEXT') {
  const source = message.text.split(`BEGIN_${name}_JSON\n`)[1]?.split(`\nEND_${name}_JSON`)[0];
  assert.ok(source, `Expected explicit ${name} context.`);
  return JSON.parse(source);
}

function pdfBytes(label) {
  const content = `BT /F1 16 Tf 30 100 Td (${label}) Tj ET\n`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 320 160] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  const parts = ['%PDF-1.4\n'], offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(parts.join('')));
    parts.push(`${index + 1} 0 obj\n${object}\nendobj\n`);
  }
  const xref = Buffer.byteLength(parts.join(''));
  parts.push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`);
  parts.push(offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join(''));
  parts.push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return Buffer.from(parts.join(''));
}

async function bytesOf(file) {
  const parts = [];
  for await (const part of readFileChunks(file)) parts.push(part);
  return Buffer.concat(parts);
}

test('a partial stream interruption preserves its completed peer, replans, rejects text-only completion and delivers a verified real PDF',
  { timeout: 30_000 }, async t => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'converge-recovery-pdf-'));
    const store = createFileStore({ directory: path.join(directory, 'files'), makeDefault: false });
    const urls = { left: 'about:blank', right: 'about:blank', boss: 'about:blank' };
    const sent = [], exported = new Map(), verificationReports = [];
    let interruptedRequest = null, coordinator;
    t.after(async () => {
      coordinator?.dispose();
      await store.close();
      const relative = path.relative(os.tmpdir(), directory);
      assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative) && path.basename(directory).startsWith('converge-recovery-pdf-'));
      await fs.rm(directory, { recursive: true, force: true });
    });

    coordinator = createBossCoordinator({
      supervisionIntervalMs: 10,
      requestTimeoutMs: 20_000,
      runTimeoutMs: 25_000,
      async openPage(side, url) { urls[side] = url; },
      getPageUrl(side) { return urls[side]; },
      async runVerification(candidate) {
        const report = await runVerificationLab({ candidate, timeoutMs: 10_000 });
        verificationReports.push(report);
        return report;
      },
      async sendToPage(side, message) {
        sent.push({ side, message: structuredClone(message) });
        if (['INSPECT', 'PREPARE'].includes(message.type)) return { ...READY };
        if (message.type === 'UPLOAD_FILES') return { ok: true, attached: message.files.length };
        if (message.type === 'EXPORT_MEDIA') return { ok: true,
          files: structuredClone(exported.get(`${message.runId}:${message.requestId}`) || []) };
        if (message.type === 'INSPECT_PROGRESS') {
          const interrupted = side === 'left' && message.requestId === interruptedRequest;
          return { ok: true, owned: true, requestId: message.requestId, active: !interrupted,
            generating: !interrupted, generationBusy: !interrupted, interrupted,
            interruptionKind: interrupted ? 'stream-interrupted' : null, newerUserMessage: false,
            visibleResult: interrupted ? 'Partial section draft. The requested file has not been produced.' : '',
            status: interrupted ? 'Resume stream is not available' : 'Still generating' };
        }
        return { ok: true };
      },
    });

    async function waitFor(predicate, label) {
      const deadline = Date.now() + 12_000;
      while (Date.now() < deadline) {
        if (await predicate()) return;
        const current = await coordinator.getState();
        assert.ok(!['error', 'blocked', 'limit_reached'].includes(current.status), `${label}: ${current.error || current.stage}`);
        await delay(5);
      }
      assert.fail(`${label}: deadline exceeded`);
    }
    const prompts = () => sent.filter(call => call.message.type === 'SEND_PROMPT');
    const bossPrompts = () => prompts().filter(call => call.side === 'boss');
    async function reply(call, value, media) {
      const result = await coordinator.pageEvent(call.side, { type: 'REPLY', runId: call.message.runId,
        requestId: call.message.requestId, text: typeof value === 'string' ? value : JSON.stringify(value), ...(media ? { media } : {}) });
      assert.equal(result.ok, true, result.error);
    }
    async function currentBoss(number) {
      await waitFor(() => bossPrompts().length >= number, `Boss request ${number} was not sent`);
      return bossPrompts()[number - 1];
    }
    async function dispatch(call, label) {
      const before = prompts().filter(item => item.side !== 'boss').length;
      await reply(call, { request_id: call.message.requestId, action: 'dispatch', summary: label,
        assignments: { left: `${label}: produce the complete PDF.`, right: `${label}: independently inspect completeness.` } });
      await waitFor(() => prompts().filter(item => item.side !== 'boss').length === before + 2, 'Fresh worker assignments were not sent');
      return prompts().filter(item => item.side !== 'boss').slice(-2);
    }
    async function completePair(call, label) {
      const workers = await dispatch(call, label);
      for (const worker of workers) await reply(worker, `Intermediate inspection ${label} ${worker.side}; no actual file produced.`);
      return workers;
    }

    const originalBytes = pdfBytes('Original source');
    const source = await store.ingestStream((async function* () { yield originalBytes; })(), { name: 'original.pdf', mimeType: 'application/pdf' });
    assert.equal((await coordinator.request('OPEN_LAYOUT', { chatMode: 'normal' })).ok, true);
    assert.equal((await coordinator.request('ATTACH_FILES', { files: [source] })).ok, true);
    const start = await coordinator.request('START', { question: 'Correct the attached PDF and return a complete downloadable PDF with all requested content.',
      requireFiles: true, relayMedia: true, reviewMode: 'improve', maxRounds: 6,
      studio: { preset: 'document', verificationEnabled: true, freshAudit: false } });
    assert.equal(start.ok, true, start.error);

    const first = await dispatch(await currentBoss(1), 'Initial pass');
    const left = first.find(call => call.side === 'left'), right = first.find(call => call.side === 'right');
    await reply(right, 'Completed independent inspection: the original page needs a corrected heading.');
    await waitFor(async () => (await coordinator.getState()).workerResults.length === 1, 'The healthy peer result was not retained');
    interruptedRequest = left.message.requestId;
    const recovery = await currentBoss(2), recoveryContext = contextOf(recovery.message);
    assert.equal(recoveryContext.completed_work_cycles, 0);
    assert.equal(recoveryContext.worker_results.length, 1);
    assert.equal(recoveryContext.worker_results[0].side, 'right');
    assert.equal(recoveryContext.worker_interruption_reports[0].requestId, interruptedRequest);
    assert.match(recoveryContext.worker_interruption_reports[0].diagnostic, /Resume stream/);
    assert.match(recoveryContext.worker_interruption_reports[0].partial_visible_result, /not been produced/);
    assert.equal(sent.some(call => call.side === 'right' && call.message.type === 'CANCEL'), false);
    const retirement = sent.find(call => call.side === 'left' && call.message.type === 'CANCEL');
    assert.equal(retirement.message.stopGeneration, false);
    assert.equal(retirement.message.cancelRun, false);
    const late = await coordinator.pageEvent('left', { type: 'REPLY', runId: left.message.runId,
      requestId: left.message.requestId, text: 'Late partial text must not become a completed answer.' });
    assert.equal(late.ignored, true);

    await reply(recovery, { request_id: recovery.message.requestId, action: 'repair', side: 'left',
      assignment: 'Continue the saved PDF checkpoint and produce the full requested deliverable.' });
    await waitFor(() => prompts().filter(item => item.side === 'left').length === 2, 'The failed worker did not receive its focused repair');
    const recovered = prompts().filter(item => item.side === 'left').at(-1);
    assert.notEqual(recovered.message.requestId, left.message.requestId);
    assert.notEqual(recovered.message.text, left.message.text);
    assert.equal(prompts().filter(item => item.side === 'right').length, 1, 'The healthy peer must not be repeated.');
    await reply(recovered, 'Actual resumed intermediate inspection; no final artifact yet.');
    for (let round = 2; round <= 4; round += 1) await completePair(await currentBoss(round + 1), `Inspection ${round}`);
    const textOnlyPlan = await currentBoss(6), textContext = contextOf(textOnlyPlan.message);
    assert.equal(textContext.completed_work_cycles, 4);
    const textOnly = textContext.worker_results.find(result => result.side === 'left');
    const workersBeforeGate = prompts().filter(call => call.side !== 'boss').length;
    await reply(textOnlyPlan, { request_id: textOnlyPlan.message.requestId, action: 'verify', candidate_result_id: textOnly.id });
    const repair = await currentBoss(7), repairContext = contextOf(repair.message);
    assert.match(repairContext.control_repair.error, /required downloadable output/);
    assert.equal(prompts().filter(call => call.side !== 'boss').length, workersBeforeGate);
    assert.equal((await coordinator.getState()).status, 'running');

    const production = await dispatch(repair, 'Produce corrected actual PDF');
    const producer = production.find(call => call.side === 'left');
    const finalBytes = pdfBytes('Corrected complete document');
    const output = await store.ingestStream((async function* () { yield finalBytes; })(), { name: 'corrected.pdf', mimeType: 'application/pdf' });
    const artifact = { ...output, id: `artifact-${producer.message.requestId}`, fingerprint: hash(finalBytes) };
    exported.set(`${producer.message.runId}:${producer.message.requestId}`, [artifact]);
    await reply(producer, 'Corrected complete PDF created with the requested heading. Actual file attached.', [{ ...artifact }]);
    await reply(production.find(call => call.side === 'right'), 'Independent review: inspect the newly produced corrected PDF.');
    const verifyPlan = await currentBoss(8), verifyContext = contextOf(verifyPlan.message);
    assert.equal(verifyContext.completed_work_cycles, 5);
    const actual = verifyContext.worker_results.find(result => result.side === 'left');
    assert.equal(actual.media.files[0].contentSha256, hash(finalBytes));
    const bossFile = verifyPlan.message.files.find(file => /corrected\.pdf$/.test(file.name));
    assert.ok(bossFile, 'The boss did not receive actual generated bytes.');
    assert.deepEqual(await bytesOf(bossFile), finalBytes);
    const beforeVerify = prompts().filter(call => call.side !== 'boss').length;
    await reply(verifyPlan, { request_id: verifyPlan.message.requestId, action: 'verify', candidate_result_id: actual.id });
    await waitFor(() => prompts().filter(call => call.side !== 'boss').length === beforeVerify + 2, 'Exact final checks did not start');
    const checks = prompts().filter(call => call.side !== 'boss').slice(-2);
    const exactCandidate = contextOf(checks[0].message, 'FINAL_CANDIDATE');
    for (const check of checks) {
      const candidate = contextOf(check.message, 'FINAL_CANDIDATE');
      assert.equal(candidate.sha256, exactCandidate.sha256);
      const attached = check.message.files.find(file => /^CANDIDATE_.*corrected\.pdf$/.test(file.name));
      assert.ok(attached, `${check.side} did not receive the accepted candidate file.`);
      assert.deepEqual(await bytesOf(attached), finalBytes);
      assert.match(check.message.text, /Also return documentReview/);
      // These are deterministic model-review claims for this one-page test
      // fixture. The separate verificationReports below contain the real
      // parser/rasterizer results; neither establishes live model quality.
      await reply(check, { candidate_id: candidate.id, candidate_sha256: candidate.sha256, verdict: 'accept',
        checks: ['Inspected the exact attached corrected heading and complete page.'], issues: [],
        documentReview: { files: [{ name: 'corrected.pdf', contentSha256: hash(finalBytes), pageCount: 1,
          renderedPages: [1], inspectedPages: [1] }], checks: {
          typography: 'The one-page fixture has a readable standard Helvetica heading at 16 point.',
          spacing: 'The heading is positioned inside the page boundary with clear surrounding whitespace.',
          mathematics: 'This heading-only recovery fixture contains no mathematical derivations to inspect.',
          figures: 'This heading-only one-page fixture contains no figures or captions to inspect.',
          referenceStyle: 'No style reference was selected; the fixture preserves its simple readable heading design.' }, limitations: [] },
        requirementReviews: ['task-complete', 'document-review', 'document-content'].map(id => ({ id, status: 'met',
          evidence: 'The entire requested one-page fixture source scope is retained, with its corrected heading and no missing sections.' })) });
    }
    const finishPlan = await currentBoss(9);
    const finishContext = contextOf(finishPlan.message);
    assert.ok(Object.values(finishContext.final_verification.workers).every(review => review.verdict === 'accept'));
    assert.equal(verificationReports.length, 1);
    assert.equal(verificationReports[0].checks.find(check => check.id.startsWith('pdf-structure:')).status, 'passed');
    assert.equal(verificationReports[0].checks.find(check => check.id.startsWith('pdf-structure:')).pageCount, 1);
    assert.equal(verificationReports[0].checks.find(check => check.id.startsWith('pdf-rendering:')).status, 'passed');
    await reply(finishPlan, { request_id: finishPlan.message.requestId, action: 'finish', candidate_id: exactCandidate.id,
      answer: 'Corrected PDF delivered; exact artifact and both independent reviews are recorded.',
      checks: ['Actual PDF parsed and rasterized locally.', 'Both workers reviewed the same candidate.'],
      limitations: ['Offline fixture only; no live-provider or model quality claim.'] });
    const final = await coordinator.getState();
    assert.equal(final.status, 'agreed', final.error);
    assert.equal(final.round, 5);
    assert.equal(final.workerResults.length, 12);
    assert.ok(final.supervision.events.some(event => event.type === 'interrupted' && event.side === 'left'));
    const privateCandidate = await coordinator.getCurrentCandidate();
    assert.deepEqual(await bytesOf(privateCandidate.files[0]), finalBytes);
    assert.equal(privateCandidate.files[0].contentSha256, hash(finalBytes));
    assert.equal(final.workerResults.some(result => /Late partial text/.test(result.text)), false);
  });

test('both first-turn worker interruptions refresh actual original PDF bytes instead of assuming consumed composer attachments remain',
  { timeout: 10_000 }, async t => {
    const urls = { left: 'about:blank', right: 'about:blank', boss: 'about:blank' };
    const composers = { left: new Map(), right: new Map(), boss: new Map() };
    const sent = [], interrupted = new Set();
    const sourceBytes = pdfBytes('Original dual recovery source');
    let coordinator;
    coordinator = createBossCoordinator({ supervisionIntervalMs: 5,
      async openPage(side, url) { urls[side] = url; }, getPageUrl(side) { return urls[side]; },
      async sendToPage(side, message) {
        sent.push({ side, message: structuredClone(message) });
        if (['INSPECT', 'PREPARE'].includes(message.type)) return { ...READY };
        if (message.type === 'UPLOAD_FILES') {
          for (const file of message.files) composers[side].set(file.name, file);
          return { ok: true, attached: message.files.length };
        }
        if (message.type === 'SEND_PROMPT') {
          for (const file of message.files || []) composers[side].set(file.name, file);
          const missing = (message.expectedSourceNames || []).filter(name => !composers[side].has(name));
          if (missing.length) return { ok: false, error: `Fixture confirmed missing consumed attachments: ${missing.join(', ')}` };
          composers[side].clear();
        }
        if (message.type === 'INSPECT_PROGRESS') {
          const stopped = interrupted.has(message.requestId);
          return { ok: true, owned: true, requestId: message.requestId, active: !stopped,
            generating: !stopped, generationBusy: !stopped, interrupted: stopped,
            interruptionKind: stopped ? 'stream-interrupted' : null, newerUserMessage: false,
            status: stopped ? 'Resume stream is not available' : 'Still generating' };
        }
        return { ok: true };
      },
    });
    t.after(() => coordinator.dispose());
    const prompts = side => sent.filter(call => call.message.type === 'SEND_PROMPT' && (!side || call.side === side));
    async function waitFor(predicate, label) {
      const deadline = Date.now() + 3_000;
      while (Date.now() < deadline) {
        if (await predicate()) return;
        const state = await coordinator.getState();
        assert.equal(state.status, 'running', `${label}: ${state.error || state.stage}`);
        await delay(5);
      }
      assert.fail(`${label}: deadline exceeded`);
    }
    async function dispatchBoss(call, label) {
      const event = await coordinator.pageEvent('boss', { type: 'REPLY', runId: call.message.runId,
        requestId: call.message.requestId, text: JSON.stringify({ request_id: call.message.requestId, action: 'dispatch',
          assignments: { left: `${label} produce complete corrected PDF`, right: `${label} independently inspect original PDF` } }) });
      assert.equal(event.ok, true, event.error);
    }

    assert.equal((await coordinator.request('OPEN_LAYOUT', { chatMode: 'normal' })).ok, true);
    const attached = await coordinator.request('ATTACH_FILES', { files: [{ name: 'original.pdf', mimeType: 'application/pdf', base64: sourceBytes.toString('base64') }] });
    assert.equal(attached.ok, true, attached.error);
    const started = await coordinator.request('START', { question: 'Correct this original PDF and return the complete downloadable PDF.', relayMedia: true, requireFiles: true });
    assert.equal(started.ok, true, started.error);
    await waitFor(() => prompts('boss').length === 1, 'Initial boss plan did not submit');
    await dispatchBoss(prompts('boss')[0], 'First');
    await waitFor(() => prompts('left').length === 1 && prompts('right').length === 1, 'Initial worker pair did not submit');
    for (const side of ['left', 'right']) {
      interrupted.add(prompts(side)[0].message.requestId);
      assert.equal(composers[side].size, 0, 'The first real send must consume composer attachments.');
    }
    await waitFor(() => prompts('boss').length === 2, 'Confirmed pair interruption did not produce one recovery plan');
    const context = contextOf(prompts('boss')[1].message);
    assert.equal(context.completed_work_cycles, 0);
    assert.equal(context.worker_results.length, 0);
    assert.equal(context.worker_interruption_reports.length, 2);
    async function repairBoss(call, side) {
      const event = await coordinator.pageEvent('boss', { type: 'REPLY', runId: call.message.runId,
        requestId: call.message.requestId, text: JSON.stringify({ request_id: call.message.requestId, action: 'repair',
          side, assignment: 'Continue useful saved work and inspect the entire original PDF.' }) });
      assert.equal(event.ok, true, event.error);
    }
    await repairBoss(prompts('boss')[1], context.recovery_task.side);
    await waitFor(() => prompts('boss').length === 3, 'The second failed worker did not get its separate repair plan');
    await repairBoss(prompts('boss')[2], contextOf(prompts('boss')[2].message).recovery_task.side);
    await waitFor(() => prompts('left').length === 2 && prompts('right').length === 2, 'Recovery pair did not submit');
    for (const side of ['left', 'right']) {
      const recovered = prompts(side)[1].message;
      const refreshed = recovered.files?.find(file => file.name === 'ORIGINAL_original.pdf');
      assert.ok(refreshed, `${side} recovery did not refresh its consumed original PDF.`);
      assert.deepEqual(Buffer.from(refreshed.base64, 'base64'), sourceBytes);
      assert.notEqual(recovered.requestId, prompts(side)[0].message.requestId);
    }
    assert.equal((await coordinator.getState()).status, 'running');
    assert.equal(sent.filter(call => call.message.type === 'CANCEL').length, 2);
    assert.ok(sent.filter(call => call.message.type === 'CANCEL').every(call => call.message.stopGeneration === false));
  });
