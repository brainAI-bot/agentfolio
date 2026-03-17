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
  
  // POST /api/boa/mint/finalize — after payment TX confirmed, mint the actual NFT
  app.post('/api/boa/mint/finalize', async (req, res) => {
    const { wallet, payment_tx, nft_number } = req.body;
    
    if (!wallet || !nft_number) {
      return res.status(400).json({ error: 'wallet and nft_number required' });
    }
    
    // Prevent double-mint
    if (pendingMints.has(nft_number)) {
      return res.status(409).json({ error: 'Mint already in progress for this NFT number' });
    }
    
    // Check if already minted
    try {
      const db = new Database(DB_PATH, { readonly: true });
      const existing = db.prepare('SELECT * FROM boa_mints WHERE nft_number = ?').get(nft_number);
      db.close();
      if (existing && existing.status === 'completed') {
        return res.status(409).json({ error: 'NFT already minted', mint: existing.mint_address });
      }
    } catch (e) { /* continue */ }
    
    pendingMints.add(nft_number);
    
    // Record pending mint
    try {
      const db = new Database(DB_PATH);
      db.prepare('INSERT OR REPLACE INTO boa_mints (nft_number, wallet, payment_tx, status) VALUES (?,?,?,?)')
        .run(nft_number, wallet, payment_tx || '', 'pending');
      db.close();
    } catch (e) { /* continue */ }
    
    const cluster = process.env.BOA_CLUSTER || 'mainnet';
    
    console.log(`[BOA MINT] Starting mint #${nft_number} for ${wallet} (${cluster})`);
    
    // Run the ESM mint pipeline as a subprocess
    const mintScript = path.join(PIPELINE_DIR, 'mint-nft.mjs');
    
    const cmd = `node ${JSON.stringify(mintScript)} ${nft_number} ${wallet || ''}`;
    exec(cmd, {
      cwd: PIPELINE_DIR,
      env: { ...process.env, CLUSTER: cluster },
      timeout: 120000,
      maxBuffer: 1024 * 1024,
    }, (error, stdout, stderr) => {
      pendingMints.delete(nft_number);
      
      if (error) {
        console.error(`[BOA MINT] Failed #${nft_number}:`, error.message);
        console.error('[BOA MINT] stderr:', stderr);
        
        // Update DB
        try {
          const db = new Database(DB_PATH);
          db.prepare('UPDATE boa_mints SET status = ? WHERE nft_number = ?')
            .run('failed', nft_number);
          db.close();
        } catch (e) { /* ignore */ }
        
        return res.status(500).json({ error: 'Mint failed', details: stderr || error.message });
      }
      
      // Parse the result from stdout
      try {
        const lines = stdout.split('\n');
        const resultLine = lines.find(l => l.startsWith('{'));
        let result;
        if (resultLine) {
          // Find the JSON block at the end
          const jsonStart = stdout.lastIndexOf('=== Result ===');
          if (jsonStart >= 0) {
            const jsonStr = stdout.slice(jsonStart + 14).trim();
            result = JSON.parse(jsonStr);
          } else {
            result = JSON.parse(resultLine);
          }
        }
        
        if (!result) {
          // Try to extract mint address from output
          const mintMatch = stdout.match(/Mint:\s+(\w{32,})/);
          result = { mint: mintMatch ? mintMatch[1] : 'unknown' };
        }
        
        // Update DB with completed mint
        try {
          const db = new Database(DB_PATH);
          db.prepare('UPDATE boa_mints SET mint_address = ?, metadata_uri = ?, image_uri = ?, status = ?, completed_at = ? WHERE nft_number = ?')
            .run(result.mint || '', result.metadataUri || '', result.imageUri || '', 'completed', new Date().toISOString(), nft_number);
          db.close();
        } catch (e) { /* ignore */ }
        
        console.log(`[BOA MINT] ✅ #${nft_number} minted: ${result.mint}`);
        
        res.json({
          success: true,
          nft_number,
          mint: result.mint,
          collection: result.collection,
          metadata_uri: result.metadataUri,
          image_uri: result.imageUri,
          wallet,
        });
        
      } catch (parseErr) {
        console.log('[BOA MINT] Output:', stdout);
        res.json({ success: true, nft_number, output: stdout.slice(-500) });
      }
    });
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
