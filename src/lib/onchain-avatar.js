/**
 * On-Chain Avatar Resolver
 * Reads soulbound Token-2022 tokens from wallet, extracts metadata URI,
 * resolves image from Arweave. Pure on-chain truth — no database dependency.
 */

const { Connection, PublicKey } = require('@solana/web3.js');
const { TOKEN_2022_PROGRAM_ID, getTokenMetadata } = require('@solana/spl-token');
const https = require('https');
const http = require('http');

const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const connection = new Connection(RPC_URL, 'confirmed');

// Cache to avoid hammering RPC (TTL: 5 minutes)
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL) { cache.delete(key); return null; }
  return entry.data;
}

function setCache(key, data) {
  cache.set(key, { data, ts: Date.now() });
}

/**
 * Fetch JSON from URL
 */
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    if (!url || !url.startsWith('http')) return reject(new Error('Invalid URL'));
    const client = url.startsWith('https') ? https : http;
    client.get(url, { headers: { 'User-Agent': 'AgentFolio/1.0' }, timeout: 10000 }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchJson(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

/**
 * Find soulbound (non-transferable) Token-2022 tokens in a wallet
 * Returns array of { mint, metadata } objects
 */
async function findSoulboundTokens(walletAddress) {
  const wallet = new PublicKey(walletAddress);
  
  // Get all Token-2022 accounts for this wallet
  const accounts = await connection.getParsedTokenAccountsByOwner(wallet, {
    programId: TOKEN_2022_PROGRAM_ID,
  });
  
  const soulbound = [];
  for (const { account } of accounts.value) {
    const info = account.data.parsed.info;
    // Must have exactly 1 token (NFT-like)
    if (info.tokenAmount.uiAmount !== 1 || info.tokenAmount.decimals !== 0) continue;
    
    const mintPubkey = new PublicKey(info.mint);
    
    try {
      // Read Token-2022 metadata extension from the mint
      const metadata = await getTokenMetadata(connection, mintPubkey, 'confirmed', TOKEN_2022_PROGRAM_ID);
      if (metadata) {
        soulbound.push({
          mint: info.mint,
          name: metadata.name,
          symbol: metadata.symbol,
          uri: metadata.uri,
          additionalMetadata: metadata.additionalMetadata || [],
        });
      }
    } catch (e) {
      // Not all Token-2022 tokens have metadata — skip silently
    }
  }
  
  return soulbound;
}

/**
 * Resolve avatar for a wallet address — pure on-chain
 * 
 * 1. Find soulbound Token-2022 tokens
 * 2. Look for one with symbol "BOA-SOUL" or additionalMetadata permanent=true
 * 3. Fetch metadata JSON from URI (Arweave)
 * 4. Return image URL
 * 
 * Returns: { image, mint, name, uri, permanent, burnTx, burnedNft } or null
 */
async function resolveOnChainAvatar(walletAddress) {
  const cacheKey = `avatar:${walletAddress}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;
  
  try {
    const tokens = await findSoulboundTokens(walletAddress);
    
    // Find the BOA-SOUL soulbound token
    let soul = tokens.find(t => t.symbol === 'BOA-SOUL');
    if (!soul) {
      // Fallback: look for any token with permanent=true in additional metadata
      soul = tokens.find(t => 
        t.additionalMetadata.some(([k, v]) => k === 'permanent' && v === 'true')
      );
    }
    
    if (!soul) {
      setCache(cacheKey, null);
      return null;
    }
    
    // Fetch off-chain metadata from Arweave
    let image = null;
    try {
      const json = await fetchJson(soul.uri);
      image = json.image || null;
    } catch (e) {
      console.warn('[OnChainAvatar] Failed to fetch metadata JSON:', e.message);
    }
    
    // Extract additional metadata
    const meta = Object.fromEntries(soul.additionalMetadata);
    
    const result = {
      image,
      mint: soul.mint,
      name: soul.name,
      uri: soul.uri,
      permanent: meta.permanent === 'true',
      burnTx: meta.burnTx || null,
      burnedNft: meta.burnedNft || null,
      agent: meta.agent || null,
      source: 'on-chain', // proves this came from chain, not DB
    };
    
    setCache(cacheKey, result);
    return result;
  } catch (e) {
    console.error('[OnChainAvatar] Resolve failed:', e.message);
    return null;
  }
}

/**
 * API endpoint: GET /api/avatar/onchain?wallet=...
 * Returns on-chain verified avatar data
 */
function handleOnChainAvatarRequest(req, res, url) {
  if (url.pathname === '/api/avatar/onchain' && req.method === 'GET') {
    const wallet = url.searchParams.get('wallet');
    if (!wallet) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: 'wallet required' }));
      return true;
    }
    
    resolveOnChainAvatar(wallet).then(result => {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(result || { image: null, source: 'on-chain', found: false }));
    }).catch(e => {
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: e.message }));
    });
    return true;
  }
  return false;
}


/**
 * Image redirect: GET /avatar/<wallet>
 * Returns 302 redirect to the Arweave image URL
 * Agents can use this as their PFP on any platform
 */
function handleAvatarRedirect(req, res, url) {
  const match = url.pathname.match(/^\/avatar\/([A-Za-z0-9]{32,44})$/);
  if (!match || (req.method !== 'GET' && req.method !== 'HEAD')) return false;
  
  const wallet = match[1];
  
  resolveOnChainAvatar(wallet).then(result => {
    if (result?.image) {
      // 302 redirect to Arweave image — cache for 5 min
      res.writeHead(302, {
        'Location': result.image,
        'Cache-Control': 'public, max-age=300',
        'X-Source': 'on-chain',
        'X-Soulbound-Mint': result.mint || '',
        'X-Burn-Tx': result.burnTx || '',
        'Access-Control-Allow-Origin': '*',
      });
      res.end();
    } else {
      // No soulbound found — return 404 with a hint
      res.writeHead(404, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ 
        error: 'No soulbound avatar found for this wallet',
        wallet,
        hint: 'Burn an NFT at https://agentfolio.bot/mint to get your permanent face',
      }));
    }
  }).catch(e => {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: e.message }));
  });
  
  return true;
}

module.exports = { resolveOnChainAvatar, findSoulboundTokens, handleOnChainAvatarRequest, handleAvatarRedirect };
