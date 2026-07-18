const assert = require('node:assert/strict');
const test = require('node:test');

const {
  AGENTFOLIO_CORS_ORIGINS,
  agentFolioAliasRoutingMiddleware,
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
  assert.equal(getCanonicalAgentFolioHost('brainai.bot'), 'agentfolio.bot');
  assert.equal(getCanonicalAgentFolioHost('agentfolio.bot'), 'agentfolio.bot');
});

test('allows approved alias origins for production CORS', () => {
  for (const origin of [
    'https://agentfolio.bot',
    'https://brainai.bot',
  ]) {
    assert.ok(AGENTFOLIO_CORS_ORIGINS.includes(origin), `${origin} missing from CORS allowlist`);
  }
});

test('rewrites only brainai host alias requests and strips forwarded credentials', () => {
  const req = {
    headers: {
      host: 'brainai.bot',
      authorization: 'Bearer user-token',
      cookie: 'session=abc',
      accept: 'application/json',
    },
    originalUrl: '/agentfolio/api/profile/agent_brainkid?format=json',
    url: '/agentfolio/api/profile/agent_brainkid?format=json',
  };
  const headers = {};
  const res = {
    setHeader(name, value) {
      headers[name] = value;
    },
  };

  agentFolioAliasRoutingMiddleware(req, res, () => {});

  assert.equal(req.url, '/api/profile/agent_brainkid?format=json');
  assert.equal(req.headers.authorization, undefined);
  assert.equal(req.headers.cookie, undefined);
  assert.equal(req.headers.accept, 'application/json');
  assert.deepEqual(req.agentfolioAlias.strippedHeaders, ['authorization', 'cookie']);
  assert.equal(headers['X-AgentFolio-Alias-Route'], 'brainai.agentfolio-api');
});

test('does not rewrite canonical host requests with the same path', () => {
  const req = {
    headers: { host: 'agentfolio.bot', authorization: 'Bearer canonical-token' },
    url: '/agentfolio/api/profile/agent_brainkid',
  };
  const res = { setHeader() {} };

  agentFolioAliasRoutingMiddleware(req, res, () => {});

  assert.equal(req.url, '/agentfolio/api/profile/agent_brainkid');
  assert.equal(req.headers.authorization, 'Bearer canonical-token');
  assert.equal(req.agentfolioAlias, undefined);
});
