/**
 * Twitter/X Verification for AgentFolio
 * Verifies agent X accounts through bio link or tweet proof
 * Updated: Uses vxtwitter API (Nitter instances are dead)
 */

const https = require('https');

/**
 * Verify X account by checking if bio contains AgentFolio link
 * Uses vxtwitter API for profile data
 */
async function verifyXBio(username, agentId) {
  const expectedLink = `agentfolio.bot/profile/${agentId}`;
  
  try {
    const profile = await fetchXProfile(username);
    
    if (!profile) {
      return { verified: false, error: 'Could not fetch profile' };
    }

    // Check if bio/description contains AgentFolio link
    const bio = (profile.description || profile.text || '').toLowerCase();
    const containsLink = bio.includes(expectedLink.toLowerCase()) ||
                         bio.includes('agentfolio.bot');
    
    return {
      verified: containsLink,
      method: 'bio_link',
      username: profile.user_name || username,
      followers: profile.followers || 0,
      checkedAt: new Date().toISOString(),
      message: containsLink 
        ? 'X bio contains AgentFolio link' 
        : 'Add agentfolio.bot link to X bio to verify'
    };
  } catch (e) {
    return { verified: false, error: e.message };
  }
}

/**
 * Fetch X profile data via vxtwitter API (free, no auth needed)
 */
async function fetchXProfile(username) {
  const cleanUsername = username.replace('@', '').trim();
  
  // Use fxtwitter API (free, no auth, returns user profile data)
  try {
    const data = await httpGetJSON(`https://api.fxtwitter.com/${cleanUsername}`);
    if (data && data.user) {
      return {
        user_name: data.user.screen_name || cleanUsername,
        description: data.user.description || '',
        followers: data.user.followers || 0,
        following: data.user.following || 0,
        website: data.user.website?.url || '',
        avatar: data.user.avatar_url || '',
      };
    }
  } catch (e) {
    // fxtwitter failed, continue to fallback
  }

  // Fallback: try vxtwitter with a recent tweet approach
  try {
    const vxData = await httpGetJSON(`https://api.vxtwitter.com/${cleanUsername}`);
    if (vxData && (vxData.user_name || vxData.user)) {
      return {
        user_name: vxData.user_name || vxData.user?.screen_name || cleanUsername,
        description: vxData.user?.description || vxData.text || '',
        followers: vxData.user?.followers_count || 0,
        following: vxData.user?.friends_count || 0,
      };
    }
  } catch (e) {}
  
  return null;
}

/**
 * Verify X by checking for a specific verification tweet
 */
async function verifyTwitterTweet(username, agentId) {
  const verificationPattern = `agentfolio.bot/profile/${agentId}`;
  
  return {
    verified: false,
    method: 'verification_tweet',
    message: `Tweet "Verifying my AgentFolio profile: agentfolio.bot/profile/${agentId} #AgentFolio" to verify. Use the hardened verification flow for challenge-based proof.`
  };
}

/**
 * Get X follower count via vxtwitter
 */
async function getXStats(username) {
  try {
    const profile = await fetchXProfile(username);
    if (!profile) return { followers: 0, following: 0 };

    return {
      followers: profile.followers || 0,
      following: profile.following || 0,
      fetchedAt: new Date().toISOString()
    };
  } catch (e) {
    return { followers: 0, following: 0, error: e.message };
  }
}

/**
 * HTTPS GET returning JSON
 */
function httpGetJSON(url) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; AgentFolio/1.0)',
        'Accept': 'application/json'
      }
    };

    https.get(options, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        httpGetJSON(res.headers.location).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        resolve(null);
        return;
      }
      
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(null);
        }
      });
    }).on('error', () => resolve(null));
  });
}

/**
 * Simple HTTPS GET (kept for backwards compatibility)
 */
function httpGet(url) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; AgentFolio/1.0)'
      }
    };

    https.get(options, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        httpGet(res.headers.location).then(resolve).catch(reject);
        return;
      }
      
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

module.exports = {
  verifyXBio,
  verifyTwitterTweet,
  getXStats,
  fetchXProfile
};
