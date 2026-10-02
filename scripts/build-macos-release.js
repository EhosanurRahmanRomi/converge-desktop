'use strict';

// The release is assembled and ad-hoc signed on Apple Silicon. An unsigned
// cross-platform bundle is not substituted for this native release gate.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { readIcns } = require('./macos-package-lib');

function validateBuildConfiguration(metadata, platform = process.platform, arch = process.arch) {
  assert.equal(platform, 'darwin', 'Build the macOS release on macOS so its bundle signatures can be verified.');
  assert.equal(arch, 'arm64', 'The MacBook Air M4 release must be built natively on Apple Silicon.');
  assert.equal(metadata.license, 'UNLICENSED', 'The app source license changed unexpectedly.');
  assert.equal(metadata.build.mac.identity, '-', 'This development release uses an explicit ad-hoc identity.');
  assert.equal(metadata.build.mac.hardenedRuntime, false, 'No Developer ID hardened-runtime configuration is provided.');
  assert.equal(metadata.build.mac.notarize, false, 'No notarization credentials are configured.');
  assert.equal(metadata.build.mac.minimumSystemVersion, '13.0', 'Electron 44 requires macOS 13 or newer.');
  const targets = metadata.build.mac.target;
  assert.deepEqual(targets.map(item => item.target).sort(), ['dmg', 'zip']);
  assert.ok(targets.every(item => Array.isArray(item.arch) && item.arch.length === 1 && item.arch[0] === 'arm64'), 'Only native ARM64 release targets are allowed.');
  assert.equal(metadata.build.mac.icon, 'assets/icon.icns');
  return true;
}

function main() {
  const root = path.join(__dirname, '..');
  const metadata = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  validateBuildConfiguration(metadata);
  const icon = readIcns(fs.readFileSync(path.join(root, metadata.build.mac.icon)));
  for (const size of [16, 32, 64, 128, 256, 512, 1024]) assert.ok(icon.some(chunk => chunk.dimensions?.width === size && chunk.dimensions?.height === size), `App icon is missing its ${size}px image.`);
  const environment = { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' };
  delete environment.ELECTRON_RUN_AS_NODE;
  for (const key of ['CSC_LINK', 'CSC_KEY_PASSWORD', 'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER']) {
    assert.ok(!environment[key], 'Signing or notarization credentials were supplied to the development-release task unexpectedly.');
  }
  const run = args => {
    const result = spawnSync(process.execPath, args, { cwd: root, env: environment, stdio: 'inherit' });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, `The macOS packaging step failed (exit ${result.status}).`);
  };
  run([path.join(__dirname, 'build-page-preload.js')]);
  run([require.resolve('electron-builder/out/cli/cli.js'), '--mac', 'dmg', 'zip', '--arm64', '--publish', 'never']);
  run([path.join(__dirname, 'verify-macos-release.js')]);
}
if (require.main === module) {
  try { main(); } catch (error) { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; }
}
module.exports = { validateBuildConfiguration };
