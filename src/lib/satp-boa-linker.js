/**
 * SATP BOA Linker
 * After burn-to-become mints a soulbound token, link it to the SATP identity
 * via update_identity (metadata_uri → includes soulbound mint reference)
 * 
 * Also creates an on-chain attestation recording the BOA → SATP link
 */

const { Connection, PublicKey, SystemProgram, Transaction, TransactionInstruction, Keypair, ComputeBudgetProgram } = require('@solana/web3.js');
const crypto = require('crypto');
const fs = require('fs');

// SATP v2 Identity Registry — Mainnet
const SATP_IDENTITY_PROGRAM = new PublicKey('97yL33fcu6iWT2TdERS5HeqrMSGiUnxuy6nUcTrKieSq');
// SATP Attestations Program
const SATP_ATTESTATIONS_PROGRAM = new PublicKey('ENvaD19QzwWWMJFu5r5xJ9SmHqWN6GvyzxACRejqbdug');

const NETWORK = process.env.SATP_NETWORK || 'mainnet';
const RPC_URL = NETWORK === 'devnet'
  ? 'https://api.devnet.solana.com'
  : (process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com');

const DEPLOYER_KEY_PATH = process.env.DEPLOYER_KEY_PATH || '/home/ubuntu/.config/solana/mainnet-deployer.json';

const connection = new Connection(RPC_URL, 'confirmed');

function anchorDisc(name) {
  return crypto.createHash('sha256').update(`global:${name}`).digest().slice(0, 8);
}

function encodeString(s) {
  const buf = Buffer.from(s, 'utf8');
  const len = Buffer.alloc(4);
  len.writeUInt32LE(buf.length);
  return Buffer.concat([len, buf]);
}

function encodeOption(value, encoder) {
  if (value === null || value === undefined) {
    return Buffer.from([0]); // None
  }
  return Buffer.concat([Buffer.from([1]), encoder(value)]); // Some
}

function encodeOptionString(s) {
  return encodeOption(s, encodeString);
}

function encodeOptionVecString(arr) {
  return encodeOption(arr, (a) => {
    const count = Buffer.alloc(4);
    count.writeUInt32LE(a.length);
    return Buffer.concat([count, ...a.map(s => encodeString(s))]);
  });
}

function getIdentityPDA(authority) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('identity'), new PublicKey(authority).toBuffer()],
    SATP_IDENTITY_PROGRAM
  );
}

function getAttestationPDA(agentId, issuerPubkey, attestationType) {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from('attestation'),
      new PublicKey(agentId).toBuffer(),
      issuerPubkey.toBuffer(),
      Buffer.from(attestationType),
    ],
    SATP_ATTESTATIONS_PROGRAM
  );
}

/**
 * Link a soulbound BOA to an SATP identity
 * 1. Update the identity's metadata_uri to reference the soulbound mint
 * 2. Create an attestation recording the BOA link
 * 
 * @param {string} walletAddress - The agent's wallet
 * @param {string} soulboundMint - The soulbound Token-2022 mint address
 * @param {string} burnTx - The burn transaction signature
 * @param {string} artworkUri - The artwork/image URI
 * @returns {object} - { updateTx, attestationTx }
 */
async function linkBoaToSatpIdentity(walletAddress, soulboundMint, burnTx, artworkUri) {
  let deployerKeypair;
  try {
    const keyData = JSON.parse(fs.readFileSync(DEPLOYER_KEY_PATH));
    deployerKeypair = Keypair.fromSecretKey(Uint8Array.from(keyData));
  } catch (e) {
    console.warn('[SATP BOA Linker] Deployer key not found, skipping link');
    return { updateTx: null, attestationTx: null };
  }

  const wallet = new PublicKey(walletAddress);
  const [identityPDA] = getIdentityPDA(wallet);

  // Check if identity exists
  const identityAcct = await connection.getAccountInfo(identityPDA);
  if (!identityAcct || identityAcct.data.length === 0) {
    console.log(`[SATP BOA Linker] No SATP identity for ${walletAddress}, skipping link`);
    return { updateTx: null, attestationTx: null, reason: 'no_identity' };
  }

  let attestationTxSig = null;

  // Create attestation: "boa_soulbound" type
  try {
    const attestationType = 'boa_soulbound';
    const proofData = JSON.stringify({
      soulboundMint,
      burnTx,
      artworkUri,
      linkedAt: new Date().toISOString(),
    });

    const [attestationPDA] = getAttestationPDA(wallet, deployerKeypair.publicKey, attestationType);

    // Check if attestation already exists
    const existingAttestation = await connection.getAccountInfo(attestationPDA);
    if (existingAttestation && existingAttestation.data.length > 0) {
      console.log(`[SATP BOA Linker] Attestation already exists for ${walletAddress}`);
      return { updateTx: null, attestationTx: null, reason: 'already_linked' };
    }

    const disc = anchorDisc('create_attestation');
    // create_attestation(agent_id: Pubkey, attestation_type: String, proof_data: String, expires_at: Option<i64>)
    const agentIdBytes = wallet.toBuffer(); // 32 bytes
    const data = Buffer.concat([
      disc,
      agentIdBytes,
      encodeString(attestationType),
      encodeString(proofData.slice(0, 256)), // Anchor may limit string length
      Buffer.from([0]), // None for expires_at (Option<i64>)
    ]);

    const ix = new TransactionInstruction({
      programId: SATP_ATTESTATIONS_PROGRAM,
      keys: [
        { pubkey: attestationPDA, isSigner: false, isWritable: true },
        { pubkey: deployerKeypair.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });

    const tx = new Transaction();
    tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100000 }));
    tx.add(ix);
    tx.feePayer = deployerKeypair.publicKey;
    const { blockhash } = await connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;

    attestationTxSig = await connection.sendTransaction(tx, [deployerKeypair]);
    await connection.confirmTransaction(attestationTxSig, 'confirmed');

    console.log(`[SATP BOA Linker] Attestation created: ${attestationTxSig}`);
  } catch (e) {
    console.warn('[SATP BOA Linker] Attestation creation failed (non-blocking):', e.message);
  }

  return {
    updateTx: null, // update_identity requires wallet signer — can't do server-side
    attestationTx: attestationTxSig,
    identityPDA: identityPDA.toBase58(),
    soulboundMint,
  };
}

module.exports = { linkBoaToSatpIdentity, getIdentityPDA };
