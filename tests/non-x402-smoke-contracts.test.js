const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

describe('non-x402 smoke contracts', () => {
  it('keeps profile-by-wallet responses compatible with wallet smoke checks', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../src/profile-store.js'), 'utf8');
    const routeStart = source.indexOf("app.get('/api/profile-by-wallet'");
    const routeEnd = source.indexOf('module.exports', routeStart);
    const route = source.slice(routeStart, routeEnd);

    assert.notStrictEqual(routeStart, -1, 'expected /api/profile-by-wallet route');
    assert.ok(route.includes('wallet: primaryWallet'), 'top-level wallet field must be returned');
    assert.ok(route.includes('walletAddress: primaryWallet'), 'top-level walletAddress alias must be returned');
    assert.ok(route.includes('wallets: parsedWallets'), 'parsed wallets object must be returned');
    assert.ok(
      route.includes('profile: { id: row.id, name: row.name, wallet: primaryWallet, wallets: parsedWallets }'),
      'nested profile must preserve wallet fields for existing clients'
    );
  });

  it('keeps /api/badge/:id.svg as an SVG response even when a profile is missing', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../src/server.js'), 'utf8');
    const routeStart = source.indexOf("app.get('/api/badge/:id.svg'");
    const routeEnd = source.indexOf('// Profile endorsements', routeStart);
    const route = source.slice(routeStart, routeEnd);

    assert.notStrictEqual(routeStart, -1, 'expected /api/badge/:id.svg route');
    assert.ok(route.includes("res.setHeader('Content-Type', 'image/svg+xml')"));
    assert.ok(route.includes("res.setHeader('Cache-Control', 'public, max-age=300')"));
    assert.ok(route.includes('<svg xmlns="http://www.w3.org/2000/svg"'));
    assert.ok(!route.includes("res.status(404)"), 'badge embeds should not fail as 404 text responses');
  });
});
