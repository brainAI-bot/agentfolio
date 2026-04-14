/**
 * BOA NFT Mint Finalization API — Express endpoint wrapper
 * Spawns the ESM mint pipeline as a child process
 * 
 * POST /api/boa/mint/finalize
 * Body: { wallet, payment_tx, nft_number }
 */

const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const PIPELINE_DIR = path.join(__dirname, '..', 'boa-pipeline');
const DB_PATH = '/home/ubuntu/agentfolio/data/agentfolio.db';

// Track pending mints to prevent double-minting
const pendingMints = new Set();

function registerBoaMintFinalizeRoutes(app) {
  
  // Ensure mint records table exists
  try {
    const db = new Database(DB_PATH);
    db.exec(`CREATE TABLE IF NOT EXISTS boa_mints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nft_number INTEGER NOT NULL UNIQUE,
      wallet TEXT NOT NULL,
      mint_address TEXT,
      payment_tx TEXT,
      metadata_uri TEXT,
      image_uri TEXT,
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      completed_at TEXT
    )`);
    db.close();
    console.log('[BOA Mint] boa_mints table ready');
  } catch (e) {
    console.error('[BOA Mint] DB init error:', e.message);
  }
  
  // POST /api/boa/mint/finalize — deprecated legacy route, intentionally disabled
  app.post('/api/boa/mint/finalize', async (req, res) => {
    return res.status(410).json({ error: 'Deprecated route disabled. Use /api/boa/mint/complete.' });
  });

  // GET /api/boa/mints — list minted NFTs
  app.get('/api/boa/mints', (req, res) => {
    try {
      const db = new Database(DB_PATH, { readonly: true });
      const mints = db.prepare('SELECT * FROM boa_mints ORDER BY nft_number ASC').all();
      db.close();
      res.json({ mints, total: mints.length });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
}

module.exports = { registerBoaMintFinalizeRoutes };
