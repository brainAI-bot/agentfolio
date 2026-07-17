const CANONICAL_AGENTFOLIO_HOST = 'agentfolio.bot';
const AGENTFOLIO_ALIAS_HOSTS = new Set([
  'agentfolio.com',
  'www.agentfolio.com',
  'brainai.bot',
  'www.brainai.bot',
]);

const AGENTFOLIO_CORS_ORIGINS = [
  'https://agentfolio.bot',
  'https://www.agentfolio.bot',
  'https://agentfolio.com',
  'https://www.agentfolio.com',
  'https://brainai.bot',
  'https://www.brainai.bot',
];

const BRAINI_AGENTFOLIO_API_PREFIX = '/agentfolio/api';

function normalizeHost(rawHost) {
  return String(rawHost || '')
    .split(':')[0]
    .trim()
    .toLowerCase();
}

function getCanonicalAgentFolioHost(rawHost) {
  const host = normalizeHost(rawHost);
  return AGENTFOLIO_ALIAS_HOSTS.has(host) ? CANONICAL_AGENTFOLIO_HOST : host;
}

function normalizeAgentFolioAliasPath(rawUrl) {
  const value = String(rawUrl || '');
  const queryIndex = value.indexOf('?');
  const path = queryIndex === -1 ? value : value.slice(0, queryIndex);
  const query = queryIndex === -1 ? '' : value.slice(queryIndex);

  if (path === BRAINI_AGENTFOLIO_API_PREFIX) return `/api${query}`;
  if (path.startsWith(`${BRAINI_AGENTFOLIO_API_PREFIX}/`)) {
    return `/api${path.slice(BRAINI_AGENTFOLIO_API_PREFIX.length)}${query}`;
  }
  return null;
}

function agentFolioAliasRoutingMiddleware(req, res, next) {
  const normalizedUrl = normalizeAgentFolioAliasPath(req.url);
  if (normalizedUrl) {
    req.agentfolioAlias = {
      originalUrl: req.originalUrl || req.url,
      canonicalUrl: normalizedUrl,
    };
    req.url = normalizedUrl;
    res.setHeader('X-AgentFolio-Alias-Route', 'brainai.agentfolio-api');
  }
  next();
}

module.exports = {
  AGENTFOLIO_CORS_ORIGINS,
  CANONICAL_AGENTFOLIO_HOST,
  agentFolioAliasRoutingMiddleware,
  getCanonicalAgentFolioHost,
  normalizeAgentFolioAliasPath,
};
