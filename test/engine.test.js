const test = require('node:test');
const assert = require('node:assert/strict');
const { runDebate } = require('../src/core/engine');

const accept = (resolvedIssueIds = []) => ({
  verdict: 'accept',
  findings: [],
  revisedAnswer: '',
  resolvedIssueIds,
  uncertainties: [],
});

const uncertain = () => ({
  verdict: 'uncertain',
  findings: [],
  revisedAnswer: '',
  resolvedIssueIds: [],
  uncertainties: ['The key claim is not verified.'],
});

const finding = (problem) => ({
  severity: 'major',
  location: 'answer',
  problem,
  evidence: 'The supplied question gives a different value.',
  correction: 'Use the supplied value.',
});

function mockClient(handler) {
  const calls = [];
  return {
    calls,
    async requestStructured(args) {
      calls.push(args);
      return {
        data: await handler(args, calls.length),
        usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
      };
    },
  };
}

test('starts independently and agrees only after both check the same candidate', async () => {
  const events = [];
  const attachment = { name: 'chart.png', mimeType: 'image/png', kind: 'image', dataUrl: 'data:image/png;base64,AA==' };
  const client = mockClient((_args, call) => {
    if (call === 1) return { answer: 'The answer is 42.', uncertainties: [] };
    if (call === 2) return { answer: 'I independently calculate 42.', uncertainties: [] };
    return accept();
  });
  const result = await runDebate({
    client,
    question: 'What is the answer?',
    attachments: [attachment],
    settings: { left: { model: 'left-model', effort: 'high' }, right: { model: 'right-model', effort: 'max' } },
    onEvent: (event) => events.push(event),
  });

  assert.equal(result.status, 'agreed');
  assert.equal(result.answer, 'The answer is 42.');
  assert.equal(result.rounds, 1);
  assert.equal(result.usage.calls, 5);
  assert.equal(result.usage.totalTokens, 75);
  assert.equal(client.calls[0].model, 'left-model');
  assert.equal(client.calls[1].model, 'right-model');
  assert.ok(client.calls.every((call) => call.attachments[0].dataUrl === attachment.dataUrl));
  assert.ok(!client.calls[0].inputText.includes('I independently calculate 42'));
  assert.ok(!client.calls[1].inputText.includes('The answer is 42'));
  const verificationCalls = client.calls.filter((call) => call.inputText.includes('Phase: verify'));
  assert.equal(verificationCalls.length, 2);
  const hashes = verificationCalls.map((call) => call.inputText.match(/Current candidate hash: ([a-f0-9]+)/)[1]);
  assert.equal(hashes[0], hashes[1]);
  assert.equal(events.filter((event) => event.type === 'done').length, 1);
  assert.equal(events.at(-1).result.status, 'agreed');
});

test('accept verdicts can agree when a reviewer redundantly echoes the candidate', async () => {
  const client = mockClient((_args, call) => call <= 2
    ? { answer: '4', uncertainties: [] }
    : { ...accept(), revisedAnswer: '4' });
  const result = await runDebate({ client, question: 'What is 2 + 2?', settings: { maxRounds: 1 } });
  assert.equal(result.status, 'agreed');
  assert.equal(result.answer, '4');
});

test('a concrete challenge revises the answer and both reviewers resolve the issue', async () => {
  const client = mockClient((_args, call) => {
    if (call === 1) return { answer: 'The total is 3.', uncertainties: [] };
    if (call === 2) return { answer: 'The total is 4.', uncertainties: [] };
    if (call === 3) return {
      verdict: 'challenge',
      findings: [finding('The arithmetic total is wrong.')],
      revisedAnswer: 'The total is 4.',
      resolvedIssueIds: [],
      uncertainties: [],
    };
    return accept(['I1']);
  });
  const result = await runDebate({ client, question: 'What is 2 + 2?' });

  assert.equal(result.status, 'agreed');
  assert.equal(result.answer, 'The total is 4.');
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0].status, 'resolved');
  assert.equal(result.issues[0].raisedBy, 'right');
  assert.ok(result.transcript.some((item) => item.side === 'right' && item.role === 'review' && item.text.includes('arithmetic total')));
});

test('an unresolved material issue blocks agreement despite two accept verdicts', async () => {
  const client = mockClient((_args, call) => {
    if (call <= 2) return { answer: 'The total is 3.', uncertainties: [] };
    if (call === 3) return {
      verdict: 'challenge', findings: [finding('The arithmetic total is wrong.')],
      revisedAnswer: '', resolvedIssueIds: [], uncertainties: [],
    };
    return accept();
  });
  const result = await runDebate({ client, question: 'What is 2 + 2?', settings: { maxRounds: 3 } });

  assert.notEqual(result.status, 'agreed');
  assert.equal(result.issues[0].status, 'open');
  assert.equal(result.answer, 'The total is 3.');
});

test('detects repeated uncertainty instead of looping to the configured maximum', async () => {
  const client = mockClient((_args, call) => call <= 2
    ? { answer: 'A plausible answer.', uncertainties: [] }
    : uncertain());
  const result = await runDebate({ client, question: 'Please investigate this claim.', settings: { maxRounds: 8 } });

  assert.equal(result.status, 'stalled');
  assert.equal(result.rounds, 2);
  assert.equal(result.usage.calls, 8);
});

test('stop signal ends a run even if a browser adapter ignores cancellation', async () => {
  const controller = new AbortController();
  const client = {
    calls: 0,
    requestStructured() {
      this.calls += 1;
      return new Promise(() => {});
    },
  };
  const resultPromise = runDebate({ client, question: 'A slow question', signal: controller.signal });
  controller.abort();
  const result = await resultPromise;

  assert.equal(result.status, 'cancelled');
  assert.equal(client.calls, 2);
  assert.equal(result.answer, '');
});

test('honors the model call limit without claiming agreement', async () => {
  const client = mockClient((_args, call) => call <= 2
    ? { answer: `Draft ${call}`, uncertainties: [] }
    : uncertain());
  const result = await runDebate({ client, question: 'An unresolved task', settings: { maxRounds: 4, maxCalls: 3 } });

  assert.equal(result.status, 'limit_reached');
  assert.equal(result.usage.calls, 3);
  assert.equal(result.answer, 'Draft 1');
});

test('snapshots attachments so later caller edits cannot change one side of the review', async () => {
  const attachment = { kind: 'text', name: 'note.txt', mimeType: 'text/plain', dataUrl: 'data:text/plain;base64,YQ==' };
  const attachments = [attachment];
  const client = mockClient((_args, call) => call <= 2
    ? { answer: `Draft ${call}`, uncertainties: [] }
    : accept());
  const resultPromise = runDebate({ client, question: 'Read the note', attachments });
  attachment.dataUrl = 'data:text/plain;base64,Yg==';
  attachments.push({ kind: 'text', name: 'extra.txt', mimeType: 'text/plain', dataUrl: 'data:text/plain;base64,Yw==' });
  const result = await resultPromise;

  assert.equal(result.status, 'agreed');
  assert.ok(client.calls.every((call) => call.attachments.length === 1 &&
    call.attachments[0].dataUrl === 'data:text/plain;base64,YQ=='));
});

test('preserves a finished draft if the other model fails', async () => {
  const client = mockClient((_args, call) => {
    if (call === 1) return { answer: 'Partial usable answer.', uncertainties: [] };
    throw new Error('Second model failed.');
  });
  const result = await runDebate({ client, question: 'A question' });

  assert.equal(result.status, 'error');
  assert.equal(result.answer, 'Partial usable answer.');
  assert.equal(result.transcript.length, 1);
  assert.equal(result.transcript[0].side, 'left');
});

test('does not call conflicting or uncertain verification agreement', async () => {
  for (const contradictory of [
    { ...accept(), revisedAnswer: 'Another version.' },
    { ...accept(), uncertainties: ['A key fact needs a source.'] },
  ]) {
    const client = mockClient((_args, call) => call <= 2
      ? { answer: 'Candidate answer.', uncertainties: [] }
      : call === 4 ? contradictory : accept());
    const result = await runDebate({ client, question: 'Check this', settings: { maxRounds: 1 } });
    assert.equal(result.status, 'limit_reached');
    assert.equal(result.answer, 'Candidate answer.');
  }
});

test('cannot resolve an issue that a final checker reports again', async () => {
  const client = mockClient((_args, call) => {
    if (call <= 2) return { answer: 'The total is 3.', uncertainties: [] };
    if (call === 3) return {
      verdict: 'challenge', findings: [finding('The arithmetic total is wrong.')],
      revisedAnswer: '', resolvedIssueIds: [], uncertainties: [],
    };
    if (call === 4) return {
      verdict: 'accept', findings: [finding('The arithmetic total is wrong.')],
      revisedAnswer: '', resolvedIssueIds: ['I1'], uncertainties: [],
    };
    return accept(['I1']);
  });
  const result = await runDebate({ client, question: 'What is 2 + 2?', settings: { maxRounds: 1 } });

  assert.equal(result.status, 'limit_reached');
  assert.equal(result.issues[0].status, 'open');
});

test('carries independent draft uncertainties into later checks', async () => {
  const client = mockClient((_args, call) => {
    if (call === 1) return { answer: 'A possible answer.', uncertainties: ['The date is not sourced.'] };
    if (call === 2) return { answer: 'Another answer.', uncertainties: [] };
    return accept();
  });
  await runDebate({ client, question: 'What happened?' });

  assert.ok(client.calls.slice(2).every((call) => call.inputText.includes('The date is not sourced.')));
});

test('upgrades a repeated minor issue when a checker finds it material', async () => {
  const sameProblem = 'The cited value is inconsistent.';
  const client = mockClient((_args, call) => {
    if (call <= 2) return { answer: 'A value.', uncertainties: [] };
    if (call === 3) return {
      verdict: 'accept', findings: [{ ...finding(sameProblem), severity: 'minor' }],
      revisedAnswer: '', resolvedIssueIds: [], uncertainties: [],
    };
    if (call === 4) return {
      verdict: 'challenge', findings: [finding(sameProblem)],
      revisedAnswer: '', resolvedIssueIds: [], uncertainties: [],
    };
    return accept();
  });
  const result = await runDebate({ client, question: 'Check a value', settings: { maxRounds: 1 } });

  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0].severity, 'major');
  assert.equal(result.issues[0].status, 'open');
});

test('rejects a malformed accept record instead of treating it as agreement', async () => {
  const client = mockClient((_args, call) => call <= 2
    ? { answer: 'Candidate.', uncertainties: [] }
    : { verdict: 'accept' });
  const result = await runDebate({ client, question: 'Check this answer.' });

  assert.equal(result.status, 'error');
  assert.match(result.error, /invalid review/i);
  assert.equal(result.answer, 'Candidate.');
});
