'use strict';

const RESPONSES_URL = 'https://api.openai.com/v1/responses';
const MAX_ATTEMPTS = 3;
const MAX_RETRY_WAIT_MS = 30_000;

function createOpenAIClient(apiKey) {
  if (typeof apiKey !== 'string' || !apiKey.trim()) {
    throw new TypeError('An OpenAI API key is required.');
  }

  const key = apiKey.trim();

  return {
    async requestStructured({ model, effort, instructions, inputText, attachments = [], schema, signal } = {}) {
      if (typeof model !== 'string' || !model.trim()) {
        throw new TypeError('A model ID is required.');
      }
      if (typeof inputText !== 'string') {
        throw new TypeError('inputText must be a string.');
      }
      if (typeof instructions !== 'string') {
        throw new TypeError('instructions must be a string.');
      }
      if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
        throw new TypeError('schema must be a JSON Schema object.');
      }
      if (!Array.isArray(attachments)) {
        throw new TypeError('attachments must be an array.');
      }

      const content = [{ type: 'input_text', text: inputText }];
      for (const attachment of attachments) {
        content.push(attachmentToInput(attachment));
      }

      const body = {
        model: model.trim(),
        instructions,
        input: [{ role: 'user', content }],
        text: {
          format: {
            type: 'json_schema',
            name: 'debate_turn',
            strict: true,
            schema,
          },
        },
        store: false,
      };
      if (effort != null && effort !== '') {
        if (typeof effort !== 'string') {
          throw new TypeError('effort must be a string.');
        }
        body.reasoning = { effort };
      }

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        throwIfAborted(signal);
        let response;
        try {
          response = await fetch(RESPONSES_URL, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${key}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
            signal,
          });
        } catch (error) {
          // A transport error might have an unknown server outcome. Let the
          // caller decide whether another (potentially billable) call is safe.
          throw error;
        }

        const raw = await response.text();
        const payload = parseResponseBody(raw);

        if (response.ok) {
          return unpackStructuredResponse(payload);
        }

        const error = apiError(response, payload, raw);
        if (!isRetryable(response.status, payload) || attempt === MAX_ATTEMPTS) {
          throw error;
        }

        const retryAfter = parseRetryAfter(response.headers && response.headers.get('retry-after'));
        const delayMs = retryAfter == null
          ? Math.min(350 * 2 ** (attempt - 1) + Math.floor(Math.random() * 100), MAX_RETRY_WAIT_MS)
          : retryAfter + 25;
        if (delayMs > MAX_RETRY_WAIT_MS) {
          error.retryAfterMs = delayMs;
          throw error;
        }
        await waitWithSignal(delayMs, signal);
      }

      throw new Error('OpenAI request exhausted its retry limit.');
    },
  };
}

function attachmentToInput(attachment) {
  if (!attachment || typeof attachment !== 'object') {
    throw new TypeError('Each attachment must be an object.');
  }
  const { kind, name, mimeType, dataUrl } = attachment;
  if (kind !== 'image' && kind !== 'file' && kind !== 'text') {
    throw new TypeError('Attachment kind must be image, file, or text.');
  }
  if (typeof name !== 'string' || !name.trim()) {
    throw new TypeError('Attachment name is required.');
  }
  if (typeof mimeType !== 'string' || !mimeType.trim()) {
    throw new TypeError('Attachment MIME type is required.');
  }
  if (typeof dataUrl !== 'string' || !/^data:[^;,]+;base64,[a-z0-9+/=]+$/i.test(dataUrl)) {
    throw new TypeError(`Attachment "${name}" must have a base64 data URL.`);
  }
  const encodedType = dataUrl.slice(5, dataUrl.indexOf(';')).toLowerCase();
  if (encodedType !== mimeType.toLowerCase()) {
    throw new TypeError(`Attachment "${name}" MIME type does not match its data URL.`);
  }

  if (kind === 'image') {
    if (!mimeType.toLowerCase().startsWith('image/')) {
      throw new TypeError(`Image attachment "${name}" must use an image MIME type.`);
    }
    return { type: 'input_image', image_url: dataUrl };
  }
  if (kind === 'text') {
    const encoded = dataUrl.slice(dataUrl.indexOf(',') + 1);
    const text = Buffer.from(encoded, 'base64').toString('utf8');
    return { type: 'input_text', text: `Attached source file: ${name}\n--- BEGIN FILE ---\n${text}\n--- END FILE ---` };
  }
  return { type: 'input_file', filename: name, file_data: dataUrl };
}

function parseResponseBody(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function unpackStructuredResponse(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('OpenAI returned a non-JSON response.');
  }
  if (payload.status !== 'completed') {
    const reason = payload.incomplete_details?.reason || payload.error?.message || payload.status || 'unknown status';
    throw new Error(`OpenAI response did not complete: ${reason}.`);
  }

  const textParts = [];
  for (const item of payload.output || []) {
    if (item.type !== 'message') continue;
    for (const part of item.content || []) {
      if (part.type === 'refusal' || part.refusal) {
        const error = new Error(`OpenAI refused the request: ${part.refusal || 'no reason provided'}`);
        error.code = 'refusal';
        throw error;
      }
      if (part.type === 'output_text' && typeof part.text === 'string') {
        textParts.push(part.text);
      }
    }
  }
  if (textParts.length === 0) {
    throw new Error('OpenAI returned no structured output.');
  }
  let data;
  try {
    data = JSON.parse(textParts.join(''));
  } catch {
    throw new Error('OpenAI returned malformed structured output.');
  }
  return { data, usage: payload.usage || null };
}

function apiError(response, payload, raw) {
  const detail = payload?.error;
  const message = typeof detail?.message === 'string'
    ? detail.message
    : (raw || response.statusText || 'Unknown error').slice(0, 500);
  const error = new Error(`OpenAI API ${response.status}: ${message}`);
  error.status = response.status;
  error.code = detail?.code || detail?.type || 'api_error';
  const requestId = response.headers && response.headers.get('x-request-id');
  if (requestId) error.requestId = requestId;
  return error;
}

function isRetryable(status, payload) {
  if (status === 429) {
    const code = payload?.error?.code || payload?.error?.type;
    return !['insufficient_quota', 'billing_hard_limit_reached', 'billing_not_active'].includes(code);
  }
  return status >= 500 && status <= 599;
}

function parseRetryAfter(value) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

function abortError(signal) {
  if (signal?.reason instanceof Error) return signal.reason;
  const error = new Error('Request cancelled.');
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError(signal);
}

function waitWithSignal(ms, signal) {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    let timeout;
    const onAbort = () => {
      clearTimeout(timeout);
      signal.removeEventListener('abort', onAbort);
      reject(abortError(signal));
    };
    timeout = setTimeout(() => {
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
  });
}

module.exports = { createOpenAIClient };
