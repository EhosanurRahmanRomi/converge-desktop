(() => {
  'use strict';

  const tabs = [['brief', 'Brief'], ['requirements', 'Requirements'], ['revisions', 'Revisions'], ['issues', 'Issues'], ['checks', 'Verification'], ['projects', 'Projects']];
  const presets = [['auto', 'Automatic'], ['software', 'Software'], ['research', 'Research'], ['document', 'Documents'], ['image', 'Images'], ['trading', 'Trading research']];
  const documentProfiles = [['academic', 'Academic math notes'], ['reference', 'Match attached reference'], ['editorial', 'Editorial report'], ['neutral', 'Neutral document']];
  const labels = { met: 'Met', failed: 'Failed', unverified: 'Unverified', found: 'Found', assigned: 'Assigned', fixed: 'Fixed', rechecked: 'Rechecked', reopened: 'Reopened', passed: 'Passed', saved: 'Saved locally', running: 'Running', idle: 'Not run', opening: 'Opening' };
  const node = (tag, className, text) => { const element = document.createElement(tag); if (className) element.className = className; if (text !== undefined) element.textContent = String(text); return element; };
  const list = value => Array.isArray(value) ? value : [];
  const safeText = value => String(value ?? '').slice(0, 250000);
  const evidenceText = value => Array.isArray(value) ? value.map(entry => typeof entry === 'string' ? entry : `${entry.source || 'review'}: ${entry.text || entry.evidence || ''}`).join('\n') : String(value || '');
  const time = value => { const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''; };
  const bytes = value => Number(value) >= 1048576 ? `${(Number(value) / 1048576).toFixed(1)} MB` : Number(value) >= 1024 ? `${(Number(value) / 1024).toFixed(1)} KB` : `${Number(value) || 0} B`;
  const digest = value => value ? `${String(value).slice(0, 12)}…` : 'Hash unavailable';
  const button = (label, operation, className = 'studio-button') => { const control = node('button', className, label); control.type = 'button'; if (operation) control.addEventListener('click', operation); return control; };
  const badge = (status, source) => { const element = node('span', `studio-badge ${status || 'unverified'}`, labels[status] || status || 'Unverified'); if (source) element.append(node('span', '', ` · ${source === 'executed' ? 'Executed' : source === 'model' ? 'Model review' : 'Manual'}`)); return element; };
  const field = (label, control, help) => { const wrapper = node('label', 'studio-field'); wrapper.append(node('span', '', label), control); if (help) wrapper.append(node('small', '', help)); return wrapper; };
  const select = (choices, value) => { const control = node('select', 'studio-select'); for (const [key, label] of choices) { const option = node('option', '', label); option.value = key; control.append(option); } control.value = value; return control; };
  const empty = (title, detail) => { const element = node('div', 'studio-empty'); element.append(node('h3', '', title), node('p', '', detail)); return element; };
  const sectionHead = (title, detail, action) => { const head = node('div', 'studio-section-head'); const copy = node('div'); copy.append(node('h2', '', title), node('p', '', detail)); head.append(copy); if (action) head.append(action); return head; };

  // This is a bounded display diff. It never evaluates answer text or opens
  // model supplied file locations. Oversized answers fall back to plain text.
  function answerDiff(before, after) {
    const left = safeText(before).split('\n'), right = safeText(after).split('\n');
    if (left.length * right.length > 1000000) return { limited: true, lines: right.map(text => ({ kind: 'context', text })) };
    const table = Array.from({ length: left.length + 1 }, () => new Uint16Array(right.length + 1));
    for (let i = left.length - 1; i >= 0; i--) for (let j = right.length - 1; j >= 0; j--) table[i][j] = left[i] === right[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    const lines = []; let i = 0, j = 0;
    while (i < left.length || j < right.length) {
      if (i < left.length && j < right.length && left[i] === right[j]) { lines.push({ kind: 'context', text: left[i++] }); j++; }
      else if (j < right.length && (i === left.length || table[i][j + 1] >= table[i + 1][j])) lines.push({ kind: 'added', text: right[j++] });
      else lines.push({ kind: 'removed', text: left[i++] });
    }
    return { lines, limited: false };
  }

  function create({ api, getState, onLayout, onState, onOpen, onLoadBrief, getBrief }) {
    let currentTab = 'brief', opened = false, working = false, projects = [], projectError = '', recoveryError = '', stateKey = '', selectedRevision = '', compareRevision = '';
    let latestState = getState();
    let settingsDirty = false, projectNameDirty = false, previewGeneration = 0, disposed = false, projectLibraryVersion = '';
    let lastProjectId = latestState?.projectInfo?.id || null;
    let lastTask = latestState?.studio?.contract?.task || latestState?.question || '';
    const editorDrafts = new Map();
    const designDirty = new Set();
    let lastCommittedReferences = [];
    const overlay = node('section', 'studio-overlay'); overlay.id = 'studioOverlay'; overlay.hidden = true; overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true'); overlay.setAttribute('aria-labelledby', 'studioTitle');
    const shell = node('div', 'studio-shell'); const header = node('header', 'studio-header');
    const mark = node('span', 'studio-mark', '◈'); mark.setAttribute('aria-hidden', 'true');
    const heading = node('div', 'studio-heading'); const title = node('h1', '', 'Project studio'); title.id = 'studioTitle';
    const subtitle = node('p', '', 'Manage the brief, files and review history.'); heading.append(title, subtitle);
    const save = button('Save project', () => chooseTab('projects'), 'studio-button studio-header-save');
    const close = button('×', () => setOpen(false), 'studio-close'); close.setAttribute('aria-label', 'Close project studio');
    header.append(mark, heading, save, close);
    const metrics = node('div', 'studio-metrics');
    const body = node('div', 'studio-body'); const navigation = node('nav', 'studio-nav'); navigation.setAttribute('aria-label', 'Project studio sections'); navigation.setAttribute('role', 'tablist');
    const content = node('div', 'studio-content'); const status = node('p', 'studio-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const panels = {}, controls = {};
    for (const [key, label] of tabs) {
      const control = button(label, () => chooseTab(key), 'studio-tab'); control.id = `studioTab-${key}`; control.setAttribute('role', 'tab'); control.setAttribute('aria-controls', `studioPanel-${key}`);
      const panel = node('section', 'studio-panel'); panel.id = `studioPanel-${key}`; panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', control.id); panel.hidden = key !== currentTab;
      navigation.append(control); content.append(panel); panels[key] = panel; controls[key] = control;
    }
    body.append(navigation, content); shell.append(header, metrics, body, status); overlay.append(shell); document.getElementById('app').append(overlay);
    const trigger = document.getElementById('openStudio'); trigger?.addEventListener('click', () => setOpen(!opened));
    navigation.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      const index = tabs.findIndex(([key]) => key === currentTab); const offset = ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1;
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + offset + tabs.length) % tabs.length;
      event.preventDefault(); chooseTab(tabs[next][0]); controls[currentTab].focus();
    });
    overlay.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); return; }
      if (event.key !== 'Tab') return;
      const elements = Array.from(shell.querySelectorAll('button,input,textarea,select,summary,a[href],[tabindex="0"]')).filter(element => !element.disabled && element.getClientRects().length);
      const first = elements[0], last = elements.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    });

    function notify(message, error = false) { status.textContent = message; status.classList.toggle('error', error); }
    function bindDraft(control, key) {
      const read = () => control.tagName === 'DETAILS' ? control.open : control.value;
      if (editorDrafts.has(key)) {
        if (control.tagName === 'DETAILS') control.open = editorDrafts.get(key);
        else control.value = editorDrafts.get(key);
      }
      const remember = () => editorDrafts.set(key, read());
      control.addEventListener(control.tagName === 'DETAILS' ? 'toggle' : 'input', remember);
      if (control.tagName !== 'DETAILS') control.addEventListener('change', remember);
      return control;
    }
    function clearDrafts(prefix = '') { for (const key of editorDrafts.keys()) if (key.startsWith(prefix)) editorDrafts.delete(key); }
    function resetProjectDrafts() { clearDrafts(); designDirty.clear(); lastCommittedReferences = []; settingsDirty = false; projectNameDirty = false; selectedRevision = ''; compareRevision = ''; previewGeneration++; }
    const quiesce = () => { disposed = true; previewGeneration++; };
    const removeClosingListener = api?.onClosing?.(quiesce);
    window.addEventListener('pagehide', () => { quiesce(); if (typeof removeClosingListener === 'function') removeClosingListener(); }, { once: true });
    async function invoke(method, payload, success, refresh = true) {
      if (working || disposed) return null;
      if (typeof api?.[method] !== 'function') { notify('This control is unavailable in this app build.', true); return null; }
      const previousNotice = { text: status.textContent, error: status.classList.contains('error') };
      working = true; shell.classList.add('studio-working'); notify('Working…');
      try {
        const result = payload === undefined ? await api[method]() : await api[method](payload);
        if (disposed) return null;
        if (result?.ok === false) throw new Error(result.error || 'The action did not complete.');
        if (result?.cancelled || result?.canceled) { notify('Cancelled.'); return result; }
        if (method === 'projectLoad' || method === 'projectImport') resetProjectDrafts();
        if (method === 'requirementReview') clearDrafts(`requirement:${payload.id}:`);
        if (method === 'issueReview') clearDrafts(payload.id ? `issue:${payload.id}:` : 'issue:new:');
        if (method === 'studioSettings' && JSON.stringify(settings()) === JSON.stringify(payload)) { settingsDirty = false; designDirty.clear(); }
        if (method === 'projectSave' && payload?.name === projectName.value.trim()) projectNameDirty = false;
        if (result?.state) { latestState = result.state; onState?.(result.state); }
        if (success) notify(typeof success === 'function' ? success(result || {}) : success);
        else if (status.textContent === 'Working…') notify(previousNotice.text, previousNotice.error);
        if (refresh) render(latestState, true);
        return result || {};
      } catch (error) { if (!disposed) notify(String(error?.message || error), true); return null; }
      finally { working = false; if (!disposed) shell.classList.remove('studio-working'); }
    }
    function setOpen(value) {
      if (disposed) return;
      opened = Boolean(value); overlay.hidden = !opened; trigger?.setAttribute('aria-expanded', String(opened)); document.getElementById('app').classList.toggle('studio-open', opened);
      if (!opened) previewGeneration++;
      if (opened) { onOpen?.(); render(getState(), true); chooseTab(currentTab); requestAnimationFrame(() => close.focus({ preventScroll: true })); }
      else trigger?.focus({ preventScroll: true });
      onLayout?.();
    }
    function chooseTab(key) {
      if (!panels[key]) return; const changed = key !== currentTab; currentTab = key;
      if (changed) previewGeneration++;
      for (const [name] of tabs) { panels[name].hidden = name !== key; controls[name].setAttribute('aria-selected', String(name === key)); controls[name].tabIndex = name === key ? 0 : -1; }
      if (changed) content.scrollTop = 0;
      if (key === 'projects' && opened) refreshProjects();
    }
    async function refreshProjects() {
      const result = await invoke('projectList', undefined, null, false);
      if (!result) return;
      projects = list(result.projects || result.items); projectError = result.error || ''; renderProjects();
    }
    function studio() { return latestState?.studio || {}; }
    function requirements() { return list(studio().requirements); }
    function revisions() { return list(studio().revisions); }
    function issues() { return list(studio().issues); }

    const preset = select(presets, 'auto'); preset.id = 'studioPreset';
    const criteria = node('textarea', 'studio-textarea'); criteria.id = 'studioCriteria'; criteria.rows = 6; criteria.maxLength = 10000; criteria.placeholder = 'One acceptance criterion per line\nExample: Every chart includes units and sources';
    const auditToggle = node('input'); auditToggle.type = 'checkbox'; auditToggle.id = 'studioFreshAudit';
    auditToggle.checked = true;
    const verifyToggle = node('input'); verifyToggle.type = 'checkbox'; verifyToggle.id = 'studioVerificationEnabled'; verifyToggle.checked = true;
    const containerToggle = node('input'); containerToggle.type = 'checkbox'; containerToggle.id = 'studioContainerTests';
    const documentProfile = select(documentProfiles, 'academic'); documentProfile.id = 'studioDocumentProfile';
    const documentNotes = node('textarea', 'studio-textarea'); documentNotes.id = 'studioDocumentNotes'; documentNotes.rows = 3; documentNotes.maxLength = 6000;
    documentNotes.placeholder = 'Example: clear serif body, readable equations, restrained color, generous spacing, numbered derivations.';
    const referenceNames = node('textarea', 'studio-textarea'); referenceNames.id = 'studioReferenceNames'; referenceNames.rows = 2; referenceNames.maxLength = 904;
    referenceNames.placeholder = 'Exact attached filename, one per line'; referenceNames.spellcheck = false;
    const documentError = node('p', 'studio-design-error'); documentError.id = 'studioDocumentDesignError'; documentError.hidden = true; documentError.setAttribute('role', 'alert');
    try {
      const preferences = JSON.parse(localStorage.getItem('converge.studio.preferences') || '{}');
      if (presets.some(([key]) => key === preferences.preset)) preset.value = preferences.preset;
      if (typeof preferences.freshAudit === 'boolean') auditToggle.checked = preferences.freshAudit;
      if (typeof preferences.verificationEnabled === 'boolean') verifyToggle.checked = preferences.verificationEnabled;
      containerToggle.checked = preferences.verificationMode === 'container-tests';
      if (Array.isArray(preferences.acceptanceCriteria)) criteria.value = preferences.acceptanceCriteria.map(value => String(value).slice(0, 4000)).slice(0, 30).join('\n');
      if (documentProfiles.some(([key]) => key === preferences.documentDesign?.profile)) documentProfile.value = preferences.documentDesign.profile;
      if (typeof preferences.documentDesign?.notes === 'string') documentNotes.value = preferences.documentDesign.notes.slice(0, 6000);
      if (Array.isArray(preferences.documentDesign?.referenceNames)) referenceNames.value = preferences.documentDesign.referenceNames.slice(0, 5).join('\n');
    } catch (_) { }
    if (!verifyToggle.checked) containerToggle.checked = false;
    containerToggle.disabled = !verifyToggle.checked;
    const briefCard = node('div', 'studio-card studio-brief-card');
    const briefText = node('p', 'studio-brief-text');
    const settingsButton = button('Apply to this task', () => { try { invoke('studioSettings', settings(), 'Review settings saved.'); } catch (error) { notify(error.message, true); } });
    const settingsArea = node('div', 'studio-settings-grid');
    settingsArea.append(field('Workflow', preset, 'Choose the review checks that match your work.'), field('Acceptance criteria', criteria, 'One concrete condition per line · Up to 30 criteria.'));
    const designCard = node('section', 'studio-card'); designCard.id = 'studioDocumentDesign'; designCard.setAttribute('aria-label', 'Document design');
    designCard.append(node('h3', '', 'Document design'), node('p', 'studio-help', 'Set the typography, equation style and page organization for generated documents. Appearance references do not add topics to your task.'),
      field('Design profile', documentProfile, 'Academic math notes is the default for readable theory, worked steps and equations.'),
      field('Design notes', documentNotes, 'Describe the visual details to preserve · Up to 6,000 characters.'),
      field('Attached design reference filenames', referenceNames, 'Up to 5 exact filenames, one per line. Attach the actual files with “Add a design reference” in Review controls; listing a name does not upload it.'), documentError);
    const options = node('div', 'studio-options');
    const option = (input, label, help) => { const wrapper = node('label', 'studio-option'); const copy = node('span'); copy.append(node('strong', '', label), node('small', '', help)); wrapper.append(input, copy); return wrapper; };
    options.append(option(auditToggle, 'Fresh final audit', 'A fresh worker reviews the final candidate before handoff.'), option(verifyToggle, 'Run file verification', 'Run local structural checks on retrieved output files.'), option(containerToggle, 'Run container tests', 'Docker required. Execute project tests in an isolated container.'));
    briefCard.append(node('span', 'studio-card-kicker', 'Current task'), briefText);
    panels.brief.append(sectionHead('Task brief', 'Choose the workflow and define what a complete result must include.'), briefCard, settingsArea, designCard, options, settingsButton);
    function documentDesign() {
      const names = referenceNames.value.split(/\r?\n/).filter(value => value.length);
      const invalid = names.find(name => name.length > 180 || name !== name.trim() || /[\\/<>:"|?*\x00-\x1f\x7f]/.test(name) || /[. ]$/.test(name));
      const message = names.length > 5 ? 'Use at most 5 attached reference filenames.' : invalid ? 'Use the exact filename without paths, extra spaces or unsupported characters.' : '';
      documentError.textContent = message; documentError.hidden = !message; referenceNames.setCustomValidity(message);
      if (message) throw new Error(message);
      return { profile: documentProfiles.some(([key]) => key === documentProfile.value) ? documentProfile.value : 'academic', notes: documentNotes.value.slice(0, 6000), referenceNames: [...new Set(names)] };
    }
    function settings() {
      const result = { preset: preset.value, freshAudit: auditToggle.checked, verificationEnabled: verifyToggle.checked, verificationMode: verifyToggle.checked && containerToggle.checked ? 'container-tests' : 'static', acceptanceCriteria: criteria.value.split('\n').map(value => value.trim()).filter(Boolean).slice(0, 30), documentDesign: documentDesign() };
      try { localStorage.setItem('converge.studio.preferences', JSON.stringify(result)); } catch (_) { }
      return result;
    }
    const rememberSettings = () => { settingsDirty = true; try { settings(); } catch (_) {} settingsButton.disabled = latestState.status === 'running' || !documentError.hidden; };
    for (const control of [preset, criteria, auditToggle]) control.addEventListener('change', rememberSettings);
    criteria.addEventListener('input', rememberSettings);
    for (const [key, control] of [['profile', documentProfile], ['notes', documentNotes], ['referenceNames', referenceNames]]) {
      const remember = () => { designDirty.add(key); rememberSettings(); };
      control.addEventListener('change', remember); if (control.tagName === 'TEXTAREA') control.addEventListener('input', remember);
    }
    verifyToggle.addEventListener('change', () => {
      if (!verifyToggle.checked) containerToggle.checked = false;
      containerToggle.disabled = latestState.status === 'running' || !verifyToggle.checked;
      rememberSettings();
    });
    containerToggle.addEventListener('change', () => {
      if (containerToggle.checked) verifyToggle.checked = true;
      containerToggle.disabled = latestState.status === 'running' || !verifyToggle.checked;
      rememberSettings();
    });
    function renderBrief() {
      const data = studio(); const focused = panels.brief.contains(document.activeElement);
      briefText.textContent = data.contract?.task || latestState.question || getBrief?.() || 'Your task brief appears here when you start the team.';
      if (!settingsDirty && !focused && data.settings && (data.contract?.task || latestState.question)) {
        preset.value = data.preset || 'auto'; criteria.value = list(data.contract?.acceptanceCriteria).join('\n'); auditToggle.checked = Boolean(data.settings?.freshAudit); verifyToggle.checked = data.settings?.verificationEnabled !== false; containerToggle.checked = data.settings?.verificationMode === 'container-tests';
      }
      const design = data.settings?.documentDesign;
      if (design && typeof design === 'object') {
        if (!designDirty.has('profile')) documentProfile.value = documentProfiles.some(([key]) => key === design.profile) ? design.profile : 'academic';
        if (!designDirty.has('notes')) documentNotes.value = typeof design.notes === 'string' ? design.notes.slice(0, 6000) : '';
        const committed = list(design.referenceNames).slice(0, 5);
        if (!designDirty.has('referenceNames')) referenceNames.value = committed.join('\n');
        else {
          const added = committed.filter(name => !lastCommittedReferences.includes(name));
          if (added.length) referenceNames.value = [...new Set([...referenceNames.value.split(/\r?\n/).filter(Boolean), ...added])].join('\n');
        }
        lastCommittedReferences = [...committed];
      }
      try { documentDesign(); } catch (_) {}
      if (!verifyToggle.checked) containerToggle.checked = false;
      const running = latestState.status === 'running';
      settingsButton.disabled = running || !documentError.hidden; preset.disabled = running; criteria.disabled = running; auditToggle.disabled = running; verifyToggle.disabled = running; containerToggle.disabled = running || !verifyToggle.checked;
      documentProfile.disabled = running; documentNotes.disabled = running; referenceNames.disabled = running;
    }
    function reviewCard(title, detail, content) { const card = node('article', 'studio-card'); const head = node('div', 'studio-card-head'); head.append(node('h3', '', title)); if (detail) head.append(detail); card.append(head); if (content) card.append(node('p', 'studio-card-copy', content)); return card; }
    function renderRequirements() {
      const panel = panels.requirements; panel.replaceChildren(sectionHead('Acceptance checklist', 'Each condition stays linked to its review evidence.'));
      if (!requirements().length) { panel.append(empty('No requirements yet', 'Add acceptance criteria in the Brief tab, then apply them to this task.')); return; }
      const cards = node('div', 'studio-card-list');
      for (const requirement of requirements()) {
        const card = reviewCard(requirement.text, badge(requirement.status, requirement.source), evidenceText(requirement.evidence) || 'No evidence recorded yet.');
        const details = bindDraft(node('details', 'studio-review-editor'), `requirement:${requirement.id}:open`); details.append(node('summary', '', 'Record your assessment'));
        const disposition = bindDraft(select([['unverified', 'Unverified'], ['met', 'Met'], ['failed', 'Failed']], requirement.status || 'unverified'), `requirement:${requirement.id}:status`);
        const evidence = node('textarea', 'studio-textarea'); evidence.rows = 2; evidence.maxLength = 4000; evidence.placeholder = 'What did you check? Record the result.';
        bindDraft(evidence, `requirement:${requirement.id}:evidence`);
        const submit = button('Save assessment', () => invoke('requirementReview', { id: requirement.id, status: disposition.value, evidence: evidence.value.trim() }, 'Manual assessment saved.'));
        details.append(field('Your assessment', disposition), field('Evidence', evidence), node('small', 'studio-help', 'Your assessment is recorded as manual evidence.'), submit);
        submit.dataset.requiresIdle = 'true'; submit.disabled = latestState.status === 'running'; card.append(details); cards.append(card);
      }
      panel.append(cards);
    }
    function renderRevisions() {
      previewGeneration++;
      const panel = panels.revisions; panel.replaceChildren(sectionHead('Revision history', 'Compare the written answer and inspect the files attached to each revision.'));
      const history = revisions();
      if (!history.length) { panel.append(empty('The first revision is still ahead', 'Answers and retrieved files appear here as the team develops the task.')); return; }
      if (!history.some(item => item.id === selectedRevision)) selectedRevision = studio().preferredRevisionId || history.at(-1).id;
      if (!history.some(item => item.id === compareRevision)) compareRevision = history.length > 1 ? history.at(-2).id : history[0].id;
      const selected = history.find(item => item.id === selectedRevision) || history.at(-1);
      const comparison = history.find(item => item.id === compareRevision) || history[0];
      const layout = node('div', 'studio-revision-layout'); const rail = node('div', 'studio-revision-list');
      for (const [index, revision] of history.entries()) {
        const row = button('', () => { selectedRevision = revision.id; renderRevisions(); }, 'studio-revision-row'); row.classList.toggle('selected', revision.id === selected.id);
        const text = node('span'); text.append(node('strong', '', `Revision ${index + 1}${revision.id === studio().preferredRevisionId ? ' · current' : ''}`), node('small', '', `${revision.author || 'Team'}${revision.round ? ` · Round ${revision.round}` : ''}`));
        const meta = node('span'); meta.append(node('small', '', time(revision.createdAt)), node('small', '', `${list(revision.files).length} files`)); row.append(text, meta); rail.append(row);
      }
      const detail = node('div', 'studio-revision-detail'); const compareChoices = history.map((revision, index) => [revision.id, `Revision ${index + 1}${revision.id === selected.id ? ' · selected' : ''}`]);
      const before = select(compareChoices, comparison.id); before.id = 'studioCompareRevision'; before.addEventListener('change', () => { compareRevision = before.value; renderRevisions(); });
      const tools = node('div', 'studio-revision-tools'); const restore = button('Use this revision', () => invoke('restoreRevision', { id: selected.id }, 'Revision restored. Further work will begin from this candidate.'));
      restore.disabled = latestState.status === 'running'; tools.append(field('Compare against', before), restore);
      detail.append(tools, node('p', 'studio-hash', `Candidate SHA-256: ${selected.sha256 || 'Unavailable'}`));
      const changes = answerDiff(comparison.answer || comparison.text, selected.answer || selected.text);
      const added = changes.lines.filter(line => line.kind === 'added').length, removed = changes.lines.filter(line => line.kind === 'removed').length;
      detail.append(node('p', 'studio-diff-summary', changes.limited ? 'Large answer: showing the selected revision without a line comparison.' : selected.id === comparison.id ? 'Showing the selected revision.' : `${added} added ${added === 1 ? 'line' : 'lines'} · ${removed} removed ${removed === 1 ? 'line' : 'lines'}`));
      const diff = node('pre', 'studio-diff'); diff.setAttribute('aria-label', 'Answer revision comparison');
      for (const line of changes.lines.slice(0, 6000)) { const row = node('span', `studio-diff-line ${line.kind}`, `${line.kind === 'added' ? '+ ' : line.kind === 'removed' ? '− ' : '  '}${line.text || ' '}`); diff.append(row); }
      detail.append(diff);
      const files = node('div', 'studio-file-list'); files.append(node('h3', '', 'Revision files'));
      if (!list(selected.files).length) files.append(node('p', 'studio-help', 'No files were retrieved for this revision.'));
      for (const [index, file] of list(selected.files).entries()) {
        const row = node('div', 'studio-file-row'); const copy = node('div'); copy.append(node('strong', '', file.name || file.filename || `File ${index + 1}`), node('small', '', `${file.mimeType || file.kind || 'File'} · ${bytes(file.byteLength || file.size)} · SHA-256 ${digest(file.contentSha256 || file.sha256)}`));
        if (comparison.id !== selected.id) {
          const priorFile = list(comparison.files).find(prior => prior.name === file.name);
          const changed = !priorFile ? 'Added' : priorFile.contentSha256 && file.contentSha256 ? priorFile.contentSha256 === file.contentSha256 ? 'Unchanged' : 'Changed' : 'Hash comparison unavailable';
          copy.append(node('small', 'studio-file-change', `${changed} from the compared revision`));
        }
        const actions = node('div', 'studio-file-actions');
        actions.append(button('Preview', () => previewFile(selected, file, index), 'studio-button subtle'));
        if (typeof api.studioRevisionSave === 'function') actions.append(button('Download', () => invoke('studioRevisionSave',
          { revisionId: selected.id, fileId: file.id || file.contentSha256 || file.name, fileIndex: index },
          result => result.saved ? `Downloaded ${result.name || file.name}. This is the selected revision; its review status is unchanged.` : '', false), 'studio-button subtle'));
        row.append(copy, actions); files.append(row);
      }
      if (comparison.id !== selected.id) for (const priorFile of list(comparison.files).filter(prior => !list(selected.files).some(file => file.name === prior.name))) {
        const row = node('div', 'studio-file-row'); const copy = node('div'); copy.append(node('strong', '', priorFile.name), node('small', '', 'Removed from the selected revision')); row.append(copy); files.append(row);
      }
      detail.append(files); layout.append(rail, detail); panel.append(layout);
    }
    async function previewFile(revision, file, index) {
      const generation = previewGeneration;
      const result = await invoke('studioRevisionPreview', { revisionId: revision.id, fileId: file.id || file.contentSha256 || file.name, fileIndex: index }, null, false);
      if (!result || result.cancelled || result.canceled || disposed || !opened || currentTab !== 'revisions' || generation !== previewGeneration || selectedRevision !== revision.id) return;
      const preview = result.preview || result; const container = node('div', 'studio-preview');
      const heading = node('div', 'studio-card-head'); heading.append(node('h3', '', preview.name || file.name || 'File preview'), button('Close preview', () => container.remove(), 'studio-button subtle')); container.append(heading);
      const imageData = value => typeof value === 'string' && value.length < 12 * 1024 * 1024 && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value);
      if (preview.kind === 'image' && imageData(preview.dataUrl)) { const image = node('img', 'studio-preview-image'); image.src = preview.dataUrl; image.alt = preview.name || 'Revision image preview'; container.append(image); }
      else if (preview.kind === 'pdf' && list(preview.pages).some(page => imageData(typeof page === 'string' ? page : page.dataUrl))) {
        for (const [pageNumber, page] of list(preview.pages).slice(0, 12).entries()) { const source = typeof page === 'string' ? page : page.dataUrl; if (!imageData(source)) continue; const image = node('img', 'studio-preview-image pdf'); image.src = source; image.alt = `PDF page ${pageNumber + 1}`; container.append(image); }
        container.append(node('p', 'studio-help', `Showing ${Math.min(12, list(preview.pages).length)} preview pages${preview.pageCount ? ` of ${preview.pageCount}` : ''}.`));
      } else if (preview.kind === 'text' && typeof preview.text === 'string') container.append(node('pre', 'studio-preview-text', safeText(preview.text)));
      else container.append(node('p', 'studio-help', preview.message || preview.unavailable || (preview.kind === 'pdf' ? 'Open this PDF in your document viewer to inspect the complete file.' : 'An inline preview is unavailable for this file.')));
      if (preview.kind === 'pdf' && typeof api.studioRevisionOpen === 'function') container.append(button('Open PDF', () => invoke('studioRevisionOpen', { revisionId: revision.id, fileId: file.id || file.contentSha256 || file.name, fileIndex: index }, 'PDF opened.', false)));
      panels.revisions.querySelector('.studio-preview')?.remove(); panels.revisions.append(container); container.scrollIntoView({ block: 'nearest' });
    }
    function renderIssues() {
      const panel = panels.issues; panel.replaceChildren(sectionHead('Issue board', 'Follow findings through assignment, fixes and a recorded recheck.'));
      const createIssue = bindDraft(node('details', 'studio-new-issue'), 'issue:new:open'); createIssue.append(node('summary', '', 'Add an issue'));
      const title = node('input', 'studio-input'); title.maxLength = 300; title.placeholder = 'Describe the problem';
      bindDraft(title, 'issue:new:title');
      const severity = bindDraft(select([['high', 'High'], ['medium', 'Medium'], ['low', 'Low'], ['critical', 'Critical']], 'medium'), 'issue:new:severity');
      const add = button('Add issue', () => { if (!title.value.trim()) { notify('Give the issue a clear title.', true); title.focus(); return; } invoke('issueReview', { title: title.value.trim(), severity: severity.value, status: 'found', evidence: 'Added by the user.' }, 'Issue added.'); });
      add.dataset.requiresIdle = 'true'; add.disabled = latestState.status === 'running'; createIssue.append(field('Issue', title), field('Priority', severity), add); panel.append(createIssue);
      const board = node('div', 'studio-issue-board');
      for (const [column, heading, statuses] of [['open', 'To address', ['found', 'reopened']], ['working', 'In progress', ['assigned', 'fixed']], ['closed', 'Rechecked', ['rechecked']]]) {
        const lane = node('section', `studio-issue-lane ${column}`); const laneIssues = issues().filter(issue => statuses.includes(issue.status)); lane.append(node('h3', '', `${heading} · ${laneIssues.length}`));
        if (!laneIssues.length) lane.append(node('p', 'studio-lane-empty', 'No issues here.'));
        for (const issue of laneIssues) {
          const card = node('article', 'studio-issue-card'); card.append(node('span', `studio-priority ${issue.severity}`, issue.severity || 'medium'), node('h4', '', issue.title), badge(issue.status), node('p', '', evidenceText(issue.evidence) || 'No evidence recorded.'));
          if (issue.assignedTo) card.append(node('small', '', `Assigned to ${issue.assignedTo === 'left' ? 'Worker A' : issue.assignedTo === 'right' ? 'Worker B' : issue.assignedTo}`));
          const edit = bindDraft(node('details', 'studio-review-editor'), `issue:${issue.id}:open`); edit.append(node('summary', '', 'Update status'));
          const disposition = bindDraft(select([['found', 'Found'], ['assigned', 'Assigned'], ['fixed', 'Fixed'], ['rechecked', 'Rechecked'], ['reopened', 'Reopened']], issue.status), `issue:${issue.id}:status`);
          const assignee = bindDraft(select([['', 'Unassigned'], ['left', 'Worker A'], ['right', 'Worker B']], issue.assignedTo || ''), `issue:${issue.id}:assignee`);
          const evidence = node('textarea', 'studio-textarea'); evidence.rows = 2; evidence.maxLength = 4000; evidence.placeholder = 'Record the fix or recheck evidence';
          bindDraft(evidence, `issue:${issue.id}:evidence`);
          const submit = button('Save update', () => invoke('issueReview', { id: issue.id, status: disposition.value, assignedTo: assignee.value || null, evidence: evidence.value.trim() }, 'Issue updated.'));
          submit.dataset.requiresIdle = 'true'; submit.disabled = latestState.status === 'running'; edit.append(disposition, assignee, evidence, submit); card.append(edit); lane.append(card);
          if (list(issue.history).length) {
            const history = node('details', 'studio-review-editor'); history.append(node('summary', '', 'Status history'));
            for (const entry of list(issue.history)) history.append(node('p', '', `${labels[entry.status] || entry.status} · ${time(entry.at)}${entry.evidence ? `\n${evidenceText(entry.evidence)}` : ''}`));
            card.append(history);
          }
        }
        board.append(lane);
      }
      panel.append(board);
    }
    function renderChecks() {
      const panel = panels.checks; const data = studio(); const verification = data.verification || {};
      const run = button(verification.status === 'running' ? 'Checking files…' : 'Run verification', () => invoke('verificationRun', undefined, 'Verification finished.'));
      run.disabled = latestState.status === 'running' || verification.status === 'running' || !revisions().length;
      panel.replaceChildren(sectionHead('Verification lab', 'Executed file checks are shown separately from the team’s review.', run));
      const audit = data.freshAudit || {}; const summary = node('div', 'studio-check-summary');
      const verified = list(verification.checks).filter(check => check.source === 'executed' && check.status === 'passed').length;
      const checksCard = reviewCard('Local file checks', badge(verification.status || 'idle'), verification.summary || 'Run verification after the team retrieves output files.');
      checksCard.append(node('small', 'studio-help', `${verified} executed ${verified === 1 ? 'check' : 'checks'} passed. Checks confirm the properties listed below.`));
      const auditSummary = audit.review?.summary || audit.summary || (audit.review ? audit.review.verdict === 'accept' ? 'A fresh worker accepted this exact candidate after an independent review.' : audit.review.verdict === 'revise' ? 'The fresh worker found issues that require another revision.' : 'The fresh worker could not verify this candidate.' : audit.enabled ? 'A fresh worker will inspect the final candidate.' : 'Enable a fresh audit in the Brief tab.');
      const auditCard = reviewCard('Fresh final audit', badge(audit.status || 'idle', 'model'), auditSummary);
      if (audit.review) {
        const observed = [...list(audit.review.checks), ...list(audit.review.issues)].map(evidenceText).filter(Boolean);
        if (observed.length) auditCard.append(node('p', 'studio-card-copy', observed.join('\n')));
        if (audit.review.answer) auditCard.append(node('p', 'studio-card-copy', audit.review.answer));
        if (!observed.length && !audit.review.answer && audit.review.verdict) auditCard.append(node('p', 'studio-help', `Independent model verdict: ${audit.review.verdict}.`));
      }
      summary.append(checksCard, auditCard); panel.append(summary);
      if (!list(verification.checks).length) panel.append(empty('No executed checks yet', 'Verification records a result only when a local check actually runs.'));
      for (const check of list(verification.checks)) {
        const card = reviewCard(check.label || check.id || 'Check', badge(check.status || 'unverified', check.source || 'model'), evidenceText(check.evidence) || 'No execution evidence recorded.');
        if (check.candidateSha256) card.append(node('small', 'studio-hash', `Candidate SHA-256 ${check.candidateSha256}`)); panel.append(card);
      }
    }
    const projectName = node('input', 'studio-input'); projectName.id = 'studioProjectName'; projectName.maxLength = 120; projectName.placeholder = 'Name this project';
    projectName.addEventListener('input', () => { projectNameDirty = true; });
    function renderProjects() {
      const panel = panels.projects;
      const refresh = button('Refresh', refreshProjects, 'studio-button subtle');
      panel.replaceChildren(sectionHead('Saved projects & downloads', 'Download saved output files directly, or reopen a project to continue its review.', refresh));
      const info = latestState.projectInfo;
      if (info?.name) {
        const autosave = info.status === 'error' ? `Recovery save failed: ${info.error || 'Try Save project again.'}` : info.status === 'saving' ? 'Saving recovery checkpoint…' : info.savedAt ? `Recovery checkpoint saved ${time(info.savedAt)}` : 'Project ready';
        panel.append(reviewCard(info.name, badge(info.status === 'error' ? 'failed' : info.status === 'saving' ? 'running' : 'saved'), autosave));
        if (!projectNameDirty && document.activeElement !== projectName) projectName.value = info.name;
      }
      const saveCard = node('div', 'studio-card studio-project-save'); saveCard.append(field('Project name', projectName), button('Save project', () => invoke('projectSave', { name: projectName.value.trim() || 'Untitled project' }, 'Project saved.').then(result => { if (result) refreshProjects(); })));
      const tools = node('div', 'studio-project-tools');
      const importProject = button('Import project', () => invoke('projectImport', undefined, 'Project imported.').then(result => { if (result?.state && !result.canceled && !result.cancelled) { onLoadBrief?.(result.state.question || result.state.studio?.contract?.task || ''); refreshProjects(); } }));
      const delivery = button('Export delivery package', () => invoke('deliveryExport', undefined, result => result.path ? `Delivery exported to ${result.path}` : 'Delivery package exported.'));
      for (const control of [importProject, delivery]) { control.dataset.requiresIdle = 'true'; control.disabled = latestState.status === 'running'; }
      tools.append(importProject, button('Export project', () => invoke('projectExport', undefined, result => result.path ? `Project exported to ${result.path}` : 'Project exported.')), delivery);
      saveCard.append(tools); panel.append(saveCard, node('p', 'studio-help studio-recovery-note', 'The most recent saved project is first. File downloads work while chats are disconnected or another task is running. Draft files remain drafts. Reconnect the team only when you want to continue reviewing a project.'));
      if (projectError) panel.append(node('p', 'studio-status error', projectError));
      if (!projects.length) panel.append(empty('Your project library starts here', 'Save the current task or import an exported project.'));
      for (const [index, project] of projects.entries()) {
        const row = node('article', 'studio-project-row'); const copy = node('div'); copy.append(node('h3', '', project.name || 'Untitled project'), node('p', '', `${time(project.updatedAt || project.savedAt || project.createdAt)}${project.revisionCount !== undefined ? ` · ${project.revisionCount} revisions` : ''}`));
        if (index === 0) copy.append(node('small', 'studio-help', 'Most recent project'));
        if (project.outputFileCount !== undefined) {
          copy.append(node('p', 'studio-help', project.outputFileCount ? `${project.outputFileCount} ${project.outputStatus === 'reviewed' ? 'reviewed' : 'draft'} output ${project.outputFileCount === 1 ? 'file' : 'files'}${project.outputNames?.length ? ` · ${project.outputNames.join(' · ')}` : ''}` : 'No retrieved output files yet. Source files and the brief are saved.'));
        }
        if (project.savedStatus && !['saved', 'unknown'].includes(project.savedStatus)) copy.append(node('small', 'studio-help', `Saved workflow: ${project.savedStatus}. Opening a saved project requires a fresh review before final acceptance.`));
        const load = button('Open project', () => invoke('projectLoad', { id: project.id }, 'Project recovered. Reconnect the team to continue.').then(result => { if (result?.state) { onLoadBrief?.(result.state.question || result.state.studio?.contract?.task || ''); currentTab = 'brief'; chooseTab('brief'); } }));
        load.disabled = latestState.status === 'running'; row.append(copy, load); panel.append(row);
        load.dataset.requiresIdle = 'true';
        if (typeof api.studioProjectDownload === 'function') {
          const download = button('Download saved files', () => invoke('studioProjectDownload', { id: project.id },
            result => `${result.fileCount || project.outputFileCount} ${result.outputStatus === 'reviewed' ? 'reviewed' : 'draft'} files downloaded in ${result.name || 'the selected package'}.`, false), 'studio-button subtle');
          download.disabled = !project.outputFileCount; row.append(download);
        }
      }
    }
    function render(nextState, force = false) {
      if (disposed) return;
      latestState = nextState && typeof nextState === 'object' ? nextState : latestState;
      const nextTask = latestState.studio?.contract?.task || latestState.question || '';
      const nextProjectId = latestState.projectInfo?.id || null;
      if (lastTask && nextTask !== lastTask || lastProjectId && nextProjectId && nextProjectId !== lastProjectId) resetProjectDrafts();
      if (nextProjectId) lastProjectId = nextProjectId;
      lastTask = nextTask;
      if (latestState.projectInfo?.error && latestState.projectInfo.status === 'error') {
        if (recoveryError !== latestState.projectInfo.error) notify(`Recovery save failed: ${latestState.projectInfo.error}`, true);
        recoveryError = latestState.projectInfo.error;
      } else if (recoveryError) { recoveryError = ''; notify('Recovery checkpoint saved.'); }
      if (!opened) { renderBrief(); return; }
      const data = studio(); const nextKey = JSON.stringify({ studio: data, status: latestState.status, question: latestState.question, project: latestState.projectInfo });
      if (!force && nextKey === stateKey) return; stateKey = nextKey;
      const met = requirements().filter(item => item.status === 'met').length; const openIssues = issues().filter(item => !['rechecked'].includes(item.status)).length;
      const fileStatus = badge(data.verification?.status || 'unverified'); fileStatus.prepend(document.createTextNode('File checks · '));
      metrics.replaceChildren(node('span', '', `${met} / ${requirements().length} requirements met`), node('span', '', `${revisions().length} revisions`), node('span', '', `${openIssues} open ${openIssues === 1 ? 'issue' : 'issues'}`), fileStatus);
      subtitle.textContent = latestState.projectInfo?.name ? `${latestState.projectInfo.name} · ${latestState.projectInfo.status === 'saving' ? 'Saving checkpoint' : latestState.projectInfo.status === 'error' ? 'Recovery save needs attention' : 'Saved project'}` : 'Manage the brief, files and review history.';
      renderBrief();
      // Preserve an assessment draft while page status updates arrive.
      const editing = [panels.requirements, panels.issues, panels.projects].some(panel => panel.contains(document.activeElement));
      if (!editing || force) { renderRequirements(); renderIssues(); renderProjects(); }
      renderRevisions(); renderChecks();
      for (const control of shell.querySelectorAll('[data-requires-idle]')) control.disabled = latestState.status === 'running';
      // This header control opens the project library; it does not modify a
      // running task. Saved file downloads must remain reachable during work.
      save.disabled = false;
      const libraryVersion = `${latestState.projectInfo?.id || ''}:${latestState.projectInfo?.savedAt || ''}`;
      if (currentTab === 'projects' && !working && libraryVersion !== projectLibraryVersion) {
        projectLibraryVersion = libraryVersion;
        queueMicrotask(() => { if (!disposed && opened && currentTab === 'projects') refreshProjects(); });
      }
    }
    chooseTab(currentTab);
    return { render, setOpen, openProjects: () => { setOpen(true); chooseTab('projects'); }, isOpen: () => opened, settings, answerDiff };
  }
  window.ConvergeStudioUI = Object.freeze({ create, answerDiff });
})();
