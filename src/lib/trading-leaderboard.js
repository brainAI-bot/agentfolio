/**
 * Trading Leaderboard
 * Rank agents by verified trading performance
 */

const { loadProfile, listProfiles } = require('./profile');

/**
 * Get all agents with verified trading stats
 * @param {string} dataDir - Profile data directory
 * @returns {array} Agents with trading verification
 */
function getTradingAgents(dataDir) {
  const profiles = listProfiles(dataDir);
  const tradingAgents = [];
  
  for (const profile of profiles) {
    const trading = {};
    let hasTrading = false;
    
    // Check Polymarket
    if (profile.verificationData?.polymarket?.verified) {
      trading.polymarket = profile.verificationData.polymarket.stats;
      hasTrading = true;
    }
    
    // Check Kalshi
    if (profile.verificationData?.kalshi?.verified) {
      trading.kalshi = profile.verificationData.kalshi.stats;
      hasTrading = true;
    }
    
    // Check Hyperliquid
    if (profile.verificationData?.hyperliquid?.verified) {
      trading.hyperliquid = {
        accountValue: profile.verificationData.hyperliquid.accountValue,
        pnl: profile.verificationData.hyperliquid.pnl
      };
      hasTrading = true;
    }
    
    if (hasTrading) {
      tradingAgents.push({
        id: profile.id,
        name: profile.name,
        handle: profile.handle,
        avatar: profile.avatar,
        trading,
        aggregateStats: calculateAggregateStats(trading)
      });
    }
  }
  
  return tradingAgents;
}

/**
 * Calculate aggregate stats across platforms
 */
function calculateAggregateStats(trading) {
  let totalTrades = 0;
  let totalWins = 0;
  let totalLosses = 0;
  let totalPnL = 0;
  let platforms = 0;
  
  if (trading.polymarket) {
    totalTrades += trading.polymarket.totalTrades || 0;
    totalWins += trading.polymarket.wins || 0;
    totalLosses += trading.polymarket.losses || 0;
    totalPnL += parseFloat(trading.polymarket.realizedPnL || 0);
    platforms++;
  }
  
  if (trading.kalshi) {
    totalTrades += trading.kalshi.totalTrades || 0;
    totalWins += trading.kalshi.wins || 0;
    totalLosses += trading.kalshi.losses || 0;
    platforms++;
  }
  
  if (trading.hyperliquid) {
    totalPnL += parseFloat(trading.hyperliquid.pnl || 0);
    platforms++;
  }
  
  const resolvedTrades = totalWins + totalLosses;
  const winRate = resolvedTrades > 0 ? (totalWins / resolvedTrades * 100) : 0;
  
  return {
    totalTrades,
    totalWins,
    totalLosses,
    winRate: Math.round(winRate * 10) / 10,
    totalPnL: Math.round(totalPnL * 100) / 100,
    platforms
  };
}

/**
 * Get trading leaderboard sorted by metric
 * @param {string} dataDir - Profile data directory
 * @param {string} sortBy - 'pnl', 'winRate', 'trades', 'platforms'
 * @param {number} limit - Max results
 */
function getTradingLeaderboard(dataDir, sortBy = 'pnl', limit = 50) {
  const agents = getTradingAgents(dataDir);
  
  // Sort by metric
  agents.sort((a, b) => {
    switch (sortBy) {
      case 'pnl':
        return b.aggregateStats.totalPnL - a.aggregateStats.totalPnL;
      case 'winRate':
        // Require minimum trades for win rate ranking
        if (a.aggregateStats.totalTrades < 5 && b.aggregateStats.totalTrades >= 5) return 1;
        if (b.aggregateStats.totalTrades < 5 && a.aggregateStats.totalTrades >= 5) return -1;
        return b.aggregateStats.winRate - a.aggregateStats.winRate;
      case 'trades':
        return b.aggregateStats.totalTrades - a.aggregateStats.totalTrades;
      case 'platforms':
        return b.aggregateStats.platforms - a.aggregateStats.platforms;
      default:
        return b.aggregateStats.totalPnL - a.aggregateStats.totalPnL;
    }
  });
  
  return agents.slice(0, limit);
}

/**
 * Get platform-specific leaderboard
 */
function getPlatformLeaderboard(dataDir, platform, sortBy = 'pnl', limit = 50) {
  const agents = getTradingAgents(dataDir);
  
  // Filter to agents with this platform
  const platformAgents = agents.filter(a => a.trading[platform]);
  
  // Sort by platform-specific metric
  platformAgents.sort((a, b) => {
    const statsA = a.trading[platform];
    const statsB = b.trading[platform];
    
    switch (sortBy) {
      case 'pnl':
        return parseFloat(statsB.realizedPnL || statsB.pnl || 0) - 
               parseFloat(statsA.realizedPnL || statsA.pnl || 0);
      case 'winRate':
        return (statsB.winRate || 0) - (statsA.winRate || 0);
      case 'trades':
        return (statsB.totalTrades || 0) - (statsA.totalTrades || 0);
      default:
        return parseFloat(statsB.realizedPnL || statsB.pnl || 0) - 
               parseFloat(statsA.realizedPnL || statsA.pnl || 0);
    }
  });
  
  return platformAgents.slice(0, limit);
}

module.exports = {
  getTradingAgents,
  calculateAggregateStats,
  getTradingLeaderboard,
  getPlatformLeaderboard
};
