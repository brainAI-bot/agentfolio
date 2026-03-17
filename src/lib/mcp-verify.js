/**
 * MCP Endpoint Verification
 * Verifies that an agent has a working MCP server by checking for .well-known/agentfolio.json
 * or by sending a JSON-RPC tools/list request
 */

const VERIFY_TIMEOUT = 10000; // 10 seconds

/**
 * Verify an MCP endpoint belongs to a profile
 * Strategy 1: Check {url}/.well-known/agentfolio.json for { profileId }
 * Strategy 2: Send JSON-RPC tools/list and check response is valid MCP
 */
async function verifyMcpEndpoint(mcpUrl, profileId) {
  // Normalize URL
  let baseUrl = mcpUrl.replace(/\/+$/, '');
  if (!baseUrl.startsWith('http')) baseUrl = 'https://' + baseUrl;

  const errors = [];

  // Strategy 1: .well-known verification file
  try {
    const wellKnownUrl = `${baseUrl}/.well-known/agentfolio.json`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), VERIFY_TIMEOUT);

    const res = await fetch(wellKnownUrl, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json', 'User-Agent': 'AgentFolio-Verify/1.0' }
    });
    clearTimeout(timeout);

    if (res.ok) {
      const data = await res.json();
      if (data.profileId === profileId || data.agentfolio_id === profileId) {
        return {
          verified: true,
          method: 'well-known',
          url: baseUrl,
          profileId,
          details: { endpoint: wellKnownUrl, response: data }
        };
      }
      errors.push(`well-known file found but profileId mismatch: expected ${profileId}, got ${data.profileId || data.agentfolio_id || 'none'}`);
    }
  } catch (e) {
    errors.push(`well-known check failed: ${e.message}`);
  }

  // Strategy 2: JSON-RPC tools/list
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), VERIFY_TIMEOUT);

    const res = await fetch(baseUrl, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'AgentFolio-Verify/1.0' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {}
      })
    });
    clearTimeout(timeout);

    if (res.ok) {
      const data = await res.json();
      // Valid MCP response has result.tools array
      if (data.result && Array.isArray(data.result.tools)) {
        // Check if any tool mentions agentfolio verification
        const hasVerifyTool = data.result.tools.some(t =>
          t.name === 'agentfolio_verify' ||
          (t.description && t.description.includes(profileId))
        );

        return {
          verified: true,
          method: hasVerifyTool ? 'mcp-verify-tool' : 'mcp-tools-list',
          url: baseUrl,
          profileId,
          toolCount: data.result.tools.length,
          hasVerifyTool,
          details: {
            toolNames: data.result.tools.slice(0, 10).map(t => t.name),
            totalTools: data.result.tools.length
          }
        };
      }
      errors.push('JSON-RPC response missing result.tools array');
    }
  } catch (e) {
    errors.push(`JSON-RPC check failed: ${e.message}`);
  }

  return {
    verified: false,
    url: baseUrl,
    profileId,
    errors
  };
}

module.exports = { verifyMcpEndpoint };
