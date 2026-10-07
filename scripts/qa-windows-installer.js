'use strict';

// Installation is deliberately restricted to a disposable GitHub Windows
// runner. This script must never install/uninstall on a user's local machine.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const { validateWindowsSmoke } = require('./qa-native-windows-startup');
const { validateRuntimeCoverage } = require('./macos-package-lib');
const root = path.join(__dirname, '..');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function validateInstallerEnvironment(environment, platform = process.platform, arch = process.arch) {
  assert.equal(platform, 'win32', 'Installer verification requires Windows.');
  assert.equal(arch, 'x64', 'Installer verification requires the Windows x64 runner.');
  assert.equal(environment.GITHUB_ACTIONS, 'true', 'Installer execution is restricted to a disposable GitHub runner.');
  assert.equal(environment.RUNNER_ENVIRONMENT, 'github-hosted', 'Installer execution must use a fresh GitHub-hosted runner.');
  assert.equal(environment.RUNNER_OS, 'Windows', 'Installer execution requires the GitHub Windows runner.');
  assert.ok(typeof environment.RUNNER_TEMP === 'string' && path.win32.isAbsolute(environment.RUNNER_TEMP), 'An absolute owned runner temporary directory is required.');
  return true;
}

function validateOwnedInstallDirectory(directory, runnerTemporaryDirectory) {
  const rootDirectory = path.win32.resolve(runnerTemporaryDirectory), resolved = path.win32.resolve(directory);
  const relative = path.win32.relative(rootDirectory, resolved);
  assert.ok(relative && !path.win32.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..\\'), 'Installer directory escaped the runner temporary directory.');
  const parts = relative.split('\\');
  assert.ok(parts.length === 2 && /^converge-installer-check-[0-9a-f-]{36}$/i.test(parts[0]) && parts[1] === 'installed', 'Installer directory is not the owned isolated test target.');
  return resolved;
}

function inspectInstalledSource(installDirectory, sourceRoot, metadata, extractFile) {
  validateRuntimeCoverage(metadata);
  const archive = path.join(installDirectory, 'resources', 'app.asar');
  const packagedMetadata = JSON.parse(extractFile(archive, 'package.json').toString('utf8'));
  const runtimeMetadata = { ...metadata }; for (const key of ['scripts', 'devDependencies', 'build']) delete runtimeMetadata[key];
  assert.deepEqual(packagedMetadata, runtimeMetadata, 'The installed runtime metadata differs from the published source.');
  const parity = metadata.build.files.filter(filename => filename !== 'package.json').map(filename => {
    const source = fs.readFileSync(path.join(sourceRoot, filename)), installed = extractFile(archive, path.normalize(filename));
    assert.deepEqual(installed, source, `Installed source differs: ${filename}`);
    return { file: filename, bytes: installed.length, sha256: sha256(installed) };
  });
  const parser = JSON.parse(extractFile(archive, 'node_modules/pdfjs-dist/package.json').toString('utf8'));
  assert.equal(parser.version, metadata.dependencies['pdfjs-dist'], 'The installed production PDF parser version differs.');
  for (const filename of ['node_modules/pdfjs-dist/legacy/build/pdf.mjs', 'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs']) {
    assert.ok(extractFile(archive, filename).length > 0, `Installed PDF runtime is missing ${filename}.`);
  }
  return { parity, pdfjsVersion: parser.version };
}

function runOwnedCommand(executable, args, { environment, logStem, timeoutMs = 180_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: root, env: environment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', timedOut = false;
    const capture = (chunk, stream) => {
      const value = chunk.toString('utf8');
      if (stream === 'stdout') stdout = (stdout + value).slice(-2 * 1024 * 1024);
      else stderr = (stderr + value).slice(-2 * 1024 * 1024);
      process[stream].write(value);
    };
    child.stdout.on('data', value => capture(value, 'stdout')); child.stderr.on('data', value => capture(value, 'stderr'));
    const watchdog = setTimeout(() => {
      timedOut = true;
      // Only the process tree launched by this isolated check is owned.
      if (Number.isInteger(child.pid)) spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    }, timeoutMs);
    const save = () => {
      clearTimeout(watchdog);
      if (logStem) { fs.writeFileSync(`${logStem}.stdout.log`, stdout); fs.writeFileSync(`${logStem}.stderr.log`, stderr); }
    };
    child.once('error', error => { save(); reject(error); });
    child.once('close', (code, signal) => {
      save();
      if (timedOut || code !== 0) reject(new Error(`Owned installer check failed (${path.basename(executable)}; exit ${code}; signal ${signal}; timedOut=${timedOut}).`));
      else resolve({ code, signal, stdout, stderr });
    });
  });
}

async function waitFor(predicate, timeoutMs, message) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 200)); }
  throw new Error(message);
}

async function main() {
  validateInstallerEnvironment(process.env);
  const metadata = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.notEqual(metadata.build.nsis.deleteAppDataOnUninstall, true, 'The release must not delete project/account data on uninstall.');
  const artifactName = `Converge-Setup-${metadata.version}-x64.exe`;
  const installer = path.join(root, metadata.build.directories.output, artifactName);
  assert.ok(fs.statSync(installer).isFile(), 'Build the official NSIS installer before verification.');
  const nonce = randomUUID(), temporaryDirectory = path.join(process.env.RUNNER_TEMP, `converge-installer-check-${nonce}`);
  const installDirectory = validateOwnedInstallDirectory(path.join(temporaryDirectory, 'installed'), process.env.RUNNER_TEMP);
  assert.ok(!fs.existsSync(temporaryDirectory), 'The owned test target already exists.');
  fs.mkdirSync(temporaryDirectory); fs.writeFileSync(path.join(temporaryDirectory, 'ownership.txt'), nonce);
  const evidence = path.join(root, '.live-test', `windows-installer-${nonce}`); fs.mkdirSync(evidence, { recursive: true });
  const environment = { ...process.env }; delete environment.ELECTRON_RUN_AS_NODE;
  delete environment.PORTABLE_EXECUTABLE_FILE; delete environment.PORTABLE_EXECUTABLE_DIR;
  const installerBytes = fs.readFileSync(installer), installerSha256 = sha256(installerBytes);
  // /D is the final NSIS option and is passed directly without shell quoting.
  await runOwnedCommand(installer, ['/S', '/currentuser', `/D=${installDirectory}`], { environment, logStem: path.join(evidence, 'install') });
  const executable = path.join(installDirectory, `${metadata.build.productName}.exe`);
  await waitFor(() => fs.existsSync(executable), 30_000, 'The installer did not create the application in the isolated target.');
  assert.ok(!fs.lstatSync(installDirectory).isSymbolicLink(), 'The installer test directory is a link.');
  const installed = inspectInstalledSource(installDirectory, root, metadata, require('@electron/asar').extractFile);
  const asarSha256 = sha256(fs.readFileSync(path.join(installDirectory, 'resources', 'app.asar')));
  const native = await runOwnedCommand(process.execPath, [path.join(__dirname, 'qa-native-windows-startup.js'), executable],
    { environment, logStem: path.join(evidence, 'native'), timeoutMs: 120_000 });
  const markers = native.stdout.split(/\r?\n/).filter(line => line.startsWith('CONVERGE_WINDOWS_NATIVE_SMOKE '));
  assert.equal(markers.length, 1, 'The installed app must produce one completed native startup result.');
  const startup = JSON.parse(markers[0].slice('CONVERGE_WINDOWS_NATIVE_SMOKE '.length));
  validateWindowsSmoke(startup, metadata.version, executable, startup.nonce);
  assert.ok(path.win32.relative(installDirectory, startup.executable) === `${metadata.build.productName}.exe`, 'Startup did not use the installed binary.');
  const uninstaller = path.join(installDirectory, `Uninstall ${metadata.build.productName}.exe`);
  assert.ok(fs.statSync(uninstaller).isFile(), 'The official installer did not provide its uninstaller.');
  validateOwnedInstallDirectory(installDirectory, process.env.RUNNER_TEMP);
  const uninstallerCopy = path.join(temporaryDirectory, 'owned-uninstaller.exe');
  fs.copyFileSync(uninstaller, uninstallerCopy, fs.constants.COPYFILE_EXCL);
  assert.equal(sha256(fs.readFileSync(uninstallerCopy)), sha256(fs.readFileSync(uninstaller)), 'The owned uninstaller copy differs.');
  // KEEP_APP_DATA explicitly retains account/project data. _?= binds NSIS to
  // this exact install. Run our verified outside copy so NSIS can remove its
  // installed uninstaller as well, rather than keeping a running image locked.
  await runOwnedCommand(uninstallerCopy, ['/S', '/KEEP_APP_DATA', '/currentuser', `_?=${installDirectory}`],
    { environment, logStem: path.join(evidence, 'uninstall') });
  await waitFor(() => !fs.existsSync(executable) && !fs.existsSync(path.join(installDirectory, 'resources')), 30_000,
    'Uninstall left application program files behind.');
  const remainingFiles = fs.existsSync(installDirectory) ? fs.readdirSync(installDirectory) : [];
  assert.deepEqual(remainingFiles, [], 'Uninstall left files in the isolated application directory.');
  assert.equal(fs.readFileSync(path.join(temporaryDirectory, 'ownership.txt'), 'utf8'), nonce, 'Uninstall escaped its application target.');
  const sourceCommit = (await runOwnedCommand('git.exe', ['rev-parse', 'HEAD'], { environment })).stdout.trim();
  assert.match(sourceCommit, /^[a-f0-9]{40}$/); assert.equal(sourceCommit, process.env.GITHUB_SHA, 'Installer source differs from the workflow commit.');
  assert.equal(sha256(fs.readFileSync(installer)), installerSha256, 'Installer bytes changed during native verification.');
  const report = { passed: true, version: metadata.version, platform: process.platform, architecture: process.arch,
    checkedAt: new Date().toISOString(), sourceCommit, workflowRunId: process.env.GITHUB_RUN_ID, installer: { name: artifactName,
      bytes: installerBytes.length, sha256: installerSha256, signing: 'unsigned' },
    installation: { isolatedRunnerTarget: true, installDirectory, silentInstallPassed: true, sourceParity: installed.parity,
      asarSha256, pdfjsVersion: installed.pdfjsVersion }, nativeStartup: startup,
    uninstall: { passed: true, programFilesRemoved: true, remainingFiles, keepAppData: true, outsideOwnershipMarkerPreserved: true },
    scope: 'Official NSIS installer installed and uninstalled on a fresh GitHub Windows x64 runner. Installed ASAR source parity and actual installed application startup/first paint/native views/drawers/close cleanup were checked with isolated empty user data. No local user machine, existing account, live model conversation or installer UI interaction was tested.' };
  const output = path.join(root, metadata.build.directories.output);
  fs.writeFileSync(path.join(output, 'windows-installer-verification.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(output, 'SHA256SUMS-Windows-Installer.txt'), `${installerSha256}  ${artifactName}\n`);
  process.stdout.write(`CONVERGE_WINDOWS_INSTALLER_SMOKE ${JSON.stringify({ passed: true, version: metadata.version, sourceCommit, installerSha256, parityFiles: installed.parity.length })}\n`);
}

if (require.main === module) main().catch(error => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
module.exports = { validateInstallerEnvironment, validateOwnedInstallDirectory, inspectInstalledSource };
