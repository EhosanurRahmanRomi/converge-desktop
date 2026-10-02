'use strict';

// Actual Chromium DOM and Electron will-download/broker regression for the
// resource-card structure observed on the live page. No account is opened.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { app, BrowserWindow, ipcMain, session } = require('electron');
const { createDownloadBroker } = require('../src/browser/downloads');
const { parseDraft } = require('../chrome-extension/background');
const { makePdf } = require('./qa-desktop-fixture');
const profile = fs.mkdtempSync(path.join(app.getPath('temp'), 'converge-card-qa-'));
app.setPath('userData', profile);
const bytes = makePdf('Corrected card fixture: 2 + 2 = 4.');
const sourceBytes = Buffer.from('#property strict\nvoid OnTick() { Print("exact current MQ5 candidate"); }\n');
const sourceName = 'NovaTrail_RiskControlled_v2.mq5';
const utf16SourceBytes = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(sourceBytes.toString('utf8'), 'utf16le')]);
const card = `<div class="resource-card"><div class="resource-list"><span class="group/resource-row resource-row">
  <button type="button" aria-busy="false" aria-label="Open preview of corrected.pdf" class="preview-action"></button>
  <span class="row-content"><span class="file-copy"><span title="corrected.pdf">corrected.pdf</span><span>PDF</span></span>
    <span class="download-hover"><span data-state="closed" class="contents"><button type="button" aria-label="Download file" class="download-action">↓</button></span></span>
  </span></span></div></div>`;
const response = `<h4 class="sr-only" data-conversation-role="assistant">ChatGPT said:</h4><div class="response-group">
  <div data-markdown-text-style="assistant-message"><p><span>{"answer":"Corrected the worksheet from </span><button type="button" data-testid="chatgpt-library-file-citation" aria-label="Open preview of source.pdf">source</button><span>. Download: </span><span data-file-reference="true" data-markdown-copy-text="corrected.pdf" role="button" aria-label="Open preview of corrected.pdf"><span>corrected.pdf</span></span><span>","uncertainties":[]}</span><button aria-label="View analysis" type="button">Analysis</button></p></div>${card}</div>`;
const page = `<!doctype html><html><head><meta charset="utf-8"><style>
body{font:14px sans-serif;margin:20px}.sr-only{position:absolute;width:1px;height:1px;clip:rect(0,0,0,0);overflow:hidden}.assistant{display:contents}
form{padding:12px;border:1px solid;width:500px;margin-top:20px}textarea{width:350px;height:45px}.resource-card{border:1px solid;width:400px;padding:10px;margin-top:10px}
.resource-row{display:block;position:relative;min-height:45px}.preview-action{position:absolute;inset:0;background:transparent;border:0}.row-content{display:flex;align-items:center;min-height:45px;pointer-events:none}.file-copy{display:flex;flex-direction:column}.download-hover{margin-left:auto;opacity:0;pointer-events:none;position:relative}.resource-row:focus-within .download-hover{opacity:1;pointer-events:auto}.contents{display:contents}.download-action{height:35px;width:35px}
</style></head><body><main><div id="turns"></div><form><textarea id="prompt-textarea" placeholder="Ask ChatGPT"></textarea><button type="button" data-testid="send-button">Send</button></form></main><script>
window.events=[];window.downloadClicks=0;window.previewClicks=0;window.mode='card';
window.chrome={runtime:{onMessage:{addListener(fn){window.listener=fn}},sendMessage(message){window.events.push(message);return Promise.resolve({ok:true})}}};
window.appendResponse=()=>{
 const turn=document.createElement('div');turn.className='assistant';turn.innerHTML=${JSON.stringify(response)};
 if(window.mode==='mq5-card'){turn.innerHTML=turn.innerHTML.replaceAll('corrected.pdf',${JSON.stringify(sourceName)})}
 if(['mq5-button','mq5-anchor','mq5-http-utf16','mq5-http-binary','unsupported-button','unsupported-anchor','unsupported-card'].includes(window.mode)){
   turn.querySelector('.resource-card').remove();
   const name=window.mode.startsWith('unsupported')?'candidate.zip':${JSON.stringify(sourceName)};
   if(window.mode==='unsupported-card'){
     const row=document.createElement('div');row.innerHTML='<button aria-label="Open preview of '+name+'"></button><span title="'+name+'">'+name+'</span><button aria-label="Download file" class="download-action">↓</button>';turn.append(row)
   }else{
     const action=document.createElement(window.mode.endsWith('anchor')||window.mode.startsWith('mq5-http')?'a':'button');action.className='download-action';action.textContent='Download '+name;action.setAttribute('aria-label','Download '+name);
     if(action.tagName==='A'){action.href=window.mode.startsWith('mq5-http')?'/'+name+'?encoding='+window.mode.slice('mq5-http-'.length):'sandbox:/mnt/data/'+name;action.setAttribute('role','button')}
     turn.querySelector('[data-markdown-text-style]').append(action)
   }
 }
 if(window.mode==='citation'){turn.querySelector('.resource-card').remove();const citation=turn.querySelector('[data-testid="chatgpt-library-file-citation"]');const bad=document.createElement('button');bad.type='button';bad.setAttribute('aria-label','Download file');citation.append(bad)}
 if(window.mode==='inline'){turn.querySelector('.resource-card').remove();const mention=turn.querySelector('[data-file-reference]');const bad=document.createElement('button');bad.type='button';bad.setAttribute('aria-label','Download file');mention.append(bad)}
 if(window.mode==='ordinary'){turn.querySelector('.resource-card').remove();const link=document.createElement('a');link.href='https://example.test/research.pdf';link.textContent='research.pdf';turn.querySelector('[data-markdown-text-style]').append(link)}
 document.getElementById('turns').append(turn);
 for(const button of turn.querySelectorAll('.preview-action'))button.addEventListener('click',()=>window.previewClicks++);
 for(const button of turn.querySelectorAll('.download-action'))button.addEventListener('click',(event)=>{event.preventDefault();window.downloadClicks++;
   if(window.mode==='busy'){button.disabled=true;setTimeout(()=>button.disabled=false,150)}
   if(window.mode==='changed-after'){button.replaceWith(button.cloneNode(true))}
   location.href=window.mode.startsWith('mq5')?'/'+${JSON.stringify(sourceName)}:'/corrected.pdf'});
};
document.querySelector('[data-testid="send-button"]').addEventListener('click',()=>{const editor=document.getElementById('prompt-textarea');const user=document.createElement('div');user.setAttribute('data-user-message-bubble','true');user.textContent=editor.value;document.getElementById('turns').append(user);editor.value='';setTimeout(appendResponse,25)});
</script></body></html>`;

async function run() {
  const server = http.createServer((request, res) => {
    if (request.url === '/corrected.pdf') { res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="corrected.pdf"' });res.end(bytes); }
    else if (request.url.startsWith(`/${sourceName}`)) {
      const payload = request.url.includes('encoding=utf16') ? utf16SourceBytes : request.url.includes('encoding=binary') ? Buffer.from('MZ\0\x02binary') : sourceBytes;
      res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Disposition': `attachment; filename="${sourceName}"` });res.end(payload);
    }
    else { res.writeHead(200, { 'Content-Type': 'text/html;charset=utf-8' });res.end(page); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const partition = `converge-native-card-${Date.now()}`;
  const browserSession = session.fromPartition(partition);
  browserSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: /^https?:/.test(details.url) && new URL(details.url).origin !== origin }));
  const win = new BrowserWindow({ show: false, width: 800, height: 700, webPreferences: { partition, contextIsolation: false, nodeIntegration: true } });
  const broker = createDownloadBroker({ browserSession, sideForContents: (contents) => contents === win.webContents ? 'left' : null,
    authorize: async () => true, tempRoot: profile });
  ipcMain.handle('card-qa:begin', (_event, payload) => broker.begin('left', payload));
  ipcMain.handle('card-qa:read', (_event, token) => broker.read('left', token));
  ipcMain.handle('card-qa:cancel', (_event, token) => broker.cancel('left', token));
  const source = fs.readFileSync(path.join(__dirname, '..', 'chrome-extension/content.js'), 'utf8');
  const js = (code) => win.webContents.executeJavaScript(code, true);
  let sequence = 0;
  const checks = [];
  async function setup(mode = 'card') {
    await win.loadURL(origin);
    await js(`(()=>{const module={exports:{}};${source}\nwindow.bridge=module.exports.createBridge({chrome:window.chrome,document,window,options:{tickMs:15,settleMs:35,sendSettleMs:20},async downloadVisible(request){
      const {ipcRenderer}=require('electron');const {element,signal,isCurrent,...metadata}=request;const started=await ipcRenderer.invoke('card-qa:begin',metadata);if(!started.ok)return started;
      if(window.mode==='changed-before-click')element.replaceWith(element.cloneNode(true));
      const cancel=()=>ipcRenderer.invoke('card-qa:cancel',started.token);signal.addEventListener('abort',cancel,{once:true});try{
        if(signal.aborted||element.isConnected!==true||element.disabled||element.getAttribute('aria-disabled')==='true'||isCurrent()!==true){await cancel();await ipcRenderer.invoke('card-qa:read',started.token);return{ok:false,error:'Captured action changed before click'}}
        element.click();const result=await ipcRenderer.invoke('card-qa:read',started.token);return result.ok?{...result,sourceVerifiedAtClick:true}:result
      }finally{signal.removeEventListener('abort',cancel)}
    }});window.mode=${JSON.stringify(mode)}})()`);
    await js(`new Promise(resolve=>listener({type:'INSPECT',chatMode:'normal',requireUnpersonalized:false},null,resolve))`);
  }
  async function submit(expectedType = 'REPLY') {
    const request = { runId: `card-run-${++sequence}`, requestId: `card-answer-${sequence}`, text: 'Correct the attached worksheet.', relayMedia: true };
    const submitted = await js(`window.bridge.sendPrompt(${JSON.stringify(request)})`);
    assert.equal(submitted.ok, true, submitted.error);
    const reply = await js(`new Promise((resolve,reject)=>{const started=Date.now();const timer=setInterval(()=>{const result=events.find(item=>['REPLY','ERROR'].includes(item.type)&&item.requestId===${JSON.stringify(request.requestId)});if(result){clearInterval(timer);resolve(result)}else if(Date.now()-started>5000){clearInterval(timer);reject(Error('No fixture reply'))}},20)})`);
    assert.equal(reply.type, expectedType, reply.error);
    return { request, reply };
  }
  const exported = (request) => js(`window.bridge.exportMedia(${JSON.stringify({ ...request, ids: ['media-1'] })})`);
  const check = async (name, operation) => { await operation();checks.push(name);process.stdout.write(`PASS: ${name}\n`); };
  try {
    await check('Current resource-row button downloads exact PDF bytes through the native Electron broker.', async () => {
      await setup();const { request, reply } = await submit();
      assert.deepEqual(reply.media.map(({ name, mimeType }) => ({ name, mimeType })), [{ name: 'corrected.pdf', mimeType: 'application/pdf' }]);
      assert.deepEqual(JSON.parse(reply.text), { answer: 'Corrected the worksheet from . Download: corrected.pdf', uncertainties: [] });
      assert.equal(await js(`getComputedStyle(document.querySelector('.download-hover')).opacity`), '0');
      const result = await exported(request);assert.equal(result.ok, true, result.error);
      assert.deepEqual(Buffer.from(result.files[0].base64, 'base64'), bytes);
      assert.equal(await js('downloadClicks'), 1);assert.equal(await js('previewClicks'), 0);
      assert.equal(await js(`getComputedStyle(document.querySelector('.download-hover')).opacity`), '1');
    });
    await check('Verified native PDF snapshots survive a full Chromium response remount and explicit Save after Stop without another click.', async () => {
      await setup();const { request } = await submit();const first = await exported(request);
      assert.equal(first.ok, true, first.error);
      await js(`(()=>{const response=document.querySelector('.assistant');window.removedResponse=response;response.replaceWith(response.cloneNode(true))})()`);
      assert.equal(await js('removedResponse.isConnected'), false);
      const repeated = await exported(request);
      assert.deepEqual(repeated.files, first.files);assert.equal(await js('downloadClicks'), 1);
      await js(`window.bridge.cancel(${JSON.stringify({ runId: request.runId })})`);
      assert.equal((await exported(request)).ok, false);
      const saved = await js(`window.bridge.exportMedia(${JSON.stringify({ ...request, ids: ['media-1'], allowCancelled: true })})`);
      assert.deepEqual(saved.files, first.files);assert.equal(await js('downloadClicks'), 1);assert.equal(await js('previewClicks'), 0);
    });
    await check('Changed resource filename or replaced button is rejected before the native click.', async () => {
      for (const mutation of [
        `document.querySelector('[title="corrected.pdf"]').setAttribute('title','different.pdf')`,
        `document.querySelector('.download-action').replaceWith(document.querySelector('.download-action').cloneNode(true))`,
        `document.querySelector('.preview-action').setAttribute('aria-label','Open preview of changed.pdf')`,
      ]) {
        await setup();const { request } = await submit();await js(mutation);const result = await exported(request);
        assert.equal(result.ok, false);assert.match(result.error, /changed|no longer/i);assert.equal(await js('downloadClicks'), 0);
      }
    });
    await check('A native download pins the source before its one click and accepts a React action replacement after that click.', async () => {
      await setup('changed-before-click');const before = await submit();const rejected = await exported(before.request);
      assert.equal(rejected.ok,false);assert.match(rejected.error,/changed before click/);assert.equal(await js('downloadClicks'),0);
      await setup('busy');const { request } = await submit();const result = await exported(request);
      assert.equal(result.ok, true, result.error);assert.deepEqual(Buffer.from(result.files[0].base64, 'base64'), bytes);
      assert.equal(await js('downloadClicks'), 1);
      await setup('changed-after');const changed = await submit();const captured = await exported(changed.request);
      assert.equal(captured.ok, true, captured.error);assert.deepEqual(Buffer.from(captured.files[0].base64,'base64'),bytes);
      assert.equal(await js('downloadClicks'),1);assert.equal(await js('previewClicks'),0);
      assert.deepEqual((await exported(changed.request)).files,captured.files);assert.equal(await js('downloadClicks'),1);
    });
    await check('Citation controls, inline mentions, and ordinary research links are excluded from generated outputs.', async () => {
      for (const mode of ['citation', 'inline', 'ordinary']) {
        await setup(mode);const { reply } = await submit();assert.deepEqual(reply.media, []);assert.equal(await js('downloadClicks'), 0);
      }
    });
    await check('Actual Chromium MQ5 cards, named native buttons and sandbox role-button links capture exact source bytes through Electron.', async () => {
      for (const mode of ['mq5-card', 'mq5-button', 'mq5-anchor']) {
        await setup(mode);const { request, reply } = await submit();
        assert.deepEqual(reply.media.map(({ name, mimeType }) => ({ name, mimeType })), [{ name: sourceName, mimeType: 'text/plain' }]);
        const result = await exported(request);assert.equal(result.ok, true, result.error);
        assert.equal(result.files[0].name, sourceName);
        assert.deepEqual(Buffer.from(result.files[0].base64, 'base64'), sourceBytes);
        assert.equal(await js('downloadClicks'), 1);assert.equal(await js('previewClicks'), 0);
      }
    });
    await check('Unsupported generated cards, named buttons and sandbox action links fail before any download or false media reply.', async () => {
      for (const mode of ['unsupported-card', 'unsupported-button', 'unsupported-anchor']) {
        await setup(mode);const { reply } = await submit('ERROR');
        assert.match(reply.error, /unsupported generated download.*cannot be shared safely/i);
        assert.equal(reply.media, undefined);assert.equal(await js('downloadClicks'), 0);assert.equal(await js('previewClicks'), 0);
        assert.equal(await js(`events.some(item=>item.type==='REPLY')`), false);
      }
    });
    await check('Direct Chromium fetched MQ5 preserves readable UTF-16 bytes and rejects binary masquerading as source without a download click.', async () => {
      await setup('mq5-http-utf16');const readable = await submit();const accepted = await exported(readable.request);
      assert.equal(accepted.ok, true, accepted.error);
      assert.deepEqual(Buffer.from(accepted.files[0].base64, 'base64'), utf16SourceBytes);
      assert.equal(await js('downloadClicks'), 0);
      await setup('mq5-http-binary');const binary = await submit();const rejected = await exported(binary.request);
      assert.equal(rejected.ok, false);assert.match(rejected.error, /binary data/);assert.equal(rejected.files, undefined);
      assert.equal(await js('downloadClicks'), 0);
    });
    await check('The captured provider too-long alert stops a confirmed Chromium request while its Stop control remains busy, without resubmission.', async () => {
      await setup();
      const rejectionHtml = '<div role="alert"><div class="flex min-w-0 grow flex-col"><div class="flex min-w-0 flex-col flex-1"><div class="flex min-w-0 flex-1 flex-col"><div class="min-w-0 flex-1">The message you submitted was too long, please edit it and resubmit.</div></div></div></div></div>';
      await js(`window.providerSendClicks=0;window.providerStopClicks=0;window.appendResponse=()=>{
        window.providerSendClicks++;const container=document.createElement('div');container.innerHTML=${JSON.stringify(rejectionHtml)};document.body.append(container.firstElementChild);
        const stop=document.createElement('button');stop.setAttribute('data-testid','stop-button');stop.setAttribute('aria-label','Stop');stop.textContent='Stop';stop.addEventListener('click',()=>{window.providerStopClicks++;stop.remove()});document.querySelector('form').append(stop);
      };undefined`);
      const { request, reply } = await submit('ERROR');
      assert.match(reply.error, /rejected.*too long.*automatic exchange has stopped.*no second submission/i);
      assert.equal(reply.requestId, request.requestId);
      assert.equal(await js('providerSendClicks'), 1);assert.equal(await js('providerStopClicks'), 1);
      assert.equal(await js(`document.querySelectorAll('[data-user-message-bubble="true"]').length`), 1);
      assert.equal(await js(`events.some(item=>item.type==='REPLY')`), false);
      const repeated = await js(`window.bridge.sendPrompt(${JSON.stringify(request)})`);assert.equal(repeated.ok, false);
      assert.equal(await js('providerSendClicks'), 1);
    });
    await check('An old page-level provider rejection alert cannot fail a new successful Chromium request.', async () => {
      await setup();
      await js(`(()=>{const alert=document.createElement('div');alert.setAttribute('role','alert');alert.textContent='The message you submitted was too long, please edit it and resubmit.';document.body.append(alert)})()`);
      const { reply } = await submit();assert.equal(reply.media.length, 1);
      assert.equal(await js(`events.some(item=>item.type==='ERROR')`), false);
    });
    const literal = JSON.stringify({ answer: 'Use Python: print("fixed")\nPath: C:\\reports\\corrected.pdf\nLiteral escape: \\n', uncertainties: [] }, null, 2);
    async function prepareCodeResponse({ before = '', after = '', second = false, native = false } = {}) {
      await setup();
      await js(`window.appendResponse=()=>{
        const turn=document.createElement('div');turn.innerHTML='<h4 class="sr-only" data-conversation-role="assistant">ChatGPT said:</h4><div data-markdown-text-style="assistant-message"></div>';
        const body=turn.querySelector('[data-markdown-text-style]');
        if(${Boolean(before)}){const p=document.createElement('p');p.textContent=${JSON.stringify(before)};body.append(p)}
        const toolbar=document.createElement('div');if(${native})toolbar.setAttribute('data-markdown-copy','exclude');else toolbar.setAttribute('role','toolbar');toolbar.textContent='JSON';const copy=document.createElement('button');copy.textContent='Copy code';toolbar.append(copy);
        const pre=document.createElement(${native}?'div':'pre');if(${native}){pre.setAttribute('data-markdown-copy','code-block');pre.append(toolbar)}else body.append(toolbar);
        const code=document.createElement('code');code.className='language-json';code.textContent=${JSON.stringify(literal)};pre.append(code);body.append(pre);
        if(${second})body.append(pre.cloneNode(true));
        if(${Boolean(after)}){const p=document.createElement('p');p.textContent=${JSON.stringify(after)};body.append(p)}
        document.getElementById('turns').append(turn);
      };undefined`);
    }
    await check('One fenced JSON code block preserves quotes, backslashes, and newlines exactly despite code controls.', async () => {
      for (const native of [false, true]) {
        await prepareCodeResponse({ native });const { reply } = await submit();
        assert.equal(reply.text, literal);
        assert.deepEqual(JSON.parse(reply.text), JSON.parse(literal));
        assert.equal(parseDraft(reply.text).answer, JSON.parse(literal).answer);
        assert.ok(parseDraft(reply.text).answer.includes('print("fixed")'));
        assert.ok(parseDraft(reply.text).answer.includes('C:\\reports\\corrected.pdf'));
      }
    });
    await check('Prose around a JSON block or multiple blocks is retained and strictly rejected instead of silently extracted.', async () => {
      for (const native of [false, true]) for (const options of [{ before: 'Here is the answer:' }, { after: 'Everything is now fixed.' }, { second: true }]) {
        await prepareCodeResponse({ ...options, native });const { reply } = await submit();
        assert.notEqual(reply.text, literal);
        assert.throws(() => parseDraft(reply.text), /JSON|valid|reply/i);
      }
    });
    const codeCapturePath = path.join(__dirname, '..', '.live-test', 'live-codeblock-header-dom.json');
    if (fs.existsSync(codeCapturePath)) await check('Captured DIV code-block language header is excluded while its Python quotes and complete literal JSON are preserved.', async () => {
      const capture = JSON.parse(fs.readFileSync(codeCapturePath, 'utf8')).result;
      for (const variation of ['sole', 'before', 'after', 'multiple']) {
        await setup();
        await js(`window.appendResponse=()=>{
          const turn=document.createElement('div');turn.innerHTML='<h4 class="sr-only" data-conversation-role="assistant">ChatGPT said:</h4>'+${JSON.stringify(capture.markdown)};
          const body=turn.querySelector('[data-markdown-text-style]');
          if(${JSON.stringify(variation)}==='before'||${JSON.stringify(variation)}==='after'){const prose=document.createElement('p');prose.textContent='Here is the answer.';${JSON.stringify(variation)}==='before'?body.prepend(prose):body.append(prose)}
          if(${JSON.stringify(variation)}==='multiple')body.append(body.querySelector('[data-markdown-copy="code-block"]').cloneNode(true));
          document.getElementById('turns').append(turn);
        };undefined`);
        const { reply } = await submit();
        if (variation === 'sole') {
          assert.equal(reply.text, capture.codeBlocks[0].text);
          assert.equal(parseDraft(reply.text).answer, JSON.parse(capture.codeBlocks[0].text).answer);
          assert.ok(parseDraft(reply.text).answer.includes('raise ValueError("start must be less than end")'));
          assert.doesNotMatch(reply.text, /^JSON/);
        } else {
          assert.notEqual(reply.text, capture.codeBlocks[0].text);
          assert.throws(() => parseDraft(reply.text), /JSON|valid|reply/i);
        }
      }
    });
    const capturedPath = path.join(__dirname, '..', '.live-test', 'pdf-native-card-dom.json');
    if (fs.existsSync(capturedPath)) await check('The captured live PDF response yields its exact generated file and valid JSON without card toolbar text.', async () => {
      const capturedHtml = JSON.parse(fs.readFileSync(capturedPath, 'utf8')).result.html;
      await setup();
      await js(`window.appendResponse=()=>{const turn=document.createElement('div');turn.innerHTML=${JSON.stringify(capturedHtml)};document.getElementById('turns').append(turn.firstElementChild)};undefined`);
      const { reply } = await submit();
      assert.equal(reply.media.length, 1);
      assert.equal(reply.media[0].mimeType, 'application/pdf');
      assert.equal(reply.media[0].name, 'corrected_CONVERGE-LIVE-731_worksheet.pdf');
      const parsed = JSON.parse(reply.text);
      assert.ok(parsed.answer.includes('corrected_CONVERGE-LIVE-731_worksheet.pdf'));
      assert.ok(Array.isArray(parsed.uncertainties));
      assert.doesNotMatch(reply.text, /ChatGPT said:|View analysis|Open file/);
    });
  } finally {
    await broker.dispose();ipcMain.removeHandler('card-qa:begin');ipcMain.removeHandler('card-qa:read');ipcMain.removeHandler('card-qa:cancel');win.destroy();
    await new Promise((resolve) => server.close(resolve));
  }
  process.stdout.write(`Native card Chromium regressions: ${checks.length} passed.\n`);
}

app.whenReady().then(run).then(() => app.quit(), (error) => { process.stderr.write(`${error.stack || error}\n`);app.exit(1); });
