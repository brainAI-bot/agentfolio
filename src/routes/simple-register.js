/**
 * Simple registration — no wallet required.
 * Creates a profile with just name + tagline.
 * Wallet verification can happen later.
 */
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const _bs58 = require('bs58');
const bs58 = _bs58.default || _bs58;
const nacl = require('tweetnacl');

// [CEO Apr 4] On-chain genesis creation on registration
let satpV3SDK, platformKeypair;
try {
  const { SATPV3SDK } = require('../satp-client/src/v3-sdk');
  const { Keypair } = require('@solana/web3.js');
  const RPC_URL = process.env.SOLANA_RPC_URL || 'https://mainnet.helius-rpc.com/?api-key=91c63e44-1c7a-4b98-830b-6135632565fb';
  satpV3SDK = new SATPV3SDK({ rpcUrl: RPC_URL });
  const configuredKpPath = process.env.SATP_PLATFORM_KEYPAIR || '/home/ubuntu/agentfolio/config/platform-keypair.json';
  const kpPath = configuredKpPath === '/home/ubuntu/.config/solana/satp-mainnet-platform.json'
    ? '/home/ubuntu/.config/solana/mainnet-deployer.json'
    : configuredKpPath;
  if (fs.existsSync(kpPath)) {
    platformKeypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(kpPath, 'utf8'))));
    console.log('[SimpleRegister] SATP V3 + platform keypair loaded for genesis creation');
  }
} catch (e) {
  console.warn('[SimpleRegister] On-chain genesis not available:', e.message);
}


const simpleLimiter = rateLimit({
  validate: false,
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many registration attempts. Try again in 1 hour.' },
});

function genId() {
  return 'agent_' + crypto.randomBytes(6).toString('hex');
}

function genApiKey() {
  return 'af_' + crypto.randomBytes(24).toString('hex');
}

function isBlockedTestProfile(name, profileId) {
  const normalizedName = String(name || '').trim().toLowerCase();
  const normalizedId = String(profileId || '').trim().toLowerCase();
  return /^rollbackproof\d*$/.test(normalizedId)
    || /^rollback\s*proof(\s*\d+)?$/.test(normalizedName)
    || /^rollbackproof\d*$/.test(normalizedName)
    || /^p0autotest\d*$/.test(normalizedId)
    || /^p0\s*autotest(\s*\d+)?$/.test(normalizedName)
    || /^autotest\d*$/.test(normalizedId);
}

function isLocalRegistrationRequest(req) {
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || req.hostname || '').toLowerCase();
  return host.includes('localhost') || host.includes('127.0.0.1') || host.includes('0.0.0.0');
}

async function resolveCanonicalOnchainProfileId(db, profileId, walletAddress) {
  if (!walletAddress || !satpV3SDK) return profileId;

  try {
    const current = await satpV3SDK.getGenesisRecord(profileId);
    if (current && !current.error) return profileId;
  } catch (_) {}

  const candidates = db.prepare(`
    SELECT id, wallet, wallets
    FROM profiles
    WHERE id != ? AND (
      wallet = ? OR wallet LIKE ? OR wallets LIKE ? OR verification_data LIKE ?
    )
    ORDER BY CASE WHEN id LIKE 'agent_%' THEN 0 ELSE 1 END, created_at ASC
  `).all(profileId, walletAddress, `%${walletAddress}%`, `%${walletAddress}%`, `%${walletAddress}%`);

  for (const candidate of candidates) {
    try {
      const existing = await satpV3SDK.getGenesisRecord(candidate.id);
      if (existing && !existing.error) {
        console.log(`[SimpleRegister] Resolved canonical on-chain profile ${profileId} -> ${candidate.id} for wallet ${walletAddress}`);
        return candidate.id;
      }
    } catch (_) {}
  }

  return profileId;
}

function registerSimpleRoutes(app, getDb) {
  app.post('/api/register/simple', simpleLimiter, async (req, res) => {
    const { name, tagline, github, website, skills, walletAddress, signature, signedMessage } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length < 1) {
      return res.status(400).json({ error: 'name is required' });
    }
    if (name.trim().length > 32) {
      return res.status(400).json({ error: 'name must be 32 chars or less' });
    }

    if (walletAddress && signature && signedMessage) {
      try {
        const pubkeyBytes = bs58.decode(walletAddress);
        if (pubkeyBytes.length != 32) throw new Error('invalid pubkey length');
        let sigBytes;
        try { sigBytes = bs58.decode(signature); } catch (_) {
          sigBytes = Buffer.from(signature, 'base64');
        }
        if (sigBytes.length != 64) throw new Error('invalid signature length');
        const msgBytes = new TextEncoder().encode(signedMessage);
        const valid = nacl.sign.detached.verify(msgBytes, sigBytes, pubkeyBytes);
        if (!valid) {
          return res.status(401).json({ error: 'invalid wallet signature -- proof of ownership failed' });
        }
      } catch (sigErr) {
        return res.status(400).json({ error: `signature verification error: ${sigErr.message}` });
      }
    } else if (walletAddress && (!signature || !signedMessage)) {
      return res.status(400).json({ error: 'When walletAddress is provided, signature and signedMessage are required' });
    }

    const d = getDb();

    // Custom ID from name
    let id;
    const customId = req.body.customId;
    if (customId && typeof customId === 'string') {
      const cleaned = customId.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
      if (cleaned.length < 3 || cleaned.length > 32) {
        return res.status(400).json({ error: 'Custom ID must be 3-32 characters' });
      }
      id = cleaned;
      if (isBlockedTestProfile(name, id) && !isLocalRegistrationRequest(req)) {
        return res.status(400).json({ error: 'Test profile IDs are blocked on production. Use the local registration harness instead.' });
      }
      const existing = d.prepare('SELECT id FROM profiles WHERE id = ?').get(id);
      if (existing) {
        return res.status(409).json({ error: 'This profile ID is already taken' });
      }
    } else {
      id = genId();
      if (isBlockedTestProfile(name, id) && !isLocalRegistrationRequest(req)) {
        return res.status(400).json({ error: 'Test profile IDs are blocked on production. Use the local registration harness instead.' });
      }
    }

    const apiKey = genApiKey();
    const now = new Date().toISOString();
    const resolvedBio = (tagline || '').trim();
    const handle = name.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_').substring(0, 64);

    // Parse skills
    let resolvedSkills = [];
    if (typeof skills === 'string') {
      resolvedSkills = skills.split(',').map(s => s.trim()).filter(Boolean).map(s => ({ name: s, category: 'general', verified: false }));
    } else if (Array.isArray(skills)) {
      resolvedSkills = skills.map(s => typeof s === 'string' ? { name: s, category: 'general', verified: false } : s);
    }

    const resolvedGithub = (github || '').trim();
    const resolvedWebsite = (website || '').trim();

    const cols = d.prepare("PRAGMA table_info(profiles)").all().map(c => c.name);

    try {
      const insertCols = ['id', 'name'];
      const insertPlaceholders = ['?', '?'];
      const insertVals = [id, name.trim()];

      const optionalFields = [
        ['handle', handle],
        ['description', resolvedBio],
        ['bio', resolvedBio],
        ['avatar', ''],
        ['website', resolvedWebsite],
        ['framework', ''],
        ['capabilities', JSON.stringify(resolvedSkills.map(s => s.name || s))],
        ['tags', '[]'],
        ['wallet', walletAddress || ''],
        ['wallets', walletAddress ? JSON.stringify({solana: walletAddress}) : '{}'],
        ['twitter', ''],
        ['github', resolvedGithub],
        ['email', ''],
        ['api_key', apiKey],
        ['status', 'active'],
        ['claimed', walletAddress ? 1 : 0],
        ['claimed_by', walletAddress || ''],
        ['skills', JSON.stringify(resolvedSkills)],
        ['links', JSON.stringify({ github: resolvedGithub || null, website: resolvedWebsite || null })],
        ['verification_data', '{}'],
        ['created_at', now],
        ['updated_at', now],
      ];

      for (const [col, val] of optionalFields) {
        if (cols.includes(col)) {
          insertCols.push(col);
          insertPlaceholders.push('?');
          insertVals.push(val);
        }
      }

      d.prepare(`INSERT INTO profiles (${insertCols.join(', ')}) VALUES (${insertPlaceholders.join(', ')})`).run(...insertVals);

      // Write JSON profile file
      const profilesDir = path.join(__dirname, '..', '..', 'data', 'profiles');
      fs.mkdirSync(profilesDir, { recursive: true });
      const profileJson = {
        id,
        name: name.trim(),
        handle: `@${handle}`,
        bio: resolvedBio,
        avatar: null,
        links: { github: resolvedGithub || null, website: resolvedWebsite || null },
        wallets: {},
        skills: resolvedSkills.map(s => ({ name: s.name || s, category: s.category || 'general', verified: false, proofs: [] })),
        portfolio: [],
        trackRecord: null,
        verification: { tier: 'unverified', score: 0, lastVerified: null },
        verificationData: {},
        stats: { jobsCompleted: 0, rating: 0, reviewsReceived: 0 },
        endorsements: [],
        endorsementsGiven: [],
        unclaimed: false,
        activity: [{ type: 'registered', createdAt: now }],
        createdAt: now,
        updatedAt: now,
      };
      fs.writeFileSync(path.join(profilesDir, `${id}.json`), JSON.stringify(profileJson, null, 2));

      // Auto-calculate trust score
      try {
        const { getProfileScoringData } = require('../lib/profile-scoring-integration');
        const scoringData = getProfileScoringData(profileJson);
        const overallScore = scoringData.overall?.score || scoringData.reputationScore?.score || 0;
        const level = scoringData.verificationLevel?.name || 'NEW';
        const breakdown = JSON.stringify(scoringData);
        if (overallScore <= 10000 && overallScore >= 0) {
          // P0: DB score writes removed — on-chain v3 is sole source
        } else {
          console.error('[SCORE GUARD] Blocked corrupt score in simple-register for ' + id + ': ' + overallScore);
        }
      } catch (scoreErr) {
        console.error('[SimpleRegister] Trust scoring failed:', scoreErr.message);
      }

      // Notify CMD Center
      try {
        const http = require('http');
        const notifData = JSON.stringify({
          agent_id: 'agentfolio', project_id: 'agentfolio',
          text: `🆕 New agent registered (simple): ${name.trim()} (${id}) — ${resolvedSkills.slice(0,3).map(s => s.name || s).join(', ') || 'no skills listed'}`,
          color: '#00BFFF',
        });
        const notifReq = http.request({
          hostname: 'localhost', port: 3456, path: '/api/comms/push',
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-HQ-Key': 'REDACTED_HQ_KEY' },
          timeout: 3000,
        });
        notifReq.on('error', () => {});
        notifReq.write(notifData);
        notifReq.end();
      } catch (_) {}


      // [CEO Apr 4] Create on-chain genesis record (fire-and-forget)
      if (satpV3SDK && platformKeypair) {
        console.log('[SimpleRegister] Skipping server-side genesis creation for', id, 'because identity authority must be the user wallet');
      }

      // Chain-first: write on-chain first, cache only after success.
      if (walletAddress) {
        try {
          const proof = { source: 'simple-registration', wallet: walletAddress, signatureVerified: true };
          const { postVerificationHook } = require('../post-verification-hook');
          const onchainProfileId = await resolveCanonicalOnchainProfileId(d, id, walletAddress);
          const bridgeResult = await postVerificationHook(onchainProfileId, 'solana', walletAddress, proof);
          if (bridgeResult) {
            const enrichedProof = (bridgeResult && typeof bridgeResult === 'object') ? {
              ...proof,
              txSignature: bridgeResult.txSignature || null,
              attestationPDA: bridgeResult.attestationPDA || null,
              solscanUrl: bridgeResult.txSignature ? ('https://solana.fm/tx/' + bridgeResult.txSignature) : undefined,
            } : proof;
            const vId = require('crypto').randomUUID();
            const insert = d.prepare("INSERT OR IGNORE INTO verifications (id, profile_id, platform, identifier, proof, verified_at) VALUES (?, ?, ?, ?, ?, datetime('now'))");
            const result = insert.run(
              vId, id, 'solana', walletAddress, JSON.stringify(enrichedProof)
            );
            console.log('[SimpleRegister] Cached Solana verification for', id, 'changes=', result.changes, 'wallet=', walletAddress, 'tx=', enrichedProof.txSignature || 'none');
          } else {
            console.warn('[SimpleRegister] Skipped Solana verification cache for', id, 'because on-chain write failed');
          }
        } catch (vErr) {
          console.error('[SimpleRegister] Solana auto-verify failed:', vErr.message);
        }
      }

      res.status(201).json({
        id,
        api_key: apiKey,
        message: 'Profile created! Connect a wallet later to verify and register on-chain.',
      });
    } catch (e) {
      console.error('[SimpleRegister] error:', e.message);
      if (e.message?.includes('UNIQUE')) {
        return res.status(409).json({ error: 'Profile ID already exists' });
      }
      res.status(500).json({ error: 'Registration failed', detail: e.message });
    }
  });
}

module.exports = { registerSimpleRoutes };
