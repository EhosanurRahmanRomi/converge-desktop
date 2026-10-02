'use strict';

// Retain the original app artwork. Build a multiresolution ICNS container from
// the existing unfiltered RGBA PNG without external image dependencies.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const assert = require('node:assert/strict');

function crc32(bytes) {
  let result = 0xffffffff;
  for (const byte of bytes) { result ^= byte; for (let bit = 0; bit < 8; bit++) result = (result >>> 1) ^ ((result & 1) ? 0xedb88320 : 0); }
  return (result ^ 0xffffffff) >>> 0;
}
function pngChunk(type, bytes) {
  const tag = Buffer.from(type), header = Buffer.alloc(4), checksum = Buffer.alloc(4);
  header.writeUInt32BE(bytes.length); checksum.writeUInt32BE(crc32(Buffer.concat([tag, bytes])));
  return Buffer.concat([header, tag, bytes, checksum]);
}
function readOriginalPng(bytes) {
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  assert.ok(width === height && width <= 1024 && bytes[24] === 8 && bytes[25] === 6 && bytes[28] === 0, 'Expected the original RGBA app icon.');
  const compressed = [];
  for (let offset = 8; offset < bytes.length;) {
    const size = bytes.readUInt32BE(offset), type = bytes.toString('ascii', offset + 4, offset + 8);
    assert.ok(offset + 12 + size <= bytes.length, 'Invalid original PNG chunk.');
    if (type === 'IDAT') compressed.push(bytes.subarray(offset + 8, offset + 8 + size));
    offset += size + 12;
  }
  const pixels = zlib.inflateSync(Buffer.concat(compressed));
  assert.equal(pixels.length, height * (1 + width * 4));
  for (let row = 0; row < height; row++) assert.equal(pixels[row * (1 + width * 4)], 0, 'Original icon uses an unexpected PNG filter.');
  return { width, pixels };
}
function resizedPng(original, size) {
  const output = Buffer.alloc(size * (1 + size * 4));
  const sourcePixel = (x, y, channel) => original.pixels[y * (1 + original.width * 4) + 1 + x * 4 + channel];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const sourceX = Math.max(0, Math.min(original.width - 1, (x + 0.5) * original.width / size - 0.5));
    const sourceY = Math.max(0, Math.min(original.width - 1, (y + 0.5) * original.width / size - 0.5));
    const left = Math.floor(sourceX), top = Math.floor(sourceY), right = Math.min(original.width - 1, left + 1), bottom = Math.min(original.width - 1, top + 1);
    const dx = sourceX - left, dy = sourceY - top;
    for (let channel = 0; channel < 4; channel++) {
      output[y * (1 + size * 4) + 1 + x * 4 + channel] = Math.round(sourcePixel(left, top, channel) * (1 - dx) * (1 - dy) + sourcePixel(right, top, channel) * dx * (1 - dy) + sourcePixel(left, bottom, channel) * (1 - dx) * dy + sourcePixel(right, bottom, channel) * dx * dy);
    }
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), pngChunk('IHDR', header), pngChunk('IDAT', zlib.deflateSync(output, { level: 9 })), pngChunk('IEND', Buffer.alloc(0))]);
}
function buildIcns(source) {
  const original = readOriginalPng(source), cache = new Map();
  const sizes = [['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024], ['ic11', 32], ['ic12', 64], ['ic13', 256], ['ic14', 512]];
  const chunks = sizes.map(([type, size]) => {
    if (!cache.has(size)) cache.set(size, size === original.width ? source : resizedPng(original, size));
    const image = cache.get(size), header = Buffer.alloc(8); header.write(type); header.writeUInt32BE(image.length + 8, 4);
    return Buffer.concat([header, image]);
  });
  const header = Buffer.alloc(8); header.write('icns'); header.writeUInt32BE(chunks.reduce((sum, chunk) => sum + chunk.length, 8), 4);
  return Buffer.concat([header, ...chunks]);
}
if (require.main === module) {
  const directory = path.join(__dirname, '..', 'assets');
  const bytes = buildIcns(fs.readFileSync(path.join(directory, 'icon.png')));
  fs.writeFileSync(path.join(directory, 'icon.icns'), bytes);
  process.stdout.write(`Created assets/icon.icns (${bytes.length} bytes; original Converge artwork).\n`);
}
module.exports = { buildIcns };
