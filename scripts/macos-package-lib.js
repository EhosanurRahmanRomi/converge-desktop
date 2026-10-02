'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');

const cpuName = value => value === 0x0100000c ? 'arm64' : value === 0x01000007 ? 'x64' : `cpu-${value.toString(16)}`;
const versionString = value => `${value >>> 16}.${(value >>> 8) & 255}.${value & 255}`;

function readThinMachO(bytes, offset = 0, length = bytes.length) {
  assert.ok(offset >= 0 && length >= 32 && offset + length <= bytes.length, 'Truncated Mach-O slice.');
  const magic = bytes.subarray(offset, offset + 4).toString('hex');
  assert.ok(magic === 'cffaedfe' || magic === 'feedfacf', 'Expected a 64-bit Mach-O executable.');
  const read32 = position => magic === 'cffaedfe' ? bytes.readUInt32LE(position) : bytes.readUInt32BE(position);
  const commandCount = read32(offset + 16);
  const commandsLength = read32(offset + 20);
  assert.ok(commandCount <= 4096 && 32 + commandsLength <= length, 'Invalid Mach-O load-command table.');
  const info = { architecture: cpuName(read32(offset + 4)), fileType: read32(offset + 12), rpaths: [], dylibs: [], codeSignaturePresent: false, minimumSystemVersions: [] };
  let position = offset + 32;
  const commandEnd = position + commandsLength;
  function commandString(start, size, minimum = 12) {
    assert.ok(size >= minimum, 'Truncated Mach-O string command.');
    const stringOffset = read32(start + 8);
    assert.ok(stringOffset >= minimum && stringOffset < size, 'Invalid Mach-O string offset.');
    const end = bytes.indexOf(0, start + stringOffset);
    assert.ok(end >= start + stringOffset && end < start + size, 'Unterminated Mach-O command string.');
    return bytes.toString('utf8', start + stringOffset, end);
  }
  for (let index = 0; index < commandCount; index++) {
    assert.ok(position + 8 <= commandEnd, 'Truncated Mach-O load command.');
    const command = read32(position), size = read32(position + 4);
    assert.ok(size >= 8 && size % 4 === 0 && position + size <= commandEnd, 'Invalid Mach-O load-command size.');
    if (command === 0x8000001c) info.rpaths.push(commandString(position, size));
    if ([0xc, 0x80000018, 0x8000001f, 0x80000023].includes(command)) info.dylibs.push(commandString(position, size, 24));
    if (command === 0x1d) {
      assert.ok(size >= 16, 'Truncated Mach-O code signature command.');
      const start = read32(position + 8), signatureLength = read32(position + 12);
      assert.ok(signatureLength > 0 && start >= 32 + commandsLength && start + signatureLength <= length, 'Invalid Mach-O embedded signature bounds.');
      info.codeSignaturePresent = true;
    }
    if (command === 0x32) {
      assert.ok(size >= 24, 'Truncated Mach-O build-version command.');
      if (read32(position + 8) === 1) info.minimumSystemVersions.push(versionString(read32(position + 12)));
    }
    if (command === 0x24) {
      assert.ok(size >= 16, 'Truncated macOS deployment command.');
      info.minimumSystemVersions.push(versionString(read32(position + 8)));
    }
    position += size;
  }
  assert.equal(position, commandEnd, 'Mach-O command lengths do not match the header.');
  return info;
}

function readMachO(bytes) {
  assert.ok(Buffer.isBuffer(bytes) && bytes.length >= 8, 'Mach-O bytes are required.');
  const magic = bytes.subarray(0, 4).toString('hex');
  if (magic === 'cffaedfe' || magic === 'feedfacf') {
    const slice = readThinMachO(bytes);
    return { architectures: [slice.architecture], slices: [slice] };
  }
  const bigEndian = magic === 'cafebabe' || magic === 'cafebabf';
  const littleEndian = magic === 'bebafeca' || magic === 'bfbafeca';
  assert.ok(bigEndian || littleEndian, 'Not a supported Mach-O binary.');
  const read32 = position => bigEndian ? bytes.readUInt32BE(position) : bytes.readUInt32LE(position);
  const fat64 = magic === 'cafebabf' || magic === 'bfbafeca';
  const count = read32(4), entrySize = fat64 ? 32 : 20;
  assert.ok(count > 0 && count <= 16 && 8 + count * entrySize <= bytes.length, 'Invalid universal Mach-O header.');
  const slices = [];
  const ranges = [];
  for (let index = 0; index < count; index++) {
    const entry = 8 + index * entrySize;
    let start, length;
    if (fat64) {
      const read64 = position => bigEndian ? bytes.readBigUInt64BE(position) : bytes.readBigUInt64LE(position);
      const start64 = read64(entry + 8), length64 = read64(entry + 16);
      assert.ok(start64 <= BigInt(Number.MAX_SAFE_INTEGER) && length64 <= BigInt(Number.MAX_SAFE_INTEGER), 'Universal Mach-O slice is too large.');
      start = Number(start64); length = Number(length64);
    } else { start = read32(entry + 8); length = read32(entry + 12); }
    assert.ok(start >= 8 + count * entrySize && start + length <= bytes.length && !ranges.some(range => start < range.end && range.start < start + length), 'Overlapping or truncated universal Mach-O slice.');
    const slice = readThinMachO(bytes, start, length);
    assert.equal(slice.architecture, cpuName(read32(entry)), 'Universal Mach-O CPU differs from its slice.');
    assert.ok(!slices.some(existing => existing.architecture === slice.architecture), 'Duplicate universal Mach-O CPU.');
    ranges.push({ start, end: start + length }); slices.push(slice);
  }
  return { architectures: slices.map(slice => slice.architecture), slices };
}

function isMachO(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 4) return false;
  return ['cffaedfe', 'feedfacf', 'cafebabe', 'cafebabf', 'bebafeca', 'bfbafeca'].includes(bytes.subarray(0, 4).toString('hex'));
}

function validateZipEntry(entry, appName) {
  const name = entry.fileName;
  assert.ok(typeof name === 'string' && name && !name.includes('\\') && !name.includes('\0') && !name.startsWith('/') && !/^[A-Za-z]:/.test(name), 'Unsafe ZIP entry path.');
  const parts = name.replace(/\/$/, '').split('/');
  assert.ok(parts.every(part => part && part !== '.' && part !== '..'), 'ZIP path contains traversal.');
  const resourceSidecar = parts[0] === '__MACOSX';
  assert.ok(parts[0] === appName || resourceSidecar, 'ZIP contains an unexpected top-level item.');
  const madeByUnix = (entry.versionMadeBy >>> 8) === 3;
  const mode = (entry.externalFileAttributes >>> 16) & 0xffff;
  const type = mode & 0o170000;
  const symlink = madeByUnix && type === 0o120000;
  assert.ok(resourceSidecar || madeByUnix, 'ZIP did not preserve Unix file attributes.');
  assert.ok(resourceSidecar || [0, 0o100000, 0o040000, 0o120000].includes(type), 'ZIP contains an unsupported Unix file type.');
  return { fileName: name, mode, symlink, directory: name.endsWith('/'), resourceSidecar };
}

function validateSymlinkTarget(entryName, target, appName) {
  assert.ok(typeof target === 'string' && target && !target.includes('\0') && !target.includes('\\') && !target.startsWith('/') && !/^[A-Za-z]:/.test(target), 'Unsafe framework symlink target.');
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(entryName), target));
  assert.ok(resolved === appName || resolved.startsWith(appName + '/'), 'Framework symlink escaped its app bundle.');
  return resolved;
}

function readIcns(bytes) {
  assert.ok(Buffer.isBuffer(bytes) && bytes.length >= 8 && bytes.toString('ascii', 0, 4) === 'icns' && bytes.readUInt32BE(4) === bytes.length, 'Invalid ICNS container.');
  const chunks = [];
  let position = 8;
  while (position < bytes.length) {
    assert.ok(position + 8 <= bytes.length, 'Truncated ICNS chunk.');
    const type = bytes.toString('ascii', position, position + 4), size = bytes.readUInt32BE(position + 4);
    assert.ok(size >= 8 && position + size <= bytes.length, 'Invalid ICNS chunk length.');
    const data = bytes.subarray(position + 8, position + size);
    let dimensions = null;
    if (data.length >= 24 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
      dimensions = { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
    }
    chunks.push({ type, bytes: data.length, dimensions }); position += size;
  }
  return chunks;
}

module.exports = { readMachO, isMachO, validateZipEntry, validateSymlinkTarget, readIcns };
