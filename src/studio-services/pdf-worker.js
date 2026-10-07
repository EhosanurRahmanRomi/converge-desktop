'use strict';

// Trusted parser worker. Only inert PDF data reaches pdfjs; it never opens
// attachment actions, links, embedded programs or JavaScript in the document.
const fs = require('node:fs/promises');
(async () => {
  let task;
  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const bytes = await fs.readFile(process.argv[2]);
    task = pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, useSystemFonts: false,
      disableFontFace: true, stopAtErrors: true, verbosity: 0, maxImageSize: 16 * 1024 * 1024 });
    const pdf = await task.promise;
    if (!Number.isSafeInteger(pdf.numPages) || pdf.numPages < 1 || pdf.numPages > 1_000) throw new Error('PDF page count is outside the 1–1,000 page verification limit.');
    for (let number = 1; number <= pdf.numPages; number += 1) {
      const page = await pdf.getPage(number), view = page.getViewport({ scale: 1 });
      if (!Number.isFinite(view.width) || !Number.isFinite(view.height) || view.width <= 0 || view.height <= 0) throw new Error(`PDF page ${number} has invalid dimensions.`);
      await page.getTextContent();
      page.cleanup();
    }
    let rendering;
    try {
      const { createCanvas } = await import('@napi-rs/canvas');
      // Render all short documents and a bounded sample of longer ones. The
      // worker timeout bounds expensive or hostile vector/raster content.
      const chosen = pdf.numPages <= 12 ? Array.from({ length: pdf.numPages }, (_, index) => index + 1) :
        [...new Set([1, 2, 3, Math.floor(pdf.numPages / 2), Math.floor(pdf.numPages / 2) + 1, pdf.numPages - 2, pdf.numPages - 1, pdf.numPages])];
      const rendered = [];
      for (const number of chosen) {
        const page = await pdf.getPage(number), natural = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: Math.min(1.5, 1_200 / Math.max(natural.width, natural.height)) });
        const canvas = createCanvas(Math.max(1, Math.ceil(viewport.width)), Math.max(1, Math.ceil(viewport.height)));
        await page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport, intent: 'display' }).promise;
        // PNG encoding forces the actual raster output to materialize. No
        // image bytes are retained or sent across the project IPC boundary.
        const png = canvas.toBuffer('image/png');
        if (!png.length) throw new Error(`Page ${number} produced no rendered image.`);
        rendered.push({ page: number, width: canvas.width, height: canvas.height, pngBytes: png.length });
        page.cleanup();
      }
      rendering = { status: 'passed', pagesRendered: rendered.length, totalPages: pdf.numPages, pages: rendered,
        evidence: `Rendered ${rendered.length} of ${pdf.numPages} pages to PNG (pages ${chosen.join(', ')}; maximum 1,200 pixels per dimension). Rasterization succeeded. Aesthetic quality, clipping, content accuracy and unrendered pages were not reviewed.` };
    } catch (error) {
      rendering = { status: error.code === 'ERR_MODULE_NOT_FOUND' || error.code === 'MODULE_NOT_FOUND' ? 'unverified' : 'failed', pagesRendered: 0, totalPages: pdf.numPages,
        evidence: `PDF rendering ${error.code === 'ERR_MODULE_NOT_FOUND' || error.code === 'MODULE_NOT_FOUND' ? 'unavailable' : 'failed'}: ${String(error.message).slice(0, 4_000)}` };
    }
    process.stdout.write(JSON.stringify({ ok: true, pages: pdf.numPages, scope: 'All bounded pages parsed for text and dimensions. Rendering coverage is reported separately.', rendering }));
  } catch (error) {
    process.stdout.write(JSON.stringify({ ok: false, unavailable: error.code === 'ERR_MODULE_NOT_FOUND' || error.code === 'MODULE_NOT_FOUND', error: String(error.message).slice(0, 4_000) }));
    process.exitCode = 1;
  } finally { await task?.destroy().catch(() => {}); }
})();
