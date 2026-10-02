'use strict';

// Electron 44 may install its platform runtime on the first require. Resolve it
// once before Node starts parallel test workers, so fresh installs cannot race
// several extractors writing into the same Electron distribution directory.
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

try {
  const executable = require('electron');
  if (typeof executable !== 'string' || !fs.statSync(executable).isFile()) throw new Error('The Electron test runtime is unavailable.');
  const argumentsFromCaller = process.argv.slice(2);
  // Several integration tests own Chromium windows. Bound simultaneous workers
  // to avoid GPU/teardown contention while retaining each test's real deadline.
  const concurrency = argumentsFromCaller.some(value => /^--test-concurrency(?:=|$)/.test(value)) ? [] : ['--test-concurrency=2'];
  const result = spawnSync(process.execPath, ['--test', ...concurrency, ...argumentsFromCaller], { stdio: 'inherit', env: process.env, windowsHide: true });
  if (result.error) throw result.error;
  process.exitCode = result.status == null ? 1 : result.status;
} catch (error) {
  process.stderr.write(`Test setup failed: ${error.stack || error.message}\n`);
  process.exitCode = 1;
}
