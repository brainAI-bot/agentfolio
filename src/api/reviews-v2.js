/**
 * Reviews v2 API — categories, weighted scoring, responses
 * Auth: wallet signature required for review submission
 */

const Database = require('better-sqlite3');
const path = require('path');

let nacl, bs58;
try { nacl = require('tweetnacl'); } catch (e) { console.warn('[Reviews v2] tweetnacl not available'); }
try { bs58 = require('bs58'); } catch (e) { console.warn('[Reviews v2] bs58 not available'); }

function getDb(readonly = true) {
  return new Database('/home/ubuntu/agentfolio/data/agentfolio.db', { readonly });
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

function migrateReviewsV2() {
  const db = new Database('/home/ubuntu/agentfolio/data/agentfolio.db');
  const cols = db.prepare("PRAGMA table_info(reviews)").all().map(c => c.name);
  
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
  app.post('/api/reviews/v2', (req, res) => {
    const { 
      reviewer_id, reviewee_id, rating, text, job_id,
      category_quality, category_reliability, category_communication,
      reviewer_rep_weight, tx_signature,
      wallet, signature, signedMessage
    } = req.body;
    
    if (!reviewer_id || !reviewee_id || !rating) {
      return res.status(400).json({ error: 'reviewer_id, reviewee_id, and rating required' });
    }
    if (reviewer_id === reviewee_id) {
      return res.status(400).json({ error: 'Cannot review yourself' });
    }

    // ── AUTH: Verify wallet ownership ──
    if (!wallet || !signature || !signedMessage) {
      return res.status(401).json({ 
        error: 'Authentication required. Provide wallet, signature, and signedMessage.',
        hint: 'Sign a message like "AgentFolio Review: <reviewer_id> reviews <reviewee_id> at <timestamp>"'
      });
    }

    // Verify the signer owns the wallet linked to reviewer_id
    const profileWallet = getProfileWallet(reviewer_id);
    if (!profileWallet) {
      return res.status(403).json({ error: 'Reviewer profile has no linked Solana wallet. Verify your wallet first.' });
    }
    if (profileWallet !== wallet) {
      return res.status(403).json({ error: 'Wallet does not match reviewer profile.' });
    }

    // Verify the signature
    const sigValid = verifySolanaSignature(signedMessage, signature, wallet);
    if (!sigValid) {
      return res.status(403).json({ error: 'Invalid wallet signature.' });
    }

    // Verify the signed message contains expected data (prevent replay)
    const expectedPrefix = `AgentFolio Review: ${reviewer_id} reviews ${reviewee_id}`;
    if (!signedMessage.startsWith(expectedPrefix)) {
      return res.status(400).json({ error: 'Signed message does not match expected format.', expected: expectedPrefix + ' at <unix_timestamp>' });
    }

    // Check timestamp in signed message (within 5 minutes)
    const tsMatch = signedMessage.match(/at (\d+)$/);
    if (tsMatch) {
      const msgTs = parseInt(tsMatch[1]);
      const now = Math.floor(Date.now() / 1000);
      if (Math.abs(now - msgTs) > 300) {
        return res.status(400).json({ error: 'Signed message timestamp expired (>5 min).' });
      }
    }
    // ── END AUTH ──
    
    const r = Math.min(5, Math.max(1, parseInt(rating)));
    const cq = Math.min(5, Math.max(0, parseInt(category_quality || 0)));
    const cr = Math.min(5, Math.max(0, parseInt(category_reliability || 0)));
    const cc = Math.min(5, Math.max(0, parseInt(category_communication || 0)));
    
    try {
      const db = getDb(false);
      const id = 'rev_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      
      db.prepare(`INSERT INTO reviews (id, job_id, reviewer_id, reviewee_id, rating, comment, type, created_at, 
        category_quality, category_reliability, category_communication, reviewer_rep_weight, tx_signature)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(id, job_id || 'direct', reviewer_id, reviewee_id, r, text || '', 'review', 
          new Date().toISOString(), cq, cr, cc, reviewer_rep_weight || 0, tx_signature || null);
      db.close();
      
      console.log(`[Reviews v2] Authenticated review: ${reviewer_id} -> ${reviewee_id} (wallet: ${wallet.slice(0,8)}...)`);
      
      res.status(201).json({ 
        id, reviewer_id, reviewee_id, rating: r, comment: text || '',
        category_quality: cq, category_reliability: cr, category_communication: cc,
        reviewer_rep_weight: reviewer_rep_weight || 0,
        tx_signature: tx_signature || null,
        authenticated: true,
        created_at: new Date().toISOString() 
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/reviews/:id/respond — reviewed party responds (also requires auth)
  app.post('/api/reviews/:id/respond', (req, res) => {
    const { id } = req.params;
    const { responder_id, response_text, wallet, signature, signedMessage } = req.body;
    
    if (!responder_id || !response_text) {
      return res.status(400).json({ error: 'responder_id and response_text required' });
    }

    // Auth for responses too
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

  // GET /api/reviews/v2?agent=<id> — get reviews (public, no auth needed)
  app.get('/api/reviews/v2', (req, res) => {
    const agent = req.query.agent;
    if (!agent) return res.status(400).json({ error: 'agent query param required' });
    
    try {
      const db = getDb();
      const reviews = db.prepare('SELECT * FROM reviews WHERE reviewee_id = ? ORDER BY created_at DESC').all(agent);
      db.close();
      
      let totalWeight = 0;
      let weightedSum = 0;
      let simpleSum = 0;
      
      const formatted = reviews.map(r => {
        const weight = 100 + (r.reviewer_rep_weight || 0);
        totalWeight += weight;
        weightedSum += r.rating * weight;
        simpleSum += r.rating;
        
        return {
          id: r.id,
          reviewer_id: r.reviewer_id,
          reviewee_id: r.reviewee_id,
          rating: r.rating,
          comment: r.comment,
          category_quality: r.category_quality || 0,
          category_reliability: r.category_reliability || 0,
          category_communication: r.category_communication || 0,
          reviewer_rep_weight: r.reviewer_rep_weight || 0,
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
      
      const catReviews = formatted.filter(r => r.category_quality > 0);
      const catAvg = catReviews.length > 0 ? {
        quality: catReviews.reduce((s, r) => s + r.category_quality, 0) / catReviews.length,
        reliability: catReviews.reduce((s, r) => s + r.category_reliability, 0) / catReviews.length,
        communication: catReviews.reduce((s, r) => s + r.category_communication, 0) / catReviews.length,
      } : null;
      
      res.json({
        agent,
        reviews: formatted,
        total: reviews.length,
        average_rating: Math.round(avgRating * 100) / 100,
        weighted_average: Math.round(weightedAvg * 100) / 100,
        category_averages: catAvg,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
}

module.exports = { registerReviewsV2Routes };
