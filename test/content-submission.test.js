'use strict';

// These regressions run the production bridge in real offscreen Chromium.
// The local fixture reproduces collapsed user bubbles and React replacements;
// it never opens ChatGPT or reads a browser profile.
if (!process.versions.electron) {
  const test = require('node:test');
  const assert = require('node:assert/strict');
  const { spawn } = require('node:child_process');
  test('visible submission stays correlated through collapsed and replaced user turns', { timeout: 65000 }, async () => {
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const output = await new Promise((resolve, reject) => {
      const child = spawn(require('electron'), [__filename], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let log = '';
      child.stdout.on('data', (value) => { log += value; });
      child.stderr.on('data', (value) => { log += value; });
      const timer = setTimeout(() => { child.kill(); reject(new Error(`Chromium submission regression timed out.\n${log}`)); }, 60000);
      child.on('error', (error) => { clearTimeout(timer); reject(error); });
      child.on('close', (code) => { clearTimeout(timer); resolve({ code, log }); });
    });
    assert.equal(output.code, 0, output.log);
    assert.match(output.log, /PASS: 30 actual Chromium submission regressions/);
  });
} else {
  const assert = require('node:assert/strict');
  const fs = require('node:fs/promises');
  const path = require('node:path');
  const http = require('node:http');
  const { app, BrowserWindow } = require('electron');
  const html = `<!doctype html><html><head><style>.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}img{width:128px;height:64px}</style></head><body><main><div id="turns"></div><form>
    <textarea id="prompt-textarea" aria-label="Ask ChatGPT"></textarea>
    <button id="send" data-testid="send-button" type="button">Send</button>
    <button id="stop" data-testid="stop-button" type="button" hidden>Stop</button>
    </form></main><button id="outside-stop" aria-label="Stop">Stop unrelated playback</button><script>
    window.events=[];window.sendClicks=0;window.expandClicks=0;window.stopClicks=0;window.outsideStopClicks=0;window.fixtureMode='decorated';
    window.chrome={runtime:{onMessage:{addListener(listener){window.listener=listener}},sendMessage(event){window.events.push(event);return Promise.resolve({ok:true})}}};
    const turns=document.getElementById('turns'),stop=document.getElementById('stop');let editor=document.getElementById('prompt-textarea');
    function userBubble(text,collapsed){
      const user=document.createElement('div');user.setAttribute(window.fixtureMode.startsWith('modern')?'data-user-message-bubble':'data-message-author-role',window.fixtureMode.startsWith('modern')?'true':'user');
      const body=document.createElement('span');body.textContent=collapsed?text.slice(0,180)+' ...':text;user.append(body);
      user.append(document.createTextNode('\\n'));
      const more=document.createElement('button');more.type='button';more.textContent='Show more';user.append(more);
      more.onclick=()=>{window.expandClicks++;setTimeout(()=>{body.textContent=text;more.textContent='Show less'},15)};
      const copy=document.createElement('button');copy.type='button';copy.textContent='Copy';user.append(copy);
      return user;
    }
    document.getElementById('send').onclick=()=>{
      window.sendClicks++;let text=editor.value;editor.value='';stop.hidden=false;
      if(window.fixtureMode==='wrong-marker')text=text.replace(/(Exchange tracking ID[^:]*: \\S+)$/,'$1-wrong');
      let user=userBubble(text,window.fixtureMode.includes('collapsed'));turns.append(user);
      if(window.fixtureMode.includes('virtualized')){
        const old=[...turns.querySelectorAll('[data-user-message-bubble="true"]')].filter(node=>node!==user);
        old.slice(0,window.fixtureMode.includes('lower')?4:1).forEach(node=>{const following=node.nextElementSibling;if(following?.querySelector('h4[data-conversation-role="assistant"]'))following.remove();node.remove()});
      }
      if(window.fixtureMode==='modern-rehydrated-history')setTimeout(()=>{
        for(let i=0;i<8;i++){const old=userBubble('Earlier unmounted user '+i,false);turns.prepend(old)}
      },100);
      if(window.fixtureMode==='modern-virtualized-external')setTimeout(()=>{
        const human=userBubble('A new external user interrupted',false);turns.append(human);turns.querySelector('[data-user-message-bubble="true"]').remove()
      },100);
      if(window.fixtureMode.includes('replaced'))setTimeout(()=>{const next=userBubble(text,window.fixtureMode.includes('collapsed'));user.replaceWith(next);user=next},70);
      if(window.fixtureMode==='manual')setTimeout(()=>{const next=document.createElement('div');next.setAttribute('data-message-author-role','user');next.textContent='A newer human message';turns.append(next)},70);
      if(window.fixtureMode==='new-chat-url')setTimeout(()=>history.pushState({},'', '/c/fixture-created'),70);
      if(window.fixtureMode==='query-url')setTimeout(()=>history.pushState({},'', '?model=fixture#latest'),70);
      if(window.fixtureMode==='different-chat-url')setTimeout(()=>history.pushState({},'', '/c/different-chat'),70);
      if(window.fixtureMode==='local-chat-url'||window.fixtureMode==='local-chat-switched'){
        history.pushState({},'', '/c/local-chatgpt%3A7092af08-e26b-437b-a3be-d38baeef6eb4');
        setTimeout(()=>history.pushState({},'', '/c/6abd8f42-8c5c-83ee-a977-b6509a31b850'),70);
        if(window.fixtureMode==='local-chat-switched')setTimeout(()=>history.pushState({},'', '/c/a-different-final-conversation'),140);
      }
      if(window.fixtureMode==='initial-local-chat-url')setTimeout(()=>history.pushState({},'', '/c/6abd8f42-8c5c-83ee-a977-b6509a31b850'),70);
      if(window.fixtureMode!=='stop-replaced'&&window.fixtureMode!=='composer-stop-cancel')setTimeout(()=>{
        if(window.fixtureMode!=='paused-stop')stop.hidden=true;const reply=document.createElement('div');
        if(window.fixtureMode.startsWith('modern')){
          reply.style.display='contents';const heading=document.createElement('h4');heading.className='sr-only';heading.setAttribute('data-conversation-role','assistant');heading.textContent='ChatGPT said:';reply.append(heading);
          const body=document.createElement('div');reply.append(body);
          if(window.fixtureMode==='modern-image-only'){
            const preview=document.createElement('button');preview.type='button';preview.setAttribute('data-testid','generated-image-preview');const image=document.createElement('img');image.alt='Generated image 1';
            const canvas=document.createElement('canvas');canvas.width=128;canvas.height=64;canvas.getContext('2d').fillRect(0,0,128,64);image.src=canvas.toDataURL('image/png');preview.append(image);body.append(preview);
            const edit=document.createElement('button');edit.textContent='Edit';body.append(edit);
          }else body.textContent='Completed correlated reply';
        }else{reply.setAttribute('data-message-author-role','assistant');reply.textContent='Completed correlated reply'}turns.append(reply)
      },300);
      if(window.fixtureMode==='paused-stop')setTimeout(()=>{stop.hidden=true},4200);
    };
    stop.onclick=()=>{window.stopClicks++;stop.hidden=true};
    document.getElementById('outside-stop').onclick=()=>{window.outsideStopClicks++};
    </script></body></html>`;

  async function run() {
    const source = await fs.readFile(path.join(__dirname, '..', 'chrome-extension', 'content.js'), 'utf8');
    const server = http.createServer((_request, response) => { response.writeHead(200, { 'Content-Type': 'text/html;charset=utf-8' }); response.end(html); });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const win = new BrowserWindow({ show: false, width: 900, height: 700, webPreferences: { offscreen: true, contextIsolation: false, nodeIntegration: false } });
    const evaluate = (code) => win.webContents.executeJavaScript(code);
    const command = (message) => evaluate(`new Promise(resolve=>window.listener(${JSON.stringify(message)},null,resolve))`);
    const terminal = (id) => evaluate(`new Promise((resolve,reject)=>{const start=Date.now();const timer=setInterval(()=>{
      const event=window.events.find(event=>['REPLY','ERROR'].includes(event.type)&&event.requestId===${JSON.stringify(id)});
      if(event){clearInterval(timer);resolve(event)}else if(Date.now()-start>3500){clearInterval(timer);reject(Error('No reply/error event for '+${JSON.stringify(id)}+'; '+JSON.stringify({mode:fixtureMode,users:document.querySelectorAll('[data-user-message-bubble="true"], [data-message-author-role="user"]').length,assistants:document.querySelectorAll('div:has(>h4[data-conversation-role="assistant"]),[data-message-author-role="assistant"]').length,stopVisible:!document.getElementById('stop').hidden,events:events.map(item=>item.type)})))}},10)})`);
    const setup = async (mode, urlPath = '/') => {
      await win.loadURL(origin + urlPath);
      await evaluate(`window.fixtureMode=${JSON.stringify(mode)};if(['paused-stop','composer-stop-cancel'].includes(window.fixtureMode)){document.getElementById('stop').removeAttribute('data-testid');document.getElementById('stop').setAttribute('aria-label','Stop')};(function(){const module={exports:{}};${source}\nmodule.exports.createBridge({chrome:window.chrome,document,window,options:{settleMs:window.fixtureMode==='paused-stop'?3000:50,tickMs:10,sendSettleMs:10}})})()`);
    };
    const prompt = (id) => ({ type: 'SEND_PROMPT', chatMode: 'normal', runId: 'submission-regression', requestId: id, relayMedia: id === 'modern-image-only',
      text: 'Read the user task in full.\n\n' + 'Keep every instruction intact, check the result, and give a useful answer. '.repeat(18) + `\n\nExchange tracking ID (do not include in your JSON): ${id}` });
    let passed = 0;
    try {
      for (const mode of ['decorated', 'collapsed', 'replaced', 'replaced-collapsed', 'new-chat-url', 'query-url', 'modern-collapsed', 'modern-replaced', 'modern-replaced-collapsed', 'modern-image-only', 'local-chat-url', 'initial-local-chat-url']) {
        await setup(mode, mode === 'initial-local-chat-url' ? '/c/local-chatgpt%3A7092af08-e26b-437b-a3be-d38baeef6eb4' : '/');
        const sent = await command(prompt(mode));
        assert.equal(sent.ok, true, `${mode}: ${sent.error}`);
        const result = await terminal(mode);
        assert.equal(result.type, 'REPLY', `${mode}: ${result.error}`);
        assert.equal(result.text, mode === 'modern-image-only' ? '' : 'Completed correlated reply');
        if (mode === 'modern-image-only') {
          assert.equal(result.media.length, 1, 'Generated image under zero-box assistant root was missed');
          const exported = await command({ type: 'EXPORT_MEDIA', runId: result.runId, requestId: result.requestId, ids: result.media.map((item) => item.id) });
          assert.equal(exported.ok, true, `Zero-box assistant media export failed: ${exported.error}`);
          assert.ok(exported.files[0].base64.length > 10);
        }
        const counts = await evaluate('({sends:sendClicks,expands:expandClicks})');
        assert.equal(counts.sends, 1, `${mode}: duplicate submission`);
        if (mode.includes('collapsed')) assert.ok(counts.expands >= 1, `${mode}: omitted text was not expanded`);
        passed++;
      }
      await setup('wrong-marker');
      const wrong = await command(prompt('wrong-marker'));
      assert.equal(wrong.ok, false, 'A fresh user turn with another request ID was accepted');
      assert.equal((await terminal('wrong-marker')).type, 'ERROR');
      assert.equal(await evaluate('sendClicks'), 1); passed++;

      await setup('manual');
      assert.equal((await command(prompt('manual'))).ok, true);
      assert.equal((await terminal('manual')).type, 'ERROR');
      assert.equal(await evaluate('stopClicks'), 0, 'The newer human generation was stopped'); passed++;

      await setup('different-chat-url', '/c/original-chat');
      assert.equal((await command(prompt('different-chat-url'))).ok, true);
      assert.equal((await terminal('different-chat-url')).type, 'ERROR');
      assert.equal(await evaluate('stopClicks'), 0, 'Another conversation was stopped'); passed++;

      await setup('local-chat-switched');
      assert.equal((await command(prompt('local-chat-switched'))).ok, true);
      assert.equal((await terminal('local-chat-switched')).type, 'ERROR', 'A finalized conversation was allowed to switch again');
      const diagnostic = await command({ type: 'DIAGNOSTICS' });
      assert.equal(diagnostic.diagnostics.submission.originalPath, '/');
      assert.equal(diagnostic.diagnostics.submission.currentPath, '/c/a-different-final-conversation');
      assert.equal(diagnostic.diagnostics.submission.acceptedPath, '/c/6abd8f42-8c5c-83ee-a977-b6509a31b850');
      assert.equal(diagnostic.diagnostics.submission.matchedOwnTurn, true);
      assert.doesNotMatch(JSON.stringify(diagnostic), /Keep every instruction|Exchange tracking ID|submission-regression/);
      assert.equal(await evaluate('stopClicks'), 0, 'The different final conversation was stopped'); passed++;

      await setup('stop-replaced');
      assert.equal((await command(prompt('stop-replaced'))).ok, true);
      await evaluate(`new Promise(resolve=>setTimeout(()=>{const old=document.querySelector('[data-message-author-role="user"]');old.replaceWith(old.cloneNode(true));resolve()},80))`);
      assert.equal((await command({ type: 'CANCEL', runId: 'submission-regression' })).ok, true);
      assert.equal(await evaluate('stopClicks'), 1, 'Owned generation was not stopped after its user node changed'); passed++;

      await setup('paused-stop');
      assert.equal((await command(prompt('paused-stop'))).ok, true);
      await evaluate('new Promise(resolve=>setTimeout(resolve,3750))');
      assert.equal(await evaluate("window.events.some(event=>event.type==='REPLY')"), false, 'A stable response was emitted during a three-second streaming pause');
      assert.equal((await terminal('paused-stop')).type, 'REPLY');
      assert.equal(await evaluate('outsideStopClicks'), 0); passed++;

      for (const labelled of [true, false]) {
        await setup('decorated');
        await evaluate(`window.upgradeClicks=0;const group=document.createElement('div');group.setAttribute('role','group');group.setAttribute('aria-label','Composer mode');
          group.innerHTML='<button aria-pressed="true">Chat</button><button aria-pressed="false" ${labelled ? 'aria-label="Work"' : ''}><span>Work</span><span>Requires upgrade</span></button>';
          group.lastElementChild.onclick=()=>window.upgradeClicks++;document.querySelector('main').append(group);
          const header=document.createElement('header');header.innerHTML='<button aria-pressed="true">Temporary</button>';document.body.append(header);`);
        const blocked = await command({ type: 'PREPARE', chatMode: 'work' });
        assert.equal(blocked.ready, false);
        assert.match(blocked.reason, /This ChatGPT account shows Work requires upgrade/);
        const rejected = await command({ ...prompt('restricted-work'), chatMode: 'work' });
        assert.equal(rejected.ok, false);
        assert.equal(await evaluate('sendClicks'), 0);
        assert.equal(await evaluate('upgradeClicks'), 0, 'A restricted Work button opened its upgrade action');
        assert.equal((await command({ type: 'INSPECT', chatMode: 'normal' })).ready, true);
        assert.equal((await command({ type: 'INSPECT', chatMode: 'temporary', requireUnpersonalized: false })).ready, true);
        assert.equal(await evaluate('upgradeClicks'), 0); passed++;
      }

      const seedHistory = () => evaluate(`for(let i=0;i<5;i++){const user=userBubble('Old historical user '+i,false);turns.append(user);const reply=document.createElement('div');reply.style.display='contents';reply.innerHTML='<h4 class="sr-only" data-conversation-role="assistant">ChatGPT said:</h4><div>Old historical answer '+i+'</div>';turns.append(reply)}`);
      for (const mode of ['modern-virtualized-same', 'modern-virtualized-lower', 'modern-rehydrated-history']) {
        await setup(mode, '/c/existing-conversation'); await seedHistory();
        const sent = await command(prompt(mode));
        assert.equal(sent.ok, true, `${mode}: ${sent.error}`);
        const reply = await terminal(mode);
        assert.equal(reply.type, 'REPLY', `${mode}: ${reply.error}`);
        assert.equal(reply.text, 'Completed correlated reply');
        const diagnostic = await command({ type: 'DIAGNOSTICS' });
        assert.equal(diagnostic.diagnostics.submission.baselineUserCount, 5);
        if (mode.endsWith('same')) assert.equal(diagnostic.diagnostics.submission.userCount, 5);
        if (mode.endsWith('lower')) assert.equal(diagnostic.diagnostics.submission.userCount, 2);
        if (mode === 'modern-rehydrated-history') assert.equal(diagnostic.diagnostics.submission.userCount, 14);
        assert.equal(diagnostic.diagnostics.submission.matchedOwnTurn, true);
        assert.equal(await evaluate('sendClicks'), 1); passed++;
      }

      await setup('modern-virtualized-external', '/c/existing-conversation'); await seedHistory();
      assert.equal((await command(prompt('modern-virtualized-external'))).ok, true);
      assert.equal((await terminal('modern-virtualized-external')).type, 'ERROR', 'External latest user was accepted after virtualized history removal');
      assert.equal(await evaluate('stopClicks'), 0, 'An external user generation was stopped'); passed++;

      await setup('modern-stale-marker', '/c/existing-conversation'); await seedHistory();
      const duplicate = prompt('modern-stale-marker');
      await evaluate(`turns.append(userBubble(${JSON.stringify(duplicate.text)},false))`);
      const rejected = await command(duplicate);
      assert.equal(rejected.ok, false);
      assert.match(rejected.error, /tracking ID already appears/);
      assert.equal(await evaluate('sendClicks'), 0, 'A pre-existing marker was submitted again');
      assert.equal(await evaluate("document.getElementById('prompt-textarea').value"), ''); passed++;

      await setup('modern-work-composer', '/c/existing-work-conversation');
      await evaluate(`const rich=document.createElement('div');rich.id='prompt-textarea';rich.contentEditable='true';rich.setAttribute('role','textbox');rich.setAttribute('aria-label','Work with ChatGPT');rich.setAttribute('data-composer-markdown','');rich.style.minHeight='32px';rich.innerHTML='<p data-placeholder="Work with ChatGPT"><br></p>';
        Object.defineProperty(rich,'value',{get(){return this.innerText},set(value){this.textContent=value}});editor.replaceWith(rich);editor=rich;`);
      for (const id of ['work-editor-first','work-editor-followup']) {
        const ready=await command({type:'INSPECT',chatMode:'work'});
        assert.equal(ready.work,true,'The explicit current Work editor was not recognized');
        assert.equal(ready.ready,true,ready.reason);
        const sent=await command({...prompt(id),chatMode:'work'});
        assert.equal(sent.ok,true,sent.error);
        assert.equal((await terminal(id)).type,'REPLY');
        const after=await command({type:'INSPECT',chatMode:'work'});
        assert.equal(after.work,true,'Work evidence disappeared after the reply');
        assert.equal(after.ready,true,after.reason);
      }
      assert.equal(await evaluate('sendClicks'),2,'The follow-up did not reuse the same Work conversation'); passed++;

      await setup('modern-work-history', '/c/existing-normal-conversation');
      await evaluate(`turns.append(userBubble('Work with ChatGPT',false));const historical=document.createElement('div');historical.contentEditable='true';historical.setAttribute('role','textbox');historical.setAttribute('aria-label','Work with ChatGPT');historical.textContent='An editor for an old message';turns.lastElementChild.append(historical)`);
      const historical=await command({type:'INSPECT',chatMode:'work'});
      assert.equal(historical.work,null,'A historical Work phrase/editor verified the current mode');
      assert.equal(historical.ready,false);
      assert.equal((await command({...prompt('historical-work-blocked'),chatMode:'work'})).ok,false);
      assert.equal(await evaluate('sendClicks'),0); passed++;

      await setup('composer-stop-cancel');
      assert.equal((await command(prompt('composer-stop-cancel'))).ok, true);
      const inFlight = await command({ type: 'INSPECT', chatMode: 'normal' });
      assert.equal(inFlight.busy, true);
      assert.equal((await command({ type: 'CANCEL', runId: 'submission-regression' })).ok, true);
      assert.equal(await evaluate('stopClicks'), 1, 'Current composer Stop without a test ID was not clicked');
      assert.equal(await evaluate('outsideStopClicks'), 0); passed++;

      await setup('decorated');
      const idle = await command({ type: 'INSPECT', chatMode: 'normal' });
      assert.equal(idle.ready, true, 'An unrelated Stop button marked the composer busy');
      assert.equal(idle.busy, false);
      assert.equal((await command({ type: 'CANCEL', runId: 'unowned-idle-run' })).ok, true);
      assert.equal(await evaluate('outsideStopClicks'), 0); passed++;

      await setup('decorated');
      assert.equal((await command(prompt('deduplicated'))).ok, true);
      assert.equal((await command(prompt('deduplicated'))).pending, true);
      assert.equal((await terminal('deduplicated')).type, 'REPLY');
      assert.equal(await evaluate('sendClicks'), 1); passed++;
      assert.equal(passed, 30);
      process.stdout.write('PASS: 30 actual Chromium submission regressions: virtualized same/lower/remounted history, modern/collapsed/replaced turns, display:contents image export, local-to-server promotion, safe diagnostics/navigation, composer-local Stop through three-second pauses, persistent current Work editor and historical-label rejection, Work upgrade gating, wrong/stale marker, human interruption, safe Stop, and no duplicate Send.\n');
    } finally { win.destroy(); await new Promise((resolve) => server.close(resolve)); }
  }
  app.whenReady().then(run).then(() => app.quit()).catch((error) => { process.stderr.write(`${error.stack}\n`); app.exit(1); });
}
