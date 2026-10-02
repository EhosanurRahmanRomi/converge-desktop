'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseDraft, parseReview } = require('../background');

test('rendered file reference quotes preserve the complete review values and candidate identity', () => {
  const raw = '{"candidateId":"C7","verdict":"challenge","issues":[{"severity":"minor","problem":"Improve spacing","evidence":"Checked :chatgpt-content-reference{index="0"}","correction":"Use wider margins"}],"revisedAnswer":"Fixed layout :chatgpt-content-reference{index="1"}","resolvedIssueIds":[],"uncertainties":[],"checks":["Read actual PDF :chatgpt-content-reference{index="2"}"]}';
  const review = parseReview(raw, 'C7');
  assert.equal(review.verdict, 'challenge');
  assert.equal(review.issues[0].evidence, 'Checked :chatgpt-content-reference{index="0"}');
  assert.equal(review.revisedAnswer, 'Fixed layout :chatgpt-content-reference{index="1"}');
  assert.equal(review.checks[0], 'Read actual PDF :chatgpt-content-reference{index="2"}');
  assert.throws(() => parseReview(raw, 'C8'), /different candidate/);
});

test('valid escaped references and all Python quotes and backslashes are unchanged', () => {
  const answer = 'Reference :chatgpt-content-reference{index="12"}\nassert value == "x"\npath = "C:\\files"';
  assert.equal(parseDraft(JSON.stringify({answer, uncertainties:[]})).answer, answer);
});

test('ordinary unescaped quotes, outside-string references and unsupported reference tokens still fail', () => {
  for (const raw of [
    '{"answer":"assert x == "bad"","uncertainties":[]}',
    '{"answer": :chatgpt-content-reference{index="0"},"uncertainties":[]}',
    '{"answer":"Ref :chatgpt-content-reference{index="x"}","uncertainties":[]}',
  ]) assert.throws(() => parseDraft(raw), /required JSON/);
});
