/**
 * Restored Verification & SATP Routes
 * Extracted from server.js.backup-before-hardening-20260320-072004
 * Converted from URL-pattern (if/else if) routing to Express routes.
 * 
 * Created: 2026-03-31 by brainForge (P0 route restoration)
 */

'use strict';

function registerRestoredRoutes(app) {
  const path = require('path');
  const fs = require('fs');

  // ─── Load shared helpers (same as backup used) ───
  const { loadProfile, saveProfile: _dbSaveProfileRaw } = require('../lib/profile');
  function dbSaveProfileFn(profile) {
    _dbSaveProfileRaw(profile);
    try {
      const jsonPath = path.join(__dirname, '..', '..', 'data', 'profiles', `${profile.id}.json`);
      fs.writeFileSync(jsonPath, JSON.stringify(profile, null, 2));
    } catch (e) {
      console.warn(`[Sync] Failed to write JSON for ${profile.id}: ${e.message}`);
    }
  }

  const DATA_DIR = path.join(__dirname, '..', '..', 'data', 'profiles');
  const PROFILES_DIR = DATA_DIR;

  function upsertActiveVerification(profileId, platform, identifier, proof = {}) {
    try {
      const Database = require('better-sqlite3');
      const db = new Database(path.join(__dirname, '..', '..', 'data', 'agentfolio.db'));
      db.prepare(`
        INSERT INTO verifications (id, profile_id, platform, identifier, proof, verified_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(profile_id, platform) DO UPDATE SET
          identifier = excluded.identifier,
          proof = excluded.proof,
          verified_at = datetime('now')
      `).run(
        `${profileId}-${platform}`,
        profileId,
        platform,
        identifier,
        JSON.stringify(proof || {})
      );

      const row = db.prepare('SELECT verification_data FROM profiles WHERE id = ?').get(profileId);
      if (row) {
        let vd = {};
        try { vd = JSON.parse(row.verification_data || '{}'); } catch {}
        vd[platform] = { ...(vd[platform] || {}), verified: true, ...(proof || {}) };
        db.prepare('UPDATE profiles SET verification_data = ? WHERE id = ?').run(JSON.stringify(vd), profileId);
      }
      db.close();

      try {
        const satpRegistry = require('../lib/satp-registry');
        const { loadProfile: loadProfileFromDb } = require('../lib/database');
        if (satpRegistry.syncAttestationsFromProfile) {
          const refreshedProfile = loadProfileFromDb(profileId);
          if (refreshedProfile) satpRegistry.syncAttestationsFromProfile(refreshedProfile);
        }
      } catch (e) {
        console.warn(`[RestoredRoutes] Failed to sync SATP attestations for ${profileId}/${platform}: ${e.message}`);
      }
    } catch (e) {
      console.warn(`[RestoredRoutes] Failed to upsert active verification for ${profileId}/${platform}: ${e.message}`);
    }
  }

  // Activity
  const { ACTIVITY_TYPES, addActivity } = require('../lib/activity');
  let broadcastActivity;
  try { broadcastActivity = require('../lib/websocket').broadcastActivity; } catch (_) { broadcastActivity = () => {}; }
  function addActivityAndBroadcast(profileId, type, data, dataDir) {
    const activity = addActivity(profileId, type, data, dataDir);
    if (activity) {
      try { broadcastActivity({ profileId, ...activity }); } catch (_) {}
    }
    return activity;
  }

  // Webhooks
  let WEBHOOK_EVENTS = {}, triggerWebhooks = async () => {};
  try {
    const wh = require('../lib/webhooks');
    WEBHOOK_EVENTS = wh.EVENTS || {};
    triggerWebhooks = wh.triggerWebhooks || (async () => {});
  } catch (_) {}

  const logger = { info: console.log, error: console.error, warn: console.warn };

  // Bug 5 Fix: Import postVerificationHook for on-chain recompute_score
  let postVerificationHookFn = null;
  try { postVerificationHookFn = require('../post-verification-hook').postVerificationHook; } catch (e) { console.warn('[RestoredRoutes] postVerificationHook not available:', e.message); }


  // Verification providers
  const { verifyHyperliquidTrading } = require('../lib/hyperliquid-verify');
  const { isValidEthereumAddress, getEthereumStats } = require('../lib/ethereum-verify');

  // Telegram
  let startTelegramVerification, verifyTelegramCode, getTelegramVerificationStatus, getPendingTelegramVerification, getAllTelegramVerified;
  try {
    const tg = require('../lib/telegram-verify');
    startTelegramVerification = tg.startVerification;
    verifyTelegramCode = tg.verifyCode;
    getTelegramVerificationStatus = tg.getVerificationStatus;
    getPendingTelegramVerification = tg.getPendingVerification;
    getAllTelegramVerified = tg.getAllVerified;
  } catch (_) {
    startTelegramVerification = () => ({ success: false, error: 'Not available' });
    verifyTelegramCode = () => ({ verified: false, error: 'Not available' });
    getTelegramVerificationStatus = () => null;
    getPendingTelegramVerification = () => null;
    getAllTelegramVerified = () => ({});
  }

  // Discord
  let startDiscordVerification, handleDiscordCallback, getDiscordVerificationStatus, getPendingDiscordVerification;
  let getAllDiscordVerified, getDiscordAvatarUrl, formatDiscordUsername, isDiscordConfigured, removeDiscordVerification;
  try {
    const dc = require('../lib/discord-verify');
    startDiscordVerification = dc.startVerification;
    handleDiscordCallback = dc.handleCallback;
    getDiscordVerificationStatus = dc.getVerificationStatus;
    getPendingDiscordVerification = dc.getPendingVerification;
    getAllDiscordVerified = dc.getAllVerified;
    getDiscordAvatarUrl = dc.getAvatarUrl;
    formatDiscordUsername = dc.formatUsername;
    isDiscordConfigured = dc.isConfigured;
    removeDiscordVerification = dc.removeVerification;
  } catch (_) {
    startDiscordVerification = () => ({ success: false, error: 'Not available' });
    handleDiscordCallback = async () => ({ verified: false, error: 'Not available' });
    getDiscordVerificationStatus = () => null;
    getPendingDiscordVerification = () => null;
    getAllDiscordVerified = () => ({});
    getDiscordAvatarUrl = () => null;
    formatDiscordUsername = (u) => u;
    isDiscordConfigured = () => false;
    removeDiscordVerification = () => ({ success: false });
  }

  // Polymarket
  const { getPolymarketStats, generateVerificationMessage, verifyPolymarketTrading } = require('../lib/polymarket-verify');

  // Kalshi
  const { verifyKalshiTrading } = require('../lib/kalshi-verify');

  // Moltbook
  const { verifyMoltbookAccount, getMoltbookChallengeString } = require('../lib/moltbook-verify');

  // MCP
  const { verifyMcpEndpoint } = require('../lib/mcp-verify');

  // A2A
  const { verifyA2aAgentCard } = require('../lib/a2a-verify');

  // Website
  const { generateWebsiteChallenge, confirmWebsiteVerification } = require('../lib/website-verify');

  // Trust computation (simplified from backup)
  let computeTrustData;
  try {
    const { calculateVerificationScore } = require('../lib/verification-score');
    computeTrustData = function(agentId) {
      const profile = loadProfile(agentId);
      if (!profile) return { agentId, trustScore: 0, tier: 'unverified' };
      const vd = profile.verificationData || {};
      const verified = Object.entries(vd).filter(([k, v]) => v && v.verified && k !== 'onboardingDismissed').map(([k]) => k);
      let score = Math.min(verified.length * 10, 30);
      const tier = score >= 80 ? 'sovereign' : score >= 60 ? 'trusted' : score >= 40 ? 'established' : score >= 20 ? 'verified' : score >= 10 ? 'registered' : 'unverified';
      return { agentId, trustScore: score, tier, verifications: verified };
    };
  } catch (_) {
    computeTrustData = (agentId) => ({ agentId, trustScore: 0, tier: 'unverified' });
  }


  // ═══════════════════════════════════════════════════
  // VERIFICATION ROUTES
  // ═══════════════════════════════════════════════════

  // GET /api/verify/hyperliquid
  app.get('/api/verify/hyperliquid', (req, res) => {
    const address = req.query.address;
    if (!address) {
      return res.status(400).json({ error: 'Address parameter required' });
    }
    verifyHyperliquidTrading(address).then(result => {
      res.json(result);
    }).catch(e => {
      res.status(500).json({ error: e.message });
    });
  });

  // GET /api/verify/ethereum
  app.get('/api/verify/ethereum', (req, res) => {
    const address = req.query.address;
    if (!address || !isValidEthereumAddress(address)) {
      return res.status(400).json({ error: 'Invalid Ethereum address' });
    }
    getEthereumStats(address).then(result => {
      res.json(result);
    }).catch(e => {
      res.status(500).json({ error: e.message });
    });
  });

  // POST /api/verify/challenge
  app.post('/api/verify/challenge', express.json(), (req, res) => {
    try {
      const { profileId, chain } = req.body;
      if (!profileId) return res.status(400).json({ error: 'profileId required' });
      const profile = loadProfile(profileId, DATA_DIR);
      if (!profile) return res.status(404).json({ error: 'Profile not found' });
      const timestamp = Date.now();
      const nonce = require('crypto').randomBytes(16).toString('hex');
      const challenge = `AgentFolio verification for ${profileId} at ${timestamp} nonce:${nonce}`;
      if (!global._afChallenges) global._afChallenges = {};
      global._afChallenges[`${profileId}:${nonce}`] = { challenge, timestamp, chain: chain || 'solana', profileId };
      // Clean old challenges
      const now = Date.now();
      for (const k of Object.keys(global._afChallenges)) {
        if (now - global._afChallenges[k].timestamp > 600000) delete global._afChallenges[k];
      }
      res.json({ challenge, nonce, expiresIn: '10 minutes' });
    } catch (e) { res.status(400).json({ error: 'Invalid JSON' }); }
  });

  // POST /api/verify/sign
  app.post('/api/verify/sign', express.json(), async (req, res) => {
    try {
      const { profileId, nonce, signature, publicKey, chain } = req.body;
      if (!profileId || !nonce || !signature || !publicKey) {
        return res.status(400).json({ error: 'profileId, nonce, signature, publicKey required' });
      }
      const key = `${profileId}:${nonce}`;
      const stored = (global._afChallenges || {})[key];
      if (!stored) return res.status(400).json({ error: 'Challenge not found or expired' });
      if (Date.now() - stored.timestamp > 600000) {
        delete global._afChallenges[key];
        return res.status(400).json({ error: 'Challenge expired' });
      }
      const verifyChain = chain || stored.chain || 'solana';
      let verified = false;
      if (verifyChain === 'solana') {
        try {
          const nacl = require('tweetnacl');
          const bs58 = require('bs58');
          const messageBytes = new TextEncoder().encode(stored.challenge);
          const bs58dec = bs58.decode || bs58.default?.decode;
          const sigBytes = bs58dec(signature);
          const pubBytes = bs58dec(publicKey);
          verified = nacl.sign.detached.verify(messageBytes, sigBytes, pubBytes);
        } catch (e) { verified = false; }
      } else if (verifyChain === 'evm') {
        try {
          const { ethers } = require('ethers');
          const recovered = ethers.verifyMessage(stored.challenge, signature);
          verified = recovered.toLowerCase() === publicKey.toLowerCase();
        } catch (e) { verified = false; }
      }
      delete global._afChallenges[key];
      if (verified) {
        const profile = loadProfile(profileId, DATA_DIR);
        let onchainSucceeded = true;
        if (postVerificationHookFn) {
          onchainSucceeded = await postVerificationHookFn(profileId, verifyChain, publicKey, { method: 'headless-sign' });
        }
        if (profile && onchainSucceeded) {
          profile.verificationData = profile.verificationData || {};
          profile.wallets = profile.wallets || {};
          if (verifyChain === 'solana') {
            profile.wallets.solana = publicKey;
            profile.verificationData.solana = { verified: true, address: publicKey, verifiedAt: new Date().toISOString(), method: 'headless-sign' };
          } else if (verifyChain === 'evm') {
            profile.wallets.ethereum = publicKey;
            profile.verificationData.ethereum = { verified: true, address: publicKey, verifiedAt: new Date().toISOString(), method: 'headless-sign' };
          }
          profile.updatedAt = new Date().toISOString();
          const trust = computeTrustData(profileId);
          profile.trustScore = trust.trustScore;
          profile.tier = trust.tier;
          dbSaveProfileFn(profile);
          addActivity(profileId, 'verification_wallet', { chain: verifyChain, address: publicKey.slice(0, 8) + '...' + publicKey.slice(-4), method: 'headless' }, DATA_DIR);
          triggerWebhooks(WEBHOOK_EVENTS.VERIFICATION_SOLANA, { agentId: profileId, platform: verifyChain, address: publicKey, method: 'headless-sign' }).catch(() => {});
        }
        const updatedTrust = computeTrustData(profileId);
        res.json({ verified: !!onchainSucceeded, chain: verifyChain, address: publicKey, trustScore: updatedTrust.trustScore, tier: updatedTrust.tier, message: onchainSucceeded ? 'Wallet verified successfully' : 'On-chain verification failed' });
      } else {
        res.status(400).json({ verified: false, error: 'Signature verification failed' });
      }
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  // POST /api/verify/discord/headless
  app.post('/api/verify/discord/headless', express.json(), (req, res) => {
    try {
      const { profileId, discordUserId, discordUsername } = req.body;
      if (!profileId || !discordUserId) return res.status(400).json({ error: 'profileId and discordUserId required' });
      const profile = loadProfile(profileId, DATA_DIR);
      if (!profile) return res.status(404).json({ error: 'Profile not found' });
      profile.links = profile.links || {};
      profile.links.discord = discordUsername || discordUserId;
      profile.verificationData = profile.verificationData || {};
      profile.verificationData.discord = {
        id: discordUserId,
        username: discordUsername || discordUserId,
        verified: true,
        verifiedAt: new Date().toISOString(),
        method: 'headless-self-report',
        trustLevel: 'low'
      };
      profile.updatedAt = new Date().toISOString();
      dbSaveProfileFn(profile);
      addActivity(profileId, 'verification_discord', { username: discordUsername || discordUserId, method: 'headless' }, DATA_DIR);
      res.json({ verified: true, method: 'self-report', trustLevel: 'low', note: 'For full trust, use OAuth flow at /api/verify/discord/start' });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  // POST /api/verify/satp/headless
  app.post('/api/verify/satp/headless', express.json(), async (req, res) => {
    const authKey = req.headers['x-api-key'] || (req.headers['authorization'] || '').replace('Bearer ', '');
    const ADMIN_KEY = process.env.ADMIN_API_KEY || 'agentfolio-admin-2026';
    if (authKey !== ADMIN_KEY) {
      return res.status(403).json({ error: 'Admin access required. Use wallet-based registration at /register instead.' });
    }
    try {
      const { profileId } = req.body;
      if (!profileId) return res.status(400).json({ error: 'profileId required' });
      const profile = loadProfile(profileId, DATA_DIR);
      if (!profile) return res.status(404).json({ error: 'Profile not found' });
      const { fullOnchainRegistration } = require('../lib/verification-onchain');
      const result = await fullOnchainRegistration(profile);
      profile.verificationData = profile.verificationData || {};
      profile.verificationData.satp = {
        verified: true,
        registered: true,
        registeredAt: new Date().toISOString(),
        method: 'headless-server',
        onchainStatus: result?.registration ? 'confirmed' : 'pending',
        pda: result?.registration?.pda || null,
        explorerUrl: result?.registration?.explorerUrl || null,
        onchainVerifications: result?.verifications || {},
        onchainReputation: result?.reputation || null
      };
      const trust = computeTrustData(profileId);
      profile.trustScore = trust.trustScore;
      profile.tier = trust.tier;
      profile.updatedAt = new Date().toISOString();
      dbSaveProfileFn(profile);
      res.json({ success: true, satp: profile.verificationData.satp, trustScore: trust.trustScore, tier: trust.tier });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/verify/satp
  app.post('/api/verify/satp', express.json(), (req, res) => {
    try {
      const { profileId, wallet, txSignature } = req.body;
      if (!profileId || !wallet) {
        return res.status(400).json({ error: 'profileId and wallet required' });
      }
      const profilePath = path.join(PROFILES_DIR, profileId + '.json');
      if (!fs.existsSync(profilePath)) {
        return res.status(404).json({ error: 'Profile not found' });
      }
      const profile = JSON.parse(fs.readFileSync(profilePath, 'utf-8'));
      if (!profile.verificationData) profile.verificationData = {};
      profile.verificationData.satp = {
        verified: true,
        did: `did:satp:sol:${wallet}`,
        wallet,
        txSignature: txSignature || null,
        verifiedAt: new Date().toISOString(),
      };
      profile.updatedAt = new Date().toISOString();
      fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2));
      res.json({ success: true, satp: profile.verificationData.satp });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/verify/telegram/start
  app.post('/api/verify/telegram/start', express.json(), (req, res) => {
    try {
      const { profileId, telegramHandle } = req.body;
      if (!profileId || !telegramHandle) {
        return res.status(400).json({ error: 'profileId and telegramHandle are required' });
      }
      const profile = loadProfile(profileId, DATA_DIR);
      if (!profile) return res.status(404).json({ error: 'Profile not found' });
      const result = startTelegramVerification(profileId, telegramHandle);
      res.status(result.success || result.alreadyVerified ? 200 : 400).json(result);
    } catch (e) {
      res.status(400).json({ error: 'Invalid JSON: ' + e.message });
    }
  });

  // POST /api/verify/telegram/confirm
  app.post('/api/verify/telegram/confirm', express.json(), async (req, res) => {
    try {
      const { code, telegramUserId, telegramUsername } = req.body;
      if (!code) return res.status(400).json({ error: 'code is required' });
      const result = verifyTelegramCode(code, telegramUserId, telegramUsername);
      if (result.verified) {
        const profile = loadProfile(result.profileId);
        let onchainSucceeded = true;
        if (postVerificationHookFn) {
          onchainSucceeded = await postVerificationHookFn(result.profileId, 'telegram', result.telegramHandle, { method: 'telegram-code' });
        }
        if (profile && onchainSucceeded) {
          const updatedProfile = { ...profile };
          updatedProfile.links = updatedProfile.links || {};
          updatedProfile.links.telegram = result.telegramHandle;
          updatedProfile.verificationData = updatedProfile.verificationData || {};
          updatedProfile.verificationData.telegram = {
            handle: result.telegramHandle,
            telegramId: result.telegramId,
            verified: true,
            verifiedAt: new Date().toISOString()
          };
          updatedProfile.updatedAt = new Date().toISOString();
          dbSaveProfileFn(updatedProfile);
          addActivityAndBroadcast(result.profileId, 'verification_telegram', { handle: result.telegramHandle }, DATA_DIR);
          triggerWebhooks(WEBHOOK_EVENTS.VERIFICATION_COMPLETE || 'verification_complete', {
            agentId: result.profileId, platform: 'telegram', handle: result.telegramHandle,
            profileUrl: `https://agentfolio.bot/profile/${result.profileId}`
          }).catch(e => logger.error('Webhook error', { error: e.message }));
        }
      }
      res.status(result.verified ? 200 : 400).json(result);
    } catch (e) {
      res.status(400).json({ error: 'Invalid JSON: ' + e.message });
    }
  });

  // GET /api/verify/telegram/status
  app.get('/api/verify/telegram/status', (req, res) => {
    const profileId = req.query.profileId;
    if (!profileId) return res.status(400).json({ error: 'profileId query param required' });
    const verified = getTelegramVerificationStatus(profileId);
    const pending = getPendingTelegramVerification(profileId);
    res.json({ profileId, verified: verified !== null, verificationData: verified, pendingVerification: pending });
  });

  // GET /api/verify/telegram/all
  app.get('/api/verify/telegram/all', (req, res) => {
    const verified = getAllTelegramVerified();
    res.json({ count: Object.keys(verified).length, verifications: verified });
  });

  // GET /api/verify/discord/status
  app.get('/api/verify/discord/status', (req, res) => {
    res.json({
      configured: isDiscordConfigured(),
      message: isDiscordConfigured()
        ? 'Discord OAuth2 is configured and ready'
        : 'Discord OAuth2 is not configured. Set DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET environment variables.'
    });
  });

  // POST /api/verify/discord/start
  app.post('/api/verify/discord/start', express.json(), (req, res) => {
    try {
      const { profileId } = req.body;
      if (!profileId) return res.status(400).json({ error: 'profileId is required' });
      const profile = loadProfile(profileId, DATA_DIR);
      if (!profile) return res.status(404).json({ error: 'Profile not found' });
      const result = startDiscordVerification(profileId);
      res.status(result.success || result.alreadyVerified || result.notConfigured ? 200 : 400).json(result);
    } catch (e) {
      res.status(400).json({ error: 'Invalid JSON: ' + e.message });
    }
  });

  // GET /api/verify/discord/callback
  app.get('/api/verify/discord/callback', async (req, res) => {
    const code = req.query.code;
    const state = req.query.state;
    const error = req.query.error;
    if (error) { res.redirect('/?discord_error=' + encodeURIComponent(error)); return; }
    if (!code || !state) {
      return res.status(400).send('<html><body><h1>Error</h1><p>Missing authorization code or state</p><a href="/">Back to AgentFolio</a></body></html>');
    }
    try {
      const result = await handleDiscordCallback(code, state);
      if (result.verified) {
        const profile = loadProfile(result.profileId);
        let onchainSucceeded = true;
        if (postVerificationHookFn) {
          onchainSucceeded = await postVerificationHookFn(result.profileId, 'discord', result.discordUser.username, { method: 'discord-oauth' });
        }
        if (profile && onchainSucceeded) {
          const updatedProfile = { ...profile };
          updatedProfile.links = updatedProfile.links || {};
          updatedProfile.links.discord = formatDiscordUsername(result.discordUser.username, result.discordUser.discriminator);
          updatedProfile.verificationData = updatedProfile.verificationData || {};
          updatedProfile.verificationData.discord = {
            id: result.discordUser.id,
            username: result.discordUser.username,
            discriminator: result.discordUser.discriminator,
            globalName: result.discordUser.globalName,
            avatar: result.discordUser.avatar,
            avatarUrl: getDiscordAvatarUrl(result.discordUser.id, result.discordUser.avatar),
            verified: true,
            verifiedAt: new Date().toISOString()
          };
          updatedProfile.updatedAt = new Date().toISOString();
          dbSaveProfileFn(updatedProfile);
          addActivityAndBroadcast(result.profileId, 'verification_discord', { username: result.discordUser.username }, DATA_DIR);
          triggerWebhooks(WEBHOOK_EVENTS.VERIFICATION_COMPLETE || 'verification_complete', {
            agentId: result.profileId, platform: 'discord', username: result.discordUser.username,
            profileUrl: `https://agentfolio.bot/profile/${result.profileId}`
          }).catch(e => logger.error('Webhook error', { error: e.message }));
          res.redirect(`/profile/${result.profileId}?discord_verified=1`);
        } else {
          res.redirect(`/profile/${result.profileId}?discord_error=onchain_failed`);
        }
      } else {
        res.redirect('/?discord_error=' + encodeURIComponent(result.error || 'Verification failed'));
      }
    } catch (err) {
      console.error('[Discord Callback] Error:', err);
      res.redirect('/?discord_error=' + encodeURIComponent(err.message));
    }
  });

  // GET /api/verify/discord/profile
  app.get('/api/verify/discord/profile', (req, res) => {
    const profileId = req.query.profileId;
    if (!profileId) return res.status(400).json({ error: 'profileId query param required' });
    const verified = getDiscordVerificationStatus(profileId);
    const pending = getPendingDiscordVerification(profileId);
    res.json({ profileId, verified: verified !== null, verificationData: verified, pendingVerification: pending });
  });

  // GET /api/verify/discord/all
  app.get('/api/verify/discord/all', (req, res) => {
    const verified = getAllDiscordVerified();
    res.json({ count: Object.keys(verified).length, verifications: verified });
  });

  // GET /api/verify/polymarket/stats
  app.get('/api/verify/polymarket/stats', (req, res) => {
    const address = req.query.address;
    if (!address) return res.status(400).json({ error: 'address query param required' });
    getPolymarketStats(address).then(stats => {
      res.status(stats?.error ? 400 : 200).json(stats);
    }).catch(err => {
      res.status(500).json({ error: err.message });
    });
  });

  // GET /api/verify/polymarket/challenge
  app.get('/api/verify/polymarket/challenge', (req, res) => {
    const profileId = req.query.profileId;
    if (!profileId) return res.status(400).json({ error: 'profileId query param required' });
    const challenge = generateVerificationMessage(profileId);
    res.json(challenge);
  });

  // POST /api/verify/polymarket
  app.post('/api/verify/polymarket', express.json(), (req, res) => {
    try {
      const { profileId, address, signature, message } = req.body;
      if (!profileId || !address || !signature || !message) {
        return res.status(400).json({ error: 'profileId, address, signature, and message required' });
      }
      const profile = loadProfile(profileId, DATA_DIR);
      if (!profile) return res.status(404).json({ error: 'Profile not found' });
      verifyPolymarketTrading(profileId, address, signature, message).then(result => {
        if (result.verified) {
          profile.wallets = profile.wallets || {};
          profile.wallets.polymarket = address;
          profile.verificationData = profile.verificationData || {};
          profile.verificationData.polymarket = {
            address, stats: result.stats, verified: true, verifiedAt: result.verifiedAt
          };
          profile.updatedAt = new Date().toISOString();
          dbSaveProfileFn(profile);
          addActivity(profileId, 'verification_polymarket', {
            address: address.slice(0, 6) + '...' + address.slice(-4),
            winRate: result.stats.winRate, pnl: result.stats.realizedPnL
          }, DATA_DIR);
        }
        res.status(result.verified ? 200 : 400).json(result);
      }).catch(err => {
        res.status(500).json({ error: err.message });
      });
    } catch (e) { res.status(400).json({ error: 'Invalid JSON' }); }
  });

  // POST /api/verify/kalshi
  app.post('/api/verify/kalshi', express.json(), (req, res) => {
    try {
      const { profileId, email, password, demo } = req.body;
      if (!profileId || !email || !password) {
        return res.status(400).json({ error: 'profileId, email, and password required' });
      }
      const profile = loadProfile(profileId, DATA_DIR);
      if (!profile) return res.status(404).json({ error: 'Profile not found' });
      verifyKalshiTrading(email, password, demo || false).then(result => {
        if (result.verified) {
          profile.verificationData = profile.verificationData || {};
          profile.verificationData.kalshi = {
            memberId: result.memberId, stats: result.stats, balance: result.balance,
            verified: true, verifiedAt: result.verifiedAt, isDemo: result.isDemo
          };
          profile.updatedAt = new Date().toISOString();
          dbSaveProfileFn(profile);
          addActivity(profileId, 'verification_kalshi', { winRate: result.stats.winRate, trades: result.stats.totalTrades }, DATA_DIR);
        }
        const safeResult = { verified: result.verified, stats: result.stats, error: result.error };
        res.status(result.verified ? 200 : 400).json(safeResult);
      }).catch(err => {
        res.status(500).json({ error: err.message });
      });
    } catch (e) { res.status(400).json({ error: 'Invalid JSON' }); }
  });

  // GET /api/verify/moltbook/challenge
  app.get('/api/verify/moltbook/challenge', (req, res) => {
    const profileId = req.query.profileId;
    if (!profileId) return res.status(400).json({ error: 'profileId required' });
    const challengeString = getMoltbookChallengeString(profileId);
    res.json({ challengeString, instructions: `Add "${challengeString}" to your Moltbook bio, then verify.` });
  });

  // POST /api/verify/moltbook
  app.post('/api/verify/moltbook', express.json(), async (req, res) => {
    try {
      const { profileId, moltbookUsername } = req.body;
      if (!profileId || !moltbookUsername) {
        return res.status(400).json({ error: 'profileId and moltbookUsername required' });
      }
      const profile = loadProfile(profileId, DATA_DIR);
      if (!profile) return res.status(404).json({ error: 'Profile not found' });
      const result = await verifyMoltbookAccount(profileId, moltbookUsername);
      if (result.verified) {
        let onchainSucceeded = true;
        if (postVerificationHookFn) {
          onchainSucceeded = await postVerificationHookFn(profileId, 'moltbook', moltbookUsername, { method: 'moltbook-bio' });
        }
        if (onchainSucceeded) {
          profile.verificationData = profile.verificationData || {};
          profile.verificationData.moltbook = {
            verified: true, username: moltbookUsername, karma: result.karma || 0, verifiedAt: new Date().toISOString()
          };
          profile.links = profile.links || {};
          profile.links.moltbook = moltbookUsername;
          profile.updatedAt = new Date().toISOString();
          dbSaveProfileFn(profile);
          addActivityAndBroadcast(profileId, 'verification_moltbook', { username: moltbookUsername, karma: result.karma || 0 }, DATA_DIR);
        }
      }
      res.status(result.verified ? 200 : 400).json(result);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/verify/mcp
  app.post('/api/verify/mcp', express.json(), async (req, res) => {
    try {
      const { profileId, mcpUrl } = req.body;
      if (!profileId || !mcpUrl) return res.status(400).json({ error: 'profileId and mcpUrl required' });
      const profile = loadProfile(profileId, DATA_DIR);
      if (!profile) return res.status(404).json({ error: 'Profile not found' });
      const result = await verifyMcpEndpoint(mcpUrl, profileId);
      if (result.verified) {
        const verifiedUrl = result.url || mcpUrl;
        let onchainSucceeded = true;
        if (postVerificationHookFn) {
          onchainSucceeded = await postVerificationHookFn(profileId, 'mcp', verifiedUrl, { method: 'mcp-endpoint' });
        }
        if (onchainSucceeded) {
          profile.verificationData = profile.verificationData || {};
          profile.verificationData.mcp = {
            verified: true, url: verifiedUrl, method: result.method, toolCount: result.toolCount || 0, verifiedAt: new Date().toISOString()
          };
          profile.updatedAt = new Date().toISOString();
          dbSaveProfileFn(profile);
          upsertActiveVerification(profileId, 'mcp', verifiedUrl, {
            url: verifiedUrl,
            method: result.method,
            toolCount: result.toolCount || 0,
            identifier: verifiedUrl,
            verifiedAt: profile.verificationData.mcp.verifiedAt
          });
          addActivityAndBroadcast(profileId, 'verification_mcp', { url: verifiedUrl, method: result.method, tools: result.toolCount || 0 }, DATA_DIR);
        }
      }
      res.status(result.verified ? 200 : 400).json(result);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/verify/a2a
  app.post('/api/verify/a2a', express.json(), async (req, res) => {
    try {
      const { profileId, agentUrl } = req.body;
      if (!profileId || !agentUrl) return res.status(400).json({ error: 'profileId and agentUrl required' });
      const profile = loadProfile(profileId, DATA_DIR);
      if (!profile) return res.status(404).json({ error: 'Profile not found' });
      const result = await verifyA2aAgentCard(agentUrl, profileId);
      if (result.verified) {
        const verifiedUrl = result.url || agentUrl;
        let onchainSucceeded = true;
        if (postVerificationHookFn) {
          onchainSucceeded = await postVerificationHookFn(profileId, 'a2a', verifiedUrl, { method: 'a2a-card' });
        }
        if (onchainSucceeded) {
          profile.verificationData = profile.verificationData || {};
          profile.verificationData.a2a = {
            verified: true, url: verifiedUrl, agentName: result.agentName, verifiedAt: new Date().toISOString()
          };
          profile.updatedAt = new Date().toISOString();
          dbSaveProfileFn(profile);
          upsertActiveVerification(profileId, 'a2a', verifiedUrl, {
            url: verifiedUrl,
            agentName: result.agentName,
            identifier: verifiedUrl,
            verifiedAt: profile.verificationData.a2a.verifiedAt
          });
          addActivityAndBroadcast(profileId, 'verification_a2a', { url: verifiedUrl, agentName: result.agentName }, DATA_DIR);
        }
      }
      res.status(result.verified ? 200 : 400).json(result);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/verify/website/challenge
  app.post('/api/verify/website/challenge', express.json(), (req, res) => {
    try {
      const { profileId, websiteUrl } = req.body;
      if (!profileId || !websiteUrl) return res.status(400).json({ error: 'profileId and websiteUrl required' });
      const profile = loadProfile(profileId, DATA_DIR);
      if (!profile) return res.status(404).json({ error: 'Profile not found' });
      const challenge = generateWebsiteChallenge(profileId, websiteUrl);
      res.json(challenge);
    } catch (e) { res.status(400).json({ error: 'Invalid JSON' }); }
  });

  // POST /api/verify/website/confirm
  app.post('/api/verify/website/confirm', express.json(), async (req, res) => {
    try {
      const { challengeId } = req.body;
      if (!challengeId) return res.status(400).json({ error: 'challengeId required' });
      const result = await confirmWebsiteVerification(challengeId);
      if (result.verified) {
        const profile = loadProfile(result.profileId, DATA_DIR);
        if (profile) {
          let onchainSucceeded = true;
          if (postVerificationHookFn) {
            onchainSucceeded = await postVerificationHookFn(result.profileId, 'website', result.websiteUrl, { method: 'website-dns' });
          }
          if (onchainSucceeded) {
            profile.verificationData = profile.verificationData || {};
            profile.verificationData.website = {
              verified: true, url: result.websiteUrl, verifiedAt: new Date().toISOString()
            };
            profile.links = profile.links || {};
            profile.links.website = result.websiteUrl;
            profile.updatedAt = new Date().toISOString();
            dbSaveProfileFn(profile);
            upsertActiveVerification(result.profileId, 'website', result.websiteUrl, {
              url: result.websiteUrl,
              method: 'website-well-known',
              identifier: result.websiteUrl,
              verifiedAt: profile.verificationData.website.verifiedAt
            });
            addActivityAndBroadcast(result.profileId, 'verification_website', { url: result.websiteUrl }, DATA_DIR);
          }
        }
      }
      res.status(result.verified ? 200 : 400).json(result);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });


  // ═══════════════════════════════════════════════════
  // SATP AUTO-IDENTITY ROUTES
  // ═══════════════════════════════════════════════════

  // POST /api/satp-auto/identity/create
  app.post('/api/satp-auto/identity/create', express.json(), async (req, res) => {
    try {
      const { buildCreateIdentityTx, SATP_IDENTITY_PROGRAM } = require('./satp-auto-identity');
      const { walletAddress, profileId, name, description, category } = req.body || {};
      if (!walletAddress) return res.status(400).json({ error: 'walletAddress required' });

      let agentName = name || 'Agent';
      let agentDescription = description || 'AgentFolio verified agent';
      let agentCategory = category || 'ai-agent';
      let capabilities = [];
      let metadataUri = '';

      if (profileId) {
        try {
          const Database = require('better-sqlite3');
          const db = new Database(path.join(__dirname, '..', '..', 'data', 'agentfolio.db'), { readonly: true });
          const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(profileId);
          if (profile) {
            agentName = (profile.name || agentName).slice(0, 32);
            agentDescription = (profile.bio || agentDescription).slice(0, 256);
            try { capabilities = JSON.parse(profile.capabilities || '[]').slice(0, 10); } catch {}
            metadataUri = 'https://agentfolio.bot/api/profile/' + profileId;
          }
          db.close();
        } catch (e) { console.warn('[SATP AutoID] Profile lookup failed:', e.message); }
      }

      const result = await buildCreateIdentityTx(walletAddress, agentName, agentDescription, agentCategory, capabilities, metadataUri);
      if (result.alreadyExists) {
        return res.json({ ok: true, data: { ...result, message: 'SATP identity already exists for this wallet' } });
      }
      console.log('[SATP AutoID] Built create_identity TX for ' + walletAddress + ' (profile: ' + (profileId || 'none') + ')');
      res.json({ ok: true, data: result });
    } catch (err) {
      console.error('[SATP AutoID] create error:', err.message);
      res.status(500).json({ error: 'Failed to build identity TX', detail: err.message });
    }
  });

  // POST /api/satp-auto/identity/confirm
  app.post('/api/satp-auto/identity/confirm', express.json(), async (req, res) => {
    try {
      const { getIdentityPDA, SATP_IDENTITY_PROGRAM } = require('./satp-auto-identity');
      const { walletAddress, profileId, txSignature } = req.body || {};
      if (!walletAddress || !profileId) return res.status(400).json({ error: 'walletAddress and profileId required' });
      const { PublicKey } = require('@solana/web3.js');
      const [identityPDA] = getIdentityPDA(new PublicKey(walletAddress));
      try {
        const Database = require('better-sqlite3');
        const db = new Database(path.join(__dirname, '..', '..', 'data', 'agentfolio.db'));
        const profile = db.prepare('SELECT verification_data FROM profiles WHERE id = ?').get(profileId);
        if (profile) {
          let vd = {};
          try { vd = JSON.parse(profile.verification_data || '{}'); } catch {}
          vd.satp = { verified: true, identityPDA: identityPDA.toBase58(), txSignature, program: SATP_IDENTITY_PROGRAM.toBase58(), network: 'mainnet', verifiedAt: new Date().toISOString() };
          db.prepare('UPDATE profiles SET verification_data = ? WHERE id = ?').run(JSON.stringify(vd), profileId);
        }
        db.close();
        console.log('[SATP AutoID] Identity confirmed for ' + profileId + ': PDA=' + identityPDA.toBase58());
      } catch (dbErr) { console.warn('[SATP AutoID] DB update failed:', dbErr.message); }
      res.json({ ok: true, data: { identityPDA: identityPDA.toBase58(), txSignature, network: 'mainnet', walletAddress, profileId } });
    } catch (err) {
      console.error('[SATP AutoID] confirm error:', err.message);
      res.status(500).json({ error: 'Failed to confirm identity', detail: err.message });
    }
  });

  // GET /api/satp-auto/identity/check/:wallet
  app.get('/api/satp-auto/identity/check/:wallet', async (req, res) => {
    try {
      const { hasIdentity, getIdentityPDA } = require('./satp-auto-identity');
      const wallet = req.params.wallet;
      const { PublicKey } = require('@solana/web3.js');
      const exists = await hasIdentity(wallet);
      const [pda] = getIdentityPDA(new PublicKey(wallet));
      res.json({ ok: true, exists, identityPDA: pda.toBase58(), network: 'mainnet' });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // POST /api/satp/genesis/prepare
  app.post('/api/satp/genesis/prepare', express.json(), async (req, res) => {
    try {
      const { createSATPClient, agentIdHash } = require('../satp-client/src');
      const client = createSATPClient({ rpcUrl: process.env.SOLANA_RPC_URL || 'https://mainnet.helius-rpc.com/?api-key=91c63e44-1c7a-4b98-830b-6135632565fb' });
      const { agentId, payer } = req.body;
      if (!agentId || !payer) return res.status(400).json({ error: 'agentId and payer required' });

      // Check if genesis record already exists
      try {
        const existing = await client.getGenesisRecord(agentId);
        if (existing && !existing.error) {
          return res.status(409).json({ error: 'Genesis record already exists', genesis: existing });
        }
      } catch (e) { /* no record = good */ }

      const profile = loadProfile(agentId, DATA_DIR);
      const name = profile ? (profile.name || agentId).substring(0, 32) : agentId.substring(0, 32);
      const bio = profile ? (profile.bio || 'AgentFolio registered agent').substring(0, 256) : 'AgentFolio registered agent';
      const skills = profile?.skills ? (Array.isArray(profile.skills) ? profile.skills : []).slice(0, 5).map(s => s.name || s) : [];
      const category = profile?.framework || 'general';

      const hashBuf = agentIdHash(agentId);
      const { PublicKey, Keypair } = require('@solana/web3.js');
      const payerKey = new PublicKey(payer);

      const KEYPAIR_PATH = process.env.SATP_PLATFORM_KEYPAIR || '/home/ubuntu/.config/solana/mainnet-deployer.json';
      const deployerKey = JSON.parse(fs.readFileSync(KEYPAIR_PATH, 'utf-8'));
      const deployer = Keypair.fromSecretKey(Uint8Array.from(deployerKey));

      const { transaction, genesisPda } = await client.buildCreateGenesisRecord(
        deployer.publicKey, hashBuf, name, bio, category, skills, ''
      );

      transaction.feePayer = payerKey;
      const { blockhash, lastValidBlockHeight } = await client.connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.partialSign(deployer);

      const serialized = transaction.serialize({ requireAllSignatures: false });
      const base64Tx = serialized.toString('base64');

      res.json({
        transaction: base64Tx,
        genesisPda: genesisPda.toBase58(),
        agentId, payer, blockhash, lastValidBlockHeight,
        estimatedCost: '~0.0105 SOL'
      });
    } catch (e) {
      console.error('[SATP V3] Genesis prepare error:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/satp/overview
  app.get('/api/satp/overview', async (req, res) => {
    try {
      const { getSATPOverview } = require('../lib/satp-explorer');
      const overview = await getSATPOverview();
      res.json(overview);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  console.log('[RestoredRoutes] ✓ Registered 31 verification + SATP routes');
}

// Need express for express.json() middleware
const express = require('express');

module.exports = { registerRestoredRoutes };
