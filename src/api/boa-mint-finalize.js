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
const { sendBoaWriteGateResponse } = require('../lib/write-surface-gate');
const {
  completeBoaMintReservation,
  ensureBoaMintReservationSchema,
  failBoaMintReservation,
  reserveBoaMintPayment,
} = require('../lib/boa-mint-reservations');

const PIPELINE_DIR = path.join(__dirname, '..', 'boa-pipeline');
const DB_PATH = '/home/ubuntu/agentfolio/data/agentfolio.db';

// Track pending mints to prevent double-minting
const pendingMints = new Set();

function registerBoaMintFinalizeRoutes(app) {
  
  // Ensure mint records table exists
  try {
    const db = new Database(DB_PATH);
    ensureBoaMintReservationSchema(db);
    db.close();
    console.log('[BOA Mint] boa_mints table ready');
  } catch (e) {
    console.error('[BOA Mint] DB init error:', e.message);
  }
  
  // POST /api/boa/mint/finalize — after payment TX confirmed, mint the actual NFT
  app.post('/api/boa/mint/finalize', async (req, res) => {
    if (sendBoaWriteGateResponse(res, 'BOA mint finalization')) return;
    const { wallet, payment_tx, nft_number } = req.body;
    
    if (!wallet || !payment_tx || !nft_number) {
      return res.status(400).json({ error: 'wallet, payment_tx and nft_number required' });
    }
    const nftNumber = parseInt(nft_number, 10);
    if (!Number.isInteger(nftNumber) || nftNumber < 1) {
      return res.status(400).json({ error: 'nft_number must be a positive integer' });
    }
    
    // Prevent double-mint
    if (pendingMints.has(nftNumber)) {
      return res.status(409).json({ error: 'Mint already in progress for this NFT number' });
    }
    
    // Reserve payment_tx and nft_number before any mint side effects.
    try {
      const db = new Database(DB_PATH);
      const reservation = reserveBoaMintPayment(db, { nftNumber, wallet, paymentTx: payment_tx });
      db.close();
      if (reservation.idempotent) {
        return res.status(409).json({
          error: reservation.record?.status === 'completed'
            ? 'NFT already minted'
            : 'payment_tx is already reserved for a BOA mint',
          code: 'BOA_PAYMENT_TX_ALREADY_RESERVED',
          mint: reservation.record?.mint_address,
        });
      }
    } catch (e) {
      return res.status(e.statusCode || 409).json({
        error: e.message,
        code: e.code,
      });
    }
    
    pendingMints.add(nftNumber);
    
    const cluster = process.env.BOA_CLUSTER || 'mainnet';
    
    console.log(`[BOA MINT] Starting mint #${nftNumber} for ${wallet} (${cluster})`);
    
    // Run the ESM mint pipeline as a subprocess
    const mintScript = path.join(PIPELINE_DIR, 'mint-nft.mjs');
    
    const cmd = `node ${JSON.stringify(mintScript)} ${nftNumber} ${wallet || ''}`;
    exec(cmd, {
      cwd: PIPELINE_DIR,
      env: { ...process.env, CLUSTER: cluster },
      timeout: 120000,
      maxBuffer: 1024 * 1024,
    }, (error, stdout, stderr) => {
      pendingMints.delete(nftNumber);
      
      if (error) {
        console.error(`[BOA MINT] Failed #${nftNumber}:`, error.message);
        console.error('[BOA MINT] stderr:', stderr);
        
        // Update DB
        try {
          const db = new Database(DB_PATH);
          failBoaMintReservation(db, nftNumber);
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
          completeBoaMintReservation(db, {
            nftNumber,
            mintAddress: result.mint || '',
            metadataUri: result.metadataUri || '',
            imageUri: result.imageUri || '',
          });
          db.close();
        } catch (e) { /* ignore */ }
        
        console.log(`[BOA MINT] ✅ #${nftNumber} minted: ${result.mint}`);
        
        res.json({
          success: true,
          nft_number: nftNumber,
          mint: result.mint,
          collection: result.collection,
          metadata_uri: result.metadataUri,
          image_uri: result.imageUri,
          wallet,
        });
        
      } catch (parseErr) {
        console.log('[BOA MINT] Output:', stdout);
        res.json({ success: true, nft_number: nftNumber, output: stdout.slice(-500) });
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
