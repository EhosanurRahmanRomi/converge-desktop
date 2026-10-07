'use strict';

// Real production archive, Electron IPC, native picker and Chromium file inputs.
// Only the provider page and picker selection are controlled offline fixtures.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawn } = require('node:child_process');
const asar = require('@electron/asar');

const root = path.join(__dirname, '..');
const SIDES = ['left', 'right', 'boss'];
const SOURCE_BYTES = 100 * 1024 * 1024;
const CHUNK_CHARACTERS = 1024 * 1024;
const TIMEOUT_MS = 3 * 60 * 1000;
const LAUNCH_PREFIX = 'converge-packaged-large-upload-';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

function validateReport(report, metadata, launcherVersion) {
  assert.equal(report.passed, true, report.error || 'The packaged large-upload fixture failed.');
  assert.equal(report.localFixturesOnly, true);
  assert.equal(report.packaged, true);
  assert.equal(report.packageVersion, metadata.version, 'The fixture did not use the packaged version.');
  assert.equal(launcherVersion, metadata.version, 'The Electron launcher did not use packaged metadata.');
  assert.equal(report.bootstrapVersion, metadata.version, 'The production bootstrap version differs from the archive.');
  assert.equal(report.platform, process.platform);
  assert.equal(report.arch, process.arch);
  assert.equal(report.source?.name, 'large-source-100MiB.pdf');
  assert.equal(report.source.bytes, SOURCE_BYTES);
  assert.match(report.source.sha256, /^[a-f0-9]{64}$/);
  assert.equal(report.nativePickerInvocations, 1, 'The upload picker must be invoked exactly once.');
  assert.equal(report.sidebar?.ready, true, 'The sidebar remained disabled after successful upload.');
  assert.equal(report.sidebar.error, '');
  assert.ok(report.sidebar.fileStatus.includes(report.source.name));
  assert.ok(Array.isArray(report.tests) && report.tests.length >= 6, 'The complete production upload workflow did not run.');
  assert.deepEqual(report.consoleMessages, [], 'The browser pages reported errors.');
  assert.deepEqual(report.blockedRemoteOrigins, [], 'The fixture attempted remote provider access.');
  assert.deepEqual(Object.keys(report.receipts || {}).sort(), [...SIDES].sort());
  assert.deepEqual(Object.keys(report.wire || {}).sort(), [...SIDES].sort());
  const expectedCharacters = Math.ceil(SOURCE_BYTES / 3) * 4;
  const expectedChunks = Math.ceil(expectedCharacters / CHUNK_CHARACTERS);
  assert.equal(expectedChunks, 134);
  for (const side of SIDES) {
    const receipt = report.receipts[side];
    assert.equal(receipt.changes, 1, `${side} uploaded the source more than once.`);
    assert.deepEqual(receipt.errors, [], `${side} failed to read the upload.`);
    assert.deepEqual(receipt.receipts, [{ name: report.source.name, bytes: SOURCE_BYTES,
      mimeType: 'application/pdf', sha256: report.source.sha256 }], `${side} received different file bytes.`);
    assert.deepEqual(receipt.selected, [{ name: report.source.name, size: SOURCE_BYTES,
      type: 'application/pdf' }], `${side} did not select the exact source in its real file input.`);
    const wire = report.wire[side];
    assert.equal(wire.begins, 1, `${side} started more than one staged upload.`);
    assert.equal(wire.commits, 1, `${side} did not commit exactly once.`);
    assert.equal(wire.chunks, expectedChunks, `${side} used an unexpected number of chunks.`);
    assert.equal(wire.receivedCharacters, expectedCharacters, `${side} lost or repeated chunk data.`);
    assert.equal(wire.maxChunkLength, CHUNK_CHARACTERS, `${side} did not use bounded 1 MiB chunks.`);
    assert.ok(wire.maxWireBytes > CHUNK_CHARACTERS && wire.maxWireBytes <= CHUNK_CHARACTERS + 2048,
      `${side} sent an oversized Electron message.`);
  }
  assert.match(report.scope, /ChatGPT service acceptance, live model responses and large-file downloads are not tested/);
  return true;
}

function cleanupLauncher(launchRoot, temporaryRoot) {
  const resolved = fs.realpathSync(launchRoot);
  const relative = path.relative(temporaryRoot, resolved);
  assert.ok(relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative) && path.basename(resolved).startsWith(LAUNCH_PREFIX),
  'Unsafe temporary launcher cleanup path.');
  fs.rmSync(resolved, { recursive: true, force: true });
}

async function stopOwnedProcess(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform !== 'win32') { child.kill('SIGKILL'); return; }
  await new Promise(resolve => {
    const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'],
      { windowsHide: true, stdio: 'ignore' });
    const timer = setTimeout(() => { killer.kill(); child.kill(); resolve(); }, 3000);
    const done = () => { clearTimeout(timer); resolve(); };
    killer.once('error', () => { child.kill(); done(); });
    killer.once('close', done);
  });
}

async function run() {
  const began = Date.now();
  const archive = path.resolve(process.env.CONVERGE_PACKAGED_ASAR || path.join(root, 'dist/win-unpacked/resources/app.asar'));
  const reportPath = path.join(root, '.live-test/large-upload/packaged-result.json');
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  if (fs.existsSync(reportPath)) fs.unlinkSync(reportPath);
  let launchRoot, child;
  const temporaryRoot = fs.realpathSync(os.tmpdir());
  try {
    const sourceMetadata = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const metadata = JSON.parse(asar.extractFile(archive, 'package.json').toString('utf8'));
    const runtimeMetadata = { ...sourceMetadata };
    for (const key of ['scripts', 'devDependencies', 'build']) delete runtimeMetadata[key];
    assert.deepEqual(metadata, runtimeMetadata, 'Packaged runtime metadata differs from current source.');
    assert.equal(metadata.main, 'desktop-main.js');
    const files = sourceMetadata.build.files;
    assert.ok(Array.isArray(files) && files.includes('package.json'));
    const compared = [];
    for (const file of files) {
      assert.equal(typeof file, 'string');
      if (file === 'package.json') continue; // Runtime object checked above; the builder strips development fields.
      const source = fs.readFileSync(path.join(root, file));
      const packaged = asar.extractFile(archive, path.normalize(file));
      assert.deepEqual(packaged, source, `Packaged ${file} differs from current source.`);
      compared.push({ filename: file, bytes: source.length, sha256: digest(source) });
    }
    const archiveSha256 = digest(fs.readFileSync(archive));
    launchRoot = fs.mkdtempSync(path.join(temporaryRoot, LAUNCH_PREFIX));
    const fixtureTemp = path.join(launchRoot, 'fixture-temp');
    fs.mkdirSync(fixtureTemp);
    const launcherReport = path.join(launchRoot, 'launcher-version.json');
    fs.writeFileSync(path.join(launchRoot, 'package.json'), JSON.stringify({ ...metadata, main: 'launch.js' }));
    fs.writeFileSync(path.join(launchRoot, 'launch.js'),
      `const { app } = require('electron');\n` +
      `require('node:fs').writeFileSync(${JSON.stringify(launcherReport)}, JSON.stringify({ version: app.getVersion() }));\n` +
      `require(${JSON.stringify(path.join(__dirname, 'qa-large-upload.js'))});\n`);
    const environment = { ...process.env, CONVERGE_PACKAGED_ASAR: archive,
      CONVERGE_LARGE_UPLOAD_REPORT: reportPath, TEMP: fixtureTemp, TMP: fixtureTemp, TMPDIR: fixtureTemp };
    delete environment.ELECTRON_RUN_AS_NODE;
    const remaining = TIMEOUT_MS - (Date.now() - began);
    assert.ok(remaining > 0, 'Packaged parity exceeded the three-minute QA budget.');
    const exitCode = await new Promise((resolve, reject) => {
      child = spawn(require('electron'), [launchRoot], { cwd: root, env: environment,
        stdio: 'inherit', windowsHide: true });
      let expired = false;
      const timer = setTimeout(() => {
        expired = true;
        stopOwnedProcess(child).finally(() => reject(new Error('Packaged large-upload QA exceeded its three-minute deadline.')));
      }, remaining);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('close', code => { clearTimeout(timer); if (!expired) resolve(code ?? 1); });
    });
    assert.equal(exitCode, 0, `Packaged large-upload QA exited with status ${exitCode}.`);
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    const launcherVersion = JSON.parse(fs.readFileSync(launcherReport, 'utf8')).version;
    validateReport(report, metadata, launcherVersion);
    assert.equal(digest(fs.readFileSync(archive)), archiveSha256, 'Production archive changed during verification.');
    Object.assign(report, { launcherVersion, checkedAt: new Date().toISOString(), archivePath: archive,
      archiveSha256, productionFilesCompared: files, runtimeFiles: compared,
      packageMetadata: { runtimeMetadataEqual: true, removedDevelopmentFields: ['scripts', 'devDependencies', 'build'] },
      launchNote: 'Actual production archive under a metadata-matched Electron launcher. Offline provider/picker-selection fixture; actual portable startup is a separate gate.' });
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    process.stdout.write(JSON.stringify({ passed: true, version: metadata.version, sourceBytes: SOURCE_BYTES,
      sides: SIDES, chunksPerPage: 134, parityFiles: compared.length, archiveSha256, reportPath }) + '\n');
    return report;
  } catch (error) {
    let report = {};
    try { report = JSON.parse(fs.readFileSync(reportPath, 'utf8')); } catch (_) { }
    fs.writeFileSync(reportPath, JSON.stringify({ ...report, passed: false, checkedAt: new Date().toISOString(),
      wrapperError: error.stack || error.message }, null, 2));
    throw error;
  } finally {
    await stopOwnedProcess(child);
    if (launchRoot) cleanupLauncher(launchRoot, temporaryRoot);
  }
}

if (require.main === module) run().catch(error => {
  process.stderr.write(`Packaged large-upload QA failed: ${error.stack || error.message}\n`);
  process.exitCode = 1;
});

module.exports = { validateReport };
