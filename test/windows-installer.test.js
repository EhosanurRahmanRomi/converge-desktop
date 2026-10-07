'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validateInstallerEnvironment, validateOwnedInstallDirectory, inspectInstalledSource } = require('../scripts/qa-windows-installer');
const metadata = require('../package.json');
const environment = { GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted', RUNNER_OS: 'Windows', RUNNER_TEMP: 'C:\\runner\\temp' };
const target = 'C:\\runner\\temp\\converge-installer-check-11111111-1111-4111-8111-111111111111\\installed';

test('installer execution refuses local machines and unsupported runner platforms', () => {
  assert.equal(validateInstallerEnvironment(environment, 'win32', 'x64'), true);
  for (const [env, platform, arch] of [[{}, 'win32', 'x64'], [{ ...environment, GITHUB_ACTIONS: 'false' }, 'win32', 'x64'],
    [{ ...environment, RUNNER_ENVIRONMENT: 'self-hosted' }, 'win32', 'x64'],
    [{ ...environment, RUNNER_OS: 'Linux' }, 'win32', 'x64'], [{ ...environment, RUNNER_TEMP: 'relative' }, 'win32', 'x64'],
    [environment, 'darwin', 'arm64'], [environment, 'win32', 'arm64']]) assert.throws(() => validateInstallerEnvironment(env, platform, arch));
});

test('installer target must be a unique owned child of runner temp and cannot resolve outside it', () => {
  assert.equal(validateOwnedInstallDirectory(target, environment.RUNNER_TEMP), target);
  for (const directory of ['C:\\runner\\temp', 'C:\\Users\\Owner\\Programs\\Converge', 'C:\\runner\\temp-other\\installed',
    'C:\\runner\\temp\\converge-installer-check-11111111-1111-4111-8111-111111111111\\..\\..\\outside',
    target + '\\nested', 'C:\\runner\\temp\\arbitrary\\installed']) assert.throws(() => validateOwnedInstallDirectory(directory, environment.RUNNER_TEMP));
});

test('installed source parity requires every current module and exact production package identity', () => {
  const sourceRoot = path.join(__dirname, '..'), runtime = { ...metadata };
  for (const key of ['scripts', 'devDependencies', 'build']) delete runtime[key];
  const extract = (_archive, filename) => filename === 'package.json' ? Buffer.from(JSON.stringify(runtime)) :
    filename === 'node_modules/pdfjs-dist/package.json' ? Buffer.from(JSON.stringify({ version: metadata.dependencies['pdfjs-dist'] })) :
    filename.startsWith('node_modules/') ? Buffer.from('fixture dependency') : fs.readFileSync(path.join(sourceRoot, filename));
  const proof = inspectInstalledSource('isolated-install', sourceRoot, metadata, extract);
  assert.equal(proof.parity.length, metadata.build.files.length - 1);
  assert.ok(proof.parity.some(file => file.file === 'src/studio/document-design.js'));
  const wrongSource = (_archive, filename) => filename === path.normalize('src/studio/project.js') ? Buffer.from('substituted source') : extract(_archive, filename);
  assert.throws(() => inspectInstalledSource('isolated-install', sourceRoot, metadata, wrongSource), /Installed source differs/);
  const wrongVersion = (_archive, filename) => filename === 'package.json' ? Buffer.from(JSON.stringify({ ...runtime, version: '0.0.0' })) : extract(_archive, filename);
  assert.throws(() => inspectInstalledSource('isolated-install', sourceRoot, metadata, wrongVersion), /runtime metadata differs/);
  const missingPDF = (_archive, filename) => filename.endsWith('pdf.worker.mjs') ? Buffer.alloc(0) : extract(_archive, filename);
  assert.throws(() => inspectInstalledSource('isolated-install', sourceRoot, metadata, missingPDF), /PDF runtime is missing/);
});

test('Windows CI publishes installers only after owned installation, installed startup, source parity and uninstall', () => {
  const workflow = fs.readFileSync(path.join(__dirname, '../.github/workflows/windows-release.yml'), 'utf8');
  assert.match(workflow, /runs-on: windows-latest/); assert.match(workflow, /expected_version:/);
  assert.match(workflow, /electron-builder --win nsis --x64 --publish never/);
  assert.match(workflow, /node scripts\/qa-windows-installer\.js/);
  assert.ok(workflow.indexOf('node scripts/qa-windows-installer.js') < workflow.indexOf('Upload the verified official installer'));
  assert.match(workflow, /git diff --exit-code/);
  assert.match(workflow, /windows-installer-verification\.json/);
});
