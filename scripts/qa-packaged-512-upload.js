'use strict';

// Bind the large native transport/recovery result to the final production ASAR.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawn } = require('node:child_process');
const asar = require('@electron/asar');
const root = path.join(__dirname, '..');
const SIDES = ['left', 'right', 'boss'], SOURCE_BYTES = 512 * 1024 * 1024;
const LAUNCH_PREFIX = 'converge-packaged-512-upload-';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
async function digestFile(filename) { const hash = createHash('sha256'); for await (const chunk of fs.createReadStream(filename, { highWaterMark: 786432 })) hash.update(chunk); return hash.digest('hex'); }

function validateReport(report, metadata, launcherVersion) {
  assert.equal(report.passed, true, report.error || 'The packaged 512 MiB fixture failed.');
  assert.equal(report.localFixturesOnly, true); assert.equal(report.packaged, true);
  assert.equal(report.packageVersion, metadata.version); assert.equal(report.bootstrapVersion, metadata.version); assert.equal(launcherVersion, metadata.version);
  assert.equal(report.platform, process.platform); assert.equal(report.arch, process.arch);
  assert.equal(report.source?.name, 'large-source-512MiB.pdf'); assert.equal(report.source.bytes, SOURCE_BYTES); assert.match(report.source.sha256, /^[a-f0-9]{64}$/);
  assert.equal(report.nativePickerInvocations, 3);
  assert.ok(report.tests?.length >= 9); assert.deepEqual(report.consoleMessages, []); assert.deepEqual(report.blockedRemoteOrigins, []);
  assert.equal(report.sidebar?.ready, true); assert.equal(report.sidebar.error, ''); assert.equal(report.sidebar.progressHidden, true);
  assert.ok(report.sidebar.fileStatus.includes(report.source.name));
  assert.ok(report.heartbeat?.count > 50 && report.heartbeat.maxGapMs < 1500);
  assert.deepEqual(report.heartbeat.stopMisses, []);
  for (const phase of ['reading', 'staging', 'processing']) assert.ok(report.heartbeat.phases.includes(phase));
  assert.ok(report.memory.peakArrayBuffers < 128 * 1024 * 1024);
  assert.ok(report.memory.peakHeapUsed - report.memory.initial.heapUsed < 256 * 1024 * 1024);
  const expectedCharacters = Math.ceil(SOURCE_BYTES / 3) * 4, expectedChunks = Math.ceil(expectedCharacters / 1048576);
  assert.deepEqual(Object.keys(report.receipts).sort(), [...SIDES].sort());
  for (const side of SIDES) {
    const receipt = report.receipts[side], wire = report.wire[side], hashed = report.independentHashes[side];
    assert.equal(receipt.changes, 1); assert.equal(receipt.fullFileReads, 0); assert.deepEqual(receipt.errors, []);
    assert.deepEqual(receipt.receipts, [{ name: report.source.name, bytes: SOURCE_BYTES, mimeType: 'application/pdf', sha256: report.source.sha256 }]);
    assert.deepEqual(receipt.selected, [{ name: report.source.name, size: SOURCE_BYTES, type: 'application/pdf' }]);
    assert.equal(hashed.bytes, SOURCE_BYTES); assert.equal(hashed.sha256, report.source.sha256); assert.ok(hashed.maxReturnBytes <= 786432 + 65536);
    assert.equal(wire.begins, 1); assert.equal(wire.commits, 1); assert.equal(wire.aborts, 0);
    assert.equal(wire.chunks, expectedChunks); assert.equal(wire.deliveredChunks, expectedChunks); assert.equal(wire.receivedCharacters, expectedCharacters);
    assert.equal(wire.maxChunkLength, 1048576); assert.ok(wire.maxWireBytes <= 1048576 + 2048);
    assert.equal(report.cancellation.wire[side].commits, 0);
  }
  assert.ok(report.cancellation.cancelDurationMs < 2500);
  assert.equal(report.cancellation.wire[report.cancellation.heldChunk.side].deliveredChunks, 3);
  assert.equal(report.cancellation.wire[report.cancellation.heldChunk.side].aborts, 1);
  assert.equal(report.projectEvidence.originalDeletedBeforeReload, true);
  assert.equal(report.projectEvidence.reloadHash.bytes, SOURCE_BYTES); assert.equal(report.projectEvidence.reloadHash.sha256, report.source.sha256);
  const blob = report.projectEvidence.members.find(entry => entry.name === `blobs/${report.source.sha256}.blob`);
  assert.equal(blob?.bytes, SOURCE_BYTES); assert.equal(blob.sha256, report.source.sha256);
  assert.match(report.projectEvidence.archive.sha256, /^[a-f0-9]{64}$/);
  assert.ok(report.projectEvidence.archive.bytes > SOURCE_BYTES);
  assert.match(report.scope, /ChatGPT service acceptance, live model responses and large-file downloads are not tested/);
  return true;
}
async function stopOwnedProcess(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform !== 'win32') { child.kill('SIGKILL'); return; }
  await new Promise(resolve => {
    const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    const timer = setTimeout(() => { killer.kill(); child.kill(); resolve(); }, 3000);
    const done = () => { clearTimeout(timer); resolve(); };
    killer.once('error', () => { child.kill(); done(); }); killer.once('close', done);
  });
}
async function run() {
  const archive = path.resolve(process.env.CONVERGE_PACKAGED_ASAR || path.join(root, 'dist/win-unpacked/resources/app.asar'));
  const reportPath = path.join(root, '.live-test', '512-upload', 'packaged-result.json');
  fs.mkdirSync(path.dirname(reportPath), { recursive: true }); if (fs.existsSync(reportPath)) fs.unlinkSync(reportPath);
  const temporaryRoot = fs.realpathSync(os.tmpdir()); let launchRoot, child;
  try {
    const sourceMetadata = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const metadata = JSON.parse(asar.extractFile(archive, 'package.json').toString('utf8'));
    const runtimeMetadata = { ...sourceMetadata }; for (const key of ['scripts', 'devDependencies', 'build']) delete runtimeMetadata[key];
    assert.deepEqual(metadata, runtimeMetadata, 'Packaged metadata differs from source.'); assert.equal(metadata.main, 'desktop-main.js');
    const files = sourceMetadata.build.files, compared = [];
    assert.ok(Array.isArray(files) && files.includes('package.json'));
    for (const file of files) {
      assert.equal(typeof file, 'string'); if (file === 'package.json') continue;
      const source = fs.readFileSync(path.join(root, file)), packaged = asar.extractFile(archive, path.normalize(file));
      assert.deepEqual(packaged, source, `Packaged ${file} differs from current source.`);
      compared.push({ filename: file, bytes: source.length, sha256: digest(source) });
    }
    const archiveSha256 = await digestFile(archive);
    launchRoot = fs.mkdtempSync(path.join(temporaryRoot, LAUNCH_PREFIX));
    const fixtureTemp = path.join(launchRoot, 'fixture-temp'), launcherReport = path.join(launchRoot, 'launcher-version.json'); fs.mkdirSync(fixtureTemp);
    fs.writeFileSync(path.join(launchRoot, 'package.json'), JSON.stringify({ ...metadata, main: 'launch.js' }));
    fs.writeFileSync(path.join(launchRoot, 'launch.js'), `const { app }=require('electron');\nrequire('node:fs').writeFileSync(${JSON.stringify(launcherReport)},JSON.stringify({version:app.getVersion()}));\nrequire(${JSON.stringify(path.join(__dirname, 'qa-512-upload.js'))});\n`);
    const env = { ...process.env, CONVERGE_PACKAGED_ASAR: archive, CONVERGE_512_UPLOAD_REPORT: reportPath, TEMP: fixtureTemp, TMP: fixtureTemp, TMPDIR: fixtureTemp }; delete env.ELECTRON_RUN_AS_NODE;
    const exitCode = await new Promise((resolve, reject) => {
      child = spawn(require('electron'), [launchRoot], { cwd: root, env, stdio: 'inherit', windowsHide: true });
      let expired = false;
      const timer = setTimeout(() => { expired = true; stopOwnedProcess(child).finally(() => reject(new Error('Packaged 512 MiB QA exceeded its twenty-one-minute deadline.'))); }, 1260000);
      child.once('error', error => { clearTimeout(timer); reject(error); }); child.once('close', code => { clearTimeout(timer); if (!expired) resolve(code ?? 1); });
    });
    assert.equal(exitCode, 0, `Packaged 512 MiB QA exited with status ${exitCode}.`);
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8')), launcherVersion = JSON.parse(fs.readFileSync(launcherReport, 'utf8')).version;
    validateReport(report, metadata, launcherVersion);
    assert.equal(await digestFile(archive), archiveSha256, 'Production ASAR changed during verification.');
    Object.assign(report, { launcherVersion, checkedAt: new Date().toISOString(), archivePath: archive, archiveSha256,
      productionFilesCompared: files, runtimeFiles: compared, packageMetadata: { runtimeMetadataEqual: true, removedDevelopmentFields: ['scripts', 'devDependencies', 'build'] },
      launchNote: 'Final production ASAR under a metadata-matched Electron launcher. Provider/picker selection is an offline fixture; actual portable executable startup remains a separate gate.' });
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    process.stdout.write(JSON.stringify({ passed: true, version: metadata.version, sourceBytes: SOURCE_BYTES, sides: SIDES, parityFiles: compared.length, archiveSha256, reportPath }) + '\n'); return report;
  } catch (error) {
    let report = {}; try { report = JSON.parse(fs.readFileSync(reportPath, 'utf8')); } catch (_) {}
    fs.writeFileSync(reportPath, JSON.stringify({ ...report, passed: false, checkedAt: new Date().toISOString(), wrapperError: error.stack || error.message }, null, 2)); throw error;
  } finally {
    await stopOwnedProcess(child);
    if (launchRoot) {
      const resolved = fs.realpathSync(launchRoot), relative = path.relative(temporaryRoot, resolved);
      assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative) && path.basename(resolved).startsWith(LAUNCH_PREFIX), 'Unsafe temporary launcher cleanup.');
      fs.rmSync(resolved, { recursive: true, force: true });
    }
  }
}
if (require.main === module) run().catch(error => { process.stderr.write(`Packaged 512 MiB upload QA failed: ${error.stack || error.message}\n`); process.exitCode = 1; });
module.exports = { validateReport };
