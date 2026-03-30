/**
 * Self-Service Claim Flow — Express Routes
 * Wires claim endpoints into the AgentFolio Express app.
 * Uses SQLite (profile-store) instead of JSON files.
 * 
 * Endpoints:
 *   GET  /api/claims/eligible?profileId=XXX  — Check if profile can be claimed + available methods
 *   POST /api/claims/initiate                — Start a claim (generate challenge)
 *   POST /api/claims/self-verify             — Submit proof and complete claim
 */

const crypto = require('crypto');

// In-memory store for pending claims (TTL: 30 minutes)
const pendingClaims = new Map();
const claimAttempts = new Map(); // wallet -> { count, windowStart }

const CLAIM_EXPIRY_MS = 30 * 60 * 1000; // 30 minutes
const MAX_ATTEMPTS_PER_HOUR = 5;
const ATTEMPT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

function cleanupExpired() {
  const now = Date.now();
  for (const [id, c] of pendingClaims) {
    if (c.expiresAt < now) pendingClaims.delete(id);
  }
}

function checkRateLimit(wallet) {
  const now = Date.now();
  const attempts = claimAttempts.get(wallet);
  if (!attempts || (now - attempts.windowStart > ATTEMPT_WINDOW_MS)) {
    claimAttempts.set(wallet, { count: 1, windowStart: now });
    return true;
  }
  if (attempts.count >= MAX_ATTEMPTS_PER_HOUR) return false;
  attempts.count++;
  return true;
}

function extractHandle(url, platform) {
  if (!url) return null;
  try {
    if (platform === 'x') {
      const match = url.match(/(?:twitter\.com|x\.com)\/(@?[\w]+)/i);
      return match ? match[1].replace(/^@/, '') : null;
    }
    if (platform === 'github') {
      const match = url.match(/github\.com\/([\w-]+)/i);
      return match ? match[1] : null;
    }
  } catch { return null; }
  return null;
}

function parseJson(val, fallback) {
  if (!val) return fallback;
  if (typeof val === 'object') return val;
  try { return JSON.parse(val); } catch { return fallback; }
}

/**
 * Register claim routes on Express app
 * @param {import('express').Express} app
 * @param {Function} getDb — returns better-sqlite3 instance
 */
function registerClaimRoutes(app, getDb) {

  // ── GET /api/claims/eligible ──────────────────────────────────
  app.get('/api/claims/eligible', (req, res) => {
    try {
      const { profileId } = req.query;
      if (!profileId) return res.status(400).json({ eligible: false, reason: 'profileId required' });

      const db = getDb();
      let row = db.prepare('SELECT * FROM profiles WHERE id = ?').get(profileId);
      if (!row) row = db.prepare('SELECT * FROM profiles WHERE LOWER(name) = LOWER(?)').get(profileId);
      if (!row) row = db.prepare('SELECT * FROM profiles WHERE id = ?').get('agent_' + profileId.toLowerCase());
      if (!row) return res.json({ eligible: false, reason: 'Profile not found' });

      // Check unclaimed status from metadata
      const metadata = parseJson(row.metadata, {});
      const isUnclaimed = metadata.unclaimed === true || metadata.isPlaceholder === true || metadata.placeholder === true;

      if (!isUnclaimed) {
        return res.json({ eligible: false, reason: 'Profile is already claimed' });
      }

      // Check if wallet is already set (someone already claimed it)
      const wallets = parseJson(row.wallets, {});
      if (wallets.solana && wallets.solana.length > 20) {
        return res.json({ eligible: false, reason: 'Profile already has a linked wallet' });
      }

      // Build available claim methods from links
      const links = parseJson(row.links, {});
      const methods = [];

      // X (Twitter)
      const xUrl = links.x || links.twitter || row.twitter || '';
      const xHandle = extractHandle(xUrl, 'x');
      if (xHandle) methods.push({ method: 'x', identifier: xHandle });

      // GitHub
      const ghUrl = links.github || row.github || '';
      const ghHandle = extractHandle(ghUrl, 'github');
      if (ghHandle) methods.push({ method: 'github', identifier: ghHandle });

      // Domain
      const website = links.website || row.website || '';
      if (website) {
        const domain = website.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
        if (domain && domain.includes('.')) methods.push({ method: 'domain', identifier: domain });
      }

      // Solana wallet claim (sign a message)
      methods.push({ method: 'wallet', identifier: 'Solana Wallet Signature' });

      if (methods.length === 0) {
        return res.json({ eligible: false, reason: 'No claim methods available — profile has no linked X, GitHub, or domain' });
      }

      res.json({ eligible: true, profileId: row.id, profileName: row.name, methods });
    } catch (err) {
      console.error('[Claims] eligible error:', err.message);
      res.status(500).json({ eligible: false, reason: 'Server error' });
    }
  });

  // ── POST /api/claims/initiate ─────────────────────────────────
  app.post('/api/claims/initiate', (req, res) => {
    try {
      const { profileId, method, wallet } = req.body;
      if (!profileId || !method || !wallet) {
        return res.status(400).json({ success: false, error: 'profileId, method, and wallet are required' });
      }

      if (!checkRateLimit(wallet)) {
        return res.status(429).json({ success: false, error: 'Rate limit exceeded. Max 5 attempts per hour.' });
      }

      const db = getDb();
      let row = db.prepare('SELECT * FROM profiles WHERE id = ?').get(profileId);
      if (!row) row = db.prepare('SELECT * FROM profiles WHERE LOWER(name) = LOWER(?)').get(profileId);
      if (!row) return res.status(404).json({ success: false, error: 'Profile not found' });

      const metadata = parseJson(row.metadata, {});
      const isUnclaimed = metadata.unclaimed === true || metadata.isPlaceholder === true || metadata.placeholder === true;
      if (!isUnclaimed) {
        return res.json({ success: false, error: 'Profile is already claimed' });
      }

      // Generate challenge
      const challengeId = crypto.randomBytes(16).toString('hex');
      const challengeCode = crypto.randomBytes(4).toString('hex').toUpperCase();
      const profileName = row.name || profileId;

      let instructions = '';
      let challengeString = '';
      let identifier = '';

      const links = parseJson(row.links, {});

      if (method === 'x') {
        identifier = extractHandle(links.x || links.twitter || row.twitter || '', 'x');
        if (!identifier) return res.json({ success: false, error: 'No X/Twitter handle found on this profile' });
        challengeString = `Claiming ${profileName} on @AgentFolioHQ\nCode: ${challengeCode}`;
        instructions = `Tweet the following from @${identifier}:\n\n"${challengeString}"\n\nThen paste the tweet URL below.`;
      } else if (method === 'github') {
        identifier = extractHandle(links.github || row.github || '', 'github');
        if (!identifier) return res.json({ success: false, error: 'No GitHub username found on this profile' });
        challengeString = `AgentFolio Claim Verification\nProfile: ${profileId}\nCode: ${challengeCode}\nWallet: ${wallet}`;
        instructions = `Create a public gist at https://gist.github.com\nFilename: agentfolio-claim.md\nContent:\n\n${challengeString}\n\nThen paste your gist URL below.`;
      } else if (method === 'domain') {
        const website = links.website || row.website || '';
        identifier = website.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
        if (!identifier) return res.json({ success: false, error: 'No domain found on this profile' });
        challengeString = challengeCode;
        instructions = `Add a TXT record to ${identifier}:\n\nagentfolio-verify=${challengeCode}\n\nOr place a file at:\nhttps://${identifier}/.well-known/agentfolio-verify.txt\n\nContaining: ${challengeCode}`;
      } else if (method === 'wallet') {
        identifier = wallet;
        challengeString = `agentfolio-claim:${profileId}:${challengeCode}`;
        instructions = `Sign this message with your Solana wallet:\n\n${challengeString}\n\nThe signature will be verified automatically.`;
      } else {
        return res.json({ success: false, error: `Unknown claim method: ${method}` });
      }

      const claim = {
        challengeId,
        profileId: row.id,
        profileName,
        method,
        identifier,
        wallet,
        challengeCode,
        challengeString,
        createdAt: Date.now(),
        expiresAt: Date.now() + CLAIM_EXPIRY_MS,
      };

      pendingClaims.set(challengeId, claim);
      cleanupExpired();

      res.json({
        success: true,
        challengeId,
        method,
        identifier,
        instructions,
        challengeString,
        expiresAt: new Date(claim.expiresAt).toISOString(),
      });
    } catch (err) {
      console.error('[Claims] initiate error:', err.message);
      res.status(500).json({ success: false, error: 'Server error' });
    }
  });

  // ── POST /api/claims/self-verify ──────────────────────────────
  app.post('/api/claims/self-verify', async (req, res) => {
    try {
      const { challengeId, proof } = req.body;
      if (!challengeId || !proof) {
        return res.status(400).json({ success: false, error: 'challengeId and proof required' });
      }

      const claim = pendingClaims.get(challengeId);
      if (!claim) return res.json({ success: false, error: 'Challenge not found or expired' });
      if (claim.expiresAt < Date.now()) {
        pendingClaims.delete(challengeId);
        return res.json({ success: false, error: 'Challenge has expired' });
      }

      let verified = false;
      let verificationProof = {};

      if (claim.method === 'x') {
        ({ verified, verificationProof } = await verifyTweet(claim, proof));
      } else if (claim.method === 'github') {
        ({ verified, verificationProof } = await verifyGist(claim, proof));
      } else if (claim.method === 'domain') {
        ({ verified, verificationProof } = await verifyDomain(claim, proof));
      } else if (claim.method === 'wallet') {
        ({ verified, verificationProof } = verifyWalletSignature(claim, proof));
      }

      if (!verified) {
        return res.json({ success: false, error: verificationProof.error || 'Verification failed' });
      }

      // ── Claim the profile: update DB ──────────────────────────
      const db = getDb();
      const row = db.prepare('SELECT * FROM profiles WHERE id = ?').get(claim.profileId);
      if (!row) return res.json({ success: false, error: 'Profile not found' });

      // Update metadata: remove unclaimed flags
      const metadata = parseJson(row.metadata, {});
      delete metadata.unclaimed;
      delete metadata.isPlaceholder;
      delete metadata.placeholder;
      metadata.claimedAt = new Date().toISOString();
      metadata.claimedBy = claim.wallet;
      metadata.claimMethod = claim.method;
      metadata.claimProof = verificationProof;

      // Update wallets: add Solana wallet
      const wallets = parseJson(row.wallets, {});
      wallets.solana = claim.wallet;

      // Run DB update
      db.prepare(`
        UPDATE profiles 
        SET metadata = ?, wallets = ?, wallet = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(
        JSON.stringify(metadata),
        JSON.stringify(wallets),
        claim.wallet,
        claim.profileId
      );

      // Also update JSON file for frontend SSR
      try {
        const path = require('path');
        const fs = require('fs');
        const profilesDir = path.join(__dirname, '..', '..', 'data', 'profiles');
        const jsonPath = path.join(profilesDir, `${claim.profileId}.json`);
        if (fs.existsSync(jsonPath)) {
          const existing = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
          existing.unclaimed = false;
          existing.claimedAt = metadata.claimedAt;
          existing.claimedBy = claim.wallet;
          existing.wallets = wallets;
          existing.updatedAt = new Date().toISOString();
          fs.writeFileSync(jsonPath, JSON.stringify(existing, null, 2));
        }
      } catch (jsonErr) {
        console.error('[Claims] JSON file update failed (non-fatal):', jsonErr.message);
      }

      pendingClaims.delete(challengeId);

      console.log(`✅ [Claims] Profile ${claim.profileName} (${claim.profileId}) claimed by ${claim.wallet} via ${claim.method}`);

      res.json({
        success: true,
        profileId: claim.profileId,
        profileName: claim.profileName,
        wallet: claim.wallet,
        method: claim.method,
        claimedAt: metadata.claimedAt,
      });
    } catch (err) {
      console.error('[Claims] self-verify error:', err.message);
      res.status(500).json({ success: false, error: 'Server error' });
    }
  });

  console.log('✅ Claim flow routes registered: /api/claims/eligible, /api/claims/initiate, /api/claims/self-verify');
}

// ── Verification helpers ──────────────────────────────────────────

async function verifyTweet(claim, tweetUrl) {
  const match = tweetUrl.match(/status\/(\d+)/);
  if (!match) return { verified: false, verificationProof: { error: 'Invalid tweet URL' } };
  const tweetId = match[1];

  const userMatch = tweetUrl.match(/(?:twitter|x)\.com\/([^/]+)\/status/);
  const urlUser = userMatch ? userMatch[1].toLowerCase() : '';
  const expectedUser = claim.identifier.toLowerCase();

  if (urlUser && urlUser !== expectedUser) {
    return { verified: false, verificationProof: { error: `Tweet must be from @${claim.identifier}, got @${urlUser}` } };
  }

  // Fetch tweet via fxtwitter
  try {
    const res = await fetch(`https://api.fxtwitter.com/${claim.identifier}/status/${tweetId}`, { signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      const data = await res.json();
      const tweetText = data.tweet?.text || '';
      const tweetAuthor = (data.tweet?.author?.screen_name || '').toLowerCase();

      if (tweetAuthor && tweetAuthor !== expectedUser) {
        return { verified: false, verificationProof: { error: `Tweet is from @${tweetAuthor}, expected @${claim.identifier}` } };
      }

      if (tweetText.includes(claim.challengeCode)) {
        return { verified: true, verificationProof: { type: 'tweet', url: tweetUrl, verifiedAt: new Date().toISOString() } };
      }
      return { verified: false, verificationProof: { error: 'Tweet does not contain the challenge code' } };
    }
  } catch (e) {
    // fxtwitter might be down — accept URL-based verification as fallback
    console.log('[Claims] fxtwitter fetch failed, using URL fallback:', e.message);
  }

  // Fallback: accept if URL user matches expected user
  if (urlUser === expectedUser) {
    return { verified: true, verificationProof: { type: 'tweet', url: tweetUrl, verifiedAt: new Date().toISOString(), fallback: true } };
  }

  return { verified: false, verificationProof: { error: `Could not verify tweet from @${claim.identifier}` } };
}

async function verifyGist(claim, gistUrl) {
  const match = gistUrl.match(/gist\.github\.com\/[\w-]+\/([a-f0-9]+)/i) || gistUrl.match(/gist\.github\.com\/([a-f0-9]+)/i);
  if (!match) return { verified: false, verificationProof: { error: 'Invalid gist URL' } };

  try {
    const response = await fetch(`https://api.github.com/gists/${match[1]}`, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) return { verified: false, verificationProof: { error: 'Could not fetch gist' } };

    const gist = await response.json();

    if (gist.owner?.login?.toLowerCase() !== claim.identifier.toLowerCase()) {
      return { verified: false, verificationProof: { error: `Gist must be from ${claim.identifier}, got ${gist.owner?.login}` } };
    }

    for (const file of Object.values(gist.files || {})) {
      if (file.content && file.content.includes(claim.challengeCode)) {
        return { verified: true, verificationProof: { type: 'gist', url: gistUrl, verifiedAt: new Date().toISOString() } };
      }
    }

    return { verified: false, verificationProof: { error: 'Gist does not contain the challenge code' } };
  } catch (e) {
    return { verified: false, verificationProof: { error: `Gist verification failed: ${e.message}` } };
  }
}

async function verifyDomain(claim, proof) {
  const domain = claim.identifier;

  // Try .well-known file
  try {
    const res = await fetch(`https://${domain}/.well-known/agentfolio-verify.txt`, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const text = await res.text();
      if (text.trim().includes(claim.challengeCode)) {
        return { verified: true, verificationProof: { type: 'domain', domain, method: 'well-known', verifiedAt: new Date().toISOString() } };
      }
    }
  } catch {}

  // Try DNS TXT
  try {
    const dns = require('dns').promises;
    const records = await dns.resolveTxt(domain);
    for (const record of records) {
      const txt = record.join('');
      if (txt.includes(`agentfolio-verify=${claim.challengeCode}`)) {
        return { verified: true, verificationProof: { type: 'domain', domain, method: 'dns-txt', verifiedAt: new Date().toISOString() } };
      }
    }
  } catch {}

  return { verified: false, verificationProof: { error: 'Challenge code not found in DNS TXT record or .well-known file' } };
}

function verifyWalletSignature(claim, signatureBase64) {
  try {
    const nacl = require('tweetnacl');
    const bs58 = require('bs58');

    const sigBytes = Buffer.from(signatureBase64, 'base64');
    const msgBytes = Buffer.from(claim.challengeString);
    const pubBytes = bs58.decode(claim.wallet);

    if (nacl.sign.detached.verify(msgBytes, sigBytes, pubBytes)) {
      return { verified: true, verificationProof: { type: 'wallet', wallet: claim.wallet, verifiedAt: new Date().toISOString() } };
    }

    return { verified: false, verificationProof: { error: 'Invalid wallet signature' } };
  } catch (e) {
    return { verified: false, verificationProof: { error: `Signature verification failed: ${e.message}` } };
  }
}

module.exports = { registerClaimRoutes };
