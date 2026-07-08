const {
  CANONICAL_TRUST_PROVIDERS,
  isCanonicalTrustProvider,
  normalizeTrustProvider,
} = require('./canonical-verification-providers');
const { normalizeVerificationPlatform } = require('./verification-categories');

const TRUST_SCORE_CAPS = Object.freeze({
  canonicalVerifications: 440,
  satpEvidence: 200,
  releasedEscrowEvidence: 120,
  signedReviewEvidence: 40,
  total: 800,
});

const CANONICAL_PROVIDER_POINTS = Object.freeze({
  solana: 120,
  github: 120,
  domain: 100,
  website: 100,
});

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function parseJsonish(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

function hasPositiveVerification(data = {}) {
  return Boolean(data && (data.verified === true || data.success === true || data.linked === true));
}

function hasSignedEvidence(data = {}) {
  if (!data || typeof data !== 'object') return false;
  return Boolean(
    data.txSignature ||
    data.signature ||
    data.transactionSignature ||
    data.attestationTx ||
    data.attestationSignature ||
    data.memoTx ||
    data.memo_tx ||
    data.proofSignature ||
    data.reviewPda ||
    data.review_pda ||
    data.satpSignature ||
    data.tx_signature ||
    data.signedAt ||
    data.onChain === true ||
    data.verifiedOnChain === true ||
    data.source === 'satp' ||
    data.source === 'signed' ||
    data.source === 'on-chain'
  );
}

function hasSatpEvidence(data = {}) {
  if (!data || typeof data !== 'object') return false;
  return Boolean(
    data.satpSignature ||
    data.satpTxSignature ||
    data.satpAttestationTx ||
    data.satpPda ||
    data.satpIdentityPda ||
    data.source === 'satp' ||
    data.source === 'satp_v3' ||
    data.type === 'satp' ||
    data.kind === 'satp'
  );
}

function addVerificationCandidate(candidates, platform, rawData = {}) {
  const normalized = normalizeVerificationPlatform(platform);
  if (!normalized) return;

  const data = parseJsonish(rawData, rawData || {});
  candidates.push({
    ...data,
    platform: normalized,
    proof: parseJsonish(data.proof, data.proof || {}),
  });
}

function collectVerificationCandidates(input = {}) {
  const candidates = [];
  const profile = input.profile || {};

  for (const verification of input.verifications || []) {
    addVerificationCandidate(candidates, verification?.platform || verification?.type, verification);
  }

  const verificationData = {
    ...parseJsonish(profile.verificationData, {}),
    ...parseJsonish(profile.verification_data, {}),
    ...parseJsonish(profile.verification, {}),
    ...parseJsonish(input.verificationData, {}),
  };

  for (const [platform, data] of Object.entries(verificationData || {})) {
    addVerificationCandidate(candidates, platform, data);
  }

  return candidates;
}

function computeCanonicalVerificationScore(input = {}) {
  const seen = new Set();
  const verified = [];

  for (const item of collectVerificationCandidates(input)) {
    const platform = normalizeTrustProvider(item.platform);
    if (!isCanonicalTrustProvider(platform) || seen.has(platform)) continue;
    if (!hasPositiveVerification(item) && !hasPositiveVerification(item.proof)) continue;

    seen.add(platform);
    verified.push(platform);
  }

  const byProvider = {};
  let total = 0;
  for (const platform of CANONICAL_TRUST_PROVIDERS) {
    const points = verified.includes(platform) ? CANONICAL_PROVIDER_POINTS[platform] : 0;
    byProvider[platform] = points;
    total += points;
  }

  return {
    total: Math.min(total, TRUST_SCORE_CAPS.canonicalVerifications),
    breakdown: byProvider,
    verified,
  };
}

function computeSatpEvidenceScore(input = {}) {
  const profile = input.profile || {};
  const onchain = input.onchain || {};
  const candidates = collectVerificationCandidates(input);

  const hasSatpIdentity = Boolean(
    input.hasSatpIdentity ??
    input.hasSatpGenesis ??
    onchain.hasSatpIdentity ??
    onchain.hasSatpGenesis ??
    profile.hasSatpIdentity ??
    profile.hasSatpGenesis
  );

  const signedSatpItems = candidates.filter((item) => {
    const platform = normalizeVerificationPlatform(item.platform);
    return platform === 'satp' || hasSatpEvidence(item) || hasSatpEvidence(item.proof);
  });

  const signedEvidenceCount = Number(input.signedSatpEvidenceCount ?? onchain.signedSatpEvidenceCount ?? 0);
  const evidenceCount = Math.max(signedSatpItems.length, signedEvidenceCount);

  const breakdown = {
    satpIdentity: hasSatpIdentity ? 80 : 0,
    signedSatpEvidence: Math.min(3, Math.max(0, evidenceCount)) * 40,
  };

  return {
    total: Math.min(TRUST_SCORE_CAPS.satpEvidence, breakdown.satpIdentity + breakdown.signedSatpEvidence),
    breakdown,
    evidenceCount,
  };
}

function isReleasedStatus(value) {
  return ['released', 'auto_released', 'completed', 'settled'].includes(String(value || '').toLowerCase());
}

function countReleasedEscrowEvidence(input = {}) {
  const activity = input.activity || {};
  const escrows = [
    ...(Array.isArray(input.escrows) ? input.escrows : []),
    ...(Array.isArray(input.releasedEscrows) ? input.releasedEscrows : []),
    ...(Array.isArray(activity.escrows) ? activity.escrows : []),
    ...(Array.isArray(activity.releasedEscrows) ? activity.releasedEscrows : []),
  ];

  if (escrows.length > 0) {
    return escrows.filter((escrow) => {
      if (!isReleasedStatus(escrow?.status)) return false;
      return Boolean(
        escrow.txSignature ||
        escrow.tx_signature ||
        escrow.releaseTx ||
        escrow.release_tx ||
        escrow.releaseTxHash ||
        escrow.release_tx_hash ||
        escrow.escrowPda ||
        escrow.escrow_pda ||
        escrow.onChain === true ||
        escrow.verifiedOnChain === true
      );
    }).length;
  }

  return Number(
    input.releasedEscrowEvidenceCount ??
    activity.releasedEscrowEvidenceCount ??
    input.onchainReleasedEscrowEvidenceCount ??
    activity.onchainReleasedEscrowEvidenceCount ??
    0
  );
}

function computeReleasedEscrowEvidenceScore(input = {}) {
  const evidenceCount = Math.max(0, countReleasedEscrowEvidence(input));
  const total = Math.min(TRUST_SCORE_CAPS.releasedEscrowEvidence, evidenceCount * 40);
  return {
    total,
    breakdown: { releasedEscrows: total },
    evidenceCount,
  };
}

function countSignedReviewEvidence(input = {}) {
  const activity = input.activity || {};
  const reviews = [
    ...(Array.isArray(input.reviewsReceived) ? input.reviewsReceived : []),
    ...(Array.isArray(input.receivedReviews) ? input.receivedReviews : []),
    ...(Array.isArray(activity.reviewsReceived) ? activity.reviewsReceived : []),
    ...(Array.isArray(activity.receivedReviews) ? activity.receivedReviews : []),
  ];

  if (reviews.length > 0) {
    return reviews.filter((review) => hasSignedEvidence(review) || hasSignedEvidence(parseJsonish(review?.proof, {}))).length;
  }

  return Number(input.signedReviewEvidenceCount ?? activity.signedReviewEvidenceCount ?? 0);
}

function computeSignedReviewEvidenceScore(input = {}) {
  const evidenceCount = Math.max(0, countSignedReviewEvidence(input));
  const total = Math.min(TRUST_SCORE_CAPS.signedReviewEvidence, evidenceCount * 20);
  return {
    total,
    breakdown: { signedReviews: total },
    evidenceCount,
  };
}

function computeTrustScore(input = {}) {
  const canonical = computeCanonicalVerificationScore(input);
  const satp = computeSatpEvidenceScore(input);
  const releasedEscrow = computeReleasedEscrowEvidenceScore(input);
  const signedReviews = computeSignedReviewEvidenceScore(input);

  const trustScore = clamp(
    canonical.total + satp.total + releasedEscrow.total + signedReviews.total,
    0,
    TRUST_SCORE_CAPS.total
  );

  const breakdown = {
    canonicalVerifications: canonical.total,
    satpEvidence: satp.total,
    releasedEscrowEvidence: releasedEscrow.total,
    signedReviewEvidence: signedReviews.total,
  };

  return {
    trustScore,
    total: trustScore,
    breakdown,
    details: {
      canonicalVerifications: canonical,
      satpEvidence: satp,
      releasedEscrowEvidence: releasedEscrow,
      signedReviewEvidence: signedReviews,
    },
    componentTotals: breakdown,
  };
}

module.exports = {
  TRUST_SCORE_CAPS,
  CANONICAL_PROVIDER_POINTS,
  computeTrustScore,
  computeCanonicalVerificationScore,
  computeSatpEvidenceScore,
  computeReleasedEscrowEvidenceScore,
  computeSignedReviewEvidenceScore,
};
