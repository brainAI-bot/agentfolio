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

  it('rejects URLs that only contain x.com in the path', () => {
    const doc = generateDIDDocument({
      id: 'agent_example',
      name: 'Example',
      links: { twitter: 'https://example.test/https://x.com/example' },
    });

    const twitterService = doc.service.find((service) => service.id.endsWith('#twitter'));
    assert.equal(twitterService, undefined);
    assert.equal(doc.alsoKnownAs, undefined);
  });
});
