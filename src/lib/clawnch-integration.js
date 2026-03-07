/**
 * Clawnch Integration Module
 * Cross-references Clawnch token launches with AgentFolio verified agents
 */

const https = require('https');
const http = require('http');
const { loadProfile, listProfiles } = require('./profile');
const { calculateReputation, getTierInfo } = require('./reputation');

const CLAWNCH_API = 'https://clawn.ch/api/tokens';
const CACHE_TTL = 5 * 60 * 1000; // 5 min

let tokensCache = null;
let cacheTimestamp = 0;

/**
 * Fetch all Clawnch tokens (cached)
 */
async function fetchClawnchTokens() {
  if (tokensCache && Date.now() - cacheTimestamp < CACHE_TTL) return tokensCache;
  
  return new Promise((resolve, reject) => {
    const req = https.get(CLAWNCH_API, { timeout: 15000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          tokensCache = Array.isArray(parsed) ? parsed : (parsed.tokens || []);
          cacheTimestamp = Date.now();
          resolve(tokensCache);
        } catch (e) {
          reject(new Error('Failed to parse Clawnch API response'));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Clawnch API timeout')); });
  });
}

/**
 * Find AgentFolio profile matching a Clawnch agent name
 */
function findMatchingProfile(agentName, twitterUrl) {
  const profiles = listProfiles();
  
  for (const profile of profiles) {
    // Match by handle/name (case-insensitive)
    if (profile.handle && agentName && 
        profile.handle.toLowerCase() === agentName.toLowerCase()) return profile;
    if (profile.name && agentName &&
        profile.name.toLowerCase() === agentName.toLowerCase()) return profile;
    
    // Match by X handle from Clawnch twitterUrl
    if (twitterUrl && profile.verifications) {
      const xHandle = twitterUrl.replace(/^https?:\/\/(x\.com|twitter\.com)\//, '').split('/')[0].toLowerCase();
      const profileX = (profile.verifications.twitter?.username || '').toLowerCase();
      if (twitterHandle && profileX && twitterHandle === profileTwitter) return profile;
    }
    
    // Match by ID
    const normalizedId = 'agent_' + (agentName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (profile.id === normalizedId) return profile;
  }
  
  return null;
}

/**
 * Get trust data for a specific Clawnch token
 */
async function verifyClawnchToken(tokenAddress) {
  const tokens = await fetchClawnchTokens();
  const token = tokens.find(t => t.address.toLowerCase() === tokenAddress.toLowerCase());
  
  if (!token) {
    return { found: false, error: 'Token not found on Clawnch' };
  }
  
  const profile = findMatchingProfile(token.agent, token.twitterUrl);
  
  const result = {
    found: true,
    token: {
      symbol: token.symbol,
      name: token.name,
      address: token.address,
      agent: token.agent,
      source: token.source,
      launchedAt: token.launchedAt,
      clankerUrl: token.clanker_url,
      explorerUrl: token.explorer_url,
    },
    agentfolio: null,
    verified: false,
    trustScore: 0,
    tier: 'unverified',
    riskLevel: 'unknown',
  };
  
  if (profile) {
    const fullProfile = loadProfile(profile.id);
    if (fullProfile) {
      const reputation = calculateReputation(fullProfile);
      const tier = getTierInfo(reputation.score);
      const verificationCount = Object.keys(fullProfile.verifications || {}).length;
      
      result.agentfolio = {
        profileId: fullProfile.id,
        name: fullProfile.name,
        handle: fullProfile.handle,
        profileUrl: `https://agentfolio.bot/profile/${fullProfile.id}`,
        verifications: Object.keys(fullProfile.verifications || {}),
        verificationCount,
        createdAt: fullProfile.createdAt,
      };
      result.verified = verificationCount > 0;
      result.trustScore = reputation.score;
      result.tier = tier.name;
      result.riskLevel = reputation.score >= 70 ? 'low' : reputation.score >= 40 ? 'medium' : 'high';
    }
  }
  
  return result;
}

// Stats cache
let statsCache = null;
let statsCacheTimestamp = 0;
const STATS_CACHE_TTL = 10 * 60 * 1000; // 10 min

/**
 * Get stats: verified vs unverified Clawnch tokens
 */
async function getClawnchStats() {
  if (statsCache && Date.now() - statsCacheTimestamp < STATS_CACHE_TTL) return statsCache;
  
  const tokens = await fetchClawnchTokens();
  
  // Pre-build profile lookup index for performance
  const profiles = listProfiles();
  const handleIndex = new Map();
  const nameIndex = new Map();
  const idIndex = new Map();
  
  for (const p of profiles) {
    if (p.handle) handleIndex.set(p.handle.toLowerCase(), p);
    if (p.name) nameIndex.set(p.name.toLowerCase(), p);
    if (p.id) idIndex.set(p.id, p);
  }
  
  function fastMatch(agentName) {
    if (!agentName) return null;
    const lower = agentName.toLowerCase();
    return handleIndex.get(lower) || nameIndex.get(lower) || 
           idIndex.get('agent_' + lower.replace(/[^a-z0-9]/g, '')) || null;
  }
  
  let verified = 0, unverified = 0, totalTrustScore = 0;
  const verifiedTokens = [];
  
  // Only check first 500 tokens for performance (most recent)
  const subset = tokens.slice(0, 500);
  
  for (const token of subset) {
    const profile = fastMatch(token.agent);
    if (profile) {
      const fullProfile = loadProfile(profile.id);
      if (fullProfile && Object.keys(fullProfile.verifications || {}).length > 0) {
        const reputation = calculateReputation(fullProfile);
        verified++;
        totalTrustScore += reputation.score;
        if (verifiedTokens.length < 50) {
          verifiedTokens.push({
            symbol: token.symbol,
            address: token.address,
            agent: token.agent,
            trustScore: reputation.score,
            profileUrl: `https://agentfolio.bot/profile/${fullProfile.id}`,
          });
        }
        continue;
      }
    }
    unverified++;
  }
  
  statsCache = {
    total: tokens.length,
    sampled: subset.length,
    verified,
    unverified,
    verificationRate: subset.length > 0 ? ((verified / subset.length) * 100).toFixed(1) + '%' : '0%',
    avgTrustScore: verified > 0 ? Math.round(totalTrustScore / verified) : 0,
    verifiedTokens,
    timestamp: new Date().toISOString(),
  };
  statsCacheTimestamp = Date.now();
  return statsCache;
}

module.exports = { fetchClawnchTokens, verifyClawnchToken, getClawnchStats };
