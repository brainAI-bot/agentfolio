const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

describe('SATP explorer client profile matching', () => {
  it('matches profiles by profileId before wallet and only applies wallet score enrichment when profileIds match', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../frontend/src/app/satp/explorer/SATPExplorerClient.tsx'),
      'utf8'
    );

    assert.match(
      source,
      /const profile = \(agentProfileId \? profilesById\[agentProfileId\] : null\) \|\| profilesByWallet\[wallet\] \|\| null;/
    );
    assert.match(
      source,
      /const scoreMatchesProfile = Boolean\(scoreProfileId && profileId && scoreProfileId === profileId\);/
    );
    assert.match(
      source,
      /scoreMatchesProfile \? \(scores\?\.data\?\.tier \?\? scores\?\.tier\) : null/
    );
    assert.match(
      source,
      /scoreMatchesProfile \? \(scores\?\.data\?\.verificationLevel \?\? scores\?\.verificationLevel\) : null/
    );
  });
});
