/**
 * SATP Reviews V3 API Routes — On-chain job-scoped reviews
 * 
 * Endpoints:
 *   POST /api/reviews/submit    — Build unsigned submitReview TX
 *   POST /api/reviews/respond   — Build unsigned respondToReview TX
 *   GET  /api/reviews/:pda      — Fetch review state from chain
 *   GET  /api/reviews/pda/derive — Derive review PDA from job + reviewer
 * 
 * All POST endpoints return unsigned transactions (base64) for client-side wallet signing.
 * Server-stateless — no private keys needed.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const { Router } = require('express');
const { PublicKey, SystemProgram, Transaction, TransactionInstruction } = require('@solana/web3.js');
const { SATPSDK, getReviewV3PDA, getReviewCounterPDA, getReviewPDA } = require('../../satp-client/src/index');

const router = Router();

// Initialize SDK. On prod, infer mainnet when SOLANA_RPC_URL points at mainnet and SOLANA_NETWORK is unset.
const rpcUrl = process.env.SOLANA_RPC_URL;
const inferredNetwork = rpcUrl && /mainnet|helius|alchemy/i.test(rpcUrl) ? 'mainnet' : 'devnet';
const network = process.env.SOLANA_NETWORK || inferredNetwork;
const sdk = new SATPSDK({ network, rpcUrl });

const DB_PATH = '/home/ubuntu/agentfolio/data/agentfolio.db';
const MARKETPLACE_JOBS_DIR = '/home/ubuntu/agentfolio/data/marketplace/jobs';

function anchorDiscriminator(name) {
  return crypto.createHash('sha256').update(`global:${name}`).digest().slice(0, 8);
}

function serializeString(value) {
  const buf = Buffer.from(String(value || ''), 'utf8');
  const len = Buffer.alloc(4);
  len.writeUInt32LE(buf.length, 0);
  return Buffer.concat([len, buf]);
}

function getDb() {
  return new Database(DB_PATH, { readonly: true });
}

function getProfileWallet(profileId) {
  if (!profileId) return null;
  try {
    const db = getDb();
    const row = db.prepare('SELECT wallet, wallets, verification_data FROM profiles WHERE id = ?').get(profileId);
    db.close();
    if (!row) return null;
    if (row.wallet && row.wallet.length > 30) return row.wallet;
    try {
      const wallets = JSON.parse(row.wallets || '{}');
      if (wallets.solana) return wallets.solana;
    } catch (_) {}
    try {
      const vd = JSON.parse(row.verification_data || '{}');
      if (vd.solana?.address) return vd.solana.address;
    } catch (_) {}
  } catch (_) {}
  return null;
}

function findMarketplaceJobByPda(jobPDA) {
  try {
    for (const name of fs.readdirSync(MARKETPLACE_JOBS_DIR)) {
      if (!name.endsWith('.json')) continue;
      const job = JSON.parse(fs.readFileSync(path.join(MARKETPLACE_JOBS_DIR, name), 'utf8'));
      if (job?.onchainEscrowPDA === jobPDA || job?.v3EscrowPDA === jobPDA) return job;
    }
  } catch (_) {}
  return null;
}

function resolveMarketplaceReviewContext(job, reviewerWallet) {
  const clientId = job?.clientId || job?.postedBy || null;
  const agentId = job?.selectedAgentId || job?.acceptedApplicant || null;
  const clientWallet = getProfileWallet(clientId);
  const agentWallet = getProfileWallet(agentId);

  if (!clientWallet || !agentWallet) {
    throw new Error('Unable to resolve marketplace participant wallets for review build.');
  }

  if (reviewerWallet === clientWallet) {
    return { revieweeWallet: agentWallet, revieweeId: agentId, reviewerRole: 'client' };
  }
  if (reviewerWallet === agentWallet) {
    return { revieweeWallet: clientWallet, revieweeId: clientId, reviewerRole: 'agent' };
  }

  throw new Error('Reviewer wallet is not a participant on the marketplace job for this escrow PDA.');
}

async function buildMarketplaceReviewCompatTx({ reviewerWallet, jobPDA, rating, quality, reliability, communication, reviewerIdentity, commentUri, commentHash }) {
  const job = findMarketplaceJobByPda(jobPDA);
  if (!job) throw new Error('No marketplace job found for provided jobPDA.');

  const { revieweeWallet, revieweeId, reviewerRole } = resolveMarketplaceReviewContext(job, reviewerWallet);
  const reviewerKey = new PublicKey(reviewerWallet);
  const revieweeKey = new PublicKey(revieweeWallet);
  const jobKey = new PublicKey(jobPDA);
  const [reviewCounterPDA] = getReviewCounterPDA(revieweeKey, network);
  const [reviewPDA] = getReviewPDA(revieweeKey, reviewerKey, network);

  const metadata = JSON.stringify({
    kind: 'marketplace_review',
    jobId: job.id,
    jobPDA,
    reviewerRole,
    revieweeId,
    reviewerIdentity: reviewerIdentity || null,
    uri: String(commentUri || '').slice(0, 120),
    hash: String(commentHash || '').slice(0, 64),
    q: Number(quality || rating),
    r: Number(reliability || rating),
    c: Number(communication || rating),
  }).slice(0, 240);

  const reviewText = `Marketplace review for ${job.id}`.slice(0, 120);
  const instructions = [];

  if (!(await sdk.connection.getAccountInfo(reviewCounterPDA))) {
    instructions.push(new TransactionInstruction({
      programId: sdk.programIds.REVIEWS,
      keys: [
        { pubkey: reviewCounterPDA, isSigner: false, isWritable: true },
        { pubkey: reviewerKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: Buffer.concat([anchorDiscriminator('init_review_counter'), revieweeKey.toBuffer()]),
    }));
  }

  instructions.push(new TransactionInstruction({
    programId: sdk.programIds.REVIEWS,
    keys: [
      { pubkey: reviewPDA, isSigner: false, isWritable: true },
      { pubkey: reviewCounterPDA, isSigner: false, isWritable: true },
      { pubkey: reviewerKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: jobKey, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([
      anchorDiscriminator('create_review'),
      revieweeKey.toBuffer(),
      Buffer.from([Number(rating)]),
      serializeString(reviewText),
      serializeString(metadata),
    ]),
  }));

  const tx = new Transaction();
  tx.add(...instructions);
  tx.feePayer = reviewerKey;
  tx.recentBlockhash = (await sdk.connection.getLatestBlockhash()).blockhash;

  return { transaction: tx, reviewPDA, jobId: job.id, revieweeWallet, revieweeId, reviewerRole, compatibilityMode: 'legacy_create_review_with_job_binding' };
}


/**
 * POST /api/reviews/submit
 * Build an unsigned submitReview transaction.
 * 
 * Body:
 *   reviewer: string (wallet address)
 *   reviewerIdentity: string (reviewer's SATP Identity PDA)
 *   jobPDA: string (job/escrow account PDA)
 *   rating: number (1-5, overall rating)
 *   quality: number (1-5)
 *   reliability: number (1-5)
 *   communication: number (1-5)
 *   commentUri: string (URI to off-chain comment, max 200 chars)
 *   commentHash: string (hex-encoded SHA256 hash of comment, or raw text to hash)
 */
router.post('/submit', async (req, res, next) => {
  try {
    const { reviewer, reviewerIdentity, jobPDA, rating, quality, reliability, communication, commentUri, commentHash, challengeId, walletAddress } = req.body || {};

    if ((!reviewer || !reviewerIdentity || !jobPDA || !rating || !commentUri) && (challengeId || walletAddress)) {
      return next();
    }

    if (!reviewer || !reviewerIdentity || !jobPDA || !rating || !commentUri) {
      return res.status(400).json({
        error: 'Missing required fields: reviewer, reviewerIdentity, jobPDA, rating, commentUri',
      });
    }

    // Validate rating ranges
    const ratings = {
      rating: Number(rating),
      quality: Number(quality || rating),
      reliability: Number(reliability || rating),
      communication: Number(communication || rating),
    };

    for (const [key, val] of Object.entries(ratings)) {
      if (val < 1 || val > 5 || !Number.isInteger(val)) {
        return res.status(400).json({ error: `${key} must be an integer 1-5` });
      }
    }

    if (commentUri.length > 200) {
      return res.status(400).json({ error: 'commentUri must be <= 200 characters' });
    }

    const hashInput = commentHash || commentUri;

    const result = await buildMarketplaceReviewCompatTx({
      reviewerWallet: reviewer,
      reviewerIdentity,
      jobPDA,
      rating: ratings.rating,
      quality: ratings.quality,
      reliability: ratings.reliability,
      communication: ratings.communication,
      commentUri,
      commentHash: hashInput,
    });

    const txBase64 = result.transaction.serialize({ requireAllSignatures: false }).toString('base64');

    res.json({
      transaction: txBase64,
      reviewPDA: result.reviewPDA.toBase58(),
      jobId: result.jobId,
      revieweeWallet: result.revieweeWallet,
      revieweeId: result.revieweeId,
      reviewerRole: result.reviewerRole,
      compatibilityMode: result.compatibilityMode,
      message: 'Sign and send this transaction with your wallet',
    });
  } catch (e) {
    console.error('POST /api/reviews/submit error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/reviews/respond
 * Build an unsigned respondToReview transaction.
 * 
 * Body:
 *   responder: string (wallet address of reviewed party)
 *   reviewPDA: string (review account PDA)
 *   responseUri: string (URI to off-chain response, max 200 chars)
 *   responseHash: string (hex hash or raw text to hash)
 */
router.post('/respond', async (req, res) => {
  try {
    const { responder, reviewPDA, responseUri, responseHash } = req.body;

    if (!responder || !reviewPDA || !responseUri) {
      return res.status(400).json({
        error: 'Missing required fields: responder, reviewPDA, responseUri',
      });
    }

    if (responseUri.length > 200) {
      return res.status(400).json({ error: 'responseUri must be <= 200 characters' });
    }

    const hashInput = responseHash || responseUri;

    const result = await sdk.buildRespondToReview(
      responder,
      reviewPDA,
      responseUri,
      hashInput,
    );

    const txBase64 = result.transaction.serialize({ requireAllSignatures: false }).toString('base64');

    res.json({
      transaction: txBase64,
      message: 'Sign and send this transaction with your wallet',
    });
  } catch (e) {
    console.error('POST /api/reviews/respond error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/reviews/pda/derive
 * Derive review PDA from job + reviewer.
 * 
 * Query params:
 *   job: string (job/escrow account pubkey)
 *   reviewer: string (reviewer wallet pubkey)
 */
router.get('/pda/derive', async (req, res) => {
  try {
    const { job, reviewer } = req.query;

    if (!job || !reviewer) {
      return res.status(400).json({ error: 'Required query params: job, reviewer' });
    }

    try { new PublicKey(job); } catch {
      return res.status(400).json({ error: 'Invalid job pubkey' });
    }
    try { new PublicKey(reviewer); } catch {
      return res.status(400).json({ error: 'Invalid reviewer pubkey' });
    }

    const [pda, bump] = getReviewV3PDA(job, reviewer, network);

    res.json({
      pda: pda.toBase58(),
      bump,
      job,
      reviewer,
    });
  } catch (e) {
    console.error('GET /api/reviews/pda/derive error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/reviews/:pda
 * Fetch review state from on-chain.
 */
router.get('/:pda', async (req, res) => {
  try {
    const { pda } = req.params;

    // Validate pubkey format
    try { new PublicKey(pda); } catch {
      return res.status(400).json({ error: 'Invalid PDA format' });
    }

    const review = await sdk.getReview(pda);
    if (!review) {
      return res.status(404).json({ error: 'Review not found' });
    }

    res.json(review);
  } catch (e) {
    console.error('GET /api/reviews/:pda error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
