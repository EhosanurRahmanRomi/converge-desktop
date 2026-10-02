'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createOpenAIClient } = require('../src/core/api');

const schema = {
  type: 'object',
  properties: { answer: { type: 'string' } },
  required: ['answer'],
  additionalProperties: false,
};

const baseRequest = {
  model: 'gpt-6-sol',
  effort: 'high',
  instructions: 'Assess the other answer.',
  inputText: 'What is 2 + 2?',
  schema,
};

function completed(data, usage = { input_tokens: 12, output_tokens: 6, total_tokens: 18 }) {
  return new Response(JSON.stringify({
    status: 'completed',
    output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(data) }] }],
    usage,
  }), { status: 200 });
}

async function withFetch(mock, fn) {
  const original = global.fetch;
  global.fetch = mock;
  try {
    return await fn();
  } finally {
    global.fetch = original;
  }
}

test('sends a stateless strict-schema request with image and file inputs', async () => {
  let call;
  await withFetch(async (url, options) => {
    call = { url, options };
    return completed({ answer: '4' });
  }, async () => {
    const client = createOpenAIClient('sk-test');
    const result = await client.requestStructured({
      ...baseRequest,
      attachments: [
        { kind: 'image', name: 'figure.png', mimeType: 'image/png', dataUrl: 'data:image/png;base64,AA==' },
        { kind: 'file', name: 'notes.txt', mimeType: 'text/plain', dataUrl: 'data:text/plain;base64,YQ==' },
      ],
    });
    assert.deepEqual(result, {
      data: { answer: '4' },
      usage: { input_tokens: 12, output_tokens: 6, total_tokens: 18 },
    });
  });

  assert.equal(call.url, 'https://api.openai.com/v1/responses');
  assert.equal(call.options.headers.Authorization, 'Bearer sk-test');
  const body = JSON.parse(call.options.body);
  assert.equal(body.store, false);
  assert.equal(body.model, 'gpt-6-sol');
  assert.deepEqual(body.reasoning, { effort: 'high' });
  assert.equal(body.instructions, baseRequest.instructions);
  assert.deepEqual(body.text.format, {
    type: 'json_schema', name: 'debate_turn', strict: true, schema,
  });
  assert.deepEqual(body.input[0].content, [
    { type: 'input_text', text: baseRequest.inputText },
    { type: 'input_image', image_url: 'data:image/png;base64,AA==' },
    { type: 'input_file', filename: 'notes.txt', file_data: 'data:text/plain;base64,YQ==' },
  ]);
});

test('retries a temporary rate limit after Retry-After, then succeeds', async () => {
  let calls = 0;
  await withFetch(async () => {
    calls += 1;
    if (calls === 1) {
      return new Response(JSON.stringify({ error: { code: 'rate_limit_exceeded', message: 'Slow down' } }), {
        status: 429,
        headers: { 'Retry-After': '0' },
      });
    }
    return completed({ answer: '4' });
  }, async () => {
    const result = await createOpenAIClient('sk-test').requestStructured(baseRequest);
    assert.deepEqual(result.data, { answer: '4' });
  });
  assert.equal(calls, 2);
});

test('retries transient server errors but respects a long Retry-After', async () => {
  let calls = 0;
  await withFetch(async () => {
    calls += 1;
    if (calls === 1) {
      return new Response(JSON.stringify({ error: { code: 'server_is_overloaded', message: 'Busy' } }), {
        status: 503,
        headers: { 'Retry-After': '0' },
      });
    }
    return completed({ answer: '4' });
  }, async () => {
    const result = await createOpenAIClient('sk-test').requestStructured(baseRequest);
    assert.equal(result.data.answer, '4');
  });
  assert.equal(calls, 2);

  calls = 0;
  await withFetch(async () => {
    calls += 1;
    return new Response(JSON.stringify({ error: { code: 'server_is_overloaded', message: 'Busy' } }), {
      status: 503,
      headers: { 'Retry-After': '60' },
    });
  }, async () => {
    await assert.rejects(
      createOpenAIClient('sk-test').requestStructured(baseRequest),
      (error) => error.status === 503 && error.retryAfterMs >= 60_000,
    );
  });
  assert.equal(calls, 1);
});

test('does not retry authentication or exhausted quota errors', async () => {
  for (const [status, code] of [[401, 'invalid_api_key'], [429, 'insufficient_quota']]) {
    let calls = 0;
    await withFetch(async () => {
      calls += 1;
      return new Response(JSON.stringify({ error: { code, message: 'Access denied' } }), { status });
    }, async () => {
      await assert.rejects(
        createOpenAIClient('sk-test').requestStructured(baseRequest),
        (error) => error.status === status && error.code === code,
      );
    });
    assert.equal(calls, 1);
  }
});

test('reports refusal, incomplete generation, and malformed structured data', async () => {
  const cases = [
    [
      { status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'Cannot help.' }] }] },
      /refused/i,
    ],
    [
      { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [] },
      /max_output_tokens/,
    ],
    [
      { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '{bad' }] }] },
      /malformed structured output/,
    ],
  ];
  for (const [payload, pattern] of cases) {
    await withFetch(async () => new Response(JSON.stringify(payload), { status: 200 }), async () => {
      await assert.rejects(createOpenAIClient('sk-test').requestStructured(baseRequest), pattern);
    });
  }
});

test('cancels during a rate-limit wait without issuing another request', async () => {
  const controller = new AbortController();
  let calls = 0;
  await withFetch(async () => {
    calls += 1;
    return new Response(JSON.stringify({ error: { code: 'rate_limit_exceeded', message: 'Slow down' } }), {
      status: 429,
      headers: { 'Retry-After': '0.2' },
    });
  }, async () => {
    const promise = createOpenAIClient('sk-test').requestStructured({ ...baseRequest, signal: controller.signal });
    setTimeout(() => controller.abort(), 20);
    await assert.rejects(promise, (error) => error.name === 'AbortError');
  });
  assert.equal(calls, 1);
});

test('rejects invalid attachments before any network request', async () => {
  await withFetch(async () => {
    throw new Error('Fetch should not be called');
  }, async () => {
    await assert.rejects(
      createOpenAIClient('sk-test').requestStructured({
        ...baseRequest,
        attachments: [{ kind: 'file', name: 'notes.txt', mimeType: 'text/plain', dataUrl: 'data:image/png;base64,AA==' }],
      }),
      /MIME type does not match/,
    );
  });
});

test('passes a text attachment as named UTF-8 source material', async () => {
  let body;
  await withFetch(async (_url, options) => {
    body = JSON.parse(options.body);
    return completed({ answer: 'Read.' });
  }, async () => {
    await createOpenAIClient('sk-test').requestStructured({
      ...baseRequest,
      attachments: [{
        kind: 'text',
        name: 'research.txt',
        mimeType: 'text/plain',
        dataUrl: `data:text/plain;base64,${Buffer.from('Hello, 世界', 'utf8').toString('base64')}`,
      }],
    });
  });

  assert.equal(body.input[0].content[1].type, 'input_text');
  assert.match(body.input[0].content[1].text, /research\.txt/);
  assert.match(body.input[0].content[1].text, /Hello, 世界/);
});
