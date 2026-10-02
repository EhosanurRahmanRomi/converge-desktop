'use strict';

if (!process.versions.electron) {
  const test = require('node:test');
  const assert = require('node:assert/strict');
  const { spawn } = require('node:child_process');
  test('three animation themes switch during review, migrate removed comets and preserve preferences', { timeout: 35000 }, async () => {
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const result = await new Promise((resolve, reject) => {
      const child = spawn(require('electron'), [__filename], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let output = '';
      child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
      const timer = setTimeout(() => { child.kill(); reject(Error('Theme renderer test timed out.\n' + output)); }, 31000);
      child.on('error', error => { clearTimeout(timer); reject(error); });
      child.on('close', code => { clearTimeout(timer); resolve({ code, output }); });
    });
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /PASS: actual themes, comet migration, glowing labels and task independence/);
  });
} else {
  const assert = require('node:assert/strict');
  const fs = require('node:fs');
  const path = require('node:path');
  const http = require('node:http');
  const { app, BrowserWindow } = require('electron');
  app.setPath('userData', fs.mkdtempSync(path.join(app.getPath('temp'), 'converge-themes-qa-')));
  const root = path.join(__dirname, '..');
  const fixtureJs = `
    const ready={ready:true,authenticated:true,busy:false,temporary:false,work:false};
    window.themeFixture={starts:0,state:{status:'running',phase:'review',runId:'same-owned-review',round:2,maxRounds:4,question:'Fix the supplied file',chatMode:'normal',tabIds:{left:10,right:11},pages:{left:{...ready},right:{...ready}},attachments:{status:'none',names:[]},transcript:[],issues:[]}};
    window.convergeBrowser={bootstrap:async()=>({hasSession:true,version:'theme fixture',state:themeFixture.state}),setBounds:async()=>({ok:true}),onState:fn=>{themeFixture.listener=fn},onPage:()=>{},setEffectsPaused:async()=>({ok:true}),start:async()=>{themeFixture.starts++;return{ok:true}},stop:async()=>({ok:true})};`;
  const html = fs.readFileSync(path.join(root, 'renderer/browser.html'), 'utf8')
    .replace('<script defer src="browser-app.js"></script>', '<script src="theme-fixture.js"></script><script defer src="browser-app.js"></script>');
  const assets = Object.fromEntries(['browser-app.js', 'browser.css', 'galaxy-scene.js', 'galaxy-scene.css', 'star-ribbons.js', 'ghost-v2.png', 'flower-blossom-v1.png'].map(name => [name, fs.readFileSync(path.join(root, 'renderer', name))]));
  const server = http.createServer((request, response) => {
    const name = request.url.slice(1);
    if (name === 'theme-fixture.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(fixtureJs); }
    else if (Object.hasOwn(assets, name)) { response.setHeader('Content-Type', name.endsWith('.png') ? 'image/png' : name.endsWith('.css') ? 'text/css' : 'text/javascript'); response.end(assets[name]); }
    else { response.setHeader('Content-Type', 'text/html'); response.end(html); }
  });
  async function run() {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const win = new BrowserWindow({ show: false, width: 1366, height: 768, webPreferences: { offscreen: true, contextIsolation: false, nodeIntegration: false } });
    const evaluate = code => win.webContents.executeJavaScript(code);
    const wait = condition => evaluate(`new Promise((resolve,reject)=>{const began=performance.now();const check=()=>{if(${condition})return resolve();if(performance.now()-began>5000)return reject(Error('Theme condition did not settle'));setTimeout(check,25)};check()})`);
    const diagnostics = () => evaluate('ConvergeStarRibbons.diagnostics()');
    const choose = theme => evaluate(`document.getElementById('animationTheme').value=${JSON.stringify(theme)};document.getElementById('animationTheme').dispatchEvent(new Event('change',{bubbles:true}))`);
    const task = () => evaluate('({status:themeFixture.state.status,runId:themeFixture.state.runId,round:themeFixture.state.round,starts:themeFixture.starts})');
    const reload = () => new Promise(resolve => { win.webContents.once('did-finish-load', resolve); win.webContents.reload(); });
    try {
      await win.loadURL(`http://127.0.0.1:${server.address().port}/`);
      await wait("typeof ConvergeStarRibbons !== 'undefined' && ConvergeStarRibbons.diagnostics().length===2");
      assert.deepEqual(await evaluate("[...document.getElementById('animationTheme').options].map(option=>option.value)"), ['stars', 'ghost', 'flowers']);
      assert.ok(await evaluate("[...document.querySelectorAll('.reviewer-copy')].every(copy=>getComputedStyle(copy,'::before').content==='none'&&getComputedStyle(copy).backgroundColor==='rgba(0, 0, 0, 0)')"), 'Reviewer labels must have no black plates');
      assert.ok(await evaluate("[...document.querySelectorAll('.reviewer h2,.reviewer p')].every(copy=>getComputedStyle(copy).textShadow!=='none')"), 'Reviewer text must retain its glow');
      assert.ok(await evaluate("[...document.querySelectorAll('.bot-mood-bubble')].every(bubble=>{const bounds=bubble.getBoundingClientRect();const stage=document.getElementById('reviewDeck').getBoundingClientRect();return bounds.width>=28&&bounds.width<=32&&bounds.top>=stage.top&&bounds.bottom<=stage.bottom})"), 'Larger desktop emoji must stay inside the animation stage');
      const originalTask = await task();
      for (const theme of ['stars', 'ghost', 'flowers']) {
        await choose(theme);
        await wait(`ConvergeStarRibbons.diagnostics().every(item=>item.theme===${JSON.stringify(theme)} && item.assetReady)`);
        assert.equal(await evaluate("document.body.dataset.animationTheme"), theme);
        assert.equal(await evaluate("localStorage.getItem('converge.effects.theme')"), theme === 'stars' ? null : theme);
        const sharedAssets = await evaluate('ConvergeStarRibbons.assetDiagnostics()');
        if (theme === 'stars') assert.equal(sharedAssets.length, 0, 'Stars must not load bitmap or comet artwork');
        else {
          assert.equal(sharedAssets.length, 1, 'Both bands must share one selected character bitmap');
          assert.equal(sharedAssets[0].users, 2);
          assert.equal(sharedAssets[0].ready, true);
        }
        const before = await diagnostics();
        await wait(`ConvergeStarRibbons.diagnostics().every((item,index)=>item.frames>${JSON.stringify(before.map(item=>item.frames))}[index])`);
        assert.deepEqual(await task(), originalTask);
        assert.equal(await evaluate("document.getElementById('animationTheme').disabled"), false);
        assert.equal(await evaluate("document.getElementById('animationEnabled').disabled"), false);
        await evaluate("document.getElementById('animationEnabled').click()");
        await wait('ConvergeStarRibbons.diagnostics().every(item=>item.paused)');
        await evaluate('new Promise(resolve=>setTimeout(resolve,100))');
        const paused = (await diagnostics()).map(item => item.frames);
        await evaluate('new Promise(resolve=>setTimeout(resolve,300))');
        assert.deepEqual((await diagnostics()).map(item=>item.frames), paused);
        assert.deepEqual(await task(), originalTask);
        await evaluate("document.getElementById('animationEnabled').click()");
        await wait('ConvergeStarRibbons.diagnostics().every(item=>!item.paused)');
      }
      await evaluate("document.getElementById('animationEnabled').click()");
      await reload();
      await wait("document.getElementById('animationTheme').value==='flowers' && ConvergeStarRibbons.diagnostics().length===2 && ConvergeStarRibbons.diagnostics().every(item=>item.theme==='flowers'&&item.paused&&item.assetReady)");
      assert.equal(await evaluate("document.getElementById('animationEnabled').checked"), false);
      assert.equal(await evaluate("document.body.dataset.animationTheme"), 'flowers');
      await evaluate("localStorage.setItem('converge.effects.theme','galaxy')");
      await reload();
      await wait("document.getElementById('animationTheme').value==='stars' && ConvergeStarRibbons.diagnostics().length===2 && ConvergeStarRibbons.diagnostics().every(item=>item.paused&&item.assetReady)");
      assert.equal(await evaluate("localStorage.getItem('converge.effects.theme')"), 'stars');
      assert.deepEqual(await task(), originalTask);
      assert.equal(await evaluate("document.getElementById('animationEnabled').checked"), false);
      await evaluate("localStorage.setItem('converge.effects.theme','unexpected-theme')");
      await reload();
      await wait("document.getElementById('animationTheme').value==='stars' && ConvergeStarRibbons.diagnostics().length===2");
      assert.equal(await evaluate("document.body.dataset.animationTheme"), 'stars');
      process.stdout.write('PASS: actual themes, comet migration, glowing labels and task independence\n');
    } finally {
      if (!win.isDestroyed()) { try { await evaluate("window.dispatchEvent(new Event('pagehide'))"); } catch (_) {} win.destroy(); }
      await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    }
  }
  app.whenReady().then(run).then(()=>app.exit(0)).catch(error=>{process.stderr.write(error.stack+'\n');app.exit(1)});
}
