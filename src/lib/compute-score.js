/**
 * A1: Single scoring function — replaces ALL scoring paths.
 * Reads verifications and computes score/level on the fly.
 * No DB scores. No chain-cache overlay. Just verifications → score.
 */

const VERIFICATION_WEIGHTS = {
  github: 50,
  solana: 30,
  x: 40,
  twitter: 40, // alias for x
  satp: 20,
  satp_v3: 20,
  domain: 20,
  ethereum: 20,
  eth: 20,
  solana_wallet_verification: 30,
  solana_wallet: 30,
  agentmail: 15,
  moltbook: 15,
  hyperliquid: 15,
  polymarket: 10,
  discord: 10,
  telegram: 10,
  website: 10,
  mcp: 15,
  a2a: 15,
  review: 10,
};

// Level thresholds
const LEVELS = [
  { level: 0, name: 'Unclaimed',    minScore: 0,   badge: '⚪' },
  { level: 1, name: 'Registered',   minScore: 0,   badge: '🟡' },  // has SATP identity
  { level: 2, name: 'Verified',     minScore: 50,  badge: '🔵' },
  { level: 3, name: 'Established',  minScore: 100, badge: '🟢' },
  { level: 4, name: 'Trusted',      minScore: 150, badge: '🟠' },
  { level: 5, name: 'Sovereign',    minScore: 200, badge: '🟣' },  // requires human verification
];

/**
 * Compute score and level from a list of verifications.
 * @param {Array<{platform: string, identifier: string, verified?: boolean}>} verifications
 * @param {object} opts - { hasSatpIdentity: boolean, claimed: boolean }
 * @returns {{ score: number, level: number, levelName: string, badge: string, breakdown: object }}
 */
function computeScore(verifications = [], opts = {}) {
  const { hasSatpIdentity = false, claimed = false } = opts;
  
  const breakdown = {};
  let score = 0;
  let verificationCount = 0;
  let hasSatpAttestation = false;
  
  // CEO Apr 11 rule: do not filter or deduplicate on-chain attestations at read time.
  // If an attestation exists, it counts.
  for (const v of verifications) {
    const platform = (v.platform || '').toLowerCase();
    if (!platform) continue;
    // Keep a minimal identifier fallback so raw on-chain attestation rows still count.
    const identifier = v.identifier || v.address || v.did || `attestation:${verificationCount + 1}`;
    if (!identifier) continue;

    const weight = VERIFICATION_WEIGHTS[platform] || 10;
    score += weight;
    breakdown[platform] = (breakdown[platform] || 0) + weight;
    verificationCount += 1;
    if (platform === 'satp') hasSatpAttestation = true;
  }
  
  // SATP identity bonus only applies when there is identity but no explicit SATP attestation row.
  if (hasSatpIdentity && !hasSatpAttestation) {
    score += VERIFICATION_WEIGHTS.satp;
    breakdown.satp_identity = (breakdown.satp_identity || 0) + VERIFICATION_WEIGHTS.satp;
  }
  
  // Determine level
  let level = 0;
  if (!claimed && !hasSatpIdentity && verificationCount === 0) {
    level = 0; // Unclaimed
  } else if (hasSatpIdentity || claimed || verificationCount > 0) {
    level = 1; // Registered
    // Upgrade based on score thresholds
    for (let i = LEVELS.length - 1; i >= 2; i--) {
      if (score >= LEVELS[i].minScore) {
        // L5 requires human verification flag (future)
        if (i === 5) continue; // skip for now
        level = i;
        break;
      }
    }
  }
  
  const levelInfo = LEVELS[level];
  
  return {
    score,
    level,
    levelName: levelInfo.name,
    badge: levelInfo.badge,
    breakdown,
    verificationCount,
  };
}

module.exports = { computeScore, VERIFICATION_WEIGHTS, LEVELS };
