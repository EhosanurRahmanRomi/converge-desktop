'use strict';

const { randomUUID, createHash } = require('node:crypto');
const { MIME, MAX_FILE_BYTES, MAX_TOTAL_BYTES, MAX_INLINE_FILE_BYTES, FILE_LIMIT_MESSAGE, providerUploadAdvice } = require('./files');
const { isStoredFile, storedFile, readFileChunks } = require('./file-store');

const DIRECT_BASE64_LIMIT = 4 * 1024 * 1024;
const FILE_CHUNK_LENGTH = 1024 * 1024;
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const MIME_TYPES = new Set(Object.values(MIME));

function stagedFiles(input) {
  if (!Array.isArray(input) || !input.length || input.length > 5) throw new Error('Choose 1 to 5 files per transfer.');
  if (input.some(file => file?.blobId !== undefined && (!Number.isSafeInteger(file.byteLength) || file.byteLength < 1 || file.byteLength > MAX_FILE_BYTES)) ||
      input.reduce((sum, file) => sum + (file?.blobId !== undefined && Number.isSafeInteger(file.byteLength) ? file.byteLength : 0), 0) > MAX_TOTAL_BYTES) throw new Error(FILE_LIMIT_MESSAGE);
  const names = new Set();
  let bytes = 0;
  const files = input.map(file => {
    if (!file || typeof file.name !== 'string' || !/^[^\\/\x00-\x1f]{1,180}$/.test(file.name) || names.has(file.name) ||
        !MIME_TYPES.has(file.mimeType)) throw new Error('Unsupported or conflicting file name or type.');
    names.add(file.name);
    if (file.blobId !== undefined) {
      if (!isStoredFile(file)) throw new Error('The stored attachment is unavailable or its identity changed.');
      const stored = storedFile(file);
      bytes += stored.byteLength;
      if (stored.byteLength > MAX_FILE_BYTES || bytes > MAX_TOTAL_BYTES) throw new Error(FILE_LIMIT_MESSAGE);
      return { ...stored, base64Length: Math.ceil(stored.byteLength / 3) * 4 };
    }
    const base64 = file.base64;
    if (typeof base64 !== 'string' || !base64.length || base64.length % 4 ||
        base64.length > Math.ceil(MAX_INLINE_FILE_BYTES / 3) * 4) throw new Error('Invalid or oversized inline file contents.');
    const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
    const length = base64.length / 4 * 3 - padding;
    if (length > MAX_INLINE_FILE_BYTES) throw new Error('Invalid or oversized inline file contents.');
    bytes += length;
    if (!length || length > MAX_FILE_BYTES || bytes > MAX_TOTAL_BYTES) throw new Error(FILE_LIMIT_MESSAGE);
    return { name: file.name, mimeType: file.mimeType, base64, byteLength: length,
      ...(file.contentSha256 ? { contentSha256: file.contentSha256 } : {}) };
  });
  for (const file of files) {
    if (file.blobId) continue;
    const base64 = file.base64;
    // A single alphabet repetition avoids the regexp stack exhaustion caused
    // by repeating four-character groups across a large base64 payload.
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64) ||
        base64.endsWith('==') && (BASE64_ALPHABET.indexOf(base64[base64.length - 3]) & 15) !== 0 ||
        base64.endsWith('=') && !base64.endsWith('==') && (BASE64_ALPHABET.indexOf(base64[base64.length - 2]) & 3) !== 0) {
      throw new Error('Invalid noncanonical file contents.');
    }
  }
  return files;
}

/**
 * A large attachment must not become one oversized Electron IPC message.
 * Stage it in order, commit exactly once, and never retry an ambiguous upload
 * or prompt submission. The page remains responsible for confirming upload.
 * An optional signal stops staging between acknowledgements; sendSmall owns
 * cancellation of an IPC request that is already awaiting its response.
 */
async function sendUpload(sendSmall, side, message, { signal, onProgress } = {}) {
  if (typeof sendSmall !== 'function') throw new TypeError('An owned page transport is required.');
  if (!['UPLOAD_FILES', 'SEND_PROMPT'].includes(message?.type) || !message.files?.length) return sendSmall(side, message);
  const canceled = () => {
    if (!signal?.aborted) return;
    if (signal.reason instanceof Error) throw signal.reason;
    const error = new Error(String(signal.reason || 'The file transfer was canceled.'));
    error.name = 'AbortError';
    throw error;
  };
  canceled();
  const files = stagedFiles(message.files);
  const advice = files.map(file => providerUploadAdvice(file.name, file.mimeType, file.byteLength));
  const totalBytes = files.reduce((sum, file) => sum + file.byteLength, 0);
  let processedBytes = 0;
  const progress = (phase, file, fileIndex) => {
    if (typeof onProgress === 'function') onProgress({ phase, processedBytes, totalBytes, fileName: file.name, fileIndex, fileCount: files.length, side,
      ...(advice[fileIndex] ? { warning: advice[fileIndex] } : {}) });
  };
  if (!files.some(file => file.blobId) && files.reduce((total, file) => total + file.base64.length, 0) <= DIRECT_BASE64_LIMIT) {
    progress('processing', files.at(-1), files.length - 1);
    canceled();
    const response = await sendSmall(side, message);
    canceled();
    return response;
  }

  const { files: _originalFiles, ...metadata } = message;
  const transferId = randomUUID();
  let stagingStarted = false;
  const send = async payload => {
    canceled();
    const response = await sendSmall(side, payload);
    canceled();
    if (response?.ok !== true) throw new Error(response?.error || 'The page did not acknowledge the file transfer.');
    return response;
  };

  try {
    canceled();
    // Mark this before awaiting BEGIN, so a lost acknowledgement also gets
    // cleanup. ABORT removes only this transfer and never submits its files.
    stagingStarted = true;
    progress('staging', files[0], 0);
    await send({ type: 'FILE_STAGE_BEGIN', transferId, runId: metadata.runId, requestId: metadata.requestId,
      files: files.map(file => ({ name: file.name, mimeType: file.mimeType, base64Length: file.base64Length || file.base64.length,
        byteLength: file.byteLength, ...(file.contentSha256 ? { contentSha256: file.contentSha256 } : {}) })) });
    for (const [fileIndex, file] of files.entries()) {
      const hash = createHash('sha256');
      let offset = 0, receivedBytes = 0;
      const chunks = file.blobId ? readFileChunks(file, { signal, chunkBytes: FILE_CHUNK_LENGTH / 4 * 3 }) :
        (async function* () { for (let start = 0; start < file.base64.length; start += FILE_CHUNK_LENGTH) yield Buffer.from(file.base64.slice(start, start + FILE_CHUNK_LENGTH), 'base64'); })();
      for await (const bytes of chunks) {
        canceled();
        const data = bytes.toString('base64');
        if (!bytes.length || data.length > FILE_CHUNK_LENGTH || (receivedBytes + bytes.length < file.byteLength && bytes.length % 3)) throw new Error('The source stream returned an invalid chunk.');
        hash.update(bytes); receivedBytes += bytes.length;
        await send({ type: 'FILE_STAGE_CHUNK', transferId, fileIndex, offset,
          data });
        offset += data.length;
        processedBytes += bytes.length; progress('staging', file, fileIndex);
      }
      if (receivedBytes !== file.byteLength || offset !== (file.base64Length || file.base64.length) ||
          file.contentSha256 && hash.digest('hex') !== file.contentSha256) throw new Error('The source stream changed before upload confirmation.');
    }
    progress('processing', files.at(-1), files.length - 1);
    const uploaded = await send({ ...metadata, type: 'FILE_STAGE_COMMIT', transferId });
    if (uploaded.attached !== files.length) throw new Error('The page did not confirm every staged attachment.');
    if (message.type === 'UPLOAD_FILES') return uploaded;
    canceled();
    // A SEND_PROMPT that carried files must now submit its text once, with
    // the exact names already committed to its composer. Do not attach again.
    const expectedSourceNames = [...new Set([...(Array.isArray(metadata.expectedSourceNames) ? metadata.expectedSourceNames : []), ...files.map(file => file.name)])];
    return await send({ ...metadata, expectedSourceNames });
  } catch (error) {
    if (stagingStarted) {
      try { await sendSmall(side, { type: 'FILE_STAGE_ABORT', transferId }); } catch (_) { /* Preserve the original failure. */ }
    }
    throw error;
  }
}

module.exports = { sendUpload, DIRECT_BASE64_LIMIT, FILE_CHUNK_LENGTH };
