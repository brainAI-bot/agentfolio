const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

describe('SATP explorer client level mapping', () => {
  it('prefers fetched score endpoint tier and verification level before lower-fidelity SATP card fields', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../frontend/src/app/satp/explorer/SATPExplorerClient.tsx'),
      'utf8'
    );

    assert.match(
      source,
      /tier:\s*\(scores\?\.data\?\.tier\s*\?\?\s*scores\?\.tier\s*\?\?\s*agent\.tier/
    );
    assert.match(
      source,
      /verificationLevel:\s*scores\?\.data\?\.verificationLevel\s*\?\?\s*scores\?\.verificationLevel\s*\?\?\s*agent\.verificationLevel/
    );
  });
});
