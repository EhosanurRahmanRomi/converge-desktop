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
        if (!['night', 'horror', 'alien'].includes(value) || disposed) return false;
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
