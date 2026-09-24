'use strict';

const crypto = require('node:crypto');

const DEFAULT_TOLERANCE_SECONDS = 5 * 60;
const DEFAULT_REPLAY_CACHE_SIZE = 10_000;

function rawBodyBuffer(rawBody) {
  if (Buffer.isBuffer(rawBody)) return rawBody;
  if (ArrayBuffer.isView(rawBody)) return Buffer.from(rawBody.buffer, rawBody.byteOffset, rawBody.byteLength);
  if (typeof rawBody === 'string') return Buffer.from(rawBody, 'utf8');
  throw new TypeError('rawBody must be a Buffer, Uint8Array, or string containing the exact request body');
}

function signatureHex(signature) {
  const value = String(signature || '').trim();
  const match = /^v1=([a-f0-9]{64})$/i.exec(value);
  return match ? match[1].toLowerCase() : '';
}

function signWebhookBody(rawBody, secret, timestamp) {
  const body = rawBodyBuffer(rawBody);
  const normalizedTimestamp = String(timestamp);
  const signature = crypto
    .createHmac('sha256', String(secret || ''))
    .update(normalizedTimestamp)
    .update('.')
    .update(body)
    .digest('hex');
  return `v1=${signature}`;
}

function createWebhookReplayCache({ maxEntries = DEFAULT_REPLAY_CACHE_SIZE } = {}) {
  const entries = new Map();
  return {
    has(key) {
      return entries.has(key);
    },
    add(key, expiresAtMs) {
      entries.set(key, expiresAtMs);
      while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
    },
    prune(nowMs = Date.now()) {
      for (const [key, expiresAt] of entries) {
        if (expiresAt <= nowMs) entries.delete(key);
      }
    },
    clear() {
      entries.clear();
    },
  };
}

const defaultReplayCache = createWebhookReplayCache();

function verifyWebhookSignature({
  rawBody,
  secret,
  signature,
  timestamp,
  deliveryId,
}, {
  now = Date.now(),
  toleranceSeconds = DEFAULT_TOLERANCE_SECONDS,
  replayCache = defaultReplayCache,
} = {}) {
  let body;
  try {
    body = rawBodyBuffer(rawBody);
  } catch (error) {
    return { valid: false, code: 'INVALID_BODY', error: error.message };
  }
  const timestampText = String(timestamp || '').trim();
  const timestampNumber = Number(timestampText);
  if (!/^\d+$/.test(timestampText) || !Number.isSafeInteger(timestampNumber)) {
    return { valid: false, code: 'INVALID_TIMESTAMP', error: 'Webhook timestamp must be integer Unix seconds' };
  }
  const delivery = String(deliveryId || '').trim();
  if (!delivery || delivery.length > 200) {
    return { valid: false, code: 'INVALID_DELIVERY_ID', error: 'Webhook delivery ID is required' };
  }
  const tolerance = Number(toleranceSeconds);
  if (!Number.isFinite(tolerance) || tolerance < 0) {
    return { valid: false, code: 'INVALID_TOLERANCE', error: 'Webhook tolerance must be a non-negative number' };
  }
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const ageSeconds = Math.abs(nowMs - (timestampNumber * 1000)) / 1000;
  if (ageSeconds > tolerance) {
    return { valid: false, code: 'TIMESTAMP_OUTSIDE_TOLERANCE', error: 'Webhook timestamp is outside the allowed tolerance' };
  }
  const suppliedHex = signatureHex(signature);
  if (!suppliedHex) {
    return { valid: false, code: 'INVALID_SIGNATURE_FORMAT', error: 'Webhook signature must be v1=<64 hex characters>' };
  }
  const expectedHex = signWebhookBody(body, secret, timestampText).slice(3);
  const supplied = Buffer.from(suppliedHex, 'hex');
  const expected = Buffer.from(expectedHex, 'hex');
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
    return { valid: false, code: 'SIGNATURE_MISMATCH', error: 'Webhook signature does not match the exact raw body' };
  }
  const replayKey = delivery;
  replayCache.prune?.(nowMs);
  if (replayCache.has(replayKey)) {
    return { valid: false, code: 'REPLAY_DETECTED', error: 'Webhook delivery has already been accepted' };
  }
  replayCache.add(replayKey, nowMs + (tolerance * 1000));
  return { valid: true, code: 'VERIFIED', deliveryId: delivery, timestamp: timestampNumber };
}

module.exports = {
  DEFAULT_TOLERANCE_SECONDS,
  createWebhookReplayCache,
  signWebhookBody,
  verifyWebhookSignature,
};
