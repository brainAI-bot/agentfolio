/**
 * Domain Verification Module
 * DNS TXT record based: user adds a TXT record, we verify via DNS lookup.
 */
const crypto = require('crypto');
const dns = require('dns').promises;

const challenges = new Map();
const CHALLENGE_TTL_MS = 60 * 60 * 1000; // 1 hour (DNS propagation takes time)

async function initiateDomainVerification(profileId, domain) {
  const clean = domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim().toLowerCase();
  if (!clean || !clean.includes('.')) throw new Error('Invalid domain');

  const code = 'agentfolio-verify=' + crypto.randomBytes(8).toString('hex');
  const challengeId = crypto.randomUUID();

  challenges.set(challengeId, {
    profileId,
    domain: clean,
    code,
    createdAt: Date.now(),
    verified: false,
  });

  // Cleanup old
  for (const [id, ch] of challenges) {
    if (Date.now() - ch.createdAt > CHALLENGE_TTL_MS) challenges.delete(id);
  }

  return {
    success: true,
    challengeId,
    domain: clean,
    code,
    instructions: `Add a DNS TXT record to ${clean}:\n\nRecord: TXT\nHost: @ (or _agentfolio)\nValue: ${code}\n\nThen click "Verify" again. DNS may take up to 1 hour to propagate.`,
    expiresIn: '1 hour',
  };
}

async function verifyDomainChallenge(challengeId, method = 'auto') {
  const ch = challenges.get(challengeId);
  if (!ch) throw new Error('Challenge not found or expired');
  if (Date.now() - ch.createdAt > CHALLENGE_TTL_MS) {
    challenges.delete(challengeId);
    throw new Error('Challenge expired');
  }

  // Check DNS TXT records
  try {
    const records = await dns.resolveTxt(ch.domain);
    const flat = records.flat();
    const found = flat.some(r => r.includes(ch.code));

    if (!found) {
      // Also check _agentfolio subdomain
      try {
        const subRecords = await dns.resolveTxt(`_agentfolio.${ch.domain}`);
        const subFlat = subRecords.flat();
        if (!subFlat.some(r => r.includes(ch.code))) {
          return { verified: false, error: `TXT record not found. Make sure "${ch.code}" is set on ${ch.domain} or _agentfolio.${ch.domain}` };
        }
      } catch {
        return { verified: false, error: `TXT record not found. DNS may still be propagating.` };
      }
    }
  } catch (e) {
    return { verified: false, error: `DNS lookup failed for ${ch.domain}: ${e.code || e.message}` };
  }

  ch.verified = true;

  // Save verification
  try {
    const profileStore = require('./profile-store');
    profileStore.addVerification(ch.profileId, 'domain', ch.domain, {
      challengeId,
      domain: ch.domain,
      method: 'dns-txt',
      verifiedAt: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[DomainVerify] Failed to save:', e.message);
  }

  challenges.delete(challengeId);

  return {
    verified: true,
    platform: 'domain',
    identifier: ch.domain,
    profileId: ch.profileId,
  };
}

function getDomainVerificationStatus(challengeId) {
  const ch = challenges.get(challengeId);
  if (!ch) return { found: false };
  return {
    found: true,
    verified: ch.verified,
    domain: ch.domain,
    expiresAt: new Date(ch.createdAt + CHALLENGE_TTL_MS).toISOString(),
  };
}

module.exports = {
  initiateDomainVerification,
  verifyDomainChallenge,
  getDomainVerificationStatus,
};
