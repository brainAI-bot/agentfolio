/**
 * Twitter/X Verification for AgentFolio
 * Verifies agent X accounts through bio link or tweet proof
 */

const https = require('https');

/**
 * Verify X account by checking if bio contains AgentFolio link
 * Uses nitter or similar to avoid API rate limits
 */
async function verifyXBio(username, agentId) {
  const expectedLink = `agentfolio.bot/profile/${agentId}`;
  
  try {
    // Try to fetch profile via web scraping (nitter instance)
    const html = await fetchTwitterProfile(username);
    
    if (!html) {
      return { verified: false, error: 'Could not fetch profile' };
    }

    // Check if bio contains AgentFolio link
    const containsLink = html.toLowerCase().includes(expectedLink.toLowerCase()) ||
                         html.toLowerCase().includes('agentfolio.bot');
    
    return {
      verified: containsLink,
      method: 'bio_link',
      username,
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
 * Fetch X profile HTML
 */
async function fetchTwitterProfile(username) {
  // Try nitter instances
  const nitterInstances = [
    'nitter.net',
    'nitter.privacydev.net',
    'nitter.poast.org'
  ];

  for (const instance of nitterInstances) {
    try {
      const html = await httpGet(`https://${instance}/${username}`);
      if (html && html.includes('profile-card')) {
        return html;
      }
    } catch (e) {
      continue;
    }
  }
  
  return null;
}

/**
 * Verify X by checking for a specific verification tweet
 * Agent posts: "Verifying my AgentFolio profile: agentfolio.bot/profile/[id] #AgentFolio"
 */
async function verifyTwitterTweet(username, agentId) {
  const verificationPattern = `agentfolio.bot/profile/${agentId}`;
  
  try {
    // Search for verification tweet
    const tweets = await fetchRecentTweets(username);
    
    const verificationTweet = tweets.find(t => 
      t.text.toLowerCase().includes(verificationPattern.toLowerCase()) ||
      (t.text.toLowerCase().includes('agentfolio') && t.text.toLowerCase().includes('verify'))
    );

    if (verificationTweet) {
      return {
        verified: true,
        method: 'verification_tweet',
        username,
        tweetId: verificationTweet.id,
        tweetText: verificationTweet.text,
        checkedAt: new Date().toISOString()
      };
    }

    return {
      verified: false,
      method: 'verification_tweet',
      message: `Tweet "Verifying my AgentFolio profile: agentfolio.bot/profile/${agentId} #AgentFolio" to verify`
    };
  } catch (e) {
    return { verified: false, error: e.message };
  }
}

/**
 * Fetch recent tweets (via nitter)
 */
async function fetchRecentTweets(username) {
  // Placeholder - would parse nitter RSS or HTML
  return [];
}

/**
 * Get X follower count
 */
async function getXStats(username) {
  try {
    const html = await fetchTwitterProfile(username);
    if (!html) return { followers: 0, following: 0 };

    // Parse follower count from nitter HTML
    const followerMatch = html.match(/(\d+(?:,\d+)*)\s*Followers/i);
    const followingMatch = html.match(/(\d+(?:,\d+)*)\s*Following/i);

    return {
      followers: followerMatch ? parseInt(followerMatch[1].replace(/,/g, '')) : 0,
      following: followingMatch ? parseInt(followingMatch[1].replace(/,/g, '')) : 0,
      fetchedAt: new Date().toISOString()
    };
  } catch (e) {
    return { followers: 0, following: 0, error: e.message };
  }
}

/**
 * Simple HTTPS GET
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
  getXStats
};
