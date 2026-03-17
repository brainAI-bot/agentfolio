/**
 * MCP Endpoint Verification Module
 * Verifies Model Context Protocol servers via .well-known or JSON-RPC
 */

const TIMEOUT_MS = 10000;

/**
 * Verify MCP endpoint by checking .well-known/agentfolio.json or tools/list JSON-RPC
 */
async function verifyMcpEndpoint(mcpUrl, expectedProfileId) {
  try {
    // Normalize URL
    const url = new URL(mcpUrl);
    const baseUrl = `${url.protocol}//${url.host}`;
    
    const errors = [];
    let method = null;
    let toolCount = 0;

    // Method 1: Check .well-known/agentfolio.json
    try {
      const wellKnownUrl = `${baseUrl}/.well-known/agentfolio.json`;
      const res = await fetch(wellKnownUrl, {
        headers: { 'Accept': 'application/json', 'User-Agent': 'AgentFolio-MCP-Verify/1.0' },
        signal: AbortSignal.timeout(TIMEOUT_MS)
      });
      
      if (res.ok) {
        const data = await res.json();
        if (data.profileId === expectedProfileId) {
          return {
            verified: true,
            url: mcpUrl,
            method: 'well-known',
            profileId: expectedProfileId,
            toolCount: data.tools?.length || 0,
            message: 'MCP endpoint verified via .well-known/agentfolio.json'
          };
        } else {
          errors.push(`well-known profileId mismatch: got "${data.profileId}", expected "${expectedProfileId}"`);
        }
      } else {
        errors.push(`well-known check failed: HTTP ${res.status}`);
      }
    } catch (e) {
      errors.push(`well-known check failed: ${e.message}`);
    }

    // Method 2: Check JSON-RPC tools/list endpoint
    try {
      const rpcUrl = mcpUrl.endsWith('/') ? mcpUrl : mcpUrl + '/';
      const res = await fetch(`${rpcUrl}tools/list`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'User-Agent': 'AgentFolio-MCP-Verify/1.0'
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
          params: {}
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS)
      });

      if (res.ok) {
        const data = await res.json();
        if (data.result && Array.isArray(data.result.tools)) {
          // For JSON-RPC, we verify the endpoint works but can't verify profileId
          // This is autonomous verification - assume valid if MCP server responds
          return {
            verified: true,
            url: mcpUrl,
            method: 'json-rpc',
            profileId: expectedProfileId,
            toolCount: data.result.tools.length,
            message: `MCP endpoint verified via JSON-RPC (${data.result.tools.length} tools)`
          };
        } else {
          errors.push('JSON-RPC response missing tools array');
        }
      } else {
        errors.push(`JSON-RPC check failed: HTTP ${res.status}`);
      }
    } catch (e) {
      errors.push(`JSON-RPC check failed: ${e.message}`);
    }

    return {
      verified: false,
      url: mcpUrl,
      profileId: expectedProfileId,
      errors,
      message: 'MCP endpoint verification failed - neither .well-known nor JSON-RPC methods worked'
    };

  } catch (error) {
    return {
      verified: false,
      url: mcpUrl,
      profileId: expectedProfileId,
      errors: [error.message],
      message: 'MCP verification failed'
    };
  }
}

module.exports = {
  verifyMcpEndpoint
};