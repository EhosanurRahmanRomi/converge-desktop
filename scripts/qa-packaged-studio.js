'use strict';

// Load the actual production archive under Electron using matching package
// metadata. The native studio fixture still blocks every remote provider URL.
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
  const metadata = JSON.parse(asar.extractFile(archive, 'package.json').toString());
  assert.equal(metadata.version, sourceMetadata.version); assert.equal(metadata.main, 'desktop-main.js');
  const prefixes = ['src/studio/', 'src/studio-services/', 'src/platform/'];
  const required = new Set(sourceMetadata.build.files.filter(file => !file.includes('*') && file !== 'package.json'));
  for (const member of asar.listPackage(archive)) {
    const name = member.replace(/^[/\\]+/, '').replace(/\\/g, '/');
    if (prefixes.some(prefix => name.startsWith(prefix)) && fs.existsSync(path.join(root, name)) && fs.statSync(path.join(root, name)).isFile()) required.add(name);
  }
  for (const file of required) assert.equal(hash(asar.extractFile(archive, path.normalize(file))), hash(fs.readFileSync(path.join(root, file))), `Packaged ${file} differs from source.`);
  for (const file of ['src/studio/workflow.js', 'src/studio/project.js', 'src/platform/studio-desktop.js', 'src/studio-services/verification-lab.js', 'renderer/studio-ui.js', 'renderer/studio-ui.css']) {
    assert.ok(required.has(file), `Required studio runtime ${file} is absent from the production archive.`);
  }
  const reportPath = path.join(root, '.live-test/studio-workspace-qa-packaged/packaged-result.json');
  if (fs.existsSync(reportPath)) fs.unlinkSync(reportPath);
  const launchRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'converge-packaged-studio-'));
  fs.writeFileSync(path.join(launchRoot, 'package.json'), JSON.stringify({ ...metadata, main: 'launch.js' }));
  fs.writeFileSync(path.join(launchRoot, 'launch.js'), `require(${JSON.stringify(path.join(__dirname, 'qa-studio-workspace.js'))});\n`);
  const environment = { ...process.env, CONVERGE_PACKAGED_ASAR: archive }; delete environment.ELECTRON_RUN_AS_NODE;
  try {
    const exitCode = await new Promise((resolve, reject) => {
      const child = spawn(require('electron'), [launchRoot], { cwd: root, env: environment, windowsHide: true, stdio: 'inherit' });
      child.once('error', reject); child.once('close', code => resolve(code ?? 1));
    });
    assert.equal(exitCode, 0, `Packaged studio QA exited with status ${exitCode}.`);
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    assert.equal(report.passed, true); assert.equal(report.localFixturesOnly, true); assert.ok(report.tests.length >= 12);
    assert.equal(report.packageVersion, metadata.version); assert.equal(report.launcherVersion, metadata.version); assert.equal(report.bootstrapVersion, metadata.version);
    assert.equal(report.generatedProgramExecuted, false);
    report.archiveSha256 = hash(fs.readFileSync(archive)); report.productionFilesCompared = [...required];
    report.launchNote = 'Production app.asar with metadata-matched Electron launcher, shell preload IPC, native views, file downloads, real static checker and offline provider/dialog fixtures.';
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    process.stdout.write(JSON.stringify({ passed: true, version: metadata.version, checks: report.tests.length, parityFiles: required.size }) + '\n');
  } finally {
    const relative = path.relative(os.tmpdir(), launchRoot);
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative) && path.basename(launchRoot).startsWith('converge-packaged-studio-'));
    fs.rmSync(launchRoot, { recursive: true, force: true });
  }
}

run().catch(error => { process.stderr.write(`Packaged studio QA failed: ${error.stack || error.message}\n`); process.exitCode = 1; });
