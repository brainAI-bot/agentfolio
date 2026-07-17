const assert = require('node:assert/strict');
const test = require('node:test');

const {
  AGENTFOLIO_CORS_ORIGINS,
  getCanonicalAgentFolioHost,
  normalizeAgentFolioAliasPath,
} = require('../src/lib/alias-routing');

test('normalizes brainai AgentFolio API alias paths to canonical API routes', () => {
  assert.equal(normalizeAgentFolioAliasPath('/agentfolio/api'), '/api');
  assert.equal(normalizeAgentFolioAliasPath('/agentfolio/api/health'), '/api/health');
  assert.equal(
    normalizeAgentFolioAliasPath('/agentfolio/api/profile/agent_brainkid?format=json'),
    '/api/profile/agent_brainkid?format=json',
  );
  assert.equal(normalizeAgentFolioAliasPath('/agentfolio/profile/agent_brainkid'), null);
});

test('canonicalizes approved alias hosts to agentfolio.bot', () => {
  assert.equal(getCanonicalAgentFolioHost('agentfolio.com'), 'agentfolio.bot');
  assert.equal(getCanonicalAgentFolioHost('www.agentfolio.com'), 'agentfolio.bot');
  assert.equal(getCanonicalAgentFolioHost('brainai.bot'), 'agentfolio.bot');
  assert.equal(getCanonicalAgentFolioHost('agentfolio.bot'), 'agentfolio.bot');
});

test('allows approved alias origins for production CORS', () => {
  for (const origin of [
    'https://agentfolio.bot',
    'https://agentfolio.com',
    'https://www.agentfolio.com',
    'https://brainai.bot',
    'https://www.brainai.bot',
  ]) {
    assert.ok(AGENTFOLIO_CORS_ORIGINS.includes(origin), `${origin} missing from CORS allowlist`);
  }
});
