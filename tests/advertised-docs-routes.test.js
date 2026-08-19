const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

describe('advertised docs routes', () => {
  it('serves or redirects the previously-404 docs URLs', () => {
    const serverSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');
    assert.match(serverSource, /app\.get\('\/docs\/api'/);
    assert.match(serverSource, /app\.get\('\/api\/docs'/);
    assert.match(serverSource, /app\.get\('\/docs\/satp'/);
    assert.match(serverSource, /app\.get\('\/satp\/docs'/);
    assert.match(serverSource, /app\.get\('\/api\/x402\/info'/);
    assert.match(serverSource, /app\.get\('\/openapi\.json'/);
    const nextConfig = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'next.config.ts'), 'utf8');
    assert.match(nextConfig, /source: '\/docs\/api'/);
    assert.match(nextConfig, /source: '\/openapi\.json'/);
  });
});
