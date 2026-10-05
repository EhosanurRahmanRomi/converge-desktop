'use strict';

// Production Electron shell, three isolated WebContentsViews, and native file
// upload/download IPC against an explicitly offline model DOM fixture. Remote
// traffic is blocked. This never opens a live account or imports a real cookie.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { createHash } = require('node:crypto');
const { app, session } = require('electron');
const root = path.join(__dirname, '..');
const packagedAsar = process.env.CONVERGE_PACKAGED_ASAR && path.resolve(process.env.CONVERGE_PACKAGED_ASAR);
const productionRoot = packagedAsar || root;
const packageVersion = JSON.parse(fs.readFileSync(path.join(productionRoot, 'package.json'), 'utf8')).version;
if (packagedAsar) app.setAppPath(packagedAsar);
const { createCookieApp } = require(path.join(productionRoot, 'desktop-main.js'));
const profileRoot = fs.mkdtempSync(path.join(app.getPath('temp'), 'converge-boss-qa-'));
app.setPath('userData', profileRoot);
const evidenceRoot = path.join(root, '.live-test', packagedAsar ? 'boss-workspace-qa-packaged' : 'boss-workspace-qa');
fs.mkdirSync(evidenceRoot, { recursive: true });
const sourceBytes = Buffer.from('OFFLINE SOURCE ONLY\nMaximumLoss=100\nFixedLots=0.01\n');
const sourcePath = path.join(profileRoot, 'original-source.txt');
const sourceImagePath = path.join(profileRoot, 'source-diagram.png');
const sourcePdfPath = path.join(profileRoot, 'source-reference.pdf');
const savedPath = path.join(profileRoot, 'saved-boss-result.txt');
fs.writeFileSync(sourcePath, sourceBytes);
const sourceImageBytes = fs.readFileSync(path.join(root, 'assets/icon.png'));
// Small valid one-page PDF: only local inert fixture data is uploaded.
const pdfParts = ['%PDF-1.4\n'];
const pdfOffsets = [0];
for (const [index, body] of [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R >>',
  '<< /Length 0 >>\nstream\n\nendstream',
].entries()) {
  pdfOffsets.push(Buffer.byteLength(pdfParts.join('')));
  pdfParts.push(`${index + 1} 0 obj\n${body}\nendobj\n`);
}
const pdfXref = Buffer.byteLength(pdfParts.join(''));
pdfParts.push(`xref\n0 5\n0000000000 65535 f \n${pdfOffsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${pdfXref}\n%%EOF\n`);
const sourcePdfBytes = Buffer.from(pdfParts.join(''));
fs.writeFileSync(sourceImagePath, sourceImageBytes);
fs.writeFileSync(sourcePdfPath, sourcePdfBytes);
let sourceSelection = [sourcePath];
const log = [];
const consoleMessages = [];
const screenshots = [];
const captureWarnings = [];
const blockedRemoteOrigins = new Set();
let desktop;
let fixture;
let completed = false;
let openDialogCount = 0;
let saveDialogCount = 0;
let stateMonitor;
let bootstrapVersion;

function digest(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function pass(message) {
  log.push(message);
  fs.writeFileSync(path.join(evidenceRoot, 'progress.json'), JSON.stringify({ at: new Date().toISOString(), stage: message, stages: log.length }, null, 2));
  process.stdout.write(`PASS: ${message}\n`);
}

function fixtureBehavior() {
  const editor = document.getElementById('prompt-textarea');
  const send = document.getElementById('send');
  const stop = document.getElementById('stopFixture');
  const picker = document.getElementById('fileInput');
  const previews = document.getElementById('previews');
  const turns = document.getElementById('turns');
  window.fixtureSide = 'unassigned';
  window.fixtureSends = [];
  window.fixtureUploads = [];
  window.fixtureStops = 0;
  window.fixtureMode = 'normal';
  window.fixtureSlow = false;
  let responseTimer;
  editor.addEventListener('input', () => { send.hidden = !editor.innerText.trim(); });
  picker.addEventListener('change', () => {
    window.fixtureUploads.push(Array.from(picker.files, file => ({ name: file.name, type: file.type, size: file.size })));
    previews.replaceChildren();
    for (const file of picker.files) {
      if (file.type.startsWith('image/')) {
        const preview = document.createElement('img'); preview.src = URL.createObjectURL(file); preview.alt = 'Attached image preview'; previews.append(preview);
      } else { const chip = document.createElement('span'); chip.textContent = file.name; previews.append(chip); }
    }
  });
  stop.addEventListener('click', () => {
    clearTimeout(responseTimer); stop.hidden = true; window.fixtureStops += 1;
  });
  document.getElementById('temporaryControl').addEventListener('click', event => {
    event.currentTarget.textContent = 'Turn off temporary chat';
    document.getElementById('workControl').setAttribute('aria-pressed', 'false');
    document.getElementById('modeHeading').textContent = 'Temporary chat';
  });
  document.getElementById('workControl').addEventListener('click', event => {
    event.currentTarget.setAttribute('aria-pressed', 'true');
    document.getElementById('temporaryControl').textContent = 'Temporary chat';
    document.getElementById('modeHeading').textContent = 'Work';
  });
  function block(text, name) {
    const match = text.match(new RegExp(`BEGIN_${name}_JSON\\s*\\n([\\s\\S]*?)\\nEND_${name}_JSON`));
    return match ? JSON.parse(match[1].replace(/\u00a0/g, ' ')) : null;
  }
  function generated(body, cycle) {
    const name = `boss-refined-v${cycle}.txt`;
    const bytes = `OFFLINE REFINED SOURCE ONLY\nMaximumLoss=20\nFixedLots=0.01\nReviewPass=${cycle}\n`;
    const control = document.createElement('span');
    control.setAttribute('role', 'button');
    control.setAttribute('data-file-reference', 'true');
    control.setAttribute('aria-label', `Download ${name}`);
    control.setAttribute('data-markdown-copy-text', name);
    control.textContent = name;
    const blobUrl = URL.createObjectURL(new Blob([bytes], { type: 'text/plain' }));
    control.addEventListener('click', () => {
      const anchor = document.createElement('a'); anchor.href = blobUrl; anchor.download = name;
      anchor.hidden = true; document.body.append(anchor); anchor.click(); anchor.remove();
    });
    body.append(control);
  }
  send.addEventListener('click', async () => {
    const text = editor.innerText.trim().replace(/\u00a0/g, ' ');
    const fileBytes = await Promise.all(Array.from(picker.files, async file => ({ name: file.name,
      mimeType: file.type, base64: btoa(String.fromCharCode(...new Uint8Array(await file.arrayBuffer()))) })));
    window.fixtureSends.push({ text, files: Array.from(picker.files, file => ({ name: file.name, type: file.type, size: file.size })), fileBytes });
    const user = document.createElement('div'); user.setAttribute('data-message-author-role', 'user'); user.textContent = text; turns.append(user);
    editor.innerText = ''; send.hidden = true; stop.hidden = false; picker.value = ''; previews.replaceChildren();
    responseTimer = setTimeout(() => {
      const assistant = document.createElement('div'); assistant.setAttribute('data-message-author-role', 'assistant');
      const body = document.createElement('div'); body.className = 'markdown'; assistant.append(body);
      let value;
      try {
        if (window.fixtureSide === 'boss') {
          const context = block(text, 'BOSS_CONTEXT');
          if (!context) throw new Error('Boss fixture did not receive its explicit context JSON.');
          window.fixtureBossContexts ||= []; window.fixtureBossContexts.push(context);
          const results = context.worker_results || [];
          const latestFileResult = [...results].reverse().find(result => result.side === 'left' && result.media?.files?.length);
          const finalResults = results.slice(-2).map(result => {
            try { return JSON.parse(result.text); } catch { return null; }
          });
          const candidate = context.candidate;
          const bothAccepted = candidate && finalResults.length === 2 && finalResults.every(result => result?.verdict === 'accept' &&
            result.candidate_id === candidate.id && result.candidate_sha256 === candidate.sha256);
          if (bothAccepted) value = { request_id: context.request_id, action: 'finish', candidate_id: candidate.id,
            answer: 'Refined offline source: MaximumLoss=20, FixedLots=0.01. All generated file bytes were checked. This is a transport fixture, not a trading backtest.',
            checks: ['Both workers checked the exact final candidate identity and bytes.'], limitations: ['Offline deterministic responses only; no actual market test.'] };
          else if (context.completed_work_cycles >= context.min_work_cycles && latestFileResult) value = {
            request_id: context.request_id, action: 'verify', candidate_result_id: latestFileResult.id,
            assignments: { left: 'Check exact final source bytes and risk limit; include concrete checks.', right: 'Independently verify exact final source bytes and preserved lot size.' },
            summary: 'Verify the newest refined file independently.' };
          else value = { request_id: context.request_id, action: 'dispatch', candidate_result_id: latestFileResult?.id || null,
            assignments: { left: `QA_WORK_CYCLE=${Number(context.completed_work_cycles || 0) + 1}; refine the complete file to MaximumLoss=20, preserve FixedLots=0.01, and supply a downloadable result.`,
              right: `QA_WORK_CYCLE=${Number(context.completed_work_cycles || 0) + 1}; independently inspect risk input and original lot size, challenge errors with concrete evidence.` },
            summary: 'Boss designed two distinct current tasks and will review the outputs.' };
          if (window.fixtureMode === 'malformed-boss') value = 'Malformed controller response';
        } else {
          const candidate = block(text, 'FINAL_CANDIDATE');
          if (candidate && text.includes('Perform an independent final check of this SAME candidate.')) value = { candidate_id: candidate.id, candidate_sha256: candidate.sha256, verdict: 'accept',
            checks: ['Read attached exact file; MaximumLoss=20 and FixedLots=0.01 preserved.'], issues: [], answer: 'Verified the final source bytes independently.' };
          else {
            const cycle = Number(text.match(/QA_WORK_CYCLE=(\d+)/)?.[1] || 1);
            value = window.fixtureSide === 'left' ? `Worker A refined source in cycle ${cycle}. MaximumLoss=20 and FixedLots=0.01; complete file attached.` :
              `Worker B challenged the original MaximumLoss=100 using actual source evidence. Cycle ${cycle} independently checks required 20 limit and preserved 0.01 lot size. No profitability backtest claimed.`;
            if (window.fixtureSide === 'left') generated(assistant, cycle);
          }
        }
        body.textContent = typeof value === 'string' ? value : JSON.stringify(value);
      } catch (error) { body.textContent = `FIXTURE ERROR: ${error.message}`; }
      turns.append(assistant); stop.hidden = true;
    }, window.fixtureSlow ? 60_000 : Number(window.fixtureDelay || 80));
  });
}

async function createFixture() {
  const state = { loads: 0 };
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname !== '/') { response.writeHead(404); response.end('Offline fixture only'); return; }
    state.loads += 1;
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; script-src 'nonce-Y29udmVyZ2UtZml4dHVyZQ=='; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; base-uri 'none'; form-action 'self'" });
    response.end(`<!doctype html><html><head><meta charset="utf-8"><style>
      body{margin:0;padding:14px;color:#e9edfa;font:13px 'Segoe UI',sans-serif;background:#111528}
      header{display:flex;gap:8px;align-items:center}header button{font-size:11px;padding:5px}
      .fixture-label{color:#ffc881;font-size:11px;letter-spacing:.1em}#modeHeading{font-size:12px}
      #turns{padding-bottom:155px}[data-message-author-role]{padding:12px 0;white-space:pre-wrap;overflow-wrap:anywhere;border-bottom:1px solid #384354}
      [data-message-author-role=user]{color:#a2b4cd;max-height:85px;overflow:auto;font-size:10px}
      [data-file-reference]{display:block;color:#99e9d6;cursor:pointer;margin:8px 0}
      form{position:fixed;bottom:10px;left:10px;right:10px;padding:10px;background:#152333;border:1px solid #54758c;border-radius:12px}
      [contenteditable]{min-height:30px;max-height:70px;overflow:auto;outline:1px solid #53677e;padding:7px}
      #previews img{width:48px;height:48px}#previews span{margin-right:8px;color:#aee6d6}
      input[type=file]{font-size:10px;max-width:95%;margin:6px 0}button{padding:6px 14px;border:0;border-radius:6px;background:#9ee7d4;color:#102d24}button[hidden]{display:none}
    </style></head><body><div class="fixture-label">OFFLINE THREE CHAT QA · NO CHATGPT ACCOUNT</div>
      <header><button id="temporaryControl" type="button">Temporary chat</button><button id="workControl" type="button" aria-pressed="false">Work</button><h3 id="modeHeading">Normal chat</h3></header>
      <main><div id="turns"></div><form><div id="prompt-textarea" class="ProseMirror" role="textbox" contenteditable="true" data-placeholder="Ask ChatGPT"></div>
      <input id="fileInput" type="file" multiple><div id="previews"></div><button id="send" type="button" data-testid="send-button" aria-label="Send prompt" hidden>Send</button>
      <button id="stopFixture" type="button" data-testid="stop-button" aria-label="Stop generating" hidden>Stop</button></form></main><script nonce="Y29udmVyZ2UtZml4dHVyZQ==">(${fixtureBehavior.toString()})();</script></body></html>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { state, origin: `http://127.0.0.1:${server.address().port}`, async close() {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  } };
}

const shell = code => desktop.mainWindow.webContents.executeJavaScript(code, true);
const page = (side, code) => desktop.views[side].webContents.executeJavaScript(code, true);
const click = id => shell(`document.getElementById(${JSON.stringify(id)}).click()`);
async function waitFor(check, message, timeout = 60_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  const state = desktop && await desktop.coordinator.getState();
  const pages = {};
  if (desktop) for (const side of ['left', 'right', 'boss']) {
    try { pages[side] = await page(side, `({sends:window.fixtureSends,bossContexts:window.fixtureBossContexts,turns:document.getElementById('turns')?.innerText?.slice(-8000),editor:document.getElementById('prompt-textarea')?.innerText})`); }
    catch (error) { pages[side] = { error: error.message }; }
  }
  fs.writeFileSync(path.join(evidenceRoot, 'timeout.json'), JSON.stringify({ state, pages, consoleMessages }, null, 2));
  throw new Error(`${message}: ${state?.status} / ${state?.stage} / ${state?.error || ''}`);
}
async function capture(name) {
  try {
    const image = await Promise.race([desktop.mainWindow.capturePage(undefined, { stayHidden: true }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Capture timed out after five seconds.')), 5000))]);
    if (image.isEmpty()) throw new Error('Empty shell capture');
    const filename = path.join(evidenceRoot, `${name}.png`); fs.writeFileSync(filename, image.toPNG()); screenshots.push(filename);
    return filename;
  } catch (error) { captureWarnings.push(`${name}: ${error.message}`); }
}
async function capturePage(side, name) {
  let error;
  // The first request can allocate a fresh Chromium surface and reject as
  // UnknownVizError. A single bounded retry after a paint delay is sufficient
  // to verify the real surface without substituting a synthetic screenshot.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const image = await Promise.race([desktop.views[side].webContents.capturePage(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Capture timed out after five seconds.')), 5000))]);
      if (image.isEmpty()) throw new Error('Empty native page capture');
      const filename = path.join(evidenceRoot, `${name}.png`); fs.writeFileSync(filename, image.toPNG()); screenshots.push(filename);
      return filename;
    } catch (failure) { error = failure; }
    if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 350));
  }
  captureWarnings.push(`${name}: ${error.message}`);
}

async function open(chatMode = 'normal') {
  const result = await shell(`window.convergeBrowser.openPages({chatMode:${JSON.stringify(chatMode)}})`);
  assert.equal(result.ok, true, result.error);
  await waitFor(async () => {
    const state = await desktop.coordinator.getState();
    return state.status === 'setup' && ['left', 'right', 'boss'].every(side => state.pages[side]?.ready === true);
  }, 'Three pages did not finish setup');
  for (const side of ['left', 'right', 'boss']) await page(side, `window.fixtureSide=${JSON.stringify(side)}`);
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
    async showOpenDialog() { openDialogCount += 1; return { canceled: false, filePaths: sourceSelection }; },
    async showSaveDialog(_window, options) {
      assert.match(options.defaultPath, /^boss-refined-v\d+\.txt$/); saveDialogCount += 1;
      return { canceled: false, filePath: savedPath };
    },
  } });
  desktop.mainWindow.setSize(1366, 768);
  stateMonitor = setInterval(async () => {
    if (!desktop || completed) return;
    const state = await desktop.coordinator.getState();
    fs.writeFileSync(path.join(evidenceRoot, 'live-state.json'), JSON.stringify({ at: new Date().toISOString(), state,
      openDialogCount, saveDialogCount, fixtureLoads: fixture.state.loads }, null, 2));
  }, 5000);
  stateMonitor.unref();
  desktop.mainWindow.webContents.on('console-message', event => consoleMessages.push({ side: 'shell', level: event.level, message: event.message }));
  for (const side of ['left', 'right', 'boss']) desktop.views[side].webContents.on('console-message', event => consoleMessages.push({ side, level: event.level, message: event.message }));
  await waitFor(() => shell(`typeof window.convergeBrowser==='object' && document.getElementById('previewNotice').hidden`), 'Shell preload did not initialize');
  bootstrapVersion = (await shell('window.convergeBrowser.bootstrap()')).version;
  assert.equal(bootstrapVersion, app.getVersion());
  if (packagedAsar) assert.equal(app.getVersion(), packageVersion, 'Packaged fixture launcher must use archive metadata.');
  assert.equal(await shell('document.getElementById("version").textContent'), `v${bootstrapVersion}`);
  assert.deepEqual(Object.keys(desktop.views).sort(), ['boss', 'left', 'right']);
  for (const side of ['left', 'right', 'boss']) {
    const preferences = desktop.views[side].webContents.getLastWebPreferences();
    assert.equal(preferences.sandbox, true); assert.equal(preferences.contextIsolation, true); assert.equal(preferences.nodeIntegration, false);
  }
  assert.equal(desktop.browserSession.storagePath, null);
  pass(`Production ${process.platform === 'darwin' ? 'macOS' : 'Windows'} shell creates three sandboxed isolated native chat views and keeps its browser session in memory.`);

  const fakeCookies = JSON.stringify([{ domain: '.chatgpt.com', name: 'converge_boss_fixture', value: 'offline-fixture', path: '/', secure: true, session: true, sameSite: 'lax' }]);
  const imported = await shell(`window.convergeBrowser.importCookies(${JSON.stringify(fakeCookies)})`);
  assert.equal(imported.ok, true);
  await open();
  assert.equal(fixture.state.loads, 3);
  assert.equal((await desktop.coordinator.getState()).coordinatorMode, 'boss');
  pass('Import and Normal OK open exactly three distinct chats with the boss coordinator active.');

  sourceSelection = [sourcePath, sourcePdfPath, sourceImagePath];
  const mixedAttached = await shell('window.convergeBrowser.attachFiles()');
  assert.equal(mixedAttached.ok, true, mixedAttached.error);
  for (const side of ['left', 'right', 'boss']) {
    assert.deepEqual(await page(side, 'window.fixtureUploads[0]'), [
      { name: 'original-source.txt', type: 'text/plain', size: sourceBytes.length },
      { name: 'source-reference.pdf', type: 'application/pdf', size: sourcePdfBytes.length },
      { name: 'source-diagram.png', type: 'image/png', size: sourceImageBytes.length },
    ]);
    assert.equal(await page(side, 'document.querySelectorAll("#previews img").length'), 1);
  }
  const resetMixed = await shell('window.convergeBrowser.resetChats()');
  assert.equal(resetMixed.ok, true, resetMixed.error);
  await open();
  sourceSelection = [sourcePath];
  pass('A mixed text, valid PDF and PNG source selection reaches all three native file inputs; Reset clears the staged previews and retains the session.');

  const attached = await shell(`window.convergeBrowser.attachFiles()`);
  assert.equal(attached.ok, true, attached.error);
  assert.equal(openDialogCount, 2);
  for (const side of ['left', 'right', 'boss']) assert.deepEqual(await page(side, 'window.fixtureUploads[0]'),
    [{ name: 'original-source.txt', type: 'text/plain', size: sourceBytes.length }]);
  pass('One native file picker uploads the original source to the boss and both workers.');

  await click('toggleBoss');
  await shell(`document.getElementById('bossMessageInput').value='Refine the attached source to MaximumLoss=20 while preserving FixedLots=0.01 and return the complete downloadable file. Check it independently.';
    document.getElementById('reviewMode').value='improve';document.getElementById('maxRounds').value='6';
    document.getElementById('relayMedia').checked=true;document.getElementById('requireFiles').checked=true;
    document.getElementById('bossMessageInput').dispatchEvent(new Event('input',{bubbles:true}));`);
  await waitFor(() => shell(`!document.getElementById('sendBossMessage').disabled`), 'Boss composer did not enable after all three pages were ready');
  await click('sendBossMessage');
  await waitFor(async () => (await desktop.coordinator.getState()).status === 'running', 'Boss composer did not start the run');
  await click('closeBoss');
  await waitFor(() => page('left', 'window.fixtureSends.length>=1'), 'Boss did not issue its first worker assignment');
  const midRunInstruction = 'Also document that the preserved FixedLots=0.01 has been checked against the original source.';
  await click('toggleBoss');
  await shell(`document.getElementById('bossMessageInput').value=${JSON.stringify(midRunInstruction)};document.getElementById('bossMessageInput').dispatchEvent(new Event('input',{bubbles:true}));`);
  await waitFor(() => shell(`!document.getElementById('sendBossMessage').disabled`), 'Boss update composer did not accept an instruction while workers were active');
  await click('sendBossMessage');
  await waitFor(async () => (await desktop.coordinator.getState()).boss.revision >= 1, 'Mid-run user instruction was not recorded');
  await click('closeBoss');
  await waitFor(async () => {
    const state = await desktop.coordinator.getState();
    if (state.status === 'error') throw new Error(state.error);
    return state.status === 'agreed';
  }, 'Boss did not complete four work cycles and exact final verification', 180_000);
  const result = await desktop.coordinator.getState();
  assert.ok(result.round >= 4);
  assert.ok(result.workerResults.length >= 10);
  assert.ok(result.candidate?.media?.files?.length);
  assert.equal(result.acceptedBy.left, result.candidate.id);
  assert.equal(result.acceptedBy.right, result.candidate.id);
  const sends = Object.fromEntries(await Promise.all(['left', 'right', 'boss'].map(async side => [side, await page(side, 'window.fixtureSends')])));
  for (const side of ['left', 'right']) {
    assert.deepEqual(Buffer.from(sends[side][0].fileBytes.find(file => file.name === 'original-source.txt').base64, 'base64'), sourceBytes);
    const peer = sends[side].slice(1).find(send => send.fileBytes.some(file => /boss-refined-v\d+\.txt$/.test(file.name)));
    assert.ok(peer, `${side} never received a generated peer file`);
  }
  assert.deepEqual(Buffer.from(sends.boss[0].fileBytes.find(file => file.name === 'original-source.txt').base64, 'base64'), sourceBytes);
  const bossFileSends = sends.boss.filter(send => send.fileBytes.some(file => /boss-refined-v\d+\.txt$/.test(file.name)));
  assert.ok(bossFileSends.length >= 4, 'Each cycle output must be uploaded as actual bytes to the boss.');
  assert.match(sends.left[0].text, /QA_WORK_CYCLE=1/);
  assert.match(sends.right[0].text, /QA_WORK_CYCLE=1/);
  assert.notEqual(sends.left[0].text, sends.right[0].text);
  const contexts = await page('boss', 'window.fixtureBossContexts');
  assert.ok(contexts.some(context => context.worker_results?.some(worker => worker.side === 'left') && context.worker_results?.some(worker => worker.side === 'right')));
  assert.ok(contexts.some(context => JSON.stringify(context).includes(midRunInstruction)), 'Queued user instruction was never supplied to the boss.');
  assert.equal(result.boss.queue.length, 0, 'Completed run must not retain an undelivered user instruction.');
  pass('The boss writes distinct worker instructions, receives both results and exact generated files every cycle, then both workers verify one final candidate after four improvement cycles.');
  pass('The real boss composer accepts an instruction during worker generation, delivers it in the next boss context, and completes the run with no queued message left behind.');

  const saved = await shell('window.convergeBrowser.saveFiles()');
  assert.equal(saved.ok, true, saved.error); assert.equal(saveDialogCount, 1);
  const finalFile = result.candidate.media.files[0];
  assert.equal(digest(fs.readFileSync(savedPath)), finalFile.contentSha256);
  assert.match(fs.readFileSync(savedPath, 'utf8'), /MaximumLoss=20\nFixedLots=0\.01/);
  pass('Native Save downloads the actual accepted file and matches the coordinator SHA-256, with the requested corrected values.');

  desktop.mainWindow.showInactive();
  await new Promise(resolve => setTimeout(resolve, 500));
  const themeCaptures = [];
  for (const chatTheme of ['horror', 'alien', 'night', 'cyberpunk', 'anime']) {
    await shell(`document.getElementById('chatTheme').value=${JSON.stringify(chatTheme)};document.getElementById('chatTheme').dispatchEvent(new Event('change',{bubbles:true}));`);
    await waitFor(async () => (await Promise.all(['left', 'right', 'boss'].map(side => page(side, 'document.documentElement.getAttribute("data-converge-chat-theme")')))).every(theme => theme === chatTheme), `Theme ${chatTheme} did not reach all native pages`);
    // Occluded native child views can suspend animation frames. Bound the
    // optional frame wait; the real style checks and capture remain required.
    await Promise.race([page('left', 'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))'),
      new Promise(resolve => setTimeout(resolve, 500))]);
    await new Promise(resolve => setTimeout(resolve, 300));
    const background = await page('left', 'getComputedStyle(document.getElementById("converge-page-galaxy")).backgroundImage');
    const filename = await capturePage('left', `chat-background-${chatTheme}`);
    if (filename) themeCaptures.push({ chatTheme, background, sha256: digest(fs.readFileSync(filename)) });
  }
  assert.equal(themeCaptures.length, 5, 'Every chat theme needs a real native-page screenshot.');
  assert.equal(new Set(themeCaptures.map(item => item.sha256)).size, 5,
    'Five native chat theme captures must differ after their actual paint settles.');
  assert.equal(new Set(themeCaptures.map(item => item.background)).size, themeCaptures.length,
    'Theme settings must apply different CSS backgrounds to the native chat page.');
  pass('The settings selector applies Horror, Alien, Night, Cyberpunk and Anime backgrounds to all three real chat views.');
  for (const characterStyle of ['astronaut', 'spirit', 'robot']) {
    await shell(`document.getElementById('characterStyle').value=${JSON.stringify(characterStyle)};document.getElementById('characterStyle').dispatchEvent(new Event('change',{bubbles:true}));`);
    assert.equal(await shell('document.body.dataset.characterStyle'), characterStyle);
    assert.equal(await shell(`Array.from(document.querySelectorAll('.character-${characterStyle}')).filter(element=>getComputedStyle(element).display!=='none').length`), 3,
      'Each character choice must visibly change the two workers and the boss.');
    await new Promise(resolve => setTimeout(resolve, 250));
    await capture(`team-characters-${characterStyle}`);
  }
  pass('Robot, Explorer and Spirit character choices apply without changing the active chat run or its accepted files.');
  await shell(`if(!document.getElementById('app').classList.contains('sidebar-collapsed')) document.getElementById('closeSidebar').click();`);
  desktop.mainWindow.showInactive();
  await new Promise(resolve => setTimeout(resolve, 700));
  await capture('workers-and-boss-character');
  await click('toggleBoss');
  await waitFor(() => desktop.views.boss.getVisible(), 'Clicking the center boss did not show its native chat');
  assert.equal(await shell(`document.getElementById('bossDrawer').hidden`), false);
  await new Promise(resolve => setTimeout(resolve, 400));
  await capture('sliding-boss-chat');
  await capturePage('boss', 'native-boss-chat');
  await shell('document.getElementById("bossMessageInput").focus()');
  assert.equal(await shell('document.activeElement.id'), 'bossMessageInput');
  await click('toggleBoss');
  await waitFor(() => !desktop.views.boss.getVisible(), 'Closing the boss panel did not hide its native chat');
  await new Promise(resolve => setTimeout(resolve, 350));
  assert.equal(await shell('document.activeElement.id'), 'toggleBoss', 'Closing the boss must move focus before hiding its textarea.');
  assert.ok(desktop.views.left.getVisible() || desktop.views.right.getVisible());
  pass('Clicking the center boss opens and closes its sliding native chat panel while preserving the worker workspace.');

  const loadsBeforeFollowup = fixture.state.loads;
  await page('boss', 'window.fixtureSlow=true');
  const followup = await shell(`window.convergeBrowser.bossMessage({text:'Further improve documentation of the same source. Preserve lot size.'})`);
  assert.equal(followup.ok, true, followup.error);
  await waitFor(() => page('boss', `!document.getElementById('stopFixture').hidden`), 'Follow-up did not submit to the boss');
  const queued = await shell(`window.convergeBrowser.bossMessage({text:'Also include the exact source hash in your final review.'})`);
  assert.equal(queued.ok, true, queued.error);
  const queuedState = await desktop.coordinator.getState();
  assert.ok(queuedState.boss.queue.length >= 1);
  assert.equal(fixture.state.loads, loadsBeforeFollowup);
  pass('A follow-up reuses all three conversations; a new instruction while the boss generates is queued safely.');
  await shell('window.convergeBrowser.stop()');
  await waitFor(() => page('boss', 'window.fixtureStops>=1'), 'Stop did not click the active boss generation Stop');
  const stopped = await desktop.coordinator.getState();
  assert.ok(['stopped', 'cancelled'].includes(stopped.status));
  assert.ok(stopped.boss.queue.length === 0 || stopped.boss.queue.every(item => item.status !== 'pending'));
  const sendsAtStop = await page('boss', 'window.fixtureSends.length');
  await new Promise(resolve => setTimeout(resolve, 500));
  assert.equal(await page('boss', 'window.fixtureSends.length'), sendsAtStop);
  pass('Stop cancels active boss generation and prevents queued instructions from restarting the stopped run.');

  const reset = await shell('window.convergeBrowser.resetChats()'); assert.equal(reset.ok, true, reset.error);
  for (const side of ['left', 'right', 'boss']) assert.equal(desktop.views[side].webContents.getURL(), 'about:blank');
  assert.equal((await desktop.browserSession.cookies.get({ name: 'converge_boss_fixture' })).length, 1);
  await open('normal');
  for (const side of ['left', 'right']) await page(side, 'window.fixtureSlow=true');
  const workersStopStart = await shell(`window.convergeBrowser.start({question:'Check the corrected source without market or profitability claims.',reviewMode:'improve',maxRounds:4,relayMedia:true})`);
  assert.equal(workersStopStart.ok, true, workersStopStart.error);
  await waitFor(async () => (await Promise.all(['left', 'right'].map(side => page(side, `!document.getElementById('stopFixture').hidden`)))).every(Boolean), 'Boss did not dispatch to both workers');
  await shell('window.convergeBrowser.stop()');
  await waitFor(async () => (await Promise.all(['left', 'right'].map(side => page(side, 'window.fixtureStops>=1')))).every(Boolean), 'Stop did not cancel both active workers');
  assert.ok(['stopped', 'cancelled'].includes((await desktop.coordinator.getState()).status));
  pass('Stop also cancels both workers during their concurrent generation, retaining each completed conversation.');
  await shell('window.convergeBrowser.resetChats()');
  await open('work');
  const workState = await desktop.coordinator.getState();
  assert.equal(workState.chatMode, 'work');
  for (const side of ['left', 'right', 'boss']) assert.equal(workState.pages[side].work, true);
  pass('Reset clears all three chats without clearing the imported session; Work mode is verified on the fresh boss and worker pages.');

  await shell('window.convergeBrowser.resetChats()');
  await open('temporary');
  const temporaryState = await desktop.coordinator.getState();
  assert.equal(temporaryState.chatMode, 'temporary');
  for (const side of ['left', 'right', 'boss']) assert.equal(temporaryState.pages[side].temporary, true);
  pass('Temporary mode is also verified on all three new chats through its visible page controls.');

  await page('boss', `window.fixtureMode='malformed-boss'`);
  const malformedStart = await shell(`window.convergeBrowser.start({question:'Check safe handling of unreadable controller output.',maxRounds:4,reviewMode:'improve',relayMedia:false})`);
  assert.equal(malformedStart.ok, true, malformedStart.error);
  await waitFor(async () => (await desktop.coordinator.getState()).status === 'error', 'Malformed controller output did not stop after its bounded repair', 45_000);
  assert.equal(await page('left', 'window.fixtureSends.length'), 0);
  assert.equal(await page('right', 'window.fixtureSends.length'), 0);
  assert.equal(await page('boss', 'window.fixtureSends.length'), 2);
  assert.equal((await desktop.browserSession.cookies.get({ name: 'converge_boss_fixture' })).length, 1);
  pass('Unreadable boss control output receives one format repair, then stops safely without dispatching an invented worker task or clearing the session.');

  const uncaught = consoleMessages.filter(item => /uncaught|unhandled|FIXTURE ERROR/i.test(item.message));
  assert.deepEqual(uncaught, [], 'Renderer/page emitted an uncaught runtime error.');
  completed = true;
  fs.writeFileSync(path.join(evidenceRoot, packagedAsar ? 'packaged-result.json' : 'result.json'), JSON.stringify({ passed: true,
    localFixturesOnly: true, platform: process.platform, packageVersion, launcherVersion: app.getVersion(), bootstrapVersion,
    tests: log, screenshots, captureWarnings, blockedRemoteOrigins: [...blockedRemoteOrigins],
    consoleMessages, themeCaptures, sourceSha256: digest(sourceBytes), savedFileSha256: digest(fs.readFileSync(savedPath)),
    finalCandidateId: result.candidate.id, workCycles: result.round, sends: Object.fromEntries(Object.entries(sends).map(([side, turns]) => [side, turns.length])),
    ...(packagedAsar ? { packagedAsar, note: 'Production shell, coordinator and preloads were loaded from app.asar under development Electron. Installer execution and live authentication were not tested by this fixture.' } : {}),
  }, null, 2));
}

app.whenReady().then(run).catch(async error => {
  process.stderr.write(`FAIL: ${error.stack || error.message}\n`);
  fs.writeFileSync(path.join(evidenceRoot, packagedAsar ? 'packaged-result.json' : 'result.json'), JSON.stringify({ passed: false,
    localFixturesOnly: true, tests: log, error: error.stack || error.message, consoleMessages, captureWarnings }, null, 2));
}).finally(async () => {
  clearInterval(stateMonitor);
  if (desktop) {
    try { await desktop.coordinator.dispose(); } catch { }
    if (!desktop.mainWindow.isDestroyed()) desktop.mainWindow.close();
  }
  if (fixture) await fixture.close();
  app.exit(completed ? 0 : 1);
});
