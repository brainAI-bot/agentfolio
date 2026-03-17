/**
 * A2A (Agent-to-Agent) Verification Module
 * Verifies an agent exposes a valid /.well-known/agent.json (Google A2A spec).
 * 
 * Flow:
 * 1. Agent provides their base URL
 * 2. We fetch /.well-known/agent.json
 * 3. Validate it's a valid A2A agent card
 * 4. Check that the agent card references the AgentFolio profile ID
 */
const crypto = require('crypto');

const challenges = new Map();
const CHALLENGE_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Initiate A2A verification.
 * Agent must have a valid /.well-known/agent.json with agentfolio reference.
 */
async function initiateA2AVerification(profileId, agentUrl) {
  const clean = agentUrl.trim().replace(/\/+$/, '');
  if (!clean.startsWith('http://') && !clean.startsWith('https://')) {
    throw new Error('Agent URL must start with http:// or https://');
  }

  const challengeId = crypto.randomUUID();
  const expectedRef = `agentfolio:${profileId}`;

  challenges.set(challengeId, {
    profileId,
    agentUrl: clean,
    expectedRef,
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
    agentUrl: clean,
    wellKnownUrl: `${clean}/.well-known/agent.json`,
    expectedRef,
    instructions: [
      `Ensure your A2A agent card is at: ${clean}/.well-known/agent.json`,
      ``,
      `Required: valid agent.json with at minimum:`,
      `  - "name": your agent name`,
      `  - "url": your agent endpoint`,
      `  - "version": agent protocol version`,
      ``,
      `For ownership verification, add one of:`,
      `  - "agentfolio": "${profileId}" in the root object`,
      `  - "${expectedRef}" in the description field`,
      ``,
      `Then click "Verify".`,
    ].join('\n'),
    expiresIn: '1 hour',
  };
}

/**
 * Verify A2A challenge by fetching and validating /.well-known/agent.json
 */
async function verifyA2AChallenge(challengeId) {
  const ch = challenges.get(challengeId);
  if (!ch) throw new Error('Challenge not found or expired');
  if (Date.now() - ch.createdAt > CHALLENGE_TTL_MS) {
    challenges.delete(challengeId);
    throw new Error('Challenge expired');
  }

  const wellKnownUrl = `${ch.agentUrl}/.well-known/agent.json`;
  let agentCard = null;

  try {
    const res = await fetch(wellKnownUrl, {
      headers: {
        'User-Agent': 'AgentFolio-Verification/1.0',
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      return {
        verified: false,
        error: `Failed to fetch ${wellKnownUrl}: HTTP ${res.status}`,
      };
    }

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('json') && !contentType.includes('text')) {
      return {
        verified: false,
        error: `${wellKnownUrl} returned non-JSON content type: ${contentType}`,
      };
    }

    agentCard = await res.json();
  } catch (e) {
    if (e.name === 'TimeoutError' || e.name === 'AbortError') {
      return { verified: false, error: `Fetch timed out for ${wellKnownUrl}` };
    }
    return { verified: false, error: `Failed to fetch/parse agent.json: ${e.message}` };
  }

  // Validate A2A agent card structure
  if (!agentCard || typeof agentCard !== 'object') {
    return { verified: false, error: 'agent.json is not a valid JSON object' };
  }

  // Must have at least a name
  if (!agentCard.name) {
    return { verified: false, error: 'agent.json missing required "name" field' };
  }

  // Check for AgentFolio ownership reference
  const cardStr = JSON.stringify(agentCard);
  const hasRef = 
    agentCard.agentfolio === ch.profileId ||
    cardStr.includes(ch.expectedRef) ||
    cardStr.includes(`"agentfolio":"${ch.profileId}"`) ||
    cardStr.includes(`"agentfolio": "${ch.profileId}"`);

  if (!hasRef) {
    return {
      verified: false,
      validAgentCard: true,
      agentName: agentCard.name,
      error: `Valid agent.json found, but ownership proof "${ch.expectedRef}" not found. Add "agentfolio": "${ch.profileId}" to your agent.json.`,
    };
  }

  ch.verified = true;

  // Save verification
  try {
    const profileStore = require('./profile-store');
    profileStore.addVerification(ch.profileId, 'a2a', ch.agentUrl, {
      challengeId,
      agentUrl: ch.agentUrl,
      wellKnownUrl,
      agentName: agentCard.name,
      agentVersion: agentCard.version,
      method: 'well-known-agent-json',
      verifiedAt: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[A2AVerify] Failed to save:', e.message);
  }

  challenges.delete(challengeId);

  return {
    verified: true,
    platform: 'a2a',
    identifier: ch.agentUrl,
    profileId: ch.profileId,
    agentCard: {
      name: agentCard.name,
      url: agentCard.url,
      version: agentCard.version,
      description: agentCard.description,
    },
  };
}

function getA2AVerificationStatus(challengeId) {
  const ch = challenges.get(challengeId);
  if (!ch) return { found: false };
  return {
    found: true,
    verified: ch.verified,
    agentUrl: ch.agentUrl,
    expiresAt: new Date(ch.createdAt + CHALLENGE_TTL_MS).toISOString(),
  };
}

module.exports = {
  initiateA2AVerification,
  verifyA2AChallenge,
  getA2AVerificationStatus,
};
