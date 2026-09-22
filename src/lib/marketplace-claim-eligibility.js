'use strict';

const { computeVerificationLevel } = require('./compute-level');
const { computeTrustScore } = require('./compute-trust-score');
const { listCanonicalPeerReviews } = require('./canonical-review-evidence');
const { isCanonicalTrustProvider } = require('./canonical-verification-providers');
const { normalizeVerificationPlatform, normalizeVerifications } = require('./verification-categories');
const { isFixtureIdentity, isFixtureJob } = require('./public-traction');

function tableExists(db, table) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
}

function parseJson(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch (_) { return fallback; }
}

function canonicalVerificationRecords(db, profileId) {
  if (!tableExists(db, 'verifications')) return [];
  return normalizeVerifications(db.prepare(`
    SELECT platform, identifier, proof, verified_at
    FROM verifications
    WHERE profile_id = ? AND verified_at IS NOT NULL
    ORDER BY verified_at DESC, rowid DESC
  `).all(profileId).map((row) => {
    const proof = parseJson(row.proof);
    return {
      platform: normalizeVerificationPlatform(row.platform),
      identifier: row.identifier || null,
      verified: true,
      proof,
      txSignature: proof.txSignature || proof.signature || proof.transactionSignature || null,
      timestamp: row.verified_at,
    };
  }), { includeSatp: true, dedupe: true });
}

function canonicalReleasedEscrows(db, profileId) {
  if (!tableExists(db, 'escrows') || !tableExists(db, 'jobs')) return [];
  return db.prepare(`
    SELECT escrow.*, job.id AS canonical_job_id, job.client_id AS canonical_client_id,
      job.selected_agent_id AS canonical_agent_id, job.title AS canonical_title,
      job.description AS canonical_description, job.status AS canonical_job_status
    FROM escrows AS escrow
    JOIN jobs AS job ON job.id = escrow.job_id
    WHERE (escrow.agent_id = ? OR escrow.client_id = ?)
      AND escrow.release_tx_hash IS NOT NULL
      AND TRIM(escrow.release_tx_hash) <> ''
      AND (LOWER(escrow.status) IN ('released', 'auto_released', 'release_complete', 'completed', 'paid', 'settled')
        OR escrow.released_at IS NOT NULL)
      AND LOWER(job.status) <> 'disputed'
      AND NOT EXISTS (
        SELECT 1 FROM job_transition_audit AS disputed
        WHERE disputed.job_id = job.id AND disputed.to_status = 'disputed'
      )
  `).all(profileId, profileId).filter((row) => !isFixtureJob({
    id: row.canonical_job_id,
    client_id: row.canonical_client_id,
    agent_id: row.canonical_agent_id,
    title: row.canonical_title,
    description: row.canonical_description,
  })).map((row) => ({
    status: row.status,
    releaseTxHash: row.release_tx_hash,
    releasedAt: row.released_at,
    escrowPda: row.id,
  }));
}

function canonicalSignedReviews(db, profileId) {
  if (!tableExists(db, 'peer_reviews') || !tableExists(db, 'jobs')) return [];
  return listCanonicalPeerReviews(db, { revieweeId: profileId }).filter((review) => {
    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(review.job_id);
    const disputed = job && db.prepare(`
      SELECT 1 FROM job_transition_audit WHERE job_id = ? AND to_status = 'disputed'
    `).get(job.id);
    return job && String(job.status || '').toLowerCase() !== 'disputed' && !disputed && !isFixtureJob(job)
      && !isFixtureIdentity(review.reviewer_id, review.reviewee_id);
  });
}

function computeMarketplaceClaimEligibility(db, profileId) {
  const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(profileId);
  if (!profile || isFixtureIdentity(profile.id, profile.name, profile.handle)) {
    return {
      eligibleIdentity: false,
      verificationLevel: 0,
      trustScore: 0,
      source: 'canonical-marketplace-evidence-v1',
      verifications: [],
      releasedEscrowCount: 0,
      signedReviewCount: 0,
    };
  }

  const verifications = canonicalVerificationRecords(db, profileId);
  const releasedEscrows = canonicalReleasedEscrows(db, profileId);
  const signedReviews = canonicalSignedReviews(db, profileId);
  const hasSatpIdentity = verifications.some((entry) => ['satp', 'satp_v3'].includes(normalizeVerificationPlatform(entry.platform)));
  const level = computeVerificationLevel({
    profile: { ...profile, verification_data: undefined, verification: undefined },
    verifications,
    hasSatpIdentity,
    activity: {
      completedEscrowJobs: releasedEscrows.length,
      reviewsReceived: signedReviews,
    },
  });
  const trust = computeTrustScore({
    profile: { id: profile.id },
    verifications,
    hasSatpIdentity,
    releasedEscrows,
    reviewsReceived: signedReviews,
  });
  const canonicalIdentity = verifications.some((entry) => isCanonicalTrustProvider(entry.platform));

  return {
    eligibleIdentity: canonicalIdentity,
    verificationLevel: level.level,
    trustScore: trust.trustScore,
    source: 'canonical-marketplace-evidence-v1',
    verifications,
    releasedEscrowCount: releasedEscrows.length,
    signedReviewCount: signedReviews.length,
  };
}

module.exports = {
  canonicalVerificationRecords,
  canonicalReleasedEscrows,
  canonicalSignedReviews,
  computeMarketplaceClaimEligibility,
};
