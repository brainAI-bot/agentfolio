const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

describe('DID route contract regression guard', () => {
  it('mounts read-only DID resolve, directory, and method endpoints', () => {
    const serverPath = path.resolve(__dirname, '../src/server.js');
    const source = fs.readFileSync(serverPath, 'utf8');

    assert.ok(source.includes("app.get('/api/did/resolve', didDirectoryLimiter"));
    assert.ok(source.includes('await resolveDID(did, loadDidProfile, getRequestBaseUrl(req))'));
    assert.ok(source.includes("app.get('/api/did/directory', didDirectoryLimiter"));
    assert.ok(source.includes('didDocument: `${baseUrl}/api/did/resolve?did=${encodeURIComponent(createDID(profile.id))}`'));
    assert.ok(source.includes("app.get('/api/did/method'"));
  });
});
