'use strict';

// Real production Electron shell, native picker IPC, three sandboxed browser
// views and the generated production preload. Only the provider page is an
// offline localhost fixture; no account, cookie export or remote model is used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { createHash } = require('node:crypto');
const { app, session } = require('electron');

const root = path.join(__dirname, '..');
const packagedAsar = process.env.CONVERGE_PACKAGED_ASAR && path.resolve(process.env.CONVERGE_PACKAGED_ASAR);
const productionRoot = packagedAsar || root;
if (packagedAsar) app.setAppPath(packagedAsar);
const packageVersion = JSON.parse(fs.readFileSync(path.join(productionRoot, 'package.json'), 'utf8')).version;
const { createCookieApp } = require(path.join(productionRoot, 'desktop-main.js'));
const profileRoot = fs.mkdtempSync(path.join(app.getPath('temp'), 'converge-large-upload-qa-'));
app.setPath('userData', profileRoot);
// Closing the last hidden fixture window must not let Electron quit before
// asynchronous production cleanup and the proof file have finished. This
// fixture calls app.quit explicitly after writing its complete report.
app.on('window-all-closed', () => {});
const evidenceRoot = path.join(root, '.live-test', 'large-upload');
const reportPath = process.env.CONVERGE_LARGE_UPLOAD_REPORT || path.join(evidenceRoot, packagedAsar ? 'packaged-result.json' : 'source-result.json');
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
const sourcePath = path.join(profileRoot, 'large-source-100MiB.pdf');
const targetBytes = 100 * 1024 * 1024;
const source = writeLargePdf(sourcePath, targetBytes);
const tests = [];
const messages = [];
const blockedRemoteOrigins = new Set();
const wire = Object.fromEntries(['left', 'right', 'boss'].map(side => [side, { begins: 0, chunks: 0, commits: 0, maxChunkLength: 0, maxWireBytes: 0, receivedCharacters: 0 }]));
let desktop, fixture, openDialogs = 0, completed = false;
const startedAt = Date.now();
const watchdog = setTimeout(() => fail(new Error('The 100 MB production upload QA exceeded its three minute deadline.')), 180_000);

function writeLargePdf(filename, bytes) {
  // The single page contains a valid whitespace content stream. Build it in
  // bounded disk writes rather than retaining another 100 MB fixture buffer.
  function structure(length) {
    const parts = ['%PDF-1.7\n'];
    const offsets = [0];
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
    const prefix = Buffer.from(parts.join(''));
    const streamEnd = '\nendstream\nendobj\n';
    const xref = prefix.length + length + Buffer.byteLength(streamEnd);
    const suffix = Buffer.from(`${streamEnd}xref\n0 5\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    return { prefix, suffix };
  }
  let streamLength = bytes - 1024, pieces;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    pieces = structure(streamLength);
    const difference = bytes - pieces.prefix.length - streamLength - pieces.suffix.length;
    if (!difference) break;
    streamLength += difference;
  }
  assert.equal(pieces.prefix.length + streamLength + pieces.suffix.length, bytes);
  const handle = fs.openSync(filename, 'wx');
  const hash = createHash('sha256');
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

function fixtureBehavior() {
  const input = document.getElementById('fileInput');
  const previews = document.getElementById('previews');
  window.uploadReceipts = [];
  window.uploadErrors = [];
  window.uploadChangeCount = 0;
  input.addEventListener('change', async () => {
    window.uploadChangeCount += 1;
    const processing = document.createElement('div');
    processing.setAttribute('role', 'progressbar'); processing.textContent = 'Uploading attachment';
    previews.replaceChildren(processing);
    try {
      for (const file of input.files) {
        const bytes = await file.arrayBuffer();
        const hash = await crypto.subtle.digest('SHA-256', bytes);
        const sha256 = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
        window.uploadReceipts.push({ name: file.name, bytes: file.size, mimeType: file.type, sha256 });
      }
      previews.replaceChildren(...window.uploadReceipts.map(receipt => {
        const chip = document.createElement('span'); chip.textContent = receipt.name; chip.title = receipt.name;
        chip.setAttribute('data-testid', 'attachment-chip'); return chip;
      }));
    } catch (error) {
      window.uploadErrors.push(error.message);
      const alert = document.createElement('div'); alert.setAttribute('role', 'alert'); alert.textContent = `Upload failed: ${error.message}`;
      previews.replaceChildren(alert);
    }
  });
}

async function createFixture() {
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:0;padding:14px;color:white;background:#111528;font:14px sans-serif}
    form{position:fixed;bottom:10px;left:10px;right:10px;border:1px solid #648ba0;padding:12px;background:#182738}
    [contenteditable]{padding:8px;min-height:35px;border:1px solid #728c97}
    #previews{padding:10px}input[type=file]{display:none}[hidden]{display:none}
  </style></head><body><header><h2>Normal chat</h2><button type="button">Temporary chat</button><button type="button" aria-pressed="false">Work</button></header>
  <main><div id="turns"></div><form><div id="prompt-textarea" class="ProseMirror" role="textbox" contenteditable="true" data-placeholder="Ask ChatGPT"></div>
  <input id="fileInput" type="file" multiple aria-label="Attach files"><div id="previews"></div><button type="button" data-testid="send-button" aria-label="Send prompt" hidden>Send</button></form></main>
  <script>(${fixtureBehavior.toString()})();</script></body></html>`;
  const server = http.createServer((_request, response) => { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(html); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { origin: `http://127.0.0.1:${server.address().port}`, async close() {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  } };
}

const shell = code => desktop.mainWindow.webContents.executeJavaScript(code, true);
const page = (side, code) => desktop.views[side].webContents.executeJavaScript(code, true);
async function waitFor(check, description, timeout = 30_000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(description);
}
function pass(text) { tests.push(text); process.stdout.write(`PASS: ${text}\n`); }
function interceptWire(side) {
  const contents = desktop.views[side].webContents;
  const nativeSend = contents.send.bind(contents);
  contents.send = (channel, payload) => {
    if (channel === 'converge:page-request' && payload.message?.type?.startsWith('FILE_STAGE_')) {
      const message = payload.message;
      const metrics = wire[side];
      metrics.maxWireBytes = Math.max(metrics.maxWireBytes, Buffer.byteLength(JSON.stringify(payload)));
      if (message.type === 'FILE_STAGE_BEGIN') metrics.begins += 1;
      else if (message.type === 'FILE_STAGE_COMMIT') metrics.commits += 1;
      else if (message.type === 'FILE_STAGE_CHUNK') {
        assert.equal(message.offset, metrics.receivedCharacters); assert.equal(message.fileIndex, 0);
        metrics.chunks += 1; metrics.receivedCharacters += message.data.length;
        metrics.maxChunkLength = Math.max(metrics.maxChunkLength, message.data.length);
      }
    }
    return nativeSend(channel, payload);
  };
}

async function run() {
  fixture = await createFixture();
  function blockRemote(browserSession) {
    browserSession.webRequest.onBeforeRequest((details, callback) => {
      let allowed = /^(file:|data:|blob:|about:|devtools:)/.test(details.url);
      if (!allowed) {
        const origin = new URL(details.url).origin;
        allowed = origin === fixture.origin;
        if (!allowed) blockedRemoteOrigins.add(origin);
      }
      callback({ cancel: !allowed });
    });
  }
  blockRemote(session.defaultSession);
  app.on('web-contents-created', (_event, contents) => blockRemote(contents.session));
  desktop = await createCookieApp({ qaOrigin: fixture.origin, show: false, dialogs: {
    async showOpenDialog() { openDialogs += 1; return { canceled: false, filePaths: [sourcePath] }; },
  } });
  for (const side of ['left', 'right', 'boss']) {
    interceptWire(side);
    desktop.views[side].webContents.on('console-message', event => { if (event.level >= 2) messages.push({ side, message: String(event.message).slice(0, 1000) }); });
  }
  await waitFor(() => shell(`typeof window.convergeBrowser==='object' && document.getElementById('previewNotice').hidden`), 'The production shell did not initialize.');
  const bootstrapVersion = (await shell('window.convergeBrowser.bootstrap()')).version;
  const fakeCookies = JSON.stringify([{ domain: '.chatgpt.com', name: 'converge_large_upload_fixture', value: 'offline-fixture', path: '/', secure: true, session: true, sameSite: 'lax' }]);
  const imported = await shell(`window.convergeBrowser.importCookies(${JSON.stringify(fakeCookies)})`);
  assert.equal(imported.ok, true, imported.error);
  const opened = await shell(`window.convergeBrowser.openPages({chatMode:'normal'})`);
  assert.equal(opened.ok, true, opened.error);
  await waitFor(async () => {
    const state = await desktop.coordinator.getState();
    return ['left', 'right', 'boss'].every(side => state.pages[side]?.ready === true);
  }, 'The production bridge did not make all three fixture pages ready.');
  pass('Production shell opens three sandboxed pages using only isolated offline fixture data.');
  await waitFor(() => shell(`!document.getElementById('attachFiles').disabled`), 'The sidebar Attach control did not become ready.');
  const uploadStartedAt = Date.now();
  // Use the actual sidebar click and renderer/preload/native picker handler;
  // direct coordinator injection would omit the reported broken connection.
  await shell(`document.getElementById('attachFiles').click()`);
  await waitFor(async () => {
    const state = await desktop.coordinator.getState();
    if (['partial', 'failed'].includes(state.attachments?.status)) throw new Error(state.attachments.error || 'A production attachment failed.');
    return state.attachments?.status === 'attached';
  }, 'The native 100 MB attachment did not complete in all three pages.', 140_000);
  const state = await desktop.coordinator.getState();
  assert.equal(openDialogs, 1);
  assert.deepEqual(state.attachments.names, [source.name]);
  pass('One sidebar click reads a 100 MB PDF through the native picker and confirms delivery to the whole team.');
  const receipts = {};
  for (const side of ['left', 'right', 'boss']) {
    receipts[side] = await page(side, `({receipts:window.uploadReceipts,changes:window.uploadChangeCount,errors:window.uploadErrors,selected:Array.from(document.getElementById('fileInput').files,file=>({name:file.name,size:file.size,type:file.type}))})`);
    assert.equal(receipts[side].changes, 1); assert.deepEqual(receipts[side].errors, []);
    assert.deepEqual(receipts[side].receipts, [{ name: source.name, bytes: source.bytes, mimeType: 'application/pdf', sha256: source.sha256 }]);
    assert.deepEqual(receipts[side].selected, [{ name: source.name, size: source.bytes, type: 'application/pdf' }]);
    assert.equal(wire[side].begins, 1); assert.equal(wire[side].commits, 1);
    assert.equal(wire[side].receivedCharacters, Math.ceil(source.bytes / 3) * 4);
    assert.ok(wire[side].chunks > 100); assert.ok(wire[side].maxChunkLength <= 1024 * 1024);
    assert.ok(wire[side].maxWireBytes <= 1024 * 1024 + 2048);
  }
  pass('All three real Chromium file inputs independently hash the exact 100 MB source bytes and receive it once.');
  pass('Actual Electron page-request IPC uses sequential 1 MB chunks and one commit per page.');
  await waitFor(() => shell(`!document.getElementById('attachFiles').disabled && document.getElementById('fileStatus').classList.contains('success')`), 'The sidebar remained locked after successful upload.');
  const sidebar = await shell(`({ready:!document.getElementById('attachFiles').disabled,fileStatus:document.getElementById('fileStatus').textContent,error:document.getElementById('actionError').hidden?'':document.getElementById('actionError').textContent})`);
  assert.equal(sidebar.error, ''); assert.ok(sidebar.fileStatus.includes(source.name));
  for (const side of ['left', 'right', 'boss']) {
    assert.equal(desktop.views[side].webContents.isDestroyed(), false);
    assert.equal((await desktop.sendToPage(side, { type: 'INSPECT', chatMode: 'normal', requireUnpersonalized: false })).ready, true);
  }
  pass('The sidebar returns to ready state and all three page bridges remain responsive after upload.');
  const ownedContents = ['left', 'right', 'boss'].map(side => desktop.views[side].webContents);
  const closed = new Promise(resolve => desktop.mainWindow.once('closed', resolve));
  desktop.mainWindow.close(); await closed; await desktop.whenClosed();
  assert.ok(ownedContents.every(contents => contents.isDestroyed()));
  pass('The completed large-file workspace closes and disposes its three owned browser pages cleanly.');
  const report = { passed: true, localFixturesOnly: true, packaged: !!packagedAsar, packageVersion, bootstrapVersion,
    platform: process.platform, arch: process.arch, source, wire, receipts, sidebar, tests,
    nativePickerInvocations: openDialogs, uploadDurationMs: Date.now() - uploadStartedAt, totalDurationMs: Date.now() - startedAt,
    blockedRemoteOrigins: [...blockedRemoteOrigins], consoleMessages: messages,
    scope: 'Actual production Electron/native picker/generated preload/file-input transport only. ChatGPT service acceptance, live model responses and large-file downloads are not tested here.' };
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  completed = true; clearTimeout(watchdog);
  await fixture.close();
  fs.unlinkSync(sourcePath);
  process.stdout.write(`LARGE_UPLOAD_QA ${JSON.stringify({ passed: true, sourceBytes: source.bytes, sourceSha256: source.sha256, sides: Object.keys(receipts), reportPath, packageVersion })}\n`);
  app.quit();
}

async function fail(error) {
  if (completed) return;
  completed = true; clearTimeout(watchdog);
  let state;
  try { state = await desktop?.coordinator.getState(); } catch (_) { }
  fs.writeFileSync(reportPath, JSON.stringify({ passed: false, localFixturesOnly: true, packageVersion, error: error.stack || error.message, source, wire, tests, state, consoleMessages: messages }, null, 2));
  process.stderr.write(`Large upload QA failed: ${error.stack || error.message}\n`);
  app.exit(1);
}

app.whenReady().then(run).catch(fail);
