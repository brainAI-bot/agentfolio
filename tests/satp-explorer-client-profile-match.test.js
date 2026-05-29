const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

describe('SATP explorer client profile matching', () => {
  it('matches profiles by profileId before wallet and does not use wallet score enrichment for cards', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../frontend/src/app/satp/explorer/SATPExplorerClient.tsx'),
      'utf8'
    );

    assert.match(
      source,
      /const profile = \(agentProfileId \? profilesById\[agentProfileId\] : null\) \|\| profilesByWallet\[wallet\] \|\| null;/
    );
    assert.match(source, /const profileId = agentProfileId \?\? profile\?\.id \?\? null;/);
    assert.doesNotMatch(source, /scoreMatchesProfile/);
    assert.doesNotMatch(source, /scoreProfileId/);
  });
});
