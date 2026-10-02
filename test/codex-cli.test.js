'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createCodexClient } = require('../src/core/codex-cli');

const schema = {
  type: 'object', additionalProperties: false,
  properties: { answer: { type: 'string' } }, required: ['answer']
};

function request(overrides = {}) {
  return {
    model: 'gpt-6-sol', effort: 'high', instructions: 'Check the answer carefully.',
    inputText: 'What is two plus two?', attachments: [], schema, ...overrides
  };
}

function simplePdf(text) {
  const escaped = text.replace(/[()\\]/g, (char) => `\\${char}`);
  const stream = `BT /F1 12 Tf 72 720 Td (${escaped}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

test('Codex adapter uses an isolated read-only ephemeral turn and removes source files', async () => {
  let observed;
  const run = async (_cli, args, options) => {
    const outputPath = args[args.indexOf('--output-last-message') + 1];
    const schemaPath = args[args.indexOf('--output-schema') + 1];
    const imagePath = args[args.indexOf('--image') + 1];
    observed = { args, options, workDir: options.cwd, schema: JSON.parse(await fs.readFile(schemaPath, 'utf8')) };
    assert.equal((await fs.readFile(imagePath)).toString('utf8'), 'picture');
    await fs.writeFile(outputPath, JSON.stringify({ answer: '4' }));
    return { code: 0, stdout: '', stderr: '' };
  };
  const client = createCodexClient(path.resolve(__filename), { run });
  const result = await client.requestStructured(request({ attachments: [
    { kind: 'image', name: 'picture.png', mimeType: 'image/png', dataUrl: 'data:image/png;base64,' + Buffer.from('picture').toString('base64') },
    { kind: 'text', name: 'facts.txt', mimeType: 'text/plain', dataUrl: 'data:text/plain;base64,' + Buffer.from('The verified value is four.').toString('base64') }
  ] }));
  assert.deepEqual(result, { data: { answer: '4' }, usage: null });
  assert.deepEqual(observed.schema, schema);
  for (const flag of ['--ephemeral', '--ignore-user-config', '--ignore-rules', '--skip-git-repo-check', '--sandbox', '--output-schema', '--output-last-message']) {
    assert.ok(observed.args.includes(flag), `Missing ${flag}`);
  }
  assert.match(observed.options.input, /The verified value is four/);
  assert.match(observed.options.input, /Check the answer carefully/);
  await assert.rejects(fs.stat(observed.workDir), { code: 'ENOENT' });
});

test('Codex adapter extracts PDF text for both analysts', async () => {
  let prompt;
  const run = async (_cli, args, options) => {
    prompt = options.input;
    const outputPath = args[args.indexOf('--output-last-message') + 1];
    await fs.writeFile(outputPath, JSON.stringify({ answer: 'Read the PDF.' }));
    return { code: 0, stdout: '', stderr: '' };
  };
  const client = createCodexClient(path.resolve(__filename), { run });
  const pdf = simplePdf('Hello PDF');
  const result = await client.requestStructured(request({ attachments: [
    { kind: 'file', name: 'report.pdf', mimeType: 'application/pdf', dataUrl: 'data:application/pdf;base64,' + pdf.toString('base64') }
  ] }));
  assert.equal(result.data.answer, 'Read the PDF.');
  assert.match(prompt, /Hello PDF/);
  assert.match(prompt, /report\.pdf/);
});

test('Codex adapter reports account limits and cancellation clearly', async () => {
  const client = createCodexClient(path.resolve(__filename), {
    run: async () => ({ code: 1, stderr: 'usage limit reached', stdout: '' })
  });
  await assert.rejects(client.requestStructured(request()), /usage limit reached/i);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(client.requestStructured(request({ signal: controller.signal })), /cancelled/i);
});
