'use strict';

// This module describes evidence and review state only. It never runs a file,
// reads a browser page, or promotes a model's claim to an executed check.
const PRESETS = Object.freeze({ auto: 'Automatic', software: 'Software', research: 'Research',
  document: 'Documents', image: 'Images', trading: 'Trading research' });
const REQUIREMENT_STATUSES = new Set(['met', 'failed', 'unverified']);
const ISSUE_STATUSES = new Set(['found', 'assigned', 'fixed', 'rechecked', 'reopened']);
const SEVERITIES = new Set(['critical', 'high', 'medium', 'low']);
const SOURCES = new Set(['model', 'executed', 'user']);
const { createHash } = require('node:crypto');
const { normalizeDocumentDesign, documentDesignContext, assessDocumentReview } = require('./document-design');
const DOCUMENT_LAYOUT_IDS = new Set(['document-layout', 'document-reference-style']);
const DOCUMENT_REVIEW_PROOF = Symbol('exact document review assessment');
const clone = value => structuredClone(value);

function boundedText(value, label, maximum = 4_000, allowEmpty = false) {
  if (typeof value !== 'string' || value.length > maximum || (!allowEmpty && !value.trim())) throw new Error(`${label} is invalid.`);
  return value.trim();
}

function criteriaList(value) {
  if (!Array.isArray(value) || value.length > 30) throw new Error('Use at most 30 acceptance criteria.');
  const result = [...new Set(value.map(item => boundedText(item, 'Acceptance criterion')))];
  if (result.reduce((sum, item) => sum + item.length, 0) > 20_000) throw new Error('Acceptance criteria exceed 20,000 characters.');
  return result;
}

function normalizeSettings(payload = {}, prior = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Studio settings must be an object.');
  const preset = payload.preset ?? prior.preset ?? 'auto';
  if (!Object.hasOwn(PRESETS, preset)) throw new Error('Choose a supported task preset.');
  const settings = { freshAudit: prior.freshAudit ?? false, verificationEnabled: prior.verificationEnabled ?? false,
    verificationMode: prior.verificationMode ?? 'static' };
  for (const key of ['freshAudit', 'verificationEnabled']) {
    if (payload[key] !== undefined && typeof payload[key] !== 'boolean') throw new Error(`${key} must be true or false.`);
    if (payload[key] !== undefined) settings[key] = payload[key];
  }
  if (payload.verificationMode !== undefined) settings.verificationMode = payload.verificationMode;
  if (!['static', 'container-tests'].includes(settings.verificationMode)) throw new Error('Choose static checks or container tests.');
  return { preset, ...settings, documentDesign: normalizeDocumentDesign(payload.documentDesign ?? prior.documentDesign ?? {}),
    acceptanceCriteria: criteriaList(payload.acceptanceCriteria ?? prior.acceptanceCriteria ?? []) };
}

function emptyStudio(payload = {}) {
  const normalized = normalizeSettings(payload);
  return { version: 1, preset: normalized.preset,
    settings: { freshAudit: normalized.freshAudit, verificationEnabled: normalized.verificationEnabled,
      verificationMode: normalized.verificationMode, documentDesign: normalized.documentDesign },
    contract: { task: '', createdAt: null, userRevision: 0, documentOutput: false, acceptanceCriteria: normalized.acceptanceCriteria },
    requirements: [], issues: [], revisions: [], preferredRevisionId: null,
    verification: { status: 'idle', candidateId: null, candidateSha256: null, checks: [], summary: '' },
    freshAudit: { enabled: normalized.freshAudit, status: 'idle', candidateId: null, candidateSha256: null, side: 'right', review: null },
    history: [] };
}

function recordHistory(studio, type, detail, at = Date.now()) {
  studio.history.push({ type, detail: boundedText(detail, 'History detail', 8_000), at });
  if (studio.history.length > 200) studio.history.splice(0, studio.history.length - 200);
}

function requestsProgramTests(value) {
  const directions = String(value || '').replace(/\b(?:do not|don't|no need to|without)\b[^.!?\n]{0,100}\b(?:run|execute|pass|tests?)\b[^.!?\n]{0,80}/gi, '');
  return /\b(?:run|execute|pass)\b[^.!?\n]{0,80}\b(?:unit|integration|regression|automated|runtime)?\s*tests?\b|\btests?\s+(?:must\s+)?pass\b/i.test(directions);
}

function requestsDocumentOutput(value) {
  const directions = String(value || '').replace(/\b(?:do not|don't|no need to|without)\s+(?:make|create|generate|return|deliver|provide|produce|convert|export|save|attach|write|rewrite|edit|typeset)\b[^.!?\n;]{0,200}/gi, '');
  const verbs = /\b(?:make|create|generate|return|deliver|provide|produce|convert|export|save|attach|write|rewrite|edit|fix|correct|improve|refine|reformat|typeset|redesign)\b/gi;
  return [...directions.matchAll(verbs)].some(match => {
    const clause = directions.slice(match.index + match[0].length, match.index + match[0].length + 220)
      .split(/[!?\n;]|\.(?=\s|$)|\b(?:from|using|based on|by reading|by auditing|by analyzing|by analysing)\b/i)[0];
    // A PDF named as input to software or an explicitly different output is
    // not a document production contract. Mere uploads never add these gates.
    if (/\b(?:scripts?|programs?|parser|code|application|tool)\b[^.!?\n]{0,100}\b(?:to|that)\s+(?:read|parse|extract|analy[sz]e|inspect|process|summari[sz]e)s?\b/i.test(clause)) return false;
    if (/\b(?:pdf|docx)[ -]+(?:parser|reader|viewer|validator|processor|library|analysis|processing\s+tool)\b/i.test(clause)) return false;
    if (/\b(?:as|in|into)\s+(?:an?\s+)?(?:json|csv|tsv|txt|plain text|markdown|md|xlsx|pptx)\b/i.test(clause)) return false;
    const output = clause.split(/\bof\b/i)[0];
    return /\b(?:pdf|docx|documents?|(?:lecture|class|study|digital|expanded)\s+notes?)\b|\.(?:pdf|docx)\b/i.test(output);
  });
}

function concreteDocumentContent(evidence) {
  return evidence.length >= 40 && /\b(?:coverage|scope|sections?|lectures?|topics?|derivations?|source|contents?|chapters?|requirements?)\b/i.test(evidence) &&
    !/^(?:checked|reviewed|all good|looks good|complete|passed)(?:\s+(?:everything|all|it))?[.!\s]*$/i.test(evidence);
}
function concreteManualVisualReview(evidence) {
  return evidence.length >= 60 && /\b(?:visually|visual|rendered|inspected|viewed)\b/i.test(evidence) &&
    /\bpages?\s+(?:\d|all)|\ball\s+\d*\s*pages\b/i.test(evidence) &&
    /\b(?:font|typograph|spacing|margin|layout|equation|math|figure|caption|glyph|clipping)\w*\b/i.test(evidence);
}

function documentRequirementDefinitions(studio) {
  const result = [{ id: 'document-content', text: 'Review the requested content scope, source coverage and complete derivation or section sequence.', gate: 'review' },
    { id: 'document-layout', text: 'Visually inspect every rendered page of the exact document, including typography, spacing, mathematical notation and figures.', gate: 'review' }];
  if (studio.settings.documentDesign?.referenceNames?.length || studio.settings.documentDesign?.profile === 'reference') {
    result.push({ id: 'document-reference-style', text: 'Compare the exact rendered document against the selected style references and document concrete design findings.', gate: 'review' });
  }
  return result;
}

function unverifiedRequirement(definition) {
  return { ...definition, status: 'unverified', source: null, evidence: [], revisionId: null };
}

function requirementDefinitions(studio, requiredWork = [], hasFiles = false) {
  const result = [{ id: 'task-complete', text: 'Complete the task and preserve the requested deliverables.', gate: 'review' }];
  const reviews = { software: ['software-review', 'Review behavior, edge cases, and maintainable code.'],
    research: ['research-review', 'Check source support, dates, uncertainty, and conclusions.'],
    document: ['document-review', 'Review completeness, readable layout, and requested document style.'],
    image: ['image-review', 'Review the composition, requested content, and delivered image quality.'],
    trading: ['trading-review', 'Preserve performance targets and distinguish native results from hypotheses.'] };
  if (reviews[studio.preset]) result.push({ id: reviews[studio.preset][0], text: reviews[studio.preset][1], gate: 'review' });
  if (studio.contract.documentOutput || requestsDocumentOutput([studio.contract.task, ...studio.contract.acceptanceCriteria].join('\n'))) {
    result.push(...documentRequirementDefinitions(studio));
  }
  for (const [index, criterion] of studio.contract.acceptanceCriteria.entries()) {
    result.push({ id: `criterion-${index + 1}`, text: criterion, gate: requestsProgramTests(criterion) ? 'executed' : 'review', explicit: true });
  }
  if (studio.settings.verificationEnabled) {
    if (studio.preset === 'software') result.push({ id: 'source-validation', text: 'Run an available source or syntax check on the exact candidate.', gate: 'executed' });
    if (hasFiles) result.push({ id: 'artifact-integrity', text: 'Verify the delivered file bytes and format.', gate: 'executed' });
    if (studio.preset === 'software' && requestsProgramTests(studio.contract.task)) result.push({ id: 'program-tests', text: 'Run the requested program tests on the exact candidate.', gate: 'executed' });
    for (const work of requiredWork) result.push({ id: work.id, text: work.description || work.id, gate: 'executed' });
  }
  return result;
}

function syncRequirements(studio, requiredWork = [], hasFiles = false) {
  const existing = new Map(studio.requirements.map(item => [item.id, item]));
  studio.requirements = requirementDefinitions(studio, requiredWork, hasFiles).map(definition => {
    const prior = existing.get(definition.id);
    if (prior?.text === definition.text && prior.gate === definition.gate) return prior;
    return unverifiedRequirement(definition);
  });
}

function startContract(studio, task, userRevision = 0, requiredWork = [], hasFiles = false) {
  studio.contract.task = boundedText(task, 'Task contract', 80_000);
  studio.contract.createdAt = Date.now(); studio.contract.userRevision = userRevision;
  studio.contract.documentOutput = false;
  syncRequirements(studio, requiredWork, hasFiles);
  recordHistory(studio, 'contract', 'Task acceptance contract created.');
  return studio;
}

function invalidateAcceptance(studio, reason) {
  for (const requirement of studio.requirements) {
    requirement.status = 'unverified'; requirement.source = null; requirement.revisionId = null;
  }
  studio.verification = { status: 'idle', candidateId: null, candidateSha256: null, checks: [], summary: '' };
  studio.freshAudit = { enabled: studio.settings.freshAudit, status: 'idle', candidateId: null,
    candidateSha256: null, side: 'right', review: null };
  recordHistory(studio, 'acceptance-invalidated', reason);
}

function candidateRevision(studio, candidate, round) {
  invalidateAcceptance(studio, `Candidate ${candidate.id} requires review.`);
  const files = candidate.media?.files || candidate.files || [];
  const revision = { id: `R${studio.revisions.length + 1}`, candidateId: candidate.id, sha256: candidate.sha256,
    answer: candidate.answer, files: files.map(({ name, mimeType, contentSha256, byteLength }) =>
      ({ name, mimeType, contentSha256, byteLength })), createdAt: Date.now(), author: candidate.author, round };
  studio.revisions.push(revision); studio.preferredRevisionId = revision.id;
  // These are generated candidate artifacts, never uploaded input references.
  // A generic initial request cannot make a delivered document skip its review.
  if (files.some(file => /\.(?:pdf|docx)$/i.test(file.name || '') ||
      ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'].includes(file.mimeType))) {
    studio.contract.documentOutput = true;
    for (const definition of documentRequirementDefinitions(studio)) {
      if (!studio.requirements.some(item => item.id === definition.id)) studio.requirements.push(unverifiedRequirement(definition));
    }
  }
  for (const issue of studio.issues) {
    if (issue.status === 'rechecked') {
      issue.status = 'reopened'; issue.revisionId = revision.id;
      issue.history.push({ status: 'reopened', evidence: 'Candidate changed after the issue was rechecked.', revisionId: revision.id, at: Date.now() });
    }
  }
  return revision;
}

function requirementReview(studio, payload, candidate, source = 'user', proof) {
  if (!payload || typeof payload !== 'object') throw new Error('Supply a requirement review.');
  const requirement = studio.requirements.find(item => item.id === payload.id);
  if (!requirement) throw new Error('Choose an existing requirement.');
  if (!REQUIREMENT_STATUSES.has(payload.status) || !SOURCES.has(source)) throw new Error('Requirement review status is invalid.');
  const evidence = boundedText(payload.evidence, 'Requirement review evidence', 8_000);
  if (!candidate) throw new Error('Choose a candidate before reviewing its requirements.');
  if (payload.status === 'met' && ((DOCUMENT_LAYOUT_IDS.has(requirement.id) &&
      !(source === 'model' && proof === DOCUMENT_REVIEW_PROOF) && !(source === 'user' && concreteManualVisualReview(evidence) &&
        (requirement.id !== 'document-reference-style' || (studio.settings.documentDesign?.referenceNames?.length && studio.settings.documentDesign.referenceNames.every(name => evidence.includes(name)))))) ||
      (requirement.id === 'document-content' && !concreteDocumentContent(evidence)))) {
    // Parsing, rasterization and a generic "checked it" are not an aesthetic
    // or completeness review. Keep their claims visible without granting met.
    const priorManual = source === 'model' && requirement.status === 'met' && requirement.source === 'user' && requirement.revisionId === studio.preferredRevisionId;
    const priorFailure = source === 'model' && requirement.status === 'failed' && requirement.revisionId === studio.preferredRevisionId;
    if (!priorManual && !priorFailure) { requirement.status = 'unverified'; requirement.source = source; requirement.revisionId = studio.preferredRevisionId; }
    requirement.evidence.push({ source, status: 'unverified', text: evidence, candidateId: candidate.id,
      candidateSha256: candidate.sha256, at: Date.now() });
    if (requirement.evidence.length > 30) requirement.evidence.splice(0, requirement.evidence.length - 30);
    return requirement;
  }
  if (requirement.gate === 'executed' && payload.status !== 'failed' && source !== 'executed') {
    // A human can report an external result; it remains clearly unverified by
    // this application until the injected local verification hook confirms it.
    requirement.evidence.push({ source, status: 'unverified', text: evidence, candidateId: candidate.id,
      candidateSha256: candidate.sha256, at: Date.now() });
    const executed = requirement.evidence.slice(0, -1).findLast(entry => entry.source === 'executed' && entry.candidateSha256 === candidate.sha256);
    if (!executed) { requirement.status = 'unverified'; requirement.source = source; }
  } else {
    // Conflicting model evidence stays failed until the candidate changes or
    // a human explicitly reviews it. Arrival order is not a quality decision.
    const preserveFailure = source === 'model' && requirement.status === 'failed' && requirement.revisionId === studio.preferredRevisionId;
    if (!preserveFailure) { requirement.status = payload.status; requirement.source = source; }
    requirement.evidence.push({ source, status: payload.status, text: evidence, candidateId: candidate.id,
      candidateSha256: candidate.sha256, at: Date.now() });
  }
  requirement.revisionId = studio.preferredRevisionId;
  if (requirement.evidence.length > 30) requirement.evidence.splice(0, requirement.evidence.length - 30);
  return requirement;
}

function issueReview(studio, payload, source = 'user', reviewer = null) {
  if (!payload || typeof payload !== 'object' || !ISSUE_STATUSES.has(payload.status)) throw new Error('Issue review status is invalid.');
  const evidence = boundedText(payload.evidence, 'Issue evidence', 8_000);
  if (payload.assignedTo !== undefined && !['left', 'right', null].includes(payload.assignedTo)) throw new Error('Assign the issue to worker A or B.');
  let issue = payload.id ? studio.issues.find(item => item.id === payload.id) : null;
  if (payload.id && !issue) throw new Error('Choose an existing issue.');
  if (!issue) {
    if (payload.status !== 'found') throw new Error('New issues must start as found.');
    if (studio.issues.length >= 100) throw new Error('The issue ledger is full.');
    const severity = payload.severity || 'medium';
    if (!SEVERITIES.has(severity)) throw new Error('Issue severity is invalid.');
    issue = { id: `I${studio.issues.length + 1}`, title: boundedText(payload.title, 'Issue title'), severity,
      status: 'found', assignedTo: null, revisionId: studio.preferredRevisionId, evidence, history: [] };
    studio.issues.push(issue);
  }
  const transitions = { found: ['found', 'assigned', 'fixed'], assigned: ['assigned', 'fixed', 'reopened'],
    fixed: ['fixed', 'rechecked', 'reopened', 'assigned'], rechecked: ['rechecked', 'reopened'],
    reopened: ['reopened', 'assigned', 'fixed'] };
  if (!transitions[issue.status].includes(payload.status)) throw new Error(`An issue cannot move from ${issue.status} to ${payload.status}.`);
  if (payload.status === 'assigned' && !(payload.assignedTo || issue.assignedTo)) throw new Error('Choose a worker for this issue.');
  if (payload.status === 'rechecked' && !studio.preferredRevisionId) throw new Error('Choose a candidate before rechecking an issue.');
  const lastFix = issue.history.findLast(entry => entry.status === 'fixed');
  if (source === 'model' && payload.status === 'rechecked' && lastFix?.source === 'model' && lastFix.reviewer === reviewer) {
    throw new Error('The other worker must independently recheck this issue after its fix.');
  }
  issue.status = payload.status; issue.evidence = evidence; issue.revisionId = studio.preferredRevisionId;
  if (payload.assignedTo !== undefined) issue.assignedTo = payload.assignedTo;
  issue.history.push({ status: payload.status, evidence, source, ...(source === 'model' ? { reviewer } : {}), revisionId: studio.preferredRevisionId, at: Date.now() });
  if (issue.history.length > 50) issue.history.splice(0, issue.history.length - 50);
  recordHistory(studio, 'issue-review', `${issue.id}: ${payload.status}`);
  return issue;
}

function applyModelReview(studio, review, candidate, side, designContext) {
  const entries = review.requirementReviews || [];
  for (const entry of entries) requirementReview(studio, entry, candidate, 'model');
  const documentRequirements = studio.requirements.filter(item => DOCUMENT_LAYOUT_IDS.has(item.id));
  if (documentRequirements.length) {
    const actualPdfPages = studio.verification.candidateSha256 === candidate?.sha256 && studio.verification.candidateId === candidate?.id ?
      studio.verification.checks.filter(check => check.source === 'executed' && check.status === 'passed' &&
        /^pdf-structure:/.test(check.id) && Number.isSafeInteger(check.pageCount)).map(check => ({ name: check.fileName,
        contentSha256: check.contentSha256, pageCount: check.pageCount })) : [];
    const context = { ...(designContext || documentDesignContext(studio.settings)), actualPdfPages };
    const assessed = assessDocumentReview(review.documentReview, candidate?.media?.files || candidate?.files || [], context);
    for (const requirement of documentRequirements) {
      // An explicit human visual review remains separately labelled. Model
      // evidence cannot erase it merely because this worker lacks rendering.
      if (requirement.source === 'user' && requirement.status === 'met' && assessed.status === 'unverified') continue;
      requirementReview(studio, { id: requirement.id, status: assessed.status, evidence: assessed.evidence.slice(0, 8_000) }, candidate, 'model', DOCUMENT_REVIEW_PROOF);
    }
  }
  if (review.verdict === 'accept' && !entries.some(entry => entry.id === 'task-complete')) {
    requirementReview(studio, { id: 'task-complete', status: 'met', evidence: `${side}: ${review.checks.join('; ')}`.slice(0, 8_000) }, candidate, 'model');
  }
  for (const title of review.issues) {
    const prior = studio.issues.find(item => item.title === title);
    if (!prior) issueReview(studio, { title, status: 'found', evidence: `${side}: ${title}` }, 'model');
    else if (prior.status === 'fixed' || prior.status === 'rechecked') issueReview(studio,
      { id: prior.id, status: 'reopened', evidence: `${side}: ${title}` }, 'model');
  }
  for (const entry of review.issueReviews || []) issueReview(studio, entry, 'model', side);
}

function normalizeVerification(report, candidate) {
  if (!report || typeof report !== 'object' || !Array.isArray(report.checks) || report.checks.length > 100) throw new Error('The verification service returned an invalid report.');
  if (report.candidateId !== undefined && report.candidateId !== candidate.id) throw new Error('The verification report names another candidate.');
  if (report.candidateSha256 !== undefined && report.candidateSha256 !== candidate.sha256) throw new Error('The verification report names different candidate bytes.');
  const checks = report.checks.map((check, index) => {
    if (!check || typeof check !== 'object' || !['passed', 'failed', 'unavailable', 'unverified'].includes(check.status)) throw new Error('A verification check is invalid.');
    if (check.source !== 'executed' && check.kind !== 'executed') throw new Error('Local verification checks must describe actual tool execution.');
    if (check.candidateId !== undefined && check.candidateId !== candidate.id) throw new Error('A verification check names another candidate.');
    if (check.candidateSha256 !== undefined && check.candidateSha256 !== candidate.sha256) throw new Error('A verification check names different candidate bytes.');
    let documentIdentity = {};
    // Every local file check carries file identity metadata. Only the parser's
    // numeric page count is document inspection evidence; syntax, rendering,
    // and unavailable parser checks must retain their ordinary check behavior.
    if (check.pageCount !== undefined) {
      const file = (candidate.media?.files || candidate.files || []).find(file => file.name === check.fileName);
      const fileCheckId = file && (file.name.length <= 140 ? file.name :
        `${file.name.slice(0, 110)}-${createHash('sha256').update(file.name).digest('hex').slice(0, 12)}`);
      if (!file || !(/\.pdf$/i.test(file.name) || file.mimeType === 'application/pdf') ||
          check.id !== `pdf-structure:${fileCheckId}` || check.contentSha256 !== file.contentSha256 ||
          !/^[a-f0-9]{64}$/.test(check.contentSha256 || '') || !Number.isSafeInteger(check.pageCount) || check.pageCount < 1 || check.pageCount > 1_000) {
        throw new Error('A PDF page-count check must match the exact candidate file and bounded page count.');
      }
      documentIdentity = { fileName: file.name, contentSha256: file.contentSha256, pageCount: check.pageCount };
    }
    return { id: boundedText(check.id || `check-${index + 1}`, 'Check ID', 180),
      label: boundedText(check.label, 'Check label', 1_000), status: check.status === 'unavailable' ? 'unverified' : check.status,
      source: 'executed', evidence: boundedText(check.evidence || check.details || 'No result evidence was supplied.', 'Check evidence', 16_000),
      ...(check.tool ? { tool: boundedText(check.tool, 'Check tool', 500) } : {}),
      ...(check.requirementId ? { requirementId: boundedText(check.requirementId, 'Check requirement ID', 180) } : {}),
      candidateSha256: candidate.sha256, ...documentIdentity };
  });
  const status = checks.some(item => item.status === 'failed') ? 'failed' :
    !checks.length || checks.some(item => item.status === 'unverified') ? 'unverified' : 'passed';
  return { status, candidateId: candidate.id, candidateSha256: candidate.sha256, checks,
    summary: typeof report.summary === 'string' ? boundedText(report.summary, 'Verification summary', 8_000, true) : '', at: Date.now() };
}

function applyVerification(studio, report, candidate) {
  studio.verification = normalizeVerification(report, candidate);
  for (const requirement of studio.requirements.filter(item => item.gate === 'executed')) {
    const checks = studio.verification.checks.filter(item => item.requirementId === requirement.id || item.id === requirement.id ||
      ((requirement.id === 'program-tests' || (requirement.explicit && requestsProgramTests(requirement.text))) && /^container-tests(?::|$)/.test(item.id)));
    if (!checks.length) continue;
    const status = checks.some(item => item.status === 'failed') ? 'failed' : checks.every(item => item.status === 'passed') ? 'met' : 'unverified';
    requirementReview(studio, { id: requirement.id, status, evidence: checks.map(item => `${item.label}: ${item.evidence}`).join('\n').slice(0, 8_000) }, candidate, 'executed');
  }
  recordHistory(studio, 'verification', `Local checks ${studio.verification.status} for ${candidate.id}.`);
  return studio.verification;
}

function acceptanceBlockers(studio, candidate) {
  const blockers = studio.requirements.filter(item => item.status !== 'met').map(item => `${item.id}: ${item.status}`);
  blockers.push(...studio.issues.filter(item => item.status !== 'rechecked').map(item => `${item.id}: ${item.status}`));
  if (studio.settings.verificationEnabled) {
    const verification = studio.verification;
    // Static checks deliberately record that program tests were not run.
    // Preserve that honest coverage note without requiring program execution
    // for every document or structural-file task. Requested container tests
    // and every unavailable required checker remain completion blockers.
    const relevant = verification.checks.filter(check => !(studio.settings.verificationMode === 'static' && check.id === 'execution-coverage'));
    if (verification.candidateSha256 !== candidate?.sha256 || !['passed', 'unverified'].includes(verification.status) ||
        !relevant.length || relevant.some(check => check.status !== 'passed')) blockers.push('Local verification is incomplete or has failures.');
  }
  if (studio.settings.freshAudit && (studio.freshAudit.candidateSha256 !== candidate?.sha256 || studio.freshAudit.status !== 'passed')) blockers.push('Fresh conversation audit is incomplete.');
  return blockers;
}

function validatePublicStudio(value) {
  if (!value || value.version !== 1) throw new Error('The project studio data is unsupported.');
  const result = emptyStudio({ preset: value.preset, ...value.settings, acceptanceCriteria: value.contract?.acceptanceCriteria || [] });
  if (typeof value.contract?.task === 'string') result.contract.task = boundedText(value.contract.task, 'Saved task', 80_000, true);
  result.contract.createdAt = Number.isFinite(value.contract?.createdAt) ? value.contract.createdAt : null;
  result.contract.userRevision = Number.isInteger(value.contract?.userRevision) && value.contract.userRevision >= 0 ? value.contract.userRevision : 0;
  result.contract.documentOutput = value.contract?.documentOutput === true;
  if (!Array.isArray(value.requirements) || value.requirements.length > 50 || !Array.isArray(value.issues) || value.issues.length > 100) throw new Error('The project review ledger is invalid.');
  for (const item of value.requirements) {
    const id = boundedText(item.id, 'Saved requirement ID', 180);
    if (result.requirements.some(entry => entry.id === id) || !REQUIREMENT_STATUSES.has(item.status) || !['review', 'executed'].includes(item.gate)) throw new Error('A saved requirement is invalid.');
    const evidence = Array.isArray(item.evidence) ? item.evidence.slice(-30).map(entry => {
      if (!SOURCES.has(entry.source) || !REQUIREMENT_STATUSES.has(entry.status)) throw new Error('Saved evidence is invalid.');
      return { source: entry.source, status: entry.status, text: boundedText(entry.text, 'Saved evidence', 8_000),
        candidateId: boundedText(entry.candidateId, 'Evidence candidate ID', 100),
        candidateSha256: boundedText(entry.candidateSha256, 'Evidence hash', 64), at: Number.isFinite(entry.at) ? entry.at : 0 };
    }) : [];
    result.requirements.push({ id, text: boundedText(item.text, 'Saved requirement'), gate: item.gate,
      status: 'unverified', source: null, evidence, revisionId: null, ...(item.explicit ? { explicit: true } : {}) });
  }
  for (const item of value.issues) {
    if (!ISSUE_STATUSES.has(item.status) || !SEVERITIES.has(item.severity) || !['left', 'right', null].includes(item.assignedTo)) throw new Error('A saved issue is invalid.');
    const id = boundedText(item.id, 'Saved issue ID', 100);
    if (result.issues.some(entry => entry.id === id)) throw new Error('Saved issue IDs must be unique.');
    const history = (Array.isArray(item.history) ? item.history : []).slice(-50).map(entry => {
      if (!ISSUE_STATUSES.has(entry.status)) throw new Error('Saved issue history is invalid.');
      return { status: entry.status, evidence: boundedText(entry.evidence, 'Saved issue evidence', 8_000),
        source: SOURCES.has(entry.source) ? entry.source : 'user', revisionId: typeof entry.revisionId === 'string' ? entry.revisionId.slice(0, 100) : null,
        ...(['left', 'right'].includes(entry.reviewer) ? { reviewer: entry.reviewer } : {}),
        at: Number.isFinite(entry.at) ? entry.at : 0 };
    });
    result.issues.push({ id, title: boundedText(item.title, 'Saved issue title'), severity: item.severity,
      status: item.status === 'rechecked' ? 'fixed' : item.status, assignedTo: item.assignedTo,
      revisionId: typeof item.revisionId === 'string' ? item.revisionId.slice(0, 100) : null,
      evidence: boundedText(item.evidence, 'Saved issue evidence', 8_000), history });
  }
  result.history = (Array.isArray(value.history) ? value.history : []).slice(-200).map(item =>
    ({ type: boundedText(item.type, 'Saved history type', 100), detail: boundedText(item.detail, 'Saved history detail', 8_000), at: Number.isFinite(item.at) ? item.at : 0 }));
  return result;
}

module.exports = { PRESETS, emptyStudio, normalizeSettings, criteriaList, syncRequirements, startContract, requestsDocumentOutput,
  invalidateAcceptance, candidateRevision, requirementReview, issueReview, applyModelReview,
  normalizeVerification, applyVerification, acceptanceBlockers, recordHistory, validatePublicStudio, clone };
