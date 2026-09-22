'use strict';

function createMarketplaceMutationHeaders(actorId, idempotencyKey) {
  const key = String(idempotencyKey || '').trim() || globalThis.crypto.randomUUID();
  return {
    'Content-Type': 'application/json',
    'X-Marketplace-Actor': actorId,
    'Idempotency-Key': key,
  };
}

function createMarketplaceMutationKeyStore() {
  const keys = new Map();
  return {
    keyFor(fingerprint, explicitKey) {
      const key = String(explicitKey || '').trim()
        || keys.get(fingerprint)
        || globalThis.crypto.randomUUID();
      keys.set(fingerprint, key);
      return key;
    },
    settle(fingerprint, responseStatus) {
      if (Number(responseStatus) < 500) keys.delete(fingerprint);
    },
  };
}

module.exports = { createMarketplaceMutationHeaders, createMarketplaceMutationKeyStore };
