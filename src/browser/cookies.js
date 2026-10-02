'use strict';

const MAX_EXPORT_BYTES = 1024 * 1024;
const MAX_COOKIES = 200;
const MAX_COOKIE_BYTES = 4096;
const COOKIE_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const HOST_LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

/**
 * Parse a Chrome-style cookie JSON export or a raw Cookie request header into
 * details accepted by Electron's session.cookies.set. No values are persisted.
 */
function parseCookies(text) {
  if (typeof text !== 'string' || !text.trim()) {
    throw new TypeError('Cookie input must not be empty.');
  }
  if (Buffer.byteLength(text, 'utf8') > MAX_EXPORT_BYTES) {
    throw new RangeError('Cookie input is too large.');
  }
  if (/\0/.test(text)) {
    throw new TypeError('Cookie input contains invalid characters.');
  }

  const trimmed = text.trim();
  const isJson = trimmed.startsWith('[') || trimmed.startsWith('{');
  if (!isJson && /[\r\n]/.test(trimmed)) {
    throw new TypeError('Cookie input contains invalid characters.');
  }
  const cookies = isJson ? parseJsonExport(trimmed) : parseCookieHeader(trimmed);

  if (cookies.length === 0) {
    throw new TypeError('Cookie input contains no cookies.');
  }
  if (cookies.length > MAX_COOKIES) {
    throw new RangeError('Cookie input has too many cookies.');
  }
  return cookies;
}

function parseJsonExport(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new TypeError('Malformed cookie JSON.');
  }
  const source = Array.isArray(parsed) ? parsed : parsed?.cookies;
  if (!Array.isArray(source)) {
    throw new TypeError('Cookie JSON must contain an array.');
  }
  if (source.length > MAX_COOKIES) {
    throw new RangeError('Cookie input has too many cookies.');
  }
  return source.map(parseJsonCookie);
}

function parseJsonCookie(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    throw new TypeError('Malformed cookie entry.');
  }
  const name = validateName(source.name);
  const value = validateValue(source.value);
  validateCookieSize(name, value);

  let urlHost;
  if (source.url != null) {
    if (typeof source.url !== 'string') throw new TypeError('Malformed cookie URL.');
    let parsed;
    try {
      parsed = new URL(source.url);
    } catch {
      throw new TypeError('Malformed cookie URL.');
    }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
      throw new TypeError('Cookie URL must be HTTPS.');
    }
    urlHost = validateAllowedHost(parsed.hostname);
  }

  const domainText = source.domain;
  if (domainText != null && typeof domainText !== 'string') {
    throw new TypeError('Malformed cookie domain.');
  }
  const host = domainText ? validateAllowedHost(domainText) : urlHost;
  if (!host) throw new TypeError('Cookie domain is required.');
  if (urlHost && urlHost !== host && !urlHost.endsWith(`.${host}`)) {
    throw new TypeError('Cookie URL and domain do not match.');
  }

  const path = source.path == null ? '/' : source.path;
  if (typeof path !== 'string' || !path.startsWith('/') || /[\r\n\0]/.test(path)) {
    throw new TypeError('Malformed cookie path.');
  }
  const details = { url: `https://${urlHost || host}${path}`, name, value, path };

  if (source.hostOnly != null && typeof source.hostOnly !== 'boolean') {
    throw new TypeError('Malformed cookie hostOnly flag.');
  }
  if (source.hostOnly === true && domainText?.startsWith('.')) {
    throw new TypeError('Inconsistent cookie domain and hostOnly flag.');
  }
  if (domainText && source.hostOnly !== true) {
    details.domain = domainText.startsWith('.') ? `.${host}` : host;
  }

  for (const flag of ['secure', 'httpOnly']) {
    if (source[flag] == null) continue;
    if (typeof source[flag] !== 'boolean') {
      throw new TypeError('Malformed cookie security flag.');
    }
    details[flag] = source[flag];
  }

  if (source.sameSite != null) {
    if (typeof source.sameSite !== 'string') throw new TypeError('Malformed SameSite value.');
    const sameSite = normalizeSameSite(source.sameSite);
    if (sameSite) {
      if (sameSite === 'no_restriction' && details.secure === false) {
        throw new TypeError('SameSite=None requires a secure cookie.');
      }
      details.sameSite = sameSite;
    }
  }

  if (source.session != null && typeof source.session !== 'boolean') {
    throw new TypeError('Malformed cookie session flag.');
  }
  if (source.session !== true) {
    const expiry = source.expirationDate ?? source.expires ?? source.expiry;
    const expirationDate = parseExpiry(expiry);
    if (expirationDate != null) details.expirationDate = expirationDate;
  }
  return details;
}

function parseCookieHeader(text) {
  if (/^set-cookie\s*:/i.test(text)) {
    throw new TypeError('Expected a Cookie request header, not Set-Cookie.');
  }
  const content = text.replace(/^cookie\s*:/i, '').trim();
  if (!content) throw new TypeError('Cookie input contains no cookies.');
  const parts = content.split(';');
  if (parts.length > MAX_COOKIES) {
    throw new RangeError('Cookie input has too many cookies.');
  }
  return parts.map((part) => {
    const entry = part.trim();
    const equals = entry.indexOf('=');
    if (equals <= 0) throw new TypeError('Malformed Cookie header.');
    const name = validateName(entry.slice(0, equals).trim());
    const value = validateValue(entry.slice(equals + 1).trim());
    validateCookieSize(name, value);
    return { url: 'https://chatgpt.com/', name, value, path: '/', secure: true };
  });
}

function validateAllowedHost(raw) {
  if (typeof raw !== 'string') throw new TypeError('Malformed cookie domain.');
  const host = raw.trim().replace(/^\./, '').toLowerCase();
  if (!host || host.split('.').some((label) => !HOST_LABEL.test(label))) {
    throw new TypeError('Malformed cookie domain.');
  }
  if (!['chatgpt.com', 'openai.com'].some((base) => host === base || host.endsWith(`.${base}`))) {
    throw new TypeError('Cookie domain is not permitted.');
  }
  return host;
}

function validateName(value) {
  if (typeof value !== 'string' || !COOKIE_NAME.test(value)) {
    throw new TypeError('Malformed cookie name.');
  }
  return value;
}

function validateValue(value) {
  if (typeof value !== 'string' || /[\x00-\x1f\x7f;]/.test(value)) {
    throw new TypeError('Malformed cookie value.');
  }
  return value;
}

function validateCookieSize(name, value) {
  if (Buffer.byteLength(`${name}=${value}`, 'utf8') > MAX_COOKIE_BYTES) {
    throw new RangeError('A cookie is too large.');
  }
}

function normalizeSameSite(value) {
  const normalized = value.trim().toLowerCase().replace(/[ -]/g, '_');
  if (normalized === 'none' || normalized === 'no_restriction') return 'no_restriction';
  if (['lax', 'strict', 'unspecified'].includes(normalized)) return normalized;
  return null;
}

function parseExpiry(value) {
  if (value == null || value === '') return null;
  let number;
  if (typeof value === 'number') {
    number = value;
  } else if (typeof value === 'string') {
    const numeric = Number(value);
    number = Number.isFinite(numeric) ? numeric : Date.parse(value) / 1000;
  } else {
    return null;
  }
  if (!Number.isFinite(number) || number <= 0) return null;
  // Some exporters use Unix milliseconds instead of Unix seconds.
  if (number > 1e11) number /= 1000;
  return number <= 253402300799 ? number : null;
}

module.exports = { parseCookies };
