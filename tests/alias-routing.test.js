const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  AGENTFOLIO_CORS_ORIGINS,
  agentFolioAliasRoutingMiddleware,
  getCanonicalAgentFolioHost,
  normalizeAgentFolioAliasPath,
} = require('../src/lib/alias-routing');

const caddyAliasFragmentPath = path.join(
  __dirname,
  '..',
  'ops',
  'caddy',
  'brainai-agentfolio-api-alias.caddy',
);

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

test('rewrites the exact brainai API alias path and strips forwarded credentials', () => {
  const req = {
    headers: {
      host: 'brainai.bot',
      authorization: 'Bearer user-token',
      cookie: 'session=abc',
    },
    originalUrl: '/agentfolio/api',
    url: '/agentfolio/api',
  };
  const headers = {};
  const res = {
    setHeader(name, value) {
      headers[name] = value;
    },
  };

  agentFolioAliasRoutingMiddleware(req, res, () => {});

  assert.equal(req.url, '/api');
  assert.equal(req.headers.authorization, undefined);
  assert.equal(req.headers.cookie, undefined);
  assert.equal(req.agentfolioAlias.canonicalUrl, '/api');
  assert.deepEqual(req.agentfolioAlias.strippedHeaders, ['authorization', 'cookie']);
  assert.equal(headers['X-AgentFolio-Alias-Route'], 'brainai.agentfolio-api');
});

test('Caddy alias matcher covers exact and nested API aliases only', () => {
  const fragment = fs.readFileSync(caddyAliasFragmentPath, 'utf8');
  const matcherLine = fragment
    .split(/\r?\n/)
    .find((line) => line.trim().startsWith('@agentfolioApiAlias path '));

  assert.ok(matcherLine, 'missing agentfolio Caddy alias matcher');
  const [, ...patterns] = matcherLine.trim().split(/\s+/).slice(1);

  assert.deepEqual(patterns, ['/agentfolio/api', '/agentfolio/api/*']);
  assert.ok(patterns.includes('/agentfolio/api'));
  assert.ok(patterns.includes('/agentfolio/api/*'));
  assert.equal(patterns.includes('/agentfolio/apix'), false);
  assert.match(fragment, /handle @agentfolioApiAlias \{/);
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

test('strips forwarded credentials when Caddy already stripped the /agentfolio prefix', () => {
  const req = {
    headers: {
      host: 'brainai.bot',
      authorization: 'Bearer user-token',
      cookie: 'session=abc',
      accept: 'application/json',
    },
    originalUrl: '/api/alias/header-proof',
    url: '/api/alias/header-proof',
  };
  const headers = {};
  const res = {
    setHeader(name, value) {
      headers[name] = value;
    },
  };

  agentFolioAliasRoutingMiddleware(req, res, () => {});

  assert.equal(req.url, '/api/alias/header-proof');
  assert.equal(req.headers.authorization, undefined);
  assert.equal(req.headers.cookie, undefined);
  assert.equal(req.headers.accept, 'application/json');
  assert.equal(req.agentfolioAlias.source, 'proxy-stripped-prefix');
  assert.deepEqual(req.agentfolioAlias.strippedHeaders, ['authorization', 'cookie']);
  assert.equal(headers['X-AgentFolio-Alias-Route'], 'brainai.agentfolio-api.proxy-stripped');
});
