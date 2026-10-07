'use strict';

// Recovery decisions are deterministic. The model plans useful work only after
// transport proves which request failed. Ambiguous delivery never permits Send.
function recoveryPolicy({ kind = '', reason = '', owned = false, idle = false, newerUserMessage = true } = {}) {
  if (!owned || !idle || newerUserMessage) return { category: 'unconfirmed', action: 'observe', retryDelayMs: 0 };
  if (kind === 'authentication' || kind === 'model-unavailable') return { category: kind, action: 'attention', retryDelayMs: 0 };
  if (kind === 'rate-limit') return { category: kind, action: 'repair', retryDelayMs: 60_000 };
  const category = kind || (/timed?\s*out|timeout/i.test(reason) ? 'timeout' : 'response-interrupted');
  return { category, action: 'repair', retryDelayMs: 0 };
}

module.exports = { recoveryPolicy };
