'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Exercise the real generated preload wrapper without writing the generated
// production file or opening a page. The bridge stub captures its environment.
const generatorPath = path.join(__dirname, '..', 'scripts', 'build-page-preload.js');
const generator = fs.readFileSync(generatorPath, 'utf8');
let generated;
vm.runInNewContext(generator, {
  __dirname: path.dirname(generatorPath),
  process: { stdout: { write() {} } },
  require(name) {
    if (name === 'node:path') return path;
    if (name === 'node:fs') return {
      readFileSync(filename, encoding) {
        if (filename === path.join(__dirname, '..', 'chrome-extension/content.js')) return 'module.exports = { createBridge(env) { globalThis.downloadVisible = env.downloadVisible; } };';
        return fs.readFileSync(filename, encoding);
      },
      writeFileSync(_filename, text) { generated = text; },
    };
    throw new Error(`Unexpected generator dependency: ${name}`);
  },
}, { filename: generatorPath });
assert.equal(typeof generated, 'string');

function harness() {
  const calls = [];
  let releaseAuthorization;
  const authorizing = new Promise((resolve) => { releaseAuthorization = resolve; });
  const ipcRenderer = {
    on() {}, send() {},
    async invoke(channel, payload) {
      calls.push({ channel, payload });
      if (channel === 'converge:download-begin') {
        await authorizing;
        return { ok: true, token: 'owned-download' };
      }
      if (channel === 'converge:download-cancel') return { ok: true };
      if (channel === 'converge:download-read') return { ok: true, mimeType: 'application/pdf', base64: 'JVBERg==' };
      throw new Error(`Unexpected download operation: ${channel}`);
    },
  };
  const context = {
    process: { argv: [], isMainFrame: true }, location: { origin: 'https://chatgpt.com' },
    document: { readyState: 'complete' }, window: {},
    require(name) { assert.equal(name, 'electron'); return { ipcRenderer }; },
  };
  vm.runInNewContext(generated, context, { filename: 'generated-page-preload-test.js' });
  let clicks = 0;
  const element = { isConnected: true, disabled: false, attributes: {},
    getAttribute(name) { return this.attributes[name] ?? null; }, click() { clicks += 1; } };
  const controller = new AbortController();
  const sourceState = { current: true, throws: false };
  const request = { element, runId: 'run', requestId: 'draft', id: 'media-1', name: 'reviewed.pdf', mimeType: 'application/pdf',
    signal: controller.signal, isCurrent: () => {
      if (sourceState.throws) throw new Error('Captured source was replaced');
      return sourceState.current;
    } };
  return { calls, element, controller, request, sourceState, releaseAuthorization, download: context.downloadVisible, clicks: () => clicks };
}

test('native download revalidates the exact source after authorization and clicks its current action once', async () => {
  const page = harness();
  let sourceChecks = 0;
  page.request.isCurrent = () => { sourceChecks += 1; return true; };
  const pending = page.download(page.request);
  assert.equal(page.clicks(), 0);
  assert.equal(sourceChecks, 0, 'The final source check belongs after the IPC authorization.');
  page.releaseAuthorization();
  const result = await pending;
  assert.equal(result.ok, true);
  assert.equal(result.sourceVerifiedAtClick, true);
  assert.equal(sourceChecks, 1);
  assert.equal(page.clicks(), 1);
  assert.deepEqual(page.calls.map((item) => item.channel), ['converge:download-begin', 'converge:download-read']);
  assert.deepEqual(JSON.parse(JSON.stringify(page.calls[0].payload)), { runId: 'run', requestId: 'draft', id: 'media-1', name: 'reviewed.pdf', mimeType: 'application/pdf' },
    'Functions and DOM controls must not be sent over IPC.');
});

test('changed, detached, disabled, or unverifiable actions cancel their owned broker job without clicking', async () => {
  for (const mutation of [
    (page) => { page.element.isConnected = false; },
    (page) => { page.element.disabled = true; },
    (page) => { page.element.attributes['aria-disabled'] = 'true'; },
    (page) => { page.sourceState.current = false; },
    (page) => { page.sourceState.throws = true; },
  ]) {
    const page = harness();
    const pending = page.download(page.request);
    // Change the captured DOM/source while begin waits on authorization.
    mutation(page);
    page.releaseAuthorization();
    const result = await pending;
    assert.equal(result.ok, false);
    assert.match(result.error, /changed before|replaced/);
    assert.notEqual(result.sourceVerifiedAtClick, true);
    assert.equal(page.clicks(), 0);
    assert.deepEqual(page.calls.map((item) => item.channel), ['converge:download-begin', 'converge:download-cancel', 'converge:download-read']);
  }
  const missing = harness();
  delete missing.request.isCurrent;
  const pending = missing.download(missing.request);
  missing.releaseAuthorization();
  assert.equal((await pending).ok, false);
  assert.equal(missing.clicks(), 0);
  assert.deepEqual(missing.calls.map((item) => item.channel), ['converge:download-begin', 'converge:download-cancel', 'converge:download-read']);
});

test('Stop while authorization waits cancels the owned job before the native click', async () => {
  const page = harness();
  const pending = page.download(page.request);
  page.controller.abort('Stopped by user');
  page.releaseAuthorization();
  await pending;
  assert.equal(page.clicks(), 0);
  assert.deepEqual(page.calls.map((item) => item.channel), ['converge:download-begin', 'converge:download-cancel', 'converge:download-read']);
});

test('a native action consumed after its verified click retains the capture acknowledgement without another click', async () => {
  const page = harness();
  const click = page.element.click;
  page.element.click = () => {
    click();
    page.element.isConnected = false;
    page.sourceState.current = false;
  };
  const pending = page.download(page.request);
  page.releaseAuthorization();
  const result = await pending;
  assert.equal(result.ok, true);
  assert.equal(result.sourceVerifiedAtClick, true);
  assert.equal(page.clicks(), 1);
  assert.deepEqual(page.calls.map((item) => item.channel), ['converge:download-begin', 'converge:download-read']);
});
