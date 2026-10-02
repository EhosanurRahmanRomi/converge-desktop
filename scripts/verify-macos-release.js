'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { spawnSync } = require('node:child_process');
const { readMachO, isMachO, validateZipEntry, validateSymlinkTarget, readIcns } = require('./macos-package-lib');

const root = path.join(__dirname, '..');
const metadata = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const productName = metadata.build.productName;
const appName = `${productName}.app`;
const output = path.resolve(root, metadata.build.directories.output);
const bundle = path.join(output, 'mac-arm64', appName);
const artifactName = extension => metadata.build.mac.artifactName.replaceAll('${version}', metadata.version).replaceAll('${arch}', 'arm64').replaceAll('${ext}', extension);
const reportPath = path.join(output, 'macos-verification.json');
const digestBytes = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function command(executable, args) {
  const result = spawnSync(executable, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${executable} failed: ${(result.stderr || result.stdout).slice(-3000)}`);
  return { stdout: result.stdout, stderr: result.stderr };
}
async function fileDigest(filename) {
  const digest = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filename)) digest.update(chunk);
  return digest.digest('hex');
}
function inside(parent, filename) {
  const relative = path.relative(parent, filename);
  return !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep);
}
function filesBelow(directory) {
  const found = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    found.push(filename);
    if (entry.isDirectory()) found.push(...filesBelow(filename));
  }
  return found;
}

function inspectBundle(application, label) {
  const plistPath = path.join(application, 'Contents', 'Info.plist');
  const info = JSON.parse(command('/usr/bin/plutil', ['-convert', 'json', '-o', '-', plistPath]).stdout);
  assert.equal(info.CFBundleIdentifier, metadata.build.appId, `${label}: wrong bundle ID.`);
  assert.equal(info.CFBundleExecutable, productName, `${label}: wrong executable.`);
  assert.equal(info.CFBundleShortVersionString, metadata.version, `${label}: wrong application version.`);
  assert.equal(info.LSMinimumSystemVersion, '13.0', `${label}: incorrect macOS minimum.`);
  assert.equal(info.LSApplicationCategoryType, 'public.app-category.productivity');
  const iconName = info.CFBundleIconFile.endsWith('.icns') ? info.CFBundleIconFile : info.CFBundleIconFile + '.icns';
  const iconChunks = readIcns(fs.readFileSync(path.join(application, 'Contents', 'Resources', iconName)));
  assert.ok(iconChunks.some(chunk => chunk.dimensions?.width === 1024));
  const signature = command('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', application]);
  const signatureInfo = command('/usr/bin/codesign', ['-d', '--verbose=4', application]);
  assert.match(signatureInfo.stderr, /Signature=adhoc/, `${label}: the expected development signature is missing.`);
  const binaries = [], symlinks = [];
  for (const filename of filesBelow(application)) {
    const stat = fs.lstatSync(filename), relative = path.relative(application, filename).replaceAll(path.sep, '/');
    if (stat.isSymbolicLink()) {
      const target = fs.readlinkSync(filename);
      validateSymlinkTarget(`${appName}/${relative}`, target, appName);
      assert.ok(fs.existsSync(filename), `${label}: broken symlink ${relative}`);
      assert.ok(inside(application, fs.realpathSync(filename)), `${label}: symlink escaped the app.`);
      symlinks.push({ file: relative, target });
    } else if (stat.isFile()) {
      const descriptor = fs.openSync(filename, 'r'), header = Buffer.alloc(4);
      try { fs.readSync(descriptor, header, 0, 4, 0); } finally { fs.closeSync(descriptor); }
      if (!isMachO(header)) continue;
      const info = readMachO(fs.readFileSync(filename));
      assert.deepEqual(info.architectures, ['arm64'], `${label}: non-ARM64 binary ${relative}`);
      assert.ok((stat.mode & 0o111) !== 0, `${label}: executable permissions missing ${relative}`);
      for (const slice of info.slices) {
        assert.ok(slice.codeSignaturePresent, `${label}: embedded ARM64 signature is absent ${relative}`);
        for (const loadPath of slice.rpaths.concat(slice.dylibs)) assert.ok(!/^(?:[A-Za-z]:|\/Users\/|\/home\/|\/tmp\/|\/private\/var\/)/.test(loadPath), `${label}: build-machine path in ${relative}`);
      }
      binaries.push({ file: relative, mode: (stat.mode & 0o777).toString(8), ...info });
    }
  }
  assert.ok(binaries.some(item => item.file === `Contents/MacOS/${productName}`), `${label}: main executable was not inspected.`);
  assert.ok(binaries.filter(item => item.file.includes(' Helper')).length >= 3, `${label}: expected sandbox helpers were not found.`);
  for (const relative of ['Contents/Frameworks/Electron Framework.framework/Versions/Current', 'Contents/Frameworks/Electron Framework.framework/Electron Framework', 'Contents/Frameworks/Electron Framework.framework/Resources']) {
    assert.ok(symlinks.some(item => item.file === relative), `${label}: framework link layout was not preserved.`);
  }
  const resources = path.join(application, 'Contents', 'Resources');
  for (const item of metadata.build.extraResources) assert.ok(fs.existsSync(path.join(resources, item.to)), `${label}: missing notice ${item.to}`);
  const asarPath = path.join(resources, 'app.asar');
  const asar = require('@electron/asar');
  const packagedMetadata = JSON.parse(asar.extractFile(asarPath, 'package.json').toString('utf8'));
  const runtimeMetadata = { ...metadata }; for (const key of ['scripts', 'devDependencies', 'build']) delete runtimeMetadata[key];
  assert.deepEqual(packagedMetadata, runtimeMetadata, `${label}: runtime metadata differs.`);
  const parity = metadata.build.files.filter(filename => filename !== 'package.json').map(filename => {
    const source = fs.readFileSync(path.join(root, filename));
    const packaged = asar.extractFile(asarPath, filename.replaceAll('\\', '/'));
    assert.deepEqual(packaged, source, `${label}: packaged source differs: ${filename}`);
    return { file: filename, bytes: source.length, sha256: digestBytes(source) };
  });
  return { label, bundleIdentifier: info.CFBundleIdentifier, version: info.CFBundleShortVersionString, minimumSystemVersion: info.LSMinimumSystemVersion,
    signature: { verified: true, type: 'ad-hoc', notarized: false, detail: signature.stderr.trim() },
    binaries, symlinks, sourceParity: parity, asarSha256: digestBytes(fs.readFileSync(asarPath)) };
}

function inspectZip(archivePath) {
  const descriptor = fs.openSync(archivePath, 'r');
  const size = fs.fstatSync(descriptor).size;
  const read = (position, length) => { const bytes = Buffer.alloc(length); assert.equal(fs.readSync(descriptor, bytes, 0, length, position), length, 'Truncated ZIP read.'); return bytes; };
  try {
    const tailLength = Math.min(size, 65557), tail = read(size - tailLength, tailLength);
    let end = -1;
    for (let index = tail.length - 22; index >= 0; index--) if (tail.readUInt32LE(index) === 0x06054b50 && index + 22 + tail.readUInt16LE(index + 20) === tail.length) { end = index; break; }
    assert.ok(end >= 0, 'ZIP end-of-directory record missing.');
    assert.equal(tail.readUInt16LE(end + 4), 0); assert.equal(tail.readUInt16LE(end + 6), 0);
    const entries = tail.readUInt16LE(end + 10), length = tail.readUInt32LE(end + 12), offset = tail.readUInt32LE(end + 16);
    assert.equal(entries, tail.readUInt16LE(end + 8));
    assert.ok(entries > 0 && entries < 65535 && length <= 16 * 1024 * 1024 && offset + length <= size - tailLength + end, 'Unsupported or invalid ZIP directory.');
    const central = read(offset, length), files = [], seen = new Set(); let position = 0;
    for (let index = 0; index < entries; index++) {
      assert.ok(position + 46 <= central.length && central.readUInt32LE(position) === 0x02014b50, 'Invalid ZIP central entry.');
      const nameLength = central.readUInt16LE(position + 28), extraLength = central.readUInt16LE(position + 30), commentLength = central.readUInt16LE(position + 32);
      assert.ok(position + 46 + nameLength + extraLength + commentLength <= central.length, 'Truncated ZIP central entry.');
      const fileName = central.toString('utf8', position + 46, position + 46 + nameLength);
      const item = validateZipEntry({ fileName, versionMadeBy: central.readUInt16LE(position + 4), externalFileAttributes: central.readUInt32LE(position + 38) }, appName);
      assert.ok(!seen.has(fileName), 'Duplicate ZIP entry.'); seen.add(fileName);
      assert.equal(central.readUInt16LE(position + 34), 0, 'Multivolume ZIP entry.');
      assert.equal(central.readUInt16LE(position + 8) & 1, 0, 'Encrypted release ZIP entry.');
      const compressedLength = central.readUInt32LE(position + 20), uncompressedLength = central.readUInt32LE(position + 24), localOffset = central.readUInt32LE(position + 42), method = central.readUInt16LE(position + 10);
      assert.ok(localOffset + 30 <= offset, 'ZIP local header overlaps its directory.');
      const localHeader = read(localOffset, 30); assert.equal(localHeader.readUInt32LE(0), 0x04034b50);
      assert.equal(localHeader.readUInt16LE(8), method, 'ZIP compression metadata differs.');
      const localNameLength = localHeader.readUInt16LE(26), localExtraLength = localHeader.readUInt16LE(28);
      const payloadOffset = localOffset + 30 + localNameLength + localExtraLength;
      assert.ok(payloadOffset + compressedLength <= offset, 'ZIP payload overlaps its directory.');
      assert.equal(read(localOffset + 30, localNameLength).toString('utf8'), fileName, 'ZIP local path differs from its directory.');
      if (!item.resourceSidecar && fileName.includes('/Contents/MacOS/')) assert.ok((item.mode & 0o111) !== 0, 'ZIP lost executable permissions.');
      if (item.symlink) {
        assert.ok(uncompressedLength > 0 && uncompressedLength <= 4096 && compressedLength <= 8192 && [0, 8].includes(method), 'Invalid ZIP symlink payload.');
        const payload = read(payloadOffset, compressedLength), targetBytes = method === 8 ? zlib.inflateRawSync(payload, { maxOutputLength: 4096 }) : payload;
        assert.equal(targetBytes.length, uncompressedLength);
        item.target = targetBytes.toString('utf8'); validateSymlinkTarget(fileName, item.target, appName);
      }
      files.push(item); position += 46 + nameLength + extraLength + commentLength;
    }
    assert.equal(position, central.length);
    assert.ok(files.some(item => item.fileName === `${appName}/Contents/MacOS/${productName}`), 'ZIP is missing the app executable.');
    assert.ok(files.filter(item => item.symlink).length >= 3, 'ZIP did not preserve framework symlinks.');
    return { entries: files.length, unixAttributesPreserved: true, symlinks: files.filter(item => item.symlink) };
  } finally { fs.closeSync(descriptor); }
}

async function main() {
  assert.equal(process.platform, 'darwin', 'Native macOS tools are required to verify this release.');
  assert.equal(process.arch, 'arm64', 'Release verification must run on Apple Silicon.');
  fs.mkdirSync(output, { recursive: true });
  const zipPath = path.join(output, artifactName('zip')), dmgPath = path.join(output, artifactName('dmg'));
  assert.ok(fs.existsSync(bundle) && fs.existsSync(zipPath) && fs.existsSync(dmgPath), 'Build the ARM64 app, ZIP and DMG before verification.');
  const originalBundle = inspectBundle(bundle, 'built application');
  const zipStructure = inspectZip(zipPath);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'converge-macos-release-'));
  let mounted = false;
  try {
    const extraction = path.join(temporary, 'zip'); fs.mkdirSync(extraction);
    command('/usr/bin/ditto', ['-x', '-k', zipPath, extraction]);
    const extractedBundle = inspectBundle(path.join(extraction, appName), 'ZIP extracted application');
    assert.equal(extractedBundle.asarSha256, originalBundle.asarSha256, 'ZIP changed the packaged source.');
    command('/usr/bin/hdiutil', ['verify', dmgPath]);
    const mountpoint = path.join(temporary, 'dmg'); fs.mkdirSync(mountpoint);
    command('/usr/bin/hdiutil', ['attach', dmgPath, '-readonly', '-nobrowse', '-mountpoint', mountpoint]); mounted = true;
    assert.equal(fs.readlinkSync(path.join(mountpoint, 'Applications')), '/Applications', 'DMG install shortcut is missing.');
    const mountedBundle = inspectBundle(path.join(mountpoint, appName), 'DMG mounted application');
    assert.equal(mountedBundle.asarSha256, originalBundle.asarSha256, 'DMG changed the packaged source.');
    command('/usr/bin/hdiutil', ['detach', mountpoint]); mounted = false;
    const artifacts = await Promise.all([zipPath, dmgPath].map(async filename => ({ name: path.basename(filename), bytes: fs.statSync(filename).size, sha256: await fileDigest(filename) })));
    const report = { checkedAt: new Date().toISOString(), passed: true, platform: process.platform, architecture: process.arch, hostMacOS: command('/usr/bin/sw_vers', ['-productVersion']).stdout.trim(),
      version: metadata.version, originalBundle, zipStructure,
      archiveRoundTrips: { zip: { signatureVerified: true, sourceBytesMatched: true, permissionsAndSymlinksVerified: true }, dmg: { imageVerified: true, signatureVerified: true, sourceBytesMatched: true, applicationsShortcutVerified: true } },
      artifacts, scope: 'Native ARM64 structural, byte-parity and ad-hoc signature verification, including the extracted ZIP and readonly mounted DMG. This does not claim Developer ID signing, Apple notarization, a physical MacBook M4 test or live provider access.' };
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    fs.writeFileSync(path.join(output, 'SHA256SUMS-macOS.txt'), artifacts.map(item => `${item.sha256}  ${item.name}`).join('\n') + '\n');
    process.stdout.write(JSON.stringify({ passed: true, version: metadata.version, binaries: originalBundle.binaries.length, symlinks: originalBundle.symlinks.length, parityFiles: originalBundle.sourceParity.length, artifacts }) + '\n');
  } finally {
    if (mounted) command('/usr/bin/hdiutil', ['detach', path.join(temporary, 'dmg')]);
    const resolved = path.resolve(temporary);
    assert.ok(inside(path.resolve(os.tmpdir()), resolved) && path.basename(resolved).startsWith('converge-macos-release-'), 'Temporary cleanup path is outside its intended directory.');
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}
if (require.main === module) main().catch(error => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
module.exports = { inspectZip };
