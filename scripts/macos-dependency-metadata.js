'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');

// Exact dependency cleanup rules from pinned electron-builder 26.15.3,
// app-builder-lib/out/fileTransformer.js. Dependency devDependencies survive.
const OMITTED_METADATA_FIELDS = new Set(['dist', 'gitHead', 'build', 'jspm', 'ava', 'xo', 'nyc',
  'eslintConfig', 'contributors', 'bundleDependencies', 'tags']);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function dependencyRuntimeMetadata(source, configuration = {}) {
  assert.ok(source && typeof source === 'object' && !Array.isArray(source), 'Dependency package metadata must be an object.');
  const expected = { ...source }, removedFields = [];
  const dependencies = source.dependencies;
  const removeBabel = dependencies != null && typeof dependencies === 'object' &&
    !Object.getOwnPropertyNames(dependencies).some(name => name.startsWith('babel'));
  for (const name of Object.getOwnPropertyNames(source)) {
    if (name.startsWith('_') || OMITTED_METADATA_FIELDS.has(name) || name === 'bugs' ||
        configuration.removePackageScripts !== false && name === 'scripts' ||
        configuration.removePackageKeywords !== false && name === 'keywords' ||
        removeBabel && name === 'babel') {
      delete expected[name]; removedFields.push(name);
    }
  }
  return { expected, removedFields };
}

function verifyDependencyPackageMetadata(sourceBytes, packagedBytes, { file = 'dependency package.json', configuration = {} } = {}) {
  assert.ok(Buffer.isBuffer(sourceBytes) && Buffer.isBuffer(packagedBytes), `${file}: package metadata bytes are required.`);
  const source = JSON.parse(sourceBytes.toString('utf8')), packaged = JSON.parse(packagedBytes.toString('utf8'));
  const { expected, removedFields } = dependencyRuntimeMetadata(source, configuration);
  // Compare every retained field. Only the exact builder cleanup applies;
  // main/exports/type, versions, dependencies, engines, CPU and OS stay strict.
  assert.deepEqual(packaged, expected, `${file}: packaged dependency runtime metadata differs.`);
  return { metadata: packaged, evidence: { file, comparison: 'semantic-runtime-metadata',
    builderVersion: '26.15.3', name: packaged.name, version: packaged.version, removedFields,
    sourceBytes: sourceBytes.length, packagedBytes: packagedBytes.length,
    sourceSha256: sha256(sourceBytes), packagedSha256: sha256(packagedBytes), rawBytesMatched: sourceBytes.equals(packagedBytes) } };
}

module.exports = { dependencyRuntimeMetadata, verifyDependencyPackageMetadata };
