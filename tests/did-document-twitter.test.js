const { describe, it } = require('node:test');
const assert = require('node:assert');

const { generateDIDDocument } = require('../src/lib/did');

describe('DID document linked social generation', () => {
  it('uses the normalized X handle without throwing', () => {
    const doc = generateDIDDocument({
      id: 'agent_example',
      name: 'Example',
      links: { twitter: 'https://x.com/example' },
    });

    const twitterService = doc.service.find((service) => service.id.endsWith('#twitter'));
    assert.equal(twitterService.serviceEndpoint, 'https://x.com/example');
    assert.deepEqual(doc.alsoKnownAs, ['https://x.com/example']);
  });
});
