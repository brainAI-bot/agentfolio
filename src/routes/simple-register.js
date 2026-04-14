/**
 * Registration routes.
 *
 * Production registration is now atomic and wallet-first:
 * 1. /api/register/atomic      -> build unsigned SATP V3 create_identity tx
 * 2. user signs + submits tx
 * 3. /api/register/atomic/confirm -> wait for chain confirmation, then create DB row
 *
 * Legacy /api/register/simple remains available only for localhost harness use.
 */
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { PublicKey, Connection } = require('@solana/web3.js');
const { computeUnifiedTrustScore } = require('../lib/unified-trust-score');
const {
  buildCreateIdentityV3Tx,
  getV3GenesisRecordPDA,
  getV3IdentityStatus,
  recordConfirmedV3Identity,
  connection: satpConnection,
} = require('./satp-auto-identity-v3');

const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const registrationConnection = satpConnection || new Connection(RPC_URL, 'confirmed');

const simpleLimiter = rateLimit({
  validate: false,
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many registration attempts. Try again in 1 hour.' },
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function genId() {
  return 'agent_' + crypto.randomBytes(6).toString('hex');
}

function genApiKey() {
  return 'af_' + crypto.randomBytes(24).toString('hex');
}

function isLocalRegistrationRequest(req) {
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || req.hostname || '').toLowerCase();
  return host.includes('localhost') || host.includes('127.0.0.1') || host.includes('0.0.0.0');
}

function normalizeSkills(skills) {
  if (typeof skills === 'string') {
    return skills
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => ({ name: s, category: 'general', verified: false }));
  }

  if (Array.isArray(skills)) {
    return skills
      .map((skill) => {
        if (typeof skill === 'string') {
          const name = skill.trim();
          return name ? { name, category: 'general', verified: false } : null;
        }
        if (!skill || typeof skill !== 'object') return null;
        const name = String(skill.name || '').trim();
        if (!name) return null;
        return {
          name,
          category: skill.category || 'general',
          verified: Boolean(skill.verified),
        };
      })
      .filter(Boolean);
  }

  return [];
}

function normalizeRegistrationInput(body = {}, options = {}) {
  const requireWallet = options.requireWallet !== false;
  const name = String(body.name || '').trim();
  const tagline = String(body.tagline || '').trim();
  const github = String(body.github || '').trim();
  const website = String(body.website || '').trim();
  const walletAddress = body.walletAddress ? String(body.walletAddress).trim() : '';

  if (!name) throw new Error('name is required');
  if (name.length > 32) throw new Error('name must be 32 chars or less');
  if (!tagline) throw new Error('tagline is required');
  if (tagline.length > 256) throw new Error('tagline must be 256 chars or less');

  if (requireWallet) {
    if (!walletAddress) throw new Error('walletAddress is required');
    try {
      new PublicKey(walletAddress);
    } catch (_) {
      throw new Error('walletAddress must be a valid Solana address');
    }
  }

  let id = '';
  const customId = body.customId ? String(body.customId).trim().toLowerCase().replace(/[^a-z0-9_-]/g, '') : '';
  if (customId) {
    if (customId.length < 3 || customId.length > 32) {
      throw new Error('Custom ID must be 3-32 characters');
    }
    id = customId;
  } else {
    id = genId();
  }

  const resolvedSkills = normalizeSkills(body.skills);

  return {
    id,
    name,
    tagline,
    github,
    website,
    walletAddress,
    resolvedSkills,
    capabilityNames: resolvedSkills.map((skill) => skill.name || '').filter(Boolean),
  };
}

function ensureProfileIdAvailable(db, id) {
  const existing = db.prepare('SELECT id FROM profiles WHERE id = ?').get(id);
  if (existing) {
    const err = new Error('This profile ID is already taken');
    err.statusCode = 409;
    throw err;
  }
}

function writeProfileJson(profile) {
  const profilesDir = path.join(__dirname, '..', '..', 'data', 'profiles');
  fs.mkdirSync(profilesDir, { recursive: true });
  fs.writeFileSync(path.join(profilesDir, `${profile.id}.json`), JSON.stringify(profile, null, 2));
}

function buildProfileJson({ id, name, tagline, github, website, walletAddress, resolvedSkills, apiKey, now }) {
  return {
    id,
    name,
    handle: "",
    bio: tagline,
    avatar: null,
    links: { github: github || null, website: website || null },
    wallets: walletAddress ? { solana: walletAddress } : {},
    skills: resolvedSkills.map((skill) => ({
      name: skill.name,
      category: skill.category || 'general',
      verified: Boolean(skill.verified),
      proofs: [],
    })),
    portfolio: [],
    trackRecord: null,
    verification: { tier: 'registered', score: 10, lastVerified: now },
    verificationData: {},
    stats: { jobsCompleted: 0, rating: 0, reviewsReceived: 0 },
    endorsements: [],
    endorsementsGiven: [],
    unclaimed: false,
    apiKey,
    activity: [{ type: 'registered', createdAt: now }],
    createdAt: now,
    updatedAt: now,
  };
}

function insertProfileRecord(db, registration) {
  const apiKey = genApiKey();
  const now = new Date().toISOString();
  const cols = db.prepare('PRAGMA table_info(profiles)').all().map((column) => column.name);

  const insertCols = ['id', 'name'];
  const insertPlaceholders = ['?', '?'];
  const insertVals = [registration.id, registration.name];

  const optionalFields = [
    ['handle', ''],
    ['description', registration.tagline],
    ['bio', registration.tagline],
    ['avatar', ''],
    ['website', registration.website],
    ['framework', ''],
    ['capabilities', JSON.stringify(registration.capabilityNames)],
    ['tags', '[]'],
    ['wallet', registration.walletAddress || ''],
    ['wallets', registration.walletAddress ? JSON.stringify({ solana: registration.walletAddress }) : '{}'],
    ['twitter', ''],
    ['github', registration.github],
    ['email', ''],
    ['api_key', apiKey],
    ['status', 'active'],
    ['claimed', registration.walletAddress ? 1 : 0],
    ['claimed_by', registration.walletAddress || ''],
    ['skills', JSON.stringify(registration.resolvedSkills)],
    ['links', JSON.stringify({ github: registration.github || null, website: registration.website || null })],
    ['verification_data', '{}'],
    ['created_at', now],
    ['updated_at', now],
  ];

  for (const [column, value] of optionalFields) {
    if (cols.includes(column)) {
      insertCols.push(column);
      insertPlaceholders.push('?');
      insertVals.push(value);
    }
  }

  db.prepare(`INSERT INTO profiles (${insertCols.join(', ')}) VALUES (${insertPlaceholders.join(', ')})`).run(...insertVals);

  const profileJson = buildProfileJson({
    id: registration.id,
    name: registration.name,
    tagline: registration.tagline,
    github: registration.github,
    website: registration.website,
    walletAddress: registration.walletAddress,
    resolvedSkills: registration.resolvedSkills,
    apiKey,
    now,
  });
  writeProfileJson(profileJson);

  return { apiKey, now, profileJson };
}

function notifyRegistration(name, id, kind = 'atomic') {
  try {
    const http = require('http');
    const notifData = JSON.stringify({
      agent_id: 'agentfolio',
      project_id: 'agentfolio',
      text: `🆕 New agent registered (${kind}): ${name} (${id})`,
      color: '#00BFFF',
    });
    const notifReq = http.request({
      hostname: 'localhost',
      port: 3456,
      path: '/api/comms/push',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-HQ-Key': 'REDACTED_HQ_KEY' },
      timeout: 3000,
    });
    notifReq.on('error', () => {});
    notifReq.write(notifData);
    notifReq.end();
  } catch (_) {}
}

async function waitForConfirmedGenesisTransaction({ txSignature, walletAddress, profileId, timeoutMs = 90000 }) {
  const [genesisPDA] = getV3GenesisRecordPDA(profileId);
  const genesisAddress = genesisPDA.toBase58();
  const deadline = Date.now() + timeoutMs;
  let latestStatus = null;

  while (Date.now() < deadline) {
    const [parsedTx, signatureStatus, genesisAccount] = await Promise.all([
      registrationConnection.getParsedTransaction(txSignature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      }).catch(() => null),
      registrationConnection.getSignatureStatus(txSignature, { searchTransactionHistory: true }).catch(() => null),
      registrationConnection.getAccountInfo(genesisPDA, 'confirmed').catch(() => null),
    ]);

    latestStatus = signatureStatus?.value || latestStatus;

    if (latestStatus?.err) {
      throw new Error(`On-chain transaction failed: ${JSON.stringify(latestStatus.err)}`);
    }

    if (parsedTx?.meta?.err) {
      throw new Error(`On-chain transaction failed: ${JSON.stringify(parsedTx.meta.err)}`);
    }

    if (parsedTx) {
      const accountKeys = parsedTx.transaction.message.accountKeys.map((key) => {
        const pubkey = key?.pubkey || key;
        return typeof pubkey === 'string' ? pubkey : pubkey.toBase58();
      });
      const signerKeys = parsedTx.transaction.message.accountKeys
        .filter((key) => key?.signer)
        .map((key) => {
          const pubkey = key?.pubkey || key;
          return typeof pubkey === 'string' ? pubkey : pubkey.toBase58();
        });

      if (!signerKeys.includes(walletAddress)) {
        throw new Error('Confirmed transaction was not signed by the expected wallet');
      }
      if (!accountKeys.includes(genesisAddress)) {
        throw new Error('Confirmed transaction did not create the expected SATP genesis account');
      }
    }

    if (parsedTx && genesisAccount && genesisAccount.data?.length > 0) {
      return {
        parsedTx,
        genesisPDA: genesisAddress,
      };
    }

    await sleep(1500);
  }

  if (latestStatus?.confirmationStatus) {
    throw new Error(`Timed out waiting for SATP genesis account after transaction reached ${latestStatus.confirmationStatus}`);
  }

  throw new Error('Timed out waiting for confirmed SATP registration transaction');
}

function registerSimpleRoutes(app, getDb) {
  app.post('/api/register/simple', simpleLimiter, async (req, res) => {
    if (!isLocalRegistrationRequest(req)) {
      return res.status(410).json({
        error: 'Legacy simple registration is disabled on production. Connect a wallet and use the atomic registration flow so SATP genesis and the DB row are created together.',
      });
    }

    try {
      const d = getDb();
      const registration = normalizeRegistrationInput(req.body, { requireWallet: false });
      ensureProfileIdAvailable(d, registration.id);
      const created = insertProfileRecord(d, registration);

      res.status(201).json({
        id: registration.id,
        api_key: created.apiKey,
        message: 'Local-only legacy profile created without on-chain registration.',
      });
    } catch (error) {
      const statusCode = error.statusCode || (String(error.message || '').includes('already taken') ? 409 : 400);
      res.status(statusCode).json({ error: error.message || 'Registration failed' });
    }
  });

  app.post('/api/register/atomic', simpleLimiter, async (req, res) => {
    try {
      const d = getDb();
      const registration = normalizeRegistrationInput(req.body, { requireWallet: true });
      ensureProfileIdAvailable(d, registration.id);

      const onchainStatus = await getV3IdentityStatus(registration.id);
      if (onchainStatus?.accountExists || onchainStatus?.exists) {
        return res.status(409).json({ error: 'SATP genesis record already exists for this profile ID' });
      }

      const txResult = await buildCreateIdentityV3Tx(
        registration.walletAddress,
        registration.id,
        registration.name,
        registration.tagline,
        'ai-agent',
        registration.capabilityNames,
        `https://agentfolio.bot/api/profile/${registration.id}`
      );

      if (txResult.alreadyExists) {
        return res.status(409).json({ error: 'SATP genesis record already exists for this profile ID' });
      }

      res.json({
        ok: true,
        data: {
          profileId: registration.id,
          ...txResult,
        },
      });
    } catch (error) {
      const statusCode = error.statusCode || (String(error.message || '').includes('already taken') ? 409 : 400);
      res.status(statusCode).json({ error: error.message || 'Failed to prepare atomic registration' });
    }
  });

  app.post('/api/register/atomic/confirm', simpleLimiter, async (req, res) => {
    try {
      const d = getDb();
      const registration = normalizeRegistrationInput(req.body, { requireWallet: true });
      const txSignature = String(req.body.txSignature || '').trim();
      if (!txSignature) {
        return res.status(400).json({ error: 'txSignature is required' });
      }

      await waitForConfirmedGenesisTransaction({
        txSignature,
        walletAddress: registration.walletAddress,
        profileId: registration.id,
      });

      let existingProfile = d.prepare('SELECT * FROM profiles WHERE id = ?').get(registration.id);
      let apiKey = existingProfile?.api_key || '';

      if (!existingProfile) {
        const created = insertProfileRecord(d, registration);
        apiKey = created.apiKey;
        existingProfile = d.prepare('SELECT * FROM profiles WHERE id = ?').get(registration.id);
      }

      let identityResult = null;
      let identityWarning = null;
      try {
        identityResult = await recordConfirmedV3Identity({
          walletAddress: registration.walletAddress,
          profileId: registration.id,
          txSignature,
        });
      } catch (identityError) {
        identityWarning = identityError.message;
        console.error('[AtomicRegister] Identity confirmation bookkeeping failed:', identityError.message);
      }

      const profile = d.prepare('SELECT * FROM profiles WHERE id = ?').get(registration.id) || existingProfile;
      const scoring = computeUnifiedTrustScore(d, profile, { v3Score: { verificationLevel: 1 } });
      try {
        const v3Explorer = require('../v3-explorer');
        if (typeof v3Explorer.clearCache === 'function') v3Explorer.clearCache();
      } catch (cacheError) {
        console.warn('[AtomicRegister] Failed to clear V3 explorer cache:', cacheError.message);
      }
      notifyRegistration(registration.name, registration.id, 'atomic');

      res.status(201).json({
        ok: true,
        id: registration.id,
        api_key: apiKey,
        walletAddress: registration.walletAddress,
        txSignature,
        genesisPDA: identityResult?.data?.genesisPDA || getV3GenesisRecordPDA(registration.id)[0].toBase58(),
        level: scoring.levelName,
        trustScore: scoring.trustScore,
        profile,
        warning: identityWarning,
        satpAttestation: identityResult?.satpAttestation || null,
        solanaAttestation: identityResult?.solanaAttestation || null,
      });
    } catch (error) {
      console.error('[AtomicRegister] confirm error:', error.message);
      res.status(500).json({ error: error.message || 'Failed to finalize atomic registration' });
    }
  });
}

module.exports = { registerSimpleRoutes };
