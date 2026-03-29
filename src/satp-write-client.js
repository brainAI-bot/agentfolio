/**
 * SATP Write Client
 * Builds and sends transactions to SATP programs (Identity, Reputation, Reviews)
 * Supports both server-signed (platform wallet) and unsigned TX generation (client-side signing)
 */

const { Connection, PublicKey, Keypair, SystemProgram, Transaction } = require('@solana/web3.js');
const { Program, AnchorProvider, Wallet, BN } = require('@coral-xyz/anchor');
const fs = require('fs');
const path = require('path');

// V3 SDK for Genesis Record operations
let SATPV3SDK, createSATPClient, hashAgentId, getGenesisPDA;
try {
  const idx = require('./satp-client/src/index');
  SATPV3SDK = idx.SATPV3SDK;
  createSATPClient = idx.createSATPClient;
  hashAgentId = idx.hashAgentId;
  getGenesisPDA = idx.getGenesisPDA;
  console.log('[SATP Write] V3 SDK loaded');
} catch (e) {
  console.warn('[SATP Write] V3 SDK not available:', e.message);
}

// IDLs
const identityIdl = require('./idl/identity_registry.json');
const reputationIdl = require('./idl/reputation.json');
const reviewsIdl = require('./idl/reviews.json');

// Program IDs — V2 mainnet (canonical)
const MAINNET_IDS = {
  IDENTITY: new PublicKey('97yL33fcu6iWT2TdERS5HeqrMSGiUnxuy6nUcTrKieSq'),
  REVIEWS: new PublicKey('Ge1sD2qwmH8QaaKCPZzZERvsFXNVMvKbAgTp2p17yjLK'),
  REPUTATION: new PublicKey('C9ogv8TBrvFy4pLKDoGQg9B73Q5rKPPsQ4kzkcDk6Jd'),
  ATTESTATIONS: new PublicKey('ENvaD19QzwWWMJFu5r5xJ9SmHqWN6GvyzxACRejqbdug'),
  VALIDATION: new PublicKey('9p795d2j3eGqzborG2AncucWBaU6PieKxmhKVroV3LNh'),
};

// Devnet IDs (from IDL addresses)
const DEVNET_IDS = {
  IDENTITY: new PublicKey(identityIdl.address),
  REPUTATION: new PublicKey(reputationIdl.address),
  REVIEWS: new PublicKey(reviewsIdl.address),
};

function getProgramIds(network) {
  return network === 'devnet' ? DEVNET_IDS : MAINNET_IDS;
}

// Default to mainnet
const PROGRAM_IDS = MAINNET_IDS;

// Network config
const DEVNET_RPC = 'https://api.devnet.solana.com';
const MAINNET_RPC = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

/**
 * Load keypair from file
 */
function loadKeypair(filePath) {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

/**
 * Get Anchor provider for a given network
 */
function getProvider(network = 'devnet', keypair = null) {
  const rpcUrl = network === 'devnet' ? DEVNET_RPC : MAINNET_RPC;
  const connection = new Connection(rpcUrl, 'confirmed');
  
  if (keypair) {
    const wallet = new Wallet(keypair);
    return new AnchorProvider(connection, wallet, { commitment: 'confirmed' });
  }
  
  // Dummy wallet for read-only / unsigned TX building
  const dummyKp = Keypair.generate();
  const wallet = new Wallet(dummyKp);
  return new AnchorProvider(connection, wallet, { commitment: 'confirmed' });
}

/**
 * Get Identity program instance
 */
function getIdentityProgram(provider, network) {
  const ids = getProgramIds(network);
  // Override IDL address with correct network program ID
  const idl = { ...identityIdl, address: ids.IDENTITY.toBase58() };
  return new Program(idl, provider);
}

/**
 * Get Reputation program instance
 */
function getReputationProgram(provider, network) {
  const ids = getProgramIds(network);
  const idl = { ...reputationIdl, address: ids.REPUTATION.toBase58() };
  return new Program(idl, provider);
}

/**
 * Get Reviews program instance
 */
function getReviewsProgram(provider, network) {
  const ids = getProgramIds(network);
  const idl = { ...reviewsIdl, address: ids.REVIEWS.toBase58() };
  return new Program(idl, provider);
}

// ─── PDA Helpers ─────────────────────────────────────────

function getIdentityPDA(authorityPubkey, network) {
  const ids = getProgramIds(network);
  return PublicKey.findProgramAddressSync(
    [Buffer.from('identity'), new PublicKey(authorityPubkey).toBuffer()],
    ids.IDENTITY
  );
}

function getReviewPDA(agentId, reviewerPubkey, network) {
  const ids = getProgramIds(network);
  return PublicKey.findProgramAddressSync(
    [Buffer.from('review'), new PublicKey(agentId).toBuffer(), new PublicKey(reviewerPubkey).toBuffer()],
    ids.REVIEWS
  );
}

function getReviewCounterPDA(agentId, network) {
  const ids = getProgramIds(network);
  return PublicKey.findProgramAddressSync(
    [Buffer.from('review_counter'), new PublicKey(agentId).toBuffer()],
    ids.REVIEWS
  );
}

function getReputationAuthorityPDA(network) {
  const ids = getProgramIds(network);
  return PublicKey.findProgramAddressSync(
    [Buffer.from('reputation_authority')],
    ids.REPUTATION
  );
}

// ─── Write Operations ────────────────────────────────────

/**
 * Register a new agent identity on-chain (server-signed)
 * @param {object} params - { name, description, category, capabilities, metadataUri }
 * @param {Keypair} signerKeypair - The wallet that becomes the identity authority
 * @param {string} network - 'devnet' or 'mainnet'
 * @returns {object} - { txSignature, identityPDA }
 */
async function registerIdentity(params, signerKeypair, network = 'mainnet') {
  const provider = getProvider(network, signerKeypair);
  const program = getIdentityProgram(provider, network);
  
  const { name, description, category, capabilities = [], metadataUri = '' } = params;
  
  const [identityPDA] = getIdentityPDA(signerKeypair.publicKey, network);
  
  // Check if identity PDA already exists — skip creation if so
  const rpcUrl = network === 'devnet' ? DEVNET_RPC : MAINNET_RPC;
  const checkConn = new Connection(rpcUrl, 'confirmed');
  const existingAcct = await checkConn.getAccountInfo(identityPDA);
  if (existingAcct && existingAcct.data.length > 0) {
    console.log(`[SATP Write] Identity PDA already exists for ${signerKeypair.publicKey.toBase58()}, skipping creation`);
    return {
      txSignature: null,
      identityPDA: identityPDA.toBase58(),
      authority: signerKeypair.publicKey.toBase58(),
      network,
      alreadyExists: true,
    };
  }
  
  const tx = await program.methods
    .createIdentity(name, description, category, capabilities, metadataUri)
    .accounts({
      identity: identityPDA,
      authority: signerKeypair.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  
  return {
    txSignature: tx,
    identityPDA: identityPDA.toBase58(),
    authority: signerKeypair.publicKey.toBase58(),
    network,
    alreadyExists: false,
  };
}

/**
 * Build an unsigned identity registration TX (for client-side signing)
 * @param {object} params - { name, description, category, capabilities, metadataUri, walletAddress }
 * @param {string} network - 'devnet' or 'mainnet'
 * @returns {object} - { transaction (base64), identityPDA }
 */
async function buildRegisterIdentityTx(params, network = 'mainnet') {
  const rpcUrl = network === 'devnet' ? DEVNET_RPC : MAINNET_RPC;
  const connection = new Connection(rpcUrl, 'confirmed');
  
  const walletPubkey = new PublicKey(params.walletAddress);
  const [identityPDA] = getIdentityPDA(walletPubkey, network);
  
  const provider = getProvider(network);
  const program = getIdentityProgram(provider, network);
  
  // Check if identity PDA already exists (raw getAccountInfo for cross-version compat)
  const existingAcct2 = await connection.getAccountInfo(identityPDA);
  if (existingAcct2 && existingAcct2.data.length > 0) {
    return {
      transaction: null,
      identityPDA: identityPDA.toBase58(),
      authority: walletPubkey.toBase58(),
      network,
      alreadyExists: true,
    };
  }
  
  const { name, description, category, capabilities = [], metadataUri = '' } = params;
  
  const ix = await program.methods
    .createIdentity(name, description, category, capabilities, metadataUri)
    .accounts({
      identity: identityPDA,
      authority: walletPubkey,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  
  const tx = new Transaction().add(ix);
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;
  tx.feePayer = walletPubkey;
  
  const serialized = tx.serialize({ requireAllSignatures: false }).toString('base64');
  
  return {
    transaction: serialized,
    identityPDA: identityPDA.toBase58(),
    authority: walletPubkey.toBase58(),
    network,
    blockhash,
    lastValidBlockHeight,
    alreadyExists: false,
  };
}

/**
 * Trigger reputation recomputation for an agent
 * @param {string} agentWallet - The agent's wallet address (authority)
 * @param {Keypair} callerKeypair - Any wallet (permissionless)
 * @param {string} network
 * @returns {object} - { txSignature }
 */
async function recomputeReputation(agentWallet, callerKeypair, network = 'mainnet') {
  const provider = getProvider(network, callerKeypair);
  const repProgram = getReputationProgram(provider, network);
  const ids = getProgramIds(network);
  
  const agentPubkey = new PublicKey(agentWallet);
  const [identityPDA] = getIdentityPDA(agentPubkey, network);
  const [repAuthority] = getReputationAuthorityPDA(network);
  
  const tx = await repProgram.methods
    .recomputeReputation()
    .accounts({
      identity: identityPDA,
      reputationAuthority: repAuthority,
      identityProgram: ids.IDENTITY,
      caller: callerKeypair.publicKey,
    })
    .rpc();
  
  return {
    txSignature: tx,
    agentWallet,
    identityPDA: identityPDA.toBase58(),
    network,
  };
}

/**
 * Read an identity from on-chain (using Anchor deserialization)
 */
async function readIdentity(walletAddress, network = 'mainnet') {
  const provider = getProvider(network);
  const program = getIdentityProgram(provider, network);
  
  const [identityPDA] = getIdentityPDA(new PublicKey(walletAddress), network);
  
  try {
    const account = await program.account.agentIdentity.fetch(identityPDA);
    return {
      pda: identityPDA.toBase58(),
      agentId: account.agentId.toBase58(),
      name: account.name,
      description: account.description,
      category: account.category,
      capabilities: account.capabilities,
      metadataUri: account.metadataUri,
      reputationScore: account.reputationScore.toNumber(),
      verificationLevel: account.verificationLevel,
      authority: account.authority.toBase58(),
      createdAt: new Date(account.createdAt.toNumber() * 1000).toISOString(),
      updatedAt: new Date(account.updatedAt.toNumber() * 1000).toISOString(),
      onChain: true,
      network,
    };
  } catch (err) {
    if (err.message.includes('Account does not exist')) return null;
    throw err;
  }
}

// ─── Attestations ────────────────────────────────────────

const attestationsIdl = require('./idl/attestations.json');

function getAttestationsProgram(provider, network) {
  const ids = getProgramIds(network);
  const idl = { ...attestationsIdl, address: ids.ATTESTATIONS.toBase58() };
  return new Program(idl, provider);
}

function getAttestationPDA(agentId, issuerPubkey, attestationType, network) {
  const ids = getProgramIds(network);
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from('attestation'),
      agentId.toBuffer(),
      issuerPubkey.toBuffer(),
      Buffer.from(attestationType),
    ],
    ids.ATTESTATIONS
  );
}

/**
 * Create an attestation for an agent on-chain
 * @param {object} params - { agentId (pubkey string), attestationType, proofData, expiresAt (unix ts or null) }
 * @param {Keypair} signerKeypair - Issuer keypair
 * @param {string} network
 */
async function createAttestation(params, signerKeypair, network = 'mainnet') {
  const provider = getProvider(network, signerKeypair);
  const program = getAttestationsProgram(provider, network);

  const agentPubkey = new PublicKey(params.agentId);
  const [attestationPDA] = getAttestationPDA(agentPubkey, signerKeypair.publicKey, params.attestationType, network);

  const expiresAt = params.expiresAt ? new BN(params.expiresAt) : null;

  const tx = await program.methods
    .createAttestation(agentPubkey, params.attestationType, params.proofData || '', expiresAt)
    .accounts({
      attestation: attestationPDA,
      issuer: signerKeypair.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  return {
    txSignature: tx,
    attestationPDA: attestationPDA.toBase58(),
    agentId: params.agentId,
    attestationType: params.attestationType,
    network,
  };
}

// ─── V3 Operations ───────────────────────────────────────

/**
 * Register a V3 Genesis Record on-chain (server-signed)
 * Uses agent_id string instead of wallet-based PDA derivation
 */
async function registerIdentityV3(params, signerKeypair, network = 'mainnet') {
  if (!SATPV3SDK) throw new Error('V3 SDK not available');
  
  const rpcUrl = network === 'devnet' ? DEVNET_RPC : MAINNET_RPC;
  const sdk = new SATPV3SDK({ network, rpcUrl });
  
  const { agentId, name, description, category, capabilities = [], metadataUri = '' } = params;
  
  const { transaction, genesisPDA } = await sdk.buildCreateIdentity(
    signerKeypair.publicKey, agentId,
    { name, description, category, capabilities, metadataUri }
  );
  
  const connection = new Connection(rpcUrl, 'confirmed');
  const sig = await connection.sendTransaction(transaction, [signerKeypair]);
  await connection.confirmTransaction(sig, 'confirmed');
  
  return {
    txSignature: sig,
    genesisPDA: genesisPDA.toBase58(),
    agentId,
    authority: signerKeypair.publicKey.toBase58(),
    network,
    version: 3,
  };
}

/**
 * Build unsigned V3 identity creation TX (for client-side signing)
 */
async function buildRegisterIdentityV3Tx(params, network = 'mainnet') {
  if (!SATPV3SDK) throw new Error('V3 SDK not available');
  
  const rpcUrl = network === 'devnet' ? DEVNET_RPC : MAINNET_RPC;
  const sdk = new SATPV3SDK({ network, rpcUrl });
  
  const { agentId, name, description, category, capabilities = [], metadataUri = '', walletAddress } = params;
  const wallet = new PublicKey(walletAddress);
  
  const { transaction, genesisPDA } = await sdk.buildCreateIdentity(
    wallet, agentId,
    { name, description, category, capabilities, metadataUri }
  );
  
  const serialized = transaction.serialize({ requireAllSignatures: false }).toString('base64');
  
  return {
    transaction: serialized,
    genesisPDA: genesisPDA.toBase58(),
    agentId,
    authority: wallet.toBase58(),
    network,
    version: 3,
  };
}

/**
 * Read V3 Genesis Record from on-chain
 */
async function readIdentityV3(agentId, network = 'mainnet') {
  if (!SATPV3SDK) throw new Error('V3 SDK not available');
  
  const rpcUrl = network === 'devnet' ? DEVNET_RPC : MAINNET_RPC;
  const sdk = new SATPV3SDK({ network, rpcUrl });
  
  const record = await sdk.getGenesisRecord(agentId);
  if (!record) return null;
  
  return {
    ...record,
    onChain: true,
    network,
    version: 3,
  };
}

module.exports = {
  PROGRAM_IDS,
  loadKeypair,
  getProvider,
  getIdentityProgram,
  getReputationProgram,
  getReviewsProgram,
  getAttestationsProgram,
  getIdentityPDA,
  getReviewPDA,
  getReviewCounterPDA,
  getAttestationPDA,
  registerIdentity,
  buildRegisterIdentityTx,
  recomputeReputation,
  readIdentity,
  createAttestation,
  // V3 operations
  registerIdentityV3,
  buildRegisterIdentityV3Tx,
  readIdentityV3,
  ...(SATPV3SDK ? { SATPV3SDK } : {}),
  ...(hashAgentId ? { hashAgentId } : {}),
  ...(getGenesisPDA ? { getGenesisPDA } : {}),
};
