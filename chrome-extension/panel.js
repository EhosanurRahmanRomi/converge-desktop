(() => {
  'use strict';

  const byId = (id) => document.getElementById(id);
  const ui = Object.fromEntries([
    'openLayout', 'preparePages', 'copyDiagnostics', 'expandLeft', 'expandRight', 'restoreSplit',
    'confirmLeft', 'confirmRight', 'question',
    'protocol', 'maxRounds', 'roundMinus', 'roundPlus', 'start', 'stop',
    'sourceFiles', 'chooseFiles', 'fileStatus', 'privacyHint', 'mediaWarning', 'relayMedia',
    'leftPage', 'rightPage', 'leftPageDetail', 'rightPageDetail',
    'leftPageSymbol', 'rightPageSymbol', 'runDot', 'roundBadge',
    'statusBanner', 'statusTitle', 'statusDetail', 'transcript', 'answer',
    'copyAnswer', 'exportAnswer', 'footerStatus', 'answerOutputs', 'viewOutput'
  ].map((id) => [id, byId(id)]));

  // Opening panel.html as a local file shows the design but cannot access
  // extension APIs. Explain installation before wiring any action handlers.
  if (globalThis.location?.protocol !== 'chrome-extension:' ||
      !globalThis.chrome?.runtime?.id ||
      !globalThis.chrome?.windows?.getCurrent ||
      !globalThis.chrome?.storage?.session) {
    byId('installWarning').hidden = false;
    for (const control of document.querySelectorAll('button, input, textarea')) control.disabled = true;
    ui.statusTitle.textContent = 'Install Converge in Chrome';
    ui.statusDetail.textContent = 'This local HTML preview cannot open chats or run an exchange.';
    ui.footerStatus.textContent = 'PREVIEW ONLY';
    return;
  }

  let state = {};
  let busyAction = false;
  let stopBusy = false;
  let confirmationKey = '';
  let draftSaveTimer = null;

  function applyDraft(draft) {
    if (!draft || typeof draft !== 'object') return;
    if (state.status === 'running') return;
    for (const [key, element] of [['question', ui.question], ['protocol', ui.protocol]]) {
      if (typeof draft[key] === 'string' && document.activeElement !== element) element.value = draft[key];
    }
    if (Number.isInteger(draft.maxRounds) && document.activeElement !== ui.maxRounds) {
      ui.maxRounds.value = String(Math.min(12, Math.max(1, draft.maxRounds)));
    }
    if (typeof draft.relayMedia === 'boolean' && document.activeElement !== ui.relayMedia) ui.relayMedia.checked = draft.relayMedia;
    renderMediaWarning();
  }

  function renderMediaWarning() {
    const question = ui.question.value;
    ui.mediaWarning.hidden = !(/\b(?:make|create|generate|draw|render)\b.{0,90}\b(?:image|picture|photo|illustration|artwork)\b/i.test(question) ||
      /\b(?:image|picture|photo|illustration|artwork)\b.{0,90}\b(?:make|create|generate|draw|render)\b/i.test(question));
    ui.mediaWarning.textContent = ui.relayMedia.checked
      ? 'The chats may generate pictures and review the relayed images. Image copying is experimental; Chrome must allow the displayed image to be read.'
      : 'With output sharing off, the chats refine a text image prompt instead of generating pictures.';
  }

  function scheduleDraftSave() {
    clearTimeout(draftSaveTimer);
    draftSaveTimer = setTimeout(() => {
      chrome.storage.session.set({ convergeDraft: {
        question: ui.question.value,
        protocol: ui.protocol.value,
        maxRounds: rounds(), relayMedia: ui.relayMedia.checked
      } }).catch(showError);
    }, 180);
  }

  function plainError(error) {
    return String(error?.message || error || 'The action failed.');
  }

  async function request(type, payload = {}) {
    const result = await chrome.runtime.sendMessage({ type, ...payload });
    if (!result || result.ok === false) {
      throw new Error(result?.error || 'The extension did not respond. Reload it and try again.');
    }
    if (result.state) render(result.state);
    return result;
  }

  function setActionBusy(value) {
    busyAction = Boolean(value);
    ui.openLayout.disabled = busyAction || state.status === 'running';
    ui.preparePages.disabled = busyAction || !hasTwoTabs() || state.status === 'running';
    ui.copyDiagnostics.disabled = busyAction || !hasTwoTabs();
    ui.expandLeft.disabled = busyAction || !hasTwoTabs() || state.status === 'running';
    ui.expandRight.disabled = busyAction || !hasTwoTabs() || state.status === 'running';
    ui.restoreSplit.disabled = busyAction || !hasTwoTabs() || state.status === 'running';
    const attachmentFailure = ['failed', 'partial'].includes(state.attachments?.status);
    ui.chooseFiles.disabled = busyAction || !hasTwoTabs() || state.status !== 'setup' || attachmentFailure;
    ui.relayMedia.disabled = busyAction || state.status === 'running';
    for (const field of [ui.question, ui.protocol, ui.maxRounds, ui.roundMinus, ui.roundPlus]) {
      field.disabled = busyAction || state.status === 'running';
    }
    ui.start.disabled = busyAction || !hasTwoTabs() || state.status !== 'setup' || attachmentFailure;
    // Stop has its own action lane: a pending START can already have published
    // running state while the page is still confirming the initial send.
    ui.stop.disabled = stopBusy || state.status !== 'running';
  }

  function renderPrivacyHint(alert = false) {
    const left = state.pages?.left;
    const right = state.pages?.right;
    let message;
    if (!hasTwoTabs()) message = 'Click Open two chats before confirming privacy settings.';
    else if ([['A', left], ['B', right]].some(([, page]) => page && !page.ready)) {
      const blocked = [['A', left], ['B', right]].filter(([, page]) => page && !page.ready)
        .map(([name, page]) => `${name}: ${page.reason || 'Page is still loading.'}`);
      message = `Wait for both chats or click Check pages. ${blocked.join(' ')}`;
    } else if ([left, right].some((page) => page?.temporary === false || page?.unpersonalized === false)) {
      message = 'A page reports that Temporary or Unpersonalized is off. Set both modes in ChatGPT, then click Check pages.';
    } else if (ui.confirmLeft.checked && ui.confirmRight.checked) {
      message = 'Privacy mode confirmed for both pages. Enter your question and start the exchange.';
    } else {
      message = 'In each ChatGPT page, set Temporary and Unpersonalized before the first message. Then tick both boxes here. Check pages cannot confirm modes that ChatGPT does not expose.';
    }
    ui.privacyHint.textContent = message;
    ui.privacyHint.classList.toggle('alert', alert || (hasTwoTabs() && !(ui.confirmLeft.checked && ui.confirmRight.checked)));
  }

  function hasTwoTabs() {
    const ids = state.tabIds || state.tabs || {};
    return Number.isInteger(ids.left) && Number.isInteger(ids.right);
  }

  function currentAnswer() {
    const value = state.answer || state.candidate || state.result?.answer || '';
    if (value && typeof value === 'object') return String(value.text || value.answer || '');
    return String(value || '');
  }

  function currentMedia() {
    return state.candidate?.media || Object.values(state.drafts || {}).find((draft) => draft.answer === currentAnswer())?.media || null;
  }

  function pageDescription(page, hasTab) {
    if (!hasTab) return { text: 'Not opened', kind: '' };
    if (!page) return { text: 'Checking page…', kind: 'warn' };
    if (page.ready && page.temporary && page.unpersonalized) return { text: 'Temporary · Unpersonalized', kind: 'ready' };
    if (!page.ready) return { text: page.reason || 'Waiting for the composer', kind: 'warn' };
    if (page.authenticated === false) return { text: page.reason || 'Sign in in Chrome', kind: 'warn' };
    if (page.busy) return { text: 'ChatGPT is answering', kind: 'warn' };
    return { text: page.reason || 'Mode not verified', kind: 'warn' };
  }

  function renderPage(side) {
    const tabId = (state.tabIds || state.tabs || {})[side];
    const page = state.pages?.[side];
    const description = pageDescription(page, Number.isInteger(tabId));
    ui[`${side}PageDetail`].textContent = description.text;
    ui[`${side}PageSymbol`].textContent = description.kind === 'ready' ? '●' : description.kind === 'warn' ? '◐' : '○';
    ui[`${side}Page`].classList.toggle('ready', description.kind === 'ready');
    ui[`${side}Page`].classList.toggle('warn', description.kind === 'warn');
  }

  function renderTranscript() {
    const entries = Array.isArray(state.transcript) ? state.transcript.slice(-30) : [];
    if (!entries.length) {
      ui.transcript.replaceChildren();
      const empty = document.createElement('div');
      empty.className = 'stream-empty';
      const icon = document.createElement('span');
      icon.textContent = '⇄';
      const description = document.createElement('p');
      description.textContent = 'The two reviewers’ drafts and challenges will appear here.';
      empty.append(icon, description);
      ui.transcript.append(empty);
      return;
    }
    const fragment = document.createDocumentFragment();
    for (const item of entries) {
      const box = document.createElement('article');
      box.className = `note ${item.side === 'right' ? 'right' : 'left'}`;
      const head = document.createElement('div');
      head.className = 'note-head';
      const name = document.createElement('strong');
      name.textContent = item.side === 'right' ? 'B · RIGHT CHAT' : 'A · LEFT CHAT';
      const role = document.createElement('span');
      role.textContent = String(item.role || 'reply');
      const body = document.createElement('p');
      body.textContent = String(item.text || '');
      if (item.outputs?.length) body.textContent += `\n\nOutputs: ${item.outputs.join(', ')}`;
      head.append(name, role);
      box.append(head, body);
      fragment.append(box);
    }
    ui.transcript.replaceChildren(fragment);
    ui.transcript.scrollTop = ui.transcript.scrollHeight;
  }

  function statusDescription() {
    const status = String(state.status || 'idle');
    if (status === 'running') {
      return { title: state.stage || 'Review in progress', detail: state.detail || `Round ${state.round || 1} · Keep both ChatGPT pages open.` };
    }
    if (status === 'agreed') return { title: 'Both reviewers accepted this answer', detail: 'Check the answer yourself. Open fresh chats for another question.' };
    if (status === 'cancelled' || status === 'stopped') return { title: 'Exchange stopped', detail: 'The best current answer remains below. Open fresh chats to restart.' };
    if (status === 'limit_reached') return { title: 'Round limit reached', detail: 'Review the answer and remaining issues. Open fresh chats to restart.' };
    if (status === 'stalled') return { title: 'No further progress', detail: 'The reviewers repeated without resolving the answer. Open fresh chats to restart.' };
    if (status === 'error') return { title: 'Exchange needs attention', detail: `${state.error || 'Check both pages.'} Open fresh chats to restart.` };
    return { title: state.stage || (hasTwoTabs() ? 'Pages opened' : 'Waiting to begin'), detail: hasTwoTabs() ? 'Select Temporary and Unpersonalized in each page.' : 'Open and prepare the two chats.' };
  }

  function render(nextState) {
    state = nextState && typeof nextState === 'object' ? nextState : {};
    const ids = state.tabIds || state.tabs || {};
    const newKey = `${ids.left || ''}:${ids.right || ''}`;
    if (confirmationKey !== newKey) {
      confirmationKey = newKey;
      ui.confirmLeft.checked = false;
      ui.confirmRight.checked = false;
      ui.fileStatus.textContent = 'Images and documents · up to 5';
    }
    for (const side of ['left', 'right']) {
      const page = state.pages?.[side];
      const check = side === 'left' ? ui.confirmLeft : ui.confirmRight;
      const verified = page?.temporary === true && page?.unpersonalized === true;
      if (verified) {
        check.checked = true;
        check.dataset.autoVerified = 'true';
      } else {
        if (check.dataset.autoVerified === 'true' || page?.temporary === false || page?.unpersonalized === false) {
          check.checked = false;
        }
        check.dataset.autoVerified = 'false';
      }
      check.disabled = verified || !hasTwoTabs() || !page?.ready || state.status === 'running' ||
        page?.temporary === false || page?.unpersonalized === false;
    }
    if (state.attachments?.status === 'attached') {
      ui.fileStatus.textContent = `${state.attachments.names?.length || 0} file(s) attached to both chats`;
    } else if (state.attachments?.status === 'partial') {
      ui.fileStatus.textContent = `Files reached only one page. Open fresh chats. ${state.attachments.error || ''}`;
    } else if (state.attachments?.status === 'failed') {
      ui.fileStatus.textContent = `${state.attachments.error || 'Files were not confirmed on both pages.'} Open two fresh chats to reset.`;
    }
    renderPage('left');
    renderPage('right');
    renderPrivacyHint();
    const status = String(state.status || 'idle');
    const description = statusDescription();
    if (status === 'running') {
      ui.question.value = state.question || ui.question.value;
      ui.protocol.value = state.protocol || '';
      ui.maxRounds.value = String(state.maxRounds || rounds());
      ui.relayMedia.checked = state.relayMedia === true;
      renderMediaWarning();
    }
    ui.statusTitle.textContent = description.title;
    ui.statusDetail.textContent = description.detail;
    ui.statusBanner.classList.toggle('running', status === 'running');
    ui.statusBanner.classList.toggle('error', status === 'error');
    ui.runDot.classList.toggle('running', status === 'running');
    ui.runDot.classList.toggle('error', status === 'error');
    ui.runDot.title = status;
    ui.footerStatus.textContent = status.toUpperCase().replaceAll('_', ' ');
    ui.roundBadge.textContent = `ROUND ${Number.isInteger(state.round) && state.round > 0 ? state.round : '—'}`;
    ui.stop.hidden = status !== 'running';
    ui.start.hidden = status === 'running';
    const answer = currentAnswer();
    ui.answer.textContent = answer || 'No answer yet.';
    ui.answer.classList.toggle('answer-placeholder', !answer);
    const media = currentMedia();
    ui.answerOutputs.hidden = !media;
    ui.answerOutputs.textContent = media ? `Outputs in chat ${media.side === 'left' ? 'A' : 'B'}: ${media.files.map((file) => file.name).join(', ')}` : '';
    ui.viewOutput.hidden = !media;
    ui.copyAnswer.disabled = !answer;
    ui.exportAnswer.disabled = !answer;
    renderTranscript();
    setActionBusy(busyAction);
  }

  function showError(error) {
    ui.statusTitle.textContent = 'Action could not finish';
    ui.statusDetail.textContent = plainError(error);
    ui.statusBanner.classList.add('error');
  }

  async function runAction(fn) {
    if (busyAction) return;
    setActionBusy(true);
    try { await fn(); } catch (error) { showError(error); }
    finally { setActionBusy(false); }
  }

  function rounds() {
    const number = Number(ui.maxRounds.value);
    return Number.isInteger(number) ? Math.min(12, Math.max(1, number)) : 6;
  }

  ui.openLayout.addEventListener('click', () => runAction(async () => {
    ui.confirmLeft.checked = false;
    ui.confirmRight.checked = false;
    const currentWindow = await chrome.windows.getCurrent();
    const screenBounds = {
      left: Number(screen.availLeft) || 0,
      top: Number(screen.availTop) || 0,
      width: Number(screen.availWidth),
      height: Number(screen.availHeight)
    };
    await request('OPEN_LAYOUT', { windowId: currentWindow.id, screenBounds });
    await refresh();
  }));
  ui.preparePages.addEventListener('click', () => runAction(async () => {
    await request('PREPARE');
    await refresh();
  }));
  ui.copyDiagnostics.addEventListener('click', () => runAction(async () => {
    const pages = {};
    for (const side of ['left', 'right']) {
      const tabId = state.tabIds?.[side];
      if (!Number.isInteger(tabId)) throw new Error('Open both chats before copying diagnostics.');
      try {
        const response = await chrome.tabs.sendMessage(tabId, { type: 'DIAGNOSTICS' });
        pages[side] = response?.diagnostics || { error: response?.error || 'No diagnostic response' };
      } catch (error) {
        pages[side] = { error: plainError(error) };
      }
    }
    await navigator.clipboard.writeText(JSON.stringify({ extensionVersion: '0.4.0', pages }, null, 2));
    ui.copyDiagnostics.textContent = 'Diagnostics copied';
    setTimeout(() => { ui.copyDiagnostics.textContent = 'Copy safe page diagnostics'; }, 2200);
  }));
  async function chatWindow(side) {
    const tabId = state.tabIds?.[side];
    if (!Number.isInteger(tabId)) throw new Error('Open two chats first.');
    const tab = await chrome.tabs.get(tabId);
    if (!Number.isInteger(tab.windowId)) throw new Error(`${side} chat window is no longer open.`);
    return tab.windowId;
  }
  ui.expandLeft.addEventListener('click', () => runAction(async () => {
    await chrome.windows.update(await chatWindow('left'), { state: 'maximized', focused: true });
  }));
  ui.expandRight.addEventListener('click', () => runAction(async () => {
    await chrome.windows.update(await chatWindow('right'), { state: 'maximized', focused: true });
  }));
  ui.restoreSplit.addEventListener('click', () => runAction(async () => {
    const layout = state.layout;
    if (!layout || !Number.isInteger(layout.leftWidth)) throw new Error('Open two chats again to restore the split.');
    const leftWindow = await chatWindow('left');
    const rightWindow = await chatWindow('right');
    await chrome.windows.update(leftWindow, { state: 'normal', left: layout.left, top: layout.top,
      width: layout.leftWidth, height: layout.height });
    await chrome.windows.update(rightWindow, { state: 'normal', left: layout.left + layout.leftWidth,
      top: layout.top, width: layout.width - layout.leftWidth, height: layout.height });
    await chrome.windows.update(leftWindow, { focused: true });
  }));
  ui.start.addEventListener('click', () => runAction(async () => {
    const question = ui.question.value.trim();
    if (!question) throw new Error('Enter a question for both chats.');
    if (!ui.confirmLeft.checked || !ui.confirmRight.checked) {
      renderPrivacyHint(true);
      ui.privacyHint.scrollIntoView({ behavior: 'smooth', block: 'center' });
      throw new Error('Confirm Temporary and Unpersonalized mode in both visible ChatGPT pages.');
    }
    await request('START', {
      question,
      protocol: ui.protocol.value.trim(),
      maxRounds: rounds(),
      confirmTemporary: true, relayMedia: ui.relayMedia.checked
    });
    await refresh();
  }));
  ui.confirmLeft.addEventListener('change', () => renderPrivacyHint());
  ui.confirmRight.addEventListener('change', () => renderPrivacyHint());
  ui.question.addEventListener('input', () => { renderMediaWarning(); scheduleDraftSave(); });
  ui.relayMedia.addEventListener('change', () => { renderMediaWarning(); scheduleDraftSave(); });
  ui.protocol.addEventListener('input', scheduleDraftSave);
  ui.maxRounds.addEventListener('input', scheduleDraftSave);
  const allowedTypes = Object.freeze({
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
    gif: 'image/gif', pdf: 'application/pdf', txt: 'text/plain',
    md: 'text/markdown', csv: 'text/csv', tsv: 'text/tab-separated-values', json: 'application/json',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  });
  async function fileData(file) {
    const extension = file.name.split('.').pop()?.toLowerCase();
    const mimeType = allowedTypes[extension];
    if (!mimeType) throw new Error(`${file.name} is not a supported file type.`);
    if (file.size > 12 * 1024 * 1024) throw new Error(`${file.name} exceeds the 12 MB file limit.`);
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
      reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
      reader.readAsDataURL(file);
    });
    return { name: file.name, mimeType, base64 };
  }
  ui.chooseFiles.addEventListener('click', () => ui.sourceFiles.click());
  ui.sourceFiles.addEventListener('change', () => runAction(async () => {
    const files = Array.from(ui.sourceFiles.files || []);
    ui.sourceFiles.value = '';
    if (!files.length) return;
    if (files.length > 5) throw new Error('Choose up to five files.');
    if (files.reduce((sum, file) => sum + file.size, 0) > 24 * 1024 * 1024) {
      throw new Error('The files together exceed 24 MB.');
    }
    ui.fileStatus.textContent = `Attaching ${files.length} file${files.length === 1 ? '' : 's'} to both chats…`;
    try {
      const data = await Promise.all(files.map(fileData));
      await request('ATTACH_FILES', { files: data });
      ui.fileStatus.textContent = `${files.length} file${files.length === 1 ? '' : 's'} attached to both chats`;
    } catch (error) {
      ui.fileStatus.textContent = plainError(error);
      throw error;
    }
  }));
  ui.stop.addEventListener('click', async () => {
    if (stopBusy || state.status !== 'running') return;
    stopBusy = true;
    setActionBusy(busyAction);
    try {
      await request('STOP');
      await refresh();
    } catch (error) {
      showError(error);
    } finally {
      stopBusy = false;
      setActionBusy(busyAction);
    }
  });
  ui.roundMinus.addEventListener('click', () => { ui.maxRounds.value = String(Math.max(1, rounds() - 1)); scheduleDraftSave(); });
  ui.roundPlus.addEventListener('click', () => { ui.maxRounds.value = String(Math.min(12, rounds() + 1)); scheduleDraftSave(); });
  ui.maxRounds.addEventListener('change', () => { ui.maxRounds.value = String(rounds()); scheduleDraftSave(); });
  ui.copyAnswer.addEventListener('click', () => runAction(async () => {
    await navigator.clipboard.writeText(currentAnswer());
    ui.copyAnswer.textContent = 'Copied';
    setTimeout(() => { ui.copyAnswer.textContent = 'Copy answer'; }, 1500);
  }));
  ui.viewOutput.addEventListener('click', () => runAction(async () => {
    const media = currentMedia();
    if (!media) return;
    const tabId = state.tabIds?.[media.side];
    if (!Number.isInteger(tabId)) throw new Error('The original output page is no longer available.');
    const tab = await chrome.tabs.update(tabId, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
  }));
  ui.exportAnswer.addEventListener('click', () => {
    const answer = currentAnswer();
    if (!answer) return;
    const media = currentMedia();
    const outputs = media ? `\n\nOutputs: ${media.files.map((file) => file.name).join(', ')}. Open original ChatGPT page ${media.side === 'left' ? 'A' : 'B'} to save them. This Markdown export contains text only.` : '';
    const text = `# Converge answer\n\n${answer}${outputs}\n\n---\nStatus: ${state.status || 'unknown'}\n`;
    const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `converge-answer-${new Date().toISOString().slice(0, 10)}.md`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  });

  async function refresh() {
    const stored = await chrome.storage.session.get(['convergeState', 'convergeDraft']);
    applyDraft(stored.convergeDraft);
    if (stored.convergeState) render(stored.convergeState);
    const result = await request('GET_STATE');
    if (result.state) render(result.state);
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'session' && changes.convergeState?.newValue) {
      render(changes.convergeState.newValue);
    }
    if (area === 'session' && changes.convergeDraft?.newValue) applyDraft(changes.convergeDraft.newValue);
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refresh().catch(showError);
  });
  refresh().catch(showError);
})();
