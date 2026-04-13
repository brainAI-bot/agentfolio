/**
 * Reviews v2 API — categories, weighted scoring, responses
 * Auth: wallet signature required for review submission
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { Connection } = require('@solana/web3.js');
const { getProgramIds } = require('../satp-client/src/constants');
const { computeVerificationLevel } = require('../lib/compute-level');

const DB_PATH = '/home/ubuntu/agentfolio/data/agentfolio.db';
const MARKETPLACE_JOBS_DIR = '/home/ubuntu/agentfolio/data/marketplace/jobs';
const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || 'https://mainnet.helius-rpc.com/?api-key=91c63e44-1c7a-4b98-830b-6135632565fb';
const SATP_NETWORK = /mainnet|helius|alchemy/i.test(SOLANA_RPC_URL) ? 'mainnet' : 'devnet';
const SATP_PROGRAM_IDS = getProgramIds(SATP_NETWORK);
const SATP_REVIEWS_PROGRAM_ID = SATP_PROGRAM_IDS.REVIEWS.toBase58();

let solanaConnection = null;

function getSolanaConnection() {
  if (!solanaConnection) {
    solanaConnection = new Connection(SOLANA_RPC_URL, 'confirmed');
  }
  return solanaConnection;
}

let nacl, bs58;
try { nacl = require('tweetnacl'); } catch (e) { console.warn('[Reviews v2] tweetnacl not available'); }
try { const _bs58 = require('bs58'); bs58 = _bs58.default || _bs58; } catch (e) { console.warn('[Reviews v2] bs58 not available'); }

function getDb(readonly = true) {
  return new Database(DB_PATH, { readonly });
}

function verifySolanaSignature(message, signature, publicKey) {
  if (!nacl || !bs58) return false;
  try {
    const msgBytes = new TextEncoder().encode(message);
    const sigBytes = bs58.decode(signature);
    const pubKeyBytes = bs58.decode(publicKey);
    return nacl.sign.detached.verify(msgBytes, sigBytes, pubKeyBytes);
  } catch (e) {
    return false;
  }
}

function getProfileWallet(profileId) {
  try {
    const db = getDb(true);
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
    return null;
  } catch (e) {
    return null;
  }
}

function readMarketplaceJob(jobId) {
  try {
    return JSON.parse(fs.readFileSync(path.join(MARKETPLACE_JOBS_DIR, `${jobId}.json`), 'utf8'));
  } catch (e) {
    return null;
  }
}

function getMarketplaceParticipants(job) {
  return {
    clientId: job?.clientId || job?.postedBy || null,
    agentId: job?.selectedAgentId || job?.acceptedApplicant || null,
  };
}

function hasReleasedEscrow(job) {
  if (!job) return false;

  if (job.escrowId) {
    try {
      const escrowPath = path.join('/home/ubuntu/agentfolio/data/marketplace/escrow', String(job.escrowId) + '.json');
      const escrow = JSON.parse(fs.readFileSync(escrowPath, 'utf8'));
      if (escrow && (escrow.status === 'released' || escrow.status === 'auto_released')) return true;
    } catch (_) {}
  }

  return !!(job.fundsReleased || job.v3ReleaseTx || job.v3ReleasedAt);
}


function verifyReviewAuth(reviewerId, revieweeId, wallet, signature, signedMessage) {
  if (!wallet || !signature || !signedMessage) {
    return {
      ok: false,
      status: 401,
      error: 'Authentication required. Provide wallet, signature, and signedMessage.',
      hint: 'Sign a message like "AgentFolio Review: <reviewer_id> reviews <reviewee_id> at <timestamp>"',
    };
  }

  const profileWallet = getProfileWallet(reviewerId);
  if (!profileWallet) {
    return { ok: false, status: 403, error: 'Reviewer profile has no linked Solana wallet. Verify your wallet first.' };
  }
  if (profileWallet !== wallet) {
    return { ok: false, status: 403, error: 'Wallet does not match reviewer profile.' };
  }

  const sigValid = verifySolanaSignature(signedMessage, signature, wallet);
  if (!sigValid) {
    return { ok: false, status: 403, error: 'Invalid wallet signature.' };
  }

  const expectedPrefix = `AgentFolio Review: ${reviewerId} reviews ${revieweeId}`;
  if (!signedMessage.startsWith(expectedPrefix)) {
    return {
      ok: false,
      status: 400,
      error: 'Signed message does not match expected format.',
      expected: expectedPrefix + ' at <unix_timestamp>',
    };
  }

  const tsMatch = signedMessage.match(/at (\d+)$/);
  if (tsMatch) {
    const msgTs = parseInt(tsMatch[1], 10);
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - msgTs) > 300) {
      return { ok: false, status: 400, error: 'Signed message timestamp expired (>5 min).' };
    }
  }

  return { ok: true };
}

async function verifyReviewTxBackedAuth(reviewerId, txSignature, opts = {}) {
  if (!txSignature) {
    return { ok: false, status: 400, error: 'tx_signature required for tx-backed review auth.' };
  }

  const profileWallet = getProfileWallet(reviewerId);
  if (!profileWallet) {
    return { ok: false, status: 403, error: 'Reviewer profile has no linked Solana wallet. Verify your wallet first.' };
  }

  try {
    const conn = getSolanaConnection();
    const txInfo = await conn.getTransaction(txSignature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    });

    if (!txInfo || txInfo.meta?.err) {
      return { ok: false, status: 400, error: 'Submitted tx_signature is not confirmed on-chain.' };
    }

    const message = txInfo.transaction?.message;
    const rawKeys = Array.isArray(message?.accountKeys)
      ? message.accountKeys
      : Array.isArray(message?.staticAccountKeys)
        ? message.staticAccountKeys
        : [];

    const accountKeys = rawKeys
      .map((key) => (typeof key === 'string' ? key : key?.toBase58?.() || null))
      .filter(Boolean);

    if (!accountKeys.includes(profileWallet)) {
      return { ok: false, status: 403, error: 'tx_signature does not include the reviewer profile wallet.' };
    }

    if (opts.requiredProgramId && !accountKeys.includes(opts.requiredProgramId)) {
      return { ok: false, status: 403, error: 'tx_signature does not include the SATP reviews program.' };
    }

    if (opts.requiredAccount && !accountKeys.includes(opts.requiredAccount)) {
      return { ok: false, status: 403, error: 'tx_signature does not include the expected marketplace escrow/job account.' };
    }

    return { ok: true, authMode: 'tx_signature', wallet: profileWallet, txConfirmed: true };
  } catch (e) {
    return { ok: false, status: 502, error: 'Unable to verify tx_signature on-chain right now.', detail: e.message };
  }
}

function getReviewerRepWeight(db, reviewerId) {
  try {
    const row = db.prepare('SELECT COUNT(*) AS count FROM reviews WHERE reviewer_id = ?').get(reviewerId);
    const count = Number(row?.count || 0);
    if (count < 3) return -50;
    if (count < 10) return -20;
    if (count < 50) return 0;
    return 10;
  } catch (e) {
    return 0;
  }
}

function parseJson(value, fallback) {
  if (value == null || value === '') return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

function tierToLevel(tier) {
  return ({
    unverified: 0,
    unclaimed: 0,
    registered: 1,
    verified: 2,
    established: 3,
    trusted: 4,
    sovereign: 5,
  }[String(tier || '').toLowerCase()] || 0);
}

function getProfileRow(db, profileId) {
  return db.prepare('SELECT * FROM profiles WHERE id = ?').get(profileId) || null;
}

function getProfileReviewWeightContext(db, profileId) {
  const row = getProfileRow(db, profileId);
  if (!row) return null;

  const verificationData = parseJson(row.verification_data, {}) || {};
  const verification = parseJson(row.verification, {}) || {};
  const wallets = parseJson(row.wallets, {}) || {};
  const skills = parseJson(row.skills, []);
  const portfolio = parseJson(row.portfolio, []);
  const verifiedPlatforms = Array.isArray(verification.verifiedPlatforms)
    ? verification.verifiedPlatforms
    : Object.keys(verificationData).filter((platform) => verificationData?.[platform]?.verified);

  const verifications = Object.entries(verificationData)
    .filter(([platform, data]) => platform !== 'onboardingDismissed' && data && (data.verified || data.txSignature || data.address || data.handle || data.domain))
    .map(([platform, data]) => ({
      platform,
      method: data.method || data.proofMethod || data.proof_type || '',
    }));

  const completedEscrowCount = Number(
    db.prepare("SELECT COUNT(*) AS c FROM reviews WHERE reviewer_id = ? AND job_id IS NOT NULL AND job_id != 'direct'").get(profileId)?.c || 0
  );
  const receivedReviewCount = Number(db.prepare('SELECT COUNT(*) AS c FROM reviews WHERE reviewee_id = ?').get(profileId)?.c || 0);

  const profile = {
    ...row,
    wallets,
    skills,
    portfolio,
    verificationData,
    verification,
    avatar: row.avatar || row.avatar_url || '',
    createdAt: row.created_at || row.createdAt || null,
  };

  const computedLevel = computeVerificationLevel({
    profile,
    verifications,
    hasSatpIdentity: Boolean(verificationData?.satp_v3?.verified || verificationData?.satp?.verified || verifiedPlatforms.length > 0),
    completedEscrowCount,
    receivedReviewCount,
    profileExists: true,
  }).level;

  const storedLevel = tierToLevel(verification?.tier || row.tier || null);

  return {
    level: Math.max(computedLevel, storedLevel),
    verifiedPlatforms,
  };
}

function getReviewerLevelWeight(level) {
  return ({ 0: 0.3, 1: 0.3, 2: 0.6, 3: 0.8, 4: 1.0, 5: 1.2 }[Number(level) || 0] || 0.3);
}

function getJobAmount(db, jobId) {
  if (!jobId || jobId === 'direct') return 0;

  try {
    const row = db.prepare('SELECT agreed_budget, budget_amount, budget_max FROM jobs WHERE id = ?').get(jobId);
    const dbCandidates = [row?.agreed_budget, row?.budget_amount, row?.budget_max];
    for (const candidate of dbCandidates) {
      const value = Number(candidate);
      if (Number.isFinite(value) && value > 0) return value;
    }
  } catch (_) {}

  const job = readMarketplaceJob(jobId);
  if (!job) return 0;
  const candidates = [
    job.agreedBudget,
    job.agreed_budget,
    job.budgetAmount,
    job.budget_amount,
    job.budget,
    job.budgetMax,
    job.budget_max,
    job.amount,
    job.paymentAmount,
  ];

  for (const candidate of candidates) {
    const value = Number(candidate);
    if (Number.isFinite(value) && value > 0) return value;
  }

  return 0;
}

function getJobValueWeight(amount) {
  if (amount <= 0) return 0.5;
  if (amount < 10) return 0.5;
  if (amount <= 100) return 0.8;
  if (amount <= 1000) return 1.0;
  return 1.2;
}

function getReviewerHistoryMeta(db, reviewerId) {
  try {
    const row = db.prepare(`SELECT
      COUNT(*) AS count,
      SUM(CASE WHEN rating <= 2 THEN 1 ELSE 0 END) AS low_count
      FROM reviews
      WHERE reviewer_id = ?`).get(reviewerId) || {};
    const count = Number(row.count || 0);
    const lowCount = Number(row.low_count || 0);
    const badRatio = count > 0 ? lowCount / count : 0;
    const serialBadReviewer = count > 0 && badRatio > 0.5;

    let weight = 0.5;
    if (serialBadReviewer) weight = 0.3;
    else if (count < 3) weight = 0.5;
    else if (count < 10) weight = 0.8;
    else if (count < 50) weight = 1.0;
    else weight = 1.1;

    return {
      count,
      lowCount,
      badRatio: Math.round(badRatio * 1000) / 1000,
      serialBadReviewer,
      weight,
    };
  } catch (e) {
    return { count: 0, lowCount: 0, badRatio: 0, serialBadReviewer: false, weight: 0.5 };
  }
}

function computeReviewWeight(db, review) {
  const reviewer = getProfileReviewWeightContext(db, review.reviewer_id) || { level: 0, verifiedPlatforms: [] };
  const reviewerLevelWeight = getReviewerLevelWeight(reviewer.level);
  const jobAmount = getJobAmount(db, review.job_id);
  const jobValueWeight = getJobValueWeight(jobAmount);
  const history = getReviewerHistoryMeta(db, review.reviewer_id);
  const reviewWeight = reviewerLevelWeight * jobValueWeight * history.weight;

  return {
    review_weight: Math.round(reviewWeight * 1000) / 1000,
    review_weight_breakdown: {
      reviewer_level: reviewer.level,
      reviewer_level_weight: reviewerLevelWeight,
      job_value: jobAmount,
      job_value_weight: jobValueWeight,
      reviewer_history_count: history.count,
      reviewer_low_rating_count: history.lowCount,
      reviewer_low_rating_ratio: history.badRatio,
      reviewer_history_weight: history.weight,
      serial_bad_reviewer: history.serialBadReviewer,
    },
  };
}

function insertReviewRecord(db, {
  job_id,
  reviewer_id,
  reviewee_id,
  rating,
  text,
  category_quality,
  category_reliability,
  category_communication,
  reviewer_rep_weight,
  tx_signature,
}) {
  const id = 'rev_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const createdAt = new Date().toISOString();
  db.prepare(`INSERT INTO reviews (id, job_id, reviewer_id, reviewee_id, rating, comment, type, created_at,
    category_quality, category_reliability, category_communication, reviewer_rep_weight, tx_signature)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(
      id,
      job_id || 'direct',
      reviewer_id,
      reviewee_id,
      rating,
      text || '',
      'review',
      createdAt,
      category_quality || 0,
      category_reliability || 0,
      category_communication || 0,
      reviewer_rep_weight || 0,
      tx_signature || null,
    );
  return { id, createdAt };
}

function getReviewsPayload(agent) {
  const db = getDb();
  try {
    const reviews = db.prepare('SELECT * FROM reviews WHERE reviewee_id = ? ORDER BY created_at DESC').all(agent);

    let totalWeight = 0;
    let weightedSum = 0;
    let simpleSum = 0;

    const formatted = reviews.map((r) => {
      const weightMeta = computeReviewWeight(db, r);
      const weight = Number(weightMeta.review_weight || 0);
      totalWeight += weight;
      weightedSum += r.rating * weight;
      simpleSum += r.rating;

      return {
        id: r.id,
        reviewer_id: r.reviewer_id,
        reviewee_id: r.reviewee_id,
        job_id: r.job_id || null,
        rating: r.rating,
        comment: r.comment,
        category_quality: r.category_quality || 0,
        category_reliability: r.category_reliability || 0,
        category_communication: r.category_communication || 0,
        reviewer_rep_weight: r.reviewer_rep_weight || 0,
        review_weight: weightMeta.review_weight,
        review_weight_breakdown: weightMeta.review_weight_breakdown,
        tx_signature: r.tx_signature || null,
        source: r.tx_signature ? 'solana' : 'database',
        has_response: !!r.has_response,
        response_text: r.response_text || null,
        response_at: r.response_at || null,
        created_at: r.created_at,
      };
    });

    const avgRating = reviews.length > 0 ? simpleSum / reviews.length : 0;
    const weightedAvg = totalWeight > 0 ? weightedSum / totalWeight : 0;

    const catReviews = formatted.filter((r) => r.category_quality > 0);
    const catAvg = catReviews.length > 0 ? {
      quality: catReviews.reduce((s, r) => s + r.category_quality, 0) / catReviews.length,
      reliability: catReviews.reduce((s, r) => s + r.category_reliability, 0) / catReviews.length,
      communication: catReviews.reduce((s, r) => s + r.category_communication, 0) / catReviews.length,
    } : null;

    return {
      agent,
      reviews: formatted,
      total: reviews.length,
      average_rating: Math.round(avgRating * 100) / 100,
      weighted_average: Math.round(weightedAvg * 100) / 100,
      category_averages: catAvg,
      weighting_formula: {
        reviewer_level_weight: 'Level 0-1 => 0.3, Level 2 => 0.6, Level 3 => 0.8, Level 4 => 1.0, Level 5 => 1.2',
        job_value_weight: '< $10 => 0.5, $10-100 => 0.8, $100-1000 => 1.0, > $1000 => 1.2',
        reviewer_history_weight: '<3 => 0.5, 3-10 => 0.8, 10-50 => 1.0, 50+ => 1.1, serial bad reviewer => 0.3',
      },
    };
  } finally {
    db.close();
  }
}

function migrateReviewsV2() {
  const db = new Database(DB_PATH);
  const cols = db.prepare('PRAGMA table_info(reviews)').all().map(c => c.name);

  const additions = [
    ['category_quality', 'INTEGER DEFAULT 0'],
    ['category_reliability', 'INTEGER DEFAULT 0'],
    ['category_communication', 'INTEGER DEFAULT 0'],
    ['reviewer_rep_weight', 'INTEGER DEFAULT 0'],
    ['tx_signature', 'TEXT DEFAULT NULL'],
    ['has_response', 'INTEGER DEFAULT 0'],
    ['response_text', 'TEXT DEFAULT NULL'],
    ['response_at', 'TEXT DEFAULT NULL'],
  ];

  for (const [col, def] of additions) {
    if (!cols.includes(col)) {
      db.prepare(`ALTER TABLE reviews ADD COLUMN ${col} ${def}`).run();
      console.log(`[Reviews v2] Added column: ${col}`);
    }
  }
  db.close();
}

function registerReviewsV2Routes(app) {
  try { migrateReviewsV2(); } catch (e) { console.error('[Reviews v2] Migration error:', e.message); }

  // POST /api/reviews/v2 — submit review with wallet signature auth
  app.post('/api/reviews/v2', async (req, res) => {
    const {
      reviewer_id, reviewee_id, rating, text, job_id,
      category_quality, category_reliability, category_communication,
      reviewer_rep_weight, tx_signature,
      wallet, signature, signedMessage,
    } = req.body || {};

    if (!reviewer_id || !reviewee_id || !rating) {
      return res.status(400).json({ error: 'reviewer_id, reviewee_id, and rating required' });
    }
    if (reviewer_id === reviewee_id) {
      return res.status(400).json({ error: 'Cannot review yourself' });
    }

    const auth = tx_signature && !wallet && !signature && !signedMessage
      ? await verifyReviewTxBackedAuth(reviewer_id, tx_signature)
      : verifyReviewAuth(reviewer_id, reviewee_id, wallet, signature, signedMessage);
    if (!auth.ok) {
      const payload = { error: auth.error };
      if (auth.hint) payload.hint = auth.hint;
      if (auth.expected) payload.expected = auth.expected;
      if (auth.detail) payload.detail = auth.detail;
      return res.status(auth.status).json(payload);
    }

    const r = Math.min(5, Math.max(1, parseInt(rating, 10)));
    const cq = Math.min(5, Math.max(0, parseInt(category_quality || 0, 10)));
    const cr = Math.min(5, Math.max(0, parseInt(category_reliability || 0, 10)));
    const cc = Math.min(5, Math.max(0, parseInt(category_communication || 0, 10)));

    try {
      const db = getDb(false);
      if (job_id) {
        const existing = db.prepare('SELECT id FROM reviews WHERE job_id = ? AND reviewer_id = ? AND reviewee_id = ? LIMIT 1').get(job_id, reviewer_id, reviewee_id);
        if (existing) {
          db.close();
          return res.status(409).json({
            error: 'Reviewer already submitted a review for this job',
            reviewer_id,
            reviewee_id,
            job_id,
            existing_review_id: existing.id,
            auth_mode: auth.authMode || 'wallet_signature',
          });
        }
      }
      const record = insertReviewRecord(db, {
        job_id,
        reviewer_id,
        reviewee_id,
        rating: r,
        text: text || '',
        category_quality: cq,
        category_reliability: cr,
        category_communication: cc,
        reviewer_rep_weight: reviewer_rep_weight || 0,
        tx_signature: tx_signature || null,
      });
      db.close();

      const authLabel = auth.authMode === 'tx_signature'
        ? `tx ${String(tx_signature || '').slice(0, 8)}...`
        : `wallet: ${String(auth.wallet || wallet || '').slice(0, 8)}...`;
      console.log(`[Reviews v2] Authenticated review (${auth.authMode || 'wallet_signature'}): ${reviewer_id} -> ${reviewee_id} (${authLabel})`);

      res.status(201).json({
        id: record.id,
        reviewer_id,
        reviewee_id,
        rating: r,
        comment: text || '',
        category_quality: cq,
        category_reliability: cr,
        category_communication: cc,
        reviewer_rep_weight: reviewer_rep_weight || 0,
        tx_signature: tx_signature || null,
        authenticated: true,
        auth_mode: auth.authMode || 'wallet_signature',
        created_at: record.createdAt,
      });
    } catch (e) {
      if (e && (e.code == 'SQLITE_CONSTRAINT_UNIQUE' || /UNIQUE constraint failed/i.test(String(e.message || '')))) {
        return res.status(409).json({
          error: 'Reviewer already submitted a review for this job',
          reviewer_id,
          reviewee_id,
          job_id: job_id || 'direct',
          auth_mode: auth.authMode || 'wallet_signature',
        });
      }
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/reviews/:id/respond — reviewed party responds (also requires auth)
  app.post('/api/reviews/:id/respond', (req, res) => {
    const { id } = req.params;
    const { responder_id, response_text, wallet, signature, signedMessage } = req.body || {};

    if (!responder_id || !response_text) {
      return res.status(400).json({ error: 'responder_id and response_text required' });
    }

    if (!wallet || !signature || !signedMessage) {
      return res.status(401).json({ error: 'Authentication required. Provide wallet, signature, and signedMessage.' });
    }

    const profileWallet = getProfileWallet(responder_id);
    if (!profileWallet || profileWallet !== wallet) {
      return res.status(403).json({ error: 'Wallet does not match responder profile.' });
    }

    const sigValid = verifySolanaSignature(signedMessage, signature, wallet);
    if (!sigValid) {
      return res.status(403).json({ error: 'Invalid wallet signature.' });
    }

    try {
      const db = getDb(false);
      const review = db.prepare('SELECT * FROM reviews WHERE id = ?').get(id);
      if (!review) { db.close(); return res.status(404).json({ error: 'Review not found' }); }
      if (review.reviewee_id !== responder_id) {
        db.close();
        return res.status(403).json({ error: 'Only the reviewed party can respond' });
      }
      if (review.has_response) {
        db.close();
        return res.status(400).json({ error: 'Review already has a response' });
      }

      db.prepare('UPDATE reviews SET has_response = 1, response_text = ?, response_at = ? WHERE id = ?')
        .run(response_text, new Date().toISOString(), id);
      db.close();

      res.json({ id, has_response: true, response_text, response_at: new Date().toISOString() });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/marketplace/jobs/:id/review — escrow-gated marketplace review
  app.post('/api/marketplace/jobs/:id/review', async (req, res) => {
    const {
      rating,
      comment,
      reviewerId,
      reviewType,
      category_quality,
      category_reliability,
      category_communication,
      wallet,
      signature,
      signedMessage,
      txSignature,
      tx_signature,
    } = req.body || {};

    if (!rating || !reviewerId || !reviewType) {
      return res.status(400).json({ error: 'rating, reviewerId, and reviewType are required' });
    }

    const job = readMarketplaceJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (!hasReleasedEscrow(job)) {
      return res.status(400).json({ error: 'Reviews only allowed after funded escrow has been released for this job.' });
    }

    const { clientId, agentId } = getMarketplaceParticipants(job);
    if (!clientId || !agentId) {
      return res.status(400).json({ error: 'Job is missing review participants' });
    }

    let revieweeId = null;
    if (reviewType === 'client_to_agent') {
      if (reviewerId !== clientId) {
        return res.status(403).json({ error: 'reviewerId must match the job client for client_to_agent reviews' });
      }
      revieweeId = agentId;
    } else if (reviewType === 'agent_to_client') {
      if (reviewerId !== agentId) {
        return res.status(403).json({ error: 'reviewerId must match the assigned agent for agent_to_client reviews' });
      }
      revieweeId = clientId;
    } else {
      return res.status(400).json({ error: 'reviewType must be client_to_agent or agent_to_client' });
    }

    if (!revieweeId || reviewerId === revieweeId) {
      return res.status(400).json({ error: 'Invalid review participants' });
    }

    const submittedTxSignature = txSignature || tx_signature || null;
    if (!submittedTxSignature) {
      return res.status(400).json({ error: 'Marketplace reviews require a confirmed on-chain tx_signature.' });
    }

    const expectedJobAccount = job.onchainEscrowPDA || job.v3EscrowPDA || null;
    if (!expectedJobAccount) {
      return res.status(409).json({
        error: 'Marketplace tx-backed reviews require a job with an on-chain escrow PDA. JSON-only escrow jobs are not eligible for tx_signature review auth.',
      });
    }
    const auth = await verifyReviewTxBackedAuth(reviewerId, submittedTxSignature, {
      requiredProgramId: SATP_REVIEWS_PROGRAM_ID,
      requiredAccount: expectedJobAccount,
    });
    if (!auth.ok) {
      const payload = { error: auth.error };
      if (auth.hint) payload.hint = auth.hint;
      if (auth.expected) payload.expected = auth.expected;
      if (auth.detail) payload.detail = auth.detail;
      return res.status(auth.status).json(payload);
    }

    const r = Math.min(5, Math.max(1, parseInt(rating, 10)));
    const cq = Math.min(5, Math.max(0, parseInt(category_quality || 0, 10)));
    const cr = Math.min(5, Math.max(0, parseInt(category_reliability || 0, 10)));
    const cc = Math.min(5, Math.max(0, parseInt(category_communication || 0, 10)));

    try {
      const db = getDb(false);
      const existing = db.prepare('SELECT id FROM reviews WHERE job_id = ? AND reviewer_id = ? LIMIT 1').get(req.params.id, reviewerId);
      if (existing) {
        db.close();
        return res.status(409).json({ error: 'Reviewer already submitted a review for this job', reviewId: existing.id });
      }

      const reviewer_rep_weight = getReviewerRepWeight(db, reviewerId);
      const record = insertReviewRecord(db, {
        job_id: req.params.id,
        reviewer_id: reviewerId,
        reviewee_id: revieweeId,
        rating: r,
        text: comment || '',
        category_quality: cq,
        category_reliability: cr,
        category_communication: cc,
        reviewer_rep_weight,
        tx_signature: submittedTxSignature,
      });
      db.close();

      res.status(201).json({
        ok: true,
        id: record.id,
        job_id: req.params.id,
        reviewType,
        reviewer_id: reviewerId,
        reviewee_id: revieweeId,
        rating: r,
        comment: comment || '',
        category_quality: cq,
        category_reliability: cr,
        category_communication: cc,
        reviewer_rep_weight,
        tx_signature: submittedTxSignature,
        authenticated: true,
        created_at: record.createdAt,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  const sendReviews = (req, res) => {
    const agent = req.query.agent;
    if (!agent) return res.status(400).json({ error: 'agent query param required' });

    try {
      res.json(getReviewsPayload(agent));
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  };

  // GET /api/reviews/v2?agent=<id> — get reviews (public, no auth needed)
  app.get('/api/reviews/v2', sendReviews);

  // GET /api/reviews?agent=<id> — legacy/public alias
  app.get('/api/reviews', sendReviews);
}

module.exports = { registerReviewsV2Routes };
