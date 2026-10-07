'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { sendUpload, DIRECT_BASE64_LIMIT, FILE_CHUNK_LENGTH } = require('../src/browser/upload-transport');
const { MAX_FILE_BYTES, MAX_TOTAL_BYTES } = require('../src/browser/files');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createFileStore, getStoredFilePath } = require('../src/browser/file-store');

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const largeFile = () => ({ name: 'original.pdf', mimeType: 'application/pdf', base64: Buffer.alloc(4 * 1024 * 1024, 90).toString('base64') });
const message = (files = [largeFile()]) => ({ type: 'UPLOAD_FILES', runId: 'run-1', requestId: 'request-1', files });

test('small attachments and non-upload messages keep the direct page path', async () => {
  const messages = [
    { type: 'INSPECT', runId: 'run-1' },
    message([{ name: 'source.txt', mimeType: 'text/plain', base64: 'YQ==' }]),
    message([{ name: 'boundary.pdf', mimeType: 'application/pdf', base64: 'A'.repeat(DIRECT_BASE64_LIMIT) }]),
    { type: 'SEND_PROMPT', text: 'No attachment', files: [] },
  ];
  for (const original of messages) {
    let count = 0;
    const result = await sendUpload(async (side, sent) => {
      count += 1; assert.equal(side, 'left'); assert.equal(sent, original); return { ok: true, direct: true };
    }, 'left', original);
    assert.equal(count, 1); assert.equal(result.direct, true);
  }
});

test('a real 100 MB payload arrives exactly in sequential bounded IPC chunks and commits once', async () => {
  const bytes = Buffer.alloc(100 * 1024 * 1024, 90);
  Buffer.from('%PDF-1.7\n').copy(bytes);
  for (const index of [FILE_CHUNK_LENGTH / 4 * 3 - 1, Math.floor(bytes.length / 2), bytes.length - 1]) bytes[index] ^= 1;
  const base64 = bytes.toString('base64');
  const original = message([{ name: '100MB-reviewed.pdf', mimeType: 'application/pdf', base64 }]);
  const chunks = [];
  let transferId, offset = 0, active = 0, commits = 0;
  const receivedDigest = createHash('sha256');
  const result = await sendUpload(async (side, sent) => {
    assert.equal(side, 'boss'); assert.equal(++active, 1);
    await Promise.resolve();
    assert.ok(Buffer.byteLength(JSON.stringify(sent)) <= FILE_CHUNK_LENGTH + 1024, 'No large IPC message is allowed.');
    if (sent.type === 'FILE_STAGE_BEGIN') {
      transferId = sent.transferId;
      assert.match(transferId, /^[a-f0-9-]{36}$/);
      assert.equal(sent.runId, 'run-1'); assert.equal(sent.requestId, 'request-1');
      assert.deepEqual(sent.files, [{ name: '100MB-reviewed.pdf', mimeType: 'application/pdf', base64Length: base64.length, byteLength: bytes.length }]);
      assert.equal('base64' in sent.files[0], false);
    } else if (sent.type === 'FILE_STAGE_CHUNK') {
      assert.equal(sent.transferId, transferId); assert.equal(sent.fileIndex, 0); assert.equal(sent.offset, offset);
      assert.ok(sent.data.length <= FILE_CHUNK_LENGTH); assert.equal(sent.data.length % 4, 0);
      offset += sent.data.length; chunks.push(sent.data); receivedDigest.update(Buffer.from(sent.data, 'base64'));
    } else if (sent.type === 'FILE_STAGE_COMMIT') {
      commits += 1; assert.equal(sent.transferId, transferId); assert.equal(offset, base64.length);
      assert.equal('files' in sent, false); assert.equal(sent.runId, original.runId); assert.equal(sent.requestId, original.requestId);
    } else assert.fail(`Unexpected transfer operation: ${sent.type}`);
    active -= 1;
    return { ok: true, ...(sent.type === 'FILE_STAGE_COMMIT' ? { attached: 1 } : {}) };
  }, 'boss', original);
  assert.equal(result.attached, 1); assert.equal(commits, 1);
  assert.equal(chunks.join(''), base64); assert.equal(receivedDigest.digest('hex'), digest(bytes));
  assert.equal(original.files[0].base64, base64);
});

test('a large SEND_PROMPT stages its source aliases first and submits text only once', async () => {
  const file = { ...largeFile(), name: 'ORIGINAL_SOURCE_algorithm.mq5.txt', mimeType: 'text/plain' };
  const original = { ...message([file]), type: 'SEND_PROMPT', text: 'Review this exact source.',
    candidateId: 'C3', expectedSourceNames: ['prior-result.txt'] };
  const calls = [];
  const result = await sendUpload(async (side, sent) => {
    assert.equal(side, 'right'); calls.push(sent);
    return { ok: true, ...(sent.type === 'FILE_STAGE_COMMIT' ? { attached: 1 } : {}), ...(sent.type === 'SEND_PROMPT' ? { submitted: true } : {}) };
  }, 'right', original);
  assert.equal(result.submitted, true);
  const submit = calls.filter(sent => sent.type === 'SEND_PROMPT');
  assert.equal(submit.length, 1); assert.equal(calls.at(-1), submit[0]);
  assert.equal('files' in submit[0], false); assert.equal(submit[0].text, original.text);
  assert.equal(submit[0].candidateId, original.candidateId); assert.equal(submit[0].requestId, original.requestId);
  assert.deepEqual(submit[0].expectedSourceNames, ['prior-result.txt', file.name]);
  assert.deepEqual(original.expectedSourceNames, ['prior-result.txt']);
  assert.equal(calls.filter(sent => sent.type === 'FILE_STAGE_COMMIT').length, 1);
  assert.equal(calls.some(sent => sent.type === 'UPLOAD_FILES'), false);
});

test('file indices and offsets restart for every file without changing its name or bytes', async () => {
  const files = [largeFile(), { name: 'side-notes.txt', mimeType: 'text/plain', base64: Buffer.from('Notes\n').toString('base64') }];
  const reconstructed = ['', ''];
  let manifest;
  await sendUpload(async (_side, sent) => {
    if (sent.type === 'FILE_STAGE_BEGIN') manifest = sent.files;
    if (sent.type === 'FILE_STAGE_CHUNK') {
      assert.equal(sent.offset, reconstructed[sent.fileIndex].length);
      reconstructed[sent.fileIndex] += sent.data;
    }
    return { ok: true, ...(sent.type === 'FILE_STAGE_COMMIT' ? { attached: 2 } : {}) };
  }, 'left', message(files));
  assert.deepEqual(reconstructed, files.map(file => file.base64));
  assert.deepEqual(manifest.map(file => file.name), files.map(file => file.name));
});

test('a refused or lost chunk causes cleanup and never commits, submits or retries', async () => {
  for (const lost of [false, true]) {
    const calls = [];
    let count = 0;
    await assert.rejects(sendUpload(async (_side, sent) => {
      calls.push(sent);
      if (sent.type === 'FILE_STAGE_CHUNK' && ++count === 2) {
        if (lost) throw new Error('The page connection was interrupted.');
        return { ok: false, error: 'The transfer was canceled.' };
      }
      return { ok: true };
    }, 'left', { ...message(), type: 'SEND_PROMPT', text: 'Never submit after a failed chunk.' }), /interrupted|canceled/);
    assert.equal(calls.filter(sent => sent.type === 'FILE_STAGE_CHUNK').length, 2);
    assert.equal(calls.some(sent => ['FILE_STAGE_COMMIT', 'SEND_PROMPT', 'UPLOAD_FILES'].includes(sent.type)), false);
    assert.equal(calls.at(-1).type, 'FILE_STAGE_ABORT'); assert.equal(calls.at(-1).transferId, calls[0].transferId);
  }
});

test('lost BEGIN or failed COMMIT is cleaned up without an automatic repeat', async () => {
  for (const failure of ['FILE_STAGE_BEGIN', 'FILE_STAGE_COMMIT', 'unconfirmed']) {
    const calls = [];
    await assert.rejects(sendUpload(async (_side, sent) => {
      calls.push(sent);
      if (sent.type === failure) throw new Error('Acknowledgement was lost.');
      return { ok: true, ...(sent.type === 'FILE_STAGE_COMMIT' ? { attached: 0 } : {}) };
    }, 'left', { ...message(), type: 'SEND_PROMPT', text: 'Review the attached document.' }), /lost|every staged attachment/);
    assert.equal(calls.filter(sent => sent.type === 'FILE_STAGE_BEGIN').length, 1);
    assert.equal(calls.some(sent => sent.type === 'SEND_PROMPT'), false);
    assert.equal(calls.at(-1).type, 'FILE_STAGE_ABORT');
  }
});

test('Stop between chunk acknowledgements cancels staging and never submits a prompt', async () => {
  const controller = new AbortController();
  const calls = [];
  await assert.rejects(sendUpload(async (_side, sent) => {
    calls.push(sent);
    if (sent.type === 'FILE_STAGE_CHUNK') controller.abort('Stopped by the user.');
    return { ok: true };
  }, 'boss', { ...message(), type: 'SEND_PROMPT', text: 'Do not send after Stop.' }, { signal: controller.signal }), /Stopped by the user/);
  assert.deepEqual(calls.map(sent => sent.type), ['FILE_STAGE_BEGIN', 'FILE_STAGE_CHUNK', 'FILE_STAGE_ABORT']);
});

test('a canceled direct transfer never sends and a late small-file ACK cannot revive its transfer', async () => {
  const file = { name: 'source.txt', mimeType: 'text/plain', base64: 'YQ==' };
  for (const alreadyStopped of [true, false]) {
    const controller = new AbortController();
    let calls = 0;
    if (alreadyStopped) controller.abort('Stopped before direct upload.');
    await assert.rejects(sendUpload(async () => {
      calls += 1; controller.abort('Stopped while direct upload was waiting.'); return { ok: true, attached: 1 };
    }, 'left', message([file]), { signal: controller.signal }), /Stopped/);
    assert.equal(calls, alreadyStopped ? 0 : 1);
  }
});

test('a prompt acknowledgement failure does not submit the prompt a second time', async () => {
  const calls = [];
  await assert.rejects(sendUpload(async (_side, sent) => {
    calls.push(sent);
    if (sent.type === 'SEND_PROMPT') return { ok: false, error: 'Submission acknowledgement is uncertain.' };
    return { ok: true, ...(sent.type === 'FILE_STAGE_COMMIT' ? { attached: 1 } : {}) };
  }, 'left', { ...message(), type: 'SEND_PROMPT', text: 'Submit exactly once.' }), /uncertain/);
  assert.equal(calls.filter(sent => sent.type === 'SEND_PROMPT').length, 1);
  assert.equal(calls.filter(sent => sent.type === 'FILE_STAGE_COMMIT').length, 1);
});

test('malformed, oversized, conflicting and noncanonical payloads are rejected before staging', async () => {
  let calls = 0;
  const send = async () => { calls += 1; return { ok: true }; };
  const bad = ['', 'YQ', 'YR==', 'YQ==AAAA', 'AA?=', 'A===', 'AAA=\n'];
  for (const base64 of bad) await assert.rejects(sendUpload(send, 'left', message([{ name: 'source.pdf', mimeType: 'application/pdf', base64 }])), /Invalid|limit/);
  await assert.rejects(sendUpload(send, 'left', message([{ name: '../source.pdf', mimeType: 'application/pdf', base64: 'YQ==' }])), /name or type/);
  await assert.rejects(sendUpload(send, 'left', message([{ name: 'source.exe', mimeType: 'application/octet-stream', base64: 'YQ==' }])), /name or type/);
  const small = { name: 'source.pdf', mimeType: 'application/pdf', base64: 'YQ==' };
  await assert.rejects(sendUpload(send, 'left', message([small, small])), /name or type/);
  const stored = { name: 'source.pdf', mimeType: 'application/pdf', blobId: 'unregistered-boundary', contentSha256: 'a'.repeat(64), byteLength: MAX_FILE_BYTES + 1 };
  await assert.rejects(sendUpload(send, 'left', message([stored])), /limit/);
  await assert.rejects(sendUpload(send, 'left', message(Array.from({ length: 3 }, (_, i) => ({ ...stored, name: `file-${i}.pdf`, byteLength: MAX_FILE_BYTES })))), /limit/);
  await assert.rejects(sendUpload(send, 'left', message([{ ...stored, byteLength: 1 }])), /unavailable|identity/);
  assert.equal(calls, 0);
});

test('an owned disk source streams bounded chunks, verifies its digest, reports progress and commits without inline data', async t => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'converge-stream-transfer-'));
  const store = createFileStore({ directory: folder });
  t.after(async () => { await store.close(); await fs.rm(folder, { recursive: true, force: true }); });
  const file = await store.ingestStream((async function* () {
    for (let index = 0; index < 9; index += 1) yield Buffer.alloc(786432, 65 + index);
    yield Buffer.from('last chunk.');
  })(), { name: 'large.pdf', mimeType: 'application/pdf' });
  const received = createHash('sha256'), progress = [];
  let offset = 0, bytes = 0, commits = 0;
  await sendUpload(async (_side, sent) => {
    assert.equal(JSON.stringify(sent).includes(file.blobId), false, 'The page needs bytes, never host capabilities.');
    if (sent.type === 'FILE_STAGE_BEGIN') {
      assert.deepEqual(sent.files, [{ name: file.name, mimeType: file.mimeType, base64Length: Math.ceil(file.byteLength / 3) * 4,
        byteLength: file.byteLength, contentSha256: file.contentSha256 }]);
    } else if (sent.type === 'FILE_STAGE_CHUNK') {
      assert.equal(sent.offset, offset); assert.ok(sent.data.length <= FILE_CHUNK_LENGTH);
      const chunk = Buffer.from(sent.data, 'base64'); received.update(chunk); bytes += chunk.length; offset += sent.data.length;
    } else if (sent.type === 'FILE_STAGE_COMMIT') { commits += 1; assert.equal(bytes, file.byteLength); }
    else assert.fail(sent.type);
    return { ok: true, ...(sent.type === 'FILE_STAGE_COMMIT' ? { attached: 1 } : {}) };
  }, 'boss', message([file]), { onProgress: event => progress.push(event) });
  assert.equal(commits, 1); assert.equal(received.digest('hex'), file.contentSha256);
  assert.equal(progress[0].phase, 'staging'); assert.equal(progress.at(-1).phase, 'processing');
  assert.equal(progress.at(-1).processedBytes, file.byteLength); assert.equal(progress.at(-1).totalBytes, file.byteLength);
  assert.equal('base64' in file, false);
});

test('a damaged stored source cannot commit and Stop during its stream cannot send a late prompt', async t => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'converge-stream-cancel-'));
  const store = createFileStore({ directory: folder });
  t.after(async () => { await store.close(); await fs.rm(folder, { recursive: true, force: true }); });
  const file = await store.ingestStream((async function* () { yield Buffer.alloc(786432, 90); yield Buffer.alloc(786432, 90); })(), { name: 'source.pdf', mimeType: 'application/pdf' });
  const handle = await fs.open(getStoredFilePath(file), 'r+'); await handle.write(Buffer.from('X'), 0, 1, 12); await handle.close();
  const calls = [];
  await assert.rejects(sendUpload(async (_side, sent) => { calls.push(sent.type); return { ok: true }; }, 'left', message([file])), /changed/);
  assert.equal(calls.includes('FILE_STAGE_COMMIT'), false); assert.equal(calls.at(-1), 'FILE_STAGE_ABORT');
  const controller = new AbortController(); calls.length = 0;
  await assert.rejects(sendUpload(async (_side, sent) => {
    calls.push(sent.type); if (sent.type === 'FILE_STAGE_CHUNK') controller.abort('Stopped during stored source transfer.'); return { ok: true };
  }, 'right', { ...message([file]), type: 'SEND_PROMPT', text: 'Never send after Stop.' }, { signal: controller.signal }), /Stopped/);
  assert.deepEqual(calls, ['FILE_STAGE_BEGIN', 'FILE_STAGE_CHUNK', 'FILE_STAGE_ABORT']);
});

test('provider image limits reject worker files before staging and large spreadsheets report actionable advice', async t => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'converge-provider-transfer-'));
  const store = createFileStore({ directory: folder });
  t.after(async () => { await store.close(); await fs.rm(folder, { recursive: true, force: true }); });
  async function* bytes(length) {
    while (length > 0) { const size = Math.min(length, 786432); yield Buffer.alloc(size, 65); length -= size; }
  }
  const image = await store.ingestStream(bytes(20 * 1024 * 1024 + 1), { name: 'generated.png', mimeType: 'image/png' });
  const calls = [], progress = [];
  const send = async (_side, sent) => { calls.push(sent.type); return { ok: false, error: 'The fixture page refuses this upload.' }; };
  await assert.rejects(sendUpload(send, 'right', message([image])), /generated\.png.*images up to 20 MB/);
  assert.deepEqual(calls, [], 'Oversized images must not start a transfer to a worker.');
  const sheet = await store.ingestStream(bytes(50 * 1024 * 1024 + 1), { name: 'summary.csv', mimeType: 'text/csv' });
  await assert.rejects(sendUpload(send, 'boss', message([sheet]), { onProgress: event => progress.push(event) }), /fixture page refuses/);
  assert.deepEqual(calls, ['FILE_STAGE_BEGIN', 'FILE_STAGE_ABORT']);
  assert.equal(progress[0].fileName, 'summary.csv');
  assert.match(progress[0].warning, /spreadsheets.*50 MB.*Split this spreadsheet/);
});
