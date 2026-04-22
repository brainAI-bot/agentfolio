const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

describe('well-known agent metadata parity', () => {
  it('ships the public A2A agent card and MCP endpoint on the live /mcp/sse path', () => {
    const agentJson = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '../frontend/public/.well-known/agent.json'), 'utf8')
    );
    const agentfolioJson = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '../frontend/public/.well-known/agentfolio.json'), 'utf8')
    );

    assert.strictEqual(agentJson.url, 'https://agentfolio.bot/mcp/sse');
    assert.strictEqual(agentfolioJson.mcpEndpoint, 'https://agentfolio.bot/mcp/sse');
    assert.strictEqual(agentJson.id, 'agentfolio-a2a-smoke');
  });
});
