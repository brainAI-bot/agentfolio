/**
 * SATP REST API Routes
 * Exposes on-chain identity, reputation, verification, and attestation data via REST.
 * All data is read directly from Solana — trustless and verifiable.
 */

const satpIdentity = require('../satp-identity-client');
const satpReviewsOnchain = require('../satp-reviews-onchain');
const { checkOnChainIdentity } = require('../lib/wallet');

// V3 SDK (using SATPV3SDK directly for all V3 operations)
let satpV3Client;
let SATPV3SDK_Class;
try {
  const { SATPV3SDK } = require('../satp-client/src/v3-sdk');
  SATPV3SDK_Class = SATPV3SDK;
  satpV3Client = new SATPV3SDK({ rpcUrl: process.env.SOLANA_RPC_URL || 'https://mainnet.helius-rpc.com/?api-key=REDACTED_HELIUS_API_KEY' });
  console.log('[SATP API] V3 SDK loaded (v3-sdk SATPV3SDK with getGenesisRecord)');
} catch (e) {
  console.warn('[SATP API] V3 SDK not available:', e.message);
}

function registerSATPRoutes(app) {
  // Wallet address validation helper
  const { PublicKey } = require('@solana/web3.js');
  function isValidWallet(addr) {
    try { new PublicKey(addr); return true; } catch { return false; }
  }

  // Warm cache on startup (non-blocking)
  setTimeout(() => {
    satpIdentity.listRegisteredAgents(1, 0)
      .then(r => console.log(`[SATP API] Cache warmed: ${r.total} agents indexed`))
      .catch(e => console.error('[SATP API] Cache warm failed:', e.message));
  }, 5000);

  async function loadProfileByWalletOrId({ wallet = null, profileId = null }) {
    try {
      const Database = require('better-sqlite3');
      const path = require('path');
      const db = new Database(path.join(__dirname, '../../data/agentfolio.db'), { readonly: true });
      let profile = null;
      if (profileId) profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(profileId);
      if (!profile && wallet) profile = db.prepare('SELECT * FROM profiles WHERE wallet = ?').get(wallet);
      if (!profile && wallet) profile = db.prepare('SELECT * FROM profiles WHERE id IN (SELECT profile_id FROM verifications WHERE identifier = ?)').get(wallet);
      try { db.close(); } catch {}
      return profile || null;
    } catch (_) {
      return null;
    }
  }

  async function loadNormalizedTrust(profileId) {
    if (!profileId) return null;
    try {
      const apiBase = process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:3333';
      const trustRes = await globalThis.fetch(`${apiBase}/api/profile/${encodeURIComponent(profileId)}/trust-score`);
      if (!trustRes.ok) return null;
      const trustJson = await trustRes.json();
      return trustJson?.data || null;
    } catch (_) {
      return null;
    }
  }

  function normalizeAttestationPlatform(value) {
    const platform = String(value || '').trim().toLowerCase();
    if (!platform) return null;
    return platform;
  }

  function loadAttestationTxHints(profileId) {
    const hints = {};
    if (!profileId) return hints;
    const setHint = (platform, txSignature) => {
      const normalized = normalizeAttestationPlatform(platform);
      if (!normalized || !txSignature || hints[normalized]) return;
      hints[normalized] = {
        txSignature,
        solscanUrl: 'https://solana.fm/tx/' + txSignature,
      };
    };

    try {
      const Database = require('better-sqlite3');
      const path = require('path');
      const db = new Database(path.join(__dirname, '../../data/agentfolio.db'), { readonly: true });
      const profile = db.prepare('SELECT verification_data FROM profiles WHERE id = ?').get(profileId);
      const attRows = db.prepare('SELECT platform, tx_signature FROM attestations WHERE profile_id = ? AND tx_signature IS NOT NULL ORDER BY created_at DESC').all(profileId);
      for (const row of attRows) setHint(row.platform, row.tx_signature);

      const verifRows = db.prepare('SELECT platform, proof FROM verifications WHERE profile_id = ? ORDER BY verified_at DESC').all(profileId);
      for (const row of verifRows) {
        let proof = {};
        try { proof = typeof row.proof === 'string' ? JSON.parse(row.proof) : (row.proof || {}); } catch {}
        setHint(row.platform, proof.txSignature || proof.signature || proof.transactionSignature || null);
      }

      let verificationData = {};
      try { verificationData = JSON.parse(profile?.verification_data || '{}'); } catch {}
      for (const [platform, data] of Object.entries(verificationData || {})) {
        const txSignature = data && typeof data === 'object' ? (data.txSignature || data.signature || data.transactionSignature || null) : null;
        setHint(platform, txSignature);
      }
      db.close();
    } catch (_) {}

    return hints;
  }

  async function buildOnchainStatus({ wallet = null, profileId = null }) {
    const profile = await loadProfileByWalletOrId({ wallet, profileId });
    const resolvedWallet = wallet || profile?.wallet || null;
    if (!resolvedWallet || !isValidWallet(resolvedWallet)) {
      return { status: 404, body: { ok: false, error: 'wallet not found' } };
    }

    const onchain = await checkOnChainIdentity(resolvedWallet);
    const trust = await loadNormalizedTrust(profile?.id || profileId || null);
    const normalizedScore = trust && typeof trust.reputationScore === 'number'
      ? (trust.reputationScore > 10000 ? Math.round(trust.reputationScore / 10000) : trust.reputationScore)
      : 0;

    return {
      status: 200,
      body: {
        ok: true,
        wallet: resolvedWallet,
        profileId: profile?.id || profileId || null,
        registered: !!onchain?.registered,
        pda: onchain?.pda || onchain?.pdas?.identity || null,
        identity: onchain?.identity || null,
        reputation: onchain?.reputation || null,
        rawAuthority: onchain?.identity?.authority || null,
        rawVerificationLevel: onchain?.reputation?.verificationLevel ?? null,
        rawReputationScore: onchain?.reputation?.reputationScore ?? null,
        trustScore: normalizedScore,
        verificationLevel: trust?.verificationLevel || 0,
        verificationLabel: trust?.verificationLabel || trust?.levelName || 'Unverified',
        source: trust ? 'normalized-profile-trust' : 'onchain-only',
      }
    };
  }

  app.get('/api/wallet/onchain-status/:wallet', async (req, res) => {
    const result = await buildOnchainStatus({ wallet: req.params.wallet });
    res.status(result.status).json(result.body);
  });

  app.get('/api/profile/:id/onchain-status', async (req, res) => {
    const result = await buildOnchainStatus({ profileId: req.params.id });
    res.status(result.status).json(result.body);
  });
  
  // ─── Agent Identity ──────────────────────────────────
  
  /**
   * GET /api/satp/identity/:wallet
   * Returns full on-chain identity for a wallet
   */
  app.get('/api/satp/identity/:wallet', async (req, res) => {
    try {
      const network = req.query.network || 'mainnet';
      if (!isValidWallet(req.params.wallet)) return res.status(400).json({ error: 'Invalid wallet address' });
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
      // Input validation: reject non-base58 wallet strings early
      const walletParam = req.params.wallet;
      if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(walletParam)) {
        return res.status(400).json({ error: "Invalid wallet address", detail: "Must be a valid base58 Solana address (32-44 chars)" });
      }
    try {
      var wallet = req.params.wallet;
      var network = req.query.network || 'mainnet';
      var scores = await satpIdentity.getAgentScores(wallet, network);
      if (!scores) {
        return res.json({ ok: true, data: { wallet: wallet, reputationScore: 0, reputationScoreRaw: 0, verificationLevel: 0, verificationLabel: "Unverified", reputationRank: "Newcomer", onChain: false, trustless: true } });
      }
      // Enrich with V3 on-chain scores (cached, from Solana V3 program)
      try {
        var v3Explorer = require('../v3-explorer');
        var v3Agents = await v3Explorer.fetchAllV3Agents();
        var v3Match = v3Agents.find(function(a) { return a.authority === wallet; });
        if (v3Match) {
          scores.rawReputationScore = v3Match.reputationScore;
          scores.rawVerificationLevel = v3Match.verificationLevel;
          scores.rawVerificationLabel = v3Match.tierLabel;
          scores.reputationScore = v3Match.reputationScore;
          scores.verificationLevel = v3Match.verificationLevel;
          scores.verificationLabel = v3Match.tierLabel;
          scores.reputationRank = satpIdentity.scoreToRank(v3Match.reputationScore);
          scores.tier = v3Match.tier;
          scores.trustScore = v3Match.reputationScore;
          scores.source = 'v3-onchain';
        }
      } catch (v3e) {
        // V3 lookup failed, return V2 data as-is
      }

      // Profile-facing SATP score responses should prefer normalized profile trust
      // when this wallet is linked to a known AgentFolio profile.
      try {
        const Database = require('better-sqlite3');
        const path = require('path');
        const db = new Database(path.join(__dirname, '../../data/agentfolio.db'), { readonly: true });
        let matchedProfile = db.prepare("SELECT * FROM profiles WHERE wallet = ?").get(wallet);
        if (!matchedProfile) {
          matchedProfile = db.prepare("SELECT * FROM profiles WHERE id IN (SELECT profile_id FROM verifications WHERE identifier = ?)").get(wallet);
        }
        try { db.close(); } catch {}
        if (matchedProfile?.id) {
          const apiBase = process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:3333';
          const trustRes = await globalThis.fetch(`${apiBase}/api/profile/${encodeURIComponent(matchedProfile.id)}/trust-score`);
          if (trustRes.ok) {
            const trustJson = await trustRes.json();
            const trust = trustJson?.data;
            if (trust && typeof trust.reputationScore === 'number') {
              const normalizedScore = trust.reputationScore > 10000 ? Math.round(trust.reputationScore / 10000) : trust.reputationScore;
              scores.reputationScore = normalizedScore;
              scores.trustScore = normalizedScore;
              scores.verificationLevel = trust.verificationLevel || 0;
              scores.verificationLabel = trust.verificationLabel || trust.levelName || scores.verificationLabel;
              scores.reputationRank = satpIdentity.scoreToRank(normalizedScore);
              scores.tier = trust.verificationLabel || trust.levelName || scores.tier;
              scores.source = 'normalized-profile-trust';
              scores.profileId = matchedProfile.id;
            }
          }
        }
      } catch (_) {}
      res.json({ ok: true, data: scores });
    } catch (err) {
      console.error('[SATP API] scores error: ' + err.message);
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
      if (!isValidWallet(req.params.wallet)) return res.status(400).json({ error: 'Invalid wallet address' });
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

      let normalizedTrust = null;
      let profileId = null;
      try {
        const Database = require('better-sqlite3');
        const path = require('path');
        const dbPath = path.join(__dirname, '..', '..', 'data', 'agentfolio.db');
        const db = new Database(dbPath, { readonly: true });
        try {
          const profile = db.prepare("SELECT id FROM profiles WHERE wallet = ? OR json_extract(wallets, '$.solana') = ? LIMIT 1").get(wallet, wallet);
          profileId = profile?.id || null;
        } finally {
          db.close();
        }
        if (profileId) {
          const trustRes = await globalThis.fetch(`http://127.0.0.1:3333/api/profile/${encodeURIComponent(profileId)}/trust-score`);
          if (trustRes.ok) {
            const trustJson = await trustRes.json();
            normalizedTrust = trustJson?.data || null;
          }
        }
      } catch (_) {}

      const reputationScore = normalizedTrust?.reputationScore ?? identity.reputationScore;
      const verificationLevel = normalizedTrust?.verificationLevel ?? identity.verificationLevel;
      const verificationLabel = normalizedTrust?.verificationLabel || satpIdentity.levelToLabel(verificationLevel);
      
      res.json({
        ok: true,
        data: {
          identity: normalizedTrust ? {
            ...identity,
            rawReputationScore: identity.reputationScore,
            rawVerificationLevel: identity.verificationLevel,
            rawVerificationLabel: satpIdentity.levelToLabel(identity.verificationLevel),
            reputationScore,
            verificationLevel,
            verificationLabel,
            profileId,
          } : identity,
          scores: {
            reputationScore,
            reputationRank: satpIdentity.scoreToRank(reputationScore),
            verificationLevel,
            verificationLabel,
            trustless: true,
            source: normalizedTrust ? 'normalized-profile-trust' : 'solana-mainnet',
            profileId,
            rawReputationScore: identity.reputationScore,
            rawVerificationLevel: identity.verificationLevel,
            rawVerificationLabel: satpIdentity.levelToLabel(identity.verificationLevel),
          },
          attestations: {
            count: attestations.length,
            verified: attestations.filter(a => a.verified && !a.expired).length,
            types: [...new Set(attestations.map(a => a.attestationType))],
            items: attestations,
          },
          meta: {
            source: normalizedTrust ? 'normalized-profile-trust' : 'solana-mainnet',
            profileId,
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
        const result = await satpIdentity.listRegisteredAgents(500, 0);
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
      if (!isValidWallet(req.params.wallet)) return res.status(400).json({ error: 'Invalid wallet address' });
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
      if (!isValidWallet(req.params.wallet)) return res.status(400).json({ error: 'Invalid wallet address' });
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
      const wallet = req.params.wallet;
      if (!isValidWallet(wallet)) return res.status(400).json({ error: 'Invalid wallet address' });
      const rep = await satpReviewsOnchain.getReputation(wallet);

      let profileId = null;
      let normalizedTrust = null;
      try {
        const Database = require('better-sqlite3');
        const path = require('path');
        const db = new Database(path.join(__dirname, '..', '..', 'data', 'agentfolio.db'), { readonly: true });
        try {
          const profile = db.prepare("SELECT id FROM profiles WHERE wallet = ? OR json_extract(wallets, '$.solana') = ? LIMIT 1").get(wallet, wallet);
          profileId = profile?.id || null;
        } finally {
          db.close();
        }
        if (profileId) {
          const trustRes = await globalThis.fetch(`http://127.0.0.1:3333/api/profile/${encodeURIComponent(profileId)}/trust-score`);
          if (trustRes.ok) {
            const trustJson = await trustRes.json();
            normalizedTrust = trustJson?.data || null;
          }
        }
      } catch (_) {}

      if (!rep && !normalizedTrust) {
        return res.status(404).json({ error: 'No reputation account found', wallet });
      }

      const rawScore = rep?.reputationScore ?? 0;
      const rawLevel = rep?.verificationLevel ?? 1;
      const rawLabel = rep?.verificationLabel || 'Registered';
      const reputationScore = normalizedTrust?.reputationScore ?? rawScore;
      const verificationLevel = normalizedTrust?.verificationLevel ?? rawLevel;
      const verificationLabel = normalizedTrust?.verificationLabel ?? rawLabel;

      res.json({
        ok: true,
        data: {
          ...(rep || {}),
          reputationScore,
          verificationLevel,
          verificationLabel,
          source: normalizedTrust ? 'normalized-profile-trust' : 'solana-mainnet',
          profileId,
          rawReputationScore: rawScore,
          rawVerificationLevel: rawLevel,
          rawVerificationLabel: rawLabel,
        }
      });
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


  // ─── V3 Genesis Record Routes ────────────────────────

  /**
   * GET /api/satp/v3/agent/:agentId
   * Returns V3 Genesis Record by agent_id (not wallet)
   */
  app.get('/api/satp/v3/agent/:agentId', async (req, res) => {
    if (!satpV3Client) return res.status(503).json({ error: 'V3 SDK not available' });
    try {
      const record = await satpV3Client.getGenesisRecord(req.params.agentId);
      if (!record) return res.status(404).json({ error: 'No Genesis Record', agentId: req.params.agentId });
      
      // DB override: if nft_avatar.permanent=true, set isBorn=true + add face data
      try {
        const Database = require('better-sqlite3');
        const path = require('path');
        const db = new Database(path.join(__dirname, '../../data/agentfolio.db'), { readonly: true });
        const row = db.prepare('SELECT nft_avatar FROM profiles WHERE id = ?').get(req.params.agentId);
        db.close();
        if (row && row.nft_avatar) {
          const nftData = JSON.parse(row.nft_avatar);
          if (nftData.permanent) {
            // HARD RULE: isBorn comes from on-chain ONLY — never from DB (CEO directive 2026-03-31)
            record.dbFaceImage = nftData.image || null;
            record.dbSoulboundMint = nftData.soulboundMint || null;
            record.dbBurnTx = nftData.burnTxSignature || null;
          }
        }
      } catch (dbErr) { /* ignore */ }
      
      res.json({ ok: true, source: 'satp_v3_onchain', data: record });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * GET /api/satp/v3/agent/:agentId/scores
   * Returns on-chain reputation + verification from V3 Genesis Record
   */
  app.get('/api/satp/v3/agent/:agentId/scores', async (req, res) => {
    if (!satpV3Client) return res.status(503).json({ error: 'V3 SDK not available' });
    try {
      const record = await satpV3Client.getGenesisRecord(req.params.agentId);
      if (!record) return res.status(404).json({ error: 'No Genesis Record', agentId: req.params.agentId });

      let normalizedTrust = null;
      try {
        const trustRes = await globalThis.fetch(`http://127.0.0.1:3333/api/profile/${encodeURIComponent(req.params.agentId)}/trust-score`);
        if (trustRes.ok) {
          const trustJson = await trustRes.json();
          normalizedTrust = trustJson?.data || null;
        }
      } catch (_) {}

      const reputationScore = normalizedTrust?.reputationScore ?? record.reputationScore;
      const verificationLevel = normalizedTrust?.verificationLevel ?? record.verificationLevel;
      const verificationLabel = normalizedTrust?.verificationLabel ?? record.verificationLabel;

      res.json({
        ok: true,
        source: normalizedTrust ? 'normalized-profile-trust' : 'satp_v3_onchain',
        data: {
          reputationScore,
          reputationPct: normalizedTrust ? ((reputationScore || 0) / 10).toFixed(2) : record.reputationPct,
          verificationLevel,
          verificationLabel,
          isBorn: record.isBorn,
          pda: record.pda,
          profileId: req.params.agentId,
          rawReputationScore: record.reputationScore,
          rawVerificationLevel: record.verificationLevel,
          rawVerificationLabel: record.verificationLabel,
        }
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * GET /api/satp/v3/resolve/:agentId
   * Returns the PDA address for an agent_id (no RPC needed)
   */
  app.get('/api/satp/v3/resolve/:agentId', (req, res) => {
    if (!satpV3Client) return res.status(503).json({ error: 'V3 SDK not available' });
    const pda = satpV3Client.resolveAgent(req.params.agentId);
    res.json({ ok: true, agentId: req.params.agentId, pda });
  });

  // ═══ V3 NAME REGISTRY + LINKED WALLETS (added 2026-03-22) ═══

  app.get('/api/satp/v3/name/:name', async (req, res) => {
    if (!satpV3Client) return res.status(503).json({ error: 'V3 SDK not available' });
    try {
      const reg = await satpV3Client.getNameRegistry(req.params.name);
      if (!reg) return res.status(404).json({ error: 'Name not registered', name: req.params.name });
      res.json({ ok: true, data: reg });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/satp/v3/name/:name/available', async (req, res) => {
    if (!satpV3Client) return res.status(503).json({ error: 'V3 SDK not available' });
    try {
      const taken = await satpV3Client.isNameTaken(req.params.name);
      res.json({ ok: true, name: req.params.name, available: !taken });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/satp/v3/agent/:agentId/wallets', async (req, res) => {
    if (!satpV3Client) return res.status(503).json({ error: 'V3 SDK not available' });
    try {
      const wallets = await satpV3Client.getLinkedWallets(req.params.agentId);
      res.json({ ok: true, agentId: req.params.agentId, count: wallets.length, wallets });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  console.log('[SATP API] Routes registered: /api/satp/{identity,scores,attestations,registry,profile,programs,reviews,reputation} + /api/satp/v3/{agent,scores,resolve,name,wallets} + /api/satp/attestations/by-agent/:agentId');

  // ═══ Attestations by Agent ID (with TX signatures) ═══
  // Returns full attestation data from chain-cache for verify-attestations tool
  app.get('/api/satp/attestations/by-agent/:agentId', async (req, res) => {
    try {
      const chainCache = require('../lib/chain-cache');
      const { agentId } = req.params;
      const attestations = chainCache.getVerifications(agentId);
      const txHints = loadAttestationTxHints(agentId);
      const enriched = [];

      for (const a of attestations) {
        let proofData = {};
        try { proofData = typeof a.proofData === 'string' ? JSON.parse(a.proofData) : (a.proofData || {}); } catch {}
        const platform = normalizeAttestationPlatform(a.platform) || a.platform;
        const hinted = txHints[platform] || null;
        const txSignature = a.txSignature || proofData.txSignature || proofData.signature || proofData.transactionSignature || hinted?.txSignature || null;
        enriched.push({
          platform,
          txSignature,
          memo: a.memo || null,
          proofHash: a.proofHash || null,
          signer: a.signer || null,
          timestamp: a.timestamp || null,
          solscanUrl: hinted?.solscanUrl || a.solscanUrl || (txSignature ? ('https://solana.fm/tx/' + txSignature) : null),
        });
      }

      // Only synthesize DB proof hints when chain-cache returned nothing at all.
      if (enriched.length === 0) {
        for (const [platform, hint] of Object.entries(txHints)) {
          if (!platform) continue;
          enriched.push({
            platform,
            txSignature: hint?.txSignature || null,
            memo: null,
            proofHash: null,
            signer: null,
            timestamp: null,
            solscanUrl: hint?.solscanUrl || (hint?.txSignature ? ('https://solana.fm/tx/' + hint.txSignature) : null),
          });
        }
      }

      const platforms = enriched.map(a => normalizeAttestationPlatform(a.platform) || a.platform).filter(Boolean);
      
      res.json({
        ok: true,
        data: {
          agentId,
          count: enriched.length,
          platforms,
          attestations: enriched,
        },
      });
    } catch (err) {
      console.error('[SATP API] attestations by-agent error:', err.message);
      res.status(500).json({ error: 'Failed to fetch attestations', detail: err.message });
    }
  });
}

module.exports = { registerSATPRoutes };
