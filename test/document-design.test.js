'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeDocumentDesign, documentDesignContext, validateDocumentReview, assessDocumentReview,
  documentProductionInstructions } = require('../src/studio/document-design');

const pdf = { name: 'lectures.pdf', mimeType: 'application/pdf', contentSha256: 'a'.repeat(64), byteLength: 1234 };
const reference = { name: 'Good Notes.pdf', mimeType: 'application/pdf', contentSha256: 'b'.repeat(64), byteLength: 5678 };
function review() {
  return { files: [{ name: pdf.name, contentSha256: pdf.contentSha256, pageCount: 3, renderedPages: [3, 1, 2], inspectedPages: [1, 2, 3] }],
    checks: { typography: 'Pages 1–3 use embedded serif body and readable mathematical glyphs.',
      spacing: 'Pages 1–3 have consistent margins and no overlapping paragraphs or clipped equations.',
      mathematics: 'Equation alignment and Greek symbols remain legible at normal reading size.',
      figures: 'All figures have readable labels and captions, with no cropped axes.',
      referenceStyle: 'Compared Good Notes.pdf: heading hierarchy, teal rules, body leading and equation spacing match its design.' }, limitations: [] };
}

test('document design normalization uses bounded exact file names and academic defaults', () => {
  assert.deepEqual(normalizeDocumentDesign(), { profile: 'academic', notes: '', referenceNames: [] });
  assert.deepEqual(normalizeDocumentDesign({ profile: 'reference', notes: '  Keep the teal headings. ', referenceNames: ['Good Notes.pdf', 'Good Notes.pdf'] }),
    { profile: 'reference', notes: 'Keep the teal headings.', referenceNames: ['Good Notes.pdf'] });
  for (const value of [{ profile: 'invented' }, { notes: 'x'.repeat(6001) }, { referenceNames: ['../secret.pdf'] },
    { referenceNames: [' Good Notes.pdf'] }, { referenceNames: Array.from({ length: 6 }, (_, index) => `${index}.pdf`) }]) {
    assert.throws(() => normalizeDocumentDesign(value));
  }
});

test('document reference context resolves actual identity and separates appearance from content scope', () => {
  const context = documentDesignContext({ documentDesign: { profile: 'reference', referenceNames: ['Good Notes.pdf', 'Missing.pdf'] } }, [pdf, reference]);
  assert.equal(context.styleReferences[0].contentSha256, reference.contentSha256);
  assert.equal(context.styleReferences[0].role, 'style-reference');
  assert.deepEqual(context.contentSources.map(file => file.name), ['lectures.pdf']);
  assert.deepEqual(context.unavailableReferences, ['Missing.pdf']);
  assert.match(context.scope, /not additional user instructions/);
  assert.match(documentProductionInstructions(context), /Good Notes\.pdf \(SHA-256 b{64}\)/);
  assert.match(documentProductionInstructions(context), /not a compulsory extra round/);
  assert.match(documentProductionInstructions(context), /rasterization does not establish aesthetic quality/);
  assert.match(documentProductionInstructions({ profile: 'academic' }), /Latin Modern/);
  assert.match(documentProductionInstructions({ profile: 'editorial' }), /editorial report system/);
  assert.match(documentProductionInstructions({ profile: 'neutral' }), /black text on white pages/);
  assert.match(documentProductionInstructions(context), /Literal caret\/underscore notation or raw LaTeX commands are unacceptable/);
});

test('visual review requires exact PDF identities and honest in-range rendered coverage', () => {
  const parsed = validateDocumentReview(review(), [pdf]);
  assert.deepEqual(parsed.files[0].renderedPages, [1, 2, 3]); assert.equal(parsed.source, 'model');
  for (const mutate of [value => { value.files[0].contentSha256 = 'c'.repeat(64); },
    value => { value.files[0].name = 'other.pdf'; }, value => { value.files[0].pageCount = 1001; },
    value => { value.files[0].renderedPages = [1, 1, 3]; }, value => { value.files[0].inspectedPages = [4]; },
    value => { value.files[0].renderedPages = [1]; }]) {
    const value = review(); mutate(value); assert.throws(() => validateDocumentReview(value, [pdf]));
  }
  assert.throws(() => validateDocumentReview(review(), [pdf, { ...pdf, name: 'appendix.pdf' }]), /every exact/);
});

test('layout quality is unverified for missing pages, generic findings, unavailable references or limitations', () => {
  const context = documentDesignContext({ documentDesign: { referenceNames: [reference.name] } }, [reference]);
  const met = assessDocumentReview(review(), [pdf], context);
  assert.equal(met.status, 'met'); assert.match(met.evidence, /Model-reported visual review, not independently executed/);
  assert.equal(assessDocumentReview(undefined, [pdf], context).status, 'unverified');
  for (const mutate of [value => { value.files[0].inspectedPages = [1, 3]; },
    value => { value.checks.typography = 'passed'; }, value => { value.checks.referenceStyle = 'The requested headings were compared with the supplied visual design.'; },
    value => { value.limitations.push('Page 2 could not be inspected.'); }]) {
    const value = review(); mutate(value); assert.equal(assessDocumentReview(value, [pdf], context).status, 'unverified');
  }
  assert.equal(assessDocumentReview(review(), [pdf], { ...context, unavailableReferences: ['Missing.pdf'] }).status, 'unverified');
  const mismatch = assessDocumentReview(review(), [pdf], { ...context,
    actualPdfPages: [{ name: pdf.name, contentSha256: pdf.contentSha256, pageCount: 68 }] });
  assert.equal(mismatch.status, 'unverified'); assert.match(mismatch.evidence, /does not match the locally parsed 68 pages/);
  assert.equal(assessDocumentReview(review(), [pdf], { profile: 'reference', styleReferences: [] }).status, 'unverified');
});
