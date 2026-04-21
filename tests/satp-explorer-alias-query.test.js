const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

describe('satp explorer alias query regression guard', () => {
  it('forwards the incoming query string to /api/explorer/agents', () => {
    const serverPath = path.resolve(__dirname, '../src/server.js');
    const source = fs.readFileSync(serverPath, 'utf8');

    assert.ok(source.includes("const query = req.url.includes('?') ? `?${req.url.split('?')[1]}` : '';"));
    assert.ok(source.includes("fetch(`http://localhost:3333/api/explorer/agents${query}`)"));
  });
});
