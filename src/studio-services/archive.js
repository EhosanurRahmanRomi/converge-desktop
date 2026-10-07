'use strict';

// A small ZIP STORE implementation keeps portable projects independent of
// development-only packaging dependencies. Import accepts this exact, bounded
// format: no extraction, compression, symlinks, ZIP64, encryption or zip bombs.
const { MAX_ARCHIVE_BYTES, MAX_METADATA_BYTES } = require('./identity');
const MAX_ENTRIES = 505;
const table = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value >>> 0;
});
function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = table[(value ^ byte) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}
function archiveName(name) {
  if (typeof name !== 'string' || name.length > 260 || !name || name.startsWith('/') ||
      /[\\:\x00-\x1f\x7f]/.test(name) || name.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error('Unsafe archive member name.');
  }
  return name;
}
function createZip(entries) {
  if (!Array.isArray(entries) || entries.length > MAX_ENTRIES) throw new Error('Archive contains too many entries.');
  const locals = [], directories = [], names = new Set();
  let offset = 0;
  for (const entry of entries) {
    const name = archiveName(entry.name);
    if (names.has(name.toLowerCase())) throw new Error('Archive member names must be unique.');
    names.add(name.toLowerCase());
    const nameBytes = Buffer.from(name, 'utf8'), bytes = Buffer.from(entry.bytes);
    const crc = crc32(bytes);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6);
    header.writeUInt32LE(crc, 14); header.writeUInt32LE(bytes.length, 18); header.writeUInt32LE(bytes.length, 22);
    header.writeUInt16LE(nameBytes.length, 26);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(0x800, 8); directory.writeUInt32LE(crc, 16);
    directory.writeUInt32LE(bytes.length, 20); directory.writeUInt32LE(bytes.length, 24);
    directory.writeUInt16LE(nameBytes.length, 28); directory.writeUInt32LE(offset, 42);
    locals.push(header, nameBytes, bytes); directories.push(directory, nameBytes);
    offset += header.length + nameBytes.length + bytes.length;
    if (offset > MAX_ARCHIVE_BYTES) throw new Error('Archive exceeds the project size limit.');
  }
  const directory = Buffer.concat(directories), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  if (offset + directory.length + end.length > MAX_ARCHIVE_BYTES) throw new Error('Archive exceeds the project size limit.');
  return Buffer.concat([...locals, directory, end]);
}

function readZip(input) {
  if (!(Buffer.isBuffer(input) || input instanceof Uint8Array) || input.byteLength > MAX_ARCHIVE_BYTES) throw new Error('Project archive is invalid or too large.');
  const bytes = Buffer.from(input);
  const fail = () => { throw new Error('Invalid project archive: only complete Converge ZIP STORE archives are supported.'); };
  if (bytes.length < 22) fail();
  const end = bytes.length - 22;
  if (bytes.readUInt32LE(end) !== 0x06054b50 || bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6) || bytes.readUInt16LE(end + 20)) fail();
  const count = bytes.readUInt16LE(end + 10), size = bytes.readUInt32LE(end + 12), start = bytes.readUInt32LE(end + 16);
  if (count !== bytes.readUInt16LE(end + 8) || count > MAX_ENTRIES || start + size !== end) fail();
  const entries = new Map();
  let cursor = start, expectedOffset = 0;
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > end || bytes.readUInt32LE(cursor) !== 0x02014b50) fail();
    const flags = bytes.readUInt16LE(cursor + 8), method = bytes.readUInt16LE(cursor + 10);
    const crc = bytes.readUInt32LE(cursor + 16), compressed = bytes.readUInt32LE(cursor + 20), uncompressed = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28), extraLength = bytes.readUInt16LE(cursor + 30), commentLength = bytes.readUInt16LE(cursor + 32);
    const localOffset = bytes.readUInt32LE(cursor + 42);
    if (flags !== 0x800 || method || compressed !== uncompressed || extraLength || commentLength || bytes.readUInt16LE(cursor + 34) ||
        bytes.readUInt32LE(cursor + 38) || localOffset !== expectedOffset || cursor + 46 + nameLength > end || localOffset + 30 > start) fail();
    let name;
    try { name = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength)); archiveName(name); }
    catch (_) { fail(); }
    if (entries.has(name) || [...entries.keys()].some(key => key.toLowerCase() === name.toLowerCase())) fail();
    if (bytes.readUInt32LE(localOffset) !== 0x04034b50 || bytes.readUInt16LE(localOffset + 6) !== flags || bytes.readUInt16LE(localOffset + 8) !== method ||
        bytes.readUInt32LE(localOffset + 14) !== crc || bytes.readUInt32LE(localOffset + 18) !== compressed || bytes.readUInt32LE(localOffset + 22) !== uncompressed ||
        bytes.readUInt16LE(localOffset + 26) !== nameLength || bytes.readUInt16LE(localOffset + 28)) fail();
    const contentStart = localOffset + 30 + nameLength, contentEnd = contentStart + compressed;
    if (contentEnd > start || !bytes.subarray(localOffset + 30, contentStart).equals(Buffer.from(name, 'utf8'))) fail();
    const content = bytes.subarray(contentStart, contentEnd);
    if (crc32(content) !== crc) throw new Error(`Archive member ${name} failed its integrity check.`);
    if (/\.json$/i.test(name) && content.length > MAX_METADATA_BYTES) throw new Error('Archive metadata exceeds the limit.');
    entries.set(name, content);
    expectedOffset = contentEnd; cursor += 46 + nameLength;
  }
  if (cursor !== end || expectedOffset !== start) fail();
  return entries;
}

// Native project and delivery dialogs use these disk APIs. Keep every read
// bounded; a 512 MB source must never become a complete archive Buffer.
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const CHUNK_BYTES = 786432;
function aborted(signal) {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('Archive operation canceled.');
}
function crcUpdate(value, bytes) {
  for (const byte of bytes) value = table[(value ^ byte) & 255] ^ (value >>> 8);
  return value;
}
async function readExact(handle, length, position, signal) {
  aborted(signal);
  const bytes = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    aborted(signal);
    const { bytesRead } = await handle.read(bytes, offset, length - offset, position + offset);
    if (!bytesRead) throw new Error('Archive is incomplete.');
    offset += bytesRead;
  }
  return bytes;
}
async function writeExact(handle, bytes, position, signal) {
  let offset = 0;
  while (offset < bytes.length) {
    aborted(signal);
    const { bytesWritten } = await handle.write(bytes, offset, bytes.length - offset, position + offset);
    if (!bytesWritten) throw new Error('Archive write did not finish.');
    offset += bytesWritten;
  }
}
async function *entryChunks(entry, signal) {
  if (Buffer.isBuffer(entry.bytes) || entry.bytes instanceof Uint8Array) {
    for (let offset = 0; offset < entry.bytes.length; offset += CHUNK_BYTES) {
      aborted(signal); yield entry.bytes.subarray(offset, offset + CHUNK_BYTES);
    }
    return;
  }
  if (typeof entry.filePath !== 'string' || !path.isAbsolute(entry.filePath)) throw new Error('Archive source is unavailable.');
  const stat = await fs.lstat(entry.filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || !Number.isSafeInteger(entry.byteLength) || stat.size !== entry.byteLength) throw new Error('Archive source size changed.');
  const handle = await fs.open(entry.filePath, 'r');
  try {
    const opened = await handle.stat();
    if (opened.size !== stat.size || opened.ino !== stat.ino) throw new Error('Archive source changed.');
    for (let offset = 0; offset < stat.size; offset += CHUNK_BYTES) {
      yield await readExact(handle, Math.min(CHUNK_BYTES, stat.size - offset), offset, signal);
    }
    const after = await handle.stat();
    if (after.size !== stat.size || after.mtimeMs !== opened.mtimeMs) throw new Error('Archive source changed while reading.');
  } finally { await handle.close(); }
}
async function entryIdentity(entry, signal) {
  let length = 0, crc = 0xffffffff;
  const hash = createHash('sha256');
  for await (const chunk of entryChunks(entry, signal)) {
    length += chunk.length;
    if (length > MAX_ARCHIVE_BYTES) throw new Error('Archive exceeds the project size limit.');
    crc = crcUpdate(crc, chunk); hash.update(chunk);
  }
  const digest = hash.digest('hex');
  if (entry.contentSha256 !== undefined && entry.contentSha256 !== digest) throw new Error('Archive source failed its SHA-256 check.');
  return { length, crc: (crc ^ 0xffffffff) >>> 0, digest };
}
async function writeZipFile(entries, destination, { signal } = {}) {
  if (!Array.isArray(entries) || entries.length > MAX_ENTRIES || typeof destination !== 'string' || !path.isAbsolute(destination)) throw new Error('Invalid archive destination or entries.');
  const planned = [], names = new Set();
  let total = 22;
  for (const entry of entries) {
    aborted(signal);
    const name = archiveName(entry.name), key = name.toLowerCase();
    if (names.has(key)) throw new Error('Archive member names must be unique.');
    names.add(key);
    const nameBytes = Buffer.from(name), identity = await entryIdentity(entry, signal);
    if (/\.json$/i.test(name) && !name.startsWith('files/') && identity.length > MAX_METADATA_BYTES) throw new Error('Archive metadata exceeds the limit.');
    total += identity.length + nameBytes.length * 2 + 76;
    if (total > MAX_ARCHIVE_BYTES) throw new Error('Archive exceeds the project size limit.');
    planned.push({ entry, nameBytes, ...identity });
  }
  const temporary = `${destination}.${randomUUID()}.tmp`;
  let handle;
  try {
    aborted(signal); handle = await fs.open(temporary, 'wx', 0o600);
    let position = 0; const directories = [];
    for (const item of planned) {
      const { entry, nameBytes, length, crc } = item;
      const header = Buffer.alloc(30);
      header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6);
      header.writeUInt32LE(crc, 14); header.writeUInt32LE(length, 18); header.writeUInt32LE(length, 22); header.writeUInt16LE(nameBytes.length, 26);
      const directory = Buffer.alloc(46);
      directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6); directory.writeUInt16LE(0x800, 8);
      directory.writeUInt32LE(crc, 16); directory.writeUInt32LE(length, 20); directory.writeUInt32LE(length, 24);
      directory.writeUInt16LE(nameBytes.length, 28); directory.writeUInt32LE(position, 42);
      directories.push(directory, nameBytes);
      await writeExact(handle, header, position, signal); position += header.length;
      await writeExact(handle, nameBytes, position, signal); position += nameBytes.length;
      let actual = 0, actualCrc = 0xffffffff; const actualHash = createHash('sha256');
      for await (const chunk of entryChunks(entry, signal)) {
        actual += chunk.length; actualCrc = crcUpdate(actualCrc, chunk); actualHash.update(chunk);
        await writeExact(handle, chunk, position, signal); position += chunk.length;
      }
      if (actual !== length || ((actualCrc ^ 0xffffffff) >>> 0) !== crc || actualHash.digest('hex') !== item.digest) throw new Error('Archive source changed between verification and export.');
    }
    const directory = Buffer.concat(directories), end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50); end.writeUInt16LE(planned.length, 8); end.writeUInt16LE(planned.length, 10);
    end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(position, 16);
    await writeExact(handle, directory, position, signal); position += directory.length;
    await writeExact(handle, end, position, signal);
    aborted(signal); await handle.sync(); await handle.close(); handle = null;
    aborted(signal); await fs.rename(temporary, destination);
    return { bytes: total, entries: planned.length };
  } finally {
    await handle?.close().catch(() => {}); await fs.unlink(temporary).catch(() => {});
  }
}
async function readZipFile(filename, { signal, onEntry } = {}) {
  if (typeof filename !== 'string' || !path.isAbsolute(filename) || typeof onEntry !== 'function') throw new Error('A disk archive and entry consumer are required.');
  const stat = await fs.lstat(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 22 || stat.size > MAX_ARCHIVE_BYTES) throw new Error('Project archive is invalid or too large.');
  const fail = () => { throw new Error('Invalid project archive: only complete Converge ZIP STORE archives are supported.'); };
  const handle = await fs.open(filename, 'r');
  try {
    const opened = await handle.stat();
    if (opened.size !== stat.size || opened.ino !== stat.ino) fail();
    const end = await readExact(handle, 22, stat.size - 22, signal);
    if (end.readUInt32LE(0) !== 0x06054b50 || end.readUInt16LE(4) || end.readUInt16LE(6) || end.readUInt16LE(20)) fail();
    const count = end.readUInt16LE(10), size = end.readUInt32LE(12), start = end.readUInt32LE(16);
    if (count !== end.readUInt16LE(8) || count > MAX_ENTRIES || start + size !== stat.size - 22 || size > MAX_ENTRIES * (46 + 1040)) fail();
    const directory = await readExact(handle, size, start, signal);
    const planned = [], names = new Set(); let cursor = 0, expectedOffset = 0;
    for (let index = 0; index < count; index += 1) {
      if (cursor + 46 > size || directory.readUInt32LE(cursor) !== 0x02014b50) fail();
      const flags = directory.readUInt16LE(cursor + 8), method = directory.readUInt16LE(cursor + 10), crc = directory.readUInt32LE(cursor + 16);
      const compressed = directory.readUInt32LE(cursor + 20), length = directory.readUInt32LE(cursor + 24), nameLength = directory.readUInt16LE(cursor + 28);
      const localOffset = directory.readUInt32LE(cursor + 42);
      if (flags !== 0x800 || method || compressed !== length || directory.readUInt16LE(cursor + 30) || directory.readUInt16LE(cursor + 32) ||
        directory.readUInt16LE(cursor + 34) || directory.readUInt32LE(cursor + 38) || localOffset !== expectedOffset || cursor + 46 + nameLength > size || localOffset + 30 > start) fail();
      let name;
      try { name = new TextDecoder('utf-8', { fatal: true }).decode(directory.subarray(cursor + 46, cursor + 46 + nameLength)); archiveName(name); } catch (_) { fail(); }
      if (names.has(name.toLowerCase())) fail(); names.add(name.toLowerCase());
      if (/\.json$/i.test(name) && !name.startsWith('files/') && length > MAX_METADATA_BYTES) throw new Error('Archive metadata exceeds the limit.');
      const local = await readExact(handle, 30 + nameLength, localOffset, signal);
      if (local.readUInt32LE(0) !== 0x04034b50 || local.readUInt16LE(6) !== flags || local.readUInt16LE(8) !== method ||
        local.readUInt32LE(14) !== crc || local.readUInt32LE(18) !== compressed || local.readUInt32LE(22) !== length ||
        local.readUInt16LE(26) !== nameLength || local.readUInt16LE(28) || !local.subarray(30).equals(Buffer.from(name))) fail();
      const contentStart = localOffset + 30 + nameLength, contentEnd = contentStart + length;
      if (contentEnd > start) fail();
      planned.push({ name, byteLength: length, contentStart, crc }); expectedOffset = contentEnd; cursor += 46 + nameLength;
    }
    if (cursor !== size || expectedOffset !== start) fail();
    for (const entry of planned) {
      let complete = false;
      const stream = (async function *() {
        let crc = 0xffffffff;
        for (let offset = 0; offset < entry.byteLength; offset += CHUNK_BYTES) {
          const chunk = await readExact(handle, Math.min(CHUNK_BYTES, entry.byteLength - offset), entry.contentStart + offset, signal);
          crc = crcUpdate(crc, chunk); yield chunk;
        }
        if (((crc ^ 0xffffffff) >>> 0) !== entry.crc) throw new Error(`Archive member ${entry.name} failed its integrity check.`);
        complete = true;
      })();
      try { await onEntry({ name: entry.name, byteLength: entry.byteLength, stream }); }
      finally { await stream.return(); }
      if (!complete) throw new Error('Archive entry consumer did not read the complete member.');
    }
    const after = await handle.stat();
    if (after.size !== stat.size || after.mtimeMs !== opened.mtimeMs) throw new Error('Archive changed while reading.');
    return planned.map(({ name, byteLength }) => ({ name, byteLength }));
  } finally { await handle.close(); }
}

module.exports = { createZip, readZip, crc32, writeZipFile, readZipFile };
