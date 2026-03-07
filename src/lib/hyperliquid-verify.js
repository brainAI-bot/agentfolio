/**
 * Hyperliquid Verification for AgentFolio
 * Verifies trading track record via public API
 */

const https = require('https');

const HL_API = 'api.hyperliquid.xyz';

/**
 * Fetch account state for a wallet address
 */
async function fetchAccountState(address) {
  const payload = {
    type: 'clearinghouseState',
    user: address
  };

  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const options = {
      hostname: HL_API,
      path: '/info',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error('Invalid JSON response'));
        }
      });
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

/**
 * Fetch historical fills (trades) for an address
 */
async function fetchFills(address, limit = 100) {
  const payload = {
    type: 'userFills',
    user: address
  };

  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const options = {
      hostname: HL_API,
      path: '/info',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const fills = JSON.parse(body);
          resolve(Array.isArray(fills) ? fills.slice(0, limit) : []);
        } catch (e) {
          reject(new Error('Invalid JSON response'));
        }
      });
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

/**
 * Calculate trading stats from fills
 */
function calculateTradingStats(fills) {
  if (!fills || fills.length === 0) {
    return {
      totalTrades: 0,
      totalVolume: 0,
      uniqueAssets: [],
      firstTrade: null,
      lastTrade: null
    };
  }

  const volume = fills.reduce((sum, f) => {
    const px = parseFloat(f.px) || 0;
    const sz = parseFloat(f.sz) || 0;
    return sum + (px * sz);
  }, 0);

  const assets = [...new Set(fills.map(f => f.coin))];
  const times = fills.map(f => f.time).filter(t => t).sort();

  return {
    totalTrades: fills.length,
    totalVolume: Math.round(volume * 100) / 100,
    uniqueAssets: assets,
    firstTrade: times[0] || null,
    lastTrade: times[times.length - 1] || null,
    recentTrades: fills.slice(0, 10).map(f => ({
      coin: f.coin,
      side: f.side,
      size: f.sz,
      price: f.px,
      time: f.time
    }))
  };
}

/**
 * Verify Hyperliquid trading activity for an address
 */
async function verifyHyperliquidTrading(address) {
  try {
    // Fetch account state and fills in parallel
    const [accountState, fills] = await Promise.all([
      fetchAccountState(address),
      fetchFills(address, 100)
    ]);

    // Extract portfolio value
    const marginSummary = accountState?.marginSummary || {};
    const accountValue = parseFloat(marginSummary.accountValue) || 0;
    
    // Get positions
    const positions = (accountState?.assetPositions || [])
      .filter(p => parseFloat(p.position?.szi) !== 0)
      .map(p => ({
        coin: p.position?.coin,
        size: p.position?.szi,
        entryPrice: p.position?.entryPx,
        unrealizedPnl: p.position?.unrealizedPnl,
        leverage: p.position?.leverage?.value
      }));

    // Calculate stats from fills
    const stats = calculateTradingStats(fills);

    // Determine verification level
    let verificationLevel = 'none';
    if (stats.totalTrades >= 100) verificationLevel = 'active_trader';
    else if (stats.totalTrades >= 20) verificationLevel = 'regular_trader';
    else if (stats.totalTrades >= 5) verificationLevel = 'casual_trader';
    else if (stats.totalTrades > 0) verificationLevel = 'minimal_activity';

    return {
      verified: stats.totalTrades > 0,
      address,
      accountValue,
      openPositions: positions.length,
      positions,
      stats,
      verificationLevel,
      checkedAt: new Date().toISOString()
    };
  } catch (e) {
    return {
      verified: false,
      address,
      error: e.message
    };
  }
}

/**
 * Get trading PnL summary
 */
async function getTradingPnL(address) {
  try {
    const state = await fetchAccountState(address);
    const marginSummary = state?.marginSummary || {};
    
    return {
      accountValue: parseFloat(marginSummary.accountValue) || 0,
      totalMarginUsed: parseFloat(marginSummary.totalMarginUsed) || 0,
      totalNtlPos: parseFloat(marginSummary.totalNtlPos) || 0,
      withdrawable: parseFloat(marginSummary.withdrawable) || 0
    };
  } catch (e) {
    return { error: e.message };
  }
}

module.exports = {
  verifyHyperliquidTrading,
  getTradingPnL,
  fetchAccountState,
  fetchFills
};
