/**
 * A2A Agent Card Verification
 * Verifies that an agent has a valid /.well-known/agent.json (Google A2A protocol)
 * and that the agent card references the AgentFolio profileId
 */

const VERIFY_TIMEOUT = 10000;

/**
 * Validate A2A agent card structure
 * Minimum fields: name, description, url
 */
function isValidAgentCard(card) {
  if (!card || typeof card !== 'object') return false;
  if (!card.name || typeof card.name !== 'string') return false;
  // description and url are recommended but we'll be lenient
  return true;
}

/**
 * Extract profileId from agent card
 * Checks multiple locations:
 * - card.agentfolio_id
 * - card.extensions?.agentfolio?.profileId
 * - card.identity?.agentfolio
 * - card.metadata?.agentfolio_id
 */
function extractProfileId(card) {
  if (card.agentfolio_id) return card.agentfolio_id;
  if (card.extensions?.agentfolio?.profileId) return card.extensions.agentfolio.profileId;
  if (card.extensions?.agentfolio?.id) return card.extensions.agentfolio.id;
  if (card.identity?.agentfolio) return card.identity.agentfolio;
  if (card.metadata?.agentfolio_id) return card.metadata.agentfolio_id;
  return null;
}

/**
 * Verify an A2A agent card for a profile
 */
async function verifyA2aAgentCard(agentUrl, profileId) {
  let baseUrl = agentUrl.replace(/\/+$/, '');
  if (!baseUrl.startsWith('http')) baseUrl = 'https://' + baseUrl;

  try {
    const cardUrl = `${baseUrl}/.well-known/agent.json`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), VERIFY_TIMEOUT);

    const res = await fetch(cardUrl, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json', 'User-Agent': 'AgentFolio-Verify/1.0' }
    });
    clearTimeout(timeout);

    if (!res.ok) {
      return {
        verified: false,
        error: `Failed to fetch agent card: HTTP ${res.status}`,
        url: cardUrl
      };
    }

    let card;
    try {
      card = await res.json();
    } catch (e) {
      return { verified: false, error: 'Invalid JSON in agent card', url: cardUrl };
    }

    if (!isValidAgentCard(card)) {
      return {
        verified: false,
        error: 'Agent card missing required fields (name)',
        url: cardUrl,
        card
      };
    }

    const foundProfileId = extractProfileId(card);
    if (!foundProfileId) {
      return {
        verified: false,
        error: 'Agent card does not contain agentfolio_id. Add "agentfolio_id": "' + profileId + '" to your agent.json',
        url: cardUrl,
        cardName: card.name
      };
    }

    if (foundProfileId !== profileId) {
      return {
        verified: false,
        error: `Profile ID mismatch: expected ${profileId}, found ${foundProfileId}`,
        url: cardUrl
      };
    }

    return {
      verified: true,
      url: cardUrl,
      profileId,
      agentName: card.name,
      agentDescription: card.description || '',
      agentUrl: card.url || baseUrl,
      capabilities: card.capabilities || [],
      details: {
        name: card.name,
        description: card.description,
        version: card.version,
        skills: card.skills?.length || 0
      }
    };
  } catch (e) {
    return {
      verified: false,
      error: `Failed to verify: ${e.message}`,
      url: baseUrl
    };
  }
}

module.exports = { verifyA2aAgentCard, isValidAgentCard, extractProfileId };
