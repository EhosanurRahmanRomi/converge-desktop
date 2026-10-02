'use strict';

// Generates the app icon without external image dependencies.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const outDir = path.join(__dirname, '..', 'assets');
fs.mkdirSync(outDir, { recursive: true });

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const tag = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([tag, data])));
  return Buffer.concat([length, tag, data, checksum]);
}

function clamp(value) { return Math.max(0, Math.min(1, value)); }
function smoothstep(edge0, edge1, value) {
  const t = clamp((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}
function mix(a, b, t) { return a + (b - a) * t; }

function sample(x, y) {
  const px = x - 128;
  const py = y - 128;
  const qx = Math.abs(px) - 82;
  const qy = Math.abs(py) - 82;
  const box = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - 32;
  const alpha = 1 - smoothstep(-0.3, 1.2, box);
  if (alpha <= 0) return [0, 0, 0, 0];

  const bgTop = [18, 28, 52];
  const bgBottom = [8, 13, 28];
  const gradient = clamp(y / 256);
  let color = bgTop.map((v, i) => mix(v, bgBottom[i], gradient));

  const glowLeft = Math.exp(-((x - 79) ** 2 + (y - 91) ** 2) / 9500);
  const glowRight = Math.exp(-((x - 184) ** 2 + (y - 160) ** 2) / 10500);
  color = color.map((v, i) => v + [26, 12, 53][i] * glowLeft + [5, 40, 43][i] * glowRight);

  const leftDist = Math.abs(Math.hypot(x - 92, y - 127) - 57);
  const rightDist = Math.abs(Math.hypot(x - 164, y - 127) - 57);
  const leftRing = 1 - smoothstep(8.0, 10.2, leftDist);
  const rightRing = 1 - smoothstep(8.0, 10.2, rightDist);
  const leftAura = (1 - smoothstep(8, 27, leftDist)) * 0.20;
  const rightAura = (1 - smoothstep(8, 27, rightDist)) * 0.20;
  const violet = [177, 112, 255];
  const cyan = [72, 229, 219];
  for (let i = 0; i < 3; i++) {
    color[i] = mix(color[i], violet[i], leftAura);
    color[i] = mix(color[i], cyan[i], rightAura);
    color[i] = mix(color[i], violet[i], leftRing * (x < 127 ? 0.97 : 0.55));
    color[i] = mix(color[i], cyan[i], rightRing * (x >= 127 ? 0.97 : 0.55));
  }

  const bar = 1 - smoothstep(5.8, 7.7, Math.abs(y - 127));
  const center = (1 - smoothstep(16, 23, Math.abs(x - 128))) * bar;
  color = color.map((v) => mix(v, 242, center * 0.93));
  return [...color.map((v) => Math.max(0, Math.min(255, Math.round(v)))), Math.round(alpha * 255)];
}

function png(size) {
  const data = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    data[row] = 0;
    for (let x = 0; x < size; x++) {
      const samples = [0, 0, 0, 0];
      for (let sy = 0; sy < 2; sy++) for (let sx = 0; sx < 2; sx++) {
        const rgba = sample((x + (sx + 0.5) / 2) * 256 / size,
          (y + (sy + 0.5) / 2) * 256 / size);
        for (let c = 0; c < 4; c++) samples[c] += rgba[c];
      }
      const offset = row + 1 + x * 4;
      for (let c = 0; c < 4; c++) data[offset + c] = Math.round(samples[c] / 4);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(data, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

const sizes = [16, 24, 32, 48, 64, 128, 256];
const images = sizes.map(png);
const header = Buffer.alloc(6 + sizes.length * 16);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
for (let i = 0; i < sizes.length; i++) {
  const entry = 6 + i * 16;
  header[entry] = sizes[i] === 256 ? 0 : sizes[i];
  header[entry + 1] = sizes[i] === 256 ? 0 : sizes[i];
  header[entry + 2] = 0;
  header[entry + 3] = 0;
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(images[i].length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += images[i].length;
}
fs.writeFileSync(path.join(outDir, 'icon.ico'), Buffer.concat([header, ...images]));
fs.writeFileSync(path.join(outDir, 'icon.png'), images[images.length - 1]);
console.log(`Created assets/icon.ico (${sizes.length} sizes) and assets/icon.png`);
