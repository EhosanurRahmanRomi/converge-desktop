'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { emptyStudio, startContract, candidateRevision, requirementReview, issueReview,
  applyVerification, applyModelReview, acceptanceBlockers, normalizeSettings, requestsDocumentOutput, syncRequirements, validatePublicStudio } = require('../src/studio/workflow');
const { documentDesignContext } = require('../src/studio/document-design');

const candidate = { id: 'C1', sha256: 'a'.repeat(64), answer: 'Complete source', author: 'left', media: null };

test('preset settings and explicit criteria are bounded, deduplicated, and do not imply execution', () => {
  const settings = normalizeSettings({ preset: 'software', acceptanceCriteria: ['Pass boundaries', 'Pass boundaries'], verificationEnabled: true });
  assert.deepEqual(settings.acceptanceCriteria, ['Pass boundaries']);
  const studio = startContract(emptyStudio(settings), 'Build a program', 0, [], true);
  assert.deepEqual(studio.requirements.map(item => item.id), ['task-complete', 'software-review', 'criterion-1', 'source-validation', 'artifact-integrity']);
  assert.ok(studio.requirements.every(item => item.status === 'unverified'));
  assert.throws(() => normalizeSettings({ freshAudit: 'yes' }), /true or false/);
  assert.throws(() => normalizeSettings({ preset: 'invented' }), /preset/);
  assert.throws(() => normalizeSettings({ acceptanceCriteria: Array(30).fill('a'.repeat(4_000)).map((item, index) => `${index}${item.slice(3)}`) }), /20,000/);
});

test('model and human claims remain unverified for executed acceptance gates', () => {
  const studio = startContract(emptyStudio({ preset: 'software', verificationEnabled: true }), 'Build software');
  candidateRevision(studio, candidate, 4);
  for (const source of ['model', 'user']) requirementReview(studio,
    { id: 'source-validation', status: 'met', evidence: 'The model says it compiled.' }, candidate, source);
  assert.equal(studio.requirements.find(item => item.id === 'source-validation').status, 'unverified');
  assert.ok(acceptanceBlockers(studio, candidate).some(item => item.includes('source-validation')));
  assert.throws(() => applyVerification(studio, { checks: [{ id: 'x', label: 'Compiler', source: 'model', status: 'passed', evidence: 'Claim only' }] }, candidate), /actual tool execution/);
  applyVerification(studio, { candidateId: candidate.id, candidateSha256: candidate.sha256,
    checks: [{ id: 'syntax', label: 'Syntax check', kind: 'executed', requirementId: 'source-validation', status: 'passed', evidence: 'Exit code 0 from node --check.' }] }, candidate);
  const requirement = studio.requirements.find(item => item.id === 'source-validation');
  assert.equal(requirement.status, 'met'); assert.equal(requirement.source, 'executed');
  requirementReview(studio, { id: 'source-validation', status: 'met', evidence: 'A later model claims it ran the compiler.' }, candidate, 'model');
  assert.equal(requirement.status, 'met'); assert.equal(requirement.source, 'executed');
  requirementReview(studio, { id: 'source-validation', status: 'unverified', evidence: 'This worker has no compiler access.' }, candidate, 'model');
  assert.equal(requirement.status, 'met'); assert.equal(requirement.source, 'executed');
});

test('executed reports must identify the exact candidate and unavailable tools stay unverified', () => {
  const studio = emptyStudio({ verificationEnabled: true });
  assert.throws(() => applyVerification(studio, { candidateSha256: 'b'.repeat(64), checks: [] }, candidate), /different candidate bytes/);
  applyVerification(studio, { checks: [{ id: 'docker', label: 'Container tests', kind: 'executed', status: 'unavailable', evidence: 'Docker unavailable.' }] }, candidate);
  assert.equal(studio.verification.status, 'unverified');
  assert.equal(studio.verification.checks[0].status, 'unverified');
});

test('issue lifecycle requires assignment and a fix before recheck, then reopens on another revision', () => {
  const studio = emptyStudio(); candidateRevision(studio, candidate, 4);
  issueReview(studio, { title: 'Empty input crashes', status: 'found', severity: 'high', evidence: 'Observed exception.' });
  assert.throws(() => issueReview(studio, { id: 'I1', status: 'assigned', evidence: 'Fix it.' }), /Choose a worker/);
  assert.throws(() => issueReview(studio, { id: 'I1', status: 'rechecked', evidence: 'Looks good.' }), /cannot move/);
  issueReview(studio, { id: 'I1', status: 'assigned', assignedTo: 'left', evidence: 'Worker A owns the fix.' });
  issueReview(studio, { id: 'I1', status: 'fixed', evidence: 'Empty-input guard added in this candidate.' });
  issueReview(studio, { id: 'I1', status: 'rechecked', evidence: 'Independent empty-input example returns an empty list.' });
  assert.deepEqual(studio.issues[0].history.map(item => item.status), ['found', 'assigned', 'fixed', 'rechecked']);
  candidateRevision(studio, { ...candidate, id: 'C2', sha256: 'b'.repeat(64) }, 4);
  assert.equal(studio.issues[0].status, 'reopened');
  assert.equal(studio.issues[0].revisionId, 'R2');
});

test('explicit criteria require concrete item reviews and stay incomplete on a generic acceptance', () => {
  const studio = startContract(emptyStudio({ acceptanceCriteria: ['Handle an empty list.'] }), 'Build an algorithm');
  candidateRevision(studio, candidate, 4);
  applyModelReview(studio, { verdict: 'accept', checks: ['General review'], issues: [] }, candidate, 'left');
  assert.equal(studio.requirements.find(item => item.id === 'criterion-1').status, 'unverified');
  applyModelReview(studio, { verdict: 'accept', checks: ['Boundary review'], issues: [],
    requirementReviews: [{ id: 'criterion-1', status: 'met', evidence: 'The empty input returns [] without accessing index 0.' }] }, candidate, 'right');
  assert.deepEqual(acceptanceBlockers(studio, candidate), []);
  assert.equal(studio.requirements[1].source, 'model');
});

test('static coverage remains unverified without blocking passed file checks, but missing required checks still block', () => {
  const studio = startContract(emptyStudio({ verificationEnabled: true }), 'Deliver a JSON data file', 0, [], true);
  candidateRevision(studio, candidate, 4);
  applyModelReview(studio, { verdict: 'accept', checks: ['Document content reviewed'], issues: [] }, candidate, 'left');
  const checks = [{ id: 'candidate-identity', label: 'Exact file identity', source: 'executed', status: 'passed', requirementId: 'artifact-integrity', evidence: 'Actual hash matched.' },
    { id: 'execution-coverage', label: 'Program execution', source: 'executed', status: 'unverified', evidence: 'Static mode did not execute generated programs.' }];
  applyVerification(studio, { checks }, candidate);
  assert.equal(studio.verification.status, 'unverified');
  assert.deepEqual(acceptanceBlockers(studio, candidate), []);
  studio.settings.verificationMode = 'container-tests';
  assert.ok(acceptanceBlockers(studio, candidate).some(item => item.includes('Local verification')));
  studio.settings.verificationMode = 'static';
  applyVerification(studio, { checks: [...checks, { id: 'pdf-parser', label: 'PDF parser', source: 'executed', status: 'unverified', requirementId: 'artifact-integrity', evidence: 'Parser unavailable.' }] }, candidate);
  assert.ok(acceptanceBlockers(studio, candidate).some(item => item.includes('artifact-integrity')));
  assert.ok(acceptanceBlockers(studio, candidate).some(item => item.includes('Local verification')));
});

test('document production adds mandatory content and visual gates in Automatic mode even when local checks are disabled', () => {
  for (const task of ['Make a PDF for the first 20 lectures.', 'Write expanded lecture notes.', 'Produce the reviewed report.pdf.',
    'Rewrite the uploaded document.', 'Create a DOCX document from the PDF.', 'Generate Python code and deliver a short PDF report.',
    'Do not generate a PDF; deliver a DOCX document instead.']) {
    assert.equal(requestsDocumentOutput(task), true, task);
    const studio = startContract(emptyStudio({ verificationEnabled: false }), task, 0, [], true);
    assert.deepEqual(studio.requirements.map(item => item.id), ['task-complete', 'document-content', 'document-layout']);
  }
  for (const task of ['Read the uploaded PDF and answer the question.', 'Create summary.json from the source PDF.',
    'Write a Python script to parse a PDF.', 'Create a PDF parser.', 'Create a PDF viewer.',
    'Generate a program that reads PDF files.', 'Create a JSON summary using notes.pdf.',
    'Do not generate a PDF. Return summary.json.', 'Analyze software based on the attached reference PDF.', 'Create a downloadable image.']) {
    assert.equal(requestsDocumentOutput(task), false, task);
    assert.ok(!startContract(emptyStudio(), task, 0, [], true).requirements.some(item => item.id === 'document-layout'), task);
  }
  const criterionStudio = startContract(emptyStudio({ acceptanceCriteria: ['Deliver the finished report as a PDF.'] }), 'Complete the report');
  assert.ok(criterionStudio.requirements.some(item => item.id === 'document-layout'));
  assert.ok(criterionStudio.requirements.some(item => item.id === 'document-content'));
  assert.equal(requestsDocumentOutput('Create a PDF parser and deliver a PDF report.'), true);
});

const documentCandidate = { ...candidate, answer: 'Complete expanded lecture notes', media: { files: [{ name: 'notes.pdf', mimeType: 'application/pdf',
  contentSha256: 'b'.repeat(64), byteLength: 4200 }] } };
function documentReview() {
  return { files: [{ name: 'notes.pdf', contentSha256: 'b'.repeat(64), pageCount: 3, renderedPages: [1, 2, 3], inspectedPages: [1, 2, 3] }],
    checks: { typography: 'Inspected embedded serif body fonts, bold heading levels and readable equation glyphs on every page.',
      spacing: 'All three pages keep aligned margins, comfortable line spacing and unclipped equation blocks.',
      mathematics: 'Displayed fractions and aligned derivations use true superscripts, subscripts and mathematical symbols.',
      figures: 'Figure labels and captions remain readable and match the geometry explained in the adjacent paragraphs.',
      referenceStyle: 'No separate style reference was selected; the consistent academic design matches the requested lecture-note format.' }, limitations: [] };
}

test('actual generated document candidates add persistent mandatory gates without classifying uploaded inputs', () => {
  const studio = startContract(emptyStudio({ preset: 'software', verificationEnabled: true,
    documentDesign: { profile: 'reference', referenceNames: ['good-notes.pdf'] } }), 'Complete the requested work', 0,
  [{ id: 'native-test', description: 'Run the native source test.' }], true);
  assert.ok(!studio.requirements.some(item => item.id === 'document-layout'), 'Input attachments were classified as document outputs');
  candidateRevision(studio, documentCandidate, 4);
  for (const id of ['document-content', 'document-layout', 'document-reference-style', 'native-test', 'source-validation', 'artifact-integrity']) {
    assert.ok(studio.requirements.some(item => item.id === id), id);
  }
  assert.equal(studio.contract.documentOutput, true);
  assert.ok(acceptanceBlockers(studio, documentCandidate).some(item => item.includes('document-layout')));
  studio.settings.verificationEnabled = false;
  syncRequirements(studio);
  assert.ok(studio.requirements.some(item => item.id === 'document-layout'));
  const recovered = validatePublicStudio(studio); syncRequirements(recovered);
  assert.equal(recovered.contract.documentOutput, true);
  assert.equal(recovered.requirements.find(item => item.id === 'document-layout').status, 'unverified');
  startContract(studio, 'Answer the numeric question');
  assert.equal(studio.contract.documentOutput, false);
  assert.ok(!studio.requirements.some(item => item.id === 'document-layout'), 'A previous document made a new numeric task inherit its layout gate');
  candidateRevision(studio, { ...candidate, files: [{ name: 'report.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    contentSha256: 'f'.repeat(64), byteLength: 1000 }] }, 1);
  assert.ok(studio.requirements.some(item => item.id === 'document-layout'));
  assert.equal(studio.revisions.at(-1).files[0].name, 'report.docx');
});

test('generic document acceptance and successful rasterization cannot certify content or visual quality', () => {
  const studio = startContract(emptyStudio(), 'Make a PDF for the first 20 lectures.'); candidateRevision(studio, documentCandidate, 4);
  applyModelReview(studio, { verdict: 'accept', checks: ['Checked it'], issues: [], requirementReviews: [
    { id: 'document-content', status: 'met', evidence: 'Checked it.' },
    { id: 'document-layout', status: 'met', evidence: 'The PDF rendered correctly with every page present and all checks passed.' },
  ] }, documentCandidate, 'left');
  assert.equal(studio.requirements.find(item => item.id === 'document-content').status, 'unverified');
  assert.equal(studio.requirements.find(item => item.id === 'document-layout').status, 'unverified');
  requirementReview(studio, { id: 'document-layout', status: 'met', evidence: 'The actual rasterizer produced three readable PNG pages without reporting errors.' }, documentCandidate, 'executed');
  assert.equal(studio.requirements.find(item => item.id === 'document-layout').status, 'unverified');
  assert.ok(acceptanceBlockers(studio, documentCandidate).some(item => item.includes('document-layout')));
});

test('exact complete page review grants model visual evidence while partial, stale and unavailable inspection stays unverified', () => {
  const review = documentReview(), studio = startContract(emptyStudio(), 'Make a PDF for the first 20 lectures.');
  candidateRevision(studio, documentCandidate, 4);
  const acceptance = { verdict: 'accept', checks: ['Checked all source sections'], issues: [], documentReview: review,
    requirementReviews: [{ id: 'document-content', status: 'met', evidence: 'Mapped every requested lecture 1-20 section and derivation to the original source coverage ledger; no requested section remains missing.' }] };
  applyModelReview(studio, acceptance, documentCandidate, 'left');
  assert.deepEqual(acceptanceBlockers(studio, documentCandidate), []);
  const layout = studio.requirements.find(item => item.id === 'document-layout');
  assert.equal(layout.source, 'model'); assert.match(layout.evidence.at(-1).text, /Model-reported visual review, not independently executed/);
  const incomplete = structuredClone(review); incomplete.files[0].inspectedPages.pop();
  applyModelReview(studio, { ...acceptance, documentReview: incomplete }, documentCandidate, 'right');
  assert.equal(layout.status, 'unverified'); assert.match(layout.evidence.at(-1).text, /2\/3 pages/);
  const stale = structuredClone(review); stale.files[0].contentSha256 = 'c'.repeat(64);
  applyModelReview(studio, { ...acceptance, documentReview: stale }, documentCandidate, 'right');
  assert.equal(layout.status, 'unverified'); assert.match(layout.evidence.at(-1).text, /hashes do not match/);
  const unavailable = structuredClone(review); unavailable.limitations = ['Rendering the final saved pages was unavailable.'];
  applyModelReview(studio, { ...acceptance, documentReview: unavailable }, documentCandidate, 'right');
  assert.equal(layout.status, 'unverified');
  applyModelReview(studio, { ...acceptance, documentReview: undefined }, documentCandidate, 'right');
  assert.equal(layout.status, 'unverified');
});

test('selected style references remain mandatory and unavailable or unmentioned comparisons cannot pass', () => {
  const settings = { documentDesign: { profile: 'reference', notes: 'Match the typeset equations and restrained chapter styling.', referenceNames: ['good-notes.pdf'] } };
  const studio = startContract(emptyStudio(settings), 'Produce expanded lecture notes as a PDF.'); candidateRevision(studio, documentCandidate, 4);
  assert.ok(studio.requirements.some(item => item.id === 'document-reference-style'));
  const proof = documentReview(), source = { name: 'good-notes.pdf', mimeType: 'application/pdf', contentSha256: 'd'.repeat(64), byteLength: 5000 };
  const acceptance = { verdict: 'accept', checks: ['Reference style reviewed'], issues: [], documentReview: proof };
  applyModelReview(studio, acceptance, documentCandidate, 'left', documentDesignContext(studio.settings, []));
  assert.equal(studio.requirements.find(item => item.id === 'document-reference-style').status, 'unverified');
  applyModelReview(studio, acceptance, documentCandidate, 'left', documentDesignContext(studio.settings, [source]));
  assert.equal(studio.requirements.find(item => item.id === 'document-reference-style').status, 'unverified');
  proof.checks.referenceStyle = 'Compared good-notes.pdf: matched serif body typography, numbered displayed equations and restrained blue lecture headings on all three rendered pages.';
  applyModelReview(studio, acceptance, documentCandidate, 'left', documentDesignContext(studio.settings, [source]));
  assert.equal(studio.requirements.find(item => item.id === 'document-reference-style').status, 'met');
  assert.equal(studio.requirements.find(item => item.id === 'document-reference-style').source, 'model');
});

test('manual document visual reviews are separately labelled and invalidate on changed candidate or saved-project restore', () => {
  const studio = startContract(emptyStudio(), 'Deliver a PDF document.'); candidateRevision(studio, documentCandidate, 4);
  requirementReview(studio, { id: 'document-layout', status: 'met', evidence: 'Checked it.' }, documentCandidate, 'user');
  assert.equal(studio.requirements.find(item => item.id === 'document-layout').status, 'unverified');
  requirementReview(studio, { id: 'document-layout', status: 'met', evidence: 'I visually inspected all 3 pages of this exact PDF: equation glyphs, fonts, spacing and figure captions are readable without clipping.' }, documentCandidate, 'user');
  const layout = studio.requirements.find(item => item.id === 'document-layout');
  assert.equal(layout.status, 'met'); assert.equal(layout.source, 'user');
  applyModelReview(studio, { verdict: 'accept', checks: ['This worker has no renderer'], issues: [] }, documentCandidate, 'left');
  assert.equal(layout.status, 'met'); assert.equal(layout.source, 'user');
  const saved = validatePublicStudio(studio);
  assert.equal(saved.requirements.find(item => item.id === 'document-layout').status, 'unverified');
  candidateRevision(studio, { ...documentCandidate, id: 'C2', sha256: 'e'.repeat(64) }, 5);
  assert.equal(layout.status, 'unverified'); assert.equal(layout.source, null);
});

test('document design choices are bounded, retained through settings updates and recovered without acceptance authority', () => {
  const settings = normalizeSettings({ documentDesign: { profile: 'reference', notes: 'Use mathematical typesetting.', referenceNames: ['good.pdf', 'good.pdf'] } });
  assert.deepEqual(settings.documentDesign.referenceNames, ['good.pdf']);
  assert.deepEqual(normalizeSettings({ freshAudit: true }, settings).documentDesign, settings.documentDesign);
  const studio = startContract(emptyStudio(settings), 'Make a PDF of the lectures.');
  assert.deepEqual(validatePublicStudio(studio).settings.documentDesign, settings.documentDesign);
  assert.throws(() => normalizeSettings({ documentDesign: { notes: 'x'.repeat(6001) } }), /6,000/);
  assert.throws(() => normalizeSettings({ documentDesign: { referenceNames: ['C:\\private\\source.pdf'] } }), /exact style-reference/);
});

test('actual parsed PDF page count constrains model inspection claims and is never inferred from prose or stale bytes', () => {
  const studio = startContract(emptyStudio({ verificationEnabled: false }), 'Create a PDF document.'); candidateRevision(studio, documentCandidate, 4);
  const check = { id: 'pdf-structure:notes.pdf', label: 'Actual PDF structure parser', status: 'passed', source: 'executed',
    fileName: 'notes.pdf', contentSha256: 'b'.repeat(64), pageCount: 68, evidence: 'The trusted parser counted 68 pages.' };
  applyVerification(studio, { candidateId: documentCandidate.id, candidateSha256: documentCandidate.sha256, checks: [check] }, documentCandidate);
  assert.equal(studio.verification.checks[0].pageCount, 68);
  const acceptance = { verdict: 'accept', checks: ['Document reviewed'], issues: [], documentReview: documentReview() };
  applyModelReview(studio, acceptance, documentCandidate, 'left');
  const layout = studio.requirements.find(item => item.id === 'document-layout');
  assert.equal(layout.status, 'unverified'); assert.match(layout.evidence.at(-1).text, /68/);
  for (const changed of [{ ...check, contentSha256: 'c'.repeat(64) }, { ...check, fileName: 'other.pdf' }, { ...check, pageCount: 0 }, { ...check, pageCount: 1001 }, { ...check, pageCount: 1.5 }]) {
    assert.throws(() => applyVerification(studio, { checks: [changed] }, documentCandidate), /exact candidate file/);
  }
  applyVerification(studio, { checks: [{ id: 'pdf-structure:notes.pdf', label: 'Parser result', status: 'passed', source: 'executed', evidence: '68 pages were parsed.' }] }, documentCandidate);
  applyModelReview(studio, acceptance, documentCandidate, 'left');
  assert.equal(layout.status, 'met', 'Free text was improperly parsed as numeric tool evidence');
  studio.verification.candidateSha256 = 'c'.repeat(64);
  studio.verification.checks[0] = check;
  applyModelReview(studio, acceptance, documentCandidate, 'left');
  assert.equal(layout.status, 'met', 'Stale candidate page counts affect a new candidate review');
  assert.equal(layout.source, 'model');
});

test('generic local file identity metadata does not become PDF page-count evidence', () => {
  const studio = emptyStudio(), files = [{ name: 'result.js', mimeType: 'text/javascript', contentSha256: 'd'.repeat(64), byteLength: 42 },
    ...documentCandidate.media.files];
  const current = { ...candidate, media: { files } };
  applyVerification(studio, { checks: [
    { id: 'javascript-syntax:result.js', label: 'JavaScript syntax', status: 'passed', source: 'executed',
      fileName: 'result.js', contentSha256: 'd'.repeat(64), byteLength: 42, evidence: 'Trusted Node parsed the file; generated code was not executed.' },
    { id: 'pdf-rendering:notes.pdf', label: 'PDF rasterization', status: 'passed', source: 'executed',
      fileName: 'notes.pdf', contentSha256: 'b'.repeat(64), byteLength: 4200, evidence: 'The rasterizer produced PNG pages. Appearance was not reviewed.' },
    { id: 'pdf-structure:notes.pdf', label: 'PDF structure', status: 'unverified', source: 'executed',
      fileName: 'notes.pdf', contentSha256: 'b'.repeat(64), byteLength: 4200, evidence: 'The parser is unavailable.' },
  ] }, current);
  assert.deepEqual(studio.verification.checks.map(check => check.status), ['passed', 'passed', 'unverified']);
  assert.ok(studio.verification.checks.every(check => check.pageCount === undefined));
  const longName = `${'lecture-'.repeat(19)}notes.pdf`, file = { ...files[1], name: longName };
  const checkId = `${longName.slice(0, 110)}-${require('node:crypto').createHash('sha256').update(longName).digest('hex').slice(0, 12)}`;
  applyVerification(studio, { checks: [{ id: `pdf-structure:${checkId}`, label: 'PDF structure', source: 'executed', status: 'passed',
    fileName: longName, contentSha256: file.contentSha256, pageCount: 68, evidence: 'The trusted parser counted all 68 pages.' }] }, { ...current, media: { files: [file] } });
  assert.equal(studio.verification.checks[0].pageCount, 68);
  assert.equal(studio.verification.checks[0].fileName, longName);
});

test('a worker cannot certify its own issue fix, while the other worker can independently recheck it', () => {
  const studio = startContract(emptyStudio(), 'Repair software'); candidateRevision(studio, candidate, 4);
  issueReview(studio, { title: 'Empty input fails', status: 'found', evidence: 'Observed a boundary defect.' });
  const review = { verdict: 'accept', checks: ['Checked the exact candidate'], issues: [], issueReviews: [{ id: 'I1', status: 'fixed', evidence: 'Added the missing empty-input guard.' }] };
  applyModelReview(studio, review, candidate, 'left');
  review.issueReviews = [{ id: 'I1', status: 'rechecked', evidence: 'Ran an independent empty-input walkthrough.' }];
  assert.throws(() => applyModelReview(studio, review, candidate, 'left'), /other worker/);
  assert.equal(studio.issues[0].status, 'fixed');
  applyModelReview(studio, review, candidate, 'right');
  assert.equal(studio.issues[0].status, 'rechecked');
  assert.equal(studio.issues[0].history.at(-1).reviewer, 'right');
});

test('explicit passing-program-test conditions need actual execution and cannot be waived by syntax or worker claims', () => {
  const studio = startContract(emptyStudio({ preset: 'software', verificationEnabled: true, acceptanceCriteria: ['All unit tests pass'] }), 'Build software and run its regression tests', 0, [], true);
  candidateRevision(studio, candidate, 4);
  applyModelReview(studio, { verdict: 'accept', checks: ['Source reviewed'], issues: [], requirementReviews: [
    { id: 'software-review', status: 'met', evidence: 'Edge cases traced.' },
    { id: 'criterion-1', status: 'met', evidence: 'The model claims tests passed.' },
  ] }, candidate, 'left');
  const staticChecks = [{ id: 'candidate-identity', label: 'Identity', source: 'executed', status: 'passed', requirementId: 'artifact-integrity', evidence: 'Hash matched.' },
    { id: 'syntax', label: 'Syntax', source: 'executed', status: 'passed', requirementId: 'source-validation', evidence: 'Syntax parser exited zero.' }];
  applyVerification(studio, { checks: staticChecks }, candidate);
  assert.equal(studio.requirements.find(item => item.id === 'criterion-1').status, 'unverified');
  assert.ok(acceptanceBlockers(studio, candidate).some(item => item.includes('program-tests')));
  applyVerification(studio, { checks: [...staticChecks, { id: 'container-tests:javascript', label: 'Actual isolated test run', source: 'executed', status: 'passed', evidence: 'Fixed local image, test exit 0.' }] }, candidate);
  assert.deepEqual(acceptanceBlockers(studio, candidate), []);
  const onlyGenerate = startContract(emptyStudio({ preset: 'software', verificationEnabled: true }), 'Write unit tests, do not run tests.');
  assert.ok(!onlyGenerate.requirements.some(item => item.id === 'program-tests'));
});

test('local checks bound to different candidate bytes cannot be relabeled as current evidence', () => {
  const studio = emptyStudio({ verificationEnabled: true });
  assert.throws(() => applyVerification(studio, { candidateId: candidate.id, candidateSha256: candidate.sha256,
    checks: [{ id: 'syntax', label: 'Syntax', status: 'passed', source: 'executed', candidateSha256: 'b'.repeat(64), evidence: 'Checked an older candidate.' }] }, candidate), /different candidate bytes/);
  assert.equal(studio.verification.status, 'idle');
});
