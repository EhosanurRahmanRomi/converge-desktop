'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createTransformer } = require('app-builder-lib/out/fileTransformer');
const { dependencyRuntimeMetadata, verifyDependencyPackageMetadata } = require('../scripts/macos-dependency-metadata');
const root = path.resolve(__dirname, '..');
const configuration = require('../package.json').build;
const encode = value => Buffer.from(JSON.stringify(value));

async function actualBuilderMetadata(name, options = configuration) {
  const file = path.join(root, 'node_modules', name, 'package.json'), source = fs.readFileSync(file);
  const transformed = await createTransformer(root, options)(file);
  return { source, packaged: transformed == null ? source : Buffer.from(transformed), file };
}

test('real PDF.js and native canvas metadata match the pinned builder cleanup exactly', async () => {
  assert.equal(require('app-builder-lib/package.json').version, '26.15.3');
  for (const name of ['pdfjs-dist', '@napi-rs/canvas']) {
    const { source, packaged, file } = await actualBuilderMetadata(name);
    const verified = verifyDependencyPackageMetadata(source, packaged, { file, configuration });
    assert.equal(verified.evidence.comparison, 'semantic-runtime-metadata');
    assert.equal(verified.evidence.rawBytesMatched, false);
    assert.equal(verified.evidence.packagedBytes, packaged.length);
    assert.notEqual(verified.evidence.sourceSha256, verified.evidence.packagedSha256);
    assert.ok(verified.evidence.removedFields.includes('scripts'));
    assert.ok(verified.evidence.removedFields.includes('keywords'));
    if (name === 'pdfjs-dist') assert.ok(verified.evidence.removedFields.includes('bugs'));
    const original = JSON.parse(source);
    if (original.devDependencies) assert.deepEqual(verified.metadata.devDependencies, original.devDependencies);
    assert.deepEqual(verified.metadata.optionalDependencies, original.optionalDependencies);
  }
});

test('builder flags preserving scripts and keywords require those fields to remain unchanged', async () => {
  const options = { ...configuration, removePackageScripts: false, removePackageKeywords: false };
  const { source, packaged } = await actualBuilderMetadata('pdfjs-dist', options);
  const verified = verifyDependencyPackageMetadata(source, packaged, { configuration: options });
  assert.deepEqual(verified.metadata.scripts, JSON.parse(source).scripts);
  assert.deepEqual(verified.metadata.keywords, JSON.parse(source).keywords);
  assert.throws(() => verifyDependencyPackageMetadata(source, packaged), /runtime metadata differs/);
});

test('retained loader, engine, dependency and identity fields cannot silently change', async () => {
  const { source, packaged } = await actualBuilderMetadata('pdfjs-dist');
  const original = JSON.parse(packaged);
  for (const alter of [value => { value.version = '0.0.0'; }, value => { value.main = 'other.js'; },
    value => { value.optionalDependencies['@napi-rs/canvas'] = '*'; }, value => { value.engines.node = '*'; },
    value => { value.exports = './other.js'; }, value => { value.unknownRuntimeField = true; },
    value => { delete value.browser; }]) {
    const changed = structuredClone(original); alter(changed);
    assert.throws(() => verifyDependencyPackageMetadata(source, encode(changed)), /runtime metadata differs/);
  }
  const canvas = await actualBuilderMetadata('@napi-rs/canvas');
  const changed = JSON.parse(canvas.packaged); delete changed.devDependencies;
  assert.throws(() => verifyDependencyPackageMetadata(canvas.source, encode(changed)), /runtime metadata differs/);
});

test('known cleanup preserves dependency Babel configuration only when Babel is a dependency', () => {
  const source = { name: 'fixture', version: '1', main: 'index.js', dependencies: { 'babel-runtime': '6' },
    babel: { presets: ['env'] }, _integrity: 'npm metadata', dist: { tarball: 'registry' }, bugs: 'tracker' };
  const result = dependencyRuntimeMetadata(source);
  assert.deepEqual(result.expected, { name: 'fixture', version: '1', main: 'index.js', dependencies: { 'babel-runtime': '6' }, babel: { presets: ['env'] } });
  const withoutBabel = { ...source, dependencies: { helper: '1' } };
  assert.equal(dependencyRuntimeMetadata(withoutBabel).expected.babel, undefined);
  assert.equal(source._integrity, 'npm metadata');
});
