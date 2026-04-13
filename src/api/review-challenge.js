/**
 * Review Challenge-Response API
 * POST /api/reviews/challenge — generate wallet-sign challenge
 * POST /api/reviews/submit — verify signature + create review (escrow-gated)
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const nacl = require('tweetnacl');

const MARKETPLACE_DIR = path.join(__dirname, '..', '..', 'data', 'marketplace');

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function findReleasedEscrowReviewRight(reviewerId, revieweeId) {
  const jobsDir = path.join(MARKETPLACE_DIR, 'jobs');
  const escrowDir = path.join(MARKETPLACE_DIR, 'escrow');
  let files = [];
  try { files = fs.readdirSync(jobsDir).filter(name => name.endsWith('.json')); } catch { return null; }

  for (const name of files) {
    const job = readJson(path.join(jobsDir, name));
    if (!job) continue;

    const clientId = job.clientId || job.postedBy;
    const workerId = job.acceptedApplicant || job.selectedAgentId;
    const pairMatches = (reviewerId === clientId && revieweeId === workerId) || (reviewerId === workerId && revieweeId === clientId);
    if (!pairMatches) continue;

    if (job.escrowId) {
      const escrow = readJson(path.join(escrowDir, `${job.escrowId}.json`));
      if (escrow && escrow.status === 'released') {
        return { jobId: job.id, source: 'json_escrow', escrowId: job.escrowId };
      }
    }

    if (job.v3EscrowPDA && (job.v3ReleaseTx || job.v3ReleasedAt)) {
      return { jobId: job.id, source: 'v3_escrow', escrowPDA: job.v3EscrowPDA, releaseTx: job.v3ReleaseTx || null };
    }
  }

  return null;
}

function getDb(readonly = true) {
  return new Database('/home/ubuntu/agentfolio/data/agentfolio.db', { readonly });
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
  } catch (_) {
    return null;
  }
}

// In-memory challenge store (TTL 30 min)
const challenges = new Map();

function registerReviewChallengeRoutes(app) {
  // POST /api/reviews/challenge
  app.post('/api/reviews/challenge', (req, res) => {
    try {
      const { reviewerId, revieweeId, rating, chain, jobId } = req.body;
      if (!reviewerId || !revieweeId || !rating) {
        return res.status(400).json({ success: false, error: 'reviewerId, revieweeId, and rating required' });
      }
      if (reviewerId === revieweeId) {
        return res.status(400).json({ success: false, error: 'Cannot review yourself' });
      }

      if (chain && chain !== 'solana') {
        return res.status(400).json({ success: false, error: 'Only Solana signed reviews are enabled on production.' });
      }

      const parsedRating = Number(rating);
      if (!Number.isInteger(parsedRating) || parsedRating < 1 || parsedRating > 5) {
        return res.status(400).json({ success: false, error: 'rating must be an integer 1-5' });
      }

      const challengeId = 'rc_' + crypto.randomBytes(16).toString('hex');
      const nonce = crypto.randomBytes(8).toString('hex');
      const message = `AgentFolio Review | reviewer=${reviewerId} | reviewee=${revieweeId} | rating=${parsedRating} | nonce=${nonce}`;

      challenges.set(challengeId, {
        reviewerId,
        revieweeId,
        rating: parsedRating,
        chain: chain || 'solana',
        jobId: jobId || null,
        message,
        nonce,
        createdAt: Date.now(),
      });

      // Cleanup expired challenges
      for (const [id, ch] of challenges) {
        if (Date.now() - ch.createdAt > 30 * 60 * 1000) challenges.delete(id);
      }

      res.json({ success: true, challengeId, message, expiresIn: '30 minutes' });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // POST /api/reviews/submit
  app.post('/api/reviews/submit', async (req, res) => {
    try {
      const { challengeId, signature, walletAddress, comment } = req.body;
      if (!challengeId || !signature || !walletAddress) {
        return res.status(400).json({ verified: false, error: 'challengeId, signature, and walletAddress required' });
      }

      const challenge = challenges.get(challengeId);
      if (!challenge) {
        return res.status(404).json({ verified: false, error: 'Challenge not found or expired' });
      }

      // Check expiry
      if (Date.now() - challenge.createdAt > 30 * 60 * 1000) {
        challenges.delete(challengeId);
        return res.status(400).json({ verified: false, error: 'Challenge expired' });
      }

      // Verify signature
      if (challenge.chain === 'solana') {
        const _bs58 = require('bs58');
        const bs58 = _bs58.default || _bs58;
        const messageBytes = new TextEncoder().encode(challenge.message);
        let sigBytes;
        try {
          sigBytes = bs58.decode(signature);
        } catch {
          sigBytes = Buffer.from(signature, 'base64');
        }

        let pubkeyBytes;
        try {
          pubkeyBytes = bs58.decode(walletAddress);
        } catch {
          return res.status(400).json({ verified: false, error: 'Invalid wallet format' });
        }

        if (sigBytes.length !== 64 || pubkeyBytes.length !== 32) {
          return res.status(400).json({ verified: false, error: 'Invalid signature or wallet format' });
        }
        const valid = nacl.sign.detached.verify(messageBytes, sigBytes, pubkeyBytes);
        if (!valid) {
          return res.status(400).json({ verified: false, error: 'Signature verification failed' });
        }

        const reviewerWallet = getProfileWallet(challenge.reviewerId);
        if (!reviewerWallet) {
          return res.status(403).json({ verified: false, error: 'Reviewer profile has no linked Solana wallet.' });
        }
        if (reviewerWallet !== walletAddress) {
          return res.status(403).json({ verified: false, error: 'Wallet does not match reviewer profile.' });
        }
      } else {
        return res.status(400).json({ verified: false, error: 'Only Solana signed reviews are enabled on production.' });
      }

      const reviewRight = findReleasedEscrowReviewRight(challenge.reviewerId, challenge.revieweeId);
      if (!reviewRight) {
        return res.status(403).json({
          verified: false,
          error: 'No released escrow job found between these agents. Reviews require completed funded escrow.',
        });
      }

      // Cleanup used challenge after signature verification. Legacy challenge-based review
      // submission must NOT write DB-only reviews anymore. Reviews now require an
      // on-chain transaction and tx_signature via the tx-backed marketplace flow.
      challenges.delete(challengeId);

      return res.status(409).json({
        verifiedSignature: true,
        reviewCreated: false,
        requiresOnchainReview: true,
        error: 'Legacy wallet-signed review submission is disabled. Reviews now require an on-chain transaction and tx_signature.',
        review: {
          reviewer: challenge.reviewerId,
          reviewee: challenge.revieweeId,
          rating: challenge.rating,
          comment: comment || '',
          walletAddress,
          chain: challenge.chain,
          jobId: reviewRight.jobId || challenge.jobId || null,
          escrowSource: reviewRight.source,
          escrowPDA: reviewRight.escrowPDA || null,
          releaseTx: reviewRight.releaseTx || null,
        },
        nextStep: 'Build and sign an on-chain review transaction, then POST /api/marketplace/jobs/:id/review with tx_signature.',
      });
    } catch (e) {
      console.error('[ReviewChallenge] submit error:', e);
      res.status(500).json({ verified: false, error: e.message });
    }
  });
}

module.exports = { registerReviewChallengeRoutes };
