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
    assert.match(output.log, /PASS: 103 actual Chromium submission regressions/);
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
    window.events=[];window.sendClicks=0;window.expandClicks=0;window.stopClicks=0;window.retryClicks=0;window.outsideStopClicks=0;window.fixtureMode='decorated';
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
      if(window.fixtureMode==='modern-current-unmounted')setTimeout(()=>{user.remove();setTimeout(()=>turns.append(user),120)},70);
      if(window.fixtureMode==='manual')setTimeout(()=>{const next=document.createElement('div');next.setAttribute('data-message-author-role','user');next.textContent='A newer human message';turns.append(next)},70);
      if(window.fixtureMode==='new-chat-url')setTimeout(()=>history.pushState({},'', '/c/fixture-created'),70);
      if(window.fixtureMode==='query-url')setTimeout(()=>history.pushState({},'', '?model=fixture#latest'),70);
      if(window.fixtureMode==='different-chat-url')setTimeout(()=>history.pushState({},'', '/c/different-chat'),70);
      if(window.fixtureMode==='modern-navigation-return'){
        const original=location.href;
        setTimeout(()=>history.pushState({},'', '/'),70);
        setTimeout(()=>history.replaceState({},'', original),125);
      }
      if(window.fixtureMode==='local-chat-url'||window.fixtureMode==='local-chat-switched'){
        history.pushState({},'', '/c/local-chatgpt%3A7092af08-e26b-437b-a3be-d38baeef6eb4');
        setTimeout(()=>history.pushState({},'', '/c/6abd8f42-8c5c-83ee-a977-b6509a31b850'),70);
        if(window.fixtureMode==='local-chat-switched')setTimeout(()=>history.pushState({},'', '/c/a-different-final-conversation'),140);
      }
      if(window.fixtureMode==='initial-local-chat-url')setTimeout(()=>history.pushState({},'', '/c/6abd8f42-8c5c-83ee-a977-b6509a31b850'),70);
      const completeReply=()=>{
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
      };
      if(window.fixtureMode!=='stop-replaced'&&window.fixtureMode!=='composer-stop-cancel'){
        if(window.fixtureMode==='modern-controlled-response')window.releaseResponse=completeReply;
        else setTimeout(completeReply,300);
      }
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
      await evaluate(`window.fixtureMode=${JSON.stringify(mode)};
        if(window.fixtureMode==='modern-controlled-response'){
          window.scheduledDelays=[];const originalSetTimeout=window.setTimeout;
          window.setTimeout=(callback,delay,...argumentsFromCaller)=>{scheduledDelays.push(Number(delay));return originalSetTimeout(callback,delay,...argumentsFromCaller)};
        }
        if(['paused-stop','composer-stop-cancel'].includes(window.fixtureMode)){document.getElementById('stop').removeAttribute('data-testid');document.getElementById('stop').setAttribute('aria-label','Stop')};(function(){const module={exports:{}};${source}\nmodule.exports.createBridge({chrome:window.chrome,document,window,options:{settleMs:window.fixtureMode==='paused-stop'?3000:50,tickMs:10,sendSettleMs:10,navigationGraceMs:150,resumeIdentityTimeoutMs:150}})})()`);
    };
    const prompt = (id) => ({ type: 'SEND_PROMPT', chatMode: 'normal', runId: 'submission-regression', requestId: id, relayMedia: id === 'modern-image-only',
      text: 'Read the user task in full.\n\n' + 'Keep every instruction intact, check the result, and give a useful answer. '.repeat(18) + `\n\nExchange tracking ID (do not include in your JSON): ${id}` });
    let passed = 0;
    try {
      for (const mode of ['decorated', 'collapsed', 'replaced', 'replaced-collapsed', 'new-chat-url', 'query-url', 'modern-collapsed', 'modern-replaced', 'modern-replaced-collapsed', 'modern-image-only', 'modern-current-unmounted', 'local-chat-url', 'initial-local-chat-url']) {
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
        if (mode === 'modern-current-unmounted') {
          assert.equal(await evaluate('stopClicks'), 0, 'A temporarily unmounted owned request stopped its generation.');
          assert.equal(await evaluate(`events.some(event=>event.type==='ERROR'&&event.requestId===${JSON.stringify(mode)})`), false);
        }
        if (mode.includes('collapsed')) assert.ok(counts.expands >= 1, `${mode}: omitted text was not expanded`);
        passed++;
      }
      await setup('wrong-marker');
      const wrong = await command(prompt('wrong-marker'));
      assert.equal(wrong.ok, false, 'A fresh user turn with another request ID was accepted');
      assert.equal((await terminal('wrong-marker')).type, 'ERROR');
      assert.equal(await evaluate('sendClicks'), 1); passed++;

      const finalControlText = JSON.stringify({ candidate_id: 'C1', candidate_sha256: 'a'.repeat(64), agree: true,
        checks: ['Verified "final.txt"; literal reference :chatgpt-content-reference{index="0"}.'], issues: [] });
      const controlDOM = async ({ control = finalControlText, second = null, header = true, download = false } = {}) => evaluate(`
        stop.hidden=true;
        const reply=document.createElement('div');reply.setAttribute('data-message-author-role','assistant');
        const tool=document.createElement('div');tool.className='markdown';tool.setAttribute('data-tool-result','true');
        const toolPre=document.createElement('pre');const toolCode=document.createElement('code');toolCode.className='language-json';toolCode.textContent='{"stdout":"tool inspection","result":17}';toolPre.append(toolCode);tool.append(toolPre);reply.append(tool);
        const final=document.createElement('div');final.setAttribute('data-markdown-text-style','assistant-message');
        const codeBlock=raw=>{const block=document.createElement('div');block.setAttribute('data-markdown-copy','code-block');
          ${header ? "const label=document.createElement('div');label.setAttribute('data-markdown-copy','exclude');label.innerHTML='<span>JSON</span><button>Copy code</button>';block.append(label);" : ''}
          const pre=document.createElement('pre');const code=document.createElement('code');${header ? '' : "code.className='language-json';"}code.textContent=raw;pre.append(code);block.append(pre);final.append(block)};
        codeBlock(${JSON.stringify(control)});${second === null ? '' : `codeBlock(${JSON.stringify(second)});`}
        const reference=document.createElement('span');reference.setAttribute('data-testid','chatgpt-library-file-citation');reference.textContent=':chatgpt-content-reference{index="0"}';final.append(reference);
        ${download ? "const link=document.createElement('a');link.href=location.origin+'/files/final.txt';link.download='final.txt';link.textContent='Download final.txt';final.append(link);window.fetch=async()=>new Response('Final exact artifact\\n',{headers:{'content-type':'text/plain'}});" : ''}
        reply.append(final);turns.append(reply);`);
      for (const [id, metadata, header] of [
        ['control-fence-copy-header', true, true],
        ['control-fence-language-class', true, false],
        ['unmarked-control-fences', false, true],
      ]) {
        await setup('modern-controlled-response');
        assert.equal((await command({ ...prompt(id), relayMedia: metadata,
          ...(metadata ? { responseFormat: 'control-json' } : {}) })).ok, true);
        await controlDOM({ header, download: metadata });
        const delivered = await terminal(id);
        assert.equal(delivered.type, 'REPLY', delivered.error);
        if (metadata) {
          assert.equal(delivered.text, finalControlText, 'Control extraction must keep CODE.textContent quotes and escapes exactly.');
          assert.deepEqual(JSON.parse(delivered.text), JSON.parse(finalControlText));
          assert.equal(delivered.media.length, 1, 'Selecting control JSON must not drop a download beside its fence.');
          const file = await command({ type: 'EXPORT_MEDIA', runId: delivered.runId, requestId: delivered.requestId, ids: delivered.media.map(item => item.id) });
          assert.equal(file.ok, true, file.error);
          assert.equal(Buffer.from(file.files[0].base64, 'base64').toString(), 'Final exact artifact\n');
        } else {
          assert.notEqual(delivered.text, finalControlText, 'Unmarked worker prose must not opt into control-only extraction.');
          assert.match(delivered.text, /tool inspection/);
        }
        passed++;
      }

      await setup('modern-controlled-response');
      assert.equal((await command({ ...prompt('ambiguous-control-fences'), responseFormat: 'control-json' })).ok, true);
      await controlDOM({ second: JSON.stringify({ candidate_id: 'OTHER', agree: false, checks: [], issues: ['Different object'] }) });
      const ambiguousControl = await terminal('ambiguous-control-fences');
      assert.equal(ambiguousControl.type, 'REPLY');
      assert.equal((ambiguousControl.text.match(/```json/g) || []).length, 2, 'Ambiguous final controls lost their explicit fence boundaries.');
      assert.ok(ambiguousControl.text.includes(finalControlText));
      assert.match(ambiguousControl.text, /OTHER/);
      assert.throws(() => JSON.parse(ambiguousControl.text)); passed++;

      await setup('modern-controlled-response');
      assert.equal((await command({ ...prompt('malformed-control-fence'), responseFormat: 'control-json' })).ok, true);
      const malformedControl = '{"candidate_id":"C1","checks":["reference :chatgpt-content-reference{index="0"}"],"agree":true}';
      await controlDOM({ control: malformedControl });
      const malformedDelivered = await terminal('malformed-control-fence');
      assert.equal(malformedDelivered.type, 'REPLY');
      assert.equal(malformedDelivered.text, malformedControl, 'The collector must never repair malformed model JSON or citation escapes.');
      assert.throws(() => JSON.parse(malformedDelivered.text)); passed++;

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
        assert.equal(await evaluate('expandClicks'), 0, `${mode}: status inspection expanded a historical user bubble and changed the submission baseline.`);
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

      // Capture the actual reply-observer deadline scheduled by the production
      // bridge, keeping its real timer and a manually released DOM response.
      // This proves the budgets without pretending to run a model for an hour.
      for (const [id, requested, expected] of [
        ['two-hour-default', undefined, 2 * 60 * 60_000],
        ['seventy-minute-request', 70 * 60_000, 70 * 60_000],
      ]) {
        await setup('modern-controlled-response');
        assert.equal((await command({ ...prompt(id), ...(requested === undefined ? {} : { timeoutMs: requested }) })).ok, true);
        assert.ok((await evaluate('scheduledDelays')).includes(expected), `${id}: the actual observer did not schedule the required long-response allowance.`);
        const status = await command({ type: 'INSPECT', chatMode: 'normal' });
        assert.equal(status.busy, true, 'An unfinished controlled response was treated as free.');
        assert.equal(await evaluate('stopClicks'), 0, 'The bridge stopped a genuine active response.');
        await evaluate('window.releaseResponse()');
        assert.equal((await terminal(id)).type, 'REPLY');
        assert.equal(await evaluate('sendClicks'), 1); passed++;
      }

      const progress = id => command({ type: 'INSPECT_PROGRESS', runId: 'submission-regression', requestId: id });
      await setup('modern-controlled-response');
      assert.equal((await command(prompt('supervision-busy'))).ok, true);
      await evaluate("const marker=document.createElement('span');marker.textContent='Stopped thinking';document.body.append(marker)");
      const stillWorking = await progress('supervision-busy');
      assert.equal(stillWorking.owned, true);
      assert.equal(stillWorking.active, true);
      assert.equal(stillWorking.generating, true);
      assert.equal(stillWorking.generationBusy, true);
      assert.equal(stillWorking.interrupted, false, 'A still-generating request was declared interrupted.');
      assert.equal(await evaluate('stopClicks'), 0);
      await evaluate('window.releaseResponse()');
      assert.equal((await terminal('supervision-busy')).type, 'REPLY'); passed++;

      await setup('modern-controlled-response');
      assert.equal((await command(prompt('supervision-provider-stop'))).ok, true);
      await evaluate("stop.hidden=true;const marker=document.createElement('span');marker.textContent='Stopped thinking';document.body.append(marker)");
      const interrupted = await progress('supervision-provider-stop');
      assert.equal(interrupted.owned, true);
      assert.equal(interrupted.active, false);
      assert.equal(interrupted.interrupted, true);
      assert.equal(interrupted.generating, false);
      assert.match(interrupted.visibleResult, /No completed result/);
      assert.equal((await progress('supervision-provider-stop')).interrupted, true, 'Repeated supervision lost the owned interrupted request.');
      await evaluate('new Promise(resolve=>setTimeout(resolve,30))');
      assert.equal(await evaluate("events.some(event=>event.type==='ERROR'&&event.requestId==='supervision-provider-stop')"), false, 'A recoverable provider interruption emitted a fatal relay error.');
      assert.equal(await evaluate('stopClicks'), 0); passed++;

      await setup('modern-controlled-response');
      assert.equal((await command(prompt('supervision-nested-stop-header'))).ok, true);
      await evaluate(`stop.hidden=true;const reply=document.createElement('div');reply.setAttribute('data-message-author-role','assistant');
        const heading=document.createElement('button');heading.textContent='Stopped thinking';reply.append(heading);turns.append(reply)`);
      await evaluate('new Promise(resolve=>setTimeout(resolve,150))');
      assert.equal(await evaluate("events.some(event=>event.type==='REPLY'&&event.requestId==='supervision-nested-stop-header')"), false, 'A stopped thinking header was relayed as a completed answer.');
      const nestedStopped = await progress('supervision-nested-stop-header');
      assert.equal(nestedStopped.interrupted, true, 'A provider status header inside the assistant turn was missed.');
      assert.equal(nestedStopped.active, false);
      assert.equal(await evaluate('stopClicks'), 0); passed++;

      for (const [id, quoted] of [['supervision-stop-then-answer', false], ['supervision-quoted-stop', true]]) {
        await setup('modern-controlled-response');
        assert.equal((await command(prompt(id))).ok, true);
        await evaluate(`stop.hidden=true;const reply=document.createElement('div');reply.setAttribute('data-message-author-role','assistant');
          const heading=document.createElement('button');heading.textContent='Stopped thinking';
          const body=document.createElement('div');body.className='markdown';body.textContent='Completed verified answer.';
          ${quoted ? "const quote=document.createElement('span');quote.textContent='Stopped thinking';body.append(quote);" : 'reply.append(heading);'}
          reply.append(body);turns.append(reply)`);
        assert.equal((await progress(id)).interrupted, false, `${id}: a completed body or quoted phrase triggered recovery.`);
        const delivered = await terminal(id);
        assert.equal(delivered.type, 'REPLY');
        assert.match(delivered.text, /Completed verified answer/);
        assert.equal(await evaluate('stopClicks'), 0); passed++;
      }

      for (const [id, nested] of [['supervision-reconnect-owned-response', true], ['supervision-reconnect-page-alert', false]]) {
        await setup('modern-controlled-response');
        assert.equal((await command(prompt(id))).ok, true);
        await evaluate(`const reply=document.createElement('div');reply.setAttribute('data-message-author-role','assistant');
          const body=document.createElement('div');body.className='markdown';body.textContent='Partial PDF preparation.';reply.append(body);turns.append(reply);
          const warning=document.createElement('div');warning.id='connection-warning';warning.textContent='Connection interrupted. Waiting for the complete answer…';
          ${nested ? 'reply' : 'document.body'}.append(warning);${nested ? '' : "warning.setAttribute('role','alert');"}`);
        const waiting = await progress(id);
        assert.equal(waiting.owned, true); assert.equal(waiting.active, true);
        assert.equal(waiting.reconnecting, true); assert.equal(waiting.interrupted, false);
        assert.equal(waiting.generationBusy, true);
        assert.match(waiting.reason, /Connection interrupted.*current request is retained/);
        await evaluate('stop.hidden=true;new Promise(resolve=>setTimeout(resolve,150))');
        const temporarilyIdle = await progress(id);
        assert.equal(temporarilyIdle.reconnecting, true); assert.equal(temporarilyIdle.active, true);
        assert.equal(temporarilyIdle.generationBusy, false); assert.equal(temporarilyIdle.interrupted, false);
        assert.equal(await evaluate(`events.some(event=>['REPLY','ERROR'].includes(event.type)&&event.requestId===${JSON.stringify(id)})`), false,
          'A missing Stop during a connection warning must not deliver partial text or retire the observer.');
        await evaluate("document.getElementById('connection-warning').remove();document.querySelector('.markdown').textContent='Completed PDF preparation after reconnect.'");
        const delivered = await terminal(id);
        assert.equal(delivered.type, 'REPLY'); assert.match(delivered.text, /Completed PDF preparation after reconnect/);
        assert.equal((await command({ type: 'INSPECT', chatMode: 'normal' })).reconnecting, false);
        assert.equal(await evaluate('sendClicks'), 1); assert.equal(await evaluate('stopClicks'), 0); passed++;
      }

      await setup('modern-controlled-response');
      assert.equal((await command(prompt('supervision-reconnect-terminal'))).ok, true);
      await evaluate(`const reply=document.createElement('div');reply.setAttribute('data-message-author-role','assistant');
        const body=document.createElement('div');body.className='markdown';body.textContent='Partial PDF preparation.';reply.append(body);turns.append(reply);
        const warning=document.createElement('div');warning.textContent='Connection interrupted. Waiting for the complete answer…';reply.append(warning);
        const error=document.createElement('div');error.setAttribute('role','alert');error.textContent='Resume stream is not available.';reply.append(error)`);
      const terminalWarning = await progress('supervision-reconnect-terminal');
      assert.equal(terminalWarning.interrupted, true); assert.equal(terminalWarning.reconnecting, false);
      assert.equal(terminalWarning.active, true); assert.equal(terminalWarning.awaitingProviderIdle, true);
      await evaluate('stop.hidden=true');
      assert.equal((await progress('supervision-reconnect-terminal')).active, false);
      assert.equal(await evaluate('stopClicks'), 0); passed++;

      for (const [id, global] of [['supervision-old-reconnect-warning', false], ['supervision-preexisting-reconnect-alert', true]]) {
        await setup('modern-controlled-response');
        await evaluate(`const old=document.createElement('div');old.setAttribute('data-message-author-role','assistant');old.textContent='Earlier completed answer.';
          const warning=document.createElement('div');warning.setAttribute('role','alert');warning.textContent='Connection interrupted. Waiting for the complete answer…';
          ${global ? 'document.body' : 'old'}.append(warning);turns.append(old)`);
        assert.equal((await command(prompt(id))).ok, true);
        assert.equal((await progress(id)).reconnecting, false, 'Historical warnings must not belong to a fresh request.');
        await evaluate('window.releaseResponse()');
        assert.equal((await terminal(id)).type, 'REPLY'); passed++;
      }

      await setup('modern-controlled-response');
      assert.equal((await command(prompt('supervision-quoted-reconnect-warning'))).ok, true);
      await evaluate(`stop.hidden=true;const reply=document.createElement('div');reply.setAttribute('data-message-author-role','assistant');
        const body=document.createElement('div');body.className='markdown';body.textContent='Connection interrupted. Waiting for the complete answer…';reply.append(body);turns.append(reply)`);
      assert.equal((await progress('supervision-quoted-reconnect-warning')).reconnecting, false);
      assert.equal((await terminal('supervision-quoted-reconnect-warning')).type, 'REPLY'); passed++;

      for (const [id, nested, staleStop, wording, expectedKind = 'stream-interrupted', rootLeaf = false] of [
        ['supervision-stream-alert', false, false, 'Resume stream unavailable'],
        ['supervision-stream-alert-in-assistant', true, false, 'Resume stream unavailable'],
        ['supervision-stream-alert-with-stale-stop', false, true, 'Resume stream unavailable'],
        ['supervision-stream-not-available', false, false, 'Resume stream is not available.'],
        ['supervision-generation-alert', false, false, 'There was an error generating a response.', 'generation-error'],
        ['supervision-generation-alert-in-assistant', true, false, 'There was an error generating a response. Please try again.', 'generation-error'],
        ['supervision-generation-alert-with-stale-stop', true, true, 'An error occurred while generating the response.', 'generation-error'],
        ['supervision-generation-root-alert-leaf', false, false, 'There was an error generating a response.', 'generation-error', true],
        ['supervision-request-timeout', false, false, 'Request timed out.', 'timeout'],
        ['supervision-response-timeout', true, false, 'Response timed out. Please try again.', 'timeout'],
        ['supervision-timeout-busy', true, true, 'Time out error.', 'timeout'],
        ['supervision-delivery-error', false, false, 'Message delivery error.', 'delivery-error'],
        ['supervision-delivery-failed', true, false, 'Message delivery failed.', 'delivery-error'],
        ['supervision-live-delivery-timeout', true, false, 'Message delivery timed out. Please try again.', 'delivery-error'],
        ['supervision-live-delivery-timeout-busy', true, true, 'Message delivery timed out. Please try again.', 'delivery-error'],
        ['supervision-server-error', true, false, 'Something went wrong.', 'server-error'],
        ['supervision-too-long', false, false, 'The message you submitted was too long, please edit it and resubmit.', 'too-long'],
      ]) {
        await setup('modern-controlled-response');
        assert.equal((await command(prompt(id))).ok, true);
        await evaluate(`stop.hidden=${!staleStop};const reply=document.createElement('div');reply.setAttribute('data-message-author-role','assistant');
          const body=document.createElement('div');body.className='markdown';body.textContent='Reviewed scanned pages. Still preparing the corrected PDF.';reply.append(body);turns.append(reply);
          const error=document.createElement('div');error.setAttribute('role','alert');
          ${rootLeaf ? "const leaf=document.createElement('span');leaf.textContent=" + JSON.stringify(wording) + ";error.append(leaf);" : 'error.textContent=' + JSON.stringify(wording) + ';'}
          const retry=document.createElement('button');retry.textContent='Try again';retry.onclick=()=>window.retryClicks++;
          ${nested ? 'reply' : 'document.body'}.append(error,retry);`);
        await evaluate('new Promise(resolve=>setTimeout(resolve,150))');
        const pageStatus = await command({ type: 'INSPECT', chatMode: 'normal' });
        assert.equal(pageStatus.interrupted, true, `${id}: page status concealed its interrupted stream.`);
        assert.equal(pageStatus.requestOwned, true);
        assert.equal(pageStatus.interruptionKind, expectedKind);
        assert.ok(expectedKind === 'too-long' ? /smaller focused continuation/.test(pageStatus.reason) : pageStatus.reason.includes(wording));
        assert.equal(await evaluate(`events.some(event=>['REPLY','ERROR'].includes(event.type)&&event.requestId===${JSON.stringify(id)})`), false,
          `${id}: a partial response was relayed or a recoverable stream failure killed the run.`);
        const interrupted = await progress(id);
        assert.equal(interrupted.owned, true);
        assert.equal(interrupted.interrupted, true);
        assert.equal(interrupted.interruptionKind, expectedKind);
        assert.equal(interrupted.active, staleStop, 'The owned observer must stay alive until the actual native Stop clears.');
        assert.equal(interrupted.awaitingProviderIdle, staleStop);
        assert.equal(interrupted.generationBusy, staleStop, 'Actual provider Stop must remain authoritative for recovery safety.');
        assert.equal((await progress(id)).interrupted, true);
        if (staleStop) {
          await evaluate("document.querySelector('[role=alert]').remove();stop.hidden=true");
          await evaluate('new Promise(resolve=>setTimeout(resolve,150))');
          assert.equal(await evaluate(`events.some(event=>['REPLY','ERROR'].includes(event.type)&&event.requestId===${JSON.stringify(id)})`), false,
            'Removing a terminal alert must not turn its partial text into a completed answer.');
          const nowIdle = await progress(id);
          assert.equal(nowIdle.interrupted, true, 'A terminal stream receipt was lost before the stale Stop cleared.');
          assert.equal(nowIdle.interruptionKind, expectedKind);
          assert.equal(nowIdle.owned, true);
          assert.equal(nowIdle.active, false);
          assert.equal(nowIdle.generationBusy, false);
          assert.equal(nowIdle.awaitingProviderIdle, false);
          assert.equal(nowIdle.newerUserMessage, false);
        }
        assert.equal(await evaluate('sendClicks'), 1, 'A provider failure must never resubmit the raw assignment.');
        assert.equal(await evaluate('retryClicks'), 0, 'Progress supervision clicked Try again on a failed response.');
        assert.equal(await evaluate('stopClicks'), 0, 'Progress supervision clicked Stop on a failed response.'); passed++;
      }

      for (const [id, sameUserTurn] of [['supervision-generation-owned-user-turn', true], ['supervision-generation-assistant-turn-sibling', false]]) {
        await setup('modern-controlled-response');
        assert.equal((await command(prompt(id))).ok, true);
        await evaluate(`stop.hidden=true;const turn=document.createElement('article');turn.setAttribute('data-testid','conversation-turn-current');
          ${sameUserTurn ? 'const ownedUser=turns.lastElementChild;ownedUser.replaceWith(turn);turn.append(ownedUser);' : ''}
          ${sameUserTurn ? '' : "const reply=document.createElement('div');reply.setAttribute('data-message-author-role','assistant');reply.textContent='Partial generated section.';turn.append(reply);"}
          const error=document.createElement('div');error.setAttribute('role','alert');error.textContent='There was an error generating a response.';turn.append(error);turns.append(turn)`);
        await evaluate('new Promise(resolve=>setTimeout(resolve,100))');
        const interrupted = await progress(id);
        assert.equal(interrupted.interrupted, true, `${id}: an exactly associated terminal error was missed.`);
        assert.equal(interrupted.interruptionKind, 'generation-error');
        assert.equal(interrupted.owned, true); assert.equal(interrupted.active, false);
        assert.equal(interrupted.generationBusy, false);
        assert.equal(await evaluate(`events.some(event=>['REPLY','ERROR'].includes(event.type)&&event.requestId===${JSON.stringify(id)})`), false);
        assert.equal(await evaluate('sendClicks'), 1); assert.equal(await evaluate('stopClicks'), 0); passed++;
      }

      for (const [id, global, wording = 'Resume stream unavailable'] of [
        ['supervision-old-stream-alert', false], ['supervision-preexisting-global-alert', true],
        ['supervision-old-generation-alert', false, 'There was an error generating a response.'],
        ['supervision-preexisting-generation-alert', true, 'There was an error generating a response.'],
      ]) {
        await setup('modern-controlled-response');
        await evaluate(`const old=document.createElement('div');old.setAttribute('data-message-author-role','assistant');old.textContent='Earlier completed answer.';
          const error=document.createElement('div');error.setAttribute('role','alert');error.textContent=${JSON.stringify(wording)};
          ${global ? 'document.body' : 'old'}.append(error);turns.append(old);`);
        assert.equal((await command(prompt(id))).ok, true);
        assert.equal((await progress(id)).interrupted, false, `${id}: an old alert interrupted a new request.`);
        await evaluate('window.releaseResponse()');
        assert.equal((await terminal(id)).type, 'REPLY');
        const completed = await command({ type: 'INSPECT', chatMode: 'normal' });
        assert.equal(completed.interrupted, false, 'A completed response was retroactively invalidated.'); passed++;
      }

      await setup('modern-controlled-response');
      assert.equal((await command(prompt('supervision-quoted-stream-error'))).ok, true);
      await evaluate(`stop.hidden=true;const reply=document.createElement('div');reply.setAttribute('data-message-author-role','assistant');
        const body=document.createElement('div');body.className='markdown';body.textContent='The error named Resume stream unavailable means the connection ended.';reply.append(body);turns.append(reply);`);
      assert.equal((await progress('supervision-quoted-stream-error')).interrupted, false);
      assert.equal((await terminal('supervision-quoted-stream-error')).type, 'REPLY'); passed++;

      for (const [id, container, explicit] of [
        ['supervision-quoted-generation-prose', 'markdown', false],
        ['supervision-quoted-generation-alert', 'markdown', true],
        ['supervision-quoted-generation-code', 'pre', true],
        ['supervision-quoted-generation-blockquote', 'blockquote', true],
        ['supervision-unrelated-generation-alert', 'form', true],
      ]) {
        await setup('modern-controlled-response');
        assert.equal((await command(prompt(id))).ok, true);
        await evaluate(`stop.hidden=true;const reply=document.createElement('div');reply.setAttribute('data-message-author-role','assistant');
          const body=document.createElement('div');body.className='markdown';body.textContent='Completed explanation of the provider error.';reply.append(body);turns.append(reply);
          const container=${container === 'form' ? "document.querySelector('form')" : `document.createElement('${container === 'markdown' ? 'div' : container}')`};
          ${container === 'markdown' ? "container.className='markdown';" : ''}
          const quote=document.createElement('span');quote.textContent='There was an error generating a response.';
          ${explicit ? "quote.setAttribute('role','alert');" : ''}container.append(quote);
          ${container === 'form' ? '' : 'reply.append(container);'}`);
        assert.equal((await progress(id)).interrupted, false, `${id}: task data or an unrelated composer alert triggered recovery.`);
        const delivered = await terminal(id);
        assert.equal(delivered.type, 'REPLY');
        assert.match(delivered.text, /Completed explanation/);
        assert.equal(await evaluate('sendClicks'), 1);
        assert.equal(await evaluate('stopClicks'), 0); passed++;
      }

      for (const [id, region, wording] of [
        ['supervision-unrelated-header-generation', 'header', 'There was an error generating a response.'],
        ['supervision-unrelated-dialog-generation', 'dialog', 'There was an error generating a response.'],
        ['supervision-unrelated-header-stream', 'header', 'Resume stream unavailable'],
        ['supervision-unrelated-dialog-stream', 'dialog', 'Resume stream unavailable'],
      ]) {
        await setup('modern-controlled-response');
        assert.equal((await command(prompt(id))).ok, true);
        await evaluate(`const region=document.createElement('${region === 'header' ? 'header' : 'div'}');
          ${region === 'dialog' ? "region.setAttribute('role','dialog');" : ''}
          const error=document.createElement('div');error.setAttribute('role','alert');error.textContent=${JSON.stringify(wording)};
          region.append(error);document.body.append(region)`);
        const unaffected = await progress(id);
        assert.equal(unaffected.interrupted, false, `${id}: an unrelated panel interrupted the worker.`);
        assert.equal(unaffected.active, true); assert.equal(unaffected.generationBusy, true);
        await evaluate('window.releaseResponse()');
        assert.equal((await terminal(id)).type, 'REPLY');
        assert.equal(await evaluate('sendClicks'), 1); assert.equal(await evaluate('stopClicks'), 0); passed++;
      }

      for (const [id, wording] of [
        ['supervision-virtualized-historical-generation', 'There was an error generating a response.'],
        ['supervision-virtualized-historical-stream', 'Resume stream unavailable'],
      ]) {
        await setup('modern-controlled-response');
        await evaluate(`window.historicalUser=userBubble('Earlier unmounted user.',false);turns.append(historicalUser);
          window.historicalReply=document.createElement('div');historicalReply.setAttribute('data-message-author-role','assistant');
          historicalReply.textContent='Earlier completed response.';turns.append(historicalReply)`);
        assert.equal((await command(prompt(id))).ok, true);
        await evaluate(`historicalUser.remove();const error=document.createElement('div');error.setAttribute('role','alert');
          error.textContent=${JSON.stringify(wording)};historicalReply.append(error)`);
        const unaffected = await progress(id);
        assert.equal(unaffected.interrupted, false, `${id}: a fresh error in historical assistant history interrupted the owned worker.`);
        assert.equal(unaffected.active, true); assert.equal(unaffected.generationBusy, true);
        await evaluate('window.releaseResponse()');
        assert.equal((await terminal(id)).type, 'REPLY');
        assert.equal(await evaluate('sendClicks'), 1); assert.equal(await evaluate('stopClicks'), 0); passed++;
      }

      for (const [id, shape] of [
        ['supervision-root-alert-before-owned-user', 'before-user'],
        ['supervision-unassociated-nested-alert', 'nested'],
        ['supervision-quoted-error-aggregate', 'quoted-aggregate'],
        ['supervision-remounted-old-root-alert', 'remounted'],
      ]) {
        await setup('modern-controlled-response');
        if (shape === 'remounted') await evaluate(`window.oldRootAlert=document.createElement('div');oldRootAlert.setAttribute('role','alert');
          oldRootAlert.textContent='There was an error generating a response.';document.body.append(oldRootAlert)`);
        assert.equal((await command(prompt(id))).ok, true);
        await evaluate(`const error=document.createElement('div');error.setAttribute('role','alert');error.textContent='There was an error generating a response.';
          ${shape === 'before-user' ? 'document.body.prepend(error);' : shape === 'nested' ? "const panel=document.createElement('div');panel.append(error);document.body.append(panel);" : shape === 'quoted-aggregate' ? "const body=document.createElement('div');body.className='markdown';body.textContent=error.textContent;error.textContent='';error.append(body);document.body.append(error);" : 'oldRootAlert.remove();document.body.append(error);'}`);
        const unaffected = await progress(id);
        assert.equal(unaffected.interrupted, false, `${id}: an ambiguous or quoted root error authorized recovery.`);
        assert.equal(unaffected.active, true); assert.equal(unaffected.generationBusy, true);
        await evaluate('window.releaseResponse()');
        assert.equal((await terminal(id)).type, 'REPLY');
        assert.equal(await evaluate('sendClicks'), 1); assert.equal(await evaluate('stopClicks'), 0); passed++;
      }

      await setup('modern-controlled-response');
      assert.equal((await command({ ...prompt('multi-wrapper-artifact'), relayMedia: true })).ok, true);
      await evaluate(`stop.hidden=true;
        window.fixturePdf='%PDF-1.4\\nCorrected exact deliverable\\n%%EOF';window.fileFetches=[];
        window.fetch=async href=>{window.fileFetches.push(href);return new Response(window.fixturePdf,{headers:{'content-type':'application/pdf'}})};
        const artifact=document.createElement('div');artifact.setAttribute('data-message-author-role','assistant');artifact.textContent='Generated the corrected PDF.';
        const link=document.createElement('a');link.href=location.origin+'/files/corrected.pdf';link.download='corrected.pdf';link.textContent='corrected.pdf';artifact.append(link);turns.append(artifact);
        const final=document.createElement('div');final.setAttribute('data-message-author-role','assistant');final.textContent='Final review complete; use the attached corrected PDF.';turns.append(final);`);
      const artifactReply = await terminal('multi-wrapper-artifact');
      assert.equal(artifactReply.type, 'REPLY');
      assert.match(artifactReply.text, /Final review complete/);
      assert.equal(artifactReply.media.length, 1, 'An artifact in an earlier assistant wrapper disappeared behind the final summary.');
      assert.equal(artifactReply.media[0].name, 'corrected.pdf');
      const artifactExport = await command({ type: 'EXPORT_MEDIA', runId: artifactReply.runId, requestId: artifactReply.requestId, ids: artifactReply.media.map(item => item.id) });
      assert.equal(artifactExport.ok, true, artifactExport.error);
      assert.equal(Buffer.from(artifactExport.files[0].base64, 'base64').toString(), await evaluate('window.fixturePdf'));
      assert.equal((await evaluate('window.fileFetches')).length, 1);
      assert.equal(await evaluate('sendClicks'), 1); passed++;

      await setup('modern-controlled-response');
      assert.equal((await command(prompt('supervision-human-change'))).ok, true);
      await evaluate("turns.append(userBubble('A new human task owns the response now.',false))");
      const humanChanged = await progress('supervision-human-change');
      assert.equal(humanChanged.owned, false);
      assert.equal(humanChanged.interrupted, false, 'A human change was eligible for provider-interruption recovery.');
      assert.equal((await terminal('supervision-human-change')).type, 'ERROR');
      assert.equal(await evaluate('stopClicks'), 0, 'Supervision stopped a newer human-owned response.'); passed++;

      await setup('modern-controlled-response');
      assert.equal((await command(prompt('supervision-correct-id'))).ok, true);
      const wrongIdentity = await progress('supervision-wrong-id');
      assert.equal(wrongIdentity.owned, false);
      assert.equal(wrongIdentity.interrupted, false);
      assert.equal(wrongIdentity.requestId, 'supervision-wrong-id');
      assert.equal((await progress('supervision-correct-id')).active, true, 'An incorrect supervision identity detached the real request.');
      assert.equal(await evaluate('stopClicks'), 0);
      await evaluate('window.releaseResponse()');
      assert.equal((await terminal('supervision-correct-id')).type, 'REPLY'); passed++;

      await setup('modern-controlled-response');
      assert.equal((await command(prompt('supervision-newer-assignment'))).ok, true);
      assert.equal((await command({ type: 'CANCEL', runId: 'submission-regression', requestId: 'supervision-retired-assignment', cancelRun: false, stopGeneration: false })).cancelled, false);
      assert.equal((await progress('supervision-newer-assignment')).active, true, 'A delayed supervisor cancel detached a newer worker assignment.');
      assert.equal(await evaluate('stopClicks'), 0);
      await evaluate('window.releaseResponse()');
      assert.equal((await terminal('supervision-newer-assignment')).type, 'REPLY'); passed++;

      await setup('modern-controlled-response');
      assert.equal((await command(prompt('cancel-before-resume'))).ok, true);
      assert.equal((await command({ type: 'CANCEL', runId: 'submission-regression' })).ok, true);
      assert.equal(await evaluate('stopClicks'), 1);
      assert.equal((await command(prompt('resume-before-authorized'))).ok, false, 'A canceled run submitted a new request before resume.');
      assert.equal((await command({ type: 'RESUME_RUN', runId: 'submission-regression' })).ok, true);
      assert.equal((await command(prompt('resume-new-request'))).ok, true);
      await evaluate('window.releaseResponse()');
      assert.equal((await terminal('resume-new-request')).type, 'REPLY');
      assert.equal(await evaluate('sendClicks'), 2, 'Explicit resume did not send exactly one new request.'); passed++;

      // Actual route transition after selecting a model before the next task.
      await setup('modern-navigation-return', '/c/model-selection');
      await evaluate("history.replaceState({},'', '?effort=extra-high')");
      assert.equal((await command(prompt('model-selection'))).ok, true);
      assert.equal((await terminal('model-selection')).type, 'REPLY');
      assert.equal(await evaluate('sendClicks'), 1); assert.equal(await evaluate('stopClicks'), 0); passed++;

      const resume = id => ({ ...prompt(id), type: 'RESUME_OBSERVATION', observationUrl: origin + '/c/reload-owned' });
      const mountOwned = async (id, { newer = false, duplicate = false, markerOnly = false, busy = false, completed = false } = {}) => {
        const body = markerOnly ? `Different text\n\nExchange tracking ID (do not include in your JSON): ${id}` : prompt(id).text;
        await evaluate(`turns.append(userBubble('Earlier user',false));
          const old=document.createElement('div');old.setAttribute('data-message-author-role','assistant');old.textContent='Historical answer';turns.append(old);
          turns.append(userBubble(${JSON.stringify(body)},true));
          ${duplicate ? `turns.append(userBubble(${JSON.stringify(body)},false));` : ''}
          ${newer ? "turns.append(userBubble('New human question',false));" : ''}
          stop.hidden=${!busy};
          ${completed ? `const reply=document.createElement('div');reply.setAttribute('data-message-author-role','assistant');reply.textContent='Resumed final answer';
            const link=document.createElement('a');link.href=location.origin+'/files/resumed.txt';link.download='resumed.txt';link.textContent='Download resumed.txt';reply.append(link);turns.append(reply);
            window.fetch=async()=>new Response('Exact resumed file bytes\\n',{headers:{'content-type':'text/plain'}});` : ''}void 0;`);
      };
      await setup('modern-controlled-response', '/c/reload-owned');
      assert.equal((await command(prompt('reload-active'))).ok, true);
      // A real main-frame load destroys the first observer and its DOM.
      await setup('modern-controlled-response', '/c/reload-owned');
      await mountOwned('reload-active', { busy: true });
      assert.equal((await command(resume('reload-active'))).resumed, true);
      assert.equal((await command(resume('reload-active'))).pending, true, 'Duplicate recovery created a second observer.');
      assert.equal((await command({ type: 'INSPECT_PROGRESS', runId: 'submission-regression', requestId: 'reload-active' })).owned, true);
      await evaluate("stop.hidden=true;const answer=document.createElement('div');answer.setAttribute('data-message-author-role','assistant');answer.textContent='Reply after reload';turns.append(answer)");
      assert.equal((await terminal('reload-active')).text, 'Reply after reload');
      assert.equal(await evaluate('sendClicks'), 0); assert.equal(await evaluate('stopClicks'), 0); passed++;

      await setup('modern-controlled-response', '/c/reload-owned');
      await mountOwned('reload-finished', { completed: true });
      assert.equal((await command({ ...resume('reload-finished'), relayMedia: true })).resumed, true);
      const recovered = await terminal('reload-finished');
      assert.equal(recovered.type, 'REPLY'); assert.equal(recovered.media.length, 1);
      assert.ok(!recovered.text.includes('Historical answer'));
      const recoveredFile = await command({ type: 'EXPORT_MEDIA', runId: recovered.runId, requestId: recovered.requestId, ids: recovered.media.map(item=>item.id) });
      assert.equal(Buffer.from(recoveredFile.files[0].base64,'base64').toString(), 'Exact resumed file bytes\n');
      assert.equal(await evaluate('sendClicks'), 0); assert.equal(await evaluate('stopClicks'), 0); passed++;
      assert.equal((await command(resume('reload-finished'))).ok, false, 'Completed request was adopted twice.'); passed++;

      for (const [id, settings, address] of [
        ['resume-wrong-chat', { completed: true }, '/c/unrelated'],
        ['resume-new-human', { newer: true, busy: true }, '/c/reload-owned'],
        ['resume-marker-only', { markerOnly: true, busy: true }, '/c/reload-owned'],
        ['resume-duplicate-turn', { duplicate: true }, '/c/reload-owned'],
      ]) {
        await setup('modern-controlled-response', address); await mountOwned(id, settings);
        assert.equal((await command(resume(id))).ok, false, id);
        assert.equal(await evaluate('sendClicks'), 0); assert.equal(await evaluate('stopClicks'), 0);
        assert.equal(await evaluate("events.filter(event=>event.type==='REPLY').length"), 0); passed++;
      }
      await setup('modern-controlled-response', '/c/reload-owned'); await mountOwned('resume-cancelled', { busy: true });
      await command({ type: 'CANCEL', runId: 'submission-regression', stopGeneration: false });
      assert.equal((await command(resume('resume-cancelled'))).ok, false);
      assert.equal(await evaluate('sendClicks'), 0); assert.equal(await evaluate('stopClicks'), 0); passed++;
      await setup('modern-controlled-response', '/c/reload-owned');
      const whileHydrating = command(resume('resume-stop-during-hydration'));
      await command({ type: 'CANCEL', runId: 'submission-regression', stopGeneration: false });
      assert.equal((await whileHydrating).ok, false);
      await mountOwned('resume-stop-during-hydration', { completed: true });
      assert.equal((await command(resume('resume-stop-during-hydration'))).ok, false);
      assert.equal(await evaluate('sendClicks'), 0); assert.equal(await evaluate('stopClicks'), 0); passed++;

      assert.equal(passed, 103);
      process.stdout.write('PASS: 103 actual Chromium submission regressions, including the observed message-delivery timeout, owned timeout/delivery/server/too-long failures, model-selection route recovery, real reload of active/finished replies, exact resumed file bytes, no duplicate Send/Stop, and wrong-chat/new-human/marker-only/duplicate/cancel guards.\n');
    } finally { win.destroy(); await new Promise((resolve) => server.close(resolve)); }
  }
  app.whenReady().then(run).then(() => app.quit()).catch((error) => { process.stderr.write(`${error.stack}\n`); app.exit(1); });
}
