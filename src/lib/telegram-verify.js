/**
 * Telegram Verification
 * Verify agent's Telegram handle ownership
 * 
 * Flow:
 * 1. Agent requests verification code via API
 * 2. Code is stored with expiry (15 minutes)
 * 3. Agent sends code to AgentFolio Telegram bot
 * 4. Bot calls webhook to confirm verification
 * 5. Profile shows verified Telegram badge
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Store pending verifications
const DATA_DIR = path.join(__dirname, '../../data');
const PENDING_FILE = path.join(DATA_DIR, 'telegram-pending.json');
const VERIFIED_FILE = path.join(DATA_DIR, 'telegram-verified.json');

// Verification code expiry (15 minutes)
const CODE_EXPIRY_MS = 15 * 60 * 1000;

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
 * Load verified Telegram accounts
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
 * Save verified Telegram accounts
 */
function saveVerified(data) {
  ensureDataFiles();
  fs.writeFileSync(VERIFIED_FILE, JSON.stringify(data, null, 2));
}

/**
 * Generate a unique verification code
 */
function generateVerificationCode() {
  // 6-character alphanumeric code (easy to type)
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

/**
 * Start Telegram verification process
 * @param {string} profileId - Agent profile ID
 * @param {string} telegramHandle - Telegram username (without @)
 * @returns {object} - { code, expiresAt, botUsername }
 */
function startVerification(profileId, telegramHandle) {
  if (!profileId || !telegramHandle) {
    return { error: 'Profile ID and Telegram handle are required' };
  }

  // Normalize handle (remove @ if present)
  const handle = telegramHandle.replace(/^@/, '').toLowerCase();
  
  // Check if already verified
  const verified = loadVerified();
  if (verified[profileId]?.telegram === handle) {
    return { 
      error: 'This Telegram handle is already verified for this profile',
      alreadyVerified: true 
    };
  }

  // Check if handle is verified by another profile
  const existingProfile = Object.entries(verified).find(
    ([id, data]) => data.telegram === handle && id !== profileId
  );
  if (existingProfile) {
    return { 
      error: 'This Telegram handle is already verified by another profile',
      existingProfileId: existingProfile[0]
    };
  }

  // Generate code
  const code = generateVerificationCode();
  const expiresAt = Date.now() + CODE_EXPIRY_MS;

  // Store pending verification
  const pending = loadPending();
  pending[code] = {
    profileId,
    telegramHandle: handle,
    createdAt: Date.now(),
    expiresAt
  };
  savePending(pending);

  return {
    success: true,
    code,
    expiresAt,
    expiresIn: '15 minutes',
    botUsername: 'AgentFolioBot', // TODO: Replace with actual bot username
    instructions: `Send this code to @AgentFolioBot on Telegram: ${code}`
  };
}

/**
 * Verify code (called by Telegram bot webhook)
 * @param {string} code - Verification code
 * @param {string} telegramUserId - Telegram user ID from bot
 * @param {string} telegramUsername - Telegram username from bot
 * @returns {object} - { verified, profileId } or { error }
 */
function verifyCode(code, telegramUserId, telegramUsername) {
  if (!code) {
    return { error: 'Verification code is required' };
  }

  const pending = loadPending();
  const normalizedCode = code.toUpperCase().trim();
  const verification = pending[normalizedCode];

  if (!verification) {
    return { error: 'Invalid verification code' };
  }

  // Check expiry
  if (Date.now() > verification.expiresAt) {
    // Clean up expired code
    delete pending[normalizedCode];
    savePending(pending);
    return { error: 'Verification code has expired. Please request a new one.' };
  }

  // Verify username matches (if provided in initial request)
  const normalizedUsername = (telegramUsername || '').replace(/^@/, '').toLowerCase();
  if (verification.telegramHandle && normalizedUsername !== verification.telegramHandle) {
    return { 
      error: 'Telegram username does not match the requested handle',
      expected: verification.telegramHandle,
      received: normalizedUsername
    };
  }

  // Mark as verified
  const verified = loadVerified();
  verified[verification.profileId] = {
    telegram: normalizedUsername || verification.telegramHandle,
    telegramId: telegramUserId,
    verifiedAt: new Date().toISOString()
  };
  saveVerified(verified);

  // Remove pending verification
  delete pending[normalizedCode];
  savePending(pending);

  return {
    verified: true,
    profileId: verification.profileId,
    telegramHandle: normalizedUsername || verification.telegramHandle,
    telegramId: telegramUserId,
    message: 'Telegram verification successful!'
  };
}

/**
 * Check if a profile has verified Telegram
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
    ([code, data]) => data.profileId === profileId && Date.now() < data.expiresAt
  );
  
  if (!entry) return null;
  
  const [code, data] = entry;
  return {
    code,
    telegramHandle: data.telegramHandle,
    expiresAt: data.expiresAt,
    expiresIn: Math.round((data.expiresAt - Date.now()) / 1000 / 60) + ' minutes'
  };
}

/**
 * Remove Telegram verification from a profile
 * @param {string} profileId - Agent profile ID
 */
function removeVerification(profileId) {
  const verified = loadVerified();
  if (verified[profileId]) {
    delete verified[profileId];
    saveVerified(verified);
    return { success: true, message: 'Telegram verification removed' };
  }
  return { error: 'No Telegram verification found for this profile' };
}

/**
 * Clean up expired pending verifications
 */
function cleanupExpired() {
  const pending = loadPending();
  const now = Date.now();
  let cleaned = 0;
  
  for (const [code, data] of Object.entries(pending)) {
    if (now > data.expiresAt) {
      delete pending[code];
      cleaned++;
    }
  }
  
  if (cleaned > 0) {
    savePending(pending);
  }
  
  return { cleaned };
}

/**
 * Get all verified Telegram accounts (for admin/stats)
 */
function getAllVerified() {
  return loadVerified();
}

module.exports = {
  startVerification,
  verifyCode,
  getVerificationStatus,
  getPendingVerification,
  removeVerification,
  cleanupExpired,
  getAllVerified,
  CODE_EXPIRY_MS
};
