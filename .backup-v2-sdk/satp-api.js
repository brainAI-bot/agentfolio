/**
 * SATP REST API Routes
 * Exposes on-chain identity, reputation, verification, and attestation data via REST.
 * All data is read directly from Solana — trustless and verifiable.
 */

const satpIdentity = require('../satp-identity-client');
const satpReviewsOnchain = require('../satp-reviews-onchain');

function registerSATPRoutes(app) {
  // Warm cache on startup (non-blocking)
  setTimeout(() => {
    satpIdentity.listRegisteredAgents(1, 0)
      .then(r => console.log(`[SATP API] Cache warmed: ${r.total} agents indexed`))
      .catch(e => console.error('[SATP API] Cache warm failed:', e.message));
  }, 5000);
  
  // ─── Agent Identity ──────────────────────────────────
  
  /**
   * GET /api/satp/identity/:wallet
   * Returns full on-chain identity for a wallet
   */
  app.get('/api/satp/identity/:wallet', async (req, res) => {
    try {
      const network = req.query.network || 'mainnet';
      const identity = await satpIdentity.getAgentIdentity(req.params.wallet, network);
      if (!identity) {
        return res.status(404).json({ error: 'Agent not registered on-chain', wallet: req.params.wallet });
      }
      res.json({ ok: true, data: identity });
    } catch (err) {
      console.error('[SATP API] identity error:', err.message);
      res.status(500).json({ error: 'Failed to fetch identity', detail: err.message });
    }
  });

  // ─── Scores (Reputation + Verification Level) ────────
  
  /**
   * GET /api/satp/scores/:wallet
   * Returns on-chain computed reputation score and verification level
   * These are trustlessly computed by the Reputation and Validation programs
   */
  app.get('/api/satp/scores/:wallet', async (req, res) => {
    try {
      const network = req.query.network || 'mainnet';
      const scores = await satpIdentity.getAgentScores(req.params.wallet, network);
      if (!scores) {
        return res.status(404).json({ error: 'Agent not found on-chain', wallet: req.params.wallet });
      }
      res.json({ ok: true, data: scores });
    } catch (err) {
      console.error('[SATP API] scores error:', err.message);
      res.status(500).json({ error: 'Failed to fetch scores', detail: err.message });
    }
  });

  // ─── Attestations ────────────────────────────────────
  
  /**
   * GET /api/satp/attestations/:wallet
   * Returns all on-chain attestations for an agent
   */
  app.get('/api/satp/attestations/:wallet', async (req, res) => {
    try {
      const attestations = await satpIdentity.getAgentAttestations(req.params.wallet);
      res.json({
        ok: true,
        data: {
          wallet: req.params.wallet,
          count: attestations.length,
          attestations,
          types: [...new Set(attestations.map(a => a.attestationType))],
          verified: attestations.filter(a => a.verified && !a.expired).length,
        },
      });
    } catch (err) {
      console.error('[SATP API] attestations error:', err.message);
      res.status(500).json({ error: 'Failed to fetch attestations', detail: err.message });
    }
  });

  // ─── Registry (List All Agents) ──────────────────────
  
  /**
   * GET /api/satp/registry
   * Lists all registered agents with pagination
   * Query: ?limit=50&offset=0
   */
  app.get('/api/satp/registry', async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit) || 50, 100);
      const offset = parseInt(req.query.offset) || 0;
      const result = await satpIdentity.listRegisteredAgents(limit, offset);
      res.json({ ok: true, data: result });
    } catch (err) {
      console.error('[SATP API] registry error:', err.message);
      res.status(500).json({ error: 'Failed to list agents', detail: err.message });
    }
  });

  // ─── Combined Profile (Identity + Scores + Attestations) ─
  
  /**
   * GET /api/satp/profile/:wallet
   * Returns everything: identity + scores + attestations in one call
   */
  app.get('/api/satp/profile/:wallet', async (req, res) => {
    try {
      const wallet = req.params.wallet;
      const network = req.query.network || 'mainnet';
      const results = await Promise.allSettled([
        satpIdentity.getAgentIdentity(wallet, network),
        satpIdentity.getAgentAttestations(wallet),
      ]);
      const identity = results[0].status === 'fulfilled' ? results[0].value : null;
      const attestations = results[1].status === 'fulfilled' ? results[1].value : [];
      
      if (!identity) {
        return res.status(404).json({ error: 'Agent not registered on-chain', wallet });
      }
      
      res.json({
        ok: true,
        data: {
          identity,
          scores: {
            reputationScore: identity.reputationScore,
            reputationRank: satpIdentity.scoreToRank(identity.reputationScore),
            verificationLevel: identity.verificationLevel,
            verificationLabel: satpIdentity.levelToLabel(identity.verificationLevel),
            trustless: true,
          },
          attestations: {
            count: attestations.length,
            verified: attestations.filter(a => a.verified && !a.expired).length,
            types: [...new Set(attestations.map(a => a.attestationType))],
            items: attestations,
          },
          meta: {
            source: 'solana-mainnet',
            programs: {
              identity: satpIdentity.PROGRAMS.IDENTITY.toBase58(),
              reputation: satpIdentity.PROGRAMS.REPUTATION.toBase58(),
              validation: satpIdentity.PROGRAMS.VALIDATION.toBase58(),
              reviews: satpIdentity.PROGRAMS.REVIEWS.toBase58(),
            },
          },
        },
      });
    } catch (err) {
      console.error('[SATP API] profile error:', err.message);
      res.status(500).json({ error: 'Failed to fetch profile', detail: err.message });
    }
  });

  // ─── Search by name ───────────────────────────────────
  
  /**
   * GET /api/satp/search?name=brainGrowth
   * Find agent by name
   */
  app.get('/api/satp/search', async (req, res) => {
    try {
      if (!req.query.name) {
        return res.status(400).json({ error: 'Missing ?name= parameter' });
      }
      const query = req.query.name.toLowerCase();

      // 1. Try exact on-chain name match
      let agent = await satpIdentity.findAgentByName(query);
      if (agent) return res.json({ ok: true, source: 'onchain', data: agent });

      // 2. Partial match across all on-chain agents
      try {
        const result = await satpIdentity.listRegisteredAgents(200, 0);
        const allAgents = Array.isArray(result) ? result : (result?.agents || result?.page || []);
        if (allAgents.length) {
          const partial = allAgents.find(a =>
            (a.name && a.name.toLowerCase().includes(query)) ||
            (a.authority && a.authority.toLowerCase().startsWith(query))
          );
          if (partial) return res.json({ ok: true, source: 'onchain-partial', data: partial });
        }
      } catch (e) { /* on-chain search failed, fall through to DB */ }

      // 3. Search local DB profiles and cross-reference on-chain
      const Database = require('better-sqlite3');
      const dbPath = require('path').join(__dirname, '..', '..', 'data', 'agentfolio.db');
      try {
        const db = new Database(dbPath, { readonly: true });
        const rows = db.prepare(
          `SELECT id, name, json_extract(wallets, '$.solana') as solana_wallet FROM profiles WHERE LOWER(name) LIKE ? LIMIT 5`
        ).all(`%${query}%`);
        db.close();

        if (rows.length > 0) {
          // Try to enrich with on-chain data
          const results = [];
          for (const row of rows) {
            let onChain = null;
            if (row.solana_wallet) {
              try { onChain = await satpIdentity.getAgentIdentity(row.solana_wallet); } catch {}
            }
            results.push({ profileId: row.id, name: row.name, wallet: row.solana_wallet, onChain });
          }
          return res.json({ ok: true, source: 'db', data: results });
        }
      } catch (dbErr) {
        console.error('[SATP API] DB search fallback error:', dbErr.message);
      }

      return res.status(404).json({ error: 'Agent not found', name: req.query.name });
    } catch (err) {
      console.error('[SATP API] search error:', err.message);
      res.status(500).json({ error: 'Search failed', detail: err.message });
    }
  });

  // ─── Program Info ────────────────────────────────────
  
  /**
   * GET /api/satp/programs
   * Returns program IDs and metadata
   */
  app.get('/api/satp/programs', (req, res) => {
    const network = req.query.network || 'mainnet';
    const progs = satpIdentity.getPrograms(network);
    res.json({
      ok: true,
      data: {
        programs: Object.fromEntries(
          Object.entries(progs).map(([k, v]) => [k.toLowerCase(), v.toBase58()])
        ),
        legacy: Object.fromEntries(
          Object.entries(satpIdentity.LEGACY_PROGRAMS).map(([k, v]) => [k.toLowerCase(), v.toBase58()])
        ),
        network: network === 'devnet' ? 'devnet' : 'mainnet-beta',
        architecture: 'proof-based-trustless',
        description: 'SATP v2 — Solana Agent Trust Protocol. 5-program cluster with CPI-based scoring.',
      },
    });
  });

  // ─── On-Chain Reviews (v2) ─────────────────────────────

  /**
   * GET /api/satp/reviews/:wallet
   * Returns on-chain reviews received by an agent (v2 with categories + weighted scoring)
   */
  app.get('/api/satp/reviews/:wallet', async (req, res) => {
    try {
      const reviews = await satpReviewsOnchain.getReviewsForAgent(req.params.wallet);
      const stats = await satpReviewsOnchain.getReviewStats(req.params.wallet);
      res.json({ ok: true, data: { reviews, stats, source: 'on-chain' } });
    } catch (err) {
      console.error('[SATP API] reviews error:', err.message);
      res.status(500).json({ error: 'Failed to fetch reviews', detail: err.message });
    }
  });

  /**
   * GET /api/satp/reviews/:wallet/given
   * Returns on-chain reviews given BY an agent
   */
  app.get('/api/satp/reviews/:wallet/given', async (req, res) => {
    try {
      const reviews = await satpReviewsOnchain.getReviewsByAgent(req.params.wallet);
      res.json({ ok: true, data: { reviews, total: reviews.length, source: 'on-chain' } });
    } catch (err) {
      console.error('[SATP API] reviews/given error:', err.message);
      res.status(500).json({ error: 'Failed to fetch given reviews', detail: err.message });
    }
  });

  /**
   * GET /api/satp/reputation/:wallet
   * Returns on-chain reputation account (weighted scores from reviews program)
   */
  app.get('/api/satp/reputation/:wallet', async (req, res) => {
    try {
      const rep = await satpReviewsOnchain.getReputation(req.params.wallet);
      if (!rep) {
        return res.status(404).json({ error: 'No reputation account found', wallet: req.params.wallet });
      }
      res.json({ ok: true, data: rep });
    } catch (err) {
      console.error('[SATP API] reputation error:', err.message);
      res.status(500).json({ error: 'Failed to fetch reputation', detail: err.message });
    }
  });

  /**
   * GET /api/satp/reviews
   * Lists all on-chain reviews (paginated)
   * Query: ?limit=50&offset=0
   */
  app.get('/api/satp/reviews', async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit) || 50, 100);
      const offset = parseInt(req.query.offset) || 0;
      const result = await satpReviewsOnchain.getAllReviews(limit, offset);
      res.json({ ok: true, data: result });
    } catch (err) {
      console.error('[SATP API] all reviews error:', err.message);
      res.status(500).json({ error: 'Failed to list reviews', detail: err.message });
    }
  });

  console.log('[SATP API] Routes registered: /api/satp/{identity,scores,attestations,registry,profile,programs,reviews,reputation}');
}

module.exports = { registerSATPRoutes };
