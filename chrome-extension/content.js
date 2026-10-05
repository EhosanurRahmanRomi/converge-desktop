/* Converge's page bridge. It uses only the visible ChatGPT page DOM. */
(function () {
  'use strict';

  const ASSISTANT_SELECTOR = '[data-message-author-role="assistant"], div:has(> h4[data-conversation-role="assistant"])';
  const USER_SELECTOR = '[data-message-author-role="user"], [data-user-message-bubble="true"]';
  const TURN_SELECTOR = `${USER_SELECTOR}, ${ASSISTANT_SELECTOR}, article[data-testid^="conversation-turn"]`;
  const COMPOSER_SELECTOR = [
    '#prompt-textarea',
    '[data-testid="prompt-textarea"]',
    'textarea[placeholder*="Message" i]',
    'textarea[placeholder*="Ask anything" i]',
    'textarea[placeholder*="Ask ChatGPT" i]',
    '[contenteditable="true"][aria-label*="Message" i]',
    '[contenteditable="true"][aria-label*="Ask anything" i]',
    '[contenteditable="true"][aria-label*="Ask ChatGPT" i]',
    '[contenteditable="true"][data-placeholder*="Message" i]',
    '[contenteditable="true"][data-placeholder*="Ask anything" i]',
    '[contenteditable="true"][data-placeholder*="Ask ChatGPT" i]',
    '[role="textbox"][contenteditable="true"]',
    '[role="textbox"][aria-label*="Ask ChatGPT" i]',
    '[role="textbox"][data-placeholder*="Ask ChatGPT" i]'
  ].join(',');
  const SEND_SELECTOR = [
    'button[data-testid="send-button"]',
    'button[aria-label="Send prompt" i]',
    'button[aria-label="Send message" i]',
    'button[aria-label="Send" i]',
    'button[type="submit"]'
  ].join(',');
  const STOP_SELECTOR = [
    'button[data-testid="stop-button"]',
    'button[aria-label="Stop generating" i]',
    'button[aria-label="Stop response" i]',
    'button[aria-label="Stop" i]'
  ].join(',');
  const MAX_PROMPT_CHARS = 200000;
  const MAX_REPLY_CHARS = 300000;
  const MAX_FILE_BYTES = 12 * 1024 * 1024;
  const MAX_TOTAL_BYTES = 24 * 1024 * 1024;
  // Each native upload is limited to five files. A boss prompt may inspect
  // five original sources and both workers' five-file result bundles after
  // those uploads have each been confirmed separately.
  const MAX_ATTACHED_SOURCE_NAMES = 15;
  const MIME_BY_EXTENSION = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
    pdf: 'application/pdf', zip: 'application/zip', txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', json: 'application/json',
    mq5: 'text/plain', mqh: 'text/plain', mq4: 'text/plain', py: 'text/plain', js: 'text/plain', mjs: 'text/plain', cjs: 'text/plain', ts: 'text/plain',
    jsx: 'text/plain', tsx: 'text/plain', c: 'text/plain', cc: 'text/plain', cpp: 'text/plain',
    h: 'text/plain', hpp: 'text/plain', cs: 'text/plain', java: 'text/plain', rs: 'text/plain',
    go: 'text/plain', rb: 'text/plain', php: 'text/plain', sql: 'text/plain', html: 'text/plain', css: 'text/plain', xml: 'text/plain',
    yaml: 'text/plain', yml: 'text/plain', toml: 'text/plain', sh: 'text/plain', ps1: 'text/plain', r: 'text/plain',
    swift: 'text/plain', kt: 'text/plain', kts: 'text/plain', ini: 'text/plain', cfg: 'text/plain', log: 'text/plain', set: 'text/plain',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  };
  const ALLOWED_MIME = new Set([
    'image/png', 'image/jpeg', 'image/webp', 'image/gif',
    'application/pdf', 'application/zip', 'text/plain', 'text/markdown',
    'text/csv', 'application/json',
    MIME_BY_EXTENSION.docx, MIME_BY_EXTENSION.xlsx, MIME_BY_EXTENSION.pptx
  ]);

  function createBridge(env) {
    const doc = env.document;
    const win = env.window;
    const runtime = env.chrome.runtime;
    const options = env.options || {};
    const settleMs = options.settleMs || 3000;
    const tickMs = options.tickMs || 400;
    const replyTimeoutMs = options.replyTimeoutMs || 20 * 60 * 1000;
    const setupTimeoutMs = options.setupTimeoutMs || 6000;
    const sendSettleMs = options.sendSettleMs || 250;
    const now = options.now || (() => Date.now());
    const recent = new Map();
    const cancelledRuns = new Set();
    const mediaRecords = new Map();
    const mediaExports = new Map();
    const mediaSnapshots = new Map();
    let mediaSnapshotBytes = 0;
    let mediaSnapshotEpoch = 0;
    let mediaSnapshotRunId = null;
    let active = null;
    let activeAttachment = null;
    let prepareInFlight = null;
    let chatMode = 'temporary';
    let requireUnpersonalized = true;
    let statusTimer = null;
    let lastPublishedStatus = '';
    let lastSubmissionDiagnostic = null;

    function configureMode(message) {
      if (message?.chatMode === undefined) return;
      if (!['temporary', 'normal', 'work'].includes(message.chatMode)) throw new Error('Choose Temporary, Normal, or Work chat mode.');
      chatMode = message.chatMode;
      requireUnpersonalized = message.requireUnpersonalized === true;
    }

    function visible(element) {
      if (!element || element.isConnected === false || element.hidden) return false;
      if (element.closest && element.closest('[hidden], [aria-hidden="true"]')) return false;
      const style = win.getComputedStyle ? win.getComputedStyle(element) : null;
      if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
      if (element.getClientRects && element.getClientRects().length === 0) {
        // The current ChatGPT message root uses display:contents. Its own box
        // has no rectangle while the message/image children are rendered.
        return style?.display === 'contents' && Array.from(element.children || [])
          .some((child) => !child.classList?.contains('sr-only') && visible(child));
      }
      return true;
    }

    function allVisible(selector, scope) {
      const root = scope || doc;
      try {
        return Array.from(root.querySelectorAll(selector)).filter(visible);
      } catch (_) {
        return [];
      }
    }

    function label(element) {
      return String(element.getAttribute?.('aria-label') || element.innerText || element.textContent || '')
        .replace(/\s+/g, ' ').trim();
    }

    function choiceState(element) {
      for (const attribute of ['aria-pressed', 'aria-checked', 'aria-selected', 'data-state']) {
        const value = element.getAttribute?.(attribute);
        if (value === 'true' || value === 'checked' || value === 'on') return true;
        if (value === 'false' || value === 'unchecked' || value === 'off') return false;
      }
      if (element.getAttribute?.('aria-current') === 'page') return true;
      return null;
    }

    function findComposer() {
      const editable = (element) => {
        if (element.disabled || element.getAttribute?.('contenteditable') === 'false') return false;
        return element.tagName === 'TEXTAREA' || element.isContentEditable || element.getAttribute?.('contenteditable') === 'true';
      };
      const outsideTurns = (element) => !element.closest?.(TURN_SELECTOR);
      const candidates = allVisible(COMPOSER_SELECTOR).filter(editable).filter(outsideTurns)
        // A rich editor may mark both its wrapper and inner editor editable.
        // Only the innermost editable receives text; distinct editors stay ambiguous.
        .filter((element, _index, items) => !items.some((other) => other !== element && element.contains?.(other)));
      // An editing box in a previous message must never receive a new prompt.
      if (candidates.length === 1) return candidates[0];
      if (candidates.length > 1) return null;
      // Page variants sometimes omit labels. A single visible editor in the
      // composer form is still identifiable without touching other inputs.
      const fallback = allVisible('textarea, [contenteditable="true"]')
        .filter(editable).filter(outsideTurns).filter((element) => Boolean(element.closest?.('form')))
        .filter((element, _index, items) => !items.some((other) => other !== element && element.contains?.(other)));
      return fallback.length === 1 ? fallback[0] : null;
    }

    function composerText(composer) {
      if (!composer) return '';
      return String(composer.tagName === 'TEXTAREA' ? composer.value : (composer.innerText ?? composer.textContent ?? ''));
    }

    function composerScope(composer) {
      if (!composer) return null;
      const explicit = composer.closest?.('form') || composer.closest?.('[data-testid="composer"], [data-testid="composer-root"], [data-type="unified-composer"], [data-testid="composer-container"]');
      if (explicit) return explicit;
      // Some editors expose no form/test ID. Find their nearby control group,
      // stopping before any ancestor that also contains conversation messages.
      for (let node = composer.parentElement, depth = 0; node && depth < 7; node = node.parentElement, depth += 1) {
        if (node === doc.body || node === doc.documentElement) break;
        if (node.querySelectorAll?.(TURN_SELECTOR)?.length) break;
        const sends = allVisible(SEND_SELECTOR, node).filter((element) => !element.matches?.(STOP_SELECTOR));
        const attachmentButtons = allVisible('button, [role="button"]', node)
          .filter((element) => /^add files(?: and more)?$/i.test(label(element)));
        if (sends.length === 1 || attachmentButtons.length === 1) return node;
      }
      return null;
    }

    const uploadedFiles = new Map();

    function attachmentImageIdentity(element) {
      return String(element.currentSrc || element.src || element.getAttribute?.('src') || element.getAttribute?.('aria-label') || '');
    }

    function attachmentNameEvidence(scope, originalName) {
      const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const extensionAt = originalName.lastIndexOf('.');
      const stem = extensionAt > 0 ? originalName.slice(0, extensionAt) : originalName;
      const extension = extensionAt > 0 ? originalName.slice(extensionAt) : '';
      // The site appends a numeric duplicate suffix or an upload timestamp.
      // Preserve the exact stem/extension and require fresh receipt evidence.
      const timestamp = '20[0-9]{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12][0-9]|3[01])-(?:[01][0-9]|2[0-3])[0-5][0-9][0-5][0-9](?:-[0-9]{1,6})?';
      const pattern = new RegExp(`(^|[\\s"'(){}\\[\\]:,])(${escape(stem)}(?: ?\\((?:[0-9]{1,6}|${timestamp})\\))?${escape(extension)})(?=$|[\\s"'(){}\\[\\]:,])`, 'g');
      const nodes = allVisible('[title], [aria-label], [alt], [data-testid*="attachment"], [data-testid*="file"], span, button, a', scope)
        .filter((node) => !node.closest?.(TURN_SELECTOR));
      const values = nodes.flatMap((node) => [label(node), node.getAttribute?.('title'), node.getAttribute?.('aria-label'), node.getAttribute?.('alt')]).filter(Boolean);
      if (!scope.querySelectorAll?.(TURN_SELECTOR)?.length) values.push(String(scope.innerText || scope.textContent || ''));
      const counts = new Map();
      for (const value of values) {
        pattern.lastIndex = 0;
        for (const match of String(value).matchAll(pattern)) counts.set(match[2], (counts.get(match[2]) || 0) + 1);
      }
      return counts;
    }

    function hasExpectedSources(composer, names) {
      if (!Array.isArray(names) || names.length > MAX_ATTACHED_SOURCE_NAMES || new Set(names).size !== names.length ||
          names.some((name) => typeof name !== 'string' || !/^[^\\/\x00-\x1f]{1,180}$/.test(name))) return false;
      if (!names.length) return true;
      const container = composerScope(composer);
      const scope = container?.parentElement || container;
      if (!scope) return false;
      const nodes = allVisible('[title], [aria-label], [alt], [data-testid*="attachment"], [data-testid*="file"], span, button, a', scope)
        .filter((node) => !node.closest?.(TURN_SELECTOR));
      const values = nodes.flatMap((node) => [label(node), node.getAttribute?.('title'), node.getAttribute?.('alt')]).filter(Boolean);
      // Unit fixtures and older composers expose the filename directly on the
      // attachment wrapper. Never read an entire conversation for this proof.
      if (!scope.querySelectorAll?.(TURN_SELECTOR)?.length) {
        values.push(String(scope.innerText || scope.textContent || ''));
      }
      return names.every((name) => {
        const receipt = uploadedFiles.get(name);
        if (receipt) {
          const named = receipt.observedName && (attachmentNameEvidence(scope, name).get(receipt.observedName) || 0) > receipt.previousCount;
          const image = receipt.element && visible(receipt.element) && scope.contains?.(receipt.element) &&
            !receipt.element.closest?.(TURN_SELECTOR) && attachmentImageIdentity(receipt.element) === receipt.identity;
          return Boolean(named || image);
        }
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const filename = new RegExp(`(^|[\\s"'(){}\\[\\]:,])${escaped}(?=$|[\\s"'(){}\\[\\]:,])`);
        if (values.some((value) => filename.test(String(value)))) return true;
        return false;
      });
    }

    function findSendButton(composer) {
      if (!composer) return null;
      const form = composerScope(composer);
      const local = form ? allVisible(SEND_SELECTOR, form).filter((element) => !element.matches?.(STOP_SELECTOR)) : [];
      if (local.length === 1) return local[0];
      if (local.length > 1) return null;
      const global = allVisible(SEND_SELECTOR).filter((element) => !element.matches?.(STOP_SELECTOR));
      return global.length === 1 ? global[0] : null;
    }

    function generationStopControls() {
      const scope = composerScope(findComposer());
      // The current renderer's unlabeled square has aria-label="Stop" and no
      // test ID. Recognize that generic label only in this composer, while
      // retaining the older explicit generation controls.
      return allVisible(STOP_SELECTOR).filter((control) =>
        control.getAttribute?.('data-testid') === 'stop-button' ||
        !/^stop$/i.test(String(control.getAttribute?.('aria-label') || '').trim()) || Boolean(scope?.contains?.(control)));
    }

    function generationBusy() {
      return generationStopControls().length > 0 ||
        allVisible('[data-is-streaming="true"], .result-streaming').length > 0;
    }

    function privacyState() {
      const controls = allVisible('button, [role="button"], [role="radio"], [role="menuitemradio"]');
      const headers = allVisible('header h1, header h2, [role="banner"] h1, [role="banner"] h2');
      const outsideMenus = (element) => !element.closest?.('[role="menu"], [role="dialog"], [role="listbox"]');
      const headerButtons = controls.filter((element) => outsideMenus(element) && element.closest?.('header, [role="banner"]') &&
        (element.tagName === 'BUTTON' || element.getAttribute?.('role') === 'button'));
      const activeTemporaryButtons = headerButtons.filter((element) => /^turn off temporary chat$/i.test(label(element)));
      const freshTemporaryButtons = headerButtons.filter((element) => /^temporary chat$/i.test(label(element)) && choiceState(element) === null);
      const mainTemporaryHeadings = allVisible('main h1, main h2, main h3, main h4, main h5, main h6, main [role="heading"], [role="main"] h1, [role="main"] h2, [role="main"] h3, [role="main"] h4, [role="main"] h5, [role="main"] h6, [role="main"] [role="heading"]')
        .filter((element) => outsideMenus(element) && /^temporary chat$/i.test(label(element)));
      const mainModes = controls.filter((element) => outsideMenus(element) && element.closest?.('main, [role="main"]') &&
        (element.tagName === 'BUTTON' || element.getAttribute?.('role') === 'button') && /^(unpersonalized|personalized)$/i.test(label(element)));
      let temporary = null;
      let unpersonalized = null;

      for (const element of controls) {
        const name = label(element);
        const state = choiceState(element);
        if (/^temporary(?: chat)?$/i.test(name) && state !== null) temporary = state;
        if (/^unpersonalized$/i.test(name) && state !== null) unpersonalized = state;
        if (/^personalized$/i.test(name) && state === true) unpersonalized = false;
      }
      // A static heading or badge is an active state, unlike a menu option.
      for (const element of headers) {
        if (element.closest?.('[role="menu"], [role="dialog"]')) continue;
        const name = label(element);
        if (/^temporary chat$/i.test(name)) temporary = true;
        if (/^unpersonalized$/i.test(name)) unpersonalized = true;
        if (/^personalized$/i.test(name)) unpersonalized = false;
      }
      // Current ChatGPT exposes an active mode through a Turn off action and
      // a main-page heading, rather than aria-pressed. A unique current-choice
      // dropdown beside that heading is distinct from selectable menu options.
      if (activeTemporaryButtons.length === 1 || mainTemporaryHeadings.length === 1) temporary = true;
      else if (activeTemporaryButtons.length === 0 && mainTemporaryHeadings.length === 0 && freshTemporaryButtons.length === 1 && temporary !== true) temporary = false;
      if (mainTemporaryHeadings.length === 1 && mainModes.length === 1) {
        unpersonalized = /^unpersonalized$/i.test(label(mainModes[0]));
      }
      // Once a Temporary conversation has messages, its heading and toggle
      // disappear. The current public conversation URL retains the explicit
      // mode flag. An observed off control takes priority over that flag.
      if (temporary === null) {
        try {
          const current = new URL(String(win.location?.href || ''));
          const flags = current.searchParams.getAll('temporary-chat');
          if (current.origin === 'https://chatgpt.com' &&
              /^\/c\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/?$/i.test(current.pathname) &&
              flags.length === 1 && flags[0] === 'true') temporary = true;
        } catch (_) { }
      }
      return { temporary, unpersonalized };
    }

    function workState() {
      const outsideTurns = (element) => !element.closest?.(TURN_SELECTOR);
      const controls = allVisible('button, a, [role="button"], [role="radio"], [role="menuitemradio"], [role="tab"], [role="option"]')
        .filter(outsideTurns);
      const work = controls.filter((element) => /^(work|work mode|switch to work)$/i.test(label(element)));
      const chat = controls.filter((element) => /^(chat|chat mode|switch to chat)$/i.test(label(element)));
      const selectedWork = work.some((element) => choiceState(element) === true);
      const selectedChat = chat.some((element) => choiceState(element) === true);
      if (selectedWork && selectedChat) return null;
      if (selectedWork) return true;
      if (selectedChat) return false;
      // After the first Work response the mode switch can disappear. Its
      // unique live editor retains this explicit Work label; historical text
      // and previous user-message editors are excluded by findComposer().
      const composer = findComposer();
      if (/^work with chatgpt$/i.test(String(composer?.getAttribute?.('aria-label') || '').trim())) return true;
      const headings = allVisible('header h1, header h2, [role="banner"] h1, [role="banner"] h2, main h1, main h2, main [role="heading"], [role="main"] h1, [role="main"] h2, [role="main"] [role="heading"]')
        .filter(outsideTurns).filter((element) => !element.closest?.('[role="menu"], [role="dialog"], [role="listbox"]'));
      const workHeading = headings.filter((element) => /^(work|work mode)$/i.test(label(element)));
      const chatHeading = headings.filter((element) => /^(chat|chat mode)$/i.test(label(element)));
      if (workHeading.length === 1 && !chatHeading.length) return true;
      if (chatHeading.length === 1 && !workHeading.length) return false;
      if (work.length === 1 && choiceState(work[0]) === false) return false;
      const currentSwitch = controls.filter((element) => !element.closest?.('[role="menu"], [role="dialog"], [role="listbox"]') &&
        Boolean(element.closest?.('header, [role="banner"], main, [role="main"]')));
      if (currentSwitch.filter((element) => /^switch to chat$/i.test(label(element))).length === 1) return true;
      if (currentSwitch.filter((element) => /^switch to work$/i.test(label(element))).length === 1) return false;
      return null;
    }

    function workRequiresUpgrade(element) {
      return [element?.innerText, element?.textContent].some((value) =>
        typeof value === 'string' && /^work\s*requires\s+upgrade$/i.test(normalizePageText(value)));
    }

    function workAccessReason() {
      // Read the explicit restriction in the actual mode switch, rather than
      // interpreting model answers or account menus as availability evidence.
      const groups = allVisible('[role="group"][aria-label="Composer mode" i]')
        .filter((group) => !group.closest?.(TURN_SELECTOR));
      const restricted = groups.some((group) => allVisible('button, [role="button"], [role="radio"], [role="tab"]', group)
        .some(workRequiresUpgrade));
      return restricted ? 'This ChatGPT account shows Work requires upgrade. Choose Normal or Temporary, or use an account with Work access.' : '';
    }

    function inspect() {
      const composer = findComposer();
      const attachmentScope = currentAttachmentScope(composer);
      const attachmentError = attachmentFailure(attachmentScope);
      const attachmentProcessing = attachmentsProcessing(attachmentScope);
      const login = allVisible('button, a').some((element) => /^(log in|sign in)$/i.test(label(element)));
      const authenticated = login ? false : composer ? true : null;
      const privacy = privacyState();
      const work = workState();
      const workRestriction = chatMode === 'work' ? workAccessReason() : '';
      const busy = Boolean(active || generationBusy() || composerText(composer).trim() || attachmentProcessing);
      // On a new ChatGPT page the Send control can be replaced by Voice until
      // text is entered. Check it after filling, not while the box is empty.
      const modeReady = chatMode === 'normal' ? work !== true : (chatMode === 'work' ? work === true && !workRestriction :
        work !== true && privacy.temporary !== false && (!requireUnpersonalized || privacy.unpersonalized !== false));
      const ready = Boolean(authenticated && !busy && !attachmentError && modeReady);
      let reason = '';
      if (!composer) reason = 'Chat composer was not found or more than one composer is visible.';
      else if (login) reason = 'Sign in to ChatGPT in this Chrome profile.';
      else if (attachmentError) reason = `An attachment failed to upload: ${attachmentError}. Remove the failed attachment and attach it again before starting.`;
      else if (attachmentProcessing) reason = 'This chat is uploading an attachment. Wait until its preview is ready.';
      else if (busy) reason = 'This chat is generating a response or has an unsent draft.';
      else if (workRestriction) reason = workRestriction;
      else if (chatMode === 'work' && work !== true) reason = 'Work mode is not verified. Select Work in this page, then check the pages again.';
      else if (chatMode !== 'work' && work === true) reason = 'This page is still in Work mode. Select Chat, then check the pages again.';
      else if (chatMode === 'temporary' && privacy.temporary === false) reason = 'Temporary Chat is off.';
      else if (chatMode === 'temporary' && requireUnpersonalized && privacy.unpersonalized === false) reason = 'This Temporary Chat is personalized.';
      else if (chatMode === 'temporary' && (privacy.temporary !== true || (requireUnpersonalized && privacy.unpersonalized !== true))) {
        reason = `The page does not expose enough state to verify Temporary${requireUnpersonalized ? ' and Unpersonalized' : ''}. Check the selected mode in ChatGPT before starting.`;
      }
      return { ok: true, ready, authenticated, ...privacy, work, chatMode, busy, reason };
    }

    function diagnostics() {
      const composer = findComposer();
      const controls = allVisible('button, [role="button"], [role="radio"], [role="menuitemradio"]')
        .filter((element) => /^(?:temporary(?: chat)?|turn off temporary chat|personalized|unpersonalized)$/i.test(label(element)))
        .slice(0, 12).map((element) => ({
          label: label(element),
          role: String(element.getAttribute?.('role') || element.tagName || '').slice(0, 30),
          selected: choiceState(element),
          inHeader: Boolean(element.closest?.('header, [role="banner"]')),
          inMenu: Boolean(element.closest?.('[role="menu"], [role="dialog"], [role="listbox"]'))
        }));
      return {
        version: 1,
        composerFound: Boolean(composer),
        visibleEditors: allVisible('textarea, [contenteditable="true"]').length,
        visibleSendControls: allVisible(SEND_SELECTOR).length,
        fileInputsInComposer: composerScope(composer)?.querySelectorAll?.('input[type="file"]')?.length ?? null,
        visibleUserTurns: getTurns(USER_SELECTOR).length,
        visibleAssistantTurns: getTurns(ASSISTANT_SELECTOR).length,
        privacy: privacyState(),
        chatMode, work: workState(),
        privacyControls: controls,
        submission: lastSubmissionDiagnostic
      };
    }

    function publishStatus() {
      try {
        const status = inspect();
        const fingerprint = JSON.stringify(status);
        if (fingerprint === lastPublishedStatus) return;
        lastPublishedStatus = fingerprint;
        const result = runtime.sendMessage({ type: 'PAGE_STATUS', status });
        if (result && typeof result.catch === 'function') result.catch(() => {});
      } catch (_) { /* A sleeping service worker does not affect the page. */ }
    }

    function scheduleStatus() {
      if (statusTimer !== null) return;
      statusTimer = setTimeout(() => { statusTimer = null; publishStatus(); }, Math.min(tickMs, 400));
    }

    function getTurns(selector) {
      const nodes = allVisible(selector);
      // Some variants expose both a turn wrapper and a legacy message marker.
      // Count the enclosing message once, preserving document order.
      return nodes.filter((node) => !nodes.some((other) => other !== node && other.contains?.(node)));
    }

    function assistantText(element) {
      if (!element) return '';
      const blocks = Array.from(element.querySelectorAll?.('.markdown, [data-testid="message-content"], [data-markdown-text-style="assistant-message"]') || []);
      const bodies = blocks.length ? blocks.filter((block) => !blocks.some((other) => other !== block && other.contains?.(block))) : [element];
      return bodies.map((body) => {
        if (bodies.length === 1) {
          const codeBlocks = Array.from(body.querySelectorAll?.('pre code, [data-markdown-copy="code-block"] code') || []);
          const codeContainers = Array.from(body.querySelectorAll?.('pre, [data-markdown-copy="code-block"]') || []);
          const outerContainers = codeContainers.filter((container) => !codeContainers.some((other) => other !== container && other.contains?.(container)));
          if (codeBlocks.length === 1 && outerContainers.length === 1 && outerContainers[0].contains?.(codeBlocks[0])) {
            const remainder = body.cloneNode?.(true);
            if (remainder) {
              // The current code renderer uses DIV[data-markdown-copy] with
              // its language/action header marked copy=exclude, not a PRE.
              // Remove the recognized block only for the prose guard; return
              // CODE.textContent itself so JSON escapes stay byte-for-byte.
              remainder.querySelectorAll?.('pre, [data-markdown-copy="code-block"], h4[data-conversation-role="assistant"], .sr-only, button, [role="button"], [role="toolbar"], [data-testid="chatgpt-library-file-citation"], [hidden], [aria-hidden="true"]')
                .forEach((node) => node.remove());
              if (!String(remainder.textContent || '').trim()) return String(codeBlocks[0].textContent || '');
            }
          }
        }
        if (blocks.length && body.getAttribute?.('data-markdown-text-style') !== 'assistant-message') return String(body.innerText ?? body.textContent ?? '');
        // A display:contents speaker root surrounds its actual body with the
        // screen-reader speaker label and media toolbar. Neither is an answer.
        const copy = body.cloneNode?.(true);
        if (!copy) return String(body.innerText ?? body.textContent ?? '');
        // Inline generated-file mentions carry the literal copy text. Keep
        // that filename in the answer/JSON while removing their UI controls.
        copy.querySelectorAll?.('[data-file-reference="true"][data-markdown-copy-text]').forEach((node) =>
          node.replaceWith(doc.createTextNode(String(node.getAttribute('data-markdown-copy-text') || ''))));
        copy.querySelectorAll?.('h4[data-conversation-role="assistant"], .sr-only, button, [role="button"], [role="toolbar"], [hidden], [aria-hidden="true"]')
          .forEach((node) => node.remove());
        copy.querySelectorAll?.('br').forEach((node) => node.replaceWith(doc.createTextNode('\n')));
        return String(copy.textContent || '');
      }).join('\n').replace(/\r\n/g, '\n').trim();
    }

    function normalizePageText(value) {
      // Rich editors split inserted lines into paragraphs, trim indentation,
      // and expose paragraph boundaries differently through innerText. Compare
      // every word and punctuation mark in order while tolerating only changes
      // to whitespace. The unique tracking ID in app prompts is part of that
      // comparison, so another submission cannot pass as this request.
      return String(value || '').replace(/[\s\u00a0]+/g, ' ').trim();
    }

    function structuredPageText(element) {
      if (!element?.childNodes) return null;
      // innerText inserts layout whitespace around inline link widgets after
      // the editor renders them. textContent instead loses paragraph breaks.
      // Read the actual text nodes, retaining only real block/BR boundaries;
      // inline characters and punctuation must still match the entire prompt.
      const blocks = /^(?:P|DIV|PRE|LI|UL|OL|BLOCKQUOTE|H[1-6]|TR|TD|TH)$/;
      const read = (node) => {
        if (node.nodeType === 3) return node.nodeValue ?? node.textContent ?? '';
        if (node.nodeType !== 1) return '';
        if (node.tagName === 'BR') return '\n';
        const content = Array.from(node.childNodes || []).map(read).join('');
        return blocks.test(node.tagName) ? `\n${content}\n` : content;
      };
      return Array.from(element.childNodes).map(read).join('');
    }

    function containsFullPrompt(element, expected) {
      const normalized = normalizePageText(expected);
      const values = element?.tagName === 'TEXTAREA'
        ? [element.value]
        : [element?.innerText, element?.textContent, structuredPageText(element)];
      return values.some((value) => typeof value === 'string' && normalizePageText(value) === normalized);
    }

    const expandingUserTurns = new WeakSet();

    function userTextValues(element) {
      const bodies = Array.from(element?.querySelectorAll?.('[data-testid="message-content"], .whitespace-pre-wrap, .markdown') || []);
      return [element, ...bodies].flatMap((body) => [body?.innerText, body?.textContent, structuredPageText(body)])
        .filter((value) => typeof value === 'string').map(normalizePageText);
    }

    function trackingMarker(expected, requestId) {
      if (typeof requestId !== 'string' || !requestId) return null;
      const match = String(expected).match(/(?:^|\n)Exchange tracking ID(?: \([^\n)]*\))?:\s*([^\s]+)\s*$/);
      return match?.[1] === requestId ? normalizePageText(match[0]) : null;
    }

    function includesMessageText(value, expected) {
      const index = value.indexOf(expected);
      if (index < 0) return false;
      const end = index + expected.length;
      return end === value.length || /\s/.test(value[end]);
    }

    function userExpandControl(element) {
      const scope = element?.closest?.('article[data-testid^="conversation-turn"], [data-testid^="conversation-turn"]') || element;
      if (!scope || allVisible(USER_SELECTOR, scope).some((user) => user !== element)) return null;
      const controls = allVisible('button, [role="button"]', scope)
        .filter((control) => /^(show more|see more|expand(?: message)?)$/i.test(label(control)));
      return controls.length === 1 ? controls[0] : null;
    }

    function sameUserText(element, expected, requestId) {
      if (!element) return false;
      const prompt = normalizePageText(expected);
      // Bubble controls such as Show more and Copy can surround the message.
      // The editor is still checked in full before Send; the new user turn is
      // correlated with this request's unique marker after submission.
      const marker = trackingMarker(expected, requestId);
      if (userMessageMatches(element, expected, requestId)) return true;
      const expand = userExpandControl(element);
      if (expand && !expandingUserTurns.has(element)) {
        expandingUserTurns.add(element);
        expand.click();
        // React may reveal the omitted text on the next render. A caller can
        // poll this same fresh turn without submitting another prompt.
        return userTextValues(element).some((value) => includesMessageText(value, prompt) || (marker && includesMessageText(value, marker)));
      }
      return false;
    }

    function userMessageMatches(element, expected, requestId) {
      if (!element) return false;
      const prompt = normalizePageText(expected);
      const marker = trackingMarker(expected, requestId);
      return userTextValues(element).some((value) => value === prompt || includesMessageText(value, prompt) ||
        (marker && includesMessageText(value, marker)));
    }

    function sameBaselineUser(element, task) {
      if (!element) return task.baselineLatestUserValues.length === 0;
      const values = userTextValues(element);
      return values.some((value) => task.baselineLatestUserValues.includes(value));
    }

    function recordSubmissionDiagnostic(task, stage) {
      const pathOnly = (value) => { try { return new URL(value).pathname.slice(0, 240); } catch (_) { return null; } };
      const users = getTurns(USER_SELECTOR);
      lastSubmissionDiagnostic = {
        stage,
        originalPath: pathOnly(task.url),
        currentPath: pathOnly(win.location.href),
        acceptedPath: task.acceptedUrl ? pathOnly(task.acceptedUrl) : null,
        transientPath: task.acceptedLocalPath || null,
        baselineUserCount: task.baselineUserCount,
        userCount: users.length,
        assistantCount: getTurns(ASSISTANT_SELECTOR).length,
        matchedOwnTurn: userMessageMatches(users.at(-1), task.text, task.requestId),
        submittedUserConfirmed: Boolean(task.submittedUser),
        generationBusy: generationBusy(),
        composerFound: Boolean(findComposer()),
        fullPromptMatched: containsFullPrompt(findComposer(), task.text),
        sendEnabled: Boolean(findSendButton(findComposer()) && !findSendButton(findComposer()).disabled),
      };
    }

    function safeFilename(value, fallback) {
      const cleaned = String(value || '').replace(/[<>:"|?*\\/\x00-\x1f\x7f]/g, '_').trim().replace(/[. ]+$/, '').slice(0, 180);
      return cleaned && cleaned !== '.' && cleaned !== '..' ? cleaned : fallback;
    }

    function filenameMime(name) {
      const extension = String(name || '').match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
      return MIME_BY_EXTENSION[extension] || null;
    }

    function validateZipArchive(name, mimeType, bytes) {
      const isZip = /\.zip$/i.test(String(name || ''));
      if (!isZip && mimeType !== 'application/zip') return;
      if (!isZip || mimeType !== 'application/zip') throw new Error('The ZIP file type does not match its filename.');
      if (bytes === undefined) return;
      // Inspect container headers only. Never extract, decompress, execute or
      // interpret a member; a valid envelope does not certify its contents.
      const invalid = () => { throw new Error('The ZIP file is malformed, incomplete, or uses unsupported multipart/ZIP64 structures.'); };
      const u16 = offset => bytes[offset] | (bytes[offset + 1] << 8);
      const u32 = offset => (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
      if (bytes.length < 22 || ![0x04034b50, 0x06054b50, 0x08074b50].includes(u32(0))) invalid();
      let end = -1;
      for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65_557); offset -= 1) {
        if (u32(offset) === 0x06054b50 && offset + 22 + u16(offset + 20) === bytes.length) { end = offset; break; }
      }
      if (end < 0 || u16(end + 4) !== 0 || u16(end + 6) !== 0 || u16(end + 8) !== u16(end + 10)) invalid();
      const entries = u16(end + 10), directorySize = u32(end + 12), directoryOffset = u32(end + 16);
      if (entries === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff || directoryOffset + directorySize > end) invalid();
      if (!entries) { if (directorySize !== 0) invalid(); return; }
      let cursor = directoryOffset;
      for (let index = 0; index < entries; index += 1) {
        if (cursor + 46 > directoryOffset + directorySize || u32(cursor) !== 0x02014b50 || u16(cursor + 34) !== 0) invalid();
        const localOffset = u32(cursor + 42);
        if (u32(cursor + 20) === 0xffffffff || u32(cursor + 24) === 0xffffffff || localOffset === 0xffffffff ||
            localOffset + 30 > directoryOffset || u32(localOffset) !== 0x04034b50) invalid();
        cursor += 46 + u16(cursor + 28) + u16(cursor + 30) + u16(cursor + 32);
        if (cursor > directoryOffset + directorySize) invalid();
      }
      if (cursor !== directoryOffset + directorySize) invalid();
    }

    function validateSettingsFile(name, mimeType, bytes) {
      if (!/\.set(?:\.txt)?$/i.test(String(name || ''))) return;
      if (mimeType !== 'text/plain') throw new Error('The settings file type does not match its filename.');
      if (bytes !== undefined) validateReadableSource(name, mimeType, bytes);
    }

    function validateReadableSource(name, mimeType, bytes) {
      if (mimeType !== 'text/plain') return;
      if (filenameMime(name) !== 'text/plain') throw new Error('The text source file has an unsupported extension.');
      // MQL editors can save BOM-marked UTF-16. Decode solely to validate
      // readability; export and hash the untouched bytes in either encoding.
      const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le'
        : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8';
      const Decoder = win.TextDecoder || globalThis.TextDecoder;
      if (typeof Decoder !== 'function') throw new Error('This browser cannot verify readable source-file text.');
      let text;
      try { text = new Decoder(encoding, { fatal: true }).decode(bytes); }
      catch (_) { throw new Error('The source file is not readable Unicode text.'); }
      if (/[\x00-\x08\x0b\x0e-\x1f\x7f]/.test(text)) throw new Error('The source file contains binary data instead of readable text.');
    }

    const OUTPUT_CITATION_SELECTOR = '[data-testid="chatgpt-library-file-citation"], [data-file-reference], [data-testid*="citation"], [data-citation]';
    const LIBRARY_CITATION_SELECTOR = '[data-testid="chatgpt-library-file-citation"], [data-testid*="citation"], [data-citation]';
    const DOWNLOAD_ACTION = /^(?:(?:↓|⬇|⇩)\s*)?(?:download|save)(?=\s|$|:)/i;
    function outputCitation(element) {
      const citation = element.closest?.(OUTPUT_CITATION_SELECTOR);
      if (!citation) return false;
      // ChatGPT now exposes some tool-created artifacts as an inline SPAN,
      // sharing data-file-reference with preview citations. Only the exact
      // named Download control with matching file metadata is a download.
      // The exception is re-evaluated on every export identity check.
      return !inlineGeneratedDownload(element) || citation !== element;
    }

    function actionFilename(element) {
      const value = label(element).replace(DOWNLOAD_ACTION, '').replace(/^\s*:\s*/, '').trim();
      return value && /^[^\\/\x00-\x1f]{1,180}\.[a-z0-9]{1,15}$/i.test(value) && safeFilename(value, '') === value ? value : '';
    }

    function inlineGeneratedDownload(element) {
      if (element.getAttribute?.('data-file-reference') !== 'true' || element.getAttribute?.('role') !== 'button' ||
          element.closest?.(LIBRARY_CITATION_SELECTOR) || element.parentElement?.closest?.('[data-file-reference]') ||
          !/^download(?=\s|:)/i.test(label(element))) return false;
      const name = actionFilename(element);
      return Boolean(name) && element.getAttribute?.('data-markdown-copy-text') === name;
    }

    function sourceFingerprint(value) {
      // A DOM identity marker, not a claim that the file's bytes were hashed.
      let hash = 2166136261;
      for (const char of value) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
      return `dom:${(hash >>> 0).toString(16).padStart(8, '0')}`;
    }

    function imageSource(element) {
      return String(element.currentSrc || element.src || element.getAttribute?.('src') || '');
    }

    function outputImageCandidate(element) {
      if (!visible(element)) return false;
      const bounds = element.getBoundingClientRect?.();
      if (bounds ? bounds.width < 64 || bounds.height < 64 : Number(element.naturalWidth) < 64 || Number(element.naturalHeight) < 64) return false;
      if (element.closest?.('[data-testid*="avatar"], .avatar')) return false;
      return !/^(?:avatar|profile (?:photo|picture)|icon|logo|badge)$/i.test(String(element.getAttribute?.('alt') || '').trim());
    }

    function largeImage(element) {
      return outputImageCandidate(element) && element.complete !== false && Number(element.naturalWidth) >= 64 && Number(element.naturalHeight) >= 64;
    }

    function downloadableAnchor(element) {
      if (outputCitation(element)) return null;
      const href = String(element.href || element.getAttribute?.('href') || '');
      const rawHref = String(element.getAttribute?.('href') || '');
      let url;
      try { url = new URL(href, win.location.href); } catch (_) { return null; }
      const native = url.protocol === 'sandbox:' || rawHref.startsWith('#') || /^javascript:\s*(?:void\s*\(\s*0\s*\)\s*;?|;)$/i.test(href);
      if (!native && !['http:', 'https:', 'blob:'].includes(url.protocol)) return null;
      let pathName = '';
      try { pathName = decodeURIComponent(url.pathname.split('/').pop() || ''); } catch (_) { /* Invalid encoded name stays unsupported. */ }
      const downloadAttribute = element.getAttribute?.('download');
      const hasDownload = downloadAttribute !== null && downloadAttribute !== undefined;
      const download = String(downloadAttribute || '');
      const visibleName = label(element);
      const explicitAction = DOWNLOAD_ACTION.test(visibleName);
      const namedLocalArtifact = (url.protocol === 'sandbox:' || url.protocol === 'blob:') && Boolean(filenameMime(visibleName));
      // A filename in a research/web citation is not proof that the model
      // created an output. Require an actual download/save affordance for web
      // links; a named sandbox/blob artifact is already a generated-file link.
      const sameOriginAction = explicitAction && ['http:', 'https:'].includes(url.protocol) && url.origin === new URL(win.location.href).origin;
      if (!hasDownload && !namedLocalArtifact && !(native && explicitAction) && !sameOriginAction) return null;
      // Download controls often say "Download corrected PDF" rather than the
      // exact filename. Use their captured, supported href basename instead.
      const candidate = [download, explicitAction ? pathName : visibleName, explicitAction ? actionFilename(element) : '', pathName, visibleName]
        .find((name) => filenameMime(name));
      if (!candidate) return null;
      const name = safeFilename(candidate, 'download.txt');
      return { href: url.href, name, mimeType: filenameMime(name), native };
    }

    const nativeCardIds = new WeakMap();
    let nextNativeCardId = 1;

    const nativeButtonIds = new WeakMap();
    let nextNativeButtonId = 1;
    function downloadableNamedButton(element, responseNode) {
      if (!visible(element) || element.disabled || element.getAttribute?.('aria-disabled') === 'true' ||
          !responseNode.contains?.(element) || outputCitation(element) ||
          (element.tagName !== 'BUTTON' && element.getAttribute?.('role') !== 'button') ||
          element.tagName === 'A' || (element.getAttribute?.('href') !== null && element.getAttribute?.('href') !== undefined) ||
          !DOWNLOAD_ACTION.test(label(element))) return null;
      const name = actionFilename(element);
      const mimeType = filenameMime(name);
      if (!mimeType) return null;
      let identity = nativeButtonIds.get(element);
      if (!identity) { identity = nextNativeButtonId++; nativeButtonIds.set(element, identity); }
      return { name, mimeType, href: `native-button:${identity}:${inlineGeneratedDownload(element) ? 'inline:' : ''}${name}`, native: true };
    }

    function downloadableCard(element, responseNode, supportedOnly = true) {
      if (!visible(element) || element.disabled || element.getAttribute?.('aria-disabled') === 'true' ||
          !/^download file$/i.test(String(element.getAttribute?.('aria-label') || '').trim()) ||
          !responseNode.contains?.(element) || outputCitation(element)) return null;
      const excluded = '[data-testid="chatgpt-library-file-citation"], [data-file-reference], [data-markdown-text-style="assistant-message"], .markdown, [data-testid="message-content"]';
      if (element.closest?.(excluded)) return null;
      for (let card = element.parentElement, depth = 0; card && card !== responseNode && depth < 8; card = card.parentElement, depth += 1) {
        if (!visible(card) || !responseNode.contains?.(card) || card.closest?.(excluded)) return null;
        const actions = allVisible('button[aria-label="Download file"]', card);
        if (actions.length !== 1 || actions[0] !== element) continue;
        const previews = allVisible('button[aria-label^="Open preview of "]', card)
          .filter((button) => !button.closest?.('[data-testid="chatgpt-library-file-citation"], [data-file-reference]'));
        if (previews.length !== 1) continue;
        const name = String(previews[0].getAttribute?.('aria-label') || '').slice('Open preview of '.length).trim();
        const mimeType = filenameMime(name);
        if ((supportedOnly && !mimeType) || !/^[^\\/\x00-\x1f]{1,180}$/.test(name) || safeFilename(name, '') !== name) return null;
        const titles = allVisible('[title]', card).filter((title) => String(title.getAttribute?.('title') || '') === name &&
          String(title.innerText ?? title.textContent ?? '').trim() === name);
        if (titles.length !== 1) continue;
        let identity = nativeCardIds.get(card);
        if (!identity) { identity = nextNativeCardId++; nativeCardIds.set(card, identity); }
        return { card, titleElement: titles[0], previewElement: previews[0], name, mimeType,
          href: `native-card:${identity}:${name}`, native: true };
      }
      return null;
    }

    function collectMedia(node) {
      const entries = [];
      const sources = new Set();
      for (const element of allVisible('img', node).filter(largeImage)) {
        const source = imageSource(element);
        if (!source || sources.has(`image:${source}`)) continue;
        sources.add(`image:${source}`);
        const name = `generated-image-${entries.length + 1}.png`;
        entries.push({ element, source, kind: 'image', name, mimeType: 'image/png',
          fingerprint: sourceFingerprint(`image:${source}:${element.naturalWidth}x${element.naturalHeight}`) });
        if (entries.length === 6) break;
      }
      if (entries.length < 6) {
        for (const element of allVisible('a', node)) {
          if (entries.some((entry) => entry.kind === 'image' && element.contains?.(entry.element))) continue;
          const link = downloadableAnchor(element);
          if (!link || sources.has(`file:${link.href}:${link.name}`)) continue;
          sources.add(`file:${link.href}:${link.name}`);
          entries.push({ element, source: link.href, kind: link.native ? 'native-file' : 'file', ...link, fingerprint: sourceFingerprint(`file:${link.href}:${link.name}`) });
          if (entries.length === 6) break;
        }
      }
      if (entries.length < 6) {
        for (const element of allVisible('button[aria-label="Download file"]', node)) {
          const card = downloadableCard(element, node);
          if (!card || sources.has(`file:${card.href}:${card.name}`)) continue;
          sources.add(`file:${card.href}:${card.name}`);
          entries.push({ element, source: card.href, kind: 'native-card', ...card,
            fingerprint: sourceFingerprint(`file:${card.href}:${card.name}`) });
          if (entries.length === 6) break;
        }
      }
      if (entries.length < 6) {
        for (const element of allVisible('button, [role="button"]', node)) {
          if (entries.some((entry) => entry.element === element)) continue;
          const button = downloadableNamedButton(element, node);
          if (!button) continue;
          entries.push({ element, source: button.href, kind: 'native-button', ...button,
            fingerprint: sourceFingerprint(`file:${button.href}:${button.name}`) });
          if (entries.length === 6) break;
        }
      }
      return entries.map((entry, index) => ({ ...entry, id: `media-${index + 1}` }));
    }

    function unsupportedGeneratedDownloads(node, entries, outputImages) {
      return [...new Set([...allVisible('a', node), ...allVisible('button, [role="button"]', node)])].filter((element) => {
        if (outputCitation(element) || entries.some((entry) => entry.element === element) ||
            outputImages.some((image) => element.contains?.(image))) return false;
        const name = label(element);
        if (element.tagName !== 'A') {
          // A real named native download action is a file affordance, unlike a
          // citation preview or filename mentioned in prose. Never click it if
          // its extension cannot be transferred safely.
          return DOWNLOAD_ACTION.test(name) && Boolean(actionFilename(element)) ||
            /^download file$/i.test(name) && Boolean(downloadableCard(element, node, false));
        }
        const download = element.getAttribute?.('download');
        if (download !== null && download !== undefined) return true;
        let url;
        try { url = new URL(String(element.href || element.getAttribute?.('href') || ''), win.location.href); }
        catch (_) { return false; }
        // Unknown sandbox/blob outputs must not silently disappear. Ordinary
        // external research links and arbitrary JavaScript actions remain data.
        const named = Boolean(actionFilename(element)) || /^[^\\/\x00-\x1f]{1,180}\.[a-z0-9]{1,15}$/i.test(name);
        if (['sandbox:', 'blob:'].includes(url.protocol)) return DOWNLOAD_ACTION.test(name) || named;
        const rawHref = String(element.getAttribute?.('href') || '');
        if ((rawHref.startsWith('#') || /^javascript:\s*(?:void\s*\(\s*0\s*\)\s*;?|;)$/i.test(url.href)) && DOWNLOAD_ACTION.test(name) && named) return true;
        return ['http:', 'https:'].includes(url.protocol) && url.origin === new URL(win.location.href).origin &&
          /^\/(?:files|downloads?)(?:\/|$)/i.test(url.pathname) && DOWNLOAD_ACTION.test(name);
      });
    }

    function storeMedia(task, node, entries) {
      const key = taskKey(task);
      mediaRecords.set(key, { node, entries, completed: false });
      if (mediaRecords.size > 40) {
        const oldest = mediaRecords.keys().next().value;
        mediaRecords.delete(oldest);
        for (const [snapshotKey, snapshot] of mediaSnapshots) {
          if (snapshot.taskKey === oldest) removeMediaSnapshot(snapshotKey);
        }
      }
      return entries.map(({ id, name, mimeType, fingerprint }) => ({ id, name, mimeType, fingerprint }));
    }

    function mediaSnapshotKey(message, entry) {
      return JSON.stringify([message.runId, message.requestId, entry.id, entry.name, entry.mimeType, entry.fingerprint]);
    }

    function removeMediaSnapshot(key) {
      const snapshot = mediaSnapshots.get(key);
      if (!snapshot) return;
      mediaSnapshotBytes -= snapshot.byteLength;
      mediaSnapshots.delete(key);
    }

    function clearMediaSnapshots() {
      mediaSnapshots.clear();
      mediaSnapshotBytes = 0;
      mediaSnapshotEpoch += 1;
    }

    function rememberMediaSnapshots(snapshots) {
      for (const snapshot of snapshots) {
        // The cap counts verified decoded bytes, matching the export limit.
        // Evict by first capture order; a repeated review does not extend it.
        removeMediaSnapshot(snapshot.key);
        while (mediaSnapshotBytes + snapshot.byteLength > MAX_TOTAL_BYTES && mediaSnapshots.size) {
          removeMediaSnapshot(mediaSnapshots.keys().next().value);
        }
        mediaSnapshots.set(snapshot.key, Object.freeze(snapshot));
        mediaSnapshotBytes += snapshot.byteLength;
      }
    }

    function snapshotFile(snapshot) {
      // Never expose the cached descriptor object to a response recipient.
      return { id: snapshot.id, name: snapshot.name, mimeType: snapshot.mimeType,
        fingerprint: snapshot.fingerprint, base64: snapshot.base64,
        contentSha256: snapshot.contentHash, byteLength: snapshot.byteLength };
    }

    function encodeBase64(bytes) {
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 32768) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
      }
      return win.btoa(binary);
    }

    async function exportMedia(message) {
      if (!validRequest(message) || !Array.isArray(message.ids) || message.ids.length < 1 || message.ids.length > 5 ||
          new Set(message.ids).size !== message.ids.length) return { ok: false, error: 'Choose one to five media IDs from a completed response.' };
      const record = mediaRecords.get(taskKey(message));
      const allowCancelled = message.allowCancelled === true && record?.completed === true;
      const runCancelled = () => cancelledRuns.has(message.runId) && !allowCancelled;
      if (runCancelled()) return { ok: false, error: 'This run was cancelled.' };
      if (message.allowCancelled === true && !allowCancelled) return { ok: false, error: 'Only a completed stored response can be saved after stopping.' };
      if (!record) return { ok: false, error: 'The completed media response is no longer available on this page.' };
      const entries = message.ids.map((id) => record.entries.find((entry) => entry.id === id));
      if (entries.some((entry) => !entry)) return { ok: false, error: 'A requested media item does not belong to this response.' };
      const snapshotEpoch = mediaSnapshotEpoch;
      const controller = new AbortController();
      mediaExports.set(controller, message.runId);
      // Native artifact actions can prepare a blob before Electron receives
      // will-download. Give each of the (at most five) sequential files its
      // broker deadline plus IPC/hash overhead; an earlier page abort would
      // release the broker and leave a late artifact at the default Save dialog.
      const timeout = setTimeout(() => controller.abort('Media export timed out.'), Math.max(30_000, entries.length * 50_000));
      const files = [];
      const verifiedSnapshots = [];
      let total = 0;
      const sameDownload = (entry) => {
        if (entry.kind === 'native-button') {
          const current = downloadableNamedButton(entry.element, record.node);
          return current && current.href === entry.source && current.name === entry.name && current.mimeType === entry.mimeType;
        }
        if (entry.kind === 'native-card') {
          const current = downloadableCard(entry.element, record.node);
          return current && current.card === entry.card && current.titleElement === entry.titleElement &&
            current.previewElement === entry.previewElement && current.href === entry.source &&
            current.name === entry.name && current.mimeType === entry.mimeType;
        }
        const current = downloadableAnchor(entry.element);
        return current && current.href === entry.source && current.name === entry.name && current.mimeType === entry.mimeType &&
          current.native === (entry.kind === 'native-file');
      };
      try {
        for (const entry of entries) {
          if (controller.signal.aborted || runCancelled()) throw new Error('Media export was cancelled or timed out.');
          const snapshotKey = mediaSnapshotKey(message, entry);
          const snapshot = mediaSnapshots.get(snapshotKey);
          if (snapshot) {
            total += snapshot.byteLength;
            if (total > MAX_TOTAL_BYTES) throw new Error('File limit is 12 MB each and 24 MB total; empty files cannot be relayed.');
            files.push(snapshotFile(snapshot));
            continue;
          }
          if (!visible(record.node)) throw new Error('The completed media response is no longer available on this page.');
          if (!visible(entry.element) || !record.node.contains?.(entry.element)) throw new Error('A media element is no longer in the completed response.');
          let bytes;
          let nativeSourceCapturedAtClick = false;
          if (entry.kind === 'image') {
            if (!largeImage(entry.element) || imageSource(entry.element) !== entry.source) throw new Error('The rendered image changed before export.');
            const canvas = doc.createElement('canvas');
            canvas.width = entry.element.naturalWidth;
            canvas.height = entry.element.naturalHeight;
            if (canvas.width * canvas.height > 25000000) throw new Error('The rendered image is too large to export safely.');
            const context = canvas.getContext('2d');
            if (!context) throw new Error('The browser could not export this image.');
            context.drawImage(entry.element, 0, 0);
            const data = canvas.toDataURL('image/png'); // May throw for a cross-origin image; no alternate URL is attempted.
            if (!data.startsWith('data:image/png;base64,')) throw new Error('The browser did not produce a PNG image.');
            bytes = decodeBase64(data.slice('data:image/png;base64,'.length));
          } else {
            if (!sameDownload(entry)) throw new Error('The download link changed before export.');
            if (entry.kind === 'native-file' || entry.kind === 'native-card' || entry.kind === 'native-button') {
              if (typeof env.downloadVisible !== 'function') throw new Error('This file uses a native download action. Open this task in the Converge desktop app to relay or save it.');
              if (entry.kind === 'native-card' || entry.kind === 'native-button') {
                // The site's resource-row controls become interactive on
                // group focus. Focus the captured action without previewing
                // the file or changing page styles, then verify it again.
                entry.element.focus?.({ preventScroll: true });
                if (!sameDownload(entry)) throw new Error('The download card changed before export.');
              }
              let abortNative;
              const aborted = new Promise((_resolve, reject) => {
                abortNative = () => reject(new Error(String(controller.signal.reason || 'Native download was cancelled.')));
                controller.signal.addEventListener('abort', abortNative, { once: true });
              });
              let downloaded;
              let sourceCheckedBeforeNativeClick = false;
              try {
                downloaded = await Promise.race([env.downloadVisible({ element: entry.element, runId: message.runId, requestId: message.requestId,
                  id: entry.id, name: entry.name, mimeType: entry.mimeType, signal: controller.signal,
                  isCurrent: () => {
                    sourceCheckedBeforeNativeClick = !controller.signal.aborted && !runCancelled() && visible(record.node) &&
                      visible(entry.element) && record.node.contains?.(entry.element) && !entry.element.disabled &&
                      entry.element.getAttribute?.('aria-disabled') !== 'true' && !!sameDownload(entry);
                    return sourceCheckedBeforeNativeClick;
                  } }), aborted]);
              } finally { controller.signal.removeEventListener('abort', abortNative); }
              if (!downloaded?.ok) throw new Error(downloaded?.error || 'The visible file download did not complete.');
              if (downloaded.mimeType !== entry.mimeType || typeof downloaded.base64 !== 'string' ||
                  downloaded.base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(downloaded.base64) ||
                  downloaded.base64.length > Math.ceil(MAX_FILE_BYTES / 3) * 4) throw new Error('The native download returned invalid or oversized file contents.');
              bytes = decodeBase64(downloaded.base64);
              // The isolated preload acknowledges only its one click after
              // revalidating this exact captured source. The native broker
              // then binds filename/type/bytes to that action. React may
              // consume/remount the busy action after the click; the reviewed
              // snapshot is the verified download, not its later DOM object.
              nativeSourceCapturedAtClick = downloaded.sourceVerifiedAtClick === true && sourceCheckedBeforeNativeClick === true;
              if (entry.kind === 'native-card' && !nativeSourceCapturedAtClick) {
                // The native download may finish before React clears the
                // captured button's busy/disabled state. Wait for that same
                // card and controls; do not substitute a different card.
                const settleDeadline = now() + 2000;
                while (!sameDownload(entry) && now() < settleDeadline &&
                    visible(record.node) && record.node.contains?.(entry.element) &&
                    !controller.signal.aborted && !runCancelled()) {
                  await new Promise((resolve) => setTimeout(resolve, 50));
                }
              }
            } else {
            if (typeof win.fetch !== 'function') throw new Error('This browser cannot export download links.');
            const response = await win.fetch(entry.source, { credentials: 'same-origin', signal: controller.signal, redirect: 'error' });
            if (!response.ok || response.type === 'opaque') throw new Error('The visible download link was unavailable or blocked by the browser.');
            const contentLength = Number(response.headers?.get?.('content-length'));
            if (contentLength > MAX_FILE_BYTES) throw new Error('The download exceeds the 12 MB file limit.');
            const contentType = String(response.headers?.get?.('content-type') || '').split(';')[0].trim().toLowerCase();
            if (contentType && contentType !== entry.mimeType &&
                !(entry.mimeType === 'application/zip' && contentType === 'application/x-zip-compressed') &&
                !(contentType === 'application/zip' && entry.mimeType.includes('openxmlformats')) &&
                !(contentType === 'text/x-python' && entry.mimeType === 'text/plain' && /\.py$/i.test(entry.name)) &&
                !['application/octet-stream', 'binary/octet-stream'].includes(contentType)) {
              throw new Error('The visible download returned an unexpected file type.');
            }
            if (!response.body?.getReader) throw new Error('The browser cannot read this download safely.');
            const reader = response.body.getReader();
            const chunks = [];
            let size = 0;
            while (true) {
              const { value, done } = await reader.read();
              if (done) break;
              if (controller.signal.aborted || runCancelled()) { await reader.cancel(); throw new Error('Media export was cancelled or timed out.'); }
              size += value.byteLength;
              if (size > MAX_FILE_BYTES || total + size > MAX_TOTAL_BYTES) { await reader.cancel(); throw new Error('File limit is 12 MB each and 24 MB total.'); }
              chunks.push(value);
            }
            bytes = new Uint8Array(size);
            let offset = 0;
            for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
            }
          }
          total += bytes.byteLength;
          if (!bytes.byteLength || bytes.byteLength > MAX_FILE_BYTES || total > MAX_TOTAL_BYTES) throw new Error('File limit is 12 MB each and 24 MB total; empty files cannot be relayed.');
          validateZipArchive(entry.name, entry.mimeType, bytes);
          validateSettingsFile(entry.name, entry.mimeType, bytes);
          validateReadableSource(entry.name, entry.mimeType, bytes);
          if (runCancelled()) throw new Error('This run was cancelled.');
          if (!nativeSourceCapturedAtClick && (!visible(record.node) || !visible(entry.element) || !record.node.contains?.(entry.element) ||
              (entry.kind === 'image' ? imageSource(entry.element) !== entry.source : !sameDownload(entry)))) {
            throw new Error(`The source media changed while exporting (response visible: ${visible(record.node)}, control visible: ${visible(entry.element)}, control in response: ${!!record.node.contains?.(entry.element)}, same output: ${entry.kind === 'image' ? imageSource(entry.element) === entry.source : !!sameDownload(entry)}).`);
          }
          const subtle = win.crypto?.subtle || globalThis.crypto?.subtle;
          if (!subtle) throw new Error('This browser cannot verify generated file contents safely.');
          const digest = new Uint8Array(await subtle.digest('SHA-256', bytes));
          const contentHash = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
          if (entry.contentHash && entry.contentHash !== contentHash) throw new Error('The generated file contents changed after their first export. Start a new run.');
          entry.contentHash = contentHash;
          if (controller.signal.aborted || runCancelled()) throw new Error('Media export was cancelled or timed out.');
          const base64 = encodeBase64(bytes);
          files.push({ id: entry.id, name: entry.name, mimeType: entry.mimeType, fingerprint: entry.fingerprint, base64,
            contentSha256: contentHash, byteLength: bytes.byteLength });
          verifiedSnapshots.push({ key: snapshotKey, taskKey: taskKey(message), id: entry.id, name: entry.name,
            mimeType: entry.mimeType, fingerprint: entry.fingerprint, base64, byteLength: bytes.byteLength, contentHash });
        }
        if (controller.signal.aborted || runCancelled()) throw new Error('Media export was cancelled or timed out.');
        // Publish only a complete successful export. A canceled/partial export
        // cannot seed a later review, nor can an old export repopulate a new run.
        if (snapshotEpoch === mediaSnapshotEpoch &&
            (mediaSnapshotRunId === null || mediaSnapshotRunId === message.runId)) {
          rememberMediaSnapshots(verifiedSnapshots);
        }
        return { ok: true, files };
      } catch (error) {
        return { ok: false, error: `Generated media could not be exported: ${error.message || 'The browser blocked this file.'}` };
      } finally { clearTimeout(timeout); mediaExports.delete(controller); }
    }

    function remember(key, state) {
      recent.set(key, state);
      if (recent.size > 40) recent.delete(recent.keys().next().value);
    }

    function taskKey(message) {
      return `${message.runId}\u0000${message.requestId}`;
    }

    function waitFor(check, timeoutMs, task) {
      return new Promise((resolve, reject) => {
        let done = false;
        let observer;
        let interval;
        let timeout;
        function cleanup() {
          if (observer) observer.disconnect();
          clearInterval(interval);
          clearTimeout(timeout);
          task.controller.signal.removeEventListener('abort', abort);
        }
        function finish(error, value) {
          if (done) return;
          done = true;
          cleanup();
          if (error) reject(error);
          else resolve(value);
        }
        function abort() {
          finish(new Error(String(task.controller.signal.reason || 'Cancelled.')));
        }
        function evaluate() {
          if (done) return;
          try {
            const result = check();
            if (result) finish(null, result);
          } catch (error) {
            finish(error);
          }
        }
        task.controller.signal.addEventListener('abort', abort, { once: true });
        if (task.controller.signal.aborted) return abort();
        interval = setInterval(evaluate, tickMs);
        timeout = setTimeout(() => finish(new Error('Timed out waiting for the ChatGPT page.')), timeoutMs);
        if (win.MutationObserver && doc.body) {
          observer = new win.MutationObserver(evaluate);
          observer.observe(doc.body, { subtree: true, childList: true, characterData: true, attributes: true });
        }
        evaluate();
      });
    }

    function fillComposer(composer, text) {
      if (composerText(composer).trim()) throw new Error('The composer already contains a draft. Clear it before starting.');
      composer.focus();
      if (composer.tagName === 'TEXTAREA') {
        const descriptor = Object.getOwnPropertyDescriptor(win.HTMLTextAreaElement.prototype, 'value');
        if (!descriptor?.set) throw new Error('Cannot write to this text box.');
        descriptor.set.call(composer, text);
        composer.dispatchEvent(new win.InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      } else {
        const selection = win.getSelection?.();
        const range = doc.createRange?.();
        if (!selection || !range || !doc.execCommand) throw new Error('This editor is not supported by the page bridge.');
        range.selectNodeContents(composer);
        selection.removeAllRanges();
        selection.addRange(range);
        const inserted = doc.execCommand('insertText', false, text);
        selection.removeAllRanges();
        if (!inserted) throw new Error('The page rejected text insertion.');
      }
      if (!containsFullPrompt(composer, text)) {
        throw new Error('The composer did not receive the full prompt.');
      }
    }

    async function waitForStage(check, timeoutMs, task, timeoutMessage) {
      try { return await waitFor(check, timeoutMs, task); }
      catch (error) {
        if (error.message === 'Timed out waiting for the ChatGPT page.') {
          throw new Error(typeof timeoutMessage === 'function' ? timeoutMessage() : timeoutMessage);
        }
        throw error;
      }
    }

    async function emit(message) {
      try {
        const result = runtime.sendMessage(message);
        if (result && typeof result.then === 'function') await result;
      } catch (_) { /* Background may have gone away; the page is still usable. */ }
    }

    function navigationValid(task) {
      const current = win.location.href;
      if (current === task.url || current === task.acceptedUrl) return true;
      const original = new URL(task.acceptedUrl || task.url);
      const destination = new URL(current);
      if (original.origin !== destination.origin) return false;
      // Search/hash changes do not change the conversation identity. A new
      // chat can acquire its /c/ URL after its own user turn is confirmed.
      if (original.pathname === destination.pathname) return true;
      const isLocalChat = (path) => /^\/c\/local-chatgpt(?::|%3a)[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\/?$/i.test(path);
      const isStoredChat = /^\/c\/[\w-]+\/?$/.test(destination.pathname);
      const users = getTurns(USER_SELECTOR);
      const ownsFreshTurn = Boolean(task.submittedUser && users.length === task.baselineUserCount + 1 &&
        userMessageMatches(users.at(-1), task.text, task.requestId));
      if (!task.acceptedUrl && ownsFreshTurn && original.pathname === '/' && isStoredChat) {
        task.acceptedUrl = current;
        return true;
      }
      // Current ChatGPT first routes a new submission through a client-local
      // UUID, then replaces it with the server conversation UUID. Associate
      // that one-way promotion only with the newly submitted owned turn.
      if (!task.acceptedUrl && ownsFreshTurn && task.baselineUserCount === 0 &&
          original.pathname === '/' && isLocalChat(destination.pathname)) {
        task.acceptedLocalPath = destination.pathname;
        task.acceptedUrl = current;
        return true;
      }
      if (ownsFreshTurn && task.baselineUserCount === 0 && isLocalChat(original.pathname) && isStoredChat &&
          (task.acceptedLocalPath === original.pathname || (!task.acceptedUrl && isLocalChat(new URL(task.url).pathname)))) {
        task.acceptedLocalPath = original.pathname;
        task.acceptedUrl = current;
        return true;
      }
      return false;
    }

    function ownedGenerationFailure(lastUser) {
      // The current page puts a failed image tool and its retry button beside
      // the submitted user bubble, without creating an assistant message.
      // Only inspect that bubble's smallest containing turn. Never interpret
      // an error or retry button from an earlier conversation turn as ours.
      for (let scope = lastUser, depth = 0; scope && scope !== doc.body && depth < 8; scope = scope.parentElement, depth += 1) {
        const users = allVisible(USER_SELECTOR, scope);
        if (users.some((user) => user !== lastUser && !lastUser.contains?.(user))) return false;
        const retry = allVisible('button', scope).filter((button) =>
          /^Try again$/i.test(label(button).trim()) &&
          /^Image generation failed\s*Try again$/i.test(String(button.parentElement?.innerText || '').trim()));
        if (retry.length === 1) return true;
        if (retry.length > 1) return false;
      }
      return false;
    }

    const PROVIDER_REJECTION_SELECTOR = '[role="alert"], [data-testid*="error"], [data-state="error"], div, span, p';
    function providerRejectionKind(value) {
      const text = String(value || '').replace(/\s+/g, ' ').trim();
      if (/^(?:the message you submitted was too long,?\s*please edit it and resubmit\.?|(?:your|the) message is too long\.?\s*(?:please (?:edit|shorten).{0,80})?)$/i.test(text)) return 'too-long';
      if (/^(?:there was an error generating (?:a|the) response\.?|an error occurred while generating (?:a|the) response\.?)(?:\s*(?:please )?try again\.?)?$/i.test(text)) return 'generation-error';
      return '';
    }

    function ownedProviderRejection(lastUser, task) {
      // Provider rejection can leave Stop/streaming markers visible forever.
      // Match the new error beside this exact submitted user turn before
      // consulting generationBusy. Prompt text, code and old turns are data.
      const failureFor = (element, globalAlert = false) => {
        if (element === lastUser || lastUser.contains?.(element) || element.contains?.(lastUser) ||
            element.closest?.('pre, code, [data-markdown-copy="code-block"]')) return '';
        const value = String(element.innerText ?? element.textContent ?? '').replace(/\s+/g, ' ').trim();
        if (!value || value.length > 300 || task.baselineProviderRejections?.get(element) === value) return '';
        const kind = providerRejectionKind(value);
        if (!kind) return '';
        const assistant = element.closest?.(ASSISTANT_SELECTOR);
        const explicitError = element.getAttribute?.('role') === 'alert' ||
          /error/i.test(element.getAttribute?.('data-testid') || '') || element.getAttribute?.('data-state') === 'error' ||
          Boolean(element.closest?.('[role="alert"], [data-testid*="error"], [data-state="error"]'));
        if (assistant && (!explicitError || globalAlert)) return '';
        if (globalAlert && (!explicitError || element.closest?.(USER_SELECTOR))) return '';
        if (kind === 'too-long') return 'ChatGPT rejected this submitted message because it was too long. The automatic exchange has stopped. Use a shorter review payload or fewer/smaller source files before starting a new run. The submitted chat was kept; no second submission was attempted.';
        if (kind === 'generation-error' && explicitError) return 'ChatGPT reported an error generating the response to this submitted request. The automatic exchange has stopped. Inspect the provider error in this chat and start a new run when it is resolved. The submitted chat was kept; no automatic retry was attempted.';
        return '';
      };
      for (let scope = lastUser, depth = 0; scope && scope !== doc.body && depth < 8; scope = scope.parentElement, depth += 1) {
        const users = allVisible(USER_SELECTOR, scope);
        if (users.some(user => user !== lastUser && !lastUser.contains?.(user))) break;
        for (const element of allVisible(PROVIDER_REJECTION_SELECTOR, scope)) {
          const failure = failureFor(element);
          if (failure) return failure;
        }
      }
      // A provider can mount the rejection in a fresh alert outside all turn
      // wrappers. It still belongs to the newest confirmed request: navigation
      // and exact user identity were checked above, and preexisting alerts and
      // any text inside earlier/user/assistant messages remain excluded.
      for (const element of allVisible(PROVIDER_REJECTION_SELECTOR)) {
        const failure = failureFor(element, true);
        if (failure) return failure;
      }
      return '';
    }

    async function observeReply(task, baseline, submittedUserCount) {
      let candidateNode = null;
      let candidateText = '';
      let candidateSignature = '';
      let changedAt = 0;
      return waitFor(() => {
        if (!navigationValid(task)) throw new Error('The chat navigated before the reply completed.');
        const users = getTurns(USER_SELECTOR);
        // The current renderer unmounts old history while adding a turn, then
        // can remount it later. Counts are only a fallback for legacy prompts
        // without a unique marker; a tracked run owns the newest marked turn.
        if (!task.trackingMarker && users.length > submittedUserCount) throw new Error('A new user message appeared while the relay was waiting.');
        const ordered = getTurns(`${USER_SELECTOR}, ${ASSISTANT_SELECTOR}`);
        const lastUser = users[users.length - 1];
        if (!sameUserText(lastUser, task.text, task.requestId)) {
          // A hydration replacement can be collapsed again. Let only that
          // newest turn finish its Show more render before deciding it changed.
          if (lastUser && expandingUserTurns.has(lastUser)) {
            task.userMatchDeadline ||= now() + 2000;
            if (now() < task.userMatchDeadline) return null;
          }
          throw new Error('The submitted user message changed or a different chat appeared.');
        }
        task.userMatchDeadline = null;
        // React can replace the user message DOM node while preserving the
        // exact request. Reacquire it by content/marker, never object identity.
        task.submittedUser = lastUser;
        const rejection = ownedProviderRejection(lastUser, task);
        if (rejection) throw new Error(rejection);
        const lastUserIndex = ordered.indexOf(lastUser);
        if (lastUserIndex < 0) return null;
        const fresh = ordered.slice(lastUserIndex + 1).filter((element) => element.matches?.(ASSISTANT_SELECTOR)).filter((element) => {
          const oldText = baseline.get(element);
          return oldText === undefined || assistantText(element) !== oldText;
        });
        if (fresh.length === 0) {
          if (!generationBusy() && ownedGenerationFailure(lastUser)) {
            throw new Error('ChatGPT reported "Image generation failed" for this request. No image was produced or relayed. Try the command again when image generation is available.');
          }
          return null;
        }
        const node = fresh[fresh.length - 1];
        const value = assistantText(node);
        const outputImages = allVisible('img', node).filter(outputImageCandidate);
        const pendingImages = outputImages.some((image) => image.complete === false);
        if (pendingImages) return null;
        const brokenImages = outputImages.some((image) => image.complete !== false && (Number(image.naturalWidth) < 64 || Number(image.naturalHeight) < 64));
        const entries = collectMedia(node);
        const unsupportedDownloads = unsupportedGeneratedDownloads(node, entries, outputImages);
        if (!value && entries.length === 0 && !unsupportedDownloads.length && !brokenImages) return null;
        if (value.length > MAX_REPLY_CHARS) throw new Error('The reply is too large to relay safely.');
        const signature = entries.map((entry) => entry.fingerprint).join('|');
        if (candidateNode !== node || candidateText !== value || candidateSignature !== signature) {
          candidateNode = node;
          candidateText = value;
          candidateSignature = signature;
          changedAt = now();
          return null;
        }
        if (generationBusy() || now() - changedAt < settleMs) return null;
        if (brokenImages && (task.relayMedia || !value)) throw new Error('A generated image did not load at a usable resolution. It cannot be relayed.');
        if (task.relayMedia && entries.length > 5) throw new Error('This response contains more than five generated media files. Start a new run requesting at most five.');
        if (task.relayMedia && unsupportedDownloads.length) throw new Error(`This response contains an unsupported generated download that cannot be shared safely: ${unsupportedDownloads.map((element) => label(element).slice(0, 180)).join(', ')}. Request a supported document/image or a plain-text source file (.txt, .mq5, .mqh, or another supported source extension), then start a new run. No unsupported file was transferred.`);
        if (!value && !task.relayMedia) throw new Error('This response contains generated media without text. Enable generated media relay before starting a new run.');
        return { text: value, media: task.relayMedia ? storeMedia(task, node, entries) : [] };
      }, task.timeoutMs, task);
    }

    function stopOwnedGeneration(task) {
      // A changed page or a newer human message must keep its own Stop control.
      const lastUser = getTurns(USER_SELECTOR).at(-1);
      if (!task.submittedUser || !sameUserText(lastUser, task.text, task.requestId) || !navigationValid(task)) return;
      task.submittedUser = lastUser;
      const controls = generationStopControls();
      if (controls.length === 1 && !controls[0].disabled) controls[0].click();
    }

    function validRequest(message) {
      return typeof message.runId === 'string' && message.runId.length > 0 && message.runId.length <= 200 &&
        typeof message.requestId === 'string' && message.requestId.length > 0 && message.requestId.length <= 200;
    }

    async function sendPrompt(message) {
      if (!validRequest(message)) return { ok: false, error: 'Missing or invalid request identity.' };
      if (cancelledRuns.has(message.runId)) return { ok: false, error: 'This run was cancelled; a late prompt will not be sent.' };
      const key = taskKey(message);
      if (active && taskKey(active) === key) return { ok: true, pending: true };
      if (recent.has(key)) return { ok: false, error: 'This request was already handled; it will not be submitted twice.' };
      if (active) return { ok: false, error: 'This chat is already handling a request.' };
      if (typeof message.text !== 'string' || !message.text.trim() || message.text.length > MAX_PROMPT_CHARS) {
        return { ok: false, error: 'Prompt must be nonempty and at most 200,000 characters.' };
      }
      const status = inspect();
      if (!status.ready) return { ok: false, error: status.reason || 'This chat is not ready.' };
      let composer = findComposer();
      if (!composer) return { ok: false, error: 'The chat composer changed.' };
      const task = {
        runId: message.runId,
        requestId: message.requestId,
        controller: new AbortController(),
        url: win.location.href,
        acceptedUrl: null,
        acceptedLocalPath: null,
        submittedUser: null,
        text: message.text,
        relayMedia: message.relayMedia === true,
        timeoutMs: Math.min(Math.max(Number(message.timeoutMs) || replyTimeoutMs, 15000), 30 * 60 * 1000)
      };
      const baseline = new Map(getTurns(ASSISTANT_SELECTOR).map((element) => [element, assistantText(element)]));
      const baselineUsers = getTurns(USER_SELECTOR);
      task.baselineProviderRejections = new Map(allVisible(PROVIDER_REJECTION_SELECTOR).map(element =>
        [element, String(element.innerText ?? element.textContent ?? '').replace(/\s+/g, ' ').trim()]));
      const userCount = baselineUsers.length;
      task.trackingMarker = trackingMarker(task.text, task.requestId);
      if (task.trackingMarker && baselineUsers.some((element) => userMessageMatches(element, task.text, task.requestId))) {
        return { ok: false, error: 'This tracking ID already appears in the chat. The same prompt will not be submitted again.' };
      }
      task.baselineLatestUserValues = userTextValues(baselineUsers.at(-1));
      task.baselineUserCount = userCount;
      recordSubmissionDiagnostic(task, 'before-fill');
      active = task;
      if (mediaSnapshotRunId !== task.runId) {
        clearMediaSnapshots();
        mediaSnapshotRunId = task.runId;
      }
      try {
        if (message.files?.length) {
          const upload = await uploadFiles(message, task);
          if (!upload.ok) throw new Error(upload.error);
        }
        if (task.controller.signal.aborted || cancelledRuns.has(task.runId)) throw new Error('Cancelled by user.');
        composer = findComposer();
        if (!composer) throw new Error('The attachment upload changed the chat composer.');
        if (message.expectedSourceNames !== undefined && !hasExpectedSources(composer, message.expectedSourceNames)) {
          throw new Error('An expected source document is no longer attached. Verify every required attachment in this chat before starting.');
        }
        fillComposer(composer, message.text);
        let stableComposer = null;
        let stableButton = null;
        let controlsChangedAt = 0;
        const controls = await waitForStage(() => {
          if (!navigationValid(task)) throw new Error('The chat navigated before submitting the prompt.');
          const users = getTurns(USER_SELECTOR);
          if (task.trackingMarker ? !sameBaselineUser(users.at(-1), task) : users.length !== userCount) {
            throw new Error('A user message appeared before the automatic prompt was submitted.');
          }
          const currentComposer = findComposer();
          const button = currentComposer && findSendButton(currentComposer);
          if (!currentComposer || !containsFullPrompt(currentComposer, task.text) || !button || button.disabled || !visible(button) || generationBusy()) {
            stableComposer = stableButton = null;
            return null;
          }
          // React can replace the composer or enable Send before committing
          // its final editor state. Reacquire both controls and let them settle
          // before one submission; never retry a possibly submitted prompt.
          if (currentComposer !== stableComposer || button !== stableButton) {
            stableComposer = currentComposer; stableButton = button; controlsChangedAt = now();
            return null;
          }
          return now() - controlsChangedAt >= sendSettleMs ? { composer: currentComposer, button } : null;
        }, 8000, task, 'No enabled, stable Send control appeared after entering the full prompt.');
        composer = controls.composer;
        controls.button.click();
        recordSubmissionDiagnostic(task, 'clicked-send');
        await waitForStage(() => {
          const users = getTurns(USER_SELECTOR);
          const submitted = users.at(-1);
          if (!task.trackingMarker && users.length <= userCount) return null;
          if (task.trackingMarker && (!submitted || sameBaselineUser(submitted, task))) return null;
          if (!sameUserText(submitted, message.text, task.requestId)) {
            if (submitted && expandingUserTurns.has(submitted)) return null;
            throw new Error('A different user message appeared while submitting the prompt.');
          }
          task.submittedUser = submitted;
          recordSubmissionDiagnostic(task, 'submitted-turn-confirmed');
          if (!navigationValid(task)) throw new Error('The chat navigated while submitting the prompt.');
          return true;
        }, 15000, task, () => `The page did not confirm the submitted prompt. ${containsFullPrompt(findComposer(), task.text) ? 'The full prompt is still in the composer.' : 'The composer changed or cleared.'} No second submission was attempted.`);
      } catch (error) {
        recordSubmissionDiagnostic(task, 'submission-error');
        stopOwnedGeneration(task);
        if (active === task) active = null;
        remember(key, 'failed');
        if (!task.controller.signal.aborted) await emit({ type: 'ERROR', runId: task.runId, requestId: task.requestId, error: error.message });
        return { ok: false, error: error.message };
      }
      observeReply(task, baseline, getTurns(USER_SELECTOR).length).then(async (result) => {
        if (active !== task || task.controller.signal.aborted) return;
        active = null;
        recordSubmissionDiagnostic(task, 'reply-complete');
        remember(key, 'complete');
        const completedMedia = mediaRecords.get(key);
        if (completedMedia) completedMedia.completed = true;
        await emit({ type: 'REPLY', runId: task.runId, requestId: task.requestId, ...result });
        publishStatus();
      }).catch(async (error) => {
        if (active !== task || task.controller.signal.aborted) return;
        stopOwnedGeneration(task);
        recordSubmissionDiagnostic(task, 'reply-error');
        active = null;
        remember(key, 'failed');
        await emit({ type: 'ERROR', runId: task.runId, requestId: task.requestId, error: error.message });
        publishStatus();
      });
      return { ok: true };
    }

    function cancel(message) {
      if (typeof message.runId === 'string' && message.runId) {
        cancelledRuns.add(message.runId);
        if (cancelledRuns.size > 100) cancelledRuns.delete(cancelledRuns.values().next().value);
      }
      if (activeAttachment && (!message.runId || !activeAttachment.runId || message.runId === activeAttachment.runId)) {
        activeAttachment.controller.abort('Cancelled by user.');
      }
      for (const [controller, runId] of mediaExports) {
        if (!message.runId || message.runId === runId) controller.abort('Cancelled by user.');
      }
      if (!active || (message.runId && message.runId !== active.runId)) return { ok: true, cancelled: false };
      const task = active;
      active = null;
      remember(taskKey(task), 'cancelled');
      task.controller.abort('Cancelled by user.');
      if (message.stopGeneration !== false) stopOwnedGeneration(task);
      publishStatus();
      return { ok: true, cancelled: true };
    }

    function oneChoice(namePattern, predicate) {
      const controls = allVisible('button, a, [role="button"], [role="radio"], [role="menuitemradio"], [role="option"], [role="tab"]')
        .filter((element) => namePattern.test(label(element)) && predicate(element));
      return controls.length === 1 ? controls[0] : null;
    }

    function temporaryToggleOff() {
      return oneChoice(/^temporary(?: chat)?$/i, (element) =>
        (choiceState(element) === false || (choiceState(element) === null && /^temporary chat$/i.test(label(element)) && privacyState().temporary === false)) &&
        !element.closest?.('[role="menu"], [role="dialog"], [role="listbox"]') &&
        Boolean(element.closest?.('header, [role="banner"]')) &&
        (element.tagName === 'BUTTON' || element.getAttribute?.('role') === 'button'));
    }

    function unpersonalizedOption() {
      return oneChoice(/^unpersonalized$/i, (element) => {
        if (choiceState(element) === true) return false;
        const role = element.getAttribute?.('role');
        return Boolean(element.closest?.('[role="dialog"], [role="menu"], [role="listbox"]')) ||
          role === 'radio' || role === 'menuitemradio' || role === 'option';
      });
    }

    function personalizedMenuButton() {
      return oneChoice(/^personalized$/i, (element) =>
        element.tagName === 'BUTTON' &&
        !element.closest?.('[role="menu"], [role="dialog"], [role="listbox"]') &&
        ((choiceState(element) === true && Boolean(element.closest?.('header, [role="banner"]')) &&
          /^(menu|dialog|listbox)$/i.test(String(element.getAttribute?.('aria-haspopup') || ''))) ||
          (Boolean(element.closest?.('main, [role="main"]')) && privacyState().temporary === true && privacyState().unpersonalized === false)));
    }

    function normalToggle() {
      return oneChoice(/^turn off temporary chat$/i, (element) =>
        !element.closest?.('[role="menu"], [role="dialog"], [role="listbox"]') &&
        Boolean(element.closest?.('header, [role="banner"]')) && privacyState().temporary === true);
    }

    function workOption() {
      return oneChoice(/^(work|work mode|switch to work)$/i, (element) => {
        if (choiceState(element) === true || workRequiresUpgrade(element) || element.closest?.(TURN_SELECTOR)) return false;
        if (element.tagName === 'A') {
          try { if (new URL(element.href || element.getAttribute?.('href'), win.location.href).origin !== new URL(win.location.href).origin) return false; }
          catch (_) { return false; }
        }
        return choiceState(element) === false || Boolean(element.closest?.('header, [role="banner"], main, [role="main"], [role="menu"], [role="dialog"], [role="listbox"]'));
      });
    }

    function chatOption() {
      return oneChoice(/^(chat|chat mode|switch to chat)$/i, (element) => {
        if (choiceState(element) === true || element.closest?.('[data-message-author-role], article[data-testid^="conversation-turn"]')) return false;
        if (element.tagName === 'A') {
          try { if (new URL(element.href || element.getAttribute?.('href'), win.location.href).origin !== new URL(win.location.href).origin) return false; }
          catch (_) { return false; }
        }
        return choiceState(element) === false || Boolean(element.closest?.('header, [role="banner"], main, [role="main"], [role="menu"], [role="dialog"], [role="listbox"]'));
      });
    }

    async function leaveWork(preparation) {
      if (workState() !== true) return;
      if (!chatOption()) {
        const menu = oneChoice(/^(work|work mode)$/i, (element) =>
          /^(menu|dialog|listbox)$/i.test(String(element.getAttribute?.('aria-haspopup') || '')) &&
          Boolean(element.closest?.('header, [role="banner"], main, [role="main"]')) &&
          !element.closest?.('[role="menu"], [role="dialog"], [role="listbox"]'));
        if (menu) { menu.click(); try { await waitFor(chatOption, setupTimeoutMs, preparation); } catch (_) { } }
      }
      const option = chatOption();
      if (option) { option.click(); try { await waitFor(() => workState() === false, setupTimeoutMs, preparation); } catch (_) { } }
    }

    async function prepareWork(preparation) {
      if (workAccessReason()) return;
      if (workState() === true) return;
      if (!workOption()) {
        // A current Chat dropdown may contain the Work choice. Open only an
        // explicitly labelled mode menu, never account or workspace settings.
        const menu = oneChoice(/^(chat|chat mode)$/i, (element) =>
          /^(menu|dialog|listbox)$/i.test(String(element.getAttribute?.('aria-haspopup') || '')) &&
          Boolean(element.closest?.('header, [role="banner"], main, [role="main"]')) &&
          !element.closest?.('[role="menu"], [role="dialog"], [role="listbox"]'));
        if (menu) { menu.click(); try { await waitFor(workOption, setupTimeoutMs, preparation); } catch (_) { } }
      }
      const option = workOption();
      if (!option) return;
      option.click();
      try { await waitFor(() => workState() === true, setupTimeoutMs, preparation); } catch (_) { /* No mode claim without selected-page evidence. */ }
    }

    async function prepareOnce() {
      // React can render its composer after the document finishes loading.
      // Wait briefly before deciding that this page cannot be prepared.
      const preparation = { controller: new AbortController() };
      if (chatMode !== 'work' && workState() === true && !active && !generationBusy() &&
          !composerText(findComposer()).trim() && !getTurns(USER_SELECTOR).length && !getTurns(ASSISTANT_SELECTOR).length) {
        await leaveWork(preparation);
      }
      if (!findComposer()) {
        try {
          await waitFor(() => findComposer() || allVisible('button, a').some((element) => /^(log in|sign in)$/i.test(label(element))), setupTimeoutMs, preparation);
        } catch (_) { /* The final inspection reports the missing composer. */ }
      }
      // Privacy choice cannot be changed after the first message. Active or
      // ambiguous toggles must never be clicked during preparation.
      const composer = findComposer();
      if (!composer || active || generationBusy() || composerText(composer).trim() ||
          getTurns(USER_SELECTOR).length || getTurns(ASSISTANT_SELECTOR).length) {
        const status = inspect();
        publishStatus();
        return status;
      }
      if (chatMode === 'normal' || chatMode === 'work') {
        const toggle = normalToggle();
        if (toggle) { toggle.click(); try { await waitFor(() => privacyState().temporary !== true, setupTimeoutMs, preparation); } catch (_) { } }
        if (chatMode === 'work') await prepareWork(preparation);
        const status = inspect(); publishStatus(); return status;
      }
      let privacy = privacyState();
      // The composer can hydrate before the header action. Give React a
      // bounded chance to expose that control on a newly opened page.
      if (privacy.temporary === null) {
        try {
          await waitFor(() => privacyState().temporary !== null || temporaryToggleOff(), setupTimeoutMs, preparation);
        } catch (_) { /* Ambiguous or unavailable controls remain unknown. */ }
        privacy = privacyState();
      }
      if (privacy.temporary === false) {
        const toggle = temporaryToggleOff();
        if (toggle) {
          toggle.click();
          try {
            await waitFor(() => privacyState().temporary === true || unpersonalizedOption(), setupTimeoutMs, preparation);
          } catch (_) { /* The final inspection explains what remains unknown. */ }
        }
      }
      privacy = privacyState();
      if (!requireUnpersonalized) {
        const status = inspect(); publishStatus(); return status;
      }
      // The header can switch to Turn off before React renders the main
      // privacy dropdown. Wait for that current choice instead of returning
      // an unknown mode immediately after a successful Temporary click.
      if (privacy.temporary === true && privacy.unpersonalized === null) {
        try {
          await waitFor(() => privacyState().unpersonalized !== null || unpersonalizedOption(), setupTimeoutMs, preparation);
        } catch (_) { /* The final inspection reports a still-unknown mode. */ }
        privacy = privacyState();
      }
      if (privacy.temporary === true && privacy.unpersonalized === false && !unpersonalizedOption()) {
        const menu = personalizedMenuButton();
        if (menu) {
          menu.click();
          try { await waitFor(() => unpersonalizedOption(), setupTimeoutMs, preparation); }
          catch (_) { /* The final inspection explains what remains unknown. */ }
        }
      }
      // A visible menu/radio choice is safe to select before the first message.
      // A bare button elsewhere on the page is not enough evidence.
      const option = unpersonalizedOption();
      if (option && privacyState().temporary === true) {
        option.click();
        try {
          await waitFor(() => privacyState().temporary === true && privacyState().unpersonalized === true, setupTimeoutMs, preparation);
        } catch (_) { /* Unknown controls stay unknown; no prompt is sent here. */ }
      }
      const status = inspect();
      publishStatus();
      return status;
    }

    function prepare() {
      if (prepareInFlight) return prepareInFlight;
      prepareInFlight = prepareOnce().finally(() => { prepareInFlight = null; });
      return prepareInFlight;
    }

    function decodeBase64(base64) {
      const binary = win.atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      return bytes;
    }

    function currentAttachmentScope(composer = findComposer()) {
      const form = composerScope(composer);
      if (!form) return null;
      return form.parentElement?.querySelectorAll?.(TURN_SELECTOR)?.length ? form : (form.parentElement || form);
    }

    function attachmentFailure(scope) {
      if (!scope) return '';
      const composer = findComposer();
      // Failed file widgets expose ordinary text such as "Upload failed";
      // they do not consistently carry an alert role or upload-state marker.
      // Stay within the active composer so earlier conversation failures and
      // unrelated page banners cannot reject this attachment batch.
      const failure = allVisible('[role="alert"], [data-upload-state="error"], [data-state="error"], [data-testid*="upload-error"], div, span, p', scope)
        .filter((element) => !element.closest?.(TURN_SELECTOR) && element !== composer &&
          !element.contains?.(composer) && !composer?.contains?.(element))
        .find((element) => {
          if (element.getAttribute?.('data-upload-state') === 'error') return true;
          const value = label(element);
          // An ordinary file name can contain "file errors". A plain chip
          // needs an explicit upload-failure phrase; richer alert semantics
          // retain the broader provider-error wording supported previously.
          const explicitAlert = element.getAttribute?.('role') === 'alert' ||
            element.getAttribute?.('data-state') === 'error' || /upload-error/i.test(element.getAttribute?.('data-testid') || '');
          return explicitAlert
            ? /(?:\b(?:upload|file|attachment)\b.{0,80}\b(?:failed|error|unsupported|too large|limit)\b|\b(?:cannot|could not|unable to) upload\b)/i.test(value)
            : /(?:\b(?:upload(?:ing)?|(?:file|attachment)\s+upload)\s+(?:has\s+)?(?:failed|failure|error)\b|\b(?:cannot|could not|unable to)\s+upload\b|\b(?:file|attachment)\s+(?:is\s+)?(?:unsupported|too large)\b|\b(?:file|attachment|upload)\s+limit\b|\b(?:maximum|too many)\s+(?:files|attachments)\b)/i.test(value);
        });
      return failure ? label(failure).slice(0, 240) || 'Upload failed.' : '';
    }

    function attachmentsProcessing(scope) {
      return Boolean(scope && allVisible('[aria-busy="true"], [role="progressbar"], [data-upload-state="uploading"], [data-state="uploading"], [data-testid*="upload-progress"], .animate-spin', scope)
        .some((element) => !element.closest?.(TURN_SELECTOR)));
    }

    async function uploadFiles(message, requestTask = null) {
      if (!Array.isArray(message.files) || message.files.length === 0 || message.files.length > 5) {
        return { ok: false, error: 'Choose one to five supported files.' };
      }
      if ((active && active !== requestTask) || activeAttachment || generationBusy()) return { ok: false, error: 'Wait until the chat is idle before attaching files.' };
      if (message.runId && cancelledRuns.has(message.runId)) return { ok: false, error: 'This run was cancelled.' };
      const composer = findComposer();
      const form = composerScope(composer);
      if (!composer || !form) return { ok: false, error: 'The attachment composer was not found.' };
      const attachmentScope = currentAttachmentScope(composer);
      const imagePreviews = (scope) => allVisible('img, [role="img"]', scope)
        .filter((element) => !element.closest?.(TURN_SELECTOR));
      const previewsBefore = new Map(imagePreviews(attachmentScope).map((element) => [element, attachmentImageIdentity(element)]));
      const transfer = new win.DataTransfer();
      let total = 0;
      const names = new Set();
      for (const item of message.files) {
        if (!item || typeof item.name !== 'string' || !/^[^\\/\x00-\x1f]{1,180}$/.test(item.name) ||
            typeof item.mimeType !== 'string' || !ALLOWED_MIME.has(item.mimeType) || typeof item.base64 !== 'string') {
          return { ok: false, error: 'Unsupported file name or type.' };
        }
        if (names.has(item.name)) return { ok: false, error: 'Attachment file names must be unique within a batch.' };
        names.add(item.name);
        // Repeating four-character groups over a multi-MB base64 string can
        // exhaust V8's regexp stack. Bound size first; this single alphabet
        // repetition plus quartet length retains strict padding validation.
        if (item.base64.length > Math.ceil(MAX_FILE_BYTES / 3) * 4 || item.base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(item.base64)) {
          return { ok: false, error: 'Invalid or oversized file contents.' };
        }
        const bytes = decodeBase64(item.base64);
        if (encodeBase64(bytes) !== item.base64) return { ok: false, error: 'Invalid noncanonical file contents.' };
        total += bytes.byteLength;
        if (!bytes.byteLength || bytes.byteLength > MAX_FILE_BYTES || total > MAX_TOTAL_BYTES) {
          return { ok: false, error: 'File limit is 12 MB each and 24 MB total.' };
        }
        try {
          validateZipArchive(item.name, item.mimeType, bytes);
          validateSettingsFile(item.name, item.mimeType, bytes);
          if (filenameMime(item.name) !== item.mimeType) throw new Error('The attachment file type does not match its filename.');
          validateReadableSource(item.name, item.mimeType, bytes);
        }
        catch (error) { return { ok: false, error: error.message }; }
        transfer.items.add(new win.File([bytes], item.name, { type: item.mimeType }));
      }
      const namesBefore = new Map(message.files.map((item) => [item.name, attachmentNameEvidence(attachmentScope, item.name)]));
      // ChatGPT displays an uploaded image as a thumbnail without its file
      // name. Require a new visible preview for each image; text/PDF files
      // still need a visible name. The input itself is not proof of upload.
      const waitTask = requestTask || { controller: new AbortController(), runId: message.runId || null };
      activeAttachment = waitTask;
      let readyAt = null;
      try {
        let pickerReason = 'A compatible file picker is not available in this chat.';
        const inputAccepts = (input) => {
          if (input.disabled || input.getAttribute?.('aria-disabled') === 'true' || input.getAttribute?.('disabled') !== null && input.getAttribute?.('disabled') !== undefined) return false;
          if (input.closest?.(TURN_SELECTOR)) return false;
          if (message.files.length > 1 && !(input.multiple === true || input.hasAttribute?.('multiple'))) return false;
          const tokens = String(input.accept || input.getAttribute?.('accept') || '').toLowerCase().split(',').map((value) => value.trim()).filter(Boolean);
          if (!tokens.length || tokens.includes('*') || tokens.includes('*/*')) return true;
          return message.files.every((file) => tokens.some((token) => token.startsWith('.')
            ? file.name.toLowerCase().endsWith(token)
            : token.endsWith('/*') ? file.mimeType.toLowerCase().startsWith(token.slice(0, -1)) : file.mimeType.toLowerCase() === token));
        };
        const choosePicker = () => {
          const currentForm = composerScope(findComposer());
          if (!currentForm) { pickerReason = 'The attachment composer changed before file selection.'; return null; }
          const local = Array.from(currentForm.querySelectorAll('input[type="file"]')).filter(inputAccepts);
          // The live composer has three hidden inputs: photos/videos, photos,
          // and Attach files. Its general Attach files input accepts mixed
          // documents/images. Visibility is irrelevant for native file inputs.
          const named = local.filter((input) => /^attach files$/i.test(String(input.getAttribute?.('aria-label') || '').trim()));
          if (named.length === 1) return named[0];
          if (named.length > 1) { pickerReason = 'More than one Attach files picker is available in this chat.'; return null; }
          if (local.length === 1) return local[0];
          if (local.length > 1) {
            const specificity = (input) => {
              const tokens = String(input.accept || input.getAttribute?.('accept') || '').toLowerCase().split(',').map((value) => value.trim()).filter(Boolean);
              if (!tokens.length || tokens.includes('*') || tokens.includes('*/*')) return 0;
              const scores = message.files.map((file) => Math.max(...tokens.map((token) =>
                token === file.mimeType.toLowerCase() || token.startsWith('.') && file.name.toLowerCase().endsWith(token) ? 3
                  : token.endsWith('/*') && file.mimeType.toLowerCase().startsWith(token.slice(0, -1)) ? 2 : 0)));
              return Math.min(...scores) * 100 + scores.reduce((sum, value) => sum + value, 0) * 10 - tokens.length;
            };
            const ranked = local.map((input) => ({ input, score: specificity(input) })).sort((left, right) => right.score - left.score);
            if (ranked[0].score > ranked[1].score) return ranked[0].input;
            pickerReason = 'More than one compatible file picker is available in this chat.'; return null;
          }
          // A form-associated input can live outside its form; a named general
          // picker can also be rendered in a portal. Require a unique explicit
          // association rather than selecting arbitrary hidden profile inputs.
          const external = Array.from(doc.querySelectorAll('input[type="file"]')).filter(inputAccepts)
            .filter((input) => input.form === currentForm || /^attach files$/i.test(String(input.getAttribute?.('aria-label') || '').trim()));
          if (external.length === 1) return external[0];
          if (external.length > 1) pickerReason = 'More than one external Attach files picker is available in this chat.';
          return null;
        };
        const input = await waitForStage(choosePicker, options.setupTimeoutMs || 6000, waitTask, () => pickerReason);
        try {
          input.files = transfer.files;
          input.dispatchEvent(new win.Event('change', { bubbles: true }));
        } catch (_) {
          return { ok: false, error: 'The page did not accept programmatic file selection.' };
        }
        let completedImages = [];
        let completedNames = new Map();
        await waitFor(() => {
          const currentForm = composerScope(findComposer());
          const parent = currentForm?.parentElement;
          const scope = parent?.querySelectorAll?.(TURN_SELECTOR)?.length
            ? currentForm : (parent || currentForm || attachmentScope);
          const uploadError = attachmentFailure(scope);
          if (uploadError) throw new Error(`The page rejected an attachment: ${uploadError}`);
          const observedNames = new Map(message.files.map((item) => {
            const evidence = attachmentNameEvidence(scope, item.name);
            const previous = namesBefore.get(item.name);
            const fresh = [...evidence.entries()].filter(([alias, count]) => count > (previous?.get(alias) || 0));
            // A single new exact alias belongs to this selected file. More
            // than one new alias is ambiguous and cannot prove the upload.
            return [item.name, fresh.length === 1 ? { name: fresh[0][0], previousCount: previous?.get(fresh[0][0]) || 0 } : null];
          }));
          const hasName = (name) => Boolean(observedNames.get(name));
          const imageFiles = message.files.filter((item) => item.mimeType.startsWith('image/'));
          const newPreviews = imagePreviews(scope).filter((element) => !previewsBefore.has(element) || previewsBefore.get(element) !== attachmentImageIdentity(element));
          const previewsLoaded = newPreviews.every((element) => typeof element.complete !== 'boolean' || (element.complete && element.naturalWidth > 0));
          const imagesConfirmed = previewsLoaded && (newPreviews.length >= imageFiles.length || imageFiles.every((item) => hasName(item.name)));
          const confirmed = imagesConfirmed && message.files.filter((item) => !item.mimeType.startsWith('image/')).every((item) => hasName(item.name));
          const processing = attachmentsProcessing(scope);
          if (!confirmed || processing) { readyAt = null; return false; }
          completedImages = newPreviews;
          completedNames = observedNames;
          if (readyAt === null) readyAt = now();
          return now() - readyAt >= (options.attachmentSettleMs || 500);
        }, options.uploadTimeoutMs || 20000, waitTask);
        let imageIndex = 0;
        message.files.forEach((item) => {
          const element = item.mimeType.startsWith('image/') ? completedImages[imageIndex++] : null;
          const alias = completedNames.get(item.name);
          uploadedFiles.set(item.name, { observedName: alias?.name || null, previousCount: alias?.previousCount || 0,
            element, identity: element ? attachmentImageIdentity(element) : null });
        });
        while (uploadedFiles.size > 40) uploadedFiles.delete(uploadedFiles.keys().next().value);
      } catch (error) {
        if (waitTask.controller.signal.aborted) return { ok: false, error: String(waitTask.controller.signal.reason || 'Attachment upload was cancelled.') };
        if (error.message !== 'Timed out waiting for the ChatGPT page.') return { ok: false, error: error.message };
        return { ok: false, error: 'The page did not show a new preview for every image or a name for every document. Check the required attachments in this chat before starting.' };
      } finally { if (activeAttachment === waitTask) activeAttachment = null; }
      return { ok: true, attached: message.files.length };
    }

    function respond(result, sendResponse) {
      Promise.resolve(result).then(sendResponse, (error) => sendResponse({ ok: false, error: error.message || String(error) }));
      return true;
    }

    function onMessage(message, _sender, sendResponse) {
      if (!message || typeof message.type !== 'string') return false;
      if (['PREPARE', 'INSPECT', 'SEND_PROMPT'].includes(message.type)) {
        try { configureMode(message); } catch (error) { sendResponse({ ok: false, error: error.message }); return false; }
      }
      switch (message.type) {
        case 'INSPECT':
          sendResponse(inspect());
          publishStatus();
          return false;
        case 'DIAGNOSTICS':
          sendResponse({ ok: true, diagnostics: diagnostics() });
          return false;
        case 'PREPARE':
          return respond(prepare(), sendResponse);
        case 'SEND_PROMPT':
          return respond(sendPrompt(message), sendResponse);
        case 'CANCEL':
          sendResponse(cancel(message));
          return false;
        case 'UPLOAD_FILES':
          return respond(uploadFiles(message), sendResponse);
        case 'EXPORT_MEDIA':
          return respond(exportMedia(message), sendResponse);
        default:
          return false;
      }
    }

    runtime.onMessage.addListener(onMessage);
    let statusObserver = null;
    if (win.MutationObserver && (doc.documentElement || doc.body)) {
      statusObserver = new win.MutationObserver(scheduleStatus);
      statusObserver.observe(doc.documentElement || doc.body, { childList: true, characterData: true, subtree: true, attributes: true,
        attributeFilter: ['aria-pressed', 'aria-checked', 'aria-selected', 'aria-current', 'data-state', 'data-is-streaming', 'hidden', 'aria-hidden', 'contenteditable', 'placeholder', 'aria-label'] });
    }
    doc.addEventListener?.('input', scheduleStatus, true);
    win.addEventListener?.('pagehide', () => {
      statusObserver?.disconnect();
      if (statusTimer !== null) clearTimeout(statusTimer);
      doc.removeEventListener?.('input', scheduleStatus, true);
      clearMediaSnapshots();
      // Source uploads and completed-result exports can run while there is
      // no active prompt. Release their owned waits/downloads on navigation
      // too, before a fresh page tries to use the same host-side broker.
      activeAttachment?.controller.abort('The chat page closed or navigated.');
      for (const controller of mediaExports.keys()) controller.abort('The chat page closed or navigated.');
      if (!active) return;
      const task = active;
      active = null;
      remember(taskKey(task), 'failed');
      task.controller.abort('The chat page closed or navigated.');
      void emit({ type: 'ERROR', runId: task.runId, requestId: task.requestId, error: 'The chat page closed or navigated.' });
    });
    // Send one initial status when the service worker is available.
    setTimeout(publishStatus, 0);
    return { inspect, onMessage, cancel, sendPrompt, uploadFiles, exportMedia, privacyState };
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createBridge };
  } else if (globalThis.chrome?.runtime?.onMessage && globalThis.document && globalThis.window) {
    createBridge({ chrome: globalThis.chrome, document: globalThis.document, window: globalThis.window });
  }
})();
