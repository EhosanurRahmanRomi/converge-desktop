'use strict';

// Attachment regressions run the production bridge in actual Chromium against
// local fixture DOMs. They never open ChatGPT or touch a browser profile.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { app, BrowserWindow, session } = require('electron');
const output = require('./qa-output').createQaOutput({ onError: () => app.exit(1) });
const evidencePath = path.join(__dirname, '..', '.live-test', 'attachment-chromium-result.json');
const { makePdf } = require('./qa-desktop-fixture');
app.setPath('userData', require('node:fs').mkdtempSync(path.join(app.getPath('temp'), 'converge-attachment-qa-')));
// Destroying the final fixture window must not auto-quit Electron before its
// asynchronous evidence write finishes. The completion handler owns exit.
app.on('window-all-closed', () => {});

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6Zf8AAAAASUVORK5CYII=';
const pdf = makePdf('Attachment fixture source: 2 + 2 = 4.').toString('base64');
const files = {
  pdf: { name: 'source.pdf', mimeType: 'application/pdf', base64: pdf },
  image: { name: 'photo.png', mimeType: 'image/png', base64: png },
};
const checks = [];
const shell = (body, setup = '') => `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;font:14px sans-serif}#turns{height:100px}form,[data-testid="composer"]{border:1px solid;padding:10px;width:500px}
textarea{width:350px;height:50px}#previews img{width:40px;height:40px}[hidden]{display:none}
</style></head><body><main><div id="turns"></div>${body}</main><script>
window.events=[];window.chrome={runtime:{onMessage:{addListener(fn){window.listener=fn}},sendMessage(m){window.events.push(m);return Promise.resolve({ok:true})}}};
window.selected=[];
window.bindPicker=(picker)=>picker.addEventListener('change',()=>{
 window.selected.push({id:picker.id,files:Array.from(picker.files,f=>({name:f.name,type:f.type,size:f.size}))});
 const previews=document.getElementById('previews');previews.setAttribute('aria-busy','true');
 for(const file of picker.files){
  const observedName=window.renameUploads?file.name.replace(/(\\.[^.]+)$/,window.renameUploads+'$1'):file.name;
  const chip=document.createElement('div');chip.setAttribute('data-testid','attachment');chip.setAttribute('title',observedName);
  const remove=document.createElement('button');remove.type='button';remove.setAttribute('aria-label','Remove '+observedName);remove.addEventListener('click',()=>chip.remove());chip.append(remove);
  if(file.type.startsWith('image/')){const img=document.createElement('img');img.src=URL.createObjectURL(file);img.alt=observedName;chip.append(img)}
  else{const name=document.createElement('span');name.textContent=observedName;chip.append(name)}
  previews.append(chip);
 }
 setTimeout(()=>previews.removeAttribute('aria-busy'),80);
});
${setup}
</script></body></html>`;
const composer = '<textarea id="prompt-textarea" placeholder="Ask ChatGPT"></textarea><div id="previews"></div><button type="button" data-testid="send-button" aria-label="Send prompt">Send</button>';

async function run() {
  const partition = `converge-attachments-${Date.now()}`;
  session.fromPartition(partition).webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }));
  const win = new BrowserWindow({ show: false, width: 800, height: 700,
    webPreferences: { partition, offscreen: true, contextIsolation: false, nodeIntegration: false } });
  const source = await fs.readFile(path.join(__dirname, '..', 'chrome-extension', 'content.js'), 'utf8');
  const js = (code) => win.webContents.executeJavaScript(code, true);
  async function load(body, setup) {
    // Data URLs remain entirely local; block only HTTP(S) in the fixture session.
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(shell(body, setup))}`);
    await js(`(()=>{const module={exports:{}};${source}\nwindow.bridge=module.exports.createBridge({chrome:window.chrome,document,window,options:{tickMs:15,setupTimeoutMs:300,uploadTimeoutMs:700,attachmentSettleMs:80,sendSettleMs:20,settleMs:25}})})()`);
  }
  const upload = (items) => js(`window.bridge.uploadFiles(${JSON.stringify({ files: items })})`);
  async function check(name, operation) {
    await operation();checks.push(name);output.out(`PASS: ${name}\n`);
  }
  try {
    await check('One hidden form picker accepts a real PDF and image and confirms both previews.', async () => {
      await load(`<form>${composer}<input id="all-files" type="file" multiple hidden></form>`, `bindPicker(document.getElementById('all-files'));`);
      const result = await upload([files.pdf, files.image]);
      assert.equal(result.ok, true, result.error);
      const selected = await js('window.selected');
      assert.equal(selected.length, 1);
      assert.deepEqual(selected[0].files.map((file) => file.name), ['source.pdf', 'photo.png']);
      assert.deepEqual(selected[0].files.map((file) => file.type), ['application/pdf', 'image/png']);
      assert.equal(await js('document.getElementById("previews").hasAttribute("aria-busy")'), false);
    });
    await check('The observed three-picker composer selects Attach files for PDFs, images, and mixed batches.', async () => {
      for (const items of [[files.pdf], [files.image], [files.pdf, files.image]]) {
        await load(`<form>${composer}<div role="presentation"><button type="button" aria-label="Add files and more">+</button>
          <input id="photos-videos" type="file" aria-label="Attach photos or videos" accept="image/*,video/*" multiple hidden>
          <input id="photos" type="file" aria-label="Attach photos" accept="image/*" multiple hidden>
          <input id="documents" type="file" aria-label="Attach files" multiple hidden></div></form>`,
        `document.querySelectorAll('input[type=file]').forEach(bindPicker);`);
        const result = await upload(items);
        assert.equal(result.ok, true, result.error);
        const selected = await js('window.selected');
        assert.equal(selected.length, 1);
        assert.equal(selected[0].id, 'documents');
        assert.deepEqual(selected[0].files.map((file) => file.name), items.map((file) => file.name));
      }
    });
    const confirmNormal = () => js(`new Promise(resolve=>listener({type:'INSPECT',chatMode:'normal',requireUnpersonalized:false},null,resolve))`);
    const bindSend = `document.querySelector('[data-testid="send-button"]').addEventListener('click',()=>{
      const editor=document.getElementById('prompt-textarea');window.events.push({type:'SUBMITTED',text:editor.value});
      const user=document.createElement('div');user.setAttribute('data-message-author-role','user');user.textContent=editor.value;document.getElementById('turns').append(user);editor.value='';
      setTimeout(()=>{const answer=document.createElement('div');answer.setAttribute('data-message-author-role','assistant');answer.textContent='Reviewed the attached fixtures.';document.getElementById('turns').append(answer)},30);
    });`;
    await check('Numeric and timestamp server-renamed PDF and PNG attachments are verified and both source names reach Send.', async () => {
      for (const suffix of ['(1)', ' (2)', '(20261001-004940)', ' (20261001-004949)', '(20261001-070436-1)', ' (20261001-070436-23)']) {
        await load(`<form>${composer}<input id="documents" type="file" aria-label="Attach files" multiple hidden></form>`,
          `window.renameUploads=${JSON.stringify(suffix)};bindPicker(document.getElementById('documents'));${bindSend}`);
        const result = await upload([files.pdf, files.image]);
        assert.equal(result.ok, true, result.error);
        assert.equal(await js(`document.querySelector('[title="source${suffix}.pdf"]')!==null`), true);
        await confirmNormal();
        const sent = await js(`window.bridge.sendPrompt(${JSON.stringify({ type: 'SEND_PROMPT', runId: `alias-${suffix}`, requestId: `source-${suffix}`, text: 'Inspect the attached PDF and picture.', expectedSourceNames: ['source.pdf', 'photo.png'] })})`);
        assert.equal(sent.ok, true, sent.error);
        assert.equal(await js(`window.events.filter(event=>event.type==='SUBMITTED').length`), 1);
      }
    });
    await check('Three separate five-file batches confirm all fifteen boss sources before a single prompt sends.', async () => {
      const originals = Array.from({ length: 5 }, (_, i) => ({ ...files.pdf, name: `ORIGINAL_SOURCE_${i + 1}.pdf` }));
      const left = Array.from({ length: 5 }, (_, i) => ({ name: `RESULT_W1_${i + 1}.txt`, mimeType: 'text/plain', base64: Buffer.from(`Worker A result ${i + 1}\n`).toString('base64') }));
      const right = Array.from({ length: 5 }, (_, i) => ({ ...files.image, name: `RESULT_W2_${i + 1}.png` }));
      const batches = [originals, left, right];
      for (const removedName of [null, originals[0].name, right[4].name]) {
        await load(`<form>${composer}<input id="documents" type="file" aria-label="Attach files" multiple hidden></form>`,
          `window.renameUploads='(1)';bindPicker(document.getElementById('documents'));${bindSend}`);
        for (const batch of batches) assert.deepEqual(await upload(batch), { ok: true, attached: 5 });
        const allNames = batches.flat().map(file => file.name);
        assert.equal(await js('window.selected.length'), 3, 'No upload batch may be silently dropped.');
        assert.equal(await js('document.querySelectorAll("#previews [data-testid=attachment]").length'), 15);
        await confirmNormal();
        if (removedName) {
          const observed = removedName.replace(/(\.[^.]+)$/, '(1)$1');
          await js(`document.querySelector('[title="'+${JSON.stringify(observed)}+'"]')?.remove()`);
        }
        const sent = await js(`window.bridge.sendPrompt(${JSON.stringify({ type: 'SEND_PROMPT', runId: `staged-${removedName || 'all'}`, requestId: 'boss-review', text: 'Inspect every original and both worker bundles.', expectedSourceNames: allNames })})`);
        assert.equal(sent.ok, removedName === null, sent.error);
        assert.equal(await js('window.events.filter(event=>event.type==="SUBMITTED").length'), removedName ? 0 : 1);
        if (removedName) assert.match(sent.error, /source document is no longer attached/i);
      }
    });
    await check('Removing the new renamed document cannot be hidden by an older original-name chip.', async () => {
      await load(`<form>${composer}<input id="documents" type="file" aria-label="Attach files" multiple hidden></form>`,
        `document.getElementById('previews').innerHTML='<span>source.pdf</span>';window.renameUploads='(1)';bindPicker(document.getElementById('documents'));${bindSend}`);
      assert.equal((await upload([files.pdf])).ok, true);
      await confirmNormal();
      await js(`document.querySelector('[title="source(1).pdf"]').remove()`);
      const sent = await js(`window.bridge.sendPrompt(${JSON.stringify({ type: 'SEND_PROMPT', runId: 'removed-alias', requestId: 'removed-alias-draft', text: 'Inspect my PDF.', expectedSourceNames: ['source.pdf'] })})`);
      assert.equal(sent.ok, false);
      assert.match(sent.error, /source document is no longer attached/i);
      assert.equal(await js(`window.events.filter(event=>event.type==='SUBMITTED').length`), 0);
    });
    await check('An incoming revised file renamed by the server uploads before the review prompt sends.', async () => {
      await load(`<form>${composer}<input id="documents" type="file" aria-label="Attach files" multiple hidden></form>`,
        `window.renameUploads='(3)';bindPicker(document.getElementById('documents'));${bindSend}`);
      await confirmNormal();
      const sent = await js(`window.bridge.sendPrompt(${JSON.stringify({ type: 'SEND_PROMPT', runId: 'incoming-alias', requestId: 'incoming-alias-review', text: 'Critically review this revised PDF.', files: [files.pdf] })})`);
      assert.equal(sent.ok, true, sent.error);
      assert.equal(await js(`document.querySelector('[title="source(3).pdf"]')!==null`), true);
      assert.equal(await js(`window.events.filter(event=>event.type==='SUBMITTED').length`), 1);
    });
    await check('Valid 6 MB and the full 12 MB source-file limit upload without exhausting the regexp stack.', async () => {
      for (const size of [6 * 1024 * 1024, 12 * 1024 * 1024]) {
        await load(`<form>${composer}<input id="documents" type="file" aria-label="Attach files" multiple hidden></form>`, `bindPicker(document.getElementById('documents'));`);
        const bytes = Buffer.alloc(size, 32);makePdf('Large source-file fixture.').copy(bytes);
        const item = { name: 'large-source.pdf', mimeType: 'application/pdf', base64: bytes.toString('base64') };
        const result = await upload([item]);
        assert.equal(result.ok, true, `${size}-byte file failed: ${result.error}`);
        assert.equal(await js('window.selected[0].files[0].size'), size);
      }
    });
    await check('Invalid base64 padding and over-limit contents never reach the picker.', async () => {
      for (const base64 of ['YQ=', 'Y===', '====', 'YQ==AAAA', Buffer.alloc(12 * 1024 * 1024 + 1, 65).toString('base64')]) {
        await load(`<form>${composer}<input id="documents" type="file" aria-label="Attach files" multiple hidden></form>`, `bindPicker(document.getElementById('documents'));`);
        const result = await upload([{ name: 'source.pdf', mimeType: 'application/pdf', base64 }]);
        assert.equal(result.ok, false);
        assert.match(result.error, /invalid|oversized/i);
        assert.deepEqual(await js('window.selected'), []);
      }
    });
    await check('A composer without a form stays within its nearby control group.', async () => {
      await load(`<div role="presentation">${composer}<button type="button" aria-label="Add files and more">+</button>
        <input id="documents" type="file" aria-label="Attach files" multiple hidden></div>`, `bindPicker(document.getElementById('documents'));`);
      assert.equal((await upload([files.pdf, files.image])).ok, true);
      assert.equal(await js('window.selected[0].id'), 'documents');
    });
    await check('A delayed picker is awaited before selecting any file.', async () => {
      await load(`<form id="composer">${composer}</form>`, `setTimeout(()=>{
        const input=document.createElement('input');input.type='file';input.id='delayed';input.multiple=true;input.hidden=true;input.setAttribute('aria-label','Attach files');
        document.getElementById('composer').append(input);bindPicker(input);
      },120);`);
      assert.equal((await upload([files.pdf])).ok, true);
      assert.equal(await js('window.selected[0].id'), 'delayed');
    });
    await check('An external form-associated Attach files input is selected while old-turn inputs are ignored.', async () => {
      await load(`<div data-message-author-role="user"><input id="old-picker" type="file" aria-label="Attach files" multiple hidden></div>
        <form id="composer">${composer}</form><input id="portal-picker" form="composer" type="file" aria-label="Attach files" multiple hidden>`,
      `document.querySelectorAll('input[type=file]').forEach(bindPicker);`);
      assert.equal((await upload([files.pdf])).ok, true);
      assert.equal(await js('window.selected[0].id'), 'portal-picker');
    });
    await check('Specific image accept rules choose photos over photos/videos when the general picker is disabled.', async () => {
      await load(`<form>${composer}<input id="disabled" type="file" aria-label="Attach files" multiple disabled hidden>
        <input id="photos-videos" type="file" accept="image/*,video/*" multiple hidden>
        <input id="photos" type="file" accept="image/*" multiple hidden></form>`, `document.querySelectorAll('input[type=file]').forEach(bindPicker);`);
      assert.equal((await upload([files.image])).ok, true);
      assert.equal(await js('window.selected[0].id'), 'photos');
    });
    await check('Identical eligible pickers remain ambiguous and no selection occurs.', async () => {
      await load(`<form>${composer}<input id="first" type="file" aria-label="Attach files" multiple hidden>
        <input id="second" type="file" aria-label="Attach files" multiple hidden></form>`, `document.querySelectorAll('input[type=file]').forEach(bindPicker);`);
      const result = await upload([files.pdf]);
      assert.equal(result.ok, false);
      assert.match(result.error, /more than one.*picker/i);
      assert.deepEqual(await js('window.selected'), []);
    });
    await check('An image-only or single-file picker cannot receive an incompatible document or multi-file batch.', async () => {
      for (const { picker, items } of [
        { picker: '<input id="images" type="file" aria-label="Attach files" accept="image/*" multiple hidden>', items: [files.pdf] },
        { picker: '<input id="single" type="file" aria-label="Attach files" hidden>', items: [files.pdf, files.image] },
      ]) {
        await load(`<form>${composer}${picker}</form>`, `document.querySelectorAll('input[type=file]').forEach(bindPicker);`);
        const result = await upload(items);
        assert.equal(result.ok, false);
        assert.match(result.error, /compatible file picker/i);
        assert.deepEqual(await js('window.selected'), []);
      }
    });
    await check('A visible upload rejection blocks success even when a filename chip appeared.', async () => {
      await load(`<form>${composer}<input id="documents" type="file" aria-label="Attach files" multiple hidden></form>`, `
        const picker=document.getElementById('documents');picker.addEventListener('change',()=>{
          window.selected.push({id:picker.id});const previews=document.getElementById('previews');const chip=document.createElement('span');chip.textContent=picker.files[0].name;previews.append(chip);
          const failure=document.createElement('div');failure.setAttribute('role','alert');failure.textContent='File upload failed. Please try again.';previews.append(failure);
        });`);
      const result = await upload([files.pdf]);
      assert.equal(result.ok, false);
      assert.match(result.error, /rejected an attachment.*upload failed/i);
    });
    await check('A plain network-failure widget with a PDF filename blocks both upload confirmation and Start readiness.', async () => {
      await load(`<form>${composer}<input id="documents" type="file" aria-label="Attach files" multiple hidden></form>`, `
        const picker=document.getElementById('documents');picker.addEventListener('change',()=>{
          window.selected.push({id:picker.id});document.getElementById('previews').innerHTML='<div title="source.pdf"><div>Upload failed because of a network issue. Check your connection and try again.</div><span>source.pdf</span></div>';
        });`);
      const result = await upload([files.pdf]);
      assert.equal(result.ok, false);
      assert.match(result.error, /rejected an attachment.*network issue/i);
      const status = await js(`new Promise(resolve=>listener({type:'INSPECT',chatMode:'normal'},null,resolve))`);
      assert.equal(status.ready, false);
      assert.match(status.reason, /attachment failed.*network issue/i);
      const sent = await js(`window.bridge.sendPrompt(${JSON.stringify({type:'SEND_PROMPT',runId:'failed-source',requestId:'failed-source-request',text:'Review source.pdf.'})})`);
      assert.equal(sent.ok, false);
      assert.equal(await js(`document.getElementById('prompt-textarea').value`), '');
      assert.equal(await js(`window.selected.length`), 1, 'An upload failure must not trigger an automatic duplicate upload.');
    });
    await check('An old failed widget outside the composer cannot reject the fresh source upload.', async () => {
      await load(`<div data-message-author-role="user"><div>Upload failed because of a network issue.</div></div><form>${composer}<input id="documents" type="file" aria-label="Attach files" multiple hidden></form>`,
        `bindPicker(document.getElementById('documents'));`);
      assert.equal((await upload([files.pdf])).ok, true);
      const status = await js(`new Promise(resolve=>listener({type:'INSPECT',chatMode:'normal'},null,resolve))`);
      assert.equal(status.ready, true, status.reason);
    });
    await check('Removing an uploaded nameless image blocks the subsequent source prompt before Send.', async () => {
      await load(`<form>${composer}<input id="documents" type="file" aria-label="Attach files" multiple hidden></form>`, `
        const picker=document.getElementById('documents');picker.addEventListener('change',()=>{
          window.selected.push({id:picker.id});const image=document.createElement('img');image.alt='Attached preview';image.src=URL.createObjectURL(picker.files[0]);document.getElementById('previews').append(image);
        });`);
      assert.equal((await upload([files.image])).ok, true);
      await js(`new Promise(resolve=>listener({type:'INSPECT',chatMode:'normal',requireUnpersonalized:false},null,resolve));document.getElementById('previews').replaceChildren();`);
      const result = await js(`window.bridge.sendPrompt(${JSON.stringify({ type: 'SEND_PROMPT', runId: 'removed-image', requestId: 'removed-image-draft', text: 'Review my photo.', expectedSourceNames: ['photo.png'] })})`);
      assert.equal(result.ok, false);
      assert.match(result.error, /source document is no longer attached/i);
      assert.equal(await js('document.getElementById("prompt-textarea").value'), '');
    });
  } finally { win.destroy(); }
  await fs.mkdir(path.dirname(evidencePath), { recursive: true });
  await fs.writeFile(evidencePath, JSON.stringify({ passed: true, tests: checks, localFixturesOnly: true }, null, 2));
  output.out(`Attachment Chromium regressions: ${checks.length} passed.\n`);
}

app.whenReady().then(run).then(() => app.quit(), async error => {
  output.error(`${error.stack || error}\n`);
  try { await fs.mkdir(path.dirname(evidencePath), { recursive: true });
    await fs.writeFile(evidencePath, JSON.stringify({ passed: false, tests: checks, error: error.stack || String(error) }, null, 2));
  } finally { app.exit(1); }
});
