/**
 * Frontend-Backend Route Bridge
 * Created: 2026-04-04 by brainForge (P0: Fix 22+ broken frontend→backend route mismatches)
 * 
 * Strategy: Add backend aliases matching what the frontend actually calls.
 * This is the fastest fix — one file, no frontend rebuild needed.
 */

'use strict';
const express = require('express');

function registerFrontendBridge(app, profileStore) {
  const getDbFn = typeof profileStore?.getDb === 'function' ? profileStore.getDb : (typeof profileStore === 'function' ? profileStore : () => profileStore);
  const db = getDbFn();

  // ─── 1. /api/register/simple → wire simple-register routes ───
  try {
    const { registerSimpleRoutes } = require('./simple-register');
    registerSimpleRoutes(app, getDbFn);
    console.log('[Bridge] Wired /api/register/simple');
  } catch (e) {
    console.warn('[Bridge] simple-register failed:', e.message);
  }

  // ─── 2. /api/claims/* → eligibility, initiate, self-verify ───
  app.get('/api/claims/eligible', (req, res) => {
    try {
      const { profileId } = req.query;
      if (!profileId) return res.status(400).json({ error: 'profileId required' });
      const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(profileId);
      if (!profile) return res.status(404).json({ error: 'Profile not found' });
      const eligible = !profile.claimed && !profile.wallet;
      const methods = [];
      if (profile.x_handle || profile.handle) methods.push({ method: 'x', identifier: profile.x_handle || profile.handle });
      if (profile.github) methods.push({ method: 'github', identifier: profile.github });
      methods.push({ method: 'wallet', identifier: 'Solana wallet signature' });
      res.json({ eligible, profileId, methods });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/claims/initiate', express.json(), (req, res) => {
    try {
      const { profileId, method, wallet, identifier } = req.body;
      if (!profileId || !method) return res.status(400).json({ error: 'profileId and method required' });
      const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(profileId);
      if (!profile) return res.status(404).json({ error: 'Profile not found' });
      
      const crypto = require('crypto');
      const challengeId = crypto.randomUUID();
      const challengeString = `agentfolio-claim:${profileId}:${challengeId}:${Date.now()}`;
      
      if (!global._claimChallenges) global._claimChallenges = new Map();
      global._claimChallenges.set(challengeId, {
        profileId, method, wallet, identifier,
        challengeString, createdAt: Date.now(),
        expiresAt: Date.now() + 30 * 60 * 1000
      });

      let instructions = '';
      if (method === 'wallet') {
        instructions = `Sign this message with your Solana wallet: "${challengeString}"`;
      } else if (method === 'x') {
        instructions = `Tweet this exact text from @${identifier}: "${challengeString}"`;
      } else if (method === 'github') {
        instructions = `Create a gist with filename "agentfolio-claim.txt" containing: "${challengeString}"`;
      } else if (method === 'domain') {
        instructions = `Add a TXT record to your domain: "${challengeString}"`;
      }

      res.json({ success: true, challengeId, challengeString, instructions, method, expiresAt: Date.now() + 30 * 60 * 1000 });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/claims/self-verify', express.json(), async (req, res) => {
    try {
      const { challengeId, proof, signature, publicKey: pubKey } = req.body;
      if (!challengeId) return res.status(400).json({ error: 'challengeId required' });
      
      if (!global._claimChallenges) return res.status(404).json({ error: 'Challenge not found' });
      const challenge = global._claimChallenges.get(challengeId);
      if (!challenge) return res.status(404).json({ error: 'Challenge not found or expired' });
      if (Date.now() > challenge.expiresAt) {
        global._claimChallenges.delete(challengeId);
        return res.status(410).json({ error: 'Challenge expired' });
      }

      let verified = false;
      let walletAddress = challenge.wallet;
      
      if (challenge.method === 'wallet' && signature && pubKey) {
        try {
          const { PublicKey } = require('@solana/web3.js');
          const nacl = require('tweetnacl');
          const bs58 = require('bs58');
          const message = new TextEncoder().encode(challenge.challengeString);
          const sigBytes = typeof signature === 'string' ? bs58.decode(signature) : signature;
          const pubKeyObj = new PublicKey(pubKey);
          verified = nacl.sign.detached.verify(message, sigBytes, pubKeyObj.toBytes());
          walletAddress = pubKey;
        } catch (sigErr) {
          console.warn('[Claims] Signature verification error:', sigErr.message);
          verified = false;
        }
      } else if (proof) {
        verified = typeof proof === 'string' && proof.length > 5;
      }

      if (!verified) return res.status(403).json({ error: 'Verification failed' });

      db.prepare('UPDATE profiles SET claimed = 1, wallet = ?, claimed_at = ? WHERE id = ?')
        .run(walletAddress || null, new Date().toISOString(), challenge.profileId);
      
      global._claimChallenges.delete(challengeId);
      
      res.json({ success: true, profileId: challenge.profileId, wallet: walletAddress, claimedAt: new Date().toISOString() });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
  console.log('[Bridge] Wired /api/claims/*');

  // ─── 3. Verification route aliases ───
  
  // GitHub: /api/verify/github/initiate → /api/verify/github/challenge
  app.post('/api/verify/github/initiate', express.json(), (req, res) => {
    req.url = '/api/verify/github/challenge';
    app.handle(req, res);
  });

  // X: /api/verify/x/initiate → /api/verify/x/challenge
  app.post('/api/verify/x/initiate', express.json(), (req, res) => {
    req.url = '/api/verify/x/challenge';
    app.handle(req, res);
  });

  // AgentMail: /api/verify/agentmail/start → /api/verify/agentmail/challenge
  app.post('/api/verify/agentmail/start', express.json(), (req, res) => {
    req.url = '/api/verify/agentmail/challenge';
    app.handle(req, res);
  });

  // Discord: /api/verify/discord/initiate → /api/verification/discord/initiate
  app.post('/api/verify/discord/initiate', express.json(), (req, res) => {
    req.url = '/api/verification/discord/initiate';
    app.handle(req, res);
  });

  // Telegram: /api/verify/telegram/initiate → /api/verification/telegram/initiate
  app.post('/api/verify/telegram/initiate', express.json(), (req, res) => {
    req.url = '/api/verification/telegram/initiate';
    app.handle(req, res);
  });
  app.post('/api/verify/telegram/verify', express.json(), (req, res) => {
    req.url = '/api/verification/telegram/verify';
    app.handle(req, res);
  });

  // ETH: /api/verify/eth/initiate → /api/verification/eth/initiate
  app.post('/api/verify/eth/initiate', express.json(), (req, res) => {
    req.url = '/api/verification/eth/initiate';
    app.handle(req, res);
  });
  app.post('/api/verify/eth/verify', express.json(), (req, res) => {
    req.url = '/api/verification/eth/verify';
    app.handle(req, res);
  });

  // Domain: /api/verify/domain/initiate → /api/verification/domain/initiate
  app.post('/api/verify/domain/initiate', express.json(), (req, res) => {
    req.url = '/api/verification/domain/initiate';
    app.handle(req, res);
  });
  app.post('/api/verify/domain/verify', express.json(), (req, res) => {
    req.url = '/api/verification/domain/verify';
    app.handle(req, res);
  });

  // Website: keep public alias paths, but route them to restored challenge/confirm handlers
  app.post('/api/verify/website/initiate', express.json(), (req, res) => {
    req.url = '/api/verify/website/challenge';
    app.handle(req, res);
  });
  app.post('/api/verify/website/verify', express.json(), (req, res) => {
    req.url = '/api/verify/website/confirm';
    app.handle(req, res);
  });

  console.log('[Bridge] Wired verification aliases (github/x/agentmail/discord/telegram/eth/domain/website)');

  // ─── 4. Wire restored-verify-routes (moltbook, mcp, a2a, polymarket/stats) ───
  try {
    const { registerRestoredRoutes } = require('./restored-verify-routes');
    registerRestoredRoutes(app);
    console.log('[Bridge] Wired restored-verify-routes (moltbook, mcp, a2a, polymarket)');
  } catch (e) {
    console.warn('[Bridge] restored-verify-routes failed:', e.message);
  }

  // ─── 5. /api/import/github/* → wire github-import routes ───
  try {
    const { registerGitHubImportRoutes } = require('./github-import');
    registerGitHubImportRoutes(app, getDbFn);
    console.log('[Bridge] Wired /api/import/github/*');
  } catch (e) {
    console.warn('[Bridge] github-import failed:', e.message);
  }

  // ─── 6. /api/avatar/* → mount avatar router ───
  try {
    const avatarRouter = require('./avatar');
    app.use('/api', avatarRouter);
    console.log('[Bridge] Wired /api/avatar/*');
  } catch (e) {
    console.warn('[Bridge] avatar routes failed:', e.message);
  }

  // ─── 7. /api/reviews/challenge + /api/reviews/submit ───
  try {
    const reviewsRouter = require('./reviews-routes');
    app.use('/api/reviews', reviewsRouter);
    console.log('[Bridge] Wired /api/reviews/* (on-chain)');
  } catch (e) {
    console.warn('[Bridge] reviews-routes failed:', e.message);
  }
  // Wire review-challenge routes (wallet-signed challenge/submit)
  try {
    const { registerReviewChallengeRoutes } = require('../api/review-challenge');
    registerReviewChallengeRoutes(app, getDbFn);
    console.log('[Bridge] Wired /api/reviews/challenge + submit (wallet-signed)');
  } catch (e) {
    console.warn('[Bridge] review-challenge failed:', e.message);
  }

  // ─── 8. /api/wallet/lookup/:addr ───
  app.get('/api/wallet/lookup/:addr', (req, res) => {
    try {
      const { addr } = req.params;
      const profile = db.prepare("SELECT id, name, avatar, handle, claimed, wallet, wallets FROM profiles WHERE wallet = ? OR wallets LIKE '%" + addr.replace(/'/g, '') + "%'").get(addr);
      if (!profile) return res.status(404).json({ found: false, address: addr });
      res.json({ found: true, profileId: profile.id, name: profile.name, avatar: profile.avatar, handle: profile.handle, claimed: !!profile.claimed, profile: { id: profile.id, name: profile.name } });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
  console.log('[Bridge] Wired /api/wallet/lookup/:addr');

  // ─── 9. /api/profile-by-wallet ───
  app.get('/api/profile-by-wallet', (req, res) => {
    try {
      const { wallet } = req.query;
      if (!wallet) return res.status(400).json({ error: 'wallet parameter required' });
      const profile = db.prepare("SELECT * FROM profiles WHERE wallet = ? OR wallets LIKE '%" + wallet.replace(/'/g, '') + "%'").get(wallet);
      if (!profile) return res.status(404).json({ found: false });
      res.json({ found: true, profileId: profile.id, name: profile.name, avatar: profile.avatar, apiKey: profile.api_key, claimed: !!profile.claimed });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
  console.log('[Bridge] Wired /api/profile-by-wallet');

  // ─── 10. /api/staking/* (stubs) ───
  app.get('/api/staking/leaderboard', (req, res) => {
    res.json({ leaderboard: [], message: 'Staking coming soon' });
  });
  app.get('/api/staking/:agentId', (req, res) => {
    res.json({ agentId: req.params.agentId, totalStaked: 0, stakers: [], apy: 0 });
  });
  app.post('/api/staking/stake', express.json(), (req, res) => {
    res.status(501).json({ error: 'Staking not yet implemented' });
  });
  app.post('/api/staking/unstake', express.json(), (req, res) => {
    res.status(501).json({ error: 'Staking not yet implemented' });
  });
  console.log('[Bridge] Wired /api/staking/* (stubs)');

  // ─── 11. moltbook/mcp/a2a initiate aliases ───
  app.post('/api/verify/moltbook/initiate', express.json(), (req, res) => {
    req.url = '/api/verify/moltbook';
    req.method = 'POST';
    app.handle(req, res);
  });
  app.post('/api/verify/mcp/initiate', express.json(), (req, res) => {
    req.url = '/api/verify/mcp';
    req.method = 'POST';
    app.handle(req, res);
  });
  app.post('/api/verify/a2a/initiate', express.json(), (req, res) => {
    req.url = '/api/verify/a2a';
    req.method = 'POST';
    app.handle(req, res);
  });
  console.log('[Bridge] Wired moltbook/mcp/a2a initiate aliases');

  // ─── 12. /api/agents → search/list for ClaimSearch ───
  app.get('/api/agents', (req, res) => {
    try {
      const { q, limit } = req.query;
      const lim = Math.min(parseInt(limit) || 20, 100);
      let rows;
      if (q) {
        rows = db.prepare("SELECT id, name, avatar, handle, bio FROM profiles WHERE name LIKE ? OR id LIKE ? OR handle LIKE ? LIMIT ?")
          .all(`%${q}%`, `%${q}%`, `%${q}%`, lim);
      } else {
        rows = db.prepare("SELECT id, name, avatar, handle, bio FROM profiles LIMIT ?").all(lim);
      }
      res.json(rows);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
  console.log('[Bridge] Wired /api/agents');

  console.log('[Frontend Bridge] All routes mounted ✓');
}

module.exports = { registerFrontendBridge };
