'use strict';

// Large QA inputs and independent receipt hashing never allocate a full file.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const path = require('node:path');
const RECEIPT_CHUNK_BYTES = 786432;

function writeLargePdf(filename, bytes) {
  function structure(length) {
    const parts = ['%PDF-1.7\n'], offsets = [0];
    for (const [index, body] of [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R >>',
    ].entries()) {
      offsets.push(Buffer.byteLength(parts.join('')));
      parts.push(`${index + 1} 0 obj\n${body}\nendobj\n`);
    }
    offsets.push(Buffer.byteLength(parts.join('')));
    parts.push(`4 0 obj\n<< /Length ${length} >>\nstream\n`);
    const prefix = Buffer.from(parts.join('')), streamEnd = '\nendstream\nendobj\n';
    const xref = prefix.length + length + Buffer.byteLength(streamEnd);
    const suffix = Buffer.from(`${streamEnd}xref\n0 5\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    return { prefix, suffix };
  }
  let streamLength = bytes - 1024, pieces;
  for (let attempt = 0; attempt < 10; attempt++) {
    pieces = structure(streamLength);
    const difference = bytes - pieces.prefix.length - streamLength - pieces.suffix.length;
    if (!difference) break;
    streamLength += difference;
  }
  assert.equal(pieces.prefix.length + streamLength + pieces.suffix.length, bytes);
  const handle = fs.openSync(filename, 'wx'), hash = createHash('sha256');
  const chunk = Buffer.alloc(1024 * 1024, 32);
  try {
    fs.writeSync(handle, pieces.prefix); hash.update(pieces.prefix);
    for (let offset = 0; offset < streamLength; offset += chunk.length) {
      const part = chunk.subarray(0, Math.min(chunk.length, streamLength - offset));
      fs.writeSync(handle, part); hash.update(part);
    }
    fs.writeSync(handle, pieces.suffix); hash.update(pieces.suffix);
  } finally { fs.closeSync(handle); }
  assert.equal(fs.statSync(filename).size, bytes);
  return { name: path.basename(filename), bytes, sha256: hash.digest('hex') };
}

function streamingFixtureBehavior(maxReadBytes) {
  const input = document.getElementById('fileInput'), previews = document.getElementById('previews');
  const editor = document.getElementById('prompt-textarea'), send = document.getElementById('send');
  const stop = document.getElementById('stopFixture'), turns = document.getElementById('turns');
  window.uploadReceipts = []; window.uploadErrors = []; window.uploadChangeCount = 0;
  window.fixtureSends = []; window.receiptReaders = [];
  window.fullFileReads = 0; window.maxReceiptChunkBytes = 0;
  File.prototype.arrayBuffer = function () { window.fullFileReads++; throw new Error('Full-file arrayBuffer is forbidden by the large QA fixture.'); };
  input.addEventListener('change', () => {
    window.uploadChangeCount++;
    const processing = document.createElement('div');
    processing.setAttribute('role', 'progressbar'); processing.textContent = 'Uploading attachment';
    previews.replaceChildren(processing);
    window.receiptReaders = Array.from(input.files, file => ({ name: file.name, bytes: file.size,
      mimeType: file.type, reader: file.stream().getReader({ mode: 'byob' }), ended: false, processedBytes: 0 }));
  });
  window.nextReceiptChunk = async index => {
    const receipt = window.receiptReaders[index];
    if (!receipt || receipt.ended) return { done: true, chunks: [] };
    const chunks = []; let bytes = 0;
    try {
      while (bytes < maxReadBytes) {
        // A default Blob reader can choose a very large block. BYOB limits the
        // actual stream read as well as the returned IPC payload.
        const value = await receipt.reader.read(new Uint8Array(maxReadBytes - bytes));
        if (value.value?.byteLength) {
          if (value.value.byteLength > maxReadBytes - bytes) throw new Error('File.stream returned an oversized read.');
          bytes += value.value.byteLength; receipt.processedBytes += value.value.byteLength;
          window.maxReceiptChunkBytes = Math.max(window.maxReceiptChunkBytes, value.value.byteLength);
          // Each browser stream block is converted separately; never join the file.
          if (typeof value.value.toBase64 === 'function') chunks.push(value.value.toBase64());
          else {
            let binary = '';
            for (let offset = 0; offset < value.value.length; offset += 8192) binary += String.fromCharCode(...value.value.subarray(offset, offset + 8192));
            chunks.push(btoa(binary));
          }
        }
        if (value.done) { receipt.ended = true; receipt.reader.releaseLock(); receipt.reader = null; break; }
      }
      if (bytes > maxReadBytes + 65536) throw new Error('Receipt batch exceeds its bounded read budget.');
      return { done: receipt.ended, chunks, bytes };
    } catch (error) { window.uploadErrors.push(error.message); throw error; }
  };
  window.finishReceipt = (index, sha256) => {
    const record = window.receiptReaders[index];
    if (!record?.ended || record.processedBytes !== record.bytes) throw new Error('Receipt hash did not consume the exact file.');
    window.uploadReceipts.push({ name: record.name, bytes: record.bytes, mimeType: record.mimeType, sha256 });
    window.selectedReceiptFiles = Array.from(input.files, file => ({ name: file.name, size: file.size, type: file.type }));
    previews.replaceChildren(...window.uploadReceipts.map(receipt => {
      const chip = document.createElement('span'); chip.textContent = receipt.name; chip.title = receipt.name;
      chip.setAttribute('data-testid', 'attachment-chip'); return chip;
    }));
    // A provider uploads then releases its local selection. Keep the measured
    // metadata, allowing sequential 512 MiB pages to release their File memory.
    input.value = ''; window.receiptReaders = [];
  };
  send.addEventListener('click', () => {
    const text = editor.textContent;
    if (!text.trim()) return;
    window.fixtureSends.push(text);
    const turn = document.createElement('article'), body = document.createElement('div');
    turn.setAttribute('data-testid', `conversation-turn-${turns.children.length + 1}`);
    body.setAttribute('data-message-author-role', 'user'); body.textContent = text;
    turn.append(body); turns.append(turn); editor.textContent = '';
    stop.hidden = false; send.hidden = true;
  });
  stop.addEventListener('click', () => { stop.hidden = true; send.hidden = false; });
}

function fixtureHtml() {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:0;padding:14px;color:white;background:#111528;font:14px sans-serif}
    form{position:fixed;bottom:10px;left:10px;right:10px;border:1px solid #648ba0;padding:12px;background:#182738}
    [contenteditable]{padding:8px;min-height:35px;border:1px solid #728c97}
    #previews{padding:10px}input[type=file]{display:none}[hidden]{display:none}
  </style></head><body><header><h2>Normal chat</h2><button type="button">Temporary chat</button><button type="button" aria-pressed="false">Work</button></header>
  <main><div id="turns"></div><form><div id="prompt-textarea" class="ProseMirror" role="textbox" contenteditable="true" data-placeholder="Ask ChatGPT"></div>
  <input id="fileInput" type="file" multiple aria-label="Attach files"><div id="previews"></div>
  <button id="send" type="button" data-testid="send-button" aria-label="Send prompt">Send</button>
  <button id="stopFixture" type="button" data-testid="stop-button" aria-label="Stop generating" hidden>Stop generating</button></form></main>
  <script>(${streamingFixtureBehavior.toString()})(${RECEIPT_CHUNK_BYTES});</script></body></html>`;
}

module.exports = { writeLargePdf, fixtureHtml, RECEIPT_CHUNK_BYTES };
