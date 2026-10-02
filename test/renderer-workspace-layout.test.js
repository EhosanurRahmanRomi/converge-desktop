'use strict';

// Load the actual renderer and CSS in Chromium, with a local host API fixture.
// This checks native-view geometry as well as visible controls and payloads.
if (!process.versions.electron) {
  const test = require('node:test');
  const assert = require('node:assert/strict');
  const { spawn } = require('node:child_process');
  test('full-width chat layout, overlay controls, bottom output drawer and review styles', { timeout: 30000 }, async () => {
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const output = await new Promise((resolve, reject) => {
      const child = spawn(require('electron'), [__filename], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let log = '';
      child.stdout.on('data', (value) => { log += value; }); child.stderr.on('data', (value) => { log += value; });
      const timer = setTimeout(() => { child.kill(); reject(new Error(`Workspace layout test timed out.\n${log}`)); }, 25000);
      child.on('error', (error) => { clearTimeout(timer); reject(error); });
      child.on('close', (code) => { clearTimeout(timer); resolve({ code, log }); });
    });
    assert.equal(output.code, 0, output.log);
    assert.match(output.log, /PASS: real renderer workspace layout and review-style regressions/);
  });
} else {
  const assert = require('node:assert/strict');
  const fs = require('node:fs/promises');
  const path = require('node:path');
  const http = require('node:http');
  const { app, BrowserWindow } = require('electron');
  app.setPath('userData', path.join(app.getPath('temp'), `converge-renderer-layout-qa-${process.pid}`));
  const fixtureJs = `
    const ready={ready:true,authenticated:true,busy:false,temporary:false,work:false};
    window.fixture={bounds:[],starts:[],saves:0,listener:null,paperAnimations:[],centralDraws:0,hidden:false,state:{status:'setup',chatMode:'normal',tabIds:{left:10,right:11},pages:{left:{...ready},right:{...ready}},attachments:{status:'none',names:[]},transcript:[],issues:[]}};
    const originalGetContext=HTMLCanvasElement.prototype.getContext;
    const observedContexts=new WeakSet();
    HTMLCanvasElement.prototype.getContext=function(...args){const context=originalGetContext.apply(this,args);if(this.id==='stars'&&args[0]==='webgl'&&context&&!observedContexts.has(context)){observedContexts.add(context);const originalDraw=context.drawArrays;context.drawArrays=function(...drawArgs){fixture.centralDraws++;return originalDraw.apply(this,drawArgs)}}return context};
    Object.defineProperty(document,'hidden',{configurable:true,get:()=>fixture.hidden});
    const originalAnimate=Element.prototype.animate;
    Element.prototype.animate=function(frames,options){if(this.id==='handoffDocument')fixture.paperAnimations.push({frames,options});return originalAnimate.call(this,frames,options)};
    fixture.finish=()=>{fixture.state={...fixture.state,status:'agreed',phase:'done',round:4,answer:'Reviewed result',candidate:{id:'C1',text:'Reviewed result',media:{side:'right',files:[{name:'improved.pdf',mimeType:'application/pdf',base64:'JVBERg=='}]}},pages:{left:{...ready},right:{...ready}}};fixture.listener(fixture.state)};
    window.convergeBrowser={
      bootstrap:async()=>({hasSession:true,version:'fixture',state:fixture.state}),setBounds:async value=>{fixture.bounds.push(value);return{ok:true}},
      onState:fn=>{fixture.listener=fn},onPage:()=>{},
      start:async payload=>{fixture.starts.push({...payload});fixture.state={...fixture.state,status:'running',phase:'review',stage:'Round 2: B checks improvements',round:2,maxRounds:payload.maxRounds,minReviewRounds:payload.reviewMode==='verify'?1:4,reviewMode:payload.reviewMode,question:payload.question,runId:'run-'+fixture.starts.length,requireFiles:payload.requireFiles,relayMedia:payload.relayMedia,attachments:{status:'none',names:[]}};fixture.listener(fixture.state);return{ok:true,state:fixture.state}},
      saveFiles:async()=>{fixture.saves++;return{ok:true,names:['improved.pdf'],saved:1}},expand:async()=>({ok:true}),copy:async()=>({ok:true}),saveText:async()=>({ok:true}),
      resetChats:async()=>{fixture.state={status:'idle',tabIds:{left:null,right:null},pages:{},attachments:{status:'none',names:[]},transcript:[],issues:[]};fixture.listener(fixture.state);return{ok:true,state:fixture.state}}
    };`;
  async function run() {
    const root = path.join(__dirname, '..');
    const html = (await fs.readFile(path.join(root, 'renderer', 'browser.html'), 'utf8'))
      .replace('<script defer src="browser-app.js"></script>', '<script src="api-fixture.js"></script><script defer src="browser-app.js"></script>');
    const js = await fs.readFile(path.join(root, 'renderer', 'browser-app.js'), 'utf8');
    const css = await fs.readFile(path.join(root, 'renderer', 'browser.css'), 'utf8');
    const galaxyJs = await fs.readFile(path.join(root, 'renderer', 'galaxy-scene.js'), 'utf8');
    const ribbonJs = await fs.readFile(path.join(root, 'renderer', 'star-ribbons.js'), 'utf8');
    const galaxyCss = await fs.readFile(path.join(root, 'renderer', 'galaxy-scene.css'), 'utf8');
    const themeAssets = Object.fromEntries(await Promise.all(['ghost-v2.png', 'flower-blossom-v1.png'].map(async name => [name, await fs.readFile(path.join(root, 'renderer', name))])));
    const server = http.createServer((request, response) => {
      const themeAsset = themeAssets[request.url?.slice(1)];
      if (themeAsset) { response.setHeader('Content-Type', 'image/png'); response.end(themeAsset); return; }
      if (request.url === '/api-fixture.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(fixtureJs); }
      else if (request.url === '/browser-app.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(js); }
      else if (request.url === '/browser.css') { response.setHeader('Content-Type', 'text/css'); response.end(css); }
      else if (request.url === '/galaxy-scene.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(galaxyJs); }
      else if (request.url === '/star-ribbons.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(ribbonJs); }
      else if (request.url === '/galaxy-scene.css') { response.setHeader('Content-Type', 'text/css'); response.end(galaxyCss); }
      else { response.setHeader('Content-Type', 'text/html;charset=utf-8'); response.end(html); }
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const win = new BrowserWindow({ show: false, frame: false, width: 1366, height: 768, webPreferences: { offscreen: true, contextIsolation: false, nodeIntegration: false } });
    const evaluate = (code) => win.webContents.executeJavaScript(code);
    const settle = () => evaluate('new Promise(resolve=>requestAnimationFrame(()=>setTimeout(resolve,30)))');
    const capture = async name => {
      if (process.env.CONVERGE_UI_CAPTURE !== '1') return;
      const folder = path.join(root, '.design', 'ui-1.6.5'); await fs.mkdir(folder, { recursive: true });
      await fs.writeFile(path.join(folder, name), (await win.webContents.capturePage()).toPNG());
    };
    // Chromium may acknowledge media emulation before delivering its change
    // event. Wait for the visible response to that real event, with a bound.
    const waitForUi = (condition) => evaluate(`new Promise((resolve,reject)=>{const began=performance.now();const check=()=>{if(${condition})return resolve();if(performance.now()-began>2000)return reject(Error('UI condition did not settle: '+${JSON.stringify(condition)}+'; state='+JSON.stringify({bodyClass:document.body.className,hidden:document.hidden,reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches,ribbons:ConvergeStarRibbons.diagnostics()})));setTimeout(check,20)};check()})`);
    const ribbonSnapshot = () => evaluate("ConvergeStarRibbons.diagnostics().map(scene=>({id:scene.canvasId,frames:scene.frames,paused:scene.paused}))");
    const verifyFrozenRibbons = async (reason) => {
      const before = await ribbonSnapshot();
      assert.equal(before.length, 2, 'Both animation bands must have live controllers');
      assert.ok(before.every(scene => scene.paused), `${reason}: a star band was not paused`);
      await evaluate('new Promise(resolve=>setTimeout(resolve,240))');
      assert.deepEqual(await ribbonSnapshot(), before, `${reason}: star bands continued drawing`);
    };
    const verifyMovingRibbonsAndStillBackdrop = async () => {
      const before = await ribbonSnapshot(), centralDraws = await evaluate('fixture.centralDraws');
      assert.equal(before.length, 2, 'Both animated bands must remain available');
      assert.ok(centralDraws > 0, 'The real WebGL chat backdrop did not render its initial still frame');
      await waitForUi(`ConvergeStarRibbons.diagnostics().every((scene,index)=>!scene.paused&&scene.frames>${JSON.stringify(before.map(scene=>scene.frames))}[index])`);
      assert.equal(await evaluate('fixture.centralDraws'), centralDraws, 'The full chat backdrop keeps redrawing while the star bands move');
    };
    const chooseMode = async (value) => {
      await evaluate(`document.getElementById('reviewMode').value=${JSON.stringify(value)};document.getElementById('reviewMode').dispatchEvent(new Event('change',{bubbles:true}))`);
    };
    const start = async (question) => {
      await evaluate(`document.getElementById('question').value=${JSON.stringify(question)};document.getElementById('question').dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('start').click()`);
      await settle();
      assert.equal(await evaluate('fixture.state.status'), 'running');
    };
    const geometry = () => evaluate(`(()=>{const box=id=>{const r=document.getElementById(id).getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}};return{viewport:innerWidth,left:box('leftSlot'),right:box('rightSlot'),deck:box('reviewDeck'),drawer:box('sidebar'),result:box('resultDrawer'),native:fixture.bounds.at(-1)}})()`);
    try {
      await win.loadURL(`http://127.0.0.1:${server.address().port}/`); await settle();
      assert.equal(await evaluate("document.getElementById('reviewMode').value"), 'auto');
      assert.equal(await evaluate("document.querySelector('.galaxy').getAttribute('aria-hidden')"), 'true');
      assert.ok(await evaluate("document.getElementById('reviewDeck').getBoundingClientRect().height <= 96"), 'The compact bot deck consumes more than 96 vertical pixels');
      assert.ok(await evaluate("document.getElementById('leftSlot').getBoundingClientRect().height >= innerHeight*.66"), 'The animation area leaves less than 66% of the window height for the chat');
      assert.ok(await evaluate("typeof ConvergeGalaxy?.create==='function'"), 'The actual procedural galaxy module did not load');
      assert.ok(await evaluate("typeof ConvergeStarRibbons?.create==='function'"), 'The actual cached star ribbon module did not load');
      assert.deepEqual(await evaluate('ConvergeStarRibbons.diagnostics().map(scene=>scene.canvasId).sort()'), ['bottomStarRibbon', 'topStarRibbon']);
      assert.equal(await evaluate("document.getElementById('animationEnabled').checked"), true);
      await verifyMovingRibbonsAndStillBackdrop();
      const idleMotion = await evaluate(`(()=>{const head=document.querySelector('#botLeft .bot-head');const animation=head.getAnimations()[0];const timing=animation?.effect.getTiming();if(!animation)return null;const before=getComputedStyle(head).transform;animation.currentTime=7000;const after=getComputedStyle(head).transform;return{iterations:timing.iterations===Infinity,duration:timing.duration,changed:before!==after}})()`);
      assert.ok(idleMotion?.iterations && idleMotion.duration >= 20000 && idleMotion.changed, 'The idle bot lacks a real long-running animation loop');
      assert.doesNotMatch(await evaluate("document.getElementById('reviewDeck').textContent"), /GPT.?5\.6|Extra High/, 'Activity deck falsely hardcodes the models selected inside ChatGPT');
      if (process.env.CONVERGE_GALAXY_CAPTURE === '1') await fs.writeFile(path.join(root, '.design', 'galaxy-renderer-controls.png'), (await win.webContents.capturePage()).toPNG());
      await capture('desktop-controls.png');
      let boxes = await geometry();
      assert.ok(boxes.deck.width / boxes.viewport >= .98, 'The top animation stage is not using the full window width');
      assert.ok(boxes.drawer.y >= boxes.deck.bottom - 1, 'The controls cover the panoramic bot animation');
      assert.ok(boxes.left.y >= boxes.deck.bottom, 'The chat overlaps the animation stage');
      assert.ok(boxes.native.left.x >= boxes.drawer.right - 1, 'Native ChatGPT view covers the controls drawer');
      const originalRightX = boxes.right.x;
      // Persist a real user setting through a complete renderer reload, then
      // enable it during a run without changing the request or stopping work.
      await evaluate("document.getElementById('animationEnabled').click()"); await settle();
      assert.equal(await evaluate("document.getElementById('effectsButton').getAttribute('aria-pressed')"), 'true');
      assert.equal(await evaluate("localStorage.getItem('converge.galaxy.effectsPaused')"), 'true');
      await verifyFrozenRibbons('Settings Off');
      await new Promise(resolve => { win.webContents.once('did-finish-load', resolve); win.webContents.reload(); }); await settle();
      assert.equal(await evaluate("document.getElementById('animationEnabled').checked"), false, 'Settings Off did not survive a renderer reload');
      assert.equal(await evaluate("document.getElementById('effectsButton').getAttribute('aria-pressed')"), 'true');
      await verifyFrozenRibbons('Reloaded Settings Off');
      await start('Improve this creative project and its files');
      assert.equal(await evaluate('fixture.starts.at(-1).reviewMode'), 'auto');
      assert.equal(await evaluate("document.getElementById('toggleSidebar').getAttribute('aria-expanded')"), 'false');
      assert.equal(await evaluate("document.getElementById('resultContent').hidden"), true);
      assert.match(await evaluate("document.getElementById('bottomStage').textContent"), /Round 2: B checks improvements/);
      assert.match(await evaluate("document.getElementById('bottomRound').textContent"), /ROUND 2/);
      boxes = await geometry();
      assert.ok((boxes.left.width + boxes.right.width) / boxes.viewport >= .85, 'Chats take less than 85% of the workspace width');
      assert.equal(boxes.native.left.x, Math.round(boxes.left.x));
      assert.equal(boxes.native.right.width, Math.round(boxes.right.width));
      assert.equal(boxes.right.x, originalRightX, 'Closing the overlay changed the split layout');
      assert.ok(boxes.native.left.y >= await evaluate("document.getElementById('reviewDeck').getBoundingClientRect().bottom"), 'Native chat covers the bot activity deck');
      assert.equal(await evaluate("document.getElementById('animationEnabled').disabled"), false, 'Animation settings cannot be changed during a review');
      const activeRequest = await evaluate('fixture.starts.at(-1)');
      await evaluate("document.getElementById('animationEnabled').click()"); await settle();
      assert.equal(await evaluate("document.getElementById('animationEnabled').checked"), true);
      assert.equal(await evaluate("document.getElementById('effectsButton').getAttribute('aria-pressed')"), 'false');
      assert.equal(await evaluate("localStorage.getItem('converge.galaxy.effectsPaused')"), 'false');
      assert.equal(await evaluate('fixture.state.status'), 'running', 'Animation On stopped the review');
      assert.deepEqual(await evaluate('fixture.starts.at(-1)'), activeRequest, 'Animation On changed the active review request');
      await verifyMovingRibbonsAndStillBackdrop();
      await evaluate("document.getElementById('animationEnabled').click()"); await settle();
      assert.equal(await evaluate("document.getElementById('effectsButton').getAttribute('aria-pressed')"), 'true');
      assert.equal(await evaluate('fixture.state.status'), 'running', 'Settings Off stopped the review');
      assert.deepEqual(await evaluate('fixture.starts.at(-1)'), activeRequest, 'Settings Off changed the active review request');
      await verifyFrozenRibbons('Settings Off during review');
      await evaluate("document.getElementById('animationEnabled').click()"); await settle();
      await verifyMovingRibbonsAndStillBackdrop();
      if (process.env.CONVERGE_LAYOUT_CAPTURE === '1') await fs.writeFile(path.join(root, '.live-test', 'renderer-layout-running.png'), (await win.webContents.capturePage()).toPNG());
      await capture('desktop-working.png');

      // A busy composer is not a transport acknowledgment. A paper moves only
      // after a successful owned peer transfer, once for that exact request.
      await evaluate(`fixture.state={...fixture.state,phase:'review',candidate:{id:'C1',text:'Current candidate',media:{side:'left',files:[{name:'improved.pdf'}]}},pending:{right:{kind:'review',requestId:'qa-review-1',candidateId:'C1'}},pages:{left:{...ready},right:{...ready,busy:true}},lastTransfer:null};fixture.listener(fixture.state)`); await settle();
      assert.equal(await evaluate('fixture.paperAnimations.length'), 0, 'Busy chat produced a fabricated transfer');
      assert.equal(await evaluate("document.getElementById('reviewerRight').classList.contains('active')"), true);
      assert.ok(await evaluate("(()=>{const a=document.querySelector('#botRight .bot-head').getAnimations()[0];return a?.effect.getTiming().iterations===Infinity&&a.effect.getTiming().duration>=20000})()"), 'The working bot lacks a sustained animation loop');
      assert.match(await evaluate("document.getElementById('rightActivity').textContent"), /Checking the other answer/);
      const homeSeparation = await evaluate("document.getElementById('botRight').getBoundingClientRect().x-document.getElementById('botLeft').getBoundingClientRect().x");
      await evaluate(`fixture.state={...fixture.state,lastTransfer:{runId:fixture.state.runId,requestId:'qa-review-1',from:'left',to:'right',candidateId:'C1',hasFiles:true}};fixture.listener(fixture.state)`); await settle();
      assert.equal(await evaluate('fixture.paperAnimations.length'), 1, 'Acknowledged peer file transfer did not move the document');
      const meeting = await evaluate(`(()=>{const bots=['botLeft','botRight'].map(id=>document.getElementById(id));const animations=bots.map(bot=>bot.getAnimations().find(a=>a.effect.getTiming().duration===2800));if(animations.some(a=>!a))return null;animations.forEach(a=>{a.currentTime=1400});const boxes=bots.map(bot=>bot.getBoundingClientRect());return{separation:boxes[1].x-boxes[0].x,meeting:document.getElementById('reviewDeck').classList.contains('meeting')}})()`);
      assert.ok(meeting?.meeting && meeting.separation < homeSeparation * .6, 'Both bots did not approach each other for the acknowledged handoff');
      assert.ok(await evaluate("(()=>{const frames=fixture.paperAnimations.at(-1).frames;return Number(frames[0].transform.match(/translate\\(([-\\d.]+)/)[1])<Number(frames.at(-1).transform.match(/translate\\(([-\\d.]+)/)[1])})()"), 'Left-to-right document moved in the wrong direction');
      assert.match(await evaluate("document.getElementById('bridgeLabel').textContent"), /ANSWER AND FILES SHARED/);
      await evaluate('fixture.listener(fixture.state)'); await settle();
      assert.equal(await evaluate('fixture.paperAnimations.length'), 1, 'Repeated acknowledgment replayed the document');
      if (process.env.CONVERGE_GALAXY_CAPTURE === '1') await fs.writeFile(path.join(root, '.design', 'galaxy-renderer-working.png'), (await win.webContents.capturePage()).toPNG());
      await evaluate("document.getElementById('effectsButton').click()"); await settle();
      assert.equal(await evaluate("document.getElementById('effectsButton').getAttribute('aria-pressed')"), 'true');
      assert.equal(await evaluate("localStorage.getItem('converge.galaxy.effectsPaused')"), 'true');
      assert.equal(await evaluate("document.getElementById('animationEnabled').checked"), false, 'Header pause and Settings Off disagree');
      await verifyFrozenRibbons('Header Pause during review');
      assert.equal(await evaluate("document.getElementById('handoffDocument').classList.contains('confirmed')"), false, 'Pausing effects left a moving paper visible');
      assert.equal(await evaluate("document.getElementById('reviewDeck').classList.contains('meeting')"), false, 'Pausing left the bots stuck in their meeting state');
      assert.equal(await evaluate("document.getElementById('botLeft').getAnimations().length+document.getElementById('botRight').getAnimations().length"), 0, 'Pausing did not cancel bot travel');
      await evaluate(`fixture.state={...fixture.state,lastTransfer:{...fixture.state.lastTransfer,requestId:'qa-paused-transfer'}};fixture.listener(fixture.state)`); await settle();
      assert.equal(await evaluate('fixture.paperAnimations.length'), 1, 'Paused effects still animated a file transfer');
      await evaluate("document.getElementById('effectsButton').click();fixture.listener(fixture.state)"); await settle();
      assert.equal(await evaluate("document.getElementById('animationEnabled').checked"), true, 'Header resume and Settings On disagree');
      await verifyMovingRibbonsAndStillBackdrop();
      assert.equal(await evaluate('fixture.paperAnimations.length'), 1, 'Resuming effects replayed an old paused transfer');
      await evaluate(`fixture.state={...fixture.state,candidate:{...fixture.state.candidate,id:'C2',media:{side:'right',files:[{name:'improved.pdf'}]}},pending:{left:{kind:'review',requestId:'qa-review-2',candidateId:'C2'}},pages:{left:{...ready,busy:true},right:{...ready}},lastTransfer:{runId:fixture.state.runId,requestId:'qa-review-2',from:'right',to:'left',candidateId:'C2',hasFiles:false}};fixture.listener(fixture.state)`); await settle();
      assert.equal(await evaluate('fixture.paperAnimations.length'), 2, 'Reverse peer answer exchange did not animate');
      assert.ok(await evaluate("(()=>{const frames=fixture.paperAnimations.at(-1).frames;return Number(frames[0].transform.match(/translate\\(([-\\d.]+)/)[1])>Number(frames.at(-1).transform.match(/translate\\(([-\\d.]+)/)[1])})()"), 'Right-to-left document moved in the wrong direction');
      assert.equal(await evaluate("document.getElementById('bridgeLabel').textContent"), 'ANSWER SHARED');
      await evaluate(`fixture.hidden=true;document.dispatchEvent(new Event('visibilitychange'));fixture.state={...fixture.state,lastTransfer:{...fixture.state.lastTransfer,requestId:'qa-hidden-transfer'}};fixture.listener(fixture.state)`); await settle();
      assert.equal(await evaluate('fixture.paperAnimations.length'), 2, 'Hidden workspace animated a transfer');
      assert.equal(await evaluate("document.body.classList.contains('document-hidden')"), true);
      await verifyFrozenRibbons('Hidden document');
      await evaluate("fixture.hidden=false;document.dispatchEvent(new Event('visibilitychange'));fixture.listener(fixture.state)"); await settle();
      assert.equal(await evaluate('fixture.paperAnimations.length'), 2, 'Showing workspace replayed the hidden transfer');
      await evaluate(`fixture.state={...fixture.state,status:'error',lastTransfer:{...fixture.state.lastTransfer,requestId:'qa-failed-transfer'}};fixture.listener(fixture.state)`); await settle();
      assert.equal(await evaluate('fixture.paperAnimations.length'), 2, 'Error state animated a successful exchange');
      assert.equal(await evaluate("document.getElementById('reviewDeck').classList.contains('attention')"), true);
      await evaluate(`fixture.state={...fixture.state,status:'running',runId:'restored-run',lastTransfer:{...fixture.state.lastTransfer,runId:'restored-run',requestId:'existing-transfer'}};fixture.listener(fixture.state)`); await settle();
      assert.equal(await evaluate('fixture.paperAnimations.length'), 2, 'Restored run replayed its old transfer');
      await evaluate(`fixture.state={...fixture.state,lastTransfer:null,sourceReadbacksBySide:{left:{candidateId:'C2',requestId:'qa-source-ack'}}};fixture.listener(fixture.state)`); await settle();
      assert.equal(await evaluate('fixture.paperAnimations.length'), 3, 'Actual readable-source acknowledgment fallback did not animate');
      await evaluate(`fixture.state={...fixture.state,lastTransfer:{runId:fixture.state.runId,requestId:'qa-self-review',from:'right',to:'right',candidateId:'C2',hasFiles:true}};fixture.listener(fixture.state)`); await settle();
      assert.equal(await evaluate('fixture.paperAnimations.length'), 3, 'Same-page self review pretended to transfer to the other bot');

      win.webContents.debugger.attach('1.3');
      await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {features:[{name:'prefers-reduced-motion',value:'reduce'}]}); await settle();
      await waitForUi("document.getElementById('effectsButton').disabled && document.body.classList.contains('effects-paused')");
      assert.equal(await evaluate("matchMedia('(prefers-reduced-motion: reduce)').matches"), true);
      assert.equal(await evaluate("document.getElementById('effectsButton').disabled"), true);
      assert.equal(await evaluate("document.body.classList.contains('effects-paused')"), true);
      assert.equal(await evaluate("document.getElementById('animationEnabled').disabled"), true);
      assert.equal(await evaluate("document.getElementById('animationEnabled').checked"), false);
      await verifyFrozenRibbons('System reduced motion');
      await evaluate(`fixture.state={...fixture.state,lastTransfer:{runId:fixture.state.runId,requestId:'qa-reduced-transfer',from:'right',to:'left',candidateId:'C2',hasFiles:true}};fixture.listener(fixture.state)`); await settle();
      assert.equal(await evaluate('fixture.paperAnimations.length'), 3, 'Reduced-motion preference was ignored for transfer');
      await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {features:[{name:'prefers-reduced-motion',value:'no-preference'}]}); await settle();
      await waitForUi("!document.getElementById('effectsButton').disabled && !document.body.classList.contains('effects-paused')");
      win.webContents.debugger.detach();

      await evaluate("document.getElementById('toggleSidebar').click()"); await settle();
      boxes = await geometry();
      assert.ok(boxes.drawer.y >= boxes.deck.bottom - 1, 'Reopening the controls covers the bot stage');
      assert.ok(boxes.native.left.x >= boxes.drawer.right - 1, 'Reopened drawer is covered by a native chat');
      assert.equal(boxes.right.x, originalRightX, 'Opening the overlay reflowed the split layout');
      assert.equal(await evaluate("document.getElementById('reviewMode').disabled"), true, 'Running review style is editable');
      await evaluate("document.getElementById('closeSidebar').click()"); await settle();
      await evaluate('fixture.finish()'); await settle();
      assert.equal(await evaluate("document.getElementById('resultContent').hidden"), true, 'Completion expanded the drawer without a user click');
      await evaluate("fixture.state={...fixture.state,requiredWork:[{id:'mt5-backtest'}]};fixture.listener(fixture.state)"); await settle();
      assert.equal(await evaluate("document.getElementById('reviewerRight').classList.contains('ready')"), false, 'Model agreement implied independent native tests passed');
      assert.equal(await evaluate("document.getElementById('reviewDeck').classList.contains('attention')"), true);
      assert.match(await evaluate("document.getElementById('rightActivity').textContent"), /verify tests/);
      await evaluate('fixture.state={...fixture.state,requiredWork:[]};fixture.listener(fixture.state)'); await settle();
      assert.match(await evaluate("document.getElementById('bottomFiles').textContent"), /improved\.pdf/);
      assert.equal(await evaluate("document.getElementById('saveFilesCompact').disabled"), false);
      const closedHeight = (await geometry()).left.height;
      await evaluate("document.getElementById('toggleResults').click()"); await settle();
      assert.equal(await evaluate("document.getElementById('resultContent').hidden"), false);
      boxes = await geometry();
      assert.ok(boxes.left.height < closedHeight, 'The bottom drawer did not shrink native chat bounds');
      assert.ok(boxes.native.left.y + boxes.native.left.height <= boxes.result.y + 1, 'Native chat covers the open bottom drawer');
      assert.match(await evaluate("document.getElementById('answerOutputs').textContent"), /improved\.pdf/);
      assert.match(await evaluate("document.getElementById('improvementSummary').textContent"), /No candidate revisions/);
      assert.match(await evaluate("document.getElementById('statusDetail').textContent"), /no demonstrated improvement/);
      await evaluate(`fixture.state={...fixture.state,revisionCount:1,candidate:{...fixture.state.candidate,id:'C2'},candidateHistory:[{id:'C1',text:'Original draft'}],improvementTrail:[{from:'C1',to:'C2',fileChanged:true,verified:true,changes:[{change:'Corrected the equation <img src=x>',benefit:'The worked example is consistent',evidence:'Independent substitution'}]}]};fixture.listener(fixture.state)`); await settle();
      assert.match(await evaluate("document.getElementById('improvementSummary').textContent"), /1 candidate revision/);
      assert.match(await evaluate("document.getElementById('improvementTrail').textContent"), /C1 → C2.*file replaced.*checked by both/);
      assert.equal(await evaluate("document.getElementById('improvementTrail').querySelectorAll('img').length"), 0, 'Model-supplied improvement descriptions became executable markup');
      assert.equal(await evaluate("document.getElementById('originalAnswer').textContent"), 'Original draft');
      assert.equal(await evaluate("document.getElementById('originalAnswerDetails').hidden"), false);
      if (process.env.CONVERGE_LAYOUT_CAPTURE === '1') await fs.writeFile(path.join(root, '.live-test', 'renderer-layout-outputs.png'), (await win.webContents.capturePage()).toPNG());
      await capture('desktop-results.png');
      if (process.env.CONVERGE_GALAXY_CAPTURE === '1') await fs.writeFile(path.join(root, '.design', 'galaxy-renderer-outputs.png'), (await win.webContents.capturePage()).toPNG());
      if (process.env.CONVERGE_GALAXY_CAPTURE === '1') {
        await evaluate("document.getElementById('answerPanel').scrollTop=document.getElementById('answerPanel').scrollHeight"); await settle();
        await fs.writeFile(path.join(root, '.design', 'galaxy-renderer-files.png'), (await win.webContents.capturePage()).toPNG());
      }
      await evaluate("document.getElementById('toggleResults').click();document.getElementById('saveFilesCompact').click()"); await settle();
      assert.equal(await evaluate('fixture.saves'), 1, 'Collapsed Save did not use the file save control');
      assert.match(await evaluate("document.getElementById('fileSaveStatus').textContent"), /Saved improved\.pdf/);

      await evaluate("document.getElementById('toggleSidebar').click()"); await chooseMode('improve');
      await evaluate("document.getElementById('maxRounds').value='1';document.getElementById('maxRounds').dispatchEvent(new Event('input',{bubbles:true}))");
      assert.equal(await evaluate("document.getElementById('maxRounds').value"), '4');
      await start('Refine the image composition');
      assert.equal(await evaluate('fixture.starts.at(-1).reviewMode'), 'improve');
      assert.equal(await evaluate('fixture.starts.at(-1).maxRounds'), 4);
      assert.match(await evaluate("document.getElementById('reviewSummary').textContent"), /At least 4 improvement rounds/);
      await evaluate('fixture.finish()'); await settle();
      await evaluate("document.getElementById('toggleSidebar').click()"); await chooseMode('verify');
      await start('Check the fixed numerical result');
      assert.equal(await evaluate('fixture.starts.at(-1).reviewMode'), 'verify');
      assert.match(await evaluate("document.getElementById('reviewSummary').textContent"), /2 verification steps/);
      await evaluate('fixture.finish()'); await settle();

      win.setSize(900, 650); await settle();
      boxes = await geometry();
      assert.ok((boxes.left.width + boxes.right.width) / boxes.viewport >= .85, 'Compact window loses the chat workspace');
      assert.ok(boxes.deck.height <= 84, 'The compact bot deck consumes more than 84 vertical pixels');
      await evaluate("document.getElementById('toggleSidebar').click();document.getElementById('resetChats').click()"); await settle();
      boxes = await geometry();
      assert.ok(boxes.deck.width / boxes.viewport >= .98, 'Compact window loses its full-width animation');
      assert.ok(boxes.drawer.y >= boxes.deck.bottom - 1, 'Compact controls cover the bots');
      assert.equal(await evaluate("document.getElementById('toggleSidebar').getAttribute('aria-expanded')"), 'true');
      assert.equal(await evaluate("document.getElementById('modeOptions').hidden"), false, 'Reset did not restore the chat type choice');
      assert.equal(await evaluate("document.getElementById('resultContent').hidden"), true);
      await capture('compact-controls.png');
      process.stdout.write('PASS: real renderer workspace layout and review-style regressions: >85% chat width at desktop/compact sizes, native clipping under overlay controls and <=96px desktop / <=84px compact animated bot deck, real 20s+ idle/work loops, successful Start hides controls, progress/round/files in collapsed bottom bar, user-controlled result panel, compact Save, Improve minimum 4, Verify payload, Reset restores chat type choice; real star ribbon assets animate while the full chat backdrop stays still; Settings On/Off remains editable during work, synchronizes with header Pause/Resume and persists through reload; both ribbon frame counters stop under Off/hidden/reduced-motion; galaxy paper follows actual owned acknowledgments in both directions without duplicates, busy-only fabrication, hidden/paused/history/error/self-review replay, and respects genuine reduced-motion CSS/JS preference.\n');
    } finally { win.destroy(); await new Promise((resolve) => server.close(resolve)); }
  }
  app.whenReady().then(run).then(() => app.quit()).catch((error) => { process.stderr.write(`${error.stack}\n`); app.exit(1); });
}
