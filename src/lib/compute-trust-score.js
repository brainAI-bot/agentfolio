const { computeProfileCompleteness } = require('./profile-completeness');

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function countItems(value) {
  if (Array.isArray(value)) return value.length;
  if (Number.isFinite(Number(value))) return Number(value);
  return 0;
}

function getWallet(profile = {}) {
  if (profile.wallet) return profile.wallet;
  const wallets = profile.wallets;
  if (!wallets) return null;
  if (typeof wallets === 'string') {
    try {
      return JSON.parse(wallets || '{}')?.solana || null;
    } catch (_) {
      return null;
    }
  }
  return wallets.solana || null;
}

function daysSince(dateValue) {
  if (!dateValue) return 0;
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return 0;
  return Math.floor((Date.now() - date.getTime()) / 86400000);
}

function pointsForEndorserLevel(level) {
  return ({ 1: 5, 2: 10, 3: 20, 4: 30, 5: 40 }[Number(level) || 0] || 0);
}

function computeSocialProof(input = {}) {
  const profile = input.profile || {};
  const subjectWallet = getWallet(profile);
  const endorsementsGiven = Array.isArray(input.endorsementsGiven) ? input.endorsementsGiven : new Array(Math.max(0, Number(input.endorsementsGivenCount || 0))).fill({});
  const endorsementsReceived = Array.isArray(input.endorsementsReceived)
    ? input.endorsementsReceived
    : (Array.isArray(input.receivedEndorsements) ? input.receivedEndorsements : []);

  const givenPoints = Math.min(5, endorsementsGiven.length) * 5;
  const seenPairs = new Set();
  let receivedPoints = 0;

  for (const endorsement of endorsementsReceived) {
    const endorserWallet = endorsement.endorserWallet || endorsement.fromWallet || endorsement.wallet || null;
    const endorserId = endorsement.endorserId || endorsement.from || endorsement.endorser_id || endorserWallet || null;
    const subjectId = endorsement.subjectId || endorsement.to || endorsement.profile_id || profile.id || subjectWallet || 'subject';
    if (subjectWallet && endorserWallet && subjectWallet === endorserWallet) continue;

    const pairKey = [String(endorserId || ''), String(subjectId || '')].sort().join('::');
    if (pairKey !== '::' && seenPairs.has(pairKey)) continue;
    if (pairKey !== '::') seenPairs.add(pairKey);

    receivedPoints += pointsForEndorserLevel(
      endorsement.endorserLevel || endorsement.level || endorsement.endorser_level || endorsement.reviewerLevel
    );
  }

  const total = Math.min(200, givenPoints + receivedPoints);
  return {
    total,
    breakdown: {
      endorsementsGiven: givenPoints,
      endorsementsReceived: Math.min(receivedPoints, Math.max(0, 200 - givenPoints)),
    },
  };
}

function reviewPoints(review = {}) {
  const rating = Number(review.rating || review.stars || review.score || 0);
  if (rating >= 5) return 50;
  if (rating >= 4) return 30;
  if (rating >= 3) return 10;
  if (rating > 0) return -20;
  return 0;
}

function computeMarketplaceActivity(input = {}) {
  const activity = input.activity || {};
  const jobsPosted = Number(input.jobsPosted ?? input.jobsPostedCount ?? activity.jobsPosted ?? 0);
  const workerEscrows = Number(input.escrowsCompletedAsWorker ?? input.completedWorkerEscrowCount ?? activity.escrowsCompletedAsWorker ?? activity.completedEscrowJobsAsWorker ?? 0);
  const posterEscrows = Number(input.escrowsCompletedAsPoster ?? input.completedPosterEscrowCount ?? activity.escrowsCompletedAsPoster ?? activity.completedEscrowJobsAsPoster ?? 0);
  const reviewsReceived = Array.isArray(input.reviewsReceived)
    ? input.reviewsReceived
    : (Array.isArray(input.receivedReviews) ? input.receivedReviews : (Array.isArray(activity.reviewsReceived) ? activity.reviewsReceived : []));
  const completionRate = Number.isFinite(Number(input.completionRate ?? activity.completionRate))
    ? Number(input.completionRate ?? activity.completionRate)
    : null;
  const totalJobs = workerEscrows + posterEscrows;

  const breakdown = {
    jobsPosted: jobsPosted > 0 ? 10 : 0,
    completedEscrowJobsAsWorker: workerEscrows * 30,
    completedEscrowJobsAsPoster: posterEscrows * 15,
    reviewsReceived: reviewsReceived.reduce((sum, review) => sum + reviewPoints(review), 0),
    perfectCompletionBonus: totalJobs >= 3 && completionRate === 1 ? 50 : 0,
  };

  const total = Math.min(300, breakdown.jobsPosted + breakdown.completedEscrowJobsAsWorker + breakdown.completedEscrowJobsAsPoster + breakdown.reviewsReceived + breakdown.perfectCompletionBonus);
  return { total, breakdown };
}

function computeOnChainActivity(input = {}) {
  const onchain = input.onchain || {};
  const hasSatpGenesis = Boolean(input.hasSatpIdentity ?? input.hasSatpGenesis ?? onchain.hasSatpGenesis ?? onchain.hasSatpIdentity);
  const hasBoaAvatar = Boolean(input.hasBoaAvatar ?? onchain.hasBoaAvatar);
  const onchainAttestationsReceived = Number(input.onchainAttestationsReceived ?? onchain.onchainAttestationsReceived ?? 0);

  const breakdown = {
    satpGenesis: hasSatpGenesis ? 10 : 0,
    boaAvatar: hasBoaAvatar ? 40 : 0,
    onchainAttestationsReceived: Math.min(2, Math.max(0, onchainAttestationsReceived)) * 25,
  };

  return {
    total: Math.min(100, breakdown.satpGenesis + breakdown.boaAvatar + breakdown.onchainAttestationsReceived),
    breakdown,
  };
}

function computePlatformTenure(input = {}) {
  const tenure = input.tenure || {};
  const profile = input.profile || {};
  const daysActive = Number.isFinite(Number(tenure.daysActive))
    ? Number(tenure.daysActive)
    : daysSince(profile.created_at || profile.createdAt || input.createdAt);
  const referralsReachedL2 = Number(input.referralsReachedL2 ?? tenure.referralsReachedL2 ?? input.referralCount ?? 0);

  const breakdown = {
    days7: daysActive >= 7 ? 10 : 0,
    days30: daysActive >= 30 ? 30 : 0,
    days90: daysActive >= 90 ? 50 : 0,
    referralsReachedL2: Math.min(4, Math.max(0, referralsReachedL2)) * 20,
  };

  return {
    total: Math.min(170, breakdown.days7 + breakdown.days30 + breakdown.days90 + breakdown.referralsReachedL2),
    breakdown,
    daysActive,
  };
}

function computeTrustScore(input = {}) {
  const profile = input.profile || {};
  const profileComponent = computeProfileCompleteness(profile);
  const socialComponent = computeSocialProof({ ...input, profile });
  const marketplaceComponent = computeMarketplaceActivity({ ...input, profile });
  const onchainComponent = computeOnChainActivity({ ...input, profile });
  const tenureComponent = computePlatformTenure({ ...input, profile });

  const trustScore = clamp(
    profileComponent.total + socialComponent.total + marketplaceComponent.total + onchainComponent.total + tenureComponent.total,
    0,
    800
  );

  const breakdown = {
    profile: profileComponent.total,
    social: socialComponent.total,
    marketplace: marketplaceComponent.total,
    onchain: onchainComponent.total,
    tenure: tenureComponent.total,
  };

  return {
    trustScore,
    total: trustScore,
    breakdown,
    details: {
      profile: profileComponent,
      social: socialComponent,
      marketplace: marketplaceComponent,
      onchain: onchainComponent,
      tenure: tenureComponent,
    },
    componentTotals: breakdown,
  };
}

module.exports = {
  computeTrustScore,
  computeSocialProof,
  computeMarketplaceActivity,
  computeOnChainActivity,
  computePlatformTenure,
};
