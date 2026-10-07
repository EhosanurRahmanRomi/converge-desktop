'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createZip, readZip, writeZipFile, readZipFile } = require('../src/studio-services/archive');

async function harness(t) {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'converge-archive-stream-test-'));
  t.after(async () => {
    assert.equal(path.dirname(folder), path.resolve(os.tmpdir()));
    assert.ok(path.basename(folder).startsWith('converge-archive-stream-test-'));
    await fs.rm(folder, { recursive: true, force: true });
  });
  return folder;
}
test('streamed disk archives match the existing portable ZIP format exactly', async t => {
  const folder = await harness(t), filePath = path.join(folder, 'source.bin'), destination = path.join(folder, 'project.zip');
  const bytes = Buffer.alloc(2 * 1024 * 1024 + 13, 67), metadata = Buffer.from('{"version":1}');
  await fs.writeFile(filePath, bytes);
  const written = await writeZipFile([{ name:'project.json', bytes:metadata }, { name:'blobs/source.blob', filePath,
    byteLength:bytes.length, contentSha256:createHash('sha256').update(bytes).digest('hex') }], destination);
  const expected = createZip([{name:'project.json',bytes:metadata},{name:'blobs/source.blob',bytes}]);
  assert.deepEqual(await fs.readFile(destination), expected); assert.equal(written.bytes, expected.length);
  const seen = [];
  await readZipFile(destination, { async onEntry(entry) {
    const hash = createHash('sha256'); let count=0;
    for await (const chunk of entry.stream) { assert.ok(chunk.length <= 786432); hash.update(chunk); count+=chunk.length; }
    seen.push({name:entry.name,count,sha:hash.digest('hex')});
  } });
  assert.deepEqual(seen.map(item=>item.name),['project.json','blobs/source.blob']);
  assert.equal(seen[1].sha,createHash('sha256').update(bytes).digest('hex'));
});
test('streamed archive imports reject incomplete consumption and changed member bytes', async t => {
  const folder=await harness(t), destination=path.join(folder,'project.zip');
  await fs.writeFile(destination,createZip([{name:'data.blob',bytes:Buffer.alloc(1048576,65)}]));
  await assert.rejects(readZipFile(destination,{async onEntry(entry){for await(const chunk of entry.stream){break;}}}),/complete member/);
  const handle=await fs.open(destination,'r+'); await handle.write(Buffer.from([66]),0,1,39); await handle.close();
  await assert.rejects(readZipFile(destination,{async onEntry(entry){for await(const chunk of entry.stream){}}}),/integrity check/);
});
test('streamed archive cancellation leaves an existing destination intact and removes owned temporary files', async t => {
  const folder=await harness(t), destination=path.join(folder,'project.zip'); await fs.writeFile(destination,'previous');
  const controller=new AbortController();controller.abort(new Error('Stopped archive'));
  await assert.rejects(writeZipFile([{name:'project.json',bytes:Buffer.from('{}')}],destination,{signal:controller.signal}),/Stopped archive/);
  assert.equal(await fs.readFile(destination,'utf8'),'previous'); assert.deepEqual(await fs.readdir(folder),['project.zip']);
});
test('disk export rejects SHA substitution before replacing any destination', async t => {
  const folder=await harness(t), filePath=path.join(folder,'data'),destination=path.join(folder,'project.zip');
  await fs.writeFile(filePath,'wrong'); await fs.writeFile(destination,'previous');
  await assert.rejects(writeZipFile([{name:'data.blob',filePath,byteLength:5,contentSha256:'0'.repeat(64)}],destination),/SHA-256/);
  assert.equal(await fs.readFile(destination,'utf8'),'previous');
});
test('disk import validates unsafe and mismatching headers before exposing any entry', async t => {
  const folder=await harness(t),destination=path.join(folder,'project.zip');
  const invalid=createZip([{name:'safe.blob',bytes:Buffer.from('safe')}]);invalid.writeUInt16LE(8,8); await fs.writeFile(destination,invalid);
  let calls=0;await assert.rejects(readZipFile(destination,{async onEntry(entry){calls++;for await(const chunk of entry.stream){}}}),/Invalid project archive/);
  assert.equal(calls,0);assert.throws(()=>readZip(invalid),/Invalid project archive/);
});
