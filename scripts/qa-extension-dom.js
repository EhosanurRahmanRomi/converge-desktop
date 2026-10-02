'use strict';

// Offline Chromium smoke test for the actual content script. This local page
// resembles the controls visible in the user's recording; it never opens ChatGPT.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const { app, BrowserWindow } = require('electron');

const page = `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;padding:24px;font:16px sans-serif;background:#111;color:#eee}
  form{position:absolute;bottom:24px;left:24px;width:500px;border:1px solid #555;padding:15px}
  [contenteditable]{min-height:40px;outline:1px solid #777;padding:8px}
  img{width:40px;height:40px}img.generated{width:256px;height:128px}
</style></head><body><div id="turns"></div><form id="composer-form">
  <div id="prompt-textarea" class="ProseMirror" role="textbox" data-placeholder="Ask anything" contenteditable="true"><p><br></p></div>
  <input id="files" type="file" multiple><div id="previews"></div>
  <button type="button" id="send" data-testid="send-button" hidden>Send</button>
</form><script>
  window.events=[];
  window.fixtureMode='text';
  window.corruptEditorWord=false;
  window.localMediaOrigin='__LOCAL_MEDIA_ORIGIN__';
  window.chrome={runtime:{onMessage:{addListener(fn){window.listener=fn}},
    sendMessage(message){window.events.push(message);return Promise.resolve({ok:true})}}};
  const editor=document.querySelector('[contenteditable]');
  const send=document.getElementById('send');
  // A local rich-editor transaction converts inserted lines into paragraphs,
  // as the real page's ProseMirror editor does. Its rendered paragraph spacing
  // and trimmed line indentation differ from the raw prompt string.
  editor.addEventListener('input',()=>{
    let text=editor.innerText;
    if(window.corruptEditorWord)text=text.replace('factual','fictional');
    editor.replaceChildren(...text.split(/\\r?\\n/).map(line=>{
      const p=document.createElement('p');
      if(line.trim())p.textContent=line.trim().replace(/ /g,'\\u00a0');
      else p.append(document.createElement('br'));
      return p;
    }));
    send.hidden=!editor.innerText.trim();
  });
  send.addEventListener('click',()=>{
    const text=editor.innerText.trim();
    window.events.push({type:'SUBMITTED',text,uploadBusy:document.getElementById('previews').getAttribute('aria-busy'),files:window.lastFiles||[]});
    const user=document.createElement('div');user.setAttribute('data-message-author-role','user');user.textContent=text;
    document.getElementById('turns').append(user);editor.innerText='';send.hidden=true;document.getElementById('previews').replaceChildren();
    setTimeout(()=>{const reply=document.createElement('div');reply.setAttribute('data-message-author-role','assistant');
      if(window.fixtureMode==='image'||window.fixtureMode==='cors-image'){
        const canvas=document.createElement('canvas');canvas.width=128;canvas.height=64;
        canvas.getContext('2d').fillRect(0,0,128,64);
        const image=document.createElement('img');image.className='generated';image.alt='Generated landscape';
        image.src=window.fixtureMode==='image'?canvas.toDataURL('image/png'):window.localMediaOrigin+'/square.svg';
        const clickable=document.createElement('button');clickable.type='button';clickable.append(image);reply.append(clickable);
      }else if(window.fixtureMode==='file'){
        const link=document.createElement('a');link.download='report.csv';link.textContent='report.csv';link.href=window.localMediaOrigin+'/report.csv';reply.append(link);
      }else{reply.textContent='A completed fixture answer'}
      document.getElementById('turns').append(reply)},25);
  });
  document.getElementById('files').addEventListener('change',event=>{
    window.lastFiles=Array.from(event.target.files,file=>({name:file.name,type:file.type,size:file.size}));
    window.events.push({type:'FILE_SELECTED',files:window.lastFiles});
    document.getElementById('previews').setAttribute('aria-busy','true');
    for(const file of event.target.files){const img=document.createElement('img');img.alt='preview';
      img.src='data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';
      document.getElementById('previews').append(img)}
    setTimeout(()=>document.getElementById('previews').removeAttribute('aria-busy'),50);
  });
</script></body></html>`;

async function run() {
  const server = http.createServer((request, response) => {
    if (request.url === '/square.svg') {
      response.writeHead(200, { 'Content-Type': 'image/svg+xml' });
      response.end('<svg xmlns="http://www.w3.org/2000/svg" width="128" height="64"><rect width="128" height="64" fill="blue"/></svg>');
    } else if (request.url === '/report.csv') {
      response.writeHead(200, { 'Content-Type': 'text/csv', 'Access-Control-Allow-Origin': '*' });
      response.end('item,value\nfixture,42\n');
    } else { response.writeHead(404); response.end(); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const localOrigin = `http://127.0.0.1:${server.address().port}`;
  // Loopback HTTP is a secure context for Web Crypto. Use a separate origin
  // for media so the canvas test exercises a real browser CORS restriction.
  const fixtureServer = http.createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html;charset=utf-8' });
    response.end(page.replace('__LOCAL_MEDIA_ORIGIN__', localOrigin));
  });
  await new Promise((resolve) => fixtureServer.listen(0, '127.0.0.1', resolve));
  const win = new BrowserWindow({ show: false, width: 800, height: 700,
    webPreferences: { offscreen: true, contextIsolation: false, nodeIntegration: false } });
  try {
    await win.loadURL(`http://127.0.0.1:${fixtureServer.address().port}/`);
    const source = await fs.readFile(path.join(__dirname, '..', 'chrome-extension', 'content.js'), 'utf8');
    await win.webContents.executeJavaScript(source);
    const initial = await win.webContents.executeJavaScript(`new Promise(resolve=>listener({type:'INSPECT'},null,resolve))`);
    assert.equal(initial.ready, true, `Empty Ask anything composer was not ready: ${initial.reason}`);
    const upload = await win.webContents.executeJavaScript(`new Promise(resolve=>listener({type:'UPLOAD_FILES',files:[{name:'photo.png',mimeType:'image/png',base64:'R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs='}]},null,resolve))`);
    assert.equal(upload.ok, true, `Image thumbnail was not confirmed: ${upload.error}`);
    const multilinePrompt = 'Review this image.\n\nCheck every factual claim.\n\nReturn the answer in this form:\n  answer\n  uncertainty\n\nPreserve the full instruction.\n\nExchange tracking ID: one';
    const sent = await win.webContents.executeJavaScript(`new Promise(resolve=>listener(${JSON.stringify({ type: 'SEND_PROMPT', runId: 'qa', requestId: 'one', text: multilinePrompt })},null,resolve))`);
    if (!sent.ok) process.stderr.write(`Multiline editor diagnosis: ${JSON.stringify(await win.webContents.executeJavaScript(`({text:document.querySelector('[contenteditable]').innerText,html:document.querySelector('[contenteditable]').innerHTML})`))}\n`);
    assert.equal(sent.ok, true, `Visible composer did not send: ${sent.error}`);
    const result = await win.webContents.executeJavaScript(`new Promise((resolve,reject)=>{const started=Date.now();
      const timer=setInterval(()=>{const event=window.events.find(item=>item.type==='REPLY');
        if(event){clearInterval(timer);resolve(event)}else if(Date.now()-started>8000){clearInterval(timer);reject(Error('No completed reply'))}},25)})`);
    assert.equal(result.text, 'A completed fixture answer');
    const actualPrompt = await win.webContents.executeJavaScript(`window.events.find(item=>item.type==='SUBMITTED').text`);
    const canonicalText = (text) => text.replace(/\s+/g, ' ').trim();
    assert.equal(canonicalText(actualPrompt), canonicalText(multilinePrompt), 'Rich-editor paragraph normalization changed meaningful instruction text.');
    assert.notEqual(actualPrompt, multilinePrompt, 'The fixture must exercise actual rich-editor paragraph and indentation normalization.');
    const call = (message) => win.webContents.executeJavaScript(`new Promise(resolve=>listener(${JSON.stringify(message)},null,resolve))`);
    const responseFor = (requestId) => win.webContents.executeJavaScript(`new Promise((resolve,reject)=>{const started=Date.now();
      const timer=setInterval(()=>{const event=window.events.find(item=>['REPLY','ERROR'].includes(item.type)&&item.requestId===${JSON.stringify(requestId)});
        if(event){clearInterval(timer);resolve(event)}else if(Date.now()-started>8000){clearInterval(timer);reject(Error('No completed response'))}},25)})`);
    await win.webContents.executeJavaScript(`window.corruptEditorWord=true`);
    const sendsBeforeCorruption = await win.webContents.executeJavaScript(`window.events.filter(item=>item.type==='SUBMITTED').length`);
    const corrupted = await call({ type: 'SEND_PROMPT', runId: 'qa-corrupt', requestId: 'changed-word', text: 'Review every factual claim.\n\nExchange tracking ID: changed-word' });
    assert.equal(corrupted.ok, false, 'A real rich editor changing a meaningful word must block Send.');
    assert.match(corrupted.error, /did not receive the full prompt/);
    assert.equal(await win.webContents.executeJavaScript(`window.events.filter(item=>item.type==='SUBMITTED').length`), sendsBeforeCorruption);
    await win.webContents.executeJavaScript(`window.corruptEditorWord=false;document.querySelector('[contenteditable]').innerText='';document.getElementById('send').hidden=true`);
    await win.webContents.executeJavaScript(`window.fixtureMode='image'`);
    const mediaRequest = { type: 'SEND_PROMPT', runId: 'qa-media', requestId: 'generated', text: 'Create one image', relayMedia: true };
    assert.equal((await call(mediaRequest)).ok, true);
    const imageReply = await responseFor('generated');
    assert.equal(imageReply.type, 'REPLY', imageReply.error);
    assert.equal(imageReply.text, '');
    assert.equal(imageReply.media.length, 1);
    assert.doesNotMatch(JSON.stringify(imageReply), /base64|data:image|http:/);
    const exported = await call({ type: 'EXPORT_MEDIA', runId: mediaRequest.runId, requestId: mediaRequest.requestId, ids: imageReply.media.map((item) => item.id) });
    assert.equal(exported.ok, true, exported.error);
    const imageBytes = Buffer.from(exported.files[0].base64, 'base64');
    assert.equal(imageBytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'Canvas export was not a real PNG.');
    assert.equal(imageBytes.readUInt32BE(16), 128);
    assert.equal(imageBytes.readUInt32BE(20), 64);
    await win.webContents.executeJavaScript(`window.fixtureMode='text'`);
    const relayed = await call({ type: 'SEND_PROMPT', runId: 'qa-next', requestId: 'review-media', text: 'Review the generated image', files: exported.files });
    assert.equal(relayed.ok, true, relayed.error);
    const sentWithFiles = await win.webContents.executeJavaScript(`window.events.find(item=>item.type==='SUBMITTED'&&item.text.replace(/\\s+/g,' ').trim()==='Review the generated image')`);
    assert.equal(sentWithFiles.uploadBusy, null, 'The prompt sent before the upload progress indicator cleared.');
    assert.deepEqual(sentWithFiles.files.map(({ name, type, size }) => ({ name, type, size })), [{ name: exported.files[0].name, type: 'image/png', size: imageBytes.length }]);
    assert.equal((await responseFor('review-media')).type, 'REPLY');
    await win.webContents.executeJavaScript(`window.fixtureMode='cors-image'`);
    assert.equal((await call({ type: 'SEND_PROMPT', runId: 'qa-cors', requestId: 'cross-origin-image', text: 'Create cross origin image', relayMedia: true })).ok, true);
    const corsReply = await responseFor('cross-origin-image');
    assert.equal(corsReply.type, 'REPLY', corsReply.error);
    const corsExport = await call({ type: 'EXPORT_MEDIA', runId: 'qa-cors', requestId: 'cross-origin-image', ids: corsReply.media.map((item) => item.id) });
    assert.equal(corsExport.ok, false, 'A cross-origin image should not bypass browser canvas protections.');
    assert.match(corsExport.error, /export|tainted|origin|security/i);
    await win.webContents.executeJavaScript(`window.fixtureMode='file'`);
    assert.equal((await call({ type: 'SEND_PROMPT', runId: 'qa-file', requestId: 'generated-file', text: 'Create CSV', relayMedia: true })).ok, true);
    const fileReply = await responseFor('generated-file');
    assert.equal(fileReply.type, 'REPLY', fileReply.error);
    const fileExport = await call({ type: 'EXPORT_MEDIA', runId: 'qa-file', requestId: 'generated-file', ids: fileReply.media.map((item) => item.id) });
    assert.equal(fileExport.ok, true, fileExport.error);
    assert.equal(Buffer.from(fileExport.files[0].base64, 'base64').toString(), 'item,value\nfixture,42\n');
    await call({ type: 'CANCEL', runId: 'qa-late' });
    assert.equal((await call({ type: 'SEND_PROMPT', runId: 'qa-late', requestId: 'late', text: 'Do not send' })).ok, false);
    process.stdout.write('PASS: offline Chromium paragraph rich editor, unchanged words and tracking ID, changed-word Send rejection, Send, upload progress, completed reply, image-only media, real PNG export, upload-before-relay, browser CORS rejection, exact CSV download, and late Stop dispatch.\n');
  } finally {
    win.destroy();
    await Promise.all([new Promise((resolve) => server.close(resolve)), new Promise((resolve) => fixtureServer.close(resolve))]);
  }
}

app.whenReady().then(run).then(()=>app.quit(),error=>{process.stderr.write(`${error.stack||error}\n`);app.exit(1)});
