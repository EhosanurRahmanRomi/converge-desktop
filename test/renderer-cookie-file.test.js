'use strict';

// Real Chromium File objects drive the production selection handler. Only
// synthetic cookies are used; the localhost host validates with parseCookies.
if (!process.versions.electron) {
  const test = require('node:test'), assert = require('node:assert/strict');
  const { spawn } = require('node:child_process');
  test('direct cookie JSON import clears sensitive inputs, handles failures and keeps custom window controls usable', { timeout: 30000 }, async () => {
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const result = await new Promise((resolve, reject) => {
      const child = spawn(require('electron'), [__filename], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let output = '';
      child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { output += data; });
      const timeout = setTimeout(() => { child.kill(); reject(Error(`Cookie file UI test timed out.\n${output}`)); }, 26000);
      child.on('error', error => { clearTimeout(timeout); reject(error); });
      child.on('close', code => { clearTimeout(timeout); resolve({ code, output }); });
    });
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /PASS: direct cookie file import and frameless shell controls/);
  });
} else {
  const assert = require('node:assert/strict'), fs = require('node:fs/promises');
  const path = require('node:path'), http = require('node:http'), os = require('node:os');
  const { app, BrowserWindow, ipcMain } = require('electron');
  const { parseCookies } = require('../src/browser/cookies');
  const root = path.join(__dirname, '..');
  const sentinel = 'COOKIE_QA_SYNTHETIC_SECRET';
  const valid = JSON.stringify([{ domain: '.chatgpt.com', path: '/', secure: true, name: 'fixture_only', value: sentinel }]);
  app.setPath('userData', path.join(app.getPath('temp'), `converge-cookie-file-ui-${process.pid}`));
  const fixtureJs = `
    window.fixture={imports:0,successful:0,clears:0,fileReads:0,holdRead:false,failRead:false,releaseRead:null,windowCalls:[],windowListener:null,stateListener:null,state:{status:'idle',tabIds:{left:null,right:null},pages:{},transcript:[],issues:[]}};
    const originalFileText=File.prototype.text;
    File.prototype.text=function(){fixture.fileReads++;if(fixture.failRead){fixture.failRead=false;return Promise.reject(Error('Cannot read C:\\\\private\\\\COOKIE_QA_SYNTHETIC_SECRET.json'))}if(fixture.holdRead){fixture.holdRead=false;return new Promise(resolve=>{fixture.releaseRead=()=>originalFileText.call(this).then(resolve)})}return originalFileText.call(this)};
    window.convergeBrowser={
      bootstrap:async()=>({hasSession:false,version:'cookie-file-fixture',windowState:{maximized:false,minimized:false},state:fixture.state}),setBounds:async()=>({ok:true}),
      importCookies:async text=>{fixture.imports++;const result=await window.fixtureImport(text);if(result.ok)fixture.successful++;return result},
      clearSession:async()=>{fixture.clears++;return{ok:true,hasSession:false,state:fixture.state}},
      windowAction:async action=>{fixture.windowCalls.push(action);const state={maximized:action==='toggle-maximize'?!document.body.classList.contains('window-maximized'):document.body.classList.contains('window-maximized'),minimized:action==='minimize'};fixture.windowListener?.(state);return{ok:true,windowState:state}},
      onWindowState:fn=>{fixture.windowListener=fn},onState:fn=>{fixture.stateListener=fn},onPage:()=>{},expand:async()=>({ok:true}),setEffectsPaused:async()=>({ok:true})
    };`;
  async function run() {
    let win, server, preloadDir, hostHasSession = false, hostImports = 0, hostAccepted = 0;
    const channel = 'cookie-file-fixture-' + process.pid;
    const consoleMessages = [];
    try {
      const files = Object.fromEntries(await Promise.all(['browser.html', 'browser-app.js', 'browser.css', 'galaxy-scene.js', 'galaxy-scene.css', 'star-ribbons.js', 'ghost-v2.png', 'flower-blossom-v1.png', 'studio-ui.js', 'studio-ui.css', 'assets/fonts/Manrope-Variable.ttf'].map(async name => [name, await fs.readFile(path.join(root, 'renderer', name))])));
      const html = files['browser.html'].toString('utf8').replace('<script defer src="browser-app.js"></script>', '<script src="api-fixture.js"></script><script defer src="browser-app.js"></script>');
      server = http.createServer((req, res) => {
        if (req.url === '/api-fixture.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(fixtureJs); return; }
        const name = req.url.slice(1), content = files[name];
        if (content && name !== 'browser.html') { res.setHeader('Content-Type', name.endsWith('.png') ? 'image/png' : name.endsWith('.css') ? 'text/css' : name.endsWith('.ttf') ? 'font/ttf' : 'text/javascript'); res.end(content); return; }
        res.setHeader('Content-Type', 'text/html;charset=utf-8'); res.end(html);
      });
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      preloadDir = await fs.mkdtemp(path.join(os.tmpdir(), 'converge-cookie-file-bridge-'));
      const preload = path.join(preloadDir, 'preload.js');
      await fs.writeFile(preload, `globalThis.fixtureImport=text=>require('electron').ipcRenderer.invoke(${JSON.stringify(channel)},text);`);
      ipcMain.handle(channel, (event, text) => {
        assert.equal(event.sender, win.webContents); assert.equal(event.senderFrame, win.webContents.mainFrame);
        hostImports++;
        try { const cookies = parseCookies(text); hostHasSession = true; hostAccepted++; return { ok: true, count: cookies.length, hasSession: true, state: { status: 'idle', tabIds: { left: null, right: null }, pages: {}, transcript: [], issues: [] } }; }
        catch (error) { return { ok: false, error: error.message }; }
      });
      win = new BrowserWindow({ show: false, frame: false, width: 1366, height: 768, webPreferences: { preload, offscreen: true, contextIsolation: false, nodeIntegration: false } });
      win.webContents.on('console-message', details => { consoleMessages.push(details.message || ''); });
      const evaluate = code => win.webContents.executeJavaScript(code);
      const waitFor = condition => evaluate(`new Promise((resolve,reject)=>{const began=performance.now();const check=()=>{if(${condition})return resolve();if(performance.now()-began>3000)return reject(Error('Cookie UI condition did not settle'));setTimeout(check,20)};check()})`);
      const settled = () => evaluate('new Promise(resolve=>requestAnimationFrame(()=>setTimeout(resolve,35)))');
      const fieldsCleared = async () => {
        assert.equal(await evaluate("document.getElementById('cookieInput').value"), '');
        assert.equal(await evaluate("document.getElementById('cookieFile').value"), '');
        assert.equal(await evaluate("document.getElementById('cookieFile').files.length"), 0);
        assert.equal(await evaluate(`document.body.textContent.includes(${JSON.stringify(sentinel)})`), false);
        assert.equal(await evaluate(`Object.keys(localStorage).some(key=>String(localStorage.getItem(key)).includes(${JSON.stringify(sentinel)}))`), false);
      };
      const select = async (content, filename = 'session.json') => {
        await evaluate(`(()=>{document.getElementById('sessionDetails').open=true;const input=document.getElementById('cookieFile');const transfer=new DataTransfer();transfer.items.add(new File([${JSON.stringify(content)}],${JSON.stringify(filename)},{type:'application/json'}));input.files=transfer.files;document.getElementById('cookieInput').value=${JSON.stringify(sentinel)};input.dispatchEvent(new Event('change',{bubbles:true}))})()`);
      };
      const done = () => waitFor("!document.getElementById('chooseCookies').disabled");
      await win.loadURL(`http://127.0.0.1:${server.address().port}/`);
      await waitFor("document.getElementById('version').textContent==='vcookie-file-fixture'");
      await evaluate("document.getElementById('animationEnabled').click()");

      // The primary visible upload button opens the actual HTML file input.
      assert.equal(await evaluate("document.getElementById('chooseCookies').hidden"), false);
      await evaluate("(()=>{const input=document.getElementById('cookieFile');const original=input.click;input.click=()=>{fixture.chooserRequested=true};document.getElementById('chooseCookies').click();input.click=original})()");
      assert.equal(await evaluate('fixture.chooserRequested'), true);
      await select(valid, '<img src=x>.json'); await done();
      assert.equal(hostAccepted, 1); assert.equal(hostImports, 1);
      assert.match(await evaluate("document.getElementById('cookieFileStatus').textContent"), /Imported: <img src=x>\.json/);
      assert.equal(await evaluate("document.getElementById('cookieFileStatus').querySelectorAll('img').length"), 0);
      assert.equal(await evaluate("document.getElementById('openPages').disabled"), false);
      await fieldsCleared();

      // Supported export-object shape, UTF-8 BOM and safe filename truncation.
      await select('\ufeff' + JSON.stringify({ cookies: JSON.parse(valid) }), 'C:\\private\\session\u202e\u0001' + 'x'.repeat(200) + '.json'); await done();
      assert.equal(hostAccepted, 2);
      const status = await evaluate("document.getElementById('cookieFileStatus').textContent");
      assert.ok(status.length <= 190); assert.doesNotMatch(status, /private|[\\\u0000-\u001f\u202a-\u202e]/);
      await fieldsCleared();

      const failed = async (content, filename) => { await select(content, filename); await done(); assert.equal(await evaluate("document.getElementById('sessionError').hidden"), false); await fieldsCleared(); };
      const beforeInvalid = hostImports;
      await failed('{broken COOKIE_QA_SYNTHETIC_SECRET', 'broken.json');
      await failed(valid, 'session.txt');
      await failed('{}', 'not-an-export.json');
      await failed('[]', 'empty.json');
      assert.equal(hostImports, beforeInvalid, 'Invalid JSON/file shapes reached host session replacement');
      const beforeOversizeReads = await evaluate('fixture.fileReads');
      await failed('x'.repeat(1024 * 1024 + 1), 'too-large.json');
      assert.equal(await evaluate('fixture.fileReads'), beforeOversizeReads, 'Oversized file was read before rejection');
      assert.equal(hostImports, beforeInvalid);

      await failed(JSON.stringify([{ domain: 'chatgpt.com.attacker.test', name: 'sid', value: sentinel }]), 'wrong-domain.json');
      assert.equal(hostImports, beforeInvalid + 1); assert.equal(hostAccepted, 2);
      assert.equal(hostHasSession, true, 'An invalid-domain export replaced the previously accepted session');
      assert.equal(await evaluate("document.getElementById('openPages').disabled"), false);
      await evaluate('fixture.failRead=true');
      await failed(valid, 'unreadable.json');
      assert.doesNotMatch(await evaluate("document.getElementById('sessionError').textContent"), /private|COOKIE_QA_SYNTHETIC_SECRET/);

      // Hold a real File.text read, so a second session operation cannot race.
      await evaluate('fixture.holdRead=true'); await select(valid, 'held.json');
      await waitFor('typeof fixture.releaseRead===\'function\'');
      assert.equal(await evaluate("document.getElementById('chooseCookies').disabled"), true);
      assert.equal(await evaluate("document.getElementById('importCookies').disabled"), true);
      assert.equal(await evaluate("document.getElementById('clearSession').disabled"), true);
      const beforeHeldImports = hostImports;
      await evaluate("document.getElementById('clearSession').click();document.getElementById('importCookies').click()");
      assert.equal(await evaluate('fixture.clears'), 0); assert.equal(hostImports, beforeHeldImports);
      await evaluate('fixture.releaseRead()'); await done(); assert.equal(hostAccepted, 3); await fieldsCleared();

      // Cancel selection is a no-op and pasted JSON remains supported.
      const beforeCancel = hostImports;
      await evaluate("document.getElementById('cookieFile').dispatchEvent(new Event('change',{bubbles:true}))"); await settled();
      assert.equal(hostImports, beforeCancel);
      await evaluate(`document.getElementById('cookieInput').value=${JSON.stringify(valid)};document.getElementById('cookieInput').dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('importCookies').click()`);
      await done(); assert.equal(hostAccepted, 4); await fieldsCleared();

      // Native controls stay usable during work and reflect external state.
      await evaluate("fixture.state={...fixture.state,status:'running'};fixture.stateListener(fixture.state)"); await settled();
      assert.equal(await evaluate("document.getElementById('chooseCookies').disabled"), true);
      for (const id of ['windowMinimize', 'windowMaximize', 'windowClose']) {
        assert.equal(await evaluate(`document.getElementById(${JSON.stringify(id)}).disabled`), false);
        assert.equal(await evaluate(`getComputedStyle(document.getElementById(${JSON.stringify(id)})).getPropertyValue('-webkit-app-region')`), 'no-drag');
      }
      assert.equal(await evaluate("document.getElementById('windowMaximize').getAttribute('aria-label')"), 'Maximize window');
      await evaluate("document.getElementById('windowMaximize').click()"); await settled();
      assert.equal(await evaluate("document.getElementById('windowMaximize').getAttribute('aria-label')"), 'Restore window');
      await evaluate('fixture.windowListener({maximized:false,minimized:false})'); await settled();
      assert.equal(await evaluate("document.getElementById('windowMaximize').getAttribute('aria-label')"), 'Maximize window');
      await evaluate("document.getElementById('windowMinimize').click();document.getElementById('windowClose').click()"); await settled();
      assert.deepEqual(await evaluate('fixture.windowCalls'), ['toggle-maximize', 'minimize', 'close']);
      assert.equal(consoleMessages.some(message => /COOKIE_QA_SYNTHETIC_SECRET|private/.test(message)), false, 'Sensitive cookie input or private path reached browser logs');
      assert.equal(consoleMessages.some(message => /Uncaught|Unhandled/i.test(message)), false, 'Renderer logged an unhandled exception');
      process.stdout.write('PASS: direct cookie file import and frameless shell controls: JSON array/object/BOM, native domain validation, size/type/shape/read failures, busy/cancel safety, cleared file and pasted inputs, safe filename text and no secrets in UI/storage/logs; owner window controls remain usable while busy and reflect external maximize state.\n');
    } finally {
      if (win && !win.isDestroyed()) win.destroy(); ipcMain.removeHandler(channel);
      if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
      if (preloadDir) { await fs.unlink(path.join(preloadDir, 'preload.js')); await fs.rmdir(preloadDir); }
    }
  }
  app.whenReady().then(run).then(() => app.exit(0)).catch(error => { process.stderr.write(error.stack + '\n'); app.exit(1); });
}
