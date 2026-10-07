'use strict';

const fs = require('node:fs/promises');
const { isStoredFile, verifyStoredFile, copyStoredFile, readFileHead } = require('../browser/file-store');
const os = require('node:os');
const path = require('node:path');
const { normalizeCandidate, fileDescriptor } = require('./identity');
const { runProcess } = require('./process-runner');
const { runContainerTests } = require('./container-tests');
const { validateTextSource } = require('../browser/files');

const TEXT_LIMIT = 16 * 1024 * 1024;
const PYTHON_AST = 'import ast,sys,tokenize\nwith tokenize.open(sys.argv[1]) as source:\n    ast.parse(source.read(), filename=sys.argv[1])\nprint("Python AST syntax parsed; candidate code was not executed.")';
function unicodeText(bytes, bomMarked = false) {
  const encoding = bomMarked && bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le'
    : bomMarked && bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8';
  return new TextDecoder(encoding, { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
}

function parseCSV(text) {
  const firstLine = text.split(/\r?\n/, 1)[0];
  const delimiter = firstLine.includes(',') ? ',' : firstLine.includes('\t') ? '\t' : firstLine.includes(';') ? ';' : ',';
  return parseDelimited(text, delimiter, 'CSV');
}

function parseTSV(text) {
  return parseDelimited(text, '\t', 'TSV');
}

function parseDelimited(text, delimiter, format) {
  let rows = 0, columns = null, cells = 0, quoted = false, closedQuote = false, fieldStarted = false, at = 0;
  const finishRow = () => {
    cells += 1; rows += 1;
    if (columns === null) columns = cells;
    if (cells !== columns) throw new Error(`${format} row ${rows} has ${cells} columns; expected ${columns}.`);
    if (rows > 200_000) throw new Error(`${format} exceeds the 200,000 row verification limit.`);
    cells = 0; fieldStarted = false; closedQuote = false;
  };
  while (at < text.length) {
    const char = text[at++];
    if (quoted) {
      if (char === '"') {
        if (text[at] === '"') at += 1;
        else { quoted = false; closedQuote = true; }
      }
      continue;
    }
    if (char === delimiter) { cells += 1; fieldStarted = false; closedQuote = false; if (cells > 10_000) throw new Error(`${format} has too many columns.`); }
    else if (char === '\r' || char === '\n') { if (char === '\r' && text[at] === '\n') at += 1; finishRow(); }
    else if (char === '"') { if (fieldStarted || closedQuote) throw new Error(`${format} has a misplaced quote.`); quoted = true; fieldStarted = true; }
    else { if (closedQuote) throw new Error(`${format} has text after a closing quote.`); fieldStarted = true; }
  }
  if (quoted) throw new Error(`${format} has an unterminated quoted field.`);
  if (cells || fieldStarted || closedQuote) finishRow();
  if (!rows) throw new Error(`${format} has no rows.`);
  return { rows, columns, delimiter: delimiter === '\t' ? 'tab' : delimiter };
}

function markdownLinks(text, names) {
  const destinations = [...text.matchAll(/!?\[[^\]\n]*\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+["'][^\n]*["'])?\s*\)/g)].map(match => match[1] || match[2]);
  const missing = [], unsafe = [], external = [];
  let local = 0;
  for (const raw of destinations) {
    if (/^(?:https?:|mailto:)/i.test(raw)) { external.push(raw); continue; }
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith('//')) { unsafe.push(raw); continue; }
    if (raw.startsWith('#')) continue;
    let target;
    try { target = decodeURIComponent(raw.split(/[?#]/, 1)[0]).replace(/^\.\//, ''); } catch (_) { missing.push(raw); continue; }
    if (!names.has(target)) missing.push(raw); else local += 1;
  }
  return { local, missing, unsafe, external };
}

function resultStatus(checks) {
  return checks.some(check => check.status === 'failed') ? 'failed' : checks.some(check => check.status === 'unverified') ? 'unverified' : 'passed';
}

function declaredImageSize(bytes, extension) {
  // Reject oversized advertised dimensions before invoking a native decoder,
  // which otherwise could allocate memory before getSize() is available.
  let width, height;
  if (extension === '.png' && bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    width = bytes.readUInt32BE(16); height = bytes.readUInt32BE(20);
  } else if (extension === '.gif' && bytes.length >= 10 && /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString())) {
    width = bytes.readUInt16LE(6); height = bytes.readUInt16LE(8);
  } else if (extension === '.bmp' && bytes.length >= 26 && bytes.toString('ascii', 0, 2) === 'BM') {
    width = bytes.readInt32LE(18); height = Math.abs(bytes.readInt32LE(22));
  } else if (['.jpg', '.jpeg'].includes(extension) && bytes[0] === 255 && bytes[1] === 216) {
    let at = 2;
    while (at + 4 <= bytes.length) {
      if (bytes[at++] !== 255) break;
      while (bytes[at] === 255) at += 1;
      const marker = bytes[at++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (at + 2 > bytes.length) break;
      const length = bytes.readUInt16BE(at);
      if (length < 2 || at + length > bytes.length) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && length >= 7) {
        height = bytes.readUInt16BE(at + 3); width = bytes.readUInt16BE(at + 5); break;
      }
      at += length;
    }
  } else if (extension === '.webp' && bytes.length >= 30 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    const format = bytes.toString('ascii', 12, 16);
    if (format === 'VP8X') { width = bytes.readUIntLE(24, 3) + 1; height = bytes.readUIntLE(27, 3) + 1; }
    else if (format === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) { width = bytes.readUInt16LE(26) & 0x3fff; height = bytes.readUInt16LE(28) & 0x3fff; }
    else if (format === 'VP8L' && bytes[20] === 0x2f) { const size = bytes.readUInt32LE(21); width = (size & 0x3fff) + 1; height = ((size >>> 14) & 0x3fff) + 1; }
  }
  if (width !== undefined && (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width * height > 50_000_000)) throw new Error('Declared image dimensions exceed the 50 megapixel verification limit or are invalid.');
  return width === undefined ? null : { width, height };
}

async function runVerificationLab({ candidate, nodeExecutable = process.execPath, pythonExecutable, nativeImage, pdfParser,
  testMode = 'static', dockerExecutable = 'docker', timeoutMs = 15_000, processRunner = runProcess, signal } = {}) {
  const startedAt = new Date().toISOString();
  let current;
  try { current = normalizeCandidate(candidate); }
  catch (error) {
    return { status: 'failed', candidateId: candidate?.id || null, candidateSha256: candidate?.sha256 || null, startedAt,
      finishedAt: new Date().toISOString(), checks: [{ id: 'candidate-identity', label: 'Exact candidate identity', status: 'failed', source: 'executed', requirementId: 'artifact-integrity', evidence: error.message }],
      summary: 'Candidate identity could not be verified. No file checks ran.' };
  }
  const checks = [], fileIdentities = current.files.map(fileDescriptor);
  const add = check => {
    const result = { source: 'executed', candidateSha256: current.sha256, ...check };
    const evidence = String(result.evidence || '');
    // The coordinator accepts at most 16,000 characters per check. Preserve
    // real failure/timeout status even when a parser emits a very long log.
    result.evidence = evidence.length > 16_000 ? `${evidence.slice(0, 15_945)}\n[Diagnostic log truncated to the report limit.]` : evidence;
    checks.push(result);
  };
  try { for (const file of current.files) if (isStoredFile(file)) await verifyStoredFile(file, { signal }); }
  catch (error) { add({ id: 'candidate-identity', label: 'Exact candidate identity', status: signal?.aborted ? 'unverified' : 'failed', requirementId: 'artifact-integrity', evidence: error.message }); return { status: signal?.aborted ? 'unverified' : 'failed', candidateId: current.id, candidateSha256: current.sha256, files: fileIdentities, startedAt, finishedAt: new Date().toISOString(), checks }; }
  add({ id: 'candidate-identity', label: 'Exact candidate identity', status: 'passed', requirementId: 'artifact-integrity', evidence: `Recomputed candidate ${current.id} SHA-256 ${current.sha256} and ${current.files.length} exact file identities. Disk-backed files were hashed incrementally.`, files: fileIdentities });
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'converge-verification-'));
  try {
    await fs.chmod(directory, 0o755);
    for (const file of current.files) {
      if (isStoredFile(file)) {
        if (file.byteLength <= TEXT_LIMIT || /\.pdf$/i.test(file.name) && file.byteLength <= 64 * 1024 * 1024 || testMode === 'container-tests') {
          await copyStoredFile(file, path.join(directory, file.name), { signal }); await fs.chmod(path.join(directory, file.name), 0o444);
        }
      } else await fs.writeFile(path.join(directory, file.name), file.bytes, { mode: 0o444, flag: 'wx' });
    }
    for (const file of current.files) {
      if (signal?.aborted) { add({ id: 'verification-cancelled', label: 'Verification coverage', status: 'unverified', evidence: 'Verification was cancelled; remaining file checks were not run.' }); break; }
      const extension = path.extname(file.name).toLowerCase(), filename = path.join(directory, file.name);
      const base = { fileName: file.name, contentSha256: file.contentSha256, byteLength: file.byteLength };
      const checkFileId = file.name.length <= 140 ? file.name : `${file.name.slice(0, 110)}-${require('./identity').sha256(file.name).slice(0, 12)}`;
      const record = (id, label, status, evidence, extras = {}) => add({ ...base, id: `${id}:${checkFileId}`, label, status, evidence,
        requirementId: ['javascript-syntax', 'python-syntax'].includes(id) ? 'source-validation' : 'artifact-integrity', ...extras });
      try {
        if (['.js', '.mjs', '.cjs'].includes(extension)) {
          if (file.byteLength > TEXT_LIMIT) { record('javascript-syntax', 'JavaScript syntax', 'unverified', 'File exceeds the 16 MB syntax parsing limit.'); continue; }
          if (!nodeExecutable) { record('javascript-syntax', 'JavaScript syntax', 'unverified', 'No trusted Node interpreter is configured.'); continue; }
          const run = await processRunner(nodeExecutable, ['--check', filename], { cwd: directory, timeoutMs, signal });
          record('javascript-syntax', 'JavaScript syntax', run.unavailable || run.aborted ? 'unverified' : run.code === 0 && !run.timedOut && !run.outputLimited ? 'passed' : 'failed',
            `${run.aborted ? 'Syntax check cancelled. ' : ''}${run.timedOut ? 'Syntax check timed out. ' : ''}${run.outputLimited ? 'Log limit exceeded. ' : ''}${run.error || run.stderr || run.stdout || (run.aborted ? 'No completed syntax evidence.' : 'Node parsed syntax successfully; candidate code was not executed.')}`,
            { exitCode: run.code, timedOut: run.timedOut, outputLimited: run.outputLimited });
        } else if (extension === '.py') {
          if (file.byteLength > TEXT_LIMIT) { record('python-syntax', 'Python syntax', 'unverified', 'File exceeds the 16 MB syntax parsing limit.'); continue; }
          if (!pythonExecutable) { record('python-syntax', 'Python syntax', 'unverified', 'No trusted Python interpreter is configured.'); continue; }
          const run = await processRunner(pythonExecutable, ['-I', '-S', '-B', '-c', PYTHON_AST, filename], { cwd: directory, timeoutMs, signal });
          record('python-syntax', 'Python syntax', run.unavailable || run.aborted ? 'unverified' : run.code === 0 && !run.timedOut && !run.outputLimited ? 'passed' : 'failed',
            `${run.aborted ? 'Syntax check cancelled. ' : ''}${run.timedOut ? 'Syntax check timed out. ' : ''}${run.outputLimited ? 'Log limit exceeded. ' : ''}${run.error || run.stderr || run.stdout}`, { exitCode: run.code, timedOut: run.timedOut, outputLimited: run.outputLimited });
        } else if (['.json', '.csv', '.tsv', '.md', '.txt', '.html', '.css', '.xml', '.yaml', '.yml', '.toml'].includes(extension)) {
          if (file.byteLength > TEXT_LIMIT) { record('text-structure', 'Text structure', 'unverified', 'File exceeds the 16 MB local text parsing limit.'); continue; }
          if (isStoredFile(file)) file.bytes = await readFileHead(file, TEXT_LIMIT);
          if (extension === '.tsv') validateTextSource(file.name, file.mimeType, file.bytes);
          const text = unicodeText(file.bytes, extension === '.tsv');
          if (extension === '.json') { JSON.parse(text); record('json-parse', 'JSON parsing', 'passed', 'Strict UTF-8 decoding and JSON parsing succeeded.'); }
          else if (extension === '.csv') {
            const parsed = parseCSV(text); record('csv-parse', 'CSV structure', 'passed', `Parsed ${parsed.rows} rows, ${parsed.columns} consistent columns, delimiter ${parsed.delimiter}.`);
          } else if (extension === '.tsv') {
            const parsed = parseTSV(text); record('tsv-parse', 'TSV structure', 'passed', `Parsed ${parsed.rows} rows, ${parsed.columns} consistent columns, delimiter tab. Unicode text and exact byte identity were checked; cells were not executed.`);
          } else if (extension === '.md') {
            const links = markdownLinks(text, new Set(current.files.map(item => item.name)));
            record('markdown-links', 'Markdown local links', links.missing.length || links.unsafe.length ? 'failed' : 'passed',
              `Decoded UTF-8; ${links.local} local file links found. ${links.missing.length ? `Missing: ${links.missing.join(', ')}. ` : ''}${links.unsafe.length ? `Unsupported or unsafe links: ${links.unsafe.join(', ')}.` : ''}`,
              { scope: 'Inline link destinations and local file existence; headings and reference links are not checked.' });
            if (links.external.length) record('markdown-remote-links', 'External link availability', 'unverified', `${links.external.length} external links were recorded but not requested or fetched.`, { links: links.external.slice(0, 100) });
          } else record('unicode-text', 'Readable text', 'passed', 'Strict UTF-8 decoding succeeded. Language validity and rendered appearance were not checked.');
        } else if (extension === '.pdf') {
          if (file.byteLength > 64 * 1024 * 1024) { record('pdf-structure', 'PDF page structure', 'unverified', 'Exact bytes were hashed, but this PDF exceeds the 64 MB bounded local parsing and rendering limit.'); continue; }
          if (pdfParser) {
            if (isStoredFile(file)) file.bytes = await fs.readFile(filename);
            const parsed = await pdfParser(file.bytes);
            if (!parsed?.pages || !Number.isInteger(parsed.pages) || parsed.pages < 1 || parsed.pages > 1_000) throw new Error('PDF parser returned an invalid page count.');
            record('pdf-structure', 'PDF page structure', 'passed', `${parsed.pages} pages parsed. ${parsed.scope || 'Visual appearance was not rendered.'}`, { pageCount: parsed.pages });
            record('pdf-rendering', 'PDF rasterization (appearance not reviewed)', parsed.rendering?.status || 'unverified', parsed.rendering?.evidence || 'The injected parser did not render pages.', { rendering: parsed.rendering });
          } else if (nodeExecutable) {
            const run = await processRunner(nodeExecutable, ['--max-old-space-size=256', path.join(__dirname, 'pdf-worker.js'), filename], { cwd: directory, timeoutMs: Math.max(timeoutMs, 30_000), signal });
            let parsed;
            try { parsed = JSON.parse(run.stdout); } catch (_) { /* Worker diagnostics remain in the check evidence. */ }
            record('pdf-structure', 'PDF page structure', run.unavailable || run.aborted || parsed?.unavailable ? 'unverified' : parsed?.ok && run.code === 0 && !run.timedOut && !run.outputLimited ? 'passed' : 'failed',
              parsed?.ok ? `${parsed.pages} pages parsed. ${parsed.scope}` : `${run.aborted ? 'PDF parser cancelled. ' : ''}${run.timedOut ? 'PDF parser timed out. ' : ''}${parsed?.error || run.error || run.stderr || 'PDF parser did not return valid evidence.'}`, { exitCode: run.code, timedOut: run.timedOut, ...(parsed?.ok && Number.isSafeInteger(parsed.pages) ? { pageCount: parsed.pages } : {}) });
            if (parsed?.ok) record('pdf-rendering', 'PDF rasterization (appearance not reviewed)', parsed.rendering?.status || 'unverified', parsed.rendering?.evidence || 'No rendering evidence was returned.', { rendering: parsed.rendering });
          } else record('pdf-structure', 'PDF page structure', 'unverified', 'No trusted Node interpreter or PDF parser is configured.');
        } else if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'].includes(extension)) {
          if (file.byteLength > TEXT_LIMIT) { record('image-decode', 'Image decoding', 'unverified', 'Exact bytes were hashed, but this image exceeds the 16 MB bounded local decoding limit.'); continue; }
          if (isStoredFile(file)) file.bytes = await readFileHead(file, TEXT_LIMIT);
          declaredImageSize(file.bytes, extension);
          if (!nativeImage?.createFromBuffer) { record('image-decode', 'Image decoding', 'unverified', 'The native image decoder is unavailable.'); continue; }
          const image = nativeImage.createFromBuffer(file.bytes);
          if (!image || image.isEmpty()) throw new Error('The image could not be decoded.');
          const size = image.getSize();
          if (!Number.isInteger(size.width) || !Number.isInteger(size.height) || size.width < 1 || size.height < 1 || size.width * size.height > 50_000_000) throw new Error('Image dimensions exceed the verification limit or are invalid.');
          record('image-decode', 'Image decoding', 'passed', `Native decoder read ${size.width} × ${size.height} pixels. Appearance and task suitability were not evaluated.`, { dimensions: size });
        } else record('format-check', 'Format verification', 'unverified', `No trusted local format checker is configured for ${extension || 'this file type'}. Exact byte identity was checked.`);
      } catch (error) { record('file-check', 'File structure', 'failed', String(error.message).slice(0, 4_000)); }
    }
    if (testMode === 'container-tests') {
      for (const check of await runContainerTests({ directory, files: current.files, dockerExecutable, timeoutMs: Math.max(timeoutMs, 30_000), processRunner, signal })) add(check);
    } else add({ id: 'execution-coverage', label: 'Program execution and integration tests', status: 'unverified', evidence: 'Static verification mode: generated programs and their tests were not executed. Syntax, structure and identity checks cannot prove runtime behavior or task correctness.' });
    const status = resultStatus(checks);
    return { status, candidateId: current.id, candidateSha256: current.sha256, answerSha256: require('./identity').sha256(current.answer), files: fileIdentities,
      startedAt, finishedAt: new Date().toISOString(), testMode, checks,
      summary: `${checks.filter(check => check.status === 'passed').length} passed, ${checks.filter(check => check.status === 'failed').length} failed, ${checks.filter(check => check.status === 'unverified').length} unverified. Checks apply only to this candidate and these exact bytes.` };
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
}

module.exports = { runVerificationLab, parseCSV, parseTSV, markdownLinks, resultStatus, declaredImageSize, PYTHON_AST };
