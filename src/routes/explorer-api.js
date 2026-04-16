/**
 * Explorer API Routes — serves chain-cache data at /api/explorer/*
 * 
 * These routes bridge the chain-cache layer to the public API.
 * Chain-cache is already running (started in server.js), these routes
 * just expose its data at the /api/explorer/* endpoints.
 * 
 * Routes:
 *   GET /api/explorer/agents       — List all on-chain agents (V3 Genesis Records)
 *   GET /api/explorer/stats        — Chain-cache stats (identity/attestation counts)
 *   GET /api/explorer/leaderboard  — Reputation leaderboard from V3 Genesis Records
 *   GET /api/explorer/search       — Search agents by name/category
 * 
 * Note: GET /api/explorer/:agentId already exists inline in server.js (line 358)
 * 
 * brainChain — 2026-03-27
 */

const express = require('express');
const router = express.Router();

const SITE_URL = process.env.PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || 'https://agentfolio.bot';

const NON_PUBLIC_EXPLORER_NAMES = new Set([
  'Smoke 423064591',
  'Smoke 423302531',
  'Smoke 423302532',
  'brainTEST',
  'test',
  'ratecheck',
  'ratecheck2',
  'ratetest1',
  'ratetest2',
  'ratetest3',
  'ratelimit-probe',
  '__rate_test__',
  'CEO Selftest 55648944',
]);

function isNonPublicExplorerAgent(agent) {
  const name = String(agent?.agentName || '').trim();
  if (!name) return true;
  if (NON_PUBLIC_EXPLORER_NAMES.has(name)) return true;
  const lower = name.toLowerCase();
  if (lower.startsWith('ratecheck') || lower.startsWith('ratetest')) return true;
  if (lower === 'ratelimit-probe' || lower === '__rate_test__') return true;
  if (lower === 'test') return true;
  if (lower.startsWith('ceo selftest ')) return true;
  return false;
}

function parseJsonField(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function getProfileAvatar(profileRow, fallback = null) {
  const nftAvatar = parseJsonField(profileRow?.nft_avatar, null);
  return nftAvatar?.image || nftAvatar?.arweaveUrl || profileRow?.avatar || fallback || null;
}


function normalizeExplorerPlatform(value) {
  const platform = String(value || '').toLowerCase();
  if (!platform) return null;
  if (platform === 'twitter') return 'x';
  if (platform === 'satp_v3') return null;
  if (platform.startsWith('verification_')) return normalizeExplorerPlatform(platform.slice('verification_'.length));
  if (platform.endsWith('_verification')) return normalizeExplorerPlatform(platform.slice(0, -'_verification'.length));
  if (platform === 'solana_wallet') return 'solana';
  if (platform === 'eth_wallet' || platform === 'ethereum_wallet' || platform === 'ethereum' || platform === 'evm') return 'eth';
  if (platform === 'review' || platform.includes('satp')) return null;
  return platform;
}

function normalizePublicPlatforms(values) {
  const list = Array.isArray(values) ? values : [values];
  return [...new Set(list.map(normalizeExplorerPlatform).filter(Boolean))];
}

// A1: Helper to compute score for any profile using the unified trust scorer
function getComputedScore(profileId, explorerAgent = null) {
  let db;
  try {
    const { computeUnifiedTrustScore } = require('../lib/unified-trust-score');
    const Database = require('better-sqlite3');
    const path = require('path');
    db = new Database(path.join(__dirname, '../../data/agentfolio.db'), { readonly: true });
    const row = db.prepare('SELECT * FROM profiles WHERE lower(id) = lower(?) LIMIT 1').get(profileId);
    if (!row) {
      return explorerAgent ? {
        score: explorerAgent.reputationScore || 0,
        level: explorerAgent.verificationLevel || 0,
        levelName: explorerAgent.tierLabel || explorerAgent.tier || 'Unverified',
        avatar: explorerAgent.faceImage || null,
      } : null;
    }
    let verificationData = {};
    try { verificationData = JSON.parse(row.verification_data || '{}'); } catch {}
    const hasPersistedSatp = Boolean(verificationData?.satp_v3?.verified || verificationData?.satp?.verified);
    const unified = computeUnifiedTrustScore(db, { ...row, id: profileId }, {
      v3Score: explorerAgent ? {
        reputationScore: explorerAgent.reputationScore || 0,
        verificationLevel: explorerAgent.verificationLevel || (hasPersistedSatp ? 1 : 0),
        verificationLabel: explorerAgent.tierLabel || explorerAgent.tier || 'Registered',
        isBorn: explorerAgent.isBorn,
        onChain: explorerAgent,
      } : null,
      hasBoaAvatar: Boolean(explorerAgent?.isBorn),
    });
    return {
      score: unified.score || 0,
      level: unified.level || 0,
      levelName: unified.levelName || 'Unverified',
      avatar: getProfileAvatar(row, explorerAgent?.faceImage || null),
    };
  } catch (_) {
    return explorerAgent ? {
      score: explorerAgent.reputationScore || 0,
      level: explorerAgent.verificationLevel || 0,
      levelName: explorerAgent.tierLabel || explorerAgent.tier || 'Unverified',
      avatar: explorerAgent.faceImage || null,
    } : null;
  } finally {
    try {
      if (db) db.close();
    } catch (_) {}
  }
}


/**
 * GET /api/explorer/agents
 * 
 * Returns all on-chain V3 Genesis Records with attestation data from chain-cache.
 * This is the same data as /api/satp/explorer/agents but at the cleaner URL.
 * 
 * Query params:
 *   ?category=AI        — Filter by category
 *   ?minLevel=2         — Minimum verification level (0-5)
 *   ?born=true          — Only show born (soulbound) agents
 *   ?limit=50           — Max results (default: all)
 */
router.get('/agents', async (req, res) => {
  let db = null;
  try {
    const v3Explorer = require('../v3-explorer');
    const chainCache = require('../lib/chain-cache');
    const Database = require('better-sqlite3');
    const path = require('path');
    db = new Database(path.join(__dirname, '../../data/agentfolio.db'), { readonly: true });
    const normalizePlatform = normalizeExplorerPlatform;
    const isLikelySolanaTxSignature = (value) => /^[1-9A-HJ-NP-Za-km-z]{60,120}$/.test(String(value || "").trim());
    const parseJson = (val, fallback) => {
      if (val === null || val === undefined || val === '') return fallback;
      if (typeof val === 'object') return val;
      try { return JSON.parse(val); } catch { return fallback; }
    };
    const { computeUnifiedTrustScore } = require('../lib/unified-trust-score');
    const resolveProfileRow = (agent) => {
      const metadataProfileId = (() => {
        try {
          const uri = String(agent.metadataUri || '').trim();
          const match = uri.match(/\/api\/profile\/([^/?#]+)/i);
          return match ? decodeURIComponent(match[1]) : null;
        } catch {
          return null;
        }
      })();
      const derivedProfileId = 'agent_' + String(agent.agentName || '').trim().toLowerCase().replace(/\s+/g, '_');
      const handleCandidate = derivedProfileId.replace(/^agent_/, '');
      return db.prepare(`
        SELECT * FROM profiles
        WHERE lower(id) = lower(?)
           OR lower(id) = lower(?)
           OR lower(handle) = lower(?)
           OR wallet = ?
        ORDER BY
          CASE
            WHEN lower(id) = lower(?) THEN 0
            WHEN lower(id) = lower(?) THEN 1
            WHEN lower(handle) = lower(?) THEN 2
            WHEN wallet = ? THEN 3
            ELSE 4
          END,
          created_at DESC
        LIMIT 1
      `).get(metadataProfileId, derivedProfileId, handleCandidate, agent.authority, metadataProfileId, derivedProfileId, handleCandidate, agent.authority) || null;
    };
    
    let agents = await v3Explorer.fetchAllV3Agents();
    
    // Filter test/smoke accounts
    const TEST_NAMES = new Set([
      'braintest3', 'braintest11', 'braintest12', 'braintest20', 'braintest22',
      'mainnet-deploy-test', 'smoketestagent', 'smoketest2', 'smoketest',
      'smoketestbot', 'e2etestagent', 'brantest', 'birth test',
    ]);
    const isTest = (name) => {
      const ln = (name || '').toLowerCase();
      return TEST_NAMES.has(ln);
    };
    
    agents = agents.filter(a => !isTest(a.agentName));
    agents = agents.filter(a => !isNonPublicExplorerAgent(a));
    
    // Apply query filters
    const { category, minLevel, born, limit } = req.query;
    
    if (category) {
      agents = agents.filter(a => a.category && a.category.toLowerCase() === category.toLowerCase());
    }
    if (minLevel) {
      const lvl = parseInt(minLevel, 10);
      if (!isNaN(lvl)) agents = agents.filter(a => a.verificationLevel >= lvl);
    }
    if (born === 'true') {
      agents = agents.filter(a => a.isBorn);
    }
    
    // Enrich with chain-cache attestation data
    const enriched = await Promise.all(agents.map(async (a) => {
      const profileRow = resolveProfileRow(a) || {};
      const profileId = profileRow.id || ('agent_' + String(a.agentName || '').trim().toLowerCase().replace(/\s+/g, '_'));
      const verificationData = parseJson(profileRow.verification_data, {});
      const attestations = (chainCache.getVerifications(profileId, profileRow.created_at) || []).map(att => ({ ...att }));
      const txHints = new Map();
      const addTxHint = (platform, txSignature, timestamp = null) => {
        const normalized = normalizePlatform(platform);
        if (!normalized || !isLikelySolanaTxSignature(txSignature)) return;
        if (!txHints.has(normalized)) {
          txHints.set(normalized, {
            platform: normalized,
            txSignature,
            timestamp,
            solscanUrl: `https://solana.fm/tx/${txSignature}`,
          });
        }
      };

      for (const row of db.prepare('SELECT platform, tx_signature, created_at FROM attestations WHERE profile_id = ? AND tx_signature IS NOT NULL ORDER BY created_at DESC').all(profileId)) {
        addTxHint(row.platform, row.tx_signature, row.created_at || null);
      }
      if (typeof chainCache.resolveAttestationTxHintByPda === 'function') {
        for (const att of attestations) {
          if (!att?.pda || att?.txSignature) continue;
          try {
            const createdAtUnix = att?.timestamp ? Math.floor(new Date(att.timestamp).getTime() / 1000) : null;
            const hint = await chainCache.resolveAttestationTxHintByPda(att.pda, createdAtUnix);
            if (hint?.txSignature) {
              att.txSignature = hint.txSignature;
              att.solscanUrl = hint.solscanUrl || att.solscanUrl || ('https://solana.fm/tx/' + hint.txSignature);
              addTxHint(att.platform, hint.txSignature, att.timestamp || null);
            }
          } catch (_) {}
        }
      }
      for (const row of db.prepare('SELECT platform, proof, verified_at FROM verifications WHERE profile_id = ? ORDER BY verified_at DESC').all(profileId)) {
        let proof = {};
        try { proof = typeof row.proof === 'string' ? JSON.parse(row.proof) : (row.proof || {}); } catch {}
        addTxHint(row.platform, proof.txSignature || proof.signature || proof.transactionSignature || null, row.verified_at || null);
      }
      for (const [platform, value] of Object.entries(verificationData || {})) {
        const txSignature = value && typeof value === 'object' ? (value.txSignature || value.signature || value.transactionSignature || null) : null;
        const timestamp = value && typeof value === 'object' ? (value.verifiedAt || value.timestamp || null) : null;
        addTxHint(platform, txSignature, timestamp);
      }

      const platformSet = new Set([
        ...attestations.map(att => normalizePlatform(att.platform)).filter(Boolean),
        ...Array.from(txHints.keys()),
      ]);
      
      // Deduplicated attestation memos with DB tx backfill
      const attMemos = [];
      const seen = new Set();
      for (const att of attestations) {
        const platform = normalizePlatform(att.platform);
        if (!platform || seen.has(platform)) continue;
        seen.add(platform);
        const hinted = txHints.get(platform) || null;
        const txSignature = att.txSignature || hinted?.txSignature || null;
        attMemos.push({
          platform,
          txSignature,
          timestamp: att.timestamp || hinted?.timestamp || null,
          solscanUrl: hinted?.solscanUrl || (isLikelySolanaTxSignature(txSignature) ? `https://solana.fm/tx/${txSignature}` : null),
        });
      }
      for (const [platform, hinted] of txHints.entries()) {
        if (seen.has(platform)) continue;
        seen.add(platform);
        attMemos.push({
          platform,
          txSignature: hinted.txSignature,
          timestamp: hinted.timestamp || null,
          solscanUrl: hinted.solscanUrl,
        });
      }
      
      // Check DB for permanent face (overrides on-chain isBorn)
      let dbBorn = a.isBorn;
      let dbFaceImage = getProfileAvatar(profileRow, a.faceImage || null);
      let dbSoulboundMint = a.faceMint || null;
      const nftData = parseJsonField(profileRow?.nft_avatar, null);
      if (nftData) {
        if (nftData.permanent) dbBorn = true;
        dbSoulboundMint = nftData.soulboundMint || nftData.identifier || dbSoulboundMint;
      }
      
      return {
        pda: a.pda,
        authority: a.authority,
        name: profileRow.name || a.agentName,
        profileId,
        description: profileRow.bio || profileRow.description || a.description,
        category: a.category,
        capabilities: parseJson(profileRow.capabilities, a.capabilities || []),
        ...(() => {
          try {
            const hasPersistedSatp = Boolean(verificationData?.satp_v3?.verified || verificationData?.satp?.verified);
            const unified = computeUnifiedTrustScore(db, { ...profileRow, id: profileId }, {
              v3Score: {
                reputationScore: a.reputationScore || 0,
                verificationLevel: a.verificationLevel || (hasPersistedSatp ? 1 : 0),
                verificationLabel: a.tierLabel || a.tier || 'Registered',
                isBorn: a.isBorn,
                onChain: a,
              },
              hasBoaAvatar: a.isBorn,
            });
            return {
              trustScore: unified.score,
              score: unified.score,
              reputationScore: unified.score,
              level: unified.level,
              levelName: unified.levelName,
              verificationLevel: unified.level,
              verificationLevelName: unified.levelName,
              verificationLabel: unified.levelName,
              tier: unified.levelName,
              tierLabel: unified.levelName,
              verificationBadge: unified.badge,
            };
          } catch (_) {
            return {
              trustScore: a.reputationScore,
              score: a.reputationScore,
              reputationScore: a.reputationScore,
              level: a.verificationLevel,
              levelName: a.tierLabel || a.tier,
              verificationLevel: a.verificationLevel,
              verificationLevelName: a.tierLabel || a.tier,
              verificationLabel: a.tierLabel || a.tier,
              tier: a.tier,
              tierLabel: a.tierLabel,
              verificationBadge: null,
            };
          }
        })(),
        platforms: [...platformSet],
        platformCount: platformSet.size,
        onChainAttestations: attestations.length,
        attestationMemos: attMemos,
        nftImage: dbFaceImage,
        nftMint: dbSoulboundMint,
        soulbound: a.soulbound || dbBorn,
        isBorn: dbBorn,
        createdAt: a.bornAt,
        programId: 'GTppU4E44BqXTQgbqMZ68ozFzhP1TLty3EGnzzjtNZfG',
        source: 'v3',
      };
    }));
    
    // Apply limit
    const maxResults = limit ? parseInt(limit, 10) : enriched.length;
    const results = enriched.slice(0, isNaN(maxResults) ? enriched.length : maxResults);
    
    res.json({
      agents: results,
      count: results.length,
      total: enriched.length,
      source: 'solana-mainnet',
      cacheStats: chainCache.getStats(),
    });
  } catch (err) {
    console.error('[Explorer API] /agents error:', err.message);
    res.status(500).json({ error: 'Failed to fetch agents', details: err.message });
  } finally {
    if (db) {
      try { db.close(); } catch (_) {}
    }
  }
});

/**
 * GET /api/explorer/stats
 * 
 * Chain-cache statistics: identity counts, attestation counts, refresh timing.
 */
router.get('/stats', async (req, res) => {
  try {
    const chainCache = require('../lib/chain-cache');
    const v3Explorer = require('../v3-explorer');
    
    const cacheStats = chainCache.getStats();
    let v3Agents = [];
    try {
      v3Agents = await v3Explorer.fetchAllV3Agents();
    } catch (_) {}
    
    // Count by verification level
    const levelCounts = { unverified: 0, registered: 0, verified: 0, established: 0, trusted: 0, sovereign: 0 };
    const levelLabels = ['unverified', 'registered', 'verified', 'established', 'trusted', 'sovereign'];
    for (const a of v3Agents) {
      const label = levelLabels[a.verificationLevel] || 'unverified';
      levelCounts[label]++;
    }
    
    // Count born vs unborn
    const bornCount = v3Agents.filter(a => a.isBorn).length;
    
    // Count unique categories
    const categories = {};
    for (const a of v3Agents) {
      if (a.category) categories[a.category] = (categories[a.category] || 0) + 1;
    }
    
    // Average reputation score
    const totalScore = v3Agents.reduce((sum, a) => sum + (a.reputationScore || 0), 0);
    const avgScore = v3Agents.length > 0 ? Math.round(totalScore / v3Agents.length) : 0;
    
    res.json({
      chainCache: cacheStats,
      v3: {
        totalAgents: v3Agents.length,
        bornAgents: bornCount,
        unbornAgents: v3Agents.length - bornCount,
        averageReputationScore: avgScore,
        verificationLevels: levelCounts,
        categories,
      },
      programIds: {
        identity_v3: 'GTppU4E44BqXTQgbqMZ68ozFzhP1TLty3EGnzzjtNZfG',
        identity_v2: '97yL33fcu6iWT2TdERS5HeqrMSGiUnxuy6nUcTrKieSq',
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[Explorer API] /stats error:', err.message);
    res.status(500).json({ error: 'Failed to fetch stats', details: err.message });
  }
});

/**
 * GET /api/explorer/leaderboard
 * 
 * Reputation leaderboard — agents sorted by score, enriched with attestation data.
 * 
 * Query params:
 *   ?limit=10    — Number of results (default: 10, max: 50)
 *   ?born=true   — Only born agents
 */
router.get('/leaderboard', async (req, res) => {
  try {
    const v3Explorer = require('../v3-explorer');
    const chainCache = require('../lib/chain-cache');
    
    let agents = await v3Explorer.fetchAllV3Agents();
    
    // Filter test accounts
    agents = agents.filter(a => {
      const ln = (a.agentName || '').toLowerCase();
      return !ln.startsWith('smoketest') && !ln.startsWith('e2etest') && ln !== 'mainnet-deploy-test';
    });
    agents = agents.filter(a => !isNonPublicExplorerAgent(a));
    
    // Optional born filter
    if (req.query.born === 'true') {
      agents = agents.filter(a => a.isBorn);
    }
    
    // Sort by reputation score descending (already done in v3-explorer, but be explicit)
    agents.sort((a, b) => b.reputationScore - a.reputationScore);
    
    const maxLimit = Math.min(parseInt(req.query.limit, 10) || 10, 50);
    const top = agents.slice(0, maxLimit);
    
    const leaderboard = top.map((a, i) => {
      const profileId = 'agent_' + a.agentName.toLowerCase();
      const platforms = normalizePublicPlatforms(chainCache.getVerifiedPlatforms(profileId));
      const cs = getComputedScore(profileId, a);
      
      return {
        rank: i + 1,
        name: a.agentName,
        profileId,
        ...(cs ? { reputationScore: cs.score, verificationLevel: cs.level, tier: cs.levelName, tierLabel: cs.levelName } : { reputationScore: a.reputationScore, verificationLevel: a.verificationLevel, tier: a.tier, tierLabel: a.tierLabel }),
        platforms,
        platformCount: platforms.length,
        nftImage: (cs && cs.avatar) || a.faceImage || null,
        soulbound: a.soulbound || false,
        isBorn: a.isBorn,
        profileUrl: `${SITE_URL}/profile/${profileId}`,
      };
    });
    
    res.json({
      leaderboard,
      count: leaderboard.length,
      totalAgents: agents.length,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[Explorer API] /leaderboard error:', err.message);
    res.status(500).json({ error: 'Failed to build leaderboard', details: err.message });
  }
});

/**
 * GET /api/explorer/search
 * 
 * Search agents by name or category.
 * 
 * Query params:
 *   ?q=brain        — Search query (name, description, category)
 *   ?limit=20       — Max results (default: 20, max: 50)
 */
router.get('/search', async (req, res) => {
  try {
    const { q, limit } = req.query;
    
    if (!q || q.trim().length === 0) {
      return res.status(400).json({ error: 'Query parameter "q" is required' });
    }
    
    const v3Explorer = require('../v3-explorer');
    const chainCache = require('../lib/chain-cache');
    
    let agents = await v3Explorer.fetchAllV3Agents();
    agents = agents.filter(a => !isNonPublicExplorerAgent(a));
    const query = q.toLowerCase().trim();
    
    const matches = agents.filter(a => {
      const name = (a.agentName || '').toLowerCase();
      const desc = (a.description || '').toLowerCase();
      const cat = (a.category || '').toLowerCase();
      const caps = (a.capabilities || []).join(' ').toLowerCase();
      return name.includes(query) || desc.includes(query) || cat.includes(query) || caps.includes(query);
    });
    
    const maxLimit = Math.min(parseInt(limit, 10) || 20, 50);
    const results = matches.slice(0, maxLimit).map(a => {
      const profileId = 'agent_' + a.agentName.toLowerCase();
      const platforms = normalizePublicPlatforms(chainCache.getVerifiedPlatforms(profileId));
      const cs = getComputedScore(profileId, a);
      
      return {
        name: a.agentName,
        profileId,
        description: a.description,
        category: a.category,
        reputationScore: cs ? cs.score : a.reputationScore,
        verificationLevel: cs ? cs.level : a.verificationLevel,
        tierLabel: cs ? cs.levelName : a.tierLabel,
        platforms,
        nftImage: (cs && cs.avatar) || a.faceImage || null,
        isBorn: a.isBorn,
        profileUrl: `${SITE_URL}/profile/${profileId}`,
      };
    });
    
    res.json({
      query: q,
      results,
      count: results.length,
      totalMatches: matches.length,
    });
  } catch (err) {
    console.error('[Explorer API] /search error:', err.message);
    res.status(500).json({ error: 'Search failed', details: err.message });
  }
});

module.exports = router;
