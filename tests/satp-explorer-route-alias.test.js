const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

describe('SATP explorer route alias wiring', () => {
  it('uses the canonical SATP explorer shaper instead of proxying to /api/explorer/agents', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../src/server.js'), 'utf8');

    assert.match(source, /app\.get\('\/api\/satp\/explorer\/agents',[\s\S]*getSatpAgents\(\)/);
    assert.doesNotMatch(source, /app\.get\('\/api\/satp\/explorer\/agents',[\s\S]*fetch\('http:\/\/localhost:3333\/api\/explorer\/agents'\)/);
    assert.match(source, /app\.get\('\/api\/satp\/explorer',[\s\S]*'\/api\/satp\/explorer\/agents'/);
  });
});
