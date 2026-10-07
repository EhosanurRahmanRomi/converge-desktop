'use strict';

const { spawn } = require('node:child_process');
const DEFAULT_TIMEOUT = 15_000;
const MAX_OUTPUT = 32_768;

function checkerEnvironment() {
  const result = {};
  for (const name of ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE']) {
    if (process.env[name]) result[name] = process.env[name];
  }
  // Electron's own executable can safely run the trusted parsing worker as
  // Node; NODE_OPTIONS and Python startup hooks never reach checker children.
  result.ELECTRON_RUN_AS_NODE = '1';
  return result;
}

function runProcess(executable, args, { cwd, timeoutMs = DEFAULT_TIMEOUT, maxOutput = MAX_OUTPUT, env = checkerEnvironment(), input, signal } = {}) {
  return new Promise(resolve => {
    let child, stdout = '', stderr = '', outputSize = 0, timedOut = false, outputLimited = false, settled = false, aborted = false;
    const abort = () => { aborted = true; child?.kill('SIGKILL'); };
    const finish = value => {
      if (settled) return; settled = true; clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      resolve({ ...value, stdout, stderr, timedOut, outputLimited, aborted });
    };
    let timer;
    if (signal?.aborted) { aborted = true; finish({ code: null }); return; }
    try { child = spawn(executable, args, { cwd, env, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }); }
    catch (error) { finish({ code: null, error: error.message, unavailable: true }); return; }
    timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, Math.min(Math.max(timeoutMs, 50), 120_000));
    signal?.addEventListener('abort', abort, { once: true });
    const append = field => chunk => {
      outputSize += chunk.length;
      const text = chunk.toString('utf8');
      if (field === 'stdout') stdout = (stdout + text).slice(0, maxOutput);
      else stderr = (stderr + text).slice(0, maxOutput);
      if (outputSize > maxOutput && !outputLimited) { outputLimited = true; child.kill('SIGKILL'); }
    };
    child.stdout.on('data', append('stdout')); child.stderr.on('data', append('stderr'));
    child.on('error', error => finish({ code: null, error: error.message, unavailable: error.code === 'ENOENT' || error.code === 'EACCES' }));
    child.on('close', (code, signal) => finish({ code, signal }));
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

module.exports = { checkerEnvironment, runProcess, DEFAULT_TIMEOUT, MAX_OUTPUT };
