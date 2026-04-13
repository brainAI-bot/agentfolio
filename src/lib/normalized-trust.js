const profileStore = require('../profile-store');
const { computeUnifiedTrustScore } = require('./unified-trust-score');

let getV3Score = async () => null;
try {
  ({ getV3Score } = require('../v3-score-service'));
} catch (_) {}

async function loadNormalizedTrust(profileId) {
  if (!profileId) return null;
  try {
    const db = profileStore.getDb();
    const row = db.prepare('SELECT * FROM profiles WHERE id = ?').get(profileId);
    if (!row) return null;

    const v3Score = await getV3Score(profileId).catch(() => null);
    const unified = computeUnifiedTrustScore(db, row, { v3Score });

    return {
      profileId,
      trustScore: unified.score,
      score: unified.score,
      reputationScore: unified.score,
      verificationLevel: unified.level,
      verificationLevelName: unified.levelName,
      verificationLabel: unified.levelName,
      breakdown: unified.breakdown || {},
      trustScoreBreakdown: unified.breakdown || {},
      isBorn: !!(v3Score && v3Score.isBorn),
      faceImage: (v3Score && v3Score.faceImage) || null,
      source: unified.source,
    };
  } catch (_) {
    return null;
  }
}

module.exports = { loadNormalizedTrust };
