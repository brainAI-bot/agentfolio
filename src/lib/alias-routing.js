const CANONICAL_AGENTFOLIO_HOST = 'agentfolio.bot';
const AGENTFOLIO_ALIAS_HOSTS = new Set([
  'brainai.bot',
]);

const AGENTFOLIO_CORS_ORIGINS = [
  'https://agentfolio.bot',
  'https://www.agentfolio.bot',
  'https://brainai.bot',
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

function stripAliasForwardedHeaders(req) {
  const strippedHeaders = [];
  for (const headerName of ['authorization', 'cookie']) {
    if (Object.prototype.hasOwnProperty.call(req.headers || {}, headerName)) {
      delete req.headers[headerName];
      strippedHeaders.push(headerName);
    }
  }
  return strippedHeaders;
}

function agentFolioAliasRoutingMiddleware(req, res, next) {
  if (normalizeHost(req.headers?.host) !== 'brainai.bot') {
    return next();
  }

  const normalizedUrl = normalizeAgentFolioAliasPath(req.url);
  if (normalizedUrl) {
    const strippedHeaders = stripAliasForwardedHeaders(req);
    req.agentfolioAlias = {
      originalUrl: req.originalUrl || req.url,
      canonicalUrl: normalizedUrl,
      strippedHeaders,
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
  stripAliasForwardedHeaders,
};
