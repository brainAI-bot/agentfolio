/**
 * Auto-Verification Pipeline for AgentFolio
 * Pulls on-chain data and populates profiles with verified stats.
 * Zero manual verification needed.
 */

const { verifyHyperliquidTrading, fetchAccountState, fetchFills } = require('./hyperliquid-verify');
const { getPolymarketStats } = require('./polymarket-verify');
const { verifySolanaWallet, getSolanaTokenAccounts } = require('./solana-verify');
const { verifyGitHubProfile, getGitHubStats } = require('./github-verify');
const { loadProfile, saveProfile } = require('./profile');

const SUPPORTED_PLATFORMS = ['hyperliquid', 'polymarket', 'solana', 'github'];

/**
 * Verify Hyperliquid wallet and return normalized stats
 */
async function verifyHyperliquid(walletAddress) {
  const result = await verifyHyperliquidTrading(walletAddress);
  if (!result.verified && result.error) {
    return { success: false, platform: 'hyperliquid', error: result.error };
  }

  return {
    success: true,
    platform: 'hyperliquid',
    address: walletAddress,
    verified: result.verified,
    stats: {
      accountValue: result.accountValue || 0,
      openPositions: result.openPositions || 0,
      totalTrades: result.stats?.totalTrades || 0,
      totalVolume: result.stats?.totalVolume || 0,
      uniqueAssets: result.stats?.uniqueAssets || [],
      firstTrade: result.stats?.firstTrade || null,
      lastTrade: result.stats?.lastTrade || null,
      verificationLevel: result.verificationLevel || 'none',
    },
    positions: result.positions || [],
    checkedAt: new Date().toISOString()
  };
}

/**
 * Verify Polymarket wallet and return normalized stats
 * Uses data-api.polymarket.com directly for reliable results
 */
async function verifyPolymarket(walletAddress) {
  try {
    const https = require('https');
    const url = `https://data-api.polymarket.com/trades?user=${walletAddress}&limit=100`;
    
    const trades = await new Promise((resolve, reject) => {
      https.get(url, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error('Invalid JSON from Polymarket'));
          }
        });
      }).on('error', reject);
    });

    if (!Array.isArray(trades)) {
      return { success: false, platform: 'polymarket', error: 'Unexpected response from Polymarket API' };
    }

    const totalTrades = trades.length;
    let totalVolume = 0;
    const markets = new Set();

    for (const t of trades) {
      totalVolume += (parseFloat(t.size) || 0) * (parseFloat(t.price) || 0);
      if (t.slug) markets.add(t.slug);
    }

    // Analyze wins/losses from resolved markets
    const marketOutcomes = {};
    for (const t of trades) {
      const key = t.conditionId || t.slug;
      if (!key) continue;
      if (!marketOutcomes[key]) marketOutcomes[key] = { buys: 0, spent: 0, title: t.title, outcome: t.outcome };
      if (t.side === 'BUY') {
        marketOutcomes[key].buys += parseFloat(t.size) || 0;
        marketOutcomes[key].spent += (parseFloat(t.size) || 0) * (parseFloat(t.price) || 0);
      }
    }

    return {
      success: true,
      platform: 'polymarket',
      address: walletAddress,
      verified: totalTrades > 0,
      stats: {
        totalTrades,
        totalVolume: Math.round(totalVolume * 100) / 100,
        uniqueMarkets: markets.size,
        recentTrades: trades.slice(0, 5).map(t => ({
          title: t.title,
          side: t.side,
          outcome: t.outcome,
          size: t.size,
          price: t.price,
          timestamp: t.timestamp
        }))
      },
      checkedAt: new Date().toISOString()
    };
  } catch (e) {
    return { success: false, platform: 'polymarket', error: e.message };
  }
}

/**
 * Verify Solana wallet and return normalized stats
 */
async function verifySolana(walletAddress) {
  const [walletResult, tokenResult] = await Promise.all([
    verifySolanaWallet(walletAddress),
    getSolanaTokenAccounts(walletAddress)
  ]);

  if (!walletResult.verified && walletResult.error) {
    return { success: false, platform: 'solana', error: walletResult.error };
  }

  return {
    success: true,
    platform: 'solana',
    address: walletAddress,
    verified: walletResult.verified,
    stats: {
      balanceSOL: parseFloat(walletResult.balanceSOL) || 0,
      transactionCount: walletResult.transactionCount || 0,
      tokenCount: tokenResult.count || 0,
      tier: walletResult.tier || 'unverified',
      verificationScore: walletResult.verificationScore || 0,
      lastActivity: walletResult.lastActivityTime || null,
      isProgram: walletResult.isProgram || false,
    },
    tokens: (tokenResult.tokens || []).slice(0, 10),
    checkedAt: new Date().toISOString()
  };
}

/**
 * Verify GitHub username and return normalized stats
 */
async function verifyGitHub(username, agentId) {
  try {
    const result = await verifyGitHubProfile(username, agentId || '');
    if (result.error) {
      return { success: false, platform: 'github', error: result.error };
    }

    return {
      success: true,
      platform: 'github',
      username: result.username,
      verified: result.verified,
      stats: {
        repos: result.stats?.repos || 0,
        stars: result.stats?.stars || 0,
        forks: result.stats?.forks || 0,
        followers: result.stats?.followers || 0,
        topLanguages: result.topLanguages || [],
        accountAge: result.createdAt || null,
      },
      recentRepos: result.recentRepos || [],
      avatar: result.avatar || null,
      verificationHint: result.verificationHint || null,
      checkedAt: new Date().toISOString()
    };
  } catch (e) {
    return { success: false, platform: 'github', error: e.message };
  }
}

/**
 * Run auto-verification for a profile
 * @param {string} profileId - Profile ID
 * @param {string} platform - Platform to verify (hyperliquid, polymarket, solana, github)
 * @param {string} address - Wallet address or username
 * @returns {object} Verification result
 */
async function autoVerify(profileId, platform, address) {
  if (!SUPPORTED_PLATFORMS.includes(platform)) {
    return { success: false, error: `Unsupported platform: ${platform}. Supported: ${SUPPORTED_PLATFORMS.join(', ')}` };
  }

  if (!address || !address.trim()) {
    return { success: false, error: 'Address/username is required' };
  }

  const profile = loadProfile(profileId);
  if (!profile) {
    return { success: false, error: 'Profile not found' };
  }

  // Run platform-specific verification
  let result;
  switch (platform) {
    case 'hyperliquid':
      result = await verifyHyperliquid(address.trim());
      break;
    case 'polymarket':
      result = await verifyPolymarket(address.trim());
      break;
    case 'solana':
      result = await verifySolana(address.trim());
      break;
    case 'github':
      result = await verifyGitHub(address.trim(), profileId);
      break;
  }

  if (!result.success) {
    return result;
  }

  // Merge into profile's verificationData
  const verificationData = profile.verificationData || {};
  verificationData[platform] = result;

  // Update profile wallets/links
  if (!profile.wallets) profile.wallets = {};
  if (!profile.links) profile.links = {};

  if (platform === 'hyperliquid') profile.wallets.hyperliquid = address.trim();
  if (platform === 'polymarket') profile.wallets.polymarket = address.trim();
  if (platform === 'solana') profile.wallets.solana = address.trim();
  if (platform === 'github') profile.links.github = address.trim();

  // Recalculate verification score based on all platforms
  const platformCount = Object.keys(verificationData).filter(k => verificationData[k]?.verified).length;
  const verifiedPlatforms = Object.keys(verificationData).filter(k => verificationData[k]?.verified);

  let score = profile.verification?.score || 0;
  // Each verified platform adds points
  score = Math.min(100, platformCount * 20 + (result.verified ? 10 : 0));

  let tier = 'unverified';
  if (score >= 80) tier = 'verified';
  else if (score >= 40) tier = 'partial';
  else if (score > 0) tier = 'basic';

  profile.verificationData = verificationData;
  profile.verification = {
    ...profile.verification,
    score,
    tier,
    lastVerified: new Date().toISOString(),
    verifiedPlatforms
  };

  // Save
  saveProfile(profile);

  return {
    success: true,
    profileId,
    platform,
    result,
    verification: profile.verification,
    message: result.verified
      ? `✅ ${platform} verified successfully`
      : `⚠️ ${platform} checked but no activity found`
  };
}

/**
 * Run all verifications for a profile based on its existing wallets/links
 */
async function autoVerifyAll(profileId) {
  const profile = loadProfile(profileId);
  if (!profile) return { success: false, error: 'Profile not found' };

  const results = {};

  if (profile.wallets?.hyperliquid) {
    results.hyperliquid = await autoVerify(profileId, 'hyperliquid', profile.wallets.hyperliquid);
  }
  if (profile.wallets?.polymarket) {
    results.polymarket = await autoVerify(profileId, 'polymarket', profile.wallets.polymarket);
  }
  if (profile.wallets?.solana) {
    results.solana = await autoVerify(profileId, 'solana', profile.wallets.solana);
  }
  if (profile.links?.github) {
    results.github = await autoVerify(profileId, 'github', profile.links.github);
  }

  return {
    success: true,
    profileId,
    results,
    platformsChecked: Object.keys(results).length
  };
}

module.exports = {
  autoVerify,
  autoVerifyAll,
  verifyHyperliquid,
  verifyPolymarket,
  verifySolana,
  verifyGitHub,
  SUPPORTED_PLATFORMS
};
