'use strict';

// Files stay in an app-owned immutable disk store. IPC and checkpoints carry
// opaque capabilities and exact identities, never user paths or giant strings.
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const registry = new Map(), stores = new Map();
let defaultStore;
const CHUNK_BYTES = 786432, HEAD_BYTES = 65536;
const maximum = () => require('./files').MAX_FILE_BYTES;
const stopped = signal => { if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('The file operation was cancelled.'); };
const hash = () => createHash('sha256');
function safeName(name) {
  if (typeof name !== 'string' || !name || name.length > 180 || /[\\/<>:"|?*\x00-\x1f\x7f]/.test(name) || /[. ]$/.test(name) || /^(?:\.{1,2}|con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) throw new Error('Invalid stored file name.');
  return name;
}
function record(file) {
  const owned = file && registry.get(file.blobId);
  if (!owned || file.contentSha256 !== owned.contentSha256 || file.byteLength !== owned.byteLength || file.mimeType !== owned.mimeType || file.byteLength > maximum()) throw new Error('Stored file identity is unavailable or changed.');
  safeName(file.name); return owned;
}
function isStoredFile(file) { try { record(file); return true; } catch (_) { return false; } }
function storedFile(file) { const item = record(file); return { name: safeName(file.name), mimeType: item.mimeType, blobId: file.blobId, byteLength: item.byteLength, contentSha256: item.contentSha256 }; }
function getStoredFilePath(file) { return record(file).filename; }
function getStoredFileHead(file, maxBytes = HEAD_BYTES) { return Buffer.from(record(file).head.subarray(0, Math.min(HEAD_BYTES, Math.max(0, maxBytes)))); }
async function* readFileChunks(file, { signal, chunkBytes = CHUNK_BYTES } = {}) {
  const item = record(file);
  if (!Number.isInteger(chunkBytes) || chunkBytes < 1 || chunkBytes > 1024 * 1024) throw new Error('Invalid disk chunk size.');
  const stat = await fs.lstat(item.filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== item.byteLength) throw new Error('Stored file is missing or damaged.');
  const handle = await fs.open(item.filename, 'r');
  try {
    const opened = await handle.stat();
    if (opened.size !== stat.size || opened.ino !== stat.ino || opened.mtimeMs !== stat.mtimeMs) throw new Error('Stored file changed before reading.');
    let offset = 0;
    while (offset < item.byteLength) {
      stopped(signal); const bytes = Buffer.allocUnsafe(Math.min(chunkBytes, item.byteLength - offset));
      let filled = 0;
      while (filled < bytes.length) {
        stopped(signal); const { bytesRead } = await handle.read(bytes, filled, bytes.length - filled, offset + filled);
        if (!bytesRead) throw new Error('Stored file ended before its verified length.');
        filled += bytesRead;
      }
      offset += bytes.length; yield bytes;
    }
    stopped(signal);
    const after = await handle.stat();
    if (after.size !== opened.size || after.ino !== opened.ino || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) throw new Error('Stored file changed while reading.');
  } finally { await handle.close(); }
}
async function readFileHead(file, maxBytes = HEAD_BYTES) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes > 16 * 1024 * 1024) throw new Error('Preview exceeds its bounded read limit.');
  const item = record(file), stat = await fs.lstat(item.filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== item.byteLength) throw new Error('Stored file is missing or damaged.');
  const handle = await fs.open(item.filename, 'r');
  try {
    const opened = await handle.stat();
    if (opened.size !== stat.size || opened.ino !== stat.ino || opened.mtimeMs !== stat.mtimeMs) throw new Error('Stored file changed before its preview.');
    const bytes = Buffer.alloc(Math.min(maxBytes, item.byteLength)); let offset = 0;
    while (offset < bytes.length) { const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset); if (!bytesRead) throw new Error('Stored preview ended before its expected length.'); offset += bytesRead; }
    const after = await handle.stat();
    if (after.size !== opened.size || after.ino !== opened.ino || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) throw new Error('Stored file changed during its preview.');
    return bytes;
  }
  finally { await handle.close(); }
}
async function verifyStoredFile(file, { signal } = {}) {
  const digest = hash(); let count = 0;
  for await (const bytes of readFileChunks(file, { signal })) { digest.update(bytes); count += bytes.length; }
  if (count !== file.byteLength || digest.digest('hex') !== file.contentSha256) throw new Error(`Stored file ${file.name} failed its SHA-256 check.`);
  return storedFile(file);
}
async function copyStoredFile(file, destination, { signal } = {}) {
  if (typeof destination !== 'string' || !destination) throw new Error('An output path is required.');
  const temp = `${destination}.${randomUUID()}.part`, output = await fs.open(temp, 'wx', 0o600), digest = hash(); let count = 0;
  try {
    for await (const bytes of readFileChunks(file, { signal })) { await output.writeFile(bytes); digest.update(bytes); count += bytes.length; }
    stopped(signal);
    if (count !== file.byteLength || digest.digest('hex') !== file.contentSha256) throw new Error('Stored file contents changed while copying.');
    await output.sync(); await output.close(); stopped(signal); await fs.rename(temp, destination);
  } finally { await output.close().catch(() => {}); await fs.unlink(temp).catch(() => {}); }
}
async function validateZipPath(filename, name, mimeType, byteLength, signal, assertActive = () => {}) {
  require('./files').validateTextSource(name, mimeType);
  if (mimeType !== 'application/zip') return;
  const invalid = () => { throw new Error('The ZIP file is malformed, incomplete, or uses unsupported multipart/ZIP64 structures.'); };
  const handle = await fs.open(filename, 'r');
  const read = async (offset, length) => {
    stopped(signal); assertActive(); if (offset < 0 || offset + length > byteLength) invalid(); const bytes = Buffer.alloc(length); let readLength = 0;
    while (readLength < length) { stopped(signal); assertActive(); const result = await handle.read(bytes, readLength, length - readLength, offset + readLength); if (!result.bytesRead) invalid(); readLength += result.bytesRead; }
    return bytes;
  };
  try {
    if (byteLength < 22) invalid();
    const first = await read(0, 4); if (![0x04034b50, 0x06054b50, 0x08074b50].includes(first.readUInt32LE(0))) invalid();
    const tailOffset = Math.max(0, byteLength - 65557), tail = await read(tailOffset, byteLength - tailOffset); let end = -1;
    for (let offset = tail.length - 22; offset >= 0; offset--) if (tail.readUInt32LE(offset) === 0x06054b50 && offset + 22 + tail.readUInt16LE(offset + 20) === tail.length) { end = offset; break; }
    if (end < 0 || tail.readUInt16LE(end + 4) || tail.readUInt16LE(end + 6) || tail.readUInt16LE(end + 8) !== tail.readUInt16LE(end + 10)) invalid();
    const count = tail.readUInt16LE(end + 10), size = tail.readUInt32LE(end + 12), start = tail.readUInt32LE(end + 16);
    if (count === 65535 || size === 0xffffffff || start === 0xffffffff || start + size > tailOffset + end || !count && size) invalid();
    let cursor = start;
    for (let index = 0; index < count; index++) {
      const header = await read(cursor, 46), local = header.readUInt32LE(42);
      if (header.readUInt32LE(0) !== 0x02014b50 || header.readUInt16LE(34) || header.readUInt32LE(20) === 0xffffffff || header.readUInt32LE(24) === 0xffffffff || local === 0xffffffff || local + 30 > start || (await read(local, 4)).readUInt32LE(0) !== 0x04034b50) invalid();
      cursor += 46 + header.readUInt16LE(28) + header.readUInt16LE(30) + header.readUInt16LE(32); if (cursor > start + size) invalid();
    }
    if (cursor !== start + size) invalid();
  } finally { await handle.close(); }
}
function createFileStore({ directory, makeDefault = true } = {}) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) throw new Error('An absolute file store directory is required.');
  const root = path.resolve(directory);
  if (stores.has(root)) { const existing = stores.get(root); if (makeDefault || !defaultStore) defaultStore = existing; return existing; }
  const blobs = path.join(root, 'blobs'), staging = path.join(root, 'staging'); let closed = false, closePromise;
  const jobs = new Set();
  const active = () => { if (closed) throw new Error('The file store is closed.'); };
  async function writeStream(stream, { name, mimeType, signal, onProgress = () => {}, expectedSha256, expectedByteLength } = {}) {
    active(); safeName(name); require('./files').validateTextSource(name, mimeType);
    if (!Object.values(require('./files').MIME).includes(mimeType)) throw new Error('Unsupported stored media type.');
    await fs.mkdir(blobs, { recursive: true }); await fs.mkdir(staging, { recursive: true }); active();
    const temp = path.join(staging, `${randomUUID()}.part`), output = await fs.open(temp, 'wx', 0o600), digest = hash();
    let count = 0, head = Buffer.alloc(0), decoder, unicodeLead = Buffer.alloc(0);
    try {
      for await (const chunk of stream) {
        active(); stopped(signal); const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        if (bytes.length > 1024 * 1024) throw new Error('Input stream exceeds the 1 MB chunk limit.');
        count += bytes.length; if (!count || count > maximum()) throw new Error('File exceeds the workspace file limit.');
        if (head.length < HEAD_BYTES) head = Buffer.concat([head, bytes.subarray(0, HEAD_BYTES - head.length)]);
        if (require('./files').isReadableTextMime(mimeType)) {
          let input = bytes;
          if (!decoder) {
            unicodeLead = Buffer.concat([unicodeLead, bytes]);
            if (unicodeLead.length < 2) { digest.update(bytes); await output.writeFile(bytes); continue; }
            decoder = new TextDecoder(unicodeLead[0] === 255 && unicodeLead[1] === 254 ? 'utf-16le' : unicodeLead[0] === 254 && unicodeLead[1] === 255 ? 'utf-16be' : 'utf-8', { fatal: true });
            input = unicodeLead; unicodeLead = Buffer.alloc(0);
          }
          let text; try { text = decoder.decode(input, { stream: true }); } catch (_) { throw new Error('The source file is not readable Unicode text.'); }
          if (/[\x00-\x08\x0b\x0e-\x1f\x7f]/.test(text)) throw new Error('The source file contains binary data instead of readable text.');
        }
        digest.update(bytes); await output.writeFile(bytes); try { onProgress({ phase: 'reading', byteLength: count, processedBytes: count, totalBytes: expectedByteLength || null }); } catch (_) {}
      }
      if (unicodeLead.length) { try { new TextDecoder('utf-8', { fatal: true }).decode(unicodeLead); } catch (_) { throw new Error('The source file is not readable Unicode text.'); } if (/[\x00-\x08\x0b\x0e-\x1f\x7f]/.test(unicodeLead.toString())) throw new Error('The source file contains binary data instead of readable text.'); }
      if (decoder) { try { decoder.decode(); } catch (_) { throw new Error('The source file is not readable Unicode text.'); } }
      active(); stopped(signal); if (!count) throw new Error('Empty files cannot be uploaded.');
      const contentSha256 = digest.digest('hex');
      if (expectedSha256 && expectedSha256 !== contentSha256 || expectedByteLength !== undefined && expectedByteLength !== count) throw new Error('File contents do not match their expected identity.');
      await output.sync(); await output.close(); await validateZipPath(temp, name, mimeType, count, signal, active); active(); stopped(signal);
      const filename = path.join(blobs, `${contentSha256}.blob`);
      let existing = false;
      try { await fs.link(temp, filename); } catch (error) { if (error.code !== 'EEXIST') throw error; existing = true; }
      active(); stopped(signal);
      const blobId = randomUUID(), result = { name, mimeType, blobId, byteLength: count, contentSha256 };
      registry.set(blobId, { ...result, filename, head, owner: root });
      try { if (existing) await verifyStoredFile(result, { signal }); active(); stopped(signal); }
      catch (error) { registry.delete(blobId); throw error; }
      return result;
    } finally { await output.close().catch(() => {}); await fs.unlink(temp).catch(() => {}); }
  }
  async function ingestStream(stream, options) {
    const operation = writeStream(stream, options); jobs.add(operation);
    try { return await operation; } finally { jobs.delete(operation); }
  }
  async function ingest(filename, options = {}) {
    active(); const initial = await fs.lstat(filename);
    if (!initial.isFile() || initial.isSymbolicLink() || initial.size < 1 || initial.size > maximum()) throw new Error('Choose a regular file within the workspace file limit.');
    const input = await fs.open(filename, 'r');
    const stream = async function* () { let offset = 0; try { while (offset < initial.size) { active(); stopped(options.signal); const chunk = Buffer.allocUnsafe(Math.min(CHUNK_BYTES, initial.size - offset)); const { bytesRead } = await input.read(chunk, 0, chunk.length, offset); if (!bytesRead) throw new Error('The source file changed while preparing.'); offset += bytesRead; yield chunk.subarray(0, bytesRead); } const final = await input.stat(); if (final.size !== initial.size || final.mtimeMs !== initial.mtimeMs || final.ino !== initial.ino) throw new Error('The source file changed while preparing.'); } finally { await input.close(); } };
    const operation = ingestStream(stream(), { ...options, name: options.name || path.basename(filename), expectedByteLength: options.expectedByteLength ?? initial.size }); jobs.add(operation);
    try { return await operation; } finally { jobs.delete(operation); await input.close().catch(() => {}); }
  }
  const store = { ingest, ingestStream, read: readFileChunks, close() {
    if (!closePromise) {
      closed = true;
      closePromise = (async () => { await Promise.allSettled([...jobs]); for (const [id, item] of registry) if (item.owner === root) registry.delete(id); if (stores.get(root) === store) stores.delete(root); if (defaultStore === store) defaultStore = undefined; })();
    }
    return closePromise;
  } };
  stores.set(root, store); if (makeDefault || !defaultStore) defaultStore = store; return store;
}
async function importFile(filename, options) { if (!defaultStore) throw new Error('The native file store is not configured.'); return defaultStore.ingest(filename, options); }
async function registerStoredFile(filename, options) { return importFile(filename, { ...options, expectedSha256: options.contentSha256, expectedByteLength: options.byteLength }); }
module.exports = { createFileStore, isStoredFile, storedFile, importFile, readFileChunks, readFileHead, getStoredFileHead,
  copyStoredFile, verifyStoredFile, getStoredFilePath, registerStoredFile };
