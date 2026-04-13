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
const { loadNormalizedTrust } = require('../lib/normalized-trust');

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
const HELIUS_RPC = 'https://mainnet.helius-rpc.com/?api-key=91c63e44-1c7a-4b98-830b-6135632565fb';

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
/**
 * Check if wallet owns any Metaplex Core NFTs from our BOA candy machine collection.
 * Uses Helius DAS API (getAssetsByOwner with grouping filter).
 * Returns: { hasMinted: boolean, count: number, assets: [] }
 */
async function checkOnChainMints(wallet) {
  const COLLECTION = 'CCw8NjAS3QpfDU4fBYkJ2kD4znNy468e3wqAJQKoJCFk';
  const HELIUS_RPC = 'https://mainnet.helius-rpc.com/?api-key=91c63e44-1c7a-4b98-830b-6135632565fb';
  
  try {
    const resp = await fetch(HELIUS_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'boa-check',
        method: 'getAssetsByOwner',
        params: {
          ownerAddress: wallet,
          page: 1,
          limit: 10,
          displayOptions: { showCollectionMetadata: false },
        },
      }),
    });
    const data = await resp.json();
    const assets = (data?.result?.items || []).filter(a => {
      // Match Core NFTs from our collection
      const grouping = a.grouping || [];
      return grouping.some(g => g.group_key === 'collection' && g.group_value === COLLECTION);
    });
    return { hasMinted: assets.length > 0, count: assets.length, assets: assets.map(a => ({ id: a.id, name: a.content?.metadata?.name })) };
  } catch (e) {
    console.error('[OnChainMintCheck] DAS API error:', e.message);
    return { hasMinted: false, count: 0, assets: [], error: e.message };
  }
}


function getRecordedBoaMintCount({ wallet, agentId, matchWallet = true } = {}) {
  try {
    const recordsDir = path.join(PIPELINE_DIR, 'mint-records');
    const files = fs.existsSync(recordsDir) ? fs.readdirSync(recordsDir).filter((name) => name.endsWith('.json')) : [];
    let count = 0;
    for (const file of files) {
      try {
        const record = JSON.parse(fs.readFileSync(path.join(recordsDir, file), 'utf8'));
        if (matchWallet && wallet && record?.recipient === wallet) {
          count += 1;
          continue;
        }
        if (agentId && record?.agentId === agentId) {
          count += 1;
        }
      } catch {}
    }
    return count;
  } catch (e) {
    console.warn('[RecordedMintCount] Failed to read mint records:', e.message);
    return 0;
  }
}

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

function safeJsonParse(raw, fallback) {
  try { return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
}

function getProfileCreatedAtMs(profile) {
  const parsed = Date.parse(profile?.created_at || profile?.updated_at || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function profileMatchesWallet(profile, wallet) {
  if (!profile || !wallet) return false;
  if (profile.wallet === wallet) return true;
  const verificationData = safeJsonParse(profile.verification_data, {});
  if (verificationData?.solana?.address === wallet) return true;
  const wallets = safeJsonParse(profile.wallets, {});
  if (wallets?.solana === wallet) return true;
  return false;
}

async function getNormalizedTrustForProfile(profileId) {
  let level = 0, rep = 0;
  try {
    const trust = await loadNormalizedTrust(profileId);
    if (trust && typeof trust.reputationScore === 'number') {
      level = trust.verificationLevel || 0;
      rep = trust.reputationScore > 10000 ? Math.round(trust.reputationScore / 10000) : trust.reputationScore;
    }
  } catch {}
  return { level, rep };
}

async function resolveBestProfileForWallet(db, wallet, options = {}) {
  const profiles = db.prepare('SELECT * FROM profiles').all().filter((profile) => profileMatchesWallet(profile, wallet));
  if (!profiles.length) return null;

  const preferredProfileId = options?.preferredProfileId ? String(options.preferredProfileId) : null;
  if (preferredProfileId) {
    const preferred = profiles.find((profile) => String(profile.id) === preferredProfileId);
    if (preferred) {
      const trust = await getNormalizedTrustForProfile(preferred.id);
      return {
        profile: preferred,
        level: trust.level || 0,
        rep: trust.rep || 0,
        createdAtMs: getProfileCreatedAtMs(preferred),
      };
    }
  }

  const ranked = [];
  for (const profile of profiles) {
    const trust = await getNormalizedTrustForProfile(profile.id);
    ranked.push({
      profile,
      level: trust.level || 0,
      rep: trust.rep || 0,
      createdAtMs: getProfileCreatedAtMs(profile),
    });
  }

  ranked.sort((a, b) =>
    (b.level - a.level) ||
    (b.rep - a.rep) ||
    (b.createdAtMs - a.createdAtMs) ||
    String(b.profile.id || '').localeCompare(String(a.profile.id || ''))
  );

  if (ranked.length > 1) {
    console.log('[BurnPublic] Multiple profiles matched wallet', wallet, '=>', ranked.map((item) => `${item.profile.id}:${item.level}/${item.rep}`).join(', '), 'selected', ranked[0].profile.id);
  }

  return ranked[0];
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
      // Skip soulbound tokens — they are permanent and should never be burned
      const nameLower = name.toLowerCase();
      if (nameLower.includes('soulbound') || nameLower.includes('soul bound') || nameLower.includes('soul-bound')) {
        continue;
      }

      // Check Token-2022 non-transferable extension (soulbound indicator)
      const isNonTransferable = item.content?.metadata?.attributes?.some(
        a => a.trait_type === 'transferable' && a.value === 'false'
      ) || item.ownership?.frozen === true;
      if (isNonTransferable) {
        continue;
      }

      // Fix Irys URLs — replace gateway variants with working uploader endpoint
      if (image) {
        image = image
          .replace('node1.irys.xyz', 'gateway.irys.xyz')
          .replace('arweave.net', 'gateway.irys.xyz');
      }

      nfts.push({ mint, name, image, uri, isGenesis, isToken2022: false, isCoreAsset: iface === 'MplCoreAsset' });
    }

    console.log('[BurnPublic] DAS returned', items.length, 'assets,', nfts.length, 'NFTs (soulbound filtered) for', walletAddress);
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
  
  // Detect asset type: Core NFT or SPL Token
  const accountInfo = await connection.getAccountInfo(mint);
  if (!accountInfo) throw new Error('NFT account not found: ' + nftMint);
  
  const METAPLEX_CORE_PROGRAM = new PublicKey('CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d');
  
  if (accountInfo.owner.equals(METAPLEX_CORE_PROGRAM)) {
    // ═══ CORE NFT: Use Core burn worker (returns unsigned TX) ═══
    console.log('[BurnPublic] Detected Core NFT, using Metaplex Core burn');
    const { execFile } = require('child_process');
    return new Promise((resolve, reject) => {
      execFile('node', ['/home/ubuntu/agentfolio/core-cm-v2/core-burn-worker.mjs', nftMint, walletAddress, 'prepare'], {
        timeout: 30000,
        cwd: '/home/ubuntu/agentfolio/core-cm-v2',
        env: { ...process.env, HOME: process.env.HOME },
      }, (err, stdout, stderr) => {
        if (err) return reject(new Error('Core burn prepare failed: ' + err.message));
        try {
          const lines = stdout.trim().split('\n');
          const result = JSON.parse(lines[lines.length - 1]);
          if (result.error) return reject(new Error(result.error));
          // Return the pre-built TX from the worker
          const txBuf = Buffer.from(result.transaction, 'base64');
          const tx = Transaction.from(txBuf);
          resolve(tx);
        } catch (e) { reject(new Error('Core burn parse failed')); }
      });
    });
  }
  
  // ═══ SPL TOKEN NFT: Original burn flow ═══
  if (!accountInfo.owner.equals(TOKEN_PROGRAM_ID)) {
    throw new Error('Unsupported NFT program for burn: ' + accountInfo.owner.toBase58());
  }
  console.log('[BurnPublic] Detected SPL Token NFT, using SPL Token burn');
  const ata = await getAssociatedTokenAddress(mint, wallet, false, TOKEN_PROGRAM_ID);
  const { getAccount, getMint } = require('@solana/spl-token');
  let tokenAccount;
  try {
    tokenAccount = await getAccount(connection, ata, 'confirmed', TOKEN_PROGRAM_ID);
  } catch {
    throw new Error('Wallet does not own this SPL NFT');
  }
  if (!tokenAccount.owner.equals(wallet)) {
    throw new Error('Wallet does not own this SPL NFT');
  }
  if (tokenAccount.amount !== 1n) {
    throw new Error('Burn to Become requires exactly 1 token in the wallet account');
  }
  const mintInfo = await getMint(connection, mint, 'confirmed', TOKEN_PROGRAM_ID);
  if (mintInfo.decimals !== 0 || mintInfo.supply !== 1n) {
    throw new Error('Burn to Become only supports non-fungible SPL NFTs');
  }
  
  const tx = new Transaction();
  tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100000 }));
  tx.add(createBurnInstruction(ata, mint, wallet, 1, [], TOKEN_PROGRAM_ID));
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
    const wallet = (req?.query?.wallet || (() => { try { return url?.searchParams?.get ? url.searchParams.get('wallet') : new URL(req.originalUrl || req.url || '', 'http://localhost').searchParams.get('wallet'); } catch { return null; } })());
    if (!wallet) return sendJson(400, { error: 'wallet required' });
    getWalletNFTs(wallet).then(nfts => sendJson(200, { nfts })).catch(e => sendJson(500, { error: e.message }));
    return true;
  }

  // GET /api/burn-to-become/satp-score
  if (url.pathname === '/api/burn-to-become/satp-score' && req.method === 'GET') {
    const wallet = (req?.query?.wallet || (() => { try { return url?.searchParams?.get ? url.searchParams.get('wallet') : new URL(req.originalUrl || req.url || '', 'http://localhost').searchParams.get('wallet'); } catch { return null; } })());
    const profileId = (req?.query?.profileId || (() => { try { return url?.searchParams?.get ? url.searchParams.get('profileId') : new URL(req.originalUrl || req.url || '', 'http://localhost').searchParams.get('profileId'); } catch { return null; } })());
    if (!wallet) return sendJson(400, { error: 'wallet required' });
    (async () => {
      try {
        const Database = require('better-sqlite3');
        const db = new Database(require('path').join(__dirname, '../../data/agentfolio.db'), { readonly: true });
        const resolvedProfile = await resolveBestProfileForWallet(db, wallet, { preferredProfileId: profileId });
        const matchedProfile = resolvedProfile?.profile || null;
        try { db.close(); } catch {}
        if (matchedProfile?.id) {
          try {
            const trust = await loadNormalizedTrust(matchedProfile.id);
            if (trust && typeof trust.reputationScore === 'number') {
              const normalizedScore = trust.reputationScore > 10000 ? Math.round(trust.reputationScore / 10000) : trust.reputationScore;
              return sendJson(200, {
                score: normalizedScore,
                free: normalizedScore >= FREE_SCORE_THRESHOLD,
                level: trust.verificationLevel || 0,
                levelName: trust.verificationLabel || 'Unverified',
                source: 'normalized-profile-trust',
                profileId: matchedProfile.id,
              });
            }
          } catch {}
        }
        const score = await getSatpScore(wallet);
        return sendJson(200, { score, free: score >= FREE_SCORE_THRESHOLD, source: 'raw-satp-score' });
      } catch (e) {
        return sendJson(500, { error: e.message });
      }
    })();
    return true;
  }

  // GET /api/burn-to-become/profile?wallet=... — resolve linked profile and normalized trust data
  if (url.pathname === '/api/burn-to-become/profile' && req.method === 'GET') {
    const wallet = (req?.query?.wallet || (() => { try { return url?.searchParams?.get ? url.searchParams.get('wallet') : new URL(req.originalUrl || req.url || '', 'http://localhost').searchParams.get('wallet'); } catch { return null; } })());
    const profileId = (req?.query?.profileId || (() => { try { return url?.searchParams?.get ? url.searchParams.get('profileId') : new URL(req.originalUrl || req.url || '', 'http://localhost').searchParams.get('profileId'); } catch { return null; } })());
    if (!wallet) { sendJson(400, { error: 'wallet required' }); return true; }
    (async () => {
      try {
        const Database = require('better-sqlite3');
        const { computeScore } = require('../lib/compute-score');
        const db = new Database(require('path').join(__dirname, '../../data/agentfolio.db'), { readonly: true });
        const resolvedProfile = await resolveBestProfileForWallet(db, wallet, { preferredProfileId: profileId });
        const matchedProfile = resolvedProfile?.profile || null;
        if (!matchedProfile) { try { db.close(); } catch {} sendJson(200, { found: false, wallet }); return; }

        let level = resolvedProfile?.level || 0;
        let reputation = resolvedProfile?.rep || 0;
        let levelName = 'Unverified';
        let badge = '⚪';

        try {
          const trust = await loadNormalizedTrust(matchedProfile.id);
          if (trust && typeof trust.reputationScore === 'number') {
            level = trust.verificationLevel || 0;
            reputation = trust.reputationScore > 10000 ? Math.round(trust.reputationScore / 10000) : trust.reputationScore;
            levelName = trust.verificationLabel || levelName;
          }
        } catch {}

        if (!level && !reputation) {
          const verifs = db.prepare('SELECT platform, identifier FROM verifications WHERE profile_id = ?').all(matchedProfile.id);
          const computed = computeScore(verifs, { hasSatpIdentity: !!matchedProfile.wallet, claimed: !!matchedProfile.claimed });
          level = computed.level || 0;
          reputation = computed.score || 0;
          levelName = computed.levelName || levelName;
          badge = computed.badge || badge;
        } else {
          const LEVEL_NAMES = ['Unregistered', 'Registered', 'Verified', 'Established', 'Trusted', 'Sovereign'];
          const LEVEL_BADGES = ['⚪', '🟡', '🔵', '🟢', '🟠', '👑'];
          levelName = LEVEL_NAMES[level] || levelName;
          badge = LEVEL_BADGES[level] || badge;
        }

        try { db.close(); } catch {}
        sendJson(200, {
          found: true,
          wallet,
          profileId: matchedProfile.id,
          agent: matchedProfile.id,
          name: matchedProfile.name,
          handle: matchedProfile.handle,
          level,
          levelName,
          badge,
          reputation,
        });
      } catch (e) {
        console.error('[BurnPublic] profile error:', e);
        sendJson(500, { error: e.message });
      }
    })();
    return true;
  }

  // GET /api/burn-to-become/eligibility?wallet=... — check BOA mint eligibility (Level + Rep)
  if (url.pathname === '/api/burn-to-become/eligibility' && req.method === 'GET') {
    const wallet = (req?.query?.wallet || (() => { try { return url?.searchParams?.get ? url.searchParams.get('wallet') : new URL(req.originalUrl || req.url || '', 'http://localhost').searchParams.get('wallet'); } catch { return null; } })());
    const profileId = (req?.query?.profileId || (() => { try { return url?.searchParams?.get ? url.searchParams.get('profileId') : new URL(req.originalUrl || req.url || '', 'http://localhost').searchParams.get('profileId'); } catch { return null; } })());
    if (!wallet) return sendJson(400, { error: 'wallet required' });
    (async () => {
      try {
        const Database = require('better-sqlite3');
        const db = new Database(path.join(__dirname, '../../data/agentfolio.db'), { readonly: true });
        let getCompleteScore; try { getCompleteScore = require('../lib/scoring-engine-v2').getCompleteScore; } catch(_) { getCompleteScore = () => ({ overall: 0, level: 'Unverified' }); } const fs = require('fs');
        const LEVEL_NAMES = ['Unregistered', 'Registered', 'Verified', 'Established', 'Trusted', 'Sovereign'];
        const LEVEL_BADGES = ['⚪', '🟡', '🔵', '🟢', '🟠', '👑'];
        const resolvedProfile = await resolveBestProfileForWallet(db, wallet, { preferredProfileId: profileId });
        let matchedProfile = resolvedProfile?.profile || null;
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
        // Profile-facing burn eligibility should use the same normalized trust source as the
        // rest of the public API, with old best-of logic only as a fallback.
        let level = resolvedProfile?.level || 0, reputation = resolvedProfile?.rep || 0;
        let v3Lev = 0, v3Rp = 0, v2Lev = 0, v2Rp = 0;
        try {
          const trust = await loadNormalizedTrust(matchedProfile.id);
          if (trust && typeof trust.reputationScore === 'number') {
            level = trust.verificationLevel || 0;
            reputation = trust.reputationScore > 10000 ? Math.round(trust.reputationScore / 10000) : trust.reputationScore;
          }
        } catch {}
        if (!level && !reputation) {
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
          level = Math.max(v3Lev, v2Lev);
          reputation = Math.max(v3Rp, v2Rp);
        }
        console.log('[ELIGIBILITY] Score for', matchedProfile.id, 'normalized/fallback =>', level+'/'+reputation, 'V3:', v3Lev+'/'+v3Rp, 'V2:', v2Lev+'/'+v2Rp);
        const eligible = level >= 3 && reputation >= 50;
        db.close();
        // Check isBorn from Genesis Record — free first mint only if not already born
        let isBorn = false;
        let boaMintCount = 0;
        let recordedBoaMintCount = 0;
        try {
          const { getV3Score } = require('../v3-score-service');
          const v3Data = await getV3Score(matchedProfile.id);
          if (v3Data && v3Data.isBorn) isBorn = true;
        } catch {}
        try {
          const onChainMints = await checkOnChainMints(wallet);
          boaMintCount = onChainMints.count || 0;
        } catch {}
        recordedBoaMintCount = getRecordedBoaMintCount({ wallet, agentId: matchedProfile.id, matchWallet: !profileId });
        sendJson(200, { found: true, agent: matchedProfile.id, name: matchedProfile.name, level, levelName: LEVEL_NAMES[level] || 'Unknown', badge: LEVEL_BADGES[level] || '⚪', reputation, eligible, freeFirstMint: eligible && !isBorn && recordedBoaMintCount === 0 && boaMintCount === 0, isBorn, boaMintCount, recordedBoaMintCount });
      } catch (e) { console.error('[BurnPublic] eligibility error:', e); sendJson(500, { error: e.message }); }
    })();
    return true;
  }

  // POST /api/burn-to-become/submit-genesis — submit signed burnToBecome TX (client-side authority)
  if (url.pathname === '/api/burn-to-become/submit-genesis' && req.method === 'POST') {
    (async () => {
      try {
        const { signedTransaction } = req.body || {};
        if (!signedTransaction) return sendJson(400, { error: 'signedTransaction required' });
        
        const txBuffer = Buffer.from(signedTransaction, 'base64');
        const sig = await connection.sendRawTransaction(txBuffer);
        await connection.confirmTransaction(sig, 'confirmed');
        try { require('../v3-score-service').clearV3Cache(); } catch {}
        console.log('[SubmitGenesis] burnToBecome TX confirmed:', sig);
        sendJson(200, { success: true, signature: sig });
      } catch (e) {
        console.error('[SubmitGenesis] error:', e.message);
        sendJson(500, { error: e.message });
      }
    })();
    return true;
  }

  // POST /api/burn-to-become/prepare
  if (url.pathname === '/api/burn-to-become/prepare' && req.method === 'POST') {
    (async () => {
      try {
        const { wallet, nftMint } = req.body || {};
        if (!wallet || !nftMint) return sendJson(400, { error: 'wallet and nftMint required' });

        const { PublicKey } = require('@solana/web3.js');
        try {
          new PublicKey(wallet);
          new PublicKey(nftMint);
        } catch {
          return sendJson(400, { error: 'Invalid wallet or nftMint' });
        }

        const Database = require('better-sqlite3');
        const path = require('path');
        const gateDb = new Database(path.join(__dirname, '../../data/agentfolio.db'), { readonly: true });
        const resolvedProfile = await resolveBestProfileForWallet(gateDb, wallet);
        const profileId = resolvedProfile?.profile?.id || null;
        try { gateDb.close(); } catch {}
        if (!profileId) {
          return sendJson(403, { error: 'No AgentFolio profile linked to this wallet. Register at agentfolio.bot first.', wallet });
        }

        let level = resolvedProfile?.level || 0;
        let rep = resolvedProfile?.rep || 0;
        try {
          const trust = await loadNormalizedTrust(profileId);
          if (trust && typeof trust.reputationScore === 'number') {
            level = trust.verificationLevel || 0;
            rep = trust.reputationScore > 10000 ? Math.round(trust.reputationScore / 10000) : trust.reputationScore;
          }
        } catch {}
        if (level < 3 || rep < 50) {
          return sendJson(403, { error: 'Burn to Become requires Level 3+ and Rep 50+.', level, rep, profileId });
        }

        const burnSatpCheck = await checkSatpOnChain(wallet);
        let hasSatpIdentity = burnSatpCheck.hasIdentity;
        try {
          const { getV3Score } = require('../v3-score-service');
          const v3 = await getV3Score(profileId);
          if (v3) hasSatpIdentity = true;
        } catch {}
        if (!hasSatpIdentity) {
          return sendJson(403, { error: 'SATP identity required to burn. Verify your wallet at agentfolio.bot/verify first.' });
        }
        if (burnSatpCheck.hasBoaSoulbound) {
          return sendJson(409, { error: 'This wallet already has a permanent face (boa_soulbound attestation on-chain). Each agent gets one.' });
        }

        try {
          const checkDb = new Database(path.join(__dirname, '../../data/agentfolio.db'), { readonly: true });
          const existing = checkDb.prepare('SELECT nft_avatar FROM profiles WHERE id = ?').get(profileId);
          if (existing && existing.nft_avatar) {
            const nftData = JSON.parse(existing.nft_avatar);
            if (nftData.permanent === true) {
              try { checkDb.close(); } catch {}
              return sendJson(403, {
                error: 'This agent already has a permanent soulbound face. Burn to Become is a one-time, irreversible process.',
                existingSoulbound: nftData.soulboundMint,
                existingImage: nftData.image,
              });
            }
          }
          try { checkDb.close(); } catch {}
        } catch (checkErr) {
          console.warn('[BurnPublic] prepare permanent face check failed (non-blocking — on-chain SATP is authority):', checkErr.message);
        }

        const tx = await buildBurnTransaction(wallet, nftMint);
        const serialized = tx.serialize({ requireAllSignatures: false }).toString('base64');
        sendJson(200, { transaction: serialized });
      } catch (e) {
        console.error('[BurnPublic] prepare error:', e);
        const message = e && e.message ? e.message : 'Unknown error';
        const validationError = (
          message === 'Wallet does not own this SPL NFT' ||
          message === 'Burn to Become requires exactly 1 token in the wallet account' ||
          message === 'Burn to Become only supports non-fungible SPL NFTs' ||
          message === 'Invalid wallet or nftMint' ||
          message.startsWith('Unsupported NFT program for burn:') ||
          message.startsWith('NFT account not found:')
        );
        sendJson(validationError ? 400 : 500, { error: message });
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

        const { PublicKey } = require('@solana/web3.js');
        try {
          new PublicKey(wallet);
          new PublicKey(nftMint);
        } catch {
          return sendJson(400, { error: 'Invalid wallet or nftMint' });
        }

        const Database = require('better-sqlite3');
        const path = require('path');
        const gateDb = new Database(path.join(__dirname, '../../data/agentfolio.db'), { readonly: true });
        const resolvedProfile = await resolveBestProfileForWallet(gateDb, wallet);
        const resolvedProfileId = resolvedProfile?.profile?.id || null;
        try { gateDb.close(); } catch {}
        if (!resolvedProfileId) {
          return sendJson(403, { error: 'No AgentFolio profile linked to this wallet. Register at agentfolio.bot first.', wallet });
        }

        let level = resolvedProfile?.level || 0;
        let rep = resolvedProfile?.rep || 0;
        try {
          const trust = await loadNormalizedTrust(resolvedProfileId);
          if (trust && typeof trust.reputationScore === 'number') {
            level = trust.verificationLevel || 0;
            rep = trust.reputationScore > 10000 ? Math.round(trust.reputationScore / 10000) : trust.reputationScore;
          }
        } catch {}
        if (level < 3 || rep < 50) {
          return sendJson(403, { error: 'Burn to Become requires Level 3+ and Rep 50+.', level, rep, profileId: resolvedProfileId });
        }
        
        // ON-CHAIN SATP SECURITY: Identity + boa_soulbound attestation check
        const burnSatpCheck = await checkSatpOnChain(wallet);
        let hasSatpIdentity = burnSatpCheck.hasIdentity;
        try {
          const { getV3Score } = require('../v3-score-service');
          const v3 = await getV3Score(resolvedProfileId);
          if (v3) hasSatpIdentity = true;
        } catch {}
        if (!hasSatpIdentity) {
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
          // Try Core NFT first (via Helius DAS), then fall back to SPL Token Metadata
          try {
            const dasResp = await fetch(HELIUS_RPC, {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getAsset", params: { id: nftMint } }),
            });
            const dasData = await dasResp.json();
            const assetContent = dasData.result && dasData.result.content;
            if (assetContent) {
              artworkUri = (assetContent.links && assetContent.links.image) || (assetContent.files && assetContent.files[0] && assetContent.files[0].uri) || "";
              metadataUri = (assetContent.json_uri) || "";
              nftName = (assetContent.metadata && assetContent.metadata.name || "BOA") + " — Soulbound";
            }
          } catch (dasErr) { console.warn("[BurnPublic] DAS metadata fetch failed:", dasErr.message); }

          // Fallback: SPL Token Metadata PDA
          if (!artworkUri) {
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
              // Build burnToBecome TX for client-side signing
              try {
                const v3sdk = require('@brainai/satp-v3');
                const builders = new v3sdk.SatpV3Builders(process.env.SOLANA_RPC_URL || 'https://mainnet.helius-rpc.com/?api-key=91c63e44-1c7a-4b98-830b-6135632565fb');
                const userAuthority = new PublicKey(burnResult.authority);
                const faceMintPk = soulboundResult.soulboundMint ? new PublicKey(soulboundResult.soulboundMint) : PublicKey.default;
                const clientBurnTx = await builders.burnToBecome({
                  agentId: agentId,
                  authority: userAuthority,
                  faceImage: artworkUri || '',
                  faceMint: faceMintPk,
                  faceBurnTx: burnTx || '',
                });
                const latestBtb = await connection.getLatestBlockhash('confirmed');
                clientBurnTx.feePayer = userAuthority;
                clientBurnTx.recentBlockhash = latestBtb.blockhash;
                // Serialize for client signing (no server signature needed)
                const serializedBurnToBecome = clientBurnTx.serialize({ requireAllSignatures: false }).toString('base64');
                // Store for response
                soulboundResult.burnToBecomeTx = serializedBurnToBecome;
                soulboundResult.burnToBecomeAuthority = burnResult.authority;
                console.log('[BurnPublic] Built client-side burnToBecome TX for', agentId, 'authority:', burnResult.authority);
              } catch (btbErr) {
                console.warn('[BurnPublic] Failed to build client burnToBecome TX:', btbErr.message);
              }
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
          // Client-side burnToBecome TX (when authority != deployer)
          burnToBecomeTx: soulboundResult.burnToBecomeTx || null,
          burnToBecomeAuthority: soulboundResult.burnToBecomeAuthority || null,
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
    const requestedProfileId = req.body && req.body.profileId;
    if (!wallet) return sendJson(400, { error: "wallet required" });
    if (!flow || !["free", "paid"].includes(flow)) return sendJson(400, { error: "flow must be 'free' or 'paid'" });

    (async () => {
      try {
        const { PublicKey } = require("@solana/web3.js");
        try { new PublicKey(wallet); } catch { return sendJson(400, { error: "Invalid wallet" }); }

        const Database = require("better-sqlite3");
        const dbPath = require("path").join(__dirname, "../../data/agentfolio.db");
        const db = new Database(dbPath, { readonly: true });
        const resolvedProfile = await resolveBestProfileForWallet(db, wallet, { preferredProfileId: requestedProfileId });
        const profileId = resolvedProfile?.profile?.id || null;
        db.close();

        // Free flow: check eligibility
        if (flow === "free") {
          if (!profileId) return sendJson(403, { error: "No profile found for this wallet" });
          
          let level = resolvedProfile?.level || 0, rep = resolvedProfile?.rep || 0, isBorn = false;
          try {
            const trust = await loadNormalizedTrust(profileId);
            if (trust && typeof trust.reputationScore === 'number') {
              level = trust.verificationLevel || 0;
              rep = trust.reputationScore > 10000 ? Math.round(trust.reputationScore / 10000) : trust.reputationScore;
            }
          } catch {}
          try {
            const { getV3Score } = require("../v3-score-service");
            const v3 = await getV3Score(profileId);
            if (v3) { isBorn = !!v3.isBorn; }
          } catch {}
          let boaMintCount = 0;
          let recordedBoaMintCount = 0;
          try {
            const onChainMints = await checkOnChainMints(wallet);
            boaMintCount = onChainMints.count || 0;
          } catch {}
          recordedBoaMintCount = getRecordedBoaMintCount({ wallet, agentId: profileId, matchWallet: !requestedProfileId });
          if (level < 3 || rep < 50) return sendJson(403, { error: "Free mint requires Level 3+ and Rep 50+", level, rep });
          if (isBorn || boaMintCount > 0 || recordedBoaMintCount > 0) return sendJson(403, { error: "Free mint already used", isBorn: !!isBorn, boaMintCount, recordedBoaMintCount });
        }

        // === ANTI-GAMING: PDA check DISABLED (2026-03-31) — using isBorn via V3 Genesis Record instead ===
        const agentIdForPda = profileId;

        if (agentIdForPda) {
          try {
            const { Connection: Conn2, SystemProgram: SP2, PublicKey: PK2 } = require("@solana/web3.js");
            const crypto2 = require("crypto");
            const conn2 = new Conn2(process.env.SOLANA_RPC_URL || "https://mainnet.helius-rpc.com/?api-key=91c63e44-1c7a-4b98-830b-6135632565fb", "confirmed");
            const cmState2 = JSON.parse(require("fs").readFileSync("/home/ubuntu/agentfolio/boa-pipeline/candy-machine-data/core-cm-state.json", "utf-8"));
            const agentHash2 = crypto2.createHash("sha256").update(agentIdForPda).digest();
            const cmBytes2 = new PK2(cmState2.candyMachine).toBuffer();
            // PDA: ["boa_mint_tracker", sha256(agent_id), candy_machine_pubkey] — no genesis dependency
            const [mtPda] = PK2.findProgramAddressSync(
              [Buffer.from("boa_mint_tracker"), agentHash2, cmBytes2],
              SP2.programId
            );
            const tInfo = await conn2.getAccountInfo(mtPda);
            if (tInfo) {
              // PDA has lamports = agent already minted
              if (flow === "free") {
                return sendJson(403, { error: "Free mint already used (agent: " + agentIdForPda + ")", mintTrackerPda: mtPda.toBase58() });
              }
              console.log("[PrepareMint] Mint tracker exists for", agentIdForPda, "lamports:", tInfo.lamports);
            } else {
              console.log("[PrepareMint] No mint tracker for", agentIdForPda, "- first mint allowed");
            }
          } catch (e) { console.warn("[PrepareMint] PDA check failed (non-blocking):", e.message); }
        }

        // Build unsigned TX via worker (pass agentId for on-chain PDA creation)
        const { execFile } = require("child_process");
        const workerArgs = ["/home/ubuntu/agentfolio/core-cm-v2/core-cm-prepare-worker.mjs", wallet, flow];
        if (agentIdForPda) workerArgs.push(agentIdForPda);
        execFile("node", workerArgs, {
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
    const requestedProfileId = req.body && req.body.profileId;
    if (!wallet) return sendJson(400, { error: "wallet required" });

    (async () => {
      try {
        // === SATP Identity Gate — ENFORCED (on-chain PDA check) ===
        // Active: wallets without SATP identity PDA are rejected
        // const IDENTITY_PROGRAM = new PublicKey("97yL33fcu6iWT2TdERS5HeqrMSGiUnxuy6nUcTrKieSq");

        const Database = require("better-sqlite3");
        const dbPath = require("path").join(__dirname, "../../data/agentfolio.db");
        
        // === 1. Per-agent mint count (max 3) — tracks by agent_id to prevent wallet-swap gaming ===
        // ON-CHAIN SATP SECURITY — legacy wallet PDA + V3 genesis fallback
        const satpCheck = await checkSatpOnChain(wallet);
        let hasSatpIdentity = satpCheck.hasIdentity;
        if (satpCheck.hasIdentity) {
          console.log("[MintBOA] SATP identity verified via legacy PDA:", satpCheck.identityPda);
        }
        
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
        const resolvedProfile = await resolveBestProfileForWallet(countDb, wallet, { preferredProfileId: requestedProfileId });
        agentIdForCount = resolvedProfile?.profile?.id || null;
        countDb.close();
        
        // Check V3 Genesis Record isBorn (on-chain source of truth)
        if (agentIdForCount) {
          try {
            const { getV3Score } = require("../v3-score-service");
            const v3 = await getV3Score(agentIdForCount);
            if (v3) {
              hasSatpIdentity = true;
              if (v3.isBorn) v3IsBorn = true;
              console.log("[MintBOA] SATP identity verified via V3 genesis for", agentIdForCount);
            }
            console.log("[MintBOA] V3 Genesis Record for", agentIdForCount, "isBorn:", v3IsBorn);
          } catch (e) { console.warn("[MintBOA] V3 check failed:", e.message); }
        }
        if (!hasSatpIdentity) {
          return sendJson(403, { error: "SATP identity required. Verify your wallet at agentfolio.bot/verify first.", identityPDA: satpCheck.identityPda, agentId: agentIdForCount || null });
        }
        
        // Mint count: combine on-chain collection scan, V3 born state, and recorded BOA mints.
        let onChainCount = 0;
        try {
          const onChainResult = await checkOnChainMints(wallet);
          onChainCount = onChainResult.count || 0;
        } catch (e) { console.warn("[MintBOA] On-chain mint check failed:", e.message); }
        let recordedBoaMintCount = 0;
        try {
          recordedBoaMintCount = getRecordedBoaMintCount({ wallet, agentId: agentIdForCount, matchWallet: !requestedProfileId });
        } catch (e) { console.warn("[MintBOA] Recorded mint count failed:", e.message); }
        // On-chain isBorn overrides: if born on-chain, count is at least 1
        const effectiveMintCount = Math.max(onChainCount, recordedBoaMintCount, v3IsBorn ? 1 : 0);
        console.log("[MintBOA] Effective mint count:", effectiveMintCount, "(onChain:", onChainCount, "recorded:", recordedBoaMintCount, "v3IsBorn:", v3IsBorn, ")");

        // === HARD CAP: Max 3 mints per agent ===
        if (effectiveMintCount >= 3) {
          return sendJson(403, { error: "Maximum 3 mints per agent reached.", currentMints: effectiveMintCount, maxMints: 3 });
        }

        // === 2. Unified eligibility check (DB level + rep) ===
        const checkDb = new Database(dbPath, { readonly: true });
        let profileId = resolvedProfile?.profile?.id || null;
        let isEligibleFree = false;
        
        if (profileId) {
          // Use normalized profile trust first, with raw/V2 scoring only as fallback.
          let v3Level = 0, v3Rep = 0, v2Level = 0, v2Rep = 0;
          let level = resolvedProfile?.level || 0, rep = resolvedProfile?.rep || 0;
          try {
            const trust = await loadNormalizedTrust(profileId);
            if (trust && typeof trust.reputationScore === 'number') {
              level = trust.verificationLevel || 0;
              rep = trust.reputationScore > 10000 ? Math.round(trust.reputationScore / 10000) : trust.reputationScore;
            }
          } catch (e) { console.error('[BURN] normalized trust fetch error:', e.message); }
          try {
            const { getV3Score } = require('../v3-score-service');
            const v3 = await getV3Score(profileId);
            if (v3) {
              v3Level = v3.verificationLevel || 0;
              v3Rep = v3.reputationScore || 0;
            }
          } catch (e) { console.error('[BURN] V3 score lookup failed:', e.message); }
          if (!level && !rep) {
            try {
              let getCompleteScore; try { getCompleteScore = require('../lib/scoring-engine-v2').getCompleteScore; } catch(_) { getCompleteScore = () => ({ overall: 0, level: 'Unverified' }); }
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
            level = Math.max(v3Level, v2Level);
            rep = Math.max(v3Rep, v2Rep);
          }
          console.log('[BURN] Score resolution for', profileId, 'normalized/fallback =>', level+'/'+rep, 'V3:', v3Level+'/'+v3Rep, 'V2:', v2Level+'/'+v2Rep);
          isEligibleFree = level >= 3 && rep >= 50;
          console.log("[BURN DEBUG]", { profileId, level, rep, isEligibleFree, effectiveMintCount: typeof effectiveMintCount !== "undefined" ? effectiveMintCount : "not set yet" });
        }
        checkDb.close();

        // === HARD GATE: Profile required for ALL mints ===
        if (!profileId) {
          return sendJson(403, { error: "No AgentFolio profile linked to this wallet. Register at agentfolio.bot first.", wallet });
        }

        // === 3. Determine pricing ===
        // On-chain check: does wallet already own Core NFTs from our collection?
        let onChainMintCount = 0;
        try {
          const onChainResult = await checkOnChainMints(wallet);
          onChainMintCount = onChainResult.count || 0;
          console.log('[BURN] On-chain mint check for', wallet, ':', onChainMintCount, 'NFTs from collection');
        } catch (e) {
          console.error('[BURN] On-chain mint check failed, falling back to DB count:', e.message);
        }
        const isFirstMint = effectiveMintCount === 0 && onChainMintCount === 0;
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
  satpV3Client = createSATPClient({ rpcUrl: process.env.SOLANA_RPC_URL || "https://mainnet.helius-rpc.com/?api-key=91c63e44-1c7a-4b98-830b-6135632565fb" });
  console.log("[BurnToBecome] SATP V3 SDK loaded");
} catch (e) {
  console.warn("[BurnToBecome] SATP V3 SDK not available:", e.message);
}
        // Use Core Candy Machine worker (separate node_modules in core-cm-v2)
        const workerPath = "/home/ubuntu/agentfolio/core-cm-v2/core-cm-mint-worker.mjs";

        execFile("node", [workerPath, wallet], {
          timeout: 120000,
          cwd: "/home/ubuntu/agentfolio/core-cm-v2",
          env: { ...process.env, HOME: process.env.HOME, SOLANA_RPC_URL: process.env.SOLANA_RPC_URL || "https://mainnet.helius-rpc.com/?api-key=91c63e44-1c7a-4b98-830b-6135632565fb" },
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
    const { wallet, profileId, signature, asset, boaId, flow, imageUri: bodyImageUri, metadataUri: bodyMetadataUri, boaName: bodyBoaName } = req.body || {};
    if (!wallet || !signature) return sendJson(400, { error: 'wallet and signature required' });
    
    (async () => {
      try {
        const { Connection, PublicKey } = require('@solana/web3.js');
        const connection = new Connection(process.env.SOLANA_RPC_URL || 'https://mainnet.helius-rpc.com/?api-key=91c63e44-1c7a-4b98-830b-6135632565fb', 'confirmed');
        
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
          const resolvedProfile = await resolveBestProfileForWallet(db, wallet, { preferredProfileId: profileId });
          agentId = resolvedProfile?.profile?.id || null;
          db.close();
        } catch {}
        
        // Resolve actual BOA image from uploaded assets
        let imageUri = '';
        let boaName = '';
        if (boaId) {
          try {
            const uploadedPath = require('path').join('/home/ubuntu/agentfolio/boa-pipeline/candy-machine-data', 'uploaded-assets.json');
            const uploaded = JSON.parse(fs.readFileSync(uploadedPath, 'utf8'));
            const assetData = uploaded[boaId] || uploaded[String(boaId)] || {};
            imageUri = assetData.imageUri || '';
            boaName = assetData.name || ('Burned-Out Agent #' + boaId);
          } catch (e) { console.warn('[ConfirmMint] Could not resolve BOA image:', e.message); }
        }

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
          imageUri,
          boaName,
          timestamp: new Date().toISOString(),
        };
        
        if (!fs.existsSync(MINT_RECORDS_DIR)) fs.mkdirSync(MINT_RECORDS_DIR, { recursive: true });
        fs.writeFileSync(recordPath, JSON.stringify(record, null, 2));
        console.log('[ConfirmMint] Recorded client-signed mint:', effectiveBoaId, 'agent:', agentId, 'sig:', signature.slice(0, 20));
        
        // STEP 1: Resolve artwork URI via DAS (same as Card 2 burn flow)
        let artworkUri = bodyImageUri || imageUri || record.imageUri || '';
        let metadataUri = bodyMetadataUri || '';
        let nftName = bodyBoaName || boaName || 'Burned-Out Agent';
        
        if (!artworkUri && asset) {
          // Try Helius DAS getAsset for the minted BOA
          try {
            const HELIUS_RPC = process.env.SOLANA_RPC_URL || 'https://mainnet.helius-rpc.com/?api-key=91c63e44-1c7a-4b98-830b-6135632565fb';
            const dasResp = await fetch(HELIUS_RPC, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getAsset', params: { id: asset } }),
            });
            const dasData = await dasResp.json();
            const assetContent = dasData.result && dasData.result.content;
            if (assetContent) {
              artworkUri = (assetContent.links && assetContent.links.image) || (assetContent.files && assetContent.files[0] && assetContent.files[0].uri) || '';
              metadataUri = assetContent.json_uri || '';
              nftName = (assetContent.metadata && assetContent.metadata.name || nftName);
              console.log('[ConfirmMint] DAS resolved artwork:', artworkUri?.slice(0, 60));
            }
          } catch (dasErr) { console.warn('[ConfirmMint] DAS artwork resolution failed:', dasErr.message); }
        }
        if (!metadataUri) metadataUri = artworkUri;
        // Card 1/3: Regular tradable NFT — use the minted asset as the profile face reference.
        let soulboundMintAddress = null;
        const faceMintAddress = asset || soulboundMintAddress || null;
        let burnToBecomeResult = null;

        // Keep profile/avatar state in sync for client-signed mints, same as server-side mint-boa.
        if (agentId && artworkUri) {
          try {
            const { loadProfile, saveProfile: _rawSave } = require('../lib/profile');
            const fs = require('fs');
            const path = require('path');
            function saveProfile(profile) {
              _rawSave(profile);
              try { fs.writeFileSync(path.join(__dirname, '../../data/profiles', profile.id + '.json'), JSON.stringify(profile, null, 2)); } catch (e) {}
            }
            const profile = loadProfile(agentId);
            const nftAvatarPayload = {
              chain: 'solana',
              wallet,
              identifier: faceMintAddress || asset || null,
              name: nftName || boaName || 'Burned-Out Agent',
              image: artworkUri,
              arweaveUrl: artworkUri,
              verifiedAt: new Date().toISOString(),
              verifiedOnChain: true,
              permanent: true,
              burnTxSignature: signature || '',
              soulboundMint: faceMintAddress || null,
              boaId: effectiveBoaId,
              mintedAt: new Date().toISOString(),
            };
            if (profile) {
              profile.nftAvatar = nftAvatarPayload;
              profile.avatar = artworkUri;
              profile.boaMint = faceMintAddress || profile.boaMint || null;
              profile.boaId = effectiveBoaId;
              saveProfile(profile);
            }
            try {
              const Database = require('better-sqlite3');
              const directDb = new Database(require('path').join(__dirname, '../../data/agentfolio.db'));
              directDb.prepare('UPDATE profiles SET nft_avatar = ?, avatar = ?, updated_at = ? WHERE id = ?').run(
                JSON.stringify(nftAvatarPayload),
                artworkUri,
                new Date().toISOString(),
                agentId
              );
              directDb.close();
            } catch (dbErr) {
              console.error('[ConfirmMint] Profile DB update failed:', dbErr.message);
            }
            console.log('[ConfirmMint] Profile avatar updated for', agentId, 'mint:', (faceMintAddress || '').slice(0, 16));
          } catch (profileErr) {
            console.warn('[ConfirmMint] Profile avatar sync failed:', profileErr.message);
          }
        }

        // Try to finalize burnToBecome using the minted BOA asset, matching the server-side mint path.
        if (agentId && faceMintAddress) {
          try {
            console.log('[ConfirmMint] Calling burnToBecome:', agentId, 'face:', artworkUri?.slice(0, 40), 'mint:', faceMintAddress?.slice(0, 16));
            burnToBecomeResult = await safeBurnToBecome(agentId, artworkUri || '', faceMintAddress, signature || '');
            if (burnToBecomeResult.success) {
              console.log('[ConfirmMint] V3 burnToBecome recorded:', agentId, 'tx:', burnToBecomeResult.txSignature);
              record.burnToBecomeTx = burnToBecomeResult.txSignature;
            } else if (burnToBecomeResult.needsClientSign) {
              console.log('[ConfirmMint] burnToBecome needs client sign:', agentId, 'authority:', burnToBecomeResult.authority);
              try {
                const v3sdk = require('@brainai/satp-v3');
                const builders = new v3sdk.SatpV3Builders(process.env.SOLANA_RPC_URL || 'https://mainnet.helius-rpc.com/?api-key=91c63e44-1c7a-4b98-830b-6135632565fb');
                const userAuthority = new PublicKey(burnToBecomeResult.authority);
                const faceMintPk = faceMintAddress ? new PublicKey(faceMintAddress) : PublicKey.default;
                const clientBurnTx = await builders.burnToBecome({
                  agentId,
                  authority: userAuthority,
                  faceImage: artworkUri || '',
                  faceMint: faceMintPk,
                  faceBurnTx: signature || '',
                });
                const latestBtb = await connection.getLatestBlockhash('confirmed');
                clientBurnTx.feePayer = userAuthority;
                clientBurnTx.recentBlockhash = latestBtb.blockhash;
                record.burnToBecomeTx = clientBurnTx.serialize({ requireAllSignatures: false }).toString('base64');
                record.burnToBecomeAuthority = burnToBecomeResult.authority;
                console.log('[ConfirmMint] Built client burnToBecome TX for', agentId);
              } catch (btbErr) {
                console.warn('[ConfirmMint] Failed to build client burnToBecome TX:', btbErr.message);
              }
            } else {
              console.log('[ConfirmMint] burnToBecome skipped:', agentId, burnToBecomeResult.reason);
            }
          } catch (e) { console.warn('[ConfirmMint] burnToBecome failed:', e.message); }
        }

        sendJson(200, { success: true, recorded: true, agentId, boaId: effectiveBoaId, soulboundMint: soulboundMintAddress, burnToBecome: burnToBecomeResult, ...record });
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

// Register as Express middleware  
module.exports.registerRoutes = function(app) {
  const { URL } = require('url');
  app.use('/api/burn-to-become', (req, res, next) => {
    try {
      const url = new URL(req.originalUrl || req.url, 'http://localhost');
      const handled = handleBurnToBecome(req, res, url);
      if (!handled) next();
    } catch (e) {
      next(e);
    }
  });
  console.log('[BurnToBecome] Routes registered via Express middleware');
};
