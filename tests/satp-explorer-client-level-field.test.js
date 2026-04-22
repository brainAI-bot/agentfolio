const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

describe('SATP explorer client level mapping', () => {
  it('only applies fetched score endpoint tier and verification level when the returned profile matches the card profile', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../frontend/src/app/satp/explorer/SATPExplorerClient.tsx'),
      'utf8'
    );

    assert.match(
      source,
      /tier:\s*\(\(scoreMatchesProfile \? \(scores\?\.data\?\.tier \?\? scores\?\.tier\) : null\) \?\? agent\.tier/
    );
    assert.match(
      source,
      /verificationLevel:\s*\(scoreMatchesProfile \? \(scores\?\.data\?\.verificationLevel \?\? scores\?\.verificationLevel\) : null\) \?\? agent\.verificationLevel/
    );
  });
});
