/**
 * SATP Escrow API Routes — On-chain escrow for agent commerce
 * 
 * Endpoints:
 *   POST /api/escrow/create    — Build unsigned createEscrow TX
 *   POST /api/escrow/submit    — Build unsigned submitWork TX
 *   POST /api/escrow/release   — Build unsigned release TX
 *   POST /api/escrow/cancel    — Build unsigned cancel TX
 *   POST /api/escrow/dispute   — Build unsigned raiseDispute TX
 *   POST /api/escrow/close     — Build unsigned closeEscrow TX
 *   GET  /api/escrow/:pda      — Fetch escrow state from chain
 *   GET  /api/escrow/pda/derive — Derive escrow PDA from client + description
 * 
 * All POST endpoints return unsigned transactions (base64) for client-side wallet signing.
 * This keeps the server stateless — no private keys needed.
 */

const { Router } = require('express');
const { PublicKey } = require('@solana/web3.js');
const crypto = require('crypto');

// Import SATP SDK (adjust path for prod deployment)
let SATPSDK;
try {
  SATPSDK = require('../../satp-client/src/index').SATPSDK || require('../../satp-client/src/index');
} catch (e) {
  console.warn('[Escrow Routes] SATP SDK not found, escrow endpoints disabled:', e.message);
}

const router = Router();

// Determine network from env or default to mainnet
const NETWORK = process.env.SATP_NETWORK || 'mainnet';
const sdk = SATPSDK ? new SATPSDK({ network: NETWORK }) : null;

/**
 * Middleware: ensure SDK is available
 */
function requireSDK(req, res, next) {
  if (!sdk) {
    return res.status(503).json({ error: 'Escrow SDK not available' });
  }
  next();
}

/**
 * Helper: serialize a Transaction to base64 for client signing
 */
function serializeTransaction(tx) {
  // Serialize without requiring signatures (for unsigned TX)
  const serialized = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
  return Buffer.from(serialized).toString('base64');
}

/**
 * POST /api/escrow/create
 * Build an unsigned createEscrow transaction.
 * 
 * Body: {
 *   clientWallet: string,    // Client's wallet address
 *   agentWallet: string,     // Agent's wallet address  
 *   amountLamports: number,  // Amount to escrow (in lamports)
 *   description: string,     // Job description (hashed on-chain)
 *   deadlineUnix: number     // Unix timestamp deadline
 * }
 * 
 * Returns: { transaction: string (base64), escrowPDA: string, descriptionHash: string }
 */
router.post('/create', requireSDK, async (req, res) => {
  try {
    const { clientWallet, agentWallet, amountLamports, description, deadlineUnix } = req.body;

    if (!clientWallet || !agentWallet || !amountLamports || !description || !deadlineUnix) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['clientWallet', 'agentWallet', 'amountLamports', 'description', 'deadlineUnix']
      });
    }

    if (amountLamports <= 0) {
      return res.status(400).json({ error: 'amountLamports must be positive' });
    }

    if (deadlineUnix <= Math.floor(Date.now() / 1000)) {
      return res.status(400).json({ error: 'deadline must be in the future' });
    }

    const result = await sdk.buildCreateEscrow(
      clientWallet, agentWallet, amountLamports, description, deadlineUnix
    );

    res.json({
      transaction: serializeTransaction(result.transaction),
      escrowPDA: result.escrowPDA.toBase58(),
      descriptionHash: result.descriptionHash.toString('hex'),
      network: NETWORK,
      message: 'Sign and submit this transaction to create the escrow'
    });
  } catch (err) {
    console.error('[Escrow] create error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/escrow/submit
 * Build an unsigned submitWork transaction.
 * 
 * Body: {
 *   agentWallet: string,   // Agent's wallet address (signer)
 *   escrowPDA: string,     // Escrow account PDA
 *   workProof: string      // Proof of work (URL, hash, description)
 * }
 */
router.post('/submit', requireSDK, async (req, res) => {
  try {
    const { agentWallet, escrowPDA, workProof } = req.body;

    if (!agentWallet || !escrowPDA || !workProof) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['agentWallet', 'escrowPDA', 'workProof']
      });
    }

    const result = await sdk.buildSubmitWork(agentWallet, escrowPDA, workProof);

    res.json({
      transaction: serializeTransaction(result.transaction),
      network: NETWORK,
      message: 'Agent: sign and submit to submit work proof'
    });
  } catch (err) {
    console.error('[Escrow] submit error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/escrow/release
 * Build an unsigned release transaction (client pays agent).
 * 
 * Body: {
 *   clientWallet: string,  // Client's wallet address (signer)
 *   agentWallet: string,   // Agent's wallet address (receives funds)
 *   escrowPDA: string      // Escrow account PDA
 * }
 */
router.post('/release', requireSDK, async (req, res) => {
  try {
    const { clientWallet, agentWallet, escrowPDA } = req.body;

    if (!clientWallet || !agentWallet || !escrowPDA) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['clientWallet', 'agentWallet', 'escrowPDA']
      });
    }

    const result = await sdk.buildRelease(clientWallet, agentWallet, escrowPDA);

    res.json({
      transaction: serializeTransaction(result.transaction),
      network: NETWORK,
      message: 'Client: sign and submit to release payment to agent'
    });
  } catch (err) {
    console.error('[Escrow] release error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/escrow/cancel
 * Build an unsigned cancel transaction (client gets refund after deadline).
 * 
 * Body: {
 *   clientWallet: string,  // Client's wallet address (signer)
 *   escrowPDA: string      // Escrow account PDA
 * }
 */
router.post('/cancel', requireSDK, async (req, res) => {
  try {
    const { clientWallet, escrowPDA } = req.body;

    if (!clientWallet || !escrowPDA) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['clientWallet', 'escrowPDA']
      });
    }

    const result = await sdk.buildCancel(clientWallet, escrowPDA);

    res.json({
      transaction: serializeTransaction(result.transaction),
      network: NETWORK,
      message: 'Client: sign and submit to cancel escrow and get refund (only after deadline)'
    });
  } catch (err) {
    console.error('[Escrow] cancel error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/escrow/dispute
 * Build an unsigned raiseDispute transaction.
 * 
 * Body: {
 *   signerWallet: string,  // Client OR Agent wallet (signer)
 *   escrowPDA: string      // Escrow account PDA
 * }
 */
router.post('/dispute', requireSDK, async (req, res) => {
  try {
    const { signerWallet, escrowPDA } = req.body;

    if (!signerWallet || !escrowPDA) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['signerWallet', 'escrowPDA']
      });
    }

    const result = await sdk.buildRaiseDispute(signerWallet, escrowPDA);

    res.json({
      transaction: serializeTransaction(result.transaction),
      network: NETWORK,
      message: 'Sign and submit to raise a dispute on this escrow'
    });
  } catch (err) {
    console.error('[Escrow] dispute error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/escrow/close
 * Build an unsigned closeEscrow transaction (reclaim rent after settlement).
 * 
 * Body: {
 *   clientWallet: string,  // Client's wallet address (signer, receives rent)
 *   escrowPDA: string      // Escrow account PDA
 * }
 */
router.post('/close', requireSDK, async (req, res) => {
  try {
    const { clientWallet, escrowPDA } = req.body;

    if (!clientWallet || !escrowPDA) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['clientWallet', 'escrowPDA']
      });
    }

    const result = await sdk.buildCloseEscrow(clientWallet, escrowPDA);

    res.json({
      transaction: serializeTransaction(result.transaction),
      network: NETWORK,
      message: 'Client: sign and submit to close escrow and reclaim rent'
    });
  } catch (err) {
    console.error('[Escrow] close error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/escrow/:pda
 * Fetch escrow account state from on-chain.
 * 
 * Returns: { client, agent, amount, descriptionHash, deadline, status, workProof, createdAt }
 */
router.get('/:pda', requireSDK, async (req, res) => {
  try {
    const { pda } = req.params;

    // Validate PDA is a valid public key
    let escrowKey;
    try {
      escrowKey = new PublicKey(pda);
    } catch {
      return res.status(400).json({ error: 'Invalid PDA address' });
    }

    const escrow = await sdk.getEscrow(escrowKey);
    if (!escrow) {
      return res.status(404).json({ error: 'Escrow account not found' });
    }

    res.json({
      ...escrow,
      pda: pda,
      network: NETWORK
    });
  } catch (err) {
    console.error('[Escrow] get error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/escrow/pda/derive
 * Derive an escrow PDA from client wallet + description.
 * 
 * Query: { client: string, description: string }
 * Returns: { pda: string, descriptionHash: string }
 */
router.get('/pda/derive', requireSDK, async (req, res) => {
  try {
    const { client, description } = req.query;

    if (!client || !description) {
      return res.status(400).json({
        error: 'Missing required query params',
        required: ['client', 'description']
      });
    }

    let clientKey;
    try {
      clientKey = new PublicKey(client);
    } catch {
      return res.status(400).json({ error: 'Invalid client wallet address' });
    }

    const descHash = crypto.createHash('sha256').update(description).digest();
    const { getEscrowPDA } = require('../../satp-client/src/pda');
    const [escrowPDA] = getEscrowPDA(clientKey, descHash, NETWORK);

    res.json({
      pda: escrowPDA.toBase58(),
      descriptionHash: descHash.toString('hex'),
      client: client,
      network: NETWORK
    });
  } catch (err) {
    console.error('[Escrow] derive PDA error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
