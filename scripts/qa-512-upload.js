'use strict';

// Real shell/native chooser/three sandboxed Chromium inputs. The provider is
// an offline page, so this proves local transport and recovery, not acceptance
// of a 512 MiB file by ChatGPT or quality of a remote model response.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { createHash } = require('node:crypto');
const { app, session } = require('electron');
const { writeLargePdf, fixtureHtml, RECEIPT_CHUNK_BYTES } = require('./qa-upload-fixture');
const root = path.join(__dirname, '..');
const packagedAsar = process.env.CONVERGE_PACKAGED_ASAR && path.resolve(process.env.CONVERGE_PACKAGED_ASAR);
const productionRoot = packagedAsar || root;
if (packagedAsar) app.setAppPath(packagedAsar);
const packageVersion = JSON.parse(fs.readFileSync(path.join(productionRoot, 'package.json'), 'utf8')).version;
const { createCookieApp } = require(path.join(productionRoot, 'desktop-main.js'));
const { readFileChunks, verifyStoredFile } = require(path.join(productionRoot, 'src/browser/file-store.js'));
const { readZipFile } = require(path.join(productionRoot, 'src/studio-services/archive.js'));
const profileRoot = fs.mkdtempSync(path.join(app.getPath('temp'), 'converge-512-upload-qa-'));
app.setPath('userData', profileRoot);
const reportPath = process.env.CONVERGE_512_UPLOAD_REPORT || path.join(root, '.live-test', '512-upload', packagedAsar ? 'packaged-result.json' : 'source-result.json');
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
const sourcePath = path.join(profileRoot, 'large-source-512MiB.pdf');
const cancelPath = path.join(profileRoot, 'cancel-source-32MiB.pdf');
const oversizePath = path.join(profileRoot, 'oversize-512MiB-plus-one.pdf');
const exportPath = path.join(profileRoot, 'Converge-512MiB-project.zip');
const targetBytes = 512 * 1024 * 1024, sides = ['left', 'right', 'boss'];
const source = writeLargePdf(sourcePath, targetBytes);
writeLargePdf(cancelPath, 32 * 1024 * 1024);
// Boundary rejection checks the actual native stat; no 512 MiB + 1 allocation.
const oversized = fs.openSync(oversizePath, 'wx'); fs.ftruncateSync(oversized, targetBytes + 1); fs.closeSync(oversized);
const tests = [], messages = [], blockedRemoteOrigins = new Set(), hashJobs = [];
let desktop, fixture, openDialogs = 0, selection = oversizePath, completed = false;
let cancelArmed = false, heldChunk = null, independentError, heartbeat, projectEvidence;
const wire = Object.fromEntries(sides.map(side => [side, emptyWire()]));
const memory = { initial: process.memoryUsage(), peakRss: 0, peakHeapUsed: 0, peakArrayBuffers: 0 };
const sampleMemory = () => { const item = process.memoryUsage(); for (const [sourceKey, targetKey] of [['rss', 'peakRss'], ['heapUsed', 'peakHeapUsed'], ['arrayBuffers', 'peakArrayBuffers']]) memory[targetKey] = Math.max(memory[targetKey], item[sourceKey]); };
sampleMemory();
const memoryTimer = setInterval(sampleMemory, 100);
const startedAt = Date.now();
const watchdog = setTimeout(() => fail(new Error('The 512 MiB native QA exceeded its twenty-minute deadline.')), 1200_000);

function emptyWire() { return { begins: 0, chunks: 0, commits: 0, aborts: 0, deliveredChunks: 0, maxChunkLength: 0, maxWireBytes: 0, receivedCharacters: 0 }; }
const shell = code => desktop.mainWindow.webContents.executeJavaScript(code, true);
const page = (side, code) => desktop.views[side].webContents.executeJavaScript(code, true);
async function waitFor(check, description, timeout = 30_000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (independentError) throw independentError;
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 35));
  }
  throw new Error(description);
}
function pass(text) { tests.push(text); process.stdout.write(`PASS: ${text}\n`); }
function cleanupProfile() {
  if (!fs.existsSync(profileRoot)) return;
  const parent = fs.realpathSync(app.getPath('temp')), resolved = fs.realpathSync(profileRoot), relative = path.relative(parent, resolved);
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative) && path.basename(resolved).startsWith('converge-512-upload-qa-'));
  fs.rmSync(resolved, { recursive: true, force: true });
}
async function okay(method, payload) {
  const value = await shell(`window.convergeBrowser.${method}(${payload === undefined ? '' : JSON.stringify(payload)})`);
  assert.equal(value.ok, true, value.error); return value;
}
async function hashDisk(filename) {
  const hash = createHash('sha256'); let bytes = 0;
  for await (const chunk of fs.createReadStream(filename, { highWaterMark: RECEIPT_CHUNK_BYTES })) { hash.update(chunk); bytes += chunk.length; }
  return { bytes, sha256: hash.digest('hex') };
}
async function hashStored(file) {
  assert.equal(file.base64, undefined, 'A 512 MiB source became a giant inline string.');
  assert.equal(typeof file.blobId, 'string'); await verifyStoredFile(file);
  const hash = createHash('sha256'); let bytes = 0, maximumRead = 0;
  for await (const chunk of readFileChunks(file)) { hash.update(chunk); bytes += chunk.length; maximumRead = Math.max(maximumRead, chunk.length); }
  assert.ok(maximumRead <= RECEIPT_CHUNK_BYTES);
  return { bytes, sha256: hash.digest('hex'), maximumRead };
}
async function hashInput(side) {
  await waitFor(() => page(side, 'window.receiptReaders?.length===1'), `${side} did not dispatch its actual File input selection.`);
  const hash = createHash('sha256'); let bytes = 0, batches = 0, maxReturnBytes = 0;
  while (true) {
    const batch = await page(side, 'window.nextReceiptChunk(0)'); batches++;
    maxReturnBytes = Math.max(maxReturnBytes, batch.bytes || 0);
    assert.ok((batch.bytes || 0) <= RECEIPT_CHUNK_BYTES + 65536);
    for (const encoded of batch.chunks) {
      const chunk = Buffer.from(encoded, 'base64'); hash.update(chunk); bytes += chunk.length;
      assert.ok(chunk.length <= RECEIPT_CHUNK_BYTES);
    }
    if (batch.done) break;
  }
  const sha256 = hash.digest('hex'); assert.equal(bytes, targetBytes); assert.equal(sha256, source.sha256);
  await page(side, `window.finishReceipt(0,${JSON.stringify(sha256)})`);
  process.stdout.write(`RECEIPT: ${side} independently streamed ${bytes} bytes with matching SHA-256.\n`);
  return { bytes, sha256, batches, maxReturnBytes };
}
function interceptWire(side) {
  const contents = desktop.views[side].webContents, nativeSend = contents.send.bind(contents);
  contents.send = (channel, payload) => {
    const message = payload.message;
    if (channel === 'converge:page-request' && message?.type?.startsWith('FILE_STAGE_')) {
      const metrics = wire[side];
      metrics.maxWireBytes = Math.max(metrics.maxWireBytes, Buffer.byteLength(JSON.stringify(payload)));
      if (message.type === 'FILE_STAGE_BEGIN') metrics.begins++;
      if (message.type === 'FILE_STAGE_ABORT') metrics.aborts++;
      if (message.type === 'FILE_STAGE_CHUNK') {
        assert.equal(message.offset, metrics.receivedCharacters); assert.equal(message.fileIndex, 0);
        metrics.chunks++; metrics.receivedCharacters += message.data.length;
        metrics.maxChunkLength = Math.max(metrics.maxChunkLength, message.data.length);
        if (cancelArmed && metrics.deliveredChunks >= 3 && !heldChunk) {
          heldChunk = { side, offset: message.offset, dataLength: message.data.length }; return;
        }
        metrics.deliveredChunks++;
      }
      if (message.type === 'FILE_STAGE_COMMIT') {
        metrics.commits++;
        const job = hashInput(side).catch(error => { independentError = error; throw error; });
        // Avoid an unhandled rejection while the native receipt waiter catches up.
        job.catch(() => {}); hashJobs.push({ side, job });
      }
    }
    return nativeSend(channel, payload);
  };
}
async function createFixture() {
  const html = fixtureHtml();
  const server = http.createServer((_request, response) => { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(html); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { origin: `http://127.0.0.1:${server.address().port}`, async close() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}
async function recordHeartbeat() {
  await shell(`window.qaUpload={active:true,count:0,maxGapMs:0,last:performance.now(),phases:[],stopMisses:[],progress:[]};
    window.qaUpload.timer=setInterval(()=>{const q=window.qaUpload,now=performance.now();if(q.active){q.count++;q.maxGapMs=Math.max(q.maxGapMs,now-q.last)}q.last=now},50);
    window.qaUpload.unsubscribe=window.convergeBrowser.onState(state=>{const q=window.qaUpload,p=state.attachments?.progress;if(!q.active||!p)return;
      if(!q.phases.includes(p.phase))q.phases.push(p.phase);if(q.progress.length<2000)q.progress.push({...p});
      const button=document.getElementById('headerStop');if(button.hidden||button.disabled)q.stopMisses.push(p.phase);
    });true;`);
}
async function run() {
  fixture = await createFixture();
  function blockRemote(browserSession) {
    browserSession.webRequest.onBeforeRequest((details, callback) => {
      let allowed = /^(file:|data:|blob:|about:|devtools:)/.test(details.url);
      if (!allowed) { const origin = new URL(details.url).origin; allowed = origin === fixture.origin; if (!allowed) blockedRemoteOrigins.add(origin); }
      callback({ cancel: !allowed });
    });
  }
  blockRemote(session.defaultSession); app.on('web-contents-created', (_event, contents) => blockRemote(contents.session));
  desktop = await createCookieApp({ qaOrigin: fixture.origin, show: false, dialogs: {
    async showOpenDialog() { openDialogs++; return { canceled: false, filePaths: [selection] }; },
    async showSaveDialog() { return { canceled: false, filePath: exportPath }; },
  } });
  for (const side of sides) {
    interceptWire(side);
    desktop.views[side].webContents.on('console-message', event => { if (event.level >= 2) messages.push({ side, message: String(event.message).slice(0, 1000) }); });
  }
  await waitFor(() => shell("typeof window.convergeBrowser==='object'&&document.getElementById('previewNotice').hidden"), 'The production shell did not initialize.');
  const bootstrapVersion = (await shell('window.convergeBrowser.bootstrap()')).version;
  await okay('importCookies', JSON.stringify([{ domain: '.chatgpt.com', name: 'converge_512_upload_fixture', value: 'offline-fixture', path: '/', secure: true, session: true, sameSite: 'lax' }]));
  await okay('openPages', { chatMode: 'normal' });
  await waitFor(async () => { const state = await desktop.coordinator.getState(); return sides.every(side => state.pages[side]?.ready === true); }, 'Not all native bridges are ready.');
  pass('Production shell opens three sandboxed chat pages with remote access blocked.');

  // Native IPC rejects invalid selection; keep that rejection inside Chromium
  // so this deliberately failing boundary case does not abort the QA runner.
  const rejected = await shell("window.convergeBrowser.attachFiles().then(value=>({unexpected:value}),error=>({error:error.message}))");
  assert.equal(rejected.unexpected, undefined); assert.match(rejected.error, /512|limit/i);
  assert.ok(sides.every(side => wire[side].begins === 0 && wire[side].commits === 0));
  assert.equal((await desktop.coordinator.getState()).attachments.status, 'none');
  pass('The real native chooser rejects 512 MiB plus one byte before any page transfer.');

  await recordHeartbeat(); selection = cancelPath; cancelArmed = true;
  await shell("document.getElementById('attachFiles').click()");
  await waitFor(() => heldChunk, 'The controlled cancellation did not reach an actual staged chunk.');
  const cancelBegan = Date.now();
  const cancelControl = await shell("({visible:!document.getElementById('headerStop').hidden,enabled:!document.getElementById('headerStop').disabled,label:document.getElementById('headerStop').textContent})");
  assert.equal(cancelControl.visible, true); assert.equal(cancelControl.enabled, true); assert.match(cancelControl.label, /Stop|Cancel upload/);
  await shell("document.getElementById('headerStop').click()");
  await waitFor(() => shell("!document.getElementById('attachFiles').disabled&&document.getElementById('headerStop').hidden"), 'Stop left the native upload action locked.', 5000);
  const cancelDurationMs = Date.now() - cancelBegan; assert.ok(cancelDurationMs < 2500, `Stop took ${cancelDurationMs} ms.`);
  await waitFor(() => wire[heldChunk.side].aborts === 1, 'Stop did not send scoped stage cleanup.');
  const cancellation = { wire: JSON.parse(JSON.stringify(wire)), heldChunk, cancelDurationMs, cancelControl };
  assert.ok(sides.every(side => wire[side].commits === 0)); assert.equal(wire[heldChunk.side].deliveredChunks, 3);
  for (const side of sides) { assert.equal(await page(side, 'window.uploadChangeCount'), 0); assert.deepEqual(await page(side, 'window.fixtureSends'), []); }
  assert.equal((await desktop.coordinator.exportProject()).sources.length, 0);
  pass('Stop cancels a transfer after three actual IPC chunks, aborts staging promptly and commits or submits no source.');

  cancelArmed = false; for (const side of sides) wire[side] = emptyWire();
  selection = sourcePath; const uploadStartedAt = Date.now();
  await shell("document.getElementById('attachFiles').click()");
  await waitFor(async () => {
    const state = await desktop.coordinator.getState();
    if (['partial', 'failed'].includes(state.attachments?.status)) throw new Error(state.attachments.error || 'A native upload failed.');
    return state.attachments?.status === 'attached';
  }, 'The 512 MiB source did not complete on all three real file inputs.', 900_000);
  const uploadCompletedAt = Date.now();
  const hashResults = {}; for (const { side, job } of hashJobs) hashResults[side] = await job;
  const receipts = {};
  for (const side of sides) {
    receipts[side] = await page(side, '({receipts:window.uploadReceipts,changes:window.uploadChangeCount,errors:window.uploadErrors,selected:window.selectedReceiptFiles,fullFileReads:window.fullFileReads,maxReceiptChunkBytes:window.maxReceiptChunkBytes})');
    assert.equal(receipts[side].changes, 1); assert.deepEqual(receipts[side].errors, []); assert.equal(receipts[side].fullFileReads, 0);
    assert.deepEqual(receipts[side].receipts, [{ name: source.name, bytes: targetBytes, mimeType: 'application/pdf', sha256: source.sha256 }]);
    assert.deepEqual(receipts[side].selected, [{ name: source.name, size: targetBytes, type: 'application/pdf' }]);
    assert.equal(wire[side].begins, 1); assert.equal(wire[side].commits, 1); assert.equal(wire[side].aborts, 0);
    assert.equal(wire[side].receivedCharacters, Math.ceil(targetBytes / 3) * 4);
    assert.ok(wire[side].chunks > 500 && wire[side].maxChunkLength <= 1048576 && wire[side].maxWireBytes <= 1048576 + 2048);
    assert.ok(receipts[side].maxReceiptChunkBytes <= RECEIPT_CHUNK_BYTES);
  }
  pass('A real 512 MiB PDF reaches all three Chromium File inputs once; independent streamed SHA-256 matches exact source bytes.');
  pass('Production transfer uses bounded ordered 1 MiB IPC chunks; independent receipt reads never call full-file arrayBuffer.');
  await waitFor(() => shell("!document.getElementById('attachFiles').disabled&&document.getElementById('fileStatus').classList.contains('success')"), 'The completed native upload left the sidebar locked.');
  heartbeat = await shell("window.qaUpload.active=false;window.qaUpload.unsubscribe();clearInterval(window.qaUpload.timer);({count:window.qaUpload.count,maxGapMs:window.qaUpload.maxGapMs,phases:window.qaUpload.phases,stopMisses:window.qaUpload.stopMisses,progress:window.qaUpload.progress})");
  assert.ok(heartbeat.count > 50); assert.ok(heartbeat.maxGapMs < 1500, `Shell heartbeat stalled for ${heartbeat.maxGapMs} ms.`);
  assert.deepEqual(heartbeat.stopMisses, []);
  for (const phase of ['reading', 'staging', 'processing']) assert.ok(heartbeat.phases.includes(phase), `Missing real ${phase} progress.`);
  const sidebar = await shell("({ready:!document.getElementById('attachFiles').disabled,fileStatus:document.getElementById('fileStatus').textContent,error:document.getElementById('actionError').hidden?'':document.getElementById('actionError').textContent,progressHidden:document.getElementById('fileUploadProgress').hidden})");
  assert.equal(sidebar.error, ''); assert.equal(sidebar.progressHidden, true);
  pass('The shell stays responsive during reading, staging and provider processing, with Cancel usable independently and ready controls restored.');

  const projectStartedAt = Date.now();
  await okay('start', { question: 'Summarize the original PDF source in plain text, without creating files.', reviewMode: 'verify', maxRounds: 2,
    requireFiles: false, relayMedia: true, studio: { verificationEnabled: false, freshAudit: false } });
  await waitFor(() => page('boss', 'window.fixtureSends.length===1'), 'The offline task did not submit its initial boss prompt.');
  await okay('stop');
  const snapshot = await desktop.coordinator.exportProject();
  assert.equal(snapshot.sources.length, 1); assert.equal(snapshot.sources[0].byteLength, targetBytes);
  assert.deepEqual(await hashStored(snapshot.sources[0]), { bytes: targetBytes, sha256: source.sha256, maximumRead: RECEIPT_CHUNK_BYTES });
  const saved = await okay('projectSave', { name: 'Native 512 MiB source recovery QA' });
  const listed = await okay('projectList'); assert.ok(listed.projects.some(item => item.id === saved.project.id));
  fs.unlinkSync(sourcePath);
  const loaded = await okay('projectLoad', { id: saved.project.id }); assert.equal(loaded.reconnectRequired, true);
  const reloaded = await desktop.coordinator.exportProject();
  const reloadHash = await hashStored(reloaded.sources[0]); assert.equal(reloadHash.bytes, targetBytes); assert.equal(reloadHash.sha256, source.sha256);
  pass('Native project Save and Load recover the exact 512 MiB source through opaque disk capabilities after the original file is deleted.');
  await okay('projectExport');
  const members = []; let projectMetadata, exportedSource;
  await readZipFile(exportPath, { async onEntry(entry) {
    const hash = createHash('sha256'); let bytes = 0, maximumRead = 0; const metadataChunks = [];
    for await (const chunk of entry.stream) { hash.update(chunk); bytes += chunk.length; maximumRead = Math.max(maximumRead, chunk.length); if (entry.name === 'project.json') metadataChunks.push(chunk); }
    const member = { name: entry.name, bytes, sha256: hash.digest('hex'), maximumRead }; members.push(member);
    if (entry.name === 'project.json') projectMetadata = JSON.parse(Buffer.concat(metadataChunks).toString('utf8'));
    if (entry.name === `blobs/${source.sha256}.blob`) exportedSource = member;
  } });
  assert.equal(exportedSource?.bytes, targetBytes); assert.equal(exportedSource.sha256, source.sha256);
  assert.ok(exportedSource.maximumRead <= 1048576);
  assert.equal(projectMetadata.project.snapshot.sources[0].contentSha256, source.sha256);
  const serialized = JSON.stringify(projectMetadata); assert.equal(serialized.includes('converge_512_upload_fixture'), false); assert.equal(serialized.includes('blobId'), false);
  projectEvidence = { id: saved.project.id, reloadHash, members, archive: await hashDisk(exportPath), originalDeletedBeforeReload: true };
  pass('Native project Export streams a portable ZIP whose independently hashed 512 MiB source matches saved and reloaded bytes.');

  const ownedContents = sides.map(side => desktop.views[side].webContents), closed = new Promise(resolve => desktop.mainWindow.once('closed', resolve));
  desktop.mainWindow.close(); await closed; await desktop.whenClosed(); assert.ok(ownedContents.every(contents => contents.isDestroyed()));
  pass('The large-file workspace disposes all owned pages and closes cleanly.');
  sampleMemory();
  assert.ok(memory.peakArrayBuffers < 128 * 1024 * 1024, `Host retained ${memory.peakArrayBuffers} bytes of ArrayBuffers.`);
  assert.ok(memory.peakHeapUsed - memory.initial.heapUsed < 256 * 1024 * 1024, 'Host heap grew as if retaining the full encoded source.');
  const report = { passed: true, localFixturesOnly: true, packaged: !!packagedAsar, packageVersion, bootstrapVersion,
    platform: process.platform, arch: process.arch, source, receipts, independentHashes: hashResults, wire, cancellation, heartbeat, sidebar,
    projectEvidence, memory, tests, nativePickerInvocations: openDialogs, uploadDurationMs: uploadCompletedAt - uploadStartedAt,
    projectDurationMs: Date.now() - projectStartedAt, totalDurationMs: Date.now() - startedAt,
    blockedRemoteOrigins: [...blockedRemoteOrigins], consoleMessages: messages,
    scope: 'Actual production Electron/native picker/generated preload/512 MiB file-input transport and streamed project recovery/export only. ChatGPT service acceptance, live model responses and large-file downloads are not tested here.' };
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  completed = true; clearTimeout(watchdog); clearInterval(memoryTimer); await fixture.close();
  // Chromium may hold a small profile lock until app.quit on Windows. Fixture
  // cleanup must never prevent a completed QA process from exiting. The
  // packaged wrapper removes its whole launcher after Electron has exited.
  try { cleanupProfile(); } catch (cleanupError) { process.stderr.write(`QA profile cleanup after Close: ${cleanupError.message}\n`); }
  process.stdout.write(`UPLOAD_512_QA ${JSON.stringify({ passed: true, sourceBytes: targetBytes, sourceSha256: source.sha256, reportPath, packageVersion })}\n`);
  app.quit();
}
async function fail(error) {
  if (completed) return;
  completed = true; clearTimeout(watchdog); clearInterval(memoryTimer);
  let state; try { state = await desktop?.coordinator.getState(); } catch (_) {}
  fs.writeFileSync(reportPath, JSON.stringify({ passed: false, localFixturesOnly: true, packaged: !!packagedAsar, packageVersion, source, wire, tests,
    error: error.stack || error.message, state, heartbeat, memory, consoleMessages: messages }, null, 2));
  process.stderr.write(`512 MiB upload QA failed: ${error.stack || error.message}\n`);
  try {
    if (desktop && !desktop.mainWindow.isDestroyed()) {
      const closed = new Promise(resolve => desktop.mainWindow.once('closed', resolve));
      desktop.mainWindow.close(); await closed; await desktop.whenClosed();
    }
    await fixture?.close(); cleanupProfile();
  } catch (cleanupError) { process.stderr.write(`QA cleanup: ${cleanupError.message}\n`); }
  app.exit(1);
}
app.whenReady().then(run).catch(fail);
