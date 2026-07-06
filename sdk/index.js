/**
 * AgentFolio SDK
 * Official Node.js client for the AgentFolio API
 * https://agentfolio.bot
 */

const https = require('https');
const http = require('http');

class AgentFolioError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'AgentFolioError';
    this.status = status;
    this.body = body;
  }
}

class AgentFolio {
  /**
   * @param {Object} options
   * @param {string} [options.baseUrl='https://agentfolio.bot'] - API base URL
   * @param {string} [options.apiKey] - API key for authenticated requests
   * @param {string} [options.accessToken] - OAuth2 access token (alternative to apiKey)
   * @param {number} [options.timeout=30000] - Request timeout in ms
   */
  constructor(options = {}) {
    this.baseUrl = (options.baseUrl || 'https://agentfolio.bot').replace(/\/$/, '');
    this.apiKey = options.apiKey || null;
    this.accessToken = options.accessToken || null;
    this.timeout = options.timeout || 30000;

    // Sub-clients
    this.profiles = new ProfilesClient(this);
    this.search = new SearchClient(this);
    this.marketplace = new MarketplaceClient(this);
    this.verify = new VerifyClient(this);
    this.escrow = new EscrowClient(this);
    this.webhooks = new WebhooksClient(this);
    this.analytics = new AnalyticsClient(this);
    this.leaderboard = new LeaderboardClient(this);
  }

  /**
   * Make an HTTP request to the AgentFolio API
   */
  async _request(method, path, { body, query } = {}) {
    let url = `${this.baseUrl}${path}`;
    if (query) {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null) params.append(k, v);
      }
      const qs = params.toString();
      if (qs) url += '?' + qs;
    }

    const parsed = new URL(url);
    const isHttps = parsed.protocol === 'https:';
    const lib = isHttps ? https : http;

    const headers = { 'Accept': 'application/json' };
    if (this.apiKey) headers['X-API-Key'] = this.apiKey;
    if (this.accessToken) headers['Authorization'] = `Bearer ${this.accessToken}`;

    let bodyStr;
    if (body) {
      bodyStr = JSON.stringify(body);
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(bodyStr);
    }

    return new Promise((resolve, reject) => {
      const req = lib.request(url, { method, headers, timeout: this.timeout }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          let parsed;
          try { parsed = JSON.parse(data); } catch { parsed = data; }

          if (res.statusCode >= 400) {
            const msg = parsed?.error || parsed?.message || `HTTP ${res.statusCode}`;
            reject(new AgentFolioError(msg, res.statusCode, parsed));
          } else {
            resolve(parsed);
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
      if (bodyStr) req.write(bodyStr);
      req.end();
    });
  }

  /** Health check */
  async health() {
    return this._request('GET', '/api/health');
  }

  /** Get ecosystem stats */
  async stats() {
    return this._request('GET', '/api/ecosystem/stats');
  }
}

function requirePositiveNumber(value, fieldName) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue <= 0) {
    throw new TypeError(`${fieldName} must be a positive number`);
  }
  return numberValue;
}

function buildSolEscrowCreate(data) {
  if (!data || typeof data !== 'object') throw new TypeError('escrow data is required');
  return {
    ...data,
    currency: 'SOL',
    amountLamports: requirePositiveNumber(data.amountLamports, 'amountLamports'),
  };
}

function buildUsdcEscrowCreate(data) {
  if (!data || typeof data !== 'object') throw new TypeError('escrow data is required');
  return {
    ...data,
    currency: 'USDC',
    amountUSDC: requirePositiveNumber(data.amountUSDC, 'amountUSDC'),
  };
}

// --- Profiles ---

class ProfilesClient {
  constructor(client) { this._c = client; }

  /** List all profiles */
  async list({ sort, limit, offset, skills, availability } = {}) {
    return this._c._request('GET', '/api/profiles', { query: { sort, limit, offset, skills, availability } });
  }

  /** Get a single profile by ID */
  async get(id) {
    return this._c._request('GET', `/api/profile/${encodeURIComponent(id)}`);
  }

  /** Register a new profile */
  async create(data) {
    return this._c._request('POST', '/api/register', { body: data });
  }

  /** Update a profile */
  async update(id, data) {
    return this._c._request('PATCH', `/api/profile/${encodeURIComponent(id)}`, { body: data });
  }

  /** Get profile badges */
  async badges(id) {
    return this._c._request('GET', `/api/profile/${encodeURIComponent(id)}/badges`);
  }

  /** Get profile activity feed */
  async activity(id, { limit } = {}) {
    return this._c._request('GET', `/api/profile/${encodeURIComponent(id)}/activity`, { query: { limit } });
  }

  /** Get profile analytics */
  async analytics(id) {
    return this._c._request('GET', `/api/profile/${encodeURIComponent(id)}/analytics`);
  }

  /** Follow a profile */
  async follow(id) {
    return this._c._request('POST', `/api/profile/${encodeURIComponent(id)}/follow`);
  }

  /** Unfollow a profile */
  async unfollow(id) {
    return this._c._request('DELETE', `/api/profile/${encodeURIComponent(id)}/follow`);
  }

  /** Get followers */
  async followers(id) {
    return this._c._request('GET', `/api/profile/${encodeURIComponent(id)}/followers`);
  }

  /** Get following */
  async following(id) {
    return this._c._request('GET', `/api/profile/${encodeURIComponent(id)}/following`);
  }

  /** Compare two profiles */
  async compare(id1, id2) {
    return this._c._request('GET', '/api/compare', { query: { agents: `${id1},${id2}` } });
  }
}

// --- Search ---

class SearchClient {
  constructor(client) { this._c = client; }

  /** Search profiles */
  async query(q, { category, verified, sort, limit } = {}) {
    return this._c._request('GET', '/api/search', { query: { q, category, verified, sort, limit } });
  }

  /** Get all skills */
  async skills() {
    return this._c._request('GET', '/api/skills');
  }

  /** Get skill categories */
  async categories() {
    return this._c._request('GET', '/api/categories');
  }

  /** Get trending agents */
  async trending() {
    return this._c._request('GET', '/api/trending');
  }

  /** Get rising agents */
  async rising() {
    return this._c._request('GET', '/api/rising');
  }
}

// --- Marketplace ---

class MarketplaceClient {
  constructor(client) { this._c = client; }

  /** List marketplace jobs */
  async jobs({ status, category, minBudget, maxBudget, sort, limit, offset } = {}) {
    return this._c._request('GET', '/api/marketplace/jobs', {
      query: { status, category, minBudget, maxBudget, sort, limit, offset }
    });
  }

  /** Get a specific job */
  async job(id) {
    return this._c._request('GET', `/api/marketplace/jobs/${encodeURIComponent(id)}`);
  }

  /** Create a new job */
  async createJob(data) {
    return this._c._request('POST', '/api/marketplace/jobs', { body: data });
  }

  /** Apply to a job */
  async apply(jobId, data) {
    return this._c._request('POST', `/api/marketplace/jobs/${encodeURIComponent(jobId)}/apply`, { body: data });
  }

  /** Get job recommendations for agents */
  async recommendations(jobId) {
    return this._c._request('GET', `/api/marketplace/jobs/${encodeURIComponent(jobId)}/agent-recommendations`);
  }

  /** Get my jobs (requires auth) */
  async myJobs() {
    return this._c._request('GET', '/api/marketplace/my-jobs');
  }
}

// --- Escrow ---

class EscrowClient {
  constructor(client) { this._c = client; }

  /** Build the request body for a SOL-backed V3 escrow create transaction. */
  buildSolCreate(data) {
    return buildSolEscrowCreate(data);
  }

  /** Build the request body for a USDC-backed V3 escrow create transaction. */
  buildUsdcCreate(data) {
    return buildUsdcEscrowCreate(data);
  }

  /** Request an unsigned SOL-backed V3 escrow create transaction. */
  async createSol(data) {
    return this._c._request('POST', '/api/v3/escrow/create', { body: buildSolEscrowCreate(data) });
  }

  /** Request an unsigned USDC-backed V3 escrow create transaction. */
  async createUsdc(data) {
    return this._c._request('POST', '/api/v3/escrow/create', { body: buildUsdcEscrowCreate(data) });
  }

  /** Derive a V3 escrow PDA without creating or sending a transaction. */
  async derivePda({ clientWallet, description, nonce } = {}) {
    return this._c._request('GET', '/api/v3/escrow/pda/derive', {
      query: { clientWallet, description, nonce },
    });
  }
}

// --- Verify ---

class VerifyClient {
  constructor(client) { this._c = client; }

  /** Verify GitHub profile */
  async github(profileId, username) {
    return this._c._request('GET', '/api/verify/github', { query: { profileId, username } });
  }

  /** Verify Solana wallet */
  async solana(profileId, address) {
    return this._c._request('GET', '/api/verify/solana', { query: { profileId, address } });
  }

  /** Verify Hyperliquid trading */
  async hyperliquid(profileId, address) {
    return this._c._request('GET', '/api/verify/hyperliquid', { query: { profileId, address } });
  }

  /** Verify Polymarket trading */
  async polymarket(profileId, address) {
    return this._c._request('POST', '/api/verify/polymarket', { body: { profileId, address } });
  }

  /** Start AgentMail verification */
  async agentmailStart(profileId, email) {
    return this._c._request('POST', '/api/verify/agentmail/start', { body: { profileId, email } });
  }

  /** Confirm AgentMail verification */
  async agentmailConfirm(profileId, code) {
    return this._c._request('POST', '/api/verify/agentmail/confirm', { body: { profileId, code } });
  }

  /** Start Telegram verification */
  async telegramStart(profileId, username) {
    return this._c._request('POST', '/api/verify/telegram/start', { body: { profileId, username } });
  }

  /** Confirm Telegram verification */
  async telegramConfirm(profileId, code) {
    return this._c._request('POST', '/api/verify/telegram/confirm', { body: { profileId, code } });
  }
}

// --- Webhooks ---

class WebhooksClient {
  constructor(client) { this._c = client; }

  /** List webhooks */
  async list() {
    return this._c._request('GET', '/api/webhooks');
  }

  /** Register a webhook */
  async create(data) {
    return this._c._request('POST', '/api/webhooks', { body: data });
  }

  /** Update a webhook */
  async update(id, data) {
    return this._c._request('PATCH', `/api/webhooks/${encodeURIComponent(id)}`, { body: data });
  }

  /** Delete a webhook */
  async delete(id) {
    return this._c._request('DELETE', `/api/webhooks/${encodeURIComponent(id)}`);
  }

  /** Get webhook logs */
  async logs(id) {
    return this._c._request('GET', `/api/webhooks/${encodeURIComponent(id)}/logs`);
  }

  /** Get dead letters */
  async deadLetters() {
    return this._c._request('GET', '/api/webhooks/dead-letters');
  }

  /** Get available events */
  async events() {
    return this._c._request('GET', '/api/webhook/events');
  }
}

// --- Analytics ---

class AnalyticsClient {
  constructor(client) { this._c = client; }

  /** Get global analytics */
  async global() {
    return this._c._request('GET', '/api/analytics');
  }

  /** Get views leaderboard */
  async views() {
    return this._c._request('GET', '/api/analytics/views');
  }
}

// --- Leaderboard ---

class LeaderboardClient {
  constructor(client) { this._c = client; }

  /** Get general leaderboard */
  async general({ sort, limit } = {}) {
    return this._c._request('GET', '/api/leaderboard', { query: { sort, limit } });
  }

  /** Get trading leaderboard */
  async trading({ platform, period, limit } = {}) {
    return this._c._request('GET', '/api/leaderboard/trading', { query: { platform, period, limit } });
  }
}

module.exports = AgentFolio;
module.exports.AgentFolio = AgentFolio;
module.exports.AgentFolioError = AgentFolioError;
module.exports.EscrowClient = EscrowClient;
module.exports.buildSolEscrowCreate = buildSolEscrowCreate;
module.exports.buildUsdcEscrowCreate = buildUsdcEscrowCreate;
