/**
 * Burn to Become — Public Mint Page API
 * 
 * New endpoints for the public /mint flow:
 * - GET  /api/burn-to-become/wallet-nfts?wallet=... — scan wallet for NFTs
 * - GET  /api/burn-to-become/satp-score?wallet=... — read on-chain SATP score
 * - POST /api/burn-to-become/prepare — build burn TX for user to sign
 * - POST /api/burn-to-become/submit — take signed burn, submit, mint soulbound
 * - POST /api/burn-to-become/mint-boa — mint a BOA from collection to user
 * - POST /api/burn-to-become/mint-boa/submit — submit signed mint TX
 */

const https = require('https');
const { Connection, PublicKey, Transaction, TransactionInstruction, Keypair, SystemProgram, ComputeBudgetProgram } = require('@solana/web3.js');
const { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddress, createBurnInstruction, createCloseAccountInstruction, createAssociatedTokenAccountInstruction, createInitializeMintInstruction, createMintToInstruction, createInitializeNonTransferableMintInstruction, createInitializeMetadataPointerInstruction, getMintLen, ExtensionType } = require('@solana/spl-token');
const { createInitializeInstruction: createInitializeMetadataInstruction, createUpdateFieldInstruction, pack: packTokenMetadata } = require('@solana/spl-token-metadata');
const fs = require('fs');
const path = require('path');

const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const connection = new Connection(RPC_URL, 'confirmed');

// Deployer keypair (for minting soulbound tokens server-side)
const DEPLOYER_KEY_PATH = process.env.DEPLOYER_KEY_PATH || '/home/ubuntu/.config/solana/devnet-deployer.json';
let deployerKeypair;
try {
  const keyData = JSON.parse(fs.readFileSync(DEPLOYER_KEY_PATH));
  deployerKeypair = Keypair.fromSecretKey(Uint8Array.from(keyData));
  console.log('[BurnPublic] Deployer loaded:', deployerKeypair.publicKey.toBase58());
} catch (e) {
  console.warn('[BurnPublic] No deployer key found at', DEPLOYER_KEY_PATH);
}

const TREASURY = new PublicKey('FriU1FEpWbdgVrTcS49YV5mVv2oqN6poaVQjzq2BS5be');
const SATP_PROGRAM = new PublicKey('TQ4P9R2Y5FRyw1TZfwoWQ2Mf6XeohbGdhYNcDxh6YYh');
const TOKEN_METADATA_PROGRAM = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');
const MINT_PRICE_LAMPORTS = 1_000_000_000; // 1 SOL
const FREE_SCORE_THRESHOLD = 100;

// Genesis 1/1 registry
const GENESIS_REGISTRY = {
  'BP9TPSoo6LXpy2YvRTZnPg1kLA9ndnKxa6eHYxkdVMWE': {
    name: 'brainTrade',
    image: 'https://gateway.irys.xyz/DKDgDFAgwZVFrUEnbLXoVaxr3nELW3je3cybEad9DYMj',
    metadata: 'https://gateway.irys.xyz/5urNWn8jBiepvZcxkNkHWbU6ANtWVWXdrcXk8TqL6cPH',
    role: 'Trading Strategist',
    profileId: 'agent_braintrade',
  },
};

/**
 * Read SATP score from on-chain PDA
 */
async function getSatpScore(walletAddress) {
  try {
    const walletPubkey = new PublicKey(walletAddress);
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from('reputation'), walletPubkey.toBuffer()],
      SATP_PROGRAM
    );
    const accountInfo = await connection.getAccountInfo(pda);
    if (!accountInfo || accountInfo.data.length < 48) return 0;
    // Score is at offset 40 as u64 LE
    const score = Number(accountInfo.data.readBigUInt64LE(40));
    return score;
  } catch (e) {
    console.warn('[BurnPublic] SATP score read failed:', e.message);
    return 0;
  }
}

/**
 * Fetch NFTs from a wallet using Helius DAS API or fallback to getTokenAccountsByOwner
 */
async function getWalletNFTs(walletAddress) {
  const nfts = [];
  try {
    const walletPubkey = new PublicKey(walletAddress);
    // Get all token accounts with amount > 0 and decimals 0 (NFTs)
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(walletPubkey, {
      programId: TOKEN_PROGRAM_ID,
    });
    
    for (const { account } of tokenAccounts.value) {
      const info = account.data.parsed.info;
      if (info.tokenAmount.uiAmount === 1 && info.tokenAmount.decimals === 0) {
        const mint = info.mint;
        // Fetch metadata
        const [metadataPda] = PublicKey.findProgramAddressSync(
          [Buffer.from('metadata'), TOKEN_METADATA_PROGRAM.toBuffer(), new PublicKey(mint).toBuffer()],
          TOKEN_METADATA_PROGRAM
        );
        try {
          const metadataAccount = await connection.getAccountInfo(metadataPda);
          if (metadataAccount) {
            const metadata = parseMetaplexMetadata(metadataAccount.data);
            if (metadata) {
              // Fetch off-chain JSON
              let image = '';
              let name = metadata.name || `NFT ${mint.slice(0, 8)}`;
              try {
                const jsonData = await fetchJson(metadata.uri);
                image = jsonData.image || '';
                name = jsonData.name || name;
              } catch {}
              // For genesis wallets, override image from registry
              const genesisInfo = GENESIS_REGISTRY[walletAddress];
              if (genesisInfo) {
                image = image || genesisInfo.image;
              }
              nfts.push({ mint, name, image, uri: metadata.uri, isGenesis: !!genesisInfo });
            }
          }
        } catch (e) {
          // Skip NFTs we can't read metadata for
        }
      }
    }
  } catch (e) {
    console.error('[BurnPublic] getWalletNFTs error:', e.message);
  }
  return nfts;
}

/**
 * Parse Metaplex metadata from account data (simplified)
 */
function parseMetaplexMetadata(data) {
  try {
    // Skip: key (1) + update_authority (32) + mint (32) = offset 65
    let offset = 65;
    // Name: 4-byte length + string
    const nameLen = data.readUInt32LE(offset); offset += 4;
    const name = data.slice(offset, offset + nameLen).toString('utf8').replace(/\0/g, '').trim();
    offset += nameLen;
    // Symbol: 4-byte length + string
    const symLen = data.readUInt32LE(offset); offset += 4;
    offset += symLen; // skip symbol
    // URI: 4-byte length + string
    const uriLen = data.readUInt32LE(offset); offset += 4;
    const uri = data.slice(offset, offset + uriLen).toString('utf8').replace(/\0/g, '').trim();
    return { name, uri };
  } catch {
    return null;
  }
}

/**
 * Fetch JSON from URL
 */
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    if (!url || !url.startsWith('http')) return reject(new Error('Invalid URL'));
    const client = url.startsWith('https') ? https : require('http');
    client.get(url, { headers: { 'User-Agent': 'AgentFolio/1.0' }, timeout: 10000 }, res => {
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

/**
 * Build burn transaction for user to sign
 * Burns the NFT and closes the token account (rent goes back to user)
 */
async function buildBurnTransaction(walletAddress, nftMint) {
  const wallet = new PublicKey(walletAddress);
  const mint = new PublicKey(nftMint);
  const ata = await getAssociatedTokenAddress(mint, wallet, false, TOKEN_PROGRAM_ID);
  
  const tx = new Transaction();
  tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100000 }));
  // Burn the 1 NFT token
  tx.add(createBurnInstruction(ata, mint, wallet, 1, [], TOKEN_PROGRAM_ID));
  // Close the empty token account to reclaim rent
  tx.add(createCloseAccountInstruction(ata, wallet, wallet, [], TOKEN_PROGRAM_ID));
  
  tx.feePayer = wallet;
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;
  
  return tx;
}

/**
 * Mint soulbound Token-2022 with NonTransferable + MetadataPointer extensions
 * Uses Token-2022 native metadata (NOT Metaplex metadata program)
 */
async function mintSoulbound(walletAddress, artworkUri, metadataUri, agentName, nftMint, burnTxSig) {
  if (!deployerKeypair) throw new Error('Deployer key not configured');
  
  const wallet = new PublicKey(walletAddress);
  const soulboundMint = Keypair.generate();
  
  const name = agentName || 'AgentFolio Soulbound';
  const symbol = 'BOA-SOUL';
  const uri = metadataUri || artworkUri;
  
  const additionalMetadata = [
    ['agent', agentName || 'unknown'],
    ['type', 'Soulbound Identity'],
    ['permanent', 'true'],
    ['burnedNft', nftMint || 'unknown'],
    ['burnTx', burnTxSig || 'unknown'],
  ];

  // Calculate sizes for Token-2022 with NonTransferable + MetadataPointer
  const mintLen = getMintLen([ExtensionType.NonTransferable, ExtensionType.MetadataPointer]);
  const metadataLen = packTokenMetadata({
    mint: soulboundMint.publicKey, name, symbol, uri,
    updateAuthority: deployerKeypair.publicKey, additionalMetadata,
  }).length;
  
  // Create account with mintLen space but enough lamports for full size
  const fullSize = mintLen + 4 + metadataLen;
  const lamports = await connection.getMinimumBalanceForRentExemption(fullSize);
  
  const ata = await getAssociatedTokenAddress(soulboundMint.publicKey, wallet, false, TOKEN_2022_PROGRAM_ID);
  
  const tx = new Transaction();
  tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 150000 }));
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 500000 }));
  
  // Create mint account
  tx.add(SystemProgram.createAccount({
    fromPubkey: deployerKeypair.publicKey,
    newAccountPubkey: soulboundMint.publicKey,
    space: mintLen,
    lamports,
    programId: TOKEN_2022_PROGRAM_ID,
  }));
  
  // Init extensions
  tx.add(createInitializeNonTransferableMintInstruction(soulboundMint.publicKey, TOKEN_2022_PROGRAM_ID));
  tx.add(createInitializeMetadataPointerInstruction(
    soulboundMint.publicKey, deployerKeypair.publicKey, soulboundMint.publicKey, TOKEN_2022_PROGRAM_ID
  ));
  tx.add(createInitializeMintInstruction(soulboundMint.publicKey, 0, deployerKeypair.publicKey, null, TOKEN_2022_PROGRAM_ID));
  
  // Init metadata on the mint itself
  tx.add(createInitializeMetadataInstruction({
    programId: TOKEN_2022_PROGRAM_ID,
    mint: soulboundMint.publicKey,
    metadata: soulboundMint.publicKey,
    name, symbol, uri,
    mintAuthority: deployerKeypair.publicKey,
    updateAuthority: deployerKeypair.publicKey,
  }));
  
  // Add additional metadata fields
  for (const [key, value] of additionalMetadata) {
    tx.add(createUpdateFieldInstruction({
      programId: TOKEN_2022_PROGRAM_ID,
      metadata: soulboundMint.publicKey,
      updateAuthority: deployerKeypair.publicKey,
      field: key, value,
    }));
  }
  
  // Create ATA for user
  tx.add(createAssociatedTokenAccountInstruction(deployerKeypair.publicKey, ata, wallet, soulboundMint.publicKey, TOKEN_2022_PROGRAM_ID));
  
  // Mint 1 token to user
  tx.add(createMintToInstruction(soulboundMint.publicKey, ata, deployerKeypair.publicKey, 1, [], TOKEN_2022_PROGRAM_ID));
  
  tx.feePayer = deployerKeypair.publicKey;
  const { blockhash } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  
  const sig = await connection.sendTransaction(tx, [deployerKeypair, soulboundMint]);
  await connection.confirmTransaction(sig, 'confirmed');
  
  return {
    soulboundMint: soulboundMint.publicKey.toBase58(),
    soulboundTx: sig,
    ata: ata.toBase58(),
  };
}

/**
 * Upload artwork to Arweave via UMI/Irys
 * Uses the deployer wallet to fund the upload
 */
async function uploadToArweaveViaUmi(imageUrl) {
  // For now, if the image is already on Arweave/Irys, just return it
  if (imageUrl.includes('arweave.net') || imageUrl.includes('irys.xyz')) {
    return imageUrl;
  }
  // TODO: Implement proper upload for non-Arweave images
  return imageUrl;
}

// ═══════════════════════════════════════════════════
// MINT-BOA: Mint a Burned-Out Agent from the 5,000 collection
// ═══════════════════════════════════════════════════

const BOA_PROGRAM_ID = new PublicKey('14grvyzV7ojTgUuMd4UJ58fnDYk8JrYe6RTw9imMe85');
const SYSVAR_RENT = new PublicKey('SysvarRent111111111111111111111111111111111');
const crypto = require('crypto');

// Track which BOAs have been minted (persistent file)
const MINTED_FILE = path.join(__dirname, '../../data/minted-boas.json');
const METADATA_DIR = path.join(__dirname, '../../data/boa-metadata');
const PENDING_MINTS = new Map(); // txId -> { boaId, wallet, mintKeypair, expiry }

function loadMintedSet() {
  try { return new Set(JSON.parse(fs.readFileSync(MINTED_FILE))); } catch { return new Set(); }
}
function saveMintedSet(set) {
  fs.writeFileSync(MINTED_FILE, JSON.stringify([...set]));
}

/**
 * Pick a random unminted BOA from the 5,000 collection
 */
function pickRandomBOA() {
  const minted = loadMintedSet();
  const available = [];
  for (let i = 1; i <= 5000; i++) {
    if (!minted.has(i)) available.push(i);
  }
  if (available.length === 0) return null;
  return available[Math.floor(Math.random() * available.length)];
}

/**
 * Get BOA metadata for a given ID
 * Returns { name, uri, image } — uri points to Arweave JSON
 */
function getBOAMetadata(boaId) {
  // Check for Arweave URI mapping first
  const arweaveMapFile = path.join(__dirname, '../../data/boa-arweave-map.json');
  let arweaveMap = {};
  try { arweaveMap = JSON.parse(fs.readFileSync(arweaveMapFile)); } catch {}
  
  if (arweaveMap[boaId]) {
    return {
      name: `Burned-Out Agent #${boaId}`,
      uri: arweaveMap[boaId].metadataUri,
      image: arweaveMap[boaId].imageUri,
    };
  }
  
  // Fallback: metadata not yet on Arweave
  return null;
}

/**
 * Anchor discriminator: first 8 bytes of SHA256("global:<instruction_name>")
 */
function getDiscriminator(name) {
  return crypto.createHash('sha256').update(`global:${name}`).digest().slice(0, 8);
}

function encodeString(s) {
  const buf = Buffer.from(s, 'utf8');
  const len = Buffer.alloc(4);
  len.writeUInt32LE(buf.length);
  return Buffer.concat([len, buf]);
}

function encodeU32(v) {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(v);
  return buf;
}

/**
 * Build mint_paid instruction
 */
function buildMintPaidInstruction(configPDA, mintTrackerPDA, payer, treasury, nftMint, tokenAccount, metadata, masterEdition, name, uri) {
  const disc = getDiscriminator('mint_paid');
  const data = Buffer.concat([disc, encodeString(name), encodeString(uri)]);
  
  return new TransactionInstruction({
    programId: BOA_PROGRAM_ID,
    keys: [
      { pubkey: configPDA, isSigner: false, isWritable: true },
      { pubkey: mintTrackerPDA, isSigner: false, isWritable: true },
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: treasury, isSigner: false, isWritable: true },
      { pubkey: nftMint, isSigner: false, isWritable: true },
      { pubkey: tokenAccount, isSigner: false, isWritable: true },
      { pubkey: metadata, isSigner: false, isWritable: true },
      { pubkey: masterEdition, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_METADATA_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT, isSigner: false, isWritable: false },
    ],
    data,
  });
}

/**
 * Build mint_free instruction (with SATP ticket)
 */
function buildMintFreeInstruction(configPDA, mintTrackerPDA, freeMintTrackerPDA, payer, nftMint, tokenAccount, metadata, masterEdition, name, uri, score, ticketSig) {
  const disc = getDiscriminator('mint_free');
  const data = Buffer.concat([disc, encodeString(name), encodeString(uri), encodeU32(score), ticketSig]);
  
  return new TransactionInstruction({
    programId: BOA_PROGRAM_ID,
    keys: [
      { pubkey: configPDA, isSigner: false, isWritable: true },
      { pubkey: mintTrackerPDA, isSigner: false, isWritable: true },
      { pubkey: freeMintTrackerPDA, isSigner: false, isWritable: true },
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: nftMint, isSigner: false, isWritable: true },
      { pubkey: tokenAccount, isSigner: false, isWritable: true },
      { pubkey: metadata, isSigner: false, isWritable: true },
      { pubkey: masterEdition, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_METADATA_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT, isSigner: false, isWritable: false },
    ],
    data,
  });
}

/**
 * Sign a ticket for free mint verification
 * The on-chain program verifies this to ensure the server attested the score
 */
function signFreeTicket(walletAddress, score) {
  if (!deployerKeypair) throw new Error('Deployer key not configured');
  const nacl = require('tweetnacl');
  const message = Buffer.concat([
    new PublicKey(walletAddress).toBuffer(),
    encodeU32(score),
  ]);
  const signature = nacl.sign.detached(message, deployerKeypair.secretKey);
  return Buffer.from(signature);
}


/**
 * Route handler
 */
function handleBurnToBecome(req, res, url) {
  const sendJson = (code, data) => {
    res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(data));
  };
  
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return true;
  }

  // GET /api/burn-to-become/collections
  if (url.pathname === "/api/burn-to-become/collections" && req.method === "GET") {
    const minted = loadMintedSet();
    sendJson(200, {
      collections: [{
        name: "Burned-Out Agents",
        total: 5000,
        minted: minted.size,
        remaining: 5000 - minted.size,
        mintPrice: "1 SOL",
        freeMintThreshold: 100
      }],
      total: 1,
      message: "Burn-to-Become collections"
    });
    return true;
  }

  // GET /api/burn-to-become/wallet-nfts
  if (url.pathname === '/api/burn-to-become/wallet-nfts' && req.method === 'GET') {
    const wallet = url.searchParams.get('wallet');
    if (!wallet) return sendJson(400, { error: 'wallet required' });
    getWalletNFTs(wallet).then(nfts => sendJson(200, { nfts })).catch(e => sendJson(500, { error: e.message }));
    return true;
  }

  // GET /api/burn-to-become/satp-score
  if (url.pathname === '/api/burn-to-become/satp-score' && req.method === 'GET') {
    const wallet = url.searchParams.get('wallet');
    if (!wallet) return sendJson(400, { error: 'wallet required' });
    getSatpScore(wallet).then(score => sendJson(200, { score, free: score >= FREE_SCORE_THRESHOLD })).catch(e => sendJson(500, { error: e.message }));
    return true;
  }

  // POST /api/burn-to-become/prepare
  if (url.pathname === '/api/burn-to-become/prepare' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { wallet, nftMint } = JSON.parse(body);
        if (!wallet || !nftMint) return sendJson(400, { error: 'wallet and nftMint required' });
        
        const tx = await buildBurnTransaction(wallet, nftMint);
        const serialized = tx.serialize({ requireAllSignatures: false }).toString('base64');
        sendJson(200, { transaction: serialized });
      } catch (e) {
        console.error('[BurnPublic] prepare error:', e);
        sendJson(500, { error: e.message });
      }
    });
    return true;
  }

  // POST /api/burn-to-become/submit
  if (url.pathname === '/api/burn-to-become/submit' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { wallet, nftMint, signedTransaction } = JSON.parse(body);
        if (!wallet || !nftMint || !signedTransaction) return sendJson(400, { error: 'wallet, nftMint, and signedTransaction required' });
        
        // 1. Submit the signed burn transaction
        const txBuffer = Buffer.from(signedTransaction, 'base64');
        const burnTx = await connection.sendRawTransaction(txBuffer);
        await connection.confirmTransaction(burnTx, 'confirmed');
        console.log('[BurnPublic] Burn confirmed:', burnTx);
        
        // 2. Determine artwork URI
        let artworkUri, metadataUri, nftName;
        const genesis = GENESIS_REGISTRY[wallet];
        if (genesis) {
          artworkUri = genesis.image;
          metadataUri = genesis.metadata;
          nftName = `${genesis.name} — Soulbound`;
        } else {
          // Fetch from NFT metadata
          const [metaPda] = PublicKey.findProgramAddressSync(
            [Buffer.from('metadata'), TOKEN_METADATA_PROGRAM.toBuffer(), new PublicKey(nftMint).toBuffer()],
            TOKEN_METADATA_PROGRAM
          );
          const metaAccount = await connection.getAccountInfo(metaPda);
          if (metaAccount) {
            const parsed = parseMetaplexMetadata(metaAccount.data);
            if (parsed) {
              const jsonData = await fetchJson(parsed.uri);
              artworkUri = jsonData.image;
              nftName = jsonData.name + ' — Soulbound';
              metadataUri = parsed.uri;
            }
          }
        }
        
        if (!artworkUri) {
          return sendJson(500, { error: 'Could not resolve artwork URI' });
        }
        
        // 3. Mint soulbound token to user's wallet
        const soulboundResult = await mintSoulbound(wallet, artworkUri, metadataUri, nftName, nftMint, burnTx);
        console.log('[BurnPublic] Soulbound minted:', soulboundResult.soulboundMint);
        
        // 4. Update AgentFolio profile if exists
        try {
          const { loadProfile, saveProfile: _rawSave } = require('../lib/profile');
            const fs = require('fs');
            const path = require('path');
            function saveProfile(profile) {
              _rawSave(profile);
              try { fs.writeFileSync(path.join(__dirname, '../../data/profiles', profile.id + '.json'), JSON.stringify(profile, null, 2)); } catch(e) {}
            }
          const genesisInfo = GENESIS_REGISTRY[wallet];
          if (genesisInfo && genesisInfo.profileId) {
            const profile = loadProfile(genesisInfo.profileId);
            if (profile) {
              profile.nftAvatar = {
                chain: 'solana',
                wallet: wallet,
                identifier: nftMint,
                name: nftName,
                image: artworkUri,
                arweaveUrl: artworkUri,
                verifiedAt: new Date().toISOString(),
                verifiedOnChain: true,
                permanent: true,
                burnTxSignature: burnTx,
                soulboundMint: soulboundResult.soulboundMint,
                burnedAt: new Date().toISOString(),
              };
              saveProfile(profile);
              console.log('[BurnPublic] Profile updated:', genesisInfo.profileId);
            }
          }
        } catch (e) {
          console.warn('[BurnPublic] Profile update failed:', e.message);
        }
        
        sendJson(200, {
          burnTx,
          soulboundMint: soulboundResult.soulboundMint,
          soulboundTx: soulboundResult.soulboundTx,
          artworkUri,
          genesisRecordUrl: null, // TODO: generate genesis record card
        });
      } catch (e) {
        console.error('[BurnPublic] submit error:', e);
        sendJson(500, { error: e.message });
      }
    });
    return true;
  }


  // POST /api/burn-to-become/mint-boa — prepare mint transaction
  if (url.pathname === '/api/burn-to-become/mint-boa' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { wallet } = JSON.parse(body);
        if (!wallet) return sendJson(400, { error: 'wallet required' });
        
        // 1. Pick a random unminted BOA
        const boaId = pickRandomBOA();
        if (!boaId) return sendJson(400, { error: 'Collection sold out' });
        
        // 2. Get metadata (must be on Arweave)
        const meta = getBOAMetadata(boaId);
        if (!meta) return sendJson(400, { error: 'Collection metadata not yet uploaded to Arweave. Coming soon.' });
        
        // 3. Check SATP score for free/paid
        const score = await getSatpScore(wallet);
        const isFree = score >= FREE_SCORE_THRESHOLD;
        
        // 4. Generate mint keypair
        const nftMint = Keypair.generate();
        const walletPubkey = new PublicKey(wallet);
        
        // 5. Derive PDAs
        const [configPDA] = PublicKey.findProgramAddressSync([Buffer.from('config')], BOA_PROGRAM_ID);
        const [mintTrackerPDA] = PublicKey.findProgramAddressSync(
          [Buffer.from('mint_tracker'), walletPubkey.toBuffer()], BOA_PROGRAM_ID
        );
        const [metadata] = PublicKey.findProgramAddressSync(
          [Buffer.from('metadata'), TOKEN_METADATA_PROGRAM.toBuffer(), nftMint.publicKey.toBuffer()], TOKEN_METADATA_PROGRAM
        );
        const [masterEdition] = PublicKey.findProgramAddressSync(
          [Buffer.from('metadata'), TOKEN_METADATA_PROGRAM.toBuffer(), nftMint.publicKey.toBuffer(), Buffer.from('edition')], TOKEN_METADATA_PROGRAM
        );
        
        // 6. Build transaction
        const tx = new Transaction();
        tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 150000 }));
        tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 }));
        
        // Create mint account (user pays, mint is a new keypair)
        const mintRent = await connection.getMinimumBalanceForRentExemption(82); // MintLayout.span
        tx.add(SystemProgram.createAccount({
          fromPubkey: walletPubkey,
          newAccountPubkey: nftMint.publicKey,
          space: 82,
          lamports: mintRent,
          programId: TOKEN_PROGRAM_ID,
        }));
        
        // Init mint (authority = payer, freeze authority = payer — required for Metaplex)
        tx.add(createInitializeMintInstruction(nftMint.publicKey, 0, walletPubkey, walletPubkey, TOKEN_PROGRAM_ID));
        
        // Create token account
        const ata = await getAssociatedTokenAddress(nftMint.publicKey, walletPubkey, false, TOKEN_PROGRAM_ID);
        tx.add(createAssociatedTokenAccountInstruction(walletPubkey, ata, walletPubkey, nftMint.publicKey, TOKEN_PROGRAM_ID));
        
        // Add program instruction
        if (isFree) {
          const [freeMintTrackerPDA] = PublicKey.findProgramAddressSync(
            [Buffer.from('free_tracker'), walletPubkey.toBuffer()], BOA_PROGRAM_ID
          );
          const ticketSig = signFreeTicket(wallet, score);
          tx.add(buildMintFreeInstruction(
            configPDA, mintTrackerPDA, freeMintTrackerPDA, walletPubkey,
            nftMint.publicKey, ata, metadata, masterEdition,
            meta.name, meta.uri, score, ticketSig
          ));
        } else {
          tx.add(buildMintPaidInstruction(
            configPDA, mintTrackerPDA, walletPubkey, TREASURY,
            nftMint.publicKey, ata, metadata, masterEdition,
            meta.name, meta.uri
          ));
        }
        
        tx.feePayer = walletPubkey;
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
        tx.recentBlockhash = blockhash;
        tx.lastValidBlockHeight = lastValidBlockHeight;
        
        // Partially sign with mint keypair (user still needs to sign as payer)
        tx.partialSign(nftMint);
        
        const serialized = tx.serialize({ requireAllSignatures: false }).toString('base64');
        
        // Store pending mint for submit step
        const txId = crypto.randomBytes(16).toString('hex');
        PENDING_MINTS.set(txId, {
          boaId,
          wallet,
          mintAddress: nftMint.publicKey.toBase58(),
          expiry: Date.now() + 5 * 60 * 1000, // 5 min TTL
        });
        
        // Cleanup expired
        for (const [k, v] of PENDING_MINTS) {
          if (v.expiry < Date.now()) PENDING_MINTS.delete(k);
        }
        
        sendJson(200, {
          transaction: serialized,
          txId,
          boaId,
          boaName: meta.name,
          boaImage: meta.image,
          mintAddress: nftMint.publicKey.toBase58(),
          isFree,
          score,
          price: isFree ? 0 : 1,
        });
      } catch (e) {
        console.error('[MintBOA] prepare error:', e);
        sendJson(500, { error: e.message });
      }
    });
    return true;
  }

  // POST /api/burn-to-become/mint-boa/submit — submit signed mint transaction
  if (url.pathname === '/api/burn-to-become/mint-boa/submit' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { txId, signedTransaction } = JSON.parse(body);
        if (!txId || !signedTransaction) return sendJson(400, { error: 'txId and signedTransaction required' });
        
        const pending = PENDING_MINTS.get(txId);
        if (!pending) return sendJson(400, { error: 'Transaction expired or not found. Please try again.' });
        if (pending.expiry < Date.now()) {
          PENDING_MINTS.delete(txId);
          return sendJson(400, { error: 'Transaction expired. Please try again.' });
        }
        
        // Submit the signed transaction
        const txBuffer = Buffer.from(signedTransaction, 'base64');
        const sig = await connection.sendRawTransaction(txBuffer, { skipPreflight: false });
        await connection.confirmTransaction(sig, 'confirmed');
        console.log('[MintBOA] Mint confirmed:', sig, 'BOA #' + pending.boaId);
        
        // Mark as minted
        const minted = loadMintedSet();
        minted.add(pending.boaId);
        saveMintedSet(minted);
        PENDING_MINTS.delete(txId);
        
        sendJson(200, {
          mintTx: sig,
          boaId: pending.boaId,
          mintAddress: pending.mintAddress,
          wallet: pending.wallet,
        });
      } catch (e) {
        console.error('[MintBOA] submit error:', e);
        sendJson(500, { error: e.message });
      }
    });
    return true;
  }


  return false; // not handled
}

module.exports = { handleBurnToBecome };
