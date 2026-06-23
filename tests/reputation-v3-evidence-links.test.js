const { describe, it } = require('node:test');
const assert = require('node:assert');

const router = require('../src/routes/reputation-v3-routes');

describe('SATP V3 trust evidence links', () => {
  it('builds source-linked evidence for the trust-score API surface', () => {
    const links = router.__test.buildTrustEvidenceLinks('agent alpha/1', {
      pda: 'GenesisPda1111111111111111111111111111111',
      authority: 'Authority11111111111111111111111111111111',
    });

    assert.deepStrictEqual(links.map((link) => link.type), [
      'satp_explorer',
      'satp_genesis_resolver',
      'trust_credential',
      'solana_genesis_pda',
      'solana_authority',
    ]);

    assert.strictEqual(links[0].href, '/satp/explorer?agent=agent%20alpha%2F1');
    assert.strictEqual(links[1].href, '/api/satp/v3/resolve/agent%20alpha%2F1');
    assert.strictEqual(links[2].href, '/api/trust-credential/agent%20alpha%2F1');
    assert.strictEqual(links[3].source, 'solana');
    assert.match(links[3].href, /GenesisPda1111111111111111111111111111111$/);
    assert.match(links[4].href, /Authority11111111111111111111111111111111$/);
  });

  it('omits Solana links when the SDK record has no PDA or authority', () => {
    const links = router.__test.buildTrustEvidenceLinks('agent_beta', {});

    assert.deepStrictEqual(links.map((link) => link.type), [
      'satp_explorer',
      'satp_genesis_resolver',
      'trust_credential',
    ]);
  });
});
