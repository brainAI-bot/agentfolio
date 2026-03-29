/**
 * SATP Write Client — Migrated to @brainai/satp-v3 SDK
 * 
 * Uses SatpV3Builders for type-safe transaction construction.
 * Uses SatpV3Client for on-chain reads.
 * Legacy Anchor/IDL code eliminated — all Borsh handled by SDK.
 */

const { Connection, PublicKey, Keypair, SystemProgram, Transaction } = require('@solana/web3.js');
const fs = require('fs');
const path = require('path');

const {
  SatpV3Client,
  SatpV3Builders,
  deriveGenesisPda,
  deriveReviewPda,
  deriveReviewCounterPda,
  deriveReputationAuthorityPda,
  deriveAttestationPda,
  agentIdHash,
  deserializeGenesis,
  trustTier,
  verificationLabel,
  PROGRAM_IDS,
} = require('@brainai/satp-v3');

// Network config
const DEVNET_RPC = 'https://api.devnet.solana.com';
const MAINNET_RPC = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

function getRpcUrl(network) {
  return network === 'devnet' ? DEVNET_RPC : MAINNET_RPC;
}

/**
 * Load keypair from file
 */
function loadKeypair(filePath) {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

/**
 * Get SatpV3Client for a given network
 */
function getClient(network = 'mainnet') {
  return new SatpV3Client(getRpcUrl(network));
}

// ─── PDA Helpers (re-exports from SDK) ───────────────────

function getIdentityPDA(authorityPubkey, _network) {
  // V3 SDK derives from agentId hash, not authority.
  // For backward compat, this returns genesis PDA if authority is used as agentId.
  return deriveGenesisPda(new PublicKey(authorityPubkey).toBase58());
}

function getReviewPDA(agentId, reviewerPubkey, _network) {
  return deriveReviewPda(agentId, new PublicKey(reviewerPubkey).toBase58());
}

function getReviewCounterPDA(agentId, _network) {
  return deriveReviewCounterPda(agentId);
}

function getReputationAuthorityPDA(_network) {
  return deriveReputationAuthorityPda();
}

function getAttestationPDA(agentId, issuerPubkey, attestationType, _network) {
  return deriveAttestationPda(agentId, new PublicKey(issuerPubkey).toBase58(), attestationType);
}

// ─── Write Operations ────────────────────────────────────

/**
 * Register a new agent identity on-chain (server-signed)
 * Uses SatpV3Builders.createIdentity for type-safe TX construction.
 */
async function registerIdentity(params, signerKeypair, network = 'mainnet') {
  const connection = new Connection(getRpcUrl(network), 'confirmed');
  const { name, description, category, capabilities = [], metadataUri = '' } = params;

  const ix = SatpV3Builders.createIdentity({
    authority: signerKeypair.publicKey.toBase58(),
    agentName: name,
    description,
    category,
    capabilities,
    metadataUri,
  });

  const tx = new Transaction().add(ix);
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;
  tx.feePayer = signerKeypair.publicKey;

  tx.sign(signerKeypair);
  const txSignature = await connection.sendRawTransaction(tx.serialize());
  await connection.confirmTransaction({ signature: txSignature, blockhash, lastValidBlockHeight });

  const [genesisPda] = deriveGenesisPda(name); // agentId = name for initial registration

  return {
    txSignature,
    identityPDA: genesisPda.toBase58(),
    authority: signerKeypair.publicKey.toBase58(),
    network,
  };
}

/**
 * Build an unsigned identity registration TX (for client-side signing)
 */
async function buildRegisterIdentityTx(params, network = 'mainnet') {
  const connection = new Connection(getRpcUrl(network), 'confirmed');
  const walletPubkey = new PublicKey(params.walletAddress);

  const ix = SatpV3Builders.createIdentity({
    authority: walletPubkey.toBase58(),
    agentName: params.name,
    description: params.description,
    category: params.category,
    capabilities: params.capabilities || [],
    metadataUri: params.metadataUri || '',
  });

  const tx = new Transaction().add(ix);
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;
  tx.feePayer = walletPubkey;

  const serialized = tx.serialize({ requireAllSignatures: false }).toString('base64');

  const [genesisPda] = deriveGenesisPda(params.name);

  return {
    transaction: serialized,
    identityPDA: genesisPda.toBase58(),
    authority: walletPubkey.toBase58(),
    network,
    blockhash,
    lastValidBlockHeight,
  };
}

/**
 * Read an identity from on-chain (using SDK client)
 */
async function readIdentity(agentId, network = 'mainnet') {
  const client = getClient(network);
  
  try {
    const result = await client.getGenesis(agentId);
    if (!result || !result.data) return null;
    
    const record = deserializeGenesis(Buffer.from(result.data));
    const tier = trustTier(record.reputationScore);
    
    return {
      pda: result.pda,
      agentName: record.agentName,
      description: record.description,
      category: record.category,
      capabilities: record.capabilities,
      metadataUri: record.metadataUri,
      reputationScore: record.reputationScore,
      reputationPct: record.reputationScore / 10000,
      verificationLevel: record.verificationLevel,
      verificationLabel: verificationLabel(record.verificationLevel),
      trustTier: tier,
      authority: record.authority,
      createdAt: record.genesisRecord ? new Date(record.genesisRecord * 1000).toISOString() : null,
      onChain: true,
      network,
    };
  } catch (err) {
    if (err.message && err.message.includes('not found')) return null;
    throw err;
  }
}

/**
 * Create an attestation for an agent on-chain
 * Uses SatpV3Builders.createAttestation for type-safe TX construction.
 */
async function createAttestation(params, signerKeypair, network = 'mainnet') {
  const connection = new Connection(getRpcUrl(network), 'confirmed');

  const ix = SatpV3Builders.createAttestation({
    agentId: params.agentId,
    issuer: signerKeypair.publicKey.toBase58(),
    attestationType: params.attestationType,
    proofData: params.proofData || '',
    expiresAt: params.expiresAt || null,
  });

  const tx = new Transaction().add(ix);
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;
  tx.feePayer = signerKeypair.publicKey;

  tx.sign(signerKeypair);
  const txSignature = await connection.sendRawTransaction(tx.serialize());
  await connection.confirmTransaction({ signature: txSignature, blockhash, lastValidBlockHeight });

  const [attestationPDA] = deriveAttestationPda(
    params.agentId,
    signerKeypair.publicKey.toBase58(),
    params.attestationType
  );

  return {
    txSignature,
    attestationPDA: attestationPDA.toBase58(),
    agentId: params.agentId,
    attestationType: params.attestationType,
    network,
  };
}

module.exports = {
  PROGRAM_IDS,
  loadKeypair,
  getClient,
  getIdentityPDA,
  getReviewPDA,
  getReviewCounterPDA,
  getAttestationPDA,
  registerIdentity,
  buildRegisterIdentityTx,
  readIdentity,
  createAttestation,
};
