const { isProfileCompleteForLevel } = require('./profile-completeness');
const {
  normalizeVerifications,
  getVerificationCategory,
  normalizeVerificationPlatform,
} = require('./verification-categories');

const LEVELS = {
  0: { level: 0, name: 'Unclaimed', badge: '⚪' },
  1: { level: 1, name: 'Registered', badge: '🟡' },
  2: { level: 2, name: 'Verified', badge: '🔵' },
  3: { level: 3, name: 'Established', badge: '🟢' },
  4: { level: 4, name: 'Trusted', badge: '🟠' },
  5: { level: 5, name: 'Sovereign', badge: '🟣' },
};

function countEffectiveVerifications(verifications = []) {
  const bucketCounts = { wallet: 0, platform: 0, infra: 0, onchain: 0 };
  for (const verification of verifications) {
    const category = getVerificationCategory(verification.platform);
    if (!category) continue;
    if (category === 'wallet') {
      bucketCounts.wallet = Math.min(2, bucketCounts.wallet + 1);
      continue;
    }
    bucketCounts[category] += 1;
  }
  return Object.values(bucketCounts).reduce((sum, count) => sum + count, 0);
}

function hasHumanVerificationCredential(verifications = []) {
  return verifications.some((verification) => {
    const platform = normalizeVerificationPlatform(verification.platform);
    if (platform === 'github') return true;
    if (platform !== 'x') return false;
    const method = String(verification.method || verification.proofMethod || verification.proof_type || '').toLowerCase();
    return Boolean(method && (method.includes('hardened') || method.includes('gist') || method.includes('human')));
  });
}

function computeVerificationLevel(input = {}) {
  const profile = input.profile || {};
  const activity = input.activity || {};
  const hasSatpIdentity = Boolean(input.hasSatpIdentity || input.hasSatpGenesis || activity.hasSatpGenesis);
  const normalizedVerifications = normalizeVerifications(input.verifications || [], { includeSatp: false, dedupe: true });
  const categories = [...new Set(normalizedVerifications.map((v) => getVerificationCategory(v.platform)).filter(Boolean))];
  const verificationCount = normalizedVerifications.length;
  const effectiveVerificationCount = countEffectiveVerifications(normalizedVerifications);
  const profileComplete = isProfileCompleteForLevel(profile);
  const completedEscrowJobs = Number(
    input.completedEscrowCount
      ?? activity.completedEscrowJobs
      ?? ((Number(activity.completedEscrowJobsAsWorker || 0) + Number(activity.completedEscrowJobsAsPoster || 0)))
      ?? 0
  );
  const reviewCount = Number(
    input.receivedReviewCount
      ?? activity.receivedReviewCount
      ?? (Array.isArray(activity.reviewsReceived) ? activity.reviewsReceived.length : 0)
      ?? 0
  );
  const hasBoaAvatar = Boolean(input.hasBoaAvatar ?? activity.hasBoaAvatar);
  const humanVerification = typeof input.hasHumanVerification === 'boolean'
    ? input.hasHumanVerification
    : hasHumanVerificationCredential(normalizedVerifications);
  const profileExists = input.profileExists ?? Boolean(profile && Object.keys(profile).length > 0);

  let level = 0;
  if (hasSatpIdentity) level = 1;
  if (hasSatpIdentity && verificationCount >= 2) level = 2;
  if (level >= 2 && effectiveVerificationCount >= 5 && categories.length >= 2 && profileComplete) level = 3;
  if (level >= 3 && completedEscrowJobs >= 1 && reviewCount >= 1) level = 4;
  if (level >= 4 && hasBoaAvatar && reviewCount >= 3 && humanVerification) level = 5;

  if (!hasSatpIdentity && verificationCount === 0 && !profileExists) level = 0;

  const meta = LEVELS[level];
  return {
    level,
    levelName: meta.name,
    badge: meta.badge,
    verificationCount,
    effectiveVerificationCount,
    categories,
    categoryCount: categories.length,
    profileComplete,
    hasHumanVerification: humanVerification,
    verifications: normalizedVerifications,
  };
}

module.exports = {
  LEVELS,
  computeVerificationLevel,
  hasHumanVerificationCredential,
};
