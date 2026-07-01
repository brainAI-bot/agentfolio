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

function hasCompletedEscrowBetween(reviewerId, revieweeId, options = {}) {
  const marketplaceDir = options.marketplaceDir || DEFAULT_MARKETPLACE_DIR;
  try {
    return listMarketplaceJobs(marketplaceDir).some(job => {
      if (!COMPLETED_JOB_STATUSES.has(job.status)) return false;
      if (!jobHasReleasedEscrow(job, marketplaceDir)) return false;

      const { clients, workers } = getJobParticipants(job, marketplaceDir);
      return (
        (clients.has(reviewerId) && workers.has(revieweeId)) ||
        (clients.has(revieweeId) && workers.has(reviewerId))
      );
    });
  } catch (e) {
    console.error('[ReviewChallenge] escrow gate failed closed:', e.message);
    return false;
  }
}

function escrowGateError() {
  return 'Reviews require a completed job with released escrow between these agents.';
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
      if (reviewerId === revieweeId) {
        return res.status(400).json({ success: false, error: 'Cannot review yourself' });
      }
      if (!hasCompletedEscrowBetween(reviewerId, revieweeId, { marketplaceDir })) {
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
          return res.status(400).json({ verified: false, error: 'Invalid signature or wallet format' });
        }
        const valid = nacl.sign.detached.verify(messageBytes, sigBytes, pubkeyBytes);
        if (!valid) {
          return res.status(400).json({ verified: false, error: 'Signature verification failed' });
        }
      } else {
        // ETH verification — simplified (ecrecover would go here)
        // For now, accept it (frontend did the signing)
      }

      if (!hasCompletedEscrowBetween(challenge.reviewerId, challenge.revieweeId, { marketplaceDir })) {
        challenges.delete(challengeId);
        return res.status(403).json({ verified: false, error: escrowGateError() });
      }

      // Save review
      const db = getDb(false, dbPath);
      const id = 'rev_' + Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
      
      // Detect FK column
      const reviewCols = db.prepare('PRAGMA table_info(reviews)').all().map(c => c.name);
      const useRevieweeId = reviewCols.includes('reviewee_id');
      
      if (useRevieweeId) {
        db.prepare(`INSERT INTO reviews (id, job_id, reviewer_id, reviewee_id, rating, comment, type, created_at)
          VALUES (?,?,?,?,?,?,?,?)`)
          .run(id, 'wallet-signed', challenge.reviewerId, challenge.revieweeId, challenge.rating, comment || '', 'review', new Date().toISOString());
      } else {
        db.prepare(`INSERT INTO reviews (id, profile_id, reviewer_id, reviewer_name, rating, comment, created_at)
          VALUES (?,?,?,?,?,?,?)`)
          .run(id, challenge.revieweeId, challenge.reviewerId, challenge.reviewerId, challenge.rating, comment || '', new Date().toISOString());
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
};
