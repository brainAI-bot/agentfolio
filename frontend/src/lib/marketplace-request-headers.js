'use strict';

function createMarketplaceMutationHeaders(actorId, idempotencyKey) {
  const key = String(idempotencyKey || '').trim() || globalThis.crypto.randomUUID();
  return {
    'Content-Type': 'application/json',
    'X-Marketplace-Actor': actorId,
    'Idempotency-Key': key,
  };
}

module.exports = { createMarketplaceMutationHeaders };
