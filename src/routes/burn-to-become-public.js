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
const PIPELINE_DIR = "/home/ubuntu/agentfolio/boa-pipeline";
const { safeBurnToBecome } = require('./safe-burn-to-become');

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
// On-chain SATP attestation check (boa_soulbound)
const SATP_ATTESTATIONS_PROGRAM = new PublicKey('ENvaD19QzwWWMJFu5r5xJ9SmHqWN6GvyzxACRejqbdug');
const SATP_IDENTITY_PROGRAM = new PublicKey('97yL33fcu6iWT2TdERS5HeqrMSGiUnxuy6nUcTrKieSq');

function getSatpIdentityPDA(walletPubkey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('identity'), new PublicKey(walletPubkey).toBuffer()],
    SATP_IDENTITY_PROGRAM
  );
}

function getBoaSoulboundPDA(walletPubkey, issuerPubkey) {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from('attestation'),
      new PublicKey(walletPubkey).toBuffer(),
      new PublicKey(issuerPubkey).toBuffer(),
      Buffer.from('boa_soulbound'),
    ],
    SATP_ATTESTATIONS_PROGRAM
  );
}

const DEPLOYER_PUBKEY = 'Bq1niVKyTECn4HDxAJWiHZvRMCZndZtC113yj3Rkbroc';
const HELIUS_RPC = 'https://mainnet.helius-rpc.com/?api-key=HELIUS_API_KEY_REDACTED';

async function checkSatpOnChain(wallet) {
  const { Connection } = require('@solana/web3.js');
  const conn = new Connection(HELIUS_RPC, 'confirmed');
  const [identityPda] = getSatpIdentityPDA(wallet);
  const identityAcct = await conn.getAccountInfo(identityPda);
  const hasIdentity = !!(identityAcct && identityAcct.data.length > 0);
  
  let hasBoaSoulbound = false;
  if (hasIdentity) {
    const [attPda] = getBoaSoulboundPDA(wallet, DEPLOYER_PUBKEY);
    const attAcct = await conn.getAccountInfo(attPda);
    hasBoaSoulbound = !!(attAcct && attAcct.data.length > 0);
  }
  
  return { hasIdentity, hasBoaSoulbound, identityPda: identityPda.toBase58() };
}
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
    // Use Helius DAS API — returns ALL asset types (Core, Token, Token-2022) with images pre-resolved
    const dasResponse = await new Promise((resolve, reject) => {
      const postData = JSON.stringify({
        jsonrpc: '2.0', id: 'wallet-nfts', method: 'getAssetsByOwner',
        params: { ownerAddress: walletAddress, page: 1, limit: 100,
          displayOptions: { showFungible: false, showNativeBalance: false } },
      });
      const req = https.request(HELIUS_RPC, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) },
        timeout: 15000,
      }, (res) => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
      });
      req.on('error', reject);
      req.write(postData);
      req.end();
    });

    const items = dasResponse?.result?.items || [];
    const genesisInfo = GENESIS_REGISTRY[walletAddress];

    for (const item of items) {
      // Skip fungible tokens and compressed NFTs without images
      const iface = item.interface || '';
      if (iface === 'FungibleToken' || iface === 'FungibleAsset') continue;

      const mint = item.id;
      const name = item.content?.metadata?.name || `NFT ${mint.slice(0, 8)}`;
      let image = '';

      // DAS returns images in content.links or content.files
      if (item.content?.links?.image) {
        image = item.content.links.image;
      } else if (item.content?.files?.[0]?.uri) {
        image = item.content.files[0].uri;
      }

      // Genesis override
      if (genesisInfo) {
        image = image || genesisInfo.image;
      }

      const uri = item.content?.json_uri || '';
      const isGenesis = !!genesisInfo;
      const isToken2022 = item.token_standard === 'NonFungible' && item.interface === 'ProgrammableNFT';
      const isCoreAsset = iface === 'V1_NFT' || iface === 'MplCoreAsset' || item.compression?.compressed === false;

      // Filter: only include non-fungibles with supply 1 (or Core assets)
      // DAS already filters by owner, so most items here are valid NFTs
      nfts.push({ mint, name, image, uri, isGenesis, isToken2022: false, isCoreAsset: iface === 'MplCoreAsset' });
    }

    console.log('[BurnPublic] DAS returned', items.length, 'assets,', nfts.length, 'NFTs for', walletAddress);
  } catch (e) {
    console.error('[BurnPublic] getWalletNFTs DAS error:', e.message, '- falling back to RPC scan');
    // Fallback: basic RPC scan for standard SPL NFTs
    try {
      const walletPubkey = new PublicKey(walletAddress);
      for (const programId of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
        const tokenAccounts = await connection.getParsedTokenAccountsByOwner(walletPubkey, { programId });
        for (const { account } of tokenAccounts.value) {
          const info = account.data.parsed.info;
          if (info.tokenAmount.uiAmount === 1 && info.tokenAmount.decimals === 0) {
            nfts.push({ mint: info.mint, name: `NFT ${info.mint.slice(0, 8)}`, image: '', uri: '', isGenesis: false });
          }
        }
      }
    } catch (fallbackErr) {
      console.error('[BurnPublic] Fallback RPC scan also failed:', fallbackErr.message);
    }
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
const USED_PAYMENTS_FILE = path.join(__dirname, '../../data/used-payment-txs.json');
function loadUsedPayments() { try { return new Set(JSON.parse(fs.readFileSync(USED_PAYMENTS_FILE))); } catch { return new Set(); } }
function saveUsedPayment(tx) { const used = loadUsedPayments(); used.add(tx); fs.writeFileSync(USED_PAYMENTS_FILE, JSON.stringify([...used])); }
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
  const SOFT_CAP = 100;
  for (let i = 1; i <= SOFT_CAP; i++) {
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

  // Parse JSON body for POST requests (raw HTTP server — no middleware)
  if (req.method === 'POST' && !req.body) {
    let bodyStr = '';
    req.on('data', chunk => bodyStr += chunk);
    req.on('end', () => {
      try { req.body = JSON.parse(bodyStr); } catch { req.body = {}; }
      handleBurnToBecome(req, res, url);
    });
    return true; // signal handled (async)
  }

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
        total: 100,
        minted: minted.size,
        remaining: Math.max(0, 100 - minted.size),
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

  // GET /api/burn-to-become/eligibility?wallet=... — check BOA mint eligibility (Level + Rep)
  if (url.pathname === '/api/burn-to-become/eligibility' && req.method === 'GET') {
    const wallet = url.searchParams.get('wallet');
    if (!wallet) return sendJson(400, { error: 'wallet required' });
    (async () => {
      try {
        const Database = require('better-sqlite3');
        const db = new Database(path.join(__dirname, '../../data/agentfolio.db'), { readonly: true });
        const { getCompleteScore } = require('../lib/scoring-engine-v2'); const fs = require('fs');
        const LEVEL_NAMES = ['Unregistered', 'Registered', 'Verified', 'On-Chain', 'Trusted', 'Sovereign'];
        const LEVEL_BADGES = ['⚪', '🟡', '🔵', '🟢', '🟠', '👑'];
        const profiles = db.prepare('SELECT * FROM profiles').all();
        let matchedProfile = db.prepare("SELECT * FROM profiles WHERE wallet = ?").get(wallet) || null;
        if (!matchedProfile) for (const p of profiles) {
          try { const vd = JSON.parse(p.verification_data || '{}'); if (vd.solana?.address === wallet) { matchedProfile = p; break; } } catch {}
        }
        if (!matchedProfile) {
          const score = await getSatpScore(wallet);
          db.close();
          return sendJson(200, { found: false, level: 0, levelName: 'Unregistered', badge: '⚪', reputation: score, eligible: false, message: 'No AgentFolio profile linked to this wallet. Register at agentfolio.bot first.' });
        }
        const profileObj = {
          id: matchedProfile.id, name: matchedProfile.name, handle: matchedProfile.handle,
          bio: matchedProfile.bio, avatar: matchedProfile.avatar,
          skills: JSON.parse(matchedProfile.skills || '[]'),
          verification: JSON.parse(matchedProfile.verification || '{}'),
          endorsements: JSON.parse(matchedProfile.endorsements || '[]'),
          portfolio: JSON.parse(matchedProfile.portfolio || '[]'),
          track_record: JSON.parse(matchedProfile.track_record || '{}'),
        };
        try {
          const pPath = require('path').join(__dirname, '../../data/profiles', matchedProfile.id + '.json');
          if (fs.existsSync(pPath)) {
            const pf = JSON.parse(fs.readFileSync(pPath, 'utf8'));
            profileObj.verificationData = pf.verificationData || {};
            profileObj.stats = pf.stats || {};
            profileObj.endorsements = pf.endorsements || profileObj.endorsements || [];
            profileObj.moltbookStats = pf.moltbookStats || {};
          }
        } catch (e) {}
        // Use best-of V3 on-chain + V2 computed scores (fixes stale Genesis Record bug)
        let v3Lev = 0, v3Rp = 0, v2Lev = 0, v2Rp = 0;
        try {
          const { getV3Score } = require('../v3-score-service');
          const v3 = await getV3Score(matchedProfile.id);
          if (v3) {
            v3Lev = v3.verificationLevel || 0;
            v3Rp = v3.reputationScore || 0;
          }
        } catch {}
        try {
          const scoreResult = getCompleteScore(profileObj);
          v2Lev = scoreResult.verificationLevel ? scoreResult.verificationLevel.level : 0;
          v2Rp = scoreResult.reputationScore ? scoreResult.reputationScore.score : 0;
        } catch {}
        const level = Math.max(v3Lev, v2Lev);
        const reputation = Math.max(v3Rp, v2Rp);
        console.log('[ELIGIBILITY] Score for', matchedProfile.id, 'V3:', v3Lev+'/'+v3Rp, 'V2:', v2Lev+'/'+v2Rp, 'Final:', level+'/'+reputation);
        const eligible = level >= 3 && reputation >= 50;
        db.close();
        // Check isBorn from Genesis Record — free first mint only if not already born
        let isBorn = false;
        try {
          const { getV3Score } = require('../v3-score-service');
          const v3Data = await getV3Score(matchedProfile.id);
          if (v3Data && v3Data.isBorn) isBorn = true;
        } catch {}
        sendJson(200, { found: true, agent: matchedProfile.id, name: matchedProfile.name, level, levelName: LEVEL_NAMES[level] || 'Unknown', badge: LEVEL_BADGES[level] || '⚪', reputation, eligible, freeFirstMint: eligible && !isBorn, isBorn });
      } catch (e) { console.error('[BurnPublic] eligibility error:', e); sendJson(500, { error: e.message }); }
    })();
    return true;
  }

  // POST /api/burn-to-become/prepare
  if (url.pathname === '/api/burn-to-become/prepare' && req.method === 'POST') {
    (async () => {
      try {
        const { wallet, nftMint } = req.body || {};
        if (!wallet || !nftMint) return sendJson(400, { error: 'wallet and nftMint required' });
        
        const tx = await buildBurnTransaction(wallet, nftMint);
        const serialized = tx.serialize({ requireAllSignatures: false }).toString('base64');
        sendJson(200, { transaction: serialized });
      } catch (e) {
        console.error('[BurnPublic] prepare error:', e);
        sendJson(500, { error: e.message });
      }
    })();
    return true;
  }

  // POST /api/burn-to-become/submit
  if (url.pathname === '/api/burn-to-become/submit' && req.method === 'POST') {
    (async () => {
      try {
        const { wallet, nftMint, signedTransaction } = req.body || {};
        if (!wallet || !nftMint || !signedTransaction) return sendJson(400, { error: 'wallet, nftMint, and signedTransaction required' });
        
        // ON-CHAIN SATP SECURITY: Identity + boa_soulbound attestation check
        const burnSatpCheck = await checkSatpOnChain(wallet);
        if (!burnSatpCheck.hasIdentity) {
          console.log('[BurnPublic] BLOCKED: No SATP identity for', wallet);
          return sendJson(403, { error: 'SATP identity required to burn. Verify your wallet at agentfolio.bot/verify first.' });
        }
        if (burnSatpCheck.hasBoaSoulbound) {
          console.log('[BurnPublic] BLOCKED by on-chain attestation:', wallet);
          return sendJson(409, { error: 'This wallet already has a permanent face (boa_soulbound attestation on-chain). Each agent gets one.' });
        }

        // SECURITY: Block burn if agent already has a permanent face (DB fallback)
        try {
          const Database = require('better-sqlite3');
          const path = require('path');
          const checkDb = new Database(path.join(__dirname, '../../data/agentfolio.db'), { readonly: true });
          // Check by wallet (genesis registry) or by any profile with this wallet
          // Look up profile by wallet in DB (covers genesis + regular agents)
          let profileId = null;
          const byWallet = checkDb.prepare("SELECT id FROM profiles WHERE wallets LIKE ?").get('%' + wallet + '%');
          if (byWallet) profileId = byWallet.id;
          // Also check nft_avatar column for any profile with this wallet
          if (!profileId) {
            const byNftWallet = checkDb.prepare("SELECT id FROM profiles WHERE nft_avatar LIKE ?").get('%' + wallet + '%');
            if (byNftWallet) profileId = byNftWallet.id;
          }
          if (profileId) {
            const existing = checkDb.prepare('SELECT nft_avatar FROM profiles WHERE id = ?').get(profileId);
            if (existing && existing.nft_avatar) {
              const nftData = JSON.parse(existing.nft_avatar);
              if (nftData.permanent === true) {
                checkDb.close();
                console.log('[BurnPublic] BLOCKED: Agent', profileId, 'already has permanent face');
                return sendJson(403, { 
                  error: 'This agent already has a permanent soulbound face. Burn to Become is a one-time, irreversible process.',
                  existingSoulbound: nftData.soulboundMint,
                  existingImage: nftData.image,
                });
              }
            }
          }
          checkDb.close();
        } catch (checkErr) {
          console.warn('[BurnPublic] DB permanent face check failed (non-blocking — on-chain SATP is authority):', checkErr.message);
        }
        
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

        // 3.5. Link soulbound BOA to SATP identity (Task 2)
        let boaSatpLinkTx = null;
        try {
          const { linkBoaToSatpIdentity } = require("../lib/satp-boa-linker");
          const linkResult = await linkBoaToSatpIdentity(wallet, soulboundResult.soulboundMint, burnTx, artworkUri);
          boaSatpLinkTx = linkResult.attestationTx;
          if (boaSatpLinkTx) {
            console.log("[BurnPublic] BOA linked to SATP identity:", boaSatpLinkTx);
          } else {
            console.log("[BurnPublic] BOA→SATP link skipped:", linkResult.reason || "no deployer key");
          }
        
        // V3: Mark agent as "Born" on-chain via burnToBecome (uses safe wrapper)
        try {
          const profileStore = require("../profile-store");
          const profile = profileStore.getProfileByWallet ? profileStore.getProfileByWallet(wallet) : null;
          const agentId = profile?.id || wallet;
          const burnResult = await safeBurnToBecome(agentId, artworkUri || "", soulboundResult.soulboundMint || "", burnTx || "");
          if (burnResult.success) {
            console.log("[SATP V3] burnToBecome completed for " + agentId + ": tx=" + burnResult.txSignature);
          } else if (burnResult.needsClientSign) {
            console.log("[SATP V3] burnToBecome needs client-side signing for " + agentId + " (authority: " + burnResult.authority + ")");
          } else {
            console.log("[SATP V3] burnToBecome skipped for " + agentId + ": " + burnResult.reason);
          }
        } catch (v3Err) {
          console.warn("[SATP V3] burnToBecome failed (non-blocking):", v3Err.message);
        }

} catch (linkErr) {
          console.warn("[BurnPublic] BOA→SATP link failed (non-blocking):", linkErr.message);
        }
        
                // 3.6. V3 Genesis Record — burnToBecome (on-chain birth) — uses safe wrapper
        try {
          const profileStore = require('../profile-store');
          const db = profileStore.getDb ? profileStore.getDb() : null;
          let agentId = null;
          if (db) {
            const row = db.prepare("SELECT id FROM profiles WHERE wallets LIKE ? OR verification_data LIKE ?").get(`%${wallet}%`, `%${wallet}%`);
            if (row) agentId = row.id;
          }
          
          if (agentId) {
            const burnResult = await safeBurnToBecome(agentId, artworkUri || '', soulboundResult.soulboundMint || '', burnTx || '');
            if (burnResult.success) {
              console.log('[BurnPublic] V3 burnToBecome confirmed for ' + agentId + ': tx=' + burnResult.txSignature);
            } else if (burnResult.needsClientSign) {
              console.log('[BurnPublic] V3 burnToBecome needs client sign for ' + agentId + ' (authority: ' + burnResult.authority + ')');
            } else {
              console.log('[BurnPublic] V3 burnToBecome skipped for ' + agentId + ': ' + burnResult.reason);
            }
          } else {
            console.log('[BurnPublic] V3 burnToBecome skipped: no profile found for wallet', wallet);
          }
        } catch (v3Err) {
          console.warn('[BurnPublic] V3 burnToBecome failed (non-blocking):', v3Err.message);
        }

        // 4. Update AgentFolio profile if exists
        try {
          const { loadProfile, saveProfile: _rawSave }
 = require('../lib/profile');
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
              
              // Direct DB update for nft_avatar column (saveProfile doesn't handle this)
              try {
                const Database = require('better-sqlite3');
                const dbPath = require('path').join(__dirname, '../../data/agentfolio.db');
                const directDb = new Database(dbPath);
                directDb.prepare('UPDATE profiles SET nft_avatar = ?, avatar = ?, updated_at = ? WHERE id = ?').run(
                  JSON.stringify(profile.nftAvatar),
                  profile.nftAvatar.image || profile.nftAvatar.arweaveUrl,
                  new Date().toISOString(),
                  genesisInfo.profileId
                );
                directDb.close();
                console.log('[BurnPublic] nft_avatar saved to DB for', genesisInfo.profileId);
              } catch (dbErr) {
                console.error('[BurnPublic] DB nft_avatar update failed:', dbErr.message);
              }
              
              console.log('[BurnPublic] Profile updated:', genesisInfo.profileId);
            }
          } else {
            // Non-genesis: look up profile by wallet address
            try {
              const Database = require('better-sqlite3');
              const path = require('path');
              const lookupDb = new Database(path.join(__dirname, '../../data/agentfolio.db'));
              const match = lookupDb.prepare("SELECT id FROM profiles WHERE wallets LIKE ?").get('%' + wallet + '%');
              if (match) {
                const profile = loadProfile(match.id);
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
                  profile.avatar = artworkUri;
                  saveProfile(profile);
                  lookupDb.prepare('UPDATE profiles SET nft_avatar = ?, avatar = ?, updated_at = ? WHERE id = ?').run(
                    JSON.stringify(profile.nftAvatar), artworkUri, new Date().toISOString(), match.id
                  );
                  console.log('[BurnPublic] Profile updated by wallet lookup:', match.id);
                }
              }
              lookupDb.close();
            } catch (walletErr) {
              console.warn('[BurnPublic] Wallet-based profile lookup failed:', walletErr.message);
            }
          }
        } catch (e) {
          console.warn('[BurnPublic] Profile update failed:', e.message);
        }

        // Register permanent face on-chain via SATP Memo attestation
        let attestationTx = null;
        try {
          const { registerFaceOnChain } = require('../lib/satp-face-registry');
          const faceResult = await registerFaceOnChain({
            agentId: genesisInfo ? genesisInfo.profileId : wallet,
            agentName: genesisInfo ? genesisInfo.name : 'Unknown',
            agentWallet: wallet,
            soulboundMint: soulboundResult.soulboundMint,
            arweaveImage: artworkUri,
            burnTx: burnTx || null,
            originalMint: null,
          });
          attestationTx = faceResult.signature;
          console.log('[BurnPublic] SATP Face attestation TX:', attestationTx);

          // Update nft_avatar in DB with attestation TX
          try {
            const Database = require('better-sqlite3');
            const path = require('path');
            const directDb = new Database(path.join(__dirname, '../../data/agentfolio.db'));
            const existing = directDb.prepare('SELECT nft_avatar FROM profiles WHERE id = ?').get(
              genesisInfo ? genesisInfo.profileId : null
            );
            if (existing && existing.nft_avatar) {
              const nftData = JSON.parse(existing.nft_avatar);
              nftData.attestationTx = attestationTx;
              directDb.prepare('UPDATE profiles SET nft_avatar = ? WHERE id = ?').run(
                JSON.stringify(nftData),
                genesisInfo.profileId
              );
            }
            directDb.close();
            console.log('[BurnPublic] Attestation TX saved to nft_avatar');
          } catch (dbErr) {
            console.error('[BurnPublic] Could not save attestation TX to DB:', dbErr.message);
          }
        } catch (faceErr) {
          console.warn('[BurnPublic] SATP Face registration failed (non-blocking):', faceErr.message);
        }
        
        sendJson(200, {
          burnTx,
          soulboundMint: soulboundResult.soulboundMint,
          soulboundTx: soulboundResult.soulboundTx,
          artworkUri,
          attestationTx,
          genesisRecordUrl: null,
          boaSatpLinkTx,
        });
      } catch (e) {
        console.error('[BurnPublic] submit error:', e);
        sendJson(500, { error: e.message });
      }
    })();
    return true;
  }


  // POST /api/burn-to-become/prepare-mint — build unsigned TX for client-side signing
  if (url.pathname === "/api/burn-to-become/prepare-mint" && req.method === "POST") {
    const wallet = req.body && req.body.wallet;
    const flow = req.body && req.body.flow;
    if (!wallet) return sendJson(400, { error: "wallet required" });
    if (!flow || !["free", "paid"].includes(flow)) return sendJson(400, { error: "flow must be 'free' or 'paid'" });

    (async () => {
      try {
        const { PublicKey } = require("@solana/web3.js");
        try { new PublicKey(wallet); } catch { return sendJson(400, { error: "Invalid wallet" }); }

        // Free flow: check eligibility
        if (flow === "free") {
          const Database = require("better-sqlite3");
          const dbPath = require("path").join(__dirname, "../../data/agentfolio.db");
          const db = new Database(dbPath, { readonly: true });
          let profileId = null;
          const profiles = db.prepare("SELECT * FROM profiles").all();
          for (const p of profiles) {
            try { const vd = JSON.parse(p.verification_data || "{}"); if (vd.solana && vd.solana.address === wallet) { profileId = p.id; break; } } catch {}
            try { const w = JSON.parse(p.wallets || "{}"); if (w.solana === wallet) { profileId = p.id; break; } } catch {}
          }
          db.close();
          if (!profileId) return sendJson(403, { error: "No profile found for this wallet" });
          
          let level = 0, rep = 0, isBorn = false;
          try {
            const { getV3Score } = require("../v3-score-service");
            const v3 = await getV3Score(profileId);
            if (v3) { level = v3.verificationLevel || 0; rep = v3.reputationScore || 0; isBorn = !!v3.isBorn; }
          } catch {}
          if (level < 3 || rep < 50) return sendJson(403, { error: "Free mint requires Level 3+ and Rep 50+", level, rep });
          if (isBorn) return sendJson(403, { error: "Already used free burn-to-become", isBorn: true });
        }

        // Build unsigned TX via worker
        const { execFile } = require("child_process");
        execFile("node", ["/home/ubuntu/agentfolio/core-cm-v2/core-cm-prepare-worker.mjs", wallet, flow], {
          timeout: 30000, cwd: "/home/ubuntu/agentfolio/core-cm-v2",
          env: { ...process.env, HOME: process.env.HOME },
        }, (err, stdout, stderr) => {
          if (err) return sendJson(500, { error: "Prepare failed: " + err.message });
          try {
            const lines = stdout.trim().split("\n");
            const result = JSON.parse(lines[lines.length - 1]);
            if (result.error) return sendJson(500, result);
            sendJson(200, result);
          } catch (e) { sendJson(500, { error: "Parse error" }); }
        });
      } catch (e) { sendJson(500, { error: e.message }); }
    })();
    return true;
  }

  
  // POST /api/burn-to-become/mint-boa — Metaplex pipeline mint (server-side)
  if (url.pathname === "/api/burn-to-become/mint-boa" && req.method === "POST") {
    const wallet = req.body && req.body.wallet;
    const paymentTx = req.body && req.body.paymentTx; // SOL payment TX for paid mints
    if (!wallet) return sendJson(400, { error: "wallet required" });

    (async () => {
      try {
        // === SATP Identity Gate — ENFORCED (on-chain PDA check) ===
        // Active: wallets without SATP identity PDA are rejected
        // const IDENTITY_PROGRAM = new PublicKey("97yL33fcu6iWT2TdERS5HeqrMSGiUnxuy6nUcTrKieSq");

        const Database = require("better-sqlite3");
        const dbPath = require("path").join(__dirname, "../../data/agentfolio.db");
        
        // === 1. Per-agent mint count (max 3) — tracks by agent_id to prevent wallet-swap gaming ===
        // ON-CHAIN SATP SECURITY — identity PDA + boa_soulbound attestation check
        const satpCheck = await checkSatpOnChain(wallet);
        if (!satpCheck.hasIdentity) {
          return sendJson(403, { error: "SATP identity required. Verify your wallet at agentfolio.bot/verify first.", identityPDA: satpCheck.identityPda });
        }
        console.log("[MintBOA] SATP identity verified:", satpCheck.identityPda);
        
        // If already has boa_soulbound attestation (already burned), no free mint
        if (satpCheck.hasBoaSoulbound) {
          console.log("[MintBOA] Wallet already has boa_soulbound attestation — no free mint");
          // They can still do paid mints, just not free
        }

        // === ON-CHAIN MINT GATING (V3 Genesis Record isBorn) ===
        // Free mint: ONE per Genesis Record PDA. isBorn=true means already minted.
        // This is wallet-rotation proof — Genesis Record PDA is permanent identity.
        let v3IsBorn = false;
        let agentIdForCount = null;
        const countDb = new Database(dbPath, { readonly: true });
        const allProfiles = countDb.prepare("SELECT * FROM profiles").all();
        for (const p of allProfiles) {
          try {
            const vd = JSON.parse(p.verification_data || "{}");
            if (vd.solana && vd.solana.address === wallet) { agentIdForCount = p.id; break; }
          } catch {}
          try {
            const w = JSON.parse(p.wallets || "{}");
            if (w.solana === wallet) { agentIdForCount = p.id; break; }
          } catch {}
          if (!agentIdForCount && p.wallet === wallet) { agentIdForCount = p.id; }
        }
        countDb.close();
        
        // Check V3 Genesis Record isBorn (on-chain source of truth)
        if (agentIdForCount) {
          try {
            const { getV3Score } = require("../v3-score-service");
            const v3 = await getV3Score(agentIdForCount);
            if (v3 && v3.isBorn) v3IsBorn = true;
            console.log("[MintBOA] V3 Genesis Record for", agentIdForCount, "isBorn:", v3IsBorn);
          } catch (e) { console.warn("[MintBOA] V3 check failed:", e.message); }
        }
        
        // Mint count: prefer on-chain isBorn, fallback to JSON records for legacy
        const MINT_RECORDS_DIR = "/home/ubuntu/agentfolio/boa-pipeline/mint-records";
        let walletMintCount = 0;
        let agentMintCount = 0;
        if (fs.existsSync(MINT_RECORDS_DIR)) {
          fs.readdirSync(MINT_RECORDS_DIR).filter(f => f.endsWith(".json")).forEach(f => {
            try {
              const rec = JSON.parse(fs.readFileSync(require("path").join(MINT_RECORDS_DIR, f), "utf-8"));
              if (rec.recipient === wallet || rec.wallet === wallet) walletMintCount++;
              if (agentIdForCount && rec.agentId === agentIdForCount) agentMintCount++;
            } catch {}
          });
        }
        // On-chain isBorn overrides: if born on-chain, count is at least 1
        const effectiveMintCount = Math.max(walletMintCount, agentMintCount, v3IsBorn ? 1 : 0);
        console.log("[MintBOA] Effective mint count:", effectiveMintCount, "(wallet:", walletMintCount, "agent:", agentMintCount, "v3IsBorn:", v3IsBorn, ")");

        // === HARD CAP: Max 3 mints per agent ===
        if (effectiveMintCount >= 3) {
          return sendJson(403, { error: "Maximum 3 mints per agent reached.", currentMints: effectiveMintCount, maxMints: 3 });
        }

        // === 2. Unified eligibility check (DB level + rep) ===
        const checkDb = new Database(dbPath, { readonly: true });
        let profileId = null;
        let isEligibleFree = false;
        
        // Find profile by wallet
        const profiles = checkDb.prepare("SELECT * FROM profiles").all();
        for (const p of profiles) {
          try {
            const vd = JSON.parse(p.verification_data || "{}");
            if (vd.solana && vd.solana.address === wallet) { profileId = p.id; break; }
          } catch {}
          try {
            const w = JSON.parse(p.wallets || "{}");
            if (w.solana === wallet) { profileId = p.id; break; }
          if (!profileId && p.wallet === wallet) { profileId = p.id; break; }
          } catch {}
        }
        
        if (profileId) {
          // Use best-of V3 on-chain + V2 computed scores (fixes stale Genesis Record bug)
          let v3Level = 0, v3Rep = 0, v2Level = 0, v2Rep = 0;
          try {
            const { getV3Score } = require('../v3-score-service');
            const v3 = await getV3Score(profileId);
            if (v3) {
              v3Level = v3.verificationLevel || 0;
              v3Rep = v3.reputationScore || 0;
            }
          } catch (e) { console.error('[BURN] V3 score lookup failed:', e.message); }
          try {
            const { getCompleteScore } = require('../lib/scoring-engine-v2');
            const profile = checkDb.prepare('SELECT * FROM profiles WHERE id = ?').get(profileId);
            if (profile) {
              const profileObj = {
                id: profile.id, name: profile.name, handle: profile.handle, bio: profile.bio,
                skills: JSON.parse(profile.skills || '[]'),
                verification: JSON.parse(profile.verification || '{}'),
                endorsements: JSON.parse(profile.endorsements || '[]'),
                portfolio: JSON.parse(profile.portfolio || '[]'),
                track_record: JSON.parse(profile.track_record || '{}'),
              };
              const scoreResult = getCompleteScore(profileObj);
              v2Level = scoreResult.verificationLevel?.level || 0;
              v2Rep = scoreResult.reputationScore?.score || 0;
            }
          } catch (e) { console.error('[BURN] V2 scoring error:', e.message); }
          const level = Math.max(v3Level, v2Level);
          const rep = Math.max(v3Rep, v2Rep);
          console.log('[BURN] Score resolution for', profileId, 'V3:', v3Level+'/'+v3Rep, 'V2:', v2Level+'/'+v2Rep, 'Final:', level+'/'+rep);
          isEligibleFree = level >= 3 && rep >= 50;
          console.log("[BURN DEBUG]", { profileId, level, rep, isEligibleFree, effectiveMintCount: typeof effectiveMintCount !== "undefined" ? effectiveMintCount : "not set yet" });
        }
        checkDb.close();

        // === HARD GATE: Profile required for ALL mints ===
        if (!profileId) {
          return sendJson(403, { error: "No AgentFolio profile linked to this wallet. Register at agentfolio.bot first.", wallet });
        }

        // === 3. Determine pricing ===
        const isFirstMint = effectiveMintCount === 0;
        const isFree = isFirstMint && isEligibleFree;
        // Override: if already has soulbound attestation, no free mint
        const actuallyFree = isFree && !satpCheck.hasBoaSoulbound && !v3IsBorn;
        const price = actuallyFree ? 0 : 1; // 1 SOL for paid mints

        // === 4. Verify SOL payment for paid mints ===
        if (!actuallyFree) {
          if (!paymentTx) {
            return sendJson(402, {
              error: "Payment required",
              price: "1 SOL",
              mintNumber: effectiveMintCount + 1,
              isFirstMint: isFirstMint,
              eligible: isEligibleFree,
              message: isFirstMint
                ? "You do not meet free mint requirements (Level 3+ and Rep 50+). Send 1 SOL to treasury and include paymentTx."
                : "First mint only is free. Send 1 SOL to treasury and include paymentTx.",
              treasury: "FriU1FEpWbdgVrTcS49YV5mVv2oqN6poaVQjzq2BS5be"
            });
          }
          // Verify the payment TX on-chain
          try {
            const { Connection } = require("@solana/web3.js");
            const conn = new Connection(process.env.SOLANA_RPC || "https://api.mainnet-beta.solana.com");
            // Validate tx signature format before RPC call
            if (!paymentTx || typeof paymentTx !== "string" || paymentTx.length < 80 || paymentTx.length > 90) {
              return sendJson(400, { error: "Invalid payment transaction signature format." });
            }
            const txInfo = await conn.getTransaction(paymentTx, { maxSupportedTransactionVersion: 0 });
            if (!txInfo) {
              return sendJson(400, { error: "Payment TX not found on-chain. Wait for confirmation and retry." });
            }
            // Check that at least 1 SOL was transferred (1_000_000_000 lamports)
            const preBalances = txInfo.meta.preBalances;
            const postBalances = txInfo.meta.postBalances;
            const treasuryIdx = txInfo.transaction.message.staticAccountKeys
              ? txInfo.transaction.message.staticAccountKeys.findIndex(k => k.toBase58() === "FriU1FEpWbdgVrTcS49YV5mVv2oqN6poaVQjzq2BS5be")
              : -1;
            if (treasuryIdx >= 0) {
              const received = postBalances[treasuryIdx] - preBalances[treasuryIdx];
              if (received < 900_000_000) { // ~0.9 SOL min (allowing for fees)
                return sendJson(400, { error: "Insufficient payment. Expected 1 SOL to treasury.", received: received / 1e9 });
              }
            } else {
              return sendJson(400, { error: "Payment TX does not transfer to treasury wallet." });
            }
          } catch (verifyErr) {
            console.error("[MintBOA] Payment verification failed:", verifyErr.message);
            return sendJson(400, { error: "Payment verification failed: " + verifyErr.message });
          }
        }

        // === REPLAY PROTECTION: Check payment TX hasn't been used before ===
        if (!actuallyFree && paymentTx) {
          const usedPayments = loadUsedPayments();
          if (usedPayments.has(paymentTx)) {
            return sendJson(409, { error: "Payment TX already used for a previous mint. Send a new payment.", paymentTx });
          }
        }
        // === 5+6. Core Candy Machine mint (atomic on-chain counter, no claim files needed) ===
        console.log("[MintBOA] Core CM mint for " + wallet + " (mint #" + (effectiveMintCount + 1) + ", " + (actuallyFree ? "FREE" : "PAID") + ")");
        const { execFile } = require("child_process");

// SATP V3 SDK for Genesis Record updates
let satpV3Client;
try {
  const { createSATPClient } = require("../satp-client/src");
  satpV3Client = createSATPClient({ rpcUrl: process.env.SOLANA_RPC_URL || "https://mainnet.helius-rpc.com/?api-key=HELIUS_API_KEY_REDACTED" });
  console.log("[BurnToBecome] SATP V3 SDK loaded");
} catch (e) {
  console.warn("[BurnToBecome] SATP V3 SDK not available:", e.message);
}
        // Use Core Candy Machine worker (separate node_modules in core-cm-v2)
        const workerPath = "/home/ubuntu/agentfolio/core-cm-v2/core-cm-mint-worker.mjs";

        execFile("node", [workerPath, wallet], {
          timeout: 120000,
          cwd: "/home/ubuntu/agentfolio/core-cm-v2",
          env: { ...process.env, HOME: process.env.HOME, SOLANA_RPC_URL: process.env.SOLANA_RPC_URL || "https://mainnet.helius-rpc.com/?api-key=HELIUS_API_KEY_REDACTED" },
        }, (err, stdout, stderr) => {
          if (stderr) console.log("[MintBOA] stderr:", stderr.slice(0, 500));
          if (err) {
            console.error("[MintBOA] Core CM mint failed:", err.message);
            return sendJson(500, { error: "Mint failed: " + err.message });
          }
          try {
            const lines = stdout.trim().split("\n");
            const result = JSON.parse(lines[lines.length - 1]);
            if (result.error) return sendJson(500, result);
            console.log("[MintBOA] \u2705 BOA #" + result.boaId + " minted via Candy Machine: " + result.mintAddress);
            // TASK 4: Auto-update profile avatar to BOA image
            if (profileId && result.imageUri) {
              try {
                const Database = require("better-sqlite3");
                const avatarDb = new Database(require("path").join(__dirname, "../../data/agentfolio.db"));
                avatarDb.prepare("UPDATE profiles SET avatar = ? WHERE id = ?").run(result.imageUri, profileId);
                avatarDb.close();
                // Also update JSON profile if exists
                const profileJsonPath = require("path").join(__dirname, "../../data/profiles", profileId + ".json");
                if (fs.existsSync(profileJsonPath)) {
                  const pf = JSON.parse(fs.readFileSync(profileJsonPath, "utf-8"));
                  pf.avatar = result.imageUri;
                  pf.boaMint = result.mintAddress;
                  pf.boaId = result.boaId;
                  fs.writeFileSync(profileJsonPath, JSON.stringify(pf, null, 2));
                }
                console.log("[MintBOA] Avatar auto-updated for " + profileId);
                // V3: Record burn-to-become on Genesis Record (uses safe wrapper)
                if (profileId) {
                  safeBurnToBecome(profileId, result.imageUri || "", result.mintAddress || "", "")
                    .then(burnResult => {
                      if (burnResult.success) {
                        console.log("[SATP V3] burnToBecome recorded for " + profileId + ": tx=" + burnResult.txSignature);
                      } else if (burnResult.needsClientSign) {
                        console.log("[SATP V3] burnToBecome needs client sign for " + profileId + " (authority: " + burnResult.authority + ")");
                      } else {
                        console.log("[SATP V3] burnToBecome skipped for " + profileId + ": " + burnResult.reason);
                      }
                    })
                    .catch(err => console.error("[SATP V3] burnToBecome failed for " + profileId + ":", err.message));
                }
              } catch (avatarErr) {
                console.error("[MintBOA] Avatar update failed:", avatarErr.message);
              }
            }
            // Inject agentId into mint record
            try {
              const recPath = require("path").join(PIPELINE_DIR, "mint-records", result.boaId + ".json");
              if (fs.existsSync(recPath)) {
                const rec = JSON.parse(fs.readFileSync(recPath, "utf-8"));
                rec.agentId = agentIdForCount || profileId || null;
                rec.wallet = wallet;
                fs.writeFileSync(recPath, JSON.stringify(rec, null, 2));
              }
            } catch (e) { console.error("[MintBOA] Failed to patch record:", e.message); }
            // Record used payment TX for replay protection
            if (paymentTx) saveUsedPayment(paymentTx);
            sendJson(200, {
              success: true,
              boaId: result.boaId,
              boaName: result.boaName,
              mintAddress: result.mintAddress,
              metadataUri: result.metadataUri,
              imageUri: result.imageUri,
              collection: result.collection,
              isFree: actuallyFree,
              mintNumber: effectiveMintCount + 1,
              maxMints: 3,
              price: price,
              paymentTx: paymentTx || null,
              itemsRedeemed: result.itemsRedeemed,
              itemsAvailable: result.itemsAvailable,
            });
          } catch (e) {
            console.error("[MintBOA] Parse error:", stdout);
            sendJson(500, { error: "Failed to parse worker output" });
          }
        });
      } catch (e) {
        console.error("[MintBOA] error:", e);
        sendJson(500, { error: e.message });
      }
    })();
    return true;
  }

  // POST /api/burn-to-become/mint-boa/submit — DEPRECATED (Metaplex pipeline is server-side)
  if (url.pathname === '/api/burn-to-become/mint-boa/submit' && req.method === 'POST') {
    sendJson(410, { error: 'This endpoint is deprecated. Minting is now handled server-side via /api/burn-to-become/mint-boa' });
    return true;
  }

  // POST /api/burn-to-become/confirm-mint — record a client-signed mint after TX confirms
  if (url.pathname === '/api/burn-to-become/confirm-mint' && req.method === 'POST') {
    const { wallet, signature, asset, boaId, flow } = req.body || {};
    if (!wallet || !signature) return sendJson(400, { error: 'wallet and signature required' });
    
    (async () => {
      try {
        const { Connection, PublicKey } = require('@solana/web3.js');
        const connection = new Connection(process.env.SOLANA_RPC_URL || 'https://mainnet.helius-rpc.com/?api-key=HELIUS_API_KEY_REDACTED', 'confirmed');
        
        // Validate signature format (base58, 86-88 chars)
        if (!signature || typeof signature !== 'string' || signature.length < 80 || signature.length > 100) {
          return sendJson(400, { error: 'Invalid transaction signature format' });
        }
        // Verify the TX actually confirmed on-chain
        const txInfo = await connection.getTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
        if (!txInfo) return sendJson(404, { error: 'Transaction not found or not confirmed yet. Try again in a few seconds.' });
        if (txInfo.meta && txInfo.meta.err) return sendJson(400, { error: 'Transaction failed on-chain', txError: txInfo.meta.err });
        
        // Verify wallet was a signer
        const signers = txInfo.transaction.message.staticAccountKeys 
          ? txInfo.transaction.message.staticAccountKeys.map(k => k.toBase58())
          : txInfo.transaction.message.accountKeys.map(k => k.toBase58());
        if (!signers.includes(wallet)) return sendJson(403, { error: 'Wallet was not a signer on this transaction' });
        
        // Record the mint
        const MINT_RECORDS_DIR = '/home/ubuntu/agentfolio/boa-pipeline/mint-records';
        const effectiveBoaId = boaId || 'client-' + Date.now();
        const recordPath = require('path').join(MINT_RECORDS_DIR, effectiveBoaId + '.json');
        
        // Find agent ID from wallet
        const Database = require('better-sqlite3');
        const dbPath = require('path').join(__dirname, '../../data/agentfolio.db');
        let agentId = null;
        try {
          const db = new Database(dbPath, { readonly: true });
          const profiles = db.prepare('SELECT * FROM profiles').all();
          for (const p of profiles) {
            try { const vd = JSON.parse(p.verification_data || '{}'); if (vd.solana && vd.solana.address === wallet) { agentId = p.id; break; } } catch {}
            try { const w = JSON.parse(p.wallets || '{}'); if (w.solana === wallet) { agentId = p.id; break; } } catch {}
          }
          db.close();
        } catch {}
        
        const record = {
          cluster: 'mainnet',
          nftNumber: boaId || null,
          mint: asset || null,
          collection: 'CCw8NjAS3QpfDU4fBYkJ2kD4znNy468e3wqAJQKoJCFk',
          recipient: wallet,
          agentId: agentId,
          flow: flow || 'unknown',
          signature,
          clientSigned: true,
          timestamp: new Date().toISOString(),
        };
        
        if (!fs.existsSync(MINT_RECORDS_DIR)) fs.mkdirSync(MINT_RECORDS_DIR, { recursive: true });
        fs.writeFileSync(recordPath, JSON.stringify(record, null, 2));
        console.log('[ConfirmMint] Recorded client-signed mint:', effectiveBoaId, 'agent:', agentId, 'sig:', signature.slice(0, 20));
        
        // If free flow + agent has Genesis Record, trigger burnToBecome (uses safe wrapper)
        if (flow === 'free' && agentId && asset) {
          try {
            const burnResult = await safeBurnToBecome(agentId, asset?.imageUri || '', asset?.mintAddress || '', '');
            if (burnResult.success) {
              console.log('[ConfirmMint] V3 burnToBecome recorded:', agentId, 'tx:', burnResult.txSignature);
              record.burnToBecomeTx = burnResult.txSignature;
            } else if (burnResult.needsClientSign) {
              console.log('[ConfirmMint] burnToBecome needs client sign:', agentId, 'authority:', burnResult.authority);
            } else {
              console.log('[ConfirmMint] burnToBecome skipped:', agentId, burnResult.reason);
            }
          } catch (e) { console.warn('[ConfirmMint] burnToBecome failed:', e.message); }
        }
        
        sendJson(200, { success: true, recorded: true, agentId, boaId: effectiveBoaId, ...record });
      } catch (e) {
        console.error('[ConfirmMint] Error:', e.message);
        sendJson(500, { error: e.message });
      }
    })();
    return true;
  }

  return false; // not handled

}

module.exports = { handleBurnToBecome };
