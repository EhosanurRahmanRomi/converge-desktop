'use strict';

// Transfer already verified native assets inside GitHub. This helper cannot
// create or publish a release, and never uploads the portable or source files.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { validateRuntimeCoverage } = require('./macos-package-lib');
const { validateWindowsSmoke } = require('./qa-native-windows-startup');
const REPOSITORY = 'EhosanurRahmanRomi/converge-desktop';
const WORKFLOWS = Object.freeze({
  windows: { name: 'Native Windows installer release checks', path: '.github/workflows/windows-release.yml', artifact: 'Converge-Windows-x64-installer-release' },
  macos: { name: 'Native macOS ARM64 release checks', path: '.github/workflows/macos-arm64.yml', artifact: 'Converge-macOS-arm64-release' },
});
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

function validateInputs(environment, metadata) {
  assert.equal(environment.GITHUB_REPOSITORY, REPOSITORY, 'Only this repository can receive the release assets.');
  const version = environment.EXPECTED_VERSION || '1.9.9';
  assert.match(version, /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/, 'Use an exact stable release version.');
  assert.equal(metadata.version, version, 'The current checkout has a different version.');
  const tag = environment.RELEASE_TAG || `v${version}`;
  assert.equal(tag, `v${version}`, 'The release tag must match the exact version.');
  const windowsRunId = environment.WINDOWS_RUN_ID, macosRunId = environment.MACOS_RUN_ID;
  for (const id of [windowsRunId, macosRunId]) assert.match(id || '', /^[1-9]\d{5,19}$/, 'An explicit native workflow run ID is required.');
  assert.notEqual(windowsRunId, macosRunId, 'Choose the two distinct native workflow runs.');
  return { repository: REPOSITORY, version, tag, windowsRunId, macosRunId };
}

function validateRun(run, apiRun, kind, id) {
  const workflow = WORKFLOWS[kind]; assert.ok(workflow, 'Unknown native workflow.');
  assert.equal(String(run.databaseId), id, 'The native run ID differs.');
  assert.equal(run.status, 'completed', 'The native run is still in progress.');
  assert.equal(run.conclusion, 'success', 'The native run did not pass.');
  assert.equal(run.workflowName, workflow.name, 'The native workflow name differs.');
  assert.equal(run.url, `https://github.com/${REPOSITORY}/actions/runs/${id}`, 'The native run belongs to another repository.');
  assert.match(run.headSha || '', /^[a-f0-9]{40}$/, 'The native run commit is invalid.');
  assert.equal(String(apiRun.id), id);
  assert.equal(apiRun.repository?.full_name, REPOSITORY);
  assert.equal(apiRun.head_repository?.full_name, REPOSITORY, 'Fork-built artifacts cannot be uploaded.');
  assert.equal(apiRun.head_sha, run.headSha);
  assert.equal(apiRun.path, workflow.path, 'The native workflow path differs.');
  assert.equal(apiRun.status, 'completed'); assert.equal(apiRun.conclusion, 'success');
  return run;
}

function validateDraft(release, tag) {
  assert.equal(release.tagName, tag, 'The existing release has a different tag.');
  assert.equal(release.isDraft, true, 'Assets may only be uploaded into an existing draft.');
  assert.ok(Number.isSafeInteger(release.databaseId) && release.databaseId > 0, 'An existing release identity is required.');
  assert.notEqual(release.isImmutable, true, 'An immutable release cannot receive assets.');
  return release.databaseId;
}

function validateSourceParity(parity, metadata, sourceRoot) {
  validateRuntimeCoverage(metadata);
  const expected = metadata.build.files.filter(filename => filename !== 'package.json');
  assert.equal(expected.length, 41, 'Review an altered runtime manifest before uploading a new release.');
  assert.equal(new Set(expected).size, expected.length, 'The current runtime manifest contains duplicate paths.');
  assert.ok(Array.isArray(parity)); assert.equal(parity.length, expected.length, 'The native report has incomplete or extra source coverage.');
  const seen = new Set();
  for (const item of parity) {
    assert.ok(item && expected.includes(item.file) && !seen.has(item.file), 'Unexpected or repeated packaged source path.');
    assert.ok(!item.file.includes('\\') && !path.posix.isAbsolute(item.file) && !item.file.split('/').includes('..'), 'Unsafe source path.');
    seen.add(item.file);
    const source = fs.readFileSync(path.join(sourceRoot, item.file));
    assert.equal(item.bytes, source.length, `Native source size differs: ${item.file}`);
    assert.equal(item.sha256, digest(source), `Native source bytes differ: ${item.file}`);
  }
  return parity;
}

function validateReportProvenance(report, run, version) {
  assert.equal(report.passed, true, 'Native verification did not pass.');
  assert.equal(report.version, version, 'Native verification has a different release version.');
  assert.equal(report.sourceCommit, run.headSha, 'The native report is not from the selected run commit.');
  assert.equal(String(report.workflowRunId), String(run.databaseId), 'The native report is not from the selected workflow run.');
}

function validateNativeReports(windows, macos, runs, metadata, sourceRoot) {
  validateReportProvenance(windows, runs.windows, metadata.version);
  validateReportProvenance(macos, runs.macos, metadata.version);
  assert.equal(windows.platform, 'win32'); assert.equal(windows.architecture, 'x64');
  assert.equal(windows.installation?.isolatedRunnerTarget, true); assert.equal(windows.installation?.silentInstallPassed, true);
  assert.equal(windows.installation?.pdfjsVersion, metadata.dependencies['pdfjs-dist']);
  const installedExecutable = path.win32.join(windows.installation.installDirectory, `${metadata.build.productName}.exe`);
  validateWindowsSmoke(windows.nativeStartup, metadata.version, installedExecutable, windows.nativeStartup?.nonce);
  assert.match(windows.nativeStartup.nonce || '', /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i);
  for (const key of ['passed', 'programFilesRemoved', 'keepAppData', 'outsideOwnershipMarkerPreserved']) assert.equal(windows.uninstall?.[key], true, `Native uninstall did not pass ${key}.`);
  assert.deepEqual(windows.uninstall.remainingFiles, []);
  assert.equal(macos.platform, 'darwin'); assert.equal(macos.architecture, 'arm64');
  assert.equal(macos.originalBundle?.version, metadata.version);
  assert.equal(macos.originalBundle?.signature?.verified, true); assert.equal(macos.originalBundle?.signature?.type, 'ad-hoc');
  assert.equal(macos.originalBundle?.signature?.notarized, false);
  assert.equal(macos.originalBundle?.productionDependencies?.pdfjsVersion, metadata.dependencies['pdfjs-dist']);
  assert.equal(macos.originalBundle?.productionDependencies?.nativeCanvas, 'darwin-arm64');
  assert.deepEqual(macos.archiveRoundTrips, {
    zip: { signatureVerified: true, sourceBytesMatched: true, permissionsAndSymlinksVerified: true },
    dmg: { imageVerified: true, signatureVerified: true, sourceBytesMatched: true, applicationsShortcutVerified: true },
  });
  const windowsParity = validateSourceParity(windows.installation.sourceParity, metadata, sourceRoot);
  const macosParity = validateSourceParity(macos.originalBundle.sourceParity, metadata, sourceRoot);
  const byFile = values => [...values].sort((a, b) => a.file.localeCompare(b.file));
  assert.deepEqual(byFile(windowsParity), byFile(macosParity), 'The Windows and Mac packaged source bytes differ.');
  return { windowsParity, macosParity };
}

async function fileDigest(filename) {
  const hash = createHash('sha256');
  for await (const bytes of fs.createReadStream(filename)) hash.update(bytes);
  return hash.digest('hex');
}

async function validateAssetFiles(directory, items, expectedNames, checksumName, reportName) {
  assert.ok(Array.isArray(items)); assert.equal(items.length, expectedNames.length);
  assert.deepEqual(items.map(item => item.name).sort(), [...expectedNames].sort(), 'Unexpected native release filenames.');
  assert.deepEqual(fs.readdirSync(directory).sort(), [...expectedNames, checksumName, reportName].sort(), 'The named artifact includes missing or unexpected files.');
  const verified = [];
  for (const item of items) {
    assert.ok(Number.isSafeInteger(item.bytes) && item.bytes > 0 && item.bytes <= 2 * 1024 ** 3, 'Invalid native asset size.');
    assert.match(item.sha256 || '', /^[a-f0-9]{64}$/, 'Invalid native asset hash.');
    const filename = path.join(directory, item.name), stat = fs.lstatSync(filename);
    assert.ok(stat.isFile() && !stat.isSymbolicLink(), 'Only regular artifact files can be uploaded.');
    assert.equal(stat.size, item.bytes, `Native artifact size differs: ${item.name}`);
    assert.equal(await fileDigest(filename), item.sha256, `Native artifact hash differs: ${item.name}`);
    verified.push({ ...item, filename });
  }
  for (const name of [checksumName, reportName]) {
    const stat = fs.lstatSync(path.join(directory, name));
    assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 8 * 1024 ** 2, 'Invalid verification document.');
  }
  const actualChecksums = fs.readFileSync(path.join(directory, checksumName), 'utf8').trim().split(/\r?\n/).sort();
  assert.deepEqual(actualChecksums, items.map(item => `${item.sha256}  ${item.name}`).sort(), 'Native checksums differ from the verification report.');
  return verified;
}

function validateUploadedRelease(release, tag, draftId, receipts, previousAssets) {
  assert.equal(validateDraft(release, tag), draftId, 'The release was published or changed during transfer.');
  assert.ok(Array.isArray(release.assets), 'The server upload receipt has no assets.');
  const find = name => {
    const found = release.assets.filter(item => item.name === name);
    assert.equal(found.length, 1, `The server must contain one exact asset: ${name}`);
    return found[0];
  };
  const names = new Set(receipts.map(item => item.name)); assert.equal(names.size, receipts.length);
  for (const receipt of receipts) {
    const actual = find(receipt.name);
    assert.equal(actual.size, receipt.bytes, `Uploaded server size differs: ${receipt.name}`);
    assert.equal(actual.digest, `sha256:${receipt.sha256}`, `Uploaded server hash differs: ${receipt.name}`);
  }
  for (const prior of previousAssets) {
    if (names.has(prior.name)) continue;
    const actual = find(prior.name);
    assert.equal(actual.size, prior.size, `A preserved release asset changed: ${prior.name}`);
    assert.equal(actual.digest, prior.digest, `A preserved release asset hash changed: ${prior.name}`);
  }
  return true;
}

function gh(args, json = false) {
  const result = spawnSync('gh', args, { encoding: 'utf8', maxBuffer: 16 * 1024 ** 2, timeout: 300_000, stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.error) throw new Error(`GitHub transfer failed: ${result.error.code || result.error.message}`);
  assert.equal(result.status, 0, `GitHub transfer command failed: ${(result.stderr || result.stdout).slice(-2000)}`);
  return json ? JSON.parse(result.stdout) : result.stdout;
}

async function main() {
  assert.equal(process.platform, 'linux', 'Asset transfer runs on the disposable Linux GitHub runner.');
  assert.equal(process.env.GITHUB_ACTIONS, 'true'); assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted');
  const root = path.join(__dirname, '..'), metadata = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const inputs = validateInputs(process.env, metadata);
  const checkedOut = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
  assert.equal(checkedOut.status, 0); const sourceCommit = checkedOut.stdout.trim();
  assert.equal(sourceCommit, process.env.GITHUB_SHA, 'The upload checkout commit differs from its workflow.');
  const releaseArgs = ['release', 'view', inputs.tag, '--repo', inputs.repository, '--json', 'databaseId,tagName,isDraft,isImmutable,assets'];
  const draftId = validateDraft(gh(releaseArgs, true), inputs.tag);
  const directory = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP, 'converge-verified-transfer-'));
  const runs = {};
  for (const [kind, id] of [['windows', inputs.windowsRunId], ['macos', inputs.macosRunId]]) {
    const run = gh(['run', 'view', id, '--repo', inputs.repository, '--json', 'databaseId,status,conclusion,headSha,workflowName,url'], true);
    const apiRun = gh(['api', `repos/${inputs.repository}/actions/runs/${id}`], true);
    runs[kind] = validateRun(run, apiRun, kind, id);
    const output = path.join(directory, kind); fs.mkdirSync(output);
    gh(['run', 'download', id, '--repo', inputs.repository, '--name', WORKFLOWS[kind].artifact, '--dir', output]);
  }
  const readReport = filename => { const stat = fs.lstatSync(filename); assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 8 * 1024 ** 2); return JSON.parse(fs.readFileSync(filename, 'utf8')); };
  const windows = readReport(path.join(directory, 'windows', 'windows-installer-verification.json'));
  const macos = readReport(path.join(directory, 'macos', 'macos-verification.json'));
  validateNativeReports(windows, macos, runs, metadata, root);
  const windowsName = `Converge-Setup-${inputs.version}-x64.exe`;
  const macosNames = ['dmg', 'zip'].map(extension => `Converge-${inputs.version}-macOS-arm64.${extension}`);
  const windowsAssets = await validateAssetFiles(path.join(directory, 'windows'), [windows.installer], [windowsName], 'SHA256SUMS-Windows-Installer.txt', 'windows-installer-verification.json');
  const macosAssets = await validateAssetFiles(path.join(directory, 'macos'), macos.artifacts, macosNames, 'SHA256SUMS-macOS.txt', 'macos-verification.json');
  const assets = [...windowsAssets.map(item => item.filename), ...macosAssets.map(item => item.filename),
    path.join(directory, 'windows', 'windows-installer-verification.json'), path.join(directory, 'windows', 'SHA256SUMS-Windows-Installer.txt'),
    path.join(directory, 'macos', 'macos-verification.json'), path.join(directory, 'macos', 'SHA256SUMS-macOS.txt')];
  const receipts = await Promise.all(assets.map(async filename => ({ name: path.basename(filename), bytes: fs.statSync(filename).size, sha256: await fileDigest(filename) })));
  // Check again immediately before mutation. The workflow never publishes the
  // draft, and release publication must wait until this transfer has completed.
  const beforeUpload = gh(releaseArgs, true);
  assert.equal(validateDraft(beforeUpload, inputs.tag), draftId, 'The draft release identity changed.');
  assert.ok(Array.isArray(beforeUpload.assets), 'The draft asset inventory is unavailable.');
  gh(['release', 'upload', inputs.tag, ...assets, '--repo', inputs.repository, '--clobber']);
  validateUploadedRelease(gh(releaseArgs, true), inputs.tag, draftId, receipts, beforeUpload.assets);
  const report = { passed: true, releaseStillDraft: true, repository: inputs.repository, tag: inputs.tag, version: inputs.version,
    uploadSourceCommit: sourceCommit, windowsRun: { id: inputs.windowsRunId, sourceCommit: runs.windows.headSha },
    macosRun: { id: inputs.macosRunId, sourceCommit: runs.macos.headSha }, runtimeParityFiles: 41,
    uploadedAssets: receipts, serverSizesAndDigestsVerified: true, existingAssetsPreserved: true,
    binaries: [...windowsAssets, ...macosAssets].map(({ filename, ...item }) => item),
    scope: 'Verified native binaries transferred into an existing draft only. All current runtime bytes match both native reports. No release was created/published and the portable/source assets were not uploaded or replaced.' };
  const evidence = path.join(root, '.live-test'); fs.mkdirSync(evidence, { recursive: true });
  fs.writeFileSync(path.join(evidence, 'verified-release-transfer.json'), JSON.stringify(report, null, 2));
  process.stdout.write(`CONVERGE_DRAFT_ASSET_TRANSFER ${JSON.stringify(report)}\n`);
}

if (require.main === module) main().catch(error => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
module.exports = { REPOSITORY, WORKFLOWS, validateInputs, validateRun, validateDraft, validateSourceParity, validateNativeReports, validateAssetFiles, validateUploadedRelease };
