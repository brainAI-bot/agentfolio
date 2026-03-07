/**
 * Discord Verification
 * Verify agent's Discord handle ownership via OAuth2
 * 
 * Flow:
 * 1. Agent clicks "Verify Discord" → gets redirect URL
 * 2. Agent authorizes on Discord
 * 3. Discord redirects back with code
 * 4. We exchange code for token, get user info
 * 5. Profile shows verified Discord badge
 * 
 * Setup:
 * 1. Create Discord app at https://discord.com/developers/applications
 * 2. Add redirect URI: https://agentfolio.bot/api/verify/discord/callback
 * 3. Set env vars: DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');

// Store pending verifications and verified accounts
const DATA_DIR = path.join(__dirname, '../../data');
const PENDING_FILE = path.join(DATA_DIR, 'discord-pending.json');
const VERIFIED_FILE = path.join(DATA_DIR, 'discord-verified.json');

// Discord OAuth2 endpoints
const DISCORD_API = 'https://discord.com/api/v10';
const DISCORD_AUTH_URL = 'https://discord.com/api/oauth2/authorize';
const DISCORD_TOKEN_URL = 'https://discord.com/api/oauth2/token';

// OAuth2 settings
const REDIRECT_URI = process.env.DISCORD_REDIRECT_URI || 'https://agentfolio.bot/api/verify/discord/callback';
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const SCOPES = 'identify';

// State expiry (15 minutes)
const STATE_EXPIRY_MS = 15 * 60 * 1000;

// Ensure data files exist
function ensureDataFiles() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(PENDING_FILE)) {
    fs.writeFileSync(PENDING_FILE, '{}');
  }
  if (!fs.existsSync(VERIFIED_FILE)) {
    fs.writeFileSync(VERIFIED_FILE, '{}');
  }
}

/**
 * Load pending verifications
 */
function loadPending() {
  ensureDataFiles();
  try {
    return JSON.parse(fs.readFileSync(PENDING_FILE, 'utf8'));
  } catch (e) {
    return {};
  }
}

/**
 * Save pending verifications
 */
function savePending(data) {
  ensureDataFiles();
  fs.writeFileSync(PENDING_FILE, JSON.stringify(data, null, 2));
}

/**
 * Load verified Discord accounts
 */
function loadVerified() {
  ensureDataFiles();
  try {
    return JSON.parse(fs.readFileSync(VERIFIED_FILE, 'utf8'));
  } catch (e) {
    return {};
  }
}

/**
 * Save verified Discord accounts
 */
function saveVerified(data) {
  ensureDataFiles();
  fs.writeFileSync(VERIFIED_FILE, JSON.stringify(data, null, 2));
}

/**
 * Generate OAuth2 state token
 */
function generateState() {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Check if Discord OAuth is configured
 */
function isConfigured() {
  return !!(CLIENT_ID && CLIENT_SECRET);
}

/**
 * Start Discord verification (OAuth2 flow)
 * @param {string} profileId - Agent profile ID
 * @returns {object} - { authUrl, state } or { error }
 */
function startVerification(profileId) {
  if (!profileId) {
    return { error: 'Profile ID is required' };
  }

  if (!isConfigured()) {
    return { 
      error: 'Discord OAuth2 is not configured. Set DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET.',
      notConfigured: true
    };
  }

  // Check if already verified
  const verified = loadVerified();
  if (verified[profileId]) {
    return { 
      error: 'Discord is already verified for this profile',
      alreadyVerified: true,
      discordUser: verified[profileId].username
    };
  }

  // Generate state token
  const state = generateState();
  const expiresAt = Date.now() + STATE_EXPIRY_MS;

  // Store pending verification
  const pending = loadPending();
  pending[state] = {
    profileId,
    createdAt: Date.now(),
    expiresAt
  };
  savePending(pending);

  // Build authorization URL
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPES,
    state: state
  });

  const authUrl = `${DISCORD_AUTH_URL}?${params.toString()}`;

  return {
    success: true,
    authUrl,
    state,
    expiresAt,
    expiresIn: '15 minutes',
    instructions: 'Click the authorization URL to verify your Discord account'
  };
}

/**
 * Make HTTPS request (promise-based)
 */
function httpsRequest(url, options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ statusCode: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ statusCode: res.statusCode, data, parseError: true });
        }
      });
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

/**
 * Exchange OAuth2 code for access token
 */
async function exchangeCode(code) {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_type: 'authorization_code',
    code: code,
    redirect_uri: REDIRECT_URI
  });

  const response = await httpsRequest(DISCORD_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  }, params.toString());

  if (response.statusCode !== 200) {
    throw new Error(`Token exchange failed: ${JSON.stringify(response.data)}`);
  }

  return response.data;
}

/**
 * Get Discord user info from access token
 */
async function getDiscordUser(accessToken) {
  const response = await httpsRequest(`${DISCORD_API}/users/@me`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`
    }
  });

  if (response.statusCode !== 200) {
    throw new Error(`Failed to get user info: ${JSON.stringify(response.data)}`);
  }

  return response.data;
}

/**
 * Handle OAuth2 callback
 * @param {string} code - OAuth2 authorization code
 * @param {string} state - State token for verification
 * @returns {object} - { verified, profileId, discordUser } or { error }
 */
async function handleCallback(code, state) {
  if (!code || !state) {
    return { error: 'Authorization code and state are required' };
  }

  // Validate state
  const pending = loadPending();
  const verification = pending[state];

  if (!verification) {
    return { error: 'Invalid or expired state token' };
  }

  // Check expiry
  if (Date.now() > verification.expiresAt) {
    delete pending[state];
    savePending(pending);
    return { error: 'Verification session has expired. Please try again.' };
  }

  try {
    // Exchange code for token
    const tokenData = await exchangeCode(code);
    
    // Get user info
    const discordUser = await getDiscordUser(tokenData.access_token);

    // Check if this Discord account is already verified by another profile
    const verified = loadVerified();
    const existingProfile = Object.entries(verified).find(
      ([id, data]) => data.discordId === discordUser.id && id !== verification.profileId
    );
    
    if (existingProfile) {
      delete pending[state];
      savePending(pending);
      return { 
        error: 'This Discord account is already verified by another profile',
        existingProfileId: existingProfile[0]
      };
    }

    // Mark as verified
    verified[verification.profileId] = {
      discordId: discordUser.id,
      username: discordUser.username,
      discriminator: discordUser.discriminator || '0',
      globalName: discordUser.global_name || null,
      avatar: discordUser.avatar,
      verifiedAt: new Date().toISOString()
    };
    saveVerified(verified);

    // Remove pending verification
    delete pending[state];
    savePending(pending);

    return {
      verified: true,
      profileId: verification.profileId,
      discordUser: {
        id: discordUser.id,
        username: discordUser.username,
        discriminator: discordUser.discriminator,
        globalName: discordUser.global_name,
        avatar: discordUser.avatar
      },
      message: 'Discord verification successful!'
    };
  } catch (error) {
    console.error('[Discord Verify] Error:', error);
    return { error: `Verification failed: ${error.message}` };
  }
}

/**
 * Check if a profile has verified Discord
 * @param {string} profileId - Agent profile ID
 * @returns {object|null} - Verification data or null
 */
function getVerificationStatus(profileId) {
  const verified = loadVerified();
  return verified[profileId] || null;
}

/**
 * Check pending verification status
 * @param {string} profileId - Agent profile ID
 * @returns {object|null} - Pending verification info or null
 */
function getPendingVerification(profileId) {
  const pending = loadPending();
  const entry = Object.entries(pending).find(
    ([state, data]) => data.profileId === profileId && Date.now() < data.expiresAt
  );
  
  if (!entry) return null;
  
  const [state, data] = entry;
  return {
    state,
    expiresAt: data.expiresAt,
    expiresIn: Math.round((data.expiresAt - Date.now()) / 1000 / 60) + ' minutes'
  };
}

/**
 * Remove Discord verification from a profile
 * @param {string} profileId - Agent profile ID
 */
function removeVerification(profileId) {
  const verified = loadVerified();
  if (verified[profileId]) {
    delete verified[profileId];
    saveVerified(verified);
    return { success: true, message: 'Discord verification removed' };
  }
  return { error: 'No Discord verification found for this profile' };
}

/**
 * Clean up expired pending verifications
 */
function cleanupExpired() {
  const pending = loadPending();
  const now = Date.now();
  let cleaned = 0;
  
  for (const [state, data] of Object.entries(pending)) {
    if (now > data.expiresAt) {
      delete pending[state];
      cleaned++;
    }
  }
  
  if (cleaned > 0) {
    savePending(pending);
  }
  
  return { cleaned };
}

/**
 * Get all verified Discord accounts (for admin/stats)
 */
function getAllVerified() {
  return loadVerified();
}

/**
 * Get Discord avatar URL
 */
function getAvatarUrl(userId, avatarHash, size = 128) {
  if (!avatarHash) {
    // Default avatar
    const defaultIndex = parseInt(userId) % 5;
    return `https://cdn.discordapp.com/embed/avatars/${defaultIndex}.png`;
  }
  const format = avatarHash.startsWith('a_') ? 'gif' : 'png';
  return `https://cdn.discordapp.com/avatars/${userId}/${avatarHash}.${format}?size=${size}`;
}

/**
 * Format Discord username (handles new username system)
 */
function formatUsername(username, discriminator) {
  if (!discriminator || discriminator === '0') {
    return `@${username}`;
  }
  return `${username}#${discriminator}`;
}

module.exports = {
  startVerification,
  handleCallback,
  getVerificationStatus,
  getPendingVerification,
  removeVerification,
  cleanupExpired,
  getAllVerified,
  getAvatarUrl,
  formatUsername,
  isConfigured,
  STATE_EXPIRY_MS
};
