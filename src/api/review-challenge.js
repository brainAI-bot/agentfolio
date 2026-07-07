/**
 * Review Challenge-Response API
 * POST /api/reviews/challenge — generate wallet-sign challenge
 * POST /api/reviews/submit — verify signature + create review (escrow-gated)
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

let Database;
let nacl;

const DEFAULT_DB_PATH = path.join(__dirname, '..', '..', 'data', 'agentfolio.db');
const DEFAULT_MARKETPLACE_DIR = path.join(__dirname, '..', '..', 'data', 'marketplace');
const COMPLETED_JOB_STATUSES = new Set(['completed', 'release_complete', 'released', 'paid']);
const RELEASED_ESCROW_STATUSES = new Set(['released', 'release_complete', 'paid']);
const SELECTED_APPLICATION_STATUSES = new Set(['accepted', 'selected']);
const ALLOWED_CHAINS = new Set(['solana', 'ethereum']);

function getDb(readonly = true, dbPath = DEFAULT_DB_PATH) {
  if (!Database) Database = require('better-sqlite3');
  return new Database(dbPath, { readonly });
}

function readJSON(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function getMarketplaceSubdir(marketplaceDir, subdir) {
  return path.join(marketplaceDir, subdir);
}

function listMarketplaceJobs(marketplaceDir = DEFAULT_MARKETPLACE_DIR) {
  const jobsDir = getMarketplaceSubdir(marketplaceDir, 'jobs');
  return fs.readdirSync(jobsDir)
    .filter(file => file.endsWith('.json'))
    .map(file => readJSON(path.join(jobsDir, file)))
    .filter(Boolean);
}

function loadEscrowForJob(job, marketplaceDir) {
  const escrowDir = getMarketplaceSubdir(marketplaceDir, 'escrow');
  if (job.escrowId) {
    return readJSON(path.join(escrowDir, `${job.escrowId}.json`));
  }

  try {
    return fs.readdirSync(escrowDir)
      .filter(file => file.endsWith('.json'))
      .map(file => readJSON(path.join(escrowDir, file)))
      .find(escrow => escrow && escrow.jobId === job.id) || null;
  } catch {
    return null;
  }
}

function loadApplication(appRef, marketplaceDir) {
  if (!appRef) return null;
  if (typeof appRef === 'object') return appRef;
  return readJSON(path.join(getMarketplaceSubdir(marketplaceDir, 'applications'), `${appRef}.json`));
}

function participantSet(values) {
  return new Set(values.filter(value => typeof value === 'string' && value.trim()).map(value => value.trim()));
}

function getJobParticipants(job, marketplaceDir) {
  const clients = participantSet([job.clientId, job.postedBy, job.v3EscrowFundedBy]);
  const workers = participantSet([
    job.acceptedApplicant,
    job.selectedAgentId,
    job.workerId,
    job.winnerId,
    job.assigneeId,
    job.v3EscrowAgentId,
    job.v3EscrowAgentWallet,
  ]);

  if (Array.isArray(job.applications)) {
    for (const appRef of job.applications) {
      const app = loadApplication(appRef, marketplaceDir);
      if (app && SELECTED_APPLICATION_STATUSES.has(app.status) && app.applicantId) {
        workers.add(app.applicantId);
      }
    }
  }

  return { clients, workers };
}

function jobHasReleasedEscrow(job, marketplaceDir) {
  const escrow = loadEscrowForJob(job, marketplaceDir);
  if (escrow && RELEASED_ESCROW_STATUSES.has(escrow.status)) return true;

  const hasV3Release = Boolean(job.v3EscrowPDA && (job.v3ReleaseTx || job.v3ReleasedAt));
  if (hasV3Release) return true;

  const hasRecordedEscrow = Boolean(job.escrowId || job.v3EscrowPDA || job.escrowFunded);
  return Boolean(job.fundsReleased && hasRecordedEscrow);
}

function findReleasedEscrowReviewContext(reviewerId, revieweeId, options = {}) {
  const marketplaceDir = options.marketplaceDir || DEFAULT_MARKETPLACE_DIR;
  try {
    for (const job of listMarketplaceJobs(marketplaceDir)) {
      if (!COMPLETED_JOB_STATUSES.has(job.status)) continue;
      if (!jobHasReleasedEscrow(job, marketplaceDir)) continue;

      const { clients, workers } = getJobParticipants(job, marketplaceDir);
      const matched = (
        (clients.has(reviewerId) && workers.has(revieweeId)) ||
        (clients.has(revieweeId) && workers.has(reviewerId))
      );
      if (matched) {
        return {
          jobId: job.id,
          escrowId: job.escrowId || job.v3EscrowPDA || null,
        };
      }
    }
    return null;
  } catch (e) {
    console.error('[ReviewChallenge] escrow gate failed closed:', e.message);
    return null;
  }
}

function escrowGateError() {
  return 'Reviews require a completed job with released escrow between these agents.';
}

function hasCompletedEscrowBetween(reviewerId, revieweeId, options = {}) {
  return Boolean(findReleasedEscrowReviewContext(reviewerId, revieweeId, options));
}

function verifyEthereumSignature(message, signature, expectedAddress) {
  try {
    const ethers = require('ethers');
    const recovered = ethers.verifyMessage
      ? ethers.verifyMessage(message, signature)
      : ethers.utils.verifyMessage(message, signature);
    return recovered.toLowerCase() === expectedAddress.toLowerCase();
  } catch {
    return false;
  }
}

function findExistingReview(db, { jobId, reviewerId, revieweeId, useRevieweeId }) {
  const revieweeColumn = useRevieweeId ? 'reviewee_id' : 'profile_id';
  return db.prepare(`
    SELECT id FROM reviews
    WHERE job_id = ? AND reviewer_id = ? AND ${revieweeColumn} = ?
    LIMIT 1
  `).get(jobId, reviewerId, revieweeId);
}

function parseJSONField(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeWallet(chain, wallet) {
  const value = String(wallet || '').trim();
  return chain === 'ethereum' ? value.toLowerCase() : value;
}

function reviewerWalletMatchesProfile(db, { reviewerId, chain, walletAddress }) {
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'profiles'").all();
    if (tables.length === 0) return false;

    const cols = db.prepare('PRAGMA table_info(profiles)').all().map(c => c.name);
    const selectedCols = ['id', 'wallet', 'claimed_by', 'wallets', 'verification_data'].filter(col => cols.includes(col));
    if (!selectedCols.includes('id')) return false;

    const profile = db.prepare(`SELECT ${selectedCols.join(', ')} FROM profiles WHERE id = ?`).get(reviewerId);
    if (!profile) return false;

    const wallets = parseJSONField(profile.wallets);
    const verificationData = parseJSONField(profile.verification_data);
    const candidateWallets = [
      profile.wallet,
      profile.claimed_by,
      wallets?.[chain],
      chain === 'solana' ? wallets?.solana_wallet : null,
      wallets?.wallet,
      verificationData?.[chain]?.address,
      verificationData?.[chain]?.wallet,
    ].filter(Boolean);

    const expected = normalizeWallet(chain, walletAddress);
    return candidateWallets.some(candidate => normalizeWallet(chain, candidate) === expected);
  } catch (e) {
    console.error('[ReviewChallenge] reviewer identity lookup failed closed:', e.message);
    return false;
  }
}

// In-memory challenge store (TTL 30 min)
const challenges = new Map();

function registerReviewChallengeRoutes(app, options = {}) {
  const dbPath = options.dbPath || DEFAULT_DB_PATH;
  const marketplaceDir = options.marketplaceDir || DEFAULT_MARKETPLACE_DIR;

  // POST /api/reviews/challenge
  app.post('/api/reviews/challenge', (req, res) => {
    try {
      const { reviewerId, revieweeId, rating, chain } = req.body;
      if (!reviewerId || !revieweeId || !rating) {
        return res.status(400).json({ success: false, error: 'reviewerId, revieweeId, and rating required' });
      }
      if (chain && !ALLOWED_CHAINS.has(chain)) {
        return res.status(400).json({ success: false, error: 'chain must be solana or ethereum' });
      }
      if (reviewerId === revieweeId) {
        return res.status(400).json({ success: false, error: 'Cannot review yourself' });
      }
      const escrowContext = findReleasedEscrowReviewContext(reviewerId, revieweeId, { marketplaceDir });
      if (!escrowContext) {
        return res.status(403).json({ success: false, error: escrowGateError() });
      }

      const challengeId = 'rc_' + crypto.randomBytes(16).toString('hex');
      const nonce = crypto.randomBytes(8).toString('hex');
      const message = `AgentFolio Review | reviewer=${reviewerId} | reviewee=${revieweeId} | rating=${rating} | nonce=${nonce}`;

      challenges.set(challengeId, {
        reviewerId,
        revieweeId,
        rating: Math.min(5, Math.max(1, parseInt(rating))),
        chain: chain || 'solana',
        message,
        nonce,
        jobId: escrowContext.jobId,
        escrowId: escrowContext.escrowId,
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
        if (!nacl) nacl = require('tweetnacl');
        const _bs58 = require('bs58');
        const bs58 = _bs58.default || _bs58;
        const messageBytes = new TextEncoder().encode(challenge.message);
        let sigBytes;
        try {
          sigBytes = bs58.decode(signature);
        } catch {
          sigBytes = Buffer.from(signature, 'base64');
        }
        const pubkeyBytes = bs58.decode(walletAddress);
        if (sigBytes.length !== 64 || pubkeyBytes.length !== 32) {
          return res.status(401).json({ verified: false, error: 'Invalid signature or wallet format' });
        }
        const valid = nacl.sign.detached.verify(messageBytes, sigBytes, pubkeyBytes);
        if (!valid) {
          return res.status(401).json({ verified: false, error: 'Signature verification failed' });
        }
      } else {
        const valid = verifyEthereumSignature(challenge.message, signature, walletAddress);
        if (!valid) {
          return res.status(401).json({ verified: false, error: 'Signature verification failed' });
        }
      }

      const escrowContext = findReleasedEscrowReviewContext(challenge.reviewerId, challenge.revieweeId, { marketplaceDir });
      if (!escrowContext || escrowContext.jobId !== challenge.jobId) {
        challenges.delete(challengeId);
        return res.status(403).json({ verified: false, error: escrowGateError() });
      }

      // Save review
      const db = getDb(false, dbPath);
      const signerMatchesReviewer = reviewerWalletMatchesProfile(db, {
        reviewerId: challenge.reviewerId,
        chain: challenge.chain,
        walletAddress,
      });
      if (!signerMatchesReviewer) {
        db.close();
        return res.status(403).json({ verified: false, error: 'Signed wallet is not bound to the reviewer SATP identity' });
      }

      const id = 'rev_' + Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
      
      // Detect FK column
      const reviewCols = db.prepare('PRAGMA table_info(reviews)').all().map(c => c.name);
      const useRevieweeId = reviewCols.includes('reviewee_id');
      const existing = findExistingReview(db, {
        jobId: challenge.jobId,
        reviewerId: challenge.reviewerId,
        revieweeId: challenge.revieweeId,
        useRevieweeId,
      });
      if (existing) {
        db.close();
        challenges.delete(challengeId);
        return res.status(409).json({ verified: false, error: 'Review already exists for this released escrow' });
      }
      
      if (useRevieweeId) {
        db.prepare(`INSERT INTO reviews (id, job_id, reviewer_id, reviewee_id, rating, comment, type, created_at)
          VALUES (?,?,?,?,?,?,?,?)`)
          .run(id, challenge.jobId, challenge.reviewerId, challenge.revieweeId, challenge.rating, comment || '', 'escrow_review', new Date().toISOString());
      } else {
        db.prepare(`INSERT INTO reviews (id, profile_id, reviewer_id, reviewer_name, rating, comment, job_id, created_at)
          VALUES (?,?,?,?,?,?,?,?)`)
          .run(id, challenge.revieweeId, challenge.reviewerId, challenge.reviewerId, challenge.rating, comment || '', challenge.jobId, new Date().toISOString());
      }
      db.close();

      // Cleanup used challenge
      challenges.delete(challengeId);

      res.json({
        verified: true,
        review: {
          id,
          reviewer: challenge.reviewerId,
          reviewee: challenge.revieweeId,
          jobId: challenge.jobId,
          escrowId: challenge.escrowId,
          rating: challenge.rating,
          comment: comment || '',
          walletAddress,
          chain: challenge.chain,
        },
      });
    } catch (e) {
      console.error('[ReviewChallenge] submit error:', e);
      res.status(500).json({ verified: false, error: e.message });
    }
  });
}

module.exports = {
  registerReviewChallengeRoutes,
  hasCompletedEscrowBetween,
  findReleasedEscrowReviewContext,
};
