/**
 * SATP Registry - Trust attestation storage and scoring
 * Manages agent trust attestations and computes composite trust scores
 */

const { db, loadProfile, listProfiles } = require('./database');
const { calculateReputation, getReputationTier } = require('./reputation');

// ===== Prepared Statements =====

const stmts = {
  insertAttestation: db.prepare(`
    INSERT OR REPLACE INTO satp_attestations (id, agent_id, attestation_type, score, evidence, issued_at, expires_at, issuer)
    VALUES (@id, @agent_id, @attestation_type, @score, @evidence, @issued_at, @expires_at, @issuer)
  `),
  getAttestation: db.prepare('SELECT * FROM satp_attestations WHERE id = ?'),
  listByAgent: db.prepare('SELECT * FROM satp_attestations WHERE agent_id = ? ORDER BY issued_at DESC'),
  listByAgentAndType: db.prepare('SELECT * FROM satp_attestations WHERE agent_id = ? AND attestation_type = ? ORDER BY issued_at DESC'),
  deleteByAgent: db.prepare('DELETE FROM satp_attestations WHERE agent_id = ?'),
  countAll: db.prepare('SELECT COUNT(*) as count FROM satp_attestations'),
  countByAgent: db.prepare('SELECT COUNT(*) as count FROM satp_attestations WHERE agent_id = ?'),

  // P0: upsertTrustScore removed — on-chain v3 only
  // P0: getTrustScore removed
  // P0: allTrustScores removed
  // P0: avgScore removed
  // P0: countScored removed
};

// ===== Attestation Helpers =====

/**
 * Generate attestation ID from agent + type + issuer to allow dedup
 */
function makeAttestationId(agentId, type, issuer) {
  return `att_${agentId}_${type}_${issuer}`.replace(/[^a-zA-Z0-9_-]/g, '_');
}

/**
 * Sync verification data from a profile into attestation rows.
 * Reads verification_data JSON and converts each proof into an attestation.
 */
function syncAttestationsFromProfile(profile) {
  const now = new Date().toISOString();
  const vd = profile.verificationData || {};
  const attestations = [];

  // Solana wallet verification
  if (vd.solana?.verified) {
    attestations.push({
      id: makeAttestationId(profile.id, 'verification', 'solana'),
      agent_id: profile.id,
      attestation_type: 'verification',
      score: 80,
      evidence: JSON.stringify({ platform: 'solana', wallet: vd.solana.wallet || '', method: 'signature' }),
      issued_at: vd.solana.verifiedAt || now,
      expires_at: null,
      issuer: 'solana'
    });
  }

  // GitHub verification
  if (vd.github?.verified) {
    attestations.push({
      id: makeAttestationId(profile.id, 'github', 'github'),
      agent_id: profile.id,
      attestation_type: 'github',
      score: 70,
      evidence: JSON.stringify({ platform: 'github', username: vd.github.username || '' }),
      issued_at: vd.github.verifiedAt || now,
      expires_at: null,
      issuer: 'github'
    });
  }

  // X verification
  if (vd.twitter?.verified || vd.x?.verified) {
    const xData = vd.twitter?.verified ? vd.twitter : vd.x;
    attestations.push({
      id: makeAttestationId(profile.id, 'verification', 'twitter'),
      agent_id: profile.id,
      attestation_type: 'verification',
      score: 60,
      evidence: JSON.stringify({ platform: 'twitter', handle: xData?.handle || xData?.identifier || '' }),
      issued_at: xData?.verifiedAt || now,
      expires_at: null,
      issuer: 'twitter'
    });
  }

  // Ethereum verification
  if (vd.eth?.verified) {
    attestations.push({
      id: makeAttestationId(profile.id, 'verification', 'eth'),
      agent_id: profile.id,
      attestation_type: 'verification',
      score: 75,
      evidence: JSON.stringify({ platform: 'eth', wallet: vd.eth.address || vd.eth.identifier || '' }),
      issued_at: vd.eth.verifiedAt || now,
      expires_at: null,
      issuer: 'eth'
    });
  }

  // AgentMail verification
  if (vd.agentmail?.verified) {
    attestations.push({
      id: makeAttestationId(profile.id, 'verification', 'agentmail'),
      agent_id: profile.id,
      attestation_type: 'verification',
      score: 55,
      evidence: JSON.stringify({ platform: 'agentmail', identifier: vd.agentmail.identifier || vd.agentmail.address || '' }),
      issued_at: vd.agentmail.verifiedAt || now,
      expires_at: null,
      issuer: 'agentmail'
    });
  }

  // Domain verification
  if (vd.domain?.verified) {
    attestations.push({
      id: makeAttestationId(profile.id, 'verification', 'domain'),
      agent_id: profile.id,
      attestation_type: 'verification',
      score: 65,
      evidence: JSON.stringify({ platform: 'domain', domain: vd.domain.identifier || vd.domain.address || '' }),
      issued_at: vd.domain.verifiedAt || now,
      expires_at: null,
      issuer: 'domain'
    });
  }

  // Website verification
  if (vd.website?.verified) {
    attestations.push({
      id: makeAttestationId(profile.id, 'verification', 'website'),
      agent_id: profile.id,
      attestation_type: 'verification',
      score: 60,
      evidence: JSON.stringify({ platform: 'website', url: vd.website.identifier || vd.website.address || '' }),
      issued_at: vd.website.verifiedAt || now,
      expires_at: null,
      issuer: 'website'
    });
  }

  // MCP verification
  if (vd.mcp?.verified) {
    attestations.push({
      id: makeAttestationId(profile.id, 'verification', 'mcp'),
      agent_id: profile.id,
      attestation_type: 'verification',
      score: 60,
      evidence: JSON.stringify({ platform: 'mcp', url: vd.mcp.identifier || vd.mcp.address || vd.mcp.url || '' }),
      issued_at: vd.mcp.verifiedAt || now,
      expires_at: null,
      issuer: 'mcp'
    });
  }

  // A2A verification
  if (vd.a2a?.verified) {
    attestations.push({
      id: makeAttestationId(profile.id, 'verification', 'a2a'),
      agent_id: profile.id,
      attestation_type: 'verification',
      score: 60,
      evidence: JSON.stringify({ platform: 'a2a', url: vd.a2a.identifier || vd.a2a.address || vd.a2a.url || '' }),
      issued_at: vd.a2a.verifiedAt || now,
      expires_at: null,
      issuer: 'a2a'
    });
  }

  // Polymarket verification
  if (vd.polymarket?.verified) {
    attestations.push({
      id: makeAttestationId(profile.id, 'trading', 'polymarket'),
      agent_id: profile.id,
      attestation_type: 'trading',
      score: 65,
      evidence: JSON.stringify({ platform: 'polymarket', address: vd.polymarket.address || '' }),
      issued_at: vd.polymarket.verifiedAt || now,
      expires_at: null,
      issuer: 'polymarket'
    });
  }

  // Telegram verification
  if (vd.telegram?.verified) {
    attestations.push({
      id: makeAttestationId(profile.id, 'verification', 'telegram'),
      agent_id: profile.id,
      attestation_type: 'verification',
      score: 50,
      evidence: JSON.stringify({ platform: 'telegram', username: vd.telegram.username || '' }),
      issued_at: vd.telegram.verifiedAt || now,
      expires_at: null,
      issuer: 'telegram'
    });
  }

  // Discord verification
  if (vd.discord?.verified) {
    attestations.push({
      id: makeAttestationId(profile.id, 'verification', 'discord'),
      agent_id: profile.id,
      attestation_type: 'verification',
      score: 50,
      evidence: JSON.stringify({ platform: 'discord', username: vd.discord.username || '' }),
      issued_at: vd.discord.verifiedAt || now,
      expires_at: null,
      issuer: 'discord'
    });
  }

  // Endorsements as attestations
  const endorsements = profile.endorsements || [];
  for (const e of endorsements) {
    const endorserId = typeof e === 'string' ? e : (e.from || e.endorserId || 'unknown');
    attestations.push({
      id: makeAttestationId(profile.id, 'endorsement', endorserId),
      agent_id: profile.id,
      attestation_type: 'endorsement',
      score: 55,
      evidence: JSON.stringify({ endorser: endorserId, skill: e.skill || null }),
      issued_at: e.createdAt || now,
      expires_at: null,
      issuer: endorserId
    });
  }

  // Batch insert
  const insertMany = db.transaction((atts) => {
    for (const att of atts) {
      stmts.insertAttestation.run(att);
    }
  });
  insertMany(attestations);

  return attestations;
}

// ===== Exported Functions =====

/**
 * Compute trust score for a profile, aggregating reputation + attestations.
 * P0: DB writes removed — on-chain v3 is sole source.
 */
function computeTrustScore(profileId) {
  const profile = loadProfile(profileId);
  if (!profile) {
    throw new Error(`Profile not found: ${profileId}`);
  }

  // Sync attestations from verification data
  syncAttestationsFromProfile(profile);

  // Get reputation breakdown
  const rep = calculateReputation(profile);

  // Verification score: from reputation breakdown verification components (0-40 scaled to 0-100)
  const verificationScore = Math.round(
    ((rep.breakdown.verifiedSkills || 0) + (rep.breakdown.verifiedProjects || 0) + (rep.breakdown.walletVerification || 0)) * 2.5
  );

  // Activity score: from reputation breakdown activity components (0-30 scaled to 0-100)
  const activityScore = Math.round(
    ((rep.breakdown.portfolioItems || 0) + (rep.breakdown.skillCount || 0) +
     (rep.breakdown.profileCompleteness || 0) + (rep.breakdown.accountAge || 0)) * 3.33
  );

  // Social score: from reputation breakdown social components (0-30 scaled to 0-100)
  const socialScore = Math.round(
    ((rep.breakdown.moltbookKarma || 0) + (rep.breakdown.twitterFollowers || 0) +
     (rep.breakdown.endorsements || 0)) * 3.33
  );

  // Overall: weighted combination
  const overallScore = Math.min(100, Math.round(
    verificationScore * 0.4 + activityScore * 0.3 + socialScore * 0.3
  ));

  const now = new Date().toISOString();
  const trustData = {
    agent_id: profileId,
    overall_score: overallScore,
    verification_score: Math.min(100, verificationScore),
    activity_score: Math.min(100, activityScore),
    social_score: Math.min(100, socialScore),
    last_computed: now
  };

  // P0: DB write removed — stmts.upsertTrustScore.run(trustData);

  return {
    overall_score: trustData.overall_score,
    verification_score: trustData.verification_score,
    activity_score: trustData.activity_score,
    social_score: trustData.social_score,
    last_computed: now
  };
}

/**
 * Get a single attestation by ID.
 */
function getAttestation(id) {
  const row = stmts.getAttestation.get(id);
  if (!row) return null;
  return {
    id: row.id,
    agentId: row.agent_id,
    attestationType: row.attestation_type,
    score: row.score,
    evidence: JSON.parse(row.evidence || '{}'),
    issuedAt: row.issued_at,
    expiresAt: row.expires_at,
    issuer: row.issuer
  };
}

/**
 * List attestations for an agent. Auto-syncs from profile verification data first.
 * @param {string} agentId
 * @param {object} opts - { type?: string }
 */
function listAttestations(agentId, opts = {}) {
  // Auto-sync from profile
  const profile = loadProfile(agentId);
  if (profile) {
    syncAttestationsFromProfile(profile);
  }

  let rows;
  if (opts.type) {
    rows = stmts.listByAgentAndType.all(agentId, opts.type);
  } else {
    rows = stmts.listByAgent.all(agentId);
  }

  return rows.map(row => ({
    id: row.id,
    agentId: row.agent_id,
    attestationType: row.attestation_type,
    score: row.score,
    evidence: JSON.parse(row.evidence || '{}'),
    issuedAt: row.issued_at,
    expiresAt: row.expires_at,
    issuer: row.issuer
  }));
}

/**
 * Get cached trust score for an agent (does NOT recompute).
 */
function getTrustScore(agentId) {
  // P0: DB reads removed — return null, callers should use v3-score-service
  return null;
}

/**
 * Get registry-wide stats.
 */
function getRegistryStats() {
  const profiles = listProfiles();
  const totalAgents = profiles.length;
  const totalAttestations = stmts.countAll.get().count;
  // P0: DB score stats removed — on-chain v3 only
  const scoredCount = 0;
  const avgScore = 0;
  const tierDistribution = { elite: 0, verified: 0, established: 0, emerging: 0, newcomer: 0 };

  return {
    totalAgents,
    totalAttestations,
    avgScore,
    tierDistribution
  };
}

/**
 * Recompute trust scores for all profiles.
 */
function syncAllTrustScores() {
  const profiles = listProfiles();
  const results = [];
  for (const profile of profiles) {
    try {
      const score = computeTrustScore(profile.id);
      results.push({ agentId: profile.id, ...score });
    } catch (err) {
      results.push({ agentId: profile.id, error: err.message });
    }
  }
  return results;
}

module.exports = {
  computeTrustScore,
  getAttestation,
  listAttestations,
  getTrustScore,
  getRegistryStats,
  syncAllTrustScores,
  syncAttestationsFromProfile
};
