const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

describe('public metadata parity', () => {
  it('ships crawler metadata routes and well-known MCP metadata on live paths', () => {
    const agentJson = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '../frontend/public/.well-known/agent.json'), 'utf8')
    );
    const agentfolioJson = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '../frontend/public/.well-known/agentfolio.json'), 'utf8')
    );
    const robotsSource = fs.readFileSync(
      path.resolve(__dirname, '../frontend/src/app/robots.ts'),
      'utf8'
    );
    const sitemapSource = fs.readFileSync(
      path.resolve(__dirname, '../frontend/src/app/sitemap.ts'),
      'utf8'
    );

    assert.strictEqual(agentJson.url, 'https://agentfolio.bot/mcp/sse');
    assert.strictEqual(agentfolioJson.mcpEndpoint, 'https://agentfolio.bot/mcp/sse');
    assert.match(robotsSource, /sitemap:\s*'https:\/\/agentfolio\.bot\/sitemap\.xml'/);
    assert.match(sitemapSource, /const BASE_URL = 'https:\/\/agentfolio\.bot';/);
    assert.match(sitemapSource, /\$\{BASE_URL\}\/import\/github/);
  });
});
