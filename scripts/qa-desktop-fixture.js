'use strict';

const http = require('node:http');

// Inert source bytes only: these fixtures contain no trading call and are never
// compiled or executed. The test checks transport identity, not EA performance.
function makeEaSource(corrected = false) {
  return Buffer.from(`#property strict\n// OFFLINE QA ONLY. No order or trading operations.\ninput double FixedLots = 0.01;\ninput double MaxLossUsd = ${corrected ? '20.0' : '100.0'};\nint OnInit() { return INIT_SUCCEEDED; }\nvoid OnTick() { /* inert fixture */ }\n`);
}

function makePdf(text) {
  const escaped = String(text).replace(/([\\()])/g, '\\$1');
  const stream = `BT /F1 12 Tf 50 750 Td (${escaped}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let output = '%PDF-1.4\n'; const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(output)); output += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(output);
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(output);
}

function fixtureHtml(side, mode) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;padding:18px;font:14px "Segoe UI",sans-serif;background:#101923;color:#ecf4f7}
  .qa{padding:8px;border:1px solid #627589;border-radius:6px;color:#ffce88;font-size:12px}
  header{display:flex;gap:16px;align-items:center}h1,h2{font-size:13px}
  #turns{padding-bottom:180px}#turns>[data-message-author-role]{padding:14px 0;border-bottom:1px solid #35495e;white-space:pre-wrap;overflow-wrap:anywhere}
  #turns [data-message-author-role="user"]{color:#9baec0;max-height:115px;overflow:auto;font-size:11px}
  #turns img{width:128px;height:128px;border-radius:8px}
  form{position:fixed;bottom:12px;left:12px;right:12px;background:#182839;border:1px solid #536b81;border-radius:12px;padding:12px}
  [contenteditable]{min-height:35px;max-height:90px;overflow:auto;padding:8px;outline:1px solid #6d8193;border-radius:6px}
  input[type=file]{max-width:100%;margin-top:8px;font-size:11px}#previews img{width:64px;height:64px}
  button{padding:8px 18px;background:#91deca;color:#132920;border:0;border-radius:6px;margin-top:8px}
  a{display:block;color:#8adecb}button[hidden]{display:none}
  </style></head><body><div class="qa">OFFLINE QA SIMULATION · Reviewer ${side === 'left' ? 'A' : 'B'} · No ChatGPT account</div>
  <header><button id="temporaryControl" type="button">${mode === 'unknown-privacy' ? 'Reviewer settings' : 'Temporary chat'}</button><span id="currentModeSlot"><button id="currentMode" type="button" aria-checked="true">Personalized</button></span><button id="workControl" type="button" aria-pressed="false">${mode === 'unknown-work' ? 'Workspace settings' : 'Work'}</button></header>
  <main><section id="privacyMain"></section><div id="turns"></div>
  <form><div id="prompt-textarea" class="ProseMirror" role="textbox" data-placeholder="Ask ChatGPT" contenteditable="true"></div>
  <input id="fileInput" type="file" multiple><div id="previews"></div>
  <button type="button" data-testid="send-button" id="send" aria-label="Send prompt" hidden>Send</button>
  <button type="button" data-testid="stop-button" id="stopFixture" aria-label="Stop generating" hidden>Stop</button></form></main>
  <script>(${fixtureBehavior.toString()})(${JSON.stringify(side)},${JSON.stringify(mode)},${JSON.stringify({ initial: makePdf('Initial report: 2 + 2 = 5').toString('base64'), corrected: makePdf('Corrected report: 2 + 2 = 4').toString('base64'), eaInitial: makeEaSource().toString('base64'), eaCorrected: makeEaSource(true).toString('base64') })});</script></body></html>`;
}

function fixtureBehavior(side, mode, pdfPayloads) {
  const editor = document.getElementById('prompt-textarea');
  const send = document.getElementById('send');
  const stop = document.getElementById('stopFixture');
  const picker = document.getElementById('fileInput');
  const previews = document.getElementById('previews');
  window.fixtureSends = [];
  window.fixtureUploads = [];
  window.fixtureStops = 0;
  window.fixtureResponseMode = mode;
  window.fixtureWorkClicks = 0;
  window.fixturePrivacy = { temporary: 0, menu: 0, unpersonalized: 0 };
  const temporaryControl = document.getElementById('temporaryControl');
  const privacyMain = document.getElementById('privacyMain');
  const currentMode = document.getElementById('currentMode');
  const workControl = document.getElementById('workControl');
  workControl.addEventListener('click', () => {
    if (mode === 'unknown-work') return;
    window.fixtureWorkClicks += 1;
    workControl.setAttribute('aria-pressed', 'true');
    temporaryControl.setAttribute('aria-pressed', 'false');
    temporaryControl.textContent = 'Temporary chat';
    privacyMain.replaceChildren();
    const heading = document.createElement('h3'); heading.textContent = 'Work'; privacyMain.append(heading);
  });
  currentMode.addEventListener('click', () => {
    if (!privacyMain.querySelector('h3')) return;
    window.fixturePrivacy.menu += 1;
    const menu = document.createElement('div'); menu.setAttribute('role', 'menu');
    for (const name of ['Personalized', 'Unpersonalized']) {
      const option = document.createElement('button'); option.type = 'button'; option.setAttribute('role', 'menuitem');
      const title = document.createElement('strong'); title.textContent = name;
      const description = document.createElement('span'); description.textContent = name === 'Personalized' ? 'This chat can reference memory, plugins, and custom instructions' : 'This chat will ignore memory, plugins, and custom instructions';
      option.append(title, document.createElement('br'), description);
      option.addEventListener('click', () => {
        if (name === 'Unpersonalized') window.fixturePrivacy.unpersonalized += 1;
        currentMode.textContent = name; currentMode.removeAttribute('aria-checked'); menu.remove();
      });
      menu.append(option);
    }
    privacyMain.append(menu);
  });
  temporaryControl.addEventListener('click', () => {
    if (mode === 'unknown-privacy') return;
    window.fixturePrivacy.temporary += 1;
    if (temporaryControl.textContent === 'Turn off temporary chat') {
      temporaryControl.textContent = 'Temporary chat'; privacyMain.replaceChildren(); return;
    }
    temporaryControl.textContent = 'Turn off temporary chat';
    workControl.setAttribute('aria-pressed', 'false');
    currentMode.removeAttribute('aria-checked');
    // React can show the header's active action before the main-page mode
    // chooser arrives. PREPARE must wait for this second render automatically.
    setTimeout(() => {
      const heading = document.createElement('h3'); heading.textContent = 'Temporary chat';
      privacyMain.append(heading);
    }, 35);
  });
  let responseTimer = null;
  let editorTransactionPending = false;
  editor.addEventListener('input', () => {
    send.hidden = !editor.innerText.trim();
    if (editorTransactionPending) return;
    editorTransactionPending = true;
    // Chromium insertText can emit input per inserted line. A rich editor
    // commits its transaction after insertion; replacing the selection during
    // insertText itself would recursively inflate paragraph spacing.
    queueMicrotask(() => {
      editorTransactionPending = false;
      const text = editor.innerText;
      editor.replaceChildren(...text.split(/\r?\n/).map((line) => {
        const paragraph = document.createElement('p');
        if (line.trim()) paragraph.textContent = line.trim().replace(/ /g, '\u00a0');
        else paragraph.append(document.createElement('br'));
        return paragraph;
      }));
      send.hidden = !editor.innerText.trim();
    });
  });
  picker.addEventListener('change', () => {
    window.fixtureUploads.push(Array.from(picker.files).map((file) => ({ name: file.name, type: file.type, size: file.size })));
    previews.replaceChildren();
    if (window.fixtureResponseMode === 'upload-failure') return;
    for (const file of picker.files) {
      if (file.type.startsWith('image/')) {
        const image = document.createElement('img'); image.alt = 'Attached preview'; image.src = URL.createObjectURL(file); previews.append(image);
      } else { const chip = document.createElement('span'); chip.textContent = file.name; previews.append(chip); }
    }
  });
  stop.addEventListener('click', () => {
    window.fixtureStops += 1;
    clearTimeout(responseTimer); responseTimer = null; stop.hidden = true;
  });
  function picture(color) {
    const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 128;
    const context = canvas.getContext('2d'); context.fillStyle = color; context.fillRect(0, 0, 128, 128);
    const image = document.createElement('img'); image.alt = 'Generated fixture picture'; image.src = canvas.toDataURL('image/png');
    return image;
  }
  function download(color) {
    const link = document.createElement(window.fixtureResponseMode.startsWith('ea') ? 'span' : 'a');
    if (window.fixtureResponseMode.startsWith('ea')) {
      const filename = color === '#339933' ? 'qa-risk-corrected.mq5' : 'qa-risk-initial.mq5';
      // Match the generated inline download captured from the live ChatGPT
      // page: it is a span marked file-reference, not an anchor/download attr.
      link.setAttribute('role', 'button');
      link.setAttribute('aria-label', `Download ${filename}`);
      link.setAttribute('data-file-reference', 'true');
      link.setAttribute('data-markdown-copy-text', filename);
      link.textContent = filename;
      const binary = atob(color === '#339933' ? pdfPayloads.eaCorrected : pdfPayloads.eaInitial);
      const bytes = Uint8Array.from(binary, (value) => value.charCodeAt(0));
      const blobUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
      link.addEventListener('click', (event) => {
        event.preventDefault();
        const downloadLink = document.createElement('a');
        downloadLink.href = blobUrl; downloadLink.download = filename;
        downloadLink.hidden = true; document.body.append(downloadLink);
        downloadLink.click(); downloadLink.remove();
      });
    } else if (window.fixtureResponseMode.startsWith('pdf')) {
      link.download = color === '#339933' ? 'corrected-report.pdf' : 'initial-report.pdf'; link.textContent = link.download;
      const binary = atob(color === '#339933' ? pdfPayloads.corrected : pdfPayloads.initial);
      const bytes = Uint8Array.from(binary, (value) => value.charCodeAt(0));
      const blobUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      if (window.fixtureResponseMode.startsWith('pdf-native')) {
        // The visible sandbox URI cannot be fetched. Its page click resolves a
        // real Chromium download, exercising the isolated host download broker.
        link.href = `sandbox:/mnt/data/${link.download}`;
        link.addEventListener('click', (event) => {
          event.preventDefault();
          const downloadLink = document.createElement('a');
          downloadLink.href = blobUrl; downloadLink.download = link.download;
          downloadLink.hidden = true; document.body.append(downloadLink);
          downloadLink.click(); downloadLink.remove();
        });
      } else link.href = blobUrl;
    } else {
      link.download = 'review-notes.txt'; link.textContent = 'review-notes.txt';
      link.href = window.fixtureResponseMode === 'slow-media' ? '/slow-notes.txt' : URL.createObjectURL(new Blob(['Fixture image evidence: ' + color], { type: 'text/plain' }));
    }
    return link;
  }
  send.addEventListener('click', async () => {
    const text = editor.innerText.trim();
    const promptText = text.replace(/\s+/g, ' ');
    const files = Array.from(picker.files).map((file) => ({ name: file.name, type: file.type, size: file.size }));
    const fileBytes = await Promise.all(Array.from(picker.files).map(async (file) => ({
      name: file.name, base64: btoa(String.fromCharCode(...new Uint8Array(await file.arrayBuffer()))),
    })));
    window.fixtureSends.push({ text, files, fileBytes });
    const user = document.createElement('div'); user.setAttribute('data-message-author-role', 'user'); user.textContent = text;
    document.getElementById('turns').append(user);
    editor.innerText = ''; send.hidden = true; stop.hidden = false; picker.value = ''; previews.replaceChildren();
    responseTimer = setTimeout(() => {
      const assistant = document.createElement('div'); assistant.setAttribute('data-message-author-role', 'assistant');
      let reply; let color;
      if (promptText.includes('Phase: independent draft')) {
        reply = { answer: window.fixtureResponseMode === 'arithmetic' ? '10' : window.fixtureResponseMode.startsWith('ea') ? 'Initial inert EA source attached for file transport review.' : side === 'left' ? 'Initial answer with generated image' : 'Independent right draft', uncertainties: [] };
        if (window.fixtureResponseMode !== 'arithmetic') color = side === 'left' ? '#bb3333' : '#3333bb';
      } else {
        const candidateId = promptText.match(/Current candidate ID: (C\d+)/)?.[1];
        reply = { candidateId, verdict: 'accept', issues: [], revisedAnswer: '', resolvedIssueIds: [], uncertainties: [] };
        if (window.fixtureResponseMode !== 'arithmetic' && window.fixtureResponseMode !== 'ea-missing-backtest' && side === 'right' && candidateId === 'C1') {
          reply.verdict = 'challenge';
          reply.issues = window.fixtureResponseMode.startsWith('ea') ? [{ severity: 'major', problem: 'Source risk input still uses the old maximum', evidence: 'The attached source says MaxLossUsd = 100.0', correction: 'Change the requested source input to MaxLossUsd = 20.0' }] : [{ severity: 'major', problem: 'The initial picture requires correction', evidence: 'The fixture picture is red', correction: 'Use the corrected green picture' }];
          reply.revisedAnswer = window.fixtureResponseMode.startsWith('ea') ? 'Corrected inert EA source with MaxLossUsd = 20.0. No trading execution or profitability test was performed.' : 'Improved answer with corrected generated image'; color = '#339933';
        } else if (side === 'left' && candidateId === 'C2') reply.resolvedIssueIds = ['I1'];
        if (window.fixtureResponseMode === 'ea-missing-backtest') {
          reply.taskEvidence = [{ requirementId: 'mt5-backtest', status: 'unavailable', evidence: 'This offline fixture has no MT5 Strategy Tester, price history, broker, or native report.' }];
        }
      }
      const body = document.createElement('div'); body.className = 'markdown'; body.textContent = window.fixtureResponseMode === 'invalid-reply' ? 'A malformed protocol reply' : JSON.stringify(reply); assistant.append(body);
      if (color && window.fixtureResponseMode !== 'invalid-reply') {
        if (!window.fixtureResponseMode.startsWith('pdf') && !window.fixtureResponseMode.startsWith('ea')) assistant.append(picture(color));
        assistant.append(download(color));
      }
      document.getElementById('turns').append(assistant); stop.hidden = true;
    }, window.fixtureResponseMode === 'slow-reply' ||
      (window.fixtureResponseMode.endsWith('slow-review') && !promptText.includes('Phase: independent draft')) ? 60_000 : 80);
  });
}

async function createFixtureServer() {
  let sequence = 0;
  let mode = 'media';
  const slowResponses = new Set();
  const state = { pageLoads: 0, slowMediaRequests: 0, slowMediaAborts: 0 };
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    if (pathname === '/') {
      state.pageLoads += 1;
      const side = sequence++ % 2 === 0 ? 'left' : 'right';
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(fixtureHtml(side, mode));
    } else if (pathname === '/slow-notes.txt') {
      state.slowMediaRequests += 1;
      response.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
      response.write('A slow fixture download has started.');
      slowResponses.add(response);
      response.on('close', () => { state.slowMediaAborts += 1; slowResponses.delete(response); });
    } else { response.writeHead(404); response.end('Fixture only'); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    state,
    setMode(value) { mode = value; sequence = 0; },
    releaseSlowMedia() { for (const response of slowResponses) response.end('The delayed body has completed.'); },
    async close() {
      for (const response of slowResponses) response.destroy();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

module.exports = { createFixtureServer, makePdf, makeEaSource };
