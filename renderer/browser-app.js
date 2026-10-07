(() => {
  'use strict';

  let windowClosing = false;

  const ids = ['app', 'sidebar', 'toggleSidebar', 'closeSidebar', 'previewNotice', 'version', 'statusDot', 'topStatus', 'headerStop',
    'sessionDetails', 'sessionBadge', 'sidebarIntro', 'cookieInput', 'cookieFile', 'chooseCookies', 'clearSession', 'cookieFileStatus', 'cookieFileLabel', 'cookiePasteDetails',
    'windowMinimize', 'windowMaximize', 'windowClose',
    'importCookies', 'sessionHint', 'sessionError', 'question', 'questionLabel', 'questionCount', 'protocol',
    'maxRounds', 'roundMinus', 'roundPlus', 'reviewMode', 'reviewModeHint', 'relayMedia', 'requireFiles', 'attachFiles', 'attachStyleReferences', 'styleReferenceStatus', 'fileStatus', 'fileUploadProgress', 'fileProgressLabel', 'fileProgressBar', 'fileProgressDetail',
    'privacyCheck', 'confirmLeft', 'confirmRight', 'confirmBoss', 'privacyHint', 'start', 'stop', 'actionError',
    'openPages', 'resetChats', 'modeTemporary', 'modeNormal', 'modeWork', 'modeOptions', 'modeHeading', 'modeHint', 'openedMode', 'settingsDetails', 'reviewSummary', 'prepare', 'diagnostics', 'statusTitle', 'statusDetail', 'roundBadge',
    'leftMode', 'leftDetail', 'rightMode', 'rightDetail', 'leftSlot', 'rightSlot',
    'reloadLeft', 'reloadRight', 'expandLeft', 'expandRight', 'restoreSplit', 'chatGrid',
    'resultDrawer', 'toggleResults', 'bottomStage', 'bottomRound', 'bottomFiles', 'saveFilesCompact', 'resultLabel', 'resultCount', 'resultContent',
    'answerTab', 'activityTab', 'issuesTab', 'answerPanel', 'activityPanel', 'issuesPanel',
    'activityCount', 'issueCount', 'teamHealth', 'teamHealthSummary', 'teamHealthLog', 'answer', 'answerOutputs', 'outputCard', 'outputHeading', 'deliveryStatus', 'deliveryHint', 'workflowHistoryCard', 'workflowHistoryOutcome', 'workflowHistoryTime', 'workflowHistoryStage', 'workflowHistoryError', 'workflowHistoryHint', 'outputFileList', 'checkpointOutputs', 'checkpointCount', 'checkpointFileList', 'saveFiles', 'fileSaveStatus', 'viewOutput', 'copyAnswer',
    'exportAnswer', 'transcript', 'issues', 'improvementCard', 'improvementSummary', 'improvementDetail', 'improvementTrail', 'candidateVersion', 'originalAnswerDetails', 'originalAnswer', 'bossReviewCard', 'bossFinalSummary', 'bossFinalChecks', 'bossLimitations',
    'stars', 'topStarRibbon', 'bottomStarRibbon', 'effectsButton', 'animationEnabled', 'animationStatus', 'animationTheme', 'animationDescription', 'effectsMode', 'openStudio', 'reviewDeck', 'reviewerLeft', 'reviewerRight', 'leftActivity', 'rightActivity', 'botLeft', 'botRight', 'bridgeLabel', 'handoffDocument',
    'toggleBoss', 'closeBoss', 'bossDrawer', 'bossSlot', 'bossMode', 'bossDetail', 'botBoss', 'bossActivity', 'bossMessageForm', 'bossMessageInput', 'sendBossMessage', 'bossQueueStatus', 'bossMessageHint', 'bossMessageError', 'bossAttachFiles', 'bossFilesStatus', 'chatTheme', 'characterStyle'];
  const ui = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));
  const galaxyEffects = createGalaxyEffects();
  const api = window.convergeBrowser;
  if (!api || typeof api.bootstrap !== 'function' || typeof api.setBounds !== 'function') {
    ui.previewNotice.hidden = false;
    ui.statusTitle.textContent = 'Desktop app required';
    ui.statusDetail.textContent = 'This local file previews the design. Launch Converge to use the controls.';
    ui.topStatus.textContent = 'Preview only';
    for (const element of document.querySelectorAll('button, input, textarea, select')) element.disabled = true;
    return;
  }

  let state = { status: 'idle', pages: {}, transcript: [], attachments: {} };
  let hasSession = false;
  let selectedMode = 'normal';
  let busyAction = '';
  let stopBusy = false;
  let expandedSide = null;
  let confirmationKey = '';
  let transcriptKey = '';
  let issuesKey = '';
  let boundsScheduled = false;
  let lastBounds = '';
  let copyTimer;
  let bossOpen = false;
  let bossBoundsFrame = null;
  let fileCandidateKey = '';
  let outputRowsKey = '';
  let savingFiles = false;
  let explicitFileRequirement = ui.requireFiles.checked;
  let automaticFileRequirement = false;
  let activeAttachmentRole = null;
  const confirmedAutomatically = { left: false, right: false, boss: false };
  const studioUI = window.ConvergeStudioUI?.create({ api, getState: () => state, onLayout: scheduleBounds,
    onState: render, getBrief: () => ui.question.value.trim(),
    onOpen: () => { setSidebarOpen(false); setBossOpen(false); setResultsOpen(false); },
    onLoadBrief: (text) => { ui.question.value = text; updateControls(); } });

  const isRunning = () => state.status === 'running';
  const bossWorkspace = () => state.coordinatorMode === 'boss' || state.tabIds?.boss != null;
  const pageSides = () => bossWorkspace() ? ['left', 'right', 'boss'] : ['left', 'right'];
  const confirmationFor = (side) => ui[side === 'boss' ? 'confirmBoss' : side === 'left' ? 'confirmLeft' : 'confirmRight'];
  const hasPages = () => pageSides().every((side) => state.tabIds?.[side] != null);
  const activeMode = () => hasPages() ? state.chatMode || selectedMode : selectedMode;
  const modeNames = { temporary: 'Temporary', normal: 'Normal', work: 'Work mode' };
  const canStartStatus = () => ['setup', 'agreed', 'stopped', 'cancelled', 'limit_reached', 'stalled', 'blocked', 'error'].includes(state.status);
  const isTerminal = () => ['agreed', 'stopped', 'cancelled', 'limit_reached', 'stalled', 'blocked', 'error'].includes(state.status);
  const isFollowup = () => hasPages() && state.status !== 'setup' && state.status !== 'running' && Boolean(state.question);
  const reviewMode = () => ['auto', 'improve', 'verify'].includes(ui.reviewMode.value) ? ui.reviewMode.value : 'auto';
  const rounds = () => Math.max(reviewMode() === 'verify' ? 1 : 4, Math.min(12, Number.parseInt(ui.maxRounds.value, 10) || 6));
  const answerText = () => outputRecord() === state.delivery && /^worker/.test(state.delivery?.source || '') ? String(state.delivery.answer || state.delivery.text || '') :
    typeof state.answer === 'string' && state.answer ? state.answer : typeof state.candidate === 'string' ? state.candidate :
      String(outputRecord()?.answer || outputRecord()?.text || state.candidate?.answer || state.candidate?.text || '');
  const deliveryIsFinal = () => state.status === 'agreed' && outputRecord()?.draft !== true;

  const appearancePreference = { chatTheme: 'converge.chat.theme', characterStyle: 'converge.characters.style' };
  const chatThemes = ['night', 'horror', 'alien', 'cyberpunk', 'anime'];
  const chatThemeDescriptions = {
    night: 'A still galaxy behind all three chats. Backgrounds stay still to keep rendering light.',
    horror: 'Black velvet and a crimson haze. A still scene keeps the conversation clear.',
    alien: 'An emerald moon over a distant violet world. A still scene keeps rendering light.',
    cyberpunk: 'A neon skyline, holographic grid and cyan–magenta lights. A still vector scene keeps rendering light.',
    anime: 'Painted twilight, layered mountains and cherry blossoms. A still vector scene keeps rendering light.'
  };
  function describeChatTheme() {
    document.getElementById('chatThemeDescription').textContent = chatThemeDescriptions[ui.chatTheme.value] || chatThemeDescriptions.night;
  }
  function chooseAppearance(name, choices, fallback) {
    let value = fallback;
    try { const saved = localStorage.getItem(appearancePreference[name]); if (choices.includes(saved)) value = saved; } catch (_) {}
    ui[name].value = value;
    document.body.dataset[name] = value;
    return value;
  }
  chooseAppearance('chatTheme', chatThemes, 'night');
  describeChatTheme();
  chooseAppearance('characterStyle', ['robot', 'astronaut', 'spirit'], 'robot');
  async function syncChatAppearance() {
    if (typeof api.setAppearance !== 'function') return;
    try { await request('setAppearance', { chatTheme: ui.chatTheme.value }); }
    catch (error) { showError(error); }
  }
  ui.chatTheme.addEventListener('change', () => {
    if (!chatThemes.includes(ui.chatTheme.value)) return;
    document.body.dataset.chatTheme = ui.chatTheme.value;
    describeChatTheme();
    try { localStorage.setItem(appearancePreference.chatTheme, ui.chatTheme.value); } catch (_) {}
    syncChatAppearance();
  });
  ui.characterStyle.addEventListener('change', () => {
    if (!['robot', 'astronaut', 'spirit'].includes(ui.characterStyle.value)) return;
    document.body.dataset.characterStyle = ui.characterStyle.value;
    try { localStorage.setItem(appearancePreference.characterStyle, ui.characterStyle.value); } catch (_) {}
    galaxyEffects.stopPaper();
  });

  function styleReferenceNames() {
    return [...new Set([...(state.studio?.settings?.documentDesign?.referenceNames || []), ...(state.attachments?.referenceNames || [])])];
  }

  function contentFileNames(names = []) {
    const references = new Set(styleReferenceNames());
    return names.filter(name => !references.has(name));
  }

  function syncFileRequirement() {
    const queuedPdf = ['attached', 'ready', 'complete'].includes(state.attachments?.status) &&
      contentFileNames(state.attachments?.names || []).some((name) => /\.pdf$/i.test(String(name)));
    // Auto-requiring a revised PDF belongs to the queued source upload. Once
    // Start consumes it, the next unrelated command returns to the user's own
    // setting. The running task still displays its committed file requirement.
    if (automaticFileRequirement && !queuedPdf) automaticFileRequirement = false;
    ui.requireFiles.checked = isRunning() ? state.requireFiles === true :
      explicitFileRequirement || automaticFileRequirement;
  }

  function errorText(error) {
    const text = String(error?.message || error || 'The app could not complete this action.');
    // Runtime errors are never allowed to echo a cookie JSON payload into the UI.
    if (/__Secure-next-auth|session-token|"value"\s*:|"domain"\s*:|eyJ[a-zA-Z0-9_-]{30,}/.test(text)) {
      return 'The session could not be imported. Check that this is a complete ChatGPT cookie JSON export.';
    }
    return text.slice(0, 2000);
  }

  function showError(error, target = ui.actionError) {
    // A Start failure must remain visible when the controls drawer was closed.
    if (ui.sidebar.contains(target)) setSidebarOpen(true);
    target.textContent = errorText(error);
    target.hidden = false;
    target.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  async function request(method, payload) {
    if (windowClosing) return { ok: false, error: 'The workspace is closing.' };
    if (typeof api[method] !== 'function') throw new Error('This app build is missing a required workspace control.');
    const result = payload === undefined ? await api[method]() : await api[method](payload);
    if (result?.hasSession !== undefined) hasSession = Boolean(result.hasSession);
    if (result?.state) render(result.state);
    if (result?.ok === false) throw new Error(result.error || 'This action did not complete.');
    return result || {};
  }

  async function action(label, operation, target = ui.actionError) {
    if (busyAction) return;
    busyAction = label;
    target.hidden = true;
    updateControls();
    try { return await operation(); }
    catch (error) { showError(error, target); return null; }
    finally { busyAction = ''; updateControls(); scheduleBounds(); }
  }

  function pageVerified(page) {
    if (activeMode() === 'temporary') return page?.temporary === true;
    if (activeMode() === 'work') return page?.work === true;
    return true;
  }

  function resetPrivacyConfirmation(sides = pageSides()) {
    const pages = { ...state.pages };
    for (const side of sides) {
      confirmationFor(side).checked = false;
      confirmedAutomatically[side] = false;
      pages[side] = { ...pages[side], ready: false, busy: false, temporary: null, unpersonalized: null, work: null,
        reason: `Opening ${modeNames[activeMode()] || 'selected'} chats…` };
    }
    state = { ...state, pages };
    for (const side of sides) renderPage(side);
    updateControls();
  }

  function privacyConfirmed() {
    if (activeMode() === 'normal') return true;
    if (activeMode() === 'work') return pageSides().every((side) => state.pages?.[side]?.work === true);
    return pageSides().every((side) => state.pages?.[side]?.temporary === true ||
      (state.pages?.[side]?.temporary !== false && confirmationFor(side).checked));
  }

  function pagesReady() {
    return hasPages() && pageSides().every((side) => state.pages?.[side]?.ready === true &&
      state.pages?.[side]?.authenticated !== false && !state.pages?.[side]?.busy);
  }

  function updateControls() {
    // Revoke a previous automatic confirmation before evaluating Start.
    renderPrivacy();
    const running = isRunning();
    const busy = Boolean(busyAction);
    const opened = hasPages();
    ui.app.classList.toggle('workspace-open', opened);
    ui.sidebarIntro.hidden = opened;
    ui.modeOptions.hidden = opened;
    ui.modeHeading.textContent = opened ? 'Current workspace' : 'Chat workspace';
    const attachmentFailure = ['failed', 'partial'].includes(state.attachments?.status);
    const attaching = state.attachments?.status === 'uploading' || busyAction === 'attach';
    ui.importCookies.disabled = busy || running || !ui.cookieInput.value.trim();
    const importing = busyAction === 'import' || busyAction === 'import-file';
    ui.importCookies.textContent = importing ? 'Importing…' : 'Import pasted JSON';
    if (ui.cookieFileLabel) ui.cookieFileLabel.textContent = importing ? 'Importing…' : 'Import JSON file';
    ui.chooseCookies.disabled = busy || running;
    ui.cookieInput.disabled = busy || running;
    ui.clearSession.disabled = busy || running || !hasSession;
    ui.clearSession.hidden = !hasSession;
    ui.openPages.disabled = busy || running || !hasSession || hasPages();
    ui.openPages.hidden = hasPages();
    ui.openPages.textContent = busyAction === 'open' ? 'Opening the team…' : 'OK · Open the team ↗';
    ui.resetChats.hidden = !hasPages();
    ui.resetChats.disabled = busy || !hasPages();
    ui.resetChats.textContent = busyAction === 'reset' ? 'Resetting chats…' : '↻ Reset & choose new chat type';
    for (const mode of ['temporary', 'normal', 'work']) {
      const radio = ui[`mode${mode[0].toUpperCase()}${mode.slice(1)}`];
      radio.disabled = busy || running || hasPages();
      radio.checked = selectedMode === mode;
      radio.closest('.mode-option').classList.toggle('selected', selectedMode === mode);
    }
    ui.modeOptions.classList.toggle('locked', hasPages());
    ui.openedMode.hidden = !hasPages();
    ui.openedMode.textContent = hasPages() ? modeNames[activeMode()] : '';
    ui.modeHint.textContent = hasPages() ? 'New commands use these same chats.' :
      hasSession ? `${modeNames[selectedMode]} selected. Click OK to open the boss and its workers.` : 'Import your session, then click OK to open your selected chat type.';
    ui.prepare.disabled = busy || running || !hasPages();
    ui.prepare.textContent = busyAction === 'prepare' ? 'Preparing pages…' : 'Check & prepare pages';
    ui.attachFiles.disabled = busy || running || !hasPages() || !attachmentFailure && (!pagesReady() || !canStartStatus());
    ui.attachFiles.textContent = busyAction === 'attach' ? attachmentFailure ? 'Checking uploads…' : 'Attaching to the team…' : attachmentFailure ? '↻ Check pending uploads' : '＋ Attach files, images or code';
    ui.attachStyleReferences.disabled = ui.attachFiles.disabled;
    ui.attachStyleReferences.textContent = busyAction === 'attach' && (activeAttachmentRole === 'style-reference' || state.attachments?.fileRole === 'style-reference') ? 'Attaching design reference…' : '＋ Add a design reference';
    ui.bossAttachFiles.disabled = ui.attachFiles.disabled;
    ui.diagnostics.disabled = busy || !hasPages();
    for (const element of [ui.question, ui.protocol, ui.maxRounds, ui.roundMinus, ui.roundPlus, ui.reviewMode, ui.relayMedia, ui.requireFiles]) {
      element.disabled = busy || running;
    }
    ui.maxRounds.min = reviewMode() === 'verify' ? '1' : '4';
    if (reviewMode() !== 'verify' && Number(ui.maxRounds.value) < 4) ui.maxRounds.value = '4';
    ui.start.disabled = busy || running || !ui.question.value.trim() || !pagesReady() || !privacyConfirmed() || !canStartStatus() || attachmentFailure || ui.requireFiles.checked && !ui.relayMedia.checked;
    ui.start.textContent = busyAction === 'start' ? 'Briefing the boss…' : isFollowup() ? 'Give the boss a new task ✦' : 'Start the team ✦';
    ui.questionLabel.textContent = isFollowup() ? 'Next task · same chats' : 'Your task';
    ui.start.hidden = running;
    ui.stop.hidden = !running && !attaching;
    // Stop does not wait for an upload/start action to return.
    ui.stop.disabled = !running && !attaching || stopBusy;
    ui.stop.textContent = stopBusy ? 'Stopping…' : attaching && !running ? '■ Cancel upload' : '■ Stop exchange';
    ui.headerStop.hidden = !running && !attaching;
    ui.headerStop.disabled = !running && !attaching || stopBusy;
    ui.headerStop.textContent = stopBusy ? 'Stopping…' : '■ Stop';
    ui.sendBossMessage.disabled = busy || !bossWorkspace() || !hasPages() || !ui.bossMessageInput.value.trim() ||
      (!running && (!pagesReady() || !privacyConfirmed() || !canStartStatus() || attachmentFailure || ui.requireFiles.checked && !ui.relayMedia.checked));
    ui.bossMessageInput.disabled = busyAction === 'boss-message' || busyAction === 'start' || busyAction === 'reset' || busyAction === 'clear';
    ui.sendBossMessage.textContent = busyAction === 'boss-message' || busyAction === 'start' ? 'Sending…' : running ? 'Add instruction ↗' : ['blocked', 'limit_reached'].includes(state.status) ? 'Continue task ↗' : isFollowup() ? 'Start next task ↗' : 'Send to boss ↗';
    renderBossControls();
    for (const side of ['left', 'right']) {
      ui[`reload${side === 'left' ? 'Left' : 'Right'}`].disabled = busy || running || !hasPages() || state.attachments?.status === 'attached';
      ui[`expand${side === 'left' ? 'Left' : 'Right'}`].disabled = busy || !hasPages();
    }
    ui.restoreSplit.hidden = !expandedSide;
    const text = answerText();
    ui.copyAnswer.disabled = busy || !text;
    ui.exportAnswer.disabled = busy || !text;
    const candidateFiles = mediaInfo().files;
    ui.saveFiles.disabled = savingFiles || windowClosing || !candidateFiles.length;
    ui.saveFiles.hidden = !candidateFiles.length;
    ui.saveFiles.textContent = savingFiles ? 'Saving files…' : deliveryIsFinal() ? '↓ Download all final files' : '↓ Download all draft files';
    ui.saveFilesCompact.disabled = ui.saveFiles.disabled;
    ui.saveFilesCompact.textContent = savingFiles ? 'Saving…' : !candidateFiles.length ? 'No files yet' : deliveryIsFinal() ? '↓ Final files' : '↓ Draft files';
    ui.saveFilesCompact.title = candidateFiles.length ? deliveryIsFinal() ? 'Download the final reviewed output files' : 'Download the current draft without stopping the team' : 'No generated files have been captured yet';
    for (const button of ui.outputCard.querySelectorAll('.output-file-save')) button.disabled = savingFiles || windowClosing;
    ui.sessionBadge.textContent = hasSession ? 'Imported' : 'Not connected';
    ui.sessionBadge.classList.toggle('connected', hasSession);
    ui.questionCount.textContent = `${ui.question.value.length.toLocaleString('en-US')} / 20,000`;
    const summaryFiles = running ? state.requireFiles === true : ui.requireFiles.checked;
    const summaryMedia = running ? state.relayMedia === true : ui.relayMedia.checked;
    const committedMode = running ? state.reviewMode || reviewMode() : reviewMode();
    const minimum = running ? Number(state.minReviewRounds) || (committedMode === 'verify' ? 1 : 4) : committedMode === 'verify' ? 1 : 4;
    const reviewPlan = minimum === 1 ? '2 verification steps' : committedMode === 'auto' && !running ? `4+ improvement rounds · simple arithmetic: 2 verification steps` : `At least ${minimum} improvement rounds · up to ${running ? state.maxRounds || rounds() : rounds()}`;
    ui.reviewSummary.textContent = `${summaryFiles ? 'Revised file required' : summaryMedia ? 'File and image sharing on' : 'Text exchange'} · ${reviewPlan}`;
    ui.reviewModeHint.textContent = committedMode === 'verify' ? 'Both reviewers check the answer in 2 verification steps.' : committedMode === 'improve' ? 'Both reviewers develop meaningful improvements for at least 4 rounds before final agreement.' : 'Auto uses 4+ improvement rounds. Simple arithmetic gets 2 verification steps.';
  }

  function renderPrivacy() {
    const temporary = activeMode() === 'temporary';
    const unknown = hasPages() && temporary && pageSides().some((side) => !pageVerified(state.pages?.[side]));
    ui.privacyCheck.hidden = !unknown;
    ui.confirmBoss.closest('label').hidden = !bossWorkspace();
    for (const side of pageSides()) {
      const page = state.pages?.[side];
      const checkbox = confirmationFor(side);
      const verified = temporary && page?.temporary === true;
      if (verified) checkbox.checked = true;
      else if (confirmedAutomatically[side] || page?.temporary === false || !temporary) checkbox.checked = false;
      confirmedAutomatically[side] = verified;
      checkbox.disabled = isRunning() || !temporary || !page?.ready || verified || page?.temporary === false;
    }
    let message;
    if (!hasSession) message = 'Import your session, choose a chat type and click OK.';
    else if (!hasPages()) message = 'Choose Temporary, Normal or Work mode above, then click OK.';
    else if (!pagesReady()) message = 'The app is checking the team’s pages. Open the boss character to inspect its chat.';
    else if (temporary && pageSides().some((side) => state.pages?.[side]?.temporary === false)) {
      message = 'A page reports that Temporary mode is off. Check & prepare pages will try the visible control again. Expand the chat if needed.';
    } else if (activeMode() === 'work' && !privacyConfirmed()) {
      message = 'Work mode has not been verified in every chat. Check & prepare pages will try the Work control. Open the boss or expand a worker to inspect it.';
    } else if (!privacyConfirmed()) {
      message = 'Check Temporary mode in each chat and confirm it above when the page cannot verify the mode.';
    } else if (ui.requireFiles.checked && !ui.relayMedia.checked) message = 'Require a revised file needs sharing enabled. Turn on Share generated images and files in Settings, or turn off Require a revised file.';
    else if (state.status === 'setup') message = 'The team is ready. Give your task to the boss here or click the middle character to chat.';
    else if (isRunning()) message = 'The exchange is running. Stop is available at any time.';
    else message = 'Give the boss your next task in these same chats. Reset opens a fresh team and lets you choose a type again.';
    ui.privacyHint.textContent = message;
    ui.privacyHint.classList.toggle('ready', pagesReady() && privacyConfirmed() && (!ui.requireFiles.checked || ui.relayMedia.checked));
    scheduleBounds();
  }

  function renderPage(side) {
    const page = state.pages?.[side] || {};
    const opened = hasPages() && (side !== 'boss' || bossWorkspace());
    const verified = pageVerified(page);
    ui[`${side}Mode`].textContent = !opened ? 'Not opened' : page.authenticated === false ? 'Session not signed in' :
      page.interrupted === true ? `${modeNames[activeMode()]} · Interrupted` :
      page.reconnecting === true ? `${modeNames[activeMode()]} · Reconnecting` :
      page.busy ? `${modeNames[activeMode()]} · Generating` : !page.ready ? `${modeNames[activeMode()]} · Loading` :
        verified ? `${modeNames[activeMode()]} · Ready` : `${modeNames[activeMode()]} · Mode not verified`;
    const reason = !opened ? hasSession ? 'Choose a chat type and click OK.' : 'Waiting for your imported session.' : page.reason ||
      (page.busy ? 'ChatGPT is answering. The next review waits until it finishes.' : page.ready ?
        verified ? 'Ready · The app will relay the completed replies automatically.' : 'Composer ready · checking the selected chat type.' : 'Loading ChatGPT and looking for the composer…');
    ui[`${side}Detail`].textContent = reason;
    ui[`${side}Detail`].classList.toggle('ready', page.ready === true && verified && page.interrupted !== true && page.reconnecting !== true);
    ui[`${side}Detail`].classList.toggle('error', page.interrupted === true || page.reconnecting === true || page.authenticated === false || activeMode() === 'temporary' && page.temporary === false || activeMode() === 'work' && page.work === false);
    ui[`${side}Slot`].querySelector('.empty-page').hidden = opened;
  }

  function renderBossControls() {
    const queue = state.boss?.queue || state.userQueue || state.boss?.userQueue || state.queuedMessages || [];
    const queued = Array.isArray(queue) ? queue.length : Math.max(0, Number(state.queuedUserMessages) || 0);
    ui.bossQueueStatus.textContent = queued ? `${queued} ${queued === 1 ? 'instruction' : 'instructions'} queued` :
      !hasPages() ? 'Team not connected' : isRunning() ? state.pages?.boss?.busy ? 'Boss is thinking' : 'Team working' : 'Ready for your task';
    ui.bossQueueStatus.classList.toggle('queued', queued > 0);
    ui.bossMessageHint.textContent = state.status === 'blocked' ?
      'Send missing information here to continue this task. Direct chat above does not control workers.' : isRunning() ?
      'Send team instructions here; additions are queued for the boss. Direct chat above does not control workers.' :
      'Send team instructions here. The ChatGPT box above is for direct chat and does not control workers.';
    ui.toggleBoss.classList.toggle('has-queued-message', queued > 0);
    ui.toggleBoss.title = `${bossOpen ? 'Close' : 'Open'} boss chat${queued ? ` · ${queued} queued` : ''}`;
  }

  function setBossOpen(open) {
    if (windowClosing) return;
    if (open && studioUI?.isOpen()) studioUI.setOpen(false);
    bossOpen = Boolean(open);
    if (!bossOpen && ui.bossDrawer.contains(document.activeElement)) ui.toggleBoss.focus({ preventScroll: true });
    ui.bossDrawer.hidden = !bossOpen;
    ui.bossDrawer.setAttribute('aria-hidden', String(!bossOpen));
    ui.toggleBoss.setAttribute('aria-expanded', String(bossOpen));
    ui.toggleBoss.setAttribute('aria-label', bossOpen ? 'Close boss chat' : 'Open boss chat');
    ui.app.classList.toggle('boss-open', bossOpen);
    if (bossOpen) {
      setSidebarOpen(false);
      setResultsOpen(false);
    }
    renderBossControls();
    scheduleBounds();
    if (bossBoundsFrame != null) cancelAnimationFrame(bossBoundsFrame);
    bossBoundsFrame = null;
    if (bossOpen) {
      // Native views sit above HTML. Track the short drawer entrance so its
      // chat and the clipped worker stay aligned with the moving surface.
      const began = performance.now();
      const trackEntrance = () => {
        scheduleBounds();
        bossBoundsFrame = bossOpen && performance.now() - began < 350 ? requestAnimationFrame(trackEntrance) : null;
      };
      bossBoundsFrame = requestAnimationFrame(trackEntrance);
    }
    if (bossOpen) requestAnimationFrame(() => {
      if (bossOpen && !windowClosing) ui.bossMessageInput.focus({ preventScroll: true });
    });
  }

  function renderStatus() {
    const status = state.status || 'idle';
    let title = state.stage || 'Your workspace is ready to connect';
    let detail = state.detail || '';
    if (status === 'idle') { title = hasSession ? 'Choose how to open your team' : 'Your workspace is ready to connect'; detail ||= hasSession ? 'Choose Temporary, Normal or Work mode, then open the boss and its two workers.' : 'Import your Chrome cookies, choose a chat type, then open the team.'; }
    if (status === 'setup') { title = state.stage || 'Preparing the boss and workers'; detail ||= pagesReady() && privacyConfirmed() ? 'Give your task to the boss. It plans the work and reviews both workers’ answers.' : `The app is preparing the ${modeNames[activeMode()]} team before the first message.`; }
    if (status === 'running') { title = state.stage || 'The team is working'; detail ||= 'The boss directs the workers and receives their completed replies. Click the boss to add an idea.'; }
    if (status === 'agreed') {
      const revisions = Number(state.revisionCount) || 0;
      title = revisions ? `Revised result checked by both reviewers · ${revisions} ${revisions === 1 ? 'revision' : 'revisions'}` : 'Both reviewers checked the unchanged result';
      detail = revisions ? 'The current revision passed both model reviews. Open the changes below to compare it with the first draft. Enter another command for these chats or Reset.' : 'The reviews did not produce a changed candidate. This is a verification result, with no demonstrated improvement. Enter another command for these chats or Reset.';
      if (state.requiredWork?.length) {
        title = 'Reviewed files · test evidence reported';
        detail = 'Both reviewers checked the candidate and reported test evidence. Converge has not independently executed or authenticated those performance tests. Inspect the actual report and remaining limitations before relying on the result.';
      }
      if (bossWorkspace() && !state.requiredWork?.length) {
        title = state.stage || 'Boss review finished';
        detail = state.detail || 'The boss reviewed the workers’ results. Inspect the final answer, files and remaining limitations below, or give the team a new task.';
      }
    }
    if (status === 'error') { title = 'The exchange needs attention'; detail = state.error || state.detail || 'Check the page status, then send a command again or Reset the pair.'; }
    if (['stopped', 'cancelled'].includes(status)) { title = 'Exchange stopped'; detail = 'Your current answer and full exchange are retained. Enter another command for these chats, or Reset for a new pair.'; }
    if (status === 'limit_reached') { title = state.stage || 'Workflow limit reached'; detail = state.error || 'Review the current results and ask the boss to continue in the same chats.'; }
    if (status === 'stalled') { title = 'The reviewers stopped making progress'; detail = 'Review the current answer and unresolved issues below. You can send your next command to the same chats.'; }
    if (status === 'blocked') { title = state.stage || 'The boss needs your input'; detail = state.detail || 'Open the boss to read what is missing. Your current work and files are retained.'; }
    if (['limit_reached', 'stalled'].includes(status) && (state.issues || []).some(issue => issue.taskRequirementId && !issue.resolved)) {
      title = 'Requested testing remains unfinished';
      detail = 'The current files are retained, but the requested test evidence is still missing. Open Remaining issues to see what is needed. Model agreement cannot replace completing that work.';
    }
    ui.statusTitle.textContent = title;
    ui.statusDetail.textContent = detail;
    ui.roundBadge.textContent = state.round ? `ROUND ${state.round} / ${state.maxRounds || rounds()}` : 'ROUND —';
    ui.bottomStage.textContent = title;
    ui.bottomStage.title = `${title}${detail ? '\n' + detail : ''}`;
    ui.bottomRound.textContent = ui.roundBadge.textContent;
    ui.topStatus.textContent = status === 'running' ? (state.pages?.boss?.busy ? 'Boss thinking · team active' : 'Team working') : status === 'agreed' ? (state.requiredWork?.length ? 'Review finished · verify tests' : 'Boss review finished') : status === 'error' ? 'Needs attention' : hasSession ? 'Boss + two workers' : 'Import your session to begin';
    ui.statusDot.classList.toggle('connected', hasSession);
    ui.statusDot.classList.toggle('running', status === 'running');
    ui.statusDot.classList.toggle('error', status === 'error');
    ui.resultDrawer.classList.toggle('agreed', status === 'agreed');
    ui.resultLabel.textContent = status === 'agreed' ? (state.requiredWork?.length ? 'Reviewed candidate · performance not independently verified' : 'Final reviewed candidate') : isRunning() ? 'Current candidate · review in progress' : 'Current candidate · review unfinished';
  }

  function installCharacterVariants() {
    // These are local vector characters. Only their small heads, hands and
    // expressions move; the page backgrounds never need an animation loop.
    for (const [index, bot] of [ui.botLeft, ui.botBoss, ui.botRight].entries()) {
      bot.querySelector('svg.bot-character').classList.add('character-robot');
      const boss = bot === ui.botBoss;
      const crown = boss ? '<path class="boss-crown" d="m73 20-3-10 12 5 8-10 8 10 12-5-3 10z" fill="#ffdd8f" stroke="#fff0c9"/>' : '';
      const desk = `<g class="bot-workstation"><path d="m40 128 50-9 50 9-50 13z" fill="#12273d" stroke="currentColor" opacity=".7"/><path d="M63 90h54l-4 29H67z" fill="#0a192a" stroke="#c3e5f7"/><path class="bot-screen-code" d="M70 97h37M71 103h22m6 0h8M71 109h13m5 0h14" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path class="bot-screen-caret" d="M108 108v5" stroke="#fff" stroke-width="1.5"/><path d="m58 123 32-4 32 4-32 8z" fill="#31536a" stroke="currentColor" opacity=".8"/></g>`;
      const astronaut = `<svg class="bot-character character-astronaut" viewBox="0 0 180 156" fill="none"><defs><linearGradient id="explorerSuit${index}" x1="55" y1="20" x2="121" y2="123" gradientUnits="userSpaceOnUse"><stop stop-color="#fff"/><stop offset=".52" stop-color="#c4d6e6"/><stop offset="1" stop-color="#5c7f9f"/></linearGradient></defs><ellipse cx="90" cy="144" rx="53" ry="6" fill="currentColor" opacity=".1"/><g class="bot-float"><path d="M57 85h66v36H57z" fill="#35546e" stroke="#a9cadf"/><g class="bot-left-arm"><path d="m62 83-10 19 23 13" stroke="url(#explorerSuit${index})" stroke-width="12" stroke-linecap="round"/><g class="bot-typing-left"><ellipse cx="75" cy="115" rx="8" ry="4" fill="#ecf6ff"/></g></g><g class="bot-right-arm"><path d="m118 83 10 19-23 13" stroke="url(#explorerSuit${index})" stroke-width="12" stroke-linecap="round"/><g class="bot-typing-right"><ellipse cx="105" cy="115" rx="8" ry="4" fill="#ecf6ff"/></g></g><g class="bot-body"><path d="M70 78h40l10 37q-30 16-60 0z" fill="url(#explorerSuit${index})" stroke="#edf8ff"/><path d="M72 80q18 9 36 0" stroke="#375976" stroke-width="4"/><rect x="77" y="87" width="26" height="19" rx="4" fill="#16354e" stroke="#cee8f9"/><path d="M82 92h16m-16 5h9" stroke="currentColor" stroke-width="2"/><circle cx="100" cy="114" r="3" fill="${boss ? '#ffd88b' : 'currentColor'}"/></g><g class="bot-head"><circle cx="90" cy="49" r="38" fill="url(#explorerSuit${index})" stroke="#ebf6ff" stroke-width="1.4"/><circle cx="90" cy="48" r="30" fill="#081728" stroke="#587791" stroke-width="2"/><path d="M65 36q14-15 37-8" stroke="#f8ffff" stroke-opacity=".32" stroke-width="4" stroke-linecap="round"/><g class="bot-gaze"><g class="bot-eyes"><ellipse class="bot-eye" cx="77" cy="46" rx="5" ry="${boss ? '4' : '7'}"/><ellipse class="bot-eye" cx="103" cy="46" rx="5" ry="7"/><path d="M83 60q7 6 14 0" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>${boss ? '<path d="m70 37 13 3m14 0 13-3" stroke="#ffdf99" stroke-width="2" stroke-linecap="round"/>' : '<path d="m72 33 9-2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'}</g></g>${crown}<path d="M54 47h-5v15h7m70-15h5v15h-7" stroke="#adc9dc" stroke-width="4" stroke-linecap="round"/><circle class="bot-beacon" cx="130" cy="65" r="3" fill="currentColor"/></g></g>${desk}</svg>`;
      const spirit = `<svg class="bot-character character-spirit" viewBox="0 0 180 156" fill="none"><defs><linearGradient id="spiritBody${index}" x1="54" y1="22" x2="126" y2="127" gradientUnits="userSpaceOnUse"><stop stop-color="#effdff"/><stop offset=".45" stop-color="${boss ? '#ebceff' : '#bceef9'}"/><stop offset="1" stop-color="${boss ? '#b284dc' : '#699caf'}" stop-opacity=".55"/></linearGradient></defs><ellipse cx="90" cy="143" rx="53" ry="5" fill="currentColor" opacity=".1"/><g class="bot-float"><path class="spirit-tail" d="M58 100q-10 21 6 29l14-10 13 13 15-14 15 11q11-12 2-29z" fill="url(#spiritBody${index})" stroke="currentColor" stroke-opacity=".5"/><g class="bot-left-arm"><path d="M60 83q-16 10-11 21 5 7 22 8" stroke="url(#spiritBody${index})" stroke-width="10" stroke-linecap="round"/></g><g class="bot-right-arm"><path d="M120 83q16 10 11 21-5 7-22 8" stroke="url(#spiritBody${index})" stroke-width="10" stroke-linecap="round"/></g><g class="bot-head"><path d="M54 63q0-40 36-40t36 40v38q-36 16-72 0z" fill="url(#spiritBody${index})" stroke="#e4f7ff" stroke-width="1.1"/><path d="M64 47q7-17 23-17" stroke="#fff" stroke-width="4" stroke-opacity=".45" stroke-linecap="round"/><g class="bot-gaze"><g class="bot-eyes"><ellipse cx="77" cy="60" rx="5" ry="${boss ? '5' : '9'}" fill="#13243c"/><ellipse cx="103" cy="60" rx="5" ry="9" fill="#13243c"/><circle cx="78" cy="58" r="2" fill="#fff"/><circle cx="104" cy="58" r="2" fill="#fff"/><path d="M84 77q6 6 12 0" stroke="#293b51" stroke-width="2.2" stroke-linecap="round"/>${boss ? '<path d="m71 47 12 3m14 0 12-3" stroke="#4c3367" stroke-width="2" stroke-linecap="round"/>' : '<path d="M71 46q6-5 12-2" stroke="#365b74" stroke-width="2" stroke-linecap="round"/>'}</g><ellipse cx="67" cy="75" rx="6" ry="3" fill="#ec94c0" opacity=".55"/><ellipse cx="114" cy="75" rx="6" ry="3" fill="#ec94c0" opacity=".55"/></g>${crown}</g><circle class="bot-beacon" cx="140" cy="43" r="4" fill="currentColor"/><path d="m35 42 3 7 7 3-7 3-3 7-3-7-7-3 7-3z" fill="currentColor" opacity=".65"/></g>${desk}</svg>`;
      const holder = document.createElement('div');
      holder.innerHTML = astronaut + spirit;
      while (holder.firstChild) bot.append(holder.firstChild);
    }
  }

  function createGalaxyEffects() {
    installCharacterVariants();
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const preferenceKey = 'converge.galaxy.effectsPaused';
    const themePreferenceKey = 'converge.effects.theme';
    const motionPreferenceKey = 'converge.effects.mode';
    const themes = {
      stars: { description: 'Glowing falling stars and reviewer movement', active: 'falling stars and reviewer motion' },
      ghost: { description: 'Luminous ghosts, spectral lights and reviewer movement', active: 'ghosts, spectral lights and reviewer motion' },
      flowers: { description: 'Flowers, drifting petals and reviewer movement', active: 'flowers, petals and reviewer motion' },
    };
    let effectsPaused = false;
    let animationTheme = 'stars';
    let effectsMode = 'full';
    try { const saved = localStorage.getItem(motionPreferenceKey); if (['full', 'low-power', 'off'].includes(saved)) effectsMode = saved; } catch (_) { }
    try { effectsPaused = localStorage.getItem(preferenceKey) === 'true'; } catch (_) { }
    try {
      const savedTheme = localStorage.getItem(themePreferenceKey);
      if (savedTheme === 'galaxy') {
        animationTheme = 'stars';
        localStorage.setItem(themePreferenceKey, animationTheme);
      } else if (Object.hasOwn(themes, savedTheme)) animationTheme = savedTheme;
    } catch (_) { }
    document.body.dataset.animationTheme = animationTheme;
    ui.animationTheme.value = animationTheme;
    if (ui.effectsMode) ui.effectsMode.value = effectsMode;
    document.body.dataset.effectsMode = effectsMode;
    const galaxyScene = window.ConvergeGalaxy?.create(ui.stars, { startPaused: true });
    galaxyScene?.setPaused(true);
    const ribbonScenes = [
      window.ConvergeStarRibbons?.create(ui.topStarRibbon, { band: 'top', fps: 30, theme: animationTheme }),
      window.ConvergeStarRibbons?.create(ui.bottomStarRibbon, { band: 'bottom', fps: 30, theme: animationTheme }),
    ].filter(Boolean);
    let paperAnimation = null;
    let paperTimer = null;
    let meetingAnimations = [];
    let moodTimer = null;
    let activeRun = null;
    let windowVisible = true;
    const seenTransfers = new Set();
    const motionAllowed = () => !windowClosing && !effectsPaused && !reducedMotion.matches && !document.hidden && windowVisible;
    const moodSymbols = { curious: '🤔', thoughtful: '💭', focused: '🧠', sparkle: '✨' };
    const characterFor = (side) => ui[side === 'boss' ? 'botBoss' : side === 'left' ? 'botLeft' : 'botRight'];
    const reviewerFor = (side) => side === 'boss' ? ui.toggleBoss : ui[side === 'left' ? 'reviewerLeft' : 'reviewerRight'];

    // These expressions give the characters personality. They never change
    // the actual reviewer status, candidate quality or agreement decision.
    function setMood(side, mood) {
      const bot = characterFor(side);
      if (!Object.hasOwn(moodSymbols, mood) || bot.dataset.mood === mood) return;
      bot.dataset.mood = mood;
      bot.querySelector('.mood-symbol').textContent = moodSymbols[mood];
    }

    function scheduleMoods() {
      clearTimeout(moodTimer); moodTimer = null;
      // Expressions are set by the real coordinator stage in render().
    }

    function stopPaper() {
      clearTimeout(paperTimer);
      paperTimer = null;
      paperAnimation?.cancel(); paperAnimation = null;
      for (const animation of meetingAnimations) animation.cancel();
      meetingAnimations = [];
      for (const [element, classes] of [[ui.reviewDeck, ['meeting']], [ui.handoffDocument, ['confirmed']],
        [ui.reviewerLeft, ['sending', 'receiving']], [ui.reviewerRight, ['sending', 'receiving']], [ui.toggleBoss, ['sending', 'receiving']]]) {
        if (classes.some((name) => element.classList.contains(name))) element.classList.remove(...classes);
      }
    }

    function playPaper(from, to) {
      stopPaper();
      if (!motionAllowed()) return;
      const deck = ui.reviewDeck.getBoundingClientRect();
      const bots = { left: ui.botLeft.getBoundingClientRect(), right: ui.botRight.getBoundingClientRect(), boss: ui.botBoss.getBoundingClientRect() };
      const sender = bots[from];
      const receiver = bots[to];
      const meetingGap = Math.min(62, deck.width * .1);
      const pair = [from, to];
      const meetingX = (sender.left + sender.width / 2 + receiver.left + receiver.width / 2) / 2;
      const shifts = Object.fromEntries(pair.map((side) => [side,
        meetingX + (bots[side].left < meetingX ? -meetingGap : meetingGap) - bots[side].left - bots[side].width / 2]));
      const forward = sender.left < receiver.left;
      const startX = sender.left - deck.left + sender.width * (forward ? .87 : .13) - 18;
      const endX = receiver.left - deck.left + receiver.width * (forward ? .13 : .87) - 18;
      const startY = sender.top - deck.top + sender.height * .66 - 20;
      const endY = receiver.top - deck.top + receiver.height * .66 - 20;
      const sign = forward ? 1 : -1;
      const meetStartX = startX + shifts[from];
      const meetEndX = endX + shifts[to];
      const meetY = Math.min(startY, endY) - 7;
      ui.reviewDeck.classList.add('meeting');
      ui.handoffDocument.classList.add('confirmed');
      reviewerFor(from).classList.add('sending');
      reviewerFor(to).classList.add('receiving');
      meetingAnimations = pair.map((side) => {
        const tilt = bots[side].left < meetingX ? 4 : -4;
        return characterFor(side).animate([
          { transform: 'translate(0,0) rotate(0deg)', offset: 0 },
          { transform: `translate(${shifts[side]}px,-5px) rotate(${tilt}deg)`, offset: .28 },
          { transform: `translate(${shifts[side]}px,-5px) rotate(${tilt}deg)`, offset: .67 },
          { transform: 'translate(0,0) rotate(0deg)', offset: 1 },
        ], { duration: 2800, easing: 'cubic-bezier(.35,0,.2,1)', fill: 'none' });
      });
      paperAnimation = ui.handoffDocument.animate([
        { transform: `translate(${startX}px,${startY}px) rotate(${-12 * sign}deg) scale(.7)`, opacity: 0 },
        { transform: `translate(${startX}px,${startY}px) rotate(${-10 * sign}deg) scale(.86)`, opacity: 1, offset: .10 },
        { transform: `translate(${meetStartX}px,${meetY}px) rotate(${-8 * sign}deg) scale(.9)`, opacity: 1, offset: .28 },
        { transform: `translate(${meetStartX}px,${meetY}px) rotate(${-5 * sign}deg) scale(.92)`, opacity: 1, offset: .40 },
        { transform: `translate(${meetEndX}px,${meetY - 2}px) rotate(${7 * sign}deg) scale(.98)`, opacity: 1, offset: .57 },
        { transform: `translate(${meetEndX}px,${meetY}px) rotate(${8 * sign}deg) scale(.9)`, opacity: 1, offset: .67 },
        { transform: `translate(${endX}px,${endY}px) rotate(${10 * sign}deg) scale(.8)`, opacity: .7, offset: .93 },
        { transform: `translate(${endX}px,${endY}px) rotate(${12 * sign}deg) scale(.76)`, opacity: 0 },
      ], { duration: 2800, easing: 'cubic-bezier(.3,.1,.25,1)', fill: 'forwards' });
      paperTimer = setTimeout(stopPaper, 2820);
    }

    function updateAppearanceControls() {
      ui.animationEnabled.checked = !effectsPaused && !reducedMotion.matches;
      ui.animationEnabled.disabled = reducedMotion.matches;
      ui.animationDescription.textContent = themes[animationTheme].description;
      ui.animationStatus.textContent = reducedMotion.matches ? 'Off · system reduced motion' : effectsPaused ? 'Off · still scene' :
        document.hidden || !windowVisible ? 'On · paused while the window is hidden' : effectsMode === 'low-power' ? 'Low power · task activity only' : `On · ${themes[animationTheme].active}`;
    }

    function pauseScenes() {
      // The wide chat backdrop stays still even when the two star bands move.
      galaxyScene?.setPaused(true);
      for (const scene of ribbonScenes) scene.setPaused(!motionAllowed() || effectsMode === 'low-power');
    }

    function applyEffects() {
      document.body.classList.toggle('effects-paused', effectsPaused || reducedMotion.matches);
      ui.effectsButton.disabled = reducedMotion.matches;
      ui.effectsButton.setAttribute('aria-pressed', String(effectsPaused || reducedMotion.matches));
      ui.effectsButton.textContent = reducedMotion.matches ? '✧ Reduced motion' : effectsPaused ? '✧ Resume effects' : '✧ Pause effects';
      ui.effectsButton.title = reducedMotion.matches ? 'Reduced motion is enabled in your system settings' : effectsPaused ? 'Resume decorative motion' : 'Pause decorative motion';
      updateAppearanceControls();
      if (!windowClosing) Promise.resolve(window.convergeBrowser?.setEffectsPaused?.(effectsPaused || reducedMotion.matches)).catch(() => { });
      if (!motionAllowed()) stopPaper();
      pauseScenes();
      scheduleMoods();
    }

    function setAnimationEnabled(enabled) {
      effectsPaused = !enabled;
      if (!enabled) effectsMode = 'off';
      else if (effectsMode === 'off') effectsMode = 'full';
      document.body.dataset.effectsMode = effectsMode;
      if (ui.effectsMode) ui.effectsMode.value = effectsMode;
      try { localStorage.setItem(motionPreferenceKey, effectsMode); } catch (_) { }
      try { localStorage.setItem(preferenceKey, String(effectsPaused)); } catch (_) { }
      applyEffects();
    }
    ui.effectsButton.addEventListener('click', () => setAnimationEnabled(effectsPaused));
    ui.animationEnabled.addEventListener('change', () => setAnimationEnabled(ui.animationEnabled.checked));
    ui.effectsMode?.addEventListener('change', () => {
      effectsMode = ['full', 'low-power', 'off'].includes(ui.effectsMode.value) ? ui.effectsMode.value : 'full';
      setAnimationEnabled(effectsMode !== 'off');
    });
    ui.animationTheme.addEventListener('change', () => {
      const selectedTheme = ui.animationTheme.value;
      if (!Object.hasOwn(themes, selectedTheme) || selectedTheme === animationTheme) { ui.animationTheme.value = animationTheme; return; }
      animationTheme = selectedTheme;
      try { localStorage.setItem(themePreferenceKey, animationTheme); } catch (_) { }
      document.body.dataset.animationTheme = animationTheme;
      for (const scene of ribbonScenes) scene.setTheme?.(animationTheme);
      updateAppearanceControls();
    });
    reducedMotion.addEventListener('change', applyEffects);
    function applyVisibility() {
      document.body.classList.toggle('document-hidden', document.hidden || !windowVisible);
      if (!motionAllowed()) stopPaper();
      updateAppearanceControls();
      pauseScenes();
      scheduleMoods();
    }
    function setWindowVisible(update) {
      const visible = typeof update === 'boolean' ? update : update?.visible;
      if (typeof visible !== 'boolean' || windowVisible === visible) return;
      windowVisible = visible;
      applyVisibility();
    }
    // Chromium can keep the document visible while its native window is
    // minimized. Suspend decoration in that case without stopping the review.
    const removeWindowVisibilityListener = window.convergeBrowser?.onWindowVisibility?.(setWindowVisible);
    document.addEventListener('visibilitychange', () => {
      applyVisibility();
    });
    window.addEventListener('resize', stopPaper);
    window.addEventListener('pagehide', () => {
      clearTimeout(moodTimer); galaxyScene?.dispose();
      for (const scene of ribbonScenes) scene.dispose();
      stopPaper();
      if (typeof removeWindowVisibilityListener === 'function') removeWindowVisibilityListener();
    });
    document.body.classList.toggle('document-hidden', document.hidden || !windowVisible);
    applyEffects();

    function validTransfer(record, next) {
      return record && record.runId === next.runId && typeof record.requestId === 'string' &&
        ['left', 'right', 'boss'].includes(record.from) && ['left', 'right', 'boss'].includes(record.to) &&
        record.from !== record.to && (record.from === 'boss' || record.to === 'boss' || record.candidateId === next.candidate?.id);
    }

    function transfers(next) {
      if (next.lastTransfer) return validTransfer(next.lastTransfer, next) ? [next.lastTransfer] : [];
      // Readable-code source acknowledgements predate the general transfer
      // record. They certify a successful send, never just a busy composer.
      return Object.entries(next.sourceReadbacksBySide || {}).flatMap(([to, readback]) => {
        const record = { runId: next.runId, requestId: readback.requestId, from: next.candidate?.media?.side,
          to, candidateId: readback.candidateId, hasFiles: true };
        return validTransfer(record, next) ? [record] : [];
      });
    }

    function render(next, connected) {
      const running = next.status === 'running';
      const attention = ['error', 'stalled', 'blocked', 'limit_reached'].includes(next.status) || next.status === 'agreed' && next.requiredWork?.length > 0;
      const complete = next.status === 'agreed' && !attention;
      ui.reviewDeck.classList.toggle('attention', attention);
      const bridgeText = attention ? 'Review needs attention' : complete ? 'Review finished' :
        running ? next.phase === 'boss-planning' ? 'Boss is planning' : next.phase === 'boss-workers' ? 'Workers developing results' : next.phase === 'boss-verification' ? 'Checking the final candidate' : next.phase === 'boss-fresh-audit' ? 'Fresh final audit' : 'Review in progress' : 'Boss + two workers';
      // Page status is polled while the same decorative scene stays on screen.
      // Keep unchanged text nodes so those polls do not repaint the bot deck.
      if (ui.bridgeLabel.textContent !== bridgeText) ui.bridgeLabel.textContent = bridgeText;
      for (const side of ['left', 'right', 'boss']) {
        const reviewer = reviewerFor(side);
        const page = next.pages?.[side] || {};
        const pending = next.pending?.[side];
        const interrupted = page.interrupted === true;
        const reconnecting = !interrupted && page.reconnecting === true;
        const active = running && !!pending && page.busy === true && !interrupted && !reconnecting;
        reviewer.classList.toggle('active', active);
        reviewer.classList.toggle('ready', complete);
        reviewer.classList.toggle('warning', attention || interrupted || reconnecting);
        if (attention || interrupted || reconnecting) setMood(side, 'thoughtful');
        else if (complete) setMood(side, 'sparkle');
        else if (active) setMood(side, pending?.kind?.includes('review') || pending?.kind?.includes('verify') || pending?.kind?.includes('audit') ? 'thoughtful' : 'focused');
        else setMood(side, 'curious');
        const stage = attention || interrupted || reconnecting ? 'attention' : complete ? 'completed' : active ? /verify|audit|review/.test(pending?.kind || '') ? 'check' : 'work' : running ? 'waiting' : 'idle';
        if (reviewer.dataset.stage !== stage) reviewer.dataset.stage = stage;
        const activity = active ? 'active' : 'idle';
        if (reviewer.dataset.activity !== activity) reviewer.dataset.activity = activity;
        let label = !connected ? 'Waiting for your session' : !next.tabIds?.[side] ? 'Waiting for your chat' :
          !page.authenticated ? page.authenticated === false ? 'Check your session' : 'Opening your chat' :
            interrupted ? running ? page.awaitingProviderIdle === true || page.generating === true ?
              'Stream interrupted · waiting for provider' : 'Response interrupted · recovering' : 'Response interrupted · needs attention' :
            reconnecting ? 'Connection interrupted · waiting for complete answer' :
            running ? pending?.kind === 'draft' ? active ? 'Developing a first answer' : 'Preparing a first answer' :
              pending?.kind === 'review' ? active ? 'Checking the other answer' : 'Preparing the next review' :
                pending?.kind === 'verify' ? active ? 'Checking the final candidate' : 'Preparing final verification' :
                side === 'boss' ? active ? 'Planning and reviewing' : 'Waiting for worker results' : pending ? active ? 'Working on the boss’s task' : 'Receiving instructions' : 'Waiting for the boss' :
              attention ? next.status === 'agreed' ? 'Review finished · verify tests' : 'Review needs attention' :
                complete ? 'Review finished' : ['stopped', 'cancelled'].includes(next.status) ? 'Review stopped · answer retained' :
                  page.busy ? 'Chat has work or an unsent draft' : page.ready ? 'Ready for your command' : 'Checking your chat';
        const activityLabel = ui[side === 'boss' ? 'bossActivity' : side === 'left' ? 'leftActivity' : 'rightActivity'];
        if (activityLabel.textContent !== label) activityLabel.textContent = label;
      }
      if (!running) { stopPaper(); if (ui.reviewDeck.classList.contains('sharing')) ui.reviewDeck.classList.remove('sharing'); }
      const records = transfers(next);
      if ((next.runId || null) !== activeRun) {
        activeRun = next.runId || null; seenTransfers.clear(); stopPaper();
        // Loading a current run must not replay its already completed motion.
        for (const record of records) seenTransfers.add(`${record.runId}:${record.requestId}`);
        return;
      }
      for (const record of records) {
        const key = `${record.runId}:${record.requestId}`;
        if (seenTransfers.has(key)) continue;
        seenTransfers.add(key);
        if (seenTransfers.size > 128) seenTransfers.delete(seenTransfers.values().next().value);
        if (!running) continue;
        ui.bridgeLabel.textContent = record.hasFiles ? 'Answer and files shared' : 'Answer shared';
        if (motionAllowed()) {
          ui.reviewDeck.classList.add('sharing');
          playPaper(record.from, record.to);
        }
      }
    }
    return { render, stopPaper, setWindowVisible };
  }

  function outputRecord() {
    if (state.candidate?.media?.files?.length) return state.candidate;
    if (state.delivery?.files?.length) return state.delivery;
    return state.candidate || state.delivery || null;
  }

  function mediaInfo() {
    const record = outputRecord();
    const media = record?.media || Object.values(state.drafts || {}).find((draft) => draft?.answer === answerText())?.media;
    const outputs = Array.isArray(media?.files) && media.files.length ? media.files : Array.isArray(media?.outputs) ? media.outputs : [];
    const files = Array.isArray(record?.files) ? record.files : Array.isArray(record?.media?.files) ? record.media.files : [];
    return { side: media?.side || record?.side || record?.author || 'left', files,
      names: (files.length ? files : outputs).map((output) => typeof output === 'string' ? output : String(output?.name || output?.filename || output?.kind || 'Generated output')) };
  }

  function fileSnapshot(files = mediaInfo().files) {
    // This identity is captured before a native save dialog opens. The host
    // resolves retained bytes once; a new worker result cannot change this save.
    const record = outputRecord();
    return { candidateId: record === state.candidate ? record?.id || null : record?.candidateId || null,
      deliveryId: record?.id || null,
      sha256: record?.sha256,
      files: files.map(file => ({ name: String(file.name || file.filename || ''),
        ...(file.contentSha256 ? { contentSha256: file.contentSha256 } : {}) })),
      draft: !deliveryIsFinal() };
  }

  function fileSize(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) return '';
    if (bytes < 1024) return `${bytes} B`;
    const unit = bytes >= 1024 * 1024 ? 'MB' : 'KB';
    return `${(bytes / (unit === 'MB' ? 1024 * 1024 : 1024)).toLocaleString('en-US', { maximumFractionDigits: 1 })} ${unit}`;
  }

  function renderOutputFiles(media) {
    const checkpoints = (Array.isArray(state.delivery?.checkpoints) ? state.delivery.checkpoints : [])
      .filter(record => record.files?.length && record.sha256 !== outputRecord()?.sha256);
    const key = JSON.stringify({ selected: fileSnapshot(media.files), checkpoints: checkpoints.map(record => ({ id: record.id, sha256: record.sha256, files: record.files })) });
    if (key !== outputRowsKey) {
      outputRowsKey = key;
      const fragment = document.createDocumentFragment();
      const fileRow = (file, snapshot) => {
        const row = document.createElement('li'); row.className = 'output-file-row';
        const detail = document.createElement('div'); detail.className = 'output-file-detail';
        const name = document.createElement('strong'); name.textContent = String(file.name || file.filename || 'Generated file');
        const metadata = document.createElement('span');
        const fingerprint = file.contentSha256 ? `SHA-256 ${file.contentSha256.slice(0, 12)}…` : '';
        metadata.textContent = [fileSize(file.byteLength), fingerprint].filter(Boolean).join(' · ');
        detail.append(name, metadata);
        const button = document.createElement('button'); button.type = 'button'; button.className = 'button secondary output-file-save';
        button.textContent = '↓ Download'; button.setAttribute('aria-label', `Download ${name.textContent}`);
        button.addEventListener('click', () => saveCurrentFiles([file], snapshot));
        row.append(detail, button); return row;
      };
      for (const file of media.files) fragment.append(fileRow(file));
      ui.outputFileList.replaceChildren(fragment);
      const checkpointFragment = document.createDocumentFragment();
      for (const record of checkpoints) {
        const group = document.createElement('section'); group.className = 'output-checkpoint-group';
        const heading = document.createElement('h4'); heading.textContent = `${record.author === 'right' || record.side === 'right' ? 'Worker B' : 'Worker A'} · ${record.id || record.resultId}${record.round ? ` · cycle ${record.round}` : ''}`;
        const list = document.createElement('ul'); list.className = 'output-file-list';
        for (const file of record.files) list.append(fileRow(file, { candidateId: null, deliveryId: record.id || record.resultId,
          sha256: record.sha256, files: [{ name: file.name, ...(file.contentSha256 ? { contentSha256: file.contentSha256 } : {}) }], draft: true }));
        group.append(heading, list); checkpointFragment.append(group);
      }
      ui.checkpointFileList.replaceChildren(checkpointFragment);
    }
    ui.checkpointOutputs.hidden = !checkpoints.length;
    ui.checkpointCount.textContent = String(checkpoints.length);
    for (const button of ui.outputCard.querySelectorAll('.output-file-save')) button.disabled = savingFiles || windowClosing;
  }

  function renderResult() {
    const text = answerText();
    ui.answer.textContent = text || 'The current candidate will appear here as the reviewers work.';
    ui.answer.classList.toggle('empty-answer', !text);
    ui.resultCount.textContent = text ? state.status === 'agreed' ? bossWorkspace() ? 'Boss approved · A + B checked' : 'Accepted by A + B' : `${String(state.candidate?.id || 'Current draft')} · ${text.length.toLocaleString('en-US')} characters` : 'No answer yet';
    const media = mediaInfo();
    ui.bottomFiles.textContent = media.names.length ? `${media.names.length} ${media.names.length === 1 ? 'file' : 'files'} · ${media.names.join(' · ')}` : 'No output files yet';
    ui.bottomFiles.title = media.names.length ? media.names.join('\n') : 'Generated files and images will appear here';
    ui.outputCard.hidden = false;
    ui.outputHeading.textContent = 'Results & downloads';
    const final = deliveryIsFinal();
    const workerDraft = outputRecord() === state.delivery && /^worker/.test(state.delivery?.source || '');
    ui.deliveryStatus.textContent = final ? 'Final reviewed result' : media.files.length ? workerDraft ? 'Worker draft · awaiting boss review' : 'Current draft · review unfinished' : 'No downloadable files yet';
    ui.deliveryStatus.classList.toggle('final', final);
    ui.deliveryHint.textContent = final ? 'These are the exact files retained from the reviewed result. Check the remaining limitations below.' : media.files.length ?
      'You can download this saved draft now. Review may still change the final answer; downloading keeps the team working.' :
      text ? 'An answer is available below. The team has not delivered a downloadable file yet. Copy or export the answer, or ask the boss for the missing file.' :
      'Your final answer and generated files will appear here. Completed drafts stay downloadable while review continues.';
    ui.answerOutputs.textContent = media.files.length ? `${media.files.length} ${media.files.length === 1 ? 'file' : 'files'} retained · ${outputRecord()?.id || 'current draft'}` : '';
    renderWorkflowHistory();
    renderOutputFiles(media);
    const nextFileKey = JSON.stringify(fileSnapshot(media.files));
    if (nextFileKey !== fileCandidateKey) { fileCandidateKey = nextFileKey; ui.fileSaveStatus.hidden = true; }
    const nativeOutput = hasPages() && outputRecord()?.media?.runId !== 'saved-project';
    ui.viewOutput.hidden = !media.names.length || !nativeOutput && !studioUI?.openProjects;
    ui.viewOutput.textContent = nativeOutput ? 'View original outputs' : 'Open saved project';
    const summary = state.boss?.finalSummary;
    const checks = Array.isArray(state.boss?.finalChecks) ? state.boss.finalChecks : [];
    const limitations = state.boss?.limitations;
    ui.bossReviewCard.hidden = !bossWorkspace() || !summary && !checks.length && !limitations?.length;
    ui.bossFinalSummary.textContent = typeof summary === 'string' ? summary : '';
    ui.bossFinalChecks.textContent = checks.length ? `Reported checks\n${checks.map(value => typeof value === 'string' ? value : JSON.stringify(value)).join('\n')}` : '';
    ui.bossFinalChecks.hidden = !checks.length;
    ui.bossLimitations.textContent = typeof limitations === 'string' ? limitations : Array.isArray(limitations) ? limitations.join('\n') : '';
    ui.bossLimitations.hidden = !ui.bossLimitations.textContent;
    ui.bossLimitations.parentElement.hidden = ui.bossLimitations.hidden;
    renderImprovements();
    renderTranscript();
    renderIssues();
  }

  function renderWorkflowHistory() {
    const previous = state.completionContext;
    const present = previous && typeof previous === 'object' && (previous.status || previous.stage || previous.error);
    ui.workflowHistoryCard.hidden = !present;
    if (!present) return;
    const status = String(previous.status || 'recorded').slice(0, 80).replace(/_/g, ' ');
    ui.workflowHistoryOutcome.textContent = `Recorded outcome: ${status}`;
    ui.workflowHistoryStage.textContent = typeof previous.stage === 'string' ? previous.stage.slice(0, 600) : '';
    ui.workflowHistoryStage.hidden = !ui.workflowHistoryStage.textContent;
    ui.workflowHistoryError.textContent = previous.error ? errorText(previous.error) : '';
    ui.workflowHistoryError.hidden = !ui.workflowHistoryError.textContent;
    const date = new Date(previous.finishedAt);
    ui.workflowHistoryTime.hidden = !previous.finishedAt || !Number.isFinite(date.getTime());
    ui.workflowHistoryTime.textContent = ui.workflowHistoryTime.hidden ? '' : `Recorded ${date.toLocaleString()}`;
    ui.workflowHistoryHint.textContent = previous.status === 'agreed' ?
      'Saved history, not live progress. Reopening a project preserves this recorded outcome; it does not restore live verification.' :
      `Saved history, not live progress. This review was unfinished.${!hasPages() ? ' Open a team to continue from the retained project.' : ' The current workflow status is shown above.'}`;
  }

  function renderImprovements() {
    const history = Array.isArray(state.candidateHistory) ? state.candidateHistory : [];
    const trail = Array.isArray(state.improvementTrail) ? state.improvementTrail : [];
    const revisions = Number(state.revisionCount) || 0;
    ui.improvementCard.hidden = !state.candidate;
    ui.improvementSummary.textContent = revisions ? `${revisions} candidate ${revisions === 1 ? 'revision' : 'revisions'}` : 'No candidate revisions';
    ui.candidateVersion.textContent = state.candidate?.id || '';
    const fileChanges = trail.filter(entry => entry.fileChanged === true).length;
    ui.improvementDetail.textContent = revisions ? `${fileChanges ? `${fileChanges} file ${fileChanges === 1 ? 'replacement' : 'replacements'}. ` : ''}Benefits below are reported by the models. A revision is marked checked only after both inspect that exact candidate.` : isRunning() ? 'The reviewers are comparing drafts and looking for a useful change.' : 'The candidate stayed unchanged. Review activity records the checks that were performed.';
    const fragment = document.createDocumentFragment();
    for (const entry of trail) {
      const item = document.createElement('li');
      const title = document.createElement('strong');
      title.textContent = `${entry.from || '?'} → ${entry.to || '?'} · ${entry.fileChanged ? 'file replaced' : 'answer revised'} · ${entry.verified ? 'checked by both' : 'proposed'}`;
      item.append(title);
      if (entry.change && !(entry.changes || []).length) { const description = document.createElement('p'); description.textContent = String(entry.change); item.append(description); }
      for (const change of entry.changes || []) {
        const description = document.createElement('p');
        description.textContent = [change.change, change.benefit && `Benefit: ${change.benefit}`, change.evidence && `Evidence: ${change.evidence}`].filter(Boolean).join(' — ');
        item.append(description);
      }
      fragment.append(item);
    }
    ui.improvementTrail.replaceChildren(fragment);
    const original = history[0]?.text || state.drafts?.left?.answer || '';
    ui.originalAnswerDetails.hidden = !revisions || !original;
    ui.originalAnswer.textContent = original;
  }

  function renderTranscript() {
    const supervision = state.supervision;
    if (ui.teamHealth) {
      ui.teamHealth.hidden = !bossWorkspace();
      ui.teamHealthSummary.textContent = supervision?.checkedAt ?
        `Last check ${new Date(supervision.checkedAt).toLocaleTimeString()} · ${supervision.checks || 0} checks · Visible failures are checked immediately; healthy work continues.` :
        'Visible failures trigger an immediate check. Regular health checks run every 5 minutes; the boss repairs only the failed worker.';
      const events = supervision?.events || [];
      const visibleEvents = new Set([...events.filter(event => event.type === 'interrupted').slice(-8), ...events.slice(-20)]);
      const rows = events.filter(event => visibleEvents.has(event)).map(event => {
        const item = document.createElement('li');
        item.textContent = `${event.at ? new Date(event.at).toLocaleTimeString() + ' · ' : ''}${event.detail || event.message || event.reason || event.text || event.status || 'Worker status checked'}`;
        return item;
      });
      ui.teamHealthLog.replaceChildren(...rows);
    }
    const entries = Array.isArray(state.transcript) ? state.transcript : [];
    ui.activityCount.textContent = String(entries.length);
    const nextKey = JSON.stringify(entries);
    if (nextKey === transcriptKey) return;
    transcriptKey = nextKey;
    if (!entries.length) {
      const empty = document.createElement('p'); empty.className = 'empty-answer';
      empty.textContent = 'The complete drafts, reviews and challenges will appear here.';
      ui.transcript.replaceChildren(empty);
      return;
    }
    const fragment = document.createDocumentFragment();
    for (const entry of entries) {
      const article = document.createElement('article');
      article.className = `transcript-entry ${entry.side === 'boss' ? 'boss' : entry.side === 'right' ? 'right' : 'left'}`;
      const heading = document.createElement('div'); heading.className = 'transcript-heading';
      const reviewer = document.createElement('strong'); reviewer.textContent = entry.side === 'boss' ? 'BOSS · TEAM DIRECTOR' : entry.side === 'right' ? 'B · SECOND WORKER' : entry.side === 'left' ? 'A · FIRST WORKER' : 'YOU · TASK INSTRUCTION';
      const role = document.createElement('span'); role.textContent = String(entry.role || 'reply');
      const text = document.createElement('p'); text.textContent = String(entry.text || '');
      if (entry.outputs?.length) text.textContent += `\n\nOutputs: ${entry.outputs.map((item) => typeof item === 'string' ? item : item?.name || 'Generated output').join(', ')}`;
      heading.append(reviewer, role); article.append(heading, text); fragment.append(article);
    }
    ui.transcript.replaceChildren(fragment);
  }

  function remainingIssues() {
    const issues = (Array.isArray(state.issues) ? state.issues : []).filter(issue => !issue.resolved)
      .map(issue => typeof issue === 'string' ? { problem: issue } : issue);
    if (bossWorkspace()) {
      for (const [side, review] of Object.entries(state.finalVerification?.workers || {})) {
        if (review.verdict === 'accept') continue;
        for (const problem of review.issues || []) issues.push({ id: `Worker ${side === 'left' ? 'A' : 'B'}`, severity: 'Review', problem });
      }
      const limitations = state.boss?.limitations;
      for (const problem of Array.isArray(limitations) ? limitations : typeof limitations === 'string' && limitations ? [limitations] : []) {
        issues.push({ id: 'Boss limitation', severity: 'Limitation', problem });
      }
    }
    if (state.error && state.status !== 'agreed') issues.unshift({ id: 'Workflow', severity: 'major', problem: state.error });
    return issues;
  }

  function renderIssues() {
    const severity = { critical: 0, major: 1, minor: 2 };
    const issues = remainingIssues().sort((a, b) =>
      Number(!a.taskRequirementId) - Number(!b.taskRequirementId) || (severity[a.severity] ?? 3) - (severity[b.severity] ?? 3));
    ui.issueCount.textContent = String(issues.length);
    const nextKey = `${state.status}:${JSON.stringify(issues)}`;
    if (nextKey === issuesKey) return;
    issuesKey = nextKey;
    const fragment = document.createDocumentFragment();
    if (!issues.length) {
      const empty = document.createElement('p'); empty.className = 'empty-answer';
      empty.textContent = state.status === 'agreed' ? 'Both reviewers accepted the current answer without unresolved issues.' : 'No unresolved issues reported yet.';
      fragment.append(empty);
    }
    for (const issue of issues) {
      const box = document.createElement('article'); box.className = 'issue';
      const heading = document.createElement('h4'); heading.textContent = `${issue.id || 'Issue'} · ${issue.severity || 'Review'}`;
      const body = document.createElement('p'); body.textContent = [issue.problem || issue.summary || issue.reason, issue.evidence && `Evidence: ${issue.evidence}`, issue.correction && `Suggested correction: ${issue.correction}`].filter(Boolean).join('\n\n');
      box.append(heading, body); fragment.append(box);
    }
    ui.issues.replaceChildren(fragment);
  }

  function renderAttachments() {
    const attachment = state.attachments || {};
    const progress = attachment.progress;
    const uploading = ['uploading', 'attaching'].includes(attachment.status);
    const progressing = (uploading || busyAction === 'attach' || isRunning()) && progress && ['reading', 'staging', 'processing'].includes(progress.phase);
    ui.fileUploadProgress.hidden = !progressing;
    let progressLabel = '';
    if (progressing) {
      const sideName = { left: 'Worker A', right: 'Worker B', boss: 'Boss' }[progress.side];
      const byteAmount = (bytes) => `${(Math.max(0, Number(bytes) || 0) / 1048576).toLocaleString(undefined, { maximumFractionDigits: 1 })} MiB`;
      const determinate = progress.phase !== 'processing' && Number.isFinite(progress.processedBytes) && Number.isFinite(progress.totalBytes) && progress.totalBytes > 0;
      const percentage = determinate ? Math.min(100, Math.max(0, progress.processedBytes / progress.totalBytes * 100)) : null;
      progressLabel = progress.phase === 'reading' ? 'Reading source files' : progress.phase === 'staging' ? `Sending to ${sideName || 'the team'}` : `${sideName || 'The team'} is processing the upload`;
      ui.fileProgressLabel.textContent = `${progressLabel}${percentage === null ? '…' : ` · ${Math.floor(percentage)}%`}`;
      if (percentage === null) ui.fileProgressBar.removeAttribute('value');
      else ui.fileProgressBar.value = percentage;
      const fileCount = Number.isInteger(progress.fileCount) && progress.fileCount > 0 ? progress.fileCount : 0;
      const fileIndex = Number.isInteger(progress.fileIndex) ? progress.fileIndex : null;
      const detail = [progress.fileName, fileCount && fileIndex !== null ? `File ${Math.min(fileCount, Math.max(1, fileIndex + 1))} of ${fileCount}` : ''];
      if (determinate) detail.push(`${byteAmount(progress.processedBytes)} of ${byteAmount(progress.totalBytes)}`);
      if (progress.phase === 'processing') detail.push('Waiting for the chat service to confirm the attachment. You can cancel while it processes.');
      if (Number.isInteger(progress.completedPages) && Number.isInteger(progress.totalPages) && progress.totalPages > 0) detail.push(`${progress.completedPages} of ${progress.totalPages} pages confirmed`);
      if (typeof progress.warning === 'string' && progress.warning.trim()) detail.push(progress.warning);
      ui.fileProgressDetail.textContent = detail.filter(Boolean).join(' · ');
    }
    const labels = { uploading: 'Waiting for the team to confirm every file…', attaching: 'Attaching files to the team…', attached: 'Attached to the team', ready: 'Attached to the team', complete: 'Attached to the team', partial: 'Some uploads are unconfirmed. Click Check pending uploads when their previews finish.', failed: 'Upload failed or is still pending. Click Check pending uploads to verify the existing previews.' };
    const retained = isRunning() && Array.isArray(state.sourceNames) && state.sourceNames.length;
    const contentNames = contentFileNames(attachment.names || []);
    const sourceNames = contentFileNames(state.sourceNames || []);
    const references = styleReferenceNames();
    ui.fileStatus.textContent = attachment.error || (labels[attachment.status] ? `${labels[attachment.status]}${contentNames.length ? `\nContent files\n${contentNames.join('\n')}` : references.length ? '\nNo content files in this upload' : ''}` : retained && sourceNames.length ? `Original sources for this task · supplied with each review\n${sourceNames.join('\n')}` : isFollowup() ? 'No files queued for your next command' : 'No source files attached');
    ui.styleReferenceStatus.hidden = !references.length;
    ui.styleReferenceStatus.textContent = references.length ? `Design references · appearance only\n${references.join('\n')}` : '';
    ui.fileStatus.classList.toggle('success', !!retained || ['attached', 'ready', 'complete'].includes(attachment.status));
    ui.fileStatus.classList.toggle('failure', ['partial', 'failed'].includes(attachment.status));
    const names = attachment.names?.length ? attachment.names : (isRunning() || state.status === 'blocked') && state.sourceNames?.length ? state.sourceNames : [];
    ui.bossFilesStatus.hidden = !names.length && !progressing;
    const bossContentNames = contentFileNames(names);
    ui.bossFilesStatus.textContent = progressing ? ui.fileProgressLabel.textContent : [bossContentNames.length ? `${bossContentNames.length} content ${bossContentNames.length === 1 ? 'file' : 'files'} · ${bossContentNames.join(' · ')}` : '', references.length ? `${references.length} design ${references.length === 1 ? 'reference' : 'references'} · ${references.join(' · ')}` : ''].filter(Boolean).join(' | ');
    ui.bossFilesStatus.title = names.join('\n');
  }

  function render(nextState) {
    const oldStatus = state.status;
    const hadFiles = mediaInfo().files.length > 0;
    state = nextState && typeof nextState === 'object' ? nextState : state;
    syncFileRequirement();
    if (typeof state.hasSession === 'boolean') hasSession = state.hasSession;
    if (hasPages() && modeNames[state.chatMode]) selectedMode = state.chatMode;
    const newKey = `${state.tabIds?.left ?? ''}:${state.tabIds?.right ?? ''}:${state.tabIds?.boss ?? ''}:${activeMode()}`;
    if (newKey !== confirmationKey) {
      confirmationKey = newKey;
      ui.confirmLeft.checked = false; ui.confirmRight.checked = false; ui.confirmBoss.checked = false;
      confirmedAutomatically.left = false; confirmedAutomatically.right = false; confirmedAutomatically.boss = false;
    }
    renderPage('left'); renderPage('right'); renderPage('boss'); renderAttachments();
    updateControls(); renderStatus(); renderResult();
    galaxyEffects.render(state, hasSession);
    studioUI?.render(state);
    if (oldStatus !== 'running' && isRunning()) {
      setSidebarOpen(false);
      setResultsOpen(false);
    }
    // A finished run or a restored detached project must reveal its result,
    // instead of leaving all deliverables behind an unlabelled collapsed bar.
    if (oldStatus === 'running' && isTerminal() || !hadFiles && mediaInfo().files.length && !hasPages() && !isRunning()) {
      setResultsOpen(true); setResultTab('answer');
    }
    scheduleBounds();
  }

  function slotBounds(element) {
    if (studioUI?.isOpen()) return { x: 0, y: 0, width: 0, height: 0 };
    if (!hasPages() || element === ui.bossSlot && (!bossOpen || !bossWorkspace()) || !element.getClientRects().length) return { x: 0, y: 0, width: 0, height: 0 };
    const bounds = element.getBoundingClientRect();
    let x = bounds.x;
    let right = bounds.right;
    // Embedded native pages render above the HTML layer. Clip their covered
    // area while the drawer is open so its controls remain usable.
    if (!ui.app.classList.contains('sidebar-collapsed')) {
      const drawer = ui.sidebar.getBoundingClientRect();
      const overlap = Math.max(0, Math.min(bounds.right, drawer.right) - Math.max(bounds.left, drawer.left));
      if (overlap > 0) x = Math.max(bounds.x, drawer.right);
    }
    if (bossOpen && element !== ui.bossSlot) {
      const boss = ui.bossDrawer.getBoundingClientRect();
      if (bounds.right > boss.left && bounds.left < boss.right) right = Math.min(bounds.right, boss.left);
    }
    return { x: Math.round(x), y: Math.round(bounds.y), width: Math.max(0, Math.round(right - x)), height: Math.max(0, Math.round(bounds.height)) };
  }

  function scheduleBounds() {
    if (windowClosing || boundsScheduled) return;
    boundsScheduled = true;
    requestAnimationFrame(() => {
      boundsScheduled = false;
      if (windowClosing) return;
      const bounds = { left: slotBounds(ui.leftSlot), right: slotBounds(ui.rightSlot), boss: slotBounds(ui.bossSlot) };
      const signature = JSON.stringify(bounds);
      if (signature === lastBounds) return;
      lastBounds = signature;
      Promise.resolve(api.setBounds(bounds)).catch(() => { lastBounds = ''; });
    });
  }

  async function setExpanded(side) {
    expandedSide = side;
    ui.chatGrid.classList.toggle('expanded-left', side === 'left');
    ui.chatGrid.classList.toggle('expanded-right', side === 'right');
    ui.expandLeft.setAttribute('aria-label', side === 'left' ? 'Restore split view' : 'Expand chat A');
    ui.expandRight.setAttribute('aria-label', side === 'right' ? 'Restore split view' : 'Expand chat B');
    updateControls(); scheduleBounds();
    try { await request('expand', side); }
    catch (error) { showError(error); }
    scheduleBounds();
  }

  function setResultsOpen(open) {
    if (open && studioUI?.isOpen()) studioUI.setOpen(false);
    if (open && bossOpen) setBossOpen(false);
    ui.resultDrawer.classList.toggle('open', open);
    ui.resultContent.hidden = !open;
    ui.toggleResults.setAttribute('aria-expanded', String(open));
    scheduleBounds();
  }

  function setSidebarOpen(open) {
    if (open && studioUI?.isOpen()) studioUI.setOpen(false);
    if (open && bossOpen) setBossOpen(false);
    if (!open && ui.sidebar.contains(document.activeElement)) ui.toggleSidebar.focus({ preventScroll: true });
    ui.app.classList.toggle('sidebar-collapsed', !open);
    ui.sidebar.setAttribute('aria-hidden', String(!open));
    ui.sidebar.inert = !open;
    ui.toggleSidebar.setAttribute('aria-expanded', String(open));
    ui.toggleSidebar.setAttribute('aria-label', open ? 'Hide controls' : 'Show controls');
    scheduleBounds();
  }

  function setResultTab(name) {
    for (const tab of ['answer', 'activity', 'issues']) {
      ui[`${tab}Tab`].setAttribute('aria-selected', String(tab === name));
      ui[`${tab}Tab`].setAttribute('tabindex', tab === name ? '0' : '-1');
      ui[`${tab}Panel`].hidden = tab !== name;
    }
  }

  function startPayload(question) {
    return {
      question, protocol: ui.protocol.value.trim(), reviewMode: reviewMode(), maxRounds: rounds(),
      relayMedia: ui.relayMedia.checked, requireFiles: ui.requireFiles.checked,
      ...(studioUI ? { studio: studioUI.settings() } : {}),
      confirmTemporary: activeMode() === 'temporary' && privacyConfirmed()
    };
  }
  async function startExchange() {
    if (ui.start.disabled) return;
    await action('start', () => request('start', startPayload(ui.question.value.trim())));
  }

  async function sendBossInstruction() {
    if (ui.sendBossMessage.disabled) return;
    const text = ui.bossMessageInput.value.trim();
    const continueTask = isRunning() || ['blocked', 'limit_reached'].includes(state.status) && bossWorkspace();
    await action(continueTask ? 'boss-message' : 'start', async () => {
      if (!continueTask) ui.question.value = text;
      await request(continueTask ? 'bossMessage' : 'start', continueTask ? { text, maxRounds: rounds() } : startPayload(text));
      if (ui.bossMessageInput.value.trim() === text) ui.bossMessageInput.value = '';
    }, ui.bossMessageError);
  }
  ui.toggleBoss.addEventListener('click', () => setBossOpen(!bossOpen));
  ui.bossDrawer.addEventListener('animationend', scheduleBounds);
  ui.closeBoss.addEventListener('click', () => { setBossOpen(false); ui.toggleBoss.focus({ preventScroll: true }); });
  ui.bossMessageInput.addEventListener('input', () => { ui.bossMessageError.hidden = true; updateControls(); });
  ui.bossMessageForm.addEventListener('submit', (event) => { event.preventDefault(); sendBossInstruction(); });
  ui.bossMessageInput.addEventListener('keydown', (event) => {
    if (!event.isComposing && !event.repeat && event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); sendBossInstruction(); }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && bossOpen) { setBossOpen(false); ui.toggleBoss.focus({ preventScroll: true }); }
  });

  ui.cookieInput.addEventListener('input', updateControls);
  ui.question.addEventListener('input', updateControls);
  ui.question.addEventListener('keydown', (event) => {
    if (!event.isComposing && !event.repeat && event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); startExchange(); }
  });
  ui.chooseCookies.addEventListener('click', () => ui.cookieFile.click());
  ui.cookieFile.addEventListener('change', async () => {
    const file = ui.cookieFile.files?.[0]; ui.cookieFile.value = '';
    if (!file) return;
    if (busyAction || isRunning()) return;
    ui.cookieInput.value = '';
    const name = String(file.name || 'Cookie export').split(/[/\\]/).at(-1).replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '').slice(0, 180);
    if (ui.cookieFileStatus) ui.cookieFileStatus.textContent = `Selected: ${name}`;
    await action('import-file', async () => {
      if (!/\.json$/i.test(file.name || '')) throw new Error('Choose a cookie export saved as a .json file.');
      if (file.size > 1024 * 1024) throw new Error('The cookie export is too large. Choose a JSON file no larger than 1 MB.');
      let text = '';
      try {
        try { text = await file.text(); }
        catch (_) { throw new Error('The cookie file could not be read. Choose another export.'); }
        let parsed;
        try { parsed = JSON.parse(text.trim()); }
        catch (_) { throw new Error('This file is not valid JSON. Export your ChatGPT cookies again.'); }
        const cookies = Array.isArray(parsed) ? parsed : parsed?.cookies;
        if (!Array.isArray(cookies) || !cookies.length) throw new Error('The JSON file must contain a nonempty cookie array.');
        await importSession(text, name);
      } finally { text = ''; ui.cookieInput.value = ''; ui.cookieFile.value = ''; }
    }, ui.sessionError);
  });
  async function importSession(text, filename) {
    const result = await request('importCookies', text);
    resetPrivacyConfirmation();
    hasSession = true;
    ui.sessionHint.textContent = `Session connected with ${result.count || 'ChatGPT'} cookies. Choose your chat type, then open the team.`;
    if (ui.cookieFileStatus) ui.cookieFileStatus.textContent = filename ? `Imported: ${filename}` : 'Pasted JSON imported · input cleared';
    if (ui.cookiePasteDetails) ui.cookiePasteDetails.open = false;
    ui.sessionDetails.open = false;
    updateControls();
  }
  ui.importCookies.addEventListener('click', () => action('import', async () => {
    let text = ui.cookieInput.value.trim();
    ui.cookieInput.value = '';
    try { await importSession(text); }
    finally { text = ''; ui.cookieInput.value = ''; ui.cookieFile.value = ''; }
  }, ui.sessionError));
  ui.clearSession.addEventListener('click', () => action('clear', async () => {
    await request('clearSession'); hasSession = false;
    ui.cookieInput.value = ''; ui.sessionDetails.open = true;
    if (ui.cookieFileStatus) ui.cookieFileStatus.textContent = 'ChatGPT cookie export · .json';
    ui.sessionHint.textContent = 'Session cleared. Import a new ChatGPT cookie JSON export to begin.';
    await setExpanded(null); render(state);
  }, ui.sessionError));
  for (const mode of ['temporary', 'normal', 'work']) {
    ui[`mode${mode[0].toUpperCase()}${mode.slice(1)}`].addEventListener('change', (event) => {
      if (!event.target.checked || hasPages()) return;
      selectedMode = mode; updateControls(); renderStatus();
    });
  }
  ui.openPages.addEventListener('click', () => action('open', async () => {
    resetPrivacyConfirmation(); await setExpanded(null); await request('openPages', { chatMode: selectedMode });
    ui.sessionDetails.open = false; ui.settingsDetails.open = false; ui.sidebar.scrollTop = 0;
  }));
  ui.resetChats.addEventListener('click', () => action('reset', async () => {
    await request('resetChats');
    setBossOpen(false);
    setSidebarOpen(true);
    ui.question.value = ''; ui.bossMessageInput.value = ''; ui.bossMessageError.hidden = true; ui.actionError.hidden = true;
    ui.settingsDetails.open = false; ui.sidebar.scrollTop = 0;
    resetPrivacyConfirmation(); await setExpanded(null); setResultsOpen(false); render(state);
  }));
  ui.prepare.addEventListener('click', () => action('prepare', () => request('prepare')));
  function attachTaskFiles(target = ui.actionError, requestedRole = 'content-source') { return action('attach', async () => {
    const pending = ['partial', 'failed'].includes(state.attachments?.status);
    const fileRole = pending && state.attachments?.fileRole === 'style-reference' ? 'style-reference' : requestedRole;
    activeAttachmentRole = fileRole; updateControls();
    try {
      const result = await request('attachFiles', fileRole === 'style-reference' ? { fileRole } : undefined);
      const names = contentFileNames(result.state?.attachments?.names || state.attachments?.names || []);
      if (!result.canceled && fileRole !== 'style-reference' && names.some((name) => /\.pdf$/i.test(String(name)))) {
        automaticFileRequirement = !explicitFileRequirement;
        syncFileRequirement();
        ui.relayMedia.checked = true;
      }
    } finally { activeAttachmentRole = null; }
  }, target); }
  ui.attachFiles.addEventListener('click', () => attachTaskFiles());
  ui.attachStyleReferences.addEventListener('click', () => attachTaskFiles(ui.actionError, 'style-reference'));
  ui.bossAttachFiles.addEventListener('click', () => attachTaskFiles(ui.bossMessageError));
  ui.start.addEventListener('click', startExchange);
  async function stopExchange() {
    if (stopBusy || !isRunning() && state.attachments?.status !== 'uploading' && busyAction !== 'attach') return;
    stopBusy = true; updateControls(); ui.actionError.hidden = true;
    try { await request('stop'); } catch (error) { showError(error); }
    finally { stopBusy = false; updateControls(); }
  }
  ui.stop.addEventListener('click', stopExchange);
  ui.headerStop.addEventListener('click', stopExchange);
  ui.confirmLeft.addEventListener('change', updateControls);
  ui.confirmRight.addEventListener('change', updateControls);
  ui.confirmBoss.addEventListener('change', updateControls);
  ui.requireFiles.addEventListener('change', () => {
    explicitFileRequirement = ui.requireFiles.checked;
    automaticFileRequirement = false;
    if (ui.requireFiles.checked) ui.relayMedia.checked = true;
    updateControls();
  });
  ui.relayMedia.addEventListener('change', updateControls);
  ui.reviewMode.addEventListener('change', updateControls);
  ui.roundMinus.addEventListener('click', () => { ui.maxRounds.value = String(Math.max(reviewMode() === 'verify' ? 1 : 4, rounds() - 1)); updateControls(); });
  ui.roundPlus.addEventListener('click', () => { ui.maxRounds.value = String(Math.min(12, rounds() + 1)); updateControls(); });
  ui.maxRounds.addEventListener('input', updateControls);
  ui.maxRounds.addEventListener('blur', () => { ui.maxRounds.value = String(rounds()); updateControls(); });
  ui.reloadLeft.addEventListener('click', () => action('reload', () => request('reload', 'left')));
  ui.reloadRight.addEventListener('click', () => action('reload', () => request('reload', 'right')));
  ui.expandLeft.addEventListener('click', () => setExpanded(expandedSide === 'left' ? null : 'left'));
  ui.expandRight.addEventListener('click', () => setExpanded(expandedSide === 'right' ? null : 'right'));
  ui.restoreSplit.addEventListener('click', () => setExpanded(null));
  ui.toggleSidebar.addEventListener('click', () => setSidebarOpen(ui.app.classList.contains('sidebar-collapsed')));
  ui.closeSidebar.addEventListener('click', () => setSidebarOpen(false));
  ui.toggleResults.addEventListener('click', () => setResultsOpen(ui.resultContent.hidden));
  for (const tab of ['answer', 'activity', 'issues']) {
    ui[`${tab}Tab`].addEventListener('click', () => setResultTab(tab));
    ui[`${tab}Tab`].addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const tabs = ['answer', 'activity', 'issues'];
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (tabs.indexOf(tab) + (event.key === 'ArrowRight' ? 1 : 2)) % 3;
      setResultTab(tabs[index]); ui[`${tabs[index]}Tab`].focus();
    });
  }
  ui.copyAnswer.addEventListener('click', async () => {
    try { await request('copy', answerText()); ui.copyAnswer.textContent = 'Copied'; clearTimeout(copyTimer); copyTimer = setTimeout(() => { ui.copyAnswer.textContent = 'Copy'; }, 1600); }
    catch (error) { showError(error); }
  });
  ui.exportAnswer.addEventListener('click', () => action('export', async () => {
    const changes = (state.improvementTrail || []).map(entry => {
      const lines = [`### ${entry.from} → ${entry.to} (${entry.verified ? 'checked by both reviewers' : 'proposed'})`,
        `Round ${entry.round}; ${entry.fileChanged ? 'file contents replaced' : 'answer text revised'}.`];
      for (const change of entry.changes || []) lines.push(`- Change: ${change.change}\n  Benefit reported: ${change.benefit}\n  Evidence reported: ${change.evidence}`);
      return lines.join('\n\n');
    }).join('\n\n');
    const original = state.candidateHistory?.[0]?.text;
    const history = `## Revision record\n\n${Number(state.revisionCount) || 0} candidate revisions. Benefits are model-reported; checked means both reviewed that exact candidate.\n\n${changes || 'The candidate was unchanged; no improvement was demonstrated.'}${original && state.revisionCount ? `\n\n## First draft\n\n${original}` : ''}`;
    const bossReview = state.boss?.finalSummary ? `## Boss review\n\n${state.boss.finalSummary}\n\n${state.boss.finalChecks?.length ? `Reported checks:\n${state.boss.finalChecks.map(value => `- ${typeof value === 'string' ? value : JSON.stringify(value)}`).join('\n')}\n\n` : ''}${state.boss.limitations?.length ? `Remaining limitations:\n${Array.isArray(state.boss.limitations) ? state.boss.limitations.join('\n') : state.boss.limitations}\n\n` : ''}` : '';
    const monitoring = `## Workflow monitoring\n\n${state.supervision?.checks || 0} worker checks.\n\n${(state.supervision?.events || []).map(event => `- ${event.at ? new Date(event.at).toISOString() + ': ' : ''}${event.detail || event.message || event.reason || event.text || event.status || 'Worker status checked'}`).join('\n') || 'No monitoring events yet.'}`;
    const unresolved = `## Remaining issues and limitations\n\n${remainingIssues().map(issue => `- ${issue.summary || issue.problem || issue.reason || JSON.stringify(issue)}`).join('\n') || 'No unresolved issues recorded.'}`;
    const content = `# Converge review result\n\n${answerText()}\n\n---\n\nStatus: ${state.status}\n\nQuestion: ${state.question || ui.question.value}\n\n${bossReview}${history}\n\n${monitoring}\n\n${unresolved}\n\nModel agreement does not guarantee correctness.\n`;
    await request('saveText', { content, defaultName: 'Converge-answer.md' });
  }));
  async function saveCurrentFiles(selectedFiles, selectedSnapshot) {
    if (savingFiles || windowClosing) return;
    const snapshot = selectedSnapshot || fileSnapshot(Array.isArray(selectedFiles) ? selectedFiles : mediaInfo().files);
    if (!snapshot.files.length) return;
    setResultsOpen(true);
    setResultTab('answer');
    ui.fileSaveStatus.classList.remove('failure');
    savingFiles = true; updateControls();
    try {
      ui.fileSaveStatus.hidden = true;
      const result = await request('saveFiles', snapshot);
      if (windowClosing) return;
      const names = Array.isArray(result.names) ? result.names : [];
      const count = Array.isArray(result.saved) ? result.saved.length : Number(result.saved) || names.length;
      ui.fileSaveStatus.textContent = result.canceled ? (names.length ? `Saved ${names.join(' · ')}. Remaining saves canceled.` : 'Save canceled. Your files are still available here.') :
        names.length ? `Saved ${names.join(' · ')}${snapshot.deliveryId ? ` · ${snapshot.deliveryId}` : ''}` : `Saved ${count || 'the'} ${count === 1 ? 'file' : 'files'}.`;
      ui.fileSaveStatus.hidden = false;
    } catch (error) {
      if (!windowClosing) { ui.fileSaveStatus.classList.add('failure'); showError(error, ui.fileSaveStatus); }
    } finally { savingFiles = false; updateControls(); scheduleBounds(); }
  }
  ui.saveFiles.addEventListener('click', saveCurrentFiles);
  ui.saveFilesCompact.addEventListener('click', saveCurrentFiles);
  ui.viewOutput.addEventListener('click', () => {
    if (!hasPages() || outputRecord()?.media?.runId === 'saved-project') {
      studioUI?.openProjects?.(); return;
    }
    if (mediaInfo().side === 'boss') setBossOpen(true);
    else {
      setBossOpen(false);
      setResultsOpen(false);
      setExpanded(mediaInfo().side === 'right' ? 'right' : 'left');
    }
  });
  ui.diagnostics.addEventListener('click', () => action('diagnostics', async () => {
    const result = await request('diagnostics');
    await request('copy', JSON.stringify(result.diagnostics || {}, null, 2));
    ui.diagnostics.textContent = 'Diagnostics copied';
    setTimeout(() => { ui.diagnostics.textContent = 'Copy safe page diagnostics'; }, 1800);
  }));

  const observer = new ResizeObserver(scheduleBounds);
  observer.observe(ui.leftSlot); observer.observe(ui.rightSlot); observer.observe(ui.bossSlot); observer.observe(ui.resultDrawer);
  window.addEventListener('resize', scheduleBounds);
  window.addEventListener('scroll', scheduleBounds, true);
  for (const details of document.querySelectorAll('details')) details.addEventListener('toggle', scheduleBounds);
  function quiesceWorkspace() {
    windowClosing = true;
    observer.disconnect();
    if (bossBoundsFrame != null) cancelAnimationFrame(bossBoundsFrame);
    bossBoundsFrame = null;
    galaxyEffects.stopPaper();
    window.dispatchEvent(new Event('pagehide'));
  }
  api.onClosing?.(quiesceWorkspace);
  window.addEventListener('beforeunload', () => { windowClosing = true; observer.disconnect(); });
  function renderWindowState(value = {}) {
    const maximized = value.maximized === true;
    document.body.classList.toggle('window-maximized', maximized);
    if (ui.windowMaximize) {
      ui.windowMaximize.setAttribute('aria-label', maximized ? 'Restore window' : 'Maximize window');
      ui.windowMaximize.title = maximized ? 'Restore' : 'Maximize';
    }
    scheduleBounds();
  }
  for (const [id, operation] of [['windowMinimize', 'minimize'], ['windowMaximize', 'toggle-maximize'], ['windowClose', 'close']]) {
    if (!ui[id]) continue;
    if (typeof api.windowAction !== 'function') { ui[id].closest('.window-controls').hidden = true; continue; }
    ui[id].addEventListener('click', async () => {
      try {
        const result = await request('windowAction', operation);
        if (result?.windowState) renderWindowState(result.windowState);
      } catch (error) { showError(error); }
    });
  }
  api.onWindowState?.(renderWindowState);
  api.onState?.((next) => render(next?.state || next));
  api.onPage?.((update) => {
    if (update?.state && typeof update.state === 'object') { render(update.state); return; }
    if (!['left', 'right', 'boss'].includes(update?.side)) return;
    if (update.state === 'loading') resetPrivacyConfirmation([update.side]);
    const page = update.page || (update.status && typeof update.status === 'object' ? update.status :
      update.state === 'error' ? { ready: false, reason: update.message || 'The page could not load.' } :
      update.state === 'loading' ? { ready: false, busy: false, temporary: null, unpersonalized: null, work: null, reason: `Loading ChatGPT and preparing ${modeNames[activeMode()]} chats…` } :
      update.state === 'loaded' ? { reason: 'Page loaded. Checking the composer and selected chat type…' } : update);
    render({ ...state, pages: { ...state.pages, [update.side]: { ...state.pages?.[update.side], ...page } } });
  });
  render(state);
  api.bootstrap().then((result) => {
    const shortcutModifier = document.getElementById('startShortcutModifier');
    if (shortcutModifier) shortcutModifier.textContent = result?.platform === 'darwin' ? 'Command' : 'Ctrl';
    renderWindowState(result?.windowState);
    galaxyEffects.setWindowVisible(result?.windowVisible);
    hasSession = Boolean(result?.hasSession);
    if (result?.version) ui.version.textContent = `v${result.version}`;
    if (result?.state?.question) ui.question.value = result.state.question;
    if (result?.state?.protocol) ui.protocol.value = result.state.protocol;
    if (result?.state?.maxRounds) ui.maxRounds.value = String(result.state.maxRounds);
    if (['auto', 'improve', 'verify'].includes(result?.state?.reviewMode)) ui.reviewMode.value = result.state.reviewMode;
    if (result?.state?.question && typeof result.state.relayMedia === 'boolean') ui.relayMedia.checked = result.state.relayMedia;
    if (hasSession) ui.sessionDetails.open = false;
    render(result?.state || state);
    syncChatAppearance();
    if (isRunning()) setSidebarOpen(false);
  }).catch((error) => showError(error, ui.sessionError));
})();
