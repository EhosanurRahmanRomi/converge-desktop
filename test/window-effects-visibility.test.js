'use strict';

// Exercise native host visibility rather than assuming Chromium's page-hidden
// state follows a WebContentsView with its transport throttling disabled.
if (!process.versions.electron) {
  const test = require('node:test');
  const assert = require('node:assert/strict');
  const { spawn } = require('node:child_process');
  test('hidden/minimized desktop suspends decoration while both page bridges remain responsive', { timeout: 30000 }, async () => {
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const result = await new Promise((resolve, reject) => {
      const child = spawn(require('electron'), [__filename], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let output = '';
      child.stdout.on('data', chunk => { output += chunk; });
      child.stderr.on('data', chunk => { output += chunk; });
      const timeout = setTimeout(() => { child.kill(); reject(new Error('Host visibility test timed out.\n' + output)); }, 26000);
      child.on('error', error => { clearTimeout(timeout); reject(error); });
      child.on('close', code => { clearTimeout(timeout); resolve({ code, output }); });
    });
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /PASS: native host decoration suspension and background page bridges/);
  });
} else {
  const assert = require('node:assert/strict');
  const fs = require('node:fs');
  const path = require('node:path');
  const { app } = require('electron');
  const { createCookieApp } = require('../desktop-main');
  const { createFixtureServer } = require('../scripts/qa-desktop-fixture');
  app.setPath('userData', fs.mkdtempSync(path.join(app.getPath('temp'), 'converge-visibility-qa-')));
  const settle = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function run() {
    let desktop;
    const fixture = await createFixtureServer();
    try {
      desktop = await createCookieApp({ qaOrigin: fixture.origin, show: false, legacyCoordinator: true });
      const shell = code => desktop.mainWindow.webContents.executeJavaScript(code);
      const scene = side => desktop.views[side].webContents.executeJavaScriptInIsolatedWorld(999, [{ code: 'globalThis.ConvergePageAppearance.create().diagnostics()' }]);
      const ribbons = () => shell('ConvergeStarRibbons.diagnostics()');
      const showTestWindow = () => {
        if (process.platform === 'darwin') {
          // A native macOS visible-window phase must bring the app forward;
          // showInactive can leave it occluded behind another GUI fixture.
          app.focus({ steal: true }); desktop.mainWindow.show(); desktop.mainWindow.focus();
        } else desktop.mainWindow.showInactive();
      };
      const frames = async () => (await ribbons()).map(item => item.frames);
      const allPaused = async expected => {
        const items = await ribbons();
        return items.length === 2 && items.every(item => item.paused === expected);
      };
      const waitFor = async condition => {
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) { if (await condition()) return; await settle(30); }
        throw new Error('Host decoration condition did not settle: ' + JSON.stringify({
          visible: desktop.mainWindow.isVisible(), minimized: desktop.mainWindow.isMinimized(),
          renderer: await shell("({hidden:document.hidden,reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches,bodyClass:document.body.className})"),
          ribbons: await ribbons(),
        }));
      };
      const settledFrames = async () => {
        // Native minimize can deliver a final viewport/ResizeObserver update
        // after the pause acknowledgment. A paused resize redraws one static
        // frame. Wait for that layout to settle before checking ongoing work.
        const deadline = Date.now() + 3000;
        let previous = null, quietSince = Date.now();
        while (Date.now() < deadline) {
          const current = await frames();
          if (!previous || current.some((value, index) => value !== previous[index])) quietSince = Date.now();
          else if (Date.now() - quietSince >= 250) return current;
          previous = current; await settle(40);
        }
        throw new Error('Paused scene kept rendering after the native viewport settled.');
      };
      const cookie = JSON.stringify([{ domain: '.chatgpt.com', path: '/', secure: true, name: 'converge_visibility_fixture', value: 'local-test-only' }]);
      await shell(`window.convergeBrowser.importCookies(${JSON.stringify(cookie)})`);
      await desktop.openPages({ chatMode: 'normal' });
      // Native visibility must be the only pause reason in this fixture.
      // The app still honors the real OS preference in production; these
      // loaded isolated contents emulate a known preference for this test.
      for (const contents of [desktop.mainWindow.webContents, ...Object.values(desktop.views).map(view => view.webContents)]) {
        contents.debugger.attach('1.3');
        await contents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
      }
      assert.equal(await shell("matchMedia('(prefers-reduced-motion: reduce)').matches"), false);
      for (const side of ['left', 'right']) assert.equal(await desktop.views[side].webContents.executeJavaScript("matchMedia('(prefers-reduced-motion: reduce)').matches"), false);
      await waitFor(() => allPaused(true));
      assert.deepEqual((await ribbons()).map(item => item.band).sort(), ['bottom', 'top']);
      for (const side of ['left', 'right']) {
        assert.equal((await scene(side)).animated, false);
        assert.equal((await scene(side)).paused, true);
      }
      assert.equal(await shell("document.body.classList.contains('document-hidden')"), true);
      const hiddenFrames = await settledFrames();
      await settle(300);
      assert.deepEqual(await frames(), hiddenFrames);
      for (const side of ['left', 'right']) assert.equal((await desktop.sendToPage(side, { type: 'INSPECT', chatMode: 'normal' })).ok, true);

      showTestWindow();
      if (process.platform === 'darwin') await waitFor(() => desktop.mainWindow.isFocused());
      await waitFor(() => allPaused(false));
      assert.equal(await shell("document.body.classList.contains('document-hidden')"), false);
      const visibleFrames = await frames();
      await waitFor(async () => (await frames()).every((value, index) => value > visibleFrames[index]));
      for (const side of ['left', 'right']) assert.equal((await scene(side)).effectsSuppressed, false);

      desktop.mainWindow.minimize();
      await waitFor(() => allPaused(true));
      assert.equal(await shell("document.body.classList.contains('document-hidden')"), true);
      const minimizedFrames = await settledFrames();
      await settle(300);
      assert.deepEqual(await frames(), minimizedFrames);
      for (const side of ['left', 'right']) assert.equal((await desktop.sendToPage(side, { type: 'INSPECT', chatMode: 'normal' })).ok, true);

      desktop.mainWindow.restore();
      await waitFor(() => allPaused(false));
      await shell("document.getElementById('effectsButton').click()");
      await waitFor(() => allPaused(true));
      desktop.mainWindow.hide(); showTestWindow();
      await settle(220);
      assert.equal((await scene('left')).paused, true);
      assert.equal((await scene('right')).paused, true);
      assert.equal(await shell("localStorage.getItem('converge.galaxy.effectsPaused')"), 'true');
      assert.equal(await shell("document.getElementById('effectsButton').getAttribute('aria-pressed')"), 'true');
      assert.equal(await shell("document.getElementById('animationEnabled').checked"), false);
      await shell("document.getElementById('animationEnabled').click()");
      await waitFor(() => allPaused(false));
      assert.equal(await shell("localStorage.getItem('converge.galaxy.effectsPaused')"), 'false');
      assert.equal(await shell("document.getElementById('effectsButton').getAttribute('aria-pressed')"), 'false');
      const resumed = await frames();
      await waitFor(async () => (await frames()).every((value, index) => value > resumed[index]));
      for (const side of ['left', 'right']) assert.equal((await scene(side)).paused, true);
      process.stdout.write('PASS: native host decoration suspension and background page bridges\n');
    } finally { desktop?.mainWindow.destroy(); await fixture.close(); }
  }
  app.whenReady().then(run).then(() => app.exit(0)).catch(error => { process.stderr.write(error.stack + '\n'); app.exit(1); });
}
