/**
 * Polymarket P&L Verification
 * Verify agent trading performance on Polymarket
 */

const GAMMA_API = 'https://gamma-api.polymarket.com';

/**
 * Fetch user's trading history from Polymarket
 * @param {string} address - Ethereum/Polygon wallet address
 * @returns {object} Trading stats
 */
async function getPolymarketStats(address) {
  try {
    // Fetch user's positions
    const positionsRes = await fetch(`${GAMMA_API}/users/${address}/positions`);
    if (!positionsRes.ok) {
      return { error: 'Failed to fetch positions', status: positionsRes.status };
    }
    const positions = await positionsRes.json();

    // Fetch user's trade history
    const tradesRes = await fetch(`${GAMMA_API}/users/${address}/trades?limit=1000`);
    const trades = tradesRes.ok ? await tradesRes.json() : [];

    // Calculate stats
    let totalTrades = trades.length;
    let totalVolume = 0;
    let realizedPnL = 0;
    let wins = 0;
    let losses = 0;

    // Analyze resolved positions
    for (const position of positions) {
      if (position.resolved) {
        const pnl = parseFloat(position.pnl || 0);
        realizedPnL += pnl;
        if (pnl > 0) wins++;
        else if (pnl < 0) losses++;
      }
      totalVolume += parseFloat(position.value || 0);
    }

    // Calculate win rate
    const resolvedTrades = wins + losses;
    const winRate = resolvedTrades > 0 ? (wins / resolvedTrades * 100).toFixed(1) : 0;

    return {
      address,
      totalTrades,
      totalVolume: totalVolume.toFixed(2),
      realizedPnL: realizedPnL.toFixed(2),
      wins,
      losses,
      winRate: parseFloat(winRate),
      openPositions: positions.filter(p => !p.resolved).length,
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
