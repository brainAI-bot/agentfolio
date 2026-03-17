/**
 * SATP Write API Routes
 * POST endpoints for identity registration, reputation recompute, and unsigned TX generation
 */

const satpWrite = require('../satp-write-client');
const path = require('path');

// Platform keypair for server-signed operations
const PLATFORM_KEYPAIR_PATH = process.env.SATP_PLATFORM_KEYPAIR || 
  '/home/ubuntu/.config/solana/brainforge-personal.json';
const NETWORK = process.env.SATP_NETWORK || 'mainnet';

function registerSATPWriteRoutes(app) {

  /**
   * POST /api/satp/register
   * Register a new agent identity on-chain (server-signed with platform wallet)
   * Body: { name, description, category, capabilities[], metadataUri }
   */
  app.post('/api/satp/register', async (req, res) => {
    try {
      const { name, description, category, capabilities, metadataUri } = req.body;
      
      if (!name || !description || !category) {
        return res.status(400).json({ 
          error: 'Missing required fields', 
          required: ['name', 'description', 'category'] 
        });
      }
      
      if (name.length > 32) return res.status(400).json({ error: 'Name must be 32 chars or less' });
      if (description.length > 256) return res.status(400).json({ error: 'Description must be 256 chars or less' });
      
      const signer = satpWrite.loadKeypair(PLATFORM_KEYPAIR_PATH);
      
      const result = await satpWrite.registerIdentity(
        { name, description, category, capabilities: capabilities || [], metadataUri: metadataUri || '' },
        signer,
        NETWORK
      );
      

      if (result.alreadyExists) {
        return res.json({
          ok: true,
          data: {
            ...result,
            message: "Identity already registered — returning existing PDA",
          },
        });
      }
      res.json({
        ok: true,
        data: {
          ...result,
          explorer: `https://solscan.io/tx/${result.txSignature}?cluster=${NETWORK}`,
        },
      });
    } catch (err) {
      console.error('[SATP Write] register error:', err.message);
      if (err.logs) console.error('[SATP Write] logs:', err.logs.join('\n'));
      
      const isAlreadyExists = err.message.includes('already in use') || 
        err.logs?.some(l => l.includes('already in use'));
      
      res.status(isAlreadyExists ? 409 : 500).json({ 
        error: isAlreadyExists ? 'Identity already registered for this wallet' : 'Registration failed',
        detail: err.message,
      });
    }
  });

  /**
   * POST /api/satp/register/build
   * Build an unsigned identity registration TX for client-side signing
   * Body: { walletAddress, name, description, category, capabilities[], metadataUri }
   */
  app.post('/api/satp/register/build', async (req, res) => {
    try {
      const { walletAddress, name, description, category, capabilities, metadataUri } = req.body;
      
      if (!walletAddress || !name || !description || !category) {
        return res.status(400).json({ 
          error: 'Missing required fields', 
          required: ['walletAddress', 'name', 'description', 'category'] 
        });
      }
      
      const result = await satpWrite.buildRegisterIdentityTx(
        { walletAddress, name, description, category, capabilities: capabilities || [], metadataUri: metadataUri || '' },
        NETWORK
      );
      
      res.json({ ok: true, data: result });
    } catch (err) {
      console.error('[SATP Write] build TX error:', err.message);
      res.status(500).json({ error: 'Failed to build transaction', detail: err.message });
    }
  });

  /**
   * POST /api/satp/reputation/submit
   * Trigger permissionless reputation recomputation for an agent
   * Body: { agentWallet }
   */
  app.post('/api/satp/reputation/submit', async (req, res) => {
    try {
      const { agentWallet } = req.body;
      
      if (!agentWallet) {
        return res.status(400).json({ error: 'Missing agentWallet' });
      }
      
      const caller = satpWrite.loadKeypair(PLATFORM_KEYPAIR_PATH);
      
      const result = await satpWrite.recomputeReputation(agentWallet, caller, NETWORK);
      
      // Read updated identity
      const identity = await satpWrite.readIdentity(agentWallet, NETWORK);
      
      res.json({
        ok: true,
        data: {
          ...result,
          updatedScores: identity ? {
            reputationScore: identity.reputationScore,
            verificationLevel: identity.verificationLevel,
          } : null,
          explorer: `https://solscan.io/tx/${result.txSignature}?cluster=${NETWORK}`,
        },
      });
    } catch (err) {
      console.error('[SATP Write] reputation submit error:', err.message);
      if (err.logs) console.error('[SATP Write] logs:', err.logs.join('\n'));
      res.status(500).json({ error: 'Reputation recompute failed', detail: err.message });
    }
  });

  /**
   * GET /api/satp/identity/read/:wallet
   * Read identity using Anchor deserialization (v2 IDL)
   */
  app.get('/api/satp/identity/read/:wallet', async (req, res) => {
    try {
      const identity = await satpWrite.readIdentity(req.params.wallet, NETWORK);
      if (!identity) {
        return res.status(404).json({ error: 'Identity not found', wallet: req.params.wallet });
      }
      res.json({ ok: true, data: identity });
    } catch (err) {
      console.error('[SATP Write] read error:', err.message);
      res.status(500).json({ error: 'Failed to read identity', detail: err.message });
    }
  });

  console.log(`[SATP Write API] Routes registered (network: ${NETWORK}): /api/satp/{register, register/build, reputation/submit, identity/read}`);
}

module.exports = { registerSATPWriteRoutes };
