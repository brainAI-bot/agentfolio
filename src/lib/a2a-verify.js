/**
 * A2A Agent Card Verification Module
 * Verifies agent ownership via .well-known/agent.json
 */

const TIMEOUT_MS = 10000;

/**
 * Verify A2A agent card by checking .well-known/agent.json
 */
async function verifyA2aAgentCard(agentUrl, expectedProfileId) {
  try {
    // Normalize URL
    const url = new URL(agentUrl);
    const baseUrl = `${url.protocol}//${url.host}`;
    const agentJsonUrl = `${baseUrl}/.well-known/agent.json`;

    const res = await fetch(agentJsonUrl, {
      headers: { 
        'Accept': 'application/json', 
        'User-Agent': 'AgentFolio-A2A-Verify/1.0' 
      },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });

    if (!res.ok) {
      return {
        verified: false,
        error: `Failed to fetch .well-known/agent.json: HTTP ${res.status}`,
        url: agentUrl
      };
    }

    const agentCard = await res.json();

    // Validate agent.json structure
    if (!agentCard.id) {
      return {
        verified: false,
        error: 'agent.json missing required "id" field',
        url: agentUrl
      };
    }

    // Check if profileId matches
    if (agentCard.agentfolio !== expectedProfileId && agentCard.id !== expectedProfileId) {
      return {
        verified: false,
        error: `ProfileId mismatch: agent.json has "${agentCard.agentfolio || agentCard.id}", expected "${expectedProfileId}"`,
        url: agentUrl,
        agentCard
      };
    }

    return {
      verified: true,
      url: agentUrl,
      profileId: expectedProfileId,
      agentName: agentCard.name || agentCard.id,
      agentCard,
      message: 'A2A agent card verified successfully'
    };

  } catch (error) {
    return {
      verified: false,
      error: `Failed to verify: ${error.message}`,
      url: agentUrl
    };
  }
}

module.exports = {
  verifyA2aAgentCard
};