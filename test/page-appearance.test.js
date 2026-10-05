'use strict';

// Exercise the real isolated page preload in Chromium. Cosmetic transparency
// must leave the native editor, attachment input, code, and hit targets intact.
if (!process.versions.electron) {
  const test = require('node:test');
  const assert = require('node:assert/strict');
  const { spawn } = require('node:child_process');
  test('embedded galaxy remains still, readable, origin scoped and non-interactive', { timeout: 30000 }, async () => {
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const output = await new Promise((resolve, reject) => {
      const child = spawn(require('electron'), [__filename], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let log = '';
      child.stdout.on('data', data => { log += data; }); child.stderr.on('data', data => { log += data; });
      const timer = setTimeout(() => { child.kill(); reject(new Error(`Page appearance test timed out.\n${log}`)); }, 25000);
      child.on('error', error => { clearTimeout(timer); reject(error); });
      child.on('close', code => { clearTimeout(timer); resolve({ code, log }); });
    });
    assert.equal(output.code, 0, output.log);
    assert.match(output.log, /PASS: embedded galaxy cosmetic isolation and input regressions/);
  });
} else {
  const assert = require('node:assert/strict');
  const path = require('node:path');
  const fs = require('node:fs/promises');
  const http = require('node:http');
  const { app, BrowserWindow, ipcMain } = require('electron');
  app.setPath('userData', path.join(app.getPath('temp'), `converge-page-appearance-qa-${process.pid}`));
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;width:100%;height:100%;background:#0e0e0e;color:#f5f5f5;font-family:Arial}
    #root,main,.scroll-layout{height:100%;width:100%;background:#0e0e0e}
    article{height:180px;padding:16px;box-sizing:border-box}
    pre{background:#202020;padding:12px}
    form{position:fixed;left:10px;right:10px;bottom:10px;height:90px;padding:10px;box-sizing:border-box}
    #prompt-textarea{width:calc(100% - 90px);height:54px;display:inline-block;vertical-align:middle}
    #send{width:60px;height:36px}#file{position:absolute;left:10px;top:0}
  </style></head><body><div id="root"><main><div class="scroll-layout">
    <article data-testid="conversation-turn-1"><div data-message-author-role="assistant">
    A readable answer.<pre><code>const verified = true;</code></pre><a id="download" href="/file.txt" download="answer.txt">Download answer</a>
    </div></article>
    <form onsubmit="event.preventDefault();window.clicked=(window.clicked||0)+1">
    <input id="file" type="file" multiple><div id="prompt-textarea" contenteditable="true" role="textbox"></div><button id="send" type="submit">Send</button>
    </form></div></main></div>
    <script>window.originalText=document.querySelector('article').textContent;window.clicked=0;</script>
  </body></html>`;
  async function run() {
    const server = http.createServer((_request, response) => { response.setHeader('Content-Type', 'text/html;charset=utf-8'); response.end(html); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    ipcMain.handle('converge:page-event', () => ({ ok: true }));
    const win = new BrowserWindow({ show: false, width: 680, height: 620,
      webPreferences: { offscreen: true, preload: path.join(__dirname, '..', 'src/browser/page-preload.js'),
        sandbox: true, contextIsolation: true, nodeIntegration: false,
        additionalArguments: [`--converge-qa-origin=${origin}`] } });
    const evaluate = code => win.webContents.executeJavaScript(code);
    const isolated = code => win.webContents.executeJavaScriptInIsolatedWorld(999, [{ code }]);
    const settle = ms => new Promise(resolve => setTimeout(resolve, ms));
    try {
      // This fixture checks both motion policies explicitly; do not inherit
      // the hosted OS accessibility preference for its normal-motion phase.
      win.webContents.debugger.attach('1.3');
      await win.loadURL(origin);
      await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
      await settle(250);
      assert.equal(await evaluate("matchMedia('(prefers-reduced-motion: reduce)').matches"), false);
      assert.equal(await evaluate("document.querySelectorAll('#converge-page-galaxy').length"), 1);
      assert.equal(await evaluate("document.querySelector('#converge-page-galaxy').getAttribute('aria-hidden')"), 'true');
      assert.equal(await evaluate("getComputedStyle(document.querySelector('#converge-page-galaxy')).pointerEvents"), 'none');
      assert.equal(await evaluate("getComputedStyle(document.querySelector('#converge-page-galaxy')).zIndex"), '-1');
      assert.equal(await evaluate("getComputedStyle(document.querySelector('main')).backgroundColor"), 'rgba(0, 0, 0, 0)');
      assert.equal(await evaluate("getComputedStyle(document.querySelector('.scroll-layout')).backgroundColor"), 'rgba(0, 0, 0, 0)');
      assert.equal(await evaluate("document.querySelector('article').textContent===window.originalText"), true);
      assert.equal(await evaluate("getComputedStyle(document.querySelector('pre')).backgroundColor"), 'rgba(6, 9, 22, 0.95)');
      assert.equal(await evaluate("document.querySelector('#prompt-textarea').isContentEditable"), true);
      assert.equal(await evaluate("document.querySelector('#file').type"), 'file');
      assert.equal(await evaluate("document.querySelector('#file').multiple"), true);
      const hit = await evaluate("(()=>{const r=document.querySelector('#send').getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2).id})()");
      assert.equal(hit, 'send', 'Decoration intercepted the native send hit target');
      await evaluate("document.querySelector('#prompt-textarea').focus();document.execCommand('insertText',false,'Native editor still works');document.querySelector('#send').click()");
      assert.equal(await evaluate('window.clicked'), 1);
      assert.equal(await evaluate("document.querySelector('#prompt-textarea').textContent"), 'Native editor still works');
      assert.equal(await evaluate("document.querySelector('#download').getAttribute('download')"), 'answer.txt');

      let state = await isolated('globalThis.ConvergePageAppearance.create().diagnostics()');
      assert.equal(state.supported, true);
      assert.equal(state.animated, false);
      assert.equal(state.paused, true);
      const firstFrame = state.frames;
      await settle(650);
      state = await isolated('globalThis.ConvergePageAppearance.create().diagnostics()');
      assert.equal(state.frames, firstFrame, 'The chat backdrop wastes work animating beneath conversation content');
      if (process.env.CONVERGE_PAGE_GALAXY_CAPTURE === '1') {
        await fs.writeFile(path.join(__dirname, '..', '.design', 'embedded-chat-galaxy.png'), (await win.webContents.capturePage()).toPNG());
      }
      win.webContents.send('converge:page-effects', { paused: true }); await settle(80);
      assert.equal((await isolated('globalThis.ConvergePageAppearance.create().diagnostics()')).effectsSuppressed, true);
      const pausedFrames = (await isolated('globalThis.ConvergePageAppearance.create().diagnostics()')).frames;
      await settle(220);
      assert.equal((await isolated('globalThis.ConvergePageAppearance.create().diagnostics()')).frames, pausedFrames);
      // Appearance changes stay cosmetic on the actual embedded page, including
      // file/editor controls. A renderer cannot turn arbitrary values into CSS.
      const themeSurfaces = {};
      for (const theme of ['horror', 'alien', 'cyberpunk', 'anime', 'night']) {
        win.webContents.send('converge:page-appearance', { chatTheme: theme }); await settle(70);
        assert.equal(await evaluate("document.documentElement.getAttribute('data-converge-chat-theme')"), theme);
        assert.equal((await isolated('globalThis.ConvergePageAppearance.create().diagnostics()')).chatTheme, theme);
        assert.equal(await evaluate("document.querySelector('article').textContent===window.originalText"), true);
        assert.equal(await evaluate("document.querySelector('#prompt-textarea').textContent"), 'Native editor still works');
        assert.equal((await isolated('globalThis.ConvergePageAppearance.create().diagnostics()')).frames, pausedFrames);
        assert.equal(await evaluate("getComputedStyle(document.querySelector('#converge-page-galaxy canvas')).visibility"), theme === 'night' ? 'visible' : 'hidden');
        themeSurfaces[theme] = await evaluate("getComputedStyle(document.querySelector('#converge-page-galaxy')).backgroundImage");
        assert.equal(await evaluate("(()=>{const r=document.querySelector('#send').getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2).id})()"), 'send');
        assert.equal(await evaluate("getComputedStyle(document.querySelector('pre')).backgroundColor"), 'rgba(6, 9, 22, 0.95)');
        assert.equal(await evaluate("getComputedStyle(document.querySelector('#download')).color"), 'rgb(185, 233, 252)', 'An unstyled download link is unreadable on the dark chat theme');
        if (['cyberpunk', 'anime'].includes(theme)) {
          assert.match(themeSurfaces[theme], /data:image\/svg\+xml/, 'The selected vector scene is missing from the actual page');
          assert.equal(await evaluate("getComputedStyle(document.querySelector('article')).backgroundColor"), theme === 'cyberpunk' ? 'rgba(4, 12, 27, 0.79)' : 'rgba(17, 22, 43, 0.79)');
          assert.equal(await evaluate("getComputedStyle(document.querySelector('#converge-page-galaxy')).animationName"), 'none');
          if (process.env.CONVERGE_PAGE_GALAXY_CAPTURE === '1') {
            await fs.mkdir(path.join(__dirname, '..', '.design'), { recursive: true });
            await settle(150);
            await fs.writeFile(path.join(__dirname, '..', '.design', `embedded-chat-${theme}.png`), (await win.webContents.capturePage()).toPNG());
          }
        }
      }
      assert.equal(new Set(Object.values(themeSurfaces)).size, 5, 'Two selected themes render the same actual chat surface');
      win.webContents.send('converge:page-appearance', { chatTheme: 'url(https://untrusted.invalid)' }); await settle(60);
      assert.equal(await evaluate("document.documentElement.getAttribute('data-converge-chat-theme')"), 'night');
      win.webContents.send('converge:page-effects', { paused: false }); await settle(180);
      assert.equal((await isolated('globalThis.ConvergePageAppearance.create().diagnostics()')).effectsSuppressed, false);
      assert.equal((await isolated('globalThis.ConvergePageAppearance.create().diagnostics()')).frames, pausedFrames);
      await isolated("Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'))");
      assert.equal((await isolated('globalThis.ConvergePageAppearance.create().diagnostics()')).effectsSuppressed, true);
      await isolated("Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});document.dispatchEvent(new Event('visibilitychange'))");
      assert.equal((await isolated('globalThis.ConvergePageAppearance.create().diagnostics()')).effectsSuppressed, false);
      await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
      await settle(60);
      assert.equal((await isolated('globalThis.ConvergePageAppearance.create().diagnostics()')).effectsSuppressed, true);
      win.webContents.debugger.detach();
      await isolated('globalThis.ConvergePageAppearance.create().dispose()');
      assert.equal(await evaluate("document.querySelector('#converge-page-galaxy')"), null);
      assert.equal(await evaluate("document.querySelectorAll('[data-converge-galaxy-layout]').length"), 0);
      assert.equal(await evaluate("getComputedStyle(document.querySelector('main')).backgroundColor"), 'rgb(14, 14, 14)');
      // A second localhost name is the same test server, but a different exact
      // origin. The preload must leave it completely undecorated.
      await win.loadURL(`http://localhost:${server.address().port}`);
      await settle(150);
      assert.equal(await evaluate("document.querySelector('#converge-page-galaxy')"), null);
      assert.equal(await evaluate("document.documentElement.classList.contains('converge-galaxy-page')"), false);
      process.stdout.write('PASS: embedded galaxy cosmetic isolation and input regressions\n');
    } finally {
      win.destroy(); server.close(); ipcMain.removeHandler('converge:page-event');
    }
  }
  app.whenReady().then(run).then(() => app.exit(0)).catch(error => { process.stderr.write(error.stack + '\n'); app.exit(1); });
}
