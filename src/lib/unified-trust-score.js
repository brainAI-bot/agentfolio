const { computeVerificationLevel, hasHumanVerificationCredential } = require('./compute-level');
const { computeTrustScore } = require('./compute-trust-score');
const { countPortfolioItems } = require('./profile-completeness');
const {
  normalizeVerificationPlatform,
  normalizeVerifications,
} = require('./verification-categories');

function queryAll(db, sql, params = []) {
  try {
    return db.prepare(sql).all(...params);
  } catch (_) {
    return [];
  }
}

function queryOne(db, sql, params = [], fallback = null) {
  try {
    return db.prepare(sql).get(...params) || fallback;
  } catch (_) {
    return fallback;
  }
}

function parseProof(proof) {
  if (!proof) return {};
  if (typeof proof === 'string') {
    try { return JSON.parse(proof); } catch (_) { return {}; }
  }
  return proof;
}

function extractTxSignature(proof) {
  const parsed = parseProof(proof);
  return parsed?.txSignature || parsed?.signature || parsed?.transactionSignature || null;
}

function buildVerificationList(db, profileId) {
  const rows = queryAll(
    db,
    'SELECT platform, identifier, proof, verified_at FROM verifications WHERE profile_id = ? ORDER BY verified_at DESC',
    [profileId]
  );

  return normalizeVerifications(rows.map((row) => ({
    platform: normalizeVerificationPlatform(row.platform),
    identifier: row.identifier || null,
    txSignature: extractTxSignature(row.proof),
    timestamp: row.verified_at || null,
    proof: parseProof(row.proof),
  })), { includeSatp: true, dedupe: true });
}

function getStats(db, profileId) {
  const endorsementsGiven = queryAll(db, 'SELECT * FROM endorsements WHERE endorser_id = ?', [profileId]);
  const endorsementsReceived = queryAll(db, 'SELECT * FROM endorsements WHERE profile_id = ?', [profileId]);
  const jobsPosted = queryOne(db, 'SELECT COUNT(*) AS c FROM jobs WHERE client_id = ?', [profileId], { c: 0 }).c || 0;
  const escrowsCompletedAsWorker = queryOne(db, "SELECT COUNT(*) AS c FROM escrows WHERE agent_id = ? AND (status IN ('completed','released') OR released_at IS NOT NULL)", [profileId], { c: 0 }).c || 0;
  const escrowsCompletedAsPoster = queryOne(db, "SELECT COUNT(*) AS c FROM escrows WHERE client_id = ? AND (status IN ('completed','released') OR released_at IS NOT NULL)", [profileId], { c: 0 }).c || 0;
  const totalEscrows = queryOne(db, 'SELECT COUNT(*) AS c FROM escrows WHERE agent_id = ? OR client_id = ?', [profileId, profileId], { c: 0 }).c || 0;
  const reviewsReceived = queryAll(db, 'SELECT * FROM reviews WHERE reviewee_id = ?', [profileId]);
  const onchainAttestationsReceived = queryOne(db, "SELECT COUNT(*) AS c FROM attestations WHERE profile_id = ? AND tx_signature IS NOT NULL AND platform NOT IN ('satp', 'solana')", [profileId], { c: 0 }).c || 0;
  const referralsReachedL2 = 0;

  return {
    endorsementsGiven,
    endorsementsReceived,
    jobsPosted,
    escrowsCompletedAsWorker,
    escrowsCompletedAsPoster,
    reviewsReceived,
    completionRate: totalEscrows > 0 ? ((escrowsCompletedAsWorker + escrowsCompletedAsPoster) / totalEscrows) : null,
    onchainAttestationsReceived,
    referralsReachedL2,
  };
}

function normalizeV3DisplayScore(v3Score) {
  const raw = Number(v3Score?.reputationScore || 0);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return raw > 10000 ? Math.round(raw / 1000) : raw;
}

function hasPersistedBoaAvatar(profile) {
  if (!profile || typeof profile !== 'object') return false;

  const metadata = parseProof(profile.metadata);
  const topLevelNftAvatar = parseProof(profile.nft_avatar || profile.nftAvatar);
  const metadataNftAvatar = parseProof(metadata?.nftAvatar);

  const candidates = [topLevelNftAvatar, metadataNftAvatar].filter(Boolean);
  return candidates.some((avatar) => Boolean(
    avatar?.permanent ||
    avatar?.verifiedOnChain ||
    avatar?.soulboundMint ||
    avatar?.mintedAt ||
    avatar?.burnTxSignature ||
    avatar?.burnTx
  )) || Boolean(profile?.boaMint || metadata?.boaMint || metadata?.boaId);
}

function computeUnifiedTrustScore(db, profile, options = {}) {
  const profileId = profile?.id || profile?.profileId || profile;
  const v3Score = options.v3Score || null;
  const hasSatpIdentity = Boolean(v3Score && Number(v3Score.verificationLevel || 0) >= 1);
  const hasBoaAvatar = Boolean(
    options.hasBoaAvatar ||
    profile?.hasBoaAvatar ||
    profile?.isBorn ||
    hasPersistedBoaAvatar(profile) ||
    v3Score?.isBorn ||
    v3Score?.onChain?.isBorn
  );

  const normalizedProfile = {
    ...(typeof profile === 'object' ? profile : {}),
    id: profileId,
  };
  if (!normalizedProfile.portfolioItemsCount) {
    normalizedProfile.portfolioItemsCount = countPortfolioItems(normalizedProfile);
  }

  const verifications = buildVerificationList(db, profileId);
  const stats = getStats(db, profileId);

  const level = computeVerificationLevel({
    hasSatpIdentity,
    verifications,
    profile: normalizedProfile,
    activity: {
      completedEscrowJobsAsWorker: stats.escrowsCompletedAsWorker,
      completedEscrowJobsAsPoster: stats.escrowsCompletedAsPoster,
      reviewsReceived: stats.reviewsReceived,
      hasBoaAvatar,
    },
    hasHumanVerification: hasHumanVerificationCredential(verifications),
  });

  const trust = computeTrustScore({
    profile: normalizedProfile,
    endorsementsGiven: stats.endorsementsGiven,
    endorsementsReceived: stats.endorsementsReceived,
    jobsPosted: stats.jobsPosted,
    escrowsCompletedAsWorker: stats.escrowsCompletedAsWorker,
    escrowsCompletedAsPoster: stats.escrowsCompletedAsPoster,
    reviewsReceived: stats.reviewsReceived,
    completionRate: stats.completionRate,
    onchain: {
      hasSatpGenesis: hasSatpIdentity,
      hasBoaAvatar,
      onchainAttestationsReceived: stats.onchainAttestationsReceived,
    },
    tenure: {
      referralsReachedL2: stats.referralsReachedL2,
    },
  });

  const normalizedV3Score = normalizeV3DisplayScore(v3Score);
  const displayScore = Math.max(trust.trustScore || 0, normalizedV3Score);

  return {
    score: displayScore,
    trustScore: displayScore,
    level: level.level,
    levelName: level.levelName,
    badge: level.badge,
    breakdown: trust.breakdown,
    trustBreakdown: {
      ...(trust.details || {}),
      v3: {
        rawReputationScore: Number(v3Score?.reputationScore || 0) || 0,
        normalizedDisplayScore: normalizedV3Score,
      },
    },
    verificationCount: level.verificationCount,
    effectiveVerificationCount: level.effectiveVerificationCount,
    categories: level.categories,
    verifications: verifications.map((verification) => ({
      ...verification,
      verified: true,
      solscanUrl: verification.txSignature ? `https://solana.fm/tx/${verification.txSignature}` : null,
    })),
    hasSatpIdentity,
    hasBoaAvatar,
    source: normalizedV3Score > (trust.trustScore || 0) ? 'scoring-v2-phase-a+v3-floor' : 'scoring-v2-phase-a',
  };
}

module.exports = {
  computeUnifiedTrustScore,
};
