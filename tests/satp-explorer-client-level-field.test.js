const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

describe('SATP explorer client level mapping', () => {
  it('uses the already-enriched explorer payload for tier and verification level', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../frontend/src/app/satp/explorer/SATPExplorerClient.tsx'),
      'utf8'
    );

    assert.match(
      source,
      /tier:\s*\(agent\.tier \?\? agent\.levelName \?\? agent\.verificationLabel \?\? "unverified"\)\.toLowerCase\(\)/
    );
    assert.match(
      source,
      /verificationLevel:\s*agent\.verificationLevel \?\? agent\.level \?\? 0/
    );
  });
});
