'use strict';

// Real desktop UI, sandboxed preloads, Electron IPC and two native page views.
// Only the model responses are simulated by a localhost fixture. Every remote
// request is blocked. No live ChatGPT account, Chrome profile, or real cookie
// export is opened. Run with: electron scripts/qa-desktop-cookie.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { app, session } = require('electron');
const { createFixtureServer, makePdf, makeEaSource } = require('./qa-desktop-fixture');

const root = path.join(__dirname, '..');
const packagedAsar = process.env.CONVERGE_PACKAGED_ASAR && path.resolve(process.env.CONVERGE_PACKAGED_ASAR);
const productionRoot = packagedAsar || root;
const packageMetadata = JSON.parse(fs.readFileSync(path.join(productionRoot, 'package.json'), 'utf8'));
if (packagedAsar) app.setAppPath(packagedAsar);
const { createCookieApp } = require(path.join(productionRoot, 'desktop-main.js'));
const profileRoot = fs.mkdtempSync(path.join(app.getPath('temp'), 'converge-desktop-qa-'));
app.setPath('userData', profileRoot);
const log = [];
const captureWarnings = [];
const capturedScreenshots = [];
const pageConsole = [];
const output = path.join(root, 'desktop-cookie-studio.png');
const layoutOnly = process.argv.includes('--layout-only');
const clearOnly = process.argv.includes('--clear-session-only');
const reportPath = path.join(root, packagedAsar ? 'desktop-cookie-packaged-qa-result.json' :
  clearOnly ? 'desktop-cookie-clear-session-qa-result.json' : layoutOnly ? 'desktop-cookie-layout-qa-result.json' : 'desktop-cookie-qa-result.json');
const progressPath = path.join(root, 'desktop-cookie-qa-progress.json');
let fixture;
let desktop;
let completed = false;
const sourcePdfPath = path.join(profileRoot, 'source-evidence.pdf');
const savedPdfPath = path.join(profileRoot, 'saved-corrected-report.pdf');
const savedCurrentPdfPath = path.join(profileRoot, 'saved-current-report.pdf');
const sourcePdf = makePdf('Source evidence: 2 + 2 = 4. Review the report and correct any contrary claim.');
fs.writeFileSync(sourcePdfPath, sourcePdf);
const sourceEaPath = path.join(profileRoot, 'abcccdalgo.txt');
const savedEaPath = path.join(profileRoot, 'qa-risk-corrected.mq5');
const sourceEa = makeEaSource();
fs.writeFileSync(sourceEaPath, sourceEa);
let selectedSourcePath = sourcePdfPath;
let eaRegression = null;
let openDialogCalls = 0;
let saveDialogCalls = 0;

function pass(message) {
  log.push(message);
  progress(message);
  process.stdout.write(`PASS: ${message}\n`);
}

function progress(stage) {
  fs.writeFileSync(progressPath, JSON.stringify({ timestamp: new Date().toISOString(), stage,
    passedStages: log.length, packagedAsar: packagedAsar || null }, null, 2));
}

function boundedCapture(promise, description) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() =>
    reject(new Error(`${description} did not complete within 5 seconds.`)), 5000); })]).finally(() => clearTimeout(timer));
}

async function waitFor(check, description, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const state = desktop ? await desktop.coordinator.getState() : {};
  if (desktop) {
    const diagnostic = { state, pages: {}, pageConsole };
    diagnostic.shell = await shell(`({sessionBadge:document.getElementById('sessionBadge').textContent,
      clearDisabled:document.getElementById('clearSession').disabled,clearHidden:document.getElementById('clearSession').hidden,
      sessionError:document.getElementById('sessionError').textContent,actionError:document.getElementById('actionError').textContent})`);
    diagnostic.hostHasSession = (await shell('window.convergeBrowser.bootstrap()')).hasSession;
    diagnostic.fixtureCookieCount = (await desktop.browserSession.cookies.get({ name: 'converge_fixture' })).length;
    for (const side of ['left', 'right']) {
      try {
        diagnostic.pages[side] = await Promise.race([page(side, `({url:location.href,
          sends:window.fixtureSends?.map(item=>({files:item.files,text:item.text.slice(0,4000),textLength:item.text.length})),uploads:window.fixtureUploads,
          editor:document.getElementById('prompt-textarea')?.innerText?.slice(0,4000),sendHidden:document.getElementById('send')?.hidden,
          stopHidden:document.getElementById('stopFixture')?.hidden,turns:document.getElementById('turns')?.innerText?.slice(-6000)})`),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Fixture renderer diagnostic did not respond within 3s.')), 3000))]);
        diagnostic.pages[side].bridge = await Promise.race([desktop.sendToPage(side, { type: 'DIAGNOSTICS' }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Isolated bridge diagnostic did not respond within 3s.')), 3000))]);
      } catch (error) { diagnostic.pages[side] = { error: error.message }; }
    }
    fs.writeFileSync(path.join(root, 'desktop-cookie-timeout-diagnostics.json'), JSON.stringify(diagnostic, null, 2));
  }
  throw new Error(`${description}: ${state.status || 'no app'} / ${state.stage || ''} / ${state.error || ''}`);
}

const shell = (code) => desktop.mainWindow.webContents.executeJavaScript(code, true);
const page = (side, code) => desktop.views[side].webContents.executeJavaScript(code, true);
const click = (id) => shell(`document.getElementById(${JSON.stringify(id)}).click()`);

async function startFromUI(question) {
  await shell(`document.getElementById('question').value=${JSON.stringify(question)};
    document.getElementById('question').dispatchEvent(new Event('input',{bubbles:true}));
    document.getElementById('reviewMode').value='auto';document.getElementById('reviewMode').dispatchEvent(new Event('change',{bubbles:true}));
    document.getElementById('maxRounds').value='4';document.getElementById('relayMedia').checked=true;`);
  await waitFor(() => shell(`!document.getElementById('start').disabled`), 'Start was not enabled after page setup');
  await click('start');
}

async function selectModeAndOpen(chatMode) {
  const id = { normal: 'modeNormal', temporary: 'modeTemporary', work: 'modeWork' }[chatMode];
  await shell(`document.getElementById(${JSON.stringify(id)}).checked=true;
    document.getElementById(${JSON.stringify(id)}).dispatchEvent(new Event('change',{bubbles:true}));`);
  await waitFor(() => shell(`!document.getElementById('openPages').disabled`), 'OK was not enabled for the selected type');
  await click('openPages');
  await waitFor(async () => {
    const state = await desktop.coordinator.getState();
    return state.status === 'setup' && state.chatMode === chatMode && state.pages.left.ready && state.pages.right.ready;
  }, `Both ${chatMode} chats did not become ready`, 60_000);
}

async function resetChats() {
  await waitFor(() => shell(`!document.getElementById('resetChats').disabled`), 'Reset chats was not enabled');
  await click('resetChats');
  await waitFor(async () => {
    const state = await desktop.coordinator.getState();
    return state.status === 'idle' && state.tabIds.left == null && state.tabIds.right == null;
  }, 'Reset did not unload the pair');
  assert.equal(desktop.views.left.webContents.getURL(), 'about:blank');
  assert.equal(desktop.views.right.webContents.getURL(), 'about:blank');
  assert.equal((await desktop.browserSession.cookies.get({ name: 'converge_fixture' })).length, 1, 'Reset must retain the imported session cookie.');
  assert.equal(await shell(`document.getElementById('sessionBadge').textContent`), 'Imported');
}

async function awaitAgreement(description = 'Automatic two-page exchange failed') {
  await waitFor(async () => {
    const state = await desktop.coordinator.getState();
    if (state.status === 'error') throw new Error(state.error);
    return state.status === 'agreed';
  }, description, 90_000);
  return desktop.coordinator.getState();
}

async function changeResponseMode(mode, sides = ['left', 'right']) {
  for (const side of sides) await page(side, `window.fixtureResponseMode=${JSON.stringify(mode)}`);
}

async function verifyEaTransport() {
  await resetChats();
  fixture.setMode('ea-native');
  await selectModeAndOpen('normal');
  selectedSourcePath = sourceEaPath;
  await waitFor(() => shell(`!document.getElementById('attachFiles').disabled`), 'EA Attach did not enable');
  await click('attachFiles');
  await waitFor(async () => (await desktop.coordinator.getState()).attachments.status === 'attached', 'Original .txt EA source did not attach to both pages');
  assert.equal(openDialogCalls, 2);
  for (const side of ['left', 'right']) assert.deepEqual(await page(side, 'window.fixtureUploads[0]'),
    [{ name: 'abcccdalgo.txt', type: 'text/plain', size: sourceEa.length }]);
  pass('Native Attach accepts an original .txt EA source on both isolated pages without executing its code.');

  await startFromUI('Correct the attached MQL5 EA source abcccdalgo.txt, set MaxLossUsd to 20.0 while preserving FixedLots 0.01 and provide the complete downloadable .mq5 file. This offline task checks source editing and transport only.');
  const state = await awaitAgreement('Generated .mq5 source revision did not complete its two-page review');
  assert.equal(state.codeTask, true);
  assert.equal(state.mql5Task, true);
  assert.equal(state.codeOutputExtension, 'mq5');
  assert.equal(state.requireFiles, true);
  assert.equal(state.requirePdf, false);
  assert.equal(state.candidate.id, 'C2');
  assert.equal(state.revisionCount, 1);
  assert.deepEqual(state.candidate.media.files.map(({ name, mimeType }) => ({ name, mimeType })),
    [{ name: 'qa-risk-corrected.mq5', mimeType: 'text/plain' }]);
  const turns = Object.fromEntries(await Promise.all(['left', 'right'].map(async (side) => [side, await page(side, 'window.fixtureSends')])));
  verifyFourRounds(state, [...turns.left, ...turns.right]);
  const digest = bytes => createHash('sha256').update(bytes).digest('hex');
  const readbackChecks = [];
  for (const side of ['left', 'right']) {
    assert.deepEqual(turns[side][0].files, [{ name: 'abcccdalgo.txt', type: 'text/plain', size: sourceEa.length }]);
    assert.equal(digest(Buffer.from(turns[side][0].fileBytes[0].base64, 'base64')), digest(sourceEa));
    for (const review of turns[side].slice(1)) {
      const candidateId = review.text.replace(/\s+/g, ' ').match(/Current candidate ID: (C\d+)/)?.[1];
      const snapshotBlocks = [...review.text.matchAll(/BEGIN_ORIGINAL_SOURCE_SNAPSHOT_JSON\s*\n([\s\S]*?)\nEND_ORIGINAL_SOURCE_SNAPSHOT_JSON/g)];
      assert.equal(snapshotBlocks.length, 1, 'Every EA review needs exactly one complete original-source snapshot block.');
      const snapshots = JSON.parse(snapshotBlocks[0][1]);
      assert.deepEqual(snapshots, [{ name: 'abcccdalgo.txt', text: sourceEa.toString('utf8') }],
        'The review must retain the complete decoded original source, including all whitespace and code.');
      const peer = review.fileBytes.find(file => /\.mq5\.txt$/.test(file.name));
      assert.equal(review.files.length, 1, 'EA review must attach only the exact generated candidate; original source is provided in full as prompt data.');
      assert.equal(review.fileBytes.length, 1);
      assert.ok(peer, 'EA review needs a .mq5.txt peer attachment.');
      assert.ok(!review.fileBytes.some(file => file.name.startsWith('ORIGINAL_SOURCE_')),
        'Readable original EA source must not be repeatedly reuploaded.');
      assert.equal(peer.name, candidateId === 'C2' ? 'qa-risk-corrected.mq5.txt' : 'qa-risk-initial.mq5.txt');
      assert.deepEqual(Buffer.from(peer.base64, 'base64'), makeEaSource(candidateId === 'C2'));
      assert.equal(review.files.find(file => file.name === peer.name).type, 'text/plain');
      const candidateReadbackBlocks = [...review.text.matchAll(/BEGIN_CURRENT_CANDIDATE_SOURCE_JSON\s*\n([\s\S]*?)\nEND_CURRENT_CANDIDATE_SOURCE_JSON/g)];
      assert.equal(candidateReadbackBlocks.length, 1, 'Every EA review needs one complete verified current-candidate source readback.');
      const candidateReadbacks = JSON.parse(candidateReadbackBlocks[0][1]);
      const candidateBytes = Buffer.from(peer.base64, 'base64');
      const canonicalCandidateName = peer.name.slice(0, -'.txt'.length);
      assert.deepEqual(candidateReadbacks, [{ candidateId, name: canonicalCandidateName,
        sourceSha256: digest(candidateBytes), byteLength: candidateBytes.length, text: candidateBytes.toString('utf8') }],
        'Current candidate JSON must identify the exact reviewed candidate and preserve its complete attached-byte source text.');
      assert.match(review.text.slice(review.text.lastIndexOf('END_CURRENT_CANDIDATE_SOURCE_JSON')).replace(/\s+/g, ' ').trim(),
        /Exchange tracking ID \(do not include in your response\): \S+\s*$/,
        'The exact submission tracking marker must remain last after the readback.');
      readbackChecks.push({ side, candidateId, peerName: peer.name, peerSha256: digest(Buffer.from(peer.base64, 'base64')),
        originalName: snapshots[0].name, originalSnapshotChars: snapshots[0].text.length,
        originalSnapshotSha256: digest(Buffer.from(snapshots[0].text, 'utf8')), originalSnapshotComplete: true,
        candidateReadbackName: candidateReadbacks[0].name, candidateReadbackSha256: candidateReadbacks[0].sourceSha256,
        candidateReadbackBytes: candidateReadbacks[0].byteLength, candidateReadbackChars: candidateReadbacks[0].text.length,
        candidateReadbackComplete: true, candidateReadbackMatchesAttachment: true });
    }
  }
  assert.equal(readbackChecks.length, 8);
  assert.ok(readbackChecks.some(item => item.candidateId === 'C1'));
  assert.ok(readbackChecks.some(item => item.candidateId === 'C2'));
  assert.equal(state.candidate.media.files[0].contentSha256, digest(makeEaSource(true)));
  const inlineOutputControls = Object.fromEntries(await Promise.all(['left', 'right'].map(async side => [side,
    await page(side, `Array.from(document.querySelectorAll('span[role="button"][data-file-reference="true"]')).map(element=>({
      tag:element.tagName,role:element.getAttribute('role'),label:element.getAttribute('aria-label'),
      filename:element.getAttribute('data-markdown-copy-text'),href:element.getAttribute('href'),download:element.getAttribute('download')}))`)])));
  for (const side of ['left', 'right']) {
    assert.ok(inlineOutputControls[side].length > 0);
    for (const control of inlineOutputControls[side]) {
      assert.equal(control.tag, 'SPAN'); assert.equal(control.role, 'button');
      assert.equal(control.label, `Download ${control.filename}`);
      assert.match(control.filename, /^qa-risk-(?:initial|corrected)\.mq5$/);
      assert.equal(control.href, null); assert.equal(control.download, null);
    }
  }
  pass('Live-shaped inline .mq5 Download spans are detected, changed bytes become C2, and eight fresh reviews receive complete original and verified current-candidate JSON source readbacks plus one byte-identical .mq5.txt candidate alias across four rounds.');

  await waitFor(() => shell(`!document.getElementById('saveFiles').disabled`), 'Accepted .mq5 Save did not enable');
  await click('saveFiles');
  await waitFor(() => fs.existsSync(savedEaPath), 'Host Save did not write the accepted .mq5 source');
  const saved = fs.readFileSync(savedEaPath);
  assert.deepEqual(saved, makeEaSource(true));
  assert.equal(path.extname(savedEaPath), '.mq5');
  assert.equal(digest(saved), state.candidate.media.files[0].contentSha256);
  assert.equal(saveDialogCalls, 3);
  pass('Host Save preserves the generated .mq5 extension and exactly matches the revised file SHA-256 checked by both reviewers.');
  eaRegression = { originalName: path.basename(sourceEaPath), originalSha256: digest(sourceEa),
    originalTransport: { initialUploadExactBytes: true, laterReviews: 'complete decoded source in BEGIN_ORIGINAL_SOURCE_SNAPSHOT_JSON prompt data', repeatedSourceUploads: false },
    candidateTransport: { peerAttachmentAliasExactBytes: true, canonicalFilenamePreserved: true,
      laterReviews: 'complete decoded current source with candidate ID, attached-byte SHA-256 and byte length in BEGIN_CURRENT_CANDIDATE_SOURCE_JSON',
      completeReadbacks: readbackChecks.length, readbacksMatchCandidateAttachments: true, finalTrackingMarkerPreserved: true },
    candidateName: state.candidate.media.files[0].name, candidateSha256: digest(saved), nativeSavedPath: savedEaPath,
    fullRounds: state.round, actualRevisionCount: state.revisionCount, reviewReadbacks: readbackChecks, inlineOutputControls,
    noSourceExecuted: true, simulatedModelReplies: true, externalNetworkAllowed: false };

  const ids = state.tabIds;
  await changeResponseMode('arithmetic');
  await startFromUI('What is 4 + 6?');
  const arithmetic = await awaitAgreement('Next arithmetic command retained a stale EA file gate');
  assert.deepEqual(arithmetic.tabIds, ids);
  assert.equal(arithmetic.reviewMode, 'verify');
  assert.equal(arithmetic.round, 1);
  assert.equal(arithmetic.requireFiles, false);
  assert.equal(arithmetic.codeTask, false);
  assert.equal(arithmetic.mql5Task, false);
  assert.equal(arithmetic.codeOutputExtension, '');
  assert.deepEqual(arithmetic.requiredWork, []);
  assert.equal(arithmetic.transcript.filter(entry => entry.role === 'review').length, 2);
  eaRegression.nextArithmetic = { samePair: true, reviewSteps: 2, clearedCodeFileEvidenceGates: true };
  pass('A next arithmetic command reuses the same EA chats, clears source/file/code/evidence requirements and finishes two independent verification steps.');

  await changeResponseMode('ea-missing-backtest');
  await startFromUI('Improve the MQL5 EA and backtest it with at least 6 months of data using native MT5 Strategy Tester; attach the actual native tester report alongside the corrected .mq5 source.');
  await waitFor(async () => {
    const current = await desktop.coordinator.getState();
    if (current.status === 'error') throw new Error(current.error);
    return !['running', 'setup', 'idle'].includes(current.status);
  }, 'Missing requested backtest evidence did not reach an unfinished terminal state', 90_000);
  const unfinished = await desktop.coordinator.getState();
  assert.notEqual(unfinished.status, 'agreed', 'Two accepting reviews must not complete a requested MT5 backtest without its report.');
  assert.ok(unfinished.requiredWork.some(item => item.id === 'mt5-backtest'));
  const unverifiedReviews = unfinished.transcript.filter(entry => entry.role === 'review');
  assert.ok(unverifiedReviews.length >= 2 && unverifiedReviews.every(entry => /^ACCEPT\b/.test(entry.text)), 'The gate must block completion even when every model review accepts the source.');
  assert.deepEqual([...new Set(unverifiedReviews.map(entry => entry.side))].sort(), ['left', 'right']);
  assert.ok(unfinished.issues.some(issue => issue.taskRequirementId === 'mt5-backtest' && !issue.resolved), 'The required native report must remain explicitly unresolved.');
  assert.match(`${unfinished.stage} ${unfinished.error}`, /backtest|report|evidence|work|unfinished|incomplete/i);
  eaRegression.missingNativeEvidence = { status: unfinished.status, requiredWork: unfinished.requiredWork, workEvidence: unfinished.workEvidence,
    agreementBlocked: true, noBacktestExecuted: true };
  pass('Missing requested six-month native MT5 report keeps the task unfinished even when reviewers accept the source; no live trading or tester execution is performed.');
  selectedSourcePath = sourcePdfPath;
}

async function verifyExpansion() {
  await shell(`if(document.getElementById('toggleSidebar').getAttribute('aria-expanded')==='true')document.getElementById('toggleSidebar').click()`);
  await waitFor(() => desktop.views.left.getVisible() && desktop.views.right.getVisible(), 'Both native pages were not visible');
  await waitFor(async () => {
    const slot = await shell(`(()=>{const r=document.getElementById('leftSlot').getBoundingClientRect();return {x:Math.round(r.x),width:Math.round(r.width)}})()`);
    const view = desktop.views.left.getBounds(); return view.x === slot.x && view.width === slot.width;
  }, 'Closed controls did not restore the full-width native split');
  const previous = desktop.views.right.getBounds();
  await click('expandRight');
  await waitFor(() => !desktop.views.left.getVisible() && desktop.views.right.getVisible() &&
    desktop.views.right.getBounds().width > previous.width * 1.6, 'Expand B did not resize and hide the opposite native view');
  const [width, height] = desktop.mainWindow.getContentSize();
  const expanded = desktop.views.right.getBounds();
  assert.ok(expanded.x >= 0 && expanded.y >= 0 && expanded.x + expanded.width <= width && expanded.y + expanded.height <= height);
  await click('restoreSplit');
  await waitFor(() => desktop.views.left.getVisible() && desktop.views.right.getVisible() &&
    desktop.views.right.getBounds().width <= previous.width + 2, 'Restore split did not return both native views');
  pass('Expand B hides A and enlarges only B inside the shell; Restore split returns both native page bounds.');
}

function verifyFourRounds(state, sends = []) {
  assert.equal(state.minReviewRounds, 4);
  assert.ok(state.round >= 4, 'An improvement fixture stopped before four full rounds');
  const reviews = state.transcript.filter((entry) => entry.role === 'review');
  assert.equal(reviews.length, 8, 'Four rounds must contain eight real reviewer responses');
  for (let round = 1; round <= 4; round += 1) {
    assert.deepEqual(reviews.filter((entry) => entry.round === round).map((entry) => entry.side).sort(), ['left', 'right'], `Round ${round} did not receive both fresh reviewers`);
  }
  assert.deepEqual(state.acceptedBy, { left: state.candidate.id, right: state.candidate.id });
  const ids = sends.map((entry) => entry.text.replace(/\s+/g, ' ').match(/Exchange tracking ID[^:]*:\s*(\S+)/)?.[1]);
  assert.ok(ids.every(Boolean), 'A fixture send is missing its tracking identity');
  assert.equal(new Set(ids).size, ids.length, 'A later review reused a prior request identity');
}

async function verifyClearSession() {
  await waitFor(() => shell(`!document.getElementById('clearSession').disabled`), 'Clear session was not enabled');
  await click('clearSession');
  await waitFor(() => shell(`document.getElementById('sessionBadge').textContent==='Not connected'`), 'Clear session did not finish');
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.equal(await shell(`document.getElementById('sessionBadge').textContent`), 'Not connected', 'A late teardown update restored the imported badge');
  assert.equal((await shell('window.convergeBrowser.bootstrap()')).hasSession, false);
  assert.equal((await desktop.coordinator.getState()).status, 'idle');
  assert.equal((await desktop.browserSession.cookies.get({ name: 'converge_fixture' })).length, 0);
  assert.equal(desktop.views.left.webContents.getURL(), 'about:blank');
  assert.equal(desktop.views.right.webContents.getURL(), 'about:blank');
  pass('Clear session removes the imported cookie, resets local run state and unloads both pages.');
}

async function run() {
  progress('Starting isolated desktop QA fixture server');
  fixture = await createFixtureServer();
  progress('Creating production desktop with offline fixture origin');
  const networkBlocked = [];
  function blockRemote(ses) {
    ses.webRequest.onBeforeRequest((details, callback) => {
      const allowed = /^(?:file:|data:|blob:|about:|devtools:)/.test(details.url) || new URL(details.url).origin === fixture.origin;
      if (!allowed) networkBlocked.push(new URL(details.url).origin);
      callback({ cancel: !allowed });
    });
  }
  blockRemote(session.defaultSession);
  app.on('web-contents-created', (_event, contents) => blockRemote(contents.session));
  desktop = await createCookieApp({ qaOrigin: fixture.origin, show: false, dialogs: {
    async showOpenDialog(_window, options) {
      openDialogCalls += 1;
      assert.ok(options.properties.includes('openFile'));
      return { canceled: false, filePaths: [selectedSourcePath] };
    },
    async showSaveDialog(_window, options) {
      saveDialogCalls += 1;
      assert.match(options.defaultPath, /\.(?:pdf|mq5)$/i);
      return { canceled: false, filePath: /\.mq5$/i.test(options.defaultPath) ? savedEaPath : saveDialogCalls === 1 ? savedPdfPath : savedCurrentPdfPath };
    },
  } });
  progress('Production desktop created; waiting for shell preload');
  desktop.mainWindow.setSize(1366, 768);
  for (const side of ['left', 'right']) desktop.views[side].webContents.on('console-message', (event) => pageConsole.push({ side, level: event.level, message: event.message }));
  await waitFor(() => shell(`typeof window.convergeBrowser==='object' && document.getElementById('previewNotice').hidden`), 'Desktop preload did not initialize');
  progress('Shell preload ready; inspecting bootstrap');
  const bootstrap = await shell(`window.convergeBrowser.bootstrap()`);
  if (packagedAsar) {
    assert.equal(packageMetadata.version, JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version);
    assert.equal(bootstrap.version, app.getVersion(), 'Host bootstrap must expose the actual Electron launcher app version.');
    assert.ok(desktop.mainWindow.webContents.getURL().includes('app.asar/renderer/browser.html'));
  }
  assert.equal(bootstrap.hasSession, false);
  assert.equal(bootstrap.state.status, 'idle');
  assert.equal(bootstrap.state.maxRounds, 6, 'Host default should match the six-round maximum shown in the renderer');
  for (const side of ['left', 'right']) {
    const preferences = desktop.views[side].webContents.getLastWebPreferences();
    assert.equal(preferences.sandbox, true);
    assert.equal(preferences.contextIsolation, true);
    assert.equal(preferences.nodeIntegration, false);
  }
  assert.equal(desktop.browserSession.storagePath, null);
  await new Promise((resolve) => setTimeout(resolve, 150));
  progress('Attempting optional initial hidden-shell compositor capture');
  try {
    const initialImage = await boundedCapture(desktop.mainWindow.capturePage(undefined, { stayHidden: true }), 'Initial hidden shell capture');
    if (!initialImage.isEmpty()) { const filename = path.join(root, 'desktop-cookie-initial.png'); fs.writeFileSync(filename, initialImage.toPNG()); capturedScreenshots.push(filename); }
  } catch (error) { captureWarnings.push(`Initial hidden shell capture: ${error.message}`); }
  pass('Actual desktop app starts with sandboxed isolated pages and an in-memory browser session.');

  // This is a harmless fixture cookie, not an OpenAI authentication token.
  const fakeCookies = JSON.stringify([{ domain: '.chatgpt.com', name: 'converge_fixture', value: 'fixture-only-value',
    path: '/', secure: true, httpOnly: false, hostOnly: false, session: true, sameSite: 'lax' }]);
  await shell(`document.getElementById('cookieInput').value=${JSON.stringify(fakeCookies)};
    document.getElementById('cookieInput').dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('importCookies').click();`);
  await waitFor(() => shell(`document.getElementById('sessionBadge').textContent==='Imported'`), 'UI did not finish cookie import');
  assert.equal(await shell(`document.getElementById('cookieInput').value`), '');
  const cookies = await desktop.browserSession.cookies.get({ url: 'https://chatgpt.com/', name: 'converge_fixture' });
  assert.equal(cookies.length, 1);
  assert.equal(cookies[0].value, 'fixture-only-value');
  assert.equal(fixture.state.pageLoads, 0, 'Import must wait for the selected type and OK before opening pages.');
  assert.doesNotMatch(JSON.stringify(await shell(`window.convergeBrowser.bootstrap()`)), /fixture-only-value/);
  pass('Import clears its field and retains the in-memory cookie while waiting for the selected chat type and OK.');
  if (clearOnly) {
    await selectModeAndOpen('normal');
    await changeResponseMode('upload-failure', ['left']);
    const upload = await desktop.coordinator.request('ATTACH_FILES', { files: [{ name: 'source.txt', mimeType: 'text/plain', base64: Buffer.from('Fixture source evidence.').toString('base64') }] });
    assert.equal(upload.ok, false);
    assert.equal((await desktop.coordinator.getState()).attachments.status, 'partial');
    pass('Focused clear-session regression opened both pages and reached partial-upload recovery.');
    await verifyClearSession(); completed = true;
    fs.writeFileSync(reportPath, JSON.stringify({ passed: true, localFixturesOnly: true, tests: log }, null, 2));
    return;
  }
  assert.equal(await shell(`document.getElementById('modeNormal').checked`), true, 'Normal must be the initial selection.');
  await selectModeAndOpen('normal');
  const normalState = await desktop.coordinator.getState();
  assert.equal(normalState.pages.left.temporary, false);
  assert.equal(normalState.pages.left.unpersonalized, false);
  assert.equal(await shell(`document.getElementById('privacyCheck').hidden`), true);
  for (const side of ['left', 'right']) assert.deepEqual(await page(side, 'window.fixturePrivacy'), { temporary: 0, menu: 0, unpersonalized: 0 });
  const pageIsolation = await page('left', `({require:typeof require,process:typeof process,ipc:typeof ipcRenderer,host:typeof window.convergeBrowser})`);
  assert.deepEqual(pageIsolation, { require: 'undefined', process: 'undefined', ipc: 'undefined', host: 'undefined' });
  pass('Normal OK opens both sandboxed pages with visibly off Temporary and Personalized state; no privacy gate blocks the mode.');
  const loadsBeforeReload = fixture.state.pageLoads;
  await click('reloadLeft');
  await waitFor(async () => fixture.state.pageLoads === loadsBeforeReload + 1 &&
    (await desktop.coordinator.getState()).pages.left.ready &&
    await page('left', `Array.isArray(window.fixtureSends) && document.getElementById('prompt-textarea')?.isConnected`), 'Reloaded Ask ChatGPT composer did not regain readiness', 60_000);
  assert.notEqual(await shell(`document.getElementById('leftMode').textContent`), 'Session not signed in');
  pass('A reload hydrates the Ask ChatGPT rich editor and refreshes its ready status instead of reporting a signed-out session.');
  await verifyExpansion();
  if (layoutOnly) {
    completed = true;
    fs.writeFileSync(reportPath, JSON.stringify({ passed: true, localFixturesOnly: true, tests: log,
      ...(packagedAsar ? { packagedAsar, packageVersion: packageMetadata.version, launcherVersion: app.getVersion(),
        bootstrapVersion: bootstrap.version } : {}),
      userAgent: desktop.browserSession.getUserAgent(), }, null, 2));
    return;
  }

  await startFromUI('Create an image and review it until both reviewers accept the corrected result.');
  const state = await awaitAgreement();
  assert.equal(state.candidate.id, 'C2');
  assert.equal(state.answer, 'Improved answer with corrected generated image');
  assert.equal(state.candidate.media.side, 'right');
  assert.deepEqual(state.candidate.media.files.map((file) => file.mimeType), ['image/png', 'text/plain']);
  assert.deepEqual(state.acceptedBy, { left: 'C2', right: 'C2' });
  assert.equal(state.issues.every((issue) => issue.resolved), true);
  assert.equal(state.transcript.length, 10);
  const leftTurns = await page('left', 'window.fixtureSends');
  const rightTurns = await page('right', 'window.fixtureSends');
  assert.equal(leftTurns.length, 5);
  assert.equal(rightTurns.length, 5);
  verifyFourRounds(state, [...leftTurns, ...rightTurns]);
  for (const review of [...leftTurns.slice(1), ...rightTurns.slice(1)]) assert.equal(review.files.length, 2);
  assert.ok(leftTurns[1].files.some((file) => file.type === 'image/png' && file.size > 0));
  assert.ok(leftTurns[1].files.some((file) => file.type === 'text/plain' && file.size > 0));
  await waitFor(() => shell(`document.getElementById('resultCount').textContent==='Accepted by A + B'`), 'Final result did not appear in the UI');
  assert.equal(await shell(`document.getElementById('answer').textContent`), state.answer);
  assert.doesNotMatch(JSON.stringify(state), /base64|fixture-only-value/);
  assert.equal(await shell(`document.getElementById('toggleSidebar').getAttribute('aria-expanded')`), 'false');
  assert.equal(await shell(`document.getElementById('resultContent').hidden`), true, 'Completion must retain the compact bottom bar');
  pass('Start completes ten real IPC sends across four full improvement rounds: independent drafts, challenge, corrected image/file transfer and eight fresh reviews before exact dual acceptance.');

  const loadsBeforeFollowup = fixture.state.pageLoads;
  const firstIds = structuredClone(state.tabIds);
  await startFromUI('A second command in the same two chats: refine the previous result.');
  const followupState = await awaitAgreement('The same-pair follow-up command did not finish');
  assert.notEqual(followupState.runId, state.runId);
  assert.deepEqual(followupState.tabIds, firstIds);
  assert.equal(fixture.state.pageLoads, loadsBeforeFollowup, 'A follow-up must not reload or reopen either chat.');
  const followupLeft = await page('left', 'window.fixtureSends');
  const followupRight = await page('right', 'window.fixtureSends');
  assert.equal(followupLeft.length, 10);
  assert.equal(followupRight.length, 10);
  assert.equal(await page('left', `document.querySelectorAll('[data-message-author-role="user"]').length`), 10);
  verifyFourRounds(followupState, [...followupLeft.slice(5), ...followupRight.slice(5)]);
  pass('A second improvement command completes four fresh rounds in the same two chats with new request identities and all previous page turns intact.');

  await changeResponseMode('arithmetic');
  const arithmeticBefore = { left: followupLeft.length, right: followupRight.length };
  await startFromUI('what is 4 + 6?');
  const arithmeticState = await awaitAgreement('Simple arithmetic did not stop after its two verification steps');
  assert.equal(arithmeticState.reviewMode, 'verify');
  assert.equal(arithmeticState.minReviewRounds, 1);
  assert.equal(arithmeticState.round, 1);
  assert.equal(arithmeticState.answer, '10');
  assert.deepEqual(arithmeticState.tabIds, firstIds);
  assert.equal(arithmeticState.transcript.filter(entry => entry.role === 'review').length, 2);
  for (const side of ['left','right']) assert.equal(await page(side, 'window.fixtureSends.length'), arithmeticBefore[side] + 2);
  pass('Auto recognizes simple arithmetic and finishes after two independently submitted verification responses, while retaining the same pair.');

  await resetChats();
  fixture.setMode('pdf-native');
  await selectModeAndOpen('normal');
  await waitFor(() => shell(`!document.getElementById('attachFiles').disabled`), 'Attach did not enable for ready normal pages');
  await click('attachFiles');
  await waitFor(async () => (await desktop.coordinator.getState()).attachments.status === 'attached', 'Source PDF was not attached to both pages');
  assert.equal(openDialogCalls, 1, 'Source PDF must pass through the host file dialog path.');
  for (const side of ['left', 'right']) {
    const uploads = await page(side, 'window.fixtureUploads');
    assert.deepEqual(uploads[0], [{ name: 'source-evidence.pdf', type: 'application/pdf', size: sourcePdf.length }]);
  }
  assert.match(await shell(`document.getElementById('fileStatus').textContent`), /source-evidence\.pdf/);
  assert.equal(await shell(`document.getElementById('requireFiles').checked`), true, 'Attaching a PDF must automatically require downloadable file results.');
  await startFromUI('Read source-evidence.pdf and create a corrected PDF report, then inspect and improve that PDF until both reviewers agree.');
  const pdfState = await awaitAgreement('Source PDF review and revised-file exchange did not finish');
  assert.equal(pdfState.candidate.id, 'C2');
  assert.equal(pdfState.requireFiles, true);
  assert.deepEqual(pdfState.candidate.media.files.map((file) => file.mimeType), ['application/pdf']);
  assert.equal(pdfState.candidate.media.side, 'right');
  const pdfLeftTurns = await page('left', 'window.fixtureSends');
  const pdfRightTurns = await page('right', 'window.fixtureSends');
  verifyFourRounds(pdfState, [...pdfLeftTurns, ...pdfRightTurns]);
  for (const draft of [pdfLeftTurns[0], pdfRightTurns[0]]) {
    assert.deepEqual(draft.files, [{ name: 'source-evidence.pdf', type: 'application/pdf', size: sourcePdf.length }]);
    assert.match(draft.text, /source-evidence\.pdf/);
  }
  for (const review of [...pdfLeftTurns.slice(1), ...pdfRightTurns.slice(1)]) {
    assert.equal(review.files.length, 2, 'Every fresh file review needs the original source and exact candidate.');
    const original = review.files.find((file) => file.name === 'ORIGINAL_SOURCE_1__source-evidence.pdf');
    assert.deepEqual(original, { name: 'ORIGINAL_SOURCE_1__source-evidence.pdf', type: 'application/pdf', size: sourcePdf.length });
    const candidate = review.files.filter((file) => file !== original);
    assert.equal(candidate.length, 1);
    assert.equal(candidate[0].type, 'application/pdf');
    assert.ok(candidate[0].size > 0, 'The current candidate must be a genuine uploaded PDF.');
  }
  await waitFor(() => shell(`typeof window.convergeBrowser.saveFiles==='function' && !document.getElementById('saveFiles').hidden && !document.getElementById('saveFiles').disabled`), 'Final file save control was not exposed');
  await click('saveFiles');
  await waitFor(() => fs.existsSync(savedPdfPath), 'Save final files did not write the accepted PDF');
  assert.equal(saveDialogCalls, 1);
  const savedPdf = fs.readFileSync(savedPdfPath);
  assert.deepEqual(savedPdf, makePdf('Corrected report: 2 + 2 = 4'), 'The saved PDF must be the exact accepted revised output bytes.');
  assert.equal(savedPdf.subarray(0, 5).toString(), '%PDF-');
  await waitFor(() => shell(`document.getElementById('fileSaveStatus').textContent.length>0`), 'Saved files did not receive an inline status');
  assert.ok(savedPdf.includes(Buffer.from('xref\n')) && savedPdf.includes(Buffer.from('%%EOF')));
  pass('Native Attach reads a real source PDF into both chats; generated PDF revisions are relayed for exact-file review and final accepted bytes save as a valid PDF.');
  try {
    desktop.mainWindow.showInactive();
    await shell(`if(document.getElementById('resultContent').hidden)document.getElementById('toggleResults').click()`);
    await new Promise((resolve) => setTimeout(resolve, 750));
    const pdfImage = await boundedCapture(desktop.mainWindow.capturePage(undefined, { stayHidden: true }), 'PDF result capture');
    if (pdfImage.isEmpty()) throw new Error('The PDF result card returned an empty screenshot.');
    const filename = path.join(root, 'desktop-cookie-pdf-result.png'); fs.writeFileSync(filename, pdfImage.toPNG()); capturedScreenshots.push(filename);
  } catch (error) { captureWarnings.push(`PDF result screenshot: ${error.message}`); }
  finally { desktop.mainWindow.hide(); }

  await changeResponseMode('pdf-native-slow-review');
  const pdfSendsBeforeStop = Object.fromEntries(await Promise.all(['left', 'right'].map(async (side) => [side, await page(side, 'window.fixtureSends.length')])));
  await startFromUI('Create a new PDF report from the previous evidence and review that downloadable PDF.');
  await waitFor(async () => {
    const current = await desktop.coordinator.getState();
    return current.status === 'running' && current.candidate?.id === 'C1' &&
      (await page('right', 'window.fixtureSends.length')) === pdfSendsBeforeStop.right + 2 &&
      (await page('right', '!document.getElementById("stopFixture").hidden'));
  }, 'PDF candidate did not enter its slow review stage');
  await click('stop');
  await waitFor(async () => (await desktop.coordinator.getState()).status === 'stopped', 'Stop did not retain the completed current PDF');
  await waitFor(() => shell(`document.getElementById('saveFiles').textContent.endsWith('Save current files') && !document.getElementById('saveFiles').disabled`), 'Stopped PDF did not expose Save current files');
  await click('saveFiles');
  await waitFor(() => fs.existsSync(savedCurrentPdfPath), 'Explicit Save current files rejected the completed PDF after Stop');
  assert.equal(saveDialogCalls, 2);
  assert.deepEqual(fs.readFileSync(savedCurrentPdfPath), makePdf('Initial report: 2 + 2 = 5'), 'A stopped run must save its completed current candidate rather than stale accepted files.');
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal((await page('left', 'window.fixtureSends.length')), pdfSendsBeforeStop.left + 1);
  assert.equal((await page('right', 'window.fixtureSends.length')), pdfSendsBeforeStop.right + 2);
  assert.equal((await desktop.coordinator.getState()).status, 'stopped');
  pass('Stop during PDF review preserves the completed candidate; explicit Save current files writes its exact bytes and no late review is sent.');

  await verifyEaTransport();

  await resetChats();
  fixture.setMode('media');
  assert.equal(await shell(`document.getElementById('modeNormal').checked`), true);
  assert.equal(await shell(`document.getElementById('question').value`), '');
  await selectModeAndOpen('temporary');
  const temporaryState = await desktop.coordinator.getState();
  assert.equal(temporaryState.pages.left.temporary, true);
  assert.equal(temporaryState.pages.left.ready, true, 'Temporary may retain the account default Personalized choice.');
  for (const side of ['left', 'right']) {
    assert.deepEqual(await page(side, 'window.fixturePrivacy'), { temporary: 1, menu: 0, unpersonalized: 0 });
    assert.equal(await page(side, `document.getElementById('currentMode').textContent`), 'Personalized');
  }
  await startFromUI('Verify that a Temporary Personalized page can run this command.');
  const temporaryResult = await awaitAgreement('Temporary Personalized mode did not finish');
  verifyFourRounds(temporaryResult, [...await page('left', 'window.fixtureSends'), ...await page('right', 'window.fixtureSends')]);
  pass('Reset retains cookies and mode selection; Temporary OK automatically toggles both pages and runs with their Personalized default.');

  await resetChats();
  assert.equal(await shell(`document.getElementById('modeTemporary').checked`), true);
  fixture.setMode('media');
  await selectModeAndOpen('work');
  const workState = await desktop.coordinator.getState();
  assert.equal(workState.pages.left.work, true);
  assert.equal(workState.pages.right.work, true);
  for (const side of ['left', 'right']) assert.equal(await page(side, 'window.fixtureWorkClicks'), 1);
  await startFromUI('Run a command inside the explicitly selected visible Work mode.');
  const workResult = await awaitAgreement('Verified Work mode did not finish');
  verifyFourRounds(workResult, [...await page('left', 'window.fixtureSends'), ...await page('right', 'window.fixtureSends')]);
  pass('Work OK activates a unique visible Work control and requires observed selected state before exchanging prompts.');

  await changeResponseMode('invalid-reply');
  const loadsBeforeInvalid = fixture.state.pageLoads;
  const invalidStart = (await desktop.coordinator.getState()).runId;
  await startFromUI('Exercise an invalid protocol response without changing the open chats.');
  await waitFor(async () => (await desktop.coordinator.getState()).status === 'error', 'Malformed response did not produce a clear stopped error');
  const invalidState = await desktop.coordinator.getState();
  assert.notEqual(invalidState.runId, invalidStart);
  assert.match(invalidState.error, /JSON|invalid|reply|answer|file|output/i);
  assert.equal(fixture.state.pageLoads, loadsBeforeInvalid);
  assert.equal((await desktop.browserSession.cookies.get({ name: 'converge_fixture' })).length, 1);
  await waitFor(() => shell(`document.getElementById('statusDetail').textContent.length>0 && !document.getElementById('start').disabled`), 'The error did not leave a next-command control available');
  pass('A malformed model reply stops with an explanation while preserving cookies, the two chat histories, and next-command availability.');
  await changeResponseMode('media');

  await shell(`if(!document.getElementById('resultContent').hidden)document.getElementById('toggleResults').click()`);
  // Parent authorizes showing our local fixture window without taking focus
  // so Windows allocates the native child-view compositor surfaces.
  desktop.mainWindow.showInactive();
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const [width, height] = desktop.mainWindow.getContentSize();
  for (const side of ['left', 'right']) {
    const bounds = desktop.views[side].getBounds();
    assert.ok(bounds.width >= 200 && bounds.height >= 100, `${side} page needs usable visible bounds`);
    assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= width && bounds.y + bounds.height <= height);
  }
  // Window capture snapshots the shell renderer; native child views have their
  // own capture surfaces. Keep the originals separate, avoiding a synthetic
  // screenshot that could be mistaken for live account verification.
  for (const side of ['left', 'right']) {
    try {
      const pageImage = await boundedCapture(desktop.views[side].webContents.capturePage(), `${side} native view capture`);
      if (pageImage.isEmpty()) throw new Error('The native child view returned an empty screenshot.');
      const filename = path.join(root, `desktop-cookie-page-${side}.png`); fs.writeFileSync(filename, pageImage.toPNG()); capturedScreenshots.push(filename);
    } catch (error) { captureWarnings.push(`${side} native page screenshot: ${error.message}`); }
  }
  try {
    await boundedCapture(desktop.mainWindow.capturePage(undefined, { stayHidden: true }), 'Shell warmup capture');
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const image = await boundedCapture(desktop.mainWindow.capturePage(undefined, { stayHidden: true }), 'Shell capture');
    if (image.isEmpty()) throw new Error('The shell returned an empty screenshot.');
    fs.writeFileSync(output, image.toPNG());
    capturedScreenshots.push(output);
  } catch (error) { captureWarnings.push(`Shell screenshot: ${error.message}`); }
  await click('toggleResults');
  await new Promise((resolve) => setTimeout(resolve, 1200));
  try {
    const resultImage = await boundedCapture(desktop.mainWindow.capturePage(undefined, { stayHidden: true }), 'Result capture');
    if (resultImage.isEmpty()) throw new Error('The result panel returned an empty screenshot.');
    const filename = path.join(root, 'desktop-cookie-result.png'); fs.writeFileSync(filename, resultImage.toPNG()); capturedScreenshots.push(filename);
  } catch (error) { captureWarnings.push(`Result screenshot: ${error.message}`); }
  desktop.mainWindow.hide();
  pass('Native page bounds remain inside the shell; compositor screenshots captured when available, with unsupported captures reported.');

  await changeResponseMode('slow-media');
  const sendsBeforeMediaStop = Object.fromEntries(await Promise.all(['left', 'right'].map(async (side) => [side, await page(side, 'window.fixtureSends.length')])));
  await startFromUI('Generate an image and transfer its attached evidence file.');
  await waitFor(() => fixture.state.slowMediaRequests > 0, 'A slow generated download was not started', 20_000);
  await click('stop');
  await waitFor(async () => (await desktop.coordinator.getState()).status === 'stopped', 'Stop did not cancel a media transfer');
  await waitFor(() => fixture.state.slowMediaAborts > 0, 'Stop did not abort the source download');
  fixture.releaseSlowMedia();
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.equal((await page('left', 'window.fixtureSends')).length, sendsBeforeMediaStop.left + 1);
  assert.equal((await page('right', 'window.fixtureSends')).length, sendsBeforeMediaStop.right + 1);
  assert.equal((await desktop.coordinator.getState()).status, 'stopped');
  pass('Stop during an unfinished generated-file export aborts its fetch and prevents a late review from being submitted.');

  await changeResponseMode('slow-reply');
  const sendsBeforeReplyStop = Object.fromEntries(await Promise.all(['left', 'right'].map(async (side) => [side, await page(side, 'window.fixtureSends.length')])));
  const stopClicksBefore = Object.fromEntries(await Promise.all(['left', 'right'].map(async (side) => [side, await page(side, 'window.fixtureStops')])));
  await startFromUI('Take time to solve a difficult question.');
  await waitFor(async () => (await page('left', 'window.fixtureSends.length')) === sendsBeforeReplyStop.left + 1 && (await page('right', 'window.fixtureSends.length')) === sendsBeforeReplyStop.right + 1, 'Drafts did not send');
  await shell(`if(document.getElementById('toggleSidebar').getAttribute('aria-expanded')==='true')document.getElementById('toggleSidebar').click()`);
  assert.equal(await shell(`document.getElementById('toggleSidebar').getAttribute('aria-expanded')`), 'false');
  await click('headerStop');
  await waitFor(async () => (await desktop.coordinator.getState()).status === 'stopped', 'Stop did not cancel draft generation');
  await waitFor(async () => (await page('left', 'window.fixtureStops')) === stopClicksBefore.left + 1 && (await page('right', 'window.fixtureStops')) === stopClicksBefore.right + 1, 'Both visible Stop controls were not clicked');
  pass('Header Stop remains accessible with the sidebar hidden and cancels both native page generations.');

  await click('toggleSidebar');
  await resetChats();
  assert.equal(await shell(`document.getElementById('modeWork').checked`), true);
  fixture.setMode('unknown-work');
  await shell(`document.getElementById('modeWork').checked=true;document.getElementById('modeWork').dispatchEvent(new Event('change'));`);
  await click('openPages');
  await waitFor(async () => {
    const current = await desktop.coordinator.getState();
    return current.status === 'setup' && current.chatMode === 'work' && Object.values(current.pages).some((item) => /work|mode|control|confirm/i.test(item.reason || ''));
  }, 'Unsupported Work mode did not explain its missing control', 60_000);
  assert.equal(await shell(`document.getElementById('start').disabled`), true);
  assert.equal(await page('left', 'window.fixtureSends.length'), 0);
  pass('An unavailable Work control blocks Start with a page explanation instead of guessing a URL or silently running Normal mode.');

  await resetChats();
  fixture.setMode('media');
  await selectModeAndOpen('normal');
  await changeResponseMode('upload-failure', ['left']);
  const attachment = await desktop.coordinator.request('ATTACH_FILES', { files: [{ name: 'source.txt', mimeType: 'text/plain', base64: Buffer.from('Fixture source evidence.').toString('base64') }] });
  assert.equal(attachment.ok, false);
  const attachmentState = await desktop.coordinator.getState();
  assert.equal(attachmentState.attachments.status, 'partial');
  assert.match(attachmentState.attachments.error, /left|preview|document|name/i);
  await shell(`document.getElementById('question').value='Review the attached source';document.getElementById('question').dispatchEvent(new Event('input'));`);
  assert.equal(await shell(`document.getElementById('start').disabled`), true);
  assert.equal((await desktop.browserSession.cookies.get({ name: 'converge_fixture' })).length, 1);
  pass('A source file confirmed on only one page shows a partial attachment error and blocks Start while retaining the session.');

  await verifyClearSession();

  completed = true;
  fs.writeFileSync(reportPath, JSON.stringify({ passed: true, localFixturesOnly: true, tests: log,
    ...(packagedAsar ? { packagedAsar, packageVersion: packageMetadata.version, launcherVersion: app.getVersion(),
      bootstrapVersion: bootstrap.version,
      launchNote: 'Production modules, shell and sandboxed preloads loaded from app.asar through the development Electron launcher. This test does not verify standalone EXE version, installer execution or live authentication.' } : {}),
    userAgent: desktop.browserSession.getUserAgent(),
    screenshots: capturedScreenshots,
    screenshotNote: 'Window images capture the shell; embedded native views are captured separately when supported. All pages are offline simulations.',
    captureWarnings, blockedRemoteOrigins: [...new Set(networkBlocked)], eaRegression,
    finalAnswer: state.answer, sends: { left: leftTurns.length, right: rightTurns.length }, generatedTypes: ['image/png', 'text/plain'] }, null, 2));
}

app.whenReady().then(run).catch((error) => {
  process.stderr.write(`FAIL: ${error.stack || error.message}\n`);
  fs.writeFileSync(reportPath, JSON.stringify({ passed: false, localFixturesOnly: true, tests: log, error: error.message }, null, 2));
  process.exitCode = 1;
}).finally(async () => {
  if (desktop) {
    try { await desktop.coordinator.dispose(); } catch (_) { }
    if (!desktop.mainWindow.isDestroyed()) desktop.mainWindow.close();
  }
  if (fixture) await fixture.close();
  app.exit(completed ? 0 : 1);
});
