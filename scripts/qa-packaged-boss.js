'use strict';

// Runs the current boss workflow using the production archive and its actual
// package metadata. All provider replies and file dialogs are offline fixtures.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawn } = require('node:child_process');
const asar = require('@electron/asar');

const root = path.join(__dirname, '..');
const archive = path.resolve(process.env.CONVERGE_PACKAGED_ASAR || path.join(root, 'dist/win-unpacked/resources/app.asar'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

async function run() {
  const sourceMetadata = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const metadata = JSON.parse(asar.extractFile(archive, 'package.json').toString('utf8'));
  assert.equal(metadata.version, sourceMetadata.version, 'Packaged boss version differs from current source.');
  assert.equal(metadata.main, 'desktop-main.js');
  const files = sourceMetadata.build.files.filter(file => file !== 'package.json');
  for (const file of files) {
    assert.equal(hash(asar.extractFile(archive, path.normalize(file))), hash(fs.readFileSync(path.join(root, file))), `Packaged ${file} differs from current source.`);
  }
  const reportPath = path.join(root, '.live-test/boss-workspace-qa-packaged/packaged-result.json');
  if (fs.existsSync(reportPath)) fs.unlinkSync(reportPath);
  const launchRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'converge-packaged-boss-'));
  fs.writeFileSync(path.join(launchRoot, 'package.json'), JSON.stringify({ ...metadata, main: 'launch.js' }));
  fs.writeFileSync(path.join(launchRoot, 'launch.js'), `require(${JSON.stringify(path.join(__dirname, 'qa-boss-workspace.js'))});\n`);
  const environment = { ...process.env, CONVERGE_PACKAGED_ASAR: archive };
  delete environment.ELECTRON_RUN_AS_NODE;
  try {
    const exitCode = await new Promise((resolve, reject) => {
      const child = spawn(require('electron'), [launchRoot], { cwd: root, env: environment, stdio: 'inherit', windowsHide: true });
      child.once('error', reject);
      child.once('close', code => resolve(code ?? 1));
    });
    assert.equal(exitCode, 0, `Packaged boss QA exited with status ${exitCode}.`);
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    assert.equal(report.passed, true);
    assert.equal(report.localFixturesOnly, true);
    assert.ok(report.tests.length >= 16, 'The complete boss workflow did not run.');
    assert.equal(report.packageVersion, metadata.version);
    assert.equal(report.launcherVersion, metadata.version);
    assert.equal(report.bootstrapVersion, metadata.version);
    assert.deepEqual(report.captureWarnings, [], 'Boss workflow captures were not complete.');
    report.archiveSha256 = hash(fs.readFileSync(archive));
    report.productionFilesCompared = files;
    report.launchNote = 'Actual production archive under a metadata-matched Electron launcher. Offline provider and dialog fixtures; native packaged startup is checked separately.';
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    process.stdout.write(JSON.stringify({ passed: true, version: metadata.version, platform: report.platform, workflows: report.tests.length, parityFiles: files.length }) + '\n');
  } finally {
    const relative = path.relative(os.tmpdir(), launchRoot);
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative) && path.basename(launchRoot).startsWith('converge-packaged-boss-'), 'Unsafe temporary launcher cleanup path.');
    fs.rmSync(launchRoot, { recursive: true, force: true });
  }
}

run().catch(error => { process.stderr.write(`Packaged boss QA failed: ${error.stack || error.message}\n`); process.exitCode = 1; });
