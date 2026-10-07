'use strict';

const { randomUUID } = require('node:crypto');
const { runProcess, checkerEnvironment } = require('./process-runner');
const IMAGES = Object.freeze({ javascript: 'converge-verification-node:1', python: 'converge-verification-python:1' });

function buildContainerCommand({ directory, language, testFiles, name }) {
  if (!IMAGES[language] || typeof directory !== 'string' || /[,\r\n]/.test(directory) || !/^converge-check-[a-f0-9-]+$/.test(name)) throw new Error('Container configuration is invalid.');
  const args = ['run', '--rm', '--pull', 'never', '--name', name, '--network', 'none', '--read-only',
    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--pids-limit', '64', '--memory', '256m', '--memory-swap', '256m',
    '--cpus', '0.5', '--user', '65534:65534', '--workdir', '/workspace',
    '--tmpfs', '/tmp:rw,noexec,nosuid,nodev,size=32m', '--mount', `type=bind,source=${directory},target=/workspace,readonly`, IMAGES[language]];
  if (language === 'javascript') {
    if (!Array.isArray(testFiles) || !testFiles.length || testFiles.some(name => !/^[a-z0-9_. -]+\.test\.(?:js|mjs|cjs)$/i.test(name) || name.startsWith('-'))) throw new Error('No supported Node test files.');
    args.push('node', '--test', ...testFiles.map(name => `/workspace/${name}`));
  } else args.push('python', '-I', '-B', '-m', 'unittest', 'discover', '-s', '/workspace', '-p', 'test_*.py');
  return args;
}

async function runContainerTests({ directory, files, dockerExecutable = 'docker', timeoutMs = 30_000, processRunner = runProcess, signal }) {
  const results = [], env = checkerEnvironment();
  // Preserve only Docker's selected local connection settings, not the host's
  // model/browser credentials. Images must already be installed by the user.
  for (const key of ['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_CONFIG', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH']) if (process.env[key]) env[key] = process.env[key];
  const languages = [];
  const nodeTests = files.map(file => file.name).filter(name => /\.test\.(?:js|mjs|cjs)$/i.test(name));
  if (nodeTests.length) languages.push('javascript');
  if (files.some(file => /^test_.*\.py$/i.test(file.name))) languages.push('python');
  if (!languages.length) return [{ id: 'container-tests', label: 'Isolated test execution', status: 'unverified', evidence: 'No *.test.js / *.test.mjs / *.test.cjs or test_*.py test files were supplied.' }];
  for (const language of languages) {
    const image = IMAGES[language], label = `${language === 'javascript' ? 'Node' : 'Python'} tests in isolated container`;
    const inspect = await processRunner(dockerExecutable, ['image', 'inspect', '--format', '{{.Id}}', image], { env, timeoutMs: 5_000, signal });
    if (inspect.aborted || signal?.aborted) { results.push({ id: `container-tests:${language}`, label, status: 'unverified', evidence: 'Container verification was cancelled before execution.' }); break; }
    if (inspect.unavailable || inspect.code !== 0 || inspect.timedOut || inspect.outputLimited || !/^sha256:[a-f0-9]{64}\s*$/.test(inspect.stdout)) {
      results.push({ id: `container-tests:${language}`, label, status: 'unverified', evidence: `Not executed: Docker or the fixed local image ${image} is unavailable. Images are never pulled. ${inspect.error || inspect.stderr || ''}`.slice(0, 4_000) });
      continue;
    }
    const name = `converge-check-${randomUUID()}`;
    const args = buildContainerCommand({ directory, language, testFiles: nodeTests, name });
    // Use the inspected immutable image ID to prevent a local tag change
    // between the availability check and execution from swapping the image.
    args[args.indexOf(image)] = inspect.stdout.trim();
    const run = await processRunner(dockerExecutable, args, { env, timeoutMs, signal });
    if (run.timedOut || run.outputLimited || run.code === null) {
      await processRunner(dockerExecutable, ['kill', name], { env, timeoutMs: 5_000 });
      await processRunner(dockerExecutable, ['rm', '--force', name], { env, timeoutMs: 5_000 });
    }
    results.push({ id: `container-tests:${language}`, label, status: run.unavailable || run.aborted ? 'unverified' : run.code === 0 && !run.timedOut && !run.outputLimited ? 'passed' : 'failed',
      evidence: `${run.aborted ? 'Execution cancelled. ' : ''}${run.timedOut ? 'Execution timed out. ' : ''}${run.outputLimited ? 'Execution exceeded the log limit. ' : ''}Image ${inspect.stdout.trim()}; exit ${run.code}.\n${run.stdout}${run.stderr}${run.error || ''}`.slice(0, 32_768),
      isolation: { network: 'none', rootFilesystem: 'read-only', capabilities: 'none', noNewPrivileges: true, memoryMB: 256, cpu: 0.5, processLimit: 64, input: 'read-only disposable copy' } });
  }
  return results;
}

module.exports = { IMAGES, buildContainerCommand, runContainerTests };
