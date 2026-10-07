'use strict';

const { createHash } = require('node:crypto');
const { MAX_FILE_BYTES, MAX_TOTAL_BYTES } = require('../browser/files');
const { isStoredFile, storedFile } = require('../browser/file-store');

const MAX_METADATA_BYTES = 4 * 1024 * 1024;
const MAX_PROJECT_BYTES = 3 * 1024 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = MAX_PROJECT_BYTES + MAX_METADATA_BYTES * 4;
const sha256 = value => createHash('sha256').update(value).digest('hex');

function safeMemberName(value) {
  if (typeof value !== 'string' || !value || value.length > 180 ||
      /[\\/<>:"|?*\x00-\x1f\x7f]/.test(value) || /[. ]$/.test(value) ||
      /^(?:\.{1,2}|con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value)) {
    throw new Error('File names must be safe, unique plain names without directory paths.');
  }
  return value;
}

function decodeFile(file) {
  if (!file || typeof file !== 'object') throw new Error('A file descriptor is required.');
  const name = safeMemberName(file.name);
  const mimeType = typeof file.mimeType === 'string' ? file.mimeType : 'application/octet-stream';
  if (!/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(mimeType) || mimeType.length > 150) throw new Error('File media type is invalid.');
  if (isStoredFile(file)) return storedFile(file);
  let bytes;
  if (Buffer.isBuffer(file.bytes) || file.bytes instanceof Uint8Array) {
    if (file.bytes.byteLength > MAX_FILE_BYTES) throw new Error('File exceeds the workspace file limit.');
    bytes = Buffer.from(file.bytes);
  } else {
    if (typeof file.base64 !== 'string' || file.base64.length > Math.ceil(MAX_FILE_BYTES / 3) * 4 ||
        file.base64.length % 4 || !/^(?:[A-Za-z0-9+/]*={0,2})$/.test(file.base64)) throw new Error('File data is invalid or too large.');
    bytes = Buffer.from(file.base64, 'base64');
    if (bytes.toString('base64') !== file.base64 || bytes.length > MAX_FILE_BYTES) throw new Error('File data is not canonical base64 or exceeds the limit.');
  }
  const contentSha256 = sha256(bytes);
  if (file.contentSha256 !== undefined && file.contentSha256 !== contentSha256) throw new Error(`The contents of ${name} changed after review.`);
  if (file.byteLength !== undefined && file.byteLength !== bytes.length) throw new Error(`The length of ${name} changed after review.`);
  return { name, mimeType, contentSha256, byteLength: bytes.length, bytes };
}

function normalizeFiles(files = [], maximum = 100) {
  if (!Array.isArray(files) || files.length > maximum) throw new Error(`Supply at most ${maximum} files.`);
  const names = new Set();
  let total = 0;
  return files.map(file => {
    const result = decodeFile(file);
    const key = result.name.toLowerCase();
    if (names.has(key)) throw new Error('File names must be unique, including case.');
    names.add(key);
    total += result.byteLength;
    if (total > MAX_TOTAL_BYTES) throw new Error('Files exceed the 256 MB total limit.');
    return result;
  });
}

function fileDescriptor({ name, mimeType, contentSha256, byteLength }) {
  return { name, mimeType, contentSha256, byteLength };
}

function normalizeCandidate(value) {
  if (!value || typeof value.id !== 'string' || !value.id || value.id.length > 100) throw new Error('Candidate ID is required.');
  const answer = value.answer ?? value.text ?? '';
  if (typeof answer !== 'string' || answer.length > 100_000) throw new Error('Candidate answer is too large or invalid.');
  const files = normalizeFiles(value.files || [], 5);
  const digest = sha256(JSON.stringify({ answer, files: files.map(fileDescriptor) }));
  if (value.sha256 !== undefined && value.sha256 !== digest) throw new Error('Candidate identity does not match its current text and exact file bytes.');
  return { id: value.id, sha256: digest, answer, files };
}

function boundedJSON(value, label = 'Metadata') {
  const text = JSON.stringify(value);
  if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_METADATA_BYTES) throw new Error(`${label} exceeds the 4 MB metadata limit.`);
  return text;
}

module.exports = { MAX_METADATA_BYTES, MAX_PROJECT_BYTES, MAX_ARCHIVE_BYTES, sha256, safeMemberName, decodeFile,
  normalizeFiles, normalizeCandidate, fileDescriptor, boundedJSON };
