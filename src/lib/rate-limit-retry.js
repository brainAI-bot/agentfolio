/**
 * Parse HTTP Retry-After into milliseconds.
 * Supports integer seconds and HTTP-date values.
 *
 * @param {string | null | undefined} retryAfter
 * @param {number} [nowMs]
 * @returns {number | null}
 */
function parseRetryAfterMs(retryAfter, nowMs = Date.now()) {
  if (retryAfter == null) return null;
  const value = String(retryAfter).trim();
  if (!value) return null;

  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return Math.max(0, Math.round(seconds * 1000));
  }

  const dateMs = Date.parse(value);
  if (!Number.isNaN(dateMs)) {
    return Math.max(0, dateMs - nowMs);
  }

  return null;
}

/**
 * Compute retry delay for rate-limited upstream calls.
 * Honors Retry-After when present, otherwise falls back to exponential backoff.
 *
 * @param {{ retryAfter?: string | null, attempt?: number, initialDelayMs?: number, maxDelayMs?: number }} options
 * @returns {number}
 */
function getRateLimitDelay({ retryAfter = null, attempt = 0, initialDelayMs = 500, maxDelayMs = 10000 } = {}) {
  const exponentialDelay = initialDelayMs * (2 ** attempt);
  const retryAfterMs = parseRetryAfterMs(retryAfter);
  const chosen = retryAfterMs == null ? exponentialDelay : Math.max(exponentialDelay, retryAfterMs);
  return Math.min(chosen, maxDelayMs);
}

module.exports = { parseRetryAfterMs, getRateLimitDelay };
