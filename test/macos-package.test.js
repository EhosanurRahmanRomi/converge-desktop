'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readMachO, validateZipEntry, validateSymlinkTarget, readIcns } = require('../scripts/macos-package-lib');
const { validateBuildConfiguration } = require('../scripts/build-macos-release');
const { inspectZip } = require('../scripts/verify-macos-release');
const { validateNativeSmoke } = require('../scripts/qa-native-macos-startup');
const metadata = require('../package.json');

function thin(cpu = 0x0100000c) {
  const rpath = Buffer.alloc(32); rpath.writeUInt32LE(0x8000001c, 0); rpath.writeUInt32LE(32, 4); rpath.writeUInt32LE(12, 8); rpath.write('@loader_path', 12);
  const build = Buffer.alloc(24); build.writeUInt32LE(0x32, 0); build.writeUInt32LE(24, 4); build.writeUInt32LE(1, 8); build.writeUInt32LE(0x000d0000, 12);
  const sign = Buffer.alloc(16); sign.writeUInt32LE(0x1d, 0); sign.writeUInt32LE(16, 4); sign.writeUInt32LE(104, 8); sign.writeUInt32LE(8, 12);
  const header = Buffer.alloc(32); header.writeUInt32LE(0xfeedfacf, 0); header.writeUInt32LE(cpu, 4); header.writeUInt32LE(2, 12); header.writeUInt32LE(3, 16); header.writeUInt32LE(72, 20);
  return Buffer.concat([header, rpath, build, sign, Buffer.alloc(8)]);
}
function universal() {
  const arm = thin(), x64 = thin(0x01000007), header = Buffer.alloc(48); header.writeUInt32BE(0xcafebabe, 0); header.writeUInt32BE(2, 4);
  for (const [index, cpu, start] of [[0, 0x0100000c, 48], [1, 0x01000007, 48 + arm.length]]) {
    const offset = 8 + index * 20; header.writeUInt32BE(cpu, offset); header.writeUInt32BE(start, offset + 8); header.writeUInt32BE(arm.length, offset + 12);
  }
  return Buffer.concat([header, arm, x64]);
}
function archive(entries) {
  const local = [], central = []; let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name), data = Buffer.from(entry.target || 'synthetic'), lh = Buffer.alloc(30), ch = Buffer.alloc(46);
    lh.writeUInt32LE(0x04034b50); lh.writeUInt16LE(20, 4); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26);
    ch.writeUInt32LE(0x02014b50); ch.writeUInt16LE(0x0314, 4); ch.writeUInt16LE(20, 6); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(((entry.mode || 0o100755) << 16) >>> 0, 38); ch.writeUInt32LE(offset, 42);
    local.push(lh, name, data); central.push(ch, name); offset += lh.length + name.length + data.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, cd, end]);
}
const zipEntries = () => [{ name: 'Converge.app/Contents/MacOS/Converge' }, ...['Current', 'Resources', 'Electron Framework'].map(name => ({ name: `Converge.app/Contents/Frameworks/${name}`, target: 'Versions/A', mode: 0o120777 }))];
function withArchive(bytes, callback) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'converge-archive-unit-')), filename = path.join(folder, 'fixture.zip');
  try { fs.writeFileSync(filename, bytes); callback(filename); } finally {
    const relative = path.relative(path.resolve(os.tmpdir()), path.resolve(folder));
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative) && path.basename(folder).startsWith('converge-archive-unit-'));
    fs.rmSync(folder, { recursive: true, force: true });
  }
}

test('ARM64 deployment, loader paths and signature ranges are parsed from load commands', () => {
  const parsed = readMachO(thin()); assert.deepEqual(parsed.architectures, ['arm64']); assert.deepEqual(parsed.slices[0].rpaths, ['@loader_path']); assert.deepEqual(parsed.slices[0].minimumSystemVersions, ['13.0.0']); assert.equal(parsed.slices[0].codeSignaturePresent, true);
});
test('universal bundles expose each CPU so an Intel slice cannot pass an ARM64-only gate', () => assert.deepEqual(readMachO(universal()).architectures, ['arm64', 'x64']));
test('Mach-O rejects overlapping slices and CPU-table mismatch', () => {
  const overlapping = universal(); overlapping.writeUInt32BE(48, 36); assert.throws(() => readMachO(overlapping), /Overlapping/);
  const mismatch = universal(); mismatch.writeUInt32BE(0x01000007, 8); assert.throws(() => readMachO(mismatch), /CPU differs/);
});
test('Mach-O rejects signatures outside the slice or inside load commands', () => {
  for (const offset of [4, 111]) { const bytes = thin(); bytes.writeUInt32LE(offset, 96); assert.throws(() => readMachO(bytes), /signature bounds/); }
});
test('Mach-O rejects unterminated loader paths and truncated command tables', () => {
  const bytes = thin(); bytes.fill(65, 44, 64); assert.throws(() => readMachO(bytes), /Unterminated/); assert.throws(() => readMachO(thin().subarray(0, 70)), /load-command table/);
});
test('ZIP rejects traversal and absolute paths before native extraction', () => {
  for (const fileName of ['../Converge.app/a', 'Converge.app/../a', '/Converge.app/a', 'C:/Converge.app/a', 'Converge.app\\a', 'other.app/a']) assert.throws(() => validateZipEntry({ fileName, versionMadeBy: 0x0314, externalFileAttributes: 0 }, 'Converge.app'));
});
test('ZIP requires Unix attributes and blocks devices', () => {
  assert.throws(() => validateZipEntry({ fileName: 'Converge.app/a', versionMadeBy: 20, externalFileAttributes: 0 }, 'Converge.app'), /Unix/);
  assert.throws(() => validateZipEntry({ fileName: 'Converge.app/a', versionMadeBy: 0x0314, externalFileAttributes: (0o020666 << 16) >>> 0 }, 'Converge.app'), /file type/);
});
test('framework symlinks can stay relative but cannot leave the application', () => {
  assert.equal(validateSymlinkTarget('Converge.app/Contents/Frameworks/F.framework/Resources', 'Versions/Current/Resources', 'Converge.app'), 'Converge.app/Contents/Frameworks/F.framework/Versions/Current/Resources');
  for (const target of ['../../../../escape', '/System/Library', 'C:/a']) assert.throws(() => validateSymlinkTarget('Converge.app/Contents/link', target, 'Converge.app'));
});
test('release ZIP inspection requires executable permissions and framework links', () => {
  withArchive(archive(zipEntries()), file => assert.equal(inspectZip(file).symlinks.length, 3));
  const entries = zipEntries(); entries[0].mode = 0o100644; withArchive(archive(entries), file => assert.throws(() => inspectZip(file), /executable permissions/));
});
test('release ZIP inspection rejects local path mismatches and escaping symlink payloads', () => {
  const bytes = archive(zipEntries()); bytes[30] = 88; withArchive(bytes, file => assert.throws(() => inspectZip(file), /local path differs/));
  const entries = zipEntries(); entries[1].target = '../../../../outside'; withArchive(archive(entries), file => assert.throws(() => inspectZip(file), /escaped/));
});
test('release ZIP inspection rejects duplicate entries and truncated central directories', () => {
  withArchive(archive([...zipEntries(), zipEntries()[0]]), file => assert.throws(() => inspectZip(file), /Duplicate/));
  const bytes = archive(zipEntries()); withArchive(bytes.subarray(0, bytes.length - 1), file => assert.throws(() => inspectZip(file), /end-of-directory/));
});
test('the macOS icon includes retina sizes while preserving original Converge artwork', () => {
  const icon = fs.readFileSync(path.join(__dirname, '../assets/icon.icns')), chunks = readIcns(icon), original = fs.readFileSync(path.join(__dirname, '../assets/icon.png'));
  assert.deepEqual([...new Set(chunks.map(item => item.dimensions?.width))].sort((a, b) => a - b), [16, 32, 64, 128, 256, 512, 1024]);
  let offset = 8; while (icon.toString('ascii', offset, offset + 4) !== 'ic08') offset += icon.readUInt32BE(offset + 4);
  assert.deepEqual(icon.subarray(offset + 8, offset + icon.readUInt32BE(offset + 4)), original);
  const broken = Buffer.from(icon); broken.writeUInt32BE(1, 12); assert.throws(() => readIcns(broken), /chunk length/);
});
test('macOS release build cannot run as Windows cross-build or change signing and target scope', () => {
  assert.equal(validateBuildConfiguration(metadata, 'darwin', 'arm64'), true);
  assert.throws(() => validateBuildConfiguration(metadata, 'win32', 'x64'), /macOS/); assert.throws(() => validateBuildConfiguration(metadata, 'darwin', 'x64'), /Apple Silicon/);
  for (const alter of [copy => { copy.build.mac.identity = null; }, copy => { copy.build.mac.target[0].arch = ['arm64', 'x64']; }, copy => { copy.build.mac.notarize = true; }]) {
    const copy = structuredClone(metadata); alter(copy); assert.throws(() => validateBuildConfiguration(copy, 'darwin', 'arm64'));
  }
});
test('actual app smoke must cover native editing, disposal and activation in the correct packaged binary', () => {
  const executable = path.resolve('fixture/Converge'), report = { status: 'PASS', platform: 'darwin', arch: 'arm64', packaged: true, version: metadata.version, executable, visibleShell: true, commandShortcutHint: true, nativeMenu: true,
    nativeEditingVerified: { shell: true, left: true, right: true }, didClose: true, embeddedViewsDisposed: true, closeCleanupCompleted: true, activateEventComplete: true, freshWorkspaceOnActivate: true,
    activationScope: 'Automated Electron activate event, not physical Dock input', providerScope: 'Empty isolated session; no authentication, provider navigation or live model task' };
  assert.equal(validateNativeSmoke(report, metadata.version, executable), true);
  for (const field of ['packaged', 'embeddedViewsDisposed', 'freshWorkspaceOnActivate']) assert.throws(() => validateNativeSmoke({ ...report, [field]: false }, metadata.version, executable));
  assert.throws(() => validateNativeSmoke({ ...report, nativeEditingVerified: { shell: true, left: true, right: false } }, metadata.version, executable), /Native editing/);
});
