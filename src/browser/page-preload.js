/* Generated from the bridge and desktop-only appearance modules. Run scripts/build-page-preload.js after source changes. */
'use strict';
const { ipcRenderer } = require('electron');
const qaOrigin = process.argv.find((item) => item.startsWith('--converge-qa-origin='))?.slice('--converge-qa-origin='.length);
if (process.isMainFrame && (location.origin === 'https://chatgpt.com' || (qaOrigin && /^http:\/\/127\.0\.0\.1:\d+$/.test(qaOrigin) && location.origin === qaOrigin))) {
  const listeners = [];
  const runtime = {
    onMessage: { addListener(listener) { listeners.push(listener); } },
    sendMessage(message) { return ipcRenderer.invoke('converge:page-event', message); }
  };
  ipcRenderer.on('converge:page-request', (_event, payload) => {
    let answered = false;
    const respond = (response) => {
      if (answered) return;
      answered = true;
      // Keep IPC messages small even for a 100 MB generated file.
      if (response?.files?.some(file => file.base64?.length > 4 * 1024 * 1024) ||
          response?.files?.reduce((sum, file) => sum + (file.base64?.length || 0), 0) > 4 * 1024 * 1024) {
        const serialized = JSON.stringify(response);
        let index = 0;
        for (let offset = 0; offset < serialized.length; offset += 1024 * 1024) {
          ipcRenderer.send('converge:page-response-chunk', { id: payload.id, index: index++, data: serialized.slice(offset, offset + 1024 * 1024) });
        }
        ipcRenderer.send('converge:page-response', { id: payload.id, response: { chunked: true, totalChunks: index, totalLength: serialized.length } });
      } else ipcRenderer.send('converge:page-response', { id: payload.id, response });
    };
    try { for (const listener of listeners) listener(payload.message, {}, respond); }
    catch (error) { respond({ ok: false, error: error.message }); }
  });
  const module = { exports: {} };
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
  const MAX_FILE_BYTES = 512 * 1024 * 1024;
  const MAX_TOTAL_BYTES = 1024 * 1024 * 1024;
  const MAX_INLINE_BYTES = 128 * 1024 * 1024;
  // Keep the history cache small even though an individual transfer can be
  // larger. Large files remain available in the coordinator's current result.
  const MAX_SNAPSHOT_BYTES = 24 * 1024 * 1024;
  // Each native upload is limited to five files. A boss prompt may inspect
  // five original sources and both workers' five-file result bundles after
  // those uploads have each been confirmed separately, plus at most three
  // host-created complete text replies when the inline context is too long.
  const MAX_ATTACHED_SOURCE_NAMES = 18;
  const MIME_BY_EXTENSION = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
    pdf: 'application/pdf', zip: 'application/zip', txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', tsv: 'text/tab-separated-values', json: 'application/json',
    mq5: 'text/plain', mqh: 'text/plain', mq4: 'text/plain', py: 'text/plain', js: 'text/plain', mjs: 'text/plain', cjs: 'text/plain', ts: 'text/plain',
    jsx: 'text/plain', tsx: 'text/plain', c: 'text/plain', cc: 'text/plain', cpp: 'text/plain',
    h: 'text/plain', hpp: 'text/plain', cs: 'text/plain', java: 'text/plain', rs: 'text/plain',
    go: 'text/plain', rb: 'text/plain', php: 'text/plain', sql: 'text/plain', html: 'text/plain', css: 'text/plain', xml: 'text/plain',
    yaml: 'text/plain', yml: 'text/plain', toml: 'text/plain', sh: 'text/plain', ps1: 'text/plain', r: 'text/plain',
    swift: 'text/plain', kt: 'text/plain', kts: 'text/plain', ini: 'text/plain', cfg: 'text/plain', log: 'text/plain', set: 'text/plain', tex: 'text/plain',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  };
  const ALLOWED_MIME = new Set([
    'image/png', 'image/jpeg', 'image/webp', 'image/gif',
    'application/pdf', 'application/zip', 'text/plain', 'text/markdown',
    'text/csv', 'text/tab-separated-values', 'application/json',
    MIME_BY_EXTENSION.docx, MIME_BY_EXTENSION.xlsx, MIME_BY_EXTENSION.pptx
  ]);

  function createBridge(env) {
    const doc = env.document;
    const win = env.window;
    const runtime = env.chrome.runtime;
    const options = env.options || {};
    const settleMs = options.settleMs || 3000;
    const tickMs = options.tickMs || 400;
    const replyTimeoutMs = options.replyTimeoutMs || 2 * 60 * 60 * 1000;
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
    const uploadAttempts = new Map();
    const interruptedTasks = new Map();
    let stagedUpload = null;

    function clearStagedUpload() {
      if (stagedUpload) clearTimeout(stagedUpload.timer);
      stagedUpload = null;
    }
    function renewStagedUpload() {
      clearTimeout(stagedUpload.timer);
      stagedUpload.timer = setTimeout(clearStagedUpload, 15 * 60 * 1000);
    }
    function stageFile(message) {
      if (message.type === 'FILE_STAGE_BEGIN') {
        if (stagedUpload || active || activeAttachment || generationBusy()) return { ok: false, error: 'A file transfer or response is already in progress.' };
        if (typeof message.transferId !== 'string' || message.transferId.length > 200 || !message.transferId ||
            !Array.isArray(message.files) || !message.files.length || message.files.length > 5 ||
            message.runId && cancelledRuns.has(message.runId)) return { ok: false, error: 'Invalid staged file transfer.' };
        let total = 0;
        const names = new Set();
        for (const file of message.files) {
          if (!file || typeof file.name !== 'string' || !/^[^\\/\x00-\x1f]{1,180}$/.test(file.name) || names.has(file.name) ||
              !ALLOWED_MIME.has(file.mimeType) || !Number.isSafeInteger(file.base64Length) || file.base64Length < 4 ||
              file.base64Length % 4 || file.base64Length > Math.ceil(MAX_FILE_BYTES / 3) * 4) return { ok: false, error: 'Invalid staged file metadata.' };
          if (file.byteLength !== undefined && (!Number.isSafeInteger(file.byteLength) || file.byteLength < 1 || file.byteLength > MAX_FILE_BYTES ||
              Math.ceil(file.byteLength / 3) * 4 !== file.base64Length) ||
              file.contentSha256 !== undefined && !/^[a-f0-9]{64}$/.test(file.contentSha256)) return { ok: false, error: 'Invalid staged file identity.' };
          if (filenameMime(file.name) !== file.mimeType) return { ok: false, error: 'The attachment file type does not match its filename.' };
          names.add(file.name); total += file.byteLength || file.base64Length / 4 * 3;
        }
        if (total > MAX_TOTAL_BYTES + 10) return { ok: false, error: 'File limit is 512 MB each and 1 GB total.' };
        stagedUpload = { transferId: message.transferId, runId: message.runId || null,
          files: message.files.map(file => ({ ...file, received: 0, receivedBytes: 0, parts: [], decoder: null })), timer: null };
        renewStagedUpload();
        return { ok: true };
      }
      const transfer = stagedUpload;
      if (!transfer || transfer.transferId !== message.transferId) return { ok: false, error: 'The staged file transfer is no longer available.' };
      if (message.type === 'FILE_STAGE_ABORT') { clearStagedUpload(); return { ok: true }; }
      if (transfer.runId && cancelledRuns.has(transfer.runId)) { clearStagedUpload(); return { ok: false, error: 'This file transfer was canceled.' }; }
      if (message.type === 'FILE_STAGE_CHUNK') {
        const file = transfer.files[message.fileIndex];
        if (!file || !Number.isInteger(message.fileIndex) || message.offset !== file.received ||
            typeof message.data !== 'string' || !message.data.length || message.data.length > 1024 * 1024 ||
            file.received + message.data.length > file.base64Length) { clearStagedUpload(); return { ok: false, error: 'The file chunk is missing, out of order or oversized.' }; }
        try {
          if (message.data.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(message.data) ||
              message.data.includes('=') && file.received + message.data.length !== file.base64Length) throw new Error('Invalid file chunk encoding.');
          const bytes = decodeBase64(message.data);
          if (encodeBase64(bytes) !== message.data) throw new Error('Invalid noncanonical file chunk.');
          if (file.mimeType === 'text/plain' || file.mimeType === MIME_BY_EXTENSION.tsv) {
            if (!file.decoder) {
              const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8';
              const Decoder = win.TextDecoder || globalThis.TextDecoder;
              file.decoder = new Decoder(encoding, { fatal: true });
            }
            if (/[\x00-\x08\x0b\x0e-\x1f\x7f]/.test(file.decoder.decode(bytes, { stream: true }))) throw new Error('The source file contains binary data instead of readable text.');
          }
          // Blob parts move decoded bytes out of retained JavaScript strings.
          // Never reconstruct one whole base64/binary string on commit.
          file.parts.push(new win.Blob([bytes])); file.received += message.data.length; file.receivedBytes += bytes.length;
          if (file.receivedBytes > MAX_FILE_BYTES || file.byteLength && file.receivedBytes > file.byteLength) throw new Error('The file chunk exceeds its declared size.');
          renewStagedUpload();
        } catch (error) { clearStagedUpload(); return { ok: false, error: error.message || 'Invalid file chunk.' }; }
        return { ok: true };
      }
      if (message.type === 'FILE_STAGE_COMMIT') {
        if (transfer.files.some(file => file.received !== file.base64Length || file.byteLength && file.receivedBytes !== file.byteLength) ||
            transfer.files.reduce((total, file) => total + file.receivedBytes, 0) > MAX_TOTAL_BYTES) { clearStagedUpload(); return { ok: false, error: 'The complete file bytes have not arrived.' }; }
        return (async () => {
          try {
            const prepared = transfer.files.map(file => {
              if (file.decoder && /[\x00-\x08\x0b\x0e-\x1f\x7f]/.test(file.decoder.decode())) throw new Error('The source file contains binary data instead of readable text.');
              return new win.File(file.parts, file.name, { type: file.mimeType });
            });
            for (const file of prepared) if (file.type === 'application/zip') await validateStagedZip(file, () => stagedUpload === transfer && (!transfer.runId || !cancelledRuns.has(transfer.runId)));
            if (stagedUpload !== transfer) throw new Error('This file transfer was canceled.');
            clearStagedUpload();
            return uploadFiles({ ...message, type: 'UPLOAD_FILES', runId: transfer.runId, files: transfer.files.map(file => ({ name: file.name, mimeType: file.mimeType })) }, null, prepared);
          } catch (error) { if (stagedUpload === transfer) clearStagedUpload(); return { ok: false, error: error.message || 'Invalid staged file.' }; }
        })();
      }
      return { ok: false, error: 'Unknown staged transfer operation.' };
    }

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
      const attachmentProcessing = Boolean(stagedUpload) || attachmentsProcessing(attachmentScope);
      const login = allVisible('button, a').some((element) => /^(log in|sign in)$/i.test(label(element)));
      const authenticated = login ? false : composer ? true : null;
      const privacy = privacyState();
      const work = workState();
      const workRestriction = chatMode === 'work' ? workAccessReason() : '';
      const generating = generationBusy();
      const newestUser = active || interruptedTasks.size ? getTurns(USER_SELECTOR).at(-1) : null;
      const currentTask = active || [...interruptedTasks.values()].reverse().find(task =>
        newestUser && userMessageMatches(newestUser, task.text, task.requestId) && navigationValid(task));
      // Inspection must be read-only: sameUserText can expand a bubble. During
      // submission that could alter historical controls and invalidate the
      // baseline before the new user turn exists. The observer owns expansion.
      const requestOwned = Boolean(currentTask && !currentTask.confirmingIdentity && newestUser && userMessageMatches(newestUser, currentTask.text, currentTask.requestId) && navigationValid(currentTask));
      const providerFailure = requestOwned && ownedProviderFailure(newestUser, currentTask);
      const interrupted = requestOwned && ownedResponseInterrupted(newestUser, currentTask, providerFailure);
      const connectionWarning = requestOwned && !providerFailure && !interrupted && ownedConnectionWarning(newestUser, currentTask);
      const reconnecting = Boolean(connectionWarning);
      const busy = Boolean(active || generating || composerText(composer).trim() || attachmentProcessing);
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
      else if (interrupted) reason = `${providerFailure?.reason || 'The provider stopped this response before delivering a completed result.'}${generating ? ' Waiting for the provider to clear its active response control before recovery.' : ''}`;
      else if (reconnecting) reason = `${connectionWarning} The current request is retained while ChatGPT reconnects; its partial answer is not a completed result.`;
      else if (busy) reason = 'This chat is generating a response or has an unsent draft.';
      else if (workRestriction) reason = workRestriction;
      else if (chatMode === 'work' && work !== true) reason = 'Work mode is not verified. Select Work in this page, then check the pages again.';
      else if (chatMode !== 'work' && work === true) reason = 'This page is still in Work mode. Select Chat, then check the pages again.';
      else if (chatMode === 'temporary' && privacy.temporary === false) reason = 'Temporary Chat is off.';
      else if (chatMode === 'temporary' && requireUnpersonalized && privacy.unpersonalized === false) reason = 'This Temporary Chat is personalized.';
      else if (chatMode === 'temporary' && (privacy.temporary !== true || (requireUnpersonalized && privacy.unpersonalized !== true))) {
        reason = `The page does not expose enough state to verify Temporary${requireUnpersonalized ? ' and Unpersonalized' : ''}. Check the selected mode in ChatGPT before starting.`;
      }
      return { ok: true, ready, authenticated, ...privacy, work, chatMode, busy, reason, generating,
        reconnecting,
        interrupted, interruptionKind: interrupted ? (providerFailure?.kind || 'stopped-thinking') : '',
        awaitingProviderIdle: Boolean(interrupted && generating),
        requestOwned, activeRequestId: currentTask?.requestId || null };
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

    const NON_ANSWER_CONTENT = '[data-tool-result], [data-tool-call-id], [data-message-type="tool"], [data-testid*="tool-result"], [data-testid*="tool-response"], [data-testid*="thinking"], [data-testid*="reasoning"]';
    function controlResponseText(element) {
      // Control extraction is opt-in transport metadata, never inferred from
      // prose or JSON-looking braces. A tool's structured output is not the
      // model's final control answer, even inside the same assistant wrapper.
      const explicitBodies = allVisible('[data-markdown-text-style="assistant-message"]', element)
        .filter(body => !body.closest?.(NON_ANSWER_CONTENT));
      const genericBodies = allVisible('.markdown, [data-testid="message-content"]', element)
        .filter(body => !body.closest?.(NON_ANSWER_CONTENT));
      const bodies = explicitBodies.length ? explicitBodies : genericBodies;
      const outerBodies = bodies.filter(body => !bodies.some(other => other !== body && other.contains?.(body)));
      const body = outerBodies.at(-1) || element;
      const codes = allVisible('pre code, [data-markdown-copy="code-block"] code', body)
        .filter(code => !code.closest?.(NON_ANSWER_CONTENT));
      const jsonCodes = codes.filter(code => {
        const containers = [...new Set([code.closest?.('[data-markdown-copy="code-block"]'), code.closest?.('pre')].filter(Boolean))];
        if (!containers.length) return false;
        const language = node => /^json$/i.test(String(node?.getAttribute?.('data-language') || node?.getAttribute?.('data-lang') || '').trim()) ||
          /(?:^|\s)language-json(?:\s|$)/i.test(String(node?.getAttribute?.('class') || ''));
        if (language(code) || containers.some(language)) return true;
        // Current ChatGPT labels the fenced block in its excluded copy header
        // rather than a language-json class. Only that header is a language
        // affordance; a word "JSON" in answer prose is not one.
        return containers.some(container => allVisible('[data-markdown-copy="exclude"]', container).some(header =>
          /^json$/i.test(String(header.innerText ?? header.textContent ?? '').trim()) ||
          allVisible('span', header).some(label => /^json$/i.test(String(label.innerText ?? label.textContent ?? '').trim()))));
      });
      if (jsonCodes.length === 1) return String(jsonCodes[0].textContent || '').replace(/\r\n/g, '\n').trim();
      if (jsonCodes.length > 1) {
        // Retain every explicit fence boundary. Flattening them into prose
        // would let a downstream fallback accidentally pick one object.
        return jsonCodes.map(code => `\`\`\`json\n${String(code.textContent || '')}\n\`\`\``).join('\n\n');
      }
      // Without an explicit JSON fence, preserve the
      // complete final body for the strict control parser to reject or handle;
      // do not repair escapes, scan for arbitrary objects, or pick a valid one.
      return assistantText(body);
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

    async function validateStagedZip(file, current) {
      // Validate the same inert container envelope as the inline path, using
      // bounded Blob slices rather than loading the complete archive.
      const invalid = () => { throw new Error('The ZIP file is malformed, incomplete, or uses unsupported multipart/ZIP64 structures.'); };
      const read = async (offset, length) => {
        if (!current()) throw new Error('This file transfer was canceled.');
        if (offset < 0 || offset + length > file.size) invalid();
        const data = new Uint8Array(await file.slice(offset, offset + length).arrayBuffer());
        if (!current()) throw new Error('This file transfer was canceled.');
        return new DataView(data.buffer, data.byteOffset, data.byteLength);
      };
      if (file.size < 22) invalid();
      const first = await read(0, 4);
      if (![0x04034b50, 0x06054b50, 0x08074b50].includes(first.getUint32(0, true))) invalid();
      const tailStart = Math.max(0, file.size - 65_557), tail = await read(tailStart, file.size - tailStart);
      let end = -1;
      for (let offset = tail.byteLength - 22; offset >= 0; offset -= 1) {
        if (tail.getUint32(offset, true) === 0x06054b50 && offset + 22 + tail.getUint16(offset + 20, true) === tail.byteLength) { end = offset; break; }
      }
      if (end < 0 || tail.getUint16(end + 4, true) || tail.getUint16(end + 6, true) || tail.getUint16(end + 8, true) !== tail.getUint16(end + 10, true)) invalid();
      const entries = tail.getUint16(end + 10, true), size = tail.getUint32(end + 12, true), start = tail.getUint32(end + 16, true);
      if (entries === 0xffff || size === 0xffffffff || start === 0xffffffff || start + size > tailStart + end) invalid();
      if (!entries) { if (size) invalid(); return; }
      let cursor = start;
      for (let index = 0; index < entries; index += 1) {
        if (cursor + 46 > start + size) invalid();
        const header = await read(cursor, 46);
        if (header.getUint32(0, true) !== 0x02014b50 || header.getUint16(34, true)) invalid();
        const local = header.getUint32(42, true);
        if (header.getUint32(20, true) === 0xffffffff || header.getUint32(24, true) === 0xffffffff || local === 0xffffffff || local + 30 > start) invalid();
        if ((await read(local, 4)).getUint32(0, true) !== 0x04034b50) invalid();
        cursor += 46 + header.getUint16(28, true) + header.getUint16(30, true) + header.getUint16(32, true);
        if (cursor > start + size) invalid();
      }
      if (cursor !== start + size) invalid();
    }

    function validateReadableSource(name, mimeType, bytes) {
      if ((/\.tsv$/i.test(String(name || '')) || mimeType === MIME_BY_EXTENSION.tsv) && filenameMime(name) !== mimeType) {
        throw new Error('The TSV file type does not match its filename.');
      }
      if (mimeType !== 'text/plain' && mimeType !== MIME_BY_EXTENSION.tsv) return;
      if (filenameMime(name) !== mimeType) throw new Error('The text source file has an unsupported extension.');
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

    function collectResponseMedia(nodes) {
      const entries = [], fingerprints = new Set();
      for (const responseNode of nodes) {
        for (const entry of collectMedia(responseNode)) {
          if (fingerprints.has(entry.fingerprint)) continue;
          fingerprints.add(entry.fingerprint);
          entries.push({ ...entry, responseNode, id: `media-${entries.length + 1}`,
            ...(entry.kind === 'image' ? { name: `generated-image-${entries.length + 1}.png` } : {}) });
          if (entries.length === 6) return entries;
        }
      }
      return entries;
    }

    function mediaSnapshotKey(message, entry) {
      return JSON.stringify([message.runId, message.requestId, entry.id, entry.name, entry.mimeType, entry.fingerprint]);
    }

    function removeMediaSnapshot(key) {
      const snapshot = mediaSnapshots.get(key);
      if (!snapshot) return;
      mediaSnapshotBytes -= snapshot.blobId ? 0 : snapshot.byteLength;
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
        if (!snapshot.blobId && snapshot.byteLength > MAX_SNAPSHOT_BYTES) continue;
        const weight = snapshot.blobId ? 0 : snapshot.byteLength;
        while ((mediaSnapshotBytes + weight > MAX_SNAPSHOT_BYTES || mediaSnapshots.size >= 200) && mediaSnapshots.size) {
          removeMediaSnapshot(mediaSnapshots.keys().next().value);
        }
        mediaSnapshots.set(snapshot.key, Object.freeze(snapshot));
        mediaSnapshotBytes += weight;
      }
    }

    function snapshotFile(snapshot) {
      // Never expose the cached descriptor object to a response recipient.
      return { id: snapshot.id, name: snapshot.name, mimeType: snapshot.mimeType,
        fingerprint: snapshot.fingerprint, ...(snapshot.blobId ? { blobId: snapshot.blobId } : { base64: snapshot.base64 }),
        contentSha256: snapshot.contentHash, byteLength: snapshot.byteLength };
    }

    function encodeBase64(bytes) {
      if (typeof bytes.toBase64 === 'function') return bytes.toBase64();
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
      const timeout = setTimeout(() => controller.abort('Media export timed out.'), entries.length * 35 * 60_000);
      const files = [];
      const verifiedSnapshots = [];
      let total = 0;
      const sameDownload = (entry) => {
        const responseNode = entry.responseNode || record.node;
        if (entry.kind === 'native-button') {
          const current = downloadableNamedButton(entry.element, responseNode);
          return current && current.href === entry.source && current.name === entry.name && current.mimeType === entry.mimeType;
        }
        if (entry.kind === 'native-card') {
          const current = downloadableCard(entry.element, responseNode);
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
            if (total > MAX_TOTAL_BYTES) throw new Error('File limit is 512 MB each and 1 GB total; empty files cannot be relayed.');
            files.push(snapshotFile(snapshot));
            continue;
          }
          const responseNode = entry.responseNode || record.node;
          if (!visible(responseNode)) throw new Error('The completed media response is no longer available on this page.');
          if (!visible(entry.element) || !responseNode.contains?.(entry.element)) throw new Error('A media element is no longer in the completed response.');
          let bytes;
          let storedDownload = null;
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
                    sourceCheckedBeforeNativeClick = !controller.signal.aborted && !runCancelled() && visible(responseNode) &&
                      visible(entry.element) && responseNode.contains?.(entry.element) && !entry.element.disabled &&
                      entry.element.getAttribute?.('aria-disabled') !== 'true' && !!sameDownload(entry);
                    return sourceCheckedBeforeNativeClick;
                  } }), aborted]);
              } finally { controller.signal.removeEventListener('abort', abortNative); }
              if (!downloaded?.ok) throw new Error(downloaded?.error || 'The visible file download did not complete.');
              if (downloaded.blobId !== undefined) {
                if (downloaded.mimeType !== entry.mimeType || typeof downloaded.blobId !== 'string' || !downloaded.blobId || downloaded.blobId.length > 200 ||
                    !Number.isSafeInteger(downloaded.byteLength) || downloaded.byteLength < 1 || downloaded.byteLength > MAX_FILE_BYTES ||
                    !/^[a-f0-9]{64}$/.test(downloaded.contentSha256)) throw new Error('The native download returned an invalid stored file identity.');
                storedDownload = { blobId: downloaded.blobId, byteLength: downloaded.byteLength, contentSha256: downloaded.contentSha256 };
              } else {
              if (downloaded.mimeType !== entry.mimeType || typeof downloaded.base64 !== 'string' ||
                  downloaded.base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(downloaded.base64) ||
                  downloaded.base64.length > Math.ceil(MAX_INLINE_BYTES / 3) * 4) throw new Error('The native download returned invalid or oversized file contents.');
              bytes = decodeBase64(downloaded.base64);
              }
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
                    visible(responseNode) && responseNode.contains?.(entry.element) &&
                    !controller.signal.aborted && !runCancelled()) {
                  await new Promise((resolve) => setTimeout(resolve, 50));
                }
              }
            } else {
            if (typeof win.fetch !== 'function') throw new Error('This browser cannot export download links.');
            const response = await win.fetch(entry.source, { credentials: 'same-origin', signal: controller.signal, redirect: 'error' });
            if (!response.ok || response.type === 'opaque') throw new Error('The visible download link was unavailable or blocked by the browser.');
            const contentLength = Number(response.headers?.get?.('content-length'));
            if (contentLength > MAX_INLINE_BYTES) throw new Error('Browser-only downloads have a 128 MB inline limit. Use the native desktop download for larger files.');
            const contentType = String(response.headers?.get?.('content-type') || '').split(';')[0].trim().toLowerCase();
            if (contentType && contentType !== entry.mimeType &&
                !(entry.mimeType === 'application/zip' && contentType === 'application/x-zip-compressed') &&
                !(contentType === 'application/zip' && entry.mimeType.includes('openxmlformats')) &&
                !(contentType === 'text/x-python' && entry.mimeType === 'text/plain' && /\.py$/i.test(entry.name)) &&
                !(contentType === 'text/plain' && entry.mimeType === MIME_BY_EXTENSION.tsv && /\.tsv$/i.test(entry.name)) &&
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
              if (size > MAX_INLINE_BYTES || total + size > MAX_TOTAL_BYTES) { await reader.cancel(); throw new Error('Browser-only downloads have a 128 MB inline limit.'); }
              chunks.push(value);
            }
            bytes = new Uint8Array(size);
            let offset = 0;
            for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
            }
          }
          const byteLength = storedDownload ? storedDownload.byteLength : bytes.byteLength;
          total += byteLength;
          if (!storedDownload && byteLength > MAX_INLINE_BYTES) throw new Error('Browser-only artifacts have a 128 MB inline limit. Use the native desktop download for larger files.');
          if (!byteLength || byteLength > MAX_FILE_BYTES || total > MAX_TOTAL_BYTES) throw new Error('File limit is 512 MB each and 1 GB total; empty files cannot be relayed.');
          validateZipArchive(entry.name, entry.mimeType, storedDownload ? undefined : bytes);
          validateSettingsFile(entry.name, entry.mimeType, storedDownload ? undefined : bytes);
          if (!storedDownload) validateReadableSource(entry.name, entry.mimeType, bytes);
          if (runCancelled()) throw new Error('This run was cancelled.');
          if (!nativeSourceCapturedAtClick && (!visible(responseNode) || !visible(entry.element) || !responseNode.contains?.(entry.element) ||
              (entry.kind === 'image' ? imageSource(entry.element) !== entry.source : !sameDownload(entry)))) {
            throw new Error(`The source media changed while exporting (response visible: ${visible(responseNode)}, control visible: ${visible(entry.element)}, control in response: ${!!responseNode.contains?.(entry.element)}, same output: ${entry.kind === 'image' ? imageSource(entry.element) === entry.source : !!sameDownload(entry)}).`);
          }
          let contentHash = storedDownload?.contentSha256;
          if (!storedDownload) {
            const subtle = win.crypto?.subtle || globalThis.crypto?.subtle;
            if (!subtle) throw new Error('This browser cannot verify generated file contents safely.');
            const digest = new Uint8Array(await subtle.digest('SHA-256', bytes));
            contentHash = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
          }
          if (entry.contentHash && entry.contentHash !== contentHash) throw new Error('The generated file contents changed after their first export. Start a new run.');
          entry.contentHash = contentHash;
          if (controller.signal.aborted || runCancelled()) throw new Error('Media export was cancelled or timed out.');
          const data = storedDownload ? { blobId: storedDownload.blobId } : { base64: encodeBase64(bytes) };
          files.push({ id: entry.id, name: entry.name, mimeType: entry.mimeType, fingerprint: entry.fingerprint, ...data,
            contentSha256: contentHash, byteLength });
          verifiedSnapshots.push({ key: snapshotKey, taskKey: taskKey(message), id: entry.id, name: entry.name,
            mimeType: entry.mimeType, fingerprint: entry.fingerprint, ...data, byteLength, contentHash });
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
      if (/^(?:resume stream (?:unavailable|is not available)|(?:the )?response stream (?:was |has been )?(?:interrupted|disconnected)|(?:the )?network connection (?:was |has been )?lost)(?:[.!])?(?:\s*(?:retry|try again)\.?)?$/i.test(text)) return 'stream-interrupted';
      if (/^(?:(?:the |your )?request timed out|response timed out|request timeout|time ?out error|timed out)[.!]?(?:\s*(?:please )?(?:try again|retry)[.!]?)?$/i.test(text)) return 'timeout';
      if (/^(?:(?:the )?message (?:delivery (?:failed|timed out)|failed to (?:send|deliver))|(?:failed|unable) to (?:send|deliver)(?: the| your)? message|message delivery error)[.!]?(?:\s*(?:please )?(?:try again|retry)[.!]?)?$/i.test(text)) return 'delivery-error';
      if (/^(?:something went wrong|a server error occurred|internal server error)[.!]?(?:\s*(?:please )?(?:try again|retry)[.!]?)?$/i.test(text)) return 'server-error';
      return '';
    }

    function connectionWaiting(value) {
      return /^connection interrupted[.!]?\s*waiting for the complete answer(?:\u2026|\.{1,3})?$/i.test(String(value || '').replace(/\s+/g, ' ').trim());
    }

    function ownedConnectionWarning(lastUser, task) {
      if (!lastUser || task.interruption) return '';
      for (const element of allVisible(`${PROVIDER_REJECTION_SELECTOR}, [role="status"]`)) {
        const raw = String(element.innerText ?? element.textContent ?? '');
        if (raw.length > 300) continue;
        const value = raw.replace(/\s+/g, ' ').trim();
        if (!connectionWaiting(value) || task.baselineProviderRejections?.get(element) === value) continue;
        if (element === lastUser || lastUser.contains?.(element) || element.contains?.(lastUser) ||
            element.matches?.(ASSISTANT_SELECTOR) || element.querySelector?.('.markdown, [data-testid="message-content"], [data-markdown-text-style="assistant-message"], pre, code') ||
            element.closest?.(`${USER_SELECTOR}, .markdown, [data-testid="message-content"], [data-markdown-text-style="assistant-message"], pre, code, form`)) continue;
        if (!(lastUser.compareDocumentPosition?.(element) & 4)) continue;
        const response = element.closest?.(ASSISTANT_SELECTOR);
        if (response && (lastUser.compareDocumentPosition?.(response) & 4)) return value;
        // Some renderers place the status beside the assistant wrapper inside
        // its turn. A fresh explicit page alert is the only global fallback.
        const turn = element.closest?.('article[data-testid^="conversation-turn"]');
        if (turn && allVisible(ASSISTANT_SELECTOR, turn).some(reply => lastUser.compareDocumentPosition?.(reply) & 4) &&
            !allVisible(USER_SELECTOR, turn).length) return value;
        if (!turn && !response && (element.getAttribute?.('role') === 'alert' || element.getAttribute?.('role') === 'status' ||
            element.closest?.('[role="alert"], [role="status"], [data-testid*="error"], [data-state="error"]'))) return value;
      }
      return '';
    }

    function ownedProviderFailure(lastUser, task) {
      // A terminal error may unmount before a stale Stop control disappears.
      // Keep its owned receipt so that the leftover partial body never turns
      // into a successful result when the provider finally becomes idle.
      if (task.interruption) return task.interruption;
      // Provider rejection can leave Stop/streaming markers visible forever.
      // Match the new error beside this exact submitted user turn before
      // consulting generationBusy. Prompt text, code and old turns are data.
      const failureFor = (element, globalAlert = false) => {
        const quotedContent = 'pre, code, blockquote, [data-markdown-copy="code-block"], .markdown, [data-testid="message-content"], [data-markdown-text-style="assistant-message"]';
        const unrelatedRegion = 'header, [role="banner"], [role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], nav, [role="navigation"], aside, [role="complementary"]';
        if (element === lastUser || lastUser.contains?.(element) || element.contains?.(lastUser) ||
            element.closest?.(quotedContent) || element.querySelector?.(quotedContent) ||
            element.closest?.(unrelatedRegion) || element.querySelector?.(unrelatedRegion)) return '';
        const value = String(element.innerText ?? element.textContent ?? '').replace(/\s+/g, ' ').trim();
        if (!value || value.length > 300 || task.baselineProviderRejections?.get(element) === value) return '';
        const kind = providerRejectionKind(value);
        if (!kind) return '';
        const terminal = ['generation-error', 'stream-interrupted', 'timeout', 'delivery-error', 'server-error'].includes(kind);
        if (terminal && (element.closest?.(`form, ${USER_SELECTOR}`) || element.querySelector?.(`form, ${USER_SELECTOR}`))) return '';
        const assistant = element.closest?.(ASSISTANT_SELECTOR);
        const turn = element.closest?.('article[data-testid^="conversation-turn"]');
        const ownedTurn = lastUser.closest?.('article[data-testid^="conversation-turn"]');
        const followsOwnedUser = node => {
          const position = lastUser.compareDocumentPosition?.(node) || 0;
          return Boolean(position & 4) && !(position & 1);
        };
        // A shared history container can retain an old assistant after its
        // user bubble is virtualized away. Ordering is required in both the
        // ancestor scan and the global fallback, regardless of DOM freshness.
        if (assistant && !followsOwnedUser(assistant)) return '';
        if (turn && turn !== ownedTurn && !followsOwnedUser(turn)) return '';
        const errorSelector = '[role="alert"], [data-testid*="error"], [data-state="error"]';
        const errorRoot = element.closest?.(errorSelector);
        const explicitError = element.getAttribute?.('role') === 'alert' ||
          /error/i.test(element.getAttribute?.('data-testid') || '') || element.getAttribute?.('data-state') === 'error' ||
          Boolean(errorRoot);
        if (assistant && !explicitError) return '';
        if (globalAlert && (!explicitError || element.closest?.(USER_SELECTOR))) return '';
        if (kind === 'too-long') return task.interruption = { kind, reason: 'ChatGPT rejected this tracked message as too long. The boss must create a smaller focused continuation that preserves the task and retained files; the rejected prompt must not be resent unchanged.' };
        if (terminal && explicitError && followsOwnedUser(element) && !element.closest?.(USER_SELECTOR)) {
          const turnUsers = turn ? allVisible(USER_SELECTOR, turn) : [];
          const exactOwnedTurn = turn && turn === ownedTurn && turn.contains?.(lastUser) &&
            turnUsers.every(user => user === lastUser || lastUser.contains?.(user));
          const ownedAssistantTurn = turn && !turnUsers.length &&
            allVisible(ASSISTANT_SELECTOR, turn).some(followsOwnedUser);
          // A root provider alert may be rendered beside the chat. Require an
          // explicit root directly under body, after this exact owned user;
          // nested panels without response/turn evidence remain ambiguous.
          // Baseline wording also excludes a stale root recreated as a new node.
          const baselineWording = [...(task.baselineProviderRejections?.values() || [])].includes(value);
          const rootProviderAlert = !turn && !assistant && !baselineWording &&
            errorRoot?.parentElement === doc.body && followsOwnedUser(errorRoot);
          if (!assistant && !exactOwnedTurn && !ownedAssistantTurn && !rootProviderAlert) return '';
          return task.interruption = { kind, reason: `ChatGPT reported ${value} for this request before its response completed. Its partial response is not a completed result.` };
        }
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
      // The same ownership rules apply to alerts outside the ancestor scan.
      // An unrelated panel or rehydrated historical error cannot authorize
      // recovery just because it appeared while this request was pending.
      for (const element of allVisible(PROVIDER_REJECTION_SELECTOR)) {
        const failure = failureFor(element, true);
        if (failure) return failure;
      }
      return '';
    }

    function ownedResponseInterrupted(lastUser, task, providerFailure) {
      if (!lastUser) return false;
      // A generation or stream failure can leave a partial markdown body and
      // even a stale streaming marker. It is an explicit provider failure, not proof that
      // the model finished. Retire it through supervision without relaying the
      // partial answer or clicking Retry/Stop on another request.
      const failureKind = (providerFailure === undefined ? ownedProviderFailure(lastUser, task) : providerFailure)?.kind;
      if (['stream-interrupted', 'generation-error', 'timeout', 'delivery-error', 'server-error', 'too-long'].includes(failureKind)) return true;
      if (generationBusy()) return false;
      const markers = allVisible('span, p, div, button').filter(element => {
        const value = label(element).replace(/\s+/g, ' ').trim();
        return /^(?:stopped thinking|stopped generating|response interrupted)$/i.test(value) &&
          task.baselineProviderRejections?.get(element) !== value &&
          !element.closest?.(`${USER_SELECTOR}, .markdown, [data-testid="message-content"], [data-markdown-text-style="assistant-message"], pre, code, form`) &&
          Boolean(lastUser.compareDocumentPosition(element) & 4);
      });
      if (!markers.length) return false;
      const ordered = getTurns(`${USER_SELECTOR}, ${ASSISTANT_SELECTOR}`);
      const newestReply = ordered.slice(ordered.indexOf(lastUser) + 1).filter(element => element.matches?.(ASSISTANT_SELECTOR)).at(-1);
      // A user may stop the thinking phase while a final answer still arrives.
      // A real answer body or delivered file wins over its old status heading;
      // neither quoted status text nor historical headings trigger recovery.
      if (newestReply) {
        const bodies = allVisible('.markdown, [data-testid="message-content"], [data-markdown-text-style="assistant-message"]', newestReply);
        if (bodies.some(body => String(body.innerText ?? body.textContent ?? '').trim()) || collectMedia(newestReply).length) return false;
        const plainReply = newestReply.cloneNode(true);
        plainReply.querySelectorAll('h4[data-conversation-role="assistant"], .sr-only, button, [role="button"], [role="toolbar"], [data-testid*="thinking"], [data-testid*="reasoning"], [hidden], [aria-hidden="true"]').forEach(element => element.remove());
        for (const element of plainReply.querySelectorAll('span, p, div')) {
          if (/^(?:stopped thinking|stopped generating|response interrupted)$/i.test(String(element.textContent || '').trim())) element.remove();
        }
        if (String(plainReply.textContent || '').trim()) return false;
      }
      return true;
    }

    async function observeReply(task, baseline, submittedUserCount) {
      let candidateNode = null;
      let candidateText = '';
      let candidateSignature = '';
      let changedAt = 0;
      return waitFor(() => {
        if (!navigationValid(task)) {
          // Model changes can briefly replace the route while React keeps the
          // submitted turn. Do not read another conversation, stop generation,
          // or resend. Allow this exact conversation to return first.
          const newest = getTurns(USER_SELECTOR).at(-1);
          const sameOrigin = new URL(win.location.href).origin === new URL(task.url).origin;
          task.navigationDeadline ||= now() + (options.navigationGraceMs || 15000);
          if (sameOrigin && (!newest || sameBaselineUser(newest, task) || sameUserText(newest, task.text, task.requestId)) &&
              now() < task.navigationDeadline) {
            candidateNode = null; candidateText = ''; candidateSignature = ''; changedAt = 0;
            return null;
          }
          const error = new Error('The chat navigated before the reply completed.');
          error.code = 'observation-lost';
          throw error;
        }
        task.navigationDeadline = null;
        const users = getTurns(USER_SELECTOR);
        // The current renderer unmounts old history while adding a turn, then
        // can remount it later. Counts are only a fallback for legacy prompts
        // without a unique marker; a tracked run owns the newest marked turn.
        if (!task.trackingMarker && users.length > submittedUserCount) throw new Error('A new user message appeared while the relay was waiting.');
        const ordered = getTurns(`${USER_SELECTOR}, ${ASSISTANT_SELECTOR}`);
        const lastUser = users[users.length - 1];
        if (!sameUserText(lastUser, task.text, task.requestId)) {
          // Virtualized long tool turns can temporarily unmount the owned
          // user bubble. Keep waiting for its identity without accepting any
          // reply until it returns. A new marked user message still interrupts.
          if (!lastUser || sameBaselineUser(lastUser, task)) return null;
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
        const providerFailure = ownedProviderFailure(lastUser, task);
        if (providerFailure && !['stream-interrupted', 'generation-error', 'timeout', 'delivery-error', 'server-error', 'too-long'].includes(providerFailure.kind)) throw new Error(providerFailure.reason);
        // Hold a terminal provider status for the scheduled supervisor. It is
        // not an answer and must not be accepted as a completed worker result.
        if (ownedResponseInterrupted(lastUser, task, providerFailure)) return null;
        if (ownedConnectionWarning(lastUser, task)) {
          // This provider message promises a reconnect, not a terminal stop.
          // Keep the observer even if Stop briefly unmounts, then require a
          // fresh settling interval once the warning disappears.
          candidateNode = null; candidateText = ''; candidateSignature = ''; changedAt = 0;
          return null;
        }
        const lastUserIndex = ordered.indexOf(lastUser);
        if (lastUserIndex < 0) return null;
        const fresh = ordered.slice(lastUserIndex + 1).filter((element) => element.matches?.(ASSISTANT_SELECTOR)).filter((element) => {
          const oldText = baseline.get(element);
          return oldText === undefined || assistantText(element) !== oldText;
        });
        if (fresh.length === 0) {
          if (!generationBusy() && ownedGenerationFailure(lastUser)) {
            throw Object.assign(new Error('ChatGPT reported "Image generation failed" for this request. No image was produced or relayed.'), { code: 'provider-interrupted', interruptionKind: 'image-generation' });
          }
          return null;
        }
        const node = fresh[fresh.length - 1];
        const value = task.responseFormat === 'control-json' ? controlResponseText(node) : assistantText(node);
        const outputImages = fresh.flatMap(responseNode => allVisible('img', responseNode).filter(outputImageCandidate));
        const pendingImages = outputImages.some((image) => image.complete === false);
        if (pendingImages) return null;
        const brokenImages = outputImages.some((image) => image.complete !== false && (Number(image.naturalWidth) < 64 || Number(image.naturalHeight) < 64));
        // Tools and the final answer can be separate assistant wrappers for
        // one submitted user turn. Keep actual downloads from every owned
        // wrapper, including files produced before the final summary text.
        const entries = collectResponseMedia(fresh);
        const unsupportedDownloads = fresh.flatMap(responseNode => unsupportedGeneratedDownloads(responseNode, entries, outputImages));
        if (!value && entries.length === 0 && !unsupportedDownloads.length && !brokenImages) return null;
        if (value.length > MAX_REPLY_CHARS) throw new Error('The reply is too large to relay safely.');
        const signature = JSON.stringify([fresh.map(responseNode => assistantText(responseNode)), entries.map(entry => entry.fingerprint)]);
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
        if (task.relayMedia && unsupportedDownloads.length) {
          const names = unsupportedDownloads.map(element => downloadableCard(element, element.closest?.(ASSISTANT_SELECTOR) || node, false)?.name || actionFilename(element) || label(element));
          const error = new Error(`This response contains an unsupported generated download that cannot be shared safely: ${names.map(name => name.slice(0, 180)).join(', ')}. Request a supported document/image or a plain-text source file (.txt, .mq5, .mqh, or another supported source extension). No unsupported file was transferred.`);
          error.code = 'unsupported-output';
          throw error;
        }
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
        responseFormat: message.responseFormat === 'control-json' ? 'control-json' : 'text',
        relayMedia: message.relayMedia === true,
        timeoutMs: Math.min(Math.max(Number(message.timeoutMs) || replyTimeoutMs, 15000), 2 * 60 * 60 * 1000)
      };
      const baseline = new Map(getTurns(ASSISTANT_SELECTOR).map((element) => [element, assistantText(element)]));
      const baselineUsers = getTurns(USER_SELECTOR);
      task.baselineProviderRejections = new Map(allVisible(`${PROVIDER_REJECTION_SELECTOR}, [role="status"]`).flatMap(element => {
        // Preserve terminal markers, not copies of every nested historical
        // answer/draft in a long chat. Those copies grow with PDF/tool output.
        const raw = String(element.innerText ?? element.textContent ?? '');
        if (raw.length > 600) return [];
        const value = raw.replace(/\s+/g, ' ').trim();
        return providerRejectionKind(value) || connectionWaiting(value) || /^(?:stopped thinking|stopped generating|response interrupted)$/i.test(value)
          ? [[element, value]] : [];
      }));
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
          if (!navigationValid(task)) throw Object.assign(new Error('The chat navigated before submitting the prompt.'), { code: 'observation-lost' });
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
          if (!navigationValid(task)) throw Object.assign(new Error('The chat navigated while submitting the prompt.'), { code: 'observation-lost' });
          return true;
        }, 15000, task, () => `The page did not confirm the submitted prompt. ${containsFullPrompt(findComposer(), task.text) ? 'The full prompt is still in the composer.' : 'The composer changed or cleared.'} No second submission was attempted.`);
      } catch (error) {
        recordSubmissionDiagnostic(task, 'submission-error');
        const observationLost = error.code === 'observation-lost' || error.message === 'Timed out waiting for the ChatGPT page.';
        if (!observationLost) stopOwnedGeneration(task);
        if (active === task) active = null;
        remember(key, 'failed');
        const details = observationLost ? { observationLost: true, observationUrl: task.acceptedUrl || task.url } : {};
        if (!task.controller.signal.aborted) await emit({ type: 'ERROR', runId: task.runId, requestId: task.requestId, error: error.message, ...details });
        return { ok: false, error: error.message, ...details };
      }
      startReplyObservation(task, baseline, getTurns(USER_SELECTOR).length);
      return { ok: true, observationUrl: task.acceptedUrl || task.url };
    }

    function startReplyObservation(task, baseline, submittedUserCount) {
      const key = taskKey(task);
      const observeOwnedReply = () => observeReply(task, baseline, submittedUserCount).then(async (result) => {
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
        const outputFailure = error.code === 'unsupported-output';
        const observationLost = error.code === 'observation-lost' || error.message === 'Timed out waiting for the ChatGPT page.';
        const newest = getTurns(USER_SELECTOR).at(-1);
        const owned = Boolean(task.submittedUser && newest && sameUserText(newest, task.text, task.requestId) && navigationValid(task));
        const generating = generationBusy();
        if (outputFailure && owned && (generating || ownedConnectionWarning(newest, task) || ownedProviderFailure(newest, task))) {
          // The provider can resume between the settled output observation
          // and this promise continuation. Keep observing the same request;
          // a provisional file-format error never authorizes its Stop button.
          return observeOwnedReply();
        }
        const providerInterrupted = error.code === 'provider-interrupted';
        if (!outputFailure && !observationLost && !providerInterrupted) stopOwnedGeneration(task);
        recordSubmissionDiagnostic(task, 'reply-error');
        active = null;
        remember(key, 'failed');
        await emit({ type: 'ERROR', runId: task.runId, requestId: task.requestId, error: error.message,
          ...(observationLost ? { observationLost: true, observationUrl: task.acceptedUrl || task.url } : {}),
          ...(providerInterrupted && owned && !generating ? { interrupted: true, interruptionKind: error.interruptionKind,
            owned: true, active: false, generationBusy: false, newerUserMessage: false } : {}),
          ...(outputFailure && owned && !generating ? { recoverableOutputFailure: true, owned: true, active: false,
            generationBusy: false, newerUserMessage: false } : {}) });
        publishStatus();
      });
      observeOwnedReply();
    }

    async function resumeObservation(message) {
      if (!validRequest(message) || typeof message.text !== 'string' || !message.text.trim() || message.text.length > MAX_PROMPT_CHARS ||
          !trackingMarker(message.text, message.requestId)) return { ok: false, error: 'An exact tracked request is required to reconnect.' };
      if (cancelledRuns.has(message.runId)) return { ok: false, error: 'This run was cancelled; observation will not resume.' };
      const key = taskKey(message);
      if (active && taskKey(active) === key) return { ok: true, pending: true, observationUrl: active.acceptedUrl || active.url };
      if (active || activeAttachment || stagedUpload) return { ok: false, error: 'This page already owns another operation.' };
      if (['complete', 'cancelled'].includes(recent.get(key))) return { ok: false, error: 'This request was already completed or cancelled.' };
      let expected;
      try { expected = new URL(message.observationUrl); } catch (_) { return { ok: false, error: 'The original conversation address is missing.' }; }
      const current = new URL(win.location.href);
      if (current.origin !== expected.origin || (current.pathname !== expected.pathname && expected.pathname !== '/')) {
        return { ok: false, error: 'Return to the original conversation before reconnecting its request.' };
      }
      const task = { runId: message.runId, requestId: message.requestId, controller: new AbortController(),
        url: message.observationUrl, acceptedUrl: null, acceptedLocalPath: null, submittedUser: null,
        text: message.text, trackingMarker: trackingMarker(message.text, message.requestId), baselineLatestUserValues: [], confirmingIdentity: true,
        responseFormat: message.responseFormat === 'control-json' ? 'control-json' : 'text', relayMedia: message.relayMedia === true,
        timeoutMs: Math.min(Math.max(Number(message.timeoutMs) || replyTimeoutMs, 15000), 2 * 60 * 60 * 1000),
        // Old failures before this user turn cannot authorize recovery. Current
        // owned alerts must remain visible to the supervisor after reload.
        baselineProviderRejections: new Map() };
      active = task;
      try {
        await waitForStage(() => {
          const users = getTurns(USER_SELECTOR);
          const newest = users.at(-1);
          if (!newest) return null;
          sameUserText(newest, task.text, task.requestId); // expand a collapsed owned bubble
          const fullText = normalizePageText(task.text);
          const fullMatch = element => userTextValues(element).some(value => value === fullText || includesMessageText(value, fullText));
          if (!fullMatch(newest)) return null;
          // A duplicate historical turn may be collapsed with its tracking ID
          // hidden. Expand only earlier bubbles sharing this prompt's prefix
          // before counting identity matches; marker-only duplicates are also
          // ambiguous even when their body differs.
          for (const earlier of users.slice(0, -1)) {
            const samePrefix = userTextValues(earlier).some(value => {
              const prefix = value.split(/\s+\.{3}/)[0].trim();
              return prefix.length >= 80 && fullText.startsWith(prefix);
            });
            if (!samePrefix || !userExpandControl(earlier)) continue;
            sameUserText(earlier, task.text, task.requestId);
            if (userExpandControl(earlier)) return null;
          }
          if (users.filter(element => userMessageMatches(element, task.text, task.requestId)).length !== 1) {
            throw new Error('The tracked user turn is ambiguous; observation was not resumed.');
          }
          task.baselineUserCount = Math.max(0, users.length - 1);
          task.submittedUser = newest;
          if (!navigationValid(task)) throw new Error('This is a different conversation; observation was not resumed.');
          return true;
        }, options.resumeIdentityTimeoutMs || 15000, task, 'The newest user turn does not match the complete tracked request. No prompt was resent and no generation was stopped.');
        if (cancelledRuns.has(task.runId)) throw new Error('This run was cancelled.');
        const ordered = getTurns(`${USER_SELECTOR}, ${ASSISTANT_SELECTOR}`);
        const index = ordered.indexOf(task.submittedUser);
        if (index < 0) throw new Error('The owned user turn disappeared before observation could resume.');
        const baseline = new Map(ordered.slice(0, index).filter(element => element.matches?.(ASSISTANT_SELECTOR))
          .map(element => [element, assistantText(element)]));
        if (mediaSnapshotRunId !== task.runId) { clearMediaSnapshots(); mediaSnapshotRunId = task.runId; }
        recent.delete(key);
        task.confirmingIdentity = false;
        startReplyObservation(task, baseline, getTurns(USER_SELECTOR).length);
        publishStatus();
        return { ok: true, resumed: true, observationUrl: task.acceptedUrl || task.url };
      } catch (error) {
        if (active === task) active = null;
        task.controller.abort('Observation could not reconnect.');
        return { ok: false, error: error.message };
      }
    }

    function cancel(message) {
      // A supervisor retires one request; its delayed acknowledgement cannot
      // cancel a freshly assigned request or a new attachment in the same run.
      if (message.cancelRun === false && (!active || active.runId !== message.runId || active.requestId !== message.requestId)) {
        return { ok: true, cancelled: false };
      }
      if (stagedUpload && (!message.runId || !stagedUpload.runId || message.runId === stagedUpload.runId)) clearStagedUpload();
      if (message.cancelRun !== false && typeof message.runId === 'string' && message.runId) {
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

    function inspectProgress(message) {
      const key = taskKey(message);
      const task = active && taskKey(active) === key ? active : interruptedTasks.get(key);
      const status = inspect();
      const generating = generationBusy();
      if (!task) return { ok: true, requestId: message.requestId, owned: false, active: Boolean(active), generating,
        generationBusy: generating, interrupted: false, ready: status.ready, reason: status.reason };
      const newest = getTurns(USER_SELECTOR).at(-1);
      const owned = Boolean(!task.confirmingIdentity && newest && userMessageMatches(newest, task.text, task.requestId) && navigationValid(task));
      const interrupted = owned && status.activeRequestId === task.requestId && status.interrupted;
      const reconnecting = owned && status.activeRequestId === task.requestId && status.reconnecting === true;
      // Preserve the observer while the native provider still advertises an
      // active response. It keeps exact ownership and the terminal receipt;
      // the next supervision check can retire it as soon as Stop clears.
      if (interrupted && !generating && active === task) {
        active = null;
        interruptedTasks.set(key, task);
        while (interruptedTasks.size > 12) interruptedTasks.delete(interruptedTasks.keys().next().value);
        remember(key, 'interrupted');
        task.controller.abort('The provider explicitly reported an interrupted response.');
        publishStatus();
      }
      return { ok: true, requestId: task.requestId, owned, active: active === task, generating, generationBusy: generating,
        reconnecting,
        interrupted, interruptionKind: interrupted ? status.interruptionKind : '',
        awaitingProviderIdle: Boolean(interrupted && generating),
        newerUserMessage: Boolean(newest && !owned && !sameBaselineUser(newest, task)),
        ready: inspect().ready, reason: status.reason,
        visibleResult: interrupted ? 'No completed result was delivered for this request. The provider marked its work interrupted.' : '' };
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
      if (typeof Uint8Array.fromBase64 === 'function') return Uint8Array.fromBase64(base64);
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
      if (!scope) return false;
      const composer = findComposer();
      const widgetSelector = '[data-testid*="attachment"], [data-testid*="file-preview"], [data-testid*="file-upload"], [data-file-name], [data-attachment-id], [data-upload-state]';
      const hasLegacyPreview = (container) => {
        if (container === composer || container.contains?.(composer) || composer?.contains?.(container)) return false;
        if (allVisible('img, [role="img"]', container).some(node => !node.closest?.(TURN_SELECTOR))) return true;
        const nodes = [container, ...allVisible('[title], [aria-label], [alt], span, button, a', container)]
          .filter(node => !node.closest?.(TURN_SELECTOR));
        return nodes.some(node => [label(node), node.getAttribute?.('title'), node.getAttribute?.('aria-label'), node.getAttribute?.('alt')]
          .some(value => typeof value === 'string' && value.trim().length <= 180 && filenameMime(value.trim())));
      };
      return allVisible('[aria-busy="true"], [role="progressbar"], [data-upload-state="uploading"], [data-state="uploading"], [data-testid*="upload-progress"], .animate-spin', scope)
        .some((element) => {
          if (element.closest?.(TURN_SELECTOR)) return false;
          // Explicit upload state is authoritative even before its filename
          // renders. Generic spinners and aria-busy also serve model pickers,
          // voice controls and new-page hydration, so they need file context.
          if (element.getAttribute?.('data-upload-state') === 'uploading' || element.getAttribute?.('data-state') === 'uploading' ||
              /upload-progress/i.test(element.getAttribute?.('data-testid') || '')) return true;
          if (element === composer || element.contains?.(composer) || composer?.contains?.(element)) return false;
          if (/\b(?:upload(?:ing)?|attachments?|file\s+(?:upload|processing))\b/i.test(label(element))) return true;
          const widget = element.closest?.(widgetSelector);
          if (widget && scope.contains?.(widget) && !widget.contains?.(composer)) return true;
          if (allVisible(widgetSelector, element).some(candidate => !candidate.closest?.(TURN_SELECTOR))) return true;
          // Older file cards expose only a plain name or image and a sibling
          // Loading spinner. Stop before the editor's ancestor: a model/voice
          // spinner elsewhere in the composer is unrelated to that file card.
          for (let node = element, depth = 0; node && depth < 7; node = node.parentElement, depth += 1) {
            if (node === composer || node.contains?.(composer) || scope.contains?.(node) === false) break;
            if (hasLegacyPreview(node)) return true;
            if (node === scope) break;
          }
          return false;
        });
    }

    async function uploadFiles(message, requestTask = null, preparedFiles = null) {
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
            typeof item.mimeType !== 'string' || !ALLOWED_MIME.has(item.mimeType) || !preparedFiles && typeof item.base64 !== 'string') {
          return { ok: false, error: 'Unsupported file name or type.' };
        }
        if (names.has(item.name)) return { ok: false, error: 'Attachment file names must be unique within a batch.' };
        names.add(item.name);
        if (preparedFiles) {
          const prepared = preparedFiles[transfer.files.length];
          if (!prepared || prepared.name !== item.name || prepared.type !== item.mimeType || !prepared.size || prepared.size > MAX_FILE_BYTES) return { ok: false, error: 'Invalid prepared attachment.' };
          total += prepared.size;
          if (total > MAX_TOTAL_BYTES) return { ok: false, error: 'File limit is 512 MB each and 1 GB total.' };
          transfer.items.add(prepared); continue;
        }
        // Repeating four-character groups over a multi-MB base64 string can
        // exhaust V8's regexp stack. Bound size first; this single alphabet
        // repetition plus quartet length retains strict padding validation.
        if (item.base64.length > Math.ceil(MAX_INLINE_BYTES / 3) * 4 || item.base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(item.base64)) {
          return { ok: false, error: 'Invalid or oversized file contents.' };
        }
        const bytes = decodeBase64(item.base64);
        if (encodeBase64(bytes) !== item.base64) return { ok: false, error: 'Invalid noncanonical file contents.' };
        total += bytes.byteLength;
        if (!bytes.byteLength || bytes.byteLength > MAX_INLINE_BYTES || total > MAX_TOTAL_BYTES) {
          return { ok: false, error: 'Inline file limit is 128 MB each and 1 GB total; empty files cannot be attached.' };
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
          for (const item of message.files) uploadAttempts.set(item.name, {
            namesBefore: namesBefore.get(item.name), previewsBefore, mimeType: item.mimeType
          });
          while (uploadAttempts.size > 40) uploadAttempts.delete(uploadAttempts.keys().next().value);
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
        }, options.uploadTimeoutMs || 30 * 60 * 1000, waitTask);
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
      } finally {
        if (activeAttachment === waitTask) activeAttachment = null;
        publishStatus();
      }
      return { ok: true, attached: message.files.length };
    }

    function checkAttachments(message) {
      const names = message.names;
      if (!Array.isArray(names) || !names.length || names.length > MAX_ATTACHED_SOURCE_NAMES || new Set(names).size !== names.length ||
          names.some(name => typeof name !== 'string' || !/^[^\\/\x00-\x1f]{1,180}$/.test(name))) return { ok: false, error: 'Invalid attachment check.' };
      const scope = currentAttachmentScope(findComposer());
      if (!scope || active || activeAttachment || generationBusy() || attachmentsProcessing(scope)) return { ok: false, error: 'Attachments or a response are still processing. Wait, then check again.' };
      const failure = attachmentFailure(scope);
      if (failure) return { ok: false, error: `The page rejected an attachment: ${failure}` };
      for (const name of names) {
        if (uploadedFiles.has(name)) continue;
        const attempt = uploadAttempts.get(name);
        if (!attempt) return { ok: false, error: `No owned upload receipt exists for ${name}.` };
        const fresh = [...attachmentNameEvidence(scope, name)].filter(([alias, count]) => count > (attempt.namesBefore?.get(alias) || 0));
        if (fresh.length !== 1) return { ok: false, error: `The completed upload of ${name} is not confirmed. Check that attachment in this chat.` };
        uploadedFiles.set(name, { observedName: fresh[0][0], previousCount: attempt.namesBefore?.get(fresh[0][0]) || 0, element: null, identity: null });
      }
      publishStatus();
      return hasExpectedSources(findComposer(), names) ? { ok: true, attached: names.length } : { ok: false, error: 'A required attachment is no longer present in the composer.' };
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
        case 'INSPECT_PROGRESS':
          sendResponse(inspectProgress(message));
          return false;
        case 'FILE_STAGE_BEGIN':
        case 'FILE_STAGE_CHUNK':
        case 'FILE_STAGE_COMMIT':
        case 'FILE_STAGE_ABORT':
          return respond(stageFile(message), sendResponse);
        case 'CHECK_ATTACHMENTS':
          sendResponse(checkAttachments(message));
          return false;
        case 'RESUME_RUN':
          if (typeof message.runId !== 'string' || !message.runId || message.runId.length > 200 || active || activeAttachment || stagedUpload || generationBusy()) {
            sendResponse({ ok: false, error: 'Wait until the canceled response has stopped before continuing.' });
          } else { cancelledRuns.delete(message.runId); sendResponse({ ok: true }); }
          return false;
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
        case 'RESUME_OBSERVATION':
          return respond(resumeObservation(message), sendResponse);
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
        attributeFilter: ['aria-pressed', 'aria-checked', 'aria-selected', 'aria-current', 'aria-busy', 'data-upload-state', 'data-state', 'data-is-streaming', 'hidden', 'aria-hidden', 'contenteditable', 'placeholder', 'aria-label'] });
    }
    doc.addEventListener?.('input', scheduleStatus, true);
    win.addEventListener?.('pagehide', () => {
      clearStagedUpload();
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
      void emit({ type: 'ERROR', runId: task.runId, requestId: task.requestId, error: 'The chat page closed or navigated.',
        observationLost: true, observationUrl: task.acceptedUrl || task.url });
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

  // Cosmetic failures must never stop the authenticated transport bridge.
  try {
    (() => { const module = { exports: {} }; /* Converge's original procedural galaxy. No images, network requests, or dependencies. */
(function (root) {
  'use strict';
  const VERTEX = 'attribute vec2 position;void main(){gl_Position=vec4(position,0.,1.);}';
  // Bake the unchanged five-octave fields once. They do not depend on time;
  // animation only moves the coordinates at which the fields are sampled.
  const FIELD_KERNEL = `
    float hash(vec2 p){vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
    float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
    float fbm(vec2 p){float v=0.,a=.5;mat2 m=mat2(1.62,1.17,-1.17,1.62);for(int i=0;i<5;i++){v+=a*noise(p);p=m*p+vec2(17.3,9.2);a*=.49;}return v;}
  `;
  const BAKE_FRAGMENT = `
    precision highp float;
    uniform vec2 bakeResolution;
    uniform vec2 fieldExtent;
    uniform float fieldKind;
    ${FIELD_KERNEL}
    void main(){
      vec2 p=(gl_FragCoord.xy/bakeResolution-.5)*fieldExtent;
      if(fieldKind<.5){
        gl_FragColor=vec4(fbm(p+vec2(3.7,1.2)),fbm(p*3.+vec2(1.7,-2.4)),0.,1.);
      }else{
        gl_FragColor=vec4(fbm(p+vec2(9.7,21.3)),fbm(p*2.7+vec2(12.1,-8.6)),fbm(p*1.15+4.),1.);
      }
    }
  `;
  const FRAGMENT = `
    precision highp float;
    uniform vec2 resolution;
    uniform float time;
    uniform float brightness;
    uniform sampler2D backgroundField;
    uniform sampler2D galaxyField;
    uniform vec2 backgroundExtent;
    float hash(vec2 p){vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
    mat2 rotate(float a){float c=cos(a),s=sin(a);return mat2(c,-s,s,c);}
    vec3 stars(vec2 p,float grid,float speed){
      p+=vec2(time*speed,time*speed*.39)+vec2(sin(time*.018),cos(time*.014))*speed*12.;p*=grid;vec2 cell=floor(p),f=fract(p)-.5;
      float h=hash(cell+31.7),h2=hash(cell+77.1);vec2 offset=(vec2(h,h2)-.5)*.64;
      float d=length(f-offset),size=mix(.017,.055,pow(h,13.));
      float pin=exp(-d*d/(size*size)),glow=.035*exp(-d*d/(size*size*35.));
      float twinkle=.66+.34*sin(time*(.45+h*1.5)+h2*40.);
      vec3 color=mix(vec3(.47,.72,1.),vec3(1.,.67,.91),h2);
      float flare=pow(h,44.)*.010/(abs(f.x-offset.x)*abs(f.y-offset.y)*150.+.09)*exp(-d*15.);
      flare*=1.+(1.-step(20.,grid))*2.6*pow(.5+.5*sin(time*.85+h2*17.),6.);
      return color*(pin+glow+flare)*twinkle*step(.36,h);
    }
    vec3 orbitalComet(vec2 q,float radius,float rate,float offset,vec3 color){
      float angle=atan(q.y,q.x),phase=time*rate+offset;
      float delta=mod(angle-phase+3.141593,6.283185)-3.141593;
      float radial=length(q)-radius;
      float tail=smoothstep(-.74,-.57,delta)*(1.-smoothstep(-.015,.065,delta))*exp(-max(-delta,0.)*4.4);
      float streak=exp(-radial*radial*65000.)*tail*.20;
      float haze=exp(-radial*radial*5500.)*tail*.032;
      float head=exp(-radial*radial*36000.-delta*delta*2800.)*1.12;
      float pulse=.68+.32*sin(time*.041+offset*2.);
      return color*(streak+haze+head)*pulse;
    }
    vec3 foregroundGlint(vec2 p,vec2 origin,float phase){
      vec2 center=origin+vec2(sin(time*.055+phase),cos(time*.041+phase))*.032;
      vec2 ray=p-center;float d=length(ray);
      float beat=.12+.88*pow(.5+.5*sin(time*.71+phase),5.);
      float core=exp(-d*d*90000.)*.64;
      float sparkle=.009/(abs(ray.x)*abs(ray.y)*17000.+.035)*exp(-d*68.);
      return mix(vec3(.55,.84,1.),vec3(.92,.66,1.),.5+.5*sin(phase))*(core+sparkle)*beat;
    }
    vec3 meteor(vec2 p,float offset,float period,vec2 start,vec2 velocity){
      float phase=mod(time+offset,period);
      float active=smoothstep(0.,.3,phase)*(1.-smoothstep(1.05,1.8,phase));
      vec2 head=start+velocity*phase;
      vec2 tangent=normalize(velocity),ray=p-head;
      float along=dot(ray,tangent),across=dot(ray,vec2(-tangent.y,tangent.x));
      float trail=exp(-across*across*240000.)*exp(-abs(along)*14.)*(1.-step(0.,along));
      float pin=exp(-dot(ray,ray)*125000.);
      return vec3(.63,.84,1.)*(trail*.5+pin*.65)*active;
    }
    void main(){
      vec2 uv=gl_FragCoord.xy/resolution, p=(uv-.5)*vec2(resolution.x/resolution.y,1.);
      vec2 drift=vec2(sin(time*.011),cos(time*.009))*.08;
      vec2 flow=p*2.2+drift;
      vec2 cloudField=texture2D(backgroundField,flow/backgroundExtent+.5).rg;
      float n=cloudField.r,wisps=cloudField.g;
      vec3 color=vec3(.009,.012,.045);
      float cloud=pow(max(0.,n-.24),2.)*1.45;
      color+=mix(vec3(.05,.12,.70),vec3(.56,.025,.68),smoothstep(.32,.68,wisps))*cloud;
      color+=vec3(.04,.33,.55)*pow(max(0.,wisps-.43),2.)*1.1;

      vec2 q=rotate(-.22+sin(time*.006)*.025)*(p-vec2(.015,.015));
      q*=.82;q.y*=1.58;float r=length(q),a=atan(q.y,q.x);
      float turn=a-r*7.6-time*.055;
      vec2 warped=rotate(time*.016)*q*6.3;
      // The disk ends at r=1.34, hence every visible warped coordinate is
      // within +/-8.442. The cached square has a margin beyond that circle.
      vec3 detail=texture2D(galaxyField,warped/17.3+.5).rgb;
      float grain=detail.r;
      float filament=detail.g;
      float arms=pow(.5+.5*cos(turn*3.+grain*.95),3.5);
      float ribbons=pow(.5+.5*cos(turn*9.+grain*2.),12.);
      float disk=exp(-r*2.65)*(1.-smoothstep(.19,1.34,r));
      float fog=pow(max(grain-.20,0.),1.5);
      vec3 violet=vec3(.49,.075,1.05),pink=vec3(1.22,.055,.62),blue=vec3(.04,.68,1.15);
      float hue=.5+.5*sin(turn*2.+r*7.+filament*4.);
      vec3 armColor=mix(violet,pink,smoothstep(.18,.82,hue));
      armColor=mix(armColor,blue,smoothstep(.60,.95,filament));
      color+=armColor*disk*(.15+arms*2.2)*fog*3.5;
      color+=vec3(.73,.55,1.)*ribbons*disk*(.22+grain)*.55;
      float lace=pow(max(filament-.53,0.)*2.8,2.2);
      color+=mix(vec3(.44,.8,1.),vec3(1.,.57,.94),hue)*lace*disk*(.2+arms)*1.6;
      float dust=pow(max(0.,.61-detail.b),3.0)*15.;
      color*=1.-clamp(dust*disk*.6,0.,.65);
      float core=exp(-r*r*99.);
      color+=vec3(1.0,.78,.98)*core*3.7+vec3(.39,.30,.75)*exp(-r*r*12.)*.34;
      color+=stars(p,132.,.0006)*.38+stars(p,82.,.0012)*.64+stars(p,39.,.0029)*.74+stars(p,16.,.0048)*.82;
      color+=orbitalComet(q,.48,.105,.72,vec3(.45,.83,1.));
      color+=orbitalComet(q,.73,-.078,3.86,vec3(.88,.58,1.));
      color+=orbitalComet(q,.94,.055,1.98,vec3(.59,.70,1.));
      color+=foregroundGlint(p,vec2(-.64,.30),.8)+foregroundGlint(p,vec2(.67,-.30),3.4)+foregroundGlint(p,vec2(-.41,-.28),5.2);
      color+=meteor(p,8.,22.,vec2(-.67,.29),vec2(.87,-.42));
      color+=meteor(p,17.,31.,vec2(.70,.37),vec2(-.82,-.51))*.7;
      float vignette=1.-smoothstep(.5,1.65,length(p))*.28;
      color=1.-exp(-color*brightness*1.14);
      color=pow(color,vec3(.89))*vignette;
      gl_FragColor=vec4(color,1.);
    }
  `;

  function compile(gl, type, code) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, code); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const error = gl.getShaderInfoLog(shader); gl.deleteShader(shader); throw new Error(error || 'Galaxy shader failed');
    }
    return shader;
  }

  function create(canvas, options) {
    if (!canvas || typeof canvas.getContext !== 'function') throw new TypeError('Galaxy needs a canvas');
    const opts = options || {};
    const doc = canvas.ownerDocument;
    const win = doc.defaultView || root;
    const originalVisibility = canvas.style.visibility;
    const brightness = Number.isFinite(opts.brightness) ? Math.min(2, Math.max(.15, opts.brightness)) : 1.15;
    const fps = Math.min(30, Math.max(12, Number(opts.fps) || 30));
    let gl, program, buffer, vertex, fragment, ctx, fallbackCanvas, renderCanvas = canvas;
    let bakeProgram, bakeFragment, bakeFramebuffer, backgroundField, galaxyField;
    let mode = 'webgl', error = null, disposed = false, paused = opts.startPaused === true, contextLost = false;
    let raf = 0, frameCount = 0, lastFrame = -Infinity, elapsed = 0, previousTime = null;
    let width = 0, height = 0, drawWidth = 0, drawHeight = 0, resizeObserver, sizeDirty = true;
    let resolutionLocation, timeLocation, brightnessLocation, backgroundExtentLocation;
    let bakeResolutionLocation, fieldExtentLocation, fieldKindLocation;
    let maxTextureSize = 0, bakeCount = 0, fieldBytes = 0;
    let background, galaxy, stars = [], glows = [];
    const start = performance.now();

    function cleanupGL() {
      if (gl && !contextLost) {
        if (buffer) gl.deleteBuffer(buffer);
        if (program) gl.deleteProgram(program);
        if (vertex) gl.deleteShader(vertex);
        if (fragment) gl.deleteShader(fragment);
        if (bakeProgram) gl.deleteProgram(bakeProgram);
        if (bakeFragment) gl.deleteShader(bakeFragment);
        if (bakeFramebuffer) gl.deleteFramebuffer(bakeFramebuffer);
        if (backgroundField) gl.deleteTexture(backgroundField);
        if (galaxyField) gl.deleteTexture(galaxyField);
      }
      buffer = program = vertex = fragment = null;
      bakeProgram = bakeFragment = bakeFramebuffer = backgroundField = galaxyField = null;
      fieldBytes = 0;
    }
    function bindQuad(selectedProgram) {
      gl.useProgram(selectedProgram); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      const position = gl.getAttribLocation(selectedProgram, 'position');
      gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    }
    function bakeField(existing, textureWidth, textureHeight, extentX, extentY, kind) {
      const result = existing || gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, result);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, textureWidth, textureHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, bakeFramebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, result, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        if (!existing) gl.deleteTexture(result);
        throw new Error('Galaxy field framebuffer unavailable');
      }
      bindQuad(bakeProgram); gl.viewport(0, 0, textureWidth, textureHeight);
      gl.uniform2f(bakeResolutionLocation, textureWidth, textureHeight);
      gl.uniform2f(fieldExtentLocation, extentX, extentY); gl.uniform1f(fieldKindLocation, kind);
      const dither = gl.isEnabled(gl.DITHER); gl.disable(gl.DITHER);
      gl.drawArrays(gl.TRIANGLES, 0, 6); if (dither) gl.enable(gl.DITHER);
      bakeCount++;
      return result;
    }
    function prepareFields() {
      // The background domain follows aspect ratio so even extremely wide or
      // tall windows retain the same noise rather than clamping or repeating.
      const extentX = 2.2 * drawWidth / drawHeight + .20, extentY = 2.40;
      const textureWidth = Math.min(maxTextureSize, Math.max(64, Math.ceil(drawWidth * 1.5)));
      const textureHeight = Math.min(maxTextureSize, Math.max(64, Math.ceil(drawHeight * 1.5)));
      backgroundField = bakeField(backgroundField, textureWidth, textureHeight, extentX, extentY, 0);
      const detailSize = Math.min(2048, maxTextureSize);
      if (!galaxyField) galaxyField = bakeField(null, detailSize, detailSize, 17.3, 17.3, 1);
      fieldBytes = 4 * (textureWidth * textureHeight + detailSize * detailSize);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); bindQuad(program);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, backgroundField);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, galaxyField);
      gl.uniform2f(backgroundExtentLocation, extentX, extentY);
      gl.viewport(0, 0, drawWidth, drawHeight);
    }
    function initGL() {
      gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false, powerPreference: 'low-power' });
      if (!gl) throw new Error('WebGL unavailable');
      mode = 'webgl'; renderCanvas = canvas;
      if (fallbackCanvas) { fallbackCanvas.remove(); fallbackCanvas = null; canvas.style.visibility = originalVisibility; }
      vertex = compile(gl, gl.VERTEX_SHADER, VERTEX);
      fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
      program = gl.createProgram(); gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || 'Galaxy shader link failed');
      buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
      bindQuad(program);
      resolutionLocation = gl.getUniformLocation(program, 'resolution'); timeLocation = gl.getUniformLocation(program, 'time'); brightnessLocation = gl.getUniformLocation(program, 'brightness');
      gl.uniform1f(brightnessLocation, brightness);
      backgroundExtentLocation = gl.getUniformLocation(program, 'backgroundExtent');
      gl.uniform1i(gl.getUniformLocation(program, 'backgroundField'), 0);
      gl.uniform1i(gl.getUniformLocation(program, 'galaxyField'), 1);
      bakeFragment = compile(gl, gl.FRAGMENT_SHADER, BAKE_FRAGMENT);
      bakeProgram = gl.createProgram(); gl.attachShader(bakeProgram, vertex); gl.attachShader(bakeProgram, bakeFragment); gl.linkProgram(bakeProgram);
      if (!gl.getProgramParameter(bakeProgram, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(bakeProgram) || 'Galaxy bake shader link failed');
      bakeResolutionLocation = gl.getUniformLocation(bakeProgram, 'bakeResolution');
      fieldExtentLocation = gl.getUniformLocation(bakeProgram, 'fieldExtent'); fieldKindLocation = gl.getUniformLocation(bakeProgram, 'fieldKind');
      bakeFramebuffer = gl.createFramebuffer(); maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
      drawWidth = drawHeight = 0; sizeDirty = true; measure();
    }

    function fract(n) { return n - Math.floor(n); }
    function hash2(x, y) { return fract(Math.sin(x * 127.1 + y * 311.7) * 43758.5453); }
    function noise2(x, y) {
      const ix = Math.floor(x), iy = Math.floor(y); let fx = fract(x), fy = fract(y);
      fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
      const a = hash2(ix, iy), b = hash2(ix + 1, iy), c = hash2(ix, iy + 1), d = hash2(ix + 1, iy + 1);
      return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
    }
    function fbm2(x, y) {
      let value = 0, amplitude = .5;
      for (let octave = 0; octave < 4; octave++) { value += noise2(x,y) * amplitude; const nx = x * 1.62 - y * 1.17 + 17.3; y = x * 1.17 + y * 1.62 + 9.2; x = nx; amplitude *= .49; }
      return value;
    }
    function texture(size, type) {
      const surface = doc.createElement('canvas'); surface.width = size; surface.height = size;
      const surfaceCtx = surface.getContext('2d'); const pixels = surfaceCtx.createImageData(size, size);
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const px = (x / size - .5) * 2.5, py = (y / size - .5) * 2.5;
        const n = fbm2(px*3+9.7,py*3+21.3), fine = fbm2(px*9+12.1,py*9-8.6);
        let red, green, blue, alpha = 1;
        if (type === 'background') {
          const cloud = Math.pow(Math.max(0,n-.22),2)*1.65;
          red = .03 + cloud * (.21+fine*.6); green = .035 + cloud*(.18+(1-fine)*.20); blue = .12+cloud*.96;
        } else {
          const radius = Math.hypot(px,py)*.82, angle = Math.atan2(py,px)-radius*7.6;
          const arms = Math.pow(.5+.5*Math.cos(angle*3+n*.95),3.5);
          const ribbons = Math.pow(.5+.5*Math.cos(angle*9+n*2),12);
          const disk = Math.exp(-radius*2.65) * Math.max(0,Math.min(1,(1.28-radius)*3));
          const hue = .5+.5*Math.sin(angle*2+radius*7+fine*4), fog = Math.pow(Math.max(n-.20,0),1.5);
          const intensity = disk * (.15+arms*2.2)*fog*4.4;
          const blueGlow = Math.max(0,fine-.53)*3;
          const core = Math.exp(-radius*radius*99)*3.7, ribbonLight=ribbons*disk*(.22+n)*.55;
          red = (.49 + hue*.73)*intensity+blueGlow*disk*.4+core+ribbonLight*.73;
          green = (.075+Math.max(0,fine-.60)*1.5)*intensity+blueGlow*disk*.55+core*.78+ribbonLight*.55;
          blue = (1.05-hue*.43)*intensity+blueGlow*disk*.8+core*.98+ribbonLight;
          const dust = Math.max(0,.61-fbm2(px*3.5+4,py*3.5+4));
          const dim = 1-Math.min(.6,dust*dust*dust*18*disk); red*=dim;green*=dim;blue*=dim;
          alpha = Math.min(1,disk*2.5);
        }
        const i = (y*size+x)*4;
        pixels.data[i] = Math.pow(1-Math.exp(-red*brightness*1.14),.89)*255;
        pixels.data[i+1] = Math.pow(1-Math.exp(-green*brightness*1.14),.89)*255;
        pixels.data[i+2] = Math.pow(1-Math.exp(-blue*brightness*1.14),.89)*255;
        pixels.data[i+3] = alpha*255;
      }
      surfaceCtx.putImageData(pixels,0,0); return surface;
    }
    function initFallback() {
      mode = 'canvas2d'; cleanupGL();
      drawWidth = drawHeight = 0; sizeDirty = true;
      // A canvas cannot change context types after WebGL allocation. Use an owned sibling only in that case.
      ctx = !gl && canvas.getContext('2d', { alpha: false });
      if (!ctx) {
        fallbackCanvas = doc.createElement('canvas'); fallbackCanvas.setAttribute('aria-hidden','true');
        fallbackCanvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;';
        canvas.insertAdjacentElement('afterend',fallbackCanvas); canvas.style.visibility = 'hidden';
        renderCanvas = fallbackCanvas; ctx = renderCanvas.getContext('2d', { alpha: false });
      }
      if (!ctx) throw new Error('No canvas renderer available');
      background = texture(256, 'background'); galaxy = texture(448, 'galaxy');
      stars = Array.from({length:360}, (_,i) => ({x:hash2(i,31),y:hash2(i,73),z:.2+hash2(i,51)*.8,size:hash2(i,23),phase:hash2(i,97)*Math.PI*2}));
      glows = ['#9bd6ff','#efb5ff','#ffffff'].map(color => {
        const sprite = doc.createElement('canvas'); sprite.width = sprite.height = 40;
        const paint = sprite.getContext('2d'), gradient = paint.createRadialGradient(20,20,0,20,20,20);
        gradient.addColorStop(0,'#ffffff');gradient.addColorStop(.07,color);gradient.addColorStop(.22,color+'99');gradient.addColorStop(1,color+'00');
        paint.fillStyle = gradient;paint.fillRect(0,0,40,40);return sprite;
      });
    }

    function measure() {
      if (!sizeDirty) return;
      sizeDirty = false;
      const rect = canvas.getBoundingClientRect();
      const nextWidth = Math.max(1, Math.round(rect.width || canvas.clientWidth || 1));
      const nextHeight = Math.max(1, Math.round(rect.height || canvas.clientHeight || 1));
      const ratio = Math.min(1.25, Number(win.devicePixelRatio) || 1);
      const scale = Math.min(ratio, 1050/nextWidth, 720/nextHeight);
      const nextDrawWidth = Math.max(1, Math.round(nextWidth*scale)), nextDrawHeight = Math.max(1,Math.round(nextHeight*scale));
      if (nextDrawWidth === drawWidth && nextDrawHeight === drawHeight && nextWidth === width && nextHeight === height) return;
      width = nextWidth; height = nextHeight; drawWidth = nextDrawWidth; drawHeight = nextDrawHeight;
      renderCanvas.width = drawWidth; renderCanvas.height = drawHeight;
      if (mode === 'webgl' && !contextLost) prepareFields();
    }
    function drawFallback(t) {
      ctx.globalAlpha=1; ctx.globalCompositeOperation='source-over'; ctx.fillStyle='#050719';ctx.fillRect(0,0,drawWidth,drawHeight);
      const zoom = Math.max(drawWidth,drawHeight)*1.48;
      ctx.drawImage(background,(drawWidth-zoom)/2+Math.sin(t*.011)*24,(drawHeight-zoom)/2+Math.cos(t*.009)*20,zoom,zoom);
      ctx.save();ctx.translate(drawWidth*.515,drawHeight*.48);ctx.rotate(-.22+Math.sin(t*.006)*.025);ctx.scale(1,.63);
      ctx.rotate(-t*.022);ctx.globalCompositeOperation='screen';const diameter = drawHeight*2.10;
      ctx.drawImage(galaxy,-diameter/2,-diameter/2,diameter,diameter);ctx.restore();
      ctx.globalCompositeOperation='screen';
      for (let i=0;i<stars.length;i++) {
        const star=stars[i]; const sx=fract(star.x+t*.0007*star.z+Math.sin(t*.018)*.012*star.z)*drawWidth,sy=fract(star.y+t*.00027*star.z+Math.cos(t*.014)*.012*star.z)*drawHeight;
        const twinkle=.55+.45*Math.sin(t*(.45+star.z*1.5)+star.phase);const size=star.size>.96?13:star.size>.87?6:2;
        ctx.globalAlpha=(.35+.65*star.z)*twinkle;ctx.drawImage(glows[i%3],sx-size/2,sy-size/2,size,size);
        if(size>6){ctx.strokeStyle='#e3e8ff';ctx.lineWidth=.5;ctx.beginPath();ctx.moveTo(sx-5,sy);ctx.lineTo(sx+5,sy);ctx.moveTo(sx,sy-5);ctx.lineTo(sx,sy+5);ctx.stroke();}
      }
      drawOrbitalComet(t,.48,.105,.72,'#a0ddff',0);
      drawOrbitalComet(t,.73,-.078,3.86,'#d8abff',1);
      drawOrbitalComet(t,.94,.055,1.98,'#c1cfff',0);
      drawForegroundGlint(t,-.64,.30,.8,0);
      drawForegroundGlint(t,.67,-.30,3.4,1);
      drawForegroundGlint(t,-.41,-.28,5.2,0);
      drawMeteor(t,8,22,-.67,.29,.87,-.42,1);
      drawMeteor(t,17,31,.70,.37,-.82,-.51,.7);
      ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';
    }
    function drawOrbitalComet(t,radius,rate,offset,color,sprite) {
      const phase=-(t*rate+offset),r=drawHeight*radius/.82,pulse=.68+.32*Math.sin(t*.041+offset*2);
      ctx.save();ctx.translate(drawWidth*.515,drawHeight*.48);ctx.rotate(-.22+Math.sin(t*.006)*.025);ctx.scale(1,1/1.58);
      ctx.strokeStyle=color;ctx.lineWidth=.85;
      for(let i=0;i<18;i++){const a=i*.037;ctx.globalAlpha=.34*Math.exp(-a*4.4)*pulse*(1-Math.max(0,(a-.57)/.14));ctx.beginPath();ctx.arc(0,0,r,phase+a,phase+a+.039);ctx.stroke();}
      const sx=Math.cos(phase)*r,sy=Math.sin(phase)*r;ctx.globalAlpha=pulse*.85;ctx.drawImage(glows[sprite],sx-10,sy-10,20,20);ctx.fillStyle='#e5e9ff';ctx.beginPath();ctx.arc(sx,sy,1.25,0,Math.PI*2);ctx.fill();ctx.restore();
    }
    function drawForegroundGlint(t,x,y,phase,sprite) {
      const sx=drawWidth*.5+(x+Math.sin(t*.055+phase)*.032)*drawHeight,sy=drawHeight*(.5-y-Math.cos(t*.041+phase)*.032);
      const beat=.12+.88*Math.pow(.5+.5*Math.sin(t*.71+phase),5);
      ctx.globalAlpha=beat*.85;ctx.drawImage(glows[sprite],sx-13,sy-13,26,26);
      ctx.globalAlpha=beat*.64;ctx.strokeStyle=sprite?'#e7c5ff':'#cceeff';ctx.lineWidth=.65;ctx.beginPath();ctx.moveTo(sx-10,sy);ctx.lineTo(sx+10,sy);ctx.moveTo(sx,sy-10);ctx.lineTo(sx,sy+10);ctx.stroke();
    }
    function drawMeteor(t,offset,period,x,y,vx,vy,intensity) {
      const phase=(t+offset)%period;if(phase>=1.8)return;
      const active=Math.min(1,phase/.3)*Math.max(0,Math.min(1,(1.8-phase)/.75));
      const sx=drawWidth*.5+(x+vx*phase)*drawHeight,sy=drawHeight*(.5-y-vy*phase),distance=Math.hypot(vx,vy);
      const tx=vx/distance*92,ty=-vy/distance*92;
      const gradient=ctx.createLinearGradient(sx-tx,sy-ty,sx,sy);gradient.addColorStop(0,'#b8ddff00');gradient.addColorStop(1,'#d5e8ff');
      ctx.globalAlpha=active*.7*intensity;ctx.strokeStyle=gradient;ctx.lineWidth=1.4;ctx.beginPath();ctx.moveTo(sx-tx,sy-ty);ctx.lineTo(sx,sy);ctx.stroke();ctx.drawImage(glows[0],sx-4,sy-4,8,8);
    }
    function draw() {
      if (disposed || contextLost) return;
      try { measure(); }
      catch(failure) {
        if(mode!=='webgl')throw failure;
        error=String(failure.message||failure);initFallback();measure();
      }
      if (mode === 'webgl') { gl.uniform2f(resolutionLocation,drawWidth,drawHeight);gl.uniform1f(timeLocation,elapsed);gl.drawArrays(gl.TRIANGLES,0,6); }
      else drawFallback(elapsed);
      frameCount++;
    }
    function tick(now) {
      raf = 0;
      if (disposed || paused || doc.hidden || contextLost) { previousTime=null;return; }
      if (previousTime !== null) elapsed+=Math.min(.15,(now-previousTime)/1000);
      previousTime=now;
      if(now-lastFrame>=1000/fps-1){draw();lastFrame=now;}
      raf=win.requestAnimationFrame(tick);
    }
    function schedule() { if(!disposed&&!paused&&!doc.hidden&&!contextLost&&!raf) raf=win.requestAnimationFrame(tick); }
    function onVisibility() { if(doc.hidden){win.cancelAnimationFrame(raf);raf=0;previousTime=null;}else schedule(); }
    function onLost(event) { event.preventDefault();contextLost=true;win.cancelAnimationFrame(raf);raf=0;previousTime=null;cleanupGL(); }
    function onRestored() {
      contextLost=false;
      try { initGL();draw();schedule(); }
      catch(failure){error=String(failure.message||failure);initFallback();drawWidth=drawHeight=0;sizeDirty=true;draw();schedule();}
    }
    try { if(opts.forceCanvas2D) throw new Error('Canvas2D explicitly selected');initGL(); }
    catch(failure){error=String(failure.message||failure);initFallback();}
    canvas.addEventListener('webglcontextlost',onLost);canvas.addEventListener('webglcontextrestored',onRestored);
    doc.addEventListener('visibilitychange',onVisibility);
    function onResize(){sizeDirty=true;if(paused||doc.hidden)draw();}
    if (typeof win.ResizeObserver === 'function') { resizeObserver=new win.ResizeObserver(onResize);resizeObserver.observe(canvas); }
    win.addEventListener('resize',onResize);
    draw();schedule();
    return Object.freeze({
      setPaused(value){paused=Boolean(value);if(paused){win.cancelAnimationFrame(raf);raf=0;previousTime=null;}else schedule();},
      diagnostics(){return {supported:true,mode,paused,disposed,contextLost,frames:frameCount,seconds:Number(elapsed.toFixed(3)),fpsLimit:fps,width:drawWidth,height:drawHeight,ageMs:Math.round(performance.now()-start),fallbackReason:error,fieldBakes:bakeCount,fieldTextureBytes:fieldBytes};},
      dispose(){if(disposed)return;disposed=true;win.cancelAnimationFrame(raf);raf=0;doc.removeEventListener('visibilitychange',onVisibility);win.removeEventListener('resize',onResize);canvas.removeEventListener('webglcontextlost',onLost);canvas.removeEventListener('webglcontextrestored',onRestored);if(resizeObserver)resizeObserver.disconnect();cleanupGL();if(fallbackCanvas){fallbackCanvas.remove();canvas.style.visibility=originalVisibility;}background=galaxy=null;stars=[];glows=[];}
    });
  }
  root.ConvergeGalaxy = Object.freeze({create,supported:typeof root.document!=='undefined',version:'2.2.0'});
})(globalThis);

/* Cosmetic desktop page appearance. This module never reads chat text or
 * changes editors, controls, privacy settings, cookies, or exchange state. */
(function installConvergePageAppearance(global) {
  'use strict';
  const CLASS = 'converge-galaxy-page';
  const STYLE_ID = 'converge-page-galaxy-style';
  const LAYER_ID = 'converge-page-galaxy';
  const LAYOUT = 'data-converge-galaxy-layout';
  const TURN_SELECTOR = 'article[data-testid^="conversation-turn"], [data-message-author-role]';
  const EDITOR_SELECTOR = '#prompt-textarea, [data-testid="prompt-textarea"], main [contenteditable="true"][role="textbox"]';
  const CSS = `
    html.${CLASS} { background: #070a1d !important; }
    html.${CLASS} body { background: transparent !important; isolation: isolate; }
    html.${CLASS} #${LAYER_ID} {
      position: fixed; inset: 0; z-index: -1; overflow: hidden;
      pointer-events: none !important; user-select: none;
      background: radial-gradient(ellipse at 76% 28%, #7624b8 0%, transparent 56%),
        radial-gradient(ellipse at 20% 74%, #0879a8 0%, transparent 61%), #070a1d;
    }
    html.${CLASS} #${LAYER_ID} canvas {
      display: block; width: 100%; height: 100%; pointer-events: none !important;
    }
    html.${CLASS}[data-converge-chat-theme="horror"] { background: #050405 !important; }
    html.${CLASS}[data-converge-chat-theme="horror"] #${LAYER_ID} {
      background: radial-gradient(ellipse at 50% 115%, rgba(126, 12, 28, .42), transparent 58%),
        radial-gradient(ellipse at 14% 15%, rgba(63, 39, 54, .3), transparent 45%), #050405;
    }
    html.${CLASS}[data-converge-chat-theme="alien"] { background: #041512 !important; }
    html.${CLASS}[data-converge-chat-theme="alien"] #${LAYER_ID} {
      background: radial-gradient(circle at 79% 19%, #cbffd5 0%, #62d6bd 1.7%, #206355 1.9%, transparent 2.6%),
        radial-gradient(ellipse at 13% 82%, rgba(74, 25, 113, .58), transparent 56%),
        radial-gradient(ellipse at 76% 63%, rgba(6, 113, 87, .46), transparent 60%), #041512;
    }
    /* Local still artwork: no external fetches, blur filters or frame loop. */
    html.${CLASS}[data-converge-chat-theme="cyberpunk"] { background: #071526 !important; }
    html.${CLASS}[data-converge-chat-theme="cyberpunk"] #${LAYER_ID} {
      background: linear-gradient(180deg, rgba(3, 8, 23, .13), rgba(3, 8, 23, .24)), url("data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%221200%22%20height%3D%22900%22%20viewBox%3D%220%200%201200%20900%22%3E%3Cdefs%3E%3ClinearGradient%20id%3D%22sky%22%20x2%3D%22.7%22%20y2%3D%221%22%3E%3Cstop%20stop-color%3D%22%23071526%22%2F%3E%3Cstop%20offset%3D%22.56%22%20stop-color%3D%22%23281430%22%2F%3E%3Cstop%20offset%3D%221%22%20stop-color%3D%22%230b1428%22%2F%3E%3C%2FlinearGradient%3E%3CradialGradient%20id%3D%22haze%22%3E%3Cstop%20stop-color%3D%22%23b848a1%22%20stop-opacity%3D%22.23%22%2F%3E%3Cstop%20offset%3D%221%22%20stop-color%3D%22%23b848a1%22%20stop-opacity%3D%220%22%2F%3E%3C%2FradialGradient%3E%3ClinearGradient%20id%3D%22floor%22%20x2%3D%220%22%20y2%3D%221%22%3E%3Cstop%20stop-color%3D%22%23173349%22%2F%3E%3Cstop%20offset%3D%221%22%20stop-color%3D%22%23071120%22%2F%3E%3C%2FlinearGradient%3E%3C%2Fdefs%3E%3Cpath%20fill%3D%22url(%23sky)%22%20d%3D%22M0%200h1200v900H0z%22%2F%3E%3Cellipse%20cx%3D%22660%22%20cy%3D%22305%22%20rx%3D%22550%22%20ry%3D%22325%22%20fill%3D%22url(%23haze)%22%2F%3E%3Ccircle%20cx%3D%2271%22%20cy%3D%2239%22%20r%3D%221.3%22%20fill%3D%22%23cde9ff%22%20opacity%3D%220.18%22%2F%3E%3Ccircle%20cx%3D%22228%22%20cy%3D%2298%22%20r%3D%220.65%22%20fill%3D%22%23cde9ff%22%20opacity%3D%220.27%22%2F%3E%3Ccircle%20cx%3D%22385%22%20cy%3D%22157%22%20r%3D%220.65%22%20fill%3D%22%23cde9ff%22%20opacity%3D%220.36%22%2F%3E%3Ccircle%20cx%3D%22542%22%20cy%3D%22216%22%20r%3D%220.65%22%20fill%3D%22%23cde9ff%22%20opacity%3D%220.45%22%2F%3E%3Ccircle%20cx%3D%22699%22%20cy%3D%22275%22%20r%3D%220.65%22%20fill%3D%22%23cde9ff%22%20opacity%3D%220.54%22%2F%3E%3Ccircle%20cx%3D%22856%22%20cy%3D%2244%22%20r%3D%220.65%22%20fill%3D%22%23cde9ff%22%20opacity%3D%220.18%22%2F%3E%3Ccircle%20cx%3D%221013%22%20cy%3D%22103%22%20r%3D%221.3%22%20fill%3D%22%23cde9ff%22%20opacity%3D%220.27%22%2F%3E%3Ccircle%20cx%3D%221170%22%20cy%3D%22162%22%20r%3D%220.65%22%20fill%3D%22%23cde9ff%22%20opacity%3D%220.36%22%2F%3E%3Ccircle%20cx%3D%22127%22%20cy%3D%22221%22%20r%3D%220.65%22%20fill%3D%22%23cde9ff%22%20opacity%3D%220.45%22%2F%3E%3Ccircle%20cx%3D%22284%22%20cy%3D%22280%22%20r%3D%220.65%22%20fill%3D%22%23cde9ff%22%20opacity%3D%220.54%22%2F%3E%3Ccircle%20cx%3D%22441%22%20cy%3D%2249%22%20r%3D%220.65%22%20fill%3D%22%23cde9ff%22%20opacity%3D%220.18%22%2F%3E%3Ccircle%20cx%3D%22598%22%20cy%3D%22108%22%20r%3D%220.65%22%20fill%3D%22%23cde9ff%22%20opacity%3D%220.27%22%2F%3E%3Ccircle%20cx%3D%22755%22%20cy%3D%22167%22%20r%3D%221.3%22%20fill%3D%22%23cde9ff%22%20opacity%3D%220.36%22%2F%3E%3Ccircle%20cx%3D%22912%22%20cy%3D%22226%22%20r%3D%220.65%22%20fill%3D%22%23cde9ff%22%20opacity%3D%220.45%22%2F%3E%3Ccircle%20cx%3D%221069%22%20cy%3D%22285%22%20r%3D%220.65%22%20fill%3D%22%23cde9ff%22%20opacity%3D%220.54%22%2F%3E%3Ccircle%20cx%3D%2226%22%20cy%3D%2254%22%20r%3D%220.65%22%20fill%3D%22%23cde9ff%22%20opacity%3D%220.18%22%2F%3E%3Ccircle%20cx%3D%22183%22%20cy%3D%22113%22%20r%3D%220.65%22%20fill%3D%22%23cde9ff%22%20opacity%3D%220.27%22%2F%3E%3Ccircle%20cx%3D%22340%22%20cy%3D%22172%22%20r%3D%220.65%22%20fill%3D%22%23cde9ff%22%20opacity%3D%220.36%22%2F%3E%3Ccircle%20cx%3D%22497%22%20cy%3D%22231%22%20r%3D%221.3%22%20fill%3D%22%23cde9ff%22%20opacity%3D%220.45%22%2F%3E%3Ccircle%20cx%3D%22654%22%20cy%3D%220%22%20r%3D%220.65%22%20fill%3D%22%23cde9ff%22%20opacity%3D%220.54%22%2F%3E%3Ccircle%20cx%3D%22811%22%20cy%3D%2259%22%20r%3D%220.65%22%20fill%3D%22%23cde9ff%22%20opacity%3D%220.18%22%2F%3E%3Ccircle%20cx%3D%22968%22%20cy%3D%22118%22%20r%3D%220.65%22%20fill%3D%22%23cde9ff%22%20opacity%3D%220.27%22%2F%3E%3Ccircle%20cx%3D%221125%22%20cy%3D%22177%22%20r%3D%220.65%22%20fill%3D%22%23cde9ff%22%20opacity%3D%220.36%22%2F%3E%3Ccircle%20cx%3D%2282%22%20cy%3D%22236%22%20r%3D%220.65%22%20fill%3D%22%23cde9ff%22%20opacity%3D%220.45%22%2F%3E%3Ccircle%20cx%3D%22239%22%20cy%3D%225%22%20r%3D%221.3%22%20fill%3D%22%23cde9ff%22%20opacity%3D%220.54%22%2F%3E%3Ccircle%20cx%3D%22396%22%20cy%3D%2264%22%20r%3D%220.65%22%20fill%3D%22%23cde9ff%22%20opacity%3D%220.18%22%2F%3E%3Ccircle%20cx%3D%22553%22%20cy%3D%22123%22%20r%3D%220.65%22%20fill%3D%22%23cde9ff%22%20opacity%3D%220.27%22%2F%3E%3Ccircle%20cx%3D%22710%22%20cy%3D%22182%22%20r%3D%220.65%22%20fill%3D%22%23cde9ff%22%20opacity%3D%220.36%22%2F%3E%3Ccircle%20cx%3D%22867%22%20cy%3D%22241%22%20r%3D%220.65%22%20fill%3D%22%23cde9ff%22%20opacity%3D%220.45%22%2F%3E%3Ccircle%20cx%3D%221024%22%20cy%3D%2210%22%20r%3D%220.65%22%20fill%3D%22%23cde9ff%22%20opacity%3D%220.54%22%2F%3E%3Ccircle%20cx%3D%221181%22%20cy%3D%2269%22%20r%3D%221.3%22%20fill%3D%22%23cde9ff%22%20opacity%3D%220.18%22%2F%3E%3Ccircle%20cx%3D%22138%22%20cy%3D%22128%22%20r%3D%220.65%22%20fill%3D%22%23cde9ff%22%20opacity%3D%220.27%22%2F%3E%3Ccircle%20cx%3D%22295%22%20cy%3D%22187%22%20r%3D%220.65%22%20fill%3D%22%23cde9ff%22%20opacity%3D%220.36%22%2F%3E%3Ccircle%20cx%3D%22452%22%20cy%3D%22246%22%20r%3D%220.65%22%20fill%3D%22%23cde9ff%22%20opacity%3D%220.45%22%2F%3E%3Ccircle%20cx%3D%22609%22%20cy%3D%2215%22%20r%3D%220.65%22%20fill%3D%22%23cde9ff%22%20opacity%3D%220.54%22%2F%3E%3Ccircle%20cx%3D%22766%22%20cy%3D%2274%22%20r%3D%220.65%22%20fill%3D%22%23cde9ff%22%20opacity%3D%220.18%22%2F%3E%3Ccircle%20cx%3D%22923%22%20cy%3D%22133%22%20r%3D%221.3%22%20fill%3D%22%23cde9ff%22%20opacity%3D%220.27%22%2F%3E%3Ccircle%20cx%3D%221080%22%20cy%3D%22192%22%20r%3D%220.65%22%20fill%3D%22%23cde9ff%22%20opacity%3D%220.36%22%2F%3E%3Ccircle%20cx%3D%2237%22%20cy%3D%22251%22%20r%3D%220.65%22%20fill%3D%22%23cde9ff%22%20opacity%3D%220.45%22%2F%3E%3Ccircle%20cx%3D%22194%22%20cy%3D%2220%22%20r%3D%220.65%22%20fill%3D%22%23cde9ff%22%20opacity%3D%220.54%22%2F%3E%3Ccircle%20cx%3D%22351%22%20cy%3D%2279%22%20r%3D%220.65%22%20fill%3D%22%23cde9ff%22%20opacity%3D%220.18%22%2F%3E%3Ccircle%20cx%3D%22508%22%20cy%3D%22138%22%20r%3D%220.65%22%20fill%3D%22%23cde9ff%22%20opacity%3D%220.27%22%2F%3E%3Ccircle%20cx%3D%22665%22%20cy%3D%22197%22%20r%3D%221.3%22%20fill%3D%22%23cde9ff%22%20opacity%3D%220.36%22%2F%3E%3Cpath%20d%3D%22M36%200%20414%20557%20671%20750%20314%200z%22%20fill%3D%22%2356d7fd%22%20opacity%3D%22.025%22%2F%3E%3Cpath%20d%3D%22M920%200%20757%20420%201070%20713%201200%200z%22%20fill%3D%22%23f57ddc%22%20opacity%3D%22.035%22%2F%3E%3Cg%20fill%3D%22none%22%20stroke%3D%22%236df3ff%22%20opacity%3D%22.17%22%3E%3Ccircle%20cx%3D%22853%22%20cy%3D%22171%22%20r%3D%2269%22%2F%3E%3Ccircle%20cx%3D%22853%22%20cy%3D%22171%22%20r%3D%2258%22%20stroke-dasharray%3D%2242%2017%203%209%22%2F%3E%3Cpath%20d%3D%22M770%20171h30m112%200h26M853%2088v26m0%20116v25%22%2F%3E%3C%2Fg%3E%3Cpath%20d%3D%22M0%20527%2090%20509l65%2014%2069-65%2063%2012%2087-70%2097%2049%2094-35%2063%2018%2074-44%2096%2078%20109-40%2090%2049%20103-48v283H0z%22%20fill%3D%22%231b1730%22%20opacity%3D%22.67%22%2F%3E%3Cpath%20d%3D%22M0%20750V480h74v270%22%20fill%3D%22%230c2130%22%20stroke%3D%22%23f586e5%22%20stroke-opacity%3D%22.27%22%2F%3E%3Cpath%20d%3D%22M6%20489h62%22%20stroke%3D%22%23f586e5%22%20stroke-width%3D%223%22%20opacity%3D%22.65%22%2F%3E%3Crect%20x%3D%2227.666666666666664%22%20y%3D%22508%22%20width%3D%227.75%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.34%22%2F%3E%3Crect%20x%3D%2242.33333333333333%22%20y%3D%22508%22%20width%3D%227.75%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.48000000000000004%22%2F%3E%3Crect%20x%3D%2213%22%20y%3D%22544%22%20width%3D%227.75%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.34%22%2F%3E%3Crect%20x%3D%2242.33333333333333%22%20y%3D%22544%22%20width%3D%227.75%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.2%22%2F%3E%3Crect%20x%3D%2213%22%20y%3D%22580%22%20width%3D%227.75%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.48000000000000004%22%2F%3E%3Crect%20x%3D%2227.666666666666664%22%20y%3D%22580%22%20width%3D%227.75%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.2%22%2F%3E%3Crect%20x%3D%2213%22%20y%3D%22616%22%20width%3D%227.75%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.2%22%2F%3E%3Crect%20x%3D%2227.666666666666664%22%20y%3D%22616%22%20width%3D%227.75%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.34%22%2F%3E%3Crect%20x%3D%2242.33333333333333%22%20y%3D%22616%22%20width%3D%227.75%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.48000000000000004%22%2F%3E%3Crect%20x%3D%2227.666666666666664%22%20y%3D%22652%22%20width%3D%227.75%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.48000000000000004%22%2F%3E%3Crect%20x%3D%2242.33333333333333%22%20y%3D%22652%22%20width%3D%227.75%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.2%22%2F%3E%3Crect%20x%3D%2213%22%20y%3D%22688%22%20width%3D%227.75%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.48000000000000004%22%2F%3E%3Crect%20x%3D%2242.33333333333333%22%20y%3D%22688%22%20width%3D%227.75%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.34%22%2F%3E%3Crect%20x%3D%2213%22%20y%3D%22724%22%20width%3D%227.75%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.2%22%2F%3E%3Crect%20x%3D%2227.666666666666664%22%20y%3D%22724%22%20width%3D%227.75%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.34%22%2F%3E%3Cpath%20d%3D%22M67%20750V340h96v410%22%20fill%3D%22%2313132e%22%20stroke%3D%22%2365f1ff%22%20stroke-opacity%3D%22.27%22%2F%3E%3Cpath%20d%3D%22M73%20349h84%22%20stroke%3D%22%2365f1ff%22%20stroke-width%3D%223%22%20opacity%3D%22.65%22%2F%3E%3Crect%20x%3D%2280%22%20y%3D%22368%22%20width%3D%2213.25%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.2%22%2F%3E%3Crect%20x%3D%22102%22%20y%3D%22368%22%20width%3D%2213.25%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.34%22%2F%3E%3Crect%20x%3D%22124%22%20y%3D%22368%22%20width%3D%2213.25%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.48000000000000004%22%2F%3E%3Crect%20x%3D%22102%22%20y%3D%22404%22%20width%3D%2213.25%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.48000000000000004%22%2F%3E%3Crect%20x%3D%22124%22%20y%3D%22404%22%20width%3D%2213.25%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.2%22%2F%3E%3Crect%20x%3D%2280%22%20y%3D%22440%22%20width%3D%2213.25%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.48000000000000004%22%2F%3E%3Crect%20x%3D%22124%22%20y%3D%22440%22%20width%3D%2213.25%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.34%22%2F%3E%3Crect%20x%3D%2280%22%20y%3D%22476%22%20width%3D%2213.25%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.2%22%2F%3E%3Crect%20x%3D%22102%22%20y%3D%22476%22%20width%3D%2213.25%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.34%22%2F%3E%3Crect%20x%3D%2280%22%20y%3D%22512%22%20width%3D%2213.25%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.34%22%2F%3E%3Crect%20x%3D%22102%22%20y%3D%22512%22%20width%3D%2213.25%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.48000000000000004%22%2F%3E%3Crect%20x%3D%22124%22%20y%3D%22512%22%20width%3D%2213.25%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.2%22%2F%3E%3Crect%20x%3D%22102%22%20y%3D%22548%22%20width%3D%2213.25%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.2%22%2F%3E%3Crect%20x%3D%22124%22%20y%3D%22548%22%20width%3D%2213.25%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.34%22%2F%3E%3Crect%20x%3D%2280%22%20y%3D%22584%22%20width%3D%2213.25%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.2%22%2F%3E%3Crect%20x%3D%22124%22%20y%3D%22584%22%20width%3D%2213.25%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.48000000000000004%22%2F%3E%3Cpath%20d%3D%22M154%20750V455h60v295%22%20fill%3D%22%230c2130%22%20stroke%3D%22%23f586e5%22%20stroke-opacity%3D%22.27%22%2F%3E%3Cpath%20d%3D%22M160%20464h48%22%20stroke%3D%22%23f586e5%22%20stroke-width%3D%223%22%20opacity%3D%22.65%22%2F%3E%3Crect%20x%3D%22167%22%20y%3D%22483%22%20width%3D%224.25%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.2%22%2F%3E%3Crect%20x%3D%22177%22%20y%3D%22483%22%20width%3D%224.25%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.34%22%2F%3E%3Crect%20x%3D%22167%22%20y%3D%22519%22%20width%3D%224.25%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.34%22%2F%3E%3Crect%20x%3D%22177%22%20y%3D%22519%22%20width%3D%224.25%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.48000000000000004%22%2F%3E%3Crect%20x%3D%22187%22%20y%3D%22519%22%20width%3D%224.25%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.2%22%2F%3E%3Crect%20x%3D%22177%22%20y%3D%22555%22%20width%3D%224.25%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.2%22%2F%3E%3Crect%20x%3D%22187%22%20y%3D%22555%22%20width%3D%224.25%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.34%22%2F%3E%3Crect%20x%3D%22167%22%20y%3D%22591%22%20width%3D%224.25%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.2%22%2F%3E%3Crect%20x%3D%22187%22%20y%3D%22591%22%20width%3D%224.25%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.48000000000000004%22%2F%3E%3Crect%20x%3D%22167%22%20y%3D%22627%22%20width%3D%224.25%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.34%22%2F%3E%3Crect%20x%3D%22177%22%20y%3D%22627%22%20width%3D%224.25%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.48000000000000004%22%2F%3E%3Crect%20x%3D%22167%22%20y%3D%22663%22%20width%3D%224.25%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.48000000000000004%22%2F%3E%3Crect%20x%3D%22177%22%20y%3D%22663%22%20width%3D%224.25%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.2%22%2F%3E%3Crect%20x%3D%22187%22%20y%3D%22663%22%20width%3D%224.25%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.34%22%2F%3E%3Crect%20x%3D%22177%22%20y%3D%22699%22%20width%3D%224.25%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.34%22%2F%3E%3Crect%20x%3D%22187%22%20y%3D%22699%22%20width%3D%224.25%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.48000000000000004%22%2F%3E%3Cpath%20d%3D%22M209%20750V262h111v488%22%20fill%3D%22%2313132e%22%20stroke%3D%22%2365f1ff%22%20stroke-opacity%3D%22.27%22%2F%3E%3Cpath%20d%3D%22M215%20271h99%22%20stroke%3D%22%2365f1ff%22%20stroke-width%3D%223%22%20opacity%3D%22.65%22%2F%3E%3Crect%20x%3D%22222%22%20y%3D%22290%22%20width%3D%2217%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.2%22%2F%3E%3Crect%20x%3D%22276%22%20y%3D%22290%22%20width%3D%2217%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.48000000000000004%22%2F%3E%3Crect%20x%3D%22222%22%20y%3D%22326%22%20width%3D%2217%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.34%22%2F%3E%3Crect%20x%3D%22249%22%20y%3D%22326%22%20width%3D%2217%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.48000000000000004%22%2F%3E%3Crect%20x%3D%22222%22%20y%3D%22362%22%20width%3D%2217%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.48000000000000004%22%2F%3E%3Crect%20x%3D%22249%22%20y%3D%22362%22%20width%3D%2217%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.2%22%2F%3E%3Crect%20x%3D%22276%22%20y%3D%22362%22%20width%3D%2217%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.34%22%2F%3E%3Crect%20x%3D%22249%22%20y%3D%22398%22%20width%3D%2217%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.34%22%2F%3E%3Crect%20x%3D%22276%22%20y%3D%22398%22%20width%3D%2217%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.48000000000000004%22%2F%3E%3Crect%20x%3D%22222%22%20y%3D%22434%22%20width%3D%2217%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.34%22%2F%3E%3Crect%20x%3D%22276%22%20y%3D%22434%22%20width%3D%2217%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.2%22%2F%3E%3Crect%20x%3D%22222%22%20y%3D%22470%22%20width%3D%2217%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.48000000000000004%22%2F%3E%3Crect%20x%3D%22249%22%20y%3D%22470%22%20width%3D%2217%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.2%22%2F%3E%3Crect%20x%3D%22222%22%20y%3D%22506%22%20width%3D%2217%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.2%22%2F%3E%3Crect%20x%3D%22249%22%20y%3D%22506%22%20width%3D%2217%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.34%22%2F%3E%3Crect%20x%3D%22276%22%20y%3D%22506%22%20width%3D%2217%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.48000000000000004%22%2F%3E%3Cpath%20d%3D%22M315%20750V388h87v362%22%20fill%3D%22%230c2130%22%20stroke%3D%22%23f586e5%22%20stroke-opacity%3D%22.27%22%2F%3E%3Cpath%20d%3D%22M321%20397h75%22%20stroke%3D%22%23f586e5%22%20stroke-width%3D%223%22%20opacity%3D%22.65%22%2F%3E%3Cpath%20d%3D%22M358.5%20388v-39%22%20stroke%3D%22%23f586e5%22%20opacity%3D%22.5%22%2F%3E%3Ccircle%20cx%3D%22358.5%22%20cy%3D%22347%22%20r%3D%223%22%20fill%3D%22%23f586e5%22%2F%3E%3Crect%20x%3D%22347%22%20y%3D%22416%22%20width%3D%2211%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.34%22%2F%3E%3Crect%20x%3D%22366%22%20y%3D%22416%22%20width%3D%2211%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.48000000000000004%22%2F%3E%3Crect%20x%3D%22328%22%20y%3D%22452%22%20width%3D%2211%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.34%22%2F%3E%3Crect%20x%3D%22366%22%20y%3D%22452%22%20width%3D%2211%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.2%22%2F%3E%3Crect%20x%3D%22328%22%20y%3D%22488%22%20width%3D%2211%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.48000000000000004%22%2F%3E%3Crect%20x%3D%22347%22%20y%3D%22488%22%20width%3D%2211%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.2%22%2F%3E%3Crect%20x%3D%22328%22%20y%3D%22524%22%20width%3D%2211%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.2%22%2F%3E%3Crect%20x%3D%22347%22%20y%3D%22524%22%20width%3D%2211%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.34%22%2F%3E%3Crect%20x%3D%22366%22%20y%3D%22524%22%20width%3D%2211%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.48000000000000004%22%2F%3E%3Crect%20x%3D%22347%22%20y%3D%22560%22%20width%3D%2211%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.48000000000000004%22%2F%3E%3Crect%20x%3D%22366%22%20y%3D%22560%22%20width%3D%2211%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.2%22%2F%3E%3Crect%20x%3D%22328%22%20y%3D%22596%22%20width%3D%2211%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.48000000000000004%22%2F%3E%3Crect%20x%3D%22366%22%20y%3D%22596%22%20width%3D%2211%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.34%22%2F%3E%3Crect%20x%3D%22328%22%20y%3D%22632%22%20width%3D%2211%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.2%22%2F%3E%3Crect%20x%3D%22347%22%20y%3D%22632%22%20width%3D%2211%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.34%22%2F%3E%3Cpath%20d%3D%22M395%20750V464h56v286%22%20fill%3D%22%2313132e%22%20stroke%3D%22%2365f1ff%22%20stroke-opacity%3D%22.27%22%2F%3E%3Cpath%20d%3D%22M401%20473h44%22%20stroke%3D%22%2365f1ff%22%20stroke-width%3D%223%22%20opacity%3D%22.65%22%2F%3E%3Crect%20x%3D%22408%22%20y%3D%22492%22%20width%3D%224%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.2%22%2F%3E%3Crect%20x%3D%22418%22%20y%3D%22492%22%20width%3D%224%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.34%22%2F%3E%3Crect%20x%3D%22428%22%20y%3D%22492%22%20width%3D%224%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.48000000000000004%22%2F%3E%3Crect%20x%3D%22418%22%20y%3D%22528%22%20width%3D%224%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.48000000000000004%22%2F%3E%3Crect%20x%3D%22428%22%20y%3D%22528%22%20width%3D%224%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.2%22%2F%3E%3Crect%20x%3D%22408%22%20y%3D%22564%22%20width%3D%224%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.48000000000000004%22%2F%3E%3Crect%20x%3D%22428%22%20y%3D%22564%22%20width%3D%224%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.34%22%2F%3E%3Crect%20x%3D%22408%22%20y%3D%22600%22%20width%3D%224%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.2%22%2F%3E%3Crect%20x%3D%22418%22%20y%3D%22600%22%20width%3D%224%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.34%22%2F%3E%3Crect%20x%3D%22408%22%20y%3D%22636%22%20width%3D%224%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.34%22%2F%3E%3Crect%20x%3D%22418%22%20y%3D%22636%22%20width%3D%224%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.48000000000000004%22%2F%3E%3Crect%20x%3D%22428%22%20y%3D%22636%22%20width%3D%224%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.2%22%2F%3E%3Crect%20x%3D%22418%22%20y%3D%22672%22%20width%3D%224%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.2%22%2F%3E%3Crect%20x%3D%22428%22%20y%3D%22672%22%20width%3D%224%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.34%22%2F%3E%3Crect%20x%3D%22408%22%20y%3D%22708%22%20width%3D%224%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.2%22%2F%3E%3Crect%20x%3D%22428%22%20y%3D%22708%22%20width%3D%224%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.48000000000000004%22%2F%3E%3Cpath%20d%3D%22M440%20750V324h96v426%22%20fill%3D%22%230c2130%22%20stroke%3D%22%23f586e5%22%20stroke-opacity%3D%22.27%22%2F%3E%3Cpath%20d%3D%22M446%20333h84%22%20stroke%3D%22%23f586e5%22%20stroke-width%3D%223%22%20opacity%3D%22.65%22%2F%3E%3Crect%20x%3D%22453%22%20y%3D%22352%22%20width%3D%2213.25%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.2%22%2F%3E%3Crect%20x%3D%22475%22%20y%3D%22352%22%20width%3D%2213.25%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.34%22%2F%3E%3Crect%20x%3D%22453%22%20y%3D%22388%22%20width%3D%2213.25%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.34%22%2F%3E%3Crect%20x%3D%22475%22%20y%3D%22388%22%20width%3D%2213.25%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.48000000000000004%22%2F%3E%3Crect%20x%3D%22497%22%20y%3D%22388%22%20width%3D%2213.25%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.2%22%2F%3E%3Crect%20x%3D%22475%22%20y%3D%22424%22%20width%3D%2213.25%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.2%22%2F%3E%3Crect%20x%3D%22497%22%20y%3D%22424%22%20width%3D%2213.25%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.34%22%2F%3E%3Crect%20x%3D%22453%22%20y%3D%22460%22%20width%3D%2213.25%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.2%22%2F%3E%3Crect%20x%3D%22497%22%20y%3D%22460%22%20width%3D%2213.25%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.48000000000000004%22%2F%3E%3Crect%20x%3D%22453%22%20y%3D%22496%22%20width%3D%2213.25%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.34%22%2F%3E%3Crect%20x%3D%22475%22%20y%3D%22496%22%20width%3D%2213.25%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.48000000000000004%22%2F%3E%3Crect%20x%3D%22453%22%20y%3D%22532%22%20width%3D%2213.25%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.48000000000000004%22%2F%3E%3Crect%20x%3D%22475%22%20y%3D%22532%22%20width%3D%2213.25%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.2%22%2F%3E%3Crect%20x%3D%22497%22%20y%3D%22532%22%20width%3D%2213.25%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.34%22%2F%3E%3Crect%20x%3D%22475%22%20y%3D%22568%22%20width%3D%2213.25%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.34%22%2F%3E%3Crect%20x%3D%22497%22%20y%3D%22568%22%20width%3D%2213.25%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.48000000000000004%22%2F%3E%3Cpath%20d%3D%22M525%20750V415h91v335%22%20fill%3D%22%2313132e%22%20stroke%3D%22%2365f1ff%22%20stroke-opacity%3D%22.27%22%2F%3E%3Cpath%20d%3D%22M531%20424h79%22%20stroke%3D%22%2365f1ff%22%20stroke-width%3D%223%22%20opacity%3D%22.65%22%2F%3E%3Crect%20x%3D%22538%22%20y%3D%22443%22%20width%3D%2212%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.2%22%2F%3E%3Crect%20x%3D%22578.6666666666666%22%20y%3D%22443%22%20width%3D%2212%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.48000000000000004%22%2F%3E%3Crect%20x%3D%22538%22%20y%3D%22479%22%20width%3D%2212%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.34%22%2F%3E%3Crect%20x%3D%22558.3333333333334%22%20y%3D%22479%22%20width%3D%2212%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.48000000000000004%22%2F%3E%3Crect%20x%3D%22538%22%20y%3D%22515%22%20width%3D%2212%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.48000000000000004%22%2F%3E%3Crect%20x%3D%22558.3333333333334%22%20y%3D%22515%22%20width%3D%2212%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.2%22%2F%3E%3Crect%20x%3D%22578.6666666666666%22%20y%3D%22515%22%20width%3D%2212%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.34%22%2F%3E%3Crect%20x%3D%22558.3333333333334%22%20y%3D%22551%22%20width%3D%2212%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.34%22%2F%3E%3Crect%20x%3D%22578.6666666666666%22%20y%3D%22551%22%20width%3D%2212%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.48000000000000004%22%2F%3E%3Crect%20x%3D%22538%22%20y%3D%22587%22%20width%3D%2212%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.34%22%2F%3E%3Crect%20x%3D%22578.6666666666666%22%20y%3D%22587%22%20width%3D%2212%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.2%22%2F%3E%3Crect%20x%3D%22538%22%20y%3D%22623%22%20width%3D%2212%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.48000000000000004%22%2F%3E%3Crect%20x%3D%22558.3333333333334%22%20y%3D%22623%22%20width%3D%2212%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.2%22%2F%3E%3Crect%20x%3D%22538%22%20y%3D%22659%22%20width%3D%2212%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.2%22%2F%3E%3Crect%20x%3D%22558.3333333333334%22%20y%3D%22659%22%20width%3D%2212%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.34%22%2F%3E%3Crect%20x%3D%22578.6666666666666%22%20y%3D%22659%22%20width%3D%2212%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.48000000000000004%22%2F%3E%3Cpath%20d%3D%22M606%20750V220h130v530%22%20fill%3D%22%230c2130%22%20stroke%3D%22%23f586e5%22%20stroke-opacity%3D%22.27%22%2F%3E%3Cpath%20d%3D%22M612%20229h118%22%20stroke%3D%22%23f586e5%22%20stroke-width%3D%223%22%20opacity%3D%22.65%22%2F%3E%3Cpath%20d%3D%22M671%20220v-39%22%20stroke%3D%22%23f586e5%22%20opacity%3D%22.5%22%2F%3E%3Ccircle%20cx%3D%22671%22%20cy%3D%22179%22%20r%3D%223%22%20fill%3D%22%23f586e5%22%2F%3E%3Crect%20x%3D%22652.3333333333334%22%20y%3D%22248%22%20width%3D%2221.75%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.34%22%2F%3E%3Crect%20x%3D%22685.6666666666666%22%20y%3D%22248%22%20width%3D%2221.75%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.48000000000000004%22%2F%3E%3Crect%20x%3D%22619%22%20y%3D%22284%22%20width%3D%2221.75%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.34%22%2F%3E%3Crect%20x%3D%22685.6666666666666%22%20y%3D%22284%22%20width%3D%2221.75%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.2%22%2F%3E%3Crect%20x%3D%22619%22%20y%3D%22320%22%20width%3D%2221.75%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.48000000000000004%22%2F%3E%3Crect%20x%3D%22652.3333333333334%22%20y%3D%22320%22%20width%3D%2221.75%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.2%22%2F%3E%3Crect%20x%3D%22619%22%20y%3D%22356%22%20width%3D%2221.75%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.2%22%2F%3E%3Crect%20x%3D%22652.3333333333334%22%20y%3D%22356%22%20width%3D%2221.75%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.34%22%2F%3E%3Crect%20x%3D%22685.6666666666666%22%20y%3D%22356%22%20width%3D%2221.75%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.48000000000000004%22%2F%3E%3Crect%20x%3D%22652.3333333333334%22%20y%3D%22392%22%20width%3D%2221.75%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.48000000000000004%22%2F%3E%3Crect%20x%3D%22685.6666666666666%22%20y%3D%22392%22%20width%3D%2221.75%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.2%22%2F%3E%3Crect%20x%3D%22619%22%20y%3D%22428%22%20width%3D%2221.75%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.48000000000000004%22%2F%3E%3Crect%20x%3D%22685.6666666666666%22%20y%3D%22428%22%20width%3D%2221.75%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.34%22%2F%3E%3Crect%20x%3D%22619%22%20y%3D%22464%22%20width%3D%2221.75%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.2%22%2F%3E%3Crect%20x%3D%22652.3333333333334%22%20y%3D%22464%22%20width%3D%2221.75%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.34%22%2F%3E%3Cpath%20d%3D%22M729%20750V364h74v386%22%20fill%3D%22%2313132e%22%20stroke%3D%22%2365f1ff%22%20stroke-opacity%3D%22.27%22%2F%3E%3Cpath%20d%3D%22M735%20373h62%22%20stroke%3D%22%2365f1ff%22%20stroke-width%3D%223%22%20opacity%3D%22.65%22%2F%3E%3Crect%20x%3D%22742%22%20y%3D%22392%22%20width%3D%227.75%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.2%22%2F%3E%3Crect%20x%3D%22756.6666666666666%22%20y%3D%22392%22%20width%3D%227.75%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.34%22%2F%3E%3Crect%20x%3D%22771.3333333333334%22%20y%3D%22392%22%20width%3D%227.75%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.48000000000000004%22%2F%3E%3Crect%20x%3D%22756.6666666666666%22%20y%3D%22428%22%20width%3D%227.75%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.48000000000000004%22%2F%3E%3Crect%20x%3D%22771.3333333333334%22%20y%3D%22428%22%20width%3D%227.75%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.2%22%2F%3E%3Crect%20x%3D%22742%22%20y%3D%22464%22%20width%3D%227.75%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.48000000000000004%22%2F%3E%3Crect%20x%3D%22771.3333333333334%22%20y%3D%22464%22%20width%3D%227.75%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.34%22%2F%3E%3Crect%20x%3D%22742%22%20y%3D%22500%22%20width%3D%227.75%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.2%22%2F%3E%3Crect%20x%3D%22756.6666666666666%22%20y%3D%22500%22%20width%3D%227.75%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.34%22%2F%3E%3Crect%20x%3D%22742%22%20y%3D%22536%22%20width%3D%227.75%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.34%22%2F%3E%3Crect%20x%3D%22756.6666666666666%22%20y%3D%22536%22%20width%3D%227.75%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.48000000000000004%22%2F%3E%3Crect%20x%3D%22771.3333333333334%22%20y%3D%22536%22%20width%3D%227.75%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.2%22%2F%3E%3Crect%20x%3D%22756.6666666666666%22%20y%3D%22572%22%20width%3D%227.75%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.2%22%2F%3E%3Crect%20x%3D%22771.3333333333334%22%20y%3D%22572%22%20width%3D%227.75%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.34%22%2F%3E%3Crect%20x%3D%22742%22%20y%3D%22608%22%20width%3D%227.75%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.2%22%2F%3E%3Crect%20x%3D%22771.3333333333334%22%20y%3D%22608%22%20width%3D%227.75%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.48000000000000004%22%2F%3E%3Cpath%20d%3D%22M792%20750V280h104v470%22%20fill%3D%22%230c2130%22%20stroke%3D%22%23f586e5%22%20stroke-opacity%3D%22.27%22%2F%3E%3Cpath%20d%3D%22M798%20289h92%22%20stroke%3D%22%23f586e5%22%20stroke-width%3D%223%22%20opacity%3D%22.65%22%2F%3E%3Crect%20x%3D%22805%22%20y%3D%22308%22%20width%3D%2215.25%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.2%22%2F%3E%3Crect%20x%3D%22829.6666666666666%22%20y%3D%22308%22%20width%3D%2215.25%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.34%22%2F%3E%3Crect%20x%3D%22805%22%20y%3D%22344%22%20width%3D%2215.25%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.34%22%2F%3E%3Crect%20x%3D%22829.6666666666666%22%20y%3D%22344%22%20width%3D%2215.25%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.48000000000000004%22%2F%3E%3Crect%20x%3D%22854.3333333333334%22%20y%3D%22344%22%20width%3D%2215.25%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.2%22%2F%3E%3Crect%20x%3D%22829.6666666666666%22%20y%3D%22380%22%20width%3D%2215.25%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.2%22%2F%3E%3Crect%20x%3D%22854.3333333333334%22%20y%3D%22380%22%20width%3D%2215.25%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.34%22%2F%3E%3Crect%20x%3D%22805%22%20y%3D%22416%22%20width%3D%2215.25%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.2%22%2F%3E%3Crect%20x%3D%22854.3333333333334%22%20y%3D%22416%22%20width%3D%2215.25%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.48000000000000004%22%2F%3E%3Crect%20x%3D%22805%22%20y%3D%22452%22%20width%3D%2215.25%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.34%22%2F%3E%3Crect%20x%3D%22829.6666666666666%22%20y%3D%22452%22%20width%3D%2215.25%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.48000000000000004%22%2F%3E%3Crect%20x%3D%22805%22%20y%3D%22488%22%20width%3D%2215.25%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.48000000000000004%22%2F%3E%3Crect%20x%3D%22829.6666666666666%22%20y%3D%22488%22%20width%3D%2215.25%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.2%22%2F%3E%3Crect%20x%3D%22854.3333333333334%22%20y%3D%22488%22%20width%3D%2215.25%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.34%22%2F%3E%3Crect%20x%3D%22829.6666666666666%22%20y%3D%22524%22%20width%3D%2215.25%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.34%22%2F%3E%3Crect%20x%3D%22854.3333333333334%22%20y%3D%22524%22%20width%3D%2215.25%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.48000000000000004%22%2F%3E%3Cpath%20d%3D%22M888%20750V447h75v303%22%20fill%3D%22%2313132e%22%20stroke%3D%22%2365f1ff%22%20stroke-opacity%3D%22.27%22%2F%3E%3Cpath%20d%3D%22M894%20456h63%22%20stroke%3D%22%2365f1ff%22%20stroke-width%3D%223%22%20opacity%3D%22.65%22%2F%3E%3Crect%20x%3D%22901%22%20y%3D%22475%22%20width%3D%228%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.2%22%2F%3E%3Crect%20x%3D%22931%22%20y%3D%22475%22%20width%3D%228%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.48000000000000004%22%2F%3E%3Crect%20x%3D%22901%22%20y%3D%22511%22%20width%3D%228%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.34%22%2F%3E%3Crect%20x%3D%22916%22%20y%3D%22511%22%20width%3D%228%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.48000000000000004%22%2F%3E%3Crect%20x%3D%22901%22%20y%3D%22547%22%20width%3D%228%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.48000000000000004%22%2F%3E%3Crect%20x%3D%22916%22%20y%3D%22547%22%20width%3D%228%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.2%22%2F%3E%3Crect%20x%3D%22931%22%20y%3D%22547%22%20width%3D%228%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.34%22%2F%3E%3Crect%20x%3D%22916%22%20y%3D%22583%22%20width%3D%228%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.34%22%2F%3E%3Crect%20x%3D%22931%22%20y%3D%22583%22%20width%3D%228%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.48000000000000004%22%2F%3E%3Crect%20x%3D%22901%22%20y%3D%22619%22%20width%3D%228%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.34%22%2F%3E%3Crect%20x%3D%22931%22%20y%3D%22619%22%20width%3D%228%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.2%22%2F%3E%3Crect%20x%3D%22901%22%20y%3D%22655%22%20width%3D%228%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.48000000000000004%22%2F%3E%3Crect%20x%3D%22916%22%20y%3D%22655%22%20width%3D%228%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.2%22%2F%3E%3Crect%20x%3D%22901%22%20y%3D%22691%22%20width%3D%228%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.2%22%2F%3E%3Crect%20x%3D%22916%22%20y%3D%22691%22%20width%3D%228%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.34%22%2F%3E%3Crect%20x%3D%22931%22%20y%3D%22691%22%20width%3D%228%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.48000000000000004%22%2F%3E%3Cpath%20d%3D%22M953%20750V311h113v439%22%20fill%3D%22%230c2130%22%20stroke%3D%22%23f586e5%22%20stroke-opacity%3D%22.27%22%2F%3E%3Cpath%20d%3D%22M959%20320h101%22%20stroke%3D%22%23f586e5%22%20stroke-width%3D%223%22%20opacity%3D%22.65%22%2F%3E%3Crect%20x%3D%22993.6666666666666%22%20y%3D%22339%22%20width%3D%2217.5%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.34%22%2F%3E%3Crect%20x%3D%221021.3333333333334%22%20y%3D%22339%22%20width%3D%2217.5%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.48000000000000004%22%2F%3E%3Crect%20x%3D%22966%22%20y%3D%22375%22%20width%3D%2217.5%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.34%22%2F%3E%3Crect%20x%3D%221021.3333333333334%22%20y%3D%22375%22%20width%3D%2217.5%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.2%22%2F%3E%3Crect%20x%3D%22966%22%20y%3D%22411%22%20width%3D%2217.5%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.48000000000000004%22%2F%3E%3Crect%20x%3D%22993.6666666666666%22%20y%3D%22411%22%20width%3D%2217.5%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.2%22%2F%3E%3Crect%20x%3D%22966%22%20y%3D%22447%22%20width%3D%2217.5%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.2%22%2F%3E%3Crect%20x%3D%22993.6666666666666%22%20y%3D%22447%22%20width%3D%2217.5%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.34%22%2F%3E%3Crect%20x%3D%221021.3333333333334%22%20y%3D%22447%22%20width%3D%2217.5%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.48000000000000004%22%2F%3E%3Crect%20x%3D%22993.6666666666666%22%20y%3D%22483%22%20width%3D%2217.5%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.48000000000000004%22%2F%3E%3Crect%20x%3D%221021.3333333333334%22%20y%3D%22483%22%20width%3D%2217.5%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.2%22%2F%3E%3Crect%20x%3D%22966%22%20y%3D%22519%22%20width%3D%2217.5%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.48000000000000004%22%2F%3E%3Crect%20x%3D%221021.3333333333334%22%20y%3D%22519%22%20width%3D%2217.5%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.34%22%2F%3E%3Crect%20x%3D%22966%22%20y%3D%22555%22%20width%3D%2217.5%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.2%22%2F%3E%3Crect%20x%3D%22993.6666666666666%22%20y%3D%22555%22%20width%3D%2217.5%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.34%22%2F%3E%3Cpath%20d%3D%22M1057%20750V430h66v320%22%20fill%3D%22%2313132e%22%20stroke%3D%22%2365f1ff%22%20stroke-opacity%3D%22.27%22%2F%3E%3Cpath%20d%3D%22M1063%20439h54%22%20stroke%3D%22%2365f1ff%22%20stroke-width%3D%223%22%20opacity%3D%22.65%22%2F%3E%3Crect%20x%3D%221070%22%20y%3D%22458%22%20width%3D%225.75%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.2%22%2F%3E%3Crect%20x%3D%221082%22%20y%3D%22458%22%20width%3D%225.75%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.34%22%2F%3E%3Crect%20x%3D%221094%22%20y%3D%22458%22%20width%3D%225.75%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.48000000000000004%22%2F%3E%3Crect%20x%3D%221082%22%20y%3D%22494%22%20width%3D%225.75%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.48000000000000004%22%2F%3E%3Crect%20x%3D%221094%22%20y%3D%22494%22%20width%3D%225.75%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.2%22%2F%3E%3Crect%20x%3D%221070%22%20y%3D%22530%22%20width%3D%225.75%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.48000000000000004%22%2F%3E%3Crect%20x%3D%221094%22%20y%3D%22530%22%20width%3D%225.75%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.34%22%2F%3E%3Crect%20x%3D%221070%22%20y%3D%22566%22%20width%3D%225.75%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.2%22%2F%3E%3Crect%20x%3D%221082%22%20y%3D%22566%22%20width%3D%225.75%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.34%22%2F%3E%3Crect%20x%3D%221070%22%20y%3D%22602%22%20width%3D%225.75%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.34%22%2F%3E%3Crect%20x%3D%221082%22%20y%3D%22602%22%20width%3D%225.75%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.48000000000000004%22%2F%3E%3Crect%20x%3D%221094%22%20y%3D%22602%22%20width%3D%225.75%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.2%22%2F%3E%3Crect%20x%3D%221082%22%20y%3D%22638%22%20width%3D%225.75%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.2%22%2F%3E%3Crect%20x%3D%221094%22%20y%3D%22638%22%20width%3D%225.75%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.34%22%2F%3E%3Crect%20x%3D%221070%22%20y%3D%22674%22%20width%3D%225.75%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.2%22%2F%3E%3Crect%20x%3D%221094%22%20y%3D%22674%22%20width%3D%225.75%22%20height%3D%223%22%20fill%3D%22%2365f1ff%22%20opacity%3D%220.48000000000000004%22%2F%3E%3Cpath%20d%3D%22M1118%20750V270h84v480%22%20fill%3D%22%230c2130%22%20stroke%3D%22%23f586e5%22%20stroke-opacity%3D%22.27%22%2F%3E%3Cpath%20d%3D%22M1124%20279h72%22%20stroke%3D%22%23f586e5%22%20stroke-width%3D%223%22%20opacity%3D%22.65%22%2F%3E%3Crect%20x%3D%221131%22%20y%3D%22298%22%20width%3D%2210.25%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.2%22%2F%3E%3Crect%20x%3D%221149%22%20y%3D%22298%22%20width%3D%2210.25%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.34%22%2F%3E%3Crect%20x%3D%221131%22%20y%3D%22334%22%20width%3D%2210.25%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.34%22%2F%3E%3Crect%20x%3D%221149%22%20y%3D%22334%22%20width%3D%2210.25%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.48000000000000004%22%2F%3E%3Crect%20x%3D%221167%22%20y%3D%22334%22%20width%3D%2210.25%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.2%22%2F%3E%3Crect%20x%3D%221149%22%20y%3D%22370%22%20width%3D%2210.25%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.2%22%2F%3E%3Crect%20x%3D%221167%22%20y%3D%22370%22%20width%3D%2210.25%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.34%22%2F%3E%3Crect%20x%3D%221131%22%20y%3D%22406%22%20width%3D%2210.25%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.2%22%2F%3E%3Crect%20x%3D%221167%22%20y%3D%22406%22%20width%3D%2210.25%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.48000000000000004%22%2F%3E%3Crect%20x%3D%221131%22%20y%3D%22442%22%20width%3D%2210.25%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.34%22%2F%3E%3Crect%20x%3D%221149%22%20y%3D%22442%22%20width%3D%2210.25%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.48000000000000004%22%2F%3E%3Crect%20x%3D%221131%22%20y%3D%22478%22%20width%3D%2210.25%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.48000000000000004%22%2F%3E%3Crect%20x%3D%221149%22%20y%3D%22478%22%20width%3D%2210.25%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.2%22%2F%3E%3Crect%20x%3D%221167%22%20y%3D%22478%22%20width%3D%2210.25%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.34%22%2F%3E%3Crect%20x%3D%221149%22%20y%3D%22514%22%20width%3D%2210.25%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.34%22%2F%3E%3Crect%20x%3D%221167%22%20y%3D%22514%22%20width%3D%2210.25%22%20height%3D%223%22%20fill%3D%22%23f586e5%22%20opacity%3D%220.48000000000000004%22%2F%3E%3Cpath%20d%3D%22M0%20742h1200v158H0z%22%20fill%3D%22url(%23floor)%22%2F%3E%3Cg%20fill%3D%22none%22%20stroke%3D%22%2363dbf9%22%20stroke-opacity%3D%22.15%22%3E%3Cpath%20d%3D%22M600%20741%2055%20900m545-159L280%20900m320-159L470%20900m130-159L730%20900m-130-159L935%20900m-335-159L1170%20900M0%20767h1200M0%20801h1200M0%20844h1200%22%2F%3E%3C%2Fg%3E%3Cpath%20d%3D%22M0%20743h1200%22%20stroke%3D%22%23b765b7%22%20stroke-width%3D%222%22%20opacity%3D%22.5%22%2F%3E%3Cpath%20d%3D%22M690%20520h95v27h-95z%22%20fill%3D%22%23fa76c1%22%20opacity%3D%22.18%22%2F%3E%3Cpath%20d%3D%22M697%20529h61m-61%209h42%22%20stroke%3D%22%23ffc4eb%22%20opacity%3D%22.6%22%2F%3E%3Cpath%20d%3D%22M228%20376h68v20h-68z%22%20fill%3D%22%2372edff%22%20opacity%3D%22.2%22%2F%3E%3Cpath%20d%3D%22M235%20383h50%22%20stroke%3D%22%23a9faff%22%20opacity%3D%22.6%22%2F%3E%3C%2Fsvg%3E") center / cover no-repeat, #071526;
    }
    html.${CLASS}[data-converge-chat-theme="anime"] { background: #171f43 !important; }
    html.${CLASS}[data-converge-chat-theme="anime"] #${LAYER_ID} {
      background: linear-gradient(180deg, rgba(12, 16, 39, .13), rgba(12, 16, 39, .26)), url("data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%221200%22%20height%3D%22900%22%20viewBox%3D%220%200%201200%20900%22%3E%3Cdefs%3E%3ClinearGradient%20id%3D%22sky%22%20x2%3D%220%22%20y2%3D%221%22%3E%3Cstop%20stop-color%3D%22%23171f43%22%2F%3E%3Cstop%20offset%3D%22.43%22%20stop-color%3D%22%23534064%22%2F%3E%3Cstop%20offset%3D%22.71%22%20stop-color%3D%22%23b47582%22%2F%3E%3Cstop%20offset%3D%221%22%20stop-color%3D%22%23303754%22%2F%3E%3C%2FlinearGradient%3E%3ClinearGradient%20id%3D%22water%22%20x2%3D%220%22%20y2%3D%221%22%3E%3Cstop%20stop-color%3D%22%23344967%22%2F%3E%3Cstop%20offset%3D%221%22%20stop-color%3D%22%231b253f%22%2F%3E%3C%2FlinearGradient%3E%3C%2Fdefs%3E%3Cpath%20fill%3D%22url(%23sky)%22%20d%3D%22M0%200h1200v900H0z%22%2F%3E%3Ccircle%20cx%3D%2271%22%20cy%3D%2239%22%20r%3D%221.3%22%20fill%3D%22%23cde9ff%22%20opacity%3D%220.18%22%2F%3E%3Ccircle%20cx%3D%22228%22%20cy%3D%2298%22%20r%3D%220.65%22%20fill%3D%22%23cde9ff%22%20opacity%3D%220.27%22%2F%3E%3Ccircle%20cx%3D%22385%22%20cy%3D%22157%22%20r%3D%220.65%22%20fill%3D%22%23cde9ff%22%20opacity%3D%220.36%22%2F%3E%3Ccircle%20cx%3D%22542%22%20cy%3D%22216%22%20r%3D%220.65%22%20fill%3D%22%23cde9ff%22%20opacity%3D%220.45%22%2F%3E%3Ccircle%20cx%3D%22699%22%20cy%3D%22275%22%20r%3D%220.65%22%20fill%3D%22%23cde9ff%22%20opacity%3D%220.54%22%2F%3E%3Ccircle%20cx%3D%22856%22%20cy%3D%2244%22%20r%3D%220.65%22%20fill%3D%22%23cde9ff%22%20opacity%3D%220.18%22%2F%3E%3Ccircle%20cx%3D%221013%22%20cy%3D%22103%22%20r%3D%221.3%22%20fill%3D%22%23cde9ff%22%20opacity%3D%220.27%22%2F%3E%3Ccircle%20cx%3D%221170%22%20cy%3D%22162%22%20r%3D%220.65%22%20fill%3D%22%23cde9ff%22%20opacity%3D%220.36%22%2F%3E%3Ccircle%20cx%3D%22127%22%20cy%3D%22221%22%20r%3D%220.65%22%20fill%3D%22%23cde9ff%22%20opacity%3D%220.45%22%2F%3E%3Ccircle%20cx%3D%22284%22%20cy%3D%22280%22%20r%3D%220.65%22%20fill%3D%22%23cde9ff%22%20opacity%3D%220.54%22%2F%3E%3Ccircle%20cx%3D%22441%22%20cy%3D%2249%22%20r%3D%220.65%22%20fill%3D%22%23cde9ff%22%20opacity%3D%220.18%22%2F%3E%3Ccircle%20cx%3D%22598%22%20cy%3D%22108%22%20r%3D%220.65%22%20fill%3D%22%23cde9ff%22%20opacity%3D%220.27%22%2F%3E%3Ccircle%20cx%3D%22755%22%20cy%3D%22167%22%20r%3D%221.3%22%20fill%3D%22%23cde9ff%22%20opacity%3D%220.36%22%2F%3E%3Ccircle%20cx%3D%22912%22%20cy%3D%22226%22%20r%3D%220.65%22%20fill%3D%22%23cde9ff%22%20opacity%3D%220.45%22%2F%3E%3Ccircle%20cx%3D%221069%22%20cy%3D%22285%22%20r%3D%220.65%22%20fill%3D%22%23cde9ff%22%20opacity%3D%220.54%22%2F%3E%3Ccircle%20cx%3D%2226%22%20cy%3D%2254%22%20r%3D%220.65%22%20fill%3D%22%23cde9ff%22%20opacity%3D%220.18%22%2F%3E%3Ccircle%20cx%3D%22183%22%20cy%3D%22113%22%20r%3D%220.65%22%20fill%3D%22%23cde9ff%22%20opacity%3D%220.27%22%2F%3E%3Ccircle%20cx%3D%22340%22%20cy%3D%22172%22%20r%3D%220.65%22%20fill%3D%22%23cde9ff%22%20opacity%3D%220.36%22%2F%3E%3Ccircle%20cx%3D%22497%22%20cy%3D%22231%22%20r%3D%221.3%22%20fill%3D%22%23cde9ff%22%20opacity%3D%220.45%22%2F%3E%3Ccircle%20cx%3D%22654%22%20cy%3D%220%22%20r%3D%220.65%22%20fill%3D%22%23cde9ff%22%20opacity%3D%220.54%22%2F%3E%3Ccircle%20cx%3D%22811%22%20cy%3D%2259%22%20r%3D%220.65%22%20fill%3D%22%23cde9ff%22%20opacity%3D%220.18%22%2F%3E%3Ccircle%20cx%3D%22968%22%20cy%3D%22118%22%20r%3D%220.65%22%20fill%3D%22%23cde9ff%22%20opacity%3D%220.27%22%2F%3E%3Ccircle%20cx%3D%221125%22%20cy%3D%22177%22%20r%3D%220.65%22%20fill%3D%22%23cde9ff%22%20opacity%3D%220.36%22%2F%3E%3Ccircle%20cx%3D%2282%22%20cy%3D%22236%22%20r%3D%220.65%22%20fill%3D%22%23cde9ff%22%20opacity%3D%220.45%22%2F%3E%3Ccircle%20cx%3D%22239%22%20cy%3D%225%22%20r%3D%221.3%22%20fill%3D%22%23cde9ff%22%20opacity%3D%220.54%22%2F%3E%3Ccircle%20cx%3D%22396%22%20cy%3D%2264%22%20r%3D%220.65%22%20fill%3D%22%23cde9ff%22%20opacity%3D%220.18%22%2F%3E%3Ccircle%20cx%3D%22553%22%20cy%3D%22123%22%20r%3D%220.65%22%20fill%3D%22%23cde9ff%22%20opacity%3D%220.27%22%2F%3E%3Ccircle%20cx%3D%22710%22%20cy%3D%22182%22%20r%3D%220.65%22%20fill%3D%22%23cde9ff%22%20opacity%3D%220.36%22%2F%3E%3Ccircle%20cx%3D%22867%22%20cy%3D%22241%22%20r%3D%220.65%22%20fill%3D%22%23cde9ff%22%20opacity%3D%220.45%22%2F%3E%3Ccircle%20cx%3D%221024%22%20cy%3D%2210%22%20r%3D%220.65%22%20fill%3D%22%23cde9ff%22%20opacity%3D%220.54%22%2F%3E%3Ccircle%20cx%3D%221181%22%20cy%3D%2269%22%20r%3D%221.3%22%20fill%3D%22%23cde9ff%22%20opacity%3D%220.18%22%2F%3E%3Ccircle%20cx%3D%22138%22%20cy%3D%22128%22%20r%3D%220.65%22%20fill%3D%22%23cde9ff%22%20opacity%3D%220.27%22%2F%3E%3Ccircle%20cx%3D%22295%22%20cy%3D%22187%22%20r%3D%220.65%22%20fill%3D%22%23cde9ff%22%20opacity%3D%220.36%22%2F%3E%3Ccircle%20cx%3D%22452%22%20cy%3D%22246%22%20r%3D%220.65%22%20fill%3D%22%23cde9ff%22%20opacity%3D%220.45%22%2F%3E%3Ccircle%20cx%3D%22609%22%20cy%3D%2215%22%20r%3D%220.65%22%20fill%3D%22%23cde9ff%22%20opacity%3D%220.54%22%2F%3E%3Ccircle%20cx%3D%22766%22%20cy%3D%2274%22%20r%3D%220.65%22%20fill%3D%22%23cde9ff%22%20opacity%3D%220.18%22%2F%3E%3Ccircle%20cx%3D%22923%22%20cy%3D%22133%22%20r%3D%221.3%22%20fill%3D%22%23cde9ff%22%20opacity%3D%220.27%22%2F%3E%3Ccircle%20cx%3D%221080%22%20cy%3D%22192%22%20r%3D%220.65%22%20fill%3D%22%23cde9ff%22%20opacity%3D%220.36%22%2F%3E%3Ccircle%20cx%3D%2237%22%20cy%3D%22251%22%20r%3D%220.65%22%20fill%3D%22%23cde9ff%22%20opacity%3D%220.45%22%2F%3E%3Ccircle%20cx%3D%22194%22%20cy%3D%2220%22%20r%3D%220.65%22%20fill%3D%22%23cde9ff%22%20opacity%3D%220.54%22%2F%3E%3Ccircle%20cx%3D%22351%22%20cy%3D%2279%22%20r%3D%220.65%22%20fill%3D%22%23cde9ff%22%20opacity%3D%220.18%22%2F%3E%3Ccircle%20cx%3D%22508%22%20cy%3D%22138%22%20r%3D%220.65%22%20fill%3D%22%23cde9ff%22%20opacity%3D%220.27%22%2F%3E%3Ccircle%20cx%3D%22665%22%20cy%3D%22197%22%20r%3D%221.3%22%20fill%3D%22%23cde9ff%22%20opacity%3D%220.36%22%2F%3E%3Ccircle%20cx%3D%22215%22%20cy%3D%22158%22%20r%3D%2232%22%20fill%3D%22%23ffe1cd%22%20opacity%3D%22.64%22%2F%3E%3Ccircle%20cx%3D%22227%22%20cy%3D%22146%22%20r%3D%2231%22%20fill%3D%22%23242745%22%2F%3E%3Cg%20fill%3D%22none%22%20stroke-linecap%3D%22round%22%3E%3Cpath%20d%3D%22M53%20286q137-24%20286-3m199-67q96-20%20209-4m-542%20157q148-19%20280-3%22%20stroke%3D%22%23f8c9c6%22%20stroke-width%3D%2212%22%20opacity%3D%22.065%22%2F%3E%3Cpath%20d%3D%22M74%20292q128-12%20240-2m236-68q87-11%20176-4%22%20stroke%3D%22%23f6c5d0%22%20stroke-width%3D%223%22%20opacity%3D%22.09%22%2F%3E%3C%2Fg%3E%3Cpath%20d%3D%22M0%20582%20102%20563%20194%20482%20309%20529%20404%20472%20513%20558%20594%20520%20736%20421%20858%20509%20943%20489%201050%20551%201200%20513v387H0z%22%20fill%3D%22%23716784%22%2F%3E%3Cpath%20d%3D%22m575%20531%20161-110%20122%2088-100-36-24-17-26%2018-27%209z%22%20fill%3D%22%23d2adbc%22%20opacity%3D%22.31%22%2F%3E%3Cpath%20d%3D%22M0%20640q153-92%20291-27t259-18%20299-21%20351%2059v267H0z%22%20fill%3D%22%2346526b%22%2F%3E%3Cpath%20d%3D%22M0%20709q232-68%20406-5t319-36%20475%2036v196H0z%22%20fill%3D%22url(%23water)%22%2F%3E%3Cg%20stroke%3D%22%23bda0b6%22%20fill%3D%22none%22%20stroke-linecap%3D%22round%22%20opacity%3D%22.17%22%3E%3Cpath%20d%3D%22M180%20738h156m-185%2012h89m172%2024h153m-95%2016h277m-196%2020h104m-254%2034h438%22%2F%3E%3C%2Fg%3E%3Cpath%20d%3D%22M0%20857q131-47%20205-40t135%2028q119-25%20210%202t158%2053H0z%22%20fill%3D%22%23152238%22%2F%3E%3Cg%20fill%3D%22none%22%20stroke%3D%22%2325203b%22%20stroke-linecap%3D%22round%22%3E%3Cpath%20d%3D%22M1207-12q-11%2085-79%20138t-101%2049-135%2013%22%20stroke-width%3D%2218%22%2F%3E%3Cpath%20d%3D%22M1160%2092q-97%2018-151-15t-77-23m160%20104q-29%2077-82%2098m43-90q-35-7-74-48m117-25q11-42-22-78m16%20193q67%201%20106-37%22%20stroke-width%3D%227%22%2F%3E%3C%2Fg%3E%3Cg%20transform%3D%22translate(1074%2032)%20rotate(0)%22%20fill%3D%22%23ffe3dd%22%20opacity%3D%220.47%22%3E%3Cellipse%20cx%3D%220%22%20cy%3D%22-6.6000000000000005%22%20rx%3D%224.4399999999999995%22%20ry%3D%227.5600000000000005%22%20transform%3D%22rotate(0)%22%2F%3E%3Cellipse%20cx%3D%220%22%20cy%3D%22-6.6000000000000005%22%20rx%3D%224.4399999999999995%22%20ry%3D%227.5600000000000005%22%20transform%3D%22rotate(72)%22%2F%3E%3Cellipse%20cx%3D%220%22%20cy%3D%22-6.6000000000000005%22%20rx%3D%224.4399999999999995%22%20ry%3D%227.5600000000000005%22%20transform%3D%22rotate(144)%22%2F%3E%3Cellipse%20cx%3D%220%22%20cy%3D%22-6.6000000000000005%22%20rx%3D%224.4399999999999995%22%20ry%3D%227.5600000000000005%22%20transform%3D%22rotate(216)%22%2F%3E%3Cellipse%20cx%3D%220%22%20cy%3D%22-6.6000000000000005%22%20rx%3D%224.4399999999999995%22%20ry%3D%227.5600000000000005%22%20transform%3D%22rotate(288)%22%2F%3E%3Ccircle%20r%3D%222.16%22%20fill%3D%22%23ffdfad%22%2F%3E%3C%2Fg%3E%3Cg%20transform%3D%22translate(1109%2073)%20rotate(31)%22%20fill%3D%22%23efb6d2%22%20opacity%3D%220.6%22%3E%3Cellipse%20cx%3D%220%22%20cy%3D%22-9.9%22%20rx%3D%226.66%22%20ry%3D%2211.34%22%20transform%3D%22rotate(0)%22%2F%3E%3Cellipse%20cx%3D%220%22%20cy%3D%22-9.9%22%20rx%3D%226.66%22%20ry%3D%2211.34%22%20transform%3D%22rotate(72)%22%2F%3E%3Cellipse%20cx%3D%220%22%20cy%3D%22-9.9%22%20rx%3D%226.66%22%20ry%3D%2211.34%22%20transform%3D%22rotate(144)%22%2F%3E%3Cellipse%20cx%3D%220%22%20cy%3D%22-9.9%22%20rx%3D%226.66%22%20ry%3D%2211.34%22%20transform%3D%22rotate(216)%22%2F%3E%3Cellipse%20cx%3D%220%22%20cy%3D%22-9.9%22%20rx%3D%226.66%22%20ry%3D%2211.34%22%20transform%3D%22rotate(288)%22%2F%3E%3Ccircle%20r%3D%223.2399999999999998%22%20fill%3D%22%23ffdfad%22%2F%3E%3C%2Fg%3E%3Cg%20transform%3D%22translate(1008%2081)%20rotate(62)%22%20fill%3D%22%23efb6d2%22%20opacity%3D%220.73%22%3E%3Cellipse%20cx%3D%220%22%20cy%3D%22-7.15%22%20rx%3D%224.81%22%20ry%3D%228.19%22%20transform%3D%22rotate(0)%22%2F%3E%3Cellipse%20cx%3D%220%22%20cy%3D%22-7.15%22%20rx%3D%224.81%22%20ry%3D%228.19%22%20transform%3D%22rotate(72)%22%2F%3E%3Cellipse%20cx%3D%220%22%20cy%3D%22-7.15%22%20rx%3D%224.81%22%20ry%3D%228.19%22%20transform%3D%22rotate(144)%22%2F%3E%3Cellipse%20cx%3D%220%22%20cy%3D%22-7.15%22%20rx%3D%224.81%22%20ry%3D%228.19%22%20transform%3D%22rotate(216)%22%2F%3E%3Cellipse%20cx%3D%220%22%20cy%3D%22-7.15%22%20rx%3D%224.81%22%20ry%3D%228.19%22%20transform%3D%22rotate(288)%22%2F%3E%3Ccircle%20r%3D%222.34%22%20fill%3D%22%23ffdfad%22%2F%3E%3C%2Fg%3E%3Cg%20transform%3D%22translate(963%20112)%20rotate(93)%22%20fill%3D%22%23ffe3dd%22%20opacity%3D%220.47%22%3E%3Cellipse%20cx%3D%220%22%20cy%3D%22-9.350000000000001%22%20rx%3D%226.29%22%20ry%3D%2210.71%22%20transform%3D%22rotate(0)%22%2F%3E%3Cellipse%20cx%3D%220%22%20cy%3D%22-9.350000000000001%22%20rx%3D%226.29%22%20ry%3D%2210.71%22%20transform%3D%22rotate(72)%22%2F%3E%3Cellipse%20cx%3D%220%22%20cy%3D%22-9.350000000000001%22%20rx%3D%226.29%22%20ry%3D%2210.71%22%20transform%3D%22rotate(144)%22%2F%3E%3Cellipse%20cx%3D%220%22%20cy%3D%22-9.350000000000001%22%20rx%3D%226.29%22%20ry%3D%2210.71%22%20transform%3D%22rotate(216)%22%2F%3E%3Cellipse%20cx%3D%220%22%20cy%3D%22-9.350000000000001%22%20rx%3D%226.29%22%20ry%3D%2210.71%22%20transform%3D%22rotate(288)%22%2F%3E%3Ccircle%20r%3D%223.06%22%20fill%3D%22%23ffdfad%22%2F%3E%3C%2Fg%3E%3Cg%20transform%3D%22translate(1019%20140)%20rotate(124)%22%20fill%3D%22%23efb6d2%22%20opacity%3D%220.6%22%3E%3Cellipse%20cx%3D%220%22%20cy%3D%22-8.25%22%20rx%3D%225.55%22%20ry%3D%229.45%22%20transform%3D%22rotate(0)%22%2F%3E%3Cellipse%20cx%3D%220%22%20cy%3D%22-8.25%22%20rx%3D%225.55%22%20ry%3D%229.45%22%20transform%3D%22rotate(72)%22%2F%3E%3Cellipse%20cx%3D%220%22%20cy%3D%22-8.25%22%20rx%3D%225.55%22%20ry%3D%229.45%22%20transform%3D%22rotate(144)%22%2F%3E%3Cellipse%20cx%3D%220%22%20cy%3D%22-8.25%22%20rx%3D%225.55%22%20ry%3D%229.45%22%20transform%3D%22rotate(216)%22%2F%3E%3Cellipse%20cx%3D%220%22%20cy%3D%22-8.25%22%20rx%3D%225.55%22%20ry%3D%229.45%22%20transform%3D%22rotate(288)%22%2F%3E%3Ccircle%20r%3D%222.6999999999999997%22%20fill%3D%22%23ffdfad%22%2F%3E%3C%2Fg%3E%3Cg%20transform%3D%22translate(1118%20128)%20rotate(155)%22%20fill%3D%22%23efb6d2%22%20opacity%3D%220.73%22%3E%3Cellipse%20cx%3D%220%22%20cy%3D%22-7.15%22%20rx%3D%224.81%22%20ry%3D%228.19%22%20transform%3D%22rotate(0)%22%2F%3E%3Cellipse%20cx%3D%220%22%20cy%3D%22-7.15%22%20rx%3D%224.81%22%20ry%3D%228.19%22%20transform%3D%22rotate(72)%22%2F%3E%3Cellipse%20cx%3D%220%22%20cy%3D%22-7.15%22%20rx%3D%224.81%22%20ry%3D%228.19%22%20transform%3D%22rotate(144)%22%2F%3E%3Cellipse%20cx%3D%220%22%20cy%3D%22-7.15%22%20rx%3D%224.81%22%20ry%3D%228.19%22%20transform%3D%22rotate(216)%22%2F%3E%3Cellipse%20cx%3D%220%22%20cy%3D%22-7.15%22%20rx%3D%224.81%22%20ry%3D%228.19%22%20transform%3D%22rotate(288)%22%2F%3E%3Ccircle%20r%3D%222.34%22%20fill%3D%22%23ffdfad%22%2F%3E%3C%2Fg%3E%3Cg%20transform%3D%22translate(1180%20175)%20rotate(186)%22%20fill%3D%22%23ffe3dd%22%20opacity%3D%220.47%22%3E%3Cellipse%20cx%3D%220%22%20cy%3D%22-9.350000000000001%22%20rx%3D%226.29%22%20ry%3D%2210.71%22%20transform%3D%22rotate(0)%22%2F%3E%3Cellipse%20cx%3D%220%22%20cy%3D%22-9.350000000000001%22%20rx%3D%226.29%22%20ry%3D%2210.71%22%20transform%3D%22rotate(72)%22%2F%3E%3Cellipse%20cx%3D%220%22%20cy%3D%22-9.350000000000001%22%20rx%3D%226.29%22%20ry%3D%2210.71%22%20transform%3D%22rotate(144)%22%2F%3E%3Cellipse%20cx%3D%220%22%20cy%3D%22-9.350000000000001%22%20rx%3D%226.29%22%20ry%3D%2210.71%22%20transform%3D%22rotate(216)%22%2F%3E%3Cellipse%20cx%3D%220%22%20cy%3D%22-9.350000000000001%22%20rx%3D%226.29%22%20ry%3D%2210.71%22%20transform%3D%22rotate(288)%22%2F%3E%3Ccircle%20r%3D%223.06%22%20fill%3D%22%23ffdfad%22%2F%3E%3C%2Fg%3E%3Cg%20transform%3D%22translate(1081%20187)%20rotate(217)%22%20fill%3D%22%23efb6d2%22%20opacity%3D%220.6%22%3E%3Cellipse%20cx%3D%220%22%20cy%3D%22-6.6000000000000005%22%20rx%3D%224.4399999999999995%22%20ry%3D%227.5600000000000005%22%20transform%3D%22rotate(0)%22%2F%3E%3Cellipse%20cx%3D%220%22%20cy%3D%22-6.6000000000000005%22%20rx%3D%224.4399999999999995%22%20ry%3D%227.5600000000000005%22%20transform%3D%22rotate(72)%22%2F%3E%3Cellipse%20cx%3D%220%22%20cy%3D%22-6.6000000000000005%22%20rx%3D%224.4399999999999995%22%20ry%3D%227.5600000000000005%22%20transform%3D%22rotate(144)%22%2F%3E%3Cellipse%20cx%3D%220%22%20cy%3D%22-6.6000000000000005%22%20rx%3D%224.4399999999999995%22%20ry%3D%227.5600000000000005%22%20transform%3D%22rotate(216)%22%2F%3E%3Cellipse%20cx%3D%220%22%20cy%3D%22-6.6000000000000005%22%20rx%3D%224.4399999999999995%22%20ry%3D%227.5600000000000005%22%20transform%3D%22rotate(288)%22%2F%3E%3Ccircle%20r%3D%222.16%22%20fill%3D%22%23ffdfad%22%2F%3E%3C%2Fg%3E%3Cg%20transform%3D%22translate(996%20198)%20rotate(248)%22%20fill%3D%22%23efb6d2%22%20opacity%3D%220.73%22%3E%3Cellipse%20cx%3D%220%22%20cy%3D%22-6.6000000000000005%22%20rx%3D%224.4399999999999995%22%20ry%3D%227.5600000000000005%22%20transform%3D%22rotate(0)%22%2F%3E%3Cellipse%20cx%3D%220%22%20cy%3D%22-6.6000000000000005%22%20rx%3D%224.4399999999999995%22%20ry%3D%227.5600000000000005%22%20transform%3D%22rotate(72)%22%2F%3E%3Cellipse%20cx%3D%220%22%20cy%3D%22-6.6000000000000005%22%20rx%3D%224.4399999999999995%22%20ry%3D%227.5600000000000005%22%20transform%3D%22rotate(144)%22%2F%3E%3Cellipse%20cx%3D%220%22%20cy%3D%22-6.6000000000000005%22%20rx%3D%224.4399999999999995%22%20ry%3D%227.5600000000000005%22%20transform%3D%22rotate(216)%22%2F%3E%3Cellipse%20cx%3D%220%22%20cy%3D%22-6.6000000000000005%22%20rx%3D%224.4399999999999995%22%20ry%3D%227.5600000000000005%22%20transform%3D%22rotate(288)%22%2F%3E%3Ccircle%20r%3D%222.16%22%20fill%3D%22%23ffdfad%22%2F%3E%3C%2Fg%3E%3Cg%20transform%3D%22translate(905%20155)%20rotate(279)%22%20fill%3D%22%23ffe3dd%22%20opacity%3D%220.47%22%3E%3Cellipse%20cx%3D%220%22%20cy%3D%22-6.050000000000001%22%20rx%3D%224.07%22%20ry%3D%226.93%22%20transform%3D%22rotate(0)%22%2F%3E%3Cellipse%20cx%3D%220%22%20cy%3D%22-6.050000000000001%22%20rx%3D%224.07%22%20ry%3D%226.93%22%20transform%3D%22rotate(72)%22%2F%3E%3Cellipse%20cx%3D%220%22%20cy%3D%22-6.050000000000001%22%20rx%3D%224.07%22%20ry%3D%226.93%22%20transform%3D%22rotate(144)%22%2F%3E%3Cellipse%20cx%3D%220%22%20cy%3D%22-6.050000000000001%22%20rx%3D%224.07%22%20ry%3D%226.93%22%20transform%3D%22rotate(216)%22%2F%3E%3Cellipse%20cx%3D%220%22%20cy%3D%22-6.050000000000001%22%20rx%3D%224.07%22%20ry%3D%226.93%22%20transform%3D%22rotate(288)%22%2F%3E%3Ccircle%20r%3D%221.98%22%20fill%3D%22%23ffdfad%22%2F%3E%3C%2Fg%3E%3Cg%20transform%3D%22translate(1160%2042)%20rotate(310)%22%20fill%3D%22%23efb6d2%22%20opacity%3D%220.6%22%3E%3Cellipse%20cx%3D%220%22%20cy%3D%22-6.6000000000000005%22%20rx%3D%224.4399999999999995%22%20ry%3D%227.5600000000000005%22%20transform%3D%22rotate(0)%22%2F%3E%3Cellipse%20cx%3D%220%22%20cy%3D%22-6.6000000000000005%22%20rx%3D%224.4399999999999995%22%20ry%3D%227.5600000000000005%22%20transform%3D%22rotate(72)%22%2F%3E%3Cellipse%20cx%3D%220%22%20cy%3D%22-6.6000000000000005%22%20rx%3D%224.4399999999999995%22%20ry%3D%227.5600000000000005%22%20transform%3D%22rotate(144)%22%2F%3E%3Cellipse%20cx%3D%220%22%20cy%3D%22-6.6000000000000005%22%20rx%3D%224.4399999999999995%22%20ry%3D%227.5600000000000005%22%20transform%3D%22rotate(216)%22%2F%3E%3Cellipse%20cx%3D%220%22%20cy%3D%22-6.6000000000000005%22%20rx%3D%224.4399999999999995%22%20ry%3D%227.5600000000000005%22%20transform%3D%22rotate(288)%22%2F%3E%3Ccircle%20r%3D%222.16%22%20fill%3D%22%23ffdfad%22%2F%3E%3C%2Fg%3E%3Cg%20transform%3D%22translate(970%2044)%20rotate(341)%22%20fill%3D%22%23efb6d2%22%20opacity%3D%220.73%22%3E%3Cellipse%20cx%3D%220%22%20cy%3D%22-5.5%22%20rx%3D%223.7%22%20ry%3D%226.3%22%20transform%3D%22rotate(0)%22%2F%3E%3Cellipse%20cx%3D%220%22%20cy%3D%22-5.5%22%20rx%3D%223.7%22%20ry%3D%226.3%22%20transform%3D%22rotate(72)%22%2F%3E%3Cellipse%20cx%3D%220%22%20cy%3D%22-5.5%22%20rx%3D%223.7%22%20ry%3D%226.3%22%20transform%3D%22rotate(144)%22%2F%3E%3Cellipse%20cx%3D%220%22%20cy%3D%22-5.5%22%20rx%3D%223.7%22%20ry%3D%226.3%22%20transform%3D%22rotate(216)%22%2F%3E%3Cellipse%20cx%3D%220%22%20cy%3D%22-5.5%22%20rx%3D%223.7%22%20ry%3D%226.3%22%20transform%3D%22rotate(288)%22%2F%3E%3Ccircle%20r%3D%221.7999999999999998%22%20fill%3D%22%23ffdfad%22%2F%3E%3C%2Fg%3E%3Cg%20transform%3D%22translate(860%20192)%20rotate(372)%22%20fill%3D%22%23ffe3dd%22%20opacity%3D%220.47%22%3E%3Cellipse%20cx%3D%220%22%20cy%3D%22-5.5%22%20rx%3D%223.7%22%20ry%3D%226.3%22%20transform%3D%22rotate(0)%22%2F%3E%3Cellipse%20cx%3D%220%22%20cy%3D%22-5.5%22%20rx%3D%223.7%22%20ry%3D%226.3%22%20transform%3D%22rotate(72)%22%2F%3E%3Cellipse%20cx%3D%220%22%20cy%3D%22-5.5%22%20rx%3D%223.7%22%20ry%3D%226.3%22%20transform%3D%22rotate(144)%22%2F%3E%3Cellipse%20cx%3D%220%22%20cy%3D%22-5.5%22%20rx%3D%223.7%22%20ry%3D%226.3%22%20transform%3D%22rotate(216)%22%2F%3E%3Cellipse%20cx%3D%220%22%20cy%3D%22-5.5%22%20rx%3D%223.7%22%20ry%3D%226.3%22%20transform%3D%22rotate(288)%22%2F%3E%3Ccircle%20r%3D%221.7999999999999998%22%20fill%3D%22%23ffdfad%22%2F%3E%3C%2Fg%3E%3Cg%20transform%3D%22translate(1030%20238)%20rotate(403)%22%20fill%3D%22%23efb6d2%22%20opacity%3D%220.6%22%3E%3Cellipse%20cx%3D%220%22%20cy%3D%22-6.6000000000000005%22%20rx%3D%224.4399999999999995%22%20ry%3D%227.5600000000000005%22%20transform%3D%22rotate(0)%22%2F%3E%3Cellipse%20cx%3D%220%22%20cy%3D%22-6.6000000000000005%22%20rx%3D%224.4399999999999995%22%20ry%3D%227.5600000000000005%22%20transform%3D%22rotate(72)%22%2F%3E%3Cellipse%20cx%3D%220%22%20cy%3D%22-6.6000000000000005%22%20rx%3D%224.4399999999999995%22%20ry%3D%227.5600000000000005%22%20transform%3D%22rotate(144)%22%2F%3E%3Cellipse%20cx%3D%220%22%20cy%3D%22-6.6000000000000005%22%20rx%3D%224.4399999999999995%22%20ry%3D%227.5600000000000005%22%20transform%3D%22rotate(216)%22%2F%3E%3Cellipse%20cx%3D%220%22%20cy%3D%22-6.6000000000000005%22%20rx%3D%224.4399999999999995%22%20ry%3D%227.5600000000000005%22%20transform%3D%22rotate(288)%22%2F%3E%3Ccircle%20r%3D%222.16%22%20fill%3D%22%23ffdfad%22%2F%3E%3C%2Fg%3E%3Cellipse%20cx%3D%2287%22%20cy%3D%22290%22%20rx%3D%222%22%20ry%3D%224%22%20transform%3D%22rotate(0%2087%20290)%22%20fill%3D%22%23edb7d3%22%20opacity%3D%220.18%22%2F%3E%3Cellipse%20cx%3D%22230%22%20cy%3D%22417%22%20rx%3D%223%22%20ry%3D%225%22%20transform%3D%22rotate(19%20230%20417)%22%20fill%3D%22%23edb7d3%22%20opacity%3D%220.26%22%2F%3E%3Cellipse%20cx%3D%22373%22%20cy%3D%22544%22%20rx%3D%224%22%20ry%3D%226%22%20transform%3D%22rotate(38%20373%20544)%22%20fill%3D%22%23edb7d3%22%20opacity%3D%220.33999999999999997%22%2F%3E%3Cellipse%20cx%3D%22516%22%20cy%3D%22671%22%20rx%3D%222%22%20ry%3D%227%22%20transform%3D%22rotate(57%20516%20671)%22%20fill%3D%22%23edb7d3%22%20opacity%3D%220.18%22%2F%3E%3Cellipse%20cx%3D%22659%22%20cy%3D%22798%22%20rx%3D%223%22%20ry%3D%224%22%20transform%3D%22rotate(76%20659%20798)%22%20fill%3D%22%23edb7d3%22%20opacity%3D%220.26%22%2F%3E%3Cellipse%20cx%3D%22802%22%20cy%3D%2290%22%20rx%3D%224%22%20ry%3D%225%22%20transform%3D%22rotate(95%20802%2090)%22%20fill%3D%22%23edb7d3%22%20opacity%3D%220.33999999999999997%22%2F%3E%3Cellipse%20cx%3D%22945%22%20cy%3D%22217%22%20rx%3D%222%22%20ry%3D%226%22%20transform%3D%22rotate(114%20945%20217)%22%20fill%3D%22%23edb7d3%22%20opacity%3D%220.18%22%2F%3E%3Cellipse%20cx%3D%221088%22%20cy%3D%22344%22%20rx%3D%223%22%20ry%3D%227%22%20transform%3D%22rotate(133%201088%20344)%22%20fill%3D%22%23edb7d3%22%20opacity%3D%220.26%22%2F%3E%3Cellipse%20cx%3D%2271%22%20cy%3D%22471%22%20rx%3D%224%22%20ry%3D%224%22%20transform%3D%22rotate(152%2071%20471)%22%20fill%3D%22%23edb7d3%22%20opacity%3D%220.33999999999999997%22%2F%3E%3Cellipse%20cx%3D%22214%22%20cy%3D%22598%22%20rx%3D%222%22%20ry%3D%225%22%20transform%3D%22rotate(171%20214%20598)%22%20fill%3D%22%23edb7d3%22%20opacity%3D%220.18%22%2F%3E%3Cellipse%20cx%3D%22357%22%20cy%3D%22725%22%20rx%3D%223%22%20ry%3D%226%22%20transform%3D%22rotate(190%20357%20725)%22%20fill%3D%22%23edb7d3%22%20opacity%3D%220.26%22%2F%3E%3Cellipse%20cx%3D%22500%22%20cy%3D%2217%22%20rx%3D%224%22%20ry%3D%227%22%20transform%3D%22rotate(209%20500%2017)%22%20fill%3D%22%23edb7d3%22%20opacity%3D%220.33999999999999997%22%2F%3E%3Cellipse%20cx%3D%22643%22%20cy%3D%22144%22%20rx%3D%222%22%20ry%3D%224%22%20transform%3D%22rotate(228%20643%20144)%22%20fill%3D%22%23edb7d3%22%20opacity%3D%220.18%22%2F%3E%3Cellipse%20cx%3D%22786%22%20cy%3D%22271%22%20rx%3D%223%22%20ry%3D%225%22%20transform%3D%22rotate(247%20786%20271)%22%20fill%3D%22%23edb7d3%22%20opacity%3D%220.26%22%2F%3E%3Cellipse%20cx%3D%22929%22%20cy%3D%22398%22%20rx%3D%224%22%20ry%3D%226%22%20transform%3D%22rotate(266%20929%20398)%22%20fill%3D%22%23edb7d3%22%20opacity%3D%220.33999999999999997%22%2F%3E%3Cpath%20d%3D%22M34%20805q20-68%2017-117m1%2037%2015-36m-16%2067-18-27%22%20fill%3D%22none%22%20stroke%3D%22%231f2942%22%20stroke-width%3D%225%22%2F%3E%3Cpath%20d%3D%22m45%20738%2043-42-25%2057-17%2031z%22%20fill%3D%22%231e2c43%22%2F%3E%3Cpath%20d%3D%22m48%20754-25-19%2012%2048%2013%2028z%22%20fill%3D%22%231a2941%22%2F%3E%3C%2Fsvg%3E") center / cover no-repeat, #171f43;
    }
    html.${CLASS}[data-converge-chat-theme="cyberpunk"] main article[data-testid^="conversation-turn"] {
      background-color: rgba(4, 12, 27, .79) !important; border-color: rgba(97, 220, 247, .18);
    }
    html.${CLASS}[data-converge-chat-theme="anime"] main article[data-testid^="conversation-turn"] {
      background-color: rgba(17, 22, 43, .79) !important; border-color: rgba(242, 194, 221, .17);
    }
    html.${CLASS}[data-converge-chat-theme="cyberpunk"] main [data-user-message-bubble] {
      background-color: rgba(17, 44, 64, .93) !important;
    }
    html.${CLASS}[data-converge-chat-theme="anime"] main [data-user-message-bubble] {
      background-color: rgba(57, 37, 64, .93) !important;
    }
    html.${CLASS}:not([data-converge-chat-theme="night"]) #${LAYER_ID} canvas { visibility: hidden; }
    html.${CLASS}[data-converge-chat-theme="alien"] main article[data-testid^="conversation-turn"] {
      background-color: rgba(2, 15, 17, .72) !important;
    }
    html.${CLASS}[data-converge-chat-theme="horror"] main article[data-testid^="conversation-turn"] {
      background-color: rgba(5, 4, 7, .78) !important;
    }
    html.${CLASS} :is(#root, #__next, main, [${LAYOUT}]) {
      background-color: transparent !important;
      background-image: none !important;
    }
    html.${CLASS} body, html.${CLASS} :is(button, input, select, textarea, #prompt-textarea, [data-message-author-role]) {
      font-family: 'Converge Manrope', 'Segoe UI Variable', 'Segoe UI', sans-serif !important;
    }
    html.${CLASS} main :is(pre, code, kbd, samp) {
      font-family: ui-monospace, 'Cascadia Code', Consolas, monospace !important;
    }
    html.${CLASS} main { color: #edf2ff; }
    html.${CLASS} main article[data-testid^="conversation-turn"] {
      background-color: rgba(5, 9, 25, .56) !important;
      border-color: rgba(182, 205, 255, .11);
    }
    html.${CLASS} main [data-user-message-bubble] {
      background-color: rgba(18, 35, 78, .83) !important;
    }
    html.${CLASS} main [data-message-author-role="assistant"] {
      text-shadow: 0 1px 3px rgba(0, 0, 0, .68);
    }
    html.${CLASS} main [data-message-author-role] a[href]:not([role="button"]):not([class]) {
      color: #b9e9fc;
    }
    html.${CLASS} main :is(pre, [data-testid="code-block"]) {
      background-color: rgba(6, 9, 22, .95) !important;
      text-shadow: none;
    }
    html.${CLASS} main :is(form:has(#prompt-textarea), form:has([data-testid="prompt-textarea"]), [data-type="unified-composer"]) {
      background-color: rgba(9, 15, 35, .93) !important;
      border-color: rgba(148, 173, 255, .3);
      border-radius: 24px;
    }
    html.${CLASS} main :is([role="dialog"], [role="menu"], [data-radix-popper-content-wrapper]) {
      background-color: rgba(10, 17, 35, .98) !important;
      text-shadow: none;
    }
    @media (prefers-reduced-motion: reduce) {
      html.${CLASS} #${LAYER_ID} { contain: strict; }
    }
  `;

  let controller = null;
  function create(options = {}) {
    if (controller) return controller;
    const document = options.document || global.document;
    const window = options.window || global.window || global;
    const galaxy = options.galaxy || global.ConvergeGalaxy;
    if (!document?.body || !document.documentElement || typeof galaxy?.create !== 'function') return null;
    // The embedding preload enforces the main frame and exact origin. Keep a
    // second guard here so the cosmetic module also fails closed on direct use.
    const origin = window.location?.origin;
    const qaOrigin = options.qaOrigin;
    if (origin !== 'https://chatgpt.com' && !(qaOrigin && /^http:\/\/127\.0\.0\.1:\d+$/.test(qaOrigin) && origin === qaOrigin)) return null;

    const style = document.createElement('style');
    style.id = STYLE_ID; style.textContent = CSS;
    const layer = document.createElement('div');
    layer.id = LAYER_ID;
    layer.setAttribute('aria-hidden', 'true');
    layer.setAttribute('role', 'presentation');
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    layer.appendChild(canvas);
    document.head.appendChild(style);
    document.body.prepend(layer);
    document.documentElement.classList.add(CLASS);
    let chatTheme = 'night';
    document.documentElement.setAttribute('data-converge-chat-theme', chatTheme);

    let scene;
    // Keep the chat backdrop still. Visible motion is concentrated in the
    // shell's narrow star ribbons, rather than rendering three full-screen
    // animated backgrounds beneath conversation content.
    try { scene = galaxy.create(canvas, { brightness: .86, fps: 24, startPaused: true }); }
    catch (error) {
      style.remove(); layer.remove(); document.documentElement.classList.remove(CLASS);
      throw error;
    }
    let paused = false;
    let disposed = false;
    let refreshTimer = null;
    const marked = new Set();
    const motion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const effectsSuppressed = () => paused || document.hidden || Boolean(motion?.matches);
    const setScenePaused = () => scene?.setPaused?.(true);

    // Only layout ancestors of the real main/turn/editor are made transparent.
    // Menus, file cards, code, message bubbles and editable elements keep their
    // native structure, hit testing, styles and functionality.
    const markAncestors = (element, includeSelf = false) => {
      let current = includeSelf ? element : element?.parentElement;
      for (let count = 0; current && current !== document.body && count < 24; count++, current = current.parentElement) {
        if (!['DIV', 'MAIN', 'SECTION'].includes(current.tagName)) continue;
        if (current.closest('[role="dialog"], [role="menu"], [data-radix-popper-content-wrapper], pre')) continue;
        if (current.matches('[data-user-message-bubble], [data-message-author-role], [contenteditable="true"]')) continue;
        const rect = current.getBoundingClientRect();
        if (current.tagName !== 'MAIN' && (rect.width < window.innerWidth * .65 || rect.height < 100)) continue;
        if (!current.hasAttribute(LAYOUT)) { current.setAttribute(LAYOUT, ''); marked.add(current); }
      }
    };
    const refresh = () => {
      refreshTimer = null;
      if (disposed) return;
      for (const element of marked) if (!element.isConnected) marked.delete(element);
      const main = document.querySelector('main');
      if (main) markAncestors(main, true);
      // Bound work on long virtualized conversations; no message text is read.
      for (const element of [...document.querySelectorAll(TURN_SELECTOR)].slice(-12)) markAncestors(element);
      for (const element of document.querySelectorAll(EDITOR_SELECTOR)) markAncestors(element);
      setScenePaused();
    };
    const scheduleRefresh = () => {
      if (disposed || refreshTimer !== null) return;
      refreshTimer = window.setTimeout(refresh, 180);
    };
    const observer = new window.MutationObserver(scheduleRefresh);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('visibilitychange', setScenePaused);
    motion?.addEventListener?.('change', setScenePaused);
    window.addEventListener('resize', scheduleRefresh);
    refresh();

    const dispose = () => {
      if (disposed) return;
      disposed = true;
      observer.disconnect();
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      document.removeEventListener('visibilitychange', setScenePaused);
      motion?.removeEventListener?.('change', setScenePaused);
      window.removeEventListener('resize', scheduleRefresh);
      window.removeEventListener('pagehide', dispose);
      scene?.dispose?.();
      for (const element of marked) element.removeAttribute(LAYOUT);
      marked.clear(); style.remove(); layer.remove();
      document.documentElement.classList.remove(CLASS);
      document.documentElement.removeAttribute('data-converge-chat-theme');
      controller = null;
    };
    window.addEventListener('pagehide', dispose, { once: true });
    controller = Object.freeze({
      setPaused(value) { paused = value === true; setScenePaused(); },
      setTheme(value) {
        if (!['night', 'horror', 'alien', 'cyberpunk', 'anime'].includes(value) || disposed) return false;
        chatTheme = value;
        document.documentElement.setAttribute('data-converge-chat-theme', chatTheme);
        return true;
      },
      diagnostics() { return { ...scene?.diagnostics?.(), chatTheme, decoratedLayouts: marked.size, animated: false, effectsSuppressed: effectsSuppressed() }; },
      dispose,
    });
    return controller;
  }
  global.ConvergePageAppearance = Object.freeze({ create });
})(globalThis);

 })();
  } catch (_) { /* Retain ChatGPT's native appearance if effects cannot load. */ }
  let pageAppearance = null;
  let pageEffectsPaused = false;
  let chatTheme = 'night';
  ipcRenderer.on('converge:page-appearance', (_event, payload) => {
    if (!['night', 'horror', 'alien', 'cyberpunk', 'anime'].includes(payload?.chatTheme)) return;
    chatTheme = payload.chatTheme;
    pageAppearance?.setTheme(chatTheme);
  });
  ipcRenderer.on('converge:page-effects', (_event, payload) => {
    if (typeof payload?.paused !== 'boolean') return;
    pageEffectsPaused = payload.paused;
    pageAppearance?.setPaused(pageEffectsPaused);
  });

  const initialize = () => {
    // Load the same local typeface as the shell from memory. This makes no
    // network request and retains the native monospace font for code and math.
    try {
      const fontBytes = Uint8Array.from(atob("AAEAAAATAQAABAAwR0RFRv16BtUAATBcAAAAUEdQT1PhC3ATAAEwrAAAXiBHU1VCvJ5e0QABjswAAA3sSFZBUiBlY7sAAZy4AAAD9k9TLzKSlHgMAAABuAAAAGBTVEFUfqF5nQABoLAAAACCY21hcNQ36nkAAA2wAAAG7GZ2YXKMPHWdAAGhNAAAAGpnYXNwAAAAEAABMFQAAAAIZ2x5ZihLqRQAABp0AAD5OGd2YXKoAstcAAGhoAAA4bpoZWFkKescDQAAATwAAAA2aGhlYRCjESIAAAF0AAAAJGhtdHjJWSwGAAACGAAAC5hsb2NhpvloFwAAFKQAAAXObWF4cAL9AL8AAAGYAAAAIG5hbWW2UeB2AAETrAAABYBwb3N0WihptwABGSwAABcncHJlcGgGjIUAABScAAAABwABAAAABIFIRmnKrF8PPPUAAwfQAAAAANu2poQAAAAA5s2pIP5w/gIJ3AhUAAAABgACAAAAAAAAAAEAAAhU/agAAApU/nD+cAncB9AAAAAAAAAAAAAAAAAAAALmAAEAAALmAGQADQBZAAYAAQAAAAAAAAAAAAAAAAADAAEABARrAMgABQAABRQEsAAAAJYFFASwAAACvAAyAogAAAAAAAAAAAAAAACgAAK/UAAgawAAAAAAAAAAU0hNSQDAAA37AghU/agAAAhUAlggAAGfAAAAAAQ4BaAAAAAgAAQFyADIBMIAKATCACgEwgAoBMIAKATCACgEwgAoBMIAKATCACgEwgAoBMIAKATCACgEwgAoBMIAKATCACgEwgAoBMIAKATCACgEwgAoBMIAKATCACgEwgAoBMIAKAcSACgEsgCMBXgAPAV4ADwFeAA8BXgAPAV4ADwFeAA8BRgAjAUCABQFGACMBQIAFARgAIwEYACMBGAAjARgAIwEYACMBGAAjARgAIwEsACMBGAAjARgAIwEYACMBLAAjARgAIwEYACMBGAAjARgAIwEYACMA9QAjAVeADwFXgA8BV4APAVeADwFXgA8BSgAjAVQABQFKACMAZQAoAGUAKABlP/UAZT/2gGUAI4BlACOAZQAPAGUADoBlP/aAZT/tgGU/6sDbgAAA24AAARcAIwEXACMA94AoAPeAKAD3gCgA94AoAPeAGIGfgCMBSwAjAUsAIwFLACMBSwAjAUsAIwFLACMBYQAPAWEADwFhAA8BYQAPAWEADwFhAA8BYQAPAWEADwFhAA8BYQAPAWEADwFhAA8BYQAPAWEADwFhAA8BYQAPAWEADwFhAA8BYQAPAWEADwFhAAKBYQAPAjIADwEigCMBHYAjAWEADwExgCMBMYAjATGAIwExgCMBJoAPASaADwEmgA8BJoAPASaADwEmgA8BU8AjAScABQEnAAUBJwAFAScABQEnAAUBWQAjAVkAIwFZACMBWQAjAVkAIwFZACMBWQAjAVkAIwFZACMBWQAjAVkAIwFZACMBWQAjAVkAIwFZACMBWQAjAVkAIwFZACMBWQAjASGAAoHGgAoBxoAKAcaACgHGgAoBxoAKAR6ABQEDgAABA4AAAQOAAAEDgAABA4AAAQOAAAEDgAABA4AAASKAGQEigBkBIoAZASKAGQEPABQBDwAUAQ8AFAEPABQBDwAUAQ8AFAEPABQBDwAUAQ8AFAEPABQBDwAUAQ8AFAEPABQBDwAUAQ8AFAEPABQBDwAUAQ8AFAEPABQBDwAUAQ8AFAEPABQB2QAUASAAIwENgBQBDYAUAQ2AFAENgBQBDYAUAQ2AFAEgABQBHoAUAVCAFAEgABQBHoAUAR6AFAEegBQBHoAUAR6AFAEegBQBHoAUAR6AFAEegBQBHoAUAR6AFAEegBQBHoAUASwAFAEegBQBHoAUAR6AFAEegBQAqYAPASAAFAEgABQBIAAUASAAFAEgABQBHoAjAR6AAAEev+9AZQAoAGUAKABlACgAZT/1AGU/9oBlACgAZQAjgGUADwBlAAxAZT/2gGU/7YBlP+rAcL/7AHC/+wDqACMA6gAjAGUAKABlACgAggAoAGUAI4C0gBiBlwAjAR6AIwEegCMBHoAjAR6AIwEegCMBHoAjAR8AFAEfABQBHwAUAR8AFAEfABQBHwAUAR8AFAEfABQBHwAUAR8AFAEfABQBHwAUAR8AFAEsABQBHwAUASwAFAEfABQBHwAUAR8AFAEfABQBHwAIAR8AFAH/gBQBIAAjASAAIwEgABQAp4AjAKeAIwCngCGAp4AegQEAFAEBABQBAQAUAQEAFAEBABQBAQAUAR+AIwC9gAUAx4AFAL2ABQC9gAUAvYAFAR6AHgEegB4BHoAeAR6AHgEegB4BHoAeAR6AHgEegB4BHoAeAR6AHgEegB4BHoAeAR6AHgEegB4BHoAeAR6AHgEegB4BHoAeAR6AHgDvAAoBdAAKAXQACgF0AAoBdAAKAXQACgD+gAUA/QAKAP0ACgD9AAoA/QAKAP0ACgD9AAoA/QAKAP0ACgEHgAoBB4AKAQeACgEHgAoBOgAPAbMADwEWAA8BIoAPAV0ABQCbwBQAqkAUATCACgEigCMBLIAjAQQAIwEEACMBCQAjAWwAFAEYACMBGAAjARgAIwG1AAUBGIAPAUsAIwFLACMBSwAjARcAIwEXACMBVgAKAZ+AIwFKACMBYQAPAU8AIwEigCMBXgAPAScABQEzAAoBMwAKAVoADwEegAUBOYAjAVsAIwG4ACMBvwAjAWMAIwEngCMBJ7/7AW6AIwIdgAUCAoAjASaADwFkABfBWgAPAGUAKABlP/aA24AAATmAAAHBACMBMYAUATkAAAEDgAABOYAjAWsADwFhAA8BtQAFARcAIwEhgAKBDwAUAR6AFAEEACMA44AjAOOAIwDjgCMBH4APAR6AFAEegBQBHoAUAUcABQD4gA8BD4AjAQ+AIwEPgCMA6gAjAOoAIwEWAAoBTwAjAR0AIwEfABQBD4AjASAAIwENgBQA9QAMgP0ACgD9AAoBXQAUAP6ABQEFgBQBKQAjAXCAIwF8gCMBD4AjAQAAIwEKAAoBOAAjAZyACgGIACMBAQAUAQ2AFAENgBGAZQAoAGU/9oBwv/sBHoAAAXeAIwEKABQBHoAAAO8ACgEPgC0BHwAUARAAIwEBABQBIAAUAUYABYEigBQBHoAeAR6AHgEPgB4A6gAjAO8ACgEdACMBHoAjAZcAIwEFgBQBJQAeAZcAHgGdgB4BAAAjAXeAIwEegBQBMIAKASyAIwEEACMBMIAKARgAIwEigBkBSgAjAWEADwBlACgBFwAjASGAAoGfgCMBSwAjAU8AIwFhAA8BTwAjASKAIwFKACMBJwAFAQOAAAFaAA8BHoAFAVkAIwFhAA8BMIAKAVQACgGGgAoAlsAKAY2AEQFWABQBlYARAGU/9oEDgAABKgAUAQ+AIwDvAAoBHwAUAPiAFAD1ABQBHoAjAT8AFAChACgA6gAjAPkAFAEjgCMA7wAKAQwAFAEfABQBQAAKAR4AIwENgBQBJAAUAPeADIEXAB4BZwAUAP6ABQFPAB4BfQAUAKEAKACXP/aAoT/1ARcAHgEXAB4BFwAeAR8AFAF9ABQBKgAUAPiAFAEegCMBIQAjALMAHgEUgBkBCwAUASCAGQEeABkBNgAjAPCAFAEXgB4BNgAjATYALoE2AFsBNgApgTYAKYE2ACgBNgAlATYAIwE2ADuBNgAtgTYAIwDXACMAmQAeAMQAGQC+ABQAygAZAMcAGQDfACMArIAUAMsAHgDfACMA1wAjAJkAHgDEABkAvgAUAMoAGQDHABkA3wAjAKyAFADLAB4A3wAjAFu/nAG4gB4B0gAeAdmAFABuACgAeAAeAIcANwCMADcBIgAoAI0APACNADwA/AAZAPwAGQBkAB4BNgBpANEADwHIgB4AsoAeALKAHgCHADcAjQA8APwAGQBkAB4AzABGAMwAFoDHwEYAx8AWgMYARgDGAC0AzABGAMwAFoDHwEYAx8AWgMYARgDGAC0A0gAeANIAHgEOAB4BhgAeANIAHgFKAAAA0gAeAQ4AHgGGAB4AeAAeAKAAKACgACgAoAAoAFoAHgBaAB4AoAAoAPsAKAD7ACMBK4BGASuAZACrAB4AWwAeAPsAKAD7ACMBK4BGASuAZAEOAB4B8QBGASwAHgCMADcBqAAoAGQAAABkAAABLAAAASwAAAAAAAACSYCJwSyAIwENgBQBNwAPARmADwEgABQBOQAPAWoADwEGgA8BF4APASAAFAEYgAyBSoAjASaAIwF6wB4BHYAPAScABQHQgA8BA4AAALKAHgEiAB4BDgAeAO2AHgEOAB4BdwA8AXcAPAErgGQBK4BGAXcAPAF3ADwBLAAeATkAOUE5ADmBLAAeAUsANMFLABGBLAAWASwAJIDYAB4BAYAeARcABgEjgCMBHoAUAcMAHgKVAB4BK4BkASuARgFfADwB8QBGAV8APAHxAEYBjQBGAfEARgHxAEYA4oAZAcCAKAFAABjBIoAtAQEAFwF2AA8BLoAjAbaAHgDhAA8AbwAtAG8ALQEOAB4AuwAeAiEAIwHAgCgBdgAPAfEARgB0AB4AdAAeAPAAPACWADwA5IBYwOSAXcD4gDfA8wA8AO0APADqADwA2wA9AQGAOQDwADwAwQA8AMsAPAEsAHyBLABQgj8AKAIrgAAAAAAAgAAAAMAAAAUAAMAAQAAABQABAbYAAAAogCAAAYAIgANAC8AOQB+ARMBKwExATcBPgFIAU0BfgGSAaEBsAIbAlkCxwLdA3UDfgOKA4wDkAOhA6kDsAPJA84EGgQjBDoEQwRfBJEErwS7BOkehR6eHvkgESAUIBogIiAmIDAgOiBEIGAgcCB5IIkgoyCsIK4gsSC0ILogvSC/IRYhIiGTIbUiAiIFIg8iEiIVIhoiHiIrIkgiYCJlJcrgA+AJ+wL//wAAAA0AIAAwADoAoAEWAS4BNAE5AUEBSgFQAZIBoAGvAhgCWQLGAtgDdAN+A4QDjAOOA5EDowOqA7EDygQABBsEJAQ7BEQEkASuBLoE6B6AHp4eoCARIBMgGCAcICYgMCA5IEQgYCBwIHQggCCjIKkgriCxILQguSC9IL8hFiEiIZAhtSICIgUiDyIRIhUiGiIeIisiSCJgImQlyuAB4Af7Af//AnwAAAHtAAAAAAAAAAAAAAAAAAAAAAAAAQEAAAAAAAD+ggAUAAD/X/8HAAD+aAAA/kf+RgAA/kgAAAAA/U4AAP1mAAAAAAAAAAAAAAAA4d4AAOJb4lcAAAAA4ifiiOJB4gHiK+HL4cvhseHxAADh7uHm4eEAAOHb4c7hueGnAADhCuC04KvgowAA4IrgmuCR4IbgY+BFAADc+AAAAAAGUgABAAAAoAAAALwBRAIqAlQCWgJgAmoCeAJ+AAAC2ALaAtwAAAAAAt4AAAAAAuQAAALuAAAAAALuAAAC+AMAAAADMgAAA1wDkgOUA5YDmAOaAAADogAAAAAEUARUAAAAAAAAAAAAAAAAAAAAAAAABE4AAAAAAAAETgAAAAAAAAAABEgAAAAAAAAAAARGAAAAAAAAAAAAAAAABDwAAAQ8BEAAAAAAAocCTgJ8AlUCkAK3AsQCfQJcAl0CVAKgAkoCaAJJAlYCSwJMAqcCpAKmAlACwwABABgAGQAfACMANAA1ADoAPQBIAEoATABRAFIAWABvAHEAcgB2AH0AggCVAJYAmwCcAKQCYAJXAmECrgJtAtcAqAC/AMAAxgDKANwA3QDiAOUA8QDzAPUA+gD7AQEBGAEaARsBHwEmASsBPgE/AUQBRQFNAl4CywJfAqwCiAJPAo4CmwKPAp4CzALGAtUCxwFWAngCrQJpAsgC3wLKAqoCPQI+AtgCtQLFAlIC4AI8AVcCeQJHAkYCSAJRABEAAgAJABYADwAVABcAHAAvACQAJgAsAEMAPgA/AEAAIABXAGIAWQBaAG0AYAKiAGwAiACDAIUAhgCdAHABJQC4AKkAsAC9ALYAvAC+AMMA1gDLAM0A0wDsAOcA6ADpAMcBAAELAQIBAwEWAQkCowEVATEBLAEuAS8BRgEZAUgAEwC6AAMAqgAUALsAGgDBAB0AxAAeAMUAGwDCACEAyAAiAMkAMQDYAC0A1AAyANkAJQDMADcA3wA2AN4AOQDhADgA4AA8AOQAOwDjAEcA8ABFAO4ARgDvAEEA5gBJAPIASwD0AE0A9gBPAPgATgD3AFAA+QBTAPwAVQD+AFQA/QBWAP8AawEUAGoBEwBuARcAcwEcAHUBHgB0AR0AdwEgAHoBIwB5ASIAeAEhAIABKQB/ASgAfgEnAJQBPQCRAToAhAEtAJMBPACQATkAkgE7AJgBQQCeAUcAnwClAU4ApwFQAKYBTwBkAQ0AigEzAHsBJACBASoC3ALWAt0C4QLeAtkC4gLjAfAChAHxAfIB8wH1AfYCFAH3AfgCGgIbAhwCEgIXAhMCFgIYAhUCGQFgAWEBiAFcAYABfwGCAYMBhAF9AX4BhQFoAWYBcgF5AVgBWQFaAVsBXgFfAWIBYwFkAWUBZwFzAXQBdgF1AXcBeAF7AXwBegGBAYYBhwGQAZEBkgGTAZYBlwGaAZsBnAGdAZ8BqwGsAa4BrQGvAbABswG0AbIBuQG+Ab8BmAGZAcABlAG4AbcBugG7AbwBtQG2Ab0BoAGeAaoBsQFdAZUBiQHBAYoBwgGLAcMAmgFDAJcBQACZAUIAEAC3ABIAuQAKALEADACzAA0AtAAOALUACwCyAAQAqwAGAK0ABwCuAAgArwAFAKwALgDVADAA1wAzANoAJwDOACkA0AAqANEAKwDSACgAzwBEAO0AQgDrAGEBCgBjAQwAWwEEAF0BBgBeAQcAXwEIAFwBBQBlAQ4AZwEQAGgBEQBpARIAZgEPAIcBMACJATIAiwE0AI0BNgCOATcAjwE4AIwBNQChAUoAoAFJAKIBSwCjAUwCdQJ2AnECcwJ0AnICdwLNAs4CUwKdApoCkQKSApkClgK+ArsCvAK9ArMCoQKpAqgChgKMAuQBUQFSAVW4Af+FsASNAAAAAFoAdgCbAM4BCAFBAXwBywIeAkcCdwKmAtcDHANlA44DsgPXBBEENQRzBLYE9AUfBVsFkQXPBhAGZAamBuMHHAddB6EHqQfAB+AIAggmCFEIfAioCOkJLgk2CVUJdAmVCcsJ6wokCl0KcgqxCwULTwueC+ML+gwYDDwMSAxcDHQMjQygDLMMyAzyDQYNMw1hDYgNuw3VDgEOEA4nDjMOVA5sDogOng69Dt4PBg8wD2gPoQ/hECUQcRC7EQgRaRHOEhMSUhKTEukTOBOOE+QUOxSmFRYVJRVlFbMVvxXLFgQWPhaAFr8XBxdQF6EX8RhJGKQZEhluGc4aFxopGkMaYBpsGo8atRrjGx8bURuDG7Ab3xwiHF4coRzkHSgdgB3cHeseGB4kHnAefB6RHrIe2x8IHzYfYB9/H5cftx/bH/8gHiA/IHQgrSDDIOIhAyEhIXYh0iI8Iq0jHSOPJBYkoCUAJWglzyY4JrUnNieXJ/IoTyjBKR0pkyoOKoQrAytBK3IrqyvnLDYscyyrLOgtLy07LYAtti30LjUudy7ALwgvUi+xMBMwGzBYMJUw1DEnMWUxzDIjMlkyfTLTMz4znzQFNGE0jzTENP41ETUdNTE1STVRNVk1cjWHNbE1xTX4NiY2QjZjNn02qTa1Nsk21TbyNwc3SDd2N6w35DgjOGY4tTjmOR45WjmeOeE6Jjp/Otw7GTtQO4k71zwePGw8uj0JPW090z3jPhs+YD6xPr0+/D9CP4A/pD/RP/9ANEB2QL9BDEFrQbhCCkJUQnpCp0KzQvdDL0NdQ5ND10QRREtEgES3RQJFRkWRRdtGJ0aHRutG+0cwR39H00ffR/RIFUg+SGtImEjCSOFI+0kdSUJJaEmISatJ4knuSgRKI0pESmJKbkp6SoZKuUrFSxFLN0s/S3hLgEuPS6dLuEvsS/RL/EwhTEhMlkysTNhM90z/TSBNSk1STVpNYk10TXxNhE2MTaNN0E4XTh9OR05eTnVOlU6tTuZPIU8tTzlPfk+GT8ZQBlAOUBZQHlBNUJhQ1lEKURJRO1F7UZpRolGqUb5RxlIOUmRSc1KLUpxSzFLUUtxTHlNFU4dTn1PMU+xUBlQpVFBUbFSDVItUnVSlVK1Uv1THVPdVQVVJVXNVilWhVb5V1lYLVkJWfVbNVw1XFVdHV3lXgVeaV6JXqlfhWCFYY1h8WKdY31k1WXZZflmlWa5Ztln6WjFaOVpNWlVaXVplWm1ao1rkWy1bNVtyW3pbgluKW5JbrFu0W7xbxFwEXAxcFFwoXDBcOFxTXFtcY1xrXIdcj1yXXJ9cp1ziXSRdMF09XUpdV11kXXFdfl2XXbtd9V5JXlFepF7nXylfMV94X6BfqF/NX/Zf/mBRYFlgcGCrYOdhIGFNYXdhf2GHYcZiDmI9YnFifWKvYuZi8WL5Y0lji2PVY91kFWQnZFhkkmSvZOxlNWVHZZVl3mYWZh9mJ2YvZjdmP2ZHZlBmWGahZqpms2a8ZsVmzmbXZuBm6WbyZvtnLWc/Z3Bnp2fEZ/1oQGhTaJ9o4mjwaQBpEGkgaStpQWlOaVppaml8aY5p2molajtqWGp4arVqw2rSat9q8Ws8a0RraWuOa8Vr+2wNbB9sJ2wvbDdsP2xHbFlsZmxubHtsiGyQbJlsoWypbLFsuWzFbOxs+W0QbRltQG1jbYRtjG2gbaxtuW3Cbctt023bbeNt623zbf9uB24HbgduB24HbgduSW6fbtZvK298b8dwCXBNcGpw63EdcWdxqHHxcjZyZHKHcq9y1XLdcvZy/nMgczlzTXNqc35zk3Otc8lz6XQ6dGR0dXSKdON1IXVRdWN1hHWadaJ153ZNdt9253bvdwh3IXc6d1R3cHd4d4B3nXgSeJF4uHkvea96A3otel96a3p/eox6u3rLetR63Xrleu5693sJexV7JHsyez97UHthe317qXvQe918AXwofDF8SnycfJwAAAANAMgAAAUABaAAAwAHAAsADwATABcAGwAfACMAJwArAC8AMwAAMzUhFSU1IRUlNSEVJTUhFSU1IRUlNSEVJTUhFSU1IRUlNSEVJTUhFSU1IRUlNSEVJTUhFcgEOPvIBDj7yAQ4+8gEOPvIBDj7yAQ4+8gEOPvIBDj7yAQ4+8gEOPvIBDj7yAQ4+8gEOHJykFBQdEpKckZGdEJCdDw8cjg4djAwciwscioqdiQkciAgdBoaAAACACgAAASaBaAABwALAAAzATMBIwEzARM1IRUoAgxaAgxa/gI8/gRuAuAFoPpgBXr6hgF2UFAAAAMAKAAABJoHYgADAAsADwAAASMTMwEBMwEjATMBEzUhFQKUWGBY/TQCDFoCDFr+Ajz+BG4C4AZUAQ74ngWg+mAFevqGAXZQUAAAAwAoAAAEmgcIAA8AFwAbAAABIiYmNTMUFjMyNjUzFAYGAQEzASMBMwETNSEVAmI/aD1OWT0/V049aP2HAgxaAgxa/gI8/gRuAuAGJD5nPz1ZWT0/Zz753AWg+mAFevqGAXZQUAAABAAoAAAEmgg0AA8AEwAbAB8AAAEiJiY1MxQWMzI2NTMUBgYDIxMzAQEzASMBMwETNSEVAmE/aD1OWT0/V049aBlYYFj9QQIMWgIMWv4CPP4EbgLgBiQ+Zz89WVk9P2c+AQIBDvfMBaD6YAV6+oYBdlBQAAAEACj+hASaBwgAAwATABsAHwAAATUzFQMiJiY1MxQWMzI2NTMUBgYBATMBIwEzARM1IRUCJXg7P2g9Tlk9P1dOPWj9hwIMWgIMWv4CPP4EbgLg/oSAgAegPmc/PVlZPT9nPvncBaD6YAV6+oYBdlBQAAAEACgAAASaCDQADwATABsAHwAAASImJjUzFBYzMjY1MxQGBgMDMxMBATMBIwEzARM1IRUCYT9oPU5XPz5YTj1oZWBYYP2VAgxaAgxa/gI8/gRuAuAGJD5nPz1ZWT0/Zz4BAgEO/vL42gWg+mAFevqGAXZQUAAABAAoAAAEmghUAA8AIQApAC0AAAEiJiY1MxQWMzI2NTMUBgYDJzY2FhcWFgYGByc2NicmJgYBATMBIwEzARM1IRUCYT9oPU5ZPT9XTj1ouyYeVlkjGQkZNSQ0QCQYETM2/isCDFoCDFr+Ajz+BG4C4AYkPmc/PVlZPT9nPgG4MSQjES4hS0k9FDAjXiUbChb4DAWg+mAFevqGAXZQUAAEACgAAASaB+oAFwAnAC8AMwAAASIuAiMiBhcjJjYzMh4CMzI2JzMWBgMiJiY1MxQWMzI2NTMUBgYBATMBIwEzARM1IRUC4SdLSEIeKxUKSBJNRShMSEIeJhwMSBJM1T9oPU5ZPT9XTj1o/ZUCDFoCDFr+Ajz+BG4C4Ac6HSYdOxtFYR0mHTgiQ2f+6j5nPz1ZWT0/Zz753AWg+mAFevqGAXZQUAAAAwAoAAAEmgdEAAYADgASAAABNzMXIycHAQEzASMBMwETNSEVAWzIXMhkkpL+WAIMWgIMWv4CPP4EbgLgBlTw8Kqq+awFoPpgBXr6hgF2UFAAAAQAKAAABJoINAAGAAoAEgAWAAABNzMXIycHJSMTMwEBMwEjATMBEzUhFQFryFzIZJKSAcZYYFj8MwIMWgIMWv4CPP4EbgLgBlTw8Kqq0gEO98wFoPpgBXr6hgF2UFAAAAQAKP6EBJoHRAADAAoAEgAWAAABNTMVATczFyMnBwEBMwEjATMBEzUhFQIleP7PyFzIZJKS/lgCDFoCDFr+Ajz+BG4C4P6EgIAH0PDwqqr5rAWg+mAFevqGAXZQUAAEACgAAASaCDQABgAKABIAFgAAATczFyMnByUDMxMBATMBIwEzARM1IRUBa8hcyGSSkgFgYFhg/KECDFoCDFr+Ajz+BG4C4AZU8PCqqtIBDv7y+NoFoPpgBXr6hgF2UFAAAAQAKAAABJoHiwAGABgAIAAkAAABNzMXIycHJSc2NhYXFhYGBgcnNjYnJiYGAQEzASMBMwETNSEVAWzIXMhkkpIBmiYeVlkjGQkZNSQ0QCQYETM2/KYCDFoCDFr+Ajz+BG4C4AZU8PCqqr8xJCMRLiFLST0UMCNeJRsKFvjVBaD6YAV6+oYBdlBQAAQAKAAABJoIJgAGAB4AJgAqAAABNzMXIycHASIuAiMiBhcjJjYzMh4CMzI2JzMWBgEBMwEjATMBEzUhFQFoyFzIZJKSASInS0hCHisVCkgSTUUoTEhCHiYcDEgSTPzyAgxaAgxa/gI8/gRuAuAGVPDwqqoBIh0mHTsbRWEdJh04IkNn+IoFoPpgBXr6hgF2UFAABAAoAAAEmgcIAAMABwAPABMAAAE1MxUhNTMVAQEzASMBMwETNSEVAtp4/iB4/j4CDFoCDFr+Ajz+BG4C4AaQeHh4ePlwBaD6YAV6+oYBdlBQAAMAKP6EBJoFoAADAAsADwAAATUzFQEBMwEjATMBEzUhFQIleP2LAgxaAgxa/gI8/gRuAuD+hICAAXwFoPpgBXr6hgF2UFAAAAMAKAAABJoHYgADAAsADwAAAQMzEwEjATMBIwEzASE1IQIuYFhgAhRa/gQ8/gJaAgxaAUT9IALgBlQBDv7y+awFevqGBaD71lAAAwAoAAAEmgeLABEAGQAdAAABJzY2FhcWFgYGByc2NicmJgYBATMBIwEzARM1IRUCACYeVlkjGQkZNSQ0QCQYETM2/hACDFoCDFr+Ajz+BG4C4AcTMSQjES4hS0k9FDAjXiUbChb41QWg+mAFevqGAXZQUAADACgAAASaBuQAAwALAA8AAAE1IRUBATMBIwEzARM1IRUBcgHg/NYCDFoCDFr+Ajz+BG4C4AaQVFT5cAWg+mAFevqGAXZQUAADACj+HASmBaAAFgAeACIAAAEiJiY1NDY2NxcOAhUUFjMyNjcXBgYBATMBIwEzARM1IRUEDC9QMUZ0Rj49aUA2Ihs3FjIhUPvzAgxaAgxa/gI8/gRuAuD+HDJSMDyBfjdCKGhvMS03IRk4KigB5AWg+mAFevqGAXZQUAAABAAoAAAEmgecAA8AGwAjACcAAAEiJiY1NDY2MzIWFhUUBgYnMjY1NCYjIgYVFBYBATMBIwEzARM1IRUCYjVYNTVYNTZYNDRYNi8/Py8tQUH98wIMWgIMWv4CPP4EbgLgBhg0WDY1WDU1WDU2WDRUQS0uQEAuLUH5lAWg+mAFevqGAXZQUAADACgAAASaBzYAFwAfACMAAAEiLgIjIgYXIyY2MzIeAjMyNiczFgYBATMBIwEzARM1IRUC7CdLSEIeKxUKSBJNRShMSEIeJhwMSBJM/PQCDFoCDFr+Ajz+BG4C4AaGHSYdOxtFYR0mHTgiQ2f5egWg+mAFevqGAXZQUAAAAwAoAAAGrgWgAAYACgAWAAAzASEVITcBEzUhFQMRIRUhESEVIREhFSgCDAEy/tZA/gZuAnwuA3D85AKk/VwDHAWgVCr6igF2UFD+igWgVP2uVP2uVAADAIwAAAR4BaAAEQAcACYAADMRITIWFhUUBgcnFhYVFAYGIyUhMjY2NTQmJiMhNSEyNjY1NCYjIYwCImiwaoRsBI+tcL91/gwBzGinYVmVWv4MAc5Rh1Crff4yBaBZoGlyvycwLsuZe61cVEaEXl6ZW1JOhFJ4kgABADz/4gUoBb4AHQAABSIkAjU0EiQzMgAXByYkIyIGAgcGEhYzMiQ3FwYAAsLX/uGQkAEf1/wBNDZYMP7517n1fAICfPm51wEHMFg2/swewAFS3NwBUsD++dsUv+Oq/tPDw/7Uq+S+FNv++QACADz/4gUoB2IAAwAhAAABIxMzAyIkAjU0EiQzMgAXByYkIyIGAgcGEhYzMiQ3FwYAAvVYYFiT1/7hkJABH9f8ATQ2WDD++de59XwCAnz5udcBBzBYNv7MBlQBDviAwAFS3NwBUsD++dsUv+Oq/tPDw/7Uq+S+FNv++QAAAgA8/+IFKAdEAB0AJAAABSIkAjU0EiQzMgAXByYkIyIGAgcGEhYzMiQ3FwYAATMXNzMHIwLC1/7hkJABH9f8ATQ2WDD++de59XwCAnz5udcBBzBYNv7M/kxkkpJkyFwewAFS3NwBUsD++dsUv+Oq/tPDw/7Uq+S+FNv++QdiqqrwAAIAPP4iBSgFvgAUADIAAAEiJic3FjMyNjU0Jic3MwcWFhUUBgMiJAI1NBIkMzIAFwcmJCMiBgIHBhIWMzIkNxcGAAK4ITwbHDIkLTFUMkxUOjNFaD7X/uGQkAEf1/wBNDZYMP7517n1fAICfPm51wEHMFg2/sz+IhAMShQ6JDMrEM6cFU5BSGQBwMABUtzcAVLA/vnbFL/jqv7Tw8P+1KvkvhTb/vkAAAIAPP/iBSgHRAAGACQAAAE3MxcjJwcTIiQCNTQSJDMyABcHJiQjIgYCBwYSFjMyJDcXBgABzchcyGSSkpHX/uGQkAEf1/wBNDZYMP7517n1fAICfPm51wEHMFg2/swGVPDwqqr5jsABUtzcAVLA/vnbFL/jqv7Tw8P+1KvkvhTb/vkAAAIAPP/iBSgHCAADACEAAAE1MxUDIiQCNTQSJDMyABcHJiQjIgYCBwYSFjMyJDcXBgACmnhQ1/7hkJABH9f8ATQ2WDD++de59XwCAnz5udcBBzBYNv7MBpB4ePlSwAFS3NwBUsD++dsUv+Oq/tPDw/7Uq+S+FNv++QAAAgCMAAAEyAWgABAAIQAAMxEhMhYXFhYSFRQCBgcGBiMlITI2NzY2EjU0AiYnJiYjIYwBphpyNJ/RZmbRnzN1GP60AUwwYSGOrU9PrY4hZC3+tAWgAggXxv7PuLn+z8UXBwNUBgYYqwEJpKQBCasYBgYAAwAUAAAEsgWgAAMAFAAlAAATNSEVAREhMhYXFhYSFRQCBgcGBiMlITI2NzY2EjU0AiYnJiYjIRQCWP4KAaYacjSf0WZm0Z8zdRj+tAFMMGEhjq1PT62OIWQt/rQCplRU/VoFoAIIF8b+z7i5/s/FFwcDVAYGGKsBCaSkAQmrGAYGAAMAjAAABMgHRAAQACEAKAAAMxEhMhYXFhYSFRQCBgcGBiMlITI2NzY2EjU0AiYnJiYjIRMzFzczByOMAaYacjSf0WZm0Z8zdRj+tAFMMGEhjq1PT62OIWQt/rRcZJKSZMhcBaACCBfG/s+4uf7PxRcHA1QGBhirAQmkpAEJqxgGBgH4qqrwAP//ABQAAASyBaAABgAgAAAAAQCMAAAD/AWgAAsAADMRIRUhESEVIREhFYwDcPzkAqT9XAMcBaBU/a5U/a5UAAIAjAAAA/wHYgADAA8AAAEjEzMBESEVIREhFSERIRUChlhgWP2mA3D85AKk/VwDHAZUAQ74ngWgVP2uVP2uVAACAIwAAAP8B0QACwASAAAzESEVIREhFSERIRUBMxc3MwcjjANw/OQCpP1cAxz9WGSSkmTIXAWgVP2uVP2uVAdEqqrwAAIAjAAAA/wHRAAGABIAAAE3MxcjJwcBESEVIREhFSERIRUBRMhcyGSSkv7kA3D85AKk/VwDHAZU8PCqqvmsBaBU/a5U/a5UAAMAjAAAA/wINAAGAAoAFgAAATczFyMnByUjEzMBESEVIREhFSERIRUBP8hcyGSSkgHGWGBY/MMDcPzkAqT9XAMcBlTw8Kqq0gEO98wFoFT9rlT9rlQAAwCM/oQD/AdEAAMACgAWAAABNTMVATczFyMnBwERIRUhESEVIREhFQIIeP7EyFzIZJKS/uQDcPzkAqT9XAMc/oSAgAfQ8PCqqvmsBaBU/a5U/a5UAAADAIwAAAP8CDQABgAKABYAAAE3MxcjJwclAzMTAREhFSERIRUhESEVAXLIXMhkkpIBYGBYYPz+A3D85AKk/VwDHAZU8PCqqtIBDv7y+NoFoFT9rlT9rlQAAwCMAAAEPweLAAYAGAAkAAABNzMXIycHJSc2NhYXFhYGBgcnNjYnJiYGAREhFSERIRUhESEVAVXIXMhkkpIBmiYeVlkjGQkZNSQ0QCQYETM2/SEDcPzkAqT9XAMcBlTw8KqqvzEkIxEuIUtJPRQwI14lGwoW+NUFoFT9rlT9rlQAAAMAjAAAA/wIJgAGAB4AKgAAATczFyMnBwEiLgIjIgYXIyY2MzIeAjMyNiczFgYBESEVIREhFSERIRUBSchcyGSSkgEiJ0tIQh4rFQpIEk1FKExIQh4mHAxIEkz9dQNw/OQCpP1cAxwGVPDwqqoBIh0mHTsbRWEdJh04IkNn+IoFoFT9rlT9rlQA//8AjAAAA/wHCAAGAWEAAAACAIwAAAP8BwgAAwAPAAABNTMVAREhFSERIRUhESEVAhJ4/gIDcPzkAqT9XAMcBpB4ePlwBaBU/a5U/a5UAAIAjP6EA/wFoAADAA8AAAE1MxUBESEVIREhFSERIRUCCHj+DANw/OQCpP1cAxz+hICAAXwFoFT9rlT9rlQAAgCMAAAD/AdiAAMADwAAAQMzEwERIRUhESEVIREhFQI+YFhg/fYDcPzkAqT9XAMcBlQBDv7y+awFoFT9rlT9rlQAAgCMAAAD/AeLABEAHQAAASc2NhYXFhYGBgcnNjYnJiYGAREhFSERIRUhESEVAeMmHlZZIxkJGTUkNEAkGBEzNv6RA3D85AKk/VwDHAcTMSQjES4hS0k9FDAjXiUbChb41QWgVP2uVP2uVAAAAgCMAAAD/AbkAAMADwAAATUhFQERIRUhESEVIREhFQFUAeD9WANw/OQCpP1cAxwGkFRU+XAFoFT9rlT9rlQAAAIAjP4cBAgFoAAWACIAAAEiJiY1NDY2NxcOAhUUFjMyNjcXBgYBESEVIREhFSERIRUDbi9QMUZ0Rj49aUA2Ihs3FjIhUPz1A3D85AKk/VwDHP4cMlIwPIF+N0IoaG8xLTchGTgqKAHkBaBU/a5U/a5UAAIAjAAAA/wHBAAXACMAAAEiLgIjIgYXIyY2MzIeAjMyNiczFgYBESEVIREhFSERIRUCzydLSEIeKxUKSBJNRShMSEIeJhwMSBJM/XUDcPzkAqT9XAMcBlQdJh07G0VhHSYdOCJDZ/msBaBU/a5U/a5UAAEAjAAAA6wFoAAJAAAzESEVIREhFSERjAMg/TQCVP2sBaBU/a5U/VoAAAEAPP/iBSIFvAAlAAAFIiYmAjU0EiQzMgQXByYmIyIGAgcGEhYzMjYSNSE1IRYWFRQCBALCofKiUZABH9fOARI6UjTqqrn1fAICfPm5ueRp/oAB1gMBfv7zHm7IAROl3AFRv8GZIoehqf7Uw8P+1KuTAQatVBwsDrz+068AAAIAPP/iBSIHCAAPADUAAAEiJiY1MxQWMzI2NTMUBgYDIiYmAjU0EiQzMgQXByYmIyIGAgcGEhYzMjYSNSE1IRYWFRQCBALHP2c+Tlk9P1dOPWhEofKiUZABH9fOARI6UjTqqrn1fAICfPm5ueRp/oAB1gMBfv7zBiQ+Zz89WVk9P2c++b5uyAETpdwBUb/BmSKHoan+1MPD/tSrkwEGrVQcLA68/tOvAAIAPP/iBSIHRAAGACwAAAE3MxcjJwcTIiYmAjU0EiQzMgQXByYmIyIGAgcGEhYzMjYSNSE1IRYWFRQCBAG5yFzIZJKSpaHyolGQAR/XzgESOlI06qq59XwCAnz5ubnkaf6AAdYDAX7+8wZU8PCqqvmObsgBE6XcAVG/wZkih6Gp/tTDw/7Uq5MBBq1UHCwOvP7TrwACADz+AgUiBbwACwAxAAABNTI2NicjNTMVFAYTIiYmAjU0EiQzMgQXByYmIyIGAgcGEhYzMjYSNSE1IRYWFRQCBAKICiAXAz54VBah8qJRkAEf184BEjpSNOqqufV8AgJ8+bm55Gn+gAHWAwF+/vP+AjwPIh14eEw+AeBuyAETpdwBUb/BmSKHoan+1MPD/tSrkwEGrVQcLA68/tOvAAIAPP/iBSIHCAADACkAAAE1MxUDIiYmAjU0EiQzMgQXByYmIyIGAgcGEhYzMjYSNSE1IRYWFRQCBAKaeFCh8qJRkAEf184BEjpSNOqqufV8AgJ8+bm55Gn+gAHWAwF+/vMGkHh4+VJuyAETpdwBUb/BmSKHoan+1MPD/tSrkwEGrVQcLA68/tOvAAEAjAAABJwFoAALAAAzETMRIREzESMRIRGMVANoVFT8mAWg/VoCpvpgAqb9WgACABQAAAU8BaAACwAPAAAzETMRIREzESMRIREDNSEVoFQDaFRU/JjgBSgFoP1aAqb6YAKm/VoD5FRUAAACAIwAAAScB0QABgASAAABNzMXIycHAREzESERMxEjESERAZ7IXMhkkpL+ilQDaFRU/JgGVPDwqqr5rAWg/VoCpvpgAqb9WgABAKAAAAD0BaAAAwAAMxEzEaBUBaD6YAACAKAAAAFYB2IAAwAHAAATIxMzAxEzEfhYYFi4VAZUAQ74ngWg+mAAAv/UAAABwAdEAAYACgAAAzczFyMnBxMRMxEsyFzIZJKSaFQGVPDwqqr5rAWg+mAAA//aAAABugcIAAMABwALAAABNTMVITUzFRMRMxEBQnj+IHhOVAaQeHh4ePlwBaD6YAACAI4AAAEGBwgAAwAHAAATNTMVAxEzEY54ZlQGkHh4+XAFoPpgAAIAjv6EAQYFoAADAAcAABM1MxUDETMRjnhmVP6EgIABfAWg+mAAAgA8AAAA9AdiAAMABwAAEwMzEwMRMxGcYFhgVFQGVAEO/vL5rAWg+mAAAgA6AAABTAeLABEAFQAAEyc2NhYXFhYGBgcnNjYnJiYGExEzEWAmHlZZIxkJGTUkNEAkGBEzNihUBxMxJCMRLiFLST0UMCNeJRsKFvjVBaD6YAAAAv/aAAABugbkAAMABwAAAzUhFQERMxEmAeD+5lQGkFRU+XAFoPpgAAL/tv4cAQAFoAAWABoAABMiJiY1NDY2NxcOAhUUFjMyNjcXBgYTETMRZi9QMUZ0Rj49aUA2Ihs3FjIhUBFU/hwyUjA8gX43QihobzEtNyEZOCooAeQFoPpgAAL/qwAAAekHBAAXABsAAAEiLgIjIgYXIyY2MzIeAjMyNiczFgYDETMRAVUnS0hCHisVCkgSTUUoTEhCHiYcDEgSTP1UBlQdJh07G0VhHSYdOCJDZ/msBaD6YAAAAQAA/+QCzAWgABYAAAUiJic3FhYzMjY3NjY1ETMRFAYGBwYGAWaCxh5WF5RpQYInGwlUAhMZMKUcmH4UW3s8RjJuTgP4/Ag3X1gsVFYAAgAA/+QDmAdEAAYAHQAAATczFyMnBwMiJic3FhYzMjY3NjY1ETMRFAYGBwYGAazIXMhkkpKqgsYeVheUaUGCJxsJVAITGTClBlTw8Kqq+ZCYfhRbezxGMm5OA/j8CDdfWCxUVgAAAQCMAAAEXAWgAAoAADMRMxEBMwEBIwERjFQCyHT9PgMCdPz4BaD9UAKw/VD9EALw/RAAAAIAjP4CBFwFoAALABYAAAE1MjY2JyM1MxUUBgERMxEBMwEBIwERAgwKIBcDPnhU/lxUAsh0/T4DAnT8+P4CPA8iHXh4TD4B/gWg/VACsP1Q/RAC8P0QAAABAKAAAAPABaAABQAAMxEzESEVoFQCzAWg+rRUAAACAKAAAAPAB2IAAwAJAAATIxMzAxEzESEV+FhgWLhUAswGVAEO+J4FoPq0VAD//wCgAAADwAW0ACYATAAAAAcCSgICBQAAAgCg/gIDwAWgAAsAEQAAATUyNjYnIzUzFRQGAREzESEVAfQKIBcDPnhU/ohUAsz+AjwPIh14eEw+Af4FoPq0VAAAAgBiAAADwAWgAAMACQAAEzUBFQERMxEhFWICDv4wVALMAcJkAS5i/Q4FoPq0VAAAAQCMAAAF8gWgAAwAADMRMwEBMxEjEQEjARGMUAJkAl5UVP3QXv3QBaD6xgU6+mIE1PsqBNb7KgABAIwAAASgBaAACQAAMxEzAREzESMBEYxUA2xUVPyUBaD69gUK+mAFDPr0AAIAjAAABKAHYgADAA0AAAEjEzMBETMBETMRIwERAthYYFj9VFQDbFRU/JQGVAEO+J4FoPr2BQr6YAUM+vQAAgCMAAAEoAdEAAkAEAAAMxEzAREzESMBERMzFzczByOMVANsVFT8lNxkkpJkyFwFoPr2BQr6YAUM+vQHRKqq8AAAAgCM/gIEoAWgAAsAFQAAATUyNjYnIzUzFRQGAREzAREzESMBEQJuCiAXAz54VP36VANsVFT8lP4CPA8iHXh4TD4B/gWg+vYFCvpgBQz69AABAIz+mgSgBaAAGAAAATMRFAYjIiYnNRYWMzI2NTQmJwERIxEzAQRMVEhQEyUaER0MNiYVFfy+VFQDbAWg+aJXUQQGUgMDQmA2Vx8Ezvr0BaD69gACAIwAAASgBwQAFwAhAAABIi4CIyIGFyMmNjMyHgIzMjYnMxYGAREzAREzESMBEQM+J0tIQh4rFQpIEk1FKExIQh4mHAxIEkz9BlQDbFRU/JQGVB0mHTsbRWEdJh04IkNn+awFoPr2BQr6YAUM+vQAAgA8/+IFSAW+AA8AHwAABSIkAjU0EiQzMgQSFRQCBCcyNhI1NAImIyIGAgcGEhYCwtf+4ZCQAR/X1wEfkJD+4de593x897m59XwCAnz5HsABUtzcAVLAwP6u3Nz+rsBUqwEsw8MBLaqq/tPDw/7UqwAAAwA8/+IFSAdiAAMAEwAjAAABIxMzAyIkAjU0EiQzMgQSFRQCBCcyNhI1NAImIyIGAgcGEhYDBFhgWKLX/uGQkAEf19cBH5CQ/uHXufd8fPe5ufV8AgJ8+QZUAQ74gMABUtzcAVLAwP6u3Nz+rsBUqwEsw8MBLaqq/tPDw/7UqwADADz/4gVIB0QABgAWACYAAAE3MxcjJwcTIiQCNTQSJDMyBBIVFAIEJzI2EjU0AiYjIgYCBwYSFgHMyFzIZJKSktf+4ZCQAR/X1wEfkJD+4de593x897m59XwCAnz5BlTw8Kqq+Y7AAVLc3AFSwMD+rtzc/q7AVKsBLMPDAS2qqv7Tw8P+1KsABAA8/+IFSAg0AAYACgAaACoAAAE3MxcjJwclIxMzASIkAjU0EiQzMgQSFRQCBCcyNhI1NAImIyIGAgcGEhYB1chcyGSSkgHGWGBY/mPX/uGQkAEf19cBH5CQ/uHXufd8fPe5ufV8AgJ8+QZU8PCqqtIBDveuwAFS3NwBUsDA/q7c3P6uwFSrASzDwwEtqqr+08PD/tSrAAAEADz+hAVIB0QABgAKABoAKgAAATczFyMnBxM1MxUDIiQCNTQSJDMyBBIVFAIEJzI2EjU0AiYjIgYCBwYSFgHMyFzIZJKSVng81/7hkJABH9fXAR+QkP7h17n3fHz3ubn1fAICfPkGVPDwqqr4MICAAV7AAVLc3AFSwMD+rtzc/q7AVKsBLMPDAS2qqv7Tw8P+1KsABAA8/+IFSAg0AAYACgAaACoAAAE3MxcjJwclAzMTASIkAjU0EiQzMgQSFRQCBCcyNhI1NAImIyIGAgcGEhYBzchcyGSSkgFgYFhg/tnX/uGQkAEf19cBH5CQ/uHXufd8fPe5ufV8AgJ8+QZU8PCqqtIBDv7y+LzAAVLc3AFSwMD+rtzc/q7AVKsBLMPDAS2qqv7Tw8P+1KsAAAQAPP/iBUgHiwAGABgAKAA4AAABNzMXIycHJSc2NhYXFhYGBgcnNjYnJiYGASIkAjU0EiQzMgQSFRQCBCcyNhI1NAImIyIGAgcGEhYB8chcyGSSkgGaJh5WWSMZCRk1JDRAJBgRMzb+u9f+4ZCQAR/X1wEfkJD+4de593x897m59XwCAnz5BlTw8KqqvzEkIxEuIUtJPRQwI14lGwoW+LfAAVLc3AFSwMD+rtzc/q7AVKsBLMPDAS2qqv7Tw8P+1KsABAA8/+IFSAgmAAYAHgAuAD4AAAE3MxcjJwcBIi4CIyIGFyMmNjMyHgIzMjYnMxYGAyIkAjU0EiQzMgQSFRQCBCcyNhI1NAImIyIGAgcGEhYBx8hcyGSSkgEiJ0tIQh4rFQpIEk1FKExIQh4mHAxIEkzT1/7hkJABH9fXAR+QkP7h17n3fHz3ubn1fAICfPkGVPDwqqoBIh0mHTsbRWEdJh04IkNn+GzAAVLc3AFSwMD+rtzc/q7AVKsBLMPDAS2qqv7Tw8P+1KsAAAQAPP/iBUgHCAADAAcAFwAnAAABNTMVITUzFRMiJAI1NBIkMzIEEhUUAgQnMjYSNTQCJiMiBgIHBhIWAzp4/iB4eNf+4ZCQAR/X1wEfkJD+4de593x897m59XwCAnz5BpB4eHh4+VLAAVLc3AFSwMD+rtzc/q7AVKsBLMPDAS2qqv7Tw8P+1KsAAAMAPP6EBUgFvgADABMAIwAAATUzFQMiJAI1NBIkMzIEEhUUAgQnMjYSNTQCJiMiBgIHBhIWAm54JNf+4ZCQAR/X1wEfkJD+4de593x897m59XwCAnz5/oSAgAFewAFS3NwBUsDA/q7c3P6uwFSrASzDwwEtqqr+08PD/tSrAAMAPP/iBUgHYgADABMAIwAAAQMzEwMiJAI1NBIkMzIEEhUUAgQnMjYSNTQCJiMiBgIHBhIWAp5gWGA01/7hkJABH9fXAR+QkP7h17n3fHz3ubn1fAICfPkGVAEO/vL5jsABUtzcAVLAwP6u3Nz+rsBUqwEsw8MBLaqq/tPDw/7UqwADADz/4gVIB4sAEQAhADEAAAEnNjYWFxYWBgYHJzY2JyYmBhMiJAI1NBIkMzIEEhUUAgQnMjYSNTQCJiMiBgIHBhIWAnkmHlZZIxkJGTUkNEAkGBEzNjHX/uGQkAEf19cBH5CQ/uHXufd8fPe5ufV8AgJ8+QcTMSQjES4hS0k9FDAjXiUbChb4t8ABUtzcAVLAwP6u3Nz+rsBUqwEsw8MBLaqq/tPDw/7UqwAAAwA8/+IFSAZaAA0AHQAtAAABMxYGBwYGJzUWNjc2NgEiJAI1NBIkMzIEEhUUAgQnMjYSNTQCJiMiBgIHBhIWBF1UCxM1JYpJNUcfOBX+Xtf+4ZCQAR/X1wEfkJD+4de593x897m59XwCAnz5BlpAdikcFy4yEAEQHF75v8ABUtzcAVLAwP6u3Nz+rsBUqwEsw8MBLaqq/tPDw/7UqwAEADz/4gVIB2IADQARACEAMQAAATMWBgcGBic1FjY3NjYlIxMzAyIkAjU0EiQzMgQSFRQCBCcyNhI1NAImIyIGAgcGEhYEXVQLEzUlikk1Rx84Ff6gWGBYotf+4ZCQAR/X1wEfkJD+4de593x897m59XwCAnz5BlpAdikcFy4yEAEQHF4xAQ74gMABUtzcAVLAwP6u3Nz+rsBUqwEsw8MBLaqq/tPDw/7UqwAABAA8/oQFSAZaAAMAEQAhADEAAAE1MxUBMxYGBwYGJzUWNjc2NgEiJAI1NBIkMzIEEhUUAgQnMjYSNTQCJiMiBgIHBhIWAoZ4AV9UCxM1JYpJNUcfOBX+Xtf+4ZCQAR/X1wEfkJD+4de593x897m59XwCAnz5/oSAgAfWQHYpHBcuMhABEBxe+b/AAVLc3AFSwMD+rtzc/q7AVKsBLMPDAS2qqv7Tw8P+1KsAAAQAPP/iBUgHYgANABEAIQAxAAABMxYGBwYGJzUWNjc2NiUDMxMDIiQCNTQSJDMyBBIVFAIEJzI2EjU0AiYjIgYCBwYSFgRdVAsTNSWKSTVHHzgV/jpgWGA01/7hkJABH9fXAR+QkP7h17n3fHz3ubn1fAICfPkGWkB2KRwXLjIQARAcXjEBDv7y+Y7AAVLc3AFSwMD+rtzc/q7AVKsBLMPDAS2qqv7Tw8P+1KsAAAQAPP/iBUgHiwANAB8ALwA/AAABMxYGBwYGJzUWNjc2NiUnNjYWFxYWBgYHJzY2JyYmBhMiJAI1NBIkMzIEEhUUAgQnMjYSNTQCJiMiBgIHBhIWBF1UCxM1JYpJNUcfOBX+FSYeVlkjGQkZNSQ0QCQYETM2Mdf+4ZCQAR/X1wEfkJD+4de593x897m59XwCAnz5BlpAdikcFy4yEAEQHF7wMSQjES4hS0k9FDAjXiUbChb4t8ABUtzcAVLAwP6u3Nz+rsBUqwEsw8MBLaqq/tPDw/7UqwAEADz/4gVIBwQADQAdAC0ARQAAATMWBgcGBic1FjY3NjYBIiQCNTQSJDMyBBIVFAIEJzI2EjU0AiYjIgYCBwYSFgEiLgIjIgYXIyY2MzIeAjMyNiczFgYEXVQLEzUlikk1Rx84Ff5e1/7hkJABH9fXAR+QkP7h17n3fHz3ubn1fAICfPkBRCdLSEIeKxUKSBJNRShMSEIeJhwMSBJMBlpAdikcFy4yEAEQHF75v8ABUtzcAVLAwP6u3Nz+rsBUqwEsw8MBLaqq/tPDw/7UqwYeHSYdOxtFYR0mHTgiQ2cA//8APP/iBUgHYgAmAFgAAAAnAtgB0AAAAAYC2HIAAAMAPP/iBUgG5AADABMAIwAAATUhFQMiJAI1NBIkMzIEEhUUAgQnMjYSNTQCJiMiBgIHBhIWAdIB4PDX/uGQkAEf19cBH5CQ/uHXufd8fPe5ufV8AgJ8+QaQVFT5UsABUtzcAVLAwP6u3Nz+rsBUqwEsw8MBLaqq/tPDw/7UqwAAAwAK/+IFfwW+AAsAGwArAAAXJzc3ATc3FwcHAQcFIiQCNTQSJDMyBBIVFAIEJzI2EjU0AiYjIgYCBwYSFkg+yBYDjhS3PsUQ/HQaAb7X/uGQkAEf19cBH5CQ/uHXufd8fPe5ufV8AgJ8+Ro61hgDzBTFN9YQ/DQczMABUtzcAVLAwP6u3Nz+rsBUqwEsw8MBLaqq/tPDw/7UqwD//wA8/+IFSAcEACYAWAAAAAcC3gDPAAD//wA8/+IIZAW+ACYAWAAAAAcAIwRoAAAAAgCMAAAETgWgABIAIwAAMxEhMhYXHgIVFAYGBwYGIyERESEyNjc+AjU0JiYnJiYjIYwCEhUsG2iZU1OZaBssFf5CAb4RLxhTcTo6cVMYLxH+QgWgAwUQd7VsbLV3EAQE/cAClAQEEGSPUVGPZBAFAwAAAgCMAAAEOgWgABQAIwAAMxEzESEyFxYWFxYWFRQGBwYGIyERESEyNjc2NicmJicmJiMhjFQBqk9LJ0keQUc9NTqrWf5WAapKijAnLQIBNzItfkH+VgWg/uAeDy4dPKVXUZY7Qkz+4AF0QzkvdD1HgjEtNQADADz/4gVIBb4AAwATACMAAAUBNwEFIiQCNTQSJDMyBBIVFAIEJzI2EjU0AiYjIgYCBwYSFgT6/pJCAWz9iNf+4ZCQAR/X1wEfkJD+4de593x897m59XwCAnz5HAFsQv6URMABUtzcAVLAwP6u3Nz+rsBUqwEsw8MBLaqq/tPDw/7UqwADAIwAAAR2BaAADwATACQAADMRITIWFx4CFRQGBwchESEBNwEBITI2Nz4CNTQmJicmJiMhjAISFSwbaJlTqJAQ/doDMv7kSAE4/GoBvhEvGFNxOjpxUxgvEf5CBaADBRB3tWya6CAO/cACSjb9gAKUBAQQZI9RUY9kEAUDAAAEAIwAAAR2B2IAAwATABcAKAAAASMTMwERITIWFx4CFRQGBwchESEBNwEBITI2Nz4CNTQmJicmJiMhAlBYYFj93AISFSwbaJlTqJAQ/doDMv7kSAE4/GoBvhEvGFNxOjpxUxgvEf5CBlQBDvieBaADBRB3tWya6CAO/cACSjb9gAKUBAQQZI9RUY9kEAUDAAAEAIwAAAR2B0QADwATACQAKwAAMxEhMhYXHgIVFAYHByERIQE3AQEhMjY3PgI1NCYmJyYmIyETMxc3MwcjjAISFSwbaJlTqJAQ/doDMv7kSAE4/GoBvhEvGFNxOjpxUxgvEf5CUmSSkmTIXAWgAwUQd7VsmuggDv3AAko2/YAClAQEEGSPUVGPZBAFAwH4qqrwAAQAjP4CBHYFoAALABsAHwAwAAABNTI2NicjNTMVFAYBESEyFhceAhUUBgcHIREhATcBASEyNjc+AjU0JiYnJiYjIQISCiAXAz54VP5WAhIVLBtomVOokBD92gMy/uRIATj8agG+ES8YU3E6OnFTGC8R/kL+AjwPIh14eEw+Af4FoAMFEHe1bJroIA79wAJKNv2AApQEBBBkj1FRj2QQBQMAAAEAPP/iBF4FvgA2AAAFIiYmJzcWFjMyNjY1NC4CJyUuAzU0NjYzMhYWFwcuAiMiBgYVFBYWFwUeAxUUDgICapLpmRpUJ/61frxoNlNaI/6YTnFII3fUi43gjxJUDni+dnGrYF2GPQEqJm5rR0aEuB5frncQlKxQkWFJYj0kCmwXQlRkOW6rYWi9fxBpn1hOhFJWZzkSWgsrUINjXZZqOQACADz/4gReB2IAAwA6AAABIxMzAyImJic3FhYzMjY2NTQuAiclLgM1NDY2MzIWFhcHLgIjIgYGFRQWFhcFHgMVFA4CAoBYYFh2kumZGlQn/rV+vGg2U1oj/phOcUgjd9SLjeCPElQOeL52catgXYY9ASombmtHRoS4BlQBDviAX653EJSsUJFhSWI9JApsF0JUZDluq2FovX8QaZ9YToRSVmc5EloLK1CDY12WajkAAAIAPP/iBF4HRAA2AD0AAAUiJiYnNxYWMzI2NjU0LgInJS4DNTQ2NjMyFhYXBy4CIyIGBhUUFhYXBR4DFRQOAgEzFzczByMCapLpmRpUJ/61frxoNlNaI/6YTnFII3fUi43gjxJUDni+dnGrYF2GPQEqJm5rR0aEuP6WZJKSZMhcHl+udxCUrFCRYUliPSQKbBdCVGQ5bqthaL1/EGmfWE6EUlZnORJaCytQg2Ndlmo5B2KqqvAAAgA8/iIEXgW+ABQASwAAASImJzcWMzI2NTQmJzczBxYWFRQGAyImJic3FhYzMjY2NTQuAiclLgM1NDY2MzIWFhcHLgIjIgYGFRQWFhcFHgMVFA4CAjohPBscMiQtMVQyTFQ6M0VoGJLpmRpUJ/61frxoNlNaI/6YTnFII3fUi43gjxJUDni+dnGrYF2GPQEqJm5rR0aEuP4iEAxKFDokMysQzpwVTkFIZAHAX653EJSsUJFhSWI9JApsF0JUZDluq2FovX8QaZ9YToRSVmc5EloLK1CDY12WajkAAAIAPP/iBF4HRAAGAD0AAAE3MxcjJwcTIiYmJzcWFjMyNjY1NC4CJyUuAzU0NjYzMhYWFwcuAiMiBgYVFBYWFwUeAxUUDgIBZshcyGSSkqCS6ZkaVCf+tX68aDZTWiP+mE5xSCN31IuN4I8SVA54vnZxq2Bdhj0BKiZua0dGhLgGVPDwqqr5jl+udxCUrFCRYUliPSQKbBdCVGQ5bqthaL1/EGmfWE6EUlZnORJaCytQg2Ndlmo5AAACADz+AgReBb4ACwBCAAABNTI2NicjNTMVFAYRIiYmJzcWFjMyNjY1NC4CJyUuAzU0NjYzMhYWFwcuAiMiBgYVFBYWFwUeAxUUDgICRgogFwM+eFSS6ZkaVCf+tX68aDZTWiP+mE5xSCN31IuN4I8SVA54vnZxq2Bdhj0BKiZua0dGhLj+AjwPIh14eEw+AeBfrncQlKxQkWFJYj0kCmwXQlRkOW6rYWi9fxBpn1hOhFJWZzkSWgsrUINjXZZqOQABAIz/4gTXBb4ALwAABSImJzUWFjMyNjY1NCYmJzUBJiYjIgYHBgYVESMRNDY3PgIzMhYWFwEeAhUUBgMQOkwsM1IxZqRgXruLAQwxnX+3yxoOB1wKCiGk1WxgpoUs/upeuHrzHhENVA8LT5dtXpFXBU4B2SFGsH1Eh0L81AN+RWcqkZw9NUoh/gsIXrGEyuIAAAEAFAAABIgFoAAHAAAhESE1IRUhEQIk/fAEdP3wBUxUVPq0AAIAFAAABIgFoAADAAsAABM1IRUBESE1IRUhEaoDSP4y/fAEdP3wAqZUVP1aBUxUVPq0AAACABQAAASIB0QABwAOAAAhESE1IRUhEQEzFzczByMCJP3wBHT98P7gZJKSZMhcBUxUVPq0B0SqqvD//wAU/hQEiAWgACYAfQAAAAcC4ACe//IAAgAU/gIEiAWgAAsAEwAAATUyNjYnIzUzFRQGAxEhNSEVIRECEgogFwM+eFQS/fAEdP3w/gI8DyIdeHhMPgH+BUxUVPq0AAEAjP/iBNgFoAAXAAAFIiYmNREzERQeAjMyPgI1ETMRFAYGArKg+I5UWo6iSEiijlpUjvgehvOjA6L8eoW7czU1c7uFA4b8XqLzhwACAIz/4gTYB2IAAwAbAAABIxMzAyImJjURMxEUHgIzMj4CNREzERQGBgLHWGBYdaD4jlRajqJISKKOWlSO+AZUAQ74gIbzowOi/HqFu3M1NXO7hQOG/F6i84cAAAIAjP/iBNgHCAAPACcAAAEiJiY1MxQWMzI2NTMUBgYDIiYmNREzERQeAjMyPgI1ETMRFAYGArI/Zz5OWT0/V049aD+g+I5UWo6iSEiijlpUjvgGJD5nPz1ZWT0/Zz75vobzowOi/HqFu3M1NXO7hQOG/F6i84cAAAIAjP/iBNgHRAAGAB4AAAE3MxcjJwcTIiYmNREzERQeAjMyPgI1ETMRFAYGAbzIXMhkkpKSoPiOVFqOokhIoo5aVI74BlTw8Kqq+Y6G86MDovx6hbtzNTVzu4UDhvxeovOHAAADAIz/4gTYBwgAAwAHAB8AAAE1MxUhNTMVEyImJjURMxEUHgIzMj4CNREzERQGBgMqeP4geHig+I5UWo6iSEiijlpUjvgGkHh4eHj5UobzowOi/HqFu3M1NXO7hQOG/F6i84cAAgCM/oQE2AWgAAMAGwAAATUzFQMiJiY1ETMRFB4CMzI+AjURMxEUBgYCdng8oPiOVFqOokhIoo5aVI74/oSAgAFehvOjA6L8eoW7czU1c7uFA4b8XqLzhwAAAgCM/+IE2AdiAAMAGwAAAQMzEwMiJiY1ETMRFB4CMzI+AjURMxEUBgYCnWBYYEOg+I5UWo6iSEiijlpUjvgGVAEO/vL5jobzowOi/HqFu3M1NXO7hQOG/F6i84cAAAIAjP/iBNgHiwARACkAAAEnNjYWFxYWBgYHJzY2JyYmBhMiJiY1ETMRFB4CMzI+AjURMxEUBgYCWCYeVlkjGQkZNSQ0QCQYETM2QqD4jlRajqJISKKOWlSO+AcTMSQjES4hS0k9FDAjXiUbChb4t4bzowOi/HqFu3M1NXO7hQOG/F6i84cAAgCM/+IFiAZUAA0AJQAAATMWBgcGBic1NjI3NjYBIiYmNREzERQeAjMyPgI1ETMRFAYGBSlUCxI1JV46FjEZPg79gqD4jlRajqJISKKOWlSO+AZUQHgoHAcJRgEGD2f5xYbzowOi/HqFu3M1NXO7hQOG/F6i84cAAwCM/+IFiAdiAA0AEQApAAABMxYGBwYGJzU2Mjc2NiUjEzMDIiYmNREzERQeAjMyPgI1ETMRFAYGBSlUCxI1JV46FjEZPg79l1hgWHWg+I5UWo6iSEiijlpUjvgGVEB4KBwHCUYBBg9nNwEO+ICG86MDovx6hbtzNTVzu4UDhvxeovOHAAADAIz+hAWIBlQAAwARACkAAAE1MxUBMxYGBwYGJzU2Mjc2NgEiJiY1ETMRFB4CMzI+AjURMxEUBgYChngCK1QLEjUlXjoWMRk+Dv2CoPiOVFqOokhIoo5aVI74/oSAgAfQQHgoHAcJRgEGD2f5xYbzowOi/HqFu3M1NXO7hQOG/F6i84cAAAMAjP/iBYgHYgANABEAKQAAATMWBgcGBic1NjI3NjYlAzMTAyImJjURMxEUHgIzMj4CNREzERQGBgUpVAsSNSVeOhYxGT4O/W1gWGBDoPiOVFqOokhIoo5aVI74BlRAeCgcBwlGAQYPZzcBDv7y+Y6G86MDovx6hbtzNTVzu4UDhvxeovOHAAADAIz/4gWIB4sADQAfADcAAAEzFgYHBgYnNTYyNzY2JSc2NhYXFhYGBgcnNjYnJiYGEyImJjURMxEUHgIzMj4CNREzERQGBgUpVAsSNSVeOhYxGT4O/SgmHlZZIxkJGTUkNEAkGBEzNkKg+I5UWo6iSEiijlpUjvgGVEB4KBwHCUYBBg9n9jEkIxEuIUtJPRQwI14lGwoW+LeG86MDovx6hbtzNTVzu4UDhvxeovOHAAMAjP/iBYgHBAANACUAPQAAATMWBgcGBic1NjI3NjYBIiYmNREzERQeAjMyPgI1ETMRFAYGAyIuAiMiBhcjJjYzMh4CMzI2JzMWBgUpVAsSNSVeOhYxGT4O/YKg+I5UWo6iSEiijlpUjvgVJ0tIQh4rFQpIEk1FKExIQh4mHAxIEkwGVEB4KBwHCUYBBg9n+cWG86MDovx6hbtzNTVzu4UDhvxeovOHBnIdJh07G0VhHSYdOCJDZ///AIz/4gTYB2IAJgCCAAAAJwLYAbEAAAAGAthTAAACAIz/4gTYBuQAAwAbAAABNSEVAyImJjURMxEUHgIzMj4CNREzERQGBgHCAeDwoPiOVFqOokhIoo5aVI74BpBUVPlShvOjA6L8eoW7czU1c7uFA4b8XqLzh///AIz+YgTYBaAAJgCCAAAABwLhAdQARgADAIz/4gTYB5wADwAbADMAAAEiJiY1NDY2MzIWFhUUBgYnMjY1NCYjIgYVFBYTIiYmNREzERQeAjMyPgI1ETMRFAYGArI1WDU1WDU2WDQ0WDYvPz8vLUFBLaD4jlRajqJISKKOWlSO+AYYNFg2NVg1NVg1Nlg0VEEtLkBALi1B+XaG86MDovx6hbtzNTVzu4UDhvxeovOH//8AjP/iBNgHBAAmAIIAAAAHAt4AtAAAAAEACgAABHwFoAAGAAAhATMBATMBAhb99FoB3gHgWv30BaD62gUm+mAAAAEAKAAABvIFoAAMAAAhATMBATMBATMBIwEBAcT+ZFYBcgFwWAFyAXBY/mRY/o7+kAWg+vgFCPr4BQj6YAUG+voAAAIAKAAABvIHYgADABAAAAEjEzMBATMBATMBATMBIwEBA8BYYFj9pP5kVgFyAXBYAXIBcFj+ZFj+jv6QBlQBDvieBaD6+AUI+vgFCPpgBQb6+gACACgAAAbyB0QABgATAAABNzMXIycHAQEzAQEzAQEzASMBAQKYyFzIZJKS/sj+ZFYBcgFwWAFyAXBY/mRY/o7+kAZU8PCqqvmsBaD6+AUI+vgFCPpgBQb6+gADACgAAAbyBwgAAwAHABQAAAE1MxUhNTMVAQEzAQEzAQEzASMBAQQGeP4geP6u/mRWAXIBcFgBcgFwWP5kWP6O/pAGkHh4eHj5cAWg+vgFCPr4BQj6YAUG+voAAAIAKAAABvIHYgADABAAAAEDMxMBATMBATMBATMBIwEBA1pgWGD+Ev5kVgFyAXBYAXIBcFj+ZFj+jv6QBlQBDv7y+awFoPr4BQj6+AUI+mAFBvr6AAEAFAAABGYFoAALAAAzAQEzAQEzAQEjAQEUAfr+EmQBuAG6ZP4SAfpk/jr+PALaAsb9fgKC/Tr9JgKU/WwAAQAAAAAEDgWgAAgAACERATMBATMBEQHe/iJgAagBpmD+JAJkAzz9JALc/MT9nAAAAgAAAAAEDgdiAAMADAAAASMTMwMRATMBATMBEQIXWGBYmf4iYAGoAaZg/iQGVAEO+J4CZAM8/SQC3PzE/ZwAAAIAAAAABA4HRAAGAA8AAAE3MxcjJwcTEQEzAQEzAREBEshcyGSSkmj+ImABqAGmYP4kBlTw8Kqq+awCZAM8/SQC3PzE/ZwAAAMAAAAABA4HCAADAAcAEAAAATUzFSE1MxUTEQEzAQEzARECgHj+IHhO/iJgAagBpmD+JAaQeHh4ePlwAmQDPP0kAtz8xP2cAAIAAP6EBA4FoAADAAwAAAE1MxUDEQEzAQEzAREBy3hl/iJgAagBpmD+JP6EgIABfAJkAzz9JALc/MT9nAAAAgAAAAAEDgdiAAMADAAAAQMzEwMRATMBATMBEQHjYFhgXf4iYAGoAaZg/iQGVAEO/vL5rAJkAzz9JALc/MT9nAAAAgAAAAAEDgeLABEAGgAAASc2NhYXFhYGBgcnNjYnJiYGExEBMwEBMwERAaYmHlZZIxkJGTUkNEAkGBEzNiD+ImABqAGmYP4kBxMxJCMRLiFLST0UMCNeJRsKFvjVAmQDPP0kAtz8xP2cAAIAAAAABA4HBAAXACAAAAEiLgIjIgYXIyY2MzIeAjMyNiczFgYBEQEzAQEzARECoidLSEIeKxUKSBJNRShMSEIeJhwMSBJM/vT+ImABqAGmYP4kBlQdJh07G0VhHSYdOCJDZ/msAmQDPP0kAtz8xP2cAAEAZAAABCYFoAAJAAAzNQEhNSEVASEVZANG/LoDwvy+A0IeBS5UIvrUUgAAAgBkAAAEJgdiAAMADQAAASMTMwE1ASE1IRUBIRUCX1hgWP2lA0b8ugPC/L4DQgZUAQ74nh4FLlQi+tRSAAACAGQAAAQmB0QACQAQAAAzNQEhNSEVASEVATMXNzMHI2QDRvy6A8L8vgNC/VxkkpJkyFweBS5UIvrUUgdEqqrwAAACAGQAAAQmBwgAAwANAAABNTMVATUBITUhFQEhFQI+eP2uA0b8ugPC/L4DQgaQeHj5cB4FLlQi+tRSAAACAFD/4gPEBFYAIwA3AAAFIiYmNTQ2Njc+AjcHNiYjIgYHJzY2MzIWFxYWFREjERcGBCcyNjY3NjQ1Fw4CBw4CFRQWFgHGfqZSU4ZNXte2LR4FlbyIpSFcJN+rlsgkDgxOKCv/ALF1s28PCCw1u9BUMWhHNHseWJBUX31IEBMdFAYUv7t5fRiWnHpoKHI2/VwBKAKaqlRUn284gBwiBREbFQw0Xko0akgAAAMAUP/iA8QF+gADACcAOwAAASMTMwMiJiY1NDY2Nz4CNwc2JiMiBgcnNjYzMhYXFhYVESMRFwYEJzI2Njc2NDUXDgIHDgIVFBYWAlFYYFjrfqZSU4ZNXte2LR4FlbyIpSFcJN+rlsgkDgxOKCv/ALF1s28PCCw1u9BUMWhHNHsE7AEO+ehYkFRffUgQEx0UBhS/u3l9GJacemgocjb9XAEoApqqVFSfbziAHCIFERsVDDReSjRqSAADAFD/4gPEBaAADwAzAEcAAAEiJiY1MxQWMzI2NTMUBgYDIiYmNTQ2Njc+AjcHNiYjIgYHJzY2MzIWFxYWFREjERcGBCcyNjY3NjQ1Fw4CBw4CFRQWFgIwP2g9Tlk9P1dOPWipfqZSU4ZNXte2LR4FlbyIpSFcJN+rlsgkDgxOKCv/ALF1s28PCCw1u9BUMWhHNHsEvD5nPz1ZWT0/Zz77JliQVF99SBATHRQGFL+7eX0Ylpx6aChyNv1cASgCmqpUVJ9vOIAcIgURGxUMNF5KNGpIAAQAUP/iA8QGzAAPABMANwBLAAABIiYmNTMUFjMyNjUzFAYGAyMTMwMiJiY1NDY2Nz4CNwc2JiMiBgcnNjYzMhYXFhYVESMRFwYEJzI2Njc2NDUXDgIHDgIVFBYWAi8/aD1OWT0/V049aBlYYFjvfqZSU4ZNXte2LR4FlbyIpSFcJN+rlsgkDgxOKCv/ALF1s28PCCw1u9BUMWhHNHsEvD5nPz1ZWT0/Zz4BAgEO+RZYkFRffUgQEx0UBhS/u3l9GJacemgocjb9XAEoApqqVFSfbziAHCIFERsVDDReSjRqSAAEAFD+hAPEBaAAAwATADcASwAAATUzFQMiJiY1MxQWMzI2NTMUBgYDIiYmNTQ2Njc+AjcHNiYjIgYHJzY2MzIWFxYWFREjERcGBCcyNjY3NjQ1Fw4CBw4CFRQWFgHOeBY/aD1OWT0/V049aKl+plJThk1e17YtHgWVvIilIVwk36uWyCQODE4oK/8AsXWzbw8ILDW70FQxaEc0e/6EgIAGOD5nPz1ZWT0/Zz77JliQVF99SBATHRQGFL+7eX0Ylpx6aChyNv1cASgCmqpUVJ9vOIAcIgURGxUMNF5KNGpIAAQAUP/iA8QGzAAPABMANwBLAAABIiYmNTMUFjMyNjUzFAYGAwMzEwMiJiY1NDY2Nz4CNwc2JiMiBgcnNjYzMhYXFhYVESMRFwYEJzI2Njc2NDUXDgIHDgIVFBYWAjc/aD1OVz8+WE49aGVgWGCjfqZSU4ZNXte2LR4FlbyIpSFcJN+rlsgkDgxOKCv/ALF1s28PCCw1u9BUMWhHNHsEvD5nPz1ZWT0/Zz4BAgEO/vL6JFiQVF99SBATHRQGFL+7eX0Ylpx6aChyNv1cASgCmqpUVJ9vOIAcIgURGxUMNF5KNGpIAAQAUP/iA8QG7AAPACEARQBZAAABIiYmNTMUFjMyNjUzFAYGAyc2NhYXFhYGBgcnNjYnJiYGAyImJjU0NjY3PgI3BzYmIyIGByc2NjMyFhcWFhURIxEXBgQnMjY2NzY0NRcOAgcOAhUUFhYCPT9oPU5ZPT9XTj1ouyYeVlkjGQkZNSQ0QCQYETM2E36mUlOGTV7Xti0eBZW8iKUhXCTfq5bIJA4MTigr/wCxdbNvDwgsNbvQVDFoRzR7BLw+Zz89WVk9P2c+AbgxJCMRLiFLST0UMCNeJRsKFvlWWJBUX31IEBMdFAYUv7t5fRiWnHpoKHI2/VwBKAKaqlRUn284gBwiBREbFQw0Xko0akgAAAQAUP/iA8QGggAXACcASwBfAAABIi4CIyIGFyMmNjMyHgIzMjYnMxYGAyImJjUzFBYzMjY1MxQGBgMiJiY1NDY2Nz4CNwc2JiMiBgcnNjYzMhYXFhYVESMRFwYEJzI2Njc2NDUXDgIHDgIVFBYWApsnS0hCHisVCkgSTUUoTEhCHiYcDEgSTNU/aD1OWT0/V049aId+plJThk1e17YtHgWVvIilIVwk36uWyCQODE4oK/8AsXWzbw8ILDW70FQxaEc0ewXSHSYdOxtFYR0mHTgiQ2f+6j5nPz1ZWT0/Zz77JliQVF99SBATHRQGFL+7eX0Ylpx6aChyNv1cASgCmqpUVJ9vOIAcIgURGxUMNF5KNGpIAAMAUP/iA8QF3AAGACoAPgAAATczFyMnBxMiJiY1NDY2Nz4CNwc2JiMiBgcnNjYzMhYXFhYVESMRFwYEJzI2Njc2NDUXDgIHDgIVFBYWATjIXMhkkpIqfqZSU4ZNXte2LR4FlbyIpSFcJN+rlsgkDgxOKCv/ALF1s28PCCw1u9BUMWhHNHsE7PDwqqr69liQVF99SBATHRQGFL+7eX0Ylpx6aChyNv1cASgCmqpUVJ9vOIAcIgURGxUMNF5KNGpIAAQAUP/iA8kGzAAGAAoALgBCAAABNzMXIycHJSMTMwEiJiY1NDY2Nz4CNwc2JiMiBgcnNjYzMhYXFhYVESMRFwYEJzI2Njc2NDUXDgIHDgIVFBYWAT/IXMhkkpIBxlhgWP39fqZSU4ZNXte2LR4FlbyIpSFcJN+rlsgkDgxOKCv/ALF1s28PCCw1u9BUMWhHNHsE7PDwqqrSAQ75FliQVF99SBATHRQGFL+7eX0Ylpx6aChyNv1cASgCmqpUVJ9vOIAcIgURGxUMNF5KNGpIAAAEAFD+hAPEBdwAAwAKAC4AQgAAATUzFQE3MxcjJwcTIiYmNTQ2Njc+AjcHNiYjIgYHJzY2MzIWFxYWFREjERcGBCcyNjY3NjQ1Fw4CBw4CFRQWFgHOeP7yyFzIZJKSKn6mUlOGTV7Xti0eBZW8iKUhXCTfq5bIJA4MTigr/wCxdbNvDwgsNbvQVDFoRzR7/oSAgAZo8PCqqvr2WJBUX31IEBMdFAYUv7t5fRiWnHpoKHI2/VwBKAKaqlRUn284gBwiBREbFQw0Xko0akgAAAQAUP/iA8QGzAAGAAoALgBCAAABNzMXIycHJQMzEwEiJiY1NDY2Nz4CNwc2JiMiBgcnNjYzMhYXFhYVESMRFwYEJzI2Njc2NDUXDgIHDgIVFBYWAUvIXMhkkpIBYGBYYP5ffqZSU4ZNXte2LR4FlbyIpSFcJN+rlsgkDgxOKCv/ALF1s28PCCw1u9BUMWhHNHsE7PDwqqrSAQ7+8vokWJBUX31IEBMdFAYUv7t5fRiWnHpoKHI2/VwBKAKaqlRUn284gBwiBREbFQw0Xko0akgAAAQAUP/iBBIGIwAGABgAPABQAAABNzMXIycHJSc2NhYXFhYGBgcnNjYnJiYGASImJjU0NjY3PgI3BzYmIyIGByc2NjMyFhcWFhURIxEXBgQnMjY2NzY0NRcOAgcOAhUUFhYBKMhcyGSSkgGaJh5WWSMZCRk1JDRAJBgRMzb+iH6mUlOGTV7Xti0eBZW8iKUhXCTfq5bIJA4MTigr/wCxdbNvDwgsNbvQVDFoRzR7BOzw8KqqvzEkIxEuIUtJPRQwI14lGwoW+h9YkFRffUgQEx0UBhS/u3l9GJacemgocjb9XAEoApqqVFSfbziAHCIFERsVDDReSjRqSAAEAFD/4gPEBr4ABgAeAEIAVgAAATczFyMnBwEiLgIjIgYXIyY2MzIeAjMyNiczFgYBIiYmNTQ2Njc+AjcHNiYjIgYHJzY2MzIWFxYWFREjERcGBCcyNjY3NjQ1Fw4CBw4CFRQWFgE8yFzIZJKSASInS0hCHisVCkgSTUUoTEhCHiYcDEgSTP68fqZSU4ZNXte2LR4FlbyIpSFcJN+rlsgkDgxOKCv/ALF1s28PCCw1u9BUMWhHNHsE7PDwqqoBIh0mHTsbRWEdJh04IkNn+dRYkFRffUgQEx0UBhS/u3l9GJacemgocjb9XAEoApqqVFSfbziAHCIFERsVDDReSjRqSAAEAFD/4gPEBaAAAwAHACsAPwAAATUzFSE1MxUTIiYmNTQ2Njc+AjcHNiYjIgYHJzY2MzIWFxYWFREjERcGBCcyNjY3NjQ1Fw4CBw4CFRQWFgKweP4geAZ+plJThk1e17YtHgWVvIilIVwk36uWyCQODE4oK/8AsXWzbw8ILDW70FQxaEc0ewUoeHh4ePq6WJBUX31IEBMdFAYUv7t5fRiWnHpoKHI2/VwBKAKaqlRUn284gBwiBREbFQw0Xko0akgAAAMAUP6EA8QEVgADACcAOwAAATUzFQMiJiY1NDY2Nz4CNwc2JiMiBgcnNjYzMhYXFhYVESMRFwYEJzI2Njc2NDUXDgIHDgIVFBYWAc54gH6mUlOGTV7Xti0eBZW8iKUhXCTfq5bIJA4MTigr/wCxdbNvDwgsNbvQVDFoRzR7/oSAgAFeWJBUX31IEBMdFAYUv7t5fRiWnHpoKHI2/VwBKAKaqlRUn284gBwiBREbFQw0Xko0akgAAwBQ/+IDxAX6AAMAJwA7AAABAzMTAyImJjU0NjY3PgI3BzYmIyIGByc2NjMyFhcWFhURIxEXBgQnMjY2NzY0NRcOAgcOAhUUFhYCBGBYYJZ+plJThk1e17YtHgWVvIilIVwk36uWyCQODE4oK/8AsXWzbw8ILDW70FQxaEc0ewTsAQ7+8vr2WJBUX31IEBMdFAYUv7t5fRiWnHpoKHI2/VwBKAKaqlRUn284gBwiBREbFQw0Xko0akgAAwBQ/+IDxAYjABEANQBJAAABJzY2FhcWFgYGByc2NicmJgYDIiYmNTQ2Njc+AjcHNiYjIgYHJzY2MzIWFxYWFREjERcGBCcyNjY3NjQ1Fw4CBw4CFRQWFgHFJh5WWSMZCRk1JDRAJBgRMzYXfqZSU4ZNXte2LR4FlbyIpSFcJN+rlsgkDgxOKCv/ALF1s28PCCw1u9BUMWhHNHsFqzEkIxEuIUtJPRQwI14lGwoW+h9YkFRffUgQEx0UBhS/u3l9GJacemgocjb9XAEoApqqVFSfbziAHCIFERsVDDReSjRqSAAAAwBQ/+IDxAV8AAMAJwA7AAABNSEVASImJjU0NjY3PgI3BzYmIyIGByc2NjMyFhcWFhURIxEXBgQnMjY2NzY0NRcOAgcOAhUUFhYBXAHg/op+plJThk1e17YtHgWVvIilIVwk36uWyCQODE4oK/8AsXWzbw8ILDW70FQxaEc0ewUoVFT6uliQVF99SBATHRQGFL+7eX0Ylpx6aChyNv1cASgCmqpUVJ9vOIAcIgURGxUMNF5KNGpIAAMAUP4cA9AEVgAWADoATgAAASImJjU0NjY3Fw4CFRQWMzI2NxcGBgEiJiY1NDY2Nz4CNwc2JiMiBgcnNjYzMhYXFhYVESMRFwYEJzI2Njc2NDUXDgIHDgIVFBYWAzYvUDFGdEY+PWlANiIbNxYyIVD+Z36mUlOGTV7Xti0eBZW8iKUhXCTfq5bIJA4MTigr/wCxdbNvDwgsNbvQVDFoRzR7/hwyUjA8gX43QihobzEtNyEZOCooAcZYkFRffUgQEx0UBhS/u3l9GJacemgocjb9XAEoApqqVFSfbziAHCIFERsVDDReSjRqSAAABABQ/+IDxAY0AA8AGwA/AFMAAAEiJiY1NDY2MzIWFhUUBgYnMjY1NCYjIgYVFBYDIiYmNTQ2Njc+AjcHNiYjIgYHJzY2MzIWFxYWFREjERcGBCcyNjY3NjQ1Fw4CBw4CFRQWFgItNVg1NVg1Nlg0NFg2Lz8/Ly1BQTp+plJThk1e17YtHgWVvIilIVwk36uWyCQODE4oK/8AsXWzbw8ILDW70FQxaEc0ewSwNFg2NVg1NVg1Nlg0VEEtLkBALi1B+t5YkFRffUgQEx0UBhS/u3l9GJacemgocjb9XAEoApqqVFSfbziAHCIFERsVDDReSjRqSAAAAwBQ/+IDxAWcABcAOwBPAAABIi4CIyIGFyMmNjMyHgIzMjYnMxYGASImJjU0NjY3PgI3BzYmIyIGByc2NjMyFhcWFhURIxEXBgQnMjY2NzY0NRcOAgcOAhUUFhYCvidLSEIeKxUKSBJNRShMSEIeJhwMSBJM/sB+plJThk1e17YtHgWVvIilIVwk36uWyCQODE4oK/8AsXWzbw8ILDW70FQxaEc0ewTsHSYdOxtFYR0mHTgiQ2f69liQVF99SBATHRQGFL+7eX0Ylpx6aChyNv1cASgCmqpUVJ9vOIAcIgURGxUMNF5KNGpIAAAEAFD/4gcUBFYAHwAwAFIAVgAABSImAjU0EjYzMhYSFSM1JgIjIgYGFRQSMzI2NxcOAiUyNjc+AjUXISIOAhUUFhciJjU0PgMzIQc2JiYjIgYHJz4CMzIWFxYWFQMOAgE1IRUFRJjRa23TmJrMZlYGuLyAq1XCvnrBOUIpgqj8G4TNLRsUAQT+oi99dU2YjrLMRW59cSUBXAIGPJN9e70gWBV+tGekxCILBxonmb4BdgNAHpMBAqepAQCPlf71shzeAQR725Db/vV4fChegEJUdWE5g2EHKAgpX1ZzeVSrl1x1QRwGDI3EZWiAHGN/PpGDJ00q/oiAkDoCIlRUAAMAjP/iBDAFoAAPABUAJQAABSImAjU0EjYzMhYSFRQCBiURMxEjESUyNjY1NCYmIyIGBhUUFhYCWo/IaWrPl5HLamzR/ZlUBgGAfalWU6iBfqtXVqsemAEDoaQBAZOX/v6fov79lx4FoP2y/K42gN2Litt/fNuNi92AAAABAFD/4gPwBFYAHAAABSImAic2EjYzMhYXByYmIyIGBgcWEjMyNjcXBgYCPqHacAMDcdqglusxUC27eoiyWAIDysd3uDFSQ9wekAEBqa0BAI2PfSJocnvbkNz+9m5qJIKGAAIAUP/iA/AF+gADACAAAAEjEzMDIiYCJzYSNjMyFhcHJiYjIgYGBxYSMzI2NxcGBgKAWGBYoqHacAMDcdqglusxUC27eoiyWAIDysd3uDFSQ9wE7AEO+eiQAQGprQEAjY99Imhye9uQ3P72bmokgoYAAAIAUP/iA/AF3AAcACMAAAUiJgInNhI2MzIWFwcmJiMiBgYHFhIzMjY3FwYGATMXNzMHIwI+odpwAwNx2qCW6zFQLbt6iLJYAgPKx3e4MVJD3P53ZJKSZMhcHpABAamtAQCNj30iaHJ725Dc/vZuaiSChgX6qqrwAAIAUP4iA/AEVgAUADEAAAEiJic3FjMyNjU0Jic3MwcWFhUUBgMiJgInNhI2MzIWFwcmJiMiBgYHFhIzMjY3FwYGAgQhPBscMiQtMVQyTFQ6M0VoDqHacAMDcdqglusxUC27eoiyWAIDysd3uDFSQ9z+IhAMShQ6JDMrEM6cFU5BSGQBwJABAamtAQCNj30iaHJ725Dc/vZuaiSChgAAAgBQ/+ID8AXcAAYAIwAAATczFyMnBxMiJgInNhI2MzIWFwcmJiMiBgYHFhIzMjY3FwYGAUjIXMhkkpKSodpwAwNx2qCW6zFQLbt6iLJYAgPKx3e4MVJD3ATs8PCqqvr2kAEBqa0BAI2PfSJocnvbkNz+9m5qJIKGAAACAFD/4gPwBaAAAwAgAAABNTMVAyImAic2EjYzMhYXByYmIyIGBgcWEjMyNjcXBgYCDHhGodpwAwNx2qCW6zFQLbt6iLJYAgPKx3e4MVJD3AUoeHj6upABAamtAQCNj30iaHJ725Dc/vZuaiSChgAAAwBQ/+ID9AWgAA8AHwAlAAAFIiYCNTQSNjMyFhIVFAIGJzI2NjU0JiYjIgYGFRQWFgURIxEzEQImmdFsasuRl89qaciPf6tWV6t+galSVqkB/QZUHpcBA6KfAQKXk/7/pKH+/ZhUgN2Ljdt8f9uKi92ANgNSAk76YAADAFD/4AQqBhwAGgAmACoAAAUGJiYnPgIXNhYXLgInNxYEFx4CFRQGBicyNjU0JgcmBhUUFhMnARcCPpzbdQICdtyaddg/En7XlwqwAQJIJycMd92YxszTv8TQ0eNCARZCHgKE8qKk8YMCAl9foOeEC1IKpZNLpuWoo/OEVvXP0fIDA/fO0+8EUDQBYjT//wBQ/+IFUAW0ACYAxgAAAAcCSgRgBQAABABQ/+IEiAWgAAMAEwAjACkAAAE1IRUBIiYCNTQSNjMyFhIVFAIGJzI2NjU0JiYjIgYGFRQWFgURIxEzEQKoAeD9npnRbGrLkZfPamnIj3+rVlerfoGpUlapAf0GVASwVFT7MpcBA6KfAQKXk/7/pKH+/ZhUgN2Ljdt8f9uKi92ANgNSAk76YAAAAgBQ/+IEKgRWAB0AIQAABSImAjU0EjYzMhYSFSM1JiYjIgYVFBYzMjY3FwYGATUhFQI+md14d92am9x1WgbPvcDU1MCGyjxGQvL9qgNwHooBALCxAQCJjP72vBzp+f/n5/9+diiKlgIiVFQAAwBQ/+IEKgX6AAMAIQAlAAABIxMzAyImAjU0EjYzMhYSFSM1JiYjIgYVFBYzMjY3FwYGATUhFQJ/WGBYoZndeHfdmpvcdVoGz73A1NTAhso8RkLy/aoDcATsAQ756IoBALCxAQCJjP72vBzp+f/n5/9+diiKlgIiVFQAAAMAUP/iBCoF3AAdACEAKAAABSImAjU0EjYzMhYSFSM1JiYjIgYVFBYzMjY3FwYGATUhFQEzFzczByMCPpndeHfdmpvcdVoGz73A1NTAhso8RkLy/aoDcP1SZJKSZMhcHooBALCxAQCJjP72vBzp+f/n5/9+diiKlgIiVFQD2Kqq8AADAFD/4gQqBdwABgAkACgAAAE3MxcjJwcTIiYCNTQSNjMyFhIVIzUmJiMiBhUUFjMyNjcXBgYBNSEVAUjIXMhkkpKSmd14d92am9x1WgbPvcDU1MCGyjxGQvL9qgNwBOzw8Kqq+vaKAQCwsQEAiYz+9rwc6fn/5+f/fnYoipYCIlRUAAAEAFD/4gQqBswABgAKACgALAAAATczFyMnByUjEzMBIiYCNTQSNjMyFhIVIzUmJiMiBhUUFjMyNjcXBgYBNSEVAWDIXMhkkpIBxlhgWP5Umd14d92am9x1WgbPvcDU1MCGyjxGQvL9qgNwBOzw8Kqq0gEO+RaKAQCwsQEAiYz+9rwc6fn/5+f/fnYoipYCIlRUAAQAUP6EBCoF3AADAAoAKAAsAAABNTMVATczFyMnBxMiJgI1NBI2MzIWEhUjNSYmIyIGFRQWMzI2NxcGBgE1IRUCAXj+z8hcyGSSkpKZ3Xh33Zqb3HVaBs+9wNTUwIbKPEZC8v2qA3D+hICABmjw8Kqq+vaKAQCwsQEAiYz+9rwc6fn/5+f/fnYoipYCIlRUAAQAUP/iBCoGzAAGAAoAKAAsAAABNzMXIycHJQMzEwEiJgI1NBI2MzIWEhUjNSYmIyIGFRQWMzI2NxcGBgE1IRUBR8hcyGSSkgFgYFhg/tuZ3Xh33Zqb3HVaBs+9wNTUwIbKPEZC8v2qA3AE7PDwqqrSAQ7+8vokigEAsLEBAImM/va8HOn5/+fn/352KIqWAiJUVAAEAFD/4gRABiMABgAYADYAOgAAATczFyMnByUnNjYWFxYWBgYHJzY2JyYmBgEiJgI1NBI2MzIWEhUjNSYmIyIGFRQWMzI2NxcGBgE1IRUBVshcyGSSkgGaJh5WWSMZCRk1JDRAJBgRMzb+0pndeHfdmpvcdVoGz73A1NTAhso8RkLy/aoDcATs8PCqqr8xJCMRLiFLST0UMCNeJRsKFvofigEAsLEBAImM/va8HOn5/+fn/352KIqWAiJUVAAABABQ/+IEKga+AAYAHgA8AEAAAAE3MxcjJwcBIi4CIyIGFyMmNjMyHgIzMjYnMxYGAyImAjU0EjYzMhYSFSM1JiYjIgYVFBYzMjY3FwYGATUhFQFRyFzIZJKSASInS0hCHisVCkgSTUUoTEhCHiYcDEgSTOGZ3Xh33Zqb3HVaBs+9wNTUwIbKPEZC8v2qA3AE7PDwqqoBIh0mHTsbRWEdJh04IkNn+dSKAQCwsQEAiYz+9rwc6fn/5+f/fnYoipYCIlRU//8AUP/iBCoFoAAGAZkAAAADAFD/4gQqBaAAAwAhACUAAAE1MxUDIiYCNTQSNjMyFhIVIzUmJiMiBhUUFjMyNjcXBgYBNSEVAgJ4PJndeHfdmpvcdVoGz73A1NTAhso8RkLy/aoDcAUoeHj6uooBALCxAQCJjP72vBzp+f/n5/9+diiKlgIiVFQAAAMAUP6EBCoEVgADACEAJQAAATUzFQMiJgI1NBI2MzIWEhUjNSYmIyIGFRQWMzI2NxcGBgE1IRUCAXg7md14d92am9x1WgbPvcDU1MCGyjxGQvL9qgNw/oSAgAFeigEAsLEBAImM/va8HOn5/+fn/352KIqWAiJUVAAAAwBQ/+IEKgX6AAMAIQAlAAABAzMTAyImAjU0EjYzMhYSFSM1JiYjIgYVFBYzMjY3FwYGATUhFQIoYFhgQpndeHfdmpvcdVoGz73A1NTAhso8RkLy/aoDcATsAQ7+8vr2igEAsLEBAImM/va8HOn5/+fn/352KIqWAiJUVAAAAwBQ/+IEKgYjABEALwAzAAABJzY2FhcWFgYGByc2NicmJgYTIiYCNTQSNjMyFhIVIzUmJiMiBhUUFjMyNjcXBgYBNSEVAeMmHlZZIxkJGTUkNEAkGBEzNkOZ3Xh33Zqb3HVaBs+9wNTUwIbKPEZC8v2qA3AFqzEkIxEuIUtJPRQwI14lGwoW+h+KAQCwsQEAiYz+9rwc6fn/5+f/fnYoipYCIlRUAAMAUP/iBCoFfAADACEAJQAAATUhFQEiJgI1NBI2MzIWEhUjNSYmIyIGFRQWMzI2NxcGBgE1IRUBYgHg/vyZ3Xh33Zqb3HVaBs+9wNTUwIbKPEZC8v2qA3AFKFRU+rqKAQCwsQEAiYz+9rwc6fn/5+f/fnYoipYCIlRUAAADAFD+GgQqBFYAHwA9AEEAAAEGJicmJjc2Njc+Ajc3DgMHBgYHBhYXFjY3FwYGASImAjU0EjYzMhYSFSM1JiYjIgYVFBYzMjY3FwYGATUhFQNUNmcjJBEPDC4eFFxhHVQVSU5ADBkuCwcCFSlfJDQSLf7Pmd14d92am9x1WgbPvcDU1MCGyjxGQvL9qgNw/jAWFiIkXjYsUycbY3xCBi5tZ08RJVAnHDUVKCEhOhIgAaaKAQCwsQEAiYz+9rwc6fn/5+f/fnYoipYCIlRUAAMAUP/iBCoFnAAXADUAOQAAASIuAiMiBhcjJjYzMh4CMzI2JzMWBgMiJgI1NBI2MzIWEhUjNSYmIyIGFRQWMzI2NxcGBgE1IRUCyCdLSEIeKxUKSBJNRShMSEIeJhwMSBJM0pndeHfdmpvcdVoGz73A1NTAhso8RkLy/aoDcATsHSYdOxtFYR0mHTgiQ2f69ooBALCxAQCJjP72vBzp+f/n5/9+diiKlgIiVFQAAAIAUP/iBCoEVgAdACEAAAEyFhIVFAYGIyImAjUzFRYWMzI2NTQmIyIGByc2NgEVITUCPJned3fdmpvcdVoGz73A1NTAhcs8RkLzAlX8kARWiv8AsLH/iowBCrwc6Pr/5+f/fXcoipb93lRUAAIAPAAAApIFvgAQABQAACERNDY2Nz4CMzMVIyIGFREBNSEVAQALHBkYO0grjIJeXv7oAlYEsipHPBsZHg1MWm77VgPkVFQAAAMAUP4CA/QEVgAXACcANwAAASImJic3FhYzMjY2NREzETMRFAYHDgIDIiYCNTQSNjMyFhIVFAIGJzI2NjU0JiYjIgYGFRQWFgIoTp6LMUo2xGSRo0IITgQGEGu8jZnRbGrLkZfPamnIj3+rVlerfoGpUlap/gIsaVsyb11t16ABFALo/AQxXC2DqlMB4JcBA6KfAQKXk/7/pKH+/ZhUgN2Ljdt8f9uKi92AAAAEAFD+AgP0BaAADwAnADcARwAAASImJjUzFBYzMjY1MxQGBgMiJiYnNxYWMzI2NjURMxEzERQGBw4CAyImAjU0EjYzMhYSFRQCBicyNjY1NCYmIyIGBhUUFhYCXD9oPU5ZPT9XTj1oc06eizFKNsRkkaNCCE4EBhBrvI2Z0Wxqy5GXz2ppyI9/q1ZXq36BqVJWqQS8Pmc/PVlZPT9nPvlGLGlbMm9dbdegARQC6PwEMVwtg6pTAeCXAQOinwECl5P+/6Sh/v2YVIDdi43bfH/biovdgAAABABQ/gID9AXcAAYAHgAuAD4AAAE3MxcjJwcTIiYmJzcWFjMyNjY1ETMRMxEUBgcOAgMiJgI1NBI2MzIWEhUUAgYnMjY2NTQmJiMiBgYVFBYWASzIXMhkkpKYTp6LMUo2xGSRo0IITgQGEGu8jZnRbGrLkZfPamnIj3+rVlerfoGpUlapBOzw8Kqq+RYsaVsyb11t16ABFALo/AQxXC2DqlMB4JcBA6KfAQKXk/7/pKH+/ZhUgN2Ljdt8f9uKi92AAAAEAFD+AgP0BioACwAjADMAQwAAARUiBgYXMxUjNTQ2AyImJic3FhYzMjY2NREzETMRFAYHDgIDIiYCNTQSNjMyFhIVFAIGJzI2NjU0JiYjIgYGFRQWFgKGCiAXAz54VDpOnosxSjbEZJGjQghOBAYQa7yNmdFsasuRl89qaciPf6tWV6t+galSVqkGKjwPIh14eE0999gsaVsyb11t16ABFALo/AQxXC2DqlMB4JcBA6KfAQKXk/7/pKH+/ZhUgN2Ljdt8f9uKi92AAAAEAFD+AgP0BaAAAwAbACsAOwAAATUzFQMiJiYnNxYWMzI2NjURMxEzERQGBw4CAyImAjU0EjYzMhYSFRQCBicyNjY1NCYmIyIGBhUUFhYCInhyTp6LMUo2xGSRo0IITgQGEGu8jZnRbGrLkZfPamnIj3+rVlerfoGpUlapBSh4ePjaLGlbMm9dbdegARQC6PwEMVwtg6pTAeCXAQOinwECl5P+/6Sh/v2YVIDdi43bfH/biovdgAAAAgCMAAAEAgWgABcAHQAAIRE0LgIjIg4CFQc0NjYzMh4DFREhETMRMxEDri9cg1Rji1YoTnrJd1KJa0om/IpOBgI8dKlvNkV4nFcCueNoLld+oWD9tAWg/K79sgADAAAAAAQCBaAAAwAbACEAABE1IRUBETQuAiMiDgIVBzQ2NjMyHgMVESERMxEzEQHgAc4vXINUY4tWKE56yXdSiWtKJvyKTgYEsFRU+1ACPHSpbzZFeJxXArnjaC5XfqFg/bQFoPyu/bIAA/+9AAAEAgdEAAYAHgAkAAADNzMXIycHARE0LgIjIg4CFQc0NjYzMh4DFREhETMRMxFDyFzIZJKSA40vXINUY4tWKE56yXdSiWtKJvyKTgYGVPDwqqr5rAI8dKlvNkV4nFcCueNoLld+oWD9tAWg/K79sgACAKAAAAD0BaAAAwAHAAATNTMVAxEzEaBUVFQFIICA+uAEOPvIAAEAoAAAAPQEOAADAAAzETMRoFQEOPvIAAIAoAAAAVgF+gADAAcAABMjEzMDETMR+FhgWLhUBOwBDvoGBDj7yAAC/9QAAAHABdwABgAKAAADNzMXIycHExEzESzIXMhkkpJoVATs8PCqqvsUBDj7yP///9oAAAG6BaAABgG7AAD//wCgAAAA9AWgAAYA5QAAAAMAjv6EAQYFoAADAAcACwAAEzUzFQM1MxUDETMRjnhmVFRU/oSAgAacgID64AQ4+8gAAgA8AAAA9AX6AAMABwAAEwMzEwMRMxGcYFhgVFQE7AEO/vL7FAQ4+8gAAgAxAAABQwYjABEAFQAAEyc2NhYXFhYGBgcnNjYnJiYGExEzEVcmHlZZIxkJGTUkNEAkGBEzNjFUBasxJCMRLiFLST0UMCNeJRsKFvo9BDj7yAAAAv/aAAABugV8AAMABwAAAzUhFQERMxEmAeD+5lQFKFRU+tgEOPvIAAP/tv4cAQAFoAAWABoAHgAAEyImJjU0NjY3Fw4CFRQWMzI2NxcGBhM1MxUDETMRZi9QMUZ0Rj49aUA2Ihs3FjIhUBFUVFT+HDJSMDyBfjdCKGhvMS03IRk4KigHBICA+uAEOPvIAAL/qwAAAekFnAAXABsAAAEiLgIjIgYXIyY2MzIeAjMyNiczFgYDETMRAVUnS0hCHisVCkgSTUUoTEhCHiYcDEgSTP1UBOwdJh07G0VhHSYdOCJDZ/sUBDj7yAAAAv/s/iABIgWgAAsADwAAAzUzMjY1ETMRFAYjEzUzFRREP19UcYOgVP4gVkddBR767Ip6BwCAgAAC/+z+IAHuBdwACwASAAADNTMyNjURMxEUBiMDNzMXIycHFEQ/X1RxgyzIXMhkkpL+IFZHXQUe+uyKegbM8PCqqgABAIwAAAPQBaAACgAAMxEzEQEzAQEjARGMVAIcfv3MAoqQ/aAFoPyQAgj95P3kAgj9+AAAAgCM/gID0AWgAAsAFgAAATUyNjYnIzUzFRQGAREzEQEzAQEjAREBwAogFwM+eFT+qFQCHH79zAKKkP2g/gI8DyIdeHhMPgH+BaD8kAII/eT95AII/fgAAAEAoAAAAPQFvgADAAAzETMRoFQFvvpCAAIAoAAAAVgHYgADAAcAABMjEzMDETMR+FhgWLhUBlQBDvieBb76Qv//AKAAAAIWBb4AJgD1AAAABwJKASYFAAACAI7+AgEGBb4ACwAPAAATNTI2NicjNTMVFAYDETMRjgogFwM+eFQSVP4CPA8iHXh4TD4B/gW++kIAAgBiAAACcAW+AAMABwAAEzUBFQERMxFiAg7+0FQCFmQBLmL8ugW++kIAAwCMAAAF5ARWABEAFwApAAAhEzQmIyIGBhUjJjY2MzIWFQMhETMVMxEhEzQmIyIGFSc0NjYzMhYWFQMFjgKedECDWUoFXahsmccC+qpOBgIuApt7fpxKXqVrW6BjAgLoh5s6inh3sGHAqP0SBDjc/KQC2oykrJAgaKNdTaJ//RgAAAIAjAAABAIEUAAXAB0AACERNC4CIyIOAhUHNDY2MzIeAxURIREzFTMRA64vXINUY4tWKE56yXdSiWtKJvyKTgYCPHSpbzZFeJxXArnjaC5XfqFg/bQEONz8pAAAAwCMAAAEAgX6AAMAGwAhAAABIxMzExE0LgIjIg4CFQc0NjYzMh4DFREhETMVMxECiVhgWMUvXINUY4tWKE56yXdSiWtKJvyKTgYE7AEO+gYCPHSpbzZFeJxXArnjaC5XfqFg/bQEONz8pAAAAwCMAAAEAgXcABcAHQAkAAAhETQuAiMiDgIVBzQ2NjMyHgMVESERMxUzERMzFzczByMDri9cg1Rji1YoTnrJd1KJa0om/IpOBm5kkpJkyFwCPHSpbzZFeJxXArnjaC5XfqFg/bQEONz8pAXcqqrwAAMAjP4CBAIEUAALACMAKQAAATUyNjYnIzUzFRQGARE0LgIjIg4CFQc0NjYzMh4DFREhETMVMxECDAogFwM+eFQBfi9cg1Rji1YoTnrJd1KJa0om/IpOBv4CPA8iHXh4TD4B/gI8dKlvNkV4nFcCueNoLld+oWD9tAQ43PykAAMAjP6YBAIEUAAOACYALAAAAQYmJzUWPgI1NTMVFAYDETQuAiMiDgIVBzQ2NjMyHgMVESERMxUzEQOaKjoeMTsfC1Q7GS9cg1Rji1YoTnrJd1KJa0om/IpOBv6cBAUHUgcHI0Q1cMBVSAFbAjx0qW82RXicVwK542guV36hYP20BDjc/KQAAwCMAAAEAgWcABcALwA1AAABIi4CIyIGFyMmNjMyHgIzMjYnMxYGExE0LgIjIg4CFQc0NjYzMh4DFREhETMVMxECyCdLSEIeKxUKSBJNRShMSEIeJhwMSBJMni9cg1Rji1YoTnrJd1KJa0om/IpOBgTsHSYdOxtFYR0mHTgiQ2f7FAI8dKlvNkV4nFcCueNoLld+oWD9tAQ43PykAAACAFD/4gQsBFYADwAcAAAFIiYCNTQSNjMyFhIVFAIGJzISNTQCIyIGBhUUEgI+oNxydN2dodxxct2fzMjJy4mzWM0ekgECqKoBAI6R/wCnq/7/kFQBD9ndAQd82o7c/vQAAAMAUP/iBCwF+gADABMAIAAAASMTMwMiJgI1NBI2MzIWEhUUAgYnMhI1NAIjIgYGFRQSAmdYYFiJoNxydN2dodxxct2fzMjJy4mzWM0E7AEO+eiSAQKoqgEAjpH/AKer/v+QVAEP2d0BB3zajtz+9AADAFD/4gQsBdwABgAWACMAAAE3MxcjJwcTIiYCNTQSNjMyFhIVFAIGJzISNTQCIyIGBhUUEgFIyFzIZJKSkqDccnTdnaHccXLdn8zIycuJs1jNBOzw8Kqq+vaSAQKoqgEAjpH/AKer/v+QVAEP2d0BB3zajtz+9AAEAFD/4gQsBswABgAKABoAJwAAATczFyMnByUjEzMBIiYCNTQSNjMyFhIVFAIGJzISNTQCIyIGBhUUEgFSyFzIZJKSAcZYYFj+YqDccnTdnaHccXLdn8zIycuJs1jNBOzw8Kqq0gEO+RaSAQKoqgEAjpH/AKer/v+QVAEP2d0BB3zajtz+9AAABABQ/oQELAXcAAMACgAaACcAAAE1MxUBNzMXIycHEyImAjU0EjYzMhYSFRQCBicyEjU0AiMiBgYVFBICAnj+zshcyGSSkpKg3HJ03Z2h3HFy3Z/MyMnLibNYzf6EgIAGaPDwqqr69pIBAqiqAQCOkf8Ap6v+/5BUAQ/Z3QEHfNqO3P70AAAEAFD/4gQsBswABgAKABoAJwAAATczFyMnByUDMxMBIiYCNTQSNjMyFhIVFAIGJzISNTQCIyIGBhUUEgFhyFzIZJKSAWBgWGD+waDccnTdnaHccXLdn8zIycuJs1jNBOzw8Kqq0gEO/vL6JJIBAqiqAQCOkf8Ap6v+/5BUAQ/Z3QEHfNqO3P70AAAEAFD/4gQxBiMABgAYACgANQAAATczFyMnByUnNjYWFxYWBgYHJzY2JyYmBgEiJgI1NBI2MzIWEhUUAgYnMhI1NAIjIgYGFRQSAUfIXMhkkpIBmiYeVlkjGQkZNSQ0QCQYETM2/uGg3HJ03Z2h3HFy3Z/MyMnLibNYzQTs8PCqqr8xJCMRLiFLST0UMCNeJRsKFvofkgECqKoBAI6R/wCnq/7/kFQBD9ndAQd82o7c/vQABABQ/+IELAa+AAYAHgAuADsAAAE3MxcjJwcBIi4CIyIGFyMmNjMyHgIzMjYnMxYGAyImAjU0EjYzMhYSFRQCBicyEjU0AiMiBgYVFBIBSshcyGSSkgEiJ0tIQh4rFQpIEk1FKExIQh4mHAxIEkzaoNxydN2dodxxct2fzMjJy4mzWM0E7PDwqqoBIh0mHTsbRWEdJh04IkNn+dSSAQKoqgEAjpH/AKer/v+QVAEP2d0BB3zajtz+9AAABABQ/+IELAWgAAMABwAXACQAAAE1MxUhNTMVEyImAjU0EjYzMhYSFRQCBicyEjU0AiMiBgYVFBICtnj+IHh4oNxydN2dodxxct2fzMjJy4mzWM0FKHh4eHj6upIBAqiqAQCOkf8Ap6v+/5BUAQ/Z3QEHfNqO3P70AAADAFD+hAQsBFYAAwATACAAAAE1MxUDIiYCNTQSNjMyFhIVFAIGJzISNTQCIyIGBhUUEgICeDyg3HJ03Z2h3HFy3Z/MyMnLibNYzf6EgIABXpIBAqiqAQCOkf8Ap6v+/5BUAQ/Z3QEHfNqO3P70AAMAUP/iBCwF+gADABMAIAAAAQMzEwMiJgI1NBI2MzIWEhUUAgYnMhI1NAIjIgYGFRQSAgtgWGAloNxydN2dodxxct2fzMjJy4mzWM0E7AEO/vL69pIBAqiqAQCOkf8Ap6v+/5BUAQ/Z3QEHfNqO3P70AAMAUP/iBCwGIwARACEALgAAASc2NhYXFhYGBgcnNjYnJiYGEyImAjU0EjYzMhYSFRQCBicyEjU0AiMiBgYVFBIB4yYeVlkjGQkZNSQ0QCQYETM2Q6DccnTdnaHccXLdn8zIycuJs1jNBasxJCMRLiFLST0UMCNeJRsKFvofkgECqKoBAI6R/wCnq/7/kFQBD9ndAQd82o7c/vQAAAMAUP/iBDAE7AANAB0AKgAAATMWBgcGBic1FjY3NjYBIiYCNTQSNjMyFhIVFAIGJzISNTQCIyIGBhUUEgPRVAsTNSWKSTVHHzgV/mag3HJ03Z2h3HFy3Z/MyMnLibNYzQTsQHYpHBcuMhABEBxe+y2SAQKoqgEAjpH/AKer/v+QVAEP2d0BB3zajtz+9AAEAFD/4gQwBfoADQARACEALgAAATMWBgcGBic1FjY3NjYlIxMzAyImAjU0EjYzMhYSFRQCBicyEjU0AiMiBgYVFBID0VQLEzUlikk1Rx84Ff6PWGBYiaDccnTdnaHccXLdn8zIycuJs1jNBOxAdikcFy4yEAEQHF43AQ756JIBAqiqAQCOkf8Ap6v+/5BUAQ/Z3QEHfNqO3P70AAAEAFD+hAQwBOwAAwARACEALgAAATUzFQEzFgYHBgYnNRY2NzY2ASImAjU0EjYzMhYSFRQCBicyEjU0AiMiBgYVFBICAXgBWFQLEzUlikk1Rx84Ff5moNxydN2dodxxct2fzMjJy4mzWM3+hICABmhAdikcFy4yEAEQHF77LZIBAqiqAQCOkf8Ap6v+/5BUAQ/Z3QEHfNqO3P70AAAEAFD/4gQwBfoADQARACEALgAAATMWBgcGBic1FjY3NjYlAzMTAyImAjU0EjYzMhYSFRQCBicyEjU0AiMiBgYVFBID0VQLEzUlikk1Rx84Ff4zYFhgJaDccnTdnaHccXLdn8zIycuJs1jNBOxAdikcFy4yEAEQHF43AQ7+8vr2kgECqKoBAI6R/wCnq/7/kFQBD9ndAQd82o7c/vQAAAQAUP/iBDAGIwARAB8ALwA8AAABJzY2FhcWFgYGByc2NicmJgYFMxYGBwYGJzUWNjc2NgEiJgI1NBI2MzIWEhUUAgYnMhI1NAIjIgYGFRQSAeMmHlZZIxkJGTUkNEAkGBEzNgHWVAsTNSWKSTVHHzgV/mag3HJ03Z2h3HFy3Z/MyMnLibNYzQWrMSQjES4hS0k9FDAjXiUbChbXQHYpHBcuMhABEBxe+y2SAQKoqgEAjpH/AKer/v+QVAEP2d0BB3zajtz+9AAABABQ/+IEMAWcABcAJQA1AEIAAAEiLgIjIgYXIyY2MzIeAjMyNiczFgYzMxYGBwYGJzUWNjc2NgEiJgI1NBI2MzIWEhUUAgYnMhI1NAIjIgYGFRQSAsgnS0hCHisVCkgSTUUoTEhCHiYcDEgSTMFUCxM1JYpJNUcfOBX+ZqDccnTdnaHccXLdn8zIycuJs1jNBOwdJh07G0VhHSYdOCJDZ0B2KRwXLjIQARAcXvstkgECqKoBAI6R/wCnq/7/kFQBD9ndAQd82o7c/vT//wBQ/+IELAX6ACYBAQAAACcC2AFQ/pgABwLY//L+mAADAFD/4gQsBXwAAwATACAAAAE1IRUDIiYCNTQSNjMyFhIVFAIGJzISNTQCIyIGBhUUEgFOAeDwoNxydN2dodxxct2fzMjJy4mzWM0FKFRU+rqSAQKoqgEAjpH/AKer/v+QVAEP2d0BB3zajtz+9AAAAwAg/+IEXARWAAsAGwAoAAAzJzc3ATc3FwcHAQcFIiYCNTQSNjMyFhIVFAIGJzISNTQCIyIGBhUUElw8pBYCpBqIPKAW/WoWAUSg3HJ03Z2h3HFy3Z/MyMnLibNYzTykFgKiGoY6nhb9aha8kgECqKoBAI6R/wCnq/7/kFQBD9ndAQd82o7c/vQAAwBQ/+IELAWcABcAJwA0AAABIi4CIyIGFyMmNjMyHgIzMjYnMxYGAyImAjU0EjYzMhYSFRQCBicyEjU0AiMiBgYVFBICyidLSEIeKxUKSBJNRShMSEIeJhwMSBJM1KDccnTdnaHccXLdn8zIycuJs1jNBOwdJh07G0VhHSYdOCJDZ/r2kgECqKoBAI6R/wCnq/7/kFQBD9ndAQd82o7c/vT//wBQ/+IHrgRWACcAygOEAAAABgEBAAAAAwCM/iAEMARWAA8AFQAlAAAFIiYCNTQSNjMyFhIVFAIGAREzETMRATI2NjU0JiYjIgYGFRQWFgJaj8hpas+XkctqbNH9mU4GAXp9qVZTqIF+q1dWqx6YAQOhpAEBk5f+/p+i/v2X/j4GGPyu/ToCFoDdi4rbf3zbjYvdgAAABACM/iAEMAWgAAMAEwAZACkAABMRMxEBIiYCNTQSNjMyFhIVFAIGAREzETMRATI2NjU0JiYjIgYGFRQWFoxUAXqPyGlqz5eRy2ps0f2ZTgYBen2pVlOogX6rV1arAw4Ckv1u/NSYAQOhpAEBk5f+/p+i/v2X/j4GGPyu/ToCFoDdi4rbf3zbjYvdgAADAFD+IAP0BFYADwAfACUAAAUiJgI1NBI2MzIWEhUUAgYnMjY2NTQmJiMiBgYVFBYWAREzETMRAiaZ0Wxqy5GXz2ppyI9/q1ZXq36BqVJWqQH3Bk4elwEDop8BApeT/v+kof79mFSA3YuN23x/24qL3YD96gLGA1L56AAAAQCMAAACbARHABQAADMRMxEnNjY3PgIXFSYGBw4CFRGMThoRNBkseXovQ5ZBOS8KBDj+/iIsTBgrLQcPUA8TPDWKk0L97AAAAgCMAAACbAX6AAMAGAAAASMTMwERMxEnNjY3PgIXFSYGBw4CFREBXFhgWP7QThoRNBkseXovQ5ZBOS8KBOwBDvoGBDj+/iIsTBgrLQcPUA8TPDWKk0L97AAAAgCGAAACcgXcABQAGwAAMxEzESc2Njc+AhcVJgYHDgIVEQMzFzczByOMThoRNBkseXovQ5ZBOS8KWmSSkmTIXAQ4/v4iLEwYKy0HD1APEzw1ipNC/ewF3Kqq8AACAHr+AgJsBEcACwAgAAATNTI2NicjNTMVFAYDETMRJzY2Nz4CFxUmBgcOAhURegogFwM+eFQSThoRNBkseXovQ5ZBOS8K/gI8DyIdeHhMPgH+BDj+/iIsTBgrLQcPUA8TPDWKk0L97AAAAQBQ/+QDtARWACsAAAUiJic3FhYzMjY1NCYmJy4CNTQ2NjMyFhYXByYmIyYGFRQWFhceAhUUBgIWt/IdVhvHkJOtNJeTmqtFZrR2d791CVYTwZCHqzqQgKK1SdwcmYcQZHh+bDtLPigqT2NIVoRKT41cEHGDAnJcM0k8IClUcFOTpwAAAgBQ/+QDtAX6AAMALwAAASMTMwMiJic3FhYzMjY1NCYmJy4CNTQ2NjMyFhYXByYmIyYGFRQWFhceAhUUBgI1WGBYf7fyHVYbx5CTrTSXk5qrRWa0dne/dQlWE8GQh6s6kICitUncBOwBDvnqmYcQZHh+bDtLPigqT2NIVoRKT41cEHGDAnJcM0k8IClUcFOTpwACAFD/5AO0BdwAKwAyAAAFIiYnNxYWMzI2NTQmJicuAjU0NjYzMhYWFwcmJiMmBhUUFhYXHgIVFAYBMxc3MwcjAha38h1WG8eQk600l5Oaq0VmtHZ3v3UJVhPBkIerOpCAorVJ3P5QZJKSZMhcHJmHEGR4fmw7Sz4oKk9jSFaESk+NXBBxgwJyXDNJPCApVHBTk6cF+Kqq8AAAAgBQ/iIDtARWABQAQAAAASImJzcWMzI2NTQmJzczBxYWFRQGAyImJzcWFjMyNjU0JiYnLgI1NDY2MzIWFhcHJiYjJgYVFBYWFx4CFRQGAfYhPBscMiQtMVQyTFQ6M0VoKLfyHVYbx5CTrTSXk5qrRWa0dne/dQlWE8GQh6s6kICitUnc/iIQDEoUOiQzKxDOnBVOQUhkAcKZhxBkeH5sO0s+KCpPY0hWhEpPjVwQcYMCclwzSTwgKVRwU5OnAAIAUP/kA7QF3AAGADIAAAE3MxcjJwcTIiYnNxYWMzI2NTQmJicuAjU0NjYzMhYWFwcmJiMmBhUUFhYXHgIVFAYBIMhcyGSSkpK38h1WG8eQk600l5Oaq0VmtHZ3v3UJVhPBkIerOpCAorVJ3ATs8PCqqvr4mYcQZHh+bDtLPigqT2NIVoRKT41cEHGDAnJcM0k8IClUcFOTpwACAFD+AgO0BFYACwA3AAABNTI2NicjNTMVFAYTIiYnNxYWMzI2NTQmJicuAjU0NjYzMhYWFwcmJiMmBhUUFhYXHgIVFAYBzAogFwM+eFQmt/IdVhvHkJOtNJeTmqtFZrR2d791CVYTwZCHqzqQgKK1Sdz+AjwPIh14eEw+AeKZhxBkeH5sO0s+KCpPY0hWhEpPjVwQcYMCclwzSTwgKVRwU5OnAAEAjP/kBAYFvgAzAAAFIiYnNRYWMzI2NTQmJzU+AjU0JiMiBgcGBhURIxE0Njc+AjMyFhYVFAYHHgMVFAYCRi1dLDBTM5/H571JhFOYhl2WGwwIXA8PHF+JWnKqXmtlLXRsR+UcChJUEAq1o5KwBFQJQXldh5dVWSdXLPvuBCg4YyVFYDFUpnpzrRoCMV+NX8HtAAACABT/7gK6BWQAEAAUAAAhBiYmJyYmNREzERQWFxYWNwE1IRUCulGefB8YBlQDEyScfv1aAqYSCUNENW1GA/78AkZWJkghFQOUVFQAAwAU/+4CugVkAAMAFAAYAAATNSEVEQYmJicmJjURMxEUFhcWFjcBNSEVFAKmUZ58HxgGVAMTJJx+/VoCpgHyVFT+DhIJQ0Q1bUYD/vwCRlYmSCEVA5RUVAD//wAU/+4CugZAACYBJgAAAAcCSgHKBYwAAwAU/iICugVkABQAJQApAAABIiYnNxYzMjY1NCYnNzMHFhYVFAYTBiYmJyYmNREzERQWFxYWNwE1IRUBliE8GxwyJC0xVDJMVDozRWjcUZ58HxgGVAMTJJx+/VoCpv4iEAxKFDokMysQzpwVTkFIZAHeEglDRDVtRgP+/AJGViZIIRUDlFRUAAMAFP4CAroFZAALABwAIAAAATUyNjYnIzUzFRQGAQYmJicmJjURMxEUFhcWFjcBNSEVATwKIBcDPnhUAVpRnnwfGAZUAxMknH79WgKm/gI8DyIdeHhMPgH+EglDRDVtRgP+/AJGViZIIRUDlFRUAAACAHj/6APuBDgAFwAdAAAFIi4DNREzERQeAjMyPgI1NxQGBjc1IxEzEQIuUolrSiZUL1yDVGOLVihOesn7BlQYLld+oWACTP3Ec6pvNkV4nFcCueNoGNwDXPvIAAMAeP/oA+4F+gADABsAIQAAASMTMwMiLgM1ETMRFB4CMzI+AjU3FAYGNzUjETMRAlxYYFiOUolrSiZUL1yDVGOLVihOesn7BlQE7AEO+e4uV36hYAJM/cRzqm82RXicVwK542gY3ANc+8gAAAMAeP/oA+4FoAAPACcALQAAASImJjUzFBYzMjY1MxQGBgMiLgM1ETMRFB4CMzI+AjU3FAYGNzUjETMRAjM/aD1OWT0/V049aERSiWtKJlQvXINUY4tWKE56yfsGVAS8Pmc/PVlZPT9nPvssLld+oWACTP3Ec6pvNkV4nFcCueNoGNwDXPvIAAADAHj/6APuBdwABgAeACQAAAE3MxcjJwcTIi4DNREzERQeAjMyPgI1NxQGBjc1IxEzEQE8yFzIZJKSjlKJa0omVC9cg1Rji1YoTnrJ+wZUBOzw8Kqq+vwuV36hYAJM/cRzqm82RXicVwK542gY3ANc+8gAAAQAeP/oA+4FoAADAAcAHwAlAAABNTMVITUzFRMiLgM1ETMRFB4CMzI+AjU3FAYGNzUjETMRAqp4/iB4dFKJa0omVC9cg1Rji1YoTnrJ+wZUBSh4eHh4+sAuV36hYAJM/cRzqm82RXicVwK542gY3ANc+8gAAwB4/oQD7gQ4AAMAGwAhAAABNTMVAyIuAzURMxEUHgIzMj4CNTcUBgY3NSMRMxEB93hBUolrSiZUL1yDVGOLVihOesn7BlT+hICAAWQuV36hYAJM/cRzqm82RXicVwK542gY3ANc+8gAAAMAeP/oA+4F+gADABsAIQAAAQMzEwMiLgM1ETMRFB4CMzI+AjU3FAYGNzUjETMRAiNgWGBNUolrSiZUL1yDVGOLVihOesn7BlQE7AEO/vL6/C5XfqFgAkz9xHOqbzZFeJxXArnjaBjcA1z7yAAAAwB4/+gD7gYjABEAKQAvAAABJzY2FhcWFgYGByc2NicmJgYTIi4DNREzERQeAjMyPgI1NxQGBjc1IxEzEQHjJh5WWSMZCRk1JDRAJBgRMzYzUolrSiZUL1yDVGOLVihOesn7BlQFqzEkIxEuIUtJPRQwI14lGwoW+iUuV36hYAJM/cRzqm82RXicVwK542gY3ANc+8gAAwB4/+gEngTsAA0AJQArAAABMxYGBwYGJzU2Mjc2NgEiLgM1ETMRFB4CMzI+AjU3FAYGNzUjETMRBD9UCxI1JV46FjEZPg796FKJa0omVC9cg1Rji1YoTnrJ+wZUBOxAeCgcBwlGAQYPZ/szLld+oWACTP3Ec6pvNkV4nFcCueNoGNwDXPvIAAQAeP/oBJ4F+gANABEAKQAvAAABMxYGBwYGJzU2Mjc2NiUjEzMDIi4DNREzERQeAjMyPgI1NxQGBjc1IxEzEQQ/VAsSNSVeOhYxGT4O/hZYYFiOUolrSiZUL1yDVGOLVihOesn7BlQE7EB4KBwHCUYBBg9nNwEO+e4uV36hYAJM/cRzqm82RXicVwK542gY3ANc+8gAAAQAeP6EBKAE7AANABEAKQAvAAABMxYGBwYGJzU2Mjc2NgE1MxUDIi4DNREzERQeAjMyPgI1NxQGBjc1IxEzEQRBVAsSNSVeOhYxGT4O/bl4S1KJa0omVC9cg1Rji1YoTnrJ+wZUBOxAeCgcBwlGAQYPZ/nPgIABZC5XfqFgAkz9xHOqbzZFeJxXArnjaBjcA1z7yAAEAHj/6ASeBfoADQARACkALwAAATMWBgcGBic1NjI3NjYlAzMTAyIuAzURMxEUHgIzMj4CNTcUBgY3NSMRMxEEP1QLEjUlXjoWMRk+Dv3dYFhgTVKJa0omVC9cg1Rji1YoTnrJ+wZUBOxAeCgcBwlGAQYPZzcBDv7y+vwuV36hYAJM/cRzqm82RXicVwK542gY3ANc+8gAAAQAeP/oBJ4GIwANAB8ANwA9AAABMxYGBwYGJzU2Mjc2NiUnNjYWFxYWBgYHJzY2JyYmBhMiLgM1ETMRFB4CMzI+AjU3FAYGNzUjETMRBD9UCxI1JV46FjEZPg79nSYeVlkjGQkZNSQ0QCQYETM2M1KJa0omVC9cg1Rji1YoTnrJ+wZUBOxAeCgcBwlGAQYPZ/YxJCMRLiFLST0UMCNeJRsKFvolLld+oWACTP3Ec6pvNkV4nFcCueNoGNwDXPvIAAQAeP/oBJ4FnAANACUAPQBDAAABMxYGBwYGJzU2Mjc2NiUiLgIjIgYXIyY2MzIeAjMyNiczFgYDIi4DNREzERQeAjMyPgI1NxQGBjc1IxEzEQQ/VAsSNSVeOhYxGT4O/oInS0hCHisVCkgSTUUoTEhCHiYcDEgSTOJSiWtKJlQvXINUY4tWKE56yfsGVATsQHgoHAcJRgEGD2c3HSYdOxtFYR0mHTgiQ2f6/C5XfqFgAkz9xHOqbzZFeJxXArnjaBjcA1z7yAD//wB4/+gD7gX6ACYBKwAAACcC2AE4/pgABwLY/9r+mAADAHj/6APuBXwAAwAbACEAAAE1IRUDIi4DNREzERQeAjMyPgI1NxQGBjc1IxEzEQFCAeD0UolrSiZUL1yDVGOLVihOesn7BlQFKFRU+sAuV36hYAJM/cRzqm82RXicVwK542gY3ANc+8gAAwB4/hwD+gQ4ABYALgA0AAABIiYmNTQ2NjcXDgIVFBYzMjY3FwYGASIuAzURMxEUHgIzMj4CNTcUBgY3NSMRMxEDYC9QMUZ0Rj49aUA2Ihs3FjIhUP6lUolrSiZUL1yDVGOLVihOesn7BlT+HDJSMDyBfjdCKGhvMS03IRk4KigBzC5XfqFgAkz9xHOqbzZFeJxXArnjaBjcA1z7yAAEAHj/6APuBjQADwAbADMAOQAAASImJjU0NjYzMhYWFRQGBicyNjU0JiMiBhUUFhMiLgM1ETMRFB4CMzI+AjU3FAYGNzUjETMRAjQ1WDU1WDU2WDQ0WDYvPz8vLUFBJ1KJa0omVC9cg1Rji1YoTnrJ+wZUBLA0WDY1WDU1WDU2WDRUQS0uQEAuLUH65C5XfqFgAkz9xHOqbzZFeJxXArnjaBjcA1z7yP//AHj/6APuBZwAJgErAAAABwLeAEj+mAABACgAAAOUBDgABgAAIQEzAQEzAQGw/nhYAV4BXFr+eAQ4/EIDvvvIAAABACgAAAWoBDgADAAAIQEzAQEzAQEzASMBAQFy/rZYAR4BHlgBHgEgVv62WP7i/uIEOPxYA6j8WAOo+8gDqvxWAAACACgAAAWoBfoAAwAQAAABIxMzAQEzAQEzAQEzASMBAQMbWGBY/ff+tlgBHgEeWAEeASBW/rZY/uL+4gTsAQ76BgQ4/FgDqPxYA6j7yAOq/FYAAgAoAAAFqAXcAAYAEwAAATczFyMnBwMBMwEBMwEBMwEjAQEB8shcyGSSkuT+tlgBHgEeWAEeASBW/rZY/uL+4gTs8PCqqvsUBDj8WAOo/FgDqPvIA6r8VgAAAwAoAAAFqAWgAAMABwAUAAABNTMVITUzFQMBMwEBMwEBMwEjAQEDYHj+IHj+/rZYAR4BHlgBHgEgVv62WP7i/uIFKHh4eHj62AQ4/FgDqPxYA6j7yAOq/FYAAgAoAAAFqAX6AAMAEAAAAQMzEwEBMwEBMwEBMwEjAQECtWBYYP5l/rZYAR4BHlgBHgEgVv62WP7i/uIE7AEO/vL7FAQ4/FgDqPxYA6j7yAOq/FYAAQAUAAAD5gQ4AAsAADMBATMBATMBASMBARQBuP5SaAF4AXZo/lIBuGr+gv6AAiICFv4oAdj96v3eAeT+HAABACj+IAPCBDgACQAAARMXATMBIwEzAQEu0gL+JlwBqEABfFr9yv4gAjSoBIz76AQY+egAAgAo/iADwgX6AAMADQAAASMTMwETFwEzASMBMwECHVhgWP6x0gL+JlwBqEABfFr9ygTsAQ74JgI0qASM++gEGPnoAAACACj+IAPCBdwABgAQAAABNzMXIycHAxMXATMBIwEzAQEUyFzIZJKSStIC/iZcAahAAXxa/coE7PDwqqr5NAI0qASM++gEGPnoAAMAKP4gA8IFoAADAAcAEQAAATUzFSE1MxUDExcBMwEjATMBAnp4/iB4XNIC/iZcAahAAXxa/coFKHh4eHj4+AI0qASM++gEGPnoAAACACj+IAPCBDgAAwANAAABNTMVBRMXATMBIwEzAQKgeP4W0gL+JlwBqEABfFr9yv6EgIBkAjSoBIz76AQY+egAAgAo/iADwgX6AAMADQAAAQMzEwETFwEzASMBMwEB4GBYYP720gL+JlwBqEABfFr9ygTsAQ7+8vk0AjSoBIz76AQY+egAAAIAKP4gA8IGIwARABsAAAEnNjYWFxYWBgYHJzY2JyYmBgMTFwEzASMBMwEBpyYeVlkjGQkZNSQ0QCQYETM2kdIC/iZcAahAAXxa/coFqzEkIxEuIUtJPRQwI14lGwoW+F0CNKgEjPvoBBj56AD//wAo/iADwgWcACYBRQAAAAcC3gAF/pgAAQAoAAADzgQ4AAkAADM1ASE1IRUBIRUoAwz9JAN2/PQC3B4Dwlgi/EJYAAACACgAAAPOBfoAAwANAAABIxMzATUBITUhFQEhFQJnWGBY/WEDDP0kA3b89ALcBOwBDvoGHgPCWCL8QlgAAAIAKAAAA84F3AAJABAAADM1ASE1IRUBIRUBMxc3MwcjKAMM/SQDdvz0Atz9lGSSkmTIXB4Dwlgi/EJYBdyqqvAAAAIAKAAAA84FoAADAA0AAAE1MxUBNQEhNSEVASEVAdh4/dgDDP0kA3b89ALcBSh4ePrYHgPCWCL8QlgA//8APAAABNQFvgAmANwAAAAHANwCQgAA//8APAAABiwFvgAnAVQCQgAAAAYA3AAA//8APAAAA7gFvgAmANwAAAAHAOUCxAAAAAQAPAAAA+oFvgADABQAGAAcAAABNSEVARE0NjY3PgIzMxUjIgYVEQE1IRUBETMRAmoBQP1WCxwZGDtIK4yCXl7+6AJWAQRUA+RUVPwcBLIqRzwbGR4NTFpu+1YD5FRU/BwFvvpC//8AFP/uBTgFZAAmASYAAAAHASYCfgAAAAIAUAIcAh8EVgAgADAAAAEiJjU0Njc2NjcHNiYjIgYHJzY2MzIWFxYWFREjNRcGBicyNjc2NjUXBgYHBgYVFBYBCFtdSD04l0AeBjpQMUoOVRRwW0ppFwsHTw8fa0BIVgoIASJCfC0iMjICHGBBQE0SDxQJK1VRLDIZR1E0NRk7IP6ygRI/P0tKMhpCDQ8KDw0KKSYiNQAAAgBQAhwCWQRWAAsAFwAAASImNTQ2MzIWFRQGJzI2NTQmIyIGFRQWAVR5i452eouMeVRSU1NVUFMCHKB+f52ffX+fVXBZW21vWVtu//8AKAAABJoFoAAGAAEAAAACAIwAAAROBaAAFAAjAAAzESEVIREhMhYXHgIVFAYGBwYGIyUhMjY3NjY1NCYnJiYjIYwDSP0MAb4VLBtomVNTmWgbLBX+QgG+ES8YfYGBfRgvEf5CBaBU/hQDBRB3tWxstXcQBARUBAQYw3l6whgFA///AIwAAAR4BaAABgAYAAAAAQCMAAAD/AWgAAUAADMRIRUhEYwDcPzkBaBU+rQAAgCMAAAD/AdiAAMACQAAASMTMwERIRUhEQHPWGBY/l0DcPzkBlQBDvieBaBU+rQAAQCMAAAEEAZAAAcAADMRITUzFSERjAMwVPzQBaCg9Pq0AAIAUP8QBWAFoAASAB0AABcRMj4CNzYSEjchETMRIzUhFRMhESEGAgIHDgJQXWs1GQoQEgwIA1ZkVPuYhgN+/VAGDRMODCI78AFEX5q5WosBAAERpPq0/rzw8AFEBPiF/vz++Yh4vob//wCMAAAD/AWgAAYAIwAA//8AjAAAA/wHYgAGAC8AAAADAIwAAAP8BwgAAwAHABMAAAE1MxUhNTMVAREhFSERIRUhESEVAp54/iB4/t4DcPzkAqT9XAMcBpB4eHh4+XAFoFT9rlT9rlQAAAEAFAAABsAFoAARAAAzAQEzAREzEQEzAQEjAREjEQEUAr79gnQCeFQCeHT9ggK+dP1IVP1IAvACsP1QArD9UAKw/VD9EALw/RAC8P0QAAEAPP/iBCYFvgA1AAAFIiYmJzceAjMyNjY1NCYmJyYmIiM1MjI2NzY2NTQmIyIGByc2NjMyHgIVFAYHFhYVFAYGAjiQzoEdVhhxrXJ8tGJkrm5KPxQJBUBLFqKwxZmRvEFYQfaxWZ95RXpad4t03R5UjVUkTXZDUZlscH01BAMDVAEBCKSCkJ6PgSKQsjJhkF+BsyYerY9/vmkAAAEAjAAABKAFoAAJAAAhIxEBIxEzEQEzBKBU/JRUVANsVAUM+vQFoPr2BQoAAgCMAAAEoAcIAAkAGQAAMxEzEQEzESMRAQEiJiY1MxQWMzI2NTMUBgaMVANsVFT8lAHKP2c+Tlk9P1dOPWgFoPr2BQr6YAUM+vQGJD5nPz1ZWT0/Zz4AAAIAjAAABKAHYgAJAA0AADMRMxEBMxEjEQEBAzMTjFQDbFRU/JQBomBYYAWg+vYFCvpgBQz69AZUAQ7+8gD//wCMAAAEXAWgAAYASgAAAAIAjAAABFwHYgAKAA4AADMRMxEBMwEBIwERASMTM4xUAsh0/T4DAnT8+AGbWGBYBaD9UAKw/VD9EALw/RAGVAEOAAEAKP/lBMwFoAAZAAAzNRY+Ajc+AhI3IREjESEOAwcOAyg8Sy4hEhEYFBAHA2hU/UQIDhEYEw0jQnNUBxJIln1y1eQBD6z6YAVMf+rm8Yhbo3Qt//8AjAAABfIFoAAGAFEAAP//AIwAAAScBaAABgA6AAD//wA8/+IFSAW+AAYAWAAAAAEAjAAABLAFoAAHAAAzESERIxEhEYwEJFT8hAWg+mAFTPq0//8AjAAABE4FoAAGAG8AAP//ADz/4gUoBb4ABgAZAAD//wAUAAAEiAWgAAYAfQAAAAEAKAAABJoFoAAHAAAhEwEzAQEzAQGikP32WgHcAeJa/WgBNgRq+/QEDPpgAAACACgAAASaBwgADwAXAAABIiYmNTMUFjMyNjUzFAYGAxMBMwEBMwECTj9oPU5ZPT9XTj1o65D99loB3AHiWv1oBiQ+Zz89WVk9P2c++dwBNgRq+/QEDPpgAAADADwAAAUsBaAAGQAkAC8AACE1Bi4CNTQ+Ahc1MxU2HgIVFA4CJxUDESYOAhUUHgI3Fj4CNTQuAgcCim/TqGRkqNNvVG/TqGRkqNNvVGS1i1BQi7W4ZbSLUFCLtGW2EzyW7J2e65Y8E1paEzyW656d7JY8E7YBDAPmDjmExYB/xoI4DQ04gsZ/gMWEOQ7//wAUAAAEZgWgAAYAmwAAAAEAjAAABFoFoAAYAAAhERcGBiMiJiY1ETMRFB4CMzI2NwcRMxEEBipLx4a/5mdUNGuibZDUNCBUArxAMUGI7pgBiP6cdrJ3O1MxdAMu+mAAAQCM/2AFWAWgAAsAAAU1IREzESERMxEzFQUE+4hUA5BUlKCgBaD6tAVM+rT0AAEAjAAABlQFoAALAAAzETMRIREzESERMxGMVAJmVAJmVAWg+rQFTPq0BUz6YAACAIz/YAboBaAABQARAAAFNSM1MxUlETMRIREzESERMxEGlIzg+aRUAmZUAmZUoKBU9KAFoPq0BUz6tAVM+mAAAQCM/xAFAAWgAAsAAAU1IREzESERMxEhFQKc/fBUA8xU/fDw8AWg+rQFTPpg8AAAAgCMAAAETgWgABIAIwAAMxEzESEyFhceAhUUBgYHBgYjJSEyNjc+AjU0JiYnJiYjIYxUAb4VLBtomVNTmWgbLBX+QgG+ES8YU3E6OnFTGC8R/kIFoP3AAwUQd7VsbLV3EAQEVAQEEGSPUVGPZBAFAwAAAv/sAAAEYgWgABQAJQAAMxEjNSERITIWFx4CFRQGBgcGBiMlITI2Nz4CNTQmJicmJiMhoLQBCAG+FSwbaJlTU5loGywV/kIBvhEvGFNxOjpxUxgvEf5CBUxU/cADBRB3tWxstXcQBARUBAQQZI9RUY9kEAUD//8AjAAABS4FoAAmAXoAAAAHAD0EOgAA//8AFP/lCCYFoAAnAXoD2AAAAAYBaewAAAMAjAAAB7oFoAAHABoAKwAAMxEzESEVIREhETMRITIWFx4CFRQGBgcGBiMlITI2Nz4CNTQmJicmJiMhjFQDUPywAxhUAb4VLBtomVNTmWgbLBX+QgG+ES8YU3E6OnFTGC8R/kIFoP3AVPz0BaD9wAMFEHe1bGy1dxAEBFQEBBBkj1FRj2QQBQMA//8APP/iBF4FvgAGAHYAAAABAF//4gVUBb4AIwAABSIkAjc2EiQzMgAXByYkJyYGAgchFSEWFhcWFhcWJDcXDgIC6tb+3ZIFBZMBHNLsAUg2WCr+6tKx84EHAhz95AM1TEvcgcABGDRUIqv6HsgBVNLhAVG8/vvtDsbhAwKf/ua3VHLWZmRcAgPVwBiPz3AAAAEAPP/iBTEFvgAjAAAFIiYmJzcWBDc2Njc2NjchNSEmAiYHBgQHJzYAMzIEEhcWAgQCppn6qyJUNQEXwIHcS000A/3kAhwHgfOx0v7qKlg2AUnr0gEckwUFkf7cHnDPjxjA1QMCXGRm1nJUtwEanwID4cYO7QEFvP6v4dL+rMj//wCgAAAA9AWgAAYAPQAA////2gAAAboHCAAGAEAAAP//AAD/5ALMBaAABgBIAAAAAgAAAAAEWgWgAAMAHAAAETUhFSURJzY2MzIWFhURIxE0LgIjIgYHNxEjEQIc/sQqS8iFv+ZnVDRroW6Q0zUgVAVMVFRU/URAMkCI7pj+eAFkd7F3O1IydPzSBaAAAAMAjP/iBsgFvAAHABsALwAAMxEzESEVIREFIiYmAjU0EjY2MzIWFhIVFAIGBicyPgI3Ni4CIyIOAgcGHgKMVAHU/iwDupDTiENDiNOQkNOIQ0OI05B0rnU8AQI7drF0dK51OwIBOnaxBaD9WlT9Wh5+1QENjo8BC9V9fdX+9Y+W/vLSeFRsu/CDg++6bGy674OD8LtsAAMAUAAABDoFoAAPABMAJAAAISMRIScmJjU0NjY3NjYzIQEjARclESEiBgcOAhUUFhYXFhYzBDpU/doQkKhTmWgbLBUCEvx6ZAE4SAIW/kIQMBhTcTo6cVMYMBACQA4g6JpstXcQBQP6YAKANkoCuAMFEGSPUVGPZBAEBAABAAAAAASUBaAAIQAAMxEjNSEVIRE2NjMyABEUAgYjNTI2NjU0JiYjIgYHBgYVEYyMAhz+vj7mlvUBC2rYpH60YGC+jqDRKRMHBUxUVP42bmb+9f7tqP8AkFR03qCaxF59jUWTRP4k//8AAAAABA4FoAAGAJwAAAABAIwAAARaBaAAGAAAExEnNjYzMhYWFREjETQuAiMiBgc3ESMR4CpLyIW/5mdUNGuhbpDTNSBUBaD9REAyQIjumP54AWR3sXc7UjJ0/NIFoAAAAwA8/+IFSAW+AAMAEwAjAAATNSEVASIkAjU0EiQzMgQSFRQCBCcyNhI1NAImIyIGAgcGEhaCBJz9pNf+4ZCQAR/X1wEfkJD+4de593x897m59XwCAnz5AqZUVP08wAFS3NwBUsDA/q7c3P6uwFSrASzDwwEtqqr+08PD/tSrAAACADz/YAVIBaAABwAOAAAXNSEVIzUhFQEzASMBASM8BQxU+5wCBloCDFr+IP4iWqD09KCgBkD6YAUm+toA//8AFAAABsAFoAAGAWIAAP//AIwAAARcBaAABgBKAAAAAQAKAAAEfAWgAAYAAAEzASMBASMCFloCDFr+IP4iWgWg+mAFJvra//8AUP/iA8QEVgAGAKgAAAACAFD/4gQqBb4AIwAvAAAFIiYCNTQ2Njc2Njc+AzcXDgMHBgYHNjYzMhYWFRQGBicyNjU0JiMiBhUUFgIyldh1ERsOF2BDO5+soT0MNZmpmjdXXQw+2oiT13R34pXGztbAwNDOHn8BDNNVw6owTYcqJy0aEw1QCRQeLiM03ZllcYXxoqLvg1T2zNHx8dHP8wADAIwAAAPUBDgAGQAoADcAADMRITIWFxYWFRQGBwYGBxYXFhYVFAYHBgYjJSEyNjc2NjU0JicmJiMhNSEyNjc2NjU0JicmJiMhjAGeFWUwY2kdHQ0kERsnOzNrUSpbI/5wAZAVSRxLRWpcGDUX/pABchdEG0E9Qj4rWwz+rAQ4BgwZnWAzWyQSHQkGGid5SHCHFwwEVAYGEWtCVnAKAwFUBwkVaj1EZRUPBQAAAQCMAAADXAQ4AAUAADMRIRUhEYwC0P2EBDhU/BwAAgCMAAADXAX6AAMACQAAASMTMwERIRUhEQHPWGBY/l0C0P2EBOwBDvoGBDhU/BwAAQCMAAADXATYAAcAADMRITUzFSERjAJ8VP2EBDig9PwcAAIAPP8QBEIEOAAQABsAABcRMjY3NjYSNyERMxEjNSEVEyERIQ4DBwYGPF9UGxMYEgkCjmRU/KJ0Aob+HAQNERkREiTwAUR2eFPEARTL/Bz+vPDwAUQDkFfIyK49P2IA//8AUP/iBCoEVgAGAMoAAP//AFD/4gQqBfoABgDWAAAABABQ/+IEKgWgAAMABwAlACkAAAE1MxUhNTMVEyImAjU0EjYzMhYSFSM1JiYjIgYVFBYzMjY3FwYGATUhFQK2eP4geHiZ3Xh33Zqb3HVaBs+9wNTUwIbKPEZC8v2qA3AFKHh4eHj6uooBALCxAQCJjP72vBzp+f/n5/9+diiKlgIiVFQAAQAUAAAFCAQ4ABEAADMBATMBETMRATMBASMBESMRARQB8P4gZAHcVAHcZP4gAfBk/hRU/hQCHAIc/eQCHP3kAhz95P3kAhz95AIc/eQAAQA8/+IDkgRWAC0AAAUiJic3FhYzMjY1NCYmIyM1MzI2NTQmIyIGByc2NjMyFhYVFAYHJx4CFRQGBgIUqetERjzGhIqqN4FuoJ5+kqR0bLc5QkvViGihW2lXDFFlLmKtHpiIKHh8g3NHYTJSa2Fvb1hIOF9dSoldZ4YhKAZZfz5gkVEAAQCMAAADsgQ4AAkAAAERIxEBIxEzEQEDslT9fE5UAoQEOPvIA6T8XAQ4/FwDpAAAAgCMAAADsgWgAA8AGQAAASImJjUzFBYzMjY1MxQGBgURIxEBIxEzEQECKj9oPU5ZPT9XTj1oAUlU/XxOVAKEBLw+Zz89WVk9P2c+hPvIA6T8XAQ4/FwDpAAAAgCMAAADsgX6AAMADQAAAQMzEwURIxEBIxEzEQECOWBYYAEhVP18TlQChATsAQ7+8rT7yAOk/FwEOPxcA6QAAAEAjAAAA9AEOAAKAAAzETMRATMBASMBEYxUAhx+/cwCipD9oAQ4/fgCCP3k/eQCCP34AAACAIwAAAPQBfoAAwAOAAABIxMzAREzEQEzAQEjAREB6VhgWP5DVAIcfv3MAoqQ/aAE7AEO+gYEOP34Agj95P3kAgj9+AAAAQAo//EDzAQ4ABYAADM1FjY2NzY2EjchESMRIQ4DBw4CKD0+HAkRGhcMArZU/fQJFBYYDQ4qXFALJVI4Z+8BLML7yAPkhfPUrT9GVx4AAQCMAAAEsAQ4AAwAADMRMwEBMxEjEQEjARGMVgG8AbxWVP5wXP5wBDj8MAPQ+8gDcPyQA3D8kAABAIwAAAPoBDgACwAAMxEzESERMxEjESERjFQCtFRU/UwEOP4OAfL7yAHy/g7//wBQ/+IELARWAAYBAQAAAAEAjAAAA7IEOAAHAAAzESERIxEhEYwDJlT9ggQ4+8gD5Pwc//8AjP4gBDAEVgAGARgAAP//AFD/4gPwBFYABgDAAAAAAQAyAAADogQ4AAcAACERITUhFSERAcD+cgNw/nID5FRU/Bz//wAo/iADwgQ4AAYBRQAAAAIAKP4gA8IFoAAPABkAAAEiJiY1MxQWMzI2NTMUBgYBExcBMwEjATMBAjA/aD1OWT0/V049aP6/0gL+JlwBqEABfFr9ygS8Pmc/PVlZPT9nPvlkAjSoBIz76AQY+egAAAMAUP4+BSQFngAVACAAKwAAAREGJAI1NBIkFxEzETYEEhUUAgQnEQMRJg4CFRQeAjcWPgI1NC4CBwKQnv76nJwBBp5UngEGnJz++p5UUaqSWVmSqqVRqpJZWZKqUf4+AawZeAEMxcUBDnoZAVD+sBl6/vLFxf70eBn+VAIAA7wOJnHFkpLEbyQNDSRvxJKSxXEmDv//ABQAAAPmBDgABgFEAAAAAQBQAAADigQ4ABoAACERBgYjIiYnLgI1NTMVFBYXFhYzMjY3ETMRAzY0qWOi0CAKCAJUBAYVqJdWpTlUAawbLY+HKl1LDt7eKFQmgYkrJwI4+8gAAQCM/2AEkAQ4AAsAAAU1IREzESERMxEzFQQ8/FBUAn5U3qCgBDj8HAPk/Bz0AAEAjAAABTYEOAALAAAzETMRIREzESERMxGMVAHYVAHWVAQ4/BwD5PwcA+T7yAABAIz/YAXeBDgADwAABTUhETMRIREzESERMxEzFQWK+wJUAdhUAdZUqKCgBDj8HAPk/BwD5Pwc9AAAAQCM/xADsgQ4AAsAAAU1IREzESERMxEhFQIQ/nxUAn5U/rLw8AQ4/BwD5PvI8AAAAgCMAAADsAQ4ABEAIAAAMwMzESEyFhceAhUUBgcGBiMlITI2NzY2NTQmJyYmIyGOAlYBJDBMIkh6So1dKlMv/sgBICloJTtjXVMlVin+4AQ4/koEBgxEgGaImBQJBVQEChFfcGxkEAgEAAIAKAAAA9gEOAATACIAADMDIzUzESEyFhceAhUUBgcGBiMlITI2NzY2NTQmJyYmIyG2AoziASQwTCJIekqNXSpTL/7IASApaCU7Y11TJVYp/uAD5FT+SgQGDESAZoiYFAkFVAQKEV9wbGQQCAQAAwCMAAAEVAQ4ABEAIAAkAAAzAzMRMzIWFx4CFRQGBwYGIyczMjY3NjY1NCYnJiYjIwERMxGOAlboMEwiSHpKjV0qUy/85CloJTtjXVMlVinkAx5UBDj+SgQGDUR/ZoiYFAkFVAQKEV9wbGQQCAT90gQ4+8gAAAIAKP/xBiIEOAAkADQAADM1FjY2NzY2EjchETMyFhceAhUUBgcGBiMhAyEOAwcOAiUzMjY3PgI1NCYnJiYjIyg9PRwKEhoWDAJ66B1WK0N7To5cLmQa/rAC/jIJFBYYDQ4qXAMQ5C9fKCVJMF1TLWAX5FALJFI5Z+8BLML+SgIIC0KAZ46TFQoEA+SF89StP0ZXHmMECgovXE9pYxAJAwACAIwAAAXQBDgAGQApAAAzETMRIREzETMyFhceAhUUBgcGBiMhAyERJTMyNjc+AjU0JicmJiMjjFQCCFboHVYrQ3tOjlwuZBr+sAL9+AJe5C9fKCVJMF1TLWAX5AQ4/koBtv5KAggLQoBnjpMVCgQCLv3SVAQKCi9cT2ljEAkD//8AUP/kA7QEVgAGAR8AAAABAFD/4gPwBFYAHgAABSImAjU0EjYzMhYXByYmIyIGByEVIRYWMzI2NxcGBgI8m9x1ctmbnusxUC27esHGCwI2/coMyL53uDFSQ9weiwEAr60BAI2PfSJocvTIVMrybmokgoYAAQBG/+ID5gRWAB4AAAUiJic3FhYzMjY3ITUhJiYjIgYHJzY2MzIWEhUUAgYB+pTcRFIyuHa/xwz9ygI2CsbCebwtUDLrnZvZcnXcHoaCJGpu8spUyPRyaCJ9j43/AK2v/wCL//8AoAAAAPQFoAAGAOUAAAAD/9oAAAG6BaAAAwAHAAsAAAE1MxUhNTMVExEzEQFCeP4geE5UBSh4eHh4+tgEOPvI////7P4gASIFoAAGAPEAAP//AAAAAAQCBaAABgDjAAAAAgCM/+IFjgRWABYAIgAABSImJicjESMRMxEzPgIzMhYSFRQCBicyEjU0AiMiBhUUEgOgmdd1B9RUVNIHeNeWot1xctykz8nLy77UzB6G7pz+DgQ4/g6f7oOR/wCnqv7+kFQBDNzeAQb+5tz+9AADAFAAAAOcBDgAEAAUACQAACERISImJyYmNTQ2NzY2MyETIQEzAQEhESEiBgcOAhUUFhcWFgNG/twwUSNqnI9bLVskAYwC/LQBSmj+sgFyASD+4BxrLSRKMmNPLFcBtgoGFZKFgZwZDAT7yAHg/iACCgHaBA4LNFtEXWsUCgQAAAEAAP6YBAIFoAAtAAABBiYnNRY+AjURNC4CIyIOAhURIxEjNTM1MxUhFSERNjYzMh4DFREUBgOYG0saMTsfCy9cg1Rji1YoVIyMTgEG/vo8xHJSiWtKJjr+nAQFB1IHByNENQKqdKlvNkV4nFf9sgSwVJycVP7aaF4uV36hYPz2UkwAAAEAKP6YA5QEOAAIAAABEQEzAQEzAREBsP54WgFcAV5Y/nj+mAFoBDj8QgO++8j+mAAAAQC0AAAD7gQ4ABoAAAERNjYzMhYXHgIVFSM1NCYnJiYjIgYHESMRAQg1qGOi0R8KCAJUBAYVp5hVpjlUBDj+VBstj4cqXUsO3t4pVCWBiSsn/cgEOAADAFD/4gQsBFYAAwATACAAABM1IRUBIiYCNTQSNjMyFhIVFAIGJzISNTQCIyIGBhUUEpwDVP5OoNxydN2dodxxct2fzMjJy4mzWM0B8lRU/fCSAQKoqgEAjpH/AKer/v+QVAEP2d0BB3zajtz+9AAAAgCM/+IEBgW+AB4AOgAABSImJyYmNRE0Njc+AjMyFhYVFAYHNzYeAhUUBgYnMjY2NTQmJzU+AjU0JiMiBgcGBhURFBYXFhYCSLLcHgcJDw8YXYtecqpeiYcYMoJ5T2bHjWefWuHDTINRmIZdlB0MCAkHG8Aeo3kgTysCkDhjJT9hNlWjdoq4CAoEKV+bb3W8b1ZVlmOcsAZUCkF7YIGXVFonVyz9hitKG11zAAEAUP/kA7QEVgArAAAFIiY1NDY2Nz4CNTQmByIGByc+AjMyFhYVFAYGBw4CFRQWMzI2NxcGBgHuwNxJtaKAkDqrh5DAFFYJdb93drRmRauak5c0rZOQxxtWHPMcp5NTcFQpIDxJM1xyAoNxEFyNT0qEVkhjTyooPks7bH54ZBCHmf//AFD+AgP0BFYABgDdAAAAAQAWAAAFBgWgABEAADMBATMBETMRATMBASMBESMRARYB8P4gZAHaVAHaZP4gAfBk/hZU/hYCHAIc/eYDgvx+Ahr95P3kAhr95gIa/eb//wBQ/noEOgRWAAcBYwAU/pj//wB4/+gD7gQ4AAYBKwAAAAMAeP/oA+4FoAAPACcALQAAASImJjUzFBYzMjY1MxQGBgMiLgM1ETMRFB4CMzI+AjU3FAYGNzUjETMRAjI/aD1OWT0/V049aENSiWtKJlQvXINUY4tWKE56yfsGVAS8Pmc/PVlZPT9nPvssLld+oWACTP3Ec6pvNkV4nFcCueNoGNwDXPvIAAADAHj/6APuBfoAAwAbACEAAAEDMxMDIi4DNREzERQeAjMyPgI1NxQGBjc1IxEzEQJDYFhgbVKJa0omVC9cg1Rji1YoTnrJ+wZUBOwBDv7y+vwuV36hYAJM/cRzqm82RXicVwK542gY3ANc+8gA//8AjAAAA9AFoAAGAPMAAAABACgAAAOUBDgABgAAATMBIwEBIwGwXAGIWv6k/qJYBDj7yAO+/EL//wCMAAAD6AQ4AAYBowAA//8AjAAABAIEUAAGAPsAAP//AIwAAAXkBFYABgD6AAD//wBQAAADigQ4AAYBrQAAAAMAeP9gBIAEOAAFAB0AIwAAITUzFSM1BSIuAzURMxEUHgIzMj4CNTcUBgY3NSMRMxEDoOBU/gJSiWtKJlQvXINUY4tWKE56yfsGVFT0oBguV36hYAJM/cRzqm82RXicVwK542gY3ANc+8gAAAMAeP/iBdAEOAARABcAKQAAEwMUFjMyNjY1MxYGBiMiJjUTIREjNSMRIQMUFjMyNjUXFAYGIyImJjUTzgKfc0CDWUoFXahsmccCBVZOBv3SApt7fpxKXqVrW6BjAgQ4/RiHmzqKeHewYcCoAu77yNwDXP0mi6WskCBoo11Non8C6AAEAHj/YAZiBDgABQAXAB0ALwAAITUzFSM1AQMUFjMyNjY1MxYGBiMiJjUTIREjNSMRIQMUFjMyNjUXFAYGIyImJjUTBYLgVPrAAp9zQINZSgVdqGyZxwIFVk4G/dICm3t+nEpepWtboGMCVPSgBDj9GIebOop4d7BhwKgC7vvI3ANc/SaLpayQIGijXU2ifwLo//8AjAAAA7AEOAAGAbIAAAADAIz/4gWOBaAAAwAaACYAADMRMxEFIiYmJyMRIxEzETM+AjMyFhIVFAIGJzISNTQCIyIGFRQSjFQCwJnXdQfUVFTSB3jXlqLdcXLcpM/Jy8u+1MwFoPpgHobunP4OBDj+Dp/ug5H/AKeq/v6QVAEM3N4BBv7m3P70//8AUP/iBCoFvgAGAZEAAP//ACgAAASaBaAABgABAAD//wCMAAAEeAWgAAYAGAAA//8AjAAAA/wFoAAGAVsAAAACACgAAASaBaAAAwAKAAAzNSEVATMBIwEBI24D5v3gWgIMWv4g/iJaVFQFoPpgBSb62gD//wCMAAAD/AWgAAYAIwAA//8AZAAABCYFoAAGAKQAAP//AIwAAAScBaAABgA6AAAAAwA8/+IFSAW+AAMAEwAjAAABNSEVAyIkAjU0EiQzMgQSFRQCBCcyNhI1NAImIyIGAgcGEhYB0gHg8Nf+4ZCQAR/X1wEfkJD+4de593x897m59XwCAnz5AqZUVP08wAFS3NwBUsDA/q7c3P6uwFSrASzDwwEtqqr+08PD/tSrAP//AKAAAAD0BaAABgA9AAD//wCMAAAEXAWgAAYASgAAAAEACgAABHwFoAAGAAABMwEjAQEjAhZaAgxa/iD+IloFoPpgBSb62v//AIwAAAXyBaAABgBRAAD//wCMAAAEoAWgAAYAUgAAAAMAjAAABLAFoAADAAcACwAAEzUhFQE1IRUBNSEVjAQk+9wEJPxAA1wFTFRU+rRUVAKmVFQA//8APP/iBUgFvgAGAFgAAP//AIwAAASwBaAABgFtAAD//wCMAAAETgWgAAYAbwAAAAEAjAAABJwFoAAMAAAzNQEBNSEVIQEVASEVjAJ2/YoEEPx+Amb9mgNcUAKAAnxUVP2UIP2UVAD//wAUAAAEiAWgAAYAfQAA//8AAAAABA4FoAAGAJwAAP//ADwAAAUsBaAABgFzAAD//wAUAAAEZgWgAAYAmwAAAAEAjAAABNgFoAAlAAAhES4CJyYmNREzERQWFxYWFxEzETI2NzY2NREzERQGBw4CBxECiHm5gCQcClQFDyPSn1Sf0yIPBVQJHSSCuXcBdgNWkVpIbh4CEv5WJXw/kL4CA9r8JsCQP3wlAar97h5uSFuRVgL+igABADwAAAVIBbwAKgAAMzUhJgI1NBI2NjMyFhYSFRQCByEVITc2NhI3Ni4CIyIOAhUUHgIXFTwBOo6sVqbwmprwplarjwE4/jwCTqRzBQRJkdGFg86QS0RufjpUbAFQ3pgBBsNtbcP++pje/rBsVFQprAEAp4XvuWtpt+uDgtSjbx5UAP//ACgAAASaBaAAJgABAAAABwLY/xP+Pv//ACgAAATsBaAAJwAjAPAAAAAHAtj+sf4+//8AKAAABY4FoAAnADoA8gAAAAcC2P6x/j7//wAoAAABzwWgACcAPQDbAAAABwLY/rH+Pv//AET/4gX6Bb4AJwBYALIAAAAHAtj+zf4+//8AUAAABVgFoAAnAJwBSgAAAAcC2P7Z/j7//wBEAAAF8gW8ACcB7wCqAAAABwLY/s3+PgAD/9oAAAG6BwgAAwAHAAsAAAE1MxUhNTMVExEzEQFCeP4geE5UBpB4eHh4+XAFoPpgAAMAAAAABA4HCAADAAcAEAAAATUzFSE1MxUTEQEzAQEzARECgHj+IHhO/iJgAagBpmD+JAaQeHh4ePlwAmQDPP0kAtz8xP2cAAIAUP/iBBwEVgAUACQAAAUiJgI1NBI2MzIWFwcRMxEjERcGBicyNjY1NCYmIyIGBhUUFhYCJpnRbGvSm7brGRROThQZ77R/q1ZXq36BqVJWqR6XAQKhoAECmNa6NgGo+8gBrDa911SA3YuN23x/24qL3YAAAgCM/iAEBAW+ABwAOAAAExE0Njc+AjMyFhYVFAYHHgMVFAYGIyImJxEBMjY2NTQmJzU+AjU0JiMiBgcGBhURFBYXFhaMDw0YXYtecqpeaGg0dmhCZseRe7U4AWxnn1rhw0yDUZiGXZQdDAgJBxvA/iAGGDNbIj9hNlWjdniuGgQzYJJldbxvUUP9qgIYVZZjnLAGVApBe2CBl1RaJ1cs/YYrShtdcwD//wAo/pgDlAQ4AAYBwQAAAAMAUP/kBCwFvgAQABwANwAABSImJjU0NjYXNTIWFhUUBgYnMjY1NCYjIgYVFBYBLgM1NDY2NzY2MyEVISIGBwYGFRQeAhcCPqDccnbdm6HccXLdn8vJycvNx80BVT2lm2cmSjYkQQ0BkP6CGzIVNEI7caNnHIXunaDygggOh/Cdn/CHVPnNzPD4yM31A3oVKT9qVTFPNw0JA0wFBQw8MitCNzYgAAABAFD/4gOmBFYALQAABSImJjU0NjY3ByYmNTQ2NjMyFhcHJiYjIgYVFBYzMxUjIgYGFRQWMzI2NxcGBgHOb6xjL2RRDFdpW6FoidRLQjm3bHOlkn6eoG6BN6qKhMY8RkPrHlGRYD5/WQYoIYZnXYlKXV84SFhvb2FrUjJhR3ODfHgoiJgAAAEAUP8QA7oFoAAsAAAFNi4CIyIuAjU0NjY3PgI3ITUhFQ4EBw4CFRQWFjMyFhYXHgIHA1oHGUmAYVCjiFMpfoEbhbZm/VgDICppcGlVGXqBL1q0iAc5SR8/ZDEO8FNgLw4PQI1+QpPEixyMvmhUVCxtc2xYGoC0i0NpdjEBBAUKQIFr//8AjAAABAIEUAAGAPsAAAADAFD/4gSsBbwAAwAXACsAABM1IRUBIiYmAjU0EjY2MzIWFhIVFAIGBicyPgI3Ni4CIyIOAgcGHgKAA/r+BJDTiENDiNOQkNOIQ0OI05B0rnU8AQI7drF0dK51OwIBOnaxAqZUVP08ftUBDY6PAQvVfX3V/vWPlv7y0nhUbLvwg4Pvumxsuu+Dg/C7bAAAAQCg//ICSAQ4ABYAAAUmJicmJjURMxEUFhcWFhcWNjcVBgYiAYpGaR0YBlQBFRdDMC1fKCBCPwoJQj01bUYC0v0uRlQqKykGBAMJUAcHAP//AIwAAAPQBDgABgGfAAAAAQBQAAADvAW+ABMAADMBLgIjIzUzMhYXHgIXASMBAVABiCc2VVQyPBUyE0dZPiABiFr+pP6iBDhnjEdMAwUPcqRZ+8gDvvxCAAABAIz+IAQCBDgAGQAAExEzERQeAjMyPgI1ETMRIzUGBiMiJicRjFQvXINUY4tWKFROPMRyebc4/iAGGP3Ec6pvNkV4nFcCTvvIrmdfY139eAD//wAoAAADlAQ4AAYBPgAAAAEAUP8QBDkFvgA5AAAFNiYmIyImJjU0NjcmJjU0PgIzMhYXByYmIyIGFRQWFxYWMjMVIiIGBw4CFRQWFjMyFhYXHgIHA9gJOJmI1PlrjHZedkV5nFi58UJYQreblMSyoBdLPwUJFD9Kb61kdOWpB0BRIDxmMw/wcmUZa7t4lrAeKq15XIlaLbKQIoGPi4+ElggBAVQDAwUzfnR5mEcBBAUJP4JsAP//AFD/4gQsBFYABgEBAAAAAQAoAAAE2AQ4AAsAACERIzUhFSMRIxEhEQEY8ASw8FT92APkVFT8HAPk/BwAAAIAjP4gBCgEVgAUACQAABMRNDY3PgIzMhYSFRQCBiMiJicRATI2NjU0JiYjIgYGFRQWFowDAQluxIuaz2lsz5WFwzABcn2pVlOogX6kUE+k/iADwjZMFonXfJf+/p+i/v2XeGD9ZgIWgN2Litt/e9qNjN6AAAABAFD/EAPwBFYAJgAABTYmJicuBDU0EjYzMhYXByYmIyIGBgcGHgIzMhYWFx4CBwNaCjmSe4OqZC8OctmbnOo0UC28fYWxWQEBGUuVfBhHSx5AZDAO8HNhFwUFT3eHgC7BAQuKi4EiaHJ/3Is7nJRhAQQFCkGBagACAFD/4gRoBDgAFQAiAAAFIiYmNTQ2Njc2NjMhFSE3FhIVFAYGJzISNTQCJyYGBhUUEgI+mN54ZLmBJFgkAdr+nCx1h3jemMbOzsaGtFrUHo77o5bqkhIFAVQcPP74rqP7jlQBBdPRAQQBAXvVh9b+/gABADL/8gOiBDgAGgAABSYmJyYmNREhNSEVIREUFhcWFhcWNjcVBgYiAqpGaR0YBv5yA3D+cgEVF0MwLV8oIEFACglCPTVtRgJ+VFT9gkZUKispBgQDCVAHBwABAHj/6APkBDgAGwAAExEzERQeAjMyPgI1ETMRFA4DIyIuA3hUL1yDVFSDXC9UJkpriVJSiWtKJgHsAkz9xHOqbzY2b6pzAjz9tGChflcuLld+of//AFD+PgUkBZ4ABgGrAAD//wAUAAAD5gQ4AAYBRAAAAAEAeP4+BMQEOAAnAAABES4CJyYmNREzERQWFx4CFxEzET4CNzY2NREzERQGBw4CBxECdHS6hCQcClQFDxd2p2BUYKd2Fw8FVAkdIoG7eP4+AaQDV5FZSHAcAj7+KiKAPmCXWAEEBvv6AViXYD6AIgHW/cIccEhUkVwD/lwAAAEAUP/gBaQEVgAvAAAFIiYmNTQSNxcGAhUUFhYzMjY2NREzERQWFjMyNjY1NAInNxYSFRQGBiMiJiczBgYB1oWtVLbKLLWdQYZnaGslVCRraWmFQJ+zLM6yVqyCdqwUIBOsIH/ileABOWdOXf7zwHnBcGKgXAEe/uJZoGVzwXbDAQxbTmn+xt2X4n1/hYV/AAIAoP/yAkgF+gADABoAABMjEzMTJiYnJiY1ETMRFBYXFhYXFjY3FQYGIvpYYFgwRmkdGAZUARUXQzAtXyggQj8E7AEO+fwJQj01bUYC0v0uRlQqKykGBAMJUAcHAAAD/9r/8gJIBaAAAwAHAB4AAAE1MxUhNTMVASYmJyYmNREzERQWFxYWFxY2NxUGBiIBQnj+IHgBOEZpHRgGVAEVF0MwLV8oIEI/BSh4eHh4+s4JQj01bUYC0v0uRlQqKykGBAMJUAcH////1P/yAkgF+gAmAgEAAAAHAuP+kgAAAAIAeP/oA+QF+gADAB8AAAEjEzMBETMRFB4CMzI+AjURMxEUDgMjIi4DAkFYYFj911QvXINUVINcL1QmSmuJUlKJa0omBOwBDvvyAkz9xHOqbzY2b6pzAjz9tGChflcuLld+oQADAHj/6APkBaAAAwAHACMAAAE1MxUhNTMVAREzERQeAjMyPgI1ETMRFA4DIyIuAwKmeP4geP7CVC9cg1RUg1wvVCZKa4lSUolrSiYFKHh4eHj8xAJM/cRzqm82Nm+qcwI8/bRgoX5XLi5XfqEA//8AeP/oA+QF+gAmAg0AAAAGAuPVAP//AFD/4gQsBfoABgECAAAAAgBQ/+AFpAX6AAMAMwAAASMTMwEiJiY1NBI3FwYCFRQWFjMyNjY1ETMRFBYWMzI2NjU0Aic3FhIVFAYGIyImJzMGBgMbWGBY/luFrVS2yiy1nUGGZ2hrJVQka2lphUCfsyzOslasgnasFCATrATsAQ755n/ileABOWdOXf7zwHnBcGKgXAEe/uJZoGVzwXbDAQxbTmn+xt2X4n1/hYV/AAMAUP/iBBwF+gADABgAKAAAASMTMwMiJgI1NBI2MzIWFwcRMxEjERcGBicyNjY1NCYmIyIGBhUUFhYCaVhgWKOZ0Wxr0pu26xkUTk4UGe+0f6tWV6t+galSVqkE7AEO+eiXAQKhoAECmNa6NgGo+8gBrDa911SA3YuN23x/24qL3YAAAAIAUP/iA6YF+gADADEAAAEjEzMDIiYmNTQ2NjcHJiY1NDY2MzIWFwcmJiMiBhUUFjMzFSMiBgYVFBYzMjY3FwYGAgJYYFiUb6xjL2RRDFdpW6FoidRLQjm3bHOlkn6eoG6BN6qKhMY8RkPrBOwBDvnoUZFgPn9ZBighhmddiUpdXzhIWG9vYWtSMmFHc4N8eCiImP//AIwAAAQCBfoABgD8AAAAAgCM/+ID+AW+ABEAIwAABSImJjURNDY2MzIWFhURFAYGJzI2NjURNCYmIyIGBhURFBYWAkJ4x3d3x3h4x3d3x3hhoWBgoWFhoWBgoR53x3gCcHjHd3fHeP2QeMd3VGChYQJwYaFgYKFh/ZBhoWAAAAEAeAAAAdwFoAAGAAAhEQU1JTMRAYj+8AEQVAU+omKi+mAAAAEAZAAAA+4FvgAeAAAzNwE2NjU0JiYjIgYGFSM0NjYzMhYWFRQGBgcBJyEVZAIColw2YqRkZ6RfVHnKe37KdiNNPv1gGANmVAJmU5laZKRiZKVhe8t4e8t4UoZ0OP2cPFQAAQBQ/+IDtAWgACIAAAUiJiYnNxYWNz4CNTQmIyIGBycBFyE1IRUBJzYEFhUUBgYB/mqseh5OLLp4cZxRwaErZSoyAmIa/QIDHv3WAqIBAZVuxR5GhV0ceXoDA16ncq7KGBREAko+VFb98DImXOOjjNByAAABAGQAAAQeBaAADgAAIREhNQEzASERMxEzFSMRAx79RgHwXP4QAl5UrKwBMlQEGvvmAcL+PlT+zgAAAQBk/+IEFAWgACYAAAUiJiYnNx4CMzI2NjU0JiYjIgYHJxMhFSE3Ayc2NjMyFhYVFAYGAjRyvoQcUBd0nldxs2hutGpyrjZWLAL4/R4+LCBBxHOD2oOC2h5do2gWW4VIbbRrcLNpbFoyAuRUOv04LlRkgtqEgtuFAAACAIz/4gRMBb4AIAAwAAAFIiYmNRE0NjYzMhYXByYmIyIGBhURJzY2MzIWFhUUBgYnMjY2NTQmJiMiBgYVFBYWAmyE2oKB2oWE3T1IM7VucbNoID/ii4TagoLahG60amq0bm60amq0HoLahAIchNqChGwqWW1utGr+lCZ1lYLahITaglRqtG5utGpqtG5utGoAAAEAUAAAA14FoAAGAAAzASE1IRUB3AIo/UwDDv3YBUpWVvq2AAMAeP/iA+YFvgAdACkANQAABSImJjU0NjcVJiY1NDY2MzIWFhUUBgcnFhYVFAYGJzI2NTQmIyIGFRQWEzI2NTQmIyIGFRQWAi6CxW+Pl4KEabd2drdpf4MImJRwxoKcwr+fn7/CnI2vr42Nr68eZryCkNUxLhvHeHanWVmndnjFGywx1ZCCvGZUrqKlq6uloq4C9JGNjY+PjY2RAAIAjP/iBEwFvgAgADAAAAEyFhYVERQGBiMiJic3FhYzMjY2NREXBgYjIiYmNTQ2NhciBgYVFBYWMzI2NjU0JiYCbITagoHahYTcPkgztm1xs2ggP+GMhNqCgtqEbrRqarRubrRqarQFvoLahP3khNqChGwqWG5utGoBbCZ1lYLahITaglRqtG5utGpqtG5utGoAAgC6/+IEJgW+ABEAIwAABSImJjURNDY2MzIWFhURFAYGJzI2NjURNCYmIyIGBhURFBYWAnB4x3d3x3h4x3d3x3hhoWBgoWFhoWBgoR53x3gCcHjHd3fHeP2QeMd3VGChYQJwYaFgYKFh/ZBhoWAA//8BbAAAAtAFoAAHAh4A9AAA//8ApgAABDAFvgAGAh9CAP//AKb/4gQKBaAABgIgVgD//wCgAAAEWgWgAAYCITwA//8AlP/iBEQFoAAGAiIwAP//AIz/4gRMBb4ABgIjAAD//wDuAAAD/AWgAAcCJACeAAD//wC2/+IEJAW+AAYCJT4AAAIAjP/iBEwFvgAgADAAAAEyFhYVERQGBiMiJic3FhYzMjY2NREXBgYjIiYmNTQ2NhciBgYVFBYWMzI2NjU0JiYCbITagoHahYTcPkgztm1xs2ggP+GMhNqCgtqEbrRqarRubrRqarQFvoLahP3khNqChGwqWG5utGoBbCZ1lYLahITaglRqtG5utGpqtG5utGr//wCM/+gC0AOWAAcCOwAA/eT//wB4AAABdAOEAAcCPAAA/eT//wBkAAACrAOYAAcCPQAA/eT//wBQ/+wCgAOEAAcCPgAA/eT//wBkAAACxAOEAAcCPwAA/eT//wBk/+wCuAOEAAcCQAAA/eT//wCM/+YC8AOWAAcCQQAA/eT//wBQAAACTgOEAAcCQgAA/eT//wB4/+YCtAOWAAcCQwAA/eT//wCM/+YC8AOWAAcCRAAA/eQAAgCMAgQC0AWyABEAHwAAASImJjURNDY2MzIWFhURFAYGJzI2NRE0JiMiBhURFBYBrlKDTU2DUlKDTU2DUlZ6elZVe3sCBE2DUgFqUoNNTYNS/pZSg01Qe1UBcFZ4eFb+kFV7AAEAeAIcAXQFoAAGAAABEQc1NzMRASKqqlICHAMoZlxm/HwAAAEAZAIcAqwFtAAdAAATNwE2NjU0JiMiBgYXIzQ2NjMyFhYVFAYGBwEnIRVkAgGaNiJ2VjteNgFUTYNSUoJMGzcq/nAYAiQCHEwBdjBYMFd5Ol42UYFKTYJPN1RJJv6UPFAAAQBQAggCgAWgACAAAAEiJic3FhY3NjY1NCYjIgYHJwEXITUhFQEnNhYWFRQGBgFkY5QdThhrQ19pblwZNxoqAYAY/g4CBP6qBGigWkiAAghpWxhGRwECdF5gdA0LQAFoPk5Q/rw2Fj2NYleDSgABAGQCHALEBaAADgAAATUhNQEzASERMxEzFSMVAg7+VgEwXP7QAU5SZGQCHLJQAoL9fgEM/vRQsgAAAQBkAggCuAWgACMAAAEiJic3FhYzMjY1NCYmIyIGBycTIRUhNwMnNjYzMhYWFRQGBgGIap8bThR6SF9/PWU8QGEdTBoB4P5CJhYgJnhIUoZQU4oCCH9jFEtZglo+ZTs7LyQB0k4g/kwuODxQh1NSiVMAAgCMAgIC8AWyACAALAAAASImJjURNDY2MzIWFwcmJiMiBgYVFSc2NjMyFhYVFAYGJzI2NTQmIyIGFRQWAb5Vi1JSjFhQhipCHmQ8QWY7ICaKVFSIUFOLVF2BgV1dgYECAlOMVwFAWo5SSD40MDo/aD3uJktbUIdTVIpSUINdXICAXF2DAAABAFACHAJOBaAABgAAEwEhNSEVAaYBUP5aAf7+sgIcAzRQUPzMAAMAeAICArQFsgAbACcAMwAAASImJjU0NjcVJiY1NDYzMhYVFAYHNxYWFRQGBicyNjU0JiMiBhUUFhMyNjU0JiMiBhUUFgGWVIFJX2FVVZVzdJRVWQJiYEmBVFltbFpabnBYUGJiUE5iYgICQ3lSXYkeNBd9THKAgHJMfhIyIYhdUnlDUGNbX2FhX1tjAc5RT1BQUFBPUQAAAgCMAgIC8AWyACAALAAAATIWFhURFAYGIyImJzcWFjMyNjY1NRcGBiMiJiY1NDY2FyIGFRQWMzI2NTQmAb5Vi1JSjFhPhypCHmQ8QWY7ICWLVFSIUFOLVF2BgV1dgYEFslKNV/7AWo5SST00MDo/aD3uJktbUIdTVIpSUINdW4GBW12DAAAB/nAAAAL+BaAAAwAAIScBF/66SgRGSDwFZDr//wB4AAAGfgWgACYCPAAAACcCRQJkAAAABwI9A9L95P//AHgAAAZYBaAAJgI8AAAAJwJFAmQAAAAHAj8DlP3k//8AUAAABu4FoAAmAj4AAAAnAkUC+AAAAAcCPwQq/eQAAQCgAAABGAB4AAMAADM1MxWgeHh4AAEAeP9CAPAAtAALAAAXNxY2NjUjNTMVFAZ4BiMYAUJ4SLI0AiU7ILTwQkD//wDcALQBVAOEACcCSQA8ALQABwJJADwDDP//ANz/QgFUBDgAJgJKZAAABwJJADwDwP//AKAAAAPoAHgAJgJJAAAAJwJJAWgAAAAHAkkC0AAAAAIA8AAAAUQFoAADAAcAADM1MxUDETMR8FRUVICAAWgEOPvIAAIA8P6YAUQEOAADAAcAABMzFSMVMxEj8FRUVFQEOIDo+8gAAAIAZAAAA4wFvgAtADEAAAE0Njc+Ajc2NjU0JicmJiMiBgcGBhUjNDY3NjYzMhYXFhYVFAYHDgIHBgYVAzUzFQG0ByEgZmomJhogIDCHR0yBKSUhVCsxPKdVWqM5MiwtLyRpYhkZAVpaAYpUcT88U0YpLF8zPmAiOCgtLSVnOEKJMz42Nj40gU1Fgi8nR04wMGVH/naWlgAAAgBk/noDjAQ4AC0AMQAAARQGBw4CBwYGFRQWFxYWMzI2NzY2NTMUBgcGBiMiJicmJjU0Njc+Ajc2NDUTFSM1AjwHISBmaiYlGyEfMIhGTYEoJiBUKjI8plZaozkxLS4uJGliGRpaWgKuVHE/PFNGKStgMz1gIzcpLS0mZzdCiTM9Nzc9NYFMRYMuJ0hNMDBmRgGKlpYAAQB4AiYBGALGAAsAABMiJjU0NjMyFhUUBsoiMDAiIC4uAiYuIiMtLSMiLgABAaQBrgM0Az4ADwAAASImJjU0NjYzMhYWFRQGBgJwOVw3N1w5NVk2NlkBrjRbOTlbNDRbOTlbNAAAAQA8Ay4CzAWgAA4AABMnNyU3BREzESUXBRcHJ+JEov78GgEEVAEEGv78oESgAy4y3lRQVAES/u5UUFTeMt4AAAIAeAAABqoFoAAbAB8AACETITchEyE3IRMzAyETMwMhByEDIQchAyMTIQMTIRMhAbJ6/kwWAbZk/kwWAbZyWHQBinJYdAG0Fv5MZgG0Fv5MfFZ6/nh8kgGKZP54Ac5UAXpUAbD+UAGw/lBU/oZU/jIBzv4yAiIBegAAAQB4AAACUgWgAAMAAAEzASMB+Fr+gFoFoPpgAAEAeAAAAlIFoAADAAATASMB0gGAWv6ABaD6YAWg//8A3AEsAVQEdAAnAkkAPAEsAAcCSQA8A/wAAgDwAAABRAWgAAMABwAAEzMVIxUzESPwVFRUVAWggOj7yAAAAgBk/+IDjAWgAC0AMQAAARQGBw4CBwYGFRQWFxYWMzI2NzY2NTMUBgcGBiMiJicmJjU0Njc+Ajc2NDUTFSM1AjwHISBmaiYlGyEfMIhGTYEoJiBUKjI8plZaozkxLS4uJGliGRpaWgQWVHE/PFNGKStgMz1gIzcpLS0mZzdCiTM9Nzc9NYFMRYMuJ0hNMDBmRgGKlpb//wB4AoABGAMgAAYCUgBaAAEBGP6oAtYGgAARAAABJgICNTQSEjcXBgICFRQSEhcCmHasXl6sdj5ypFhapHD+qIYBRgFouLgBaAFGhjSG/sn+sKuo/qz+xoAAAQBa/qgCGAaAABEAABMnNhISNTQCAic3FhISFRQCApg+cKRaWKRyPnasXl6s/qg2gAE6AVSoqwFQATeGNIb+uv6YuLj+mP66AAABARj+RALFBuQAJAAAASImNRE0JycmNDc3NjURNDYzMxUjIgYVERQHBxcWFREUFjMzFQJZV3sWUgcHUhZ7V2xsNEomQEAmSjRs/kR7VQKuJSNyCxsKciMlAqxXe1RJNf1UQzVaWjVD/VIzSVQAAAEAWv5EAggG5AAkAAATIzUzMjY1ETQ3NycmNRE0JiMjNTMyFhURFBcXFhQHBwYVERQGxmxsNUkmQEAmSTVsbFd7FlIICFIWe/5EVEkzAq5DNVpaNUMCrDVJVHtX/VQlI3IKGwtyIyX9UlV7AAEBGP5EAmQG5AAHAAABESEVIxEzFQEYAUz4+P5ECKBU+AhUAAEAtP5EAgAG5AAHAAABITUzESM1IQIA/rT4+AFM/kRUB/hU//8BGP7kAtYGvAAGAlwAPP//AFr+5AIYBrwABgJdADz//wEY/oACxQcgAAYCXgA8//8AWv6AAggHIAAGAl8APP//ARj+gAJkByAABgJgADwAAQC0/oACAAcgAAcAAAEhNTMRIzUhAgD+tPj4AUz+gFQH+FQAAQB4AkwC0AKgAAMAABM1IRV4AlgCTFRUAP//AHgCTALQAqAABgJoAAAAAQB4AkwDwAKgAAMAABM1IRV4A0gCTFRUAAABAHgCTAWgAqAAAwAAEzUhFXgFKAJMVFQA//8AeAJMAtACoAAGAmgAAP//AAD/QAUo/5QABwJr/4j89P//AHgCpgLQAvoABgJoAFr//wB4AqYDwAL6AAYCagBa//8AeAKmBaAC+gAGAmsAWv//AHj/QgDwALQABgJKAAD//wCg/0IB4AC0ACYCSigAAAcCSgDwAAAAAgCgBEoB4AW8AAsAFwAAAQcmBgYVMxUjNTQ2BwcmBgYVMxUjNTQ2AeAGIxgBQnhImAYjGAFCeEgFsDQCJTsgtPBCQAw0AiU7ILTwQkD//wCgBEIB4AW0ACcCSgAoBQAABwJKAPAFAAABAHgELgDwBaAACwAAEwYmNTUzFSMUFhY38DBIeEIBGCMEOgxAQvC0IDslAgD//wB4BC4A8AWgAAcCSgAABOwAAgCgBEIB4AW0AAsAFwAAAQYmNTUzFSMUFhY3BwYmNTUzFSMUFhY3AeAwSHhCARgjwjBIeEIBGCMETgxAQvC0IDslAjQMQELwtCA7JQIAAgCgAHADYAPKAAUACwAAJQEBFwEBBQEBFwEBAyL+qgFWPv7QATD+lv6qAVY+/tABMHABrgGsMP6E/oIwAa4BrDD+hP6CAAIAjABwA0wDygAFAAsAADcnAQE3AQMnAQE3Aco+ATD+0D4BVio+ATD+0D4BVnAwAX4BfDD+VP5SMAF+AXww/lQA//8BGACoAx4ERAAGAqcAAAABAZAAqAOWBEQABQAAJScBATcBAcg4AZj+aDgBzqg2AZgBmDb+MgD//wB4BDgB5AWgACYCfQAAAAcCfQEYAAAAAQB4BDgAzAWgAAMAABMRMxF4VAQ4AWj+mP//AKABJANgBH4ABwJ4AAAAtP//AIwBJANMBH4ABwJ5AAAAtP//ARgBAgMeBJ4ABgKnAFr//wGQAQIDlgSeAAYCewBa//8AeAJMA8ACoAAGAmoAAP//ARgAqAasBEQABgK8AAD//wB4AiYBGALGAAYCUgAA//8A3P9CAVQEOAAmAkpkAAAHAkkAPAPA//8AoP/2BgAFVgAGAsdkAAACAif/4gb+BFYAFgAnAAAFIicBJiY+AjMyFzY2MzIeAgYHAQYnATY2JiYjIgYHJiMiBgYWFwSUKRf+QkItHVuQW4SGPoZCXZBcGy5C/kIXJQG+QBg8flY/hkGOfFd8Ohk+HhoB1ketq45Xbjg2WJCrq0b+KhpUAdZErJ9nRkiOaKCrQwAHAIz/PAR4BmgAAwAHAAsADwAhACwANgAABTUzFQM1MxUTNTMVAzUzFQERITIWFhUUBgcnFhYVFAYGIyUhMjY2NTQmJiMhNSEyNjY1NCYjIQFgVFRUvlRUVP3GAiJosGqEbASPrXC/df4MAcxop2FZlVr+DAHOUYdQq33+MsTe3gZM4OD5tN7eBkzg4Pp4BaBZoGlyvycwLsuZe61cVEaEXl6ZW1JOhFJ4kgAAAQBQ/8QD8AWgACIAAAU1LgInPgI3NTMVFhYXByYmIyIGBgcWEjMyNjcXBgYHFQIWlMhnAwNoyJNUh9EuUC27eoiyWAIDysd3uDFSP8SDPLYJlPmipvmQCba2Cox0Imhye9uQ3P72bmokeIUJtgAGADwAoASgBQAAEwAXABsAHwAvADMAACUiLgI1ND4CMzIeAhUUDgIFJzcXAyc3FwEnNxclMjY2NTQmJiMiBgYVFBYWASc3FwJubL6QUlKQvmxtvpFSUpG+/Z08wDw6wjzAAyzAPMD9znrJd3rJd3rIdnbIAeo6wDzEUpG+bWy+kFJSkL5sbb6RUiQ8wDwCpMI6wPxgwDzAPHnId3rJd3fJenfIeQLsPMA6AAMAPP88BCoGaAADAAcANAAABTUzFQM1MxUDIiYmJzcWFjMyNjU0JiclJDU0NjYzMhYWFwcuAiMiBgYVFBYXBRYWFRQGBgIKVFRUEIrdkhlQJPKstNiCnv7S/uZxyIOH1ogRUA5ytHBpol2BiwEepZN11sTe3gZM4OD6Wl+udxCUrLGTb4MwXlnvcKthaL1/EGmfWEuFVl6ALFgzqo97tWQAAAUAUAAABIgFvgARACEAJwArAC8AACUiLgI1ND4CMzIWFhUUBgYnMjY2NTQmJiMiBgYVFBYWBREjETMRBTUhFQE1IRUCJm2uekFAeKdnn81kY8aXf6tWV6t+eapZXKsB9QZU/JgDlf6HAeDSP3enZ2amdT9qyI6Ky29UXaZtb6RZVqJ0cqVZNgJiAmz7MvBUVATsVFQAAAMAPP/iBJQFvgAcACAAJAAABSIkAjc2EiQzMhYXByYmJyYGAhUUEhYXFjcXBgYBNSEVATUhFQNY1P7ckwUFkwEc0lShRS49iEe59nt69rqPfy5FofyOA278kgNuHsYBVNThAVG8JCZKHh8BAqr+08PI/tamAgNBSCUlAiRUVAE8VFQAAAIAPP/iBW4FvgAoACwAAAUiJiYnNzIWFjMyPgI3Ez4EMzIWFgcHMCYmIyIOAgcDDgMDNSEVATA+bkYCJAI9XjUkWVhGEXoQSmNoXB1DckMCKjhfOyFhZU8QehZfdXBSA9oeHB0BTBkZF0KAaQLqYH9MJQwbHgNIGBgRN29f/RaFnU4YAsRUVAACADwAAAPyBaAAAwANAAATNSEVAREhFSERIRUhETwCGP5+AyD9NAJU/awBKVRU/tcFoFT9rlT9WgAABAA8/+IEIgW+ACYAKgAuAFUAAAUiJicmJjU0Njc2NjczDgIHBgYVFBYXFhYzMjY3NjY3MwYGBwYGATUhFQE1IRUhPgM3NjY1NCYnJiYjIgYHBgYHIzY2NzY2MzIWFxYWFRQGBwYHAiZapTk3PUY6BQ4DohowKxMqMiwkNpRCU4MwIzAJVAk5LDyn/a0D5vwaA+b+gBYmIR0MJiQ1KSV0R0JwLCs3BlQFSDk2jFJRkzY4QC4wEBoeOTMyilJTfTACDwENHB4RJF1BPGEjMys8NCReNEN5MEJMAjhUVAEUVFQLFxcYDSdXNkdvJCEvLScnbD9RjjMwODYyM4xZRm42EhQAAwBQ/+QECAWgABMAFwAbAAAhETMRFhY2Nz4DNTMUAgYHBiIBNQEVJTUBFQEuVB5dZCdldzkRWjSZl07U/s4Chv16AoYFoPqnDQYMDSGDtNV0yv7WxjUbAmJiAS5gImIBLmAAAAQAMgAABEQFoAAhACUAKQAtAAATNSEyNjc+AjU0JiYnJiYjITUhMhYXHgIVFAYGBwYGIwE1IRUBETMRAzUhFdMBZxIwFlNxOjpxUxYwEv7EATwVLBtomVNQmGwbLBX9+AQS/GZUzAQSAkBUBAQRY49RUY9kEAUDVAMFEXWzb2uzeBIEBAIIVFT7uAWg+mADRFRUAAADAIwAAATuBaAAHwAjACcAABM1ITI2NzY2NTQmJicmJiMhNSEyFhceAhUUBgcGBiMBNSEVAREzEYwCshIwFn2BOnFTFjAS/kIBvhUsG2iZU7KiGywV/U4C0P3QVAJAVAQEGMN5UY9kEAUDVAMFEnSzb6DrHQQE/tRUVP7sBaD6YAAABACMAAAENgWgACAAJAAoACwAABMhMhYXHgIVFAYHBgYjITUhMjY3PgI1NCYmJyYmIyERNwEjATUhFQE1IRWMAYIVLBtomVOQhiBRL/6EAYIRLxhTcTo6cVMYLxH+fkgCzIL9bgOq/dgCKAWgAwUReLNsj90vCwpUBAQQY5BRUZBkDwUD/PQ2/YoDxlRUAYZUVAACAHgAAAVzBaAAFQArAAAzESEyFhceAhURIxE0JiYnJiYjIREBESEiJicuAjURMxEUFhYXFhYzIRF4AcIVLBtomVNaOnFTGC8R/pIEp/4+FSwbaJlTWjpxUxgwEAFuBaADBRF4s2z9mQJnUZBkDwUD+rQFoPpgBAQSd7NsAmf9mVGQYxAEBAVMAAACADwAAAQ6Bb4AGAAcAAAzNTMyNjURNDY2MzIWFhcHJiYjIgYVESEVATUhFTyYOVFdomdXjGwnUDGPaHuVAm78HAMKVFE5A25up11Mm3Ualoybg/wIVAK2VFQAAAMAFAAABIgFoAADAAcADwAAATUBFSU1ARUBESE1IRUhEQELAob9egKG/pP98AR0/fABLGIBLmAiYgEuYPxSBUxUVPq0AAACADwAAAcGBaAAAwAQAAATNSEVAQEzAQEzAQEzASMBATwGyvrS/mRWAXIBcFgBcgFwWP5kWP6O/pACplRU/VoFoPr4BQj6+AUI+mAFBvr6AAMAAAAABA4FoAADAAcAEAAAEzUhFQE1IRUFEQEzAQEzARGgAtD9MALQ/m7+ImABqAGmYP4kAgBUVP70VFT0AmQDPP0kAtz8xP2cAP//AHgAAAJSBaAABgJWAAAAAQB4AQQEEAScAAsAAAERITUhETMRIRUhEQIa/l4BolQBov5eAQQBolQBov5eVP5eAP//AHgCpgPAAvoABgJqAFoAAQB4AWwDPgQyAAsAAAkCJwEBNwEBFwEBAwP+2P7YOwEo/tg7ASgBKDv+2AEoAWwBKP7YPAEnASg7/tkBJzv+2P7ZAAADAHgBogPAA/4AAwAHAAsAABM1IRUlNTMVAzUzFXgDSP4geHh4AqZUVOB4eP4ceHgAAAIA8AIIBOwDmAADAAcAABM1IRUBNSEV8AP8/AQD/ANEVFT+xFRUAAADAPABaATsBDgAAwAHAAsAAAEnARcFNSEVATUhFQHCPAKWPPyYA/z8BAP8AWg8ApQ6ulRU/sRUVAAAAQGQAKgDlgREAAUAACUnAQE3AQHIOAGY/mg4Ac6oNgGYAZg2/jIAAAEBGACoAx4ERAAFAAAlAQEXAQEC5v4yAc44/mgBmKgBzgHONv5o/mgAAAIA8AAABOwEVgAGAAoAABM1AQE1ARURITUh8ANq/JYD/PwEA/wBTlwBKAEoXP6kUP1WVAACAPAAAATsBFYABgAKAAABATUBFQkCNSEVBOz8BAP8/JYDavwEA/wBTgFcUAFcXP7Y/tj+VlRUAAIAeACwBDgEOAALAA8AAAERITUhETMRIRUhEQE1IRUCLv5KAbZUAbb+Sv32A8ABuAEWVAEW/upU/ur++FRUAAACAOUBkAP/A/4AGgA2AAABIi4CIyIGBhcjJjY2MzIeAjMyNiczFgYGAyIuAiMiBgYXIyY2NjMyHgIzMjY2JzMWBgYDODttZFspKycECmYRKF4/Om5nXCcyLhRmESheQTptZFwpKycECmYRKF4/Om1mXSgmKQgLZhEoXgL4NEQ0OEkZQW9ENEQ0YDo/b0b+mDRENDhJGUFvRDRENDJHIT9vRgABAOYB+AP+AvAAGQAAASIuAiMiBhcjJjY2MzIeAjMyNiczFgYGAzY3amVdKz0eD2URJ11BOGxlXSs0KRFlESZeAfgpNSlTJkFqPyk2KU8wP21DAAABAHgBkgQ4AuYABQAAAREhNSERA+T8lAPAAZIBAFT+rAAAAQDTA7oEbwXBAAUAABMBAQcBAdMBzQHPNv5n/mkD8gHP/jI4AZj+ZwAAAwBGAOYE5gOeACAALgA8AAAlIiYmNTQ2NjMyFhcjPgIzMhYWFRQGBiMiJiYnMw4CJzI2NyYmIyIGBhUUFhYhMjY2NTQmJiMiBgcWFgF0bIU9RYdke4g3NCVTcVNkhkREhmRTcVMlNCVTcU1OfzMzf05QXCYmXAKIUFwmJlxQTn8zM3/maKFVXZ1gmoxdhEVenV9fn2BGg11dg0ZabJaWbE13Pj53TU13Pj53TWyWlmwAAAMAWAAiBFYEHgADABcAJwAANycBFwEiLgI1ND4CMzIeAhUUDgInMjY2NTQmJiMiBgYVFBYWlDwDwjz+AmGpgEhIgKlhYKiASEiAqGBprWZmrWlqrWdnrSI8A8A+/HBIgKlhYKiASEiAqGBhqYBIVGetammtZmataWqtZwABAJL+wAQeBb4AHQAAEzczMjY3Ez4CNz4CMzMHIyIGBwMOAgcOAiOSCIJcaAyEAgwiJCRSRhKMCIJbaQyEAgwjIyRSRhL+wExYcATeD0VSIiIcBkxXcfsiEEZRISIcBgABAHgAAALoBaAABwAAMxEhESMRIRF4AnBU/jgFoPpgBUz6tAABAHj/egOOBOIADwAAFzUBFQE3IQchNwEVASchFXgC+v0GAQMUAf0CGgLk/RwaAwCGUgKCPAJ8VEow/ZZe/ZYwSgABABgAAASOBpAACAAAIQMjNSETATMBAc7A9gEysgI+VP2YAl5K/cwGHPlw//8AjP4gBAIEOAAGAgQAAAACAFD/4AQqBboAHgAqAAAFBiYmJz4CFzYeAhcmJicmJic3FgQXHgIVFAYGJzI2NTQmByYGFRQWAj6c23UCAnbcmjtyaFgfByIdQOOVCrABAkgnJwx33ZjGzNO/xNDRHgKE8qKk8YMCARcwRy9EgjqDiQpSCqWTS6blqKPzhFb1z9HyAwP3ztPvAAAFAHj/4gaUBb4AAwATACMAMwBDAAAzJwEXASImJjU0NjYzMhYWFRQGBicyNjY1NCYmIyIGBhUUFhYBIiYmNTQ2NjMyFhYVFAYGJzI2NjU0JiYjIgYGFRQWFvA8BWg8/tRjpGFkpGBjo2Jio2NLfktLfktLfUxMffz/Y6NiZKRgY6NiYqNjS35LS35LS31MTH08BWQ6+nxho2RipGJho2Rko2FUTH1LS35LS35LS31MArhho2RipGJho2Rko2FUS35LS35LS35LS35LAAAHAHj/4gncBb4AAwATACMAMwBDAFMAYwAAMycBFwEiJiY1NDY2MzIWFhUUBgYnMjY2NTQmJiMiBgYVFBYWASImJjU0NjYzMhYWFRQGBicyNjY1NCYmIyIGBhUUFhYBIiYmNTQ2NjMyFhYVFAYGJzI2NjU0JiYjIgYGFRQWFvA8BWg8/tRjpGFkpGBjo2Jio2NLfktLfktLfUxMffz/Y6NiZKRgY6NiYqNjS35LS35LS31MTH0G32OkYWSkYGOjYmKjY0t+S0t+S0t9TEx9PAVkOvp8YaNkYqRiYaNkZKNhVEx9S0t+S0t+S0t9TAK4YaNkYqRiYaNkZKNhVEt+S0t+S0t+S0t+S/ygYaNkYqRiYaNkZKNhVEx9S0t+S0t+S0t9TAD//wGQAQIDlgSeAAYCewBa//8BGAECAx4EngAGAqcAWgABAPAAAASMBZQACAAAIREBJwEBBwERApT+kjYBzgHONv6SBPz+kjgBzv4yOAFu+wQAAAEBGACoBqwERAAIAAABNSEBNwEBJwEBGAT8/pI4Ac7+MjgBbgJMVAFuNv4y/jI2AW4AAQDw/4AEjAUUAAgAAAEzEQEXAQE3AQKUVAFuNv4y/jI2AW4FFPsEAW44/jIBzjj+kgABARgAqAasBEQACAAAASEBBwEBFwEhBqz7BAFuOP4yAc44/pIE/AJM/pI2Ac4Bzjb+kgAAAQEYAKgFvAWgAAoAACUBARcBIREzESEBAub+MgHOOP6SA7hU+/QBbqgBzgHONv6SAwD8rP6SAP//ARgBAgasBJ4ABgK8AFr//wEYAQIGrASeAAYCvgBaAAIAZAAAAyYFPAAFAAkAACEBATMBAScJAgGS/tIBLmYBLv7SMgEG/vr++AKeAp79Yv1iQgJcAlz9pAACAKD/LgZrBQoARABQAAAFIiQmAjU0EjYkMzIEFhIHBgYjIiYnFwYGIyImJjU0NjYzMhYXBzUzERQWMzI2Njc2LgIjIg4CFRQeAjMyNjcXBgYDMjY1NCYjIgYVFBYDiJv+8sxzacUBGa+8ARezTwsPpntjgRQmHohKUXhDRXpPQYkkJk5QZDdaOAUJUafulaD4q1lntfCIZctMJGHXhFRmaVFaYmfSccsBEqCYAQ/Qd33S/v2GuLBcUghCQEV7UFR7QzdHJoj+3klrPnRSlfKvXnC+73+J8bdnOTNEPz0CFmJaX19iXF5eAAACAGP/4gTmBb4APgBRAAAFIiYnJiYnJjY3NjY3JiY1NDY3NjYzMhYXFhYXByYnJiYjIgcGBhUUFhcWFhcBNjY1JzMVFAYHFwcnBgYHBgYnMjY3NjY3AQYGBwYGFxYWFxYWAlJ5x0QzNAMBKzAjWzBVW2JYM202SJA0JDoSTho6K245Y1NDRSouGDgcAgYGBAJaDwu+OqwWVio9kU5KdjQ/NA398jRdISQhAQIlJzavHkRINoxMR5I5LDgSVotpZq0tGhYkJhhFJyQ8KB4cKCJ9UUVbOBsxGv4eITke6sJgZCCwPqIoSRchF1QTHyc+FQHgDzYnK3E8PG0pPTkAAAIAtP7mA9YFoAASABYAAAERIyImJy4CNTQ2Njc2NjMzETMRMxECulYVLBtomVNTmWgbLBWqdFT+5gNaBAQRd7RsbLR3EQUD+UYGuvlGAAIAXP64A8YFHgAoAFIAAAEiJiYnNx4CMzI2NjU0JiYnLgI1NDY2FwcGBhUUFhYXHgIVFAYGAzcyNjY1NCYmJy4CNTQ2NjMyFhYXBy4CIyIGBhUUFhYXHgIVFAYGAh5asYQXVhZxjD9NhVJRnHFxsmdwrl4GeKZZllt2vG5oriICPnhOUZxxcbJncKxaaa9wClYRbYs9Sn5MWZZbdrxuZKH+uDl/aBBRYCs2aExIUDUfH0FpW2GANQ4QHHxcQk4xFx5DdWpnjEcCMBg2aExIUDUfH0FpW2GCQVCNWxBdai0zXD1CTjEXHkN1ameHLgADADz/9gWcBVYAEwBEAFgAAAUiLgI1ND4CMzIeAhUUDgIDIiYnJiY1NjY3NjYzMhYXFhYXByYmJyYmIyIGBwYGFRQWFxYWMzI3NjY3FwYGBwYGBzI+AjU0LgIjIg4CFRQeAgLsjvq9a2u9+o6P+b1ra735i1WQNTQiAiMxNZFYNWAtLEYQUg8zIB9MJ0BuJiUdISEkbkBSRCAuEFQZRR4tZD982KVdXaXYfH3bpV1dpdsKa736jo/5vWtrvfmPjvq9awEOPkJCm0lLmD9CPhcbG1IzHCE+FRUTNDAwfjxFgC0xMygUOiQeOUkUHBy2XaXbfXzYpV1dpdh8fdulXQAABACMAlIELgX0ABMAIwAxADoAAAEiLgI1ND4CMzIeAhUUDgInMjY2NTQmJiMiBgYVFBYWJxEzMhYVFAYHFyMnIxU1MzI2NTQmIyMCXmGpgEhIgKlhYKiASEiAqGBprWZmrWlqrWdnrTjMO1svKVhSUHiCHjA0GoICUkiAqWFgqIBISICoYGGpgEhUZ61qaaxnZ6xpaq1nnAHMWDwnTRKypKToLyEkLAAAAgB4ArIGYgWgAAwAFAAAAREzAQEzEyMRASMBESERITUhFSERA3hKASoBKkoCUP78RP7+/b7+8gJu/vQCsgLu/egCGP0SAkD+LAHU/cACmlRU/WYAAgA8Au4DDAW+AA8AHwAAASImJjU0NjYzMhYWFRQGBicyNjY1NCYmIyIGBhUUFhYBpGOkYWSkYGOjYmKjY0t+S0t+S0t9TEx9Au5ho2RipGJho2Rko2FUS35LS35LS35LS35LAAEAtAAAAQgFoAADAAAzETMRtFQFoPpgAAIAtP8IAQgFoAADAAcAABMRMxEDETMRtFRUVALwArD9UPwYArD9UP//AHgAAAPABaAAJwLLAT4AAAAHAmoAAAGYAAEAeAAAAnQFoAAbAAAhERchNSEHERchNSEHETMRJyEVITcRJyEVITcRAUxa/tIBLlpa/tIBLlpUWgEu/tJaWgEu/tJaAkZaVFoB9lpUWgIk/dxaVFr+ClpUWv26AP//AIwAAAggBb4AJgBSAAAAJwLKBRQAAAAHAmgFFAAA//8AoP/iBmsFvgAHAsMAAAC0//8APACsBZwGDAAHAscAAAC2//8BGACoBqwERAAGAr4AAP//AHgEkgEwBaAABwLY/wH+Pv//AHj+jAEw/5oABwLY/wH4OAACAPAGkALQBwgAAwAHAAABNTMVITUzFQJYeP4geAaQeHh4eAABAPAGkAFoBwgAAwAAEzUzFfB4BpB4eAABAWMGVAIbB2IAAwAAAQMzEwHDYFhgBlQBDv7yAAABAXcGVAIvB2IAAwAAASMTMwHPWGBYBlQBDgD//wDfBlQC9QdiACcC2ADGAAAABwLY/2gAAAABAPAGVALcB0QABgAAEzczFyMnB/DIXMhkkpIGVPDwqqoAAQDwBlQC3AdEAAYAABMzFzczByPwZJKSZMhcB0SqqvAAAAEA8AYkArgHCAAPAAABIiYmNTMUFjMyNjUzFAYGAdQ/aD1OWT0/V049aAYkPmc/PVlZPT9nPgAAAgD0BhgCeAecAA8AGwAAASImJjU0NjYzMhYWFRQGBicyNjU0JiMiBhUUFgG2NVg1NVg1Nlg0NFg2Lz8/Ly1BQQYYNFg2NVg1NVg1Nlg0VEEtLkBALi1BAAEA5AZUAyIHBAAXAAABIi4CIyIGFyMmNjMyHgIzMjYnMxYGAo4nS0hCHisVCkgSTUUoTEhCHiYcDEgSTAZUHSYdOxtFYR0mHTgiQ2cAAAEA8AaQAtAG5AADAAATNSEV8AHgBpBUVAAAAQDw/iICGAAOABQAAAEiJic3FjMyNjU0Jic3MwcWFhUUBgFoITwbHDIkLTFUMkxUOjNFaP4iEAxKFDokMysQzpwVTkFIZAAAAQDw/hwCOgBCABYAAAEiJiY1NDY2NxcOAhUUFjMyNjcXBgYBoC9QMUZ0Rj49aUA2Ihs3FjIhUP4cMlIwPIF+N0IoaG8xLTchGTgqKAD//wHyBJICqgWgAAcC2AB7/j4AAwFCBOwDcAX6AAMABwALAAABNTMVITUzFRcjEzMC+Hj90nigWGBYBSh4eHh4PAEOAAADAKD+8ghcBq4AAgAWACoAAAkCEyIkJgI1NBI2JDMyBBYSFRQCBgQHMiQAEjU0AgAkIyIEAAIVFBIABAQEAWj+mH69/rf4jIz4AUm9ugFG9oyM9v66vs0BZwEQmpr+8P6Zzc3+mf7wmpoBEAFnA/z+1P7U/aaM+AFJvboBRvaMjPb+urq9/rf4jFiaARABZ83NAWcBEJqa/vD+mc3N/pn+8JoAAAAAHwF6AAMAAQQJAAAApgAAAAMAAQQJAAEAJACmAAMAAQQJAAIADgDKAAMAAQQJAAMAOgDYAAMAAQQJAAQAJACmAAMAAQQJAAUAGgESAAMAAQQJAAYAJAEsAAMAAQQJAAgAIAFQAAMAAQQJAAkAIAFQAAMAAQQJAAsAIgFwAAMAAQQJAAwAIgFwAAMAAQQJAA0BIgGSAAMAAQQJAA4ANgK0AAMAAQQJABAADgLqAAMAAQQJABEAFAL4AAMAAQQJABkADgLqAAMAAQQJAQAADAMMAAMAAQQJAQEAFAL4AAMAAQQJAQIAJAEsAAMAAQQJAQMACgMYAAMAAQQJAQQAGgMiAAMAAQQJAQUADgDKAAMAAQQJAQYAHgM8AAMAAQQJAQcADANaAAMAAQQJAQgAHANmAAMAAQQJAQkAEAOCAAMAAQQJAQoAIAOSAAMAAQQJAQsACAOyAAMAAQQJAQwAGAO6AAMAAQQJAQ0AEgPSAAMAAQQJAQ4AIgPkAEMAbwBwAHkAcgBpAGcAaAB0ACAAMgAwADEAOQAgAFQAaABlACAATQBhAG4AcgBvAHAAZQAgAFAAcgBvAGoAZQBjAHQAIABBAHUAdABoAG8AcgBzACAAKABoAHQAdABwAHMAOgAvAC8AZwBpAHQAaAB1AGIALgBjAG8AbQAvAGcAbwBvAGcAbABlAGYAbwBuAHQAcwAvAG0AYQBuAHIAbwBwAGUAKQBNAGEAbgByAG8AcABlACAARQB4AHQAcgBhAEwAaQBnAGgAdABSAGUAZwB1AGwAYQByADQALgA1ADAANQA7AFMASABNAEkAOwBNAGEAbgByAG8AcABlAC0ARQB4AHQAcgBhAEwAaQBnAGgAdABWAGUAcgBzAGkAbwBuACAANAAuADUAMAA1AE0AYQBuAHIAbwBwAGUALQBFAHgAdAByAGEATABpAGcAaAB0AE0AaQBrAGgAYQBpAGwAIABTAGgAYQByAGEAbgBkAGEAaAB0AHQAcAA6AC8ALwBnAGUAbgB0AC4AbQBlAGQAaQBhAFQAaABpAHMAIABGAG8AbgB0ACAAUwBvAGYAdAB3AGEAcgBlACAAaQBzACAAbABpAGMAZQBuAHMAZQBkACAAdQBuAGQAZQByACAAdABoAGUAIABTAEkATAAgAE8AcABlAG4AIABGAG8AbgB0ACAATABpAGMAZQBuAHMAZQAsACAAVgBlAHIAcwBpAG8AbgAgADEALgAxAC4AIABUAGgAaQBzACAAbABpAGMAZQBuAHMAZQAgAGkAcwAgAGEAdgBhAGkAbABhAGIAbABlACAAdwBpAHQAaAAgAGEAIABGAEEAUQAgAGEAdAA6ACAAaAB0AHQAcABzADoALwAvAG8AcABlAG4AZgBvAG4AdABsAGkAYwBlAG4AcwBlAC4AbwByAGcAaAB0AHQAcABzADoALwAvAG8AcABlAG4AZgBvAG4AdABsAGkAYwBlAG4AcwBlAC4AbwByAGcATQBhAG4AcgBvAHAAZQBFAHgAdAByAGEATABpAGcAaAB0AFcAZQBpAGcAaAB0AEwAaQBnAGgAdABNAGEAbgByAG8AcABlAC0ATABpAGcAaAB0AE0AYQBuAHIAbwBwAGUALQBSAGUAZwB1AGwAYQByAE0AZQBkAGkAdQBtAE0AYQBuAHIAbwBwAGUALQBNAGUAZABpAHUAbQBTAGUAbQBpAEIAbwBsAGQATQBhAG4AcgBvAHAAZQAtAFMAZQBtAGkAQgBvAGwAZABCAG8AbABkAE0AYQBuAHIAbwBwAGUALQBCAG8AbABkAEUAeAB0AHIAYQBCAG8AbABkAE0AYQBuAHIAbwBwAGUALQBFAHgAdAByAGEAQgBvAGwAZAACAAAAAAAA/5wAMgAAAAAAAAAAAAAAAAAAAAAAAAAAAuYAAAAkAMkBAgEDAQQBBQEGAQcAxwEIAQkBCgELAQwAYgENAK0BDgEPARAAYwCuAJAAJQAmAP0A/wBkAREBEgAnAOkBEwEUACgAZQEVAMgBFgEXARgBGQEaAMoBGwEcAMsBHQEeAR8BIAApACoA+AEhASIBIwArASQBJQAsAMwAzQDOAPoBJgDPAScBKAEpASoALQErAC4BLAAvAS0BLgEvAOIAMAAxATABMQEyATMAZgAyANAA0QE0ATUBNgE3ATgAZwE5ANMBOgE7ATwBPQE+AT8BQAFBAUIAkQCvALAAMwDtADQANQFDAUQBRQA2AUYA5AD7AUcBSAFJADcBSgFLAUwBTQA4ANQBTgDVAGgBTwDWAVABUQFSAVMBVAFVAVYBVwFYAVkBWgFbADkAOgFcAV0BXgFfADsAPADrAWAAuwFhAWIBYwFkAD0BZQDmAWYARABpAWcBaAFpAWoBawFsAGsBbQFuAW8BcAFxAGwBcgBqAXMBdAF1AG4AbQCgAEUARgD+AQAAbwF2AXcARwDqAXgBAQBIAHABeQByAXoBewF8AX0BfgBzAX8BgABxAYEBggGDAYQBhQBJAEoA+QGGAYcBiABLAYkBigBMANcAdAB2AHcBiwGMAHUBjQGOAY8BkABNAZEATgGSAE8BkwGUAZUA4wBQAFEBlgGXAZgBmQB4AFIAeQB7AZoBmwGcAZ0BngB8AZ8AegGgAaEBogGjAaQBpQGmAacBqAChAH0AsQBTAO4AVABVAakBqgGrAFYBrADlAPwBrQGuAIkAVwGvAbABsQGyAFgAfgGzAIAAgQG0AH8BtQG2AbcBuAG5AboBuwG8Ab0BvgG/AcAAWQBaAcEBwgHDAcQAWwBcAOwBxQC6AcYBxwHIAckAXQHKAOcBywHMAc0AwADBAc4AnQCeAc8B0AHRAdIB0wHUAdUB1gHXAdgB2QHaAdsB3AHdAd4B3wHgAeEB4gHjAeQB5QHmAecB6AHpAeoB6wHsAe0B7gHvAfAB8QHyAfMB9AH1AfYB9wH4AfkB+gH7AfwB/QH+Af8CAAIBAgICAwIEAgUCBgIHAggCCQIKAgsCDAINAg4CDwIQAhECEgITAhQCFQIWAhcCGAIZAhoCGwIcAh0CHgIfAiACIQIiAiMCJAIlAiYCJwIoAikCKgIrAiwCLQIuAi8CMAIxAjICMwI0AjUCNgI3AjgCOQI6AjsCPAI9Aj4CPwJAAkECQgJDAkQCRQJGAkcCSAJJAkoCSwJMAk0CTgJPAlACUQJSAlMCVAJVAlYCVwJYAlkCWgJbAlwCXQJeAl8CYAJhAmICYwJkAmUCZgJnAmgCaQJqAmsCbAJtAm4CbwJwAnECcgJzAnQCdQJ2AncCeAJ5AnoCewJ8An0CfgCbAn8CgAKBAoICgwKEAoUChgKHAogCiQKKAosCjAKNAo4CjwKQApECkgATABQAFQAWABcAGAAZABoAGwAcApMClAKVApYClwKYApkCmgKbApwCnQKeAp8CoAKhAqICowKkAqUCpgKnAqgCqQKqAqsCrAKtAq4CrwKwALwA9AD1APYAEQAPAB0AHgCrAAQAowAiAKIAwwCHAA0ABgASAD8CsQKyArMCtAALAAwAXgBgAD4AQAK1ArYCtwK4ArkCugAQArsAsgCzArwAQgK9Ar4CvwDEAMUAtAC1ALYAtwLAAKkAqgC+AL8ABQAKAsECwgLDAsQCxQLGAscCyALJAAMCygLLAAECzALNAs4AhAC9AAcCzwLQAKYA9wLRAtIC0wLUAtUC1gCFAtcC2ACWAtkADgDvAPAAuAAgAI8AIQAfAJUAlACTAKcAYQCkAEEAkgLaAJwAmgCZAKUC2wCYAAgAxgLcAt0C3gLfAuAC4QLiAuMC5AC5ACMACQCIAIYAiwCKAIwAgwBfAOgAggDCAuUC5gLnAugC6QLqAI4A3ABDAI0A3wDYAOEA2wDdANkA2gDeAOAC6wLsAu0AAgZBYnJldmUHdW5pMUVBRQd1bmkxRUI2B3VuaTFFQjAHdW5pMUVCMgd1bmkxRUI0B3VuaTFFQTQHdW5pMUVBQwd1bmkxRUE2B3VuaTFFQTgHdW5pMUVBQQd1bmkxRUEwB3VuaTFFQTIHQW1hY3JvbgdBb2dvbmVrC0NjaXJjdW1mbGV4CkNkb3RhY2NlbnQGRGNhcm9uBkRjcm9hdAZFY2Fyb24HdW5pMUVCRQd1bmkxRUM2B3VuaTFFQzAHdW5pMUVDMgd1bmkxRUM0CkVkb3RhY2NlbnQHdW5pMUVCOAd1bmkxRUJBB0VtYWNyb24HRW9nb25lawd1bmkxRUJDC0djaXJjdW1mbGV4B3VuaTAxMjIKR2RvdGFjY2VudARIYmFyC0hjaXJjdW1mbGV4B3VuaTFFQ0EHdW5pMUVDOAdJbWFjcm9uB0lvZ29uZWsGSXRpbGRlC0pjaXJjdW1mbGV4B3VuaTAxMzYGTGFjdXRlBkxjYXJvbgd1bmkwMTNCBk5hY3V0ZQZOY2Fyb24HdW5pMDE0NQNFbmcHdW5pMUVEMAd1bmkxRUQ4B3VuaTFFRDIHdW5pMUVENAd1bmkxRUQ2B3VuaTFFQ0MHdW5pMUVDRQVPaG9ybgd1bmkxRURBB3VuaTFFRTIHdW5pMUVEQwd1bmkxRURFB3VuaTFFRTANT2h1bmdhcnVtbGF1dAdPbWFjcm9uBlJhY3V0ZQZSY2Fyb24HdW5pMDE1NgZTYWN1dGULU2NpcmN1bWZsZXgHdW5pMDIxOAd1bmkxRTlFBFRiYXIGVGNhcm9uB3VuaTAxNjIHdW5pMDIxQQZVYnJldmUHdW5pMUVFNAd1bmkxRUU2BVVob3JuB3VuaTFFRTgHdW5pMUVGMAd1bmkxRUVBB3VuaTFFRUMHdW5pMUVFRQ1VaHVuZ2FydW1sYXV0B1VtYWNyb24HVW9nb25lawVVcmluZwZVdGlsZGUGV2FjdXRlC1djaXJjdW1mbGV4CVdkaWVyZXNpcwZXZ3JhdmULWWNpcmN1bWZsZXgHdW5pMUVGNAZZZ3JhdmUHdW5pMUVGNgd1bmkxRUY4BlphY3V0ZQpaZG90YWNjZW50BmFicmV2ZQd1bmkxRUFGB3VuaTFFQjcHdW5pMUVCMQd1bmkxRUIzB3VuaTFFQjUHdW5pMUVBNQd1bmkxRUFEB3VuaTFFQTcHdW5pMUVBOQd1bmkxRUFCB3VuaTFFQTEHdW5pMUVBMwdhbWFjcm9uB2FvZ29uZWsLY2NpcmN1bWZsZXgKY2RvdGFjY2VudAZkY2Fyb24GZWNhcm9uB3VuaTFFQkYHdW5pMUVDNwd1bmkxRUMxB3VuaTFFQzMHdW5pMUVDNQplZG90YWNjZW50B3VuaTFFQjkHdW5pMUVCQgdlbWFjcm9uB2VvZ29uZWsHdW5pMUVCRAd1bmkwMjU5C2djaXJjdW1mbGV4B3VuaTAxMjMKZ2RvdGFjY2VudARoYmFyC2hjaXJjdW1mbGV4CWkubG9jbFRSSwd1bmkxRUNCB3VuaTFFQzkHaW1hY3Jvbgdpb2dvbmVrBml0aWxkZQtqY2lyY3VtZmxleAd1bmkwMTM3BmxhY3V0ZQZsY2Fyb24HdW5pMDEzQwZuYWN1dGUGbmNhcm9uB3VuaTAxNDYDZW5nB3VuaTFFRDEHdW5pMUVEOQd1bmkxRUQzB3VuaTFFRDUHdW5pMUVENwd1bmkxRUNEB3VuaTFFQ0YFb2hvcm4HdW5pMUVEQgd1bmkxRUUzB3VuaTFFREQHdW5pMUVERgd1bmkxRUUxDW9odW5nYXJ1bWxhdXQHb21hY3JvbgZyYWN1dGUGcmNhcm9uB3VuaTAxNTcGc2FjdXRlC3NjaXJjdW1mbGV4B3VuaTAyMTkEdGJhcgZ0Y2Fyb24HdW5pMDE2Mwd1bmkwMjFCBnVicmV2ZQd1bmkxRUU1B3VuaTFFRTcFdWhvcm4HdW5pMUVFOQd1bmkxRUYxB3VuaTFFRUIHdW5pMUVFRAd1bmkxRUVGDXVodW5nYXJ1bWxhdXQHdW1hY3Jvbgd1b2dvbmVrBXVyaW5nBnV0aWxkZQZ3YWN1dGULd2NpcmN1bWZsZXgJd2RpZXJlc2lzBndncmF2ZQt5Y2lyY3VtZmxleAd1bmkxRUY1BnlncmF2ZQd1bmkxRUY3B3VuaTFFRjkGemFjdXRlCnpkb3RhY2NlbnQDZl9mBWZfZl9sCHRfdC5saWdhB3VuaTA0MTAHdW5pMDQxMQd1bmkwNDEyB3VuaTA0MTMHdW5pMDQwMwd1bmkwNDkwB3VuaTA0MTQHdW5pMDQxNQd1bmkwNDAwB3VuaTA0MDEHdW5pMDQxNgd1bmkwNDE3B3VuaTA0MTgHdW5pMDQxOQd1bmkwNDBEB3VuaTA0MUEHdW5pMDQwQwd1bmkwNDFCB3VuaTA0MUMHdW5pMDQxRAd1bmkwNDFFB3VuaTA0MUYHdW5pMDQyMAd1bmkwNDIxB3VuaTA0MjIHdW5pMDQyMwd1bmkwNDBFB3VuaTA0MjQHdW5pMDQyNQd1bmkwNDI3B3VuaTA0MjYHdW5pMDQyOAd1bmkwNDI5B3VuaTA0MEYHdW5pMDQyQwd1bmkwNDJBB3VuaTA0MkIHdW5pMDQwOQd1bmkwNDBBB3VuaTA0MDUHdW5pMDQwNAd1bmkwNDJEB3VuaTA0MDYHdW5pMDQwNwd1bmkwNDA4B3VuaTA0MEIHdW5pMDQyRQd1bmkwNDJGB3VuaTA0MDIHdW5pMDRBRQd1bmkwNEJBB3VuaTA0RTgPdW5pMDQxNC5sb2NsQkdSD3VuaTA0MTYubG9jbEJHUg91bmkwNDFBLmxvY2xCR1IPdW5pMDQxQi5sb2NsQkdSB3VuaTA0MzAHdW5pMDQzMQd1bmkwNDMyB3VuaTA0MzMHdW5pMDQ1Mwd1bmkwNDkxB3VuaTA0MzQHdW5pMDQzNQd1bmkwNDUwB3VuaTA0NTEHdW5pMDQzNgd1bmkwNDM3B3VuaTA0MzgHdW5pMDQzOQd1bmkwNDVEB3VuaTA0M0EHdW5pMDQ1Qwd1bmkwNDNCB3VuaTA0M0MHdW5pMDQzRAd1bmkwNDNFB3VuaTA0M0YHdW5pMDQ0MAd1bmkwNDQxB3VuaTA0NDIHdW5pMDQ0Mwd1bmkwNDVFB3VuaTA0NDQHdW5pMDQ0NQd1bmkwNDQ3B3VuaTA0NDYHdW5pMDQ0OAd1bmkwNDQ5B3VuaTA0NUYHdW5pMDQ0Qwd1bmkwNDRBB3VuaTA0NEIHdW5pMDQ1OQd1bmkwNDVBB3VuaTA0NTUHdW5pMDQ1NAd1bmkwNDREB3VuaTA0NTYHdW5pMDQ1Nwd1bmkwNDU4B3VuaTA0NUIHdW5pMDQ0RQd1bmkwNDRGB3VuaTA0NTIHdW5pMDRBRgd1bmkwNEJCB3VuaTA0RTkPdW5pMDQzMi5sb2NsQkdSD3VuaTA0MzMubG9jbEJHUg91bmkwNDM0LmxvY2xCR1IPdW5pMDQzNi5sb2NsQkdSD3VuaTA0MzcubG9jbEJHUg91bmkwNDM4LmxvY2xCR1IPdW5pMDQzOS5sb2NsQkdSD3VuaTA0NUQubG9jbEJHUg91bmkwNDNBLmxvY2xCR1IPdW5pMDQzQi5sb2NsQkdSD3VuaTA0M0QubG9jbEJHUg91bmkwNDNGLmxvY2xCR1IPdW5pMDQ0Mi5sb2NsQkdSD3VuaTA0NDcubG9jbEJHUg91bmkwNDQ2LmxvY2xCR1IPdW5pMDQ0OC5sb2NsQkdSD3VuaTA0NDkubG9jbEJHUg91bmkwNDRDLmxvY2xCR1IPdW5pMDQ0RS5sb2NsQkdSD3VuaTA0MzEubG9jbFNSQgVBbHBoYQRCZXRhBUdhbW1hB3VuaTAzOTQHRXBzaWxvbgRaZXRhA0V0YQVUaGV0YQRJb3RhBUthcHBhBkxhbWJkYQJNdQJOdQJYaQdPbWljcm9uAlBpA1JobwVTaWdtYQNUYXUHVXBzaWxvbgNQaGkDQ2hpA1BzaQd1bmkwM0E5CkFscGhhdG9ub3MMRXBzaWxvbnRvbm9zCEV0YXRvbm9zCUlvdGF0b25vcwxPbWljcm9udG9ub3MMVXBzaWxvbnRvbm9zCk9tZWdhdG9ub3MMSW90YWRpZXJlc2lzD1Vwc2lsb25kaWVyZXNpcwVhbHBoYQRiZXRhBWdhbW1hBWRlbHRhB2Vwc2lsb24EemV0YQNldGEFdGhldGEEaW90YQVrYXBwYQZsYW1iZGEHdW5pMDNCQwJudQJ4aQdvbWljcm9uA3Jobwd1bmkwM0MyBXNpZ21hA3RhdQd1cHNpbG9uA3BoaQNjaGkDcHNpBW9tZWdhCWlvdGF0b25vcwxpb3RhZGllcmVzaXMRaW90YWRpZXJlc2lzdG9ub3MMdXBzaWxvbnRvbm9zD3Vwc2lsb25kaWVyZXNpcxR1cHNpbG9uZGllcmVzaXN0b25vcwxvbWljcm9udG9ub3MKb21lZ2F0b25vcwphbHBoYXRvbm9zDGVwc2lsb250b25vcwhldGF0b25vcwd6ZXJvLnRmBm9uZS50ZgZ0d28udGYIdGhyZWUudGYHZm91ci50ZgdmaXZlLnRmBnNpeC50ZghzZXZlbi50ZghlaWdodC50ZgduaW5lLnRmB3VuaTIwODAHdW5pMjA4MQd1bmkyMDgyB3VuaTIwODMHdW5pMjA4NAd1bmkyMDg1B3VuaTIwODYHdW5pMjA4Nwd1bmkyMDg4B3VuaTIwODkHdW5pMjA3MAd1bmkwMEI5B3VuaTAwQjIHdW5pMDBCMwd1bmkyMDc0B3VuaTIwNzUHdW5pMjA3Ngd1bmkyMDc3B3VuaTIwNzgHdW5pMjA3OQpjb2xvbi5jYXNlD2V4Y2xhbWRvd24uY2FzZRFxdWVzdGlvbmRvd24uY2FzZRNwZXJpb2RjZW50ZXJlZC5jYXNlDnBhcmVubGVmdC5jYXNlD3BhcmVucmlnaHQuY2FzZQ5icmFjZWxlZnQuY2FzZQ9icmFjZXJpZ2h0LmNhc2UQYnJhY2tldGxlZnQuY2FzZRFicmFja2V0cmlnaHQuY2FzZQd1bmkwMEFEB3VuaTIwMTELaHlwaGVuLmNhc2ULZW5kYXNoLmNhc2ULZW1kYXNoLmNhc2UHdW5pMjAxRhJndWlsbGVtb3RsZWZ0LmNhc2UTZ3VpbGxlbW90cmlnaHQuY2FzZRJndWlsc2luZ2xsZWZ0LmNhc2UTZ3VpbHNpbmdscmlnaHQuY2FzZRJoeXBoZW5faHlwaGVuLmxpZ2ETaHlwaGVuX2dyZWF0ZXIubGlnYQlhbm90ZWxlaWEHdW5pMDM3RRtwYXJlbmxlZnRfY19wYXJlbnJpZ2h0LmxpZ2EHdW5pMDBBMAJDUgd1bmkyMDYwG3NwYWNlX2xlc3NfdGhyZWVfc3BhY2UubGlnYQd1bmkyMEJGBGRvbmcERXVybwd1bmkyMEI0B3VuaTIwQkEHdW5pMjBCMQd1bmkyMEJEB3VuaTIwQjkHdW5pMjBBQQd1bmkyMEFFB3VuaTIwQTkHdW5pMjIxNQhlbXB0eXNldAd1bmkwMEI1DGdyZWF0ZXIuY2FzZQlsZXNzLmNhc2UHYXJyb3d1cAphcnJvd3JpZ2h0CWFycm93ZG93bglhcnJvd2xlZnQOY2FycmlhZ2VyZXR1cm4PYXJyb3dyaWdodC5jYXNlDmFycm93bGVmdC5jYXNlB3VuaTIxMTYHYXQuY2FzZQ5jb3B5cmlnaHQuY2FzZRBsZXNzX2h5cGhlbi5saWdhB3VuaTAzNzQHdW5pMDM3NQV0b25vcw1kaWVyZXNpc3Rvbm9zGnBybmxlZnRfZ3J0cl9wcm5yaWdodC5saWdhAAABAAH//wAPAAEAAwAAAAAAAAAAAAAAAAASAAEAAAAQAAIAAAAaAAAANAABAAEAAEAAQAAAEgAAAAEAAIicprDEztji7PYKFB4oPFBkeAABAAEAAQAAAMgAAQAAABgAEAAKAAIAMAA8AAFrZXJuACIABERGTFQAOmN5cmwAPmdyZWsAOmxhdG4ATgAAAAIAAQAAAAIACAADASIAvgU6AAIACAADAHwAVgLiAEIAAAA+AAJCR1IgAD5TUkIgAD4ALgAHQVpFIAAuQ1JUIAAuS0FaIAAuTU9MIAAuUk9NIAAuVEFUIAAuVFJLIAAuAAD//wABAAAAATtEAEQAAAAOOmA6iDpoOog7ZDqQOnA6eDp4Ong6eDp4OoA6pAABO6AABAAAABY6wjqSOpg7cDqeOsw6pDqkOrA6qjqwOvQ61jrgO4I6tjsCO147EDrqOrw6vAABO+wARAAAAC09BjuaQIQ7qDosOiw6LDosOiw6LDosOiw6LDosOiw6LDosOiw6LDosOiw6LDos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/8QAAAAAAAAAAAAA/9gAAAAAAAAAUE3SAAAAAAAAAAD/2AAAAAAAAP+IAAAAAAAA/7AAAP+cAAAAAAAAAAAAAP+IAAD/dAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/2AAAAAAAAAAAAAAAAAAAAAAAAP/OAAAAAAAA/9gAAAAAAAD/2AAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/2AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/zgAAP84AAAAAAAAAAAAAAAAAAD/2AAA/9gAAP/YAAAAUE3SAAAAAAAAAAAAAAAA/4gAAP+IAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/iAAAAAAAAP/YAAD/xAAAAAAAAAAAAAD/iAAA/8QAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/9gAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP/YAAD/2AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP+IAAD/iAAAAAAAAAAAAAD/xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP+wO9gAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP/OAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP/EAAD/sDvY/84AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP/sAAAAAAAAAAAAAP+IAAAAAAAA/9gAAP/sAAAAAAAAAAAAAP+IAAD/xAAA/+IAAAAAAAD/2AAAAAAAAAAAAAAAAAAAAAAAAAAATcD/sAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/2AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAE20AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/4gAAP+IAAAAAAAAAAAAAAAAAAAAAAAA/8QAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/8QAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/9gAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP/EAAAAAAAA/8QAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/4jvS/+I70gAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/YAAA/7AAAP+wAAD/dAAAAABNxv9gAAAAAAAAAAAAAAA+AAD/YAAA/7oAAP+6AAAAAAAA/9gAAAA8AAAAAAAA/5wAAP9gAAD/xAAA/2AAAP+wAAD/xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP+6AAD/sAAA/7oAAAAAAAD/sAAAAAAAAP+wAAD/sAAA/2AAAAAATcD+6AAA/2AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP9gAAD/sAAA/8QAAP+wAAD/dAAAAAAAAP9gAAAAAAAAADwAAAA+AAAAAAAA/9gAAAAAAAAAAAAAAABNwAAAAAD/xAAAAAAAAAAAAAD/ugAAAAAAAAAAAAD/9gAAAAAAAAAAAAD/iAAAAAAAAAAAAAD/2AAAAAAAAP/YAAAAAAAAAAAAAAAAAAD/sAAA/9gAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/2AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABNwAAAAAD/2AAA/8QAAP+IAAD/ugAAAAAAAP/YAAAAAAAAAAAAAAAATboAAAAA/9gAAAAAAAAAAAAA/7oAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/7AAAAAAAAAAAAAAAAAAAAAAAAD/7E3SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFAAAAAAAAAAUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP9gAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/xAAAAAAAAAAAAAAAAAAAAAAAAAAATboAAAAAAAAAAAAAAAD/sAAA/7oAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP/EAAAAAAAAAAAAAAAAAAAAAAAA/8QAAP/YAAD/xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/9gAAP/EAAAAAAAAAAAAAAAAAAAAAAAA/9gAAP/iAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/9gAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP9gAAAAAAAA/5wAAP/YAAAAAAAA/3QAAAAAAAAAAAAAADwAAP90AAD/iAAA/3QAAAAAAAAAAAAAAHgAAAAAAAD/nAAA/4gAAP90AAD/YAAA/5wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/4gAAAAAAAD/OAAA/3QAAP+cAAAAAAAA/8QAAAAAAAD/YAAAAAAAAP84AAD/dAAA/2AAAAAAAAAAAAAAAAAAAP/EAAD/YAAA/3QAAAAAAAAAAAAAAAAAAP/YAAAAAAAA/2AAAAAAAAAAeAAAADwAAAAAAAD/4gAAAAAAAAAAAAAAAAAAAAAAAAAATdIAAAAA/+IAAP+IAAAAAAAAAAAAAP/YAAAAAAAAAAAAAP+IAAD/xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/sAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/2AAAAAAAAAAAAAAAAAAA/9gAAP/YAAD/2E3MAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/4gAAP+IAAAAAAAAAABN0gAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/dAAAAAAAAAAAAAD/2AAAAAAAAAAAAAD/iAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/9gAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP+wAAD/sAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP+IAAD/dAAAAAAAAAAAAAAAAAAAAAAAAP/YAAAAAAAAAAAAAAAAAAAAAAAA/8QAAAAAAAAAAAAAAAAAAAAAAAD/xAAAAAAAAP/YAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA8AAAAAAAAAAAAAP+IAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP+cAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPAAAAAAAAP/YAAAAAAAAAAAAAAAAAAAAAAAA/8QAAAAAAAD/2AAAAAAAAAAAAAAAAAAAAAAAAP/YAAAAAAAAAAAAAP/EAAD/2AAA/+wAAAAAAAAAAAAAAAAAAP+cAAAAAAAAAAAAAAAAAAAAAAAA/9gAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP/YAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/9gAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP/YAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP/YAAAAAAAA/5wAAP/EAAAAAAAA/7AAAP/ETdL/ugAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/8QAAAAAAAD/pgAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/2AAAAAAAAP/EAAAAAAAA/8QAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP/CAAAAAAAAAABNugAAAAD/ugAAAAAAAAAAAAD/2AAAAABNugAAAAAAAAAAAAAAAP+6AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/ugAA/8RN0v/EAAAAAE26AAAAAAAAAAD/ugAAAAAAAAAAAAAAAAAAAAAAAP/sAAAAAAAAAAAAAAAAAAAAAAAA/85NkAAAAAAAAAAA/9gAAAAAAAAAAAAAAABNtAAAAAAAAAAAAAAAAAAAAAAAAAAA/9gAAAAAAAD/2AAAAAAAAAAAAAAAAAAAAAAAAP/YAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP9gAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/9gAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP+IAAAAAAAA/9gAAP/YAAAAAAAAAAAAAP+cAAD/xAAAAAAAAAAAAAD/2AAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/sDvYAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/9gAAP/YAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/5wAAP+IAAAAAAAA/4gAAP/YAAD/xAAA/3QAAAAAAAD/pgAAAAAAAP/YAAAAAAAA/6YAAP/EAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP/EAAD/xAAA/8QAAP+mAAAAAAAA/9gAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/2AAA/9gAAP+cAAAAAAAA/8QAAAAAAAAAAAAA/9gAAP/EAAAAAAAA/4gAAP+mAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/pgAA/9gAAP/YAAD/2AAA/3QAAAAAAAD/pgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/5wAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/5wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/nAAA/5wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP+IAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/2AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/9gAAP/YAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/4gAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADvGAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAE2uAAAAAAAAO9gAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAO8YAAAAAAAAAAAAAAAAAAAAAAAAAAP/YAAAAAAAAAAAAAAAAAAAAAAAA/8QAAAAAAAAAAAAAAAAAAAAAAAD/xAAA/9gAAP/EAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP+cAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP/YAAAAAAAAAAAAAAAAAAD/2AAA/8QAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP/EAAAAAAAAAAAAAP/sAAAAAAAA/8QAAAAAAAD/2AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHgAAAAAAAAAAAAD/iAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/zgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP/EAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP+IAAAAAAAAAAAAAAAAAAAAUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABQAAAAAAAAAAAAAP+wAAD/iDvMAAAAAAAAAAAAAAAA/9gAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABNugAAAAAAAAAAAAAAAAAAAAAAAAAA/7AAAAAAAAAAAAAAAAAAAP+IO8YAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP+IO8YAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/7AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/7A72AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/4hNugAAAAAAAAAA/xAAAAAAAAD/xAAAAAAAAAA8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/YAAAAAAAAP/EAAAAAAAAAAA73gAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP/EAAAAAAAAAAAAAAAUAAAAFAAAAAAAAAAAAAD/xAAAAAAAAAAAO94AAAAA/xAAAAAAAAD/xAAAAAAAAAAAAAAAAAAAAAAAAP/sAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP/YAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/+wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/2AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/9gAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/8QAAAAAAAAAAAAAAAAAAAAAAAD/4k2iAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP/YAAAAAAAAAAAAAP/iAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP/YAAAAAAAA/9gAAP/EAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/9gAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/8QAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/8QAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/8QAAP/YAAD/xAAAAAAAAAAAAAAAAAAAAAAAAABQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP/YAAAAAAAAAAAAAAAAAAAAAAAA/8QAAAAAAAAAAAAAAAAAAAAAAAD/xAAA/9gAAP/EAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAE2WAAAAAP+IAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP+cAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP/YAAAAAAAAAAAAAAAAAAD/2AAA/8QAAAAAAAAAAAAA/9gAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP84AAAAAAAA/7oAAP+cAAAAAAAAAAAAAP84AAD/YAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/xAAAAAAAAP/YAAAAAAAA/84AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP+cAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/xAAAP8QAAAAAAAAAAAAAAAAAAD/2AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/zgAAP84AAAAAAAA/8QAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP+wTbQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/7BNtAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP+wAAAAAAAAAAAAAAAAAAAAAAAA/8QAAAAAAAAAAAAA/7oAAP/EAAAAAAAA/9g7zAAAAAAAAAAA/5wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/8QAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/8QAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/8QAAAAAAAD/nAAA/7oAAAAAAAAAAAAAAAAAAAAAAAAAADveAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADveAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/7E2cAAAAAAAAAAAAAAAAADwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABNugAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAE26AAAAAAAAAAAAAAAAAAAAAAAAAAD/7E2cAAAAAP/YAAAAAAAAAAAAAAAAAAAAPgAA/+IAAAAAAAAAHgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPgAAAAAAAAA+AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFAAAAAAAAAAAAAAAAAAAAAAAAP+cAAAAAAAAAAAAAAAAAAAAPAAAADwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAeAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/2AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/nAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/2AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/sAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/4gAAAAAAAAAAAAA/9gAAAAAAAAAAAAA/4gAAAAAAAAAAAAAAAAAAP/YAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/7AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/iAAA/4gAAAAAAAD/iE26AAAAAAAAAAD/EAAAAAAAAP/EAAAAAAAAADwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP9gAAAAAAAA/8QAAAAAAAAAADveAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP/EAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/8QAAAAAAAAAAAAAABQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP/EAAAAAAAAAAAAAAAAAAAAAAAA/+IAAAAAAAAAAAAAAAAAAAAAAAAAAE3SAAAAAP/iAAD/iAAAAAAAAAAAAAD/2AAAAAAAAAAAAAD/iAAA/8QAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP/YAAAAAAAA/9hNzAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP/YAAAAAAAAAAAAAAAAAAAAAAAA/8QAAAAAAAAAAAAAAAAAAAAAAAD/nAAA/9gAAP/EAAAAAAAAAAAAAP/YAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP/EAAAAAAAAAAAAAP/sAAAAAAAA/8QAAAAAAAD/2AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/9gAAAAAAAAAAAAAAAAAAAAAAAD/xAAAAAAAAAAAAAAAAAAAAAAAAP/EAAAAAAAA/9gAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAyO9IAAAAAAAAAAAAAAAAAAAAA/2AAAAAAAAD/2AAA/9gAAAAAAAD/2AAA/4gAAP/EAAAAAAAAAABNov/2TaIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/9gAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/xAAAAAAAAP/iTaj/2AAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/sAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/sAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/sAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/sAAAAAAAAAAAAAAAAAAAAAAAAAAAO94AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/8QAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/sDvYAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/zgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/9gAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP/iAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP9gAAAAAAAA/5wAAP/YAAAAAAAA/3QAAAAAAAAAAAAAADwAAP90AAD/iAAA/3QAAAAAAAAAAAAAAHgAAAAAAAD/nAAA/4gAAP90AAD/YAAA/5wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/4gAAAAAAAAAAAAA/3QAAP+cAAAAAAAAAAAAAAAAAAD/YAAAAAAAAAAAAAD/dAAA/2AAAAAAAAAAAAAAAAAAAP/EAAD/YAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/2AAAAAAAAAAAAAAAAAAAAAAAAD/xAAAAAAAAP/EAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA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AA8AAAAQAAAAEQAAABIAAAATAAAAFAAAABUAAAAWAAAAFwAAAVgAAAFeAAABaQAAAY8AAAHYAAAB2wAAAeIAAAHwAAAAHwAB/7AAAv+wAAP/sAAE/7AABf+wAAb/sAAH/7AACP+wAAn/sAAK/7AAC/+wAAz/sAAN/7AADv+wAA//sAAQ/7AAEf+wABL/sAAT/7AAFP+wABX/sAAW/7AAF/+wAVj/sAFe/7ABaf+wAY//sAHY/7AB2/+wAeL/sAHw/7AAAAARgAAAAAALgAAAAAACgAAAAAAPgAAAAAAAgAAAAQAQAiECXAJeAmACYgJkAnYCfQKOAo8CkAKSApgCmQKcAp4AWABIAAARvgBJAAARvgCo/8QRxACp/8QRxACq/8QRxACr/8QRxACs/8QRxACt/8QRxACu/8QRxACv/8QRxACw/8QRxACx/8QRxACy/8QRxACz/8QRxAC0/8QRxAC1/8QRxAC2/8QRxAC3/8QRxAC4/8QRxAC5/8QRxAC6/8QRxAC7/8QRxAC8/8QRxAC9/8QRxAC+/8QRxADAAAARygDBAAARygDCAAARygDDAAARygDEAAARygDFAAARygDGAAARygDKAAARygDOAAARygDPAAARygDQAAARygDRAAARygDSAAARygDVAAARygDXAAARygDaAAARygDbAAARygD5AAARygEBAAARygECAAARygEDAAARygEEAAARygEFAAARygEGAAARygEHAAARygEIAAARygEJAAARygEKAAARygELAAARygEMAAARygENAAARygEOAAARygEPAAARygEQAAARygERAAARygESAAARygETAAARygEUAAARygEVAAARygEWAAARygEXAAARygGQ/8QRxAGWAAARygGhAAARygGkAAARygGnAAARygGrAAARygG5AAARygG//8QRxAHDAAARygHIAAARygHRAAARygH5AAARygH8AAARygH+AAARygIHAAARygIKAAARygILAAARygIOAAARygIRAAARygIYAAARygIZAAARygIaAAARygACAAsCIQIhAAYCdgJ2AAECfQJ9AAECjgKOAAICjwKPAAMCkAKQAAQCkgKSAAUCmAKYAAcCmQKZAAgCnAKcAAkCngKeAAoANQAB/5wAAv+cAAP/nAAE/5wABf+cAAb/nAAH/5wACP+cAAn/nAAK/5wAC/+cAAz/nAAN/5wADv+cAA//nAAQ/5wAEf+cABL/nAAT/5wAFP+cABX/nAAW/5wAF/+cAH7/xACb/8QA3ABQAVEAUAFSAFABVABQAVj/nAFe/5wBYv/EAWn/nAFx/8QBdP/EAX3/xAGB/8QBjf/EAY//nAHY/5wB2/+cAeL/nAHt/8QB8P+cAggAUAIh/5wCSf7AAkr+wAJd/4gCX/+IAmH/iAJj/4gCZf+IAAIAEwIhAiEACgJJAkoABAJLAkwAAgJYAlgAAgJdAl0AAQJfAl8AAQJhAmEAAQJjAmMAAQJlAmUAAQJ2AnYABQJ9An0ABQKHAogAAwKMAowAAwKOAo4ABgKPAo8ABwKQApAACAKSApIACQKcApwACwKeAp4ADABLAAH/2AAC/9gAA//YAAT/2AAF/9gABv/YAAf/2AAI/9gACf/YAAr/2AAL/9gADP/YAA3/2AAO/9gAD//YABD/2AAR/9gAEv/YABP/2AAU/9gAFf/YABb/2AAX/9gASP/EAEn/xAB9/2AAfv+cAH//YACA/2AAgf9gAJX/pgCW/6YAl/+mAJj/pgCZ/6YAmv+mAJv/nACc/2AAnf9gAJ7/YACf/2AAoP9gAKH/YACi/2AAo/9gAUT/2AFY/9gBXv/YAWL/nAFp/9gBcP9gAXH/nAF0/5wBe/9gAX3/nAGB/5wBhf+mAYj/YAGJ/2ABjf+cAY//2AGa/9gBm//YAaz/2AHH/9gB2P/YAdv/2AHi/9gB6v9gAev/YAHt/5wB8P/YAfX/YAH4/2ACD//YAFAAwP/EAMH/xADC/8QAw//EAMT/xADF/8QAxv/EAMf/xADI/8QAyf/EAMr/xADO/8QAz//EAND/xADR/8QA0v/EANX/xADX/8QA2v/EANv/xADd/8QA3v/EAN//xADg/8QA4f/EAPn/xAEB/8QBAv/EAQP/xAEE/8QBBf/EAQb/xAEH/8QBCP/EAQn/xAEK/8QBC//EAQz/xAEN/8QBDv/EAQ//xAEQ/8QBEf/EARL/xAET/8QBFP/EARX/xAEW/8QBF//EARr/xAEf/8QBIP/EASH/xAEi/8QBI//EAST/xAGW/8QBof/EAaT/xAGn/8QBq//EAbj/xAG5/8QBw//EAcX/xAHG/8QByP/EAdH/xAH5/8QB/P/EAf7/xAIG/8QCB//EAgr/xAIL/8QCDv/EAhH/xAIY/8QCGf/EAhr/xAACAD0AAQAWAAAANAA0ABYASgBOABcAUABQABwAbwBvAB0AcQBxAB4AfQCBAB8AlQCjACQAqADFADMAygDkAFEA8wD0AGwA+gD7AG4BAQEYAHABHwEkAIgBRQFMAI4BUQFRAJYBWAFYAJcBWwFbAJgBXQFdAJkBYgFiAJoBZwFnAJsBcAFxAJwBdAF0AJ4BiQGJAJ8BjQGRAKABlwGZAKUBnwGfAKgBpAGkAKkBpwGnAKoBqQGrAKsBuAG5AK4BvQG+ALABwAHAALIBwwHDALMBxQHGALQByAHIALYBzAHMALcB0AHQALgB1wHYALkB2gHbALsB4QHiAL0B6gHrAL8B7QHtAMEB8AHwAMIB9QH1AMMB+AH4AMQB/AH9AMUB/wH/AMcCAgICAMgCBwIKAMkCDQIOAM0CEAIRAM8CFQIZANECHAIcANYCHwIgANcCJAIkANkCVgJWANoCaAJoANsCcgJ0ANwCdgJ2AN8CfAJ8AOAAagCo/8QAqf/EAKr/xACr/8QArP/EAK3/xACu/8QAr//EALD/xACx/8QAsv/EALP/xAC0/8QAtf/EALb/xAC3/8QAuP/EALn/xAC6/8QAu//EALz/xAC9/8QAvv/EAMD/nADB/5wAwv+cAMP/nADE/5wAxf+cAMb/nADK/5wAzv+cAM//nADQ/5wA0f+cANL/nADV/5wA1/+cANr/nADb/5wA+f+cAPr/xAD7/8QBAf+cAQL/nAED/5wBBP+cAQX/nAEG/5wBB/+cAQj/nAEJ/5wBCv+cAQv/nAEM/5wBDf+cAQ7/nAEP/5wBEP+cARH/nAES/5wBE/+cART/nAEV/5wBFv+cARf/nAEY/8QBH//EASD/xAEh/8QBIv/EASP/xAEk/8QBRP/YAZD/xAGW/5wBmv/YAZv/2AGh/5wBov/EAaT/nAGn/5wBq/+cAaz/2AG5/5wBv//EAcP/nAHF/8QBx//YAcj/nAHQ/8QB0f+cAfn/nAH8/5wB/v+cAf//xAIH/5wCCv+cAgv/nAIO/5wCD//YAhH/nAIY/5wCGf+cAhr/nAIc/8QAdgAB/xAAAv8QAAP/EAAE/xAABf8QAAb/EAAH/xAACP8QAAn/EAAK/xAAC/8QAAz/EAAN/xAADv8QAA//EAAQ/xAAEf8QABL/EAAT/xAAFP8QABX/EAAW/xAAF/8QAEj/OABJ/zgAwP/EAMH/xADC/8QAw//EAMT/xADF/8QAxv/EAMf/xADI/8QAyf/EAMr/xADO/8QAz//EAND/xADR/8QA0v/EANX/xADX/8QA2v/EANv/xADc/8QA3f+wAN7/sADf/7AA4P+wAOH/sAD5/8QBAf/EAQL/xAED/8QBBP/EAQX/xAEG/8QBB//EAQj/xAEJ/8QBCv/EAQv/xAEM/8QBDf/EAQ7/xAEP/8QBEP/EARH/xAES/8QBE//EART/xAEV/8QBFv/EARf/xAEa/8QBH//EASD/xAEh/8QBIv/EASP/xAEk/8QBUf/EAVL/xAFU/8QBWP8QAV7/EAFp/xABj/8QAZb/xAGh/8QBpP/EAaf/xAGr/8QBuP/EAbn/xAHD/8QBxf/EAcb/sAHI/8QB0f/EAdj/EAHb/xAB4v8QAfD/EAH5/8QB/P/EAf7/xAIG/8QCB//EAgj/xAIK/8QCC//EAg7/xAIR/8QCGP/EAhn/xAIa/8QAhwAB/+wAAv/sAAP/7AAE/+wABf/sAAb/7AAH/+wACP/sAAn/7AAK/+wAC//sAAz/7AAN/+wADv/sAA//7AAQ/+wAEf/sABL/7AAT/+wAFP/sABX/7AAW/+wAF//sAKj/2ACp/9gAqv/YAKv/2ACs/9gArf/YAK7/2ACv/9gAsP/YALH/2ACy/9gAs//YALT/2AC1/9gAtv/YALf/2AC4/9gAuf/YALr/2AC7/9gAvP/YAL3/2AC+/9gAwP/iAMH/4gDC/+IAw//iAMT/4gDF/+IAxv/iAMr/4gDL/9gAzP/YAM3/2ADO/+IAz//iAND/4gDR/+IA0v/iANP/2ADU/9gA1f/iANb/2ADX/+IA2P/YANn/2ADa/+IA2//iAPn/4gEB/+IBAv/iAQP/4gEE/+IBBf/iAQb/4gEH/+IBCP/iAQn/4gEK/+IBC//iAQz/4gEN/+IBDv/iAQ//4gEQ/+IBEf/iARL/4gET/+IBFP/iARX/4gEW/+IBF//iARr/2AFY/+wBXv/sAWn/7AGP/+wBkP/YAZb/4gGX/9gBmP/YAZn/2AGh/+IBpP/iAaf/4gGr/+IBuP/YAbn/4gG//9gBw//iAcj/4gHR/+IB2P/sAdv/7AHi/+wB8P/sAfn/4gH8/+IB/v/iAgb/2AIH/+ICCv/iAgv/4gIO/+ICEf/iAhj/4gIZ/+ICGv/iAiH/7AJJ/xoCSv8aAo7/2ACIABr/xAAb/8QAHP/EAB7/xAA1/8QANv/EADf/xABY/8QAWf/EAFr/xABb/8QAXP/EAF3/xABe/8QAX//EAGD/xABh/8QAYv/EAGP/xABk/8QAZf/EAGb/xABn/8QAaP/EAGn/xABq/8QAa//EAGz/xABt/8QAbv/EAHH/xAB9/2AAf/9gAID/YACB/2AAlf9gAJb/YACX/2AAmP9gAJn/YACa/2AAwP/EAMH/xADC/8QAw//EAMT/xADF/8QAxv/EAMr/xADO/8QAz//EAND/xADR/8QA0v/EANX/xADX/8QA2v/EANv/xAD5/8QBAf/EAQL/xAED/8QBBP/EAQX/xAEG/8QBB//EAQj/xAEJ/8QBCv/EAQv/xAEM/8QBDf/EAQ7/xAEP/8QBEP/EARH/xAES/8QBE//EART/xAEV/8QBFv/EARf/xAEf/8QBIP/EASH/xAEi/8QBI//EAST/xAE+/2ABP/9gAUD/YAFB/2ABQv9gAUP/YAFj/8QBbP/EAW//xAFw/2ABc//EAXv/YAGF/2ABiP9gAYv/xAGW/8QBof/EAaT/xAGn/8QBq//EAbn/xAHB/2ABw//EAcX/xAHI/8QBzf9gAdH/xAHf/8QB5v/EAer/YAHs/8QB7//EAfT/xAH2/8QB+f/EAfv/YAH8/8QB/v/EAgD/xAIF/2ACB//EAgr/xAIL/8QCDv/EAhH/xAIY/8QCGf/EAhr/xACPAAH/EAAC/xAAA/8QAAT/EAAF/xAABv8QAAf/EAAI/xAACf8QAAr/EAAL/xAADP8QAA3/EAAO/xAAD/8QABD/EAAR/xAAEv8QABP/EAAU/xAAFf8QABb/EAAX/xAASP8QAEn/EACo/8QAqf/EAKr/xACr/8QArP/EAK3/xACu/8QAr//EALD/xACx/8QAsv/EALP/xAC0/8QAtf/EALb/xAC3/8QAuP/EALn/xAC6/8QAu//EALz/xAC9/8QAvv/EAMD/xADB/8QAwv/EAMP/xADE/8QAxf/EAMb/xADH/8QAyP/EAMn/xADK/8QAzv/EAM//xADQ/8QA0f/EANL/xADV/8QA1//EANr/xADb/8QA3f/EAN7/xADf/8QA4P/EAOH/xAD5/8QBAf/EAQL/xAED/8QBBP/EAQX/xAEG/8QBB//EAQj/xAEJ/8QBCv/EAQv/xAEM/8QBDf/EAQ7/xAEP/8QBEP/EARH/xAES/8QBE//EART/xAEV/8QBFv/EARf/xAEa/8QBH//EASD/xAEh/8QBIv/EASP/xAEk/8QBJgA8AScAPAEoADwBKQA8ASoAPAFY/xABXv8QAWn/EAGP/xABkP/EAZb/xAGh/8QBpP/EAaf/xAGr/8QBuP/EAbn/xAG//8QBw//EAcX/xAHG/8QByP/EAdH/xAHY/xAB2/8QAeL/EAHw/xAB+f/EAfz/xAH+/8QCBv/EAgf/xAIK/8QCC//EAg7/xAIR/8QCGP/EAhn/xAIa/8QAAAAMgAAAAAAFgAAAAAAJgAAAAAAHgAAAAAAKgAAAAAAOgAAAAAAGgAAAAAAEgAAAAAADgAAAAAABgAAAAAANgAAAAAAIgAAAAgA6AAEAMQAAADMAMwAxADUAOQAyAD0APQA3AEgATgA4AFAAUAA/AFgAbgBAAHAAcgBXAHQAdgBaAHgAyABdAMoA8ACuAPMA9QDVAPcA9wDYAPkA+wDZAQEBUQDcAVgBWwEtAV0BXQExAV8BYwEyAWcBZwE3AWwBbAE4AW4BcQE5AXMBdAE9AXoBewE/AX0BfgFBAYABggFDAYUBhgFGAYgBiwFIAY0BkQFMAZMBkwFRAZUBmgFSAZwBnwFYAaEBrQFcAa8BrwFpAbIBtgFqAbgBuwFvAb0BwQFzAcMBzgF4AdAB0QGEAdMB0wGGAdUB2wGHAd0B3QGOAd8B4gGPAeYB5gGTAeoB7QGUAe8B8QGYAfQB9gGbAfgB+QGeAfsCHAGgAiECIQHCAlwCZQHDAnYCdgHNAn0CfQHOAo4CkAHPApICkgHSApgCmQHTApwCnAHVAp4CngHWAtMC1AHXAAIAxQABABYAAwAXABcABQAYABgADAAZAB4AEQAfACIAIwAjADEABQAzADMABQA1ADkAGgA9AD0AAQBIAEkAKgBKAEsAEwBMAE4AJABQAFAAJABYAG0AAgBuAG4ABQBwAHAAJwBxAHEAAgByAHIAKAB0AHUAKAB2AHYAGwB4AHsAGwB8AHwADQB9AH0ADgB+AH4AIgB/AIEADgCCAJQABwCVAJoAFgCbAJsAIgCcAKMACQCkAKcAHACoAL0ABAC+AL4ABgDAAMUADwDGAMYAAQDHAMcADQDIAMgAHwDKANoABgDcANwAKQDdAOEAFwDiAOQAGADlAPAACADzAPQAIAD1APUACAD3APcAHwD5APkAEgD6APsAEAEXARcABgEZARkALAEaARoANAEbAR4AFAEfASQAFQElASUADQEmAScAIQEoASgAHwEpASoAIQErATIAAQEzATgAGQE5AT0AAQE+AUMACgFEAUQAEgFFAUwACwFNAVAAJgFRAVEAKQFYAVgAAwFZAVkAJwFaAVoADAFbAVsADgFdAV0ADgFfAWEABQFiAWIAEwFjAWMADAFnAWcAEwFsAWwAAgFuAW4AJwFvAW8AEQFwAXAADgFxAXEACQFzAXMAAgF0AXQAIgF6AXsADAF9AX4AKwGAAYAAEQGBAYEAAgGCAYIAAQGFAYUADAGGAYYAAgGIAYgADQGJAYkACQGKAYoADAGLAYsAAgGNAY4AEwGPAY8AAwGQAZAABAGTAZMAFAGVAZUAFAGWAZYAAQGXAZkABgGaAZoAEgGcAZ4AAQGfAZ8AIAGhAaMAAQGlAaUAAQGmAaYALAGnAacADwGoAagAFAGpAaoACwGsAawAEgGtAa0AAQGvAa8AAQGyAbMADQG0AbQAAQG1AbYADQG4AbgADwG6AbsACAG9Ab0AGAG/Ab8AAQHAAcAAGAHBAcEACgHEAcQADAHFAcUAFQHGAcYAFwHHAccAEgHJAcsAAQHMAcwAIAHNAc0ACgHOAc4AAQHQAdAAEAHRAdEAAQHTAdMAAQHVAdUADQHWAdYAAQHYAdgAAwHZAdkADAHaAdoADgHbAdsAAwHdAd0AHAHfAd8AAgHgAeAAAQHhAeEAEwHiAeIAAwHmAeYAAgHqAeoADgHrAesACQHsAewAAgHtAe0AIgHvAe8AAgHwAfAAAwHxAfEABQH0AfQAAgH1AfUACQH2AfYAAgH4AfgACQH5AfkAAQH7AfsACgH+Af4AEgH/Af8AEAIAAgAAAgIBAgEAJQICAgIAIAIDAgMAMwIEAgQAAQIFAgUACgIGAgYAOQIIAggAKQIKAgoADwILAgsANwIMAgwAIQINAg0AEAIPAg8AEgIQAhAAGAISAhQAJQIVAhcAEAIaAhoAAQIbAhsAEgIcAhwAEAIhAiEAMgJcAlwAHQJdAl0AHgJeAl4AHQJfAl8AHgJgAmAAHQJhAmEAHgJiAmIAHQJjAmMAHgJkAmQAHQJlAmUAHgJ2AnYALQJ9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"), character => character.charCodeAt(0));
      const face = new FontFace('Converge Manrope', fontBytes.buffer, { weight: '200 800' });
      face.load().then(loaded => document.fonts.add(loaded)).catch(() => {});
    } catch (_) { /* Native system typeface remains available. */ }
    try {
      pageAppearance = globalThis.ConvergePageAppearance?.create({ document, window, qaOrigin });
      pageAppearance?.setPaused(pageEffectsPaused);
      pageAppearance?.setTheme(chatTheme);
    } catch (_) { /* A decoration is optional; composer and file transport remain native. */ }
    module.exports.createBridge({ chrome: { runtime }, document, window,
      async downloadVisible({ element, runId, requestId, id, name, mimeType, signal, isCurrent }) {
        if (signal.aborted) return { ok: false, error: 'File export canceled.' };
        const started = await ipcRenderer.invoke('converge:download-begin', { runId, requestId, id, name, mimeType });
        if (!started?.ok) return started;
        const token = started.token;
        const cancel = () => { ipcRenderer.invoke('converge:download-cancel', { token }).catch(() => {}); };
        signal.addEventListener('abort', cancel, { once: true });
        try {
          if (signal.aborted) { cancel(); return await ipcRenderer.invoke('converge:download-read', { token }); }
          // Authorization yields to IPC. Recheck this exact captured action
          // and source before its one click; a React replacement must not be
          // clicked through or left waiting for a download that never starts.
          if (element?.isConnected !== true || element.disabled || element.getAttribute?.('aria-disabled') === 'true' ||
              typeof isCurrent !== 'function' || isCurrent() !== true) {
            throw new Error('The captured file action or source changed before the download click.');
          }
          element.click();
          let downloaded = await ipcRenderer.invoke('converge:download-read', { token });
          if (downloaded?.ok && downloaded.chunked === true) {
            if (!Number.isSafeInteger(downloaded.totalLength) || downloaded.totalLength < 1 || downloaded.totalLength > Math.ceil(128 * 1024 * 1024 / 3) * 4) throw new Error('Invalid native download length.');
            const chunks = []; let offset = 0;
            while (offset < downloaded.totalLength) {
              // The provider may consume its download control after the one
              // verified click. The owned native token now binds these bytes.
              if (signal.aborted) throw new Error('File export canceled.');
              const chunk = await ipcRenderer.invoke('converge:download-chunk', { token, offset });
              if (!chunk?.ok || typeof chunk.data !== 'string' || !chunk.data.length || chunk.data.length > 1024 * 1024 || offset + chunk.data.length > downloaded.totalLength) throw new Error(chunk?.error || 'Invalid native download chunk.');
              chunks.push(chunk.data); offset += chunk.data.length;
              if (chunk.done !== (offset === downloaded.totalLength)) throw new Error('Incomplete native file transfer.');
            }
            downloaded = { ok: true, mimeType: downloaded.mimeType, base64: chunks.join('') };
          }
          return downloaded?.ok ? { ...downloaded, sourceVerifiedAtClick: true } : downloaded;
        } catch (error) {
          cancel();
          await ipcRenderer.invoke('converge:download-read', { token }).catch(() => {});
          return { ok: false, error: error.message };
        }
        finally { signal.removeEventListener('abort', cancel); }
      }
    });
    ipcRenderer.send('converge:page-ready');
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
}
