'use strict';

// Launch the delivered Windows executable itself. Portable NSIS wrappers can
// detach output streams, so a nonce-bound file report is the completion gate.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { spawn } = require('node:child_process');
const root = path.join(__dirname, '..');

function validateWindowsSmoke(report, version, executable, nonce) {
  for (const [key, expected] of Object.entries({ status: 'PASS', platform: 'win32', arch: 'x64', packaged: true,
    version, nonce, visibleShell: true, firstPaint: true, sidebarToggleVerified: true, bossDrawerVerified: true,
    progressSectionVerified: true, didClose: true, embeddedViewsDisposed: true, closeCleanupCompleted: true, isolatedSession: true })) {
    assert.equal(report[key], expected, `Windows startup smoke failed its ${key} gate.`);
  }
  assert.deepEqual(report.embeddedViews, ['left', 'right', 'boss']);
  assert.ok(Number.isInteger(report.pid) && report.pid > 0, 'The native app did not report its process identity.');
  const actualEntry = report.portableExecutable || report.executable;
  assert.equal(path.resolve(actualEntry).toLowerCase(), path.resolve(executable).toLowerCase(), 'The report did not come from the requested packaged executable.');
  assert.match(report.userData, /converge-native-smoke-\d+-[\da-f-]+$/i, 'The native smoke did not isolate user data.');
  assert.match(report.providerScope, /no authentication, provider navigation or live model task/);
  assert.match(report.clipboardScope, /does not access the clipboard/);
  return true;
}

function terminateOwnedTree(pid) {
  if (!Number.isInteger(pid) || pid < 1 || pid === process.pid) return Promise.resolve();
  return new Promise(resolve => {
    const child = spawn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    child.once('error', resolve); child.once('close', resolve);
  });
}

async function main() {
  assert.equal(process.platform, 'win32', 'The actual packaged startup gate requires Windows.');
  const metadata = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  const executable = path.resolve(process.argv[2] || path.join(root, metadata.build.directories.output, `Converge-Portable-${metadata.version}-x64.exe`));
  assert.ok((await fs.stat(executable)).isFile(), 'Choose an existing Windows portable or packaged executable.');
  const nonce = randomUUID();
  const evidence = path.join(root, '.live-test', `windows-native-startup-${nonce}`);
  await fs.mkdir(evidence, { recursive: true });
  const reportFile = path.join(evidence, 'report.json');
  const env = { ...process.env, CONVERGE_WINDOWS_SMOKE_REPORT: reportFile,
    CONVERGE_WINDOWS_SMOKE_NONCE: nonce, CONVERGE_WINDOWS_SMOKE_SCREENSHOT: path.join(evidence, 'startup.png') };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(executable, ['--converge-windows-startup-smoke'], { cwd: root, env,
    windowsHide: false, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '', launchError = null, exit = null, report = null;
  child.on('error', error => { launchError = error; });
  child.on('close', (code, signal) => { exit = { code, signal }; });
  child.stdout.on('data', chunk => { stdout = (stdout + chunk.toString('utf8')).slice(-1024 * 1024); });
  child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString('utf8')).slice(-1024 * 1024); });
  let passed = false;
  const began = Date.now();
  try {
    while (Date.now() - began < 90000) {
      if (launchError) throw launchError;
      try {
        const snapshot = JSON.parse(await fs.readFile(reportFile, 'utf8'));
        if (snapshot.nonce === nonce) report = snapshot;
      } catch (error) { if (!['ENOENT'].includes(error.code) && !(error instanceof SyntaxError)) throw error; }
      if (report?.status === 'FAIL') throw new Error(report.error || 'The native Windows app failed its startup check.');
      if (report?.status === 'PASS') break;
      // Exit code alone is not completion: a portable wrapper may detach its
      // extracted packaged process before that process writes its report.
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    assert.ok(report?.status === 'PASS', `No native startup completion report within 90 seconds. Wrapper exit: ${JSON.stringify(exit)}.`);
    validateWindowsSmoke(report, metadata.version, executable, nonce);
    const executableSha256 = createHash('sha256').update(await fs.readFile(executable)).digest('hex');
    const complete = { ...report, passed: true, checkedAt: new Date().toISOString(), launchPath: executable, executableSha256, wrapperExit: exit };
    await fs.writeFile(path.join(evidence, 'verified.json'), JSON.stringify(complete, null, 2));
    passed = true;
    process.stdout.write(`CONVERGE_WINDOWS_NATIVE_SMOKE ${JSON.stringify(complete)}\n`);
    process.stdout.write(`Evidence: ${evidence}\n`);
  } finally {
    await fs.writeFile(path.join(evidence, 'stdout.log'), stdout);
    await fs.writeFile(path.join(evidence, 'stderr.log'), stderr);
    if (!passed) {
      // Only processes launched by this gate or nonce-bound reports are ours.
      // Never find/kill a user's app by process name or install directory.
      if (report?.nonce === nonce) await terminateOwnedTree(report.pid);
      if (!exit && child.pid) await terminateOwnedTree(child.pid);
    }
  }
}

if (require.main === module) main().catch(error => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
module.exports = { validateWindowsSmoke };
