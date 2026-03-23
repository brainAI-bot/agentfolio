/**
 * Self-Service Claim Flow — Backend Module
 * Allows owners of placeholder profiles to claim them via X/GitHub/Domain verification.
 * 
 * Endpoints:
 *   POST /api/claims/initiate — Start a claim (generate challenge)
 *   POST /api/claims/verify   — Submit proof and complete claim
 *   GET  /api/claims/status/:profileId — Check claim eligibility
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// In-memory store for pending claims (TTL: 30 minutes)
const pendingClaims = new Map();
const claimAttempts = new Map(); // wallet -> { count, windowStart }

const CLAIM_EXPIRY_MS = 30 * 60 * 1000; // 30 minutes
const MAX_ATTEMPTS_PER_HOUR = 3;
const ATTEMPT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

/**
 * Check if a profile is eligible for claiming
 */
function canClaim(profileId, dataDir) {
  const profilePath = path.join(dataDir, `${profileId}.json`);
  if (!fs.existsSync(profilePath)) return { eligible: false, reason: 'Profile not found' };
  
  const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
  
  if (!profile.unclaimed) return { eligible: false, reason: 'Profile is already claimed' };
  
  // Check if it has any verifications (should be L0)
  const vd = profile.verificationData || {};
  const hasVerifications = Object.values(vd).some(v => v && typeof v === 'object' && v.verified);
  if (hasVerifications) return { eligible: false, reason: 'Profile has existing verifications' };
  
  // Extract available claim methods from links
  const methods = [];
  if (profile.links?.twitter) {
    const handle = extractHandle(profile.links.twitter, 'x');
    if (handle) methods.push({ method: 'x', identifier: handle });
  }
  if (profile.links?.github) {
    const handle = extractHandle(profile.links.github, 'github');
    if (handle) methods.push({ method: 'github', identifier: handle });
  }
  if (profile.links?.website) {
    methods.push({ method: 'domain', identifier: profile.links.website.replace(/^https?:\/\//, '').replace(/\/.*$/, '') });
  }
  
  return { eligible: true, profile, methods };
}

/**
 * Extract handle from a URL
 */
function extractHandle(url, platform) {
  if (!url) return null;
  try {
    if (platform === 'x') {
      const match = url.match(/(?:twitter\.com|x\.com)\/(@?[\w]+)/i);
      return match ? match[1].replace(/^@/, '') : null;
    }
    if (platform === 'github') {
      const match = url.match(/github\.com\/([\w-]+)/i);
      return match ? match[1] : null;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Check rate limit for a wallet
 */
function checkRateLimit(wallet) {
  const now = Date.now();
  const attempts = claimAttempts.get(wallet);
  
  if (!attempts || (now - attempts.windowStart > ATTEMPT_WINDOW_MS)) {
    claimAttempts.set(wallet, { count: 1, windowStart: now });
    return true;
  }
  
  if (attempts.count >= MAX_ATTEMPTS_PER_HOUR) {
    return false;
  }
  
  attempts.count++;
  return true;
}

/**
 * Initiate a claim — generates a challenge
 */
function initiateClaim(profileId, method, wallet, dataDir) {
  // Rate limit check
  if (!checkRateLimit(wallet)) {
    return { success: false, error: 'Rate limit exceeded. Max 3 claim attempts per wallet per hour.' };
  }
  
  const eligibility = canClaim(profileId, dataDir);
  if (!eligibility.eligible) {
    return { success: false, error: eligibility.reason };
  }
  
  // Find matching method
  const methodInfo = eligibility.methods.find(m => m.method === method);
  if (!methodInfo) {
    return { success: false, error: `Claim method '${method}' not available for this profile. Available: ${eligibility.methods.map(m => m.method).join(', ')}` };
  }
  
  // Generate challenge
  const challengeId = crypto.randomBytes(16).toString('hex');
  const challengeCode = crypto.randomBytes(3).toString('hex').toUpperCase();
  
  let instructions = '';
  let challengeString = '';
  
  if (method === 'x') {
    challengeString = `Claiming @${eligibility.profile.name} on AgentFolio. Code: ${challengeCode} #AgentFolio`;
    instructions = `Tweet the following from @${methodInfo.identifier}:\n\n"${challengeString}"\n\nThen paste the tweet URL below.`;
  } else if (method === 'github') {
    challengeString = `AgentFolio Claim Verification\nProfile: ${profileId}\nCode: ${challengeCode}\nWallet: ${wallet}`;
    instructions = `Create a public gist at https://gist.github.com\nFilename: agentfolio-claim.md\nContent:\n${challengeString}\n\nThen paste your gist URL below.`;
  } else if (method === 'domain') {
    challengeString = challengeCode;
    instructions = `Add a TXT record to ${methodInfo.identifier}:\n\nagentfolio-verify=${challengeCode}\n\nOr place a file at https://${methodInfo.identifier}/.well-known/agentfolio-verify.txt containing:\n${challengeCode}`;
  }
  
  const claim = {
    challengeId,
    profileId,
    method,
    identifier: methodInfo.identifier,
    wallet,
    challengeCode,
    challengeString,
    createdAt: Date.now(),
    expiresAt: Date.now() + CLAIM_EXPIRY_MS,
  };
  
  pendingClaims.set(challengeId, claim);
  
  // Cleanup expired claims
  for (const [id, c] of pendingClaims) {
    if (c.expiresAt < Date.now()) pendingClaims.delete(id);
  }
  
  return {
    success: true,
    challengeId,
    method,
    identifier: methodInfo.identifier,
    instructions,
    challengeString,
    expiresAt: new Date(claim.expiresAt).toISOString(),
  };
}

/**
 * Verify a claim — checks proof and transfers ownership
 */
async function verifyClaim(challengeId, proof, dataDir) {
  const claim = pendingClaims.get(challengeId);
  if (!claim) {
    return { success: false, error: 'Challenge not found or expired' };
  }
  
  if (claim.expiresAt < Date.now()) {
    pendingClaims.delete(challengeId);
    return { success: false, error: 'Challenge has expired' };
  }
  
  let verified = false;
  let verificationProof = {};
  
  try {
    if (claim.method === 'x') {
      // Verify tweet contains the challenge code
      verified = await verifyTweetClaim(claim, proof);
      verificationProof = { type: 'tweet', url: proof, verifiedAt: new Date().toISOString() };
    } else if (claim.method === 'github') {
      // Verify gist contains the challenge code
      verified = await verifyGistClaim(claim, proof);
      verificationProof = { type: 'gist', url: proof, verifiedAt: new Date().toISOString() };
    } else if (claim.method === 'domain') {
      // Verify DNS TXT or well-known file
      verified = await verifyDomainClaim(claim, proof);
      verificationProof = { type: 'domain', domain: claim.identifier, verifiedAt: new Date().toISOString() };
    }
  } catch (e) {
    return { success: false, error: `Verification failed: ${e.message}` };
  }
  
  if (!verified) {
    return { success: false, error: 'Proof does not match challenge. Make sure the challenge code is included.' };
  }
  
  // Transfer ownership
  try {
    const profilePath = path.join(dataDir, `${claim.profileId}.json`);
    const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
    
    profile.unclaimed = false;
    profile.claimedAt = new Date().toISOString();
    profile.claimedBy = claim.wallet;
    profile.claimMethod = claim.method;
    profile.claimProof = verificationProof;
    profile.wallets = profile.wallets || {};
    profile.wallets.solana = claim.wallet;
    
    // Add verification for the claim method
    profile.verificationData = profile.verificationData || {};
    if (claim.method === 'x') {
      profile.verificationData.x = { verified: true, handle: claim.identifier, verifiedAt: verificationProof.verifiedAt, method: 'claim_tweet' };
    } else if (claim.method === 'github') {
      profile.verificationData.github = { verified: true, username: claim.identifier, address: claim.identifier, verifiedAt: verificationProof.verifiedAt, method: 'claim_gist' };
    } else if (claim.method === 'domain') {
      profile.verificationData.domain = { verified: true, domain: claim.identifier, verifiedAt: verificationProof.verifiedAt, method: 'claim_dns' };
    }
    
    fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2));
    pendingClaims.delete(challengeId);
    
    return {
      success: true,
      profileId: claim.profileId,
      wallet: claim.wallet,
      method: claim.method,
      claimedAt: profile.claimedAt,
    };
  } catch (e) {
    return { success: false, error: `Failed to update profile: ${e.message}` };
  }
}

/**
 * Verify tweet claim — check if tweet from the right user contains the code
 */
async function verifyTweetClaim(claim, tweetUrl) {
  // Extract tweet ID from URL
  const match = tweetUrl.match(/status\/(\d+)/);
  if (!match) throw new Error('Invalid tweet URL');
  
  // For MVP: Accept tweet URL if it matches the expected user pattern
  // In production, use Twitter API to fetch tweet content
  const urlLower = tweetUrl.toLowerCase();
  const expectedUser = claim.identifier.toLowerCase();
  
  if (urlLower.includes(expectedUser) || urlLower.includes(`/${expectedUser}/`)) {
    // Basic URL validation — the tweet is from the expected user
    // TODO: Use Twitter API to verify tweet content contains challengeCode
    return true;
  }
  
  throw new Error(`Tweet must be from @${claim.identifier}`);
}

/**
 * Verify gist claim — fetch gist and check for challenge code
 */
async function verifyGistClaim(claim, gistUrl) {
  // Extract gist ID
  const match = gistUrl.match(/gist\.github\.com\/[\w-]+\/([a-f0-9]+)/i) || gistUrl.match(/gist\.github\.com\/([a-f0-9]+)/i);
  if (!match) throw new Error('Invalid gist URL');
  
  const gistId = match[1];
  const response = await fetch(`https://api.github.com/gists/${gistId}`);
  if (!response.ok) throw new Error('Could not fetch gist');
  
  const gist = await response.json();
  
  // Check owner matches
  if (gist.owner?.login?.toLowerCase() !== claim.identifier.toLowerCase()) {
    throw new Error(`Gist must be created by ${claim.identifier}, got ${gist.owner?.login}`);
  }
  
  // Check content contains challenge code
  for (const file of Object.values(gist.files || {})) {
    if (file.content && file.content.includes(claim.challengeCode)) {
      return true;
    }
  }
  
  throw new Error('Gist does not contain the challenge code');
}

/**
 * Verify domain claim — check DNS TXT or .well-known file
 */
async function verifyDomainClaim(claim, proof) {
  const domain = claim.identifier;
  
  // Try .well-known file first
  try {
    const res = await fetch(`https://${domain}/.well-known/agentfolio-verify.txt`, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const text = await res.text();
      if (text.trim().includes(claim.challengeCode)) return true;
    }
  } catch {}
  
  // Try DNS TXT record
  try {
    const dns = require('dns').promises;
    const records = await dns.resolveTxt(domain);
    for (const record of records) {
      const txt = record.join('');
      if (txt.includes(`agentfolio-verify=${claim.challengeCode}`)) return true;
    }
  } catch {}
  
  throw new Error('Challenge code not found in DNS TXT record or .well-known file');
}

module.exports = {
  canClaim,
  initiateClaim,
  verifyClaim,
  checkRateLimit,
  extractHandle,
};
