/**
 * BOA & Mint Eligibility Endpoints
 * Uses V3 on-chain data (v3-score-service) as primary source,
 * then the V3 explorer scan, then scoring-engine-v2.
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

let v3ScoreService;
try {
  v3ScoreService = require('../v3-score-service');
} catch (e) {
  console.warn('[Eligibility] V3 score service not available:', e.message);
}

let v3Explorer;
try {
  v3Explorer = require('../v3-explorer');
} catch (e) {
  console.warn('[Eligibility] V3 explorer not available:', e.message);
}

let getCompleteScore;
try {
  ({ getCompleteScore } = require('../lib/scoring-engine-v2'));
} catch (e) {
  console.warn('[Eligibility] Scoring engine V2 not available:', e.message);
}

function getDb() {
  return new Database(path.join(__dirname, '..', '..', 'data', 'agentfolio.db'), { readonly: true });
}

function normalizeAgentKey(value) {
  return String(value || '').trim().toLowerCase().replace(/^agent_/, '');
}

function matchExplorerAgent(agents, agentId, profile) {
  const keys = new Set([
    normalizeAgentKey(agentId),
    normalizeAgentKey(profile && profile.id),
    normalizeAgentKey(profile && profile.name),
    normalizeAgentKey(profile && profile.handle),
  ].filter(Boolean));

  return (agents || []).find((agent) => {
    const candidates = [
      agent.agentId,
      agent.agentName,
      agent.name,
      agent.pda,
      agent.profileId,
      agent.id,
    ].map(normalizeAgentKey).filter(Boolean);
    return candidates.some((candidate) => keys.has(candidate));
  }) || null;
}

function scoreFromOnchainRecord(record, source) {
  if (!record || record.verificationLevel == null || record.verificationLevel <= 0) return null;
  return {
    level: record.verificationLevel,
    reputation: record.reputationScore,
    source,
    label: record.verificationLabel,
  };
}

/**
 * Resolve agent level + reputation from the same V3 explorer/on-chain
 * surface the SATP explorer uses (verificationLevel + reputationScore).
 * If getV3Score fails or misses, try v3-explorer before scoring-engine-v2.
 */
async function resolveAgentScore(agentId, profile) {
  // Try V3 on-chain data first (correct deserialization, mainnet-pinned RPC)
  if (v3ScoreService) {
    try {
      let v3 = await v3ScoreService.getV3Score(agentId);
      if (!v3 && !agentId.startsWith('agent_')) {
        v3 = await v3ScoreService.getV3Score('agent_' + agentId.toLowerCase());
      }
      const scored = scoreFromOnchainRecord(v3, 'v3_onchain');
      if (scored) return scored;
    } catch (e) {
      console.warn('[Eligibility] V3 lookup failed for', agentId, e.message);
    }
  }

  // Same explorer scan the SATP explorer uses (fetchAllV3Agents / parseGenesisRecord)
  if (v3Explorer && typeof v3Explorer.fetchAllV3Agents === 'function') {
    try {
      const agents = await v3Explorer.fetchAllV3Agents();
      const match = matchExplorerAgent(agents, agentId, profile);
      const scored = scoreFromOnchainRecord(match, 'explorer');
      if (scored) return scored;
    } catch (e) {
      console.warn('[Eligibility] V3 explorer lookup failed for', agentId, e.message);
    }
  }

  // Fallback to scoring-engine-v2
  if (getCompleteScore && profile) {
    try {
      const profileObj = {
        id: profile.id, name: profile.name, handle: profile.handle,
        bio: profile.bio, avatar: profile.avatar,
        skills: JSON.parse(profile.skills || '[]'),
        verification: JSON.parse(profile.verification || '{}'),
        endorsements: JSON.parse(profile.endorsements || '[]'),
        portfolio: JSON.parse(profile.portfolio || '[]'),
        track_record: JSON.parse(profile.track_record || '{}'),
      };
      // Try to enrich from JSON file
      try {
        const pPath = path.join(__dirname, '..', '..', 'data', 'profiles', profile.id + '.json');
        if (fs.existsSync(pPath)) {
          const pf = JSON.parse(fs.readFileSync(pPath, 'utf8'));
          profileObj.verificationData = pf.verificationData || {};
          profileObj.stats = pf.stats || {};
          profileObj.endorsements = pf.endorsements || profileObj.endorsements || [];
          profileObj.moltbookStats = pf.moltbookStats || {};
        }
      } catch (e) {}
      const scoreResult = getCompleteScore(profileObj);
      return {
        level: scoreResult.verificationLevel ? scoreResult.verificationLevel.level : 0,
        reputation: scoreResult.reputationScore ? scoreResult.reputationScore.score : 0,
        source: 'scoring_engine_v2',
        label: scoreResult.verificationLevel ? scoreResult.verificationLevel.name : 'Unknown',
      };
    } catch (e) {
      console.warn('[Eligibility] Scoring engine fallback failed for', agentId, e.message);
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

      const { level, reputation, source } = await resolveAgentScore(agentId, profile);

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
        source,
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

module.exports = { registerEligibilityRoutes, resolveAgentScore, matchExplorerAgent };
