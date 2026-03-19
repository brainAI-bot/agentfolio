/**
 * Hardened Verification Routes — Sprint 2
 * 
 * All verification routes that require cryptographic proof:
 * - Hyperliquid: EIP-191 wallet signature
 * - Polymarket: EIP-191 wallet signature
 * - Moltbook: Cryptographic nonce in bio + 30min expiry
 * - Website: .well-known token with crypto nonce + 30min expiry
 * - Telegram: Challenge code via bot DM + 30min expiry
 * - Discord: Challenge string via bot DM (already hardened)
 * 
 * Already hardened in separate route handlers (P0 sprint):
 * - GitHub, X, AgentMail, Solana, Ethereum, Domain
 */
const { initiateHLVerification, completeHLVerification } = require('./hyperliquid-verify-hardened');
const { initiatePMVerification, completePMVerification } = require('./polymarket-verify-hardened');
const { initiateMoltbookVerification, completeMoltbookVerification } = require('./moltbook-verify-hardened');
const { initiateWebsiteVerification, completeWebsiteVerification } = require('./website-verify-hardened');
const { initiateTelegramVerification, completeTelegramVerification, markBotVerified } = require('./telegram-verify-hardened');
const { initiateDiscordVerification, confirmDiscordVerification } = require('./discord-verify-hardened');

/**
 * Parse JSON body from request
 */
async function parseBody(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  try { return JSON.parse(body); } catch { return {}; }
}

/**
 * Send JSON response
 */
function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

/**
 * Handle all hardened verification routes
 * Returns true if the route was handled, false if not matched
 */
function handleVerificationRoutes(url, req, res, DATA_DIR, helpers = {}) {
  const { loadProfile, dbSaveProfileFn, addActivityAndBroadcast, postVerificationMemo, postVerificationOnchainForProfile } = helpers;
  const pathname = url.pathname;
  const method = req.method;

  // ── HYPERLIQUID ──
  const hlInitMatch = pathname.match(/^\/api\/profile\/([^/]+)\/verify\/hyperliquid\/initiate$/);
  if (hlInitMatch && method === 'POST') {
    (async () => {
      const profileId = hlInitMatch[1];
      const parsed = await parseBody(req);
      const profile = loadProfile?.(profileId, DATA_DIR);
      if (!profile) return json(res, 404, { error: 'Profile not found' });

      const walletAddress = parsed.walletAddress || profile.wallets?.hyperliquid;
      if (!walletAddress) return json(res, 400, { error: 'No Hyperliquid wallet. Provide walletAddress or set it on your profile.' });

      try {
        const result = initiateHLVerification(profileId, walletAddress);
        json(res, 200, result);
      } catch (e) {
        json(res, 400, { error: e.message });
      }
    })();
    return true;
  }

  const hlCompleteMatch = pathname.match(/^\/api\/profile\/([^/]+)\/verify\/hyperliquid\/complete$/);
  if (hlCompleteMatch && method === 'POST') {
    (async () => {
      const profileId = hlCompleteMatch[1];
      const parsed = await parseBody(req);
      const { challengeId, signature } = parsed;
      if (!challengeId || !signature) return json(res, 400, { error: 'challengeId and signature required' });

      try {
        const result = await completeHLVerification(challengeId, signature);
        if (result.verified && loadProfile && dbSaveProfileFn) {
          const profile = loadProfile(profileId, DATA_DIR);
          if (profile) {
            profile.verificationData = profile.verificationData || {};
            profile.verificationData.hyperliquid = {
              verified: true, address: result.identifier, accountValue: result.accountValue,
              stats: result.stats, method: 'hardened_signature', verifiedAt: new Date().toISOString(),
            };
            profile.wallets = profile.wallets || {};
            if (!profile.wallets.hyperliquid) profile.wallets.hyperliquid = result.identifier;
            profile.updatedAt = new Date().toISOString();
            dbSaveProfileFn(profile);
          }
          if (addActivityAndBroadcast) {
            addActivityAndBroadcast(profileId, 'verification_hyperliquid', {
              address: result.identifier?.slice(0, 8) + '...' + result.identifier?.slice(-4),
              accountValue: result.accountValue, method: 'hardened_signature',
            }, DATA_DIR);
          }
        }
        json(res, result.verified ? 200 : 400, result);
      } catch (e) {
        json(res, 500, { error: e.message });
      }
    })();
    return true;
  }

  // ── POLYMARKET ──
  const pmInitMatch = pathname.match(/^\/api\/profile\/([^/]+)\/verify\/polymarket\/initiate$/);
  if (pmInitMatch && method === 'POST') {
    (async () => {
      const profileId = pmInitMatch[1];
      const parsed = await parseBody(req);
      const profile = loadProfile?.(profileId, DATA_DIR);
      if (!profile) return json(res, 404, { error: 'Profile not found' });

      const walletAddress = parsed.walletAddress || profile.wallets?.polymarket;
      if (!walletAddress) return json(res, 400, { error: 'No Polymarket wallet. Provide walletAddress or set it on your profile.' });

      try {
        const result = initiatePMVerification(profileId, walletAddress);
        json(res, 200, result);
      } catch (e) {
        json(res, 400, { error: e.message });
      }
    })();
    return true;
  }

  const pmCompleteMatch = pathname.match(/^\/api\/profile\/([^/]+)\/verify\/polymarket\/complete$/);
  if (pmCompleteMatch && method === 'POST') {
    (async () => {
      const profileId = pmCompleteMatch[1];
      const parsed = await parseBody(req);
      const { challengeId, signature } = parsed;
      if (!challengeId || !signature) return json(res, 400, { error: 'challengeId and signature required' });

      try {
        const result = await completePMVerification(challengeId, signature);
        if (result.verified && loadProfile && dbSaveProfileFn) {
          const profile = loadProfile(profileId, DATA_DIR);
          if (profile) {
            profile.verificationData = profile.verificationData || {};
            profile.verificationData.polymarket = {
              verified: true, address: result.identifier, stats: result.stats,
              method: 'hardened_signature', verifiedAt: new Date().toISOString(),
            };
            profile.wallets = profile.wallets || {};
            if (!profile.wallets.polymarket) profile.wallets.polymarket = result.identifier;
            profile.updatedAt = new Date().toISOString();
            dbSaveProfileFn(profile);
          }
          if (addActivityAndBroadcast) {
            addActivityAndBroadcast(profileId, 'verification_polymarket', {
              address: result.identifier?.slice(0, 8) + '...' + result.identifier?.slice(-4),
              stats: result.stats, method: 'hardened_signature',
            }, DATA_DIR);
          }
          if (postVerificationMemo) postVerificationMemo(profileId, 'polymarket', { address: result.identifier }).catch(() => {});
          if (postVerificationOnchainForProfile && profile) postVerificationOnchainForProfile(profile, 'polymarket', { address: result.identifier });
        }
        json(res, result.verified ? 200 : 400, result);
      } catch (e) {
        json(res, 500, { error: e.message });
      }
    })();
    return true;
  }

  // ── MOLTBOOK ──
  const mbInitMatch = pathname.match(/^\/api\/profile\/([^/]+)\/verify\/moltbook\/initiate$/);
  if (mbInitMatch && method === 'POST') {
    (async () => {
      const profileId = mbInitMatch[1];
      const parsed = await parseBody(req);
      const profile = loadProfile?.(profileId, DATA_DIR);
      if (!profile) return json(res, 404, { error: 'Profile not found' });

      const username = parsed.moltbookUsername || profile.links?.moltbook;
      if (!username) return json(res, 400, { error: 'No Moltbook username. Provide moltbookUsername or set it on your profile.' });

      try {
        const result = initiateMoltbookVerification(profileId, username);
        json(res, 200, result);
      } catch (e) {
        json(res, 400, { error: e.message });
      }
    })();
    return true;
  }

  const mbCompleteMatch = pathname.match(/^\/api\/profile\/([^/]+)\/verify\/moltbook\/complete$/);
  if (mbCompleteMatch && method === 'POST') {
    (async () => {
      const profileId = mbCompleteMatch[1];
      const parsed = await parseBody(req);
      const { challengeId } = parsed;
      if (!challengeId) return json(res, 400, { error: 'challengeId required' });

      try {
        const result = await completeMoltbookVerification(challengeId);
        if (result.verified && loadProfile && dbSaveProfileFn) {
          const profile = loadProfile(profileId, DATA_DIR);
          if (profile) {
            profile.verificationData = profile.verificationData || {};
            profile.verificationData.moltbook = {
              verified: true, username: result.username, karma: result.karma,
              method: 'hardened_bio_nonce', verifiedAt: new Date().toISOString(),
            };
            profile.links = profile.links || {};
            profile.links.moltbook = result.username;
            profile.updatedAt = new Date().toISOString();
            dbSaveProfileFn(profile);
          }
          if (addActivityAndBroadcast) {
            addActivityAndBroadcast(profileId, 'verification_moltbook', {
              username: result.username, karma: result.karma, method: 'hardened_bio_nonce',
            }, DATA_DIR);
          }
          if (postVerificationMemo) postVerificationMemo(profileId, 'moltbook', { username: result.username, karma: result.karma }).catch(() => {});
          if (postVerificationOnchainForProfile && profile) postVerificationOnchainForProfile(profile, 'moltbook', { username: result.username });
        }
        json(res, result.verified ? 200 : 400, result);
      } catch (e) {
        json(res, 500, { error: e.message });
      }
    })();
    return true;
  }

  // ── WEBSITE ──
  const wsInitMatch = pathname.match(/^\/api\/profile\/([^/]+)\/verify\/website\/initiate$/);
  if (wsInitMatch && method === 'POST') {
    (async () => {
      const profileId = wsInitMatch[1];
      const parsed = await parseBody(req);
      const profile = loadProfile?.(profileId, DATA_DIR);
      if (!profile) return json(res, 404, { error: 'Profile not found' });

      const websiteUrl = parsed.websiteUrl || profile.links?.website;
      if (!websiteUrl) return json(res, 400, { error: 'No website URL. Provide websiteUrl or set it on your profile.' });

      try {
        const result = initiateWebsiteVerification(profileId, websiteUrl);
        json(res, 200, result);
      } catch (e) {
        json(res, 400, { error: e.message });
      }
    })();
    return true;
  }

  const wsCompleteMatch = pathname.match(/^\/api\/profile\/([^/]+)\/verify\/website\/complete$/);
  if (wsCompleteMatch && method === 'POST') {
    (async () => {
      const profileId = wsCompleteMatch[1];
      const parsed = await parseBody(req);
      const { challengeId } = parsed;
      if (!challengeId) return json(res, 400, { error: 'challengeId required' });

      try {
        const result = await completeWebsiteVerification(challengeId);
        if (result.verified && loadProfile && dbSaveProfileFn) {
          const profile = loadProfile(profileId, DATA_DIR);
          if (profile) {
            profile.verificationData = profile.verificationData || {};
            profile.verificationData.website = {
              verified: true, url: result.websiteUrl,
              method: 'hardened_well_known', verifiedAt: new Date().toISOString(),
            };
            profile.links = profile.links || {};
            profile.links.website = result.websiteUrl;
            profile.updatedAt = new Date().toISOString();
            dbSaveProfileFn(profile);
          }
          if (addActivityAndBroadcast) {
            addActivityAndBroadcast(profileId, 'verification_website', {
              url: result.websiteUrl, method: 'hardened_well_known',
            }, DATA_DIR);
          }
          if (postVerificationMemo) postVerificationMemo(profileId, 'website', { url: result.websiteUrl }).catch(() => {});
          if (postVerificationOnchainForProfile && profile) postVerificationOnchainForProfile(profile, 'website', { url: result.websiteUrl });
        }
        json(res, result.verified ? 200 : 400, result);
      } catch (e) {
        json(res, 500, { error: e.message });
      }
    })();
    return true;
  }

  // ── TELEGRAM ──
  const tgInitMatch = pathname.match(/^\/api\/profile\/([^/]+)\/verify\/telegram\/initiate$/);
  if (tgInitMatch && method === 'POST') {
    (async () => {
      const profileId = tgInitMatch[1];
      const parsed = await parseBody(req);
      const profile = loadProfile?.(profileId, DATA_DIR);
      if (!profile) return json(res, 404, { error: 'Profile not found' });

      const handle = parsed.telegramHandle || profile.links?.telegram;
      if (!handle) return json(res, 400, { error: 'No Telegram handle. Provide telegramHandle or set it on your profile.' });

      try {
        const result = initiateTelegramVerification(profileId, handle);
        json(res, 200, result);
      } catch (e) {
        json(res, 400, { error: e.message });
      }
    })();
    return true;
  }

  const tgCompleteMatch = pathname.match(/^\/api\/profile\/([^/]+)\/verify\/telegram\/complete$/);
  if (tgCompleteMatch && method === 'POST') {
    (async () => {
      const profileId = tgCompleteMatch[1];
      const parsed = await parseBody(req);
      const { challengeId } = parsed;
      if (!challengeId) return json(res, 400, { error: 'challengeId required' });

      try {
        const result = await completeTelegramVerification(challengeId);
        if (result.verified && loadProfile && dbSaveProfileFn) {
          const profile = loadProfile(profileId, DATA_DIR);
          if (profile) {
            profile.verificationData = profile.verificationData || {};
            profile.verificationData.telegram = {
              verified: true, handle: result.handle, telegramUserId: result.telegramUserId,
              method: result.method, verifiedAt: new Date().toISOString(),
            };
            profile.links = profile.links || {};
            profile.links.telegram = result.handle;
            profile.updatedAt = new Date().toISOString();
            dbSaveProfileFn(profile);
          }
          if (addActivityAndBroadcast) {
            addActivityAndBroadcast(profileId, 'verification_telegram', {
              handle: result.handle, method: result.method,
            }, DATA_DIR);
          }
          if (postVerificationMemo) postVerificationMemo(profileId, 'telegram', { handle: result.handle }).catch(() => {});
          if (postVerificationOnchainForProfile && profile) postVerificationOnchainForProfile(profile, 'telegram', { handle: result.handle });
        }
        json(res, result.verified ? 200 : 400, result);
      } catch (e) {
        json(res, 500, { error: e.message });
      }
    })();
    return true;
  }

  // ── Telegram bot webhook (receives code from bot) ──
  if (pathname === '/api/verify/telegram/bot-callback' && method === 'POST') {
    (async () => {
      const parsed = await parseBody(req);
      const { code, telegramUserId, telegramUsername } = parsed;
      if (!code) return json(res, 400, { error: 'code required' });
      const result = markBotVerified(code, telegramUserId, telegramUsername);
      json(res, result.matched ? 200 : 404, result);
    })();
    return true;
  }

  // ── DISCORD ──
  const dcInitMatch = pathname.match(/^\/api\/profile\/([^/]+)\/verify\/discord\/initiate$/);
  if (dcInitMatch && method === 'POST') {
    (async () => {
      const profileId = dcInitMatch[1];
      const parsed = await parseBody(req);
      const profile = loadProfile?.(profileId, DATA_DIR);
      if (!profile) return json(res, 404, { error: 'Profile not found' });

      const username = parsed.discordUsername || profile.links?.discord;
      if (!username) return json(res, 400, { error: 'No Discord username. Provide discordUsername or set it on your profile.' });

      try {
        const result = await initiateDiscordVerification(profileId, username);
        json(res, result.success ? 200 : 400, result);
      } catch (e) {
        json(res, 400, { error: e.message });
      }
    })();
    return true;
  }

  const dcCompleteMatch = pathname.match(/^\/api\/profile\/([^/]+)\/verify\/discord\/complete$/);
  if (dcCompleteMatch && method === 'POST') {
    (async () => {
      const profileId = dcCompleteMatch[1];
      const parsed = await parseBody(req);
      const { challengeId, discordUserId } = parsed;
      if (!challengeId) return json(res, 400, { error: 'challengeId required' });

      try {
        const result = await confirmDiscordVerification(challengeId, discordUserId);
        if (result.verified && loadProfile && dbSaveProfileFn) {
          const profile = loadProfile(profileId, DATA_DIR);
          if (profile) {
            profile.verificationData = profile.verificationData || {};
            profile.verificationData.discord = {
              verified: true, username: result.username, discordUserId: result.discordUserId,
              method: 'hardened_dm_challenge', verifiedAt: new Date().toISOString(),
            };
            profile.links = profile.links || {};
            profile.links.discord = result.username;
            profile.updatedAt = new Date().toISOString();
            dbSaveProfileFn(profile);
          }
          if (addActivityAndBroadcast) {
            addActivityAndBroadcast(profileId, 'verification_discord', {
              username: result.username, method: 'hardened_dm_challenge',
            }, DATA_DIR);
          }
          if (postVerificationMemo) postVerificationMemo(profileId, 'discord', { username: result.username }).catch(() => {});
          if (postVerificationOnchainForProfile && profile) postVerificationOnchainForProfile(profile, 'discord', { username: result.username });
        }
        json(res, result.verified ? 200 : 400, result);
      } catch (e) {
        json(res, 500, { error: e.message });
      }
    })();
    return true;
  }

  // Not matched
  return false;
}

module.exports = { handleVerificationRoutes };
