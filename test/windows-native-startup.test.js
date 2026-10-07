'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { validateWindowsSmoke } = require('../scripts/qa-native-windows-startup');

test('native Windows startup evidence binds the actual portable wrapper and all lifecycle gates', () => {
  const executable = path.resolve('Converge-Portable-1.8.2-x64.exe');
  const report = { status: 'PASS', platform: 'win32', arch: 'x64', packaged: true,
    version: '1.8.2', nonce: 'owned-smoke', pid: 12345, portableExecutable: executable,
    executable: path.resolve('extracted/Converge.exe'), userData: path.resolve('converge-native-smoke-12345-aabbcc'),
    visibleShell: true, firstPaint: true, embeddedViews: ['left', 'right', 'boss'],
    sidebarToggleVerified: true, bossDrawerVerified: true, progressSectionVerified: true,
    didClose: true, embeddedViewsDisposed: true, closeCleanupCompleted: true, isolatedSession: true,
    providerScope: 'Empty isolated session; no authentication, provider navigation or live model task',
    clipboardScope: 'The Windows startup smoke does not access the clipboard' };
  assert.equal(validateWindowsSmoke(report, '1.8.2', executable, 'owned-smoke'), true);
  for (const changed of [{ nonce: 'stale' }, { version: '1.8.1' }, { portableExecutable: path.resolve('Other.exe') },
    { isolatedSession: false }, { progressSectionVerified: false }, { embeddedViewsDisposed: false },
    { closeCleanupCompleted: false }, { visibleShell: false }, { firstPaint: false },
    { embeddedViews: ['left', 'right'] }, { userData: path.resolve('real-user-profile') }]) {
    assert.throws(() => validateWindowsSmoke({ ...report, ...changed }, '1.8.2', executable, 'owned-smoke'));
  }
});
