'use strict';

// Read-only release verification. Never extracts or rewrites a production file.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const asar = require('@electron/asar');

const root = path.resolve(__dirname, '..');
const sourceMetadata = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const archivePath = path.join(root, 'dist', 'win-unpacked', 'resources', 'app.asar');
const archiveBytes = fs.readFileSync(archivePath);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const archiveMetadata = JSON.parse(asar.extractFile(archivePath, 'package.json').toString('utf8'));
const sourceRuntime = { ...sourceMetadata };
for (const key of ['scripts', 'devDependencies', 'build']) delete sourceRuntime[key];
assert.deepEqual(archiveMetadata, sourceRuntime, 'Packaged runtime metadata must match frozen source metadata.');
const files = sourceMetadata.build.files.filter(name => name !== 'package.json').map(filename => {
  const source = fs.readFileSync(path.join(root, filename));
  const packaged = asar.extractFile(archivePath, path.normalize(filename));
  assert.deepEqual(packaged, source, `Packaged file differs from production source: ${filename}`);
  return { filename, bytes: source.length, sourceSha256: digest(source), packagedSha256: digest(packaged), equal: true };
});
const report = { checkedAt: new Date().toISOString(), passed: true, readOnly: true,
  archivePath, archiveSha256: digest(archiveBytes), archiveBytes: archiveBytes.length,
  packageVersion: archiveMetadata.version, sourceVersion: sourceMetadata.version, main: archiveMetadata.main,
  packageMetadata: { runtimeMetadataEqual: true, removedDevelopmentFields: ['scripts', 'devDependencies', 'build'] }, files };
const releaseName = sourceMetadata.version.replace(/\.0$/, '');
const reportPath = path.join(root, '.live-test', `release-${releaseName}-asar-parity.json`);
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
process.stdout.write(JSON.stringify({ passed: true, packageVersion: archiveMetadata.version,
  parityFiles: files.length, archiveSha256: report.archiveSha256, reportPath }) + '\n');
