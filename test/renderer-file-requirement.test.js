'use strict';

if (!process.versions.electron) {
  const test = require('node:test');
  const assert = require('node:assert/strict');
  const { spawn } = require('node:child_process');
  test('PDF-specific output requirement clears for the next command while explicit user choice persists', { timeout: 30000 }, async () => {
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const output = await new Promise((resolve, reject) => {
      const child = spawn(require('electron'), [__filename], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let log = '';
      child.stdout.on('data', (value) => { log += value; }); child.stderr.on('data', (value) => { log += value; });
      const timer = setTimeout(() => { child.kill(); reject(new Error(`Renderer regression timed out.\n${log}`)); }, 25000);
      child.on('error', (error) => { clearTimeout(timer); reject(error); });
      child.on('close', (code) => { clearTimeout(timer); resolve({ code, log }); });
    });
    assert.equal(output.code, 0, output.log);
    assert.ok(output.log.includes('PASS: actual renderer PDF/next-command and explicit-choice regressions'));
  });
} else {
  const assert = require('node:assert/strict');
  const fs = require('node:fs/promises');
  const fsSync = require('node:fs');
  const path = require('node:path');
  const http = require('node:http');
  const { app, BrowserWindow } = require('electron');
  // Each native fixture owns its Chromium profile and GPU disk cache. The
  // suite also starts other Electron fixtures, so using Electron's default
  // shared profile would introduce cache locks unrelated to the assertions.
  app.setPath('userData', fsSync.mkdtempSync(path.join(app.getPath('temp'), 'converge-renderer-file-qa-')));

  const apiFixture = `<script>
    const ready={ready:true,authenticated:true,busy:false,temporary:false,work:false};
    window.fixture={starts:[],attachCalls:[],state:{status:'setup',phase:'setup',chatMode:'normal',tabIds:{left:10,right:11},pages:{left:{...ready},right:{...ready}},studio:{settings:{documentDesign:{profile:'academic',notes:'',referenceNames:[]}}},attachments:{status:'none',names:[]},transcript:[],issues:[]},listener:null};
    fixture.finish=()=>{fixture.state={...fixture.state,status:'agreed',phase:'done',answer:'Reviewed result',candidate:{id:'C1',text:'Reviewed result'},pages:{left:{...ready},right:{...ready}}};fixture.listener(fixture.state)};
    fixture.reset=()=>{fixture.state={...fixture.state,status:'setup',question:'',requireFiles:false,attachments:{status:'none',names:[]},transcript:[],issues:[]};fixture.listener(fixture.state)};
    window.convergeBrowser={
      bootstrap:async()=>({hasSession:true,version:'fixture',state:fixture.state}),setBounds:async()=>({ok:true}),
      onState:fn=>{fixture.listener=fn},onPage:()=>{},
      attachFiles:async payload=>{fixture.attachCalls.push(payload||{});if(payload?.fileRole==='style-reference'){const name=fixture.referenceName||'GOOD Design.pdf';const combined=[...new Set([...(fixture.state.attachments.names||[]),name])];if(fixture.deferReference){fixture.deferReference=false;fixture.state={...fixture.state,attachments:{status:'uploading',names:combined,referenceNames:[...(fixture.state.studio.settings.documentDesign.referenceNames||[]),name],fileRole:'style-reference'}};fixture.listener(fixture.state);return new Promise(resolve=>{fixture.cancelReference=()=>resolve({ok:true,canceled:true,state:fixture.state})})}const partial=fixture.partialReference;fixture.partialReference=false;fixture.state={...fixture.state,attachments:{status:partial?'partial':'attached',names:combined,referenceNames:[...(fixture.state.studio.settings.documentDesign.referenceNames||[]),name],fileRole:'style-reference'}};if(!partial)fixture.state.studio.settings.documentDesign.referenceNames=[...new Set([...(fixture.state.studio.settings.documentDesign.referenceNames||[]),name])]}else fixture.state={...fixture.state,attachments:{status:'attached',names:[...new Set([...(fixture.state.attachments.names||[]),'source.pdf'])],fileRole:'content-source'}};fixture.listener(fixture.state);return{ok:true,state:fixture.state}},
      start:async payload=>{fixture.starts.push({...payload});fixture.state={...fixture.state,status:'running',phase:'drafts',question:payload.question,runId:'run-'+fixture.starts.length,requireFiles:payload.requireFiles,relayMedia:payload.relayMedia,sourceNames:[...(fixture.state.attachments?.names||[])],attachments:{status:'none',names:[]}};fixture.listener(fixture.state);return{ok:true,state:fixture.state}},
      expand:async()=>({ok:true}),copy:async()=>({ok:true}),saveText:async()=>({ok:true}),
      resetChats:async()=>({ok:true}),clearSession:async()=>({ok:true}),stop:async()=>{fixture.state={...fixture.state,attachments:{status:'none',names:[]}};fixture.listener(fixture.state);fixture.cancelReference?.();fixture.cancelReference=null;return{ok:true,state:fixture.state}}
    };
    </script>`;

  async function run() {
    const root = path.join(__dirname, '..');
    const html = (await fs.readFile(path.join(root, 'renderer', 'browser.html'), 'utf8'))
      .replace('<script defer src="browser-app.js"></script>', '<script src="api-fixture.js"></script><script defer src="browser-app.js"></script>');
    const fixtureJs = apiFixture.replace(/^<script>/, '').replace(/<\/script>\s*$/, '');
    const js = await fs.readFile(path.join(root, 'renderer', 'browser-app.js'), 'utf8');
    const css = await fs.readFile(path.join(root, 'renderer', 'browser.css'), 'utf8');
    const galaxyJs = await fs.readFile(path.join(root, 'renderer', 'galaxy-scene.js'), 'utf8');
    const ribbonJs = await fs.readFile(path.join(root, 'renderer', 'star-ribbons.js'), 'utf8');
    const galaxyCss = await fs.readFile(path.join(root, 'renderer', 'galaxy-scene.css'), 'utf8');
    const themeAssets = Object.fromEntries(await Promise.all(['ghost-v2.png', 'flower-blossom-v1.png', 'studio-ui.js', 'studio-ui.css', 'assets/fonts/Manrope-Variable.ttf'].map(async name => [name, await fs.readFile(path.join(root, 'renderer', name))])));
    const server = http.createServer((request, response) => {
      const assetName = request.url?.slice(1); const themeAsset = themeAssets[assetName];
      if (themeAsset) { response.setHeader('Content-Type', assetName.endsWith('.png') ? 'image/png' : assetName.endsWith('.css') ? 'text/css' : assetName.endsWith('.ttf') ? 'font/ttf' : 'text/javascript'); response.end(themeAsset); return; }
      if (request.url === '/api-fixture.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(fixtureJs); }
      else if (request.url === '/browser-app.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(js); }
      else if (request.url === '/browser.css') { response.setHeader('Content-Type', 'text/css'); response.end(css); }
      else if (request.url === '/galaxy-scene.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(galaxyJs); }
      else if (request.url === '/star-ribbons.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(ribbonJs); }
      else if (request.url === '/galaxy-scene.css') { response.setHeader('Content-Type', 'text/css'); response.end(galaxyCss); }
      else { response.setHeader('Content-Type', 'text/html;charset=utf-8'); response.end(html); }
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const win = new BrowserWindow({ show: false, width: 1366, height: 768, webPreferences: { offscreen: true, contextIsolation: false, nodeIntegration: false } });
    const evaluate = (code) => win.webContents.executeJavaScript(code);
    const idle = () => evaluate(`new Promise((resolve,reject)=>{const start=Date.now();const timer=setInterval(()=>{if(!document.getElementById('attachFiles').disabled){clearInterval(timer);resolve()}else if(Date.now()-start>2000){clearInterval(timer);reject(Error('UI not ready'))}},10)})`);
    const attach = async () => {
      await evaluate(`document.getElementById('attachFiles').click()`); await idle();
    };
    const chooseExplicit = (checked) => evaluate(`document.getElementById('requireFiles').checked=${checked};document.getElementById('requireFiles').dispatchEvent(new Event('change',{bubbles:true}))`);
    const start = async (question) => {
      await evaluate(`document.getElementById('question').value=${JSON.stringify(question)};document.getElementById('question').dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('start').click()`);
      await evaluate(`new Promise((resolve,reject)=>{const begin=Date.now();const timer=setInterval(()=>{if(fixture.state.status==='running'){clearInterval(timer);resolve()}else if(Date.now()-begin>2000){clearInterval(timer);reject(Error('Start not received'))}},10)})`);
    };
    try {
      await win.loadURL(`http://127.0.0.1:${server.address().port}/`); await idle();
      await evaluate("document.getElementById('attachStyleReferences').click()"); await idle();
      assert.deepEqual(await evaluate('fixture.attachCalls.at(-1)'), { fileRole: 'style-reference' });
      assert.equal(await evaluate("document.getElementById('requireFiles').checked"), false, 'A style-only PDF reference demanded a revised output file');
      assert.match(await evaluate("document.getElementById('styleReferenceStatus').textContent"), /appearance only.*\s+GOOD Design\.pdf/);
      assert.doesNotMatch(await evaluate("document.getElementById('fileStatus').textContent"), /GOOD Design\.pdf/, 'Appearance references are presented as task content');
      await evaluate("fixture.state.attachments={status:'none',names:[]};fixture.listener(fixture.state);fixture.deferReference=true;document.getElementById('attachStyleReferences').click()");
      await evaluate('new Promise(resolve=>setTimeout(resolve,100))');
      assert.equal(await evaluate("document.getElementById('attachStyleReferences').disabled"), true);
      assert.equal(await evaluate("document.getElementById('attachFiles').disabled"), true);
      assert.equal(await evaluate("document.getElementById('headerStop').hidden"), false);
      assert.equal(await evaluate("document.getElementById('headerStop').disabled"), false, 'Style uploads cannot be canceled');
      await evaluate("document.getElementById('headerStop').click()"); await idle();
      await evaluate("fixture.partialReference=true;document.getElementById('attachStyleReferences').click()"); await idle();
      assert.equal(await evaluate('fixture.state.attachments.status'), 'partial');
      assert.equal(await evaluate("document.getElementById('requireFiles').checked"), false);
      await attach();
      assert.deepEqual(await evaluate('fixture.attachCalls.at(-1)'), { fileRole: 'style-reference' }, 'Rechecking a pending reference changed it into a content upload');
      assert.equal(await evaluate("document.getElementById('requireFiles').checked"), false);
      await evaluate("fixture.state.attachments={status:'none',names:[]};fixture.listener(fixture.state)");
      await attach();
      assert.equal(await evaluate("document.getElementById('requireFiles').checked"), true);
      await evaluate("fixture.referenceName='Other Design.pdf';document.getElementById('attachStyleReferences').click()"); await idle();
      assert.equal(await evaluate("document.getElementById('requireFiles').checked"), true, 'Adding an appearance reference cleared the existing content PDF requirement');
      assert.match(await evaluate("document.getElementById('fileStatus').textContent"), /Content files\s+source\.pdf/);
      assert.doesNotMatch(await evaluate("document.getElementById('fileStatus').textContent"), /Other Design\.pdf/);
      await start('Correct the source PDF');
      assert.equal(await evaluate('fixture.starts.at(-1).requireFiles'), true);
      assert.equal(await evaluate("document.getElementById('requireFiles').checked"), true, 'The active PDF run must still show its committed setting');
      assert.match(await evaluate("document.getElementById('reviewSummary').textContent"), /Revised file required/);
      assert.match(await evaluate("document.getElementById('fileStatus').textContent"), /Original sources for this task.*supplied with each review\s+source\.pdf/);
      await evaluate('fixture.finish()'); await idle();
      assert.equal(await evaluate("document.getElementById('fileStatus').textContent"), 'No files queued for your next command');
      assert.equal(await evaluate("document.getElementById('requireFiles').checked"), false, 'Auto PDF requirement leaked into the next command');
      await start('Now answer an unrelated arithmetic question in text');
      assert.equal(await evaluate('fixture.starts.at(-1).requireFiles'), false);
      assert.deepEqual(await evaluate('fixture.state.tabIds'), { left: 10, right: 11 });
      await evaluate('fixture.finish()'); await idle();

      await chooseExplicit(true); await attach();
      await start('User explicitly requires a revised file');
      assert.equal(await evaluate('fixture.starts.at(-1).requireFiles'), true);
      await evaluate('fixture.finish()'); await idle();
      assert.equal(await evaluate("document.getElementById('requireFiles').checked"), true);
      await start('Another command with the persistent user setting');
      assert.equal(await evaluate('fixture.starts.at(-1).requireFiles'), true);
      await evaluate('fixture.finish()'); await idle();

      await chooseExplicit(false); await attach();
      assert.equal(await evaluate("document.getElementById('requireFiles').checked"), true);
      await chooseExplicit(false);
      await start('Only summarize this PDF; no revised file needed');
      assert.equal(await evaluate('fixture.starts.at(-1).requireFiles'), false, 'User opt-out of automatic PDF output was ignored');
      await evaluate('fixture.finish()'); await idle();
      assert.equal(await evaluate("document.getElementById('requireFiles').checked"), false);
      await evaluate(`fixture.state={...fixture.state,status:'agreed',requiredWork:[{id:'mt5-backtest'}],issues:[]};fixture.listener(fixture.state)`);
      assert.match(await evaluate("document.getElementById('resultLabel').textContent"), /performance not independently verified/);
      assert.match(await evaluate("document.getElementById('statusDetail').textContent"), /not independently executed or authenticated/);
      await evaluate(`fixture.state={...fixture.state,status:'limit_reached',issues:[{id:'T1',taskRequirementId:'mt5-backtest',severity:'major',problem:'The real six-month report is missing',resolved:false}]};fixture.listener(fixture.state)`);
      assert.equal(await evaluate("document.getElementById('statusTitle').textContent"), 'Requested testing remains unfinished');
      assert.equal(await evaluate("document.getElementById('issueCount').textContent"), '1');
      process.stdout.write('PASS: actual renderer PDF/next-command and explicit-choice regressions: automatic PDF requirement consumed once, active summary preserved, next text command stays in the same chats, explicit on persists, and explicit off overrides queued PDF output.\n');
    } finally {
      if (!win.isDestroyed()) {
        try { await evaluate("window.dispatchEvent(new Event('pagehide'))"); } catch (_) { }
        win.destroy();
      }
      await new Promise((resolve) => {
        server.close(resolve);
        // This server belongs only to the fixture. Release any Chromium
        // keep-alive connections so they cannot hold the native test open.
        server.closeAllConnections();
      });
    }
  }
  app.whenReady().then(run).then(() => app.quit()).catch((error) => { process.stderr.write(`${error.stack}\n`); app.exit(1); });
}
