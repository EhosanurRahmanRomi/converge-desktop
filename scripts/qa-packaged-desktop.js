'use strict';

// Launches the real desktop QA against production modules, shell and sandboxed
// preloads inside app.asar. A temporary Electron launcher uses the archive's
// actual package metadata so native app.getVersion and UI bootstrap are also
// checked. It never patches Electron APIs or imports authentication cookies.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawn } = require('node:child_process');
const asar = require('@electron/asar');

const root = path.join(__dirname, '..');
const archive = path.resolve(process.env.CONVERGE_PACKAGED_ASAR || path.join(root, 'dist/win-unpacked/resources/app.asar'));
const compareFiles = [
  'desktop-main.js', 'desktop-preload.js', 'src/browser/cookies.js', 'src/browser/files.js', 'src/browser/downloads.js',
  'src/browser/desktop-coordinator.js', 'src/browser/page-preload.js',
  'chrome-extension/background.js', 'renderer/browser.html',
  'renderer/browser-app.js', 'renderer/browser.css',
];
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function run() {
  const metadata = JSON.parse(asar.extractFile(archive, 'package.json').toString('utf8'));
  const expectedVersion = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  if (metadata.version !== expectedVersion || metadata.main !== 'desktop-main.js') throw new Error(`The selected archive is not the current Converge ${expectedVersion} desktop app.`);
  for (const filename of compareFiles) {
    const packaged = asar.extractFile(archive, path.normalize(filename));
    const source = fs.readFileSync(path.join(root, filename));
    if (hash(packaged) !== hash(source)) throw new Error(`The packaged ${filename} differs from the latest source. Rebuild before packaged QA.`);
  }
  const archiveHash = hash(fs.readFileSync(archive));
  process.stdout.write(`Verified latest production files inside Converge ${metadata.version} archive.\n`);

  const launchRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'converge-packaged-qa-launch-'));
  fs.writeFileSync(path.join(launchRoot, 'package.json'), JSON.stringify({ ...metadata, main: 'launch.js' }));
  fs.writeFileSync(path.join(launchRoot, 'launch.js'), `require(${JSON.stringify(path.join(__dirname, 'qa-desktop-cookie.js'))});\n`);
  const childEnvironment = { ...process.env, CONVERGE_PACKAGED_ASAR: archive };
  delete childEnvironment.ELECTRON_RUN_AS_NODE;
  try {
    const exitCode = await new Promise((resolve, reject) => {
      const child = spawn(require('electron'), [launchRoot, ...process.argv.slice(2)], {
        cwd: root, env: childEnvironment, stdio: 'inherit', windowsHide: true,
      });
      child.once('error', reject);
      child.once('close', (code) => resolve(code == null ? 1 : code));
    });
    const reportPath = path.join(root, 'desktop-cookie-packaged-qa-result.json');
    if (fs.existsSync(reportPath)) {
      const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
      report.archiveSha256 = archiveHash;
      report.productionFilesCompared = compareFiles;
      report.launchNote = 'The QA launcher loads actual production code and preloads from app.asar under an Electron launcher carrying the archive package metadata. It does not test installer execution or live authentication.';
      fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    }
    if (exitCode) throw new Error(`Packaged desktop QA exited with status ${exitCode}.`);
  } finally {
    const absolute = path.resolve(launchRoot);
    const relative = path.relative(path.resolve(os.tmpdir()), absolute);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !path.basename(absolute).startsWith('converge-packaged-qa-launch-')) {
      throw new Error('The temporary QA launcher path was outside its intended directory; cleanup skipped.');
    }
    fs.rmSync(absolute, { recursive: true, force: true });
  }
}

run().catch((error) => { process.stderr.write(`Packaged QA failed: ${error.stack || error.message}\n`); process.exitCode = 1; });
