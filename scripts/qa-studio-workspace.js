'use strict';

// Real production Electron windows, shell preload IPC, native downloads and
// local project dialogs. Provider responses are an explicitly offline DOM
// fixture; all remote network traffic is blocked and no account is used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { createHash } = require('node:crypto');
const { app, session, nativeImage } = require('electron');
const root = path.join(__dirname, '..');
const packagedAsar = process.env.CONVERGE_PACKAGED_ASAR && path.resolve(process.env.CONVERGE_PACKAGED_ASAR);
const productionRoot = packagedAsar || root;
if (packagedAsar) app.setAppPath(packagedAsar);
const { createCookieApp } = require(path.join(productionRoot, 'desktop-main.js'));
const { readZip } = require(path.join(productionRoot, 'src/studio-services/archive.js'));
const { runVerificationLab } = require(path.join(productionRoot, 'src/studio-services/index.js'));
const { candidateDigest } = require(path.join(productionRoot, 'src/browser/boss-coordinator.js'));
const packageVersion = JSON.parse(fs.readFileSync(path.join(productionRoot, 'package.json'), 'utf8')).version;
const profileRoot = fs.mkdtempSync(path.join(app.getPath('temp'), 'converge-studio-native-qa-'));
app.setPath('userData', profileRoot);
const evidenceRoot = path.join(root, '.live-test', packagedAsar ? 'studio-workspace-qa-packaged' : 'studio-workspace-qa');
fs.mkdirSync(evidenceRoot, { recursive: true });
const sourceBytes = Buffer.from('// Original offline source\nmodule.exports = 0;\n');
const sourcePath = path.join(profileRoot, 'original.js');
const archivePath = path.join(profileRoot, 'Converge-project.zip');
const deliveryPath = path.join(profileRoot, 'Converge-delivery.zip');
const savedFilesPath = path.join(profileRoot, 'saved-project-files.zip');
const revisionDownloadPath = path.join(profileRoot, 'revision-answer.js');
const pdfDownloadPath = path.join(profileRoot, 'verified-document.pdf');
const designReferencePath = path.join(profileRoot, 'style-reference.pdf');
const canaryPath = path.join(profileRoot, 'generated-program-was-executed.txt');
fs.writeFileSync(sourcePath, sourceBytes);
const tests = [], screenshots = [], consoleMessages = [], blockedRemoteOrigins = new Set();
let desktop, fixture, completed = false, openSelection = [sourcePath];
let pdfVerification;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
function pass(label) { tests.push(label); process.stdout.write(`PASS: ${label}\n`); }

function validPdfFixture() {
  const content = '0 0 1 rg\n10 10 50 50 re f\n';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream`];
  const parts = ['%PDF-1.4\n'], offsets = [];
  for (const [index, body] of objects.entries()) {
    offsets.push(Buffer.byteLength(parts.join(''))); parts.push(`${index + 1} 0 obj\n${body}\nendobj\n`);
  }
  const xref = Buffer.byteLength(parts.join(''));
  parts.push(`xref\n0 5\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return Buffer.from(parts.join(''));
}

function fixtureBehavior(config) {
  const editor = document.getElementById('prompt-textarea'), send = document.getElementById('send'),
    stop = document.getElementById('stopFixture'), picker = document.getElementById('fileInput'),
    previews = document.getElementById('previews'), turns = document.getElementById('turns');
  window.fixtureSends = []; window.fixtureUploads = [];
  let attachedFiles = [];
  function block(text, name) { const source = text.split(`BEGIN_${name}_JSON\n`)[1]?.split(`\nEND_${name}_JSON`)[0]; return source ? JSON.parse(source) : null; }
  function download(body, cycle) {
    const name = window.fixtureDocument ? 'fixture-output.pdf' : 'answer.js';
    const bytes = window.fixtureDocument ? Uint8Array.from(atob(config.pdfBase64), character => character.charCodeAt(0)) :
      `// Offline revision ${cycle}\nrequire('node:fs').writeFileSync(${JSON.stringify(config.canaryPath)}, 'executed');\nmodule.exports = ${cycle};\n`;
    const control = document.createElement('span'); control.setAttribute('role', 'button');
    control.setAttribute('data-file-reference', 'true'); control.setAttribute('aria-label', `Download ${name}`);
    control.setAttribute('data-markdown-copy-text', name); control.textContent = name;
    const blobUrl = URL.createObjectURL(new Blob([bytes], { type: window.fixtureDocument ? 'application/pdf' : 'text/plain' }));
    control.addEventListener('click', () => { const anchor = document.createElement('a'); anchor.href = blobUrl;
      anchor.download = name; document.body.append(anchor); anchor.click(); anchor.remove(); });
    body.append(control);
  }
  editor.addEventListener('input', () => { send.hidden = !editor.innerText.trim(); });
  picker.addEventListener('change', () => {
    window.fixtureUploads.push(Array.from(picker.files, file => ({ name: file.name, size: file.size, type: file.type })));
    // ChatGPT retains already uploaded composer attachments when another
    // batch is chosen. Replacing their chips would falsely erase the source
    // receipt when a restored project's candidate is attached next.
    attachedFiles.push(...picker.files);
    for (const file of picker.files) { const chip = document.createElement('span'); chip.textContent = file.name; previews.append(chip); }
  });
  document.getElementById('temporaryControl').addEventListener('click', event => { event.currentTarget.textContent = 'Turn off temporary chat'; });
  stop.addEventListener('click', () => { stop.hidden = true; });
  send.addEventListener('click', async () => {
    const text = editor.innerText.trim().replace(/\u00a0/g, ' ');
    const fileBytes = await Promise.all(Array.from(attachedFiles, async file => ({ name: file.name,
      base64: btoa(String.fromCharCode(...new Uint8Array(await file.arrayBuffer()))) })));
    window.fixtureSends.push({ text, fileBytes });
    const user = document.createElement('div'); user.setAttribute('data-message-author-role', 'user'); user.textContent = text; turns.append(user);
    editor.innerText = ''; send.hidden = true; stop.hidden = false; picker.value = ''; previews.replaceChildren(); attachedFiles = [];
    setTimeout(() => {
      if (window.fixtureHoldResponses) return;
      const assistant = document.createElement('div'); assistant.setAttribute('data-message-author-role', 'assistant');
      const body = document.createElement('div'); body.className = 'markdown'; assistant.append(body);
      try {
        let value;
        const boss = block(text, 'BOSS_CONTEXT');
        if (boss) {
          const latest = [...boss.result_index].reverse().find(result => result.side === 'left' && result.kind === 'work');
          if (boss.final_verification && Object.keys(boss.final_verification.workers).length === 2 &&
              Object.values(boss.final_verification.workers).every(review => review.verdict === 'accept') &&
              (!boss.studio.settings.freshAudit || boss.studio.freshAudit.status === 'passed')) {
            value = { request_id: boss.request_id, action: 'finish', candidate_id: boss.candidate.id,
              answer: 'Offline fixture completed four revisions, exact file checks and a fresh final audit.',
              checks: ['Models reviewed the exact current candidate. Local JavaScript syntax was parsed.'],
              limitations: ['Static parsing does not execute generated code. Provider responses are offline fixtures.'] };
          } else if (boss.completed_work_cycles >= boss.min_work_cycles && latest) {
            value = { request_id: boss.request_id, action: 'verify', candidate_result_id: latest.id,
              assignments: { left: 'Check the exact current source and acceptance criteria.', right: 'Independently inspect the exact source and checklist.' }, summary: 'Check the exact current revision.' };
          } else {
            const cycle = boss.completed_work_cycles + 1;
            value = { request_id: boss.request_id, action: 'dispatch', candidate_result_id: latest?.id || null,
              assignments: { left: `QA_STUDIO_CYCLE=${cycle}; create the complete revised answer.js file.`, right: `QA_STUDIO_CYCLE=${cycle}; independently create and inspect the complete source.` }, summary: `Create revision ${cycle}.` };
          }
        } else if (text.includes('Perform an independent final check')) {
          const candidate = block(text, 'FINAL_CANDIDATE'), contract = block(text, 'STUDIO_CONTRACT');
          value = { candidate_id: candidate.id, candidate_sha256: candidate.sha256, verdict: 'accept',
            checks: ['Inspected exact attached source, preserved output filename and revision constant.'], issues: [], answer: 'Exact candidate review complete.',
            requirementReviews: contract.requirements.filter(item => item.gate === 'review').map(item =>
              ({ id: item.id, status: 'met', evidence: window.fixtureDocument ?
                'Reviewed the requested one-page PDF scope and source coverage: the sole requested blue square is present in the delivered page.' :
                'Observed answer.js and its explicit complete module.exports revision value in the supplied candidate.' })), issueReviews: [] };
          if (window.fixtureDocument) value.documentReview = {
            files: candidate.media.files.filter(file => file.mimeType === 'application/pdf').map(file =>
              ({ name: file.name, contentSha256: file.contentSha256, pageCount: 1, renderedPages: [1], inspectedPages: [1] })),
            checks: { typography: 'Offline fixture supplies no text; typography is not applicable to the square-only page.',
              spacing: 'Offline fixture models a square at (10,10) within the 100 by 100 point page bounds.',
              mathematics: 'No equations or derivations are requested in this one-square PDF test fixture.',
              figures: 'The fixture PDF contains the requested solid blue square without captions or textual labels.',
              referenceStyle: 'The offline reference style-reference.pdf supplies the same blue-square design and page size.' }, limitations: [] };
        } else {
          const cycle = Number(text.match(/QA_STUDIO_CYCLE=(\d+)/)?.[1] || 1);
          value = window.fixtureDocument ? `Offline PDF revision ${cycle}; one-page blue-square fixture is attached. Document review responses are test data, not an actual model visual-quality judgement.` :
            `Complete offline JavaScript revision ${cycle}. The answer.js file exports ${cycle}; generated code is checked as syntax and must not run during static verification.`;
          download(assistant, cycle);
        }
        body.textContent = typeof value === 'string' ? value : JSON.stringify(value);
      } catch (error) { body.textContent = `FIXTURE ERROR: ${error.message}`; }
      turns.append(assistant); stop.hidden = true;
    }, 80);
  });
}

async function createFixture() {
  let loads = 0;
  const server = http.createServer((request, response) => {
    if (new URL(request.url, 'http://127.0.0.1').pathname !== '/') { response.writeHead(404); response.end(); return; }
    loads += 1;
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; script-src 'nonce-c3R1ZGlvLXZlcmlmaWVk'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; base-uri 'none'" });
    response.end(`<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;padding:16px;color:#e1e8ec;background:#12212c;font:14px 'Segoe UI',sans-serif}[data-message-author-role]{padding:14px;white-space:pre-wrap;overflow-wrap:anywhere;border-bottom:1px solid #304251}[data-message-author-role=user]{max-height:90px;overflow:auto;font-size:11px}#turns{padding-bottom:155px}[data-file-reference]{display:block;cursor:pointer;color:#9ee0c8}form{position:fixed;bottom:12px;left:12px;right:12px;padding:12px;background:#1b2f3b}[contenteditable]{min-height:32px;max-height:64px;overflow:auto;outline:1px solid #69828d}button{padding:7px 14px;margin:4px}button[hidden]{display:none}#previews span{margin-right:8px}</style></head><body><p>OFFLINE STUDIO VERIFICATION · NO ACCOUNT</p><button id="temporaryControl">Temporary chat</button><main><div id="turns"></div><form><div id="prompt-textarea" class="ProseMirror" role="textbox" contenteditable="true" data-placeholder="Ask ChatGPT"></div><input id="fileInput" type="file" multiple><div id="previews"></div><button id="send" type="button" data-testid="send-button" aria-label="Send prompt" hidden>Send</button><button id="stopFixture" type="button" data-testid="stop-button" aria-label="Stop generating" hidden>Stop</button></form></main><script nonce="c3R1ZGlvLXZlcmlmaWVk">(${fixtureBehavior.toString()})(${JSON.stringify({ canaryPath, pdfBase64: validPdfFixture().toString('base64') })});</script></body></html>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { origin: `http://127.0.0.1:${server.address().port}`, loads: () => loads,
    async close() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}

const shell = code => desktop.mainWindow.webContents.executeJavaScript(code, true);
const page = (side, code) => desktop.views[side].webContents.executeJavaScript(code, true);
const invoke = (method, payload) => shell(`window.convergeBrowser[${JSON.stringify(method)}](${payload === undefined ? '' : JSON.stringify(payload)})`);
async function waitFor(check, label, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 60)); }
  const state = await desktop.coordinator.getState();
  const details = {};
  for (const side of ['left', 'right', 'boss']) { try { details[side] = await page(side, '({sends:window.fixtureSends,turns:document.getElementById("turns")?.innerText?.slice(-9000),editor:document.getElementById("prompt-textarea")?.innerText,editorHtml:document.getElementById("prompt-textarea")?.innerHTML,sendHidden:document.getElementById("send")?.hidden,stopHidden:document.getElementById("stopFixture")?.hidden,viewport:[innerWidth,innerHeight],visibility:document.visibilityState,focus:document.activeElement?.id})'); } catch (_) {} }
  try { details.production = await invoke('diagnostics'); } catch (_) {}
  fs.writeFileSync(path.join(evidenceRoot, 'timeout.json'), JSON.stringify({ state, details, consoleMessages }, null, 2));
  throw new Error(`${label}: ${state.status} / ${state.stage} / ${state.error}`);
}
async function okay(method, payload) { const result = await invoke(method, payload); assert.equal(result.ok, true, `${method}: ${result.error || ''}`); return result; }
async function capture(name) {
  // Native view geometry acknowledges before Chromium paints the shell.
  // Capture the settled panel, not the previous composited frame.
  await new Promise(resolve => setTimeout(resolve, 250));
  const image = await Promise.race([desktop.mainWindow.capturePage(undefined, { stayHidden: true }),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Shell capture ${name} timed out.`)), 8_000))]);
  assert.equal(image.isEmpty(), false, 'The real Electron shell capture is empty.');
  const filename = path.join(evidenceRoot, `${name}.png`); fs.writeFileSync(filename, image.toPNG()); screenshots.push(filename);
}
function assertSnapshotBytes(snapshot, original) {
  assert.deepEqual(Buffer.from(snapshot.sources[0].base64, 'base64'), sourceBytes);
  assert.equal(snapshot.sources[0].contentSha256, sha256(sourceBytes));
  assert.equal(snapshot.revisions.length, original.revisions.length);
  for (const [index, record] of snapshot.revisions.entries()) {
    assert.equal(record.files[0].name, 'answer.js');
    assert.equal(record.files[0].base64, original.revisions[index].files[0].base64);
    assert.equal(record.files[0].contentSha256, sha256(Buffer.from(record.files[0].base64, 'base64')));
  }
}

async function run() {
  fixture = await createFixture();
  function blockRemote(browserSession) { browserSession.webRequest.onBeforeRequest((details, callback) => {
    let allowed = /^(file:|data:|blob:|about:|devtools:)/.test(details.url);
    if (!allowed) { const origin = new URL(details.url).origin; allowed = origin === fixture.origin; if (!allowed) blockedRemoteOrigins.add(origin); }
    callback({ cancel: !allowed });
  }); }
  blockRemote(session.defaultSession); app.on('web-contents-created', (_event, contents) => blockRemote(contents.session));
  desktop = await createCookieApp({ qaOrigin: fixture.origin, show: false, dialogs: {
    async showOpenDialog() { return { canceled: false, filePaths: openSelection }; },
    async showSaveDialog(first, second) { const options = second || first; const name = options?.defaultPath || '';
      return { canceled: false, filePath: /-files\.zip$/i.test(name) ? savedFilesPath : name === 'fixture-output.pdf' ? pdfDownloadPath : name === 'answer.js' ? revisionDownloadPath : /project\.zip$/i.test(name) ? archivePath : deliveryPath }; },
  } });
  desktop.mainWindow.setSize(1440, 960);
  desktop.mainWindow.webContents.on('console-message', event => consoleMessages.push({ side: 'shell', message: event.message, level: event.level }));
  for (const side of ['left', 'right', 'boss']) desktop.views[side].webContents.on('console-message', event => consoleMessages.push({ side, message: event.message, level: event.level }));
  await waitFor(() => shell('typeof window.convergeBrowser==="object" && !document.getElementById("previewNotice").offsetHeight'), 'Production shell did not initialize');
  const bootstrap = await invoke('bootstrap');
  assert.equal(bootstrap.hasSession, false); assert.equal(desktop.browserSession.storagePath, null);
  for (const view of Object.values(desktop.views)) {
    const preferences = view.webContents.getLastWebPreferences();
    assert.equal(preferences.sandbox, true); assert.equal(preferences.contextIsolation, true); assert.equal(preferences.nodeIntegration, false);
  }
  pass('Real production shell and sandboxed native chats use an empty in-memory account session.');
  const pdfBytes = validPdfFixture();
  const pdfFile = { name: 'fixture-page.pdf', mimeType: 'application/pdf', base64: pdfBytes.toString('base64'), contentSha256: sha256(pdfBytes), byteLength: pdfBytes.length };
  const pdfCandidate = { id: 'PDF-QA', answer: 'One genuine PDF page with a blue square.', files: [pdfFile] };
  pdfCandidate.sha256 = candidateDigest(pdfCandidate.answer, { files: [pdfFile] });
  pdfVerification = await runVerificationLab({ candidate: pdfCandidate, nodeExecutable: process.execPath, nativeImage, testMode: 'static' });
  assert.equal(pdfVerification.candidateSha256, pdfCandidate.sha256);
  for (const checkId of ['pdf-structure:fixture-page.pdf', 'pdf-rendering:fixture-page.pdf']) {
    const check = pdfVerification.checks.find(item => item.id === checkId); assert.ok(check, `Missing production PDF check ${checkId}`);
    assert.equal(check.status, 'passed', check.evidence);
  }
  assert.equal(pdfVerification.checks.find(item => item.id === 'execution-coverage').status, 'unverified');
  pass('The production Electron PDF worker parses and rasterizes a genuine one-page fixture with installed runtime dependencies; this gate uses the lab module directly.');
  await okay('importCookies', JSON.stringify([{ domain: '.chatgpt.com', name: 'converge_studio_offline_fixture', value: 'offline-only', path: '/', secure: true, session: true, sameSite: 'lax' }]));
  await okay('openPages', { chatMode: 'normal' });
  await okay('attachFiles');
  for (const side of ['left', 'right', 'boss']) assert.deepEqual(await page(side, 'window.fixtureUploads[0]'), [{ name: 'original.js.txt', size: sourceBytes.length, type: 'text/plain' }]);
  pass('The shell native source picker transfers the complete original JavaScript bytes to all three browser file inputs.');
  const studio = { preset: 'software', freshAudit: true, verificationEnabled: true, verificationMode: 'static', acceptanceCriteria: ['Deliver the complete answer.js file.'] };
  await okay('start', { question: 'Create and refine a complete downloadable JavaScript source file using the original.', relayMedia: true, requireFiles: true, reviewMode: 'improve', maxRounds: 6, studio });
  await waitFor(async () => { const state = await desktop.coordinator.getState(); if (['error', 'blocked'].includes(state.status)) throw new Error(state.error); return state.status === 'agreed'; }, 'Default studio workflow did not finish', 180_000);
  const result = await desktop.coordinator.getState();
  assert.equal(result.round, 4); assert.equal(result.studio.freshAudit.status, 'passed');
  assert.equal(result.studio.freshAudit.candidateSha256, result.candidate.sha256);
  assert.equal(fixture.loads(), 4); assert.ok(result.studio.requirements.every(item => item.status === 'met'));
  const original = await desktop.coordinator.exportProject();
  assert.equal(original.revisions.length, 4); assert.equal(new Set(original.revisions.map(item => item.files[0].name)).size, 1);
  assert.equal(new Set(original.revisions.map(item => item.files[0].contentSha256)).size, 4);
  assert.equal(fs.existsSync(canaryPath), false, 'Static verification executed the generated candidate.');
  pass('Four actual file revision cycles finish with native syntax checks, explicit criteria, and a newly opened worker final audit.');
  const currentReport = result.studio.verification;
  assert.equal(currentReport.candidateSha256, result.candidate.sha256);
  assert.ok(currentReport.checks.some(check => /javascript-syntax/.test(check.id) && check.source === 'executed' && check.status === 'passed'));
  assert.ok(currentReport.checks.some(check => check.id === 'execution-coverage' && check.status === 'unverified'));
  assert.equal(currentReport.status, 'unverified');
  pass('The real local report binds the candidate SHA-256, passes Node syntax parsing, and keeps unexecuted runtime coverage visibly unverified.');
  const firstPreview = await okay('studioRevisionPreview', { revisionId: original.revisions[0].id, fileId: 'answer.js' });
  const lastPreview = await okay('studioRevisionPreview', { revisionId: original.revisions[3].id, fileId: 'answer.js' });
  assert.equal(firstPreview.sha256, original.revisions[0].files[0].contentSha256);
  assert.equal(lastPreview.sha256, original.revisions[3].files[0].contentSha256);
  assert.notEqual(firstPreview.text, lastPreview.text);
  pass('Native revision preview IPC resolves two identically named files to their distinct exact historical contents.');
  await shell('document.getElementById("openStudio").click()');
  await waitFor(() => Object.values(desktop.views).every(view => view.getBounds().width === 0 && view.getBounds().height === 0), 'Studio did not clear native chat bounds');
  await capture('studio-brief');
  await shell('document.getElementById("studioTab-revisions").click()'); await capture('studio-revisions');
  await shell('document.querySelector(".studio-close").click()');
  await waitFor(() => desktop.views.left.getBounds().height > 650 && desktop.views.right.getBounds().height > 650, 'Tall chat bounds did not return after closing studio');
  const reopenedBounds = Object.fromEntries(Object.entries(desktop.views).map(([side, view]) => [side, view.getBounds()]));
  await capture('studio-closed-tall-chats');
  pass('The real Studio drawer clears all three native view bounds; closing it restores tall, usable worker chats.');
  await okay('issueReview', { title: 'Fixture review observation', status: 'found', severity: 'low', evidence: 'An offline reviewer requested another check.' });
  await okay('issueReview', { id: 'I1', status: 'assigned', assignedTo: 'left', evidence: 'Worker A owns the observation.' });
  await okay('issueReview', { id: 'I1', status: 'fixed', evidence: 'The current revision addresses the observation.' });
  await okay('issueReview', { id: 'I1', status: 'rechecked', evidence: 'A user independently inspected the exact current source.' });
  assert.deepEqual((await desktop.coordinator.getState()).studio.issues[0].history.map(item => item.status), ['found', 'assigned', 'fixed', 'rechecked']);
  pass('Shell IPC records found, assigned, fixed and rechecked issue evidence against the selected revision.');
  const saved = await okay('projectSave', { name: 'Native studio QA · same-name revisions' });
  const listed = await okay('projectList');
  assert.ok(listed.projects.some(project => project.id === saved.project.id && project.revisionCount === 4));
  await okay('projectExport');
  const archived = readZip(fs.readFileSync(archivePath));
  const metadata = JSON.parse(archived.get('project.json').toString());
  assert.equal(metadata.project.snapshot.revisions.length, 4);
  for (const record of original.revisions) assert.equal(sha256(archived.get(`blobs/${record.files[0].contentSha256}.blob`)), record.files[0].contentSha256);
  assert.equal(sha256(archived.get(`blobs/${sha256(sourceBytes)}.blob`)), sha256(sourceBytes));
  const exportedText = JSON.stringify(metadata.project.snapshot.state);
  assert.equal(exportedText.includes('converge_studio_offline_fixture'), false);
  assert.equal(metadata.project.snapshot.state.pages, undefined); assert.equal(metadata.project.snapshot.state.pending, undefined);
  pass('Real save/list/export dialogs persist the original and all four same-name revision byte identities in a portable ZIP without browser session state.');
  await okay('restoreRevision', { id: original.revisions[0].id });
  const restored = await desktop.coordinator.getCurrentCandidate();
  assert.equal(restored.files[0].base64, original.revisions[0].files[0].base64);
  assert.deepEqual((await desktop.coordinator.getState()).acceptedBy, {});
  assert.equal((await desktop.coordinator.getState()).studio.verification.status, 'idle');
  pass('Native revision restoration selects the actual earlier bytes and invalidates prior final acceptance and tool authority.');
  await okay('verificationRun');
  await waitFor(async () => (await desktop.coordinator.getState()).studio.verification.status !== 'running', 'Manual native verification did not finish');
  const earlierReport = (await desktop.coordinator.getState()).studio.verification;
  assert.equal(earlierReport.candidateSha256, restored.sha256);
  assert.ok(earlierReport.checks.some(check => check.status === 'passed' && /javascript-syntax/.test(check.id)));
  assert.equal(fs.existsSync(canaryPath), false);
  await okay('deliveryExport');
  const delivery = readZip(fs.readFileSync(deliveryPath));
  const manifestBytes = delivery.get('manifest.json'), manifest = JSON.parse(manifestBytes.toString());
  assert.equal(manifest.candidateSha256, restored.sha256);
  assert.equal(delivery.get('files/answer.js').toString('base64'), restored.files[0].base64);
  for (const entry of manifest.files) { assert.equal(sha256(delivery.get(entry.name)), entry.sha256); assert.equal(delivery.get(entry.name).length, entry.byteLength); }
  assert.ok(delivery.get('manifest.sha256').toString().startsWith(sha256(manifestBytes)));
  const packagedReport = JSON.parse(delivery.get('verification.json').toString());
  assert.equal(packagedReport.candidateSha256, restored.sha256); assert.equal(packagedReport.status, 'unverified');
  assert.notEqual(manifest.workflowStatus, 'agreed');
  pass('Real manual verification and delivery dialogs export exact restored source bytes, matching report hashes, every content checksum and honest partial completion status.');
  const loaded = await okay('projectLoad', { id: saved.project.id });
  assert.equal(loaded.reconnectRequired, true); assert.equal(loaded.state.status, 'idle');
  assert.equal(loaded.state.studio.verification.status, 'idle'); assertSnapshotBytes(await desktop.coordinator.exportProject(), original);
  pass('Loading the disk project reconstructs original and revision bytes while requiring fresh chat ownership and verification.');
  const detachedCandidate = await desktop.coordinator.getCurrentCandidate();
  await okay('studioRevisionSave', { revisionId: loaded.state.studio.preferredRevisionId, fileId: 'answer.js', fileIndex: 0 });
  assert.equal(fs.readFileSync(revisionDownloadPath).toString('base64'), detachedCandidate.files[0].base64);
  const detachedDownload = await okay('studioProjectDownload', { id: saved.project.id });
  const detachedFiles = readZip(fs.readFileSync(savedFilesPath));
  assert.equal(detachedDownload.fileCount, 1);
  assert.equal(detachedFiles.get('files/answer.js').toString('base64'), detachedCandidate.files[0].base64);
  assert.equal((await desktop.coordinator.getState()).status, 'idle');
  assert.equal(fixture.loads(), 4, 'Downloading saved files reconnects or changes remote chats');
  pass('Disconnected saved projects expose exact individual revision downloads and a saved-file ZIP through production preload IPC without opening remote chats.');
  openSelection = [archivePath];
  const imported = await okay('projectImport');
  assert.equal(imported.reconnectRequired, true); assert.equal(imported.state.status, 'idle');
  assertSnapshotBytes(await desktop.coordinator.exportProject(), original);
  await okay('openPages', { chatMode: 'normal' });
  const connected = await desktop.coordinator.getState();
  assert.equal(connected.status, 'blocked'); assert.equal(connected.candidate.sha256, original.revisions[3].candidate.sha256);
  assert.equal(connected.question, original.state.question); assert.equal(connected.runId, null);
  pass('Importing the real exported ZIP and reconnecting new native chats preserves the saved brief and selected revision without resuming stale requests.');
  await shell('document.getElementById("openStudio").click();document.getElementById("studioTab-projects").click()');
  await waitFor(() => Object.values(desktop.views).every(view => view.getBounds().width === 0), 'Reopened Studio bounds did not clear');
  await capture('studio-projects-imported');
  await page('boss', 'window.fixtureHoldResponses=true');
  await okay('bossMessage', { text: 'Continue the saved exact candidate with a focused check.' });
  await waitFor(async () => (await desktop.coordinator.getState()).status === 'running' && (await page('boss', 'window.fixtureSends.length')) > 0,
    'The retained-project running download fixture did not start');
  const beforeDownload = await desktop.coordinator.getState();
  const pendingRequestIds = Object.values(beforeDownload.pending).map(request => request.requestId);
  const activeCandidate = await desktop.coordinator.getCurrentCandidate();
  await okay('studioRevisionSave', { revisionId: beforeDownload.studio.preferredRevisionId, fileId: 'answer.js', fileIndex: 0 });
  assert.equal(fs.readFileSync(revisionDownloadPath).toString('base64'), activeCandidate.files[0].base64);
  await okay('studioProjectDownload', { id: imported.project.id });
  assert.equal(readZip(fs.readFileSync(savedFilesPath)).get('files/answer.js').toString('base64'), activeCandidate.files[0].base64);
  const afterDownload = await desktop.coordinator.getState();
  assert.equal(afterDownload.status, 'running'); assert.equal(afterDownload.runId, beforeDownload.runId);
  assert.deepEqual(Object.values(afterDownload.pending).map(request => request.requestId), pendingRequestIds);
  assert.equal(await page('boss', 'window.fixtureSends.length'), 1, 'Saved-file downloads cause duplicate tracked prompts');
  pass('Running project and revision downloads retain exact candidate bytes, live run identity and the original owned request without duplicate prompts or cancellation.');
  await okay('stop');
  await okay('resetChats');
  await okay('openPages', { chatMode: 'normal' });
  fs.writeFileSync(designReferencePath, pdfBytes);
  openSelection = [designReferencePath];
  await okay('attachFiles', { fileRole: 'style-reference' });
  const referenceState = await desktop.coordinator.getState();
  assert.deepEqual(referenceState.studio.settings.documentDesign.referenceNames, ['style-reference.pdf']);
  for (const side of ['left', 'right', 'boss']) {
    assert.deepEqual(await page(side, 'window.fixtureUploads[0]'), [{ name: 'style-reference.pdf', size: pdfBytes.length, type: 'application/pdf' }]);
    await page(side, 'window.fixtureDocument=true');
  }
  pass('A native design-reference picker preserves real PDF bytes in all three chats and records appearance-only reference identities separately from content sources.');
  await okay('start', { question: 'Create a PDF report containing one blue square. Match the attached design reference for appearance only.',
    relayMedia: true, requireFiles: true, reviewMode: 'improve', maxRounds: 6,
    studio: { preset: 'auto', freshAudit: false, verificationEnabled: true,
      documentDesign: { profile: 'reference', referenceNames: ['style-reference.pdf'], notes: 'Match the reference square and its page size.' } } });
  await waitFor(async () => { const state = await desktop.coordinator.getState();
    if (['error', 'blocked', 'limit_reached'].includes(state.status)) throw new Error(state.error || state.stage);
    return state.status === 'agreed'; }, 'Document reference workflow did not finish', 180_000);
  const documentResult = await desktop.coordinator.getState();
  for (const id of ['document-content', 'document-layout', 'document-reference-style']) {
    const requirement = documentResult.studio.requirements.find(item => item.id === id);
    assert.equal(requirement?.status, 'met', `${id}: ${JSON.stringify(requirement)}`);
    assert.equal(requirement.source, 'model', 'Offline model-report test data must not become executed aesthetic evidence.');
  }
  const documentStructure = documentResult.studio.verification.checks.find(check => check.id === 'pdf-structure:fixture-output.pdf');
  assert.equal(documentStructure.pageCount, 1);
  const firstBoss = await page('boss', 'window.fixtureSends[0].text');
  assert.ok(firstBoss.includes('style-reference.pdf') && firstBoss.includes(sha256(pdfBytes)));
  assert.equal(JSON.parse(firstBoss.split('BEGIN_BOSS_CONTEXT_JSON\n')[1].split('\nEND_BOSS_CONTEXT_JSON')[0]).originals[0].role, 'style-reference');
  const documentCandidate = await desktop.coordinator.getCurrentCandidate();
  await okay('saveFiles', { candidateId: documentCandidate.id, sha256: documentCandidate.sha256 });
  assert.deepEqual(fs.readFileSync(pdfDownloadPath), pdfBytes);
  pass('Automatic PDF production carries the exact reference design to the boss and workers, requires separate full-page model review gates, binds host-parsed page count, and downloads the original verified PDF bytes. The model review is offline fixture data, not a quality judgement.');
  assert.deepEqual(consoleMessages.filter(item => /uncaught|unhandled|FIXTURE ERROR/i.test(item.message)), []);
  completed = true;
  fs.writeFileSync(path.join(evidenceRoot, packagedAsar ? 'packaged-result.json' : 'result.json'), JSON.stringify({ passed: true,
    localFixturesOnly: true, platform: process.platform, packageVersion, launcherVersion: app.getVersion(), bootstrapVersion: bootstrap.version,
    tests, screenshots, consoleMessages, blockedRemoteOrigins: [...blockedRemoteOrigins], profileRoot,
    sourceSha256: sha256(sourceBytes), revisionIdentities: original.revisions.map(item => ({ id: item.id, candidateSha256: item.candidate.sha256,
      files: item.files.map(({ base64: _base64, ...file }) => file) })), finalCandidateId: result.candidate.id,
    freshAudit: result.studio.freshAudit, nativeVerification: currentReport, restoredVerification: earlierReport, pdfVerification,
    documentQuality: { candidateId: documentResult.candidate.id, candidateSha256: documentResult.candidate.sha256,
      requirements: documentResult.studio.requirements, hostPageCount: documentStructure.pageCount, downloadedSha256: sha256(fs.readFileSync(pdfDownloadPath)), modelReviewIsOfflineFixture: true },
    reopenedBounds, projectArchiveSha256: sha256(fs.readFileSync(archivePath)), deliveryArchiveSha256: sha256(fs.readFileSync(deliveryPath)),
    manifest, generatedProgramExecuted: fs.existsSync(canaryPath), ...(packagedAsar ? { packagedAsar } : {}) }, null, 2));
}

app.whenReady().then(run).catch(async error => {
  process.stderr.write(`FAIL: ${error.stack || error.message}\n`);
  const failureState = desktop ? await desktop.coordinator.getState().catch(() => null) : null;
  fs.writeFileSync(path.join(evidenceRoot, packagedAsar ? 'packaged-result.json' : 'result.json'), JSON.stringify({ passed: false,
    localFixturesOnly: true, tests, error: error.stack || error.message, consoleMessages, failureState }, null, 2));
}).finally(async () => {
  if (desktop) { await desktop.coordinator.dispose().catch(() => {}); if (!desktop.mainWindow.isDestroyed()) desktop.mainWindow.close(); }
  if (fixture) await fixture.close();
  app.exit(completed ? 0 : 1);
});
