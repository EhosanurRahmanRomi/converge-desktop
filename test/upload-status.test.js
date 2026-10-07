'use strict';

// A successful native attachment must release the shell's Start control even
// when the provider finishes by changing only an attribute on an existing card.
if (!process.versions.electron) {
  const test = require('node:test');
  const assert = require('node:assert/strict');
  const { spawn } = require('node:child_process');
  test('attribute-only attachment completion publishes ready page status', { timeout: 30000 }, async () => {
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const output = await new Promise((resolve, reject) => {
      const child = spawn(require('electron'), [__filename], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let log = '';
      child.stdout.on('data', data => { log += data; }); child.stderr.on('data', data => { log += data; });
      const timer = setTimeout(() => { child.kill(); reject(Error(`Attachment status regression timed out.\n${log}`)); }, 25000);
      child.on('error', error => { clearTimeout(timer); reject(error); });
      child.on('close', code => { clearTimeout(timer); resolve({ code, log }); });
    });
    assert.equal(output.code, 0, output.log);
    assert.match(output.log, /PASS: attribute-only attachment readiness regressions/);
  });
} else {
  const assert = require('node:assert/strict');
  const fs = require('node:fs/promises');
  const path = require('node:path');
  const { app, BrowserWindow, session } = require('electron');
  app.setPath('userData', path.join(app.getPath('temp'), `converge-upload-status-qa-${process.pid}`));
  app.on('window-all-closed', () => {});
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:0;font:14px sans-serif}form{padding:10px;width:500px}
    textarea{width:350px;height:50px}[hidden]{display:none}
  </style></head><body><main><form>
    <textarea id="prompt-textarea" placeholder="Ask ChatGPT"></textarea>
    <div id="previews"></div><button type="button" data-testid="send-button" aria-label="Send prompt">Send</button>
    <input id="picker" type="file" aria-label="Attach files" multiple hidden>
    </form></main><script>
    window.events=[];window.selected=[];window.submissions=[];window.attachmentLayout='marked';
    window.chrome={runtime:{onMessage:{addListener(listener){window.listener=listener}},sendMessage(message){window.events.push(message);return Promise.resolve({ok:true})}}};
    document.getElementById('picker').addEventListener('change',event=>{
      const previews=document.getElementById('previews');
      if(window.attachmentLayout==='marked')previews.setAttribute('aria-busy','true');
      for(const file of event.target.files){
        selected.push({name:file.name,size:file.size});
        const card=document.createElement('div');
        if(window.attachmentLayout==='marked'){card.setAttribute('data-testid','attachment');card.setAttribute('title',file.name)}
        if(window.attachmentLayout==='legacy-image'){
          const image=document.createElement('img');image.alt='preview';image.width=40;image.height=40;
          image.src='data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';card.append(image);
        }else{const name=document.createElement('span');name.textContent=file.name;card.append(name)}
        if(window.attachmentLayout!=='marked'){
          const spinner=document.createElement('span');spinner.className='animate-spin';spinner.setAttribute('role','progressbar');spinner.setAttribute('aria-busy','true');spinner.textContent='Loading';card.append(spinner);
        }
        previews.append(card);
      }
    });
    document.querySelector('[data-testid="send-button"]').addEventListener('click',()=>{
      const composer=document.getElementById('prompt-textarea');
      window.submissions.push({text:composer.value,stillUploading:!!document.getElementById('previews').querySelector('.animate-spin,[aria-busy="true"]')});
      const user=document.createElement('div');user.setAttribute('data-message-author-role','user');user.textContent=composer.value;document.querySelector('main').append(user);composer.value='';
      setTimeout(()=>{const reply=document.createElement('div');reply.setAttribute('data-message-author-role','assistant');reply.textContent='Done.';document.querySelector('main').append(reply)},20);
    });
    </script></body></html>`;
  async function run() {
    const partition = `converge-upload-status-${process.pid}`;
    session.fromPartition(partition).webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }));
    const win = new BrowserWindow({ show: false, width: 800, height: 650,
      webPreferences: { partition, offscreen: true, contextIsolation: false, nodeIntegration: false } });
    const source = await fs.readFile(path.join(__dirname, '..', 'chrome-extension', 'content.js'), 'utf8');
    const evaluate = code => win.webContents.executeJavaScript(code, true);
    const wait = (condition, description) => evaluate(`new Promise((resolve,reject)=>{
      const began=performance.now();const check=()=>{if(${condition})return resolve();if(performance.now()-began>1500)return reject(Error(${JSON.stringify(description)}));setTimeout(check,10)};check()
    })`);
    const latestStatus = 'window.events.filter(event=>event.type===\'PAGE_STATUS\').at(-1)?.status';
    try {
      await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      await evaluate(`(()=>{const module={exports:{}};${source}\nwindow.bridge=module.exports.createBridge({chrome:window.chrome,document,window,
        options:{tickMs:10,setupTimeoutMs:300,uploadTimeoutMs:1500,attachmentSettleMs:30,sendSettleMs:5,settleMs:20,replyTimeoutMs:1500}})})()`);
      await evaluate("new Promise(resolve=>listener({type:'INSPECT',chatMode:'normal',requireUnpersonalized:false},null,resolve))");
      await wait(`${latestStatus}?.ready===true`, 'Initial composer status did not become ready.');
      // A fresh provider page hydrates model/voice controls in the composer.
      // Its generic spinner is not evidence that an attachment was selected.
      await evaluate(`(()=>{const control=document.createElement('button');control.type='button';control.id='model-loading';control.setAttribute('aria-label','Loading model selector');
        control.innerHTML='<span class="animate-spin" role="progressbar" aria-busy="true">Loading</span>';document.querySelector('form').append(control)})()`);
      const newPage = await evaluate("new Promise(resolve=>listener({type:'PREPARE',chatMode:'normal',requireUnpersonalized:false},null,resolve))");
      assert.equal(newPage.ready, true, newPage.reason); assert.equal(newPage.busy, false);
      assert.equal(await evaluate('window.bridge.inspect().busy'), false);
      await evaluate("document.getElementById('model-loading').remove()");
      const uploading = await evaluate(`(()=>{const control=document.createElement('div');control.id='genuine-upload';control.setAttribute('data-upload-state','uploading');document.querySelector('form').append(control);return window.bridge.inspect()})()`);
      assert.equal(uploading.ready, false); assert.equal(uploading.busy, true); assert.match(uploading.reason, /uploading an attachment/);
      await evaluate("document.getElementById('genuine-upload').remove()");
      const drafted = await evaluate("document.getElementById('prompt-textarea').value='Unsent user draft';window.bridge.inspect()");
      assert.equal(drafted.ready, false); assert.equal(drafted.busy, true);
      await evaluate("document.getElementById('prompt-textarea').value=''");
      const generating = await evaluate(`(()=>{const stop=document.createElement('button');stop.id='real-stop';stop.type='button';stop.setAttribute('data-testid','stop-button');stop.setAttribute('aria-label','Stop generating');stop.textContent='Stop';document.querySelector('form').append(stop);return window.bridge.inspect()})()`);
      assert.equal(generating.ready, false); assert.equal(generating.busy, true);
      await evaluate("document.getElementById('real-stop').remove()");
      const file = { name: 'source.txt', mimeType: 'text/plain', base64: Buffer.from('Original source for the team.\n').toString('base64') };
      await evaluate(`window.uploadPromise=window.bridge.uploadFiles(${JSON.stringify({ files: [file] })});true`);
      await wait(`${latestStatus}?.busy===true`, 'Uploading attachment did not publish busy status.');
      assert.deepEqual(await evaluate('window.selected'), [{ name: file.name, size: 30 }]);
      const originalMarkup = await evaluate("document.getElementById('previews').innerHTML");
      // No card, text, class or child changes: this is the provider transition
      // that left the sidebar disabled despite an acknowledged upload.
      await evaluate("document.getElementById('previews').setAttribute('aria-busy','false')");
      const uploaded = await evaluate('window.uploadPromise');
      assert.equal(uploaded.ok, true, uploaded.error);
      assert.equal(uploaded.attached, 1);
      await wait(`${latestStatus}?.ready===true && ${latestStatus}?.busy===false`, 'Completed upload left the last published page status busy.');
      assert.equal(await evaluate("document.getElementById('previews').innerHTML"), originalMarkup);

      const chipSpinner = await evaluate(`(()=>{const spinner=document.createElement('span');spinner.id='attachment-spinner';spinner.className='animate-spin';spinner.textContent='Loading';document.querySelector('[data-testid="attachment"]').append(spinner);return window.bridge.inspect()})()`);
      assert.equal(chipSpinner.ready, false); assert.equal(chipSpinner.busy, true); assert.match(chipSpinner.reason, /uploading an attachment/);
      await evaluate("document.getElementById('attachment-spinner').remove()");
      assert.equal(await evaluate('window.bridge.inspect().ready'), true);

      // This second lifecycle has no upload call whose finally block could
      // publish on its behalf. Attribute observation itself must stay current.
      for (const attribute of ['aria-busy', 'data-upload-state']) {
        await evaluate(`document.getElementById('previews').setAttribute(${JSON.stringify(attribute)},${JSON.stringify(attribute === 'aria-busy' ? 'true' : 'uploading')})`);
        await wait(`${latestStatus}?.busy===true`, `${attribute} did not publish attachment processing.`);
        await evaluate(`document.getElementById('previews').removeAttribute(${JSON.stringify(attribute)})`);
        await wait(`${latestStatus}?.ready===true && ${latestStatus}?.busy===false`, `${attribute} completion did not publish a ready composer.`);
        assert.equal(await evaluate("document.getElementById('previews').innerHTML"), originalMarkup);
      }
      assert.equal(await evaluate('window.selected.length'), 1, 'Readiness repair selected or uploaded a second copy.');
      // A broad hydration marker must not turn an already completed card
      // elsewhere in the composer into evidence that the model is uploading.
      await evaluate(`document.querySelector('form').setAttribute('aria-busy','true');
        (()=>{const control=document.createElement('button');control.type='button';control.id='model-with-file';control.setAttribute('aria-label','Loading model selector');control.innerHTML='<span class="animate-spin" role="progressbar" aria-busy="true">Loading</span>';document.querySelector('form').append(control)})()`);
      assert.equal(await evaluate('window.bridge.inspect().ready'), true, 'An unrelated spinner beside a completed file must stay ready.');
      await evaluate("document.querySelector('form').removeAttribute('aria-busy');document.getElementById('model-with-file').remove()");
      for (const layout of ['legacy-file', 'legacy-image']) {
        await evaluate(`document.getElementById('previews').replaceChildren();document.getElementById('picker').value='';window.attachmentLayout=${JSON.stringify(layout)};window.promptCompleted=false`);
        const legacyFile = layout === 'legacy-file' ? { name: 'legacy.txt', mimeType: 'text/plain', base64: Buffer.from('Legacy source.\n').toString('base64') }
          : { name: 'legacy.gif', mimeType: 'image/gif', base64: 'R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=' };
        const submissionsBefore = await evaluate('window.submissions.length');
        await evaluate(`window.promptPromise=window.bridge.sendPrompt(${JSON.stringify({ runId: `legacy-${layout}`, requestId: `request-${layout}`, text: 'Review the attached file.', files: [legacyFile] })}).then(result=>{window.promptCompleted=true;return result});true`);
        await wait("document.getElementById('previews').querySelector('.animate-spin')!==null", `${layout} did not expose its plain Loading spinner.`);
        const legacyStatus = await evaluate('window.bridge.inspect()');
        assert.equal(legacyStatus.ready, false); assert.equal(legacyStatus.busy, true); assert.match(legacyStatus.reason, /uploading an attachment/);
        await evaluate('new Promise(resolve=>setTimeout(resolve,80))');
        assert.equal(await evaluate('window.promptCompleted'), false, `${layout} acknowledged while still uploading.`);
        assert.equal(await evaluate('window.submissions.length'), submissionsBefore, `${layout} sent its prompt while still uploading.`);
        await evaluate("document.getElementById('previews').querySelector('.animate-spin').remove()");
        const legacyResult = await evaluate('window.promptPromise');
        assert.equal(legacyResult.ok, true, legacyResult.error);
        assert.equal(await evaluate('window.submissions.length'), submissionsBefore + 1);
        assert.equal(await evaluate('window.submissions.at(-1).stillUploading'), false);
        await wait(`window.events.some(event=>event.type==='REPLY' && event.requestId===${JSON.stringify(`request-${layout}`)})`, `${layout} did not finish its owned reply.`);
      }
      await evaluate("document.getElementById('previews').replaceChildren();document.getElementById('picker').value='';window.attachmentLayout='marked'");
      const stagedText = Buffer.from('\ufeffvalue = "€"\n', 'utf16le');
      const stagedZip = Buffer.alloc(22); stagedZip.writeUInt32LE(0x06054b50);
      const stagedFiles = [{ name: 'streamed.txt', mimeType: 'text/plain', bytes: stagedText }, { name: 'empty.zip', mimeType: 'application/zip', bytes: stagedZip }];
      const invoke = message => evaluate(`new Promise(resolve=>listener(${JSON.stringify(message)},null,resolve))`);
      assert.equal((await invoke({ type: 'FILE_STAGE_BEGIN', transferId: 'native-stream', runId: 'native-stream-run', files: stagedFiles.map(({ name, mimeType, bytes }) =>
        ({ name, mimeType, byteLength: bytes.length, base64Length: Math.ceil(bytes.length / 3) * 4 })) })).ok, true);
      assert.equal(await evaluate('window.bridge.inspect().busy'), true);
      for (const [fileIndex, file] of stagedFiles.entries()) {
        let offset = 0;
        for (let start = 0; start < file.bytes.length; start += 3) {
          const data = file.bytes.subarray(start, start + 3).toString('base64');
          assert.equal((await invoke({ type: 'FILE_STAGE_CHUNK', transferId: 'native-stream', fileIndex, offset, data })).ok, true); offset += data.length;
        }
      }
      await evaluate("window.streamCommit=new Promise(resolve=>listener({type:'FILE_STAGE_COMMIT',transferId:'native-stream'},null,resolve));true");
      await wait("document.getElementById('picker').files.length===2", 'Decoded Blob parts did not produce two real native File inputs.');
      const observed = await evaluate("Promise.all(Array.from(document.getElementById('picker').files,async file=>({name:file.name,type:file.type,size:file.size,bytes:Array.from(new Uint8Array(await file.arrayBuffer()))})))");
      assert.deepEqual(observed, stagedFiles.map(({ name, mimeType, bytes }) => ({ name, type: mimeType, size: bytes.length, bytes: [...bytes] })));
      assert.equal(await evaluate('window.bridge.inspect().ready'), false);
      await evaluate("document.getElementById('previews').removeAttribute('aria-busy')");
      assert.equal((await evaluate('window.streamCommit')).attached, 2);
      const selectedBeforeCancel = await evaluate('window.selected.length');
      await invoke({ type: 'FILE_STAGE_BEGIN', transferId: 'native-canceled', runId: 'native-canceled-run', files: [{ name: 'canceled.txt', mimeType: 'text/plain', byteLength: 1, base64Length: 4 }] });
      await invoke({ type: 'FILE_STAGE_CHUNK', transferId: 'native-canceled', fileIndex: 0, offset: 0, data: 'YQ==' });
      await invoke({ type: 'CANCEL', runId: 'native-canceled-run' });
      assert.equal((await invoke({ type: 'FILE_STAGE_COMMIT', transferId: 'native-canceled' })).ok, false);
      assert.equal(await evaluate('window.selected.length'), selectedBeforeCancel);

      // Exercise the production helpers with real Chromium capabilities, then
      // remove each capability independently to cover older browser fallbacks.
      const capabilities = await evaluate(`(()=>{
        window.originalCodecs={decode:Uint8Array.fromBase64,encode:Uint8Array.prototype.toBase64,atob:window.atob,btoa:window.btoa};
        return {decode:typeof originalCodecs.decode,encode:typeof originalCodecs.encode}
      })()`);
      assert.deepEqual(capabilities, { decode: 'function', encode: 'function' });
      const octets = Buffer.alloc(786433);
      for (let index = 0; index < octets.length; index += 1) octets[index] = (index * 173 + 29) & 255;
      const codecFiles = [...stagedFiles, { name: 'all-octets.pdf', mimeType: 'application/pdf', bytes: octets }];
      const invalid = ['YR==', 'YWJ=', 'AB==', 'AAB=', 'YQ==AAAA', 'AA?=', 'A===', 'AAA=\n', 'YQ', 'YQ=', 'Y===', 'AA-_'];
      for (const mode of ['native', 'fallback', 'native-decode', 'native-encode']) {
        await evaluate(`(()=>{
          document.getElementById('previews').replaceChildren();document.getElementById('picker').value='';
          window.codecCalls={nativeDecode:0,nativeEncode:0,atob:0,btoa:0};
          Uint8Array.fromBase64=${JSON.stringify(mode)}==='native'||${JSON.stringify(mode)}==='native-decode'
            ? (...args)=>{codecCalls.nativeDecode++;return originalCodecs.decode.call(Uint8Array,...args)}:undefined;
          Uint8Array.prototype.toBase64=${JSON.stringify(mode)}==='native'||${JSON.stringify(mode)}==='native-encode'
            ? function(...args){codecCalls.nativeEncode++;return originalCodecs.encode.call(this,...args)}:undefined;
          window.atob=(...args)=>{codecCalls.atob++;return originalCodecs.atob.call(window,...args)};
          window.btoa=(...args)=>{codecCalls.btoa++;return originalCodecs.btoa.call(window,...args)};
        })()`);
        const transferId = `codecs-${mode}`;
        assert.equal((await invoke({ type: 'FILE_STAGE_BEGIN', transferId, files: codecFiles.map(({ name, mimeType, bytes }) =>
          ({ name, mimeType, byteLength: bytes.length, base64Length: Math.ceil(bytes.length / 3) * 4 })) })).ok, true);
        for (const [fileIndex, file] of codecFiles.entries()) {
          let offset = 0;
          const blockBytes = file.bytes.length > 786432 ? 786432 : 3;
          for (let start = 0; start < file.bytes.length; start += blockBytes) {
            const data = file.bytes.subarray(start, start + blockBytes).toString('base64');
            const result = await invoke({ type: 'FILE_STAGE_CHUNK', transferId, fileIndex, offset, data });
            assert.equal(result.ok, true, `${mode}: ${result.error}`); offset += data.length;
          }
        }
        await evaluate(`window.codecCommit=new Promise(resolve=>listener(${JSON.stringify({ type: 'FILE_STAGE_COMMIT', transferId })},null,resolve));true`);
        await wait("document.getElementById('picker').files.length===3", `${mode} did not select all decoded File inputs.`);
        const receipts = await evaluate("Array.from(document.getElementById('picker').files,file=>({name:file.name,type:file.type,size:file.size}))");
        // The offline data: page is not a secure context. Read real File slices
        // independently and hash on the host instead of relying on its codecs.
        for (const [fileIndex, receipt] of receipts.entries()) {
          const hash = require('node:crypto').createHash('sha256');
          for (let start = 0; start < receipt.size; start += 65536) {
            const bytes = await evaluate(`document.getElementById('picker').files[${fileIndex}].slice(${start},${Math.min(start + 65536, receipt.size)}).arrayBuffer().then(buffer=>Array.from(new Uint8Array(buffer)))`);
            hash.update(Buffer.from(bytes));
          }
          receipt.sha256 = hash.digest('hex');
        }
        assert.deepEqual(receipts, codecFiles.map(({ name, mimeType, bytes }) => ({ name, type: mimeType, size: bytes.length,
          sha256: require('node:crypto').createHash('sha256').update(bytes).digest('hex') })));
        await evaluate("document.getElementById('previews').removeAttribute('aria-busy')");
        assert.equal((await evaluate('window.codecCommit')).attached, 3);
        const calls = await evaluate('window.codecCalls');
        assert.equal(calls.nativeDecode > 0, ['native', 'native-decode'].includes(mode));
        assert.equal(calls.nativeEncode > 0, ['native', 'native-encode'].includes(mode));
        assert.equal(calls.atob > 0, ['fallback', 'native-encode'].includes(mode));
        assert.equal(calls.btoa > 0, ['fallback', 'native-decode'].includes(mode));
        const selections = await evaluate('window.selected.length');
        for (const [index, data] of invalid.entries()) {
          const badId = `${mode}-invalid-${index}`;
          assert.equal((await invoke({ type: 'FILE_STAGE_BEGIN', transferId: badId, files: [{ name: 'invalid.pdf', mimeType: 'application/pdf', base64Length: Math.max(4, Math.ceil(data.length / 4) * 4) }] })).ok, true);
          assert.equal((await invoke({ type: 'FILE_STAGE_CHUNK', transferId: badId, fileIndex: 0, offset: 0, data })).ok, false, `${mode} accepted ${JSON.stringify(data)}.`);
          assert.equal((await invoke({ type: 'FILE_STAGE_COMMIT', transferId: badId })).ok, false);
        }
        assert.equal(await evaluate('window.selected.length'), selections, `${mode} invalid encoding selected an attachment.`);
      }
      await evaluate(`(()=>{Uint8Array.fromBase64=originalCodecs.decode;Uint8Array.prototype.toBase64=originalCodecs.encode;window.atob=originalCodecs.atob;window.btoa=originalCodecs.btoa})()`);
      process.stdout.write('PASS: attribute-only attachment readiness regressions\n');
      process.stdout.write('PASS: genuine upload markers and file-widget spinners stay busy; unrelated fresh-composer spinners remain ready, drafts and generation stay blocked\n');
      process.stdout.write('PASS: legacy plain filenames and thumbnails wait for Loading spinners before sending; broad composer hydration and independent model spinners remain ready\n');
      process.stdout.write('PASS: staged Blob parts preserve UTF-16 and ZIP bytes in real File inputs, wait for previews and discard canceled transfers\n');
      process.stdout.write('PASS: native, fallback and mixed Base64 codecs preserve exact File hashes and reject malformed canonical chunks\n');
    } finally {
      win.destroy();
    }
  }
  app.whenReady().then(run).then(() => app.exit(0), error => { process.stderr.write(`${error.stack}\n`); app.exit(1); });
}
