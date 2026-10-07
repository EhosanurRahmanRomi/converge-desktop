'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { REPOSITORY, WORKFLOWS, validateInputs, validateRun, validateDraft, validateSourceParity, validateNativeReports, validateAssetFiles, validateUploadedRelease } = require('../scripts/qa-publish-artifacts');
const metadata = require('../package.json');
const root = path.join(__dirname, '..');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const copy = value => structuredClone(value);
const run = (kind, id, commit) => ({ databaseId: Number(id), status: 'completed', conclusion: 'success', headSha: commit,
  workflowName: WORKFLOWS[kind].name, url: `https://github.com/${REPOSITORY}/actions/runs/${id}` });
const runs = { windows: run('windows', '37601396822', 'a'.repeat(40)), macos: run('macos', '37601396823', 'b'.repeat(40)) };
function temporary(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'converge-publish-unit-'));
  t.after(() => {
    const relative = path.relative(os.tmpdir(), directory);
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative) && path.basename(directory).startsWith('converge-publish-unit-'));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return directory;
}
function sourceFixture(directory) {
  return metadata.build.files.filter(file => file !== 'package.json').map(file => {
    const bytes = Buffer.from(`Exact inert fixture for ${file}\n`), filename = path.join(directory, file);
    fs.mkdirSync(path.dirname(filename), { recursive: true }); fs.writeFileSync(filename, bytes);
    return { file, bytes: bytes.length, sha256: sha256(bytes) };
  });
}
function reports(parity) {
  const installDirectory = 'C:\\runner\\temp\\converge-installer-check-11111111-1111-4111-8111-111111111111\\installed';
  const native = { status: 'PASS', platform: 'win32', arch: 'x64', packaged: true, version: metadata.version,
    nonce: '11111111-1111-4111-8111-111111111111', visibleShell: true, firstPaint: true, sidebarToggleVerified: true, bossDrawerVerified: true,
    progressSectionVerified: true, didClose: true, embeddedViewsDisposed: true, closeCleanupCompleted: true, isolatedSession: true,
    embeddedViews: ['left', 'right', 'boss'], pid: 1234, executable: path.win32.join(installDirectory, 'Converge.exe'),
    userData: 'C:\\runner\\temp\\converge-native-smoke-1234-11111111-1111-4111-8111-111111111111',
    providerScope: 'no authentication, provider navigation or live model task', clipboardScope: 'does not access the clipboard' };
  return {
    windows: { passed: true, version: metadata.version, platform: 'win32', architecture: 'x64', sourceCommit: runs.windows.headSha,
      workflowRunId: String(runs.windows.databaseId), installation: { isolatedRunnerTarget: true, silentInstallPassed: true, installDirectory,
        pdfjsVersion: metadata.dependencies['pdfjs-dist'], sourceParity: copy(parity) }, nativeStartup: native,
      uninstall: { passed: true, programFilesRemoved: true, keepAppData: true, outsideOwnershipMarkerPreserved: true, remainingFiles: [] } },
    macos: { passed: true, version: metadata.version, platform: 'darwin', architecture: 'arm64', sourceCommit: runs.macos.headSha,
      workflowRunId: String(runs.macos.databaseId), originalBundle: { version: metadata.version,
        signature: { verified: true, type: 'ad-hoc', notarized: false }, sourceParity: copy(parity),
        productionDependencies: { pdfjsVersion: metadata.dependencies['pdfjs-dist'], nativeCanvas: 'darwin-arm64' } },
      archiveRoundTrips: { zip: { signatureVerified: true, sourceBytesMatched: true, permissionsAndSymlinksVerified: true },
        dmg: { imageVerified: true, signatureVerified: true, sourceBytesMatched: true, applicationsShortcutVerified: true } } },
  };
}

test('dispatch requires explicit native runs, this repository and the matching stable draft tag', () => {
  const environment = { GITHUB_REPOSITORY: REPOSITORY, WINDOWS_RUN_ID: '37601396822', MACOS_RUN_ID: '37601396823', EXPECTED_VERSION: metadata.version, RELEASE_TAG: `v${metadata.version}` };
  assert.equal(validateInputs(environment, metadata).version, metadata.version);
  for (const change of [{ GITHUB_REPOSITORY: 'other/repository' }, { WINDOWS_RUN_ID: '1; curl bad' }, { MACOS_RUN_ID: environment.WINDOWS_RUN_ID },
    { EXPECTED_VERSION: '1.9.9-beta' }, { RELEASE_TAG: 'latest' }, { EXPECTED_VERSION: '99.9.9' }]) assert.throws(() => validateInputs({ ...environment, ...change }, metadata));
});

test('native run provenance rejects wrong workflows, fork commits, pending or failed builds', () => {
  const current = runs.windows, id = String(current.databaseId), api = { id: current.databaseId, repository: { full_name: REPOSITORY },
    head_repository: { full_name: REPOSITORY }, head_sha: current.headSha, path: WORKFLOWS.windows.path, status: 'completed', conclusion: 'success' };
  assert.equal(validateRun(current, api, 'windows', id), current);
  for (const change of [{ conclusion: 'failure' }, { status: 'in_progress' }, { headSha: 'bad' }, { workflowName: WORKFLOWS.macos.name },
    { url: `https://github.com/other/repo/actions/runs/${id}` }, { databaseId: 37601396824 }]) assert.throws(() => validateRun({ ...current, ...change }, api, 'windows', id));
  for (const change of [{ path: '.github/workflows/other.yml' }, { head_sha: 'f'.repeat(40) }, { head_repository: { full_name: 'fork/repo' } },
    { repository: { full_name: 'other/repo' } }]) assert.throws(() => validateRun(current, { ...api, ...change }, 'windows', id));
});

test('existing draft guards reject published, immutable, missing and wrong releases', () => {
  const release = { databaseId: 123, tagName: `v${metadata.version}`, isDraft: true, isImmutable: false };
  assert.equal(validateDraft(release, release.tagName), 123);
  for (const change of [{ isDraft: false }, { isImmutable: true }, { databaseId: null }, { tagName: 'v0.0.1' }]) assert.throws(() => validateDraft({ ...release, ...change }, release.tagName));
});

test('all 41 runtime source bytes must match even when successful native runs use different verifier commits', t => {
  const directory = temporary(t), parity = sourceFixture(directory), { windows, macos } = reports(parity);
  assert.equal(validateNativeReports(windows, macos, runs, metadata, directory).windowsParity.length, 41);
  assert.notEqual(windows.sourceCommit, macos.sourceCommit);
  const changed = copy(parity); changed[0].sha256 = '0'.repeat(64);
  assert.throws(() => validateSourceParity(changed, metadata, directory), /source bytes differ/);
  assert.throws(() => validateSourceParity(parity.slice(1), metadata, directory), /coverage/);
  assert.throws(() => validateSourceParity([...parity, parity[0]], metadata, directory), /coverage/);
  const duplicate = copy(parity); duplicate[0] = copy(duplicate[1]); assert.throws(() => validateSourceParity(duplicate, metadata, directory), /repeated/);
  const enlarged = copy(metadata); enlarged.build.files.push('new-runtime.js'); assert.throws(() => validateSourceParity(parity, enlarged, directory), /altered runtime manifest/);
  fs.appendFileSync(path.join(directory, parity[0].file), 'unexpected current source change');
  assert.throws(() => validateNativeReports(windows, macos, runs, metadata, directory), /source size differs/);
});

test('native evidence cannot be accepted from another run or with failed startup, uninstall, PDF dependency or Mac roundtrip', t => {
  const directory = temporary(t), parity = sourceFixture(directory), original = reports(parity);
  const changes = [
    value => { value.windows.sourceCommit = runs.macos.headSha; },
    value => { value.macos.workflowRunId = '99999999999'; },
    value => { value.windows.nativeStartup.firstPaint = false; },
    value => { value.windows.uninstall.remainingFiles = ['Converge.exe']; },
    value => { value.windows.installation.pdfjsVersion = '0.0.1'; },
    value => { value.macos.originalBundle.signature.verified = false; },
    value => { value.macos.archiveRoundTrips.dmg.sourceBytesMatched = false; },
  ];
  for (const change of changes) { const values = copy(original); change(values); assert.throws(() => validateNativeReports(values.windows, values.macos, runs, metadata, directory)); }
});

test('downloaded native binaries require exact names, sizes, hashes, checksums and no extra artifact files', async t => {
  const directory = temporary(t), name = `Converge-Setup-${metadata.version}-x64.exe`, bytes = Buffer.from('Inert fixture, not an executable.');
  const item = { name, bytes: bytes.length, sha256: sha256(bytes) }, checksum = 'SHA256SUMS-Windows-Installer.txt', report = 'windows-installer-verification.json';
  fs.writeFileSync(path.join(directory, name), bytes); fs.writeFileSync(path.join(directory, report), '{}');
  fs.writeFileSync(path.join(directory, checksum), `${item.sha256}  ${name}\r\n`);
  assert.equal((await validateAssetFiles(directory, [item], [name], checksum, report)).length, 1);
  await assert.rejects(validateAssetFiles(directory, [{ ...item, name: '../outside.exe' }], [name], checksum, report), /filenames/);
  await assert.rejects(validateAssetFiles(directory, [{ ...item, bytes: item.bytes + 1 }], [name], checksum, report), /size differs/);
  await assert.rejects(validateAssetFiles(directory, [{ ...item, sha256: '0'.repeat(64) }], [name], checksum, report), /hash differs/);
  fs.writeFileSync(path.join(directory, checksum), `${'0'.repeat(64)}  ${name}\n`);
  await assert.rejects(validateAssetFiles(directory, [item], [name], checksum, report), /checksums differ/);
  fs.writeFileSync(path.join(directory, checksum), `${item.sha256}  ${name}\n`); fs.writeFileSync(path.join(directory, 'unexpected.zip'), 'extra');
  await assert.rejects(validateAssetFiles(directory, [item], [name], checksum, report), /unexpected files/);
});

test('transfer workflow tests the guards and cannot create, publish or replace portable assets', () => {
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/publish-verified-assets.yml'), 'utf8');
  const helper = fs.readFileSync(path.join(root, 'scripts/qa-publish-artifacts.js'), 'utf8');
  assert.match(workflow, /actions: read/); assert.match(workflow, /contents: write/); assert.match(workflow, /runs-on: ubuntu-latest/);
  for (const field of ['windows_run_id', 'macos_run_id', 'release_tag', 'expected_version']) assert.match(workflow, new RegExp(`${field}:`));
  assert.ok(workflow.indexOf('node --test test/publish-artifacts.test.js') < workflow.indexOf('node scripts/qa-publish-artifacts.js'));
  assert.match(helper, /\['release', 'upload'/); assert.doesNotMatch(helper, /\['release', '(?:create|edit|delete)'/);
  assert.doesNotMatch(helper, /--draft(?:=|\s+)false|Converge-Portable-/);
  assert.match(helper, /validateUploadedRelease\(gh\(releaseArgs, true\), inputs.tag, draftId, receipts, beforeUpload.assets\)/);
});

test('server upload receipts require exact hashes and sizes while preserving every unrelated draft asset', () => {
  const prior = { name: 'existing-portable.exe', size: 50, digest: `sha256:${'a'.repeat(64)}` };
  const receipt = { name: 'new-installer.exe', bytes: 100, sha256: 'b'.repeat(64) };
  const release = { databaseId: 123, tagName: `v${metadata.version}`, isDraft: true, isImmutable: false,
    assets: [prior, { name: receipt.name, size: receipt.bytes, digest: `sha256:${receipt.sha256}` }] };
  assert.equal(validateUploadedRelease(release, release.tagName, 123, [receipt], [prior]), true);
  for (const mutate of [value => { value.isDraft = false; }, value => { value.assets.pop(); },
    value => { value.assets[1].digest = `sha256:${'0'.repeat(64)}`; }, value => { value.assets[1].size++; },
    value => { value.assets[0].digest = `sha256:${'0'.repeat(64)}`; }, value => { value.assets.push(copy(value.assets[1])); }]) {
    const changed = copy(release); mutate(changed);
    assert.throws(() => validateUploadedRelease(changed, release.tagName, 123, [receipt], [prior]));
  }
});
