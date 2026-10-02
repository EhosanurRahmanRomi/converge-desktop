'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto, createHash } = require('node:crypto');
const { createBridge } = require('../content');
const archives = require('../../test/fixtures/archive-bytes.json');

// A small page fixture drives the real reply capture and export APIs. Link
// eligibility is not reimplemented in this fixture.
class Element {
  constructor(tagName, text = '', attributes = {}) {
    Object.assign(this, { tagName, innerText: text, textContent: text, attributes,
      isConnected: true, disabled: false, hidden: false, children: [] });
  }
  getAttribute(name) { return this.attributes[name] ?? null; }
  getClientRects() { return [1]; }
  closest(selector) {
    if (selector === 'form') return this.form || null;
    for (let node = this; node; node = node.parentElement) {
      if (selector.includes('chatgpt-library-file-citation') && node.attributes['data-testid'] === 'chatgpt-library-file-citation' ||
          selector.includes('[data-file-reference]') && node.attributes['data-file-reference'] !== undefined) return node;
    }
    return null;
  }
  contains(child) { return this.children.includes(child); }
  matches(selector) { return selector.includes('data-message-author-role="assistant"') && this.attributes['data-message-author-role'] === 'assistant'; }
  querySelectorAll(selector) {
    const selectors = selector.split(',').map((part) => part.trim());
    return this.children.filter((child) => selectors.some((part) => part === 'a' && child.tagName === 'A' ||
      part === 'button' && child.tagName === 'BUTTON' || part === '[role="button"]' && child.getAttribute('role') === 'button'));
  }
  focus() {}
  dispatchEvent() { return true; }
  click() { this.onclick?.(); }
}
class TextArea extends Element {
  constructor() { super('TEXTAREA'); this._value = ''; }
  get value() { return this._value; }
  set value(value) { this._value = value; }
}
function anchor(text, href, attributes = {}) {
  const result = new Element('A', text, { href, ...attributes });
  result.href = href;
  return result;
}
function button(text, attributes = {}) { return new Element('BUTTON', text, attributes); }
function fixture(links, { fileBytes, previousLinks = [], mimeType = 'application/pdf' } = {}) {
  const messages = [], turns = [], downloads = [], fetches = [];
  if (previousLinks.length) {
    const previous = new Element('DIV', 'A previous response, outside this request.', { 'data-message-author-role': 'assistant' });
    previous.children = previousLinks;
    turns.push(previous);
  }
  const composer = new TextArea();
  const send = new Element('BUTTON', '', { 'data-testid': 'send-button' });
  const form = { querySelectorAll: (selector) => selector.includes('send-button') ? [send] : [] };
  composer.form = form;
  send.onclick = () => {
    turns.push(new Element('DIV', composer.value, { 'data-message-author-role': 'user' }));
    composer.value = '';
    const reply = new Element('DIV', 'The corrected document is attached.', { 'data-message-author-role': 'assistant' });
    reply.children = links;
    turns.push(reply);
  };
  const bytes = fileBytes || Buffer.from('%PDF-1.4\nExact corrected document\n%%EOF');
  const window = { location: { href: 'https://chatgpt.com/' }, HTMLTextAreaElement: TextArea, crypto: webcrypto,
    InputEvent: class {}, getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    atob: (value) => Buffer.from(value, 'base64').toString('binary'), btoa: (value) => Buffer.from(value, 'binary').toString('base64'),
    async fetch(href, options) {
      fetches.push({ href, options });
      let read = false;
      return { ok: true, type: 'basic', headers: { get: (name) => name === 'content-type' ? mimeType : null },
        body: { getReader: () => ({ async read() { if (read) return { done: true }; read = true; return { done: false, value: new Uint8Array(bytes) }; } }) } };
    },
  };
  const document = { body: {}, querySelectorAll(selector) {
    if (selector.includes('#prompt-textarea')) return [composer];
    if (selector.includes('send-button')) return [send];
    const user = selector.includes('data-message-author-role="user"');
    const assistant = selector.includes('data-message-author-role="assistant"');
    if (user || assistant) return turns.filter((turn) => user && turn.attributes['data-message-author-role'] === 'user' || assistant && turn.attributes['data-message-author-role'] === 'assistant');
    return [];
  } };
  const bridge = createBridge({ window, document,
    chrome: { runtime: { onMessage: { addListener() {} }, sendMessage: async (message) => { messages.push(message); return { ok: true }; } } },
    async downloadVisible(payload) { downloads.push(payload); return { ok: true, mimeType: payload.mimeType, base64: bytes.toString('base64') }; },
    options: { settleMs: 10, tickMs: 2, sendSettleMs: 5, replyTimeoutMs: 1000 },
  });
  return { bridge, messages, downloads, fetches, bytes };
}
async function capture(page, id, expectedType = 'REPLY') {
  const request = { runId: id, requestId: `${id}-request`, text: 'Create a corrected document.', relayMedia: true, chatMode: 'normal' };
  await new Promise((resolve) => page.bridge.onMessage({ type: 'INSPECT', chatMode: 'normal' }, null, resolve));
  assert.equal((await page.bridge.sendPrompt(request)).ok, true);
  const deadline = Date.now() + 1200;
  while (Date.now() < deadline) {
    const reply = page.messages.find((message) => ['REPLY', 'ERROR'].includes(message.type));
    if (reply) { assert.equal(reply.type, expectedType, reply.error); return { request, reply }; }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('The bridge did not capture the fixture reply.');
}

test('a Download corrected PDF label captures its actual sandbox filename and native bytes', async () => {
  const link = anchor('Download corrected PDF', 'sandbox:/mnt/data/corrected.pdf');
  const page = fixture([link]);
  const { request, reply } = await capture(page, 'sandbox-download-label');
  assert.deepEqual(reply.media.map(({ name, mimeType }) => ({ name, mimeType })), [{ name: 'corrected.pdf', mimeType: 'application/pdf' }]);
  const exported = await page.bridge.exportMedia({ ...request, ids: reply.media.map((file) => file.id) });
  assert.equal(exported.ok, true, exported.error);
  assert.equal(page.downloads.length, 1);
  assert.equal(page.downloads[0].element, link);
  assert.deepEqual(Buffer.from(exported.files[0].base64, 'base64'), page.bytes);
  assert.equal(exported.files[0].contentSha256, createHash('sha256').update(page.bytes).digest('hex'));
  assert.equal(exported.files[0].byteLength, page.bytes.length);
  assert.equal(reply.media[0].contentSha256, undefined, 'DOM capture cannot claim a file byte hash before export.');
  const cached = await page.bridge.exportMedia({ ...request, ids: ['media-1'] });
  assert.deepEqual(cached.files, exported.files);
  assert.equal(page.downloads.length, 1, 'Byte identity must survive cache reuse without another download.');
  assert.equal(page.fetches.length, 0);
});

test('renaming or re-exposing identical PDF bytes retains their content identity; a real byte revision changes it', async () => {
  const original = Buffer.from('%PDF-1.4\nThe original reviewed answer\n%%EOF');
  const corrected = Buffer.from('%PDF-1.4\nThe corrected reviewed answer\n%%EOF');
  const results = [];
  for (const [name, bytes] of [['candidate.pdf', original], ['candidate(7).pdf', original], ['candidate.pdf', corrected]]) {
    const page = fixture([anchor(name, `sandbox:/mnt/data/${name}`)], { fileBytes: bytes });
    const { request } = await capture(page, `byte-identity-${results.length}`);
    const result = await page.bridge.exportMedia({ ...request, ids: ['media-1'] });
    assert.equal(result.ok, true, result.error);
    results.push(result.files[0]);
  }
  assert.notEqual(results[0].name, results[1].name);
  assert.notEqual(results[0].fingerprint, results[1].fingerprint);
  assert.equal(results[0].contentSha256, results[1].contentSha256, 'Different public file names must not count as changed contents.');
  assert.equal(results[0].byteLength, results[1].byteLength);
  assert.notEqual(results[0].contentSha256, results[2].contentSha256);
  for (const file of results) assert.equal(file.contentSha256, createHash('sha256').update(Buffer.from(file.base64, 'base64')).digest('hex'));
});

test('Save actions use the decoded captured href filename rather than their descriptive label', async () => {
  const href = 'https://chatgpt.com/files/corrected%20report.pdf?download=1';
  const page = fixture([anchor('Save corrected report', href)]);
  const { request, reply } = await capture(page, 'save-label');
  assert.equal(reply.media.length, 1);
  assert.equal(reply.media[0].name, 'corrected report.pdf');
  const exported = await page.bridge.exportMedia({ ...request, ids: ['media-1'] });
  assert.equal(exported.ok, true, exported.error);
  assert.equal(page.fetches[0].href, href);
  assert.deepEqual(Buffer.from(exported.files[0].base64, 'base64'), page.bytes);
});

test('plain web PDF filename citations and generic read links never become generated outputs', async () => {
  const page = fixture([
    anchor('paper.pdf', 'https://example.com/paper.pdf'),
    anchor('Downloadable paper.pdf', 'https://example.com/paper.pdf'),
    anchor('Read corrected PDF', 'https://chatgpt.com/files/corrected.pdf'),
    anchor('report.pdf', 'https://chatgpt.com/files/report.pdf'),
  ]);
  const { reply } = await capture(page, 'citations');
  assert.deepEqual(reply.media, []);
  assert.equal(page.downloads.length, 0);
  assert.equal(page.fetches.length, 0);
});

test('named sandbox and blob artifacts remain eligible without a download attribute', async () => {
  const page = fixture([
    anchor('corrected.pdf', 'sandbox:/mnt/data/corrected.pdf'),
    anchor('review.pdf', 'blob:https://chatgpt.com/47f78b18-df48-483d-bce8-dca0f74308a2'),
  ]);
  const { reply } = await capture(page, 'local-named');
  assert.deepEqual(reply.media.map((file) => file.name), ['corrected.pdf', 'review.pdf']);
});

test('an explicit download attribute identifies a web artifact even with a descriptive label', async () => {
  const page = fixture([anchor('Your corrected PDF', 'https://files.example.com/results/abc', { download: 'corrected.pdf' })]);
  const { reply } = await capture(page, 'download-attribute');
  assert.equal(reply.media.length, 1);
  assert.equal(reply.media[0].name, 'corrected.pdf');
});

test('Download words alone cannot invent a supported file or enable arbitrary JavaScript links', async () => {
  const page = fixture([
    anchor('Download corrected.pdf', 'javascript:window.fetch("https://example.com/secret")'),
    anchor('Download research.pdf', 'https://example.com/research.pdf'),
  ]);
  const { reply } = await capture(page, 'unsupported-downloads');
  assert.deepEqual(reply.media, []);
  assert.equal(page.downloads.length, 0);
});

test('the actual named MQ5 sandbox download is captured with its original name and exact text bytes', async () => {
  const name = 'NovaTrail_RiskControlled_v2.mq5';
  const bytes = Buffer.from('#property strict\nvoid OnTick() { /* source remains unchanged during transfer */ }\n');
  const link = anchor(`Download ${name}`, `sandbox:/mnt/data/${name}`, { role: 'button' });
  const page = fixture([link], { fileBytes: bytes });
  const { request, reply } = await capture(page, 'mq5-sandbox-source');
  assert.deepEqual(reply.media.map(({ name, mimeType }) => ({ name, mimeType })), [{ name, mimeType: 'text/plain' }]);
  const exported = await page.bridge.exportMedia({ ...request, ids: ['media-1'] });
  assert.equal(exported.ok, true, exported.error);
  assert.equal(exported.files[0].name, name);
  assert.deepEqual(Buffer.from(exported.files[0].base64, 'base64'), bytes);
  assert.equal(exported.files[0].contentSha256, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(page.downloads[0].element, link);
  assert.equal(page.fetches.length, 0);
});

test('named native source buttons transfer exactly one current artifact and exclude original citations and old replies', async () => {
  const old = button('Download previous.mq5');
  const cited = button('Download original.mq5', { 'data-testid': 'chatgpt-library-file-citation' });
  const inline = button('Download original.mq5', { 'data-file-reference': 'true' });
  const current = button('Download improved.mq5', { 'aria-label': 'Download improved.mq5' });
  const bytes = Buffer.from('void OnTick() { Print("verified candidate"); }');
  const page = fixture([cited, inline, current], { fileBytes: bytes, previousLinks: [old] });
  const { request, reply } = await capture(page, 'mq5-native-source');
  assert.deepEqual(reply.media.map(({ name, mimeType }) => ({ name, mimeType })), [{ name: 'improved.mq5', mimeType: 'text/plain' }]);
  const exported = await page.bridge.exportMedia({ ...request, ids: ['media-1'] });
  assert.equal(exported.ok, true, exported.error);
  assert.equal(page.downloads.length, 1);
  assert.equal(page.downloads[0].element, current);
  assert.deepEqual(Buffer.from(exported.files[0].base64, 'base64'), bytes);
  assert.equal(exported.files[0].contentSha256, createHash('sha256').update(bytes).digest('hex'));
});

test('a named native source button is rejected if its exact filename changes before export', async () => {
  const control = button('Download improved.mq5');
  const page = fixture([control]);
  const { request } = await capture(page, 'mq5-native-changed');
  control.innerText = control.textContent = 'Download different.mq5';
  const exported = await page.bridge.exportMedia({ ...request, ids: ['media-1'] });
  assert.equal(exported.ok, false);
  assert.match(exported.error, /changed/);
  assert.equal(page.downloads.length, 0);
});

test('explicit text-source extensions preserve their filename and MIME rather than disappearing', async () => {
  for (const extension of ['mqh', 'mq4', 'py', 'mjs', 'cpp', 'ps1', 'swift', 'cfg']) {
    const name = `candidate.${extension}`;
    const page = fixture([anchor(`Download ${name}`, `sandbox:/mnt/data/${name}`)]);
    const { reply } = await capture(page, `text-source-${extension}`);
    assert.deepEqual(reply.media.map(({ name, mimeType }) => ({ name, mimeType })), [{ name, mimeType: 'text/plain' }]);
  }
});

test('opaque native action links use the exact download label without retaining the Download prefix', async () => {
  const link = anchor('Download complete.mqh', '#');
  const page = fixture([link]);
  const { request, reply } = await capture(page, 'mqh-native-hash-action');
  assert.equal(reply.media[0].name, 'complete.mqh');
  const exported = await page.bridge.exportMedia({ ...request, ids: ['media-1'] });
  assert.equal(exported.ok, true, exported.error);
  assert.equal(page.downloads[0].element, link);
});

test('unsupported generated sandbox links, named buttons and local download actions fail clearly without fake media', async () => {
  const controls = [
    anchor('Download complete.exe', 'sandbox:/mnt/data/complete.exe'),
    button('Download complete.exe'),
    anchor('Download complete.exe', '#'),
    anchor('Download completed file', 'https://chatgpt.com/files/opaque-id'),
    anchor('Download corrected PDF', 'https://chatgpt.com/files/%ZZ.pdf'),
  ];
  for (const [index, control] of controls.entries()) {
    const page = fixture([control]);
    const { reply } = await capture(page, `unsupported-generated-${index}`, 'ERROR');
    assert.match(reply.error, /generated download.*cannot be shared safely/i);
    assert.match(reply.error, /supported.*plain-text source/i);
    assert.equal(reply.media, undefined);
    assert.equal(page.messages.some((message) => message.type === 'REPLY'), false);
    assert.equal(page.downloads.length, 0);
    assert.equal(page.fetches.length, 0);
  }
});

test('a direct fetched MQ5 output with binary controls or invalid Unicode is rejected without seeding an export snapshot', async () => {
  for (const bytes of [Buffer.from('MZ\0\u0002not readable source'), Buffer.from([0xff, 0xff, 0xc0, 0xaf])]) {
    const page = fixture([anchor('Download candidate.mq5', 'https://chatgpt.com/files/candidate.mq5')], { fileBytes: bytes, mimeType: 'text/plain' });
    const { request, reply } = await capture(page, `binary-source-${bytes[0]}`);
    assert.equal(reply.media[0].mimeType, 'text/plain');
    const result = await page.bridge.exportMedia({ ...request, ids: ['media-1'] });
    assert.equal(result.ok, false);
    assert.match(result.error, /binary data|not readable Unicode text/i);
    assert.equal(result.files, undefined);
    const repeated = await page.bridge.exportMedia({ ...request, ids: ['media-1'] });
    assert.equal(repeated.ok, false);
    assert.equal(page.fetches.length, 2, 'Rejected binary bytes cannot seed a reusable candidate snapshot.');
    assert.equal(page.downloads.length, 0);
  }
});

test('UTF-8 and BOM-marked UTF-16 source exports retain the exact original bytes and hash', async () => {
  const text = '#property strict\nvoid OnTick() { Print("source é Ω"); }\n';
  const littleEndian = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
  const bigEndian = Buffer.from(littleEndian);
  for (let offset = 0; offset < bigEndian.length; offset += 2) {
    const byte = bigEndian[offset];bigEndian[offset] = bigEndian[offset + 1];bigEndian[offset + 1] = byte;
  }
  for (const [index, bytes] of [Buffer.from(text), littleEndian, bigEndian].entries()) {
    for (const native of [false, true]) {
      const control = native ? button('Download candidate.mq5') : anchor('Download candidate.mq5', 'https://chatgpt.com/files/candidate.mq5');
      const page = fixture([control], { fileBytes: bytes, mimeType: 'text/plain' });
      const { request } = await capture(page, `readable-source-${index}-${native}`);
      const result = await page.bridge.exportMedia({ ...request, ids: ['media-1'] });
      assert.equal(result.ok, true, result.error);
      assert.deepEqual(Buffer.from(result.files[0].base64, 'base64'), bytes);
      assert.equal(result.files[0].contentSha256, createHash('sha256').update(bytes).digest('hex'));
      assert.equal(result.files[0].byteLength, bytes.length);
    }
  }
});

function inlineDownload(name, attributes = {}) {
  return new Element('SPAN', `Download ${name}`, {
    'data-file-reference': 'true', 'data-markdown-copy-text': name, role: 'button',
    tabindex: '0', 'aria-busy': 'false', 'data-inline-mention-interactive': '',
    'aria-label': `Download ${name}`, 'data-state': 'closed', ...attributes,
  });
}

test('the captured live inline MQ5 download span is transferred as exact source bytes rather than discarded as a preview citation', async () => {
  const name = 'NovaTrail_MTF_Scalper_RiskControlled.mq5';
  const control = inlineDownload(name);
  const bytes = Buffer.from('#property strict\nvoid OnTick() { Print("captured inline download"); }\n');
  const page = fixture([control], { fileBytes: bytes });
  const { request, reply } = await capture(page, 'captured-live-inline-mq5');
  assert.deepEqual(reply.media.map(({ name, mimeType }) => ({ name, mimeType })), [{ name, mimeType: 'text/plain' }]);
  const result = await page.bridge.exportMedia({ ...request, ids: ['media-1'] });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.files[0].name, name);
  assert.deepEqual(Buffer.from(result.files[0].base64, 'base64'), bytes);
  assert.equal(result.files[0].contentSha256, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(page.downloads.length, 1);
  assert.equal(page.downloads[0].element, control);
});

test('inline source previews, library citations, mismatched metadata and downloads inside a library ancestor are excluded', async () => {
  const name = 'candidate.mq5';
  const preview = inlineDownload(name, { 'aria-label': `Open preview of ${name}` });
  const library = inlineDownload(name, { 'data-testid': 'chatgpt-library-file-citation' });
  const mismatch = inlineDownload(name, { 'data-markdown-copy-text': 'original.mq5' });
  const nested = inlineDownload(name);
  nested.parentElement = new Element('DIV', '', { 'data-testid': 'chatgpt-library-file-citation' });
  const previous = inlineDownload('previous.mq5');
  const page = fixture([preview, library, mismatch, nested], { previousLinks: [previous] });
  const { reply } = await capture(page, 'excluded-inline-mq5');
  assert.deepEqual(reply.media, []);
  assert.equal(page.downloads.length, 0);
  assert.equal(page.fetches.length, 0);
});

test('inline download metadata must still identify the exact captured file immediately before export', async () => {
  for (const mutation of ['copy-name', 'file-reference', 'file-reference-removed', 'label', 'library-ancestor']) {
    const control = inlineDownload('candidate.mq5');
    const page = fixture([control]);
    const { request } = await capture(page, `inline-mq5-revalidation-${mutation}`);
    if (mutation === 'copy-name') control.attributes['data-markdown-copy-text'] = 'different.mq5';
    if (mutation === 'file-reference') control.attributes['data-file-reference'] = 'false';
    if (mutation === 'file-reference-removed') delete control.attributes['data-file-reference'];
    if (mutation === 'label') control.attributes['aria-label'] = 'Download different.mq5';
    if (mutation === 'library-ancestor') control.parentElement = new Element('DIV', '', { 'data-testid': 'chatgpt-library-file-citation' });
    const result = await page.bridge.exportMedia({ ...request, ids: ['media-1'] });
    assert.equal(result.ok, false);
    assert.match(result.error, /changed/);
    assert.equal(page.downloads.length, 0);
  }
});

test('an actual inline ZIP package transfers all its exact opaque bytes while a preview remains a citation', async () => {
  const bytes = Buffer.from(archives.packageBase64, 'base64');
  const page = fixture([inlineDownload('candidate.zip')], { fileBytes: bytes });
  const { request, reply } = await capture(page, 'inline-generated-zip');
  assert.deepEqual(reply.media.map(({name, mimeType}) => ({name, mimeType})), [{name:'candidate.zip', mimeType:'application/zip'}]);
  const exported = await page.bridge.exportMedia({ ...request, ids: ['media-1'] });
  assert.equal(exported.ok, true, exported.error);
  assert.equal(exported.files[0].name, 'candidate.zip');
  assert.deepEqual(Buffer.from(exported.files[0].base64, 'base64'), bytes);
  assert.equal(exported.files[0].contentSha256, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(page.downloads.length, 1);
  const preview = fixture([inlineDownload('candidate.zip', { 'aria-label': 'Open preview of candidate.zip' })]);
  const retained = await capture(preview, 'inline-unsupported-zip-preview');
  assert.deepEqual(retained.reply.media, []);
  assert.equal(preview.downloads.length, 0);
});

test('ZIP exports accept native, direct, empty and commented containers without altering their names or bytes', async () => {
  for (const [index, key] of ['packageBase64', 'commentBase64', 'emptyBase64'].entries()) {
    const bytes = Buffer.from(archives[key], 'base64');
    for (const native of [false, true]) {
      const name = 'NovaTrail_MTF_Safe_Package.zip';
      const control = native ? button(`Download ${name}`) : anchor(`Download ${name}`, `https://chatgpt.com/files/${name}`);
      const page = fixture([control], {fileBytes:bytes, mimeType:'application/x-zip-compressed'});
      const {request} = await capture(page, `zip-export-${index}-${native}`);
      const exported = await page.bridge.exportMedia({...request, ids:['media-1']});
      assert.equal(exported.ok, true, exported.error);
      assert.equal(exported.files[0].name, name);
      assert.equal(exported.files[0].mimeType, 'application/zip');
      assert.deepEqual(Buffer.from(exported.files[0].base64, 'base64'), bytes);
      assert.equal(exported.files[0].contentSha256, createHash('sha256').update(bytes).digest('hex'));
      assert.equal(page.downloads.length, native ? 1 : 0);
    }
  }
});

test('malformed ZIP bytes cannot seed a reusable browser export snapshot', async () => {
  const good = Buffer.from(archives.packageBase64, 'base64');
  const end = good.length - 22, directory = good.readUInt32LE(end + 16);
  const brokenCentral = Buffer.from(good); brokenCentral[directory + 46 + 12] = 0;
  const brokenLocal = Buffer.from(good); brokenLocal.writeUInt32LE(directory, directory + 42);
  const multipart = Buffer.from(good); multipart.writeUInt16LE(1, end + 4);
  const zip64 = Buffer.from(good); zip64.writeUInt16LE(0xffff, end + 10);
  for (const [index, bytes] of [Buffer.from('MZ fake ZIP'), Buffer.from('PK\x03\x04'), good.subarray(0,-1),
      brokenCentral, brokenLocal, multipart, zip64].entries()) {
    const page = fixture([anchor('Download package.zip', 'https://chatgpt.com/files/package.zip')], {fileBytes:bytes, mimeType:'application/zip'});
    const {request} = await capture(page, `bad-zip-${index}`);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const exported = await page.bridge.exportMedia({...request, ids:['media-1']});
      assert.equal(exported.ok, false);
      assert.match(exported.error, /ZIP file is malformed/);
      assert.equal(exported.files, undefined);
    }
    assert.equal(page.fetches.length, 2);
  }
});

test('MT5 settings downloads retain canonical .set names and original UTF-8 or BOM UTF-16 bytes', async () => {
  const text = 'Lots=0.01\r\nMaxRiskMoney=20.0\r\n';
  const little = Buffer.concat([Buffer.from([0xff,0xfe]), Buffer.from(text,'utf16le')]);
  const big = Buffer.from(little); for(let i=0;i<big.length;i+=2) [big[i],big[i+1]]=[big[i+1],big[i]];
  for (const [index, bytes] of [Buffer.from(text), little, big].entries()) {
    const name = 'NovaTrail_safe_defaults.set';
    const page = fixture([inlineDownload(name)], {fileBytes:bytes});
    const {request,reply} = await capture(page, `set-export-${index}`);
    assert.equal(reply.media[0].mimeType, 'text/plain');
    const exported = await page.bridge.exportMedia({...request, ids:['media-1']});
    assert.equal(exported.ok,true,exported.error);
    assert.equal(exported.files[0].name,name);
    assert.deepEqual(Buffer.from(exported.files[0].base64,'base64'),bytes);
  }
});

test('binary .set data and a generated executable companion fail without pretending to relay it', async () => {
  const page = fixture([inlineDownload('defaults.set')], {fileBytes:Buffer.from([0x4d,0x5a,0,1])});
  const {request} = await capture(page, 'binary-set');
  const exported = await page.bridge.exportMedia({...request,ids:['media-1']});
  assert.equal(exported.ok,false); assert.match(exported.error,/binary data/);
  const mixed = fixture([inlineDownload('candidate.mq5'), inlineDownload('package.zip'), inlineDownload('candidate.exe')]);
  const rejected = await capture(mixed, 'unsupported-companion', 'ERROR');
  assert.match(rejected.reply.error,/candidate\.exe/);
  assert.equal(mixed.downloads.length,0);
});
