const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

describe('satp explorer alias query regression guard', () => {
  it('serves the SATP agents alias through the SATP explorer shaper', () => {
    const serverPath = path.resolve(__dirname, '../src/server.js');
    const source = fs.readFileSync(serverPath, 'utf8');

    assert.ok(source.includes("app.get('/api/satp/explorer/agents'"));
    assert.ok(source.includes("const { getSatpAgents } = require('./routes/satp-explorer-api');"));
    assert.ok(source.includes('const data = await getSatpAgents();'));
    assert.ok(source.includes('allAgents.slice(0, limit)'));
    assert.ok(!source.includes('fetch(`http://localhost:3333/api/explorer/agents${query}`)'));
  });

  it('redirects the bare SATP explorer API path to the SATP alias', () => {
    const serverPath = path.resolve(__dirname, '../src/server.js');
    const source = fs.readFileSync(serverPath, 'utf8');

    assert.ok(source.includes("app.get('/api/satp/explorer', (req, res) => {"));
    assert.ok(source.includes("res.redirect(301, '/api/satp/explorer/agents'"));
  });
});
