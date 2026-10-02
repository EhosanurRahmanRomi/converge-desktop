'use strict';

const MAX_PAGES = 100;
const MAX_TEXT_CHARS = 200_000;

async function extractPdfText(bytes) {
  if (!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array)) throw new TypeError('PDF bytes are required.');
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: true,
    disableFontFace: true,
    isEvalSupported: false,
    verbosity: 0
  });
  try {
    const document = await task.promise;
    if (document.numPages > MAX_PAGES) throw new Error(`The PDF has more than ${MAX_PAGES} pages. Split it into smaller files.`);
    const pages = [];
    let length = 0;
    for (let number = 1; number <= document.numPages; number += 1) {
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      const parts = [];
      for (const item of content.items) {
        if (typeof item.str !== 'string') continue;
        parts.push(item.str);
        parts.push(item.hasEOL ? '\n' : ' ');
      }
      const text = parts.join('').replace(/ +\n/g, '\n').trim();
      if (text) {
        const section = `[Page ${number}]\n${text}`;
        length += section.length;
        if (length > MAX_TEXT_CHARS) throw new Error('The PDF contains too much text for one debate. Split it into smaller files.');
        pages.push(section);
      }
      page.cleanup();
    }
    if (!pages.length) throw new Error('This PDF has no selectable text. Add its pages as images instead.');
    return pages.join('\n\n');
  } finally {
    await task.destroy();
  }
}

module.exports = { extractPdfText };
