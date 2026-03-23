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

// P0 Sprint hardened modules (GitHub, X, AgentMail, Solana)
let initiateGitHubVerification, verifyGitHubGist;
try { ({ initiateGitHubVerification, verifyGitHubGist } = require('./github-verify-hardened')); } catch(e) { console.warn('[Hardened] github-verify-hardened not loaded:', e.message); }
let initiateXVerification, verifyXTweet;
try { ({ initiateXVerification, verifyXTweet } = require('./x-verify-hardened')); } catch(e) { console.warn('[Hardened] x-verify-hardened not loaded:', e.message); }
let initiateAgentMailVerification, verifyAgentMailCode;
try { ({ initiateAgentMailVerification, verifyAgentMailCode } = require('./agentmail-verify-hardened')); } catch(e) { console.warn('[Hardened] agentmail-verify-hardened not loaded:', e.message); }
let initiateSolanaVerification, verifySolanaSignature;
try { ({ initiateSolanaVerification, verifySolanaSignature } = require('./solana-verify-hardened')); } catch(e) { console.warn('[Hardened] solana-verify-hardened not loaded:', e.message); }
let initiateEthVerification, verifyEthSignature;
try { ({ initiateEthVerification, verifyEthSignature } = require('./eth-verify-hardened')); } catch(e) { console.warn('[Hardened] eth-verify-hardened not loaded:', e.message); }
let initiateDomainVerification, verifyDomainOwnership;
try { ({ initiateDomainVerification, verifyDomainOwnership } = require('./domain-verify-hardened')); } catch(e) { console.warn('[Hardened] domain-verify-hardened not loaded:', e.message); }
// Profile store for SQLite verification + on-chain updates
let addVerification;
try { ({ addVerification } = require('../profile-store')); } catch(e) { console.warn('[Hardened] profile-store addVerification not loaded:', e.message); }

let getChallenge;
try { ({ getChallenge } = require('./verification-challenges')); } catch(e) { console.warn('[Hardened] verification-challenges not loaded:', e.message); }

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

  // Alias: /api/verify/hyperliquid/initiate (profileId in body)
  if (pathname === '/api/verify/hyperliquid/initiate' && method === 'POST') {
    (async () => {
      const parsed = await parseBody(req);
      const profileId = parsed.profileId;
      if (!profileId) return json(res, 400, { error: 'profileId required' });
      const profile = loadProfile?.(profileId, DATA_DIR);
      if (!profile) return json(res, 404, { error: 'Profile not found' });
      const walletAddress = parsed.walletAddress || parsed.address || profile.wallets?.hyperliquid;
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

  // Alias: /api/verify/hyperliquid/complete (profileId in body)
  if (pathname === '/api/verify/hyperliquid/complete' && method === 'POST') {
    (async () => {
      const parsed = await parseBody(req);
      const { challengeId, signature } = parsed;
      if (!challengeId || !signature) return json(res, 400, { error: 'challengeId and signature required' });
      try {
        const result = await completeHLVerification(challengeId, signature);
        if (result.verified && loadProfile && dbSaveProfileFn) {
          const profileId = result.profileId;
          if (profileId) {
            const profile = loadProfile(profileId, DATA_DIR);
            if (profile) {
              profile.verificationData = profile.verificationData || {};
              profile.verificationData.hyperliquid = {
                verified: true,
                address: result.walletAddress,
                method: 'hardened_sign',
                verifiedAt: new Date().toISOString(),
              };
              profile.updatedAt = new Date().toISOString();
              dbSaveProfileFn(profile);
              // Attestation TX
              if (postVerificationMemo) postVerificationMemo(profileId, 'hyperliquid', { address: result.walletAddress }).catch(() => {});
              if (postVerificationOnchainForProfile) postVerificationOnchainForProfile(profile, 'hyperliquid', { address: result.walletAddress });
            }
          }
        }
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
              proof: { challengeId, signature, signatureVerified: result.signatureVerified },
            };
            profile.wallets = profile.wallets || {};
            if (!profile.wallets.hyperliquid) profile.wallets.hyperliquid = result.identifier;
            profile.updatedAt = new Date().toISOString();
            
              // Save to SQLite + trigger on-chain updates
              if (addVerification) try { addVerification(profileId, 'hyperliquid', result.identifier || result.walletAddress, { verifiedAt: new Date().toISOString() }); } catch(avErr) { console.error("[Hardened] addVerification:", avErr.message); }
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
              proof: { challengeId, signature, signatureVerified: result.signatureVerified },
            };
            profile.wallets = profile.wallets || {};
            if (!profile.wallets.polymarket) profile.wallets.polymarket = result.identifier;
            profile.updatedAt = new Date().toISOString();
            
              // Save to SQLite + trigger on-chain updates
              if (addVerification) try { addVerification(profileId, 'polymarket', result.identifier || result.walletAddress, { verifiedAt: new Date().toISOString() }); } catch(avErr) { console.error("[Hardened] addVerification:", avErr.message); }
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
              proof: { challengeId, nonce: result.nonce || null },
            };
            profile.links = profile.links || {};
            profile.links.moltbook = result.username;
            profile.updatedAt = new Date().toISOString();
            
              // Save to SQLite + trigger on-chain updates
              if (addVerification) try { addVerification(profileId, 'moltbook', result.username, { verifiedAt: new Date().toISOString() }); } catch(avErr) { console.error("[Hardened] addVerification:", avErr.message); }
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
              proof: { challengeId, verificationUrl: result.websiteUrl + '/.well-known/agentfolio-verification.txt' },
            };
            profile.links = profile.links || {};
            profile.links.website = result.websiteUrl;
            profile.updatedAt = new Date().toISOString();
            
              // Save to SQLite + trigger on-chain updates
              if (addVerification) try { addVerification(profileId, 'website', result.url, { verifiedAt: new Date().toISOString() }); } catch(avErr) { console.error("[Hardened] addVerification:", avErr.message); }
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
              proof: { challengeId, telegramUserId: result.telegramUserId },
            };
            profile.links = profile.links || {};
            profile.links.telegram = result.handle;
            profile.updatedAt = new Date().toISOString();
            
              // Save to SQLite + trigger on-chain updates
              if (addVerification) try { addVerification(profileId, 'telegram', result.telegramHandle || result.username, { verifiedAt: new Date().toISOString() }); } catch(avErr) { console.error("[Hardened] addVerification:", avErr.message); }
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
              proof: { challengeId, discordUserId: result.discordUserId },
            };
            profile.links = profile.links || {};
            profile.links.discord = result.username;
            profile.updatedAt = new Date().toISOString();
            
              // Save to SQLite + trigger on-chain updates
              if (addVerification) try { addVerification(profileId, 'discord', result.discordUserId || result.identifier, { verifiedAt: new Date().toISOString() }); } catch(avErr) { console.error("[Hardened] addVerification:", avErr.message); }
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


  // ═══════════════════════════════════════════════════
  // P0 Sprint routes (GitHub, X, AgentMail, Solana)
  // These use /api/verify/{provider}/initiate|confirm pattern
  // ═══════════════════════════════════════════════════

  // ── GitHub Hardened ──
  if (pathname === '/api/verify/github/initiate' && method === 'POST' && initiateGitHubVerification) {
    (async () => {
      const parsed = await parseBody(req);
      const { profileId, username, xHandle, handle } = parsed;
      const xUser = username || xHandle || handle;
      if (!profileId || !xUser) return json(res, 400, { error: 'profileId and username required' });
      try {
        const result = await initiateGitHubVerification(profileId, username);
        json(res, result.success ? 200 : 400, result);
      } catch (e) { json(res, 500, { error: e.message }); }
    })();
    return true;
  }
  if (pathname === '/api/verify/github/confirm' && method === 'POST' && verifyGitHubGist) {
    (async () => {
      const parsed = await parseBody(req);
      const { challengeId, gistUrl } = parsed;
      if (!challengeId || !gistUrl) return json(res, 400, { error: 'challengeId and gistUrl required' });
      try {
        const result = await verifyGitHubGist(challengeId, gistUrl);
        if (result.verified && getChallenge) {
          const challenge = await getChallenge(challengeId);
          if (challenge && loadProfile && dbSaveProfileFn) {
            const profile = loadProfile(challenge.challengeData.profileId, DATA_DIR);
            if (profile) {
              profile.verificationData = profile.verificationData || {};
              profile.verificationData.github = { ...result, method: 'hardened_gist', verifiedAt: new Date().toISOString() };
              profile.updatedAt = new Date().toISOString();
              
              // Save to SQLite + trigger on-chain updates
              if (addVerification) try { addVerification(challenge.challengeData.profileId, 'github', result.username || result.identifier, { verifiedAt: new Date().toISOString() }); } catch(avErr) { console.error("[Hardened] addVerification:", avErr.message); }
              dbSaveProfileFn(profile);
              // Fire on-chain attestation for GitHub verification
              if (postVerificationMemo) postVerificationMemo(challenge.challengeData.profileId, 'github', { username: result.username || result.identifier }).catch(() => {});
              if (postVerificationOnchainForProfile && profile) postVerificationOnchainForProfile(profile, 'github', { username: result.username || result.identifier });
            }
          }
        }
        json(res, result.verified ? 200 : 400, result);
      } catch (e) { json(res, 500, { error: e.message }); }
    })();
    return true;
  }

  // ── ETH Wallet Hardened ──
  if (pathname === '/api/verify/eth/initiate' && method === 'POST' && initiateEthVerification) {
    (async () => {
      const parsed = await parseBody(req);
      const { profileId, walletAddress } = parsed;
      if (!profileId || !walletAddress) return json(res, 400, { error: 'profileId and walletAddress required' });
      try {
        const result = await initiateEthVerification(profileId, walletAddress);
        json(res, result.success ? 200 : 400, result);
      } catch (e) { json(res, 500, { error: e.message }); }
    })();
    return true;
  }
  if (pathname === '/api/verify/eth/verify' && method === 'POST' && verifyEthSignature) {
    (async () => {
      const parsed = await parseBody(req);
      const { challengeId, signature } = parsed;
      if (!challengeId || !signature) return json(res, 400, { error: 'challengeId and signature required' });
      try {
        const result = await verifyEthSignature(challengeId, signature);
        if (result.verified && getChallenge) {
          const challenge = await getChallenge(challengeId);
          if (challenge && loadProfile && dbSaveProfileFn) {
            const profile = loadProfile(challenge.challengeData.profileId, DATA_DIR);
            if (profile) {
              profile.verificationData = profile.verificationData || {};
              profile.verificationData.ethereum = { verified: true, address: challenge.challengeData.identifier, method: 'hardened_eip191', verifiedAt: new Date().toISOString() };
              profile.wallets = profile.wallets || {};
              profile.wallets.ethereum = challenge.challengeData.identifier;
              profile.updatedAt = new Date().toISOString();
              if (addVerification) try { addVerification(challenge.challengeData.profileId, 'ethereum', challenge.challengeData.identifier, { verifiedAt: new Date().toISOString() }); } catch(avErr) { console.error('[Hardened] addVerification:', avErr.message); }
              dbSaveProfileFn(profile);
              // Attestation TX
              const ethProfileId = challenge.challengeData.profileId;
              if (postVerificationMemo) postVerificationMemo(ethProfileId, 'ethereum', { address: challenge.challengeData.identifier }).catch(() => {});
              if (postVerificationOnchainForProfile) postVerificationOnchainForProfile(profile, 'ethereum', { address: challenge.challengeData.identifier });
            }
          }
        }
        json(res, result.verified ? 200 : 400, result);
      } catch (e) { json(res, 500, { error: e.message }); }
    })();
    return true;
  }

  // ── Domain Hardened ──
  if (pathname === '/api/verify/domain/initiate' && method === 'POST' && initiateDomainVerification) {
    (async () => {
      const parsed = await parseBody(req);
      const { profileId, domain } = parsed;
      if (!profileId || !domain) return json(res, 400, { error: 'profileId and domain required' });
      try {
        const result = await initiateDomainVerification(profileId, domain);
        json(res, result.success ? 200 : 400, result);
      } catch (e) { json(res, 500, { error: e.message }); }
    })();
    return true;
  }
  if (pathname === '/api/verify/domain/verify' && method === 'POST' && verifyDomainOwnership) {
    (async () => {
      const parsed = await parseBody(req);
      const { challengeId } = parsed;
      if (!challengeId) return json(res, 400, { error: 'challengeId required' });
      try {
        const result = await verifyDomainOwnership(challengeId);
        if (result.verified && getChallenge) {
          const challenge = await getChallenge(challengeId);
          if (challenge && loadProfile && dbSaveProfileFn) {
            const profile = loadProfile(challenge.challengeData.profileId, DATA_DIR);
            if (profile) {
              profile.verificationData = profile.verificationData || {};
              profile.verificationData.domain = { verified: true, domain: challenge.challengeData.identifier, method: 'hardened_dns_wellknown', verifiedAt: new Date().toISOString() };
              profile.updatedAt = new Date().toISOString();
              if (addVerification) try { addVerification(challenge.challengeData.profileId, 'domain', challenge.challengeData.identifier, { verifiedAt: new Date().toISOString() }); } catch(avErr) { console.error('[Hardened] addVerification:', avErr.message); }
              dbSaveProfileFn(profile);
            }
          }
        }
        json(res, result.verified ? 200 : 400, result);
      } catch (e) { json(res, 500, { error: e.message }); }
    })();
    return true;
  }

  // ── X Hardened ──
  if (pathname === '/api/verify/x/initiate' && method === 'POST' && initiateXVerification) {
    (async () => {
      const parsed = await parseBody(req);
      const { profileId, username, xHandle, handle } = parsed;
      const xUser = username || xHandle || handle;
      if (!profileId || !xUser) return json(res, 400, { error: 'profileId and username required' });
      try {
        const result = await initiateXVerification(profileId, xUser);
        json(res, result.success ? 200 : 400, result);
      } catch (e) { json(res, 500, { error: e.message }); }
    })();
    return true;
  }
  if (pathname === '/api/verify/x/confirm' && method === 'POST' && verifyXTweet) {
    (async () => {
      const parsed = await parseBody(req);
      const { challengeId, tweetUrl } = parsed;
      if (!challengeId || !tweetUrl) return json(res, 400, { error: 'challengeId and tweetUrl required' });
      try {
        const result = await verifyXTweet(challengeId, tweetUrl);
        if (result.verified && getChallenge) {
          const challenge = await getChallenge(challengeId);
          if (challenge && loadProfile && dbSaveProfileFn) {
            const profileId = challenge.challengeData.profileId;
            const xHandle = result.username || challenge.challengeData.identifier || '';
            const profile = loadProfile(profileId, DATA_DIR);
            if (profile) {
              // Bug 1 fix: Save the ACTUAL X handle, not profileId
              profile.verificationData = profile.verificationData || {};
              profile.verificationData.x = {
                verified: true,
                handle: xHandle,
                username: xHandle,
                address: xHandle,
                tweetUrl: result.tweetUrl,
                tweetId: result.tweetId,
                method: 'hardened_tweet',
                verifiedAt: new Date().toISOString(),
                stats: result.stats || {},
              };
              // Also update links.x
              if (!profile.links) profile.links = {};
              profile.links.x = xHandle;
              // Also store in social.twitter for MCP/SDK consumers
              if (!profile.social) profile.social = {};
              profile.social.twitter = xHandle;
              profile.updatedAt = new Date().toISOString();
              dbSaveProfileFn(profile);
              // Bug 2 fix: Fire attestation TX
              try {
                const { postVerificationMemo } = require('./memo-attestation');
                postVerificationMemo(profileId, 'x', { handle: xHandle, tweetUrl: result.tweetUrl })
                  .then(r => { if (r && r.txSignature) console.log('[X Verify] Attestation TX:', r.explorerUrl); })
                  .catch(e => console.error('[X Verify] Attestation failed:', e.message));
              } catch (e) { console.error('[X Verify] Attestation module error:', e.message); }
            }
          }
        }
        json(res, result.verified ? 200 : 400, result);
      } catch (e) { json(res, 500, { error: e.message }); }
    })();
    return true;
  }

  // ── AgentMail Hardened ──
  if (pathname === '/api/verify/agentmail/initiate' && method === 'POST' && initiateAgentMailVerification) {
    (async () => {
      const parsed = await parseBody(req);
      const { profileId, email } = parsed;
      if (!profileId || !email) return json(res, 400, { error: 'profileId and email required' });
      try {
        const result = await initiateAgentMailVerification(profileId, email);
        json(res, result.success ? 200 : 400, result);
      } catch (e) { json(res, 500, { error: e.message }); }
    })();
    return true;
  }
  if (pathname === '/api/verify/agentmail/confirm' && method === 'POST' && verifyAgentMailCode) {
    (async () => {
      const parsed = await parseBody(req);
      const { challengeId, code } = parsed;
      if (!challengeId || !code) return json(res, 400, { error: 'challengeId and code required' });
      try {
        const result = await verifyAgentMailCode(challengeId, code);
        if (result.verified && getChallenge) {
          const challenge = await getChallenge(challengeId);
          if (challenge && loadProfile && dbSaveProfileFn) {
            const profile = loadProfile(challenge.challengeData.profileId, DATA_DIR);
            if (profile) {
              profile.verificationData = profile.verificationData || {};
              profile.verificationData.agentmail = { ...result, method: 'hardened_email_code', verifiedAt: new Date().toISOString() };
              profile.updatedAt = new Date().toISOString();
              dbSaveProfileFn(profile);
              // Attestation TX
              const amProfileId = challenge.challengeData.profileId;
              if (postVerificationMemo) postVerificationMemo(amProfileId, 'agentmail', { email: result.email || challenge.challengeData.identifier }).catch(() => {});
              if (postVerificationOnchainForProfile) postVerificationOnchainForProfile(profile, 'agentmail', { email: result.email || challenge.challengeData.identifier });
            }
          }
        }
        json(res, result.verified ? 200 : 400, result);
      } catch (e) { json(res, 500, { error: e.message }); }
    })();
    return true;
  }

  // ── Solana Hardened ──
  if (pathname === '/api/verify/solana/initiate' && method === 'POST' && initiateSolanaVerification) {
    (async () => {
      const parsed = await parseBody(req);
      const { profileId, walletAddress } = parsed;
      if (!profileId || !walletAddress) return json(res, 400, { error: 'profileId and walletAddress required' });
      try {
        const result = await initiateSolanaVerification(profileId, walletAddress);
        json(res, result.success ? 200 : 400, result);
      } catch (e) { json(res, 500, { error: e.message }); }
    })();
    return true;
  }
  if (pathname === '/api/verify/solana/confirm' && method === 'POST' && verifySolanaSignature) {
    (async () => {
      const parsed = await parseBody(req);
      const { challengeId, signature } = parsed;
      if (!challengeId || !signature) return json(res, 400, { error: 'challengeId and signature required' });
      try {
        const result = await verifySolanaSignature(challengeId, signature);
        if (result.verified && getChallenge) {
          const challenge = await getChallenge(challengeId);
          if (challenge) {
            const profileId = challenge.challengeData.profileId;
            const walletAddr = result.walletAddress;
            
            // Save to SQLite verifications table + trigger on-chain updates
            if (addVerification) {
              try {
                addVerification(profileId, 'solana', walletAddr, {
                  type: 'ed25519_signature',
                  signature: result.signature,
                  message: result.proof?.message,
                  challengeId,
                  cryptoVerified: true,
                  verifiedAt: new Date().toISOString(),
                });
              } catch (avErr) { console.error('[Hardened] addVerification error:', avErr.message); }
            }
            
            // Update profile JSON (wallets + verificationData)
            if (loadProfile && dbSaveProfileFn) {
              const profile = loadProfile(profileId, DATA_DIR);
              if (profile) {
                profile.verificationData = profile.verificationData || {};
                profile.verificationData.solana = {
                  address: walletAddr,
                  verified: true,
                  linked: true,
                  method: 'hardened_ed25519_signature',
                  verifiedAt: new Date().toISOString(),
                };
                profile.wallets = profile.wallets || {};
                profile.wallets.solana = walletAddr;
                profile.updatedAt = new Date().toISOString();
                dbSaveProfileFn(profile);
              }
            }
            
            // Activity + memo attestation
            if (addActivityAndBroadcast) addActivityAndBroadcast(profileId, 'verification_solana', { address: walletAddr.slice(0,8) + '...' }, DATA_DIR);
            if (postVerificationMemo) postVerificationMemo(profileId, 'solana', { address: walletAddr }).catch(() => {});
          }
        }
        json(res, result.verified ? 200 : 400, result);
      } catch (e) { json(res, 500, { error: e.message }); }
    })();
    return true;
  }

  // Not matched
  return false;
}

module.exports = { handleVerificationRoutes };
