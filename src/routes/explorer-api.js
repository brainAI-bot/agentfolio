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
  try {
    const v3Explorer = require('../v3-explorer');
    const chainCache = require('../lib/chain-cache');
    
    let agents = await v3Explorer.fetchAllV3Agents();
    
    // Filter test/smoke accounts
    const TEST_NAMES = new Set([
      'braintest3', 'braintest11', 'braintest12', 'braintest20', 'braintest22',
      'mainnet-deploy-test', 'smoketestagent', 'smoketest2', 'smoketest',
      'smoketestbot', 'e2etestagent', 'brantest', 'agent_suppi',
    ]);
    const isTest = (name) => {
      const ln = (name || '').toLowerCase();
      return TEST_NAMES.has(ln) || (ln.startsWith('braintest') && ln !== 'braintest');
    };
    
    agents = agents.filter(a => !isTest(a.agentName));
    
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
    const enriched = agents.map(a => {
      const profileId = 'agent_' + a.agentName.toLowerCase();
      const attestations = chainCache.getVerifications(profileId);
      const platformSet = new Set(attestations.map(att => att.platform).filter(Boolean));
      
      // Deduplicated attestation memos
      const attMemos = [];
      const seen = new Set();
      for (const att of attestations) {
        if (att.platform && !seen.has(att.platform)) {
          seen.add(att.platform);
          attMemos.push({
            platform: att.platform,
            txSignature: att.txSignature || null,
            timestamp: att.timestamp || null,
            solscanUrl: att.txSignature ? `https://solscan.io/tx/${att.txSignature}` : null,
          });
        }
      }
      
      return {
        pda: a.pda,
        authority: a.authority,
        name: a.agentName,
        profileId,
        description: a.description,
        category: a.category,
        capabilities: a.capabilities,
        reputationScore: a.reputationScore,
        verificationLevel: a.verificationLevel,
        tier: a.tier,
        tierLabel: a.tierLabel,
        platforms: [...platformSet],
        platformCount: platformSet.size,
        onChainAttestations: attestations.length,
        attestationMemos: attMemos,
        nftImage: a.faceImage || null,
        nftMint: a.faceMint || null,
        soulbound: a.soulbound || false,
        isBorn: a.isBorn,
        createdAt: a.bornAt,
        programId: 'GTppU4E44BqXTQgbqMZ68ozFzhP1TLty3EGnzzjtNZfG',
        source: 'v3',
      };
    });
    
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
      const platforms = chainCache.getVerifiedPlatforms(profileId);
      
      return {
        rank: i + 1,
        name: a.agentName,
        profileId,
        reputationScore: a.reputationScore,
        verificationLevel: a.verificationLevel,
        tier: a.tier,
        tierLabel: a.tierLabel,
        platforms,
        platformCount: platforms.length,
        nftImage: a.faceImage || null,
        soulbound: a.soulbound || false,
        isBorn: a.isBorn,
        profileUrl: `https://agentfolio.bot/profile/${profileId}`,
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
    
    const agents = await v3Explorer.fetchAllV3Agents();
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
      const platforms = chainCache.getVerifiedPlatforms(profileId);
      
      return {
        name: a.agentName,
        profileId,
        description: a.description,
        category: a.category,
        reputationScore: a.reputationScore,
        verificationLevel: a.verificationLevel,
        tierLabel: a.tierLabel,
        platforms,
        nftImage: a.faceImage || null,
        isBorn: a.isBorn,
        profileUrl: `https://agentfolio.bot/profile/${profileId}`,
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
