'use strict';

const { createHash } = require('node:crypto');

// Source files are exchanged as inert text. Preserve their actual extension
// when saving; never infer an arbitrary binary type from an unknown suffix.
const TEXT_SOURCE_EXTENSIONS = Object.freeze([
  'mq5', 'mqh', 'mq4', 'py', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx',
  'c', 'cc', 'cpp', 'h', 'hpp', 'cs', 'java', 'go', 'rs', 'rb', 'php', 'sql',
  'html', 'css', 'xml', 'yaml', 'yml', 'toml', 'sh', 'ps1', 'r', 'swift', 'kt', 'kts',
  'ini', 'cfg', 'log', 'set', 'tex',
]);
const MIME = Object.freeze({
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
  pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', tsv: 'text/tab-separated-values', json: 'application/json',
  zip: 'application/zip',
  ...Object.fromEntries(TEXT_SOURCE_EXTENSIONS.map((extension) => [extension, 'text/plain'])),
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
});
// Large files use private disk blobs and bounded IPC chunks. The provider
// still enforces its own format, token, storage and account limits.
const MAX_FILE_BYTES = 512 * 1024 * 1024;
const MAX_TOTAL_BYTES = 1024 * 1024 * 1024;
const MAX_INLINE_FILE_BYTES = 128 * 1024 * 1024;
const FILE_LIMIT_MESSAGE = 'File limit is 512 MB each and 1 GB total.';
const PROVIDER_IMAGE_BYTES = 20 * 1024 * 1024;
const PROVIDER_SPREADSHEET_BYTES = 50 * 1024 * 1024;

function providerUploadAdvice(name, mimeType, byteLength) {
  if (String(mimeType).startsWith('image/') && byteLength > PROVIDER_IMAGE_BYTES) {
    throw new Error(`${name}: ChatGPT supports images up to 20 MB. Resize or compress this image before uploading.`);
  }
  if (['csv', 'tsv', 'xlsx', 'xls'].includes(filenameExtension(name)) && byteLength > PROVIDER_SPREADSHEET_BYTES) {
    return 'ChatGPT limits spreadsheets to approximately 50 MB depending on row size. Split this spreadsheet if the provider rejects it.';
  }
  return '';
}

function filenameExtension(name) {
  return String(name || '').match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() || '';
}

function validateZipArchive(name, mimeType, bytes) {
  const extension = filenameExtension(name);
  if ((extension === 'zip' || mimeType === 'application/zip') && (extension !== 'zip' || mimeType !== 'application/zip')) {
    throw new Error('The ZIP file type does not match its filename.');
  }
  if (mimeType !== 'application/zip' || bytes === undefined) return;
  // Inspect container headers only. Do not decompress, extract, execute or
  // interpret any member, including executable-looking member filenames.
  const invalid = () => { throw new Error('The ZIP file is malformed, incomplete, or uses unsupported multipart/ZIP64 structures.'); };
  const u16 = offset => bytes[offset] | (bytes[offset + 1] << 8);
  const u32 = offset => (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
  if (bytes.length < 22 || ![0x04034b50, 0x06054b50, 0x08074b50].includes(u32(0))) invalid();
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65_557); offset -= 1) {
    if (u32(offset) === 0x06054b50 && offset + 22 + u16(offset + 20) === bytes.length) { end = offset; break; }
  }
  if (end < 0 || u16(end + 4) !== 0 || u16(end + 6) !== 0 || u16(end + 8) !== u16(end + 10)) invalid();
  const entries = u16(end + 10), directorySize = u32(end + 12), directoryOffset = u32(end + 16);
  if (entries === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff || directoryOffset + directorySize > end) invalid();
  if (!entries) { if (directorySize !== 0) invalid(); return; }
  let cursor = directoryOffset;
  for (let index = 0; index < entries; index += 1) {
    if (cursor + 46 > directoryOffset + directorySize || u32(cursor) !== 0x02014b50 || u16(cursor + 34) !== 0) invalid();
    const localOffset = u32(cursor + 42);
    if (u32(cursor + 20) === 0xffffffff || u32(cursor + 24) === 0xffffffff || localOffset === 0xffffffff ||
        localOffset + 30 > directoryOffset || u32(localOffset) !== 0x04034b50) invalid();
    cursor += 46 + u16(cursor + 28) + u16(cursor + 30) + u16(cursor + 32);
    if (cursor > directoryOffset + directorySize) invalid();
  }
  if (cursor !== directoryOffset + directorySize) invalid();
}

function validateTextSource(name, mimeType, bytes) {
  // Existing upload callers share this entry point for inert text and opaque
  // archive validation, so ZIP input is checked before either chat receives it.
  validateZipArchive(name, mimeType, bytes);
  const extension = filenameExtension(name);
  if ((extension === 'tsv' || mimeType === MIME.tsv) && (extension !== 'tsv' || mimeType !== MIME.tsv)) {
    throw new Error('The TSV file type does not match its filename.');
  }
  if (TEXT_SOURCE_EXTENSIONS.includes(extension) && mimeType !== 'text/plain') {
    throw new Error('The source file type does not match its filename.');
  }
  if (!isReadableTextMime(mimeType)) return;
  if (MIME[extension] !== mimeType) {
    throw new Error('The text source file has an unsupported extension.');
  }
  if (bytes === undefined) return;
  // MQL editors may write BOM-marked UTF-16. Validate readable source without
  // altering the bytes that were reviewed or opening/executing the program.
  const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le'
    : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8';
  let text;
  try { text = new TextDecoder(encoding, { fatal: true }).decode(bytes); }
  catch (_) { throw new Error('The source file is not readable Unicode text.'); }
  if (/[\x00-\x08\x0b\x0e-\x1f\x7f]/.test(text)) {
    throw new Error('The source file contains binary data instead of readable text.');
  }
}

function isReadableTextMime(mimeType) {
  return mimeType === 'text/plain' || mimeType === MIME.tsv;
}

function safeFilename(value, mimeType) {
  const extension = Object.keys(MIME).find((key) => MIME[key] === mimeType);
  let name = String(value || '').replace(/[<>:"|?*\\/\x00-\x1f\x7f]/g, '_')
    .trim().replace(/[. ]+$/, '').slice(0, 160);
  if (!name || /^\.+$/.test(name)) name = 'converge-result';
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = `result-${name}`;
  const actualExtension = name.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  if (MIME[actualExtension] !== mimeType) name += `.${extension}`;
  return name;
}

// Only export the files from the exact candidate the user can see. A stale
// generation, reordered attachment, changed descriptor, or malformed binary
// must never silently become the final download.
function validateExport(media, exported) {
  if (!media || !['left', 'right', 'boss'].includes(media.side) || !media.runId || !media.requestId ||
      !Array.isArray(media.files) || !media.files.length || media.files.length > 5) {
    throw new Error('There are no supported candidate files to save.');
  }
  if (!exported?.ok || !Array.isArray(exported.files) || exported.files.length !== media.files.length) {
    throw new Error(exported?.error || 'The candidate files could not be read from their original chat.');
  }
  let total = 0;
  const ids = new Set();
  return exported.files.map((file, index) => {
    const expected = media.files[index];
    if (!file || ['id', 'name', 'mimeType', 'fingerprint'].some((key) =>
      typeof expected?.[key] !== 'string' || !expected[key] || file[key] !== expected[key]) ||
      !Object.values(MIME).includes(file.mimeType) || ids.has(file.id)) {
      throw new Error('The candidate file changed. Run its review again before saving it.');
    }
    ids.add(file.id);
    if (file.blobId !== undefined) {
      const { storedFile } = require('./file-store');
      const stored = storedFile(file);
      validateTextSource(stored.name, stored.mimeType);
      total += stored.byteLength;
      if (total > MAX_TOTAL_BYTES) throw new Error(FILE_LIMIT_MESSAGE);
      if (expected.contentSha256 !== undefined || expected.byteLength !== undefined) {
        if (stored.contentSha256 !== expected.contentSha256 || stored.byteLength !== expected.byteLength) {
          throw new Error('The candidate file contents changed after review. Review it again before saving.');
        }
      }
      return { ...stored, name: safeFilename(stored.name, stored.mimeType) };
    }
    if (typeof file.base64 !== 'string' || !file.base64 ||
        file.base64.length > Math.ceil(MAX_INLINE_FILE_BYTES / 3) * 4 || file.base64.length % 4 !== 0 ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(file.base64)) {
      throw new Error('The candidate file data is invalid or exceeds the 128 MB file limit.');
    }
    const bytes = Buffer.from(file.base64, 'base64');
    total += bytes.length;
    if (!bytes.length || bytes.length > MAX_INLINE_FILE_BYTES || total > MAX_TOTAL_BYTES ||
        bytes.toString('base64') !== file.base64) {
      throw new Error(FILE_LIMIT_MESSAGE);
    }
    validateTextSource(file.name, file.mimeType, bytes);
    // Recompute the identity in the host. A cached URL or descriptor cannot
    // substitute different bytes for the exact file the reviewers checked.
    if (expected.contentSha256 !== undefined || expected.byteLength !== undefined) {
      const digest = createHash('sha256').update(bytes).digest('hex');
      if (!/^[a-f0-9]{64}$/.test(expected.contentSha256 || '') ||
          expected.byteLength !== bytes.length || digest !== expected.contentSha256 ||
          file.contentSha256 !== digest || file.byteLength !== bytes.length) {
        throw new Error('The candidate file contents changed after review. Review it again before saving.');
      }
    }
    return { name: safeFilename(file.name, file.mimeType), mimeType: file.mimeType, bytes };
  });
}

module.exports = { MIME, TEXT_SOURCE_EXTENSIONS, MAX_FILE_BYTES, MAX_TOTAL_BYTES, MAX_INLINE_FILE_BYTES, FILE_LIMIT_MESSAGE,
  PROVIDER_IMAGE_BYTES, PROVIDER_SPREADSHEET_BYTES, providerUploadAdvice, safeFilename, validateExport, validateTextSource, validateZipArchive, isReadableTextMime };
