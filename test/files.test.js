'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { MIME, TEXT_SOURCE_EXTENSIONS, safeFilename, validateExport, validateTextSource, MAX_FILE_BYTES } = require('../src/browser/files');
const archives = require('./fixtures/archive-bytes.json');

const descriptor = { id: 'pdf-1', name: 'corrected.pdf', mimeType: 'application/pdf', fingerprint: 'dom:1234' };
const media = { side: 'left', runId: 'run-1', requestId: 'draft-1', files: [descriptor] };
const source = Buffer.from('%PDF-1.4\nreviewed document\n%%EOF\n');
const exported = () => ({ ok: true, files: [{ ...descriptor, base64: source.toString('base64') }] });

test('preserves exact PDF bytes when saving the reviewed candidate', () => {
  const [file] = validateExport(media, exported());
  assert.equal(file.name, 'corrected.pdf');
  assert.equal(file.mimeType, 'application/pdf');
  assert.deepEqual(file.bytes, source);
});

test('a boss-owned final file retains the same strict byte verification as worker files', () => {
  const digest = createHash('sha256').update(source).digest('hex');
  const verified = { ...descriptor, contentSha256: digest, byteLength: source.length };
  const boss = { ...media, side: 'boss', files: [verified] };
  const response = { ok: true, files: [{ ...verified, base64: source.toString('base64') }] };
  assert.deepEqual(validateExport(boss, response)[0].bytes, source);
  assert.throws(() => validateExport({ ...boss, side: 'other' }, response), /no supported/);
  assert.throws(() => validateExport(boss, { ok: true, files: [{ ...verified, base64: Buffer.from('%PDF-substituted').toString('base64') }] }), /contents changed/);
});

test('rejects stale, changed, missing and reordered candidate downloads', () => {
  for (const key of ['id', 'name', 'mimeType', 'fingerprint']) {
    const response = exported();
    response.files[0][key] += '-changed';
    assert.throws(() => validateExport(media, response), /changed/);
  }
  assert.throws(() => validateExport(media, { ok: true, files: [] }), /could not be read/);
  assert.throws(() => validateExport(media, { ok: false, error: 'File expired' }), /File expired/);
  const second = { ...descriptor, id: 'pdf-2', name: 'notes.pdf' };
  assert.throws(() => validateExport({ ...media, files: [descriptor, second] }, {
    ok: true, files: [{ ...second, base64: source.toString('base64') }, exported().files[0]],
  }), /changed/);
});

test('rejects corrupt or oversized binary payloads before a save dialog', () => {
  for (const base64 of ['', 'YQ', 'YQ==junk', 'Y!==', 'YQ=\n', 'YR==']) {
    assert.throws(() => validateExport(media, { ok: true, files: [{ ...descriptor, base64 }] }));
  }
  const oversized = Buffer.alloc(MAX_FILE_BYTES + 1).toString('base64');
  assert.throws(() => validateExport(media, { ok: true, files: [{ ...descriptor, base64: oversized }] }), /limit|exceeds/);
  const many = Array.from({ length: 3 }, (_, i) => ({ ...descriptor, id: `pdf-${i}` }));
  assert.throws(() => validateExport({ ...media, files: many }, { ok: true,
    files: many.map((file) => ({ ...file, base64: Buffer.alloc(9 * 1024 * 1024).toString('base64') })),
  }), /24 MB/);
});

test('generated filenames cannot become Windows paths or device files', () => {
  assert.equal(safeFilename('../../CON', 'application/pdf'), '.._.._CON.pdf');
  assert.equal(safeFilename('CON.pdf', 'application/pdf'), 'result-CON.pdf');
  assert.equal(safeFilename('LPT9', 'application/pdf'), 'result-LPT9.pdf');
  assert.equal(safeFilename('result.exe', 'application/pdf'), 'result.exe.pdf');
  assert.equal(safeFilename('..', 'application/pdf'), 'converge-result.pdf');
});

test('saving a byte-verified candidate recomputes its identity and rejects substituted contents', () => {
  const digest = createHash('sha256').update(source).digest('hex');
  const verified = { ...descriptor, contentSha256: digest, byteLength: source.length };
  const candidate = { ...media, files: [verified] };
  const response = { ok: true, files: [{ ...verified, base64: source.toString('base64') }] };
  assert.deepEqual(validateExport(candidate, response)[0].bytes, source);
  const changed = Buffer.from(source);
  changed[12] ^= 1;
  assert.throws(() => validateExport(candidate, { ok: true, files: [{ ...response.files[0], base64: changed.toString('base64') }] }), /contents changed/);
  assert.throws(() => validateExport(candidate, exported()), /contents changed/);
  assert.throws(() => validateExport({ ...candidate, files: [{ ...verified, byteLength: source.length + 1 }] }, response), /contents changed/);
});

function textCandidate(name, bytes, mimeType = 'text/plain') {
  const file = { id: 'source-1', name, mimeType, fingerprint: 'dom:mq5',
    contentSha256: createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.length };
  return { candidate: { ...media, files: [file] },
    response: { ok: true, files: [{ ...file, base64: bytes.toString('base64') }] } };
}

test('byte-verified MQL5 source saves with its actual .mq5 name and cannot substitute reviewed bytes', () => {
  const bytes = Buffer.from('\ufeff#property strict\r\n// Reviewed source remains inert text.\r\nvoid OnTick() {}\r\n');
  const { candidate, response } = textCandidate('NovaTrail_RiskControlled_v2.mq5', bytes);
  const [file] = validateExport(candidate, response);
  assert.equal(file.name, 'NovaTrail_RiskControlled_v2.mq5');
  assert.equal(file.mimeType, 'text/plain');
  assert.deepEqual(file.bytes, bytes);
  const replacement = Buffer.from(bytes); replacement[replacement.length - 5] ^= 1;
  assert.throws(() => validateExport(candidate, { ok: true, files: [
    { ...response.files[0], base64: replacement.toString('base64') },
  ] }), /contents changed/);
  const renamed = { ...response.files[0], name: 'different.mq5' };
  assert.throws(() => validateExport(candidate, { ok: true, files: [renamed] }), /changed/);
});

test('explicit readable source formats keep their extensions while forged MIME cannot keep .mq5', () => {
  for (const extension of TEXT_SOURCE_EXTENSIONS) {
    assert.equal(MIME[extension], 'text/plain');
    assert.equal(safeFilename(`reviewed.${extension}`, 'text/plain'), `reviewed.${extension}`);
  }
  assert.equal(safeFilename('REVIEWED.MQ5', 'text/plain'), 'REVIEWED.MQ5');
  assert.equal(safeFilename('reviewed.mq5', 'image/png'), 'reviewed.mq5.png');
  const forged = textCandidate('reviewed.mq5', Buffer.from('void OnTick() {}'), 'image/png');
  assert.throws(() => validateExport(forged.candidate, forged.response), /type does not match/);
});

test('unknown binary extensions and binary bytes cannot masquerade as text source outputs', () => {
  for (const [name, mimeType, bytes] of [
    ['payload.exe', 'text/plain', Buffer.from('MZsource')],
    ['payload.bin', 'application/octet-stream', Buffer.from([0, 1, 2])],
    ['reviewed.mq5', 'text/plain', Buffer.from([0x4d, 0x5a, 0, 1, 2])],
    ['reviewed.mqh', 'text/plain', Buffer.from([0xff, 0x80, 0x81])],
  ]) {
    const fixture = textCandidate(name, bytes, mimeType);
    assert.throws(() => validateExport(fixture.candidate, fixture.response), /unsupported|binary|Unicode|changed/);
  }
});

test('BOM-marked UTF-16 MQL source is validated and saved without transcoding reviewed bytes', () => {
  const text = '// 日本語 and বাংলা\r\nvoid OnTick() {}\r\n';
  const little = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
  const big = Buffer.from(little); big.swap16();
  for (const bytes of [little, big]) {
    const fixture = textCandidate('reviewed.mq5', bytes);
    assert.deepEqual(validateExport(fixture.candidate, fixture.response)[0].bytes, bytes);
  }
});

test('opaque ZIP package exports preserve canonical names and every reviewed byte without extracting members', () => {
  assert.equal(MIME.zip, 'application/zip');
  for (const [key, name] of [['packageBase64', 'NovaTrail_MTF_Safe_Package.zip'], ['commentBase64', 'PACKAGE.ZIP'], ['emptyBase64', 'empty.zip']]) {
    const bytes = Buffer.from(archives[key], 'base64');
    const fixture = textCandidate(name, bytes, 'application/zip');
    const [file] = validateExport(fixture.candidate, fixture.response);
    assert.equal(file.name, name);
    assert.equal(file.mimeType, 'application/zip');
    assert.deepEqual(file.bytes, bytes);
    // This verifies container transport only, including the inert ../never-run.exe member.
    assert.doesNotThrow(() => validateTextSource(name, 'application/zip', bytes));
  }
});

test('ZIP filename and MIME cannot disguise an unknown executable or unrelated file', () => {
  const bytes = Buffer.from(archives.packageBase64, 'base64');
  for (const [name, mimeType] of [['package.zip', 'application/pdf'], ['payload.exe', 'application/zip'], ['package.txt', 'application/zip']]) {
    const fixture = textCandidate(name, bytes, mimeType);
    assert.throws(() => validateExport(fixture.candidate, fixture.response), /ZIP file type does not match/);
    assert.throws(() => validateTextSource(name, mimeType), /ZIP file type does not match/);
  }
});

test('ZIP validation rejects truncated, spoofed, multipart and unsupported ZIP64 containers before saving or uploading', () => {
  const original = Buffer.from(archives.packageBase64, 'base64');
  const end = original.length - 22;
  const directory = original.readUInt32LE(end + 16);
  const altered = (change) => { const bytes = Buffer.from(original); change(bytes); return bytes; };
  const invalid = [
    Buffer.from('MZ executable-looking data'), Buffer.from('PK\x03\x04'), original.subarray(0, -1),
    Buffer.concat([original, Buffer.from('unowned trailing data')]),
    altered(b => b.writeUInt16LE(1, end + 4)),
    altered(b => b.writeUInt16LE(0xffff, end + 10)),
    altered(b => b.writeUInt32LE(0xffffffff, end + 12)),
    altered(b => b.writeUInt32LE(end, end + 16)),
    altered(b => b.writeUInt16LE(2, end + 8)),
    altered(b => b.writeUInt32LE(0xdeadbeef, directory)),
    altered(b => b.writeUInt16LE(1, directory + 34)),
    altered(b => b.writeUInt32LE(0xffffffff, directory + 20)),
    altered(b => b.writeUInt32LE(directory, directory + 42)),
    altered(b => b.writeUInt32LE(1, directory + 42)),
    altered(b => b.writeUInt16LE(0xffff, directory + 28)),
  ];
  for (const bytes of invalid) {
    const fixture = textCandidate('package.zip', bytes, 'application/zip');
    assert.throws(() => validateExport(fixture.candidate, fixture.response), /ZIP file is malformed/);
    assert.throws(() => validateTextSource('package.zip', 'application/zip', bytes), /ZIP file is malformed/);
  }
});

test('ZIP output identity and the existing per-file and aggregate byte limits stay enforced', () => {
  const bytes = Buffer.from(archives.packageBase64, 'base64');
  const fixture = textCandidate('package.zip', bytes, 'application/zip');
  const changed = Buffer.from(bytes); changed[40] ^= 1;
  assert.throws(() => validateExport(fixture.candidate, {ok:true, files:[{...fixture.response.files[0], base64:changed.toString('base64') }]}), /contents changed/);
  assert.throws(() => validateExport(fixture.candidate, {ok:true, files:[{...fixture.response.files[0], base64:Buffer.alloc(MAX_FILE_BYTES + 1).toString('base64') }]}), /12 MB|limit/);
  // Use a valid empty ZIP with inert padding before its terminal EOCD; no member is read.
  const large = Buffer.concat([Buffer.from(archives.emptyBase64, 'base64'), Buffer.alloc(9 * 1024 * 1024 - 44), Buffer.from(archives.emptyBase64, 'base64')]);
  const files = Array.from({length:3}, (_, index) => ({id:`zip-${index}`, name:`package-${index}.zip`, mimeType:'application/zip', fingerprint:`dom:${index}`}));
  assert.throws(() => validateExport({...media, files}, {ok:true, files:files.map(file => ({...file, base64:large.toString('base64')}))}), /24 MB/);
});

test('MT5 .set settings are readable inert text and retain UTF-8 or UTF-16 bytes and the canonical name', () => {
  const text = '; 日本語 and বাংলা\r\nRiskPercent=0.5\r\nMaxSlippagePoints=10\r\n';
  const little = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
  const big = Buffer.from(little); big.swap16();
  for (const bytes of [Buffer.from(text), little, big]) {
    const fixture = textCandidate('NovaTrail_safe_defaults.set', bytes);
    const [file] = validateExport(fixture.candidate, fixture.response);
    assert.equal(file.name, 'NovaTrail_safe_defaults.set');
    assert.equal(file.mimeType, 'text/plain');
    assert.deepEqual(file.bytes, bytes);
  }
  for (const [bytes, mimeType] of [[Buffer.from([0x4d,0x5a,0,1]), 'text/plain'], [Buffer.from('RiskPercent=1'), 'application/zip']]) {
    const fixture = textCandidate('defaults.set', bytes, mimeType);
    assert.throws(() => validateExport(fixture.candidate, fixture.response), /binary|does not match/);
  }
});

test('the actual EA, ZIP and settings companion bundle saves all three byte-verified outputs without substitution', () => {
  const outputs = [
    ['NovaTrail_MTF_Scalper_Safe.mq5', 'text/plain', Buffer.from('#property strict\r\nvoid OnTick() {}\r\n')],
    ['NovaTrail_MTF_Safe_Package.zip', 'application/zip', Buffer.from(archives.packageBase64, 'base64')],
    ['NovaTrail_safe_defaults.set', 'text/plain', Buffer.from('RiskPercent=0.5\r\n')],
  ];
  const records = outputs.map(([name,mimeType,bytes], index) => ({id:`companion-${index}`,name,mimeType,
    fingerprint:`dom:${index}`, contentSha256:createHash('sha256').update(bytes).digest('hex'), byteLength:bytes.length}));
  const candidate = {...media,files:records};
  const response = {ok:true,files:records.map((record,index) => ({...record,base64:outputs[index][2].toString('base64')}))};
  assert.deepEqual(validateExport(candidate,response).map(file => [file.name,file.mimeType,file.bytes]),outputs);
  assert.throws(() => validateExport(candidate,{...response,files:[response.files[1],response.files[0],response.files[2]]}),/candidate file changed/);
});
