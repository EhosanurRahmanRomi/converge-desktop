'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { extractPdfText } = require('./pdf');

const NATIVE_BIN = path.join('vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe');
const MAX_OUTPUT_BYTES = 512 * 1024;
const MAX_TEXT_CHARS = 200_000;

async function fileExists(file) {
  try {
    const stat = await fs.stat(file);
    return stat.isFile();
  } catch {
    return false;
  }
}

function candidatePaths() {
  const candidates = [];
  if (process.resourcesPath) candidates.push(path.join(process.resourcesPath, 'bin', 'codex.exe'));
  candidates.push(path.resolve(__dirname, '..', '..', 'node_modules', '@openai', 'codex-win32-x64', NATIVE_BIN));
  if (process.env.APPDATA) {
    candidates.push(path.join(process.env.APPDATA, 'npm', 'node_modules', '@openai', 'codex', 'node_modules', '@openai', 'codex-win32-x64', NATIVE_BIN));
    candidates.push(path.join(process.env.APPDATA, 'npm', 'node_modules', '@openai', 'codex-win32-x64', NATIVE_BIN));
  }
  return candidates;
}

async function findCodexCli() {
  for (const candidate of candidatePaths()) {
    if (await fileExists(candidate)) return candidate;
  }
  return null;
}

function runProcess(executable, args, { input = '', cwd, signal, maxOutputBytes = MAX_OUTPUT_BYTES } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(executable, args, {
        cwd,
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, NO_COLOR: '1' }
      });
    } catch (error) {
      reject(error);
      return;
    }
    let stdout = '';
    let stderr = '';
    let settled = false;
    const onAbort = () => child.kill();
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }
    const append = (kind, chunk) => {
      const text = chunk.toString('utf8');
      if (kind === 'stdout') stdout = (stdout + text).slice(-maxOutputBytes);
      else stderr = (stderr + text).slice(-maxOutputBytes);
    };
    child.stdout.on('data', (chunk) => append('stdout', chunk));
    child.stderr.on('data', (chunk) => append('stderr', chunk));
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      if (signal) signal.removeEventListener('abort', onAbort);
      reject(error);
    });
    child.on('close', (code, terminationSignal) => {
      if (settled) return;
      settled = true;
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve({ code, terminationSignal, stdout, stderr });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

async function getCodexStatus() {
  const cliPath = await findCodexCli();
  if (!cliPath) return { available: false, loggedIn: false };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const result = await runProcess(cliPath, ['login', 'status'], { maxOutputBytes: 8 * 1024, signal: controller.signal });
    const output = result.stdout + result.stderr;
    return { available: true, loggedIn: result.code === 0 && /logged in using/i.test(output) && !/not logged in/i.test(output), cliPath };
  } catch {
    return { available: true, loggedIn: false, cliPath };
  } finally {
    clearTimeout(timeout);
  }
}

function decodeAttachment(item) {
  if (!item || typeof item !== 'object') throw new TypeError('Invalid attachment.');
  const { kind, name, mimeType, dataUrl } = item;
  if (!['image', 'text', 'file'].includes(kind) || typeof name !== 'string' || !name ||
      typeof mimeType !== 'string' || typeof dataUrl !== 'string') throw new TypeError('Invalid attachment.');
  const prefix = `data:${mimeType};base64,`;
  if (!dataUrl.startsWith(prefix)) throw new TypeError(`Invalid data for ${name}.`);
  return Buffer.from(dataUrl.slice(prefix.length), 'base64');
}

function safeAttachmentName(name, index) {
  const ext = path.extname(name).slice(0, 12).replace(/[^a-zA-Z0-9.]/g, '');
  return `attachment-${index + 1}${ext}`;
}

async function createInput(prompt, attachments, workDir) {
  const imagePaths = [];
  const sourceParts = [];
  for (let i = 0; i < attachments.length; i += 1) {
    const item = attachments[i];
    const bytes = decodeAttachment(item);
    if (item.kind === 'file') {
      if (item.mimeType !== 'application/pdf') throw new Error(`The Codex connection cannot read ${item.name}.`);
      const pdfText = await extractPdfText(bytes);
      sourceParts.push(`Source attachment ${i + 1}: ${item.name}\n<source_file>\n${pdfText}\n</source_file>`);
      continue;
    }
    if (item.kind === 'image') {
      const imagePath = path.join(workDir, safeAttachmentName(item.name, i));
      await fs.writeFile(imagePath, bytes);
      imagePaths.push(imagePath);
    } else {
      const content = bytes.toString('utf8');
      if (content.length > MAX_TEXT_CHARS) throw new Error(`${item.name} has too much text for one Codex request.`);
      sourceParts.push(`Source attachment ${i + 1}: ${item.name}\n<source_file>\n${content}\n</source_file>`);
    }
  }
  const input = sourceParts.length ? `${prompt}\n\n${sourceParts.join('\n\n')}` : prompt;
  return { input, imagePaths };
}

function validateRequest({ model, effort, instructions, inputText, attachments, schema }) {
  if (typeof model !== 'string' || !/^[a-zA-Z0-9._:-]{1,100}$/.test(model)) throw new TypeError('A valid model ID is required.');
  if (!['low', 'medium', 'high', 'xhigh', 'max', 'ultra'].includes(effort)) throw new TypeError('A valid reasoning effort is required.');
  if (typeof instructions !== 'string' || typeof inputText !== 'string') throw new TypeError('Instructions and input text are required.');
  if (!Array.isArray(attachments)) throw new TypeError('Attachments must be an array.');
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) throw new TypeError('A JSON schema is required.');
}

async function removeWorkDir(workDir, tempBase) {
  if (!workDir) return;
  const absoluteBase = path.resolve(tempBase);
  const absoluteWork = path.resolve(workDir);
  if (!absoluteWork.startsWith(absoluteBase + path.sep)) throw new Error('Refusing to clean an unexpected temporary path.');
  await fs.rm(absoluteWork, { recursive: true, force: true });
}

function createCodexClient(cliPath, { run = runProcess } = {}) {
  if (typeof cliPath !== 'string' || !path.isAbsolute(cliPath)) throw new TypeError('A native Codex CLI path is required.');
  return {
    async requestStructured({ model, effort, instructions, inputText, attachments = [], schema, signal } = {}) {
      validateRequest({ model, effort, instructions, inputText, attachments, schema });
      if (signal?.aborted) throw new Error('Request cancelled.');
      const tempBase = path.join(os.tmpdir(), 'converge-codex');
      await fs.mkdir(tempBase, { recursive: true });
      let workDir;
      try {
        workDir = await fs.mkdtemp(path.join(tempBase, 'turn-'));
        const schemaPath = path.join(workDir, 'schema.json');
        const outputPath = path.join(workDir, 'response.json');
        await fs.writeFile(schemaPath, JSON.stringify(schema), 'utf8');
        const prompt = `You are answering as one independent analyst in a two-analyst review process. ${instructions}\n\n${inputText}\n\nReturn only a JSON object matching the provided output schema. Do not include Markdown or commentary outside the JSON. Do not modify files or run commands.`;
        const { input, imagePaths } = await createInput(prompt, attachments, workDir);
        const args = [
          'exec', '--ephemeral', '--ignore-user-config', '--ignore-rules',
          '--skip-git-repo-check', '--sandbox', 'read-only', '--cd', workDir,
          '--model', model, '--config', `model_reasoning_effort="${effort}"`,
          '--output-schema', schemaPath, '--output-last-message', outputPath
        ];
        for (const imagePath of imagePaths) args.push('--image', imagePath);
        args.push('-');
        const result = await run(cliPath, args, { input, cwd: workDir, signal });
        if (signal?.aborted) throw new Error('Request cancelled.');
        if (result.code !== 0) {
          if (/usage limit|usage_limit|rate limit/i.test(result.stderr)) throw new Error('Codex account usage limit reached. Try again after your limit resets.');
          if (/not logged in|sign in|authentication/i.test(result.stderr)) throw new Error('Codex CLI is not signed in with ChatGPT.');
          if (/model is not supported when using Codex with a ChatGPT account|unsupported model/i.test(result.stderr)) {
            throw new Error(`The ${model} model is not available through this Codex account. Choose another model ID.`);
          }
          if (/connection failed|network|socket/i.test(result.stderr)) throw new Error('Codex could not connect to OpenAI. Check your internet connection.');
          throw new Error(`Codex CLI could not finish this model request (exit ${result.code ?? 'unknown'}).`);
        }
        let raw;
        try {
          raw = await fs.readFile(outputPath, 'utf8');
        } catch {
          raw = result.stdout;
        }
        let data;
        try {
          data = JSON.parse(raw.trim());
        } catch {
          throw new Error('Codex returned an answer that did not match the requested JSON format.');
        }
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Codex returned an invalid structured answer.');
        return { data, usage: null };
      } finally {
        await removeWorkDir(workDir, tempBase);
      }
    }
  };
}

module.exports = { findCodexCli, getCodexStatus, createCodexClient };
