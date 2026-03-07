/**
 * Agent Claims System
 * Allows agents to claim unverified profiles that were created by others
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const CLAIMS_FILE = path.join(DATA_DIR, 'claims.json');
const PROFILES_DIR = path.join(DATA_DIR, 'profiles');

// Claim statuses
const STATUS = {
  PENDING: 'pending',
  VERIFIED: 'verified',
  REJECTED: 'rejected',
  EXPIRED: 'expired'
};

// Load claims data
function loadClaims() {
  if (!fs.existsSync(CLAIMS_FILE)) {
    return { claims: [] };
  }
  return JSON.parse(fs.readFileSync(CLAIMS_FILE, 'utf8'));
}

// Save claims data
function saveClaims(data) {
  fs.writeFileSync(CLAIMS_FILE, JSON.stringify(data, null, 2));
}

// Generate a verification code
function generateVerificationCode() {
  return 'CLAIM_' + crypto.randomBytes(4).toString('hex').toUpperCase();
}

// Check if a profile can be claimed
function canClaim(profileId) {
  const profilePath = path.join(PROFILES_DIR, `${profileId}.json`);
  if (!fs.existsSync(profilePath)) {
    return { canClaim: false, reason: 'Profile not found' };
  }
  
  const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
  
  // Already verified at high level - can't be claimed
  if (profile.verification?.tier === 'verified' || profile.verification?.tier === 'trusted') {
    return { canClaim: false, reason: 'Profile is already verified and cannot be claimed' };
  }
  
  // Has significant verification data - can't be claimed
  if (profile.verificationData?.hyperliquid?.verified || 
      profile.verificationData?.solana?.verified ||
      profile.verificationData?.twitter?.verified) {
    return { canClaim: false, reason: 'Profile has verification data and cannot be claimed' };
  }
  
  // Check for pending claims
  const claims = loadClaims();
  const pendingClaim = claims.claims.find(c => 
    c.profileId === profileId && c.status === STATUS.PENDING
  );
  
  if (pendingClaim) {
    return { canClaim: false, reason: 'Profile already has a pending claim' };
  }
  
  return { canClaim: true, profile };
}

// Create a claim request
function createClaim(profileId, claimantData) {
  const canClaimResult = canClaim(profileId);
  if (!canClaimResult.canClaim) {
    return { error: canClaimResult.reason };
  }
  
  const claims = loadClaims();
  const verificationCode = generateVerificationCode();
  
  const claim = {
    id: 'claim_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex'),
    profileId,
    claimantHandle: claimantData.handle,
    claimantEmail: claimantData.email || null,
    verificationMethod: claimantData.method || 'x_bio', // x_bio, github_bio, email
    verificationCode,
    status: STATUS.PENDING,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(), // 48 hours
    verifiedAt: null,
    notes: []
  };
  
  claims.claims.push(claim);
  saveClaims(claims);
  
  return {
    success: true,
    claim: {
      id: claim.id,
      verificationCode: claim.verificationCode,
      verificationMethod: claim.verificationMethod,
      expiresAt: claim.expiresAt,
      instructions: getVerificationInstructions(claim)
    }
  };
}

// Get verification instructions
function getVerificationInstructions(claim) {
  switch (claim.verificationMethod) {
    case 'x_bio':
      return `Add "${claim.verificationCode}" to your Twitter/X bio, then verify. Remove after verification completes.`;
    case 'github_bio':
      return `Add "${claim.verificationCode}" to your GitHub bio, then verify.`;
    case 'agentmail':
      return `Reply to the verification email from brainkid@agentmail.to with "${claim.verificationCode}" in the subject.`;
    default:
      return `Use code: ${claim.verificationCode}`;
  }
}

// Verify a claim
async function verifyClaim(claimId, verificationData = {}) {
  const claims = loadClaims();
  const claim = claims.claims.find(c => c.id === claimId);
  
  if (!claim) {
    return { error: 'Claim not found' };
  }
  
  if (claim.status !== STATUS.PENDING) {
    return { error: `Claim is ${claim.status}, cannot verify` };
  }
  
  if (new Date(claim.expiresAt) < new Date()) {
    claim.status = STATUS.EXPIRED;
    saveClaims(claims);
    return { error: 'Claim has expired' };
  }
  
  // Verify based on method
  let verified = false;
  
  if (claim.verificationMethod === 'x_bio') {
    // Check if the X bio contains the verification code
    // In a real implementation, this would fetch the X profile
    // For now, we accept manual verification or trust the code in verificationData
    if (verificationData.bioContainsCode || verificationData.manualApproval) {
      verified = true;
    }
  } else if (claim.verificationMethod === 'github_bio') {
    if (verificationData.bioContainsCode || verificationData.manualApproval) {
      verified = true;
    }
  } else if (claim.verificationMethod === 'agentmail') {
    if (verificationData.emailVerified || verificationData.manualApproval) {
      verified = true;
    }
  }
  
  if (!verified) {
    return { error: 'Verification failed - code not found' };
  }
  
  // Transfer ownership
  const profilePath = path.join(PROFILES_DIR, `${claim.profileId}.json`);
  const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
  
  // Update profile with claimant info
  profile.claimedBy = claim.claimantHandle;
  profile.claimedAt = new Date().toISOString();
  profile.updatedAt = new Date().toISOString();
  
  // Update links if provided
  if (verificationData.x) {
    profile.links = profile.links || {};
    profile.links.twitter = verificationData.twitter;
  }
  if (verificationData.agentmail) {
    profile.links = profile.links || {};
    profile.links.agentmail = verificationData.agentmail;
  }
  
  fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2));
  
  // Update claim status
  claim.status = STATUS.VERIFIED;
  claim.verifiedAt = new Date().toISOString();
  saveClaims(claims);
  
  return {
    success: true,
    message: 'Profile claimed successfully',
    profile: {
      id: profile.id,
      name: profile.name,
      claimedBy: profile.claimedBy
    }
  };
}

// Get claim by ID
function getClaim(claimId) {
  const claims = loadClaims();
  return claims.claims.find(c => c.id === claimId);
}

// Get claims for a profile
function getClaimsForProfile(profileId) {
  const claims = loadClaims();
  return claims.claims.filter(c => c.profileId === profileId);
}

// Get pending claims (admin)
function getPendingClaims() {
  const claims = loadClaims();
  return claims.claims.filter(c => c.status === STATUS.PENDING);
}

// Reject a claim
function rejectClaim(claimId, reason = '') {
  const claims = loadClaims();
  const claim = claims.claims.find(c => c.id === claimId);
  
  if (!claim) {
    return { error: 'Claim not found' };
  }
  
  claim.status = STATUS.REJECTED;
  claim.rejectedAt = new Date().toISOString();
  claim.notes.push({ text: reason, at: new Date().toISOString() });
  
  saveClaims(claims);
  return { success: true, message: 'Claim rejected' };
}

// Clean up expired claims
function cleanupExpiredClaims() {
  const claims = loadClaims();
  let cleaned = 0;
  
  for (const claim of claims.claims) {
    if (claim.status === STATUS.PENDING && new Date(claim.expiresAt) < new Date()) {
      claim.status = STATUS.EXPIRED;
      cleaned++;
    }
  }
  
  if (cleaned > 0) {
    saveClaims(claims);
  }
  
  return { cleaned };
}

module.exports = {
  STATUS,
  canClaim,
  createClaim,
  verifyClaim,
  getClaim,
  getClaimsForProfile,
  getPendingClaims,
  rejectClaim,
  cleanupExpiredClaims,
  generateVerificationCode
};
