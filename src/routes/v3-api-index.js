/**
 * SATP V3 API — Complete Route Index
 *
 * Mount this in your Express app to get all SATP V3 endpoints:
 *
 *   const v3Api = require('./api/v3-api-index');
 *   app.use('/api/v3', v3Api);
 *
 * This gives you:
 *   /api/v3/escrow/*        — Identity-verified escrow (11 endpoints)
 *   /api/v3/reviews/*       — On-chain reviews with self-review prevention (7 endpoints)
 *   /api/v3/reputation/*    — Permissionless reputation recompute (2 endpoints)
 *   /api/v3/validation/*    — Permissionless validation recompute (2 endpoints)
 *
 * Total: 22 V3 API endpoints
 *
 * All POST endpoints return unsigned transactions (base64) — server is stateless.
 * All GET endpoints read directly from Solana chain.
 *
 * Environment variables:
 *   SATP_NETWORK or SOLANA_NETWORK  — 'mainnet' (default) or 'devnet'
 *   SOLANA_RPC_URL                  — Custom RPC endpoint (optional)
 *
 * brainChain — 2026-03-28
 */

const { Router } = require('express');
const router = Router();

// ── Health check ───────────────────────────────────────────────────────────────
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    version: 'v3',
    network: process.env.SATP_NETWORK || process.env.SOLANA_NETWORK || 'mainnet',
    endpoints: {
      identity: 4,
      escrow: 11,
      reviews: 7,
      reputation: 2,
      validation: 2,
      total: 26,
    },
    programs: {
      identity_v3: 'GTppU4E44BqXTQgbqMZ68ozFzhP1TLty3EGnzzjtNZfG',
      reviews_v3: 'r9XX4frcqxxAZ6Au9V5PA3EAxs1zoNckqLLmoSRcNr4',
      attestations_v3: '6Xd1dAQJPvQRJ4Ntr6LtPTjDjPUZ8nfnmYLZaZ2DtrdD',
      reputation_v3: '2Lz7KzMvKdrGeAuS8WPHu7jK2yScrnKVgacpYVEuDjkJ',
      validation_v3: '6rYRiCYidJYV7QvKrzKGgNu4oMh6BAvynked69R7xMbV',
      escrow_v3: 'HXCUWKR2NvRcZ7rNAJHwPcH6QAAWaLR4bRFbfyuDND6C',
    },
    timestamp: new Date().toISOString(),
  });
});

// ── Mount sub-routers ──────────────────────────────────────────────────────────
try {
  const identityRoutes = require('./identity-v3-routes');
  router.use('/identity', identityRoutes);
  console.log('[SATP V3 API] ✅ Identity V3 routes mounted at /api/v3/identity/*');
} catch (e) {
  console.warn('[SATP V3 API] ⚠️ Identity V3 routes failed to load:', e.message);
}

try {
  const escrowRoutes = require('./escrow-v3-routes');
  router.use('/escrow', escrowRoutes);
  console.log('[SATP V3 API] ✅ Escrow V3 routes mounted at /api/v3/escrow/*');
} catch (e) {
  console.warn('[SATP V3 API] ⚠️ Escrow V3 routes failed to load:', e.message);
}

try {
  const reviewRoutes = require('./reviews-v3-routes');
  router.use('/reviews', reviewRoutes);
  console.log('[SATP V3 API] ✅ Reviews V3 routes mounted at /api/v3/reviews/*');
} catch (e) {
  console.warn('[SATP V3 API] ⚠️ Reviews V3 routes failed to load:', e.message);
}

try {
  const repValRoutes = require('./reputation-v3-routes');
  router.use('/', repValRoutes);  // reputation + validation share a router
  console.log('[SATP V3 API] ✅ Reputation/Validation V3 routes mounted at /api/v3/*');
} catch (e) {
  console.warn('[SATP V3 API] ⚠️ Reputation/Validation V3 routes failed to load:', e.message);
}

// ── API index ──────────────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  res.json({
    api: 'SATP V3',
    version: '3.0',
    docs: 'https://agentfolio.bot/docs/api/v3',
    endpoints: {
      health: 'GET /api/v3/health',
      identity: {
        get: 'GET /api/v3/identity/:agentId',
        getByAddress: 'GET /api/v3/identity/address/:pda',
        check: 'GET /api/v3/identity/check/:agentId',
        nameAvailability: 'GET /api/v3/identity/name/:name',
      },
      escrow: {
        create: 'POST /api/v3/escrow/create',
        submitWork: 'POST /api/v3/escrow/submit-work',
        release: 'POST /api/v3/escrow/release',
        partialRelease: 'POST /api/v3/escrow/partial-release',
        cancel: 'POST /api/v3/escrow/cancel',
        dispute: 'POST /api/v3/escrow/dispute',
        resolve: 'POST /api/v3/escrow/resolve',
        close: 'POST /api/v3/escrow/close',
        extendDeadline: 'POST /api/v3/escrow/extend-deadline',
        get: 'GET /api/v3/escrow/:pda',
        derivePDA: 'GET /api/v3/escrow/pda/derive',
      },
      reviews: {
        initCounter: 'POST /api/v3/reviews/init-counter',
        create: 'POST /api/v3/reviews/create',
        createSafe: 'POST /api/v3/reviews/create-safe',
        update: 'POST /api/v3/reviews/update',
        delete: 'POST /api/v3/reviews/delete',
        get: 'GET /api/v3/reviews/:agentId/:reviewer',
        count: 'GET /api/v3/reviews/count/:agentId',
      },
      reputation: {
        recompute: 'POST /api/v3/reputation/recompute',
        get: 'GET /api/v3/reputation/:agentId',
      },
      validation: {
        recompute: 'POST /api/v3/validation/recompute',
        get: 'GET /api/v3/validation/:agentId',
      },
    },
  });
});

module.exports = router;
