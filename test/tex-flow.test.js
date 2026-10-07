'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { EventEmitter } = require('node:events');
const { createHash } = require('node:crypto');
const { MIME, validateTextSource, validateExport } = require('../src/browser/files');
const { sourceTaskProfile, requestedArtifacts, peerUploadName } = require('../chrome-extension/background');
const { createDownloadBroker } = require('../src/browser/downloads');
const { createProjectStore } = require('../src/studio-services');
const name = 'CED_Lectures_1-10.tex';
const bytes = Buffer.from('\\documentclass{article}\n% বাংলা and Δ stay intact\n\\begin{document}\\[\\nabla\\cdot E=\\rho/\\epsilon_0\\]\\end{document}\n');
const sha = value => createHash('sha256').update(value).digest('hex');
class Item extends EventEmitter {
  constructor(fileName, type) { super(); this.fileName=fileName; this.type=type; }
  getFilename() { return this.fileName; }
  getMimeType() { return this.type; }
  getTotalBytes() { return 0; }
  getReceivedBytes() { return 0; }
  setSavePath(value) { this.saved=value; }
  cancel() { this.emit('done', {}, 'cancelled'); }
  async complete(data) { await fs.writeFile(this.saved,data); this.emit('done', {}, 'completed'); }
}

test('LaTeX source retains its canonical bytes but uploads as inert text without a software-task gate', () => {
  assert.equal(MIME.tex,'text/plain');
  const source={name,mimeType:MIME.tex,base64:bytes.toString('base64')};
  validateTextSource(name,MIME.tex,bytes);
  assert.equal(peerUploadName(name,MIME.tex),`${name}.txt`);
  const profile=sourceTaskProfile('Improve the lecture notes and produce a PDF.',[source]);
  assert.equal(profile.codeTask,false); assert.equal(profile.requireCodeFile,false);
  const intent=requestedArtifacts('Create notes.tex from the attached notes PDF.',[{name:'notes.pdf',mimeType:MIME.pdf}]);
  assert.equal(intent.files,true); assert.equal(intent.pdf,false);
  for(const bad of [Buffer.from([0xc3]),Buffer.from([0,1,2])]) assert.throws(()=>validateTextSource(name,MIME.tex,bad),/Unicode|binary/);
  assert.throws(()=>validateTextSource(name,MIME.png,bytes),/type does not match/);
});

test('native LaTeX download, export and saved-project reload preserve the exact reviewed source', async t => {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'converge-tex-flow-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const session=new EventEmitter();
  const broker=createDownloadBroker({browserSession:session,sideForContents:c=>c.side,authorize:()=>true,tempRoot:directory});
  t.after(()=>broker.dispose());
  const payload={runId:'ced',requestId:'worker-a',id:'editable-source',name,mimeType:MIME.tex};
  for(const nativeType of ['text/plain','text/x-tex','application/x-tex','application/octet-stream']) {
    const started=await broker.begin('left',payload); assert.equal(started.ok,true,started.error);
    const item=new Item(name,nativeType); session.emit('will-download',{},item,{side:'left'});
    assert.ok(item.saved); await item.complete(bytes);
    const response=await broker.read('left',started.token); assert.equal(response.ok,true,response.error);
    const descriptor={...payload,fingerprint:'exact-native-card',byteLength:bytes.length,contentSha256:sha(bytes)};
    const candidate={side:'left',runId:payload.runId,requestId:payload.requestId,files:[descriptor]};
    const exported=validateExport(candidate,{ok:true,files:[{...descriptor,...response}]})[0];
    assert.equal(exported.name,name); assert.deepEqual(exported.bytes,bytes);
    const store=createProjectStore({directory:path.join(directory,`project-${nativeType.replace(/\W/g,'')}`)});
    const saved=await store.save({name:'CED source',files:[exported]});
    const loaded=await store.load(saved.id);
    assert.equal(loaded.files[0].name,name);
    assert.equal(loaded.files[0].contentSha256,sha(bytes));
    assert.deepEqual(Buffer.from(loaded.files[0].base64,'base64'),bytes);
  }
  const forged={...payload,name:'notes.txt'};
  const started=await broker.begin('left',forged); const wrong=new Item('notes.txt','application/x-tex');
  session.emit('will-download',{},wrong,{side:'left'});
  assert.match((await broker.read('left',started.token)).error,/unexpected file type/);
});
