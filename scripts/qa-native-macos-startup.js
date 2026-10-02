'use strict';

// This launches the actual packaged application entry point. The packaged QA
// launcher remains a separate offline integration gate against app.asar.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.join(__dirname, '..');
const prefix = 'CONVERGE_MACOS_NATIVE_SMOKE ';

function validateNativeSmoke(report, version, executable) {
  for (const [key, value] of Object.entries({ status: 'PASS', platform: 'darwin', arch: 'arm64', packaged: true, version, visibleShell: true, nativeKeyWindow: true,
    commandShortcutHint: true, nativeMenu: true, didClose: true, embeddedViewsDisposed: true, closeCleanupCompleted: true,
    activateEventComplete: true, freshWorkspaceOnActivate: true })) assert.equal(report[key], value, `Native startup smoke failed its ${key} gate.`);
  assert.equal(path.resolve(report.executable), path.resolve(executable), 'The actual packaged executable did not report the startup check.');
  assert.deepEqual(report.nativeEditingVerified, { shell: true, left: true, right: true }, 'Native editing failed in a shell or embedded view.');
  assert.match(report.visibilityScope, /actual native key window/);
  assert.match(report.activationScope, /not physical Dock input/);
  assert.match(report.providerScope, /no authentication, provider navigation or live model task/);
  return true;
}

async function main() {
  assert.equal(process.platform, 'darwin', 'The actual packaged startup gate requires macOS.');
  assert.equal(process.arch, 'arm64', 'The actual packaged startup gate requires Apple Silicon.');
  const metadata = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const evidence = path.join(root, '.live-test'); fs.mkdirSync(evidence, { recursive: true });
  const executable = path.join(root, metadata.build.directories.output, 'mac-arm64', `${metadata.build.productName}.app`, 'Contents', 'MacOS', metadata.build.productName);
  const environment = { ...process.env, CONVERGE_MACOS_SMOKE_SCREENSHOT: path.join(evidence, 'macos-native-startup.png') };
  delete environment.ELECTRON_RUN_AS_NODE;
  let stdout = '', stderr = '', expired = false;
  const child = spawn(executable, ['--converge-native-startup-smoke'], { cwd: root, env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
  const watchdog = setTimeout(() => { expired = true; child.kill('SIGKILL'); }, 90000);
  const capture = (chunk, target) => {
    const text = chunk.toString('utf8');
    if (target === 'stdout') stdout = (stdout + text).slice(-1024 * 1024);
    else stderr = (stderr + text).slice(-1024 * 1024);
    process[target].write(text);
  };
  child.stdout.on('data', chunk => capture(chunk, 'stdout'));
  child.stderr.on('data', chunk => capture(chunk, 'stderr'));
  try {
    const status = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal })); });
    fs.writeFileSync(path.join(evidence, 'macos-native-startup.stdout.log'), stdout);
    fs.writeFileSync(path.join(evidence, 'macos-native-startup.stderr.log'), stderr);
    assert.ok(!expired, 'The actual packaged app did not finish startup, editing and close/reopen checks within 90 seconds.');
    assert.equal(status.code, 0, `The actual packaged app exited unsuccessfully (${status.code}, ${status.signal}).`);
    const markers = stdout.split(/\r?\n/).filter(line => line.startsWith(prefix));
    assert.equal(markers.length, 1, 'Expected one actual packaged startup result.');
    const report = JSON.parse(markers[0].slice(prefix.length));
    validateNativeSmoke(report, metadata.version, executable);
    fs.writeFileSync(path.join(evidence, 'macos-native-startup.json'), JSON.stringify({ ...report, passed: true, checkedAt: new Date().toISOString() }, null, 2));
  } finally { clearTimeout(watchdog); }
}
if (require.main === module) main().catch(error => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
module.exports = { validateNativeSmoke };
