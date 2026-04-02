/**
 * Batch Registration API — Enterprise Agent Import
 * 
 * POST /api/register/batch
 * 
 * Accepts an array of agent profiles for bulk registration.
 * Designed for enterprise tools (Teleport, credat, etc.) that need
 * to onboard many agents at once.
 * 
 * Body: {
 *   agents: [
 *     { name, bio, wallets: { solana }, wallet, signature, signedMessage, ... },
 *     ...
 *   ],
 *   apiKey?: string  // Optional: platform API key for trusted batch imports (skips sig verification)
 * }
 * 
 * Returns: {
 *   success: true,
 *   total: N,
 *   created: [...profile IDs],
 *   errors: [{ index, name, error }]
 * }
 */

const nacl = require('tweetnacl');
const _bs58 = require('bs58');
const bs58 = _bs58.default || _bs58;
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');

const batchLimiter = rateLimit({
  validate: false,
  windowMs: 60 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many batch registration attempts. Try again in 1 hour.' },
  keyGenerator: (req) => req.ip || req.headers['x-forwarded-for'] || 'unknown',
});

// Platform API keys for trusted batch imports (skip wallet signature verification)
// Set via BATCH_API_KEYS env var (comma-separated)
const TRUSTED_API_KEYS = new Set(
  (process.env.BATCH_API_KEYS || '').split(',').filter(k => k.length > 0)
);

const MAX_BATCH_SIZE = 100;

function genId() {
  return crypto.randomBytes(8).toString('hex');
}

function genApiKey() {
  return 'af_' + crypto.randomBytes(24).toString('hex');
}

function registerBatchRoutes(app) {
  const profileStore = require('../profile-store');

  app.post('/api/register/batch', batchLimiter, (req, res) => {
    const { agents, apiKey } = req.body;

    // Validate input
    if (!Array.isArray(agents) || agents.length === 0) {
      return res.status(400).json({ error: 'agents array is required and must be non-empty' });
    }
    if (agents.length > MAX_BATCH_SIZE) {
      return res.status(400).json({
        error: `Batch too large: ${agents.length} agents, max ${MAX_BATCH_SIZE}`,
        maxBatchSize: MAX_BATCH_SIZE,
      });
    }

    const isTrusted = apiKey && TRUSTED_API_KEYS.has(apiKey);
    const db = profileStore.getDb();

    // Detect schema columns once
    const cols = db.prepare("PRAGMA table_info(profiles)").all().map(c => c.name);
    const hasHandle = cols.includes('handle');
    const hasVerificationData = cols.includes('verification_data');
    const hasBio = cols.includes('bio');
    const hasSkillsCol = cols.includes('skills');
    const hasWalletsCol = cols.includes('wallets');
    const hasLinksCol = cols.includes('links');

    const created = [];
    const errors = [];

    for (let i = 0; i < agents.length; i++) {
      const agent = agents[i];
      try {
        // Validate name
        if (!agent.name || typeof agent.name !== 'string' || agent.name.trim().length < 1) {
          errors.push({ index: i, name: agent.name || '(unnamed)', error: 'name is required' });
          continue;
        }

        // Resolve wallet
        const solWallet = (agent.wallets && agent.wallets.solana) || agent.wallet || '';

        // Signature verification (unless trusted API key)
        if (!isTrusted) {
          if (!solWallet) {
            errors.push({ index: i, name: agent.name, error: 'wallet (Solana address) required' });
            continue;
          }
          if (!agent.signature || !agent.signedMessage) {
            errors.push({ index: i, name: agent.name, error: 'signature and signedMessage required (or provide trusted apiKey)' });
            continue;
          }
          try {
            const pubkeyBytes = bs58.decode(solWallet);
            if (pubkeyBytes.length !== 32) throw new Error('invalid pubkey length');
            let sigBytes;
            try { sigBytes = bs58.decode(agent.signature); } catch (_) {
              sigBytes = Buffer.from(agent.signature, 'base64');
            }
            if (sigBytes.length !== 64) throw new Error('invalid signature length');
            const msgBytes = new TextEncoder().encode(agent.signedMessage);
            const valid = nacl.sign.detached.verify(msgBytes, sigBytes, pubkeyBytes);
            if (!valid) {
              errors.push({ index: i, name: agent.name, error: 'invalid wallet signature' });
              continue;
            }
          } catch (sigErr) {
            errors.push({ index: i, name: agent.name, error: `signature error: ${sigErr.message}` });
            continue;
          }
        }

        // Check for duplicate wallet
        if (solWallet) {
          const existing = db.prepare("SELECT id FROM profiles WHERE wallet = ? OR wallets LIKE ?")
            .get(solWallet, `%${solWallet}%`);
          if (existing) {
            errors.push({ index: i, name: agent.name, error: `wallet already registered (profile: ${existing.id})` });
            continue;
          }
        }

        // Build profile
        const id = genId();
        const agentApiKey = genApiKey();
        const now = new Date().toISOString();
        const handle = (agent.handle || agent.name.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_')).substring(0, 64);
        const bio = (agent.bio || agent.description || '').trim();
        const wallets = agent.wallets || {};
        if (solWallet && !wallets.solana) wallets.solana = solWallet;
        const links = agent.links || {};
        const skills = Array.isArray(agent.skills)
          ? agent.skills.map(s => typeof s === 'string' ? { name: s, category: 'general', verified: false } : s)
          : Array.isArray(agent.capabilities)
            ? agent.capabilities.map(c => typeof c === 'string' ? { name: c, category: 'general', verified: false } : c)
            : [];

        const verificationData = {};
        if (solWallet) {
          verificationData.solana = { address: solWallet, verified: false, linked: true };
        }

        // Flexible INSERT
        const insertCols = ['id', 'name'];
        const insertPlaceholders = ['?', '?'];
        const insertVals = [id, agent.name.trim()];

        const optionalFields = [
          ['handle', hasHandle, handle],
          ['description', true, bio],
          ['bio', hasBio, bio],
          ['avatar', true, agent.avatar || ''],
          ['website', true, agent.website || links.website || ''],
          ['framework', true, agent.framework || ''],
          ['capabilities', true, JSON.stringify(agent.capabilities || [])],
          ['tags', true, JSON.stringify(agent.tags || [])],
          ['wallet', true, solWallet],
          ['twitter', true, agent.twitter || links.x || links.twitter || ''],
          ['github', true, agent.github || links.github || ''],
          ['email', true, agent.email || ''],
          ['api_key', true, agentApiKey],
          ['status', true, 'active'],
          ['created_at', true, now],
          ['updated_at', true, now],
          ['verification_data', hasVerificationData, JSON.stringify(verificationData)],
          ['skills', hasSkillsCol, JSON.stringify(skills)],
          ['wallets', hasWalletsCol, JSON.stringify(wallets)],
          ['links', hasLinksCol, JSON.stringify(links)],
        ];

        for (const [col, available, val] of optionalFields) {
          if (available && cols.includes(col)) {
            insertCols.push(col);
            insertPlaceholders.push('?');
            insertVals.push(val);
          }
        }

        const sql = `INSERT INTO profiles (${insertCols.join(', ')}) VALUES (${insertPlaceholders.join(', ')})`;
        db.prepare(sql).run(...insertVals);

        created.push({
          index: i,
          id,
          name: agent.name.trim(),
          apiKey: agentApiKey,
          wallet: solWallet || null,
        });

      } catch (err) {
        errors.push({ index: i, name: agent.name || '(unnamed)', error: err.message });
      }
    }

    const statusCode = errors.length === agents.length ? 400 : (errors.length > 0 ? 207 : 201);

    return res.status(statusCode).json({
      success: created.length > 0,
      total: agents.length,
      created: created.map(c => ({ id: c.id, name: c.name, apiKey: c.apiKey, wallet: c.wallet })),
      createdCount: created.length,
      errorCount: errors.length,
      errors: errors.length > 0 ? errors : undefined,
    });
  });

  console.log('[BatchRegister] Routes registered: POST /api/register/batch');
}

module.exports = { registerBatchRoutes };
