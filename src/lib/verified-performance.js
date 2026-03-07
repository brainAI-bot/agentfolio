/**
 * Verified Performance History (On-Chain Proof)
 * 
 * Fetches and caches on-chain trading history for verified wallets,
 * generating tamper-proof performance records with transaction hashes.
 * Supports: Hyperliquid, Polymarket, Solana DEX trades.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { loadProfile, listProfiles } = require('./profile');

const CACHE_DIR = path.join(__dirname, '../../data/performance-cache');
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

// Ensure cache directory exists
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

/**
 * HTTP GET helper
 */
function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: { 'User-Agent': 'AgentFolio/1.0', ...headers }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(data); }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

function httpPost(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const postData = JSON.stringify(body);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'User-Agent': 'AgentFolio/1.0',
        ...headers
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(data); }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('timeout')); });
    req.write(postData);
    req.end();
  });
}

/**
 * Fetch Hyperliquid fill history for a wallet
 */
async function fetchHyperliquidHistory(address, startTime = null) {
  try {
    const body = {
      type: 'userFills',
      user: address
    };
    if (startTime) body.startTime = startTime;
    
    const fills = await httpPost('https://api.hyperliquid.xyz/info', body);
    if (!Array.isArray(fills)) return [];
    
    return fills.map(fill => ({
      platform: 'hyperliquid',
      type: fill.side === 'B' ? 'buy' : 'sell',
      asset: fill.coin,
      price: parseFloat(fill.px),
      size: parseFloat(fill.sz),
      value: parseFloat(fill.px) * parseFloat(fill.sz),
      fee: parseFloat(fill.fee || 0),
      timestamp: fill.time,
      txHash: fill.hash || fill.tid || null,
      closedPnl: parseFloat(fill.closedPnl || 0),
      raw: { oid: fill.oid, tid: fill.tid, startPosition: fill.startPosition, dir: fill.dir }
    }));
  } catch (err) {
    console.error('HL history fetch error:', err.message);
    return [];
  }
}

/**
 * Fetch Polymarket activity for a wallet
 */
async function fetchPolymarketHistory(address) {
  try {
    const data = await httpGet(
      `https://data-api.polymarket.com/activity?address=${address}&limit=500&offset=0`
    );
    if (!Array.isArray(data)) return [];
    
    return data.map(item => ({
      platform: 'polymarket',
      type: item.type || (item.side === 'BUY' ? 'buy' : 'sell'),
      asset: item.title || item.market || item.conditionId || 'Unknown',
      price: parseFloat(item.price || 0),
      size: parseFloat(item.size || item.amount || 0),
      value: parseFloat(item.usdcSize || item.value || 0),
      fee: 0,
      timestamp: item.timestamp || item.createdAt,
      txHash: item.transactionHash || item.proxyTxnHash || null,
      outcome: item.outcome,
      raw: { conditionId: item.conditionId, side: item.side, type: item.type }
    }));
  } catch (err) {
    console.error('PM history fetch error:', err.message);
    return [];
  }
}

/**
 * Fetch Solana transaction history (token transfers / DEX swaps)
 */
async function fetchSolanaHistory(address) {
  try {
    // Use public Solana RPC to get recent signatures
    const body = {
      jsonrpc: '2.0',
      id: 1,
      method: 'getSignaturesForAddress',
      params: [address, { limit: 100 }]
    };
    const resp = await httpPost('https://api.mainnet-beta.solana.com', body);
    if (!resp?.result) return [];
    
    return resp.result.map(tx => ({
      platform: 'solana',
      type: 'transaction',
      asset: 'SOL',
      timestamp: tx.blockTime ? tx.blockTime * 1000 : null,
      txHash: tx.signature,
      status: tx.err ? 'failed' : 'confirmed',
      memo: tx.memo || null,
      slot: tx.slot,
      raw: { confirmationStatus: tx.confirmationStatus }
    }));
  } catch (err) {
    console.error('Solana history fetch error:', err.message);
    return [];
  }
}

/**
 * Build verified performance record for a profile
 */
async function buildPerformanceHistory(profileId, dataDir) {
  const profile = loadProfile(profileId, dataDir);
  if (!profile) throw new Error('Profile not found');
  
  const history = {
    profileId,
    profileName: profile.name,
    generatedAt: new Date().toISOString(),
    platforms: {},
    summary: {
      totalTrades: 0,
      totalVolume: 0,
      totalPnl: 0,
      platformCount: 0,
      firstTrade: null,
      lastTrade: null,
      verifiedWallets: []
    },
    trades: []
  };
  
  // Hyperliquid
  if (profile.verificationData?.hyperliquid?.verified) {
    const addr = profile.verificationData.hyperliquid.address;
    history.summary.verifiedWallets.push({ platform: 'hyperliquid', address: addr });
    const fills = await fetchHyperliquidHistory(addr);
    if (fills.length > 0) {
      const pnl = fills.reduce((sum, f) => sum + f.closedPnl, 0);
      const volume = fills.reduce((sum, f) => sum + f.value, 0);
      history.platforms.hyperliquid = {
        address: addr,
        tradeCount: fills.length,
        volume: Math.round(volume * 100) / 100,
        realizedPnl: Math.round(pnl * 100) / 100,
        firstTrade: fills[fills.length - 1]?.timestamp,
        lastTrade: fills[0]?.timestamp,
        assets: [...new Set(fills.map(f => f.asset))]
      };
      history.trades.push(...fills);
      history.summary.totalTrades += fills.length;
      history.summary.totalVolume += volume;
      history.summary.totalPnl += pnl;
      history.summary.platformCount++;
    }
  }
  
  // Polymarket
  if (profile.verificationData?.polymarket?.verified) {
    const addr = profile.verificationData.polymarket.address ||
                 profile.verificationData.polymarket.proxyAddress;
    if (addr) {
      history.summary.verifiedWallets.push({ platform: 'polymarket', address: addr });
      const activity = await fetchPolymarketHistory(addr);
      if (activity.length > 0) {
        const volume = activity.reduce((sum, a) => sum + a.value, 0);
        history.platforms.polymarket = {
          address: addr,
          tradeCount: activity.length,
          volume: Math.round(volume * 100) / 100,
          firstTrade: activity[activity.length - 1]?.timestamp,
          lastTrade: activity[0]?.timestamp,
          markets: [...new Set(activity.map(a => a.asset))].slice(0, 20)
        };
        history.trades.push(...activity);
        history.summary.totalTrades += activity.length;
        history.summary.totalVolume += volume;
        history.summary.platformCount++;
      }
    }
  }
  
  // Solana
  if (profile.verificationData?.solana?.verified) {
    const addr = profile.verificationData.solana.address;
    history.summary.verifiedWallets.push({ platform: 'solana', address: addr });
    const txns = await fetchSolanaHistory(addr);
    if (txns.length > 0) {
      history.platforms.solana = {
        address: addr,
        transactionCount: txns.length,
        firstTransaction: txns[txns.length - 1]?.timestamp,
        lastTransaction: txns[0]?.timestamp
      };
      history.trades.push(...txns);
      history.summary.totalTrades += txns.length;
      history.summary.platformCount++;
    }
  }
  
  // Sort all trades by timestamp desc
  history.trades.sort((a, b) => {
    const tA = typeof a.timestamp === 'number' ? a.timestamp : new Date(a.timestamp).getTime();
    const tB = typeof b.timestamp === 'number' ? b.timestamp : new Date(b.timestamp).getTime();
    return tB - tA;
  });
  
  // Summary timestamps
  if (history.trades.length > 0) {
    const times = history.trades.map(t => 
      typeof t.timestamp === 'number' ? t.timestamp : new Date(t.timestamp).getTime()
    ).filter(t => !isNaN(t));
    history.summary.firstTrade = new Date(Math.min(...times)).toISOString();
    history.summary.lastTrade = new Date(Math.max(...times)).toISOString();
  }
  
  history.summary.totalVolume = Math.round(history.summary.totalVolume * 100) / 100;
  history.summary.totalPnl = Math.round(history.summary.totalPnl * 100) / 100;
  
  // Generate proof hash (SHA-256 of summary for integrity)
  const crypto = require('crypto');
  history.proofHash = crypto.createHash('sha256')
    .update(JSON.stringify(history.summary) + JSON.stringify(history.platforms))
    .digest('hex');
  
  // Cache it
  const cachePath = path.join(CACHE_DIR, `${profileId}.json`);
  fs.writeFileSync(cachePath, JSON.stringify(history, null, 2));
  
  return history;
}

/**
 * Get cached performance or rebuild
 */
async function getPerformanceHistory(profileId, dataDir, forceRefresh = false) {
  const cachePath = path.join(CACHE_DIR, `${profileId}.json`);
  
  if (!forceRefresh && fs.existsSync(cachePath)) {
    const stat = fs.statSync(cachePath);
    if (Date.now() - stat.mtimeMs < CACHE_TTL) {
      return JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    }
  }
  
  return buildPerformanceHistory(profileId, dataDir);
}

/**
 * Get performance summary (lightweight, no trade list)
 */
async function getPerformanceSummary(profileId, dataDir) {
  const history = await getPerformanceHistory(profileId, dataDir);
  return {
    profileId: history.profileId,
    profileName: history.profileName,
    generatedAt: history.generatedAt,
    proofHash: history.proofHash,
    platforms: history.platforms,
    summary: history.summary
  };
}

/**
 * Verify a proof hash matches the claimed performance
 */
async function verifyProofHash(profileId, claimedHash, dataDir) {
  const history = await getPerformanceHistory(profileId, dataDir, true);
  return {
    valid: history.proofHash === claimedHash,
    currentHash: history.proofHash,
    claimedHash,
    generatedAt: history.generatedAt
  };
}

/**
 * Get ranking of all agents by verified on-chain performance
 */
async function getVerifiedPerformanceRanking(dataDir, sortBy = 'volume') {
  const profiles = listProfiles(dataDir);
  const rankings = [];
  
  for (const profile of profiles) {
    const hasVerifiedTrading = 
      profile.verificationData?.hyperliquid?.verified ||
      profile.verificationData?.polymarket?.verified ||
      profile.verificationData?.solana?.verified;
    
    if (!hasVerifiedTrading) continue;
    
    try {
      const summary = await getPerformanceSummary(profile.id, dataDir);
      if (summary.summary.totalTrades > 0) {
        rankings.push({
          profileId: profile.id,
          name: profile.name,
          handle: profile.handle,
          avatar: profile.avatar,
          ...summary.summary,
          platforms: summary.platforms,
          proofHash: summary.proofHash
        });
      }
    } catch (err) {
      // Skip profiles with fetch errors
    }
  }
  
  // Sort
  const sortFns = {
    volume: (a, b) => b.totalVolume - a.totalVolume,
    trades: (a, b) => b.totalTrades - a.totalTrades,
    pnl: (a, b) => b.totalPnl - a.totalPnl,
    platforms: (a, b) => b.platformCount - a.platformCount
  };
  rankings.sort(sortFns[sortBy] || sortFns.volume);
  
  return rankings;
}

/**
 * Generate explorer URLs for trade verification
 */
function getExplorerUrl(platform, txHash) {
  if (!txHash) return null;
  switch (platform) {
    case 'hyperliquid':
      return `https://app.hyperliquid.xyz/explorer/tx/${txHash}`;
    case 'polymarket':
      return `https://polygonscan.com/tx/${txHash}`;
    case 'solana':
      return `https://solscan.io/tx/${txHash}`;
    default:
      return null;
  }
}

/**
 * Format trade for display
 */
function formatTrade(trade) {
  const ts = typeof trade.timestamp === 'number' 
    ? new Date(trade.timestamp).toISOString()
    : trade.timestamp;
  return {
    ...trade,
    formattedTime: ts,
    explorerUrl: getExplorerUrl(trade.platform, trade.txHash),
    formattedValue: trade.value ? `$${trade.value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : null,
    formattedPnl: trade.closedPnl ? `${trade.closedPnl >= 0 ? '+' : ''}$${trade.closedPnl.toFixed(2)}` : null
  };
}

module.exports = {
  buildPerformanceHistory,
  getPerformanceHistory,
  getPerformanceSummary,
  verifyProofHash,
  getVerifiedPerformanceRanking,
  getExplorerUrl,
  formatTrade,
  fetchHyperliquidHistory,
  fetchPolymarketHistory,
  fetchSolanaHistory
};
