/**
 * BOA & Mint Eligibility Endpoints
 * Uses V3 on-chain data as primary source.
 * Falls back to compute-score + chain-cache for agents without V3 records.
 */

const Database = require('better-sqlite3');
const path = require('path');

let v3ScoreService;
try {
  v3ScoreService = require('../v3-score-service');
} catch (e) {
  console.warn('[Eligibility] V3 score service not available:', e.message);
}

let computeScore;
let chainCache;
try {
  ({ computeScore } = require('../lib/compute-score'));
  chainCache = require('../lib/chain-cache');
} catch (e) {
  console.warn('[Eligibility] compute-score/chain-cache not available:', e.message);
}

function getDb() {
  return new Database(path.join(__dirname, '..', '..', 'data', 'agentfolio.db'), { readonly: true });
}

function parseJsonField(val, fallback) {
  if (val === null || val === undefined || val === '') return fallback;
  if (typeof val === 'object') return val;
  try { return JSON.parse(val); } catch { return fallback; }
}

/**
 * Resolve agent level + reputation from V3 on-chain data first,
 * then fall back to compute-score + chain-cache if no V3 record exists.
 */
async function resolveAgentScore(agentId, profile) {
  // Try V3 on-chain data first (correct deserialization)
  if (v3ScoreService) {
    try {
      // Try multiple ID formats
      let v3 = await v3ScoreService.getV3Score(agentId);
      if (!v3 && !agentId.startsWith('agent_')) {
        v3 = await v3ScoreService.getV3Score('agent_' + agentId.toLowerCase());
      }
      if (v3 && v3.verificationLevel != null && v3.verificationLevel > 0) {
        return {
          level: v3.verificationLevel,
          reputation: v3.reputationScore,
          source: 'v3_onchain',
          label: v3.verificationLabel,
        };
      }
    } catch (e) {
      console.warn('[Eligibility] V3 lookup failed for', agentId, e.message);
    }
  }

  // Fallback to current chain-cache + compute-score path
  if (computeScore && chainCache && profile) {
    try {
      const wallet = profile.wallet || parseJsonField(profile.wallets, {}).solana || null;
      const identityVerified = !!wallet && chainCache.isVerified(wallet);
      const attRows = (chainCache.getVerifications(profile.id, profile.created_at) || []).filter(att => att.platform && att.platform !== 'review');
      const seen = new Set();
      const chainVerifs = [];
      if (identityVerified && wallet) {
        chainVerifs.push({ platform: 'satp', identifier: wallet });
        chainVerifs.push({ platform: 'solana', identifier: wallet });
        seen.add('satp');
        seen.add('solana');
      }
      for (const att of attRows) {
        const platform = att.platform === 'twitter' ? 'x' : att.platform;
        if (!platform || seen.has(platform)) continue;
        let proofData = {};
        try { proofData = typeof att.proofData === 'string' ? JSON.parse(att.proofData) : (att.proofData || {}); } catch {}
        const identifier = att.identifier || proofData.identifier || proofData.address || proofData.wallet || null;
        if (!identifier) continue;
        chainVerifs.push({ platform, identifier });
        seen.add(platform);
        if (platform === 'x') seen.add('twitter');
        if (platform === 'twitter') seen.add('x');
      }
      const computed = computeScore(chainVerifs, {
        hasSatpIdentity: identityVerified,
        claimed: !!profile.claimed,
      });
      return {
        level: computed.level || 0,
        reputation: computed.score || 0,
        source: 'compute_score_chain_cache',
        label: computed.levelName || 'Unknown',
      };
    } catch (e) {
      console.warn('[Eligibility] compute-score fallback failed for', agentId, e.message);
    }
  }

  return { level: 0, reputation: 0, source: 'none', label: 'Unknown' };
}

function resolveProfile(db, agentId) {
  let profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(agentId);
  if (!profile) profile = db.prepare('SELECT * FROM profiles WHERE LOWER(name) = LOWER(?)').get(agentId);
  if (!profile) profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get('agent_' + agentId.toLowerCase());
  return profile;
}

function registerEligibilityRoutes(app) {

  // GET /api/boa/eligibility?agent=<agent_id>
  app.get('/api/boa/eligibility', async (req, res) => {
    const agentId = req.query.agent;
    if (!agentId) return res.status(400).json({ error: 'Missing agent query parameter' });

    try {
      const db = getDb();
      const profile = resolveProfile(db, agentId);
      db.close();
      if (!profile) return res.status(404).json({ error: 'Agent not found', eligible: false });

      const { level, reputation } = await resolveAgentScore(agentId, profile);

      const meetsLevel = level >= 3;
      const meetsReputation = reputation >= 50;
      const eligible = meetsLevel && meetsReputation;

      const pricing = {
        maxMints: 3,
        schedule: [
          { mint: 1, cost: 0, label: 'Free' },
          { mint: 2, cost: 1.0, label: '1 SOL' },
          { mint: 3, cost: 1.0, label: '1 SOL' },
        ]
      };

      const reasons = [];
      if (!meetsLevel) reasons.push(`Verification level ${level} < 3 required`);
      if (!meetsReputation) reasons.push(`Reputation ${reputation} < 50 required`);

      res.json({
        agent: agentId,
        eligible,
        requirements: {
          verification_level: { current: level, required: 3, met: meetsLevel },
          reputation: { current: reputation, required: 50, met: meetsReputation },
        },
        pricing,
        reasons: eligible ? ['All requirements met'] : reasons,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/mint/eligibility/:agentId
  app.get('/api/mint/eligibility/:agentId', async (req, res) => {
    const agentId = req.params.agentId;
    if (!agentId) return res.status(400).json({ error: 'Missing agent parameter' });

    try {
      const db = getDb();
      const profile = resolveProfile(db, agentId);
      db.close();
      if (!profile) return res.status(404).json({ error: 'Agent not found', eligible: false });

      const { level, reputation, source } = await resolveAgentScore(agentId, profile);

      res.json({
        agent: agentId,
        eligible: level >= 3 && reputation >= 50,
        level,
        reputation,
        source,
        requirements: { minLevel: 3, minReputation: 50 },
        reason: level < 3 ? 'Verification level too low (need L3+)' : reputation < 50 ? 'Reputation too low (need 50+)' : 'Eligible to mint',
      });
    } catch (err) {
      res.status(500).json({ error: 'Eligibility check failed', detail: err.message });
    }
  });

  // GET /api/mint/eligibility?agent=<agent_id>
  app.get('/api/mint/eligibility', async (req, res) => {
    const agentId = req.query.agent;
    if (!agentId) return res.status(400).json({ error: 'Missing agent query parameter' });

    try {
      const db = getDb();
      const profile = resolveProfile(db, agentId);
      db.close();
      if (!profile) return res.status(404).json({ error: 'Agent not found', eligible: false });

      const { level, reputation, source } = await resolveAgentScore(agentId, profile);

      const mintTypes = [];

      // BOA mint (Level 3 gate)
      const boaEligible = level >= 3 && reputation >= 50;
      mintTypes.push({
        type: 'boa',
        name: 'Burned Out Agents (BOA)',
        eligible: boaEligible,
        requirements: {
          verification_level: { current: level, required: 3, met: level >= 3 },
          reputation: { current: reputation, required: 50, met: reputation >= 50 },
        },
        pricing: { first: 'Free', subsequent: '1 SOL', max: 3 },
      });

      // Basic profile badge (always available if registered)
      const badgeEligible = level >= 1;
      mintTypes.push({
        type: 'profile_badge',
        name: 'AgentFolio Profile Badge',
        eligible: badgeEligible,
        requirements: {
          verification_level: { current: level, required: 1, met: level >= 1 },
        },
      });

      res.json({
        agent: agentId,
        verification_level: level,
        reputation,
        source,
        mint_types: mintTypes,
        any_eligible: mintTypes.some(m => m.eligible),
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
}

module.exports = { registerEligibilityRoutes };
