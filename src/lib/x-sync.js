/**
 * X Profile Sync for AgentFolio
 * Pulls avatar, bio, follower count, and recent tweets from X API v2
 * Syncs to agent profiles that have a linked X handle
 */

const https = require('https');
const crypto = require('crypto');

// X API v1.1 OAuth credentials from env
const CONSUMER_KEY = process.env.X_CONSUMER_KEY;
const CONSUMER_SECRET = process.env.X_CONSUMER_SECRET;
const ACCESS_TOKEN = process.env.X_ACCESS_TOKEN;
const ACCESS_TOKEN_SECRET = process.env.X_ACCESS_TOKEN_SECRET;

/**
 * Generate OAuth 1.0a signature for X API v1.1
 */
function oauthSign(method, url, params = {}) {
  const oauthParams = {
    oauth_consumer_key: CONSUMER_KEY,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: ACCESS_TOKEN,
    oauth_version: '1.0',
    ...params
  };

  const allParams = { ...oauthParams };
  const paramString = Object.keys(allParams)
    .sort()
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(allParams[k])}`)
    .join('&');

  const baseString = `${method}&${encodeURIComponent(url)}&${encodeURIComponent(paramString)}`;
  const signingKey = `${encodeURIComponent(CONSUMER_SECRET)}&${encodeURIComponent(ACCESS_TOKEN_SECRET)}`;
  const signature = crypto.createHmac('sha1', signingKey).update(baseString).digest('base64');

  oauthParams.oauth_signature = signature;

  const authHeader = 'OAuth ' + Object.keys(oauthParams)
    .sort()
    .map(k => `${encodeURIComponent(k)}="${encodeURIComponent(oauthParams[k])}"`)
    .join(', ');

  return authHeader;
}

/**
 * Make authenticated X API request
 */
function twitterGet(endpoint, queryParams = {}) {
  return new Promise((resolve, reject) => {
    const baseUrl = `https://api.twitter.com${endpoint}`;
    const qs = Object.entries(queryParams)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
    const fullUrl = qs ? `${baseUrl}?${qs}` : baseUrl;
    
    const authHeader = oauthSign('GET', baseUrl, queryParams);

    const urlObj = new URL(fullUrl);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      headers: {
        'Authorization': authHeader,
        'User-Agent': 'AgentFolio/1.0'
      }
    };

    https.get(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode === 200) {
            resolve(json);
          } else {
            reject(new Error(`X API ${res.statusCode}: ${JSON.stringify(json.errors || json)}`));
          }
        } catch (e) {
          reject(new Error(`X parse error: ${e.message}`));
        }
      });
    }).on('error', reject);
  });
}

/**
 * Fetch X user data by username
 * Returns: { id, name, username, bio, avatar, followers, following, tweets, verified, location, url, createdAt }
 */
async function fetchXUser(username) {
  if (!CONSUMER_KEY || !ACCESS_TOKEN) {
    throw new Error('X API credentials not configured');
  }

  const cleanUsername = username.replace(/^@/, '').trim();
  if (!cleanUsername) throw new Error('Invalid username');

  // Try v2 first (free tier has users/by/username), fallback to scraping
  try {
    const data = await twitterGet('/2/users/by/username/' + cleanUsername, {
      'user.fields': 'description,profile_image_url,public_metrics,created_at,location,url,verified'
    });
    
    if (data.data) {
      const u = data.data;
      return {
        twitterId: u.id,
        name: u.name,
        username: u.username,
        bio: u.description || '',
        avatar: u.profile_image_url?.replace('_normal', '_400x400') || null,
        banner: null,
        followers: u.public_metrics?.followers_count || 0,
        following: u.public_metrics?.following_count || 0,
        tweets: u.public_metrics?.tweet_count || 0,
        verified: u.verified || false,
        location: u.location || '',
        url: u.url || '',
        createdAt: u.created_at || null,
        syncedAt: new Date().toISOString()
      };
    }
    throw new Error('No data returned');
  } catch (e) {
    // Fallback: scrape basic info from page
    return await scrapeTwitterProfile(cleanUsername);
  }
}

/**
 * Sync X data to an agent profile
 * Updates: avatar (if not custom), bio supplement, follower stats
 */
async function syncXToProfile(profile, { saveProfile, logger }) {
  const handle = profile.links?.twitter?.replace(/^@/, '');
  if (!handle) return { synced: false, reason: 'No X handle' };

  try {
    const xData = await fetchXUser(handle);

    // Build twitter sync data on profile
    const xSync = {
      ...twitterData,
      lastSyncAt: new Date().toISOString()
    };

    // Update profile
    if (!profile.xSync) profile.xSync = {};
    profile.xSync = xSync;

    // If agent has no avatar, use X avatar
    if (!profile.avatar && twitterData.avatar) {
      profile.avatar = twitterData.avatar;
    }

    // Store follower count for reputation scoring
    if (!profile.metrics) profile.metrics = {};
    profile.metrics.twitterFollowers = twitterData.followers;
    profile.metrics.twitterTweets = twitterData.tweets;

    saveProfile(profile);

    if (logger) {
      logger.info('X sync complete', {
        profileId: profile.id,
        handle,
        followers: twitterData.followers
      });
    }

    return { synced: true, data: twitterData };
  } catch (e) {
    if (logger) {
      logger.error('X sync failed', {
        profileId: profile.id,
        handle,
        error: e.message
      });
    }
    return { synced: false, error: e.message };
  }
}

/**
 * Batch sync all profiles with X handles
 * Rate limit: ~300 requests per 15 min window on v1.1
 */
async function syncAllProfiles({ listProfiles, loadProfile, saveProfile, logger }) {
  const profiles = listProfiles();
  const results = { synced: 0, failed: 0, skipped: 0, errors: [] };

  for (const p of profiles) {
    const profile = loadProfile(p.id);
    if (!profile?.links?.x) {
      results.skipped++;
      continue;
    }

    // Skip if synced in last 6 hours
    if (profile.xSync?.lastSyncAt) {
      const lastSync = new Date(profile.xSync.lastSyncAt).getTime();
      if (Date.now() - lastSync < 6 * 60 * 60 * 1000) {
        results.skipped++;
        continue;
      }
    }

    try {
      const result = await syncXToProfile(profile, { saveProfile, logger });
      if (result.synced) results.synced++;
      else results.failed++;
      
      // Rate limit: 100ms between requests
      await new Promise(r => setTimeout(r, 100));
    } catch (e) {
      results.failed++;
      results.errors.push({ id: p.id, error: e.message });
    }
  }

  if (logger) {
    logger.info('X batch sync complete', results);
  }

  return results;
}

/**
 * Scrape basic X profile data when API access is limited
 * Uses syndication API (public, no auth needed)
 */
async function scrapeTwitterProfile(username) {
  return new Promise((resolve, reject) => {
    const url = `https://syndication.twitter.com/srv/timeline-profile/screen-name/${username}`;
    const options = {
      hostname: 'syndication.twitter.com',
      path: `/srv/timeline-profile/screen-name/${username}`,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AgentFolio/1.0)' }
    };

    https.get(options, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // Follow redirect
        const rUrl = new URL(res.headers.location);
        https.get({ hostname: rUrl.hostname, path: rUrl.pathname + rUrl.search, headers: options.headers }, (res2) => {
          let data = '';
          res2.on('data', c => data += c);
          res2.on('end', () => parsesynd(data, username, resolve, reject));
        }).on('error', reject);
        return;
      }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => parsesynd(data, username, resolve, reject));
    }).on('error', reject);
  });
}

function parsesynd(html, username, resolve, reject) {
  try {
    // Extract name
    const nameMatch = html.match(/data-testid="UserName"[^>]*>([^<]+)/);
    // Extract avatar
    const avatarMatch = html.match(/src="(https:\/\/pbs\.twimg\.com\/profile_images\/[^"]+)"/);
    // Extract bio
    const bioMatch = html.match(/data-testid="UserDescription"[^>]*>([^<]+)/);

    resolve({
      twitterId: null,
      name: nameMatch?.[1]?.trim() || username,
      username,
      bio: bioMatch?.[1] || '',
      avatar: avatarMatch?.[1]?.replace('_normal', '_400x400') || null,
      banner: null,
      followers: 0,
      following: 0,
      tweets: 0,
      verified: false,
      location: '',
      url: '',
      createdAt: null,
      syncedAt: new Date().toISOString(),
      method: 'scrape'
    });
  } catch (e) {
    reject(new Error('Scrape failed: ' + e.message));
  }
}

module.exports = {
  fetchXUser,
  syncXToProfile,
  syncAllProfiles
};
