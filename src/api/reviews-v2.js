/**
 * Reviews v2 API — categories, weighted scoring, responses
 * Supplements existing /api/reviews endpoints with v2 fields
 */

const Database = require('better-sqlite3');
const path = require('path');

function getDb(readonly = true) {
  return new Database('/home/ubuntu/agentfolio/data/agentfolio.db', { readonly });
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
  // Run migration on load
  try { migrateReviewsV2(); } catch (e) { console.error('[Reviews v2] Migration error:', e.message); }

  // POST /api/reviews/v2 — submit review with categories
  app.post('/api/reviews/v2', (req, res) => {
    const { 
      reviewer_id, reviewee_id, rating, text, job_id,
      category_quality, category_reliability, category_communication,
      reviewer_rep_weight, tx_signature 
    } = req.body;
    
    if (!reviewer_id || !reviewee_id || !rating) {
      return res.status(400).json({ error: 'reviewer_id, reviewee_id, and rating required' });
    }
    if (reviewer_id === reviewee_id) {
      return res.status(400).json({ error: 'Cannot review yourself' });
    }
    
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
      
      res.status(201).json({ 
        id, reviewer_id, reviewee_id, rating: r, comment: text || '',
        category_quality: cq, category_reliability: cr, category_communication: cc,
        reviewer_rep_weight: reviewer_rep_weight || 0,
        tx_signature: tx_signature || null,
        created_at: new Date().toISOString() 
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/reviews/:id/respond — reviewed party responds
  app.post('/api/reviews/:id/respond', (req, res) => {
    const { id } = req.params;
    const { responder_id, response_text } = req.body;
    
    if (!responder_id || !response_text) {
      return res.status(400).json({ error: 'responder_id and response_text required' });
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

  // GET /api/reviews/v2?agent=<id> — get reviews with v2 fields + weighted average
  app.get('/api/reviews/v2', (req, res) => {
    const agent = req.query.agent;
    if (!agent) return res.status(400).json({ error: 'agent query param required' });
    
    try {
      const db = getDb();
      const reviews = db.prepare('SELECT * FROM reviews WHERE reviewee_id = ? ORDER BY created_at DESC').all(agent);
      db.close();
      
      // Calculate weighted average
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
      
      // Category averages
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
