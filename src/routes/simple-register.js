/**
 * Simple registration — no wallet required.
 * Creates a profile with just name + tagline.
 * Wallet verification can happen later.
 */
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// [CEO Apr 4] On-chain genesis creation on registration
let satpV3SDK, platformKeypair;
try {
  const { SATPV3SDK } = require('../satp-client/src/v3-sdk');
  const { Keypair } = require('@solana/web3.js');
  const RPC_URL = process.env.SOLANA_RPC_URL || 'https://mainnet.helius-rpc.com/?api-key=REDACTED_HELIUS_API_KEY';
  satpV3SDK = new SATPV3SDK({ rpcUrl: RPC_URL });
  const kpPath = process.env.SATP_PLATFORM_KEYPAIR || '/home/ubuntu/agentfolio/config/platform-keypair.json';
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

function registerSimpleRoutes(app, getDb) {
  app.post('/api/register/simple', simpleLimiter, (req, res) => {
    const { name, tagline, github, website, skills, walletAddress } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length < 1) {
      return res.status(400).json({ error: 'name is required' });
    }
    if (name.trim().length > 32) {
      return res.status(400).json({ error: 'name must be 32 chars or less' });
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
      const existing = d.prepare('SELECT id FROM profiles WHERE id = ?').get(id);
      if (existing) {
        return res.status(409).json({ error: 'This profile ID is already taken' });
      }
    } else {
      id = genId();
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
        (async () => {
          try {
            const existing = await satpV3SDK.getGenesisRecord(id);
            if (existing && !existing.error) {
              console.log('[SimpleRegister] Genesis already exists for', id);
              return;
            }
            const { transaction } = await satpV3SDK.buildCreateIdentity(
              platformKeypair.publicKey, id,
              { name: name.trim(), description: resolvedBio || '', category: 'agent', capabilities: resolvedSkills.map(s => s.name || s).slice(0, 5) }
            );
            transaction.sign(platformKeypair);
            const sig = await satpV3SDK.connection.sendRawTransaction(transaction.serialize());
            console.log('[SimpleRegister] Genesis created on-chain for', id, ':', sig);
          } catch (e) {
            console.error('[SimpleRegister] Genesis creation failed for', id, ':', e.message);
          }
        })();
      }

      // Bug 1 Fix: Auto-verify Solana wallet on simple registration
      if (walletAddress) {
        try {
          const vId = require('crypto').randomUUID();
          d.prepare("INSERT OR IGNORE INTO verifications (id, profile_id, platform, identifier, proof, verified_at) VALUES (?, ?, ?, ?, ?, datetime('now'))").run(
            vId, id, 'solana', walletAddress, JSON.stringify({ source: 'simple-registration', wallet: walletAddress })
          );
          console.log('[SimpleRegister] Auto-verified Solana wallet for', id);
          
          // Bug 5 Fix: Call postVerificationHook for recompute_score
          try {
            const { postVerificationHook } = require('../../post-verification-hook');
            postVerificationHook(id, 'solana', walletAddress, { source: 'simple-registration', wallet: walletAddress }).catch(e => 
              console.warn('[SimpleRegister] Post-verification hook failed:', e.message)
            );
          } catch (hookErr) {
            console.warn('[SimpleRegister] Post-verification hook not available:', hookErr.message);
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
