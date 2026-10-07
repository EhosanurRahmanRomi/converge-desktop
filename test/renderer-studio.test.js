'use strict';

if (!process.versions.electron) {
  const test = require('node:test'), assert = require('node:assert/strict'), { spawn } = require('node:child_process');
  test('studio contracts, evidence, revision restore, guarded previews, projects and native geometry', { timeout: 55000 }, async () => {
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const result = await new Promise((resolve, reject) => {
      const child = spawn(require('electron'), [__filename], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); let output = '';
      child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { output += data; });
      const timer = setTimeout(() => { child.kill(); reject(new Error(output || 'Studio renderer timed out.')); }, 50000);
      child.on('error', error => { clearTimeout(timer); reject(error); }); child.on('close', code => { clearTimeout(timer); resolve({ code, output }); });
    });
    assert.equal(result.code, 0, result.output); assert.match(result.output, /PASS: studio controls and professional typography/);
  });
} else {
  const assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path'), http = require('node:http');
  const { app, BrowserWindow } = require('electron'); const root = path.join(__dirname, '..');
  app.setPath('userData', path.join(app.getPath('temp'), `converge-studio-renderer-${process.pid}`));
  const fixtureJs = `
    const ready={ready:true,authenticated:true,busy:false};
    const original={id:'revision-1',candidateId:'C1',sha256:'a'.repeat(64),answer:'Original line\\nKeep this',author:'left',round:1,createdAt:Date.now()-10000,files:[]};
    const revised={id:'revision-2',candidateId:'C2',sha256:'b'.repeat(64),answer:'Improved line\\nKeep this\\n<img src=x onerror=window.executed=true>',author:'right',round:2,createdAt:Date.now(),files:[{name:'chart.png',mimeType:'image/png',contentSha256:'c'.repeat(64),byteLength:42},{name:'report.pdf',mimeType:'application/pdf',contentSha256:'d'.repeat(64),byteLength:1024}]};
    window.fixture={calls:[],bounds:[],starts:[],state:{status:'agreed',hasSession:true,question:'Prepare a reviewed report',answer:revised.answer,candidate:{id:'C2',answer:revised.answer},chatMode:'normal',coordinatorMode:'boss',tabIds:{left:1,right:2,boss:3},pages:{left:{...ready},right:{...ready},boss:{...ready}},transcript:[],issues:[],studio:{version:1,preset:'document',settings:{freshAudit:false,verificationEnabled:true,verificationMode:'static'},contract:{task:'Prepare a reviewed report',acceptanceCriteria:['Every chart has units']},requirements:[{id:'R1',text:'Every chart has units',status:'unverified',source:'model',evidence:[]}],issues:[{id:'I1',title:'A chart lacks its units',severity:'high',status:'found',evidence:'Chart 2',history:[]}],revisions:[original,revised],preferredRevisionId:'revision-2',verification:{status:'unverified',checks:[{id:'model',label:'Numerical review',status:'passed',source:'model',evidence:'Reviewer said correct'}]},freshAudit:{enabled:false,status:'idle'}}}};
    fixture.publish=()=>fixture.listener?.(fixture.state);
    if(new URLSearchParams(location.search).has('empty')){fixture.state.question='';fixture.state.studio.contract.task='';fixture.state.studio.contract.acceptanceCriteria=[]}
    const success=()=>({ok:true,state:fixture.state});
    window.convergeBrowser={bootstrap:async()=>({hasSession:true,version:'studio-fixture',state:fixture.state}),setBounds:async bounds=>{fixture.bounds.push(bounds);return{ok:true}},onState:listener=>{fixture.listener=listener},onPage:()=>{},onClosing:listener=>{fixture.closing=listener},setEffectsPaused:async()=>({ok:true}),setAppearance:async()=>({ok:true}),expand:async()=>({ok:true}),
      studioSettings:async payload=>{fixture.calls.push(['settings',payload]);Object.assign(fixture.state.studio,{preset:payload.preset,settings:{freshAudit:payload.freshAudit,verificationEnabled:payload.verificationEnabled,verificationMode:payload.verificationMode,documentDesign:payload.documentDesign}});fixture.state.studio.contract.acceptanceCriteria=payload.acceptanceCriteria;return success()},
      requirementReview:async payload=>{fixture.calls.push(['requirement',payload]);Object.assign(fixture.state.studio.requirements[0],{status:payload.status,source:'user',evidence:[{source:'user',text:payload.evidence}]});return success()},
      issueReview:async payload=>{fixture.calls.push(['issue',payload]);if(payload.id)Object.assign(fixture.state.studio.issues[0],payload);else fixture.state.studio.issues.push({...payload,id:'I2'});return success()},
      restoreRevision:async payload=>{fixture.calls.push(['restore',payload]);fixture.state.studio.preferredRevisionId=payload.id;return success()},
      verificationRun:async()=>{fixture.calls.push(['verify']);fixture.state.studio.verification={status:'passed',summary:'Output structure checked',checks:[{id:'pdf',label:'PDF structure',status:'passed',source:'executed',evidence:'2 pages decoded'}]};return success()},
      studioRevisionPreview:async payload=>{fixture.calls.push(['preview',payload]);if(fixture.delayPreview){fixture.delayPreview=false;await new Promise(resolve=>fixture.resolvePreview=resolve)}if(payload.fileId==='d'.repeat(64))return{ok:true,kind:'pdf',name:'report.pdf'};return fixture.unsafePreview?{ok:true,kind:'image',dataUrl:'data:text/html,<script>window.executed=true</script>'}:{ok:true,kind:'image',name:'chart.png',dataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0uoAAAAASUVORK5CYII='}},
      studioRevisionOpen:async payload=>{fixture.calls.push(['open',payload]);return{ok:true}},
      studioRevisionSave:async payload=>{fixture.calls.push(['revisionDownload',payload]);return{ok:true,saved:true,name:'report.pdf'}},
      studioProjectDownload:async payload=>{fixture.calls.push(['projectDownload',payload]);return{ok:true,saved:true,name:'saved-draft.zip',fileCount:2,outputStatus:'draft'}},
      projectList:async()=>{fixture.calls.push(['list']);return{ok:true,projects:[{id:'project-1',name:'Report project',updatedAt:Date.now(),revisionCount:2,outputFileCount:2,outputNames:['chart.png','report.pdf'],outputStatus:'draft',savedStatus:'blocked'}]}},
      projectSave:async payload=>{fixture.calls.push(['save',payload]);return success()},projectExport:async()=>{fixture.calls.push(['export']);return{ok:true,saved:true}},deliveryExport:async()=>{fixture.calls.push(['delivery']);return{ok:true,saved:true}},
      projectLoad:async payload=>{fixture.calls.push(['load',payload]);fixture.state.question='Recovered project brief';fixture.state.studio.contract.task='Recovered project brief';fixture.state.studio.settings.documentDesign={profile:'reference',notes:'Match the supplied lecture design',referenceNames:['GOOD Reference.pdf']};fixture.state.tabIds={};fixture.state.status='idle';return success()},projectImport:async()=>({ok:true,canceled:true}),
      start:async payload=>{fixture.starts.push(payload);return success()}
    };`;
  async function run() {
    const names = ['browser.html', 'browser-app.js', 'browser.css', 'studio-ui.js', 'studio-ui.css', 'assets/fonts/Manrope-Variable.ttf', 'galaxy-scene.js', 'galaxy-scene.css', 'star-ribbons.js', 'ghost-v2.png', 'flower-blossom-v1.png'];
    const assets = Object.fromEntries(await Promise.all(names.map(async name => [name, await fs.readFile(path.join(root, 'renderer', name))])));
    const html = assets['browser.html'].toString('utf8').replace('<script defer src="browser-app.js"></script>', '<script src="fixture.js"></script><script defer src="browser-app.js"></script>');
    const server = http.createServer((request, response) => {
      const name = request.url.slice(1);
      if (name === 'fixture.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(fixtureJs); }
      else if (assets[name] && name !== 'browser.html') { response.setHeader('Content-Type', name.endsWith('.css') ? 'text/css' : name.endsWith('.ttf') ? 'font/ttf' : name.endsWith('.png') ? 'image/png' : 'text/javascript'); response.end(assets[name]); }
      else { response.setHeader('Content-Type', 'text/html;charset=utf-8'); response.end(html); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const win = new BrowserWindow({ show: false, frame: false, width: 1366, height: 820, webPreferences: { offscreen: true, contextIsolation: false, nodeIntegration: false } });
    const evaluate = code => win.webContents.executeJavaScript(code);
    const settle = () => evaluate('new Promise(resolve=>requestAnimationFrame(()=>setTimeout(resolve,120)))');
    const click = async code => { await evaluate(code); await settle(); };
    const tab = key => click(`document.getElementById('studioTab-${key}').click()`);
    const capture = async name => { const folder = path.join(root, '.design'); await fs.mkdir(folder, { recursive: true }); await fs.writeFile(path.join(folder, name), (await win.webContents.capturePage()).toPNG()); };
    try {
      await win.loadURL(`http://127.0.0.1:${server.address().port}/?empty=1`); await settle(); await evaluate('document.fonts.ready');
      await click("document.getElementById('openStudio').click()");
      assert.equal(await evaluate("document.getElementById('studioFreshAudit').checked"), true, 'Empty legacy state disables the fresh audit default');
      assert.equal(await evaluate("document.getElementById('studioVerificationEnabled').checked"), true, 'Empty legacy state disables executed verification by default');
      assert.equal(await evaluate("document.getElementById('studioDocumentProfile').value"), 'academic');
      assert.equal(await evaluate("document.getElementById('studioDocumentNotes').maxLength"), 6000);
      assert.match(await evaluate("document.getElementById('studioDocumentDesign').textContent"), /Appearance references do not add topics/);
      await evaluate("localStorage.setItem('converge.studio.preferences',JSON.stringify({documentDesign:{profile:'editorial',notes:'Quiet headings and balanced whitespace',referenceNames:['Design.pdf']}}))");
      await win.loadURL(`http://127.0.0.1:${server.address().port}/?empty=1`); await settle();
      await click("document.getElementById('openStudio').click()");
      assert.equal(await evaluate("document.getElementById('studioDocumentProfile').value"), 'editorial', 'Document profile preferences were not restored');
      assert.equal(await evaluate("document.getElementById('studioDocumentNotes').value"), 'Quiet headings and balanced whitespace');
      assert.equal(await evaluate("document.getElementById('studioReferenceNames').value"), 'Design.pdf');
      await evaluate("localStorage.removeItem('converge.studio.preferences')");
      await win.loadURL(`http://127.0.0.1:${server.address().port}/`); await settle(); await evaluate('document.fonts.ready');
      assert.ok(await evaluate("Array.from(document.fonts).some(face=>face.family==='Manrope'&&face.status==='loaded')"), 'Bundled professional font was not loaded');
      // The status previously occupied the same absolute center as Studio.
      // Measure the real loaded font, long text and both Stop states, then
      // hit-test controls against the transparent native window drag strip.
      for (const width of [1366, 1100, 900]) {
        win.setSize(width, 820); await settle();
        for (const running of [false, true]) {
          await click(`fixture.state.status=${JSON.stringify(running ? 'running' : 'agreed')};fixture.state.pages.boss.busy=${running};fixture.publish()`);
          const before = await evaluate("({header:document.querySelector('.topbar').getBoundingClientRect().height,deck:document.getElementById('reviewDeck').getBoundingClientRect().height,chat:document.getElementById('leftSlot').getBoundingClientRect().height})");
          await evaluate("document.getElementById('topStatus').textContent='Boss thinking · team active · '+ 'checking attachments and the current candidate '.repeat(8)");
          const header = await evaluate(`(()=>{
            const selectors=['#toggleSidebar','.brand','.topbar-status','#headerStop','#openStudio','#effectsButton','.version','.window-controls'];
            const boxes=selectors.map(selector=>{const element=document.querySelector(selector),box=element.getBoundingClientRect();return{selector,x:box.x,y:box.y,right:box.right,bottom:box.bottom,width:box.width,height:box.height}}).filter(box=>box.width&&box.height);
            const controls=Array.from(document.querySelectorAll('.topbar button')).filter(button=>button.getClientRects().length).map(button=>{const box=button.getBoundingClientRect();return{id:button.id,reachable:document.elementFromPoint(box.x+box.width/2,box.y+box.height/2)?.closest('button')===button}});
            return{width:innerWidth,boxes,controls,header:document.querySelector('.topbar').getBoundingClientRect().height,deck:document.getElementById('reviewDeck').getBoundingClientRect().height,chat:document.getElementById('leftSlot').getBoundingClientRect().height,native:fixture.bounds.at(-1),slotY:document.getElementById('leftSlot').getBoundingClientRect().y};
          })()`);
          assert.equal(header.width, width, 'The header viewport did not resize for its geometry check');
          for (let index = 0; index < header.boxes.length; index++) {
            const box = header.boxes[index];
            assert.ok(box.x >= 0 && box.right <= width, `${box.selector} is outside the ${width}px header`);
            for (const other of header.boxes.slice(index + 1)) {
              assert.ok(box.right <= other.x || other.right <= box.x || box.bottom <= other.y || other.bottom <= box.y,
                `${box.selector} overlaps ${other.selector} at ${width}px with running=${running}`);
            }
          }
          assert.ok(header.controls.every(control=>control.reachable), `Header controls are covered at ${width}px: ${JSON.stringify(header.controls)}`);
          assert.deepEqual({header:header.header,deck:header.deck,chat:header.chat}, before, 'Long status text consumes chat space');
          assert.equal(header.header, 30); assert.ok(header.deck <= 94);
          assert.equal(header.native.left.y, Math.round(header.slotY), 'Topbar spacing changes native chat bounds');
          await evaluate("document.getElementById('openStudio').click()"); await settle();
          assert.equal(await evaluate("document.getElementById('studioOverlay').hidden"), false, 'Studio cannot open from the running header');
          await click("document.querySelector('.studio-close').click()");
        }
      }
      win.setSize(1366, 820); await click("fixture.state.status='agreed';fixture.state.pages.boss.busy=false;fixture.publish()");
      await capture('studio-workspace.png');
      await click("document.getElementById('effectsMode').value='low-power';document.getElementById('effectsMode').dispatchEvent(new Event('change'))");
      assert.equal(await evaluate("document.body.dataset.effectsMode"), 'low-power');
      assert.ok(await evaluate('ConvergeStarRibbons.diagnostics().every(scene=>scene.paused)'), 'Low power keeps background ribbon loops running');
      await click("document.getElementById('effectsMode').value='full';document.getElementById('effectsMode').dispatchEvent(new Event('change'))");
      await click("document.getElementById('openStudio').click()");
      assert.equal(await evaluate("document.getElementById('studioOverlay').hidden"), false);
      assert.ok(await evaluate('Object.values(fixture.bounds.at(-1)).every(bounds=>bounds.width===0&&bounds.height===0)'), 'Native pages cover the studio');
      assert.equal(await evaluate("document.getElementById('studioPreset').value"), 'document');
      await click("fixture.state.studio.settings.verificationEnabled=false;fixture.state.studio.settings.verificationMode='container-tests';fixture.publish()");
      assert.equal(await evaluate("document.getElementById('studioContainerTests').checked"), false, 'Disabled saved verification advertises container execution');
      assert.equal(await evaluate("document.getElementById('studioContainerTests').disabled"), true);
      await click("document.getElementById('studioContainerTests').checked=true;document.getElementById('studioContainerTests').dispatchEvent(new Event('change'))");
      assert.equal(await evaluate("document.getElementById('studioVerificationEnabled').checked"), true, 'Container selection did not explicitly enable verification');
      assert.equal(await evaluate("document.getElementById('studioContainerTests').disabled"), false);
      await click("document.getElementById('studioVerificationEnabled').click()");
      assert.equal(await evaluate("document.getElementById('studioContainerTests').checked"), false, 'Turning verification off retains selected container tests');
      assert.equal(await evaluate("document.getElementById('studioContainerTests').disabled"), true);
      await click("document.getElementById('studioVerificationEnabled').click();document.getElementById('studioContainerTests').click()");
      assert.equal(await evaluate("document.getElementById('studioContainerTests').checked"), true);
      assert.equal(await evaluate("JSON.parse(localStorage.getItem('converge.studio.preferences')).verificationMode"), 'container-tests');
      await click("document.getElementById('studioPreset').value='research';document.getElementById('studioPreset').dispatchEvent(new Event('change'));document.getElementById('studioCriteria').value='Keep this unsaved criterion';document.getElementById('studioCriteria').dispatchEvent(new Event('input'));document.getElementById('studioFreshAudit').checked=true;document.getElementById('studioFreshAudit').dispatchEvent(new Event('change'));document.getElementById('studioDocumentProfile').value='reference';document.getElementById('studioDocumentProfile').dispatchEvent(new Event('change'));document.getElementById('studioDocumentNotes').value='Readable mathematical serif and full derivations';document.getElementById('studioDocumentNotes').dispatchEvent(new Event('input'));document.getElementById('studioReferenceNames').value='My style.pdf';document.getElementById('studioReferenceNames').dispatchEvent(new Event('input'))");
      await tab('requirements');
      await click("fixture.state.projectInfo={id:'project-1',name:'Autosaved project',status:'saved',savedAt:Date.now()};fixture.publish()");
      await tab('brief');
      assert.equal(await evaluate("document.getElementById('studioCriteria').value"), 'Keep this unsaved criterion', 'Checkpoint refresh erased an unfocused settings draft');
      await click("document.querySelector('.studio-close').click();document.getElementById('openStudio').click()");
      assert.equal(await evaluate("document.getElementById('studioPreset').value"), 'research', 'Reopening Studio erased the unsaved workflow');
      assert.equal(await evaluate("document.getElementById('studioFreshAudit').checked"), true);
      assert.equal(await evaluate("document.getElementById('studioCriteria').value"), 'Keep this unsaved criterion');
      assert.equal(await evaluate("document.getElementById('studioDocumentProfile').value"), 'reference');
      assert.equal(await evaluate("document.getElementById('studioDocumentNotes').value"), 'Readable mathematical serif and full derivations');
      assert.equal(await evaluate("document.getElementById('studioReferenceNames').value"), 'My style.pdf', 'Checkpoint refresh erased a design draft');
      await click("fixture.state.studio.settings.documentDesign={profile:'academic',notes:'Saved notes',referenceNames:['Uploaded.pdf']};fixture.publish()");
      assert.equal(await evaluate("document.getElementById('studioReferenceNames').value"), 'My style.pdf\nUploaded.pdf', 'A confirmed style upload disappeared while design notes were dirty');
      assert.equal(await evaluate("JSON.parse(localStorage.getItem('converge.studio.preferences')).documentDesign.profile"), 'reference');
      await click("document.getElementById('studioPreset').value='software';document.getElementById('studioCriteria').value='Tests pass\\nNo unresolved errors';document.getElementById('studioContainerTests').checked=true;document.getElementById('studioFreshAudit').checked=true;document.querySelector('#studioPanel-brief .studio-button').click()");
      assert.deepEqual(await evaluate("fixture.calls.find(call=>call[0]==='settings')[1]"), { preset: 'software', freshAudit: true, verificationEnabled: true, verificationMode: 'container-tests', acceptanceCriteria: ['Tests pass', 'No unresolved errors'], documentDesign: { profile: 'reference', notes: 'Readable mathematical serif and full derivations', referenceNames: ['My style.pdf', 'Uploaded.pdf'] } });
      await click("document.getElementById('studioReferenceNames').value='1.pdf\\n2.pdf\\n3.pdf\\n4.pdf\\n5.pdf\\n6.pdf';document.getElementById('studioReferenceNames').dispatchEvent(new Event('input'))");
      assert.match(await evaluate("document.getElementById('studioDocumentDesignError').textContent"), /at most 5/);
      assert.equal(await evaluate("document.querySelector('#studioPanel-brief .studio-button').disabled"), true);
      await click("document.getElementById('studioReferenceNames').value='My style.pdf\\nUploaded.pdf';document.getElementById('studioReferenceNames').dispatchEvent(new Event('input'))");
      await capture('studio-brief.png');
      await tab('requirements');
      await click("document.querySelector('#studioPanel-requirements details').open=true;document.querySelector('#studioPanel-requirements textarea').value='Assessment draft survives';document.querySelector('#studioPanel-requirements textarea').dispatchEvent(new Event('input'));document.querySelector('#studioPanel-requirements select').value='failed';document.querySelector('#studioPanel-requirements select').dispatchEvent(new Event('change'));document.querySelector('#studioPanel-requirements textarea').focus()");
      await click("fixture.state.status='running';fixture.publish()");
      assert.equal(await evaluate("document.querySelector('#studioPanel-requirements .studio-button').disabled"), true, 'Focused editor retained an enabled mutation during work');
      assert.equal(await evaluate("document.getElementById('studioDocumentProfile').disabled"), true);
      assert.equal(await evaluate("document.getElementById('studioDocumentNotes').disabled"), true);
      assert.equal(await evaluate("document.getElementById('studioReferenceNames').disabled"), true);
      await click("fixture.state.status='agreed';fixture.publish();document.getElementById('studioTab-revisions').focus();fixture.state.projectInfo.savedAt++;fixture.publish()");
      assert.equal(await evaluate("document.querySelector('#studioPanel-requirements textarea').value"), 'Assessment draft survives', 'Blurred assessment draft disappeared after checkpoint');
      assert.equal(await evaluate("document.querySelector('#studioPanel-requirements select').value"), 'failed');
      await click("document.querySelector('#studioPanel-requirements details').open=true;document.querySelector('#studioPanel-requirements select').value='met';document.querySelector('#studioPanel-requirements textarea').value='Checked chart axis labels';document.querySelector('#studioPanel-requirements .studio-button').click()");
      assert.equal(await evaluate('fixture.state.studio.requirements[0].source'), 'user');
      assert.match(await evaluate("document.getElementById('studioPanel-requirements').textContent"), /Manual/);
      await tab('revisions');
      assert.match(await evaluate("document.querySelector('.studio-diff-line.added').textContent"), /Improved line/);
      assert.equal(await evaluate('window.executed'), undefined, 'Answer HTML executed');
      assert.equal(await evaluate("document.querySelector('.studio-diff img')"), null);
      await click("document.querySelector('.studio-revision-tools .studio-button').click()");
      assert.deepEqual(await evaluate("fixture.calls.find(call=>call[0]==='restore')[1]"), { id: 'revision-2' });
      await click("document.querySelector('.studio-file-actions .studio-button').click()");
      assert.match(await evaluate("document.querySelector('.studio-preview-image').src"), /^data:image\/png;base64,/);
      assert.doesNotMatch(await evaluate("document.querySelector('.studio-status').textContent"), /Working/);
      await click("fixture.unsafePreview=true;document.querySelector('.studio-file-actions .studio-button').click()");
      assert.equal(await evaluate("document.querySelector('.studio-preview-image')"), null, 'Unsafe preview was rendered');
      assert.equal(await evaluate('window.executed'), undefined);
      await click("document.querySelectorAll('.studio-file-row')[1].querySelector('.studio-file-actions .studio-button').click()");
      await click("document.querySelector('.studio-preview>.studio-button').click()");
      assert.equal(await evaluate("fixture.calls.filter(call=>call[0]==='open').length"), 1);
      await capture('studio-revisions.png');
      await tab('issues');
      await click("document.querySelector('.studio-new-issue').open=true;document.querySelector('.studio-new-issue input').value='Unsubmitted new issue';document.querySelector('.studio-new-issue input').dispatchEvent(new Event('input'));document.querySelector('.studio-issue-card details').open=true;document.querySelector('.studio-issue-card textarea').value='Unsubmitted fix evidence';document.querySelector('.studio-issue-card textarea').dispatchEvent(new Event('input'));document.getElementById('studioTab-brief').focus();fixture.state.projectInfo.savedAt++;fixture.publish()");
      assert.equal(await evaluate("document.querySelector('.studio-new-issue input').value"), 'Unsubmitted new issue');
      assert.equal(await evaluate("document.querySelector('.studio-issue-card textarea').value"), 'Unsubmitted fix evidence');
      await click("document.querySelector('.studio-issue-card details').open=true;document.querySelector('.studio-issue-card select').value='rechecked';document.querySelector('.studio-issue-card textarea').value='Chart 2 units checked in revision 2';document.querySelector('.studio-issue-card .studio-button').click()");
      assert.equal(await evaluate('fixture.state.studio.issues[0].status'), 'rechecked');
      await capture('studio-issues.png');
      await tab('checks');
      assert.match(await evaluate("document.getElementById('studioPanel-checks').textContent"), /0 executed checks passed/);
      await click("document.querySelector('#studioPanel-checks .studio-section-head .studio-button').click()");
      assert.match(await evaluate("document.getElementById('studioPanel-checks').textContent"), /1 executed check passed/);
      assert.match(await evaluate("document.getElementById('studioPanel-checks').textContent"), /2 pages decoded/);
      await capture('studio-verification.png');
      await tab('projects');
      assert.match(await evaluate("document.querySelector('.studio-project-row').textContent"), /Most recent project/);
      assert.match(await evaluate("document.querySelector('.studio-project-row').textContent"), /2 draft output files.*chart.png.*report.pdf/);
      assert.match(await evaluate("document.querySelector('.studio-project-save').previousElementSibling.textContent"), /Saved locally/);
      const previousListingCalls = await evaluate("fixture.calls.filter(call=>call[0]==='list').length");
      await click("document.getElementById('studioProjectName').value='Unsaved renamed project';document.getElementById('studioProjectName').dispatchEvent(new Event('input'));document.getElementById('studioTab-revisions').focus();fixture.state.projectInfo.savedAt++;fixture.publish()");
      assert.equal(await evaluate("document.getElementById('studioProjectName').value"), 'Unsaved renamed project', 'Checkpoint replaced the project name draft');
      assert.ok(await evaluate("fixture.calls.filter(call=>call[0]==='list').length") > previousListingCalls, 'An autosave did not refresh the open project library');
      assert.doesNotMatch(await evaluate("document.querySelector('.studio-status').textContent"), /Working/, 'Completed project listing still shows work in progress');
      await click("document.getElementById('question').value='Unsent task edit to preserve';document.getElementById('question').dispatchEvent(new Event('input'))");
      const beforeCancel = await evaluate('JSON.stringify(fixture.state)');
      await click("document.querySelectorAll('.studio-project-tools .studio-button')[0].click()");
      assert.equal(await evaluate("document.getElementById('question').value"), 'Unsent task edit to preserve', 'Cancelling project import clears the user’s current brief');
      assert.equal(await evaluate('JSON.stringify(fixture.state)'), beforeCancel, 'Cancelling import changes the current project');
      assert.equal(await evaluate("document.querySelector('.studio-status').textContent"), 'Cancelled.');
      await click("document.getElementById('studioProjectName').value='Professional report';document.querySelector('.studio-project-save>.studio-button').click()");
      assert.deepEqual(await evaluate("fixture.calls.find(call=>call[0]==='save')[1]"), { name: 'Professional report' });
      assert.equal(await evaluate("document.querySelector('.studio-status').textContent"), 'Project saved.', 'Library refresh overwrites completed save feedback');
      await click("document.querySelector('#studioPanel-projects .studio-section-head .studio-button').click()");
      assert.equal(await evaluate("document.querySelector('.studio-status').textContent"), 'Project saved.', 'Completed library refresh leaves a stale progress message');
      await click("document.querySelectorAll('.studio-project-tools .studio-button')[1].click()");
      await click("document.querySelectorAll('.studio-project-tools .studio-button')[2].click()");
      assert.ok(await evaluate("fixture.calls.some(call=>call[0]==='export')&&fixture.calls.some(call=>call[0]==='delivery')"));
      await click("fixture.state.status='running';fixture.state.tabIds={};fixture.publish()");
      assert.equal(await evaluate("document.querySelector('.studio-header-save').disabled"), false, 'Running tasks block project-library navigation');
      assert.equal(await evaluate("document.querySelector('.studio-project-row .studio-button').disabled"), true, 'Loading a project is enabled during a running task');
      assert.equal(await evaluate("document.querySelectorAll('.studio-project-row .studio-button')[1].disabled"), false, 'Running disconnected work blocks saved-file downloads');
      await click("document.querySelectorAll('.studio-project-row .studio-button')[1].click()");
      assert.deepEqual(await evaluate("fixture.calls.find(call=>call[0]==='projectDownload')[1]"), { id: 'project-1' });
      assert.equal(await evaluate('fixture.state.status'), 'running', 'Downloading a saved project interrupts the active task');
      assert.match(await evaluate("document.querySelector('.studio-status').textContent"), /2 draft files downloaded/);
      await tab('revisions');
      await click("document.querySelectorAll('.studio-file-row')[1].querySelectorAll('.studio-file-actions .studio-button')[1].click()");
      assert.deepEqual(await evaluate("fixture.calls.find(call=>call[0]==='revisionDownload')[1]"), { revisionId: 'revision-2', fileId: 'd'.repeat(64), fileIndex: 1 });
      assert.equal(await evaluate('fixture.state.status'), 'running', 'A revision download interrupts the active task');
      await click("fixture.state.status='agreed';fixture.publish()");
      await tab('projects');
      await capture('studio-projects.png');
      await tab('revisions');
      await click("fixture.delayPreview=true;document.querySelector('.studio-file-actions .studio-button').click()");
      await click("document.querySelector('.studio-revision-row').click();fixture.resolvePreview()");
      assert.equal(await evaluate("document.querySelector('.studio-preview')"), null, 'Late file preview appeared on a different selected revision');
      await click("document.querySelectorAll('.studio-revision-row')[1].click();fixture.delayPreview=true;document.querySelector('.studio-file-actions .studio-button').click()");
      await click("document.querySelector('.studio-close').click();fixture.resolvePreview();document.getElementById('openStudio').click()");
      assert.equal(await evaluate("document.querySelector('.studio-preview')"), null, 'Closed preview request reappeared after Studio reopened');
      await tab('projects');
      await click("document.querySelector('.studio-project-row .studio-button').click()");
      assert.equal(await evaluate("document.getElementById('question').value"), 'Recovered project brief');
      assert.match(await evaluate("document.querySelector('.studio-status').textContent"), /Reconnect/);
      await tab('requirements');
      assert.equal(await evaluate("document.querySelector('#studioPanel-requirements textarea').value"), '', 'A different recovered project retained the previous manual assessment draft');
      await tab('issues');
      assert.equal(await evaluate("document.querySelector('.studio-new-issue input').value"), '', 'A recovered project retained an unsaved issue from the previous project');
      await tab('brief');
      assert.equal(await evaluate("document.getElementById('studioDocumentProfile').value"), 'reference');
      assert.equal(await evaluate("document.getElementById('studioDocumentNotes').value"), 'Match the supplied lecture design');
      assert.equal(await evaluate("document.getElementById('studioReferenceNames').value"), 'GOOD Reference.pdf', 'Project restore kept stale design references');
      await click("document.querySelector('.studio-close').click()");
      assert.equal(await evaluate("document.getElementById('studioOverlay').hidden"), true);
      assert.equal(await evaluate("document.activeElement.id"), 'openStudio');
      win.setSize(900, 650); await settle();
      await click("document.getElementById('openStudio').click()");
      assert.ok(await evaluate("(()=>{const box=document.querySelector('.studio-shell').getBoundingClientRect();return box.left>=0&&box.right<=innerWidth&&box.bottom<=innerHeight})()"));
      await capture('studio-compact.png');
      await tab('issues');
      await click("fixture.state.studio.issues=[{id:'history-only',title:'Completed issue',severity:'low',status:'rechecked',evidence:'Checked',history:[{status:'rechecked',at:Date.now(),evidence:'Done'}]}];fixture.publish()");
      await click("const lastSummary=document.querySelector('.studio-issue-card>details:last-child summary');lastSummary.focus();lastSummary.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}))");
      assert.equal(await evaluate("document.activeElement.className"), 'studio-button studio-header-save', 'Tab from the last history disclosure escapes the modal');
      await tab('revisions');
      await click("document.querySelectorAll('.studio-revision-row')[1].click();fixture.delayPreview=true;document.querySelector('.studio-file-actions .studio-button').click()");
      const closingMarkup = await evaluate("document.getElementById('studioOverlay').innerHTML");
      await click("fixture.closing();fixture.resolvePreview()");
      assert.equal(await evaluate("document.getElementById('studioOverlay').innerHTML"), closingMarkup, 'Closing workspace still accepts the late file preview');
      process.stdout.write('PASS: studio controls and professional typography; native views hidden under the studio, workflow/criteria/container mode, manual evidence, text diff and restore, guarded image/PDF previews, issue recheck, executed versus model evidence, save/export/delivery/recovery, compact geometry, settings/assessment/issue/name drafts across checkpoint refresh and reopen, running mutation guards, stale-preview and close rejection, modal focus trap.\n');
    } finally {
      win.destroy();
      // Chromium may keep fixture HTTP sockets alive after its offscreen
      // window is destroyed. Stop accepting new requests before closing those
      // owned connections so teardown cannot outlive the verified test body.
      await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    }
  }
  app.whenReady().then(run).then(() => app.quit()).catch(error => { process.stderr.write(`${error.stack}\n`); app.exit(1); });
}
