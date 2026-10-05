'use strict';

// Exercise the actual renderer in Chromium. Transport is a bounded fixture;
// the separate desktop QA uses all three native views and the page adapters.
if (!process.versions.electron) {
  const test = require('node:test');
  const assert = require('node:assert/strict');
  const { spawn } = require('node:child_process');
  test('boss drawer, instructions, resumed task, themes and close quiescence', { timeout: 40000 }, async () => {
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const result = await new Promise((resolve, reject) => {
      const child = spawn(require('electron'), [__filename], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let output = '';
      child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { output += data; });
      const timer = setTimeout(() => { child.kill(); reject(Error(`Boss renderer test timed out.\n${output}`)); }, 35000);
      child.on('error', error => { clearTimeout(timer); reject(error); });
      child.on('close', code => { clearTimeout(timer); resolve({ code, output }); });
    });
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /PASS: boss UI instructions, themes, characters and closing/);
  });
} else {
  const assert = require('node:assert/strict');
  const fs = require('node:fs/promises');
  const path = require('node:path');
  const http = require('node:http');
  const { app, BrowserWindow } = require('electron');
  const root = path.join(__dirname, '..');
  app.setPath('userData', path.join(app.getPath('temp'), `converge-boss-renderer-${process.pid}`));
  const fixtureJs = `
    const ready={ready:true,authenticated:true,busy:false,temporary:false,work:false};
    window.bossFixture={bounds:[],starts:[],messages:[],themes:[],effectCalls:[],listener:null,closing:null,failNext:false,state:{coordinatorMode:'boss',status:'setup',chatMode:'normal',tabIds:{left:10,right:11,boss:12},pages:{left:{...ready},right:{...ready},boss:{...ready}},boss:{queue:[],instructions:[]},attachments:{status:'none',names:[]},transcript:[],issues:[]}};
    bossFixture.publish=value=>{bossFixture.state={...bossFixture.state,...value};bossFixture.listener(bossFixture.state)};
    window.convergeBrowser={
      bootstrap:async()=>({hasSession:true,version:'boss-ui-fixture',state:bossFixture.state}),
      setBounds:async bounds=>{bossFixture.bounds.push(bounds);return{ok:true}},
      onState:fn=>{bossFixture.listener=fn},onPage:()=>{},onClosing:fn=>{bossFixture.closing=fn},
      setEffectsPaused:async value=>{bossFixture.effectCalls.push(value);return{ok:true}},
      setAppearance:async value=>{bossFixture.themes.push(value);return{ok:true}},
      start:async payload=>{bossFixture.starts.push(payload);bossFixture.publish({status:'running',phase:'boss-planning',stage:'Boss planning the task',runId:'fixture-run',question:payload.question,reviewMode:payload.reviewMode,maxRounds:payload.maxRounds,pending:{boss:{kind:'boss-plan'}},pages:{left:{...ready},right:{...ready},boss:{...ready,busy:true}}});return{ok:true,state:bossFixture.state}},
      bossMessage:async payload=>{if(bossFixture.failNext){bossFixture.failNext=false;return{ok:false,error:'Instruction could not be queued. Try again.'}}bossFixture.messages.push(payload);bossFixture.publish({status:'running',boss:{...bossFixture.state.boss,queue:[...(bossFixture.state.boss.queue||[]),payload.text]}});return{ok:true,state:bossFixture.state}},
      expand:async()=>({ok:true}),copy:async()=>({ok:true}),saveText:async()=>({ok:true}),saveFiles:async()=>({ok:true,saved:1,names:['candidate.txt']}),
      resetChats:async()=>{bossFixture.publish({status:'idle',tabIds:{left:null,right:null,boss:null},pages:{},boss:{queue:[]},attachments:{status:'none',names:[]}});return{ok:true,state:bossFixture.state}}
    };`;
  async function run() {
    const assetNames = ['browser.html', 'browser-app.js', 'browser.css', 'galaxy-scene.js', 'galaxy-scene.css', 'star-ribbons.js', 'ghost-v2.png', 'flower-blossom-v1.png'];
    const assets = Object.fromEntries(await Promise.all(assetNames.map(async name => [name, await fs.readFile(path.join(root, 'renderer', name))])));
    const html = assets['browser.html'].toString('utf8').replace('<script defer src="browser-app.js"></script>', '<script src="boss-fixture.js"></script><script defer src="browser-app.js"></script>');
    const server = http.createServer((req, res) => {
      const name = req.url.split('?')[0].slice(1);
      if (name === 'boss-fixture.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(fixtureJs); }
      else if (assets[name] && name !== 'browser.html') { res.setHeader('Content-Type', name.endsWith('.png') ? 'image/png' : name.endsWith('.css') ? 'text/css' : 'text/javascript'); res.end(assets[name]); }
      else { res.setHeader('Content-Type', 'text/html;charset=utf-8'); res.end(html); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const win = new BrowserWindow({ show: false, frame: false, width: 1366, height: 768, webPreferences: { offscreen: true, contextIsolation: false, nodeIntegration: false } });
    const consoleErrors = [];
    win.webContents.on('console-message', details => { if (details.level === 'error') consoleErrors.push(details.message); });
    const evaluate = code => win.webContents.executeJavaScript(code);
    const settled = () => evaluate('new Promise(resolve=>requestAnimationFrame(()=>setTimeout(resolve,330)))');
    const wait = condition => evaluate(`new Promise((resolve,reject)=>{const began=performance.now();const check=()=>{if(${condition})return resolve();if(performance.now()-began>4000)return reject(Error('Boss UI condition did not settle: '+${JSON.stringify(condition)}));setTimeout(check,20)};check()})`);
    const select = (id, value) => evaluate(`document.getElementById(${JSON.stringify(id)}).value=${JSON.stringify(value)};document.getElementById(${JSON.stringify(id)}).dispatchEvent(new Event('change',{bubbles:true}))`);
    const typeInstruction = text => evaluate(`document.getElementById('bossMessageInput').value=${JSON.stringify(text)};document.getElementById('bossMessageInput').dispatchEvent(new Event('input',{bubbles:true}))`);
    const send = () => evaluate("document.getElementById('sendBossMessage').click()");
    const reload = () => new Promise(resolve => { win.webContents.once('did-finish-load', resolve); win.webContents.reload(); });
    const geometry = () => evaluate(`(()=>{const rect=id=>{const b=document.getElementById(id).getBoundingClientRect();return{x:b.x,y:b.y,width:b.width,height:b.height,right:b.right,bottom:b.bottom}};return{left:rect('leftSlot'),right:rect('rightSlot'),boss:rect('bossSlot'),drawer:rect('bossDrawer'),native:bossFixture.bounds.at(-1)}})()`);
    try {
      win.webContents.debugger.attach('1.3');
      await win.loadURL(`http://127.0.0.1:${server.address().port}/`);
      await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
      await wait("document.getElementById('version').textContent==='vboss-ui-fixture'");
      await settled();
      assert.equal(await evaluate("document.getElementById('bossDrawer').hidden"), true);
      assert.equal(await evaluate('bossFixture.bounds.at(-1).boss.width'), 0);
      await evaluate("document.getElementById('closeSidebar').click()"); await settled();
      let boxes = await geometry();
      assert.ok((boxes.native.left.width + boxes.native.right.width) / 1366 >= .85);
      await evaluate("document.getElementById('toggleBoss').click()"); await settled();
      boxes = await geometry();
      assert.equal(await evaluate("document.getElementById('toggleBoss').getAttribute('aria-expanded')"), 'true');
      assert.ok(boxes.boss.height > 300, 'The boss has too little space to show its actual conversation');
      assert.equal(boxes.native.boss.x, Math.round(boxes.boss.x));
      assert.equal(boxes.native.boss.height, Math.round(boxes.boss.height));
      assert.ok(boxes.native.right.width === 0 || boxes.native.right.x + boxes.native.right.width <= Math.round(boxes.drawer.x), 'A native worker can cover the boss drawer');
      assert.equal(boxes.native.left.width, Math.round(boxes.left.width));

      // Page readiness cannot accidentally skip the normally hidden boss.
      await evaluate("bossFixture.publish({pages:{...bossFixture.state.pages,boss:{...ready,ready:false}}})");
      await typeInstruction('Build a revised result with evidence.');
      assert.equal(await evaluate("document.getElementById('sendBossMessage').disabled"), true);
      await evaluate("bossFixture.publish({pages:{...bossFixture.state.pages,boss:{...ready}}})");

      for (const theme of ['horror', 'alien', 'night']) {
        await select('chatTheme', theme);
        await wait(`bossFixture.themes.at(-1)?.chatTheme===${JSON.stringify(theme)}`);
        assert.equal(await evaluate('document.body.dataset.chatTheme'), theme);
        assert.equal(await evaluate("localStorage.getItem('converge.chat.theme')"), theme);
      }
      for (const style of ['astronaut', 'spirit', 'robot']) {
        await select('characterStyle', style);
        const visible = await evaluate("[...document.querySelectorAll('.bot > svg.bot-character')].filter(svg=>getComputedStyle(svg).display!=='none').map(svg=>[...svg.classList].find(name=>name.startsWith('character-')))");
        assert.deepEqual(visible, Array(3).fill(`character-${style}`));
      }
      await select('chatTheme', 'alien'); await select('characterStyle', 'spirit');
      await reload(); await wait("document.getElementById('chatTheme').value==='alien'");
      assert.equal(await evaluate('document.body.dataset.characterStyle'), 'spirit');
      assert.equal(await evaluate('bossFixture.themes.at(-1).chatTheme'), 'alien');
      await evaluate("document.getElementById('toggleBoss').click()"); await settled();
      await typeInstruction('Build a revised result with evidence.'); await send();
      await wait('bossFixture.starts.length===1');
      assert.equal(await evaluate('bossFixture.starts[0].question'), 'Build a revised result with evidence.');
      assert.equal(await evaluate('bossFixture.starts[0].reviewMode'), 'auto');
      assert.equal(await evaluate("document.getElementById('bossMessageInput').value"), '');
      assert.equal(await evaluate("document.getElementById('bossDrawer').hidden"), false, 'Starting the team hid the boss conversation');

      // Sending while the boss is generating must queue safely, without a new
      // Start or a direct typed message in the native ChatGPT composer.
      await typeInstruction('Also consider the counterexample.');
      assert.equal(await evaluate("document.getElementById('sendBossMessage').disabled"), false);
      await send(); await wait('bossFixture.messages.length===1');
      assert.equal(await evaluate('bossFixture.starts.length'), 1);
      assert.match(await evaluate("document.getElementById('bossQueueStatus').textContent"), /1 instruction queued/);
      assert.equal(await evaluate("document.getElementById('bossMessageInput').value"), '');
      await evaluate('bossFixture.failNext=true');
      await typeInstruction('Keep this unsent instruction.'); await send();
      await wait("!document.getElementById('bossMessageError').hidden");
      assert.equal(await evaluate("document.getElementById('bossMessageInput').value"), 'Keep this unsent instruction.');
      assert.match(await evaluate("document.getElementById('bossMessageError').textContent"), /Try again/);

      await evaluate("bossFixture.publish({status:'blocked',stage:'Need a missing parameter',boss:{queue:[]},pages:{left:{...ready},right:{...ready},boss:{...ready}}})");
      await typeInstruction('The missing value is 20.'); await send();
      await wait('bossFixture.messages.length===2');
      assert.equal(await evaluate('bossFixture.starts.length'), 1, 'Clarification restarted the entire task');
      assert.equal(await evaluate('bossFixture.messages.at(-1).text'), 'The missing value is 20.');

      await evaluate("bossFixture.publish({status:'agreed',stage:'Boss reviewed the final result',answer:'CANONICAL WORKER CANDIDATE',candidate:{id:'C2',text:'CANONICAL WORKER CANDIDATE',media:{side:'boss',files:[{name:'candidate.txt',mimeType:'text/plain',base64:'eA=='}]}},boss:{queue:[],finalSummary:'The workers checked this candidate.',finalChecks:['Counterexample tested'],limitations:['External evidence still needs verification']},transcript:[{side:'boss',role:'plan',text:'Assign independent checks.'}],pages:{left:{...ready},right:{...ready},boss:{...ready}}})");
      assert.equal(await evaluate("document.getElementById('answer').textContent"), 'CANONICAL WORKER CANDIDATE');
      assert.equal(await evaluate("document.getElementById('bossReviewCard').hidden"), false);
      assert.match(await evaluate("document.getElementById('bossLimitations').textContent"), /External evidence/);
      assert.match(await evaluate("document.getElementById('transcript').textContent"), /BOSS · TEAM DIRECTOR/);
      await evaluate("document.getElementById('closeBoss').click();document.getElementById('viewOutput').click()"); await settled();
      assert.equal(await evaluate("document.getElementById('bossDrawer').hidden"), false, 'Boss-owned output opened the wrong native page');
      await evaluate("document.getElementById('bossMessageInput').focus();document.getElementById('toggleResults').click()"); await settled();
      assert.equal(await evaluate("document.getElementById('bossDrawer').hidden"), true);
      assert.equal(await evaluate("document.activeElement.id"), 'toggleBoss', 'Closing the drawer left focus inside hidden content');
      await evaluate("document.getElementById('toggleBoss').click()"); await settled();
      await evaluate("document.getElementById('animationEnabled').click()");
      assert.ok(await evaluate("[...document.querySelectorAll('#botBoss .bot-head')].every(head=>head.getAnimations().every(animation=>animation.playState==='paused'))"), 'Boss animation keeps running after effects are paused');
      await evaluate("document.getElementById('closeBoss').click()"); await settled();
      assert.equal(await evaluate('bossFixture.bounds.at(-1).boss.width'), 0);
      boxes = await geometry();
      assert.equal(boxes.native.right.width, Math.round(boxes.right.width));

      // The host gives the renderer a brief closing notice. Pending layout
      // callbacks and effects changes must not contact removed IPC handlers.
      const beforeClose = await evaluate('({bounds:bossFixture.bounds.length,effects:bossFixture.effectCalls.length})');
      await evaluate("bossFixture.closing();window.dispatchEvent(new Event('resize'));document.getElementById('animationEnabled').click();document.getElementById('toggleBoss').click()");
      await settled();
      assert.deepEqual(await evaluate('({bounds:bossFixture.bounds.length,effects:bossFixture.effectCalls.length})'), beforeClose);
      assert.deepEqual(consoleErrors, []);
      process.stdout.write('PASS: boss UI instructions, themes, characters and closing\n');
    } finally {
      if (!win.isDestroyed()) { try { await evaluate("window.dispatchEvent(new Event('pagehide'))"); } catch (_) {} win.destroy(); }
      await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    }
  }
  app.whenReady().then(run).then(() => app.exit(0)).catch(error => { process.stderr.write(error.stack + '\n'); app.exit(1); });
}
