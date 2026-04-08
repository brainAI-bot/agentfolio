/**
 * SATP Verification Bridge (V3)
 * 
 * After a verification is confirmed, sends a SINGLE TX with 3 instructions:
 *   1. create_attestation → creates attestation account
 *   2. verify_attestation → marks it verified (same issuer/signer)
 *   3. recompute_score → reads attestations, CPIs score update to identity
 * 
 * No program upgrade needed — uses existing deployed instructions.
 */

const { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, ComputeBudgetProgram } = require('@solana/web3.js');
const crypto = require('crypto');
const fs = require('fs');
const { getV3AttestationPDA, getGenesisPDA: getCanonicalGenesisPDA } = require('../satp-client/src/v3-pda');

// V3 Program IDs (mainnet)
const ATTESTATIONS_PROGRAM = new PublicKey('6Xd1dAQJPvQRJ4Ntr6LtPTjDjPUZ8nfnmYLZaZ2DtrdD');
const IDENTITY_PROGRAM = new PublicKey('GTppU4E44BqXTQgbqMZ68ozFzhP1TLty3EGnzzjtNZfG');

// Attestations authority PDA
const [ATTESTATIONS_AUTHORITY] = PublicKey.findProgramAddressSync(
  [Buffer.from('attestations_v3_authority')],
  ATTESTATIONS_PROGRAM
);

const CONFIGURED_KEYPAIR_PATH = process.env.SATP_PLATFORM_KEYPAIR || '/home/ubuntu/.config/solana/satp-mainnet-platform.json';
const KEYPAIR_PATH = CONFIGURED_KEYPAIR_PATH === '/home/ubuntu/.config/solana/satp-mainnet-platform.json'
  ? '/home/ubuntu/.config/solana/mainnet-deployer.json'
  : CONFIGURED_KEYPAIR_PATH;
const RPC_URL = process.env.SOLANA_RPC_URL || 'https://mainnet.helius-rpc.com/?api-key=REDACTED_HELIUS_API_KEY';

let _keypair = null;
function getKeypair() {
  if (!_keypair) {
    try {
      const raw = JSON.parse(fs.readFileSync(KEYPAIR_PATH, 'utf-8'));
      _keypair = Keypair.fromSecretKey(Uint8Array.from(raw));
    } catch (e) {
      console.error('[SATP Bridge] Cannot load keypair:', e.message);
    }
  }
  return _keypair;
}

let _connection = null;
function getConnection() {
  if (!_connection) {
    _connection = new Connection(RPC_URL, 'confirmed');
  }
  return _connection;
}

function anchorDisc(name) {
  return crypto.createHash('sha256').update(`global:${name}`).digest().slice(0, 8);
}

function encodeString(s) {
  const buf = Buffer.from(s, 'utf8');
  const len = Buffer.alloc(4);
  len.writeUInt32LE(buf.length);
  return Buffer.concat([len, buf]);
}

function hashAgentId(agentId) {
  return crypto.createHash('sha256').update(agentId).digest();
}

function getAttestationPDA(agentId, issuer, attestationType) {
  return getV3AttestationPDA(agentId, new PublicKey(issuer), attestationType, 'mainnet');
}

function getGenesisPDA(agentId) {
  return getCanonicalGenesisPDA(agentId, 'mainnet');
}

function logBridgeError(context, error) {
  const message = error?.message || String(error);
  const logs = Array.isArray(error?.logs) ? error.logs : [];
  console.error('[SATP Bridge] ' + context + ': ' + message.slice(0, 300));
  logs.slice(-20).forEach(l => console.error('  ', l));
  if (error?.stack) {
    console.error(error.stack.split('\n').slice(0, 6).join('\n'));
  }
}

/**
 * Full verification flow in ONE transaction:
 *   IX 1: create_attestation (verified=false)
 *   IX 2: verify_attestation (sets verified=true, same signer)
 *   IX 3: recompute_score (counts verified attestations, CPIs to identity)
 *
 * @param {string} agentId - Agent identifier (profile slug)
 * @param {string} platform - Verification platform (solana, telegram, discord, etc.)
 * @param {object} proofObj - Proof data
 * @returns {Promise<{txSignature: string}|null>}
 */
async function postVerificationAttestation(agentId, platform, proofObj) {
  const keypair = getKeypair();
  if (!keypair) {
    console.warn('[SATP Bridge] No keypair — skipping');
    return null;
  }

  const conn = getConnection();
  const proofData = JSON.stringify(proofObj).slice(0, 512);
  const attestationType = `verification_${platform}`;
  const [attPDA] = getAttestationPDA(agentId, keypair.publicKey, attestationType);
  const [genesisPDA] = getGenesisPDA(agentId);

  // Check if attestation already exists
  try {
    const existing = await conn.getAccountInfo(attPDA);
    if (existing && existing.data.length > 0) {
      console.log(`[SATP Bridge] Attestation already exists for ${agentId}/${platform} — skipping create, triggering recompute`);
      // Just trigger recompute (attestation may not be verified yet)
      return await triggerRecomputeOnly(agentId, keypair, conn);
    }
  } catch (_) {}

  // Check genesis exists (needed for recompute)
  const genesisAcct = await conn.getAccountInfo(genesisPDA);
  if (!genesisAcct) {
    console.warn(`[SATP Bridge] No genesis record for ${agentId} — cannot recompute score`);
    // Still create the attestation (score will be computed later when genesis exists)
    return await createAttestationOnly(agentId, attestationType, proofData, attPDA, keypair, conn);
  }

  // Build 3-instruction TX
  console.log(`[SATP Bridge] Creating verified attestation + recompute for ${agentId}/${platform} (proofBytes=${Buffer.byteLength(proofData, 'utf8')}, attPDA=${attPDA.toBase58()})`);
  
  const tx = new Transaction();
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 }));
  tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 5000 }));

  // IX 1: create_attestation
  tx.add(new TransactionInstruction({
    programId: ATTESTATIONS_PROGRAM,
    keys: [
      { pubkey: attPDA, isSigner: false, isWritable: true },
      { pubkey: keypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([
      anchorDisc('create_attestation'),
      encodeString(agentId),
      encodeString(attestationType),
      encodeString(proofData),
      Buffer.from([0]), // expires_at: None
    ]),
  }));

  // IX 2: verify_attestation (same signer = issuer)
  tx.add(new TransactionInstruction({
    programId: ATTESTATIONS_PROGRAM,
    keys: [
      { pubkey: attPDA, isSigner: false, isWritable: true },
      { pubkey: keypair.publicKey, isSigner: true, isWritable: false },
    ],
    data: anchorDisc('verify_attestation'),
  }));

  // IX 3: recompute_score
  // Collect all existing attestations for this agent + the new one
  const existingAtts = await getAgentAttestations(agentId, conn);
  const allAtts = [...new Set([attPDA.toBase58(), ...existingAtts.map(a => a.toBase58())])].map(a => new PublicKey(a));

  const recomputeKeys = [
    { pubkey: genesisPDA, isSigner: false, isWritable: true },
    { pubkey: ATTESTATIONS_AUTHORITY, isSigner: false, isWritable: false },
    { pubkey: IDENTITY_PROGRAM, isSigner: false, isWritable: false },
    { pubkey: keypair.publicKey, isSigner: true, isWritable: true },
  ];
  // Add attestations as remaining_accounts
  for (const att of allAtts.slice(0, 20)) {
    recomputeKeys.push({ pubkey: att, isSigner: false, isWritable: false });
  }

  tx.add(new TransactionInstruction({
    programId: ATTESTATIONS_PROGRAM,
    keys: recomputeKeys,
    data: anchorDisc('recompute_score'),
  }));

  try {
    const sig = await conn.sendTransaction(tx, [keypair], { skipPreflight: false });
    await conn.confirmTransaction(sig, 'confirmed');
    console.log(`[SATP Bridge] ✅ Created + verified + recomputed for ${agentId}/${platform} TX: ${sig}`);
    return { txSignature: sig, attestationPDA: attPDA.toBase58() };
  } catch (e) {
    const logs = Array.isArray(e?.logs) ? e.logs : [];
    logBridgeError(`TX failed for ${agentId}/${platform}`, e);
    const lower = ((e?.message || '') + ' ' + logs.join(' ')).toLowerCase();
    if (lower.includes('already in use')) {
      return await triggerRecomputeOnly(agentId, keypair, conn);
    }
    throw e;
  }
}

/**
 * Get all attestation accounts for an agent
 */
async function getAgentAttestations(agentId, conn) {
  try {
    const allAccounts = await conn.getProgramAccounts(ATTESTATIONS_PROGRAM, {
      filters: [{ dataSize: 744 }], // Attestation account size
    });
    const results = [];
    for (const a of allAccounts) {
      const d = a.account.data;
      if (d.length < 12) continue;
      const idLen = d.readUInt32LE(8);
      if (idLen > 64 || 12 + idLen > d.length) continue;
      const id = d.slice(12, 12 + idLen).toString();
      if (id === agentId) results.push(a.pubkey);
    }
    return results;
  } catch (e) {
    console.warn('[SATP Bridge] Failed to fetch attestations:', e.message?.slice(0, 100));
    return [];
  }
}

/**
 * Create attestation only (no genesis → can't recompute)
 */
async function createAttestationOnly(agentId, attestationType, proofData, attPDA, keypair, conn) {
  console.log(`[SATP Bridge] createAttestationOnly start for ${agentId}/${attestationType} (proofBytes=${Buffer.byteLength(proofData, 'utf8')}, attPDA=${attPDA.toBase58()})`);
  const tx = new Transaction();
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 150000 }));
  tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 5000 }));
  // create
  tx.add(new TransactionInstruction({
    programId: ATTESTATIONS_PROGRAM,
    keys: [
      { pubkey: attPDA, isSigner: false, isWritable: true },
      { pubkey: keypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([
      anchorDisc('create_attestation'),
      encodeString(agentId),
      encodeString(attestationType),
      encodeString(proofData),
      Buffer.from([0]),
    ]),
  }));
  // verify
  tx.add(new TransactionInstruction({
    programId: ATTESTATIONS_PROGRAM,
    keys: [
      { pubkey: attPDA, isSigner: false, isWritable: true },
      { pubkey: keypair.publicKey, isSigner: true, isWritable: false },
    ],
    data: anchorDisc('verify_attestation'),
  }));

  try {
    const sig = await conn.sendTransaction(tx, [keypair], { skipPreflight: false });
    await conn.confirmTransaction(sig, 'confirmed');
    console.log(`[SATP Bridge] Created + verified (no recompute — no genesis): TX ${sig}`);
    return { txSignature: sig, attestationPDA: attPDA.toBase58() };
  } catch (e) {
    const logs = Array.isArray(e?.logs) ? e.logs : [];
    logBridgeError(`createAttestationOnly failed for ${agentId}/${attestationType}`, e);
    const lower = ((e?.message || '') + ' ' + logs.join(' ')).toLowerCase();
    if (lower.includes('already in use')) {
      console.warn(`[SATP Bridge] Attestation already exists for ${agentId}/${attestationType} while in create-only mode`);
      return { txSignature: null, attestationPDA: attPDA.toBase58(), alreadyExisted: true };
    }
    return null;
  }
}

/**
 * Recompute only (attestation already exists)
 */
async function triggerRecomputeOnly(agentId, keypair, conn) {
  const [genesisPDA] = getGenesisPDA(agentId);
  const genesisAcct = await conn.getAccountInfo(genesisPDA);
  if (!genesisAcct) {
    console.warn(`[SATP Bridge] No genesis for recompute: ${agentId}`);
    return null;
  }

  const atts = await getAgentAttestations(agentId, conn);
  const recomputeKeys = [
    { pubkey: genesisPDA, isSigner: false, isWritable: true },
    { pubkey: ATTESTATIONS_AUTHORITY, isSigner: false, isWritable: false },
    { pubkey: IDENTITY_PROGRAM, isSigner: false, isWritable: false },
    { pubkey: keypair.publicKey, isSigner: true, isWritable: true },
  ];
  for (const att of atts.slice(0, 20)) {
    recomputeKeys.push({ pubkey: att, isSigner: false, isWritable: false });
  }

  const tx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 300000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 5000 }),
    new TransactionInstruction({
      programId: ATTESTATIONS_PROGRAM,
      keys: recomputeKeys,
      data: anchorDisc('recompute_score'),
    })
  );

  try {
    const sig = await conn.sendTransaction(tx, [keypair], { skipPreflight: false });
    await conn.confirmTransaction(sig, 'confirmed');
    console.log(`[SATP Bridge] Recomputed score for ${agentId}: TX ${sig}`);
    return { txSignature: sig };
  } catch (e) {
    logBridgeError(`recompute failed for ${agentId}`, e);
    throw e;
  }
}

module.exports = {
  postVerificationAttestation,
  getAgentAttestations,
  triggerRecomputeOnly,
};
