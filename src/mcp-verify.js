/**
 * MCP (Model Context Protocol) Verification Module
 * Verifies an agent exposes an MCP endpoint with a challenge/response flow.
 * 
 * Flow:
 * 1. Agent provides their MCP endpoint URL
 * 2. We send a challenge token via MCP tools/list or a custom verification tool
 * 3. The MCP server must respond with the expected token
 */
const crypto = require('crypto');

const challenges = new Map();
const CHALLENGE_TTL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Initiate MCP verification.
 * Generates a challenge and instructs the agent to expose it via their MCP endpoint.
 */
async function initiateMCPVerification(profileId, mcpUrl) {
  const clean = mcpUrl.trim().replace(/\/+$/, '');
  if (!clean.startsWith('http://') && !clean.startsWith('https://')) {
    throw new Error('MCP URL must start with http:// or https://');
  }

  const challengeId = crypto.randomUUID();
  const challengeToken = `agentfolio-mcp-verify:${crypto.randomBytes(12).toString('hex')}`;

  challenges.set(challengeId, {
    profileId,
    mcpUrl: clean,
    challengeToken,
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
    mcpUrl: clean,
    challengeToken,
    instructions: [
      `To verify your MCP endpoint, do ONE of the following:`,
      ``,
      `Option A: Add a tool named "agentfolio_verify" that returns "${challengeToken}" when called`,
      `Option B: Serve the token at ${clean}/agentfolio-verify (GET → plain text response)`,
      `Option C: Add "${challengeToken}" to your MCP server description/metadata`,
      ``,
      `Then click "Verify".`,
    ].join('\n'),
    expiresIn: '30 minutes',
  };
}

/**
 * Verify MCP challenge by probing the MCP endpoint.
 */
async function verifyMCPChallenge(challengeId) {
  const ch = challenges.get(challengeId);
  if (!ch) throw new Error('Challenge not found or expired');
  if (Date.now() - ch.createdAt > CHALLENGE_TTL_MS) {
    challenges.delete(challengeId);
    throw new Error('Challenge expired');
  }

  let verified = false;
  let method = '';

  // Method 1: Check /agentfolio-verify endpoint
  try {
    const res = await fetch(`${ch.mcpUrl}/agentfolio-verify`, {
      headers: { 'User-Agent': 'AgentFolio-Verification/1.0' },
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) {
      const body = await res.text();
      if (body.includes(ch.challengeToken)) {
        verified = true;
        method = 'endpoint';
      }
    }
  } catch (e) {
    // Endpoint not available, try next method
  }

  // Method 2: Try MCP JSON-RPC tools/list
  if (!verified) {
    try {
      const res = await fetch(ch.mcpUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'AgentFolio-Verification/1.0',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
          params: {},
        }),
        signal: AbortSignal.timeout(10000),
      });

      if (res.ok) {
        const data = await res.json();
        const tools = data?.result?.tools || [];
        // Check if agentfolio_verify tool exists in description or response
        const verifyTool = tools.find(t => 
          t.name === 'agentfolio_verify' || 
          (t.description && t.description.includes(ch.challengeToken))
        );

        if (verifyTool) {
          // Try calling the verify tool
          const callRes = await fetch(ch.mcpUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 2,
              method: 'tools/call',
              params: { name: 'agentfolio_verify', arguments: {} },
            }),
            signal: AbortSignal.timeout(10000),
          });

          if (callRes.ok) {
            const callData = await callRes.json();
            const resultStr = JSON.stringify(callData);
            if (resultStr.includes(ch.challengeToken)) {
              verified = true;
              method = 'mcp-tool';
            }
          }
        }

        // Also check the full response for the token
        if (!verified && JSON.stringify(data).includes(ch.challengeToken)) {
          verified = true;
          method = 'mcp-metadata';
        }
      }
    } catch (e) {
      // MCP endpoint not JSON-RPC compatible, try next
    }
  }

  // Method 3: Check SSE-based MCP (newer MCP transport)
  if (!verified) {
    try {
      const res = await fetch(`${ch.mcpUrl}/sse`, {
        headers: { 'User-Agent': 'AgentFolio-Verification/1.0' },
        signal: AbortSignal.timeout(5000),
      });
      // Just check if the endpoint is alive — basic proof of MCP server
      if (res.ok || res.status === 200) {
        // For SSE, we still need the token somewhere. Check the main URL body.
        const mainRes = await fetch(ch.mcpUrl, {
          headers: { 'User-Agent': 'AgentFolio-Verification/1.0' },
          signal: AbortSignal.timeout(5000),
        });
        if (mainRes.ok) {
          const body = await mainRes.text();
          if (body.includes(ch.challengeToken)) {
            verified = true;
            method = 'mcp-sse-body';
          }
        }
      }
    } catch (e) {
      // SSE not available
    }
  }

  if (!verified) {
    return {
      verified: false,
      error: `Challenge token not found at MCP endpoint ${ch.mcpUrl}. Ensure the token "${ch.challengeToken}" is accessible via one of the verification methods.`,
    };
  }

  ch.verified = true;

  // Save verification
  try {
    const profileStore = require('./profile-store');
    profileStore.addVerification(ch.profileId, 'mcp', ch.mcpUrl, {
      challengeId,
      mcpUrl: ch.mcpUrl,
      method,
      verifiedAt: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[MCPVerify] Failed to save:', e.message);
  }

  challenges.delete(challengeId);

  return {
    verified: true,
    platform: 'mcp',
    identifier: ch.mcpUrl,
    profileId: ch.profileId,
    method,
  };
}

function getMCPVerificationStatus(challengeId) {
  const ch = challenges.get(challengeId);
  if (!ch) return { found: false };
  return {
    found: true,
    verified: ch.verified,
    mcpUrl: ch.mcpUrl,
    expiresAt: new Date(ch.createdAt + CHALLENGE_TTL_MS).toISOString(),
  };
}

module.exports = {
  initiateMCPVerification,
  verifyMCPChallenge,
  getMCPVerificationStatus,
};
