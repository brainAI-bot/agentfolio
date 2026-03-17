/**
 * Telegram Verification Module
 * Challenge-based: user posts a code in a Telegram group/channel, we verify via bot.
 * For MVP: challenge code stored in memory, user DMs the bot or posts in verified channel.
 */
const crypto = require('crypto');
const path = require('path');

// In-memory challenge store (prod should use DB)
const challenges = new Map();
const CHALLENGE_TTL_MS = 15 * 60 * 1000; // 15 minutes

function generateChallengeCode() {
  return 'AF-TG-' + crypto.randomBytes(4).toString('hex').toUpperCase();
}

async function initiateTelegramVerification(profileId, telegramUsername) {
  const clean = telegramUsername.replace(/^@/, '').trim();
  if (!clean) throw new Error('Invalid Telegram username');

  const code = generateChallengeCode();
  const challengeId = crypto.randomUUID();

  challenges.set(challengeId, {
    profileId,
    telegramUsername: clean,
    code,
    createdAt: Date.now(),
    verified: false,
  });

  // Cleanup old challenges
  for (const [id, ch] of challenges) {
    if (Date.now() - ch.createdAt > CHALLENGE_TTL_MS) challenges.delete(id);
  }

  return {
    success: true,
    challengeId,
    code,
    telegramUsername: clean,
    instructions: `Send this code to our verification bot @AgentFolioBot on Telegram: ${code}\n\nOr post it in your Telegram bio temporarily.`,
    expiresIn: '15 minutes',
  };
}

async function verifyTelegramChallenge(challengeId, messageUrl) {
  const ch = challenges.get(challengeId);
  if (!ch) throw new Error('Challenge not found or expired');
  if (Date.now() - ch.createdAt > CHALLENGE_TTL_MS) {
    challenges.delete(challengeId);
    throw new Error('Challenge expired');
  }

  // For MVP: trust the messageUrl contains the code (manual verification)
  // In production: use Telegram Bot API to verify the message
  // Mark as verified if user provides the URL
  if (!messageUrl) throw new Error('Please provide the message URL or screenshot');

  ch.verified = true;

  // Save verification to DB
  try {
    const profileStore = require('./profile-store');
    profileStore.addVerification(ch.profileId, 'telegram', ch.telegramUsername, {
      challengeId,
      telegramUsername: ch.telegramUsername,
      messageUrl,
      verifiedAt: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[TelegramVerify] Failed to save:', e.message);
  }

  challenges.delete(challengeId);

  return {
    verified: true,
    platform: 'telegram',
    identifier: ch.telegramUsername,
    profileId: ch.profileId,
  };
}

function getTelegramVerificationStatus(challengeId) {
  const ch = challenges.get(challengeId);
  if (!ch) return { found: false };
  return {
    found: true,
    verified: ch.verified,
    telegramUsername: ch.telegramUsername,
    expiresAt: new Date(ch.createdAt + CHALLENGE_TTL_MS).toISOString(),
  };
}

module.exports = {
  initiateTelegramVerification,
  verifyTelegramChallenge,
  getTelegramVerificationStatus,
};
