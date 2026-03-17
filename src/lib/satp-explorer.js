/**
 * SATP Explorer - Solana Agent Trust Protocol data fetcher
 * Queries Identity, Reputation, and Validation programs on Solana mainnet
 */

const https = require('https');

const SOLANA_RPC = 'api.mainnet-beta.solana.com';

const PROGRAMS = {
  identity: 'CV5Wd9YGFX5A4dvuaFuEDuKQWp14NfnLrSdxY7EHFyeB',
  escrow: '4qx9DTX1BojPnQAtUBL2Gb9pw6kVyw5AucjaR8Yyea9a'
};

// In-memory cache with 10 minute TTL (was 60s — caused 429s)
const _cache = new Map();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes
const STALE_TTL = 60 * 60 * 1000; // 1 hour — serve stale on error

function getCached(key) {
  const entry = _cache.get(key);
  if (entry && Date.now() - entry.ts < CACHE_TTL) return entry.data;
  return null;
}

function getStaleCached(key) {
  const entry = _cache.get(key);
  if (entry && Date.now() - entry.ts < STALE_TTL) return entry.data;
  return null;
}

function setCache(key, data) {
  _cache.set(key, { data, ts: Date.now() });
}

function clearCache() {
  _cache.clear();
}

function rpcCall(method, params) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method,
      params
    });

    const options = {
      hostname: SOLANA_RPC,
      path: '/',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          if (result.error) {
            resolve({ error: result.error.message });
          } else {
            resolve(result.result);
          }
        } catch (e) {
          reject(new Error('Failed to parse RPC response'));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('RPC request timeout'));
    });
    req.write(postData);
    req.end();
  });
}

async function fetchProgramAccounts(programId) {
  const cached = getCached(`accounts:${programId}`);
  if (cached) return cached;

  try {
    const result = await rpcCall('getProgramAccounts', [
      programId,
      { encoding: 'base64', commitment: 'confirmed' }
    ]);

    if (result && !result.error) {
      setCache(`accounts:${programId}`, result);
      return result;
    }

    // On RPC error (429 etc), return stale cache if available
    const stale = getStaleCached(`accounts:${programId}`);
    if (stale) {
      console.log(`[SATP Cache] Serving stale cache for ${programId.slice(0,8)} (RPC error: ${result?.error || 'unknown'})`);
      return stale;
    }
    return result || [];
  } catch (err) {
    // On network error, return stale cache
    const stale = getStaleCached(`accounts:${programId}`);
    if (stale) {
      console.log(`[SATP Cache] Serving stale cache for ${programId.slice(0,8)} (error: ${err.message})`);
      return stale;
    }
    throw err;
  }
}

async function fetchIdentityAccounts() {
  return fetchProgramAccounts(PROGRAMS.identity);
}

async function fetchEscrowAccounts() {
  return fetchProgramAccounts(PROGRAMS.escrow);
}

async function getSATPOverview() {
  const cached = getCached('overview');
  if (cached) return cached;

  const [identities, escrows] = await Promise.all([
    fetchIdentityAccounts(),
    fetchEscrowAccounts()
  ]);

  const overview = {
    programs: PROGRAMS,
    network: 'mainnet-beta',
    counts: {
      identities: Array.isArray(identities) ? identities.length : 0,
      escrows: Array.isArray(escrows) ? escrows.length : 0
    },
    accounts: {
      identities: Array.isArray(identities) ? identities : [],
      escrows: Array.isArray(escrows) ? escrows : []
    },
    fetchedAt: new Date().toISOString()
  };

  setCache('overview', overview);
  return overview;
}

module.exports = {
  PROGRAMS,
  rpcCall,
  fetchIdentityAccounts,
  fetchEscrowAccounts,
  getSATPOverview,
  clearCache,
  _cache
};
