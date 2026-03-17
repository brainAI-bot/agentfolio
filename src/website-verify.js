/**
 * Website Verification Module
 * Verifies website ownership via .well-known/agentfolio-verification.txt token check.
 * 
 * Flow:
 * 1. Agent provides their website URL
 * 2. We generate a verification token
 * 3. Agent places it at /.well-known/agentfolio-verification.txt
 * 4. We fetch and verify the token
 */
const crypto = require('crypto');

const challenges = new Map();
const CHALLENGE_TTL_MS = 60 * 60 * 1000; // 1 hour (time to deploy the file)

/**
 * Initiate website verification.
 */
async function initiateWebsiteVerification(profileId, websiteUrl) {
  // Normalize URL — extract base domain
  let clean = websiteUrl.trim().replace(/\/+$/, '');
  if (!clean.startsWith('http://') && !clean.startsWith('https://')) {
    clean = 'https://' + clean;
  }

  // Parse to get origin only
  let origin;
  try {
    const parsed = new URL(clean);
    origin = parsed.origin; // e.g. https://example.com
  } catch (e) {
    throw new Error('Invalid website URL');
  }

  const challengeId = crypto.randomUUID();
  const verificationToken = `agentfolio-site-verify=${crypto.randomBytes(16).toString('hex')}`;

  challenges.set(challengeId, {
    profileId,
    websiteUrl: origin,
    verificationToken,
    createdAt: Date.now(),
    verified: false,
  });

  // Cleanup old
  for (const [id, ch] of challenges) {
    if (Date.now() - ch.createdAt > CHALLENGE_TTL_MS) challenges.delete(id);
  }

  const verificationUrl = `${origin}/.well-known/agentfolio-verification.txt`;

  return {
    success: true,
    challengeId,
    websiteUrl: origin,
    verificationUrl,
    verificationToken,
    instructions: [
      `Create a file at: ${verificationUrl}`,
      ``,
      `File contents (exact):`,
      verificationToken,
      ``,
      `You can also include your profile ID on a second line:`,
      `profile=${profileId}`,
      ``,
      `Then click "Verify". The file must be publicly accessible.`,
    ].join('\n'),
    expiresIn: '1 hour',
  };
}

/**
 * Verify website challenge by fetching the verification file.
 */
async function verifyWebsiteChallenge(challengeId, method = 'auto') {
  const ch = challenges.get(challengeId);
  if (!ch) throw new Error('Challenge not found or expired');
  if (Date.now() - ch.createdAt > CHALLENGE_TTL_MS) {
    challenges.delete(challengeId);
    throw new Error('Challenge expired');
  }

  const verificationUrl = `${ch.websiteUrl}/.well-known/agentfolio-verification.txt`;

  try {
    const res = await fetch(verificationUrl, {
      headers: {
        'User-Agent': 'AgentFolio-Verification/1.0',
        'Accept': 'text/plain',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      return {
        verified: false,
        error: `File not found at ${verificationUrl} (HTTP ${res.status}). Make sure the file is publicly accessible.`,
      };
    }

    const body = await res.text();

    if (!body.includes(ch.verificationToken)) {
      return {
        verified: false,
        error: `Verification token not found in ${verificationUrl}. Expected: "${ch.verificationToken}"`,
      };
    }
  } catch (e) {
    if (e.name === 'TimeoutError' || e.name === 'AbortError') {
      return { verified: false, error: `Fetch timed out for ${verificationUrl}` };
    }
    return { verified: false, error: `Failed to fetch ${verificationUrl}: ${e.message}` };
  }

  ch.verified = true;

  // Extract domain for identifier
  let domain;
  try {
    domain = new URL(ch.websiteUrl).hostname;
  } catch {
    domain = ch.websiteUrl;
  }

  // Save verification
  try {
    const profileStore = require('./profile-store');
    profileStore.addVerification(ch.profileId, 'website', domain, {
      challengeId,
      websiteUrl: ch.websiteUrl,
      method: 'well-known-txt',
      verifiedAt: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[WebsiteVerify] Failed to save:', e.message);
  }

  challenges.delete(challengeId);

  return {
    verified: true,
    platform: 'website',
    identifier: domain,
    profileId: ch.profileId,
  };
}

function getWebsiteVerificationStatus(challengeId) {
  const ch = challenges.get(challengeId);
  if (!ch) return { found: false };
  return {
    found: true,
    verified: ch.verified,
    websiteUrl: ch.websiteUrl,
    expiresAt: new Date(ch.createdAt + CHALLENGE_TTL_MS).toISOString(),
  };
}

module.exports = {
  initiateWebsiteVerification,
  verifyWebsiteChallenge,
  getWebsiteVerificationStatus,
};
