/**
 * BOA Mint v2 API — calls ESM worker for Metaplex pipeline
 */
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const ASSETS_DIR = process.env.HOME + '/boa-assets';
const PIPELINE_DIR = '/home/ubuntu/agentfolio/boa-pipeline';
const CLUSTER = process.env.BOA_CLUSTER || 'devnet';

function registerBoaMintV2Routes(app) {
  
  app.get('/api/boa/available', (req, res) => {
    try {
      const recordsDir = path.join(PIPELINE_DIR, 'mint-records');
      const minted = new Set();
      if (fs.existsSync(recordsDir)) {
        fs.readdirSync(recordsDir).forEach(f => {
          const num = parseInt(f.replace('.json', ''));
          if (!isNaN(num)) minted.add(num);
        });
      }
      let next = 1;
      while (minted.has(next) && next <= 5000) next++;
      const metadataDir = path.join(ASSETS_DIR, 'metadata');
      const totalAssets = fs.existsSync(metadataDir) 
        ? fs.readdirSync(metadataDir).filter(f => f.endsWith('.json')).length : 0;
      res.json({ next_available: next, total_minted: minted.size, total_assets: totalAssets });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/boa/mint-nft/finalize', (req, res) => {
    const { wallet, nft_number } = req.body;
    if (!wallet || !nft_number) return res.status(400).json({ error: 'wallet and nft_number required' });
    
    const nftNum = parseInt(nft_number);
    if (isNaN(nftNum) || nftNum < 1 || nftNum > 5000) return res.status(400).json({ error: 'nft_number must be 1-5000' });
    
    const metadataPath = path.join(ASSETS_DIR, 'metadata', `${nftNum}.json`);
    const imagePath = path.join(ASSETS_DIR, 'images', `${nftNum}.jpg`);
    if (!fs.existsSync(metadataPath) || !fs.existsSync(imagePath))
      return res.status(404).json({ error: `Assets not found for NFT #${nftNum}` });
    
    const recordPath = path.join(PIPELINE_DIR, 'mint-records', `${nftNum}.json`);
    if (fs.existsSync(recordPath)) {
      const existing = JSON.parse(fs.readFileSync(recordPath, 'utf-8'));
      return res.status(409).json({ error: `NFT #${nftNum} already minted`, mint: existing.mint });
    }
    
    console.log(`[BOA MINT] Starting pipeline for #${nftNum} → ${wallet}`);
    
    const workerPath = path.join(PIPELINE_DIR, 'boa-mint-worker.mjs');
    execFile('node', [workerPath, String(nftNum), wallet, CLUSTER], {
      timeout: 120000,
      env: { ...process.env, HOME: process.env.HOME },
    }, (err, stdout, stderr) => {
      if (stderr) console.log(`[BOA MINT] stderr:`, stderr.slice(0, 500));
      if (err) {
        console.error(`[BOA MINT] Failed #${nftNum}:`, err.message);
        return res.status(500).json({ error: `Mint failed: ${err.message}`, stderr: stderr?.slice(0, 200) });
      }
      try {
        const result = JSON.parse(stdout.trim().split('\n').pop());
        if (result.error) return res.status(500).json(result);
        console.log(`[BOA MINT] ✅ #${nftNum} minted: ${result.mint}`);
        res.json({ success: true, ...result });
      } catch (e) {
        console.error(`[BOA MINT] Parse error:`, stdout);
        res.status(500).json({ error: 'Failed to parse worker output', raw: stdout?.slice(0, 500) });
      }
    });
  });
}

module.exports = { registerBoaMintV2Routes };
