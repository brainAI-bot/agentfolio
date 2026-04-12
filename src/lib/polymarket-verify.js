/**
 * Polymarket P&L Verification
 * Verify agent trading performance on Polymarket
 */

const DATA_API = 'https://data-api.polymarket.com';

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'AgentFolio-Verify/1.0'
    }
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `HTTP ${res.status}`);
  }

  return res.json();
}

/**
 * Fetch user's trading history from Polymarket
 * @param {string} address - Ethereum/Polygon wallet address
 * @returns {object} Trading stats
 */
async function getPolymarketStats(address) {
  try {
    const normalized = String(address || '').trim().toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(normalized)) {
      return { error: 'Invalid wallet address' };
    }

    const [positionsRaw, tradesRaw] = await Promise.all([
      fetchJson(`${DATA_API}/positions?user=${encodeURIComponent(normalized)}&limit=500`),
      fetchJson(`${DATA_API}/trades?user=${encodeURIComponent(normalized)}&limit=1000`),
    ]);

    const positions = Array.isArray(positionsRaw) ? positionsRaw : [];
    const trades = Array.isArray(tradesRaw) ? tradesRaw : [];

    let totalVolume = 0;
    let realizedPnL = 0;
    let wins = 0;
    let losses = 0;

    for (const trade of trades) {
      const size = parseFloat(trade.size || 0);
      const price = parseFloat(trade.price || 0);
      totalVolume += size * price;
    }

    for (const position of positions) {
      const pnl = parseFloat(position.realizedPnl ?? position.cashPnl ?? 0);
      realizedPnL += pnl;
      if (pnl > 0) wins++;
      else if (pnl < 0) losses++;
    }

    const resolvedTrades = wins + losses;
    const winRate = resolvedTrades > 0 ? (wins / resolvedTrades * 100) : 0;

    return {
      address: normalized,
      totalTrades: trades.length,
      totalVolume: totalVolume.toFixed(2),
      realizedPnL: realizedPnL.toFixed(2),
      wins,
      losses,
      winRate: parseFloat(winRate.toFixed(1)),
      openPositions: positions.filter(p => Math.abs(parseFloat(p.size || 0)) > 0).length,
      resolvedPositions: resolvedTrades,
      fetchedAt: new Date().toISOString()
    };
  } catch (err) {
    return { error: err.message };
  }
}

/**
 * Verify Polymarket wallet ownership via signature
 * Agent signs a message with their wallet to prove ownership
 */
async function verifyPolymarketWallet(address, signature, message) {
  try {
    const { ethers } = require('ethers');
    const recoveredAddress = ethers.verifyMessage(message, signature);
    return recoveredAddress.toLowerCase() === address.toLowerCase();
  } catch (err) {
    return false;
  }
}

/**
 * Generate verification challenge message
 */
function generateVerificationMessage(profileId) {
  const timestamp = Date.now();
  return {
    message: `AgentFolio Polymarket Verification\nProfile: ${profileId}\nTimestamp: ${timestamp}`,
    timestamp
  };
}

/**
 * Full verification flow
 * 1. Check wallet has Polymarket activity
 * 2. Verify ownership via signature
 * 3. Return verified stats
 */
async function verifyPolymarketTrading(profileId, address, signature, message) {
  // Verify signature
  const ownershipVerified = await verifyPolymarketWallet(address, signature, message);
  if (!ownershipVerified) {
    return { verified: false, error: 'Signature verification failed' };
  }

  // Get trading stats
  const stats = await getPolymarketStats(address);
  if (stats.error) {
    return { verified: false, error: stats.error };
  }

  // Require minimum activity for verification
  if (stats.totalTrades < 5) {
    return { 
      verified: false, 
      error: 'Minimum 5 trades required for verification',
      stats 
    };
  }

  return {
    verified: true,
    address,
    stats,
    verifiedAt: new Date().toISOString()
  };
}

module.exports = {
  getPolymarketStats,
  verifyPolymarketWallet,
  generateVerificationMessage,
  verifyPolymarketTrading
};
