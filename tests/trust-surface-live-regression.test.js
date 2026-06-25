const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

describe('trust surface live regression guard', () => {
  it('serves well-known agent metadata from the backend surface', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../src/server.js'), 'utf8');

    assert.match(source, /app\.get\('\/.well-known\/agentfolio\.json'/);
    assert.match(source, /app\.get\('\/.well-known\/agent\.json'/);
    assert.match(source, /public', '\.well-known', filename/);
    assert.match(source, /frontend', 'public', '\.well-known', filename/);
    assert.match(source, /Cache-Control', 'public, max-age=300'/);
    assert.match(source, /dotfiles: 'allow'/);
  });

  it('keeps SATP V3 resolve independent of the RPC-backed SDK client', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../src/routes/satp-api.js'), 'utf8');
    const routeStart = source.indexOf("app.get('/api/satp/v3/resolve/:agentId'");
    const routeEnd = source.indexOf('// ═══ V3 NAME REGISTRY', routeStart);
    const route = source.slice(routeStart, routeEnd);

    assert.notStrictEqual(routeStart, -1, 'expected SATP V3 resolve route');
    assert.ok(route.includes('if (!getGenesisPDA)'));
    assert.ok(!route.includes('if (!satpV3Client)'), 'PDA derivation should not require the RPC client');
    assert.ok(route.includes("|| 'devnet'"), 'resolver must default to the configured V3 program network');
    assert.ok(route.includes('const [pda] = getGenesisPDA(req.params.agentId, network);'));
  });
});
