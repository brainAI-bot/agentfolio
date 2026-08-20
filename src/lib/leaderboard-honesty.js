/**
 * AF-LB-001 — leftover public leaderboard honesty.
 *
 * /api/leaderboard still ranks leftover off-chain unified scores
 * (live p1reg 3/320). The handler sets source=satp_trust_scores when
 * leaderboard_score>0, else computed / verifiable-trust-score. None of
 * those are SATP V3. Current lives at /api/satp/explorer/agents (p1reg is 2/8).
 *
 * Do not rewrite rank. Treat every source that is not v3_onchain or
 * explorer as leftover offchain-stale and point current at the explorer.
 * If a cached V3 row is available, attach it.
 */

const CURRENT_SATP_EXPLORER = '/api/satp/explorer/agents';

// Only these stay unlabeled as leftover. satp_trust_scores, computed,
// verifiable-trust-score, solana-mainnet-v3, and any other leftover source
// become offchain-stale.
const SATP_V3_SOURCES = new Set([
  'v3_onchain',
  'explorer',
]);

function normalizeAgentKey(value) {
  return String(value || '').trim().toLowerCase().replace(/^agent_/, '');
}

function isSatpV3Source(source) {
  return SATP_V3_SOURCES.has(String(source || ''));
}

function isOffchainLeftoverSource(source) {
  const value = String(source || '');
  if (!value) return false;
  return !isSatpV3Source(value);
}

function matchExplorerAgent(agents, entry) {
  const keys = new Set([
    normalizeAgentKey(entry && entry.agentId),
    normalizeAgentKey(entry && entry.id),
    normalizeAgentKey(entry && entry.name),
    normalizeAgentKey(entry && entry.handle),
    normalizeAgentKey(entry && entry.profileId),
  ].filter(Boolean));

  return (agents || []).find((agent) => {
    const candidates = [
      agent.agentId,
      agent.agentName,
      agent.name,
      agent.pda,
      agent.profileId,
      agent.id,
      agent.onChainAgentId,
    ].map(normalizeAgentKey).filter(Boolean);
    return candidates.some((candidate) => keys.has(candidate));
  }) || null;
}

function v3CurrentFromAgent(agent) {
  if (!agent) return null;
  const verificationLevel = agent.verificationLevel ?? agent.level;
  const reputationScore = agent.reputationScore ?? agent.score;
  if (verificationLevel == null && reputationScore == null) return null;
  return {
    verificationLevel: verificationLevel == null ? null : Number(verificationLevel),
    reputationScore: reputationScore == null ? null : Number(reputationScore),
  };
}

function peekExplorerAgentsSafe(loader) {
  try {
    const api = typeof loader === 'function' ? loader() : loader;
    if (!api || typeof api.peekSatpExplorerCache !== 'function') return [];
    const cached = api.peekSatpExplorerCache();
    return Array.isArray(cached && cached.agents) ? cached.agents : [];
  } catch (_) {
    return [];
  }
}

/**
 * Label leftover off-chain leaderboard rows. Rank fields (score/level) stay put.
 */
function labelLeaderboardHonesty(entry, v3Agents = []) {
  if (!entry || typeof entry !== 'object') return entry;

  const labeled = { ...entry };
  const leftover = isOffchainLeftoverSource(entry.source);

  if (leftover) {
    labeled.leftoverSource = entry.source;
    labeled.source = 'offchain-stale';
    labeled.notSatpV3 = true;
    labeled.current = CURRENT_SATP_EXPLORER;
  }

  if (!isSatpV3Source(entry.source)) {
    const match = matchExplorerAgent(v3Agents, entry);
    const v3 = v3CurrentFromAgent(match);
    if (v3) {
      labeled.v3VerificationLevel = v3.verificationLevel;
      labeled.v3ReputationScore = v3.reputationScore;
    }
  }

  return labeled;
}

function labelLeaderboardResponse(payload, v3Agents = []) {
  const rows = Array.isArray(payload && payload.leaderboard) ? payload.leaderboard : [];
  return {
    ...payload,
    current: CURRENT_SATP_EXPLORER,
    leaderboard: rows.map((row) => labelLeaderboardHonesty(row, v3Agents)),
  };
}

function isUnlabeledOffchainL3_320(entry) {
  if (!entry || typeof entry !== 'object') return false;
  const level = Number(entry.level ?? entry.verificationLevel);
  const score = Number(entry.score ?? entry.reputationScore);
  if (level !== 3 || score !== 320) return false;
  if (entry.source === 'offchain-stale' || entry.source === 'notSatpV3' || entry.notSatpV3 === true) {
    return false;
  }
  return isOffchainLeftoverSource(entry.source);
}

module.exports = {
  CURRENT_SATP_EXPLORER,
  isOffchainLeftoverSource,
  isSatpV3Source,
  isUnlabeledOffchainL3_320,
  labelLeaderboardHonesty,
  labelLeaderboardResponse,
  matchExplorerAgent,
  peekExplorerAgentsSafe,
};
