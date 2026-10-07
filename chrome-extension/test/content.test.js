const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createBridge } = require('../content');

class FakeElement {
  constructor(tagName, text = '', attributes = {}) {
    this.tagName = tagName;
    this.innerText = text;
    this.textContent = text;
    this.attributes = attributes;
    this.isConnected = true;
    this.disabled = false;
    this.hidden = false;
  }
  getAttribute(name) { return this.attributes[name] ?? null; }
  getClientRects() { return [1]; }
  closest(selector) {
    if (selector === 'form') return this.form || null;
    if (selector.includes('header') || selector.includes('[role="banner"]')) return this.region === 'header' ? this : null;
    if (selector.includes('main') || selector.includes('[role="main"]')) return this.region === 'main' ? this : null;
    if (selector.includes('[role="dialog"]') || selector.includes('[role="menu"]') || selector.includes('[role="listbox"]')) {
      return this.region === 'dialog' ? this : null;
    }
    if (selector.includes('data-message-author-role')) return this.attributes['data-message-author-role'] ? this : null;
    return null;
  }
  querySelectorAll() { return []; }
  matches(selector) {
    if (selector.includes('data-message-author-role="assistant"')) return this.attributes['data-message-author-role'] === 'assistant';
    if (selector.includes('stop-button')) return this.attributes['data-testid'] === 'stop-button';
    return false;
  }
  focus() {}
  dispatchEvent() { return true; }
  click() { this.onclick?.(); }
}

class FakeTextArea extends FakeElement {
  constructor() {
    super('TEXTAREA');
    this._value = '';
  }
  get value() { return this._value; }
  set value(value) { this._value = value; }
}

class FakeRichEditor extends FakeElement {
  constructor() {
    super('DIV', '', { contenteditable: 'true', role: 'textbox' });
    this.isContentEditable = true;
  }
  get value() { return this.innerText; }
  set value(value) { this.innerText = value; this.textContent = value; }
}

function paragraphLinkDOM(text) {
  const textNode = (value) => ({ nodeType: 3, nodeValue: value, textContent: value });
  const element = (tag, children, attributes = {}) => {
    const node = new FakeElement(tag, children.map(child => child.textContent).join(''), attributes);
    node.nodeType = 1;
    node.childNodes = children;
    node.children = children.filter(child => child.nodeType === 1);
    children.forEach(child => { child.parentElement = node; });
    return node;
  };
  const inline = (line) => {
    const nodes = []; let offset = 0;
    for (const match of line.matchAll(/https:\/\/[^\s)]+/g)) {
      nodes.push(textNode(line.slice(offset, match.index)));
      nodes.push(element('A', [element('SPAN', [textNode(match[0])])], { href: match[0] }));
      offset = match.index + match[0].length;
    }
    nodes.push(textNode(line.slice(offset)));
    return nodes;
  };
  const paragraphs = text.split('\n\n').map(block => element('P', block.split('\n').flatMap((line, index) =>
    index ? [element('BR', []), ...inline(line)] : inline(line))));
  return {
    childNodes: paragraphs,
    children: paragraphs,
    // This captures the live ProseMirror mismatch: rendered link whitespace
    // changes punctuation adjacency, while raw textContent fuses paragraphs.
    innerText: text.replace(/\(https:\/\//g, '( https://'),
    textContent: paragraphs.map(paragraph => paragraph.textContent).join('')
  };
}

function applyParagraphLinkDOM(target, text) {
  const rendered = paragraphLinkDOM(text);
  Object.assign(target, rendered);
  rendered.childNodes.forEach(child => { child.parentElement = target; });
}

function fixture({ privacy = 'selected', onSend, setup, composerMode = 'default', renderEditor, sendAppearsAfterText = false, options = {}, downloadVisible } = {}) {
  const messages = [];
  const listeners = [];
  const windowListeners = new Map();
  const composer = composerMode === 'rich-editor' ? new FakeRichEditor() : new FakeTextArea();
  const send = new FakeElement('BUTTON', '', { 'data-testid': 'send-button' });
  const stop = new FakeElement('BUTTON', '', { 'data-testid': 'stop-button' });
  const state = { users: [], assistants: [], turns: [], headings: [], composerAvailable: true, generating: false, stopClicks: 0, previews: [], fileInput: null, uploadBusy: false };
  const form = { innerText: '', querySelectorAll(selector) {
    if (selector.includes('send-button')) return sendAppearsAfterText && !composer.value ? [] : [send];
    if (selector.includes('input[type="file"]')) return state.fileInput ? [state.fileInput] : [];
    if (selector.includes('img, [role="img"]')) return state.previews;
    if (selector.includes('[aria-busy="true"]')) return state.uploadBusy ? [new FakeElement('DIV', '', { 'data-upload-state': 'uploading' })] : [];
    return [];
  } };
  composer.form = form;
  const controls = [];
  if (privacy === 'selected') {
    controls.push(new FakeElement('BUTTON', 'Temporary', { 'aria-pressed': 'true' }));
    controls.push(new FakeElement('BUTTON', 'Unpersonalized', { 'aria-checked': 'true' }));
  } else if (privacy === 'personalized') {
    controls.push(new FakeElement('BUTTON', 'Temporary', { 'aria-pressed': 'true' }));
    controls.push(new FakeElement('BUTTON', 'Personalized', { 'aria-checked': 'true' }));
  }
  stop.onclick = () => { state.stopClicks += 1; state.generating = false; };
  send.onclick = () => {
    const text = composer.value;
    composer.value = '';
    if (onSend) onSend({ text, state, addUser, addAssistant });
  };
  function addUser(text) {
    const element = new FakeElement('DIV', text, { 'data-message-author-role': 'user' });
    state.users.push(element);
    state.turns.push(element);
    return element;
  }
  function addAssistant(text) {
    const element = new FakeElement('DIV', text, { 'data-message-author-role': 'assistant' });
    state.assistants.push(element);
    state.turns.push(element);
    return element;
  }
  if (setup) setup({ controls, state, addUser, addAssistant, form, composer });
  const document = {
    body: {},
    createRange() { return { selectNodeContents() {} }; },
    execCommand(command, _unused, text) {
      assert.equal(command, 'insertText');
      const rendered = renderEditor ? renderEditor(text) : { innerText: text, textContent: text };
      composer.innerText = rendered.innerText;
      composer.textContent = rendered.textContent;
      if (rendered.childNodes) {
        composer.childNodes = rendered.childNodes;
        composer.children = rendered.children;
      }
      return true;
    },
    createElement(type) {
      assert.equal(type, 'canvas');
      return { getContext: () => ({ drawImage() {} }), toDataURL: () => 'data:image/png;base64,aW1hZ2U=' };
    },
    querySelectorAll(selector) {
      if (selector.includes('#prompt-textarea')) {
        return !state.composerAvailable || composerMode === 'generic' || (composerMode === 'ask-anything' && !selector.includes('Ask anything')) || (composerMode === 'ask-chatgpt' && !selector.includes('Ask ChatGPT')) ? [] : [composer];
      }
      if (selector === 'textarea, [contenteditable="true"]') return state.composerAvailable && composerMode === 'generic' ? [composer] : [];
      if (selector.includes('send-button')) return sendAppearsAfterText && !composer.value ? [] : [send];
      if (selector.includes('stop-button')) return state.generating ? [stop] : [];
      if (selector.includes('data-is-streaming')) return [];
      if (selector.includes('data-message-author-role="user"') && selector.includes('data-message-author-role="assistant"')) return state.turns;
      if (selector.includes('data-message-author-role="assistant"')) return state.assistants;
      if (selector.includes('data-message-author-role="user"')) return state.users;
      if (selector.includes('header h1')) return state.headings.filter((element) => element.region === 'header');
      if (selector.includes('main h1')) return state.headings.filter((element) => element.region === 'main');
      if (selector.includes('[role="radio"]')) return controls;
      if (selector === 'button, a') return controls;
      return [];
    }
  };
  const window = {
    location: { href: 'https://chatgpt.com/' },
    HTMLTextAreaElement: FakeTextArea,
    DataTransfer: class { constructor() { this.files = []; this.items = { add: (file) => this.files.push(file) }; } },
    Blob,
    File: class { constructor(parts, name, options) { this.parts = parts; this.name = name; this.type = options.type;
      this.blob = new Blob(parts); this.size = this.blob.size; } slice(...args) { return this.blob.slice(...args); } },
    Event: class { constructor(type, options) { this.type = type; this.options = options; } },
    atob: (value) => Buffer.from(value, 'base64').toString('binary'),
    btoa: (value) => Buffer.from(value, 'binary').toString('base64'),
    InputEvent: class { constructor(type, args) { this.type = type; this.args = args; } },
    getSelection: () => ({ removeAllRanges() {}, addRange() {} }),
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    addEventListener(type, listener) { windowListeners.set(type, listener); },
    dispatchEvent(event) { windowListeners.get(event.type)?.(event); return true; }
  };
  const chrome = {
    runtime: {
      onMessage: { addListener(listener) { listeners.push(listener); } },
      async sendMessage(message) { messages.push(message); return { ok: true }; }
    }
  };
  const bridge = createBridge({ chrome, document, window, downloadVisible, options: { settleMs: 20, tickMs: 5, replyTimeoutMs: 1000, setupTimeoutMs: 50, attachmentSettleMs: 20, ...options } });
  return { bridge, state, composer, send, controls, messages, listeners, addUser, addAssistant, window, document };
}

function addMediaToTurn(turn, children) {
  turn.querySelectorAll = (selector) => children.filter((child) => selector === 'img' ? child.tagName === 'IMG' : selector === 'a' ? child.tagName === 'A' : false);
  turn.contains = (child) => children.includes(child);
}

function generatedImage(source = 'https://chatgpt.com/rendered-output.png') {
  const image = new FakeElement('IMG');
  Object.assign(image, { src: source, currentSrc: source, complete: true, naturalWidth: 512, naturalHeight: 256 });
  image.getBoundingClientRect = () => ({ width: 256, height: 128 });
  return image;
}

function downloadableFile(name = 'report.csv', href = 'https://chatgpt.com/visible/report.csv') {
  const link = new FakeElement('A', name, { download: name, href });
  link.href = href;
  return link;
}

async function waitFor(check, timeout = 1000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const value = check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('Timed out in test.');
}

function failedImageTurn(users) {
  const retry = new FakeElement('BUTTON', 'Try again');
  const failure = new FakeElement('DIV', 'Image generation failed\nTry again');
  retry.parentElement = failure;
  const scope = new FakeElement('DIV');
  scope.querySelectorAll = (selector) => selector === 'button' ? [retry]
    : selector.includes('data-message-author-role="user"') ? users : [];
  for (const user of users) user.parentElement = scope;
  return retry;
}

function providerRejectedTurn(users, message, { role = '', parent = null } = {}) {
  const failure = new FakeElement('DIV', message, role ? { role } : {});
  const retry = new FakeElement('BUTTON', 'Try again');
  let retryClicks = 0;
  retry.onclick = () => { retryClicks += 1; };
  const scope = new FakeElement('DIV');
  scope.parentElement = parent;
  scope.querySelectorAll = (selector) => selector.includes('data-message-author-role="user"') ? users
    : selector.includes('[role="alert"]') ? [failure] : selector === 'button' ? [retry] : [];
  scope.contains = element => users.includes(element) || element === failure || element === retry;
  failure.parentElement = scope;retry.parentElement = scope;
  for (const user of users) { user.parentElement = scope;user.contains = element => element === user; }
  return { failure, scope, retryClicks: () => retryClicks };
}

test('a provider too-long rejection retains its owned request for a smaller boss continuation without Stop or retry', async () => {
  let widget, sendClicks = 0;
  const page = fixture({ onSend({ text, state, addUser }) {
    sendClicks += 1;
    widget = providerRejectedTurn([addUser(text)], 'The message you submitted was too long, please edit it and resubmit.');
    state.generating = true;
  } });
  const request = { runId: 'provider-too-long', requestId: 'too-long-submitted', text: 'Review this full candidate.' };
  assert.equal((await page.bridge.sendPrompt(request)).ok, true);
  await waitFor(() => page.bridge.inspect().interrupted, 700);
  const status = page.bridge.inspect();
  assert.match(status.reason, /too long.*smaller focused continuation/i);
  assert.equal(status.interruptionKind, 'too-long');
  assert.equal(status.activeRequestId, request.requestId);
  assert.equal(sendClicks, 1);assert.equal(widget.retryClicks(), 0);
  assert.equal(page.messages.some(message => message.type === 'REPLY'), false);
  assert.equal(page.state.users.length, 1, 'The submitted chat turn must be retained.');
  assert.equal(page.bridge.inspect().busy, true);
  assert.equal(page.state.stopClicks, 0);
  page.state.generating = false;
  assert.equal(page.bridge.inspect().interrupted, true);
  page.bridge.cancel({ ...request, cancelRun: false, stopGeneration: false });
  assert.equal((await page.bridge.sendPrompt(request)).ok, false, 'The same rejected request must not be submitted again.');
  assert.equal(sendClicks, 1);
});

test('a fresh provider response-generation alert keeps the owned request for supervision without Stop or retry', async () => {
  let widget, sendClicks = 0;
  const page = fixture({ onSend({ text, state, addUser }) {
    sendClicks += 1;
    const user = addUser(text);
    widget = providerRejectedTurn([user], 'There was an error generating a response. Please try again.', { role: 'alert' });
    user.compareDocumentPosition = element => element === widget.failure ? 4 : 0;
    const userClosest = user.closest.bind(user);
    user.closest = selector => selector.includes('article[data-testid') ? widget.scope : userClosest(selector);
    widget.failure.closest = selector => selector.includes('article[data-testid') ? widget.scope : selector.includes('[role="alert"]') ? widget.failure : null;
    state.generating = true;
  } });
  const request = { runId: 'provider-response-error', requestId: 'generation-alert', text: 'Review the candidate.' };
  assert.equal((await page.bridge.sendPrompt(request)).ok, true);
  await waitFor(() => page.bridge.inspect().interrupted, 700);
  const waiting = page.bridge.inspect();
  assert.equal(waiting.interruptionKind, 'generation-error');
  assert.equal(waiting.awaitingProviderIdle, true);
  assert.match(waiting.reason, /error generating.*partial response is not a completed result/i);
  assert.equal(page.state.stopClicks, 0);
  assert.equal(sendClicks, 1);
  assert.equal(widget.retryClicks(), 0);
  assert.equal(page.state.users.length, 1);
  assert.equal(page.messages.some(message => ['REPLY', 'ERROR'].includes(message.type)), false);
  page.state.generating = false;
  assert.equal(page.bridge.inspect().interrupted, true);
  assert.equal(page.bridge.inspect().awaitingProviderIdle, false);
  page.bridge.cancel({ ...request, cancelRun: false, stopGeneration: false });
  assert.equal(page.state.stopClicks, 0);
});

test('an older rejected message in shared history cannot fail the newest request', async () => {
  let old;
  const page = fixture({ setup({ addUser }) { old = addUser('The older rejected task'); },
    onSend({ text, addUser, addAssistant }) {
      providerRejectedTurn([old, addUser(text)], 'The message you submitted was too long, please edit it and resubmit.');
      addAssistant('A valid new answer');
    } });
  assert.equal((await page.bridge.sendPrompt({ runId: 'after-old-rejection', requestId: 'fresh-response', text: 'A new task.' })).ok, true);
  const reply = await waitFor(() => page.messages.find(message => message.type === 'REPLY'));
  assert.equal(reply.text, 'A valid new answer');
  assert.equal(page.messages.some(message => message.type === 'ERROR'), false);
});

test('the rejection wording quoted in the submitted prompt or an assistant answer stays ordinary task data', async () => {
  const wording = 'The message you submitted was too long, please edit it and resubmit.';
  const page = fixture({ onSend({ text, addUser, addAssistant }) {
    const user = addUser(text);
    const widget = providerRejectedTurn([user], wording);
    user.contains = element => element === user || element === widget.failure;
    const answer = addAssistant(wording);
    const quoted = new FakeElement('DIV', wording);
    quoted.closest = selector => selector.includes('data-message-author-role') ? answer : null;
    const baseQuery = widget.scope.querySelectorAll;
    widget.scope.querySelectorAll = selector => selector.includes('[role="alert"]') ? [widget.failure, quoted] : baseQuery(selector);
  } });
  assert.equal((await page.bridge.sendPrompt({ runId: 'quoted-rejection', requestId: 'explain-error', text: `Explain this provider message: ${wording}` })).ok, true);
  const reply = await waitFor(() => page.messages.find(message => message.type === 'REPLY'));
  assert.equal(reply.text, wording);
  assert.equal(page.messages.some(message => message.type === 'ERROR'), false);
});

test('Stop wins over a late provider rejection and cannot emit a second failure or retry', async () => {
  let widget;
  const page = fixture({ onSend({ text, addUser }) {
    const user = addUser(text);
    setTimeout(() => { widget = providerRejectedTurn([user], 'The message you submitted was too long, please edit it and resubmit.'); }, 40);
  } });
  const request = { runId: 'stopped-rejection', requestId: 'late-rejection', text: 'Review the candidate.' };
  assert.equal((await page.bridge.sendPrompt(request)).ok, true);
  page.bridge.cancel({ runId: request.runId });
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(widget.retryClicks(), 0);
  assert.equal(page.messages.some(message => ['REPLY', 'ERROR'].includes(message.type)), false);
});

test('the live too-long rejection in a fresh page-level alert is supervised even outside turn wrappers', async () => {
  let alertLeaf = null;
  const page = fixture({ onSend({ text, state, addUser }) {
    addUser(text);state.generating = true;
    alertLeaf = new FakeElement('DIV', 'The message you submitted was too long, please edit it and resubmit.');
    alertLeaf.closest = selector => selector.includes('[role="alert"]') ? new FakeElement('DIV', '', { role: 'alert' }) : null;
  } });
  const query = page.document.querySelectorAll.bind(page.document);
  page.document.querySelectorAll = selector => selector.startsWith('[role="alert"]') ? alertLeaf ? [alertLeaf] : [] : query(selector);
  assert.equal((await page.bridge.sendPrompt({ runId: 'outside-turn-alert', requestId: 'owned-alert', text: 'A candidate review.' })).ok, true);
  await waitFor(() => page.bridge.inspect().interrupted, 700);
  assert.match(page.bridge.inspect().reason, /too long.*smaller focused continuation/i);
  assert.equal(page.state.users.length, 1);
  assert.equal(page.state.stopClicks, 0);
  page.bridge.cancel({ runId: 'outside-turn-alert', requestId: 'owned-alert', cancelRun: false, stopGeneration: false });
});

test('a preexisting page-level rejection alert cannot fail a newly submitted request', async () => {
  const alertLeaf = new FakeElement('DIV', 'The message you submitted was too long, please edit it and resubmit.');
  alertLeaf.closest = selector => selector.includes('[role="alert"]') ? new FakeElement('DIV', '', { role: 'alert' }) : null;
  const page = fixture({ onSend({ text, addUser, addAssistant }) { addUser(text);addAssistant('Fresh successful answer'); } });
  const query = page.document.querySelectorAll.bind(page.document);
  page.document.querySelectorAll = selector => selector.startsWith('[role="alert"]') ? [alertLeaf] : query(selector);
  assert.equal((await page.bridge.sendPrompt({ runId: 'old-global-alert', requestId: 'new-success', text: 'A new request.' })).ok, true);
  const reply = await waitFor(() => page.messages.find(message => message.type === 'REPLY'));
  assert.equal(reply.text, 'Fresh successful answer');
  assert.equal(page.messages.some(message => message.type === 'ERROR'), false);
});

test('a failed image tool without an assistant turn stops the owned request clearly', async () => {
  let retryClicks = 0;
  const page = fixture({ onSend({ text, addUser }) {
    const retry = failedImageTurn([addUser(text)]);
    retry.onclick = () => { retryClicks += 1; };
  } });
  const request = { runId: 'image-tool-failure', requestId: 'failed-image', text: 'Create an image', relayMedia: true };
  assert.equal((await page.bridge.sendPrompt(request)).ok, true);
  const error = await waitFor(() => page.messages.find((message) => message.type === 'ERROR'));
  assert.match(error.error, /Image generation failed.*No image was produced or relayed/);
  assert.equal(error.requestId, request.requestId);
  assert.equal(page.messages.some((message) => message.type === 'REPLY'), false);
  assert.equal(retryClicks, 0, 'The bridge must not silently regenerate or resubmit a completed failed request.');
  assert.equal(page.bridge.inspect().busy, false);
});

test('an old failed image in a shared history container cannot fail a new request', async () => {
  let old;
  const page = fixture({ setup({ addUser }) { old = addUser('An earlier image request'); },
    onSend({ text, addUser, addAssistant }) {
      failedImageTurn([old, addUser(text)]);
      setTimeout(() => addAssistant('A new answer'), 80);
    } });
  assert.equal((await page.bridge.sendPrompt({ runId: 'after-image-failure', requestId: 'new-request', text: 'A new question' })).ok, true);
  const reply = await waitFor(() => page.messages.find((message) => message.type === 'REPLY'));
  assert.equal(reply.text, 'A new answer');
  assert.equal(page.messages.some((message) => message.type === 'ERROR'), false);
});

test('Stop prevents a late failed image widget from reporting another error', async () => {
  const page = fixture({ onSend({ text, addUser }) {
    const user = addUser(text);
    setTimeout(() => failedImageTurn([user]), 40);
  } });
  const request = { runId: 'cancel-image-failure', requestId: 'late-widget', text: 'Create an image' };
  assert.equal((await page.bridge.sendPrompt(request)).ok, true);
  page.bridge.cancel({ runId: request.runId });
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(page.messages.some((message) => ['ERROR', 'REPLY'].includes(message.type)), false);
});

function prepareStatus(page, payload = {}) {
  return new Promise((resolve) => {
    assert.equal(page.bridge.onMessage({ type: 'PREPARE', ...payload }, null, resolve), true);
  });
}

test('privacy is unknown without selected UI; personalized is explicitly off', () => {
  const unknown = fixture({ privacy: 'unknown' }).bridge.inspect();
  assert.equal(unknown.ready, true);
  assert.equal(unknown.temporary, null);
  assert.equal(unknown.unpersonalized, null);
  const personalized = fixture({ privacy: 'personalized' }).bridge.inspect();
  assert.equal(personalized.ready, false);
  assert.equal(personalized.temporary, true);
  assert.equal(personalized.unpersonalized, false);
});

test('explicit Normal mode leaves personalization and Temporary choices untouched', async () => {
  let clicks = 0;
  const page = fixture({ privacy: 'personalized', setup({ controls }) {
    for (const control of controls) control.onclick = () => { clicks += 1; };
  } });
  const status = await prepareStatus(page, { chatMode: 'normal', requireUnpersonalized: false });
  assert.equal(status.ready, true);
  assert.equal(status.chatMode, 'normal');
  assert.equal(status.unpersonalized, false);
  assert.equal(clicks, 0);
});

test('explicit Temporary mode accepts personalized chats without changing personalization', async () => {
  let clicks = 0;
  const page = fixture({ privacy: 'personalized', setup({ controls }) {
    const option = new FakeElement('BUTTON', 'Unpersonalized', { 'aria-checked': 'false' }); option.region = 'dialog';
    option.onclick = () => { clicks += 1; };
    controls.push(option);
  } });
  const status = await prepareStatus(page, { chatMode: 'temporary', requireUnpersonalized: false });
  assert.equal(status.ready, true);
  assert.equal(status.temporary, true);
  assert.equal(status.unpersonalized, false);
  assert.equal(clicks, 0);
});

test('Work mode selects one visible option and waits for selected-state evidence', async () => {
  let clicks = 0;
  const page = fixture({ privacy: 'unknown', setup({ controls }) {
    const work = new FakeElement('BUTTON', 'Work', { 'aria-pressed': 'false' }); work.region = 'header';
    work.onclick = () => { clicks += 1; setTimeout(() => { work.attributes['aria-pressed'] = 'true'; }, 10); };
    controls.push(work);
  } });
  const status = await prepareStatus(page, { chatMode: 'work' });
  assert.equal(status.ready, true);
  assert.equal(status.work, true);
  assert.equal(clicks, 1);
  await prepareStatus(page, { chatMode: 'work' });
  assert.equal(clicks, 1);
});

test('explicit Composer mode Work requires upgrade blocks without clicking upgrade and leaves other modes ready', async () => {
  for (const labelled of [true, false]) {
    let upgradeClicks = 0;
    const work = new FakeElement('BUTTON', 'Work\nRequires upgrade', { 'aria-pressed': 'false', ...(labelled ? { 'aria-label': 'Work' } : {}) });
    work.textContent = 'WorkRequires upgrade'; work.region = 'header';
    work.onclick = () => { upgradeClicks += 1; };
    const chat = new FakeElement('BUTTON', 'Chat', { 'aria-pressed': 'true' }); chat.region = 'header';
    const group = new FakeElement('DIV', '', { role: 'group', 'aria-label': 'Composer mode' });
    group.querySelectorAll = () => [chat, work];
    const page = fixture({ setup({ controls }) { controls.push(chat, work); } });
    const query = page.document.querySelectorAll.bind(page.document);
    page.document.querySelectorAll = (selector) => selector.includes('[aria-label="Composer mode"') ? [group] : query(selector);
    const blocked = await prepareStatus(page, { chatMode: 'work' });
    assert.equal(blocked.ready, false);
    assert.match(blocked.reason, /This ChatGPT account shows Work requires upgrade/);
    assert.equal(upgradeClicks, 0);
    assert.equal((await prepareStatus(page, { chatMode: 'normal' })).ready, true);
    assert.equal((await prepareStatus(page, { chatMode: 'temporary', requireUnpersonalized: false })).ready, true);
    assert.equal(upgradeClicks, 0);
  }
});

test('current Work with ChatGPT composer verifies Work after its mode switch disappears and preserves selected conflicts', async () => {
  const page = fixture({ privacy: 'unknown', composerMode: 'rich-editor', onSend({ text, addUser, addAssistant }) { addUser(text); addAssistant('Verified response'); } });
  page.composer.attributes['aria-label'] = 'Work with ChatGPT';
  page.composer.attributes['data-composer-markdown'] = '';
  assert.equal((await prepareStatus(page, { chatMode: 'work' })).work, true);
  for (const requestId of ['work-first', 'work-followup']) {
    const sent = await page.bridge.sendPrompt({ runId: 'work-label-run', requestId, text: `Work review ${requestId}` });
    assert.equal(sent.ok, true, sent.error);
    await waitFor(() => page.messages.find((message) => message.type === 'REPLY' && message.requestId === requestId));
    assert.equal(page.bridge.inspect().work, true);
    assert.equal(page.bridge.inspect().ready, true);
  }
  const chat = new FakeElement('BUTTON', 'Chat', { 'aria-pressed': 'true' });
  const work = new FakeElement('BUTTON', 'Work', { 'aria-pressed': 'true' });
  page.controls.push(chat, work);
  assert.equal(page.bridge.inspect().work, null, 'Conflicting explicit mode selections must remain unknown');
  assert.equal(page.bridge.inspect().ready, false);
});

test('Work with ChatGPT in a user message cannot verify the current ordinary chat editor', async () => {
  const page = fixture({ privacy: 'unknown', setup({ addUser }) { addUser('Work with ChatGPT'); } });
  const status = await prepareStatus(page, { chatMode: 'work' });
  assert.equal(status.work, null);
  assert.equal(status.ready, false);
});

test('Work mode remains blocked if selection is absent, ambiguous, or ignored', async () => {
  for (const variant of ['absent', 'ambiguous', 'ignored']) {
    let clicks = 0;
    const page = fixture({ privacy: 'unknown', setup({ controls }) {
      const count = variant === 'absent' ? 0 : variant === 'ambiguous' ? 2 : 1;
      for (let index = 0; index < count; index += 1) {
        const work = new FakeElement('BUTTON', 'Work', { 'aria-pressed': 'false' }); work.region = 'header';
        work.onclick = () => { clicks += 1; }; controls.push(work);
      }
    } });
    const status = await prepareStatus(page, { chatMode: 'work' });
    assert.equal(status.ready, false, variant);
    assert.notEqual(status.work, true, variant);
    assert.match(status.reason, /Work mode is not verified/);
    assert.equal(clicks, variant === 'ignored' ? 1 : 0);
  }
});

test('Normal and Temporary leave selected Work before preparing; inability to leave stays blocked', async () => {
  for (const chatMode of ['normal', 'temporary']) for (const canLeave of [true, false]) {
    let clicks = 0;
    const page = fixture({ setup({ controls }) {
      const work = new FakeElement('BUTTON', 'Work', { 'aria-selected': 'true' }); work.region = 'header';
      const chat = new FakeElement('BUTTON', 'Chat', { 'aria-selected': 'false' }); chat.region = 'header';
      chat.onclick = () => { clicks += 1; if (canLeave) { work.attributes['aria-selected'] = 'false'; chat.attributes['aria-selected'] = 'true'; } };
      controls.push(work, chat);
    } });
    const status = await prepareStatus(page, { chatMode });
    assert.equal(clicks, 1);
    assert.equal(status.ready, canLeave);
    if (canLeave) assert.equal(status.work, false);
    else assert.match(status.reason, /still in Work mode/);
  }
});

test('a source PDF removed after upload stops before filling or sending; filename substrings do not count', async () => {
  for (const displayed of ['', 'other-source.pdf', 'source.pdf.exe']) {
    let sends = 0;
    const page = fixture({ setup({ form }) { form.innerText = displayed; }, onSend() { sends += 1; } });
    const result = await page.bridge.sendPrompt({ runId: `removed-${displayed || 'empty'}`, requestId: 'source', text: 'Correct this source.', expectedSourceNames: ['source.pdf'] });
    assert.equal(result.ok, false);
    assert.match(result.error, /source document is no longer attached/);
    assert.equal(page.composer.value, '');
    assert.equal(sends, 0);
  }
  const page = fixture({ setup({ form }) { form.innerText = 'Remove attachment source.pdf'; },
    onSend({ text, addUser, addAssistant }) { addUser(text); addAssistant('Read the source file.'); } });
  assert.equal((await page.bridge.sendPrompt({ runId: 'present-source', requestId: 'source', text: 'Correct this source.', expectedSourceNames: ['source.pdf'] })).ok, true);
  await waitFor(() => page.messages.find((message) => message.type === 'REPLY'));
});

test('source receipt names are distinct and capped at fifteen normal files plus three text context files', async () => {
  const names = [...Array.from({ length: 15 }, (_, index) => `source-${index + 1}.pdf`),
    'CONVERGE_RESULT_W1_REPLY.txt', 'CONVERGE_RESULT_W2_REPLY.txt', 'CONVERGE_CANDIDATE_C1_ANSWER.txt'];
  for (const expectedSourceNames of [names, [...names, 'source-19.pdf'], ['source-1.pdf', 'source-1.pdf']]) {
    let sends = 0;
    const page = fixture({ setup({ form }) { form.innerText = [...names, 'source-19.pdf'].join('\n'); },
      onSend({ text, addUser, addAssistant }) { sends += 1; addUser(text); addAssistant('Every source reviewed.'); } });
    const result = await page.bridge.sendPrompt({ runId: `source-limit-${expectedSourceNames.length}`, requestId: 'request',
      text: 'Inspect all attachments.', expectedSourceNames });
    assert.equal(result.ok, expectedSourceNames === names, result.error);
    assert.equal(sends, expectedSourceNames === names ? 1 : 0);
    if (expectedSourceNames !== names) { assert.match(result.error, /source document is no longer attached/); assert.equal(page.composer.value, ''); }
    else await waitFor(() => page.messages.find(message => message.type === 'REPLY'));
  }
});

test('an answer saying Work and conflicting selected controls cannot verify Work mode', async () => {
  const page = fixture({ privacy: 'unknown', setup({ controls }) {
    const quoted = new FakeElement('BUTTON', 'Work', { 'aria-selected': 'true', 'data-message-author-role': 'assistant' });
    controls.push(quoted);
  } });
  assert.equal((await prepareStatus(page, { chatMode: 'work' })).work, null);
  const work = new FakeElement('BUTTON', 'Work', { 'aria-selected': 'true' });
  const chat = new FakeElement('BUTTON', 'Chat', { 'aria-selected': 'true' });
  page.controls.push(work, chat);
  assert.equal((await prepareStatus(page, { chatMode: 'work' })).work, null);
});

test('Ask ChatGPT composer is recognized and missing hydration is unknown authentication', async () => {
  const page = fixture({ composerMode: 'ask-chatgpt' });
  assert.equal(page.bridge.inspect().ready, true);
  page.state.composerAvailable = false;
  assert.equal(page.bridge.inspect().authenticated, null);
  page.controls.push(new FakeElement('BUTTON', 'Log in'));
  assert.equal(page.bridge.inspect().authenticated, false);
});

test('nested editable wrappers select the unique inner composer while separate editors stay ambiguous', () => {
  const page = fixture({ composerMode: 'rich-editor' });
  const outer = new FakeRichEditor(); outer.contains = (node) => node === page.composer;
  const original = page.document.querySelectorAll.bind(page.document);
  page.document.querySelectorAll = (selector) => selector.includes('#prompt-textarea') ? [outer, page.composer] : original(selector);
  assert.equal(page.bridge.inspect().ready, true);
  const separate = new FakeRichEditor();
  page.document.querySelectorAll = (selector) => selector.includes('#prompt-textarea') ? [page.composer, separate] : original(selector);
  assert.equal(page.bridge.inspect().ready, false);
});

test('only relays a new completed assistant turn after the submitted user turn', async () => {
  const page = fixture({
    onSend({ text, state, addUser, addAssistant }) {
      assert.equal(text, 'Check this answer');
      setTimeout(() => {
        addUser(text);
        state.generating = true;
        const reply = addAssistant('partial');
        setTimeout(() => {
          reply.innerText = 'complete reply';
          reply.textContent = 'complete reply';
          state.generating = false;
        }, 30);
      }, 5);
    }
  });
  page.addUser('Older question');
  page.addAssistant('Older answer');
  const ack = await page.bridge.sendPrompt({ runId: 'run-1', requestId: 'req-1', text: 'Check this answer' });
  assert.equal(ack.ok, true);
  assert.equal(ack.observationUrl, 'https://chatgpt.com/');
  const reply = await waitFor(() => page.messages.find((message) => message.type === 'REPLY'));
  assert.deepEqual({ runId: reply.runId, requestId: reply.requestId, text: reply.text },
    { runId: 'run-1', requestId: 'req-1', text: 'complete reply' });
  assert.equal(page.messages.filter((message) => message.type === 'REPLY').length, 1);
});

test('Ask anything composer works when Send appears only after typing', async () => {
  const page = fixture({
    composerMode: 'ask-anything',
    sendAppearsAfterText: true,
    onSend({ text, addUser, addAssistant }) {
      setTimeout(() => { addUser(text); addAssistant('Fresh completed answer'); }, 1);
    }
  });
  assert.equal(page.bridge.inspect().ready, true);
  assert.equal((await page.bridge.sendPrompt({ runId: 'ask-run', requestId: 'ask-1', text: 'Hello' })).ok, true);
  const reply = await waitFor(() => page.messages.find((message) => message.type === 'REPLY'));
  assert.equal(reply.text, 'Fresh completed answer');
});

test('Send waits for the editor update and clicks the replacement React button once', async () => {
  const page = fixture();
  let staleClicks = 0; let currentClicks = 0; let replacementCommits = 0;
  const replacement = new FakeElement('BUTTON', '', { 'data-testid': 'send-button' });
  replacement.onclick = () => {
    currentClicks += 1;
    page.addUser(page.composer.value); page.composer.value = ''; page.addAssistant('Fresh completed answer');
  };
  page.send.onclick = () => { staleClicks += 1; };
  let currentButton = page.send;
  const query = page.composer.form.querySelectorAll.bind(page.composer.form);
  page.composer.form.querySelectorAll = (selector) => selector.includes('send-button') ? [currentButton] : query(selector);
  const dispatch = page.composer.dispatchEvent.bind(page.composer);
  page.composer.dispatchEvent = (event) => {
    if (event.type === 'input') queueMicrotask(() => {
      // Commit after the first synchronous Send-control check. A wall-clock
      // timer can run after an overdue polling interval on a loaded machine
      // and accidentally test a different event ordering from React's update.
      page.send.isConnected = false;
      currentButton = replacement;
      replacementCommits += 1;
    });
    return dispatch(event);
  };
  const response = await page.bridge.sendPrompt({ runId: 'react-render-run', requestId: 'replacement', text: 'Wait for the final editor state.' });
  assert.equal(response.ok, true, response.error);
  assert.equal(replacementCommits, 1, 'Typing asynchronously commits exactly one replacement Send control.');
  assert.equal(staleClicks, 0, 'The pre-render Send button must not be clicked.');
  assert.equal(currentClicks, 1, 'The current Send button is submitted exactly once.');
  await waitFor(() => page.messages.some((message) => message.type === 'REPLY'));
});

test('paragraph spacing and trimmed rich-editor indentation preserve the full prompt and tracking ID', async () => {
  const text = 'Review the factual claims.\n\nReturn these keys:\n  answer\n  uncertainties\n\nExchange tracking ID: paragraph-request';
  const page = fixture({
    composerMode: 'rich-editor',
    renderEditor: (value) => ({ innerText: value.replace(/\n+/g, '\n\n\n').replace(/\n +/g, '\n').replace(/ /g, '\u00a0'), textContent: '' }),
    onSend({ text: submitted, addUser, addAssistant }) {
      assert.equal(submitted.replace(/\s+/g, ' ').trim(), text.replace(/\s+/g, ' ').trim());
      addUser(submitted);
      addAssistant('Verified answer');
    }
  });
  assert.equal((await page.bridge.sendPrompt({ runId: 'paragraph-run', requestId: 'paragraph-request', text })).ok, true);
  assert.equal((await waitFor(() => page.messages.find((message) => message.type === 'REPLY'))).text, 'Verified answer');
});

test('textContent verifies exact rich-editor text when innerText adds a rendered break inside a token', async () => {
  const text = 'Independent reviewer.\n\nExchange tracking ID: fallback-request';
  const page = fixture({
    composerMode: 'rich-editor',
    renderEditor: (value) => ({ innerText: value.replace('reviewer', 'review\ner'), textContent: value }),
    onSend({ addUser, addAssistant }) { addUser(text); addAssistant('Verified answer'); }
  });
  assert.equal((await page.bridge.sendPrompt({ runId: 'fallback-run', requestId: 'fallback-request', text })).ok, true);
  await waitFor(() => page.messages.some((message) => message.type === 'REPLY'));
});

test('asynchronous inline URL widgets retain exact paragraph and punctuation text through one owned Send and reply', async () => {
  const text = 'Inspect the immutable input (https://www.mql5.com/en/docs/basis/variables/inputvariables).\n\n' +
    'Failed initialization (https://www.mql5.com/en/docs/event_handlers/oninit) blocks execution.\n' +
    'Keep JSON punctuation: {"text":"a  b\\nnext", "expression":"foo(bar)"}.\n\n' +
    'Exchange tracking ID (do not include in your response): link-widget-request';
  let hydrated = false; let sends = 0;
  const page = fixture({ composerMode: 'rich-editor', onSend({ addUser, addAssistant }) {
    sends += 1;
    assert.equal(hydrated, true, 'Submit only after the asynchronous editor render settles.');
    const submitted = addUser(text);
    applyParagraphLinkDOM(submitted, text);
    addAssistant('Verified the current source.');
  } });
  const insert = page.document.execCommand.bind(page.document);
  page.document.execCommand = (...args) => {
    const result = insert(...args);
    setTimeout(() => { applyParagraphLinkDOM(page.composer, text); hydrated = true; }, 15);
    return result;
  };
  const request = { runId: 'link-widget-run', requestId: 'link-widget-request', text };
  assert.equal((await page.bridge.sendPrompt(request)).ok, true);
  const reply = await waitFor(() => page.messages.find(message => message.type === 'REPLY'));
  assert.equal(reply.text, 'Verified the current source.');
  assert.equal(reply.runId, request.runId); assert.equal(reply.requestId, request.requestId);
  assert.equal(sends, 1); assert.equal(page.state.users.length, 1);
  assert.equal(page.state.users[0].innerText.includes('( https://'), true);
  assert.equal(page.state.users[0].textContent.includes(').Failed'), true);
  assert.equal((await page.bridge.sendPrompt(request)).ok, false, 'Never resubmit an already completed tracking ID.');
  assert.equal(sends, 1);
  assert.equal(page.messages.some(message => message.type === 'ERROR'), false);
});

test('paragraph DOM fallback never approves changed punctuation, dropped code, altered URL, or a different request marker', async () => {
  const text = 'Inspect (https://www.mql5.com/en/docs/event_handlers/oninit).\n\n' +
    'Keep the expression foo(bar) and reject invalid data.\n\nExchange tracking ID: strict-link-request';
  const changes = [
    value => value.replace('foo(bar)', 'foobar'),
    value => value.replace(' and reject invalid data', ''),
    value => value.replace('/oninit', '/on_deinit'),
    value => value.replace('strict-link-request', 'foreign-link-request')
  ];
  for (const change of changes) {
    let sends = 0;
    const page = fixture({ composerMode: 'rich-editor', renderEditor: value => paragraphLinkDOM(change(value)), onSend() { sends += 1; } });
    const response = await page.bridge.sendPrompt({ runId: 'strict-link-run', requestId: 'strict-link-request', text });
    assert.equal(response.ok, false);
    assert.match(response.error, /did not receive the full prompt/);
    assert.equal(sends, 0); assert.equal(page.state.users.length, 0);
  }
});

test('a foreign user turn during inline link hydration prevents Send and preserves that generation', async () => {
  const text = 'Inspect (https://www.mql5.com/en/docs/event_handlers/oninit).\n\nExchange tracking ID: owned-link-request';
  let sends = 0;
  const page = fixture({ composerMode: 'rich-editor', onSend() { sends += 1; } });
  const insert = page.document.execCommand.bind(page.document);
  page.document.execCommand = (...args) => {
    const result = insert(...args);
    setTimeout(() => {
      applyParagraphLinkDOM(page.composer, text);
      applyParagraphLinkDOM(page.addUser('Different human input.\n\nExchange tracking ID: foreign-request'), 'Different human input.\n\nExchange tracking ID: foreign-request');
      page.state.generating = true;
    }, 15);
    return result;
  };
  const response = await page.bridge.sendPrompt({ runId: 'owned-link-run', requestId: 'owned-link-request', text });
  assert.equal(response.ok, false);
  assert.match(response.error, /user message appeared before.*submitted/);
  assert.equal(sends, 0); assert.equal(page.state.users.length, 1);
  assert.equal(page.state.generating, true); assert.equal(page.state.stopClicks, 0);
  assert.equal(page.messages.some(message => message.type === 'REPLY'), false);
});

test('a changed word, omitted instruction, or changed tracking ID never reaches Send', async () => {
  const text = 'Review factual claims.\n\nPreserve every instruction.\n\nExchange tracking ID: exact-request';
  for (const change of [
    (value) => value.replace('factual', 'fictional'),
    (value) => value.replace('Preserve every instruction.', ''),
    (value) => value.replace('exact-request', 'other-request')
  ]) {
    let sends = 0;
    const page = fixture({
      composerMode: 'rich-editor',
      renderEditor: (value) => ({ innerText: change(value), textContent: change(value) }),
      onSend() { sends += 1; }
    });
    const ack = await page.bridge.sendPrompt({ runId: 'modified-run', requestId: 'exact-request', text });
    assert.equal(ack.ok, false);
    assert.match(ack.error, /did not receive the full prompt/);
    assert.equal(sends, 0);
    assert.equal(page.state.users.length, 0);
  }
});

test('one unlabeled composer inside a form is accepted as a safe fallback', () => {
  const page = fixture({ composerMode: 'generic', sendAppearsAfterText: true });
  assert.equal(page.bridge.inspect().ready, true);
});

test('page diagnostics omit chat text and attachment contents', () => {
  const page = fixture();
  page.addUser('PRIVATE USER CONTENT');
  page.addAssistant('PRIVATE ASSISTANT CONTENT');
  let response;
  page.bridge.onMessage({ type: 'DIAGNOSTICS' }, null, (value) => { response = value; });
  assert.equal(response.ok, true);
  assert.equal(response.diagnostics.visibleUserTurns, 1);
  assert.equal(response.diagnostics.visibleAssistantTurns, 1);
  assert.doesNotMatch(JSON.stringify(response), /PRIVATE/);
});

test('duplicate request is not submitted twice', async () => {
  let sendCount = 0;
  const page = fixture({ onSend({ text, addUser }) { sendCount += 1; setTimeout(() => addUser(text), 1); } });
  const request = { runId: 'run-2', requestId: 'req-2', text: 'Prompt' };
  assert.equal((await page.bridge.sendPrompt(request)).ok, true);
  assert.deepEqual(await page.bridge.sendPrompt(request), { ok: true, pending: true });
  assert.equal(sendCount, 1);
  page.bridge.cancel({ runId: 'run-2' });
  const duplicate = await page.bridge.sendPrompt(request);
  assert.equal(duplicate.ok, false);
  assert.equal(sendCount, 1);
});

test('cancel aborts observation and clicks the visible Stop button once', async () => {
  const page = fixture({ onSend({ text, state, addUser }) {
    setTimeout(() => { addUser(text); state.generating = true; }, 1);
  } });
  assert.equal((await page.bridge.sendPrompt({ runId: 'run-3', requestId: 'req-3', text: 'Long work' })).ok, true);
  const result = page.bridge.cancel({ runId: 'run-3' });
  assert.deepEqual(result, { ok: true, cancelled: true });
  assert.equal(page.state.stopClicks, 1);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(page.messages.filter((message) => message.type === 'REPLY' || message.type === 'ERROR').length, 0);
});

test('attachments fail clearly when the page does not expose one picker', async () => {
  const page = fixture();
  const result = await page.bridge.uploadFiles({ files: [{ name: 'a.txt', mimeType: 'text/plain', base64: 'YQ==' }] });
  assert.equal(result.ok, false);
  assert.match(result.error, /picker/i);
});

test('image upload is confirmed by a new thumbnail even when filename is hidden', async () => {
  const page = fixture({ setup({ state }) {
    const input = new FakeElement('INPUT');
    input.dispatchEvent = () => {
      setTimeout(() => state.previews.push(new FakeElement('IMG')), 5);
      return true;
    };
    state.fileInput = input;
  } });
  const result = await page.bridge.uploadFiles({
    files: [{ name: 'cat.png', mimeType: 'image/png', base64: 'YQ==' }]
  });
  assert.deepEqual(result, { ok: true, attached: 1 });
});

test('PREPARE selects explicitly off Temporary and the visible Unpersonalized choice once', async () => {
  let temporaryClicks = 0;
  let choiceClicks = 0;
  const page = fixture({ privacy: 'unknown', setup({ controls }) {
    const temporary = new FakeElement('BUTTON', 'Temporary', { 'aria-pressed': 'false' });
    temporary.region = 'header';
    temporary.onclick = () => {
      temporaryClicks += 1;
      temporary.attributes['aria-pressed'] = 'true';
      const option = new FakeElement('BUTTON', 'Unpersonalized', { 'aria-checked': 'false' });
      option.region = 'dialog';
      option.onclick = () => { choiceClicks += 1; option.attributes['aria-checked'] = 'true'; };
      controls.push(option);
    };
    controls.push(temporary);
  } });
  const first = await prepareStatus(page);
  assert.equal(first.temporary, true);
  assert.equal(first.unpersonalized, true);
  await waitFor(() => page.bridge.inspect().temporary === true && page.bridge.inspect().unpersonalized === true);
  assert.equal(temporaryClicks, 1);
  assert.equal(choiceClicks, 1);
  await prepareStatus(page);
  assert.equal(temporaryClicks, 1);
  assert.equal(choiceClicks, 1);
});

test('PREPARE enables the unique fresh Temporary chat header and recognizes the current main Unpersonalized choice', async () => {
  let clicks = 0;
  const page = fixture({ privacy: 'unknown', setup({ controls, state }) {
    const toggle = new FakeElement('BUTTON', 'Temporary chat'); toggle.region = 'header';
    toggle.onclick = () => {
      clicks += 1; toggle.innerText = toggle.textContent = 'Turn off temporary chat';
      const heading = new FakeElement('H1', 'Temporary chat'); heading.region = 'main'; state.headings.push(heading);
      const choice = new FakeElement('BUTTON', 'Unpersonalized'); choice.region = 'main'; controls.push(choice);
    };
    controls.push(toggle);
  } });
  assert.equal(page.bridge.inspect().temporary, false);
  const status = await prepareStatus(page);
  assert.equal(status.temporary, true);
  assert.equal(status.unpersonalized, true);
  assert.equal(status.ready, true);
  assert.equal(clicks, 1);
  await prepareStatus(page);
  assert.equal(clicks, 1, 'An active Turn off toggle must not be clicked again.');
});

test('active Temporary heading prevents clicking an unmarked header action', async () => {
  let clicks = 0;
  const page = fixture({ privacy: 'unknown', setup({ controls, state }) {
    const toggle = new FakeElement('BUTTON', 'Temporary chat'); toggle.region = 'header'; toggle.onclick = () => { clicks += 1; };
    const heading = new FakeElement('H1', 'Temporary chat'); heading.region = 'main'; state.headings.push(heading);
    const choice = new FakeElement('BUTTON', 'Unpersonalized'); choice.region = 'main'; controls.push(toggle, choice);
  } });
  const status = await prepareStatus(page);
  assert.equal(status.temporary, true);
  assert.equal(status.unpersonalized, true);
  assert.equal(clicks, 0);
});

test('Temporary conversation remains verified when its heading disappears and its public URL retains the explicit mode flag', async () => {
  const page = fixture({ privacy: 'unknown' });
  page.window.location.href = 'https://chatgpt.com/c/6abddb87-6c90-83ee-9b52-9c43376d509d?temporary-chat=true';
  const status = await new Promise(resolve => page.bridge.onMessage({ type: 'INSPECT', chatMode: 'temporary', requireUnpersonalized: false }, null, resolve));
  assert.equal(status.temporary, true);
  assert.equal(status.ready, true);
  assert.equal(status.reason, '');
  assert.equal(status.unpersonalized, null, 'The URL must not invent a personalization setting');
});

test('Temporary URL fallback rejects foreign, ambiguous, home, false and malformed routes and respects an observed off control', () => {
  const route = '/c/6abddb87-6c90-83ee-9b52-9c43376d509d';
  for (const href of [
    `https://example.com${route}?temporary-chat=true`,
    'https://chatgpt.com/?temporary-chat=true',
    `https://chatgpt.com${route}?temporary-chat=false`,
    `https://chatgpt.com${route}?temporary-chat=true&temporary-chat=false`,
    `https://chatgpt.com${route}?temporary-chat=true&temporary-chat=true`,
    'https://chatgpt.com/c/other?temporary-chat=true',
    `https://chatgpt.com${route}?note=temporary-chat=true`,
    'invalid URL',
  ]) {
    const page = fixture({ privacy: 'unknown' }); page.window.location.href = href;
    assert.equal(page.bridge.privacyState().temporary, null, href);
  }
  const off = fixture({ privacy: 'unknown', setup({ controls }) {
    controls.push(new FakeElement('BUTTON', 'Temporary', { 'aria-pressed': 'false' }));
  } });
  off.window.location.href = `https://chatgpt.com${route}?temporary-chat=true`;
  assert.equal(off.bridge.privacyState().temporary, false);
});

test('Temporary main h3 or role heading verifies the current Unpersonalized button', () => {
  for (const selector of ['main h3', 'main [role="heading"]']) {
    const page = fixture({ privacy: 'unknown', setup({ controls }) {
      const current = new FakeElement('BUTTON', 'Unpersonalized'); current.region = 'main'; controls.push(current);
    } });
    const heading = new FakeElement(selector.includes('h3') ? 'H3' : 'DIV', 'Temporary chat', { role: 'heading' }); heading.region = 'main';
    const query = page.document.querySelectorAll.bind(page.document);
    page.document.querySelectorAll = (value) => value.includes('main h1') ? value.includes(selector) ? [heading] : [] : query(value);
    const status = page.bridge.inspect();
    assert.equal(status.temporary, true);
    assert.equal(status.unpersonalized, true);
  }
});

test('main Personalized current choice opens its menu and selects Unpersonalized before the first message', async () => {
  let menuClicks = 0; let choiceClicks = 0;
  const page = fixture({ privacy: 'unknown', setup({ controls, state }) {
    const active = new FakeElement('BUTTON', 'Turn off temporary chat'); active.region = 'header';
    const heading = new FakeElement('H1', 'Temporary chat'); heading.region = 'main'; state.headings.push(heading);
    const current = new FakeElement('BUTTON', 'Personalized'); current.region = 'main';
    current.onclick = () => {
      menuClicks += 1;
      const option = new FakeElement('BUTTON', 'Unpersonalized', { 'role': 'menuitemradio', 'aria-checked': 'false' }); option.region = 'dialog';
      option.onclick = () => { choiceClicks += 1; current.innerText = current.textContent = 'Unpersonalized'; option.hidden = true; };
      controls.push(option);
    };
    controls.push(active, current);
  } });
  assert.equal(page.bridge.inspect().unpersonalized, false);
  const status = await prepareStatus(page);
  assert.equal(status.unpersonalized, true);
  assert.equal(menuClicks, 1); assert.equal(choiceClicks, 1);
});

test('multiple fresh Temporary controls or multiple main mode choices are not treated as a unique current mode', async () => {
  let clicks = 0;
  const ambiguous = fixture({ privacy: 'unknown', setup({ controls }) {
    for (let i = 0; i < 2; i += 1) {
      const button = new FakeElement('BUTTON', 'Temporary chat'); button.region = 'header'; button.onclick = () => { clicks += 1; }; controls.push(button);
    }
  } });
  assert.equal((await prepareStatus(ambiguous)).temporary, null);
  assert.equal(clicks, 0);
  const mode = fixture({ privacy: 'unknown', setup({ controls, state }) {
    const heading = new FakeElement('H1', 'Temporary chat'); heading.region = 'main'; state.headings.push(heading);
    for (const label of ['Personalized', 'Unpersonalized']) {
      const button = new FakeElement('BUTTON', label); button.region = 'main'; button.onclick = () => { clicks += 1; }; controls.push(button);
    }
  } });
  assert.equal((await prepareStatus(mode)).unpersonalized, null);
  assert.equal(clicks, 0);
});

test('PREPARE waits for a delayed React composer before changing privacy mode', async () => {
  let clicks = 0;
  const page = fixture({ privacy: 'unknown', setup({ controls, state }) {
    state.composerAvailable = false;
    setTimeout(() => { state.composerAvailable = true; }, 15);
    const toggle = new FakeElement('BUTTON', 'Temporary chat'); toggle.region = 'header';
    toggle.onclick = () => {
      clicks += 1; toggle.innerText = toggle.textContent = 'Turn off temporary chat';
      const heading = new FakeElement('H1', 'Temporary chat'); heading.region = 'main'; state.headings.push(heading);
      const choice = new FakeElement('BUTTON', 'Unpersonalized'); choice.region = 'main'; controls.push(choice);
    };
    controls.push(toggle);
  } });
  const status = await prepareStatus(page);
  assert.equal(status.temporary, true); assert.equal(status.unpersonalized, true); assert.equal(clicks, 1);
});

test('PREPARE waits for the current mode after the Temporary header changes first', async () => {
  let clicks = 0;
  const page = fixture({ privacy: 'unknown', setup({ controls, state }) {
    const toggle = new FakeElement('BUTTON', 'Temporary chat'); toggle.region = 'header';
    toggle.onclick = () => {
      clicks += 1; toggle.innerText = toggle.textContent = 'Turn off temporary chat';
      setTimeout(() => {
        const heading = new FakeElement('H3', 'Temporary chat'); heading.region = 'main'; state.headings.push(heading);
        const current = new FakeElement('BUTTON', 'Unpersonalized'); current.region = 'main'; controls.push(current);
      }, 20);
    };
    controls.push(toggle);
  } });
  const status = await prepareStatus(page);
  assert.equal(status.temporary, true);
  assert.equal(status.unpersonalized, true, 'One preparation must wait for the delayed current privacy choice.');
  assert.equal(status.ready, true);
  assert.equal(clicks, 1);
});

test('PREPARE waits for a header action that hydrates after the composer', async () => {
  let clicks = 0;
  const page = fixture({ privacy: 'unknown', setup({ controls, state }) {
    setTimeout(() => {
      const toggle = new FakeElement('BUTTON', 'Temporary chat'); toggle.region = 'header';
      toggle.onclick = () => {
        clicks += 1; toggle.innerText = toggle.textContent = 'Turn off temporary chat';
        const heading = new FakeElement('H3', 'Temporary chat'); heading.region = 'main'; state.headings.push(heading);
        const current = new FakeElement('BUTTON', 'Unpersonalized'); current.region = 'main'; controls.push(current);
      };
      controls.push(toggle);
    }, 20);
  } });
  assert.equal(page.bridge.inspect().ready, true);
  const status = await prepareStatus(page);
  assert.equal(status.temporary, true);
  assert.equal(status.unpersonalized, true);
  assert.equal(clicks, 1);
});

test('PREPARE leaves unknown or ambiguous Temporary controls untouched', async () => {
  let clicks = 0;
  const page = fixture({ privacy: 'unknown', setup({ controls }) {
    const unmarked = new FakeElement('BUTTON', 'Temporary');
    unmarked.region = 'header';
    unmarked.onclick = () => { clicks += 1; };
    controls.push(unmarked);
  } });
  await prepareStatus(page);
  assert.equal(clicks, 0);
  assert.equal(page.bridge.inspect().temporary, null);
  const ambiguous = fixture({ privacy: 'unknown', setup({ controls }) {
    for (let i = 0; i < 2; i += 1) {
      const button = new FakeElement('BUTTON', 'Temporary', { 'aria-pressed': 'false' });
      button.region = 'header';
      button.onclick = () => { clicks += 1; };
      controls.push(button);
    }
  } });
  await prepareStatus(ambiguous);
  assert.equal(clicks, 0);
});

test('PREPARE does not change personalization after the first message', async () => {
  let clicks = 0;
  const page = fixture({ privacy: 'personalized', setup({ controls, addUser }) {
    addUser('An existing prompt');
    const choice = new FakeElement('BUTTON', 'Unpersonalized', { 'aria-checked': 'false' });
    choice.region = 'dialog';
    choice.onclick = () => { clicks += 1; };
    controls.push(choice);
  } });
  await prepareStatus(page);
  assert.equal(clicks, 0);
  assert.equal(page.bridge.inspect().unpersonalized, false);
});

test('PREPARE leaves an unverified Unpersonalized selection blocked', async () => {
  let clicks = 0;
  const page = fixture({ privacy: 'unknown', setup({ controls }) {
    const temporary = new FakeElement('BUTTON', 'Temporary', { 'aria-pressed': 'true' });
    temporary.region = 'header';
    const option = new FakeElement('BUTTON', 'Unpersonalized', { 'aria-checked': 'false' });
    option.region = 'dialog';
    option.onclick = () => { clicks += 1; }; // The page ignores the click.
    controls.push(temporary, option);
  } });
  const status = await prepareStatus(page);
  assert.equal(clicks, 1);
  assert.equal(status.temporary, true);
  assert.equal(status.unpersonalized, false);
  assert.equal(status.ready, false);
  assert.match(status.reason, /personalized/i);
});

test('overlapping PREPARE calls share one action', async () => {
  let clicks = 0;
  const page = fixture({ privacy: 'unknown', setup({ controls }) {
    const temporary = new FakeElement('BUTTON', 'Temporary', { 'aria-pressed': 'false' });
    temporary.region = 'header';
    temporary.onclick = () => {
      clicks += 1;
      setTimeout(() => { temporary.attributes['aria-pressed'] = 'true'; }, 10);
    };
    controls.push(temporary);
  } });
  await Promise.all([prepareStatus(page), prepareStatus(page)]);
  assert.equal(clicks, 1);
});

test('CANCEL remembers a run before dispatch so a late prompt never sends', async () => {
  let sends = 0;
  const page = fixture({ onSend() { sends += 1; } });
  assert.deepEqual(page.bridge.cancel({ runId: 'stopped-before-send' }), { ok: true, cancelled: false });
  const result = await page.bridge.sendPrompt({ runId: 'stopped-before-send', requestId: 'late', text: 'Do not send' });
  assert.equal(result.ok, false);
  assert.match(result.error, /cancelled/i);
  assert.equal(sends, 0);
  assert.equal(page.composer.value, '');
});

test('a thumbnail is not ready while an upload progress indicator is visible', async () => {
  const page = fixture({ setup({ state }) {
    state.fileInput = new FakeElement('INPUT');
    state.fileInput.dispatchEvent = () => { state.previews.push(new FakeElement('IMG')); state.uploadBusy = true; return true; };
  } });
  let finished = false;
  const upload = page.bridge.uploadFiles({ files: [{ name: 'cat.png', mimeType: 'image/png', base64: 'YQ==' }] }).then((result) => { finished = true; return result; });
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(finished, false);
  page.state.uploadBusy = false;
  assert.deepEqual(await upload, { ok: true, attached: 1 });
});

for (const image of [false, true]) test(`a legacy ${image ? 'thumbnail' : 'plain filename'} with a generic Loading spinner cannot acknowledge or send early`, async () => {
  let stillUploading = true, sends = 0, finished = false;
  const page = fixture({ options: { uploadTimeoutMs: 300, attachmentSettleMs: 20, sendSettleMs: 5 },
    setup({ state, form, composer }) {
      const original = form.querySelectorAll.bind(form);
      const spinner = new FakeElement('SPAN', 'Loading', { 'aria-busy': 'true', role: 'progressbar', class: 'animate-spin' });
      const filename = new FakeElement('SPAN', 'source.txt');
      const thumbnail = new FakeElement('IMG');
      const preview = new FakeElement('DIV');
      spinner.parentElement = preview; preview.parentElement = form;
      preview.contains = node => node === spinner || node === filename || node === thumbnail;
      preview.querySelectorAll = selector => selector.includes('img, [role="img"]') ? image ? [thumbnail] : []
        : selector.includes('[title]') ? image ? [] : [filename] : [];
      form.contains = node => node === composer || node === preview || preview.contains(node);
      form.querySelectorAll = selector => selector.includes('[aria-busy="true"]')
        ? stillUploading && state.fileInput.files?.length ? [spinner] : [] : original(selector);
      state.fileInput = new FakeElement('INPUT');
      state.fileInput.dispatchEvent = () => {
        if (image) state.previews.push(thumbnail);
        else form.innerText = 'source.txt';
        return true;
      };
    }, onSend({ text, addUser, addAssistant }) {
      assert.equal(stillUploading, false, 'Send must wait for the actual upload indicator to finish.');
      sends += 1; addUser(text); addAssistant('Done.');
    } });
  const file = image ? { name: 'source.png', mimeType: 'image/png', base64: 'YQ==' }
    : { name: 'source.txt', mimeType: 'text/plain', base64: Buffer.from('source content').toString('base64') };
  const prompt = page.bridge.sendPrompt({ runId: 'legacy-upload', requestId: `legacy-${image}`, text: 'Review the file', files: [file] })
    .then(result => { finished = true; return result; });
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(page.bridge.inspect().ready, false);
  assert.match(page.bridge.inspect().reason, /uploading an attachment/);
  assert.equal(finished, false); assert.equal(sends, 0);
  stillUploading = false;
  assert.equal((await prompt).ok, true); assert.equal(sends, 1);
});

test('a filename already visible before selection cannot prove a new document upload', async () => {
  const page = fixture({ options: { uploadTimeoutMs: 60 }, setup({ state, form }) {
    form.innerText = 'old-report.txt';
    state.fileInput = new FakeElement('INPUT'); // The page ignores the selection; no new chip appears.
  } });
  const result = await page.bridge.uploadFiles({ files: [{ name: 'old-report.txt', mimeType: 'text/plain', base64: 'YQ==' }] });
  assert.equal(result.ok, false);
  assert.match(result.error, /new preview|name/);
});

const stageMessage = (page, message) => new Promise(resolve => page.bridge.onMessage(message, null, resolve));
test('staging expiry renews after each chunk and measures inactivity rather than whole-transfer age', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const page = fixture();
  assert.equal((await stageMessage(page, { type: 'FILE_STAGE_BEGIN', transferId: 'slow-source',
    files: [{ name: 'source.pdf', mimeType: 'application/pdf', base64Length: 12, byteLength: 9 }] })).ok, true);
  t.mock.timers.tick(14 * 60_000);
  assert.equal((await stageMessage(page, { type: 'FILE_STAGE_CHUNK', transferId: 'slow-source', fileIndex: 0, offset: 0, data: 'YWJj' })).ok, true);
  t.mock.timers.tick(14 * 60_000);
  assert.equal((await stageMessage(page, { type: 'FILE_STAGE_CHUNK', transferId: 'slow-source', fileIndex: 0, offset: 4, data: 'ZGVm' })).ok, true,
    'An active transfer remains owned after 28 minutes.');
  t.mock.timers.tick(15 * 60_000);
  const expired = await stageMessage(page, { type: 'FILE_STAGE_CHUNK', transferId: 'slow-source', fileIndex: 0, offset: 8, data: 'Z2hp' });
  assert.equal(expired.ok, false); assert.match(expired.error, /no longer available/);
  assert.equal((await stageMessage(page, { type: 'FILE_STAGE_BEGIN', transferId: 'new-source',
    files: [{ name: 'source.pdf', mimeType: 'application/pdf', base64Length: 4, byteLength: 1 }] })).ok, true);
  await stageMessage(page, { type: 'FILE_STAGE_ABORT', transferId: 'new-source' });
});

test('default provider upload wait allows 30 minutes and remains immediately cancellable', async t => {
  const delays = [];
  const realSetTimeout = global.setTimeout;
  t.mock.method(global, 'setTimeout', (callback, delay, ...args) => { delays.push(delay); return realSetTimeout(callback, delay, ...args); });
  const page = fixture({ setup({ state, form }) {
    state.uploadBusy = true;
    state.fileInput = new FakeElement('INPUT');
    state.fileInput.dispatchEvent = () => { form.innerText = 'source.pdf'; return true; };
  } });
  t.after(() => page.bridge.cancel({ runId: 'long-upload' }));
  const pending = page.bridge.uploadFiles({ runId: 'long-upload', files: [{ name: 'source.pdf', mimeType: 'application/pdf', base64: 'YQ==' }] });
  await waitFor(() => delays.includes(30 * 60_000));
  page.bridge.cancel({ runId: 'long-upload' });
  const result = await pending;
  assert.equal(result.ok, false); assert.match(result.error, /cancelled/i);
});

test('staged chunks become Blob-backed files without whole base64 reconstruction and still wait for provider completion', async () => {
  const bytes = Buffer.from('\ufeffalpha = "€"\n', 'utf16le');
  const page = fixture({ setup({ state, form }) {
    state.fileInput = new FakeElement('INPUT');
    state.fileInput.dispatchEvent = () => { form.innerText = 'original.py.txt'; state.uploadBusy = true; return true; };
  } });
  assert.equal((await stageMessage(page, { type: 'FILE_STAGE_BEGIN', transferId: 'streamed', runId: 'stream-run',
    files: [{ name: 'original.py.txt', mimeType: 'text/plain', base64Length: Math.ceil(bytes.length / 3) * 4, byteLength: bytes.length, contentSha256: createHash('sha256').update(bytes).digest('hex') }] })).ok, true);
  let offset = 0;
  for (let start = 0; start < bytes.length; start += 3) {
    const data = bytes.subarray(start, start + 3).toString('base64');
    assert.equal((await stageMessage(page, { type: 'FILE_STAGE_CHUNK', transferId: 'streamed', fileIndex: 0, offset, data })).ok, true);
    offset += data.length;
  }
  let completed = false;
  const commit = stageMessage(page, { type: 'FILE_STAGE_COMMIT', transferId: 'streamed' }).then(result => { completed = true; return result; });
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(completed, false); assert.equal(page.bridge.inspect().ready, false);
  const file = page.state.fileInput.files[0];
  assert.equal(file.size, bytes.length); assert.ok(file.parts.every(part => part instanceof Blob));
  assert.deepEqual(Buffer.from(await file.blob.arrayBuffer()), bytes);
  page.state.uploadBusy = false; assert.equal((await commit).ok, true);
});

test('staged cancellation, malformed encoding and incomplete Unicode never reach the picker', async () => {
  for (const mode of ['cancel', 'encoding', 'unicode']) {
    let selections = 0;
    const page = fixture({ setup({ state }) { state.fileInput = new FakeElement('INPUT'); state.fileInput.dispatchEvent = () => { selections += 1; return true; }; } });
    await stageMessage(page, { type: 'FILE_STAGE_BEGIN', transferId: mode, runId: `run-${mode}`,
      files: [{ name: 'source.txt', mimeType: 'text/plain', base64Length: 4, byteLength: 1 }] });
    if (mode === 'cancel') page.bridge.cancel({ runId: `run-${mode}` });
    else await stageMessage(page, { type: 'FILE_STAGE_CHUNK', transferId: mode, fileIndex: 0, offset: 0, data: mode === 'encoding' ? 'YR==' : 'wg==' });
    assert.equal((await stageMessage(page, { type: 'FILE_STAGE_COMMIT', transferId: mode })).ok, false);
    assert.equal(selections, 0);
  }
});

test('staged malformed ZIP validation uses bounded file slices and rejects before selecting the file', async () => {
  let selections = 0;
  const page = fixture({ setup({ state }) { state.fileInput = new FakeElement('INPUT'); state.fileInput.dispatchEvent = () => { selections += 1; return true; }; } });
  await stageMessage(page, { type: 'FILE_STAGE_BEGIN', transferId: 'zip', files: [{ name: 'source.zip', mimeType: 'application/zip', base64Length: 4, byteLength: 2 }] });
  await stageMessage(page, { type: 'FILE_STAGE_CHUNK', transferId: 'zip', fileIndex: 0, offset: 0, data: 'UEs=' });
  const result = await stageMessage(page, { type: 'FILE_STAGE_COMMIT', transferId: 'zip' });
  assert.equal(result.ok, false); assert.match(result.error, /ZIP/); assert.equal(selections, 0);
});

test('staged declared 512 MiB boundary is accepted while an oversized file or 1 GiB batch is rejected without allocating payloads', async () => {
  const page = fixture(); const maximum = 512 * 1024 * 1024;
  const descriptor = bytes => ({ name: 'source.pdf', mimeType: 'application/pdf', byteLength: bytes, base64Length: Math.ceil(bytes / 3) * 4 });
  assert.equal((await stageMessage(page, { type: 'FILE_STAGE_BEGIN', transferId: 'limit', files: [descriptor(maximum)] })).ok, true);
  assert.equal((await stageMessage(page, { type: 'FILE_STAGE_ABORT', transferId: 'limit' })).ok, true);
  assert.equal((await stageMessage(page, { type: 'FILE_STAGE_BEGIN', transferId: 'oversized', files: [descriptor(maximum + 1)] })).ok, false);
  assert.equal((await stageMessage(page, { type: 'FILE_STAGE_BEGIN', transferId: 'aggregate', files: [0, 1, 2].map(index => ({ ...descriptor(maximum), name: `source-${index}.pdf` })) })).ok, false);
});

test('invalid source bytes, noncanonical base64 and duplicate filenames never reach the attachment picker', async () => {
  const cases = [
    [{ name: 'reviewed.py', mimeType: 'text/plain', base64: Buffer.from([0x4d, 0x5a, 0, 1]).toString('base64') }],
    [{ name: 'reviewed.mq5', mimeType: 'text/plain', base64: Buffer.from([0xff, 0x80]).toString('base64') }],
    [{ name: 'reviewed.mq5', mimeType: 'image/png', base64: 'YQ==' }],
    [{ name: 'source.pdf', mimeType: 'text/plain', base64: 'YQ==' }],
    [{ name: 'source.pdf', mimeType: 'application/pdf', base64: 'YR==' }],
    [{ name: 'duplicate.txt', mimeType: 'text/plain', base64: 'YQ==' }, { name: 'duplicate.txt', mimeType: 'text/plain', base64: 'Yg==' }],
  ];
  for (const files of cases) {
    let selected = 0;
    const page = fixture({ setup({ state }) {
      state.fileInput = new FakeElement('INPUT'); state.fileInput.multiple = true;
      state.fileInput.dispatchEvent = () => { selected += 1; return true; };
    } });
    const result = await page.bridge.uploadFiles({ files });
    assert.equal(result.ok, false, JSON.stringify(files));
    assert.match(result.error, /binary|Unicode|does not match|noncanonical|unique/);
    assert.equal(selected, 0, 'Invalid data must not mutate native attachment selection.');
  }
});

test('UTF-8 and BOM-marked UTF-16 source uploads preserve every inert byte', async () => {
  const text = '// বাংলা\r\nvoid OnTick() {}\r\n';
  const little = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
  const big = Buffer.from(little); big.swap16();
  for (const name of ['reviewed.mq5', 'notes.tex']) for (const bytes of [Buffer.from(text), little, big]) {
    let selected;
    const page = fixture({ setup({ state, form }) {
      state.fileInput = new FakeElement('INPUT');
      state.fileInput.dispatchEvent = () => { selected = state.fileInput.files; form.innerText = name; return true; };
    } });
    const result = await page.bridge.uploadFiles({ files: [{ name, mimeType: 'text/plain', base64: bytes.toString('base64') }] });
    assert.deepEqual(result, { ok: true, attached: 1 });
    assert.deepEqual(Buffer.from(selected[0].parts[0]), bytes);
  }
});

test('TSV inline and staged uploads preserve Unicode bytes and reject binary or mislabeled tables', async () => {
  const name = 'ced_scope_manifest.tsv', mimeType = 'text/tab-separated-values';
  const text = 'scope\tstatus\r\nবাংলা\tchecked\r\n';
  const little = Buffer.concat([Buffer.from([255, 254]), Buffer.from(text, 'utf16le')]);
  for (const bytes of [Buffer.from(text), little, Buffer.from(little).swap16()]) {
    for (const staged of [false, true]) {
      let selected;
      const page = fixture({ setup({ state, form }) {
        state.fileInput = new FakeElement('INPUT');
        state.fileInput.dispatchEvent = () => { selected = state.fileInput.files; form.innerText = name; return true; };
      } });
      let result;
      if (staged) {
        assert.equal((await stageMessage(page, { type: 'FILE_STAGE_BEGIN', transferId: 'tsv', files: [{ name, mimeType, base64Length: Math.ceil(bytes.length / 3) * 4, byteLength: bytes.length }] })).ok, true);
        let offset = 0;
        for (let at = 0; at < bytes.length; at += 3) {
          const data = bytes.subarray(at, at + 3).toString('base64');
          assert.equal((await stageMessage(page, { type: 'FILE_STAGE_CHUNK', transferId: 'tsv', fileIndex: 0, offset, data })).ok, true);
          offset += data.length;
        }
        result = await stageMessage(page, { type: 'FILE_STAGE_COMMIT', transferId: 'tsv' });
        assert.deepEqual(Buffer.from(await selected[0].blob.arrayBuffer()), bytes);
      } else {
        result = await page.bridge.uploadFiles({ files: [{ name, mimeType, base64: bytes.toString('base64') }] });
        assert.deepEqual(Buffer.from(selected[0].parts[0]), bytes);
      }
      assert.deepEqual(result, { ok: true, attached: 1 }); assert.equal(selected[0].name, name); assert.equal(selected[0].type, mimeType);
    }
  }
  for (const file of [
    { name, mimeType, base64: Buffer.from([65, 9, 0]).toString('base64') },
    { name, mimeType, base64: Buffer.from([0xc3, 0x28]).toString('base64') },
    { name, mimeType: 'text/plain', base64: little.toString('base64') },
    { name: 'manifest.txt', mimeType, base64: little.toString('base64') }
  ]) {
    let selections = 0;
    const page = fixture({ setup({ state }) { state.fileInput = new FakeElement('INPUT'); state.fileInput.dispatchEvent = () => { selections++; }; } });
    assert.equal((await page.bridge.uploadFiles({ files: [file] })).ok, false); assert.equal(selections, 0);
  }
  for (const bytes of [Buffer.from([65, 9, 0]), Buffer.from([0xc3])]) {
    const page = fixture();
    assert.equal((await stageMessage(page, { type: 'FILE_STAGE_BEGIN', transferId: 'invalid-tsv', files: [{ name, mimeType, base64Length: 4, byteLength: bytes.length }] })).ok, true);
    const chunk = await stageMessage(page, { type: 'FILE_STAGE_CHUNK', transferId: 'invalid-tsv', fileIndex: 0, offset: 0, data: bytes.toString('base64') });
    assert.equal((await stageMessage(page, { type: 'FILE_STAGE_COMMIT', transferId: 'invalid-tsv' })).ok, false);
    if (bytes.length === 3) assert.equal(chunk.ok, false);
  }
});

test('ZIP packages and .set text aliases upload their exact inert bytes before a prompt', async () => {
  const archives = require('../../test/fixtures/archive-bytes.json');
  const files = [{name:'package.zip',mimeType:'application/zip',base64:archives.packageBase64},
    {name:'defaults.set.txt',mimeType:'text/plain',base64:Buffer.from('Lots=0.01\r\nMaxRiskMoney=20\r\n').toString('base64')}];
  let selected;
  const page = fixture({setup({state, form}) {
    state.fileInput = new FakeElement('INPUT');
    state.fileInput.multiple = true;
    state.fileInput.dispatchEvent = () => { selected = state.fileInput.files; form.innerText = files.map(f=>f.name).join('\n'); return true; };
  }});
  const result = await page.bridge.uploadFiles({files});
  assert.deepEqual(result,{ok:true,attached:2});
  assert.deepEqual(selected.map(f=>({name:f.name,type:f.type})),files.map(f=>({name:f.name,type:f.mimeType})));
  assert.deepEqual(selected.map(f=>Buffer.from(f.parts[0]).toString('base64')),files.map(f=>f.base64));
});

test('invalid ZIP containers, mismatched filenames and binary settings cannot enter the attachment picker', async () => {
  const good = require('../../test/fixtures/archive-bytes.json').packageBase64;
  for (const file of [
    {name:'package.zip',mimeType:'application/zip',base64:Buffer.from('PK\x03\x04').toString('base64')},
    {name:'program.exe',mimeType:'application/zip',base64:good},
    {name:'defaults.set.txt',mimeType:'text/plain',base64:Buffer.from([0x4d,0x5a,0,1]).toString('base64')},
    {name:'defaults.set',mimeType:'application/pdf',base64:Buffer.from('Lots=0.01').toString('base64')},
  ]) {
    let clicks = 0;
    const page = fixture({setup({state}) { state.fileInput = new FakeElement('INPUT'); state.fileInput.dispatchEvent=()=>{clicks+=1;return true;}; }});
    const result = await page.bridge.uploadFiles({files:[file]});
    assert.equal(result.ok,false); assert.match(result.error,/ZIP|settings|binary data/);
    assert.equal(clicks,0);
  }
});

test('SEND_PROMPT uploads incoming files before filling or sending its prompt', async () => {
  const events = [];
  const page = fixture({ setup({ state, composer, form }) {
    state.fileInput = new FakeElement('INPUT');
    state.fileInput.dispatchEvent = () => { events.push('upload'); assert.equal(composer.value, ''); form.innerText = 'report.docx'; return true; };
  }, onSend({ text, addUser, addAssistant }) { events.push('send'); addUser(text); addAssistant('Reviewed the attached report'); } });
  const ack = await page.bridge.sendPrompt({ runId: 'files-run', requestId: 'files-request', text: 'Review this report', files: [{
    name: 'report.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', base64: 'YQ=='
  }] });
  assert.equal(ack.ok, true);
  assert.deepEqual(events, ['upload', 'send']);
  assert.equal((await waitFor(() => page.messages.find((message) => message.type === 'REPLY'))).text, 'Reviewed the attached report');
});

test('CANCEL aborts incoming attachment wait and prevents the following prompt', async () => {
  let sends = 0;
  const page = fixture({ setup({ state }) { state.fileInput = new FakeElement('INPUT'); }, onSend() { sends += 1; } });
  const pending = page.bridge.sendPrompt({ runId: 'attachment-stop', requestId: 'request', text: 'Do not submit', files: [{ name: 'cat.png', mimeType: 'image/png', base64: 'YQ==' }] });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(page.bridge.cancel({ runId: 'attachment-stop' }).cancelled, true);
  const result = await pending;
  assert.equal(result.ok, false);
  assert.match(result.error, /cancelled/i);
  assert.equal(sends, 0);
  assert.equal(page.composer.value, '');
  assert.equal(page.messages.filter((message) => ['ERROR', 'REPLY'].includes(message.type)).length, 0);
});

test('pagehide aborts a standalone source upload promptly without an active prompt', async () => {
  const page = fixture({ options: { uploadTimeoutMs: 5000 }, setup({ state }) { state.fileInput = new FakeElement('INPUT'); } });
  const upload = page.bridge.uploadFiles({ files: [{ name: 'photo.png', mimeType: 'image/png', base64: 'YQ==' }] });
  await new Promise(resolve => setTimeout(resolve, 10));
  const started = Date.now();
  page.window.dispatchEvent(new page.window.Event('pagehide'));
  const result = await upload;
  assert.equal(result.ok, false);
  assert.match(result.error, /closed or navigated/);
  assert.ok(Date.now() - started < 500, 'Navigation must release the upload without waiting for its provider timeout.');
  assert.equal(page.messages.some(message => ['ERROR', 'REPLY'].includes(message.type)), false);
});

test('pagehide cancels a completed-result native export even when no prompt remains active', async t => {
  const delays = [], realSetTimeout = global.setTimeout;
  t.mock.method(global, 'setTimeout', (callback, delay, ...args) => { delays.push(delay); return realSetTimeout(callback, delay, ...args); });
  const link = downloadableFile('reviewed.pdf', 'sandbox:/mnt/data/reviewed.pdf');
  let capturedSignal;
  let finishNative;
  const page = fixture({ downloadVisible: request => {
    capturedSignal = request.signal;
    return new Promise(resolve => { finishNative = resolve; });
  }, onSend({ text, addUser, addAssistant }) { addUser(text); addMediaToTurn(addAssistant('Completed PDF.'), [link]); } });
  const request = { runId: 'export-pagehide', requestId: 'completed-result', text: 'Create a PDF.', relayMedia: true };
  assert.equal((await page.bridge.sendPrompt(request)).ok, true);
  await waitFor(() => page.messages.find(message => message.type === 'REPLY'));
  const exporting = page.bridge.exportMedia({ ...request, ids: ['media-1'] });
  await waitFor(() => capturedSignal);
  assert.ok(delays.includes(35 * 60_000), 'The page export cannot abort before the 30-minute native broker plus transfer overhead.');
  page.window.dispatchEvent(new page.window.Event('pagehide'));
  const result = await exporting;
  assert.equal(result.ok, false);
  assert.match(result.error, /closed or navigated/);
  assert.equal(capturedSignal.aborted, true);
  finishNative({ ok: true, mimeType: 'application/pdf', base64: Buffer.from('%PDF late completion').toString('base64') });
  await new Promise(setImmediate);
  assert.equal(page.messages.filter(message => message.type === 'REPLY').length, 1, 'A late download cannot resume the exchange.');
});

test('image-only completion emits descriptors without bytes or URLs and exports a rendered PNG', async () => {
  const image = generatedImage();
  const hidden = generatedImage('https://chatgpt.com/hidden.png'); hidden.hidden = true;
  const avatar = generatedImage('https://chatgpt.com/avatar.png'); avatar.getBoundingClientRect = () => ({ width: 32, height: 32 });
  const page = fixture({ onSend({ text, state, addUser, addAssistant }) {
    addUser(text); state.generating = true;
    const turn = addAssistant(''); addMediaToTurn(turn, [image, hidden, avatar]);
    setTimeout(() => { state.generating = false; }, 20);
  } });
  const request = { runId: 'media-run', requestId: 'media-request', text: 'Generate one image', relayMedia: true };
  assert.equal((await page.bridge.sendPrompt(request)).ok, true);
  const reply = await waitFor(() => page.messages.find((message) => message.type === 'REPLY'));
  assert.equal(reply.text, '');
  assert.deepEqual(reply.media.map(({ id, name, mimeType }) => ({ id, name, mimeType })), [{ id: 'media-1', name: 'generated-image-1.png', mimeType: 'image/png' }]);
  assert.doesNotMatch(JSON.stringify(reply), /https:|base64|hidden|avatar/);
  const result = await page.bridge.exportMedia({ ...request, ids: ['media-1'] });
  assert.equal(result.ok, true);
  assert.equal(result.files[0].base64, 'aW1hZ2U=');
  assert.equal(result.files[0].fingerprint, reply.media[0].fingerprint);
  assert.equal(result.files[0].contentSha256, createHash('sha256').update(Buffer.from('image')).digest('hex'));
  assert.equal(result.files[0].byteLength, 5);
  image.currentSrc = 'https://chatgpt.com/changed.png';
  assert.deepEqual((await page.bridge.exportMedia({ ...request, ids: ['media-1'] })).files, result.files,
    'Later reviews must receive the verified original image, not the current rendering.');
});

test('an ordinary failed attachment widget blocks upload success and page readiness even when its PDF name exists', async () => {
  const failure = new FakeElement('DIV', 'Upload failed because of a network issue. Check your connection and try again.');
  const page = fixture({ setup({ state, form }) {
    const query = form.querySelectorAll.bind(form);
    form.querySelectorAll = (selector) => selector.includes('div, span, p') ? state.failedWidget ? [failure] : [] : query(selector);
    state.fileInput = new FakeElement('INPUT');
    state.fileInput.dispatchEvent = () => { form.innerText = 'source.pdf'; state.failedWidget = true; return true; };
  } });
  const result = await page.bridge.uploadFiles({ files: [{ name: 'source.pdf', mimeType: 'application/pdf', base64: 'YQ==' }] });
  assert.equal(result.ok, false);
  assert.match(result.error, /rejected an attachment.*network issue/i);
  const status = page.bridge.inspect();
  assert.equal(status.ready, false);
  assert.match(status.reason, /attachment failed.*network issue.*Remove the failed attachment/i);
  const ack = await page.bridge.sendPrompt({ runId: 'failed-upload-gate', requestId: 'request', text: 'Fix my source PDF.' });
  assert.equal(ack.ok, false);
  assert.equal(page.composer.value, '');
  assert.equal(page.messages.some((message) => message.type === 'REPLY'), false);
});

test('old-turn errors and the user draft mentioning file errors do not become current attachment failures', async () => {
  const oldTurn = new FakeElement('DIV', '', { 'data-message-author-role': 'assistant' });
  const oldError = new FakeElement('SPAN', 'Upload failed.');
  oldError.closest = (selector) => selector.includes('data-message-author-role') ? oldTurn : null;
  const page = fixture({ composerMode: 'rich-editor', setup({ state, form, composer }) {
    const query = form.querySelectorAll.bind(form);
    form.querySelectorAll = (selector) => selector.includes('div, span, p') ? [oldError, composer] : query(selector);
    composer.value = 'Find every file error and fix my answer.';
    state.fileInput = new FakeElement('INPUT');
    state.fileInput.dispatchEvent = () => { form.innerText = 'source.pdf'; return true; };
  } });
  assert.doesNotMatch(page.bridge.inspect().reason, /attachment failed/i);
  const result = await page.bridge.uploadFiles({ files: [{ name: 'source.pdf', mimeType: 'application/pdf', base64: 'YQ==' }] });
  assert.equal(result.ok, true, result.error);
});

test('a visible attachment progress indicator makes the page unready until the upload finishes', () => {
  const page = fixture();
  page.state.uploadBusy = true;
  assert.equal(page.bridge.inspect().ready, false);
  assert.match(page.bridge.inspect().reason, /uploading an attachment/i);
  page.state.uploadBusy = false;
  assert.equal(page.bridge.inspect().ready, true);
});

test('a successful filename containing file errors cannot be mistaken for a failed upload', async () => {
  const chip = new FakeElement('SPAN', 'file errors to correct.pdf');
  const page = fixture({ setup({ state, form }) {
    const query = form.querySelectorAll.bind(form);
    form.querySelectorAll = (selector) => selector.includes('div, span, p') ? [chip] : query(selector);
    state.fileInput = new FakeElement('INPUT');
    state.fileInput.dispatchEvent = () => { form.innerText = chip.innerText; return true; };
  } });
  const result = await page.bridge.uploadFiles({ files: [{ name: chip.innerText, mimeType: 'application/pdf', base64: 'YQ==' }] });
  assert.equal(result.ok, true, result.error);
  assert.equal(page.bridge.inspect().ready, true);
});

test('disabled media relay fails promptly for image-only output instead of waiting for text', async () => {
  const page = fixture({ onSend({ text, addUser, addAssistant }) { addUser(text); addMediaToTurn(addAssistant(''), [generatedImage()]); } });
  assert.equal((await page.bridge.sendPrompt({ runId: 'no-media', requestId: 'request', text: 'Generate' })).ok, true);
  const error = await waitFor(() => page.messages.find((message) => message.type === 'ERROR'));
  assert.match(error.error, /Enable generated media relay/);
  assert.equal(page.messages.some((message) => message.type === 'REPLY'), false);
});

test('explicit Save preserves completed verified output after Stop while automatic exports remain blocked', async () => {
  const image = generatedImage();
  const page = fixture({ onSend({ text, addUser, addAssistant }) {
    addUser(text); addMediaToTurn(addAssistant('Completed output'), [image]);
  } });
  const request = { runId: 'completed-save', requestId: 'completed-response', text: 'Create a file', relayMedia: true };
  await page.bridge.sendPrompt(request);
  const reply = await waitFor(() => page.messages.find((message) => message.type === 'REPLY'));
  const exportRequest = { ...request, ids: reply.media.map((file) => file.id) };
  const first = await page.bridge.exportMedia(exportRequest);
  assert.equal(first.ok, true);
  page.bridge.cancel({ runId: request.runId });
  assert.match((await page.bridge.exportMedia(exportRequest)).error, /cancelled/);
  const saved = await page.bridge.exportMedia({ ...exportRequest, allowCancelled: true });
  assert.equal(saved.ok, true);
  assert.deepEqual(saved.files, first.files);
  page.document.createElement = () => ({ getContext: () => ({ drawImage() {} }), toDataURL: () => 'data:image/png;base64,aW1hZ2Uy' });
  assert.deepEqual((await page.bridge.exportMedia({ ...exportRequest, allowCancelled: true })).files, first.files);
  assert.equal((await page.bridge.exportMedia({ runId: 'uncompleted-save', requestId: 'uncompleted-response', ids: ['media-1'], allowCancelled: true })).ok, false);
});

test('sandbox PDF downloads use the exact visible native action and retain byte and DOM verification', async () => {
  const link = downloadableFile('corrected.pdf', 'sandbox:/mnt/data/corrected.pdf');
  const calls = [];
  const base64 = Buffer.from('%PDF-1.4\ncorrected fixture').toString('base64');
  const page = fixture({ downloadVisible: async (request) => {
    calls.push(request); return { ok: true, base64, mimeType: 'application/pdf' };
  }, onSend({ text, addUser, addAssistant }) {
    addUser(text); addMediaToTurn(addAssistant('Corrected PDF attached.'), [link]);
  } });
  const request = { runId: 'native-pdf', requestId: 'native-response', text: 'Correct a PDF.', relayMedia: true };
  await page.bridge.sendPrompt(request);
  const reply = await waitFor(() => page.messages.find((message) => message.type === 'REPLY'));
  assert.deepEqual(reply.media.map(({ name, mimeType }) => ({ name, mimeType })), [{ name: 'corrected.pdf', mimeType: 'application/pdf' }]);
  const exported = await page.bridge.exportMedia({ ...request, ids: ['media-1'] });
  assert.equal(exported.ok, true);
  assert.equal(exported.files[0].base64, base64);
  assert.equal(calls[0].element, link);
  assert.equal(calls[0].runId, request.runId);
  assert.equal(calls[0].requestId, request.requestId);
  assert.equal(calls[0].name, 'corrected.pdf');
  assert.equal(calls[0].mimeType, 'application/pdf');
  link.href = 'sandbox:/mnt/data/changed.pdf'; link.attributes.href = link.href;
  assert.deepEqual((await page.bridge.exportMedia({ ...request, ids: ['media-1'] })).files, exported.files);
  assert.equal(calls.length, 1);
});

test('native CED Markdown and TSV Download file cards export their real canonical bytes', async () => {
  const sources = new Map([
    ['WorkerB_CED_L1-20_Forensic_Audit.md', Buffer.from('# Forensic audit\nSee [scope](ced_scope_manifest.tsv).\n')],
    ['ced_scope_manifest.tsv', Buffer.from('scope,note\tstatus\n"L1-20, বাংলা"\tchecked\n')]
  ]);
  const calls = [];
  const page = fixture({ downloadVisible: async request => {
    calls.push(request); assert.equal(request.isCurrent(), true);
    return { ok: true, base64: sources.get(request.name).toString('base64'), mimeType: request.mimeType, sourceVerifiedAtClick: true };
  }, onSend({ text, addUser, addAssistant }) {
    addUser(text);
    const turn = addAssistant('Completed CED forensic audit and scope manifest.');
    const cards = [...sources.keys()].map(name => {
      const card = new FakeElement('DIV'), title = new FakeElement('DIV', name, { title: name });
      const preview = new FakeElement('BUTTON', '', { 'aria-label': `Open preview of ${name}` });
      const action = new FakeElement('BUTTON', '', { 'aria-label': 'Download file' });
      for (const child of [title, preview, action]) child.parentElement = card;
      card.parentElement = turn; card.children = [title, preview, action];
      card.querySelectorAll = selector => selector === 'button[aria-label="Download file"]' ? [action]
        : selector === 'button[aria-label^="Open preview of "]' ? [preview] : selector === '[title]' ? [title] : [];
      return card;
    });
    turn.contains = child => cards.some(card => child === card || card.children.includes(child));
    turn.querySelectorAll = selector => selector === 'button[aria-label="Download file"]' ? cards.map(card => card.children[2])
      : selector === 'button, [role="button"]' ? cards.flatMap(card => card.children.slice(1)) : [];
  } });
  const request = { runId: 'native-ced', requestId: 'worker-b', text: 'Audit the CED chapters.', relayMedia: true };
  await page.bridge.sendPrompt(request);
  const reply = await waitFor(() => page.messages.find(message => message.type === 'REPLY' || message.type === 'ERROR'));
  assert.equal(reply.type, 'REPLY', reply.error);
  assert.deepEqual(reply.media.map(file => [file.name, file.mimeType]), [
    ['WorkerB_CED_L1-20_Forensic_Audit.md', 'text/markdown'], ['ced_scope_manifest.tsv', 'text/tab-separated-values']
  ]);
  const result = await page.bridge.exportMedia({ ...request, ids: reply.media.map(file => file.id) });
  assert.equal(result.ok, true, result.error); assert.equal(calls.length, 2);
  for (const file of result.files) {
    assert.deepEqual(Buffer.from(file.base64, 'base64'), sources.get(file.name));
    assert.equal(file.contentSha256, createHash('sha256').update(sources.get(file.name)).digest('hex'));
    assert.equal(file.byteLength, sources.get(file.name).length);
  }
  assert.deepEqual((await page.bridge.exportMedia({ ...request, ids: reply.media.map(file => file.id) })).files, result.files);
  assert.equal(calls.length, 2);
});

test('fetched TSV provider plain-text MIME remains bound to the selected table and readable bytes', async () => {
  for (const [name, contentType, bytes, expected] of [
    ['manifest.tsv', 'text/plain; charset=utf-8', Buffer.from('scope,note\tstatus\nL1\tchecked\n'), true],
    ['manifest.tsv', 'text/tab-separated-values', Buffer.from('scope\tstatus\nL1\tchecked\n'), true],
    ['manifest.tsv', 'text/html', Buffer.from('<html>wrong</html>'), false],
    ['manifest.tsv', 'text/plain', Buffer.from([65, 0]), false],
    ['manifest.tsv', 'text/plain', Buffer.from([0xc3, 0x28]), false],
    ['manifest.csv', 'text/plain', Buffer.from('scope,status\nL1,checked\n'), false]
  ]) {
    const link = downloadableFile(name, `https://chatgpt.com/visible/${name}`);
    const page = fixture({ onSend({ text, addUser, addAssistant }) { addUser(text); addMediaToTurn(addAssistant('Manifest attached.'), [link]); } });
    page.window.fetch = async () => ({ ok: true, type: 'basic', headers: { get: header => header === 'content-type' ? contentType : null }, body: { getReader: () => {
      let sent = false; return { async read() { if (sent) return { done: true }; sent = true; return { done: false, value: bytes }; }, async cancel() {} };
    } } });
    const request = { runId: 'fetched-tsv', requestId: 'draft', text: 'Create a manifest.', relayMedia: true };
    await page.bridge.sendPrompt(request);
    const reply = await waitFor(() => page.messages.find(message => message.type === 'REPLY'));
    const exported = await page.bridge.exportMedia({ ...request, ids: reply.media.map(file => file.id) });
    assert.equal(exported.ok, expected, exported.error);
    if (expected) { assert.equal(exported.files[0].name, name); assert.equal(exported.files[0].mimeType, 'text/tab-separated-values'); assert.deepEqual(Buffer.from(exported.files[0].base64, 'base64'), bytes); }
  }
});

test('native PDF links without the desktop broker fail clearly and canceled downloads stop promptly', async () => {
  for (const withBroker of [false, true]) {
    const link = downloadableFile('corrected.pdf', '#download-corrected');
    let capturedSignal;
    const page = fixture({ downloadVisible: withBroker ? (request) => { capturedSignal = request.signal; return new Promise(() => {}); } : undefined,
      onSend({ text, addUser, addAssistant }) { addUser(text); addMediaToTurn(addAssistant('PDF output.'), [link]); } });
    const request = { runId: `native-stop-${withBroker}`, requestId: 'response', text: 'Create a PDF.', relayMedia: true };
    await page.bridge.sendPrompt(request);
    await waitFor(() => page.messages.find((message) => message.type === 'REPLY'));
    const pending = page.bridge.exportMedia({ ...request, ids: ['media-1'] });
    if (withBroker) {
      await waitFor(() => capturedSignal);
      page.bridge.cancel({ runId: request.runId });
      assert.equal(capturedSignal.aborted, true);
    }
    const result = await pending;
    assert.equal(result.ok, false);
    assert.match(result.error, withBroker ? /cancelled/i : /native download action.*desktop app/i);
  }
});

test('native stored downloads relay and cache only their opaque identity even at the 512 MiB boundary', async () => {
  const link = downloadableFile('large.pdf', 'sandbox:/mnt/data/large.pdf'); let downloads = 0;
  const stored = { ok: true, mimeType: 'application/pdf', blobId: 'native-owned-file', byteLength: 512 * 1024 * 1024, contentSha256: 'c'.repeat(64) };
  const page = fixture({ downloadVisible: async request => {
    downloads += 1; assert.equal(request.isCurrent(), true); return { ...stored, sourceVerifiedAtClick: true };
  }, onSend({ text, addUser, addAssistant }) { addUser(text); addMediaToTurn(addAssistant('PDF output.'), [link]); } });
  const request = { runId: 'stored-native', requestId: 'response', text: 'Create a PDF.', relayMedia: true };
  await page.bridge.sendPrompt(request); await waitFor(() => page.messages.find(message => message.type === 'REPLY'));
  const result = await page.bridge.exportMedia({ ...request, ids: ['media-1'] });
  assert.equal(result.ok, true, result.error); assert.equal(result.files[0].blobId, stored.blobId);
  assert.equal(result.files[0].contentSha256, stored.contentSha256); assert.equal(result.files[0].byteLength, stored.byteLength);
  assert.equal('base64' in result.files[0], false);
  page.state.assistants[0].isConnected = false;
  assert.deepEqual((await page.bridge.exportMedia({ ...request, ids: ['media-1'] })).files, result.files);
  assert.equal(downloads, 1, 'Retained native identity does not re-download or recreate its bytes.');
});

test('sequential native files prepared after 18 seconds each keep their export owner and exact bytes', async (t) => {
  const links = Array.from({ length: 5 }, (_, i) => downloadableFile(`reviewed-${i + 1}.pdf`, `sandbox:/mnt/data/reviewed-${i + 1}.pdf`));
  const captures = [];
  const page = fixture({ downloadVisible: (request) => {
    captures.push(request);
    return new Promise((resolve) => setTimeout(() => resolve({ ok: true, mimeType: 'application/pdf',
      base64: Buffer.from(`%PDF-1.4\nExact bytes for ${request.name}\n%%EOF`).toString('base64') }), 18_000));
  }, onSend({ text, addUser, addAssistant }) {
    addUser(text); addMediaToTurn(addAssistant('Five corrected files attached.'), links);
  } });
  // A synchronous real hash keeps only the controlled file preparation on
  // this simulated clock; the bytes and the bridge's final SHA remain checked.
  page.window.crypto = { subtle: { async digest(_algorithm, bytes) { return createHash('sha256').update(bytes).digest(); } } };
  const request = { runId: 'delayed-sequential-native', requestId: 'response', text: 'Correct five files.', relayMedia: true };
  await page.bridge.sendPrompt(request);
  await waitFor(() => page.messages.find((message) => message.type === 'REPLY'));
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const exporting = page.bridge.exportMedia({ ...request, ids: links.map((_, i) => `media-${i + 1}`) });
  for (let i = 0; i < 5; i += 1) {
    assert.equal(captures.length, i + 1);
    t.mock.timers.tick(18_000);
    await new Promise(setImmediate);
    assert.equal(captures[i].signal.aborted, false);
  }
  const result = await exporting;
  assert.equal(result.ok, true, result.error);
  assert.equal(result.files.length, 5);
  for (const file of result.files) {
    const bytes = Buffer.from(`%PDF-1.4\nExact bytes for ${file.name}\n%%EOF`);
    assert.deepEqual(Buffer.from(file.base64, 'base64'), bytes);
    assert.equal(file.contentSha256, createHash('sha256').update(bytes).digest('hex'));
  }
  t.mock.timers.reset();
});

test('Stop during delayed native preparation rejects the export and a late completion cannot seed a saved snapshot', async (t) => {
  const link = downloadableFile('late-reviewed.pdf', 'sandbox:/mnt/data/late-reviewed.pdf');
  const captures = [];
  const page = fixture({ downloadVisible: (request) => {
    captures.push(request);
    return new Promise((resolve) => setTimeout(() => resolve({ ok: true, mimeType: 'application/pdf', base64: 'JVBERi0xLjQ=' }), 18_000));
  }, onSend({ text, addUser, addAssistant }) { addUser(text); addMediaToTurn(addAssistant('Prepared output.'), [link]); } });
  const request = { runId: 'stop-delayed-native', requestId: 'response', text: 'Create a file.', relayMedia: true };
  await page.bridge.sendPrompt(request);
  await waitFor(() => page.messages.find((message) => message.type === 'REPLY'));
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const exporting = page.bridge.exportMedia({ ...request, ids: ['media-1'] });
  assert.equal(captures.length, 1);
  t.mock.timers.tick(5_000);
  page.bridge.cancel({ runId: request.runId });
  const result = await exporting;
  assert.equal(result.ok, false);
  assert.match(result.error, /cancelled/i);
  assert.equal(captures[0].signal.aborted, true);
  t.mock.timers.tick(18_000);
  await new Promise(setImmediate);
  const replies = page.messages.filter((message) => message.type === 'REPLY').length;
  assert.equal(replies, 1, 'A late native completion must not resume the stopped exchange.');
  // With no complete snapshot, an explicit Save needs a new verified export.
  const saving = page.bridge.exportMedia({ ...request, ids: ['media-1'], allowCancelled: true });
  assert.equal(captures.length, 2);
  t.mock.timers.tick(18_000);
  const saved = await saving;
  assert.equal(saved.ok, true, saved.error);
  t.mock.timers.reset();
});

test('an arbitrary JavaScript link is never exposed to the native download callback', async () => {
  let calls = 0;
  const link = downloadableFile('corrected.pdf', 'javascript:window.fetch("https://example.com/secret")');
  const page = fixture({ downloadVisible: async () => { calls += 1; return { ok: true }; },
    onSend({ text, addUser, addAssistant }) { addUser(text); addMediaToTurn(addAssistant('A link is present.'), [link]); } });
  await page.bridge.sendPrompt({ runId: 'unsafe-native', requestId: 'response', text: 'Create output.', relayMedia: true });
  const stopped = await waitFor(() => page.messages.find((message) => message.type === 'ERROR'));
  assert.match(stopped.error, /unsupported/);
  assert.equal(calls, 0);
});

test('stable text waits for an unfinished generated image before emitting the response', async () => {
  const image = generatedImage(); image.complete = false; image.naturalWidth = 0; image.naturalHeight = 0;
  const page = fixture({ onSend({ text, addUser, addAssistant }) { addUser(text); addMediaToTurn(addAssistant('Here is the image'), [image]); } });
  await page.bridge.sendPrompt({ runId: 'loading-image', requestId: 'request', text: 'Create', relayMedia: true });
  await new Promise((resolve) => setTimeout(resolve, 45));
  assert.equal(page.messages.some((message) => message.type === 'REPLY'), false);
  image.complete = true; image.naturalWidth = 512; image.naturalHeight = 256;
  assert.equal((await waitFor(() => page.messages.find((message) => message.type === 'REPLY'))).media.length, 1);
});

test('a completed broken image fails clearly rather than dropping it from a text reply', async () => {
  const image = generatedImage(); image.naturalWidth = 0; image.naturalHeight = 0;
  const page = fixture({ onSend({ text, addUser, addAssistant }) { addUser(text); addMediaToTurn(addAssistant('Here is the image'), [image]); } });
  await page.bridge.sendPrompt({ runId: 'broken-image', requestId: 'request', text: 'Create', relayMedia: true });
  assert.match((await waitFor(() => page.messages.find((message) => message.type === 'ERROR'))).error, /did not load/);
});

test('canvas privacy errors produce a clear media export failure without fetching another URL', async () => {
  let fetches = 0;
  const page = fixture({ onSend({ text, addUser, addAssistant }) { addUser(text); addMediaToTurn(addAssistant(''), [generatedImage()]); } });
  page.document.createElement = () => ({ getContext: () => ({ drawImage() {} }), toDataURL() { throw new Error('Tainted canvas'); } });
  page.window.fetch = async () => { fetches += 1; throw new Error('Must not fetch'); };
  const request = { runId: 'cors-run', requestId: 'request', text: 'Generate', relayMedia: true };
  await page.bridge.sendPrompt(request);
  await waitFor(() => page.messages.find((message) => message.type === 'REPLY'));
  const result = await page.bridge.exportMedia({ ...request, ids: ['media-1'] });
  assert.equal(result.ok, false);
  assert.match(result.error, /Tainted canvas/);
  assert.equal(fetches, 0);
});

test('the same image descriptor preserves first verified bytes on a later review', async () => {
  const page = fixture({ onSend({ text, addUser, addAssistant }) { addUser(text); addMediaToTurn(addAssistant(''), [generatedImage()]); } });
  const request = { runId: 'stable-content-run', requestId: 'request', text: 'Generate', relayMedia: true };
  await page.bridge.sendPrompt(request);
  await waitFor(() => page.messages.find((message) => message.type === 'REPLY'));
  const first = await page.bridge.exportMedia({ ...request, ids: ['media-1'] });
  assert.equal(first.ok, true);
  page.document.createElement = () => ({ getContext: () => ({ drawImage() {} }), toDataURL: () => 'data:image/png;base64,Y2hhbmdlZA==' });
  const changed = await page.bridge.exportMedia({ ...request, ids: ['media-1'] });
  assert.equal(changed.ok, true);
  assert.deepEqual(changed.files, first.files);
});

test('visible download export uses only the captured href and ignores paper citations', async () => {
  const download = downloadableFile('report/a.csv');
  const citation = new FakeElement('A', 'Read the research paper', { href: 'https://example.com/paper.pdf' });
  citation.href = citation.getAttribute('href');
  const page = fixture({ onSend({ text, addUser, addAssistant }) { addUser(text); addMediaToTurn(addAssistant('Your report is ready'), [download, citation]); } });
  const fetches = [];
  page.window.fetch = async (href, options) => {
    fetches.push({ href, options });
    let read = false;
    return { ok: true, type: 'basic', headers: { get: (name) => name === 'content-type' ? 'text/csv' : null }, body: { getReader: () => ({
      async read() { if (read) return { done: true }; read = true; return { done: false, value: new Uint8Array(Buffer.from('a,b\n1,2')) }; }
    }) } };
  };
  const request = { runId: 'download-run', requestId: 'request', text: 'Create a report', relayMedia: true };
  await page.bridge.sendPrompt(request);
  const reply = await waitFor(() => page.messages.find((message) => message.type === 'REPLY'));
  assert.equal(reply.media.length, 1);
  assert.equal(reply.media[0].name, 'report_a.csv');
  const result = await page.bridge.exportMedia({ ...request, ids: ['media-1'] });
  assert.equal(result.ok, true);
  assert.equal(Buffer.from(result.files[0].base64, 'base64').toString(), 'a,b\n1,2');
  assert.equal(fetches.length, 1);
  assert.equal(fetches[0].href, download.href);
  assert.equal(fetches[0].options.credentials, 'same-origin');
  assert.equal(fetches[0].options.redirect, 'error');
  download.href = 'https://chatgpt.com/changed.csv';
  assert.deepEqual((await page.bridge.exportMedia({ ...request, ids: ['media-1'] })).files, result.files);
  assert.equal(fetches.length, 1);
});

test('a fetched ZIP cannot masquerade as PDF, image or source while OpenXML containers keep their own MIME', async () => {
  for (const name of ['reviewed.pdf', 'reviewed.png', 'reviewed.py', 'reviewed.docx']) {
    const link = downloadableFile(name, `https://chatgpt.com/visible/${name}`);
    const page = fixture({ onSend({ text, addUser, addAssistant }) { addUser(text); addMediaToTurn(addAssistant('File ready.'), [link]); } });
    let reads = 0;
    page.window.fetch = async () => ({ ok: true, type: 'basic', headers: { get: key => key === 'content-type' ? 'application/zip' : null },
      body: { getReader: () => ({ async read() { reads += 1; return reads === 1 ? { done: false, value: new Uint8Array(Buffer.from('opaque office container')) } : { done: true }; } }) } });
    const request = { runId: `mime-zip-${name}`, requestId: 'download', text: 'Create output.', relayMedia: true };
    assert.equal((await page.bridge.sendPrompt(request)).ok, true);
    await waitFor(() => page.messages.find(message => message.type === 'REPLY'));
    const exported = await page.bridge.exportMedia({ ...request, ids: ['media-1'] });
    assert.equal(exported.ok, name.endsWith('.docx'), exported.error);
    if (!exported.ok) { assert.match(exported.error, /unexpected file type/); assert.equal(reads, 0); }
    else assert.equal(exported.files[0].mimeType, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  }
});

test('fetched Python MIME aliases remain bound to the selected .py source filename', async () => {
  for (const name of ['reviewed.py', 'reviewed.txt']) {
    const link = downloadableFile(name, `https://chatgpt.com/visible/${name}`);
    const bytes = Buffer.from('def solve():\n    return 10\n');
    const page = fixture({ onSend({ text, addUser, addAssistant }) { addUser(text); addMediaToTurn(addAssistant('Source ready.'), [link]); } });
    let reads = 0;
    page.window.fetch = async () => ({ ok: true, type: 'basic', headers: { get: key => key === 'content-type' ? 'TEXT/X-PYTHON; charset=utf-8' : null },
      body: { getReader: () => ({ async read() { reads += 1; return reads === 1 ? { done: false, value: new Uint8Array(bytes) } : { done: true }; } }) } });
    const request = { runId: `python-mime-${name}`, requestId: 'source', text: 'Create source.', relayMedia: true };
    assert.equal((await page.bridge.sendPrompt(request)).ok, true);
    await waitFor(() => page.messages.find(message => message.type === 'REPLY'));
    const exported = await page.bridge.exportMedia({ ...request, ids: ['media-1'] });
    assert.equal(exported.ok, name.endsWith('.py'), exported.error);
    if (exported.ok) assert.deepEqual(Buffer.from(exported.files[0].base64, 'base64'), bytes);
    else { assert.match(exported.error, /unexpected file type/); assert.equal(reads, 0); }
  }
});

test('a visible unsupported download stops enabled media relay clearly', async () => {
  const page = fixture({ onSend({ text, addUser, addAssistant }) { addUser(text); addMediaToTurn(addAssistant('File ready'), [downloadableFile('archive.exe', 'https://chatgpt.com/archive.exe')]); } });
  await page.bridge.sendPrompt({ runId: 'unsupported-run', requestId: 'request', text: 'Create', relayMedia: true });
  const failure = await waitFor(() => page.messages.find((message) => message.type === 'ERROR'));
  assert.match(failure.error, /unsupported/);
  assert.equal(failure.recoverableOutputFailure, true);
  assert.equal(failure.owned, true);
  assert.equal(failure.active, false);
  assert.equal(failure.generationBusy, false);
  assert.equal(failure.newerUserMessage, false);
});

test('a native Stop reappearing between unsupported output observation and its catch preserves the original response', async () => {
  const link = downloadableFile('archive.exe', 'https://chatgpt.com/archive.exe');
  const closest = link.closest.bind(link);
  let resumed = false;
  let sent = 0;
  let response;
  const page = fixture({ onSend({ text, addUser, addAssistant }) {
    sent += 1; addUser(text); response = addAssistant('Provisional output while the provider reconnects.');
    addMediaToTurn(response, [link]);
  } });
  link.closest = selector => {
    // The unsupported-file diagnostic resolves its exact assistant wrapper
    // after the final native-idle check. Let the provider resume in the queued
    // microtask before the promise rejection reaches the bridge's catch.
    if (!resumed && selector === '[data-message-author-role="assistant"], div:has(> h4[data-conversation-role="assistant"])') {
      resumed = true;
      queueMicrotask(() => {
        page.state.generating = true;
        addMediaToTurn(response, []);
        setTimeout(() => {
          response.innerText = response.textContent = 'Completed original response after the provider resumed.';
          page.state.generating = false;
        }, 40);
      });
    }
    return closest(selector);
  };
  const request = { runId: 'unsupported-output-resume-race', requestId: 'original-request', text: 'Create the document.', relayMedia: true };
  assert.equal((await page.bridge.sendPrompt(request)).ok, true);
  await waitFor(() => resumed && page.state.generating);
  assert.equal(page.state.stopClicks, 0);
  assert.equal(page.messages.some(message => message.type === 'ERROR'), false);
  const reply = await waitFor(() => page.messages.find(message => message.type === 'REPLY'));
  assert.equal(reply.runId, request.runId); assert.equal(reply.requestId, request.requestId);
  assert.equal(reply.text, 'Completed original response after the provider resumed.');
  assert.equal(page.state.stopClicks, 0); assert.equal(sent, 1);
  assert.equal(page.messages.some(message => message.type === 'ERROR'), false);
  assert.equal(page.messages.filter(message => message.type === 'REPLY').length, 1);
});

test('verified native PDF snapshots survive history remounts without another download and keep exact task ownership', async () => {
  const link = downloadableFile('reviewed.pdf', 'sandbox:/mnt/data/reviewed.pdf');
  const original = Buffer.from('%PDF-1.4\nFirst fully checked candidate\n%%EOF').toString('base64');
  let calls = 0;
  const page = fixture({ downloadVisible: async (request) => {
    calls += 1;
    return { ok: true, mimeType: request.mimeType, base64: original };
  }, onSend({ text, addUser, addAssistant }) {
    addUser(text); addMediaToTurn(addAssistant('The reviewed PDF is attached.'), [link]);
  } });
  const request = { runId: 'snapshot-run', requestId: 'snapshot-draft', text: 'Create a PDF', relayMedia: true };
  assert.equal((await page.bridge.sendPrompt(request)).ok, true);
  const reply = await waitFor(() => page.messages.find((item) => item.type === 'REPLY'));
  const first = await page.bridge.exportMedia({ ...request, ids: ['media-1'] });
  assert.equal(first.ok, true, first.error);
  const expected = { ...first.files[0] };
  assert.equal(expected.fingerprint, reply.media[0].fingerprint);
  page.state.assistants[0].isConnected = false;
  link.isConnected = false;
  // A replacement DOM could show another file; it is never used as a fallback.
  addMediaToTurn(page.addAssistant('Replacement history'), [downloadableFile('replacement.pdf', 'sandbox:/mnt/data/replacement.pdf')]);
  first.files[0].name = 'recipient-mutated.pdf';
  first.files[0].base64 = 'Y2hhbmdlZA==';
  assert.deepEqual((await page.bridge.exportMedia({ ...request, ids: ['media-1'] })).files, [expected]);
  assert.equal(calls, 1);
  assert.equal((await page.bridge.exportMedia({ ...request, ids: ['media-2'] })).ok, false);
  assert.equal((await page.bridge.exportMedia({ ...request, requestId: 'another-draft', ids: ['media-1'] })).ok, false);
  page.bridge.cancel({ runId: request.runId });
  assert.match((await page.bridge.exportMedia({ ...request, ids: ['media-1'] })).error, /cancelled/i);
  assert.deepEqual((await page.bridge.exportMedia({ ...request, ids: ['media-1'], allowCancelled: true })).files, [expected]);
  assert.equal(calls, 1);
});

test('a changed native source before its first export is rejected without downloading or seeding a snapshot', async () => {
  const link = downloadableFile('reviewed.pdf', 'sandbox:/mnt/data/reviewed.pdf');
  let calls = 0;
  const page = fixture({ downloadVisible: async () => { calls += 1; throw new Error('Must not download a changed source'); },
    onSend({ text, addUser, addAssistant }) { addUser(text); addMediaToTurn(addAssistant('PDF output'), [link]); } });
  const request = { runId: 'first-identity', requestId: 'draft', text: 'Create a PDF', relayMedia: true };
  await page.bridge.sendPrompt(request);
  await waitFor(() => page.messages.find((item) => item.type === 'REPLY'));
  link.href = 'sandbox:/mnt/data/different.pdf';
  assert.match((await page.bridge.exportMedia({ ...request, ids: ['media-1'] })).error, /changed before export/);
  link.isConnected = false;
  assert.equal((await page.bridge.exportMedia({ ...request, ids: ['media-1'] })).ok, false);
  assert.equal(calls, 0);
});

test('native post-click snapshots require both the exact source callback and the isolated download acknowledgement', async () => {
  for (const [checksSource, acknowledgesClick, expected] of [[true, true, true], [false, true, false], [true, false, false]]) {
    const link = downloadableFile('reviewed.pdf', 'sandbox:/mnt/data/reviewed.pdf');
    const bytes = Buffer.from('%PDF exact source bytes').toString('base64');
    let calls = 0;
    const page = fixture({ downloadVisible: async (request) => {
      calls += 1;
      if (checksSource) assert.equal(request.isCurrent(), true);
      // React replaces the consumed control after the verified action. Neither
      // this old node nor a new DOM lookup can authorize a different download.
      link.isConnected = false;
      return { ok: true, mimeType: request.mimeType, base64: bytes, sourceVerifiedAtClick: acknowledgesClick };
    }, onSend({ text, addUser, addAssistant }) { addUser(text); addMediaToTurn(addAssistant('PDF output'), [link]); } });
    const request = { runId: `click-capture-${checksSource}-${acknowledgesClick}`, requestId: 'draft', text: 'Create a PDF', relayMedia: true };
    await page.bridge.sendPrompt(request);
    await waitFor(() => page.messages.find((item) => item.type === 'REPLY'));
    const result = await page.bridge.exportMedia({ ...request, ids: ['media-1'] });
    assert.equal(result.ok, expected, result.error);
    assert.equal(calls, 1);
    if (expected) {
      assert.equal(result.files[0].base64, bytes);
      assert.deepEqual((await page.bridge.exportMedia({ ...request, ids: ['media-1'] })).files, result.files);
      assert.equal(calls, 1);
    } else assert.match(result.error, /source media changed/);
  }
});

test('the native source callback rejects identity changes during download authorization', async () => {
  for (const mutate of [
    (link) => { link.isConnected = false; },
    (link) => { link.disabled = true; },
    (link) => { link.attributes['aria-disabled'] = 'true'; },
    (link) => { link.href = 'sandbox:/mnt/data/replaced.pdf'; },
  ]) {
    const link = downloadableFile('reviewed.pdf', 'sandbox:/mnt/data/reviewed.pdf');
    const page = fixture({ downloadVisible: async (request) => {
      assert.equal(request.isCurrent(), true);
      await Promise.resolve();
      mutate(link);
      assert.equal(request.isCurrent(), false);
      return { ok: false, error: 'Captured source changed before the native click' };
    }, onSend({ text, addUser, addAssistant }) { addUser(text); addMediaToTurn(addAssistant('PDF output'), [link]); } });
    const request = { runId: 'authorization-source-change', requestId: 'draft', text: 'Create a PDF', relayMedia: true };
    await page.bridge.sendPrompt(request);
    await waitFor(() => page.messages.find((item) => item.type === 'REPLY'));
    assert.match((await page.bridge.exportMedia({ ...request, ids: ['media-1'] })).error, /changed before the native click/);
  }
});

test('canceling a multi-file export publishes no partial snapshots', async () => {
  const links = [downloadableFile('first.pdf', 'sandbox:/mnt/data/first.pdf'), downloadableFile('second.pdf', 'sandbox:/mnt/data/second.pdf')];
  let calls = 0;
  let secondStarted = false;
  const page = fixture({ downloadVisible: async (request) => {
    calls += 1;
    if (request.name === 'second.pdf') { secondStarted = true; return new Promise(() => {}); }
    return { ok: true, mimeType: 'application/pdf', base64: Buffer.from('%PDF first').toString('base64') };
  }, onSend({ text, addUser, addAssistant }) { addUser(text); addMediaToTurn(addAssistant('Two PDF files'), links); } });
  const request = { runId: 'partial-snapshot-stop', requestId: 'draft', text: 'Create two files', relayMedia: true };
  await page.bridge.sendPrompt(request);
  await waitFor(() => page.messages.find((item) => item.type === 'REPLY'));
  const pending = page.bridge.exportMedia({ ...request, ids: ['media-1', 'media-2'] });
  await waitFor(() => secondStarted);
  page.bridge.cancel({ runId: request.runId });
  assert.match((await pending).error, /cancelled/i);
  assert.equal(calls, 2);
  links[0].isConnected = false;
  assert.equal((await page.bridge.exportMedia({ ...request, ids: ['media-1'], allowCancelled: true })).ok, false,
    'The verified first file of a canceled batch must not become a cached completed export.');
  assert.equal(calls, 2);
});

test('snapshot storage evicts the oldest export beyond 24 MB without refreshing its age on review', async () => {
  const links = new Map();
  const requests = [];
  let calls = 0;
  const bytes = Buffer.alloc(8 * 1024 * 1024, 80);
  const page = fixture({ downloadVisible: async (request) => {
    calls += 1;
    return { ok: true, mimeType: request.mimeType, base64: bytes.toString('base64') };
  }, onSend({ text, addUser, addAssistant }) {
    addUser(text);
    const link = downloadableFile(text, `sandbox:/mnt/data/${text}`);
    links.set(text, link);
    addMediaToTurn(addAssistant('Generated PDF'), [link]);
  } });
  for (let index = 1; index <= 4; index += 1) {
    const request = { runId: 'snapshot-cap', requestId: `draft-${index}`, text: `candidate-${index}.pdf`, relayMedia: true };
    requests.push(request);
    assert.equal((await page.bridge.sendPrompt(request)).ok, true);
    await waitFor(() => page.messages.find((item) => item.type === 'REPLY' && item.requestId === request.requestId));
    assert.equal((await page.bridge.exportMedia({ ...request, ids: ['media-1'] })).ok, true);
    if (index === 3) {
      links.get(requests[0].text).isConnected = false;
      assert.equal((await page.bridge.exportMedia({ ...requests[0], ids: ['media-1'] })).ok, true,
        'Exactly 24 MB fits, and reviewing an older snapshot must not refresh FIFO order.');
    }
  }
  assert.equal(calls, 4);
  assert.equal((await page.bridge.exportMedia({ ...requests[0], ids: ['media-1'] })).ok, false,
    'Adding the fourth 8 MB export must evict the first snapshot.');
  for (const request of requests.slice(1)) {
    links.get(request.text).isConnected = false;
    const cached = await page.bridge.exportMedia({ ...request, ids: ['media-1'] });
    assert.equal(cached.ok, true, cached.error);
    assert.equal(Buffer.from(cached.files[0].base64, 'base64').length, bytes.length);
  }
  assert.equal(calls, 4);
});

test('an accepted new run clears snapshots from the prior run', async () => {
  const links = [];
  let calls = 0;
  const page = fixture({ downloadVisible: async (request) => {
    calls += 1;
    return { ok: true, mimeType: request.mimeType, base64: Buffer.from('%PDF candidate').toString('base64') };
  }, onSend({ text, addUser, addAssistant }) {
    addUser(text);
    const link = downloadableFile('reviewed.pdf', 'sandbox:/mnt/data/reviewed.pdf');
    links.push(link); addMediaToTurn(addAssistant('PDF output'), [link]);
  } });
  const old = { runId: 'old-snapshot-run', requestId: 'draft', text: 'Create one PDF', relayMedia: true };
  await page.bridge.sendPrompt(old);
  await waitFor(() => page.messages.find((item) => item.type === 'REPLY' && item.runId === old.runId));
  assert.equal((await page.bridge.exportMedia({ ...old, ids: ['media-1'] })).ok, true);
  links[0].isConnected = false;
  const fresh = { ...old, runId: 'new-snapshot-run' };
  assert.equal((await page.bridge.sendPrompt(fresh)).ok, true);
  await waitFor(() => page.messages.find((item) => item.type === 'REPLY' && item.runId === fresh.runId));
  assert.equal((await page.bridge.exportMedia({ ...old, ids: ['media-1'] })).ok, false);
  assert.equal((await page.bridge.exportMedia({ ...fresh, ids: ['media-1'] })).ok, true);
  assert.equal(calls, 2);
});

test('more than five generated images fails instead of silently dropping output', async () => {
  const page = fixture({ onSend({ text, addUser, addAssistant }) { addUser(text); addMediaToTurn(addAssistant(''), Array.from({ length: 6 }, (_, index) => generatedImage(`https://chatgpt.com/${index}.png`))); } });
  await page.bridge.sendPrompt({ runId: 'too-many', requestId: 'request', text: 'Create six', relayMedia: true });
  assert.match((await waitFor(() => page.messages.find((message) => message.type === 'ERROR'))).error, /more than five/);
});

test('navigation to an old unrelated conversation cannot satisfy submission by turn count', async () => {
  let page;
  page = fixture({ onSend({ state, addUser, addAssistant }) {
    page.window.location.href = 'https://chatgpt.com/c/old-conversation';
    addUser('Unrelated old question'); addAssistant('Old answer'); state.generating = true;
  } });
  const result = await page.bridge.sendPrompt({ runId: 'navigation-run', requestId: 'request', text: 'New unique question' });
  assert.equal(result.ok, false);
  assert.match(result.error, /different user message/);
  assert.equal(page.state.stopClicks, 0);
  assert.equal(page.messages.some((message) => message.type === 'REPLY'), false);
});
