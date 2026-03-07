/**
 * Kalshi Trading Verification
 * Verify agent trading performance on Kalshi prediction markets
 * 
 * Note: Kalshi requires API authentication (unlike Polymarket's public wallet data)
 * Users must provide API credentials for verification
 */

const KALSHI_API = 'https://api.elections.kalshi.com/trade-api/v2';
const KALSHI_DEMO_API = 'https://demo-api.kalshi.co/trade-api/v2';

/**
 * Authenticate with Kalshi API
 * @param {string} email - Kalshi account email
 * @param {string} password - Kalshi account password (or API key)
 * @param {boolean} demo - Use demo API
 * @returns {object} Auth token and member ID
 */
async function authenticate(email, password, demo = false) {
  const baseUrl = demo ? KALSHI_DEMO_API : KALSHI_API;
  
  try {
    const res = await fetch(`${baseUrl}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    
    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      return { error: error.message || 'Authentication failed', status: res.status };
    }
    
    const data = await res.json();
    return {
      token: data.token,
      memberId: data.member_id,
      authenticated: true
    };
  } catch (err) {
    return { error: err.message };
  }
}

/**
 * Get portfolio balance and positions
 * @param {string} token - Auth token from login
 * @param {boolean} demo - Use demo API
 */
async function getPortfolio(token, demo = false) {
  const baseUrl = demo ? KALSHI_DEMO_API : KALSHI_API;
  
  try {
    const res = await fetch(`${baseUrl}/portfolio/balance`, {
      headers: { 
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!res.ok) {
      return { error: 'Failed to fetch portfolio', status: res.status };
    }
    
    return res.json();
  } catch (err) {
    return { error: err.message };
  }
}

/**
 * Get trading history/fills
 * @param {string} token - Auth token
 * @param {boolean} demo - Use demo API
 */
async function getTradingHistory(token, demo = false) {
  const baseUrl = demo ? KALSHI_DEMO_API : KALSHI_API;
  
  try {
    const res = await fetch(`${baseUrl}/portfolio/fills?limit=1000`, {
      headers: { 
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!res.ok) {
      return { error: 'Failed to fetch trading history', status: res.status };
    }
    
    const data = await res.json();
    return data.fills || [];
  } catch (err) {
    return { error: err.message };
  }
}

/**
 * Get positions (open trades)
 * @param {string} token - Auth token
 * @param {boolean} demo - Use demo API
 */
async function getPositions(token, demo = false) {
  const baseUrl = demo ? KALSHI_DEMO_API : KALSHI_API;
  
  try {
    const res = await fetch(`${baseUrl}/portfolio/positions`, {
      headers: { 
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!res.ok) {
      return { error: 'Failed to fetch positions', status: res.status };
    }
    
    const data = await res.json();
    return data.market_positions || [];
  } catch (err) {
    return { error: err.message };
  }
}

/**
 * Calculate trading statistics from fills
 * @param {array} fills - Trading history
 */
function calculateStats(fills) {
  if (!fills || fills.length === 0) {
    return {
      totalTrades: 0,
      totalVolume: 0,
      wins: 0,
      losses: 0,
      winRate: 0
    };
  }

  let totalVolume = 0;
  let wins = 0;
  let losses = 0;
  
  // Group by market to track P&L
  const marketPnL = {};
  
  for (const fill of fills) {
    totalVolume += (fill.count || 1) * (fill.price || 0) / 100;
    
    // Track by market ticker
    const ticker = fill.ticker;
    if (!marketPnL[ticker]) {
      marketPnL[ticker] = { cost: 0, settled: 0 };
    }
    
    if (fill.action === 'buy') {
      marketPnL[ticker].cost += (fill.count || 1) * (fill.price || 0) / 100;
    } else if (fill.action === 'sell') {
      marketPnL[ticker].settled += (fill.count || 1) * (fill.price || 0) / 100;
    }
  }
  
  // Count wins/losses from settled markets
  for (const [ticker, pnl] of Object.entries(marketPnL)) {
    if (pnl.settled > 0) {
      if (pnl.settled > pnl.cost) wins++;
      else losses++;
    }
  }
  
  const resolvedTrades = wins + losses;
  const winRate = resolvedTrades > 0 ? (wins / resolvedTrades * 100).toFixed(1) : 0;

  return {
    totalTrades: fills.length,
    totalVolume: totalVolume.toFixed(2),
    wins,
    losses,
    winRate: parseFloat(winRate),
    marketsTraded: Object.keys(marketPnL).length
  };
}

/**
 * Full Kalshi verification flow
 * Verifies account access and retrieves trading stats
 */
async function verifyKalshiTrading(email, password, demo = false) {
  // Step 1: Authenticate
  const auth = await authenticate(email, password, demo);
  if (auth.error) {
    return { verified: false, error: auth.error };
  }
  
  // Step 2: Get portfolio balance
  const portfolio = await getPortfolio(auth.token, demo);
  
  // Step 3: Get trading history
  const fills = await getTradingHistory(auth.token, demo);
  
  // Step 4: Get open positions
  const positions = await getPositions(auth.token, demo);
  
  // Step 5: Calculate stats
  const stats = calculateStats(Array.isArray(fills) ? fills : []);
  
  return {
    verified: true,
    memberId: auth.memberId,
    balance: portfolio.balance || 0,
    stats: {
      ...stats,
      openPositions: Array.isArray(positions) ? positions.length : 0
    },
    verifiedAt: new Date().toISOString(),
    isDemo: demo
  };
}

/**
 * Check if a user has Kalshi activity (public check via API auth)
 * This doesn't expose any credentials - just verifies the account exists
 */
async function checkKalshiAccount(email, password, demo = false) {
  const auth = await authenticate(email, password, demo);
  return {
    exists: auth.authenticated || false,
    error: auth.error
  };
}

module.exports = {
  authenticate,
  getPortfolio,
  getTradingHistory,
  getPositions,
  calculateStats,
  verifyKalshiTrading,
  checkKalshiAccount
};
