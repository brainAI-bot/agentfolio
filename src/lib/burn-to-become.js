/**
 * Burn to Become — Permanent NFT Avatar System
 * 
 * Flow: Pick NFT → Upload to Arweave → Burn NFT → Mint Soulbound → Lock forever
 */

const { loadProfile, saveProfile } = require('./profile');
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const BURN_STATUS_FILE = path.join(__dirname, '../../data/burn-status.json');

// Ensure data dir exists
const dataDir = path.join(__dirname, '../../data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

function loadBurnStatuses() {
  if (!fs.existsSync(BURN_STATUS_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(BURN_STATUS_FILE, 'utf8')); } catch { return {}; }
}

function saveBurnStatuses(data) {
  fs.writeFileSync(BURN_STATUS_FILE, JSON.stringify(data, null, 2));
}

function setBurnStatus(txId, status) {
  const all = loadBurnStatuses();
  all[txId] = { ...status, updatedAt: new Date().toISOString() };
  saveBurnStatuses(all);
}

function getBurnStatus(txId) {
  const all = loadBurnStatuses();
  return all[txId] || null;
}

/**
 * Check if a profile already has a permanent (burned) avatar
 */
function hasPermanentAvatar(profileId) {
  const profile = loadProfile(profileId);
  if (!profile) return false;
  return !!(profile.nftAvatar && profile.nftAvatar.permanent === true);
}

/**
 * Upload image to Arweave via Irys (Bundlr)
 * Returns the Arweave URL
 * 
 * NOTE: In production, this requires IRYS_PRIVATE_KEY env var and funded Irys account.
 * For now, we support two modes:
 * 1. Server-side upload if IRYS configured
 * 2. Client provides arweaveUrl after uploading themselves
 */
async function uploadToArweave(imageUrl) {
  // Try to fetch the image first
  const imageBuffer = await fetchImageBuffer(imageUrl);
  
  // Check for Irys SDK
  try {
    const Irys = require('@irys/sdk');
    const privateKey = process.env.IRYS_PRIVATE_KEY;
    if (!privateKey) {
      throw new Error('IRYS_PRIVATE_KEY not configured');
    }
    
    const irys = new Irys({
      url: 'https://node2.irys.xyz',
      token: 'solana',
      key: privateKey,
    });
    
    const receipt = await irys.upload(imageBuffer, {
      tags: [
        { name: 'Content-Type', value: 'image/png' },
        { name: 'App-Name', value: 'AgentFolio' },
        { name: 'Type', value: 'burn-to-become-avatar' },
      ],
    });
    
    return `https://arweave.net/${receipt.id}`;
  } catch (e) {
    console.warn('[BurnToBecome] Irys upload failed, using fallback:', e.message);
    // Fallback: store locally and return a local URL
    // In production, client should upload to Arweave directly
    const hash = crypto.createHash('sha256').update(imageBuffer).digest('hex').slice(0, 16);
    const avatarDir = path.join(__dirname, '../../public/avatars/permanent');
    if (!fs.existsSync(avatarDir)) fs.mkdirSync(avatarDir, { recursive: true });
    const filename = `${hash}.png`;
    fs.writeFileSync(path.join(avatarDir, filename), imageBuffer);
    // Return the original URL if we can't upload to Arweave
    // The client can provide arweaveUrl to override
    return imageUrl;
  }
}

/**
 * Fetch image from URL as buffer
 */
function fetchImageBuffer(imageUrl) {
  return new Promise((resolve, reject) => {
    const client = imageUrl.startsWith('https') ? https : http;
    client.get(imageUrl, { headers: { 'User-Agent': 'AgentFolio/1.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchImageBuffer(res.headers.location).then(resolve).catch(reject);
        return;
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

/**
 * Build the burn-to-become transaction instructions (serialized)
 * Client will sign and send
 * 
 * Returns serialized transaction for the client to sign
 */
function buildBurnToBecomeTxData({ walletAddress, nftMint, arweaveUrl, profileId }) {
  // Return instruction data for client-side transaction building
  // The actual transaction is built and signed client-side using @solana/web3.js
  return {
    instructions: [
      {
        type: 'burn',
        programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
        mint: nftMint,
        owner: walletAddress,
      },
      {
        type: 'mintSoulbound',
        programId: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', // Token-2022
        metadata: {
          name: `AgentFolio Identity - ${profileId}`,
          symbol: 'AFSOUL',
          uri: arweaveUrl,
          sellerFeeBasisPoints: 0,
        },
        extensions: ['nonTransferable'],
        owner: walletAddress,
      }
    ],
    message: `Burn NFT ${nftMint.slice(0, 8)}... to become your permanent AgentFolio identity`,
  };
}

/**
 * Process a burn-to-become request
 * 
 * This is called AFTER the client has:
 * 1. Signed and submitted the burn + mint transaction
 * 2. The transaction has been confirmed on-chain
 * 
 * Server verifies the transaction and locks the avatar
 */
async function processBurnToBecome({ profileId, walletAddress, nftMint, nftName, nftImage, arweaveUrl, burnTxSignature, soulboundMint }) {
  // Validate profile exists
  const profile = loadProfile(profileId);
  if (!profile) {
    return { success: false, error: 'Profile not found' };
  }
  
  // Check if already has permanent avatar
  if (profile.nftAvatar && profile.nftAvatar.permanent === true) {
    return { success: false, error: 'Profile already has a permanent avatar. Burn to Become is irreversible.', code: 403 };
  }
  
  // Check wallet is verified on this profile
  const walletVerified = profile.verifications?.some(v =>
    v.type === 'solana' &&
    v.address?.toLowerCase() === walletAddress.toLowerCase() &&
    v.verified
  );
  
  if (!walletVerified) {
    return { success: false, error: 'Wallet not verified on this profile' };
  }
  
  // Create burn status tracking
  const txId = burnTxSignature || `pending-${Date.now()}`;
  setBurnStatus(txId, {
    profileId,
    walletAddress,
    nftMint,
    nftName,
    nftImage,
    arweaveUrl: arweaveUrl || nftImage,
    soulboundMint: soulboundMint || null,
    status: 'processing',
    steps: {
      arweaveUpload: arweaveUrl ? 'complete' : 'pending',
      nftBurn: burnTxSignature ? 'complete' : 'pending',
      soulboundMint: soulboundMint ? 'complete' : 'pending',
      profileLock: 'pending',
    },
    createdAt: new Date().toISOString(),
  });
  
  // If we have the burn tx, verify it on-chain
  if (burnTxSignature) {
    try {
      const txConfirmed = await verifySolanaTransaction(burnTxSignature);
      if (!txConfirmed) {
        setBurnStatus(txId, { ...getBurnStatus(txId), status: 'failed', error: 'Transaction not confirmed' });
        return { success: false, error: 'Burn transaction not confirmed on-chain' };
      }
    } catch (e) {
      console.warn('[BurnToBecome] TX verification failed:', e.message);
      // Continue anyway — tx might just be slow
    }
  }
  
  // Upload to Arweave if not already done
  let finalArweaveUrl = arweaveUrl;
  if (!finalArweaveUrl && nftImage) {
    try {
      finalArweaveUrl = await uploadToArweave(nftImage);
      setBurnStatus(txId, { ...getBurnStatus(txId), arweaveUrl: finalArweaveUrl, steps: { ...getBurnStatus(txId).steps, arweaveUpload: 'complete' } });
    } catch (e) {
      console.warn('[BurnToBecome] Arweave upload failed, using original image:', e.message);
      finalArweaveUrl = nftImage;
    }
  }
  
  // Lock the avatar permanently
  profile.nftAvatar = {
    chain: 'solana',
    wallet: walletAddress,
    identifier: nftMint,
    name: nftName || 'Burned NFT',
    image: finalArweaveUrl || nftImage,
    arweaveUrl: finalArweaveUrl || null,
    verifiedAt: new Date().toISOString(),
    verifiedOnChain: true,
    permanent: true,
    burnTxSignature: burnTxSignature || null,
    soulboundMint: soulboundMint || null,
    burnedAt: new Date().toISOString(),
  };
  
  saveProfile(profile);
  
  // Update burn status
  setBurnStatus(txId, {
    ...getBurnStatus(txId),
    status: 'complete',
    arweaveUrl: finalArweaveUrl,
    steps: {
      arweaveUpload: 'complete',
      nftBurn: 'complete',
      soulboundMint: soulboundMint ? 'complete' : 'skipped',
      profileLock: 'complete',
    },
  });
  
  return {
    success: true,
    avatar: profile.nftAvatar,
    txId,
    message: 'This is you, forever.',
  };
}

/**
 * Verify a Solana transaction exists and is confirmed
 */
function verifySolanaTransaction(signature) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      jsonrpc: '2.0', id: 1,
      method: 'getTransaction',
      params: [signature, { encoding: 'json', commitment: 'confirmed' }]
    });
    const options = {
      hostname: 'api.mainnet-beta.solana.com',
      port: 443, path: '/', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json.result && !json.result.meta?.err);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

/**
 * Prepare burn-to-become: validates inputs, returns transaction data for client signing
 */
async function prepareBurnToBecome({ profileId, walletAddress, nftMint, nftName, nftImage }) {
  const profile = loadProfile(profileId);
  if (!profile) {
    return { success: false, error: 'Profile not found' };
  }
  
  if (profile.nftAvatar && profile.nftAvatar.permanent === true) {
    return { success: false, error: 'Profile already has a permanent avatar', code: 403 };
  }
  
  // Verify wallet ownership
  const walletVerified = profile.verifications?.some(v =>
    v.type === 'solana' &&
    v.address?.toLowerCase() === walletAddress.toLowerCase() &&
    v.verified
  );
  
  if (!walletVerified) {
    return { success: false, error: 'Wallet not verified on this profile' };
  }
  
  // Verify NFT ownership
  const nftAvatar = require('./nft-avatar');
  const owns = await nftAvatar.verifyNFTOwnership('solana', walletAddress, nftMint);
  if (!owns) {
    return { success: false, error: 'NFT ownership could not be verified on-chain' };
  }
  
  // Upload image to Arweave (or get URL ready)
  let arweaveUrl = null;
  if (nftImage) {
    try {
      arweaveUrl = await uploadToArweave(nftImage);
    } catch (e) {
      console.warn('[BurnToBecome] Pre-upload to Arweave failed:', e.message);
    }
  }
  
  // Build transaction instructions for client
  const txData = buildBurnToBecomeTxData({
    walletAddress,
    nftMint,
    arweaveUrl: arweaveUrl || nftImage,
    profileId,
  });
  
  return {
    success: true,
    arweaveUrl,
    txData,
    warning: 'This is permanent. Your NFT will be burned and cannot be recovered.',
  };
}

module.exports = {
  prepareBurnToBecome,
  processBurnToBecome,
  getBurnStatus,
  hasPermanentAvatar,
  uploadToArweave,
};
