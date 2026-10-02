'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const {
  initialState, installCoordinator, parseReview, draftPrompt, reviewPrompt, setCandidate, applyReview,
  hasAgreement, mediaContentFingerprint,
} = require('../background');

const accept = (candidateId, resolvedIssueIds = []) => ({ candidateId, verdict: 'accept', issues: [],
  revisedAnswer: '', resolvedIssueIds, uncertainties: [], checks: ['Checked the complete result against the source.', 'Compared the requested constraints.'] });
const improvement = (candidateId, revisedAnswer) => ({ candidateId, verdict: 'improve', issues: [],
  improvements: [{ change: 'Group the instructions into ordered steps.', benefit: 'The user can follow the procedure without backtracking.',
    evidence: 'The same three operations and constraints remain, now in execution order.' }],
  revisedAnswer, resolvedIssueIds: [], uncertainties: [],
  checks: ['All three original operations are retained.', 'The operation order follows the required dependencies.'] });
const metadata = (name, mimeType = 'application/pdf', fingerprint = name) => ({ id: name, name, mimeType, fingerprint });
const hashed = (file, bytes) => ({ ...file, contentSha256: createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.length });

function harness(t, { image = false, blockExport = false } = {}) {
  const state = initialState(); state.status = 'setup'; state.tabIds = { left: 10, right: 11 };
  const stored = { convergeState: state }, sent = [], payloads = new Map(); let listener, finishExport;
  const chrome = {
    runtime: { onMessage: { addListener(fn) { listener = fn; } }, onInstalled: { addListener() {} } },
    sidePanel: { async setPanelBehavior() {} },
    storage: { session: { async get(key) { return { [key]: structuredClone(stored[key]) }; }, async set(value) { Object.assign(stored, structuredClone(value)); } } },
    tabs: { async get(id) { return { id, url: 'https://chatgpt.com/' }; }, async sendMessage(id, message) {
      sent.push({ id, message: structuredClone(message) });
      if (message.type === 'EXPORT_MEDIA') {
        const files = message.ids.map((key) => {
          const { file, bytes } = payloads.get(key);
          return { ...hashed(file, bytes), base64: bytes.toString('base64') };
        });
        if (blockExport) return new Promise(resolve => { finishExport = () => resolve({ ok: true, files }); });
        return { ok: true, files };
      }
      if (message.type === 'UPLOAD_FILES') return { ok: true, attached: message.files.length };
      return { ok: true, ready: true, authenticated: true, temporary: true, unpersonalized: true, busy: false };
    }, onRemoved: { addListener() {} }, onUpdated: { addListener() {} } },
    alarms: { async clear() {}, async create() {}, onAlarm: { addListener() {} } },
  };
  installCoordinator(chrome);
  const send = (message, id) => new Promise(resolve => listener(message, id ? { tab: { id, url: 'https://chatgpt.com/' } } : {}, resolve));
  const settle = () => new Promise(resolve => setImmediate(resolve));
  const waitFor = async predicate => { for (let i = 0; i < 50 && !predicate(); i++) await settle(); assert.ok(predicate(), 'coordinator did not reach the expected state'); };
  const prompts = () => sent.filter(item => item.message.type === 'SEND_PROMPT');
  const reply = async (call, value, media) => {
    const result = await send({ type: 'REPLY', runId: call.message.runId, requestId: call.message.requestId,
      text: typeof value === 'string' ? value : JSON.stringify(value), ...(media ? { media } : {}) }, call.id);
    await settle(); return result;
  };
  const output = (file, text) => { payloads.set(file.id, { file, bytes: Buffer.from(text) }); return file; };
  const attach = async name => {
    const result = await send({ type: 'ATTACH_FILES', files: [{ name, mimeType: 'application/pdf', base64: Buffer.from('original-source-worksheet-bytes').toString('base64') }] });
    assert.equal(result.ok, true);
  };
  t.after(async () => { finishExport?.(); if (stored.convergeState.status === 'running') await send({ type: 'STOP' }); });
  return { stored, sent, send, reply, prompts, waitFor, settle, output, attach, finishExport: () => finishExport?.(), async start() {
    await send({ type: 'START', question: image ? 'Improve this image.' : 'Correct this PDF.', reviewMode: 'improve',
      maxRounds: 4, relayMedia: true, requireFiles: !image, confirmTemporary: true }); await settle();
  }, async drafts() {
    await this.start();
    const [left, right] = prompts(), file = output(metadata(image ? 'original.png' : 'original.pdf', image ? 'image/png' : 'application/pdf'), 'original-file-bytes');
    await reply(left, { answer: 'The original deliverable.', uncertainties: [] }, [file]);
    await reply(right, { answer: 'An independent alternative.', uncertainties: [] }, [file]);
    await waitFor(() => prompts().length === 3); return prompts().at(-1);
  } };
}

test('constructive comparison shows BOTH independent drafts and preceding replacement claims', () => {
  const state = initialState(); Object.assign(state, { question: 'Explain a procedure.', reviewMode: 'improve', minReviewRounds: 4,
    round: 2, drafts: { left: { answer: 'Left approach.' }, right: { answer: 'Right approach with a useful alternative.' } } });
  setCandidate(state, 'Old complete procedure.');
  applyReview(state, 'right', improvement('C1', 'A complete ordered procedure.'));
  const prompt = reviewPrompt(state, 'left');
  assert.match(prompt, /Left approach/); assert.match(prompt, /Right approach with a useful alternative/);
  assert.match(prompt, /Deliberately develop a concrete alternative/);
  assert.match(prompt, /Preceding candidate C1/); assert.match(prompt, /Old complete procedure/);
  assert.match(prompt, /claims to check, not proof/); assert.match(prompt, /before accepting/i);
});

test('coding drafts and exact-candidate reviews require external contract adversarial execution and full complexity costs', () => {
  const state = initialState(); state.question = 'Implement a scheduler, maximizing profit then minimizing jobs then lexicographically ordering their external IDs. Explain the final complexity.';
  setCandidate(state, 'An implementation with internal index tuples.');
  for (const prompt of [draftPrompt(state, 'left'), reviewPrompt(state, 'right')]) {
    assert.match(prompt, /distinct adversarial cases for EACH stated ordering and tie-breaking priority/);
    assert.match(prompt, /derive the expected external result from the user specification/);
    assert.match(prompt, /execute the actual function when tools are available/);
    assert.match(prompt, /comparison keys, internal representations, and final returned values/);
    assert.match(prompt, /internal indices must not silently stand in for external IDs or labels/);
    assert.match(prompt, /costs of tuple\/list copies, sorting, and comparisons in the complete final code/);
    assert.match(prompt, /independent simple or exhaustive reference directly from the specification/);
    assert.match(prompt, /adversarial cases and seeded tiny cases/);
    assert.match(prompt, /must not reuse the main algorithm's decisions, recurrence, or comparison logic/);
    assert.match(prompt, /actual executions and observed outcomes/);
    assert.match(prompt, /maximizing profit then minimizing jobs then lexicographically ordering their external IDs/);
    assert.doesNotMatch(prompt, /238\/340|337\/340|job(?:s)?\s*=\s*\[/);
  }
});

test('unresolved major or critical source defects override optional polish focus', () => {
  const state = initialState(); Object.assign(state, { question: 'Solve the complete worksheet.', reviewMode: 'improve',
    round: 2, candidate: { id: 'C1', text: 'A incomplete document.' },
    sourceNames: ['original-worksheet.pdf'], issues: [{ id: 'I1', severity: 'major', problem: 'All required subparts are absent.', resolved: false }] });
  const prompt = reviewPrompt(state, 'right');
  assert.match(prompt, /complete and correct every unresolved major or critical source requirement before any optional polish/);
  assert.match(prompt, /Unresolved correctness and completeness defects take priority/);
  assert.match(prompt, /ALL required original subparts and full workings/);
  assert.match(prompt, /Authoritative ORIGINAL USER SOURCE FILES: original-worksheet.pdf/);
  assert.match(prompt, /NOT the current candidate output files/);
  assert.match(prompt, /item-by-item requirement map/);
  assert.match(prompt, /exact given numerical inputs and units/);
});

test('a positive refinement needs change evidence and two checks, without a manufactured issue', () => {
  const report = improvement('C1', 'Step 1. Read. Step 2. Validate. Step 3. Submit.');
  assert.equal(parseReview(JSON.stringify(report), 'C1').verdict, 'improve');
  assert.throws(() => parseReview(JSON.stringify({ ...report, improvements: [] }), 'C1'), /specific change/);
  assert.throws(() => parseReview(JSON.stringify({ ...report, improvements: [{ change: 'Better.', benefit: '', evidence: 'Trust me.' }] }), 'C1'), /improvements list/);
  assert.throws(() => parseReview(JSON.stringify({ ...report, checks: ['Only one check.'] }), 'C1'), /two specific checks/);
  const state = initialState(); setCandidate(state, 'Submit after validating what you read.');
  applyReview(state, 'right', report);
  assert.equal(state.candidate.id, 'C2'); assert.equal(state.revisionCount, 1);
  assert.deepEqual(state.issues, []); assert.deepEqual(state.acceptedBy, {});
  assert.equal(state.candidateHistory[0].status, 'superseded');
  assert.equal(state.candidateHistory[1].author, 'right'); assert.equal(state.candidateHistory[1].status, 'proposed');
  assert.equal(state.improvementTrail[0].kind, 'refinement'); assert.equal(state.improvementTrail[0].verified, false);
  applyReview(state, 'left', accept('C2')); assert.equal(hasAgreement(state), false);
  assert.equal(state.improvementTrail[0].verified, false);
  applyReview(state, 'right', accept('C2')); assert.equal(hasAgreement(state), true);
  assert.equal(state.candidateHistory[1].status, 'verified'); assert.equal(state.improvementTrail[0].verified, true);
});

test('repeated unchanged accepts remain honest checks, never reported revisions', () => {
  const state = initialState(); state.minReviewRounds = 4; setCandidate(state, 'The complete answer already satisfies the request.');
  for (let round = 1; round <= 4; round++) {
    state.round = round; state.acceptedBy = {}; applyReview(state, 'right', accept('C1')); applyReview(state, 'left', accept('C1'));
    assert.equal(hasAgreement(state), round === 4);
  }
  assert.equal(state.revisionCount, 0); assert.deepEqual(state.improvementTrail, []); assert.equal(state.candidateHistory.length, 1);
});

test('renaming or re-exposing identical verified bytes does not create a revised file', () => {
  const state = initialState(), bytes = Buffer.from('unchanged-pdf');
  const first = { side: 'left', runId: 'run', requestId: 'r1', files: [hashed(metadata('old.pdf'), bytes)] };
  const copied = { side: 'right', runId: 'run', requestId: 'r2', files: [hashed(metadata('renamed(2).pdf'), bytes)] };
  assert.equal(mediaContentFingerprint(first), mediaContentFingerprint(copied));
  setCandidate(state, 'The complete document.', first);
  assert.equal(setCandidate(state, 'The complete document.', copied), false);
  assert.equal(state.candidate.id, 'C1'); assert.equal(state.revisionCount, 0);
  assert.equal(state.candidate.media.requestId, 'r1');
});

test('required PDF challenge with NONEMPTY revised text requests actual creation then verifies changed bytes', async t => {
  const h = harness(t), review = await h.drafts(), original = structuredClone(h.stored.convergeState.candidate);
  const report = { ...accept('C1'), verdict: 'challenge',
    issues: [{ severity: 'major', problem: 'The document contains the wrong total.', evidence: 'The displayed total is 3; 2+2=4.', correction: 'Change the total to 4 in the PDF.' }],
    revisedAnswer: 'I changed the total to 4 in the complete corrected PDF.' };
  await h.reply(review, report); await h.waitFor(() => h.prompts().length === 4);
  const creation = h.prompts().at(-1);
  assert.equal(creation.id, review.id); assert.match(creation.message.text, /Create and expose an actual revised PDF/);
  assert.deepEqual(h.stored.convergeState.candidate, original); assert.equal(h.stored.convergeState.revisionCount, 0);
  assert.equal(h.stored.convergeState.pending.right.substantiveCorrectionAttempts, 1);
  const replacement = h.output(metadata('corrected.pdf'), 'genuinely-corrected-pdf-bytes');
  await h.reply(creation, report, [replacement]); await h.waitFor(() => h.stored.convergeState.candidate?.id === 'C2');
  assert.equal(h.stored.convergeState.candidate.media.files[0].contentSha256, createHash('sha256').update('genuinely-corrected-pdf-bytes').digest('hex'));
  assert.equal(h.stored.convergeState.improvementTrail[0].fileChangeVerified, true);
  assert.equal(h.stored.convergeState.improvementTrail[0].verified, false);
  for (let count = 0; count < 10 && h.stored.convergeState.status === 'running'; count++) {
    const call = h.prompts().at(-1);
    await h.reply(call, accept(h.stored.convergeState.candidate.id, h.stored.convergeState.issues.map(issue => issue.id)));
  }
  assert.equal(h.stored.convergeState.status, 'agreed'); assert.equal(h.stored.convergeState.round, 4);
  assert.equal(h.stored.convergeState.improvementTrail[0].verified, true);
  assert.doesNotMatch(JSON.stringify(h.stored), /base64|Z2VudWluZWx5/);
});

test('required image refinement cannot inherit the old image or substitute a PDF during creation', async t => {
  const h = harness(t, { image: true }), review = await h.drafts(), original = structuredClone(h.stored.convergeState.candidate);
  const report = improvement('C1', 'A refined image with cleaner edges.');
  await h.reply(review, report); await h.waitFor(() => h.prompts().length === 4);
  assert.deepEqual(h.stored.convergeState.candidate, original);
  assert.match(h.prompts().at(-1).message.text, /actual revised image/);
  const wrongType = h.output(metadata('description.pdf'), 'a-description-in-a-pdf');
  await h.reply(h.prompts().at(-1), report, [wrongType]); await h.waitFor(() => h.stored.convergeState.status === 'error');
  assert.match(h.stored.convergeState.error, /required corrected image after one substantive/);
  assert.deepEqual(h.stored.convergeState.candidate, original);
});

test('identical file bytes with an improvement claim trigger one real creation attempt', async t => {
  const h = harness(t), review = await h.drafts(), original = structuredClone(h.stored.convergeState.candidate);
  const renamed = h.output(metadata('renamed.pdf'), 'original-file-bytes');
  await h.reply(review, improvement('C1', 'Claimed improved PDF.'), [renamed]);
  await h.waitFor(() => h.prompts().length === 4);
  assert.match(h.prompts().at(-1).message.text, /changed contents/);
  assert.deepEqual(h.stored.convergeState.candidate, original); assert.equal(h.stored.convergeState.revisionCount, 0);
  await h.reply(h.prompts().at(-1), improvement('C1', 'Another claim.'), [renamed]);
  await h.waitFor(() => h.stored.convergeState.status === 'error');
  assert.equal(h.prompts().length, 4); assert.equal(h.stored.convergeState.revisionCount, 0);
});

test('Stop remains responsive during output verification and ignores the late downloaded bytes', async t => {
  const h = harness(t, { blockExport: true }); await h.start();
  const file = h.output(metadata('slow.pdf'), 'slow-export-bytes');
  await h.reply(h.prompts()[0], { answer: 'A generated PDF.', uncertainties: [] }, [file]);
  await h.waitFor(() => h.sent.some(item => item.message.type === 'EXPORT_MEDIA'));
  assert.equal((await h.send({ type: 'STOP' })).state.status, 'stopped');
  h.finishExport(); await h.settle(); await h.settle();
  assert.equal(h.stored.convergeState.status, 'stopped'); assert.equal(h.stored.convergeState.candidate, null);
  assert.equal(h.prompts().length, 2); assert.deepEqual(h.stored.convergeState.pending, {});
});

test('a missing required draft file gets one tool-creation followup, then verified bytes enter review', async t => {
  const h = harness(t);
  await h.attach('source.pdf');
  await h.start(); const [left, right] = h.prompts();
  const originalDeadline = h.stored.convergeState.pending.left.deadline;
  await h.reply(left, { answer: 'I created corrected.pdf.', uncertainties: [] });
  await h.waitFor(() => h.prompts().length === 3);
  const creation = h.prompts().at(-1);
  assert.equal(creation.id, left.id); assert.notEqual(creation.message.requestId, left.message.requestId);
  assert.match(creation.message.text, /required draft output creation/);
  assert.match(creation.message.text, /observed NO accessible downloadable PDF/);
  assert.match(creation.message.text, /filename typed inside JSON is not an attachment/);
  assert.match(creation.message.text, /CREATE and SAVE/); assert.match(creation.message.text, /source.pdf/);
  for (const call of [left, right, creation]) {
    assert.match(call.message.text, /execute every numerical substitution/);
    assert.match(call.message.text, /exact formula, source inputs, computed value, units, and rounded printed value/);
    assert.match(call.message.text, /multiple questions or subparts/);
    assert.match(call.message.text, /Authoritative ORIGINAL USER SOURCE FILES: source.pdf/);
    assert.match(call.message.text, /NOT the current candidate output files/);
    assert.doesNotMatch(call.message.text, /Return exactly one valid JSON object/);
    assert.match(call.message.text, /No JSON/);
  }
  assert.match(left.message.text, /REOPEN the actual saved file/);
  assert.match(left.message.text, /Compare every original question\/subpart/);
  assert.match(creation.message.text, /REOPEN the actual saved file/);
  assert.match(creation.message.text, /full solutions actually present/);
  assert.equal(creation.message.files[0].name, 'ORIGINAL_SOURCE_1__source.pdf');
  assert.equal(creation.message.files.length, 1, 'creation refreshes the source without duplicating the candidate');
  assert.equal(h.stored.convergeState.pending.left.deadline, originalDeadline);
  assert.equal(h.stored.convergeState.pending.left.draftOutputAttempts, 1);
  assert.equal(h.stored.convergeState.drafts.left, undefined);
  const independent = h.output(metadata('independent.pdf'), 'independent-draft-pdf-bytes');
  await h.reply(right, { answer: 'An independent completed PDF.', uncertainties: [] }, [independent]);
  await h.waitFor(() => Boolean(h.stored.convergeState.drafts.right));
  assert.equal(h.stored.convergeState.candidate, null);
  const completed = h.output(metadata('corrected.pdf'), 'actual-completed-pdf-bytes');
  await h.reply(creation, { answer: 'Completed corrected.pdf.', uncertainties: [] }, [completed]);
  await h.waitFor(() => h.stored.convergeState.candidate?.id === 'C1' && h.prompts().length === 4);
  assert.equal(h.stored.convergeState.candidate.media.files[0].contentSha256, createHash('sha256').update('actual-completed-pdf-bytes').digest('hex'));
  assert.equal(h.prompts().at(-1).id, right.id);
  assert.deepEqual(h.prompts().at(-1).message.files.map(file => file.name), ['ORIGINAL_SOURCE_1__source.pdf', 'corrected.pdf']);
  const actualReviewPrompt = h.prompts().at(-1).message.text;
  assert.match(actualReviewPrompt, /EVERY original question\/subpart/);
  assert.match(actualReviewPrompt, /shorter summary or review-notes document is a regression/);
  assert.match(actualReviewPrompt, /REOPEN that actual saved file/);
  assert.match(actualReviewPrompt, /values actually printed in the attached file/);
  assert.match(actualReviewPrompt, /actual observed readback results/);
  assert.equal(h.stored.convergeState.status, 'running');
  assert.equal(h.stored.convergeState.transcript.filter(item => item.role === 'missing-output').length, 1);
});

test('natural file production preserves the valid critique and proposes bytes needing two fresh exact checks', async t => {
  const h = harness(t);
  await h.attach('original-worksheet.pdf');
  await h.start(); const [left, right] = h.prompts();
  const first = h.output(metadata('draft-a.pdf'), 'initial-complete-document-bytes');
  const second = h.output(metadata('draft-b.pdf'), 'independent-complete-document-bytes');
  await h.reply(left, 'I solved every source subpart and created draft-a.pdf. Download the actual PDF.', [first]);
  await h.reply(right, 'Here is my independently solved draft-b.pdf with actual calculations.', [second]);
  await h.waitFor(() => h.prompts().length === 3);
  assert.equal(h.stored.convergeState.drafts.left.answer, 'I solved every source subpart and created draft-a.pdf. Download the actual PDF.');
  const initialReview = h.prompts().at(-1);
  assert.match(initialReview.message.text, /Return exactly one valid JSON object/);
  const positive = improvement('C1', 'The improved document will preserve all subparts and explain the unit conversion.');
  positive.issues = [{ severity: 'major', problem: 'The calculation used an inconsistent rate unit.',
    evidence: 'The original source supplies a per-second rate.', correction: 'Calculate with consistent base units and retain every source subpart.' }];
  await h.reply(initialReview, positive); await h.waitFor(() => h.prompts().length === 4);
  const creation = h.prompts().at(-1), pending = h.stored.convergeState.pending.right;
  assert.match(h.stored.convergeState.stage, /Creating revised PDF/);
  assert.match(creation.message.text, /No JSON is required for this production step/);
  assert.doesNotMatch(creation.message.text, /Return exactly one valid JSON object/);
  assert.match(creation.message.text, /original-worksheet.pdf/);
  assert.match(creation.message.text, /inconsistent rate unit/);
  assert.match(creation.message.text, /consistent base units/);
  assert.match(creation.message.text, /REOPEN the actual saved file/);
  assert.deepEqual(pending.reviewProvenance.issues, positive.issues);
  assert.deepEqual(pending.reviewProvenance.improvements, positive.improvements);
  const fixed = h.output(metadata('complete-revised.pdf'), 'complete-source-solutions-with-corrected-rate-units');
  await h.reply(creation, 'Created complete-revised.pdf. Reopened it and checked every original subpart and the printed units.', [fixed]);
  await h.waitFor(() => h.stored.convergeState.candidate?.id === 'C2');
  assert.deepEqual(h.stored.convergeState.acceptedBy, {});
  assert.equal(h.stored.convergeState.improvementTrail[0].verified, false);
  assert.deepEqual(h.stored.convergeState.improvementTrail[0].changes, positive.improvements);
  assert.deepEqual(h.stored.convergeState.improvementTrail[0].checks, positive.checks);
  assert.ok(h.stored.convergeState.issues.some(issue => issue.problem === positive.issues[0].problem && !issue.resolved));
  const next = h.prompts().at(-1);
  assert.match(next.message.text, /Current candidate ID: C2/);
  assert.match(next.message.text, /Return exactly one valid JSON object/);
  assert.match(next.message.text, /original-worksheet.pdf/);
  await h.reply(next, accept('C2', h.stored.convergeState.issues.map(issue => issue.id)));
  assert.equal(h.stored.convergeState.status, 'running');
  assert.equal(h.stored.convergeState.improvementTrail[0].verified, false);
  await h.reply(h.prompts().at(-1), accept('C2', h.stored.convergeState.issues.map(issue => issue.id)));
  assert.equal(h.stored.convergeState.improvementTrail[0].verified, false, 'a prior round acceptance cannot finish the next round');
  await h.reply(h.prompts().at(-1), accept('C2', h.stored.convergeState.issues.map(issue => issue.id)));
  assert.equal(h.stored.convergeState.improvementTrail[0].verified, true);
  assert.equal(h.stored.convergeState.status, 'running', 'the four-round minimum still applies');
});

test('natural required file creation without an actual output fails, and Stop ignores a late natural replacement', async t => {
  for (const stop of [false, true]) {
    const h = harness(t), review = await h.drafts();
    await h.reply(review, improvement('C1', 'A proposed complete revision.'));
    await h.waitFor(() => h.prompts().length === 4);
    const creation = h.prompts().at(-1);
    if (stop) await h.send({ type: 'STOP' });
    const replacement = stop ? [h.output(metadata('late-natural.pdf'), 'late-natural-output')] : undefined;
    await h.reply(creation, stop ? 'Here is the completed late replacement.' : 'The revised PDF is ready, but there is no actual download.', replacement);
    if (!stop) {
      assert.equal(h.stored.convergeState.status, 'error');
      assert.match(h.stored.convergeState.error, /required corrected PDF after one substantive/);
      assert.equal(h.prompts().length, 4, 'a format retry cannot create missing file bytes');
    } else assert.equal(h.stored.convergeState.status, 'stopped');
    assert.equal(h.stored.convergeState.candidate.id, 'C1');
    assert.equal(h.stored.convergeState.revisionCount, 0); assert.deepEqual(h.stored.convergeState.acceptedBy, {});
  }
});

test('another absent draft file stops honestly with no creation loop or acceptance', async t => {
  const h = harness(t); await h.start();
  await h.reply(h.prompts()[0], { answer: 'The new PDF is done.', uncertainties: [] });
  await h.waitFor(() => h.prompts().length === 3);
  await h.reply(h.prompts().at(-1), { answer: 'The file tool is unavailable here.', uncertainties: ['Cannot create a PDF.'] });
  assert.equal(h.stored.convergeState.status, 'error');
  assert.match(h.stored.convergeState.error, /after one draft creation followup/);
  assert.equal(h.prompts().length, 3); assert.equal(h.stored.convergeState.candidate, null);
  assert.deepEqual(h.stored.convergeState.acceptedBy, {});
  assert.equal(h.sent.filter(item => item.message.type === 'CANCEL').length, 2);
});

test('Stop cancels draft creation and a late actual file cannot restart the exchange', async t => {
  const h = harness(t); await h.start();
  await h.reply(h.prompts()[0], { answer: 'I described a PDF but exposed none.', uncertainties: [] });
  await h.waitFor(() => h.prompts().length === 3);
  const creation = h.prompts().at(-1), file = h.output(metadata('late.pdf'), 'late-created-pdf');
  await h.send({ type: 'STOP' });
  await h.reply(creation, { answer: 'The real PDF is now ready.', uncertainties: [] }, [file]);
  assert.equal(h.stored.convergeState.status, 'stopped'); assert.equal(h.stored.convergeState.candidate, null);
  assert.equal(h.prompts().length, 3); assert.deepEqual(h.stored.convergeState.pending, {});
  assert.equal(h.sent.filter(item => item.message.type === 'EXPORT_MEDIA').length, 0);
});

test('draft creation retains the original deadline and an expired attempt cannot retry', async t => {
  const h = harness(t); await h.start();
  await h.reply(h.prompts()[0], { answer: 'Claimed PDF.', uncertainties: [] });
  await h.waitFor(() => h.prompts().length === 3);
  h.stored.convergeState.pending.left.deadline = Date.now() - 1;
  await h.reply(h.prompts().at(-1), { answer: 'Still no file.', uncertainties: [] });
  assert.equal(h.stored.convergeState.status, 'limit_reached'); assert.equal(h.prompts().length, 3);
  assert.equal(h.stored.convergeState.candidate, null);
});
