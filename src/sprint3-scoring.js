/**
 * Sprint 3 P1: 2D Scoring Engine — DB-backed implementation
 * Replaces placeholder functions in scoring-engine-v2.js with real DB queries
 * Exposes /api/profile/:id/score endpoint
 */

const Database = require('better-sqlite3');
const path = require('path');

function getDb() {
  return new Database(path.join(__dirname, '..', 'data', 'agentfolio.db'), { readonly: true });
}

// ===== Verification Categories =====
const VERIFICATION_CATEGORIES = {
  wallets: ['solana', 'ethereum', 'bitcoin', 'hyperliquid', 'polymarket'],
  platforms: ['agentmail', 'moltbook', 'telegram', 'discord', 'farcaster'],
  infrastructure: ['domain', 'mcp', 'a2a', 'openclaw', 'did', 'website'],
  onchain: ['ens', 'eas']
};
const HUMAN_VERIFICATIONS = ['github', 'x'];

const LEVEL_NAMES = ['Unregistered', 'Registered', 'Verified', 'On-Chain', 'Trusted', 'Sovereign'];
const LEVEL_BADGES = ['⚪', '🟡', '🔵', '🟢', '🟠', '👑'];

// ===== Core Scoring =====

function getVerificationData(profile) {
  // verification_data is stored as JSON string in profiles table
  try { return JSON.parse(profile.verification_data || '{}'); } catch { return {}; }
}

function countVerifications(vd) {
  let count = 0;
  for (const [, data] of Object.entries(vd)) {
    if (data && (data.verified || data.linked)) count++;
  }
  return count;
}

function countCategories(vd) {
  const found = new Set();
  for (const [provider, data] of Object.entries(vd)) {
    if (!data || (!data.verified && !data.linked)) continue;
    for (const [cat, providers] of Object.entries(VERIFICATION_CATEGORIES)) {
      if (providers.includes(provider)) { found.add(cat); break; }
    }
  }
  return found.size;
}

function isComplete(profile) {
  const bio = (profile.bio || '').trim();
  const avatar = (profile.avatar || '').trim();
  let skills = [];
  try { skills = JSON.parse(profile.skills || '[]'); } catch {}
  return bio.length > 0 && avatar.length > 0 && skills.length >= 2;
}

function calculateLevel(profile, db) {
  // Unclaimed profiles always return level 0
  if (profile.unclaimed) return 0;
  const vd = getVerificationData(profile);
  const vCount = countVerifications(vd);
  const catCount = countCategories(vd);
  const hasSATP = !!(vd.satp && vd.satp.verified);
  const complete = isComplete(profile);

  // Level 5: L4 + burn-to-become + 3+ reviews + human verification
  const hasHuman = HUMAN_VERIFICATIONS.some(p => vd[p]?.verified);
  const reviewCount = db.prepare('SELECT COUNT(*) as c FROM peer_reviews WHERE reviewee_id = ?').get(profile.id).c;
  const completedJobs = db.prepare("SELECT COUNT(*) as c FROM jobs WHERE selected_agent_id = ? AND status = 'completed'").get(profile.id).c;
  const hasReview = reviewCount > 0 || db.prepare('SELECT COUNT(*) as c FROM reviews WHERE reviewee_id = ?').get(profile.id).c > 0;
  // burn-to-become: check if avatar is from BOA collection
  const hasBOA = (profile.avatar || '').includes('burned-out') || (profile.avatar || '').includes('boa-');

  if (hasSATP && vCount >= 5 && catCount >= 2 && complete && completedJobs > 0 && hasReview && hasBOA && reviewCount >= 3 && hasHuman) return 5;
  if (hasSATP && vCount >= 5 && catCount >= 2 && complete && completedJobs > 0 && hasReview) return 4;
  if (hasSATP && vCount >= 5 && catCount >= 2 && complete) return 3;
  // Level 3 relaxed: rep >= 50 is checked elsewhere for BOA mint eligibility
  if (vCount >= 2) return 2;
  if (profile.name && profile.handle) return 1;
  return 0;
}

function calculateReputation(profile, db) {
  let score = 0;

  // 1. Verification level base (0-100)
  const level = calculateLevel(profile, db);
  score += level * 20;

  // 2. Reviews (0-500)
  const peerReviews = db.prepare('SELECT rating FROM peer_reviews WHERE reviewee_id = ?').all(profile.id);
  const jobReviews = db.prepare('SELECT rating FROM reviews WHERE reviewee_id = ?').all(profile.id);
  const allReviews = [...peerReviews, ...jobReviews];
  if (allReviews.length > 0) {
    const avg = allReviews.reduce((s, r) => s + r.rating, 0) / allReviews.length;
    score += Math.floor((avg / 5) * 200); // 0-200 from quality
    score += Math.min(allReviews.length * 30, 300); // 0-300 from count
  }

  // 3. Endorsements (0-200)
  let endorsements = [];
  try { endorsements = JSON.parse(profile.endorsements || '[]'); } catch {}
  score += Math.min(endorsements.length * 25, 200);

  // 4. Job performance (0-200)
  const jobStats = db.prepare(`
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed
    FROM jobs WHERE selected_agent_id = ?
  `).get(profile.id);
  if (jobStats.total > 0) {
    const rate = jobStats.completed / jobStats.total;
    score += Math.floor(rate * 100);
    // Add average rating from job reviews
    const avgJobRating = db.prepare('SELECT AVG(rating) as avg FROM reviews WHERE reviewee_id = ?').get(profile.id);
    if (avgJobRating.avg) score += Math.floor((avgJobRating.avg / 5) * 100);
  }

  // 5. Activity decay
  const lastActive = profile.last_active_at || profile.updated_at || profile.created_at;
  if (lastActive) {
    const days = (Date.now() - new Date(lastActive).getTime()) / 86400000;
    if (days > 30) {
      const mult = Math.max(0.5, 1.0 - ((days - 30) / 670));
      score = Math.floor(score * mult);
    }
  }

  return Math.min(score, 1000);
}

// ===== API Endpoint =====

function registerScoringRoutes(app) {
  // GET /api/profile/:id/score — Full 2D scoring data
  app.get('/api/profile/:id/score', (req, res) => {
    try {
      const db = getDb();
      const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(req.params.id);
      if (!profile) { db.close(); return res.status(404).json({ error: 'Agent not found' }); }

      const level = calculateLevel(profile, db);
      const reputation = calculateReputation(profile, db);

      // BOA mint eligibility: Level 3 + rep >= 50
      const boaMintEligible = level >= 3 && reputation >= 50;

      db.close();

      res.json({
        agent: req.params.id,
        verification: {
          level,
          name: LEVEL_NAMES[level],
          badge: LEVEL_BADGES[level],
        },
        reputation: {
          score: reputation,
          rank: reputation >= 800 ? 'Elite' : reputation >= 600 ? 'Expert' : reputation >= 400 ? 'Skilled' : reputation >= 200 ? 'Competent' : reputation >= 100 ? 'Developing' : 'Newcomer',
        },
        boaMintEligible,
        tier: level >= 5 && reputation >= 800 ? 'Sovereign Elite' :
              level >= 4 && reputation >= 600 ? 'Trusted Expert' :
              level >= 3 && reputation >= 400 ? 'On-Chain Skilled' :
              level >= 2 && reputation >= 200 ? 'Verified Competent' :
              level >= 1 ? 'Registered' : 'Unregistered',
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/leaderboard/scores — All agents with 2D scores for leaderboard
  app.get('/api/leaderboard/scores', (req, res) => {
    try {
      const db = getDb();
      const limit = Math.min(parseInt(req.query.limit) || 50, 200);
      const profiles = db.prepare('SELECT * FROM profiles ORDER BY updated_at DESC').all();

      const scored = profiles.map(p => {
        const level = calculateLevel(p, db);
        const rep = calculateReputation(p, db);
        return {
          id: p.id, name: p.name, handle: p.handle, avatar: p.avatar,
          level, levelName: LEVEL_NAMES[level], badge: LEVEL_BADGES[level],
          reputation: typeof rep === 'number' ? rep : (rep?.total || rep?.score || 0), reputationScore: rep,
        };
      });

      // Sort by level desc, then rep desc
      scored.sort((a, b) => b.level - a.level || b.reputation - a.reputation);

      db.close();
      res.json({ total: scored.length, agents: scored.slice(0, limit) });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
}

module.exports = { registerScoringRoutes, calculateLevel, calculateReputation };
