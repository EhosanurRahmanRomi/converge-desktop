'use strict';

const { normalizeCandidate, fileDescriptor, sha256, boundedJSON, safeMemberName } = require('./identity');
const { sanitizeSnapshot, sanitizeRecord } = require('./project-store');
const { createZip } = require('./archive');
const { isStoredFile, getStoredFilePath } = require('../browser/file-store');

function matchingVerification(verification, candidate) {
  if (!verification || verification.status === 'idle' || (!verification.candidateId && !verification.candidateSha256)) return { status: 'unverified', candidateId: candidate.id, candidateSha256: candidate.sha256, checks: [],
    summary: 'No local verification report is available for this exact candidate.' };
  if (verification.candidateId !== candidate.id || verification.candidateSha256 !== candidate.sha256) throw new Error('The verification report belongs to another candidate. Verify this exact result before exporting.');
  if (verification.status === 'running') return { status: 'unverified', candidateId: candidate.id, candidateSha256: candidate.sha256,
    checks: [], inProgress: true, summary: 'Local verification was still running when this delivery was requested. No completed local report is included.' };
  if (!['passed', 'failed', 'unverified'].includes(verification.status) || !Array.isArray(verification.checks) || verification.checks.length > 100 ||
      verification.checks.some(check => !['passed', 'failed', 'unverified'].includes(check.status) || (check.candidateSha256 && check.candidateSha256 !== candidate.sha256))) throw new Error('The verification report is invalid.');
  const reported = verification.files || [];
  if (reported.length && JSON.stringify(reported.map(fileDescriptor)) !== JSON.stringify(candidate.files.map(fileDescriptor))) throw new Error('The verification file identities do not match the exported files.');
  const report = sanitizeRecord(verification);
  // Export never upgrades incomplete or contradictory evidence to success.
  report.status = report.status === 'failed' || report.checks.some(check => check.status === 'failed') ? 'failed' :
    report.status === 'unverified' || !report.checks.length || report.checks.some(check => check.status === 'unverified') ? 'unverified' : 'passed';
  return report;
}

function prepareDeliveryPackage({ candidate, verification, project = {}, requirementStatuses = [], unresolvedIssues = [],
  workflowStatus = 'unknown', bossSummary = '', limitations = [] } = {}) {
  const current = normalizeCandidate(candidate), report = matchingVerification(verification, current);
  if (!Array.isArray(requirementStatuses) || requirementStatuses.length > 100 || !Array.isArray(unresolvedIssues) || unresolvedIssues.length > 200 ||
      !Array.isArray(limitations) || limitations.length > 200 || typeof workflowStatus !== 'string' || workflowStatus.length > 100 || typeof bossSummary !== 'string' || bossSummary.length > 100_000) throw new Error('Delivery requirements, summary or issue history exceed the limit.');
  const requirements = sanitizeRecord(requirementStatuses), issues = sanitizeRecord(unresolvedIssues);
  const checkpoint = { name: String(project.name || 'Converge project').slice(0, 180), snapshot: sanitizeSnapshot(project.snapshot || {}),
    revisions: sanitizeRecord(project.revisions || []), decisionHistory: sanitizeRecord(project.decisionHistory || []) };
  const entries = [], add = (name, bytes) => entries.push({ name, bytes: Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes, 'utf8') });
  for (const file of current.files) {
    if (isStoredFile(file)) entries.push({ name: `files/${file.name}`, filePath: getStoredFilePath(file), byteLength: file.byteLength, contentSha256: file.contentSha256 });
    else add(`files/${file.name}`, file.bytes);
  }
  add('final-answer.md', current.answer);
  add('verification.json', boundedJSON(report, 'Verification report'));
  add('requirements.json', boundedJSON(requirements, 'Requirement statuses'));
  add('revisions.json', boundedJSON(checkpoint, 'Revision history'));
  add('unresolved-issues.json', boundedJSON(issues, 'Unresolved issues'));
  add('delivery-summary.json', boundedJSON({ workflowStatus, bossSummary, limitations: sanitizeRecord(limitations),
    localVerificationStatus: report.status, requirementStatuses: requirements, unresolvedIssues: issues }, 'Delivery summary'));
  const logs = report.checks.map(check => `${check.label || check.id} [${check.status}]\nSource: ${check.source || 'not specified'}\n${check.evidence || 'No execution evidence supplied.'}`).join('\n\n');
  add('execution-logs.txt', logs);
  const failures = report.checks.filter(check => check.status === 'failed').length, unavailable = report.checks.filter(check => check.status === 'unverified').length;
  add('README.md', `# ${checkpoint.name.replace(/[\r\n]/g, ' ')}\n\n` +
    `Candidate: ${current.id}\n\nSHA-256: ${current.sha256}\n\nWorkflow status: **${workflowStatus.replace(/[\r\n*]/g, '')}**.\n\nLocal verification status: **${report.status}** (${failures} failed; ${unavailable} unverified).\n\n` +
    'Open `final-answer.md` for the current candidate text and `files/` for its exact output files. The package preserves their bytes and filenames. Completion and review status are recorded in `delivery-summary.json`; a blocked or unfinished workflow remains partial.\n\n' +
    'Read `verification.json` and `execution-logs.txt` for actual local checks and their scope. Read `requirements.json`, `delivery-summary.json` and `unresolved-issues.json` for the boss summary, limitations and remaining work. `revisions.json` records saved changes and decisions.\n\n' +
    'Syntax, parsing and byte identity checks do not establish program behavior, visual quality, profitability or task correctness. A passed individual check applies only to the stated test. Any unavailable checks remain unverified. Container tests run only when explicitly enabled with an installed isolated runtime and the fixed local image.\n\n' +
    '`manifest.json` lists SHA-256 and byte length for every content member. `manifest.sha256` hashes the manifest itself. Browser authentication, cookies and live request state are excluded from project metadata. A saved record cannot restore an authenticated remote session.\n');
  const manifest = { format: 'converge-delivery', version: 1, createdAt: new Date().toISOString(), candidateId: current.id, candidateSha256: current.sha256,
    verificationStatus: report.status, workflowStatus, files: entries.map(entry => ({ name: entry.name, sha256: entry.contentSha256 || sha256(entry.bytes), byteLength: entry.byteLength ?? entry.bytes.length })) };
  const manifestText = boundedJSON(manifest, 'Delivery manifest');
  add('manifest.json', manifestText); add('manifest.sha256', `${sha256(manifestText)}  manifest.json\n`);
  const stem = safeMemberName(`Converge-${current.id.replace(/[^a-z0-9_. -]/gi, '_').slice(0, 60)}-delivery.zip`);
  return { name: stem, entries, manifest, candidateId: current.id, candidateSha256: current.sha256, status: report.status };
}

function createDeliveryPackage(options) {
  const prepared = prepareDeliveryPackage(options);
  if (prepared.entries.some(entry => entry.filePath) || prepared.entries.reduce((sum, entry) => sum + entry.bytes.length, 0) > 16 * 1024 * 1024) throw new Error('Use streaming delivery export for disk-backed or large files.');
  const { entries, ...result } = prepared; return { ...result, bytes: createZip(entries) };
}
async function writeDeliveryPackage(prepared, destination, options) {
  await require('./archive').writeZipFile(prepared.entries, destination, options);
  const { entries: _entries, ...result } = prepared; return result;
}
async function createDeliveryPackageTo(options, destination, streamOptions) { return writeDeliveryPackage(prepareDeliveryPackage(options), destination, streamOptions); }

module.exports = { createDeliveryPackage, prepareDeliveryPackage, writeDeliveryPackage, createDeliveryPackageTo, matchingVerification };
