/**
 * Telegram Verification — Operator Verification (no bot required)
 * 
 * Verifies the human operator behind an agent has a Telegram account.
 * Similar to X verification: put a challenge code in your Telegram bio.
 * 
 * Flow:
 * 1. POST /api/profile/:id/verify/telegram/initiate — returns challenge code
 * 2. Operator adds "agentfolio:CODE" to their Telegram bio
 * 3. POST /api/profile/:id/verify/telegram/complete — server checks bio via API
 */
const crypto = require("crypto");
const https = require("https");

const challenges = new Map();
const CHALLENGE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const MAX_CHALLENGES_PER_PROFILE = 30;

function generateCode() {
  return crypto.randomBytes(3).toString("hex").toUpperCase();
}

/**
 * Initiate Telegram verification — returns challenge code for bio
 */
function initiateTelegramVerification(profileId, telegramHandle) {
  const handle = (telegramHandle || "").trim().replace(/^@/, "").toLowerCase();
  if (!handle || handle.length < 2 || handle.length > 64) {
    throw new Error("Invalid Telegram handle");
  }

  // Rate limit
  let count = 0;
  const oneHourAgo = Date.now() - 3600000;
  for (const [, ch] of challenges) {
    if (ch.profileId === profileId && ch.createdAt > oneHourAgo) count++;
  }
  if (count >= MAX_CHALLENGES_PER_PROFILE) {
    throw new Error("Too many verification attempts. Try again in 1 hour.");
  }

  const challengeId = crypto.randomUUID();
  const code = generateCode();
  const nonce = crypto.randomBytes(8).toString("hex");

  challenges.set(challengeId, {
    profileId,
    telegramHandle: handle,
    code,
    nonce,
    createdAt: Date.now(),
  });

  // Cleanup expired
  for (const [id, ch] of challenges) {
    if (Date.now() - ch.createdAt > CHALLENGE_TTL_MS) challenges.delete(id);
  }

  return {
    success: true,
    challengeId,
    telegramHandle: handle,
    code,
    instructions: "Add this to your Telegram bio temporarily:\n\nagentfolio:" + code + "\n\nThen click Verify below. You can remove it from your bio after verification.",
    expiresIn: "30 minutes",
  };
}

/**
 * Unused — kept for backward compat
 */
function markBotVerified() {
  return { matched: false };
}

/**
 * Complete Telegram verification
 * Checks Telegram bio for the challenge code via public t.me page
 */
async function completeTelegramVerification(challengeId, options) {
  options = options || {};
  const ch = challenges.get(challengeId);
  if (!ch) throw new Error("Challenge not found or expired");
  if (Date.now() - ch.createdAt > CHALLENGE_TTL_MS) {
    challenges.delete(challengeId);
    throw new Error("Challenge expired (30 minute limit). Please initiate a new verification.");
  }

  // Try to fetch Telegram bio via public page
  let bioVerified = false;
  try {
    const bioText = await fetchTelegramBio(ch.telegramHandle);
    if (bioText && bioText.includes("agentfolio:" + ch.code)) {
      bioVerified = true;
    }
  } catch (e) {
    console.warn("[Telegram-Verify] Bio fetch failed:", e.message);
  }

  if (bioVerified) {
    try {
      const profileStore = require("../profile-store");
      profileStore.addVerification(ch.profileId, "telegram", ch.telegramHandle, {
        challengeId,
        handle: ch.telegramHandle,
        method: "bio_challenge",
        nonce: ch.nonce,
        verifiedAt: new Date().toISOString(),
      });
    } catch (e) {
      console.error("[Telegram-Verify] Failed to save:", e.message);
    }

    challenges.delete(challengeId);
    return {
      verified: true,
      platform: "telegram",
      handle: ch.telegramHandle,
      profileId: ch.profileId,
      method: "bio_challenge",
      message: "Telegram operator verified via bio challenge",
    };
  }

  // Manual confirmation fallback (admin use)
  if (options.manualConfirm) {
    try {
      const profileStore = require("../profile-store");
      profileStore.addVerification(ch.profileId, "telegram", ch.telegramHandle, {
        challengeId,
        handle: ch.telegramHandle,
        method: "manual_confirm",
        nonce: ch.nonce,
        verifiedAt: new Date().toISOString(),
      });
    } catch (e) {
      console.error("[Telegram-Verify] Failed to save:", e.message);
    }
    challenges.delete(challengeId);
    return {
      verified: true,
      platform: "telegram",
      handle: ch.telegramHandle,
      profileId: ch.profileId,
      method: "manual_confirm",
      message: "Telegram operator verified (manual confirmation)",
    };
  }

  return {
    verified: false,
    error: "Code not found in @" + ch.telegramHandle + "'s Telegram bio. Add \"agentfolio:" + ch.code + "\" to your bio, then try again.",
    code: ch.code,
    telegramHandle: ch.telegramHandle,
    hint: "Add agentfolio:" + ch.code + " to your Telegram bio, wait a moment, then click Verify again.",
  };
}

/**
 * Fetch a Telegram user bio via the public t.me page
 */
function fetchTelegramBio(username) {
  return new Promise(function(resolve, reject) {
    var req = https.get(
      "https://t.me/" + username,
      { headers: { "User-Agent": "Mozilla/5.0" }, timeout: 8000 },
      function(res) {
        var html = "";
        res.on("data", function(c) { html += c; });
        res.on("end", function() {
          // Extract bio from tgme_page_description or og:description
          var descMatch = html.match(/class="tgme_page_description[^"]*"[^>]*>([^<]*)</);
          var ogMatch = html.match(/property="og:description"\s+content="([^"]*)"/);
          var bio = (descMatch && descMatch[1]) || (ogMatch && ogMatch[1]) || "";
          resolve(bio.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">"));
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", function() { req.destroy(); reject(new Error("timeout")); });
  });
}

module.exports = {
  initiateTelegramVerification,
  completeTelegramVerification,
  markBotVerified,
};
