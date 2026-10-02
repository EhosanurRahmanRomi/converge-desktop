'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCookies } = require('../src/browser/cookies');

test('parses a formatted Chrome JSON export and preserves valid attributes', () => {
  const input = JSON.stringify({
    cookies: [
      {
        domain: '.chatgpt.com',
        hostOnly: false,
        name: '__Secure-session',
        value: 'abc==',
        path: '/chat',
        secure: true,
        httpOnly: true,
        sameSite: 'no_restriction',
        expirationDate: 1800000000.5,
      },
      {
        domain: 'auth.openai.com',
        hostOnly: true,
        name: 'pref',
        value: 'on',
        session: true,
        expirationDate: 1800000000,
        sameSite: 'Lax',
      },
    ],
  }, null, 2);

  assert.deepEqual(parseCookies(input), [
    {
      url: 'https://chatgpt.com/chat',
      name: '__Secure-session',
      value: 'abc==',
      path: '/chat',
      domain: '.chatgpt.com',
      secure: true,
      httpOnly: true,
      sameSite: 'no_restriction',
      expirationDate: 1800000000.5,
    },
    {
      url: 'https://auth.openai.com/',
      name: 'pref',
      value: 'on',
      path: '/',
      sameSite: 'lax',
    },
  ]);
});

test('accepts JSON arrays and derives a permitted domain from an HTTPS URL', () => {
  const cookies = parseCookies(JSON.stringify([{ url: 'https://chat.openai.com/account', name: 'sid', value: 'x', expires: '2030-01-01T00:00:00Z' }]));
  assert.equal(cookies[0].url, 'https://chat.openai.com/');
  assert.equal(cookies[0].expirationDate, Date.parse('2030-01-01T00:00:00Z') / 1000);
  assert.equal(cookies[0].domain, undefined);
});

test('parses a raw Cookie header without losing equals signs in values', () => {
  assert.deepEqual(parseCookies('Cookie: sid=abc==; theme=dark'), [
    { url: 'https://chatgpt.com/', name: 'sid', value: 'abc==', path: '/', secure: true },
    { url: 'https://chatgpt.com/', name: 'theme', value: 'dark', path: '/', secure: true },
  ]);
});

test('rejects unrelated domains and mismatched cookie URLs', () => {
  for (const domain of ['evilchatgpt.com', 'chatgpt.com.attacker.test', 'openai.com.attacker.test']) {
    assert.throws(() => parseCookies(JSON.stringify([{ domain, name: 'sid', value: 'secret' }])), /not permitted/);
  }
  assert.throws(() => parseCookies(JSON.stringify([{ domain: '.openai.com', url: 'https://chatgpt.com/', name: 'sid', value: 'secret' }])), /do not match/);
  assert.throws(() => parseCookies(JSON.stringify([{ url: 'http://chatgpt.com/', name: 'sid', value: 'secret' }])), /HTTPS/);
});

test('rejects empty, malformed, and oversized input without echoing secrets', () => {
  for (const input of ['', '   ', '[]', '{"cookies":[]}', '{oops', 'Set-Cookie: sid=secret', 'sid', 'sid=one\r\nother=two']) {
    assert.throws(() => parseCookies(input));
  }
  assert.throws(() => parseCookies(`sid=${'x'.repeat(4096)}`), /too large/);
  assert.throws(() => parseCookies('x'.repeat(1024 * 1024 + 1)), /too large/);
  try {
    parseCookies(JSON.stringify([{ domain: 'attacker.test', name: 'sid', value: 'TOP_SECRET_VALUE' }]));
    assert.fail('Expected domain validation to fail');
  } catch (error) {
    assert.doesNotMatch(error.message, /TOP_SECRET_VALUE/);
  }
});

test('rejects invalid cookie fields and SameSite=None without Secure', () => {
  const wrap = (cookie) => JSON.stringify([cookie]);
  assert.throws(() => parseCookies(wrap({ domain: 'chatgpt.com', name: 'bad name', value: 'x' })), /name/);
  assert.throws(() => parseCookies(wrap({ domain: 'chatgpt.com', name: 'sid', value: 'x', path: 'relative' })), /path/);
  assert.throws(() => parseCookies(wrap({ domain: 'chatgpt.com', name: 'sid', value: 'x', httpOnly: 'yes' })), /security flag/);
  assert.throws(() => parseCookies(wrap({ domain: 'chatgpt.com', name: 'sid', value: 'x', sameSite: 'None', secure: false })), /requires a secure cookie/);
});
