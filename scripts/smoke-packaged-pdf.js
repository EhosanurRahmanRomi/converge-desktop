'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const resultFile = path.join(process.cwd(), 'smoke-packaged-pdf-result.json');

function simplePdf() {
  const stream = 'BT /F1 12 Tf 72 720 Td (Packaged PDF check) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

async function main() {
  const modulePath = path.join(process.resourcesPath, 'app.asar', 'src', 'core', 'pdf.js');
  const { extractPdfText } = require(modulePath);
  const text = await extractPdfText(simplePdf());
  assert.match(text, /Packaged PDF check/);
  fs.writeFileSync(resultFile, JSON.stringify({ ok: true, resourcesPath: process.resourcesPath }));
  process.stdout.write('Packaged PDF extraction passed.\n');
}

main().catch((error) => {
  fs.writeFileSync(resultFile, JSON.stringify({ ok: false, error: error.message }));
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
