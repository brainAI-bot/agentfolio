/**
 * SATP Reviews — On-Chain Submission Module
 * Ported from brainChain's satp-reviews-api/server.js
 */
const crypto = require('crypto');
const { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, SystemProgram, sendAndConfirmTransaction } = require('@solana/web3.js');

const RPC_URL = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
const WALLET_PATH = process.env.REVIEWS_WALLET_PATH || '/home/ubuntu/.config/solana/devnet-deployer.json';

const PROGRAMS = {
  IDENTITY: new PublicKey('BY4jzmnrui1K5gZ5z5xRQkVfEEMXYHYugtH1Ua867eyr'),
  REPUTATION: new PublicKey('TQ4P9R2Y5FRyw1TZfwoWQ2Mf6XeohbGdhYNcDxh6YYh'),
  ESCROW: new PublicKey('STyY8w4ZHws3X1AMoocWuDYBoogVDwvymPy8Wifx5TH'),
  REVIEWS: new PublicKey('8b2jb9U9whNjRWrCbBVR26AqhkPzXZL3yjBuAzauPYBy'),
};

let signer = null;
let connection = null;

function init() {
  if (connection) return;
  connection = new Connection(RPC_URL, 'confirmed');
  try {
    const fs = require('fs');
    const keyData = JSON.parse(fs.readFileSync(WALLET_PATH, 'utf8'));
    signer = Keypair.fromSecretKey(Uint8Array.from(keyData));
    console.log(`[SATP Reviews] Signer: ${signer.publicKey.toBase58()}`);
  } catch (e) {
    console.error(`[SATP Reviews] No signer wallet: ${e.message}`);
  }
}

function getIdentityPDA(wallet) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('identity'), new PublicKey(wallet).toBuffer()],
    PROGRAMS.IDENTITY
  );
}

function getReviewPDA(escrowPubkey, reviewerIdentityPDA) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('review'), new PublicKey(escrowPubkey).toBuffer(), new PublicKey(reviewerIdentityPDA).toBuffer()],
    PROGRAMS.REVIEWS
  );
}

async function submitOnChain(reviewerWallet, escrowPubkey, reviewedWallet, rating, comment) {
  init();
  if (!signer) return { success: false, error: 'No signer wallet configured' };

  const commentHash = crypto.createHash('sha256').update(comment || '').digest();
  const commentUri = `data:text/plain;hash=${commentHash.toString('hex')}`;
  const discriminator = crypto.createHash('sha256').update('global:submit_review').digest().slice(0, 8);
  const uriBytes = Buffer.from(commentUri, 'utf8');
  const data = Buffer.alloc(8 + 1 + 4 + uriBytes.length + 32);
  let offset = 0;
  discriminator.copy(data, offset); offset += 8;
  data.writeUInt8(rating, offset); offset += 1;
  data.writeUInt32LE(uriBytes.length, offset); offset += 4;
  uriBytes.copy(data, offset); offset += uriBytes.length;
  commentHash.copy(data, offset);

  const reviewerKey = signer.publicKey; // delegated signer
  const [reviewerIdentity] = getIdentityPDA(reviewerKey);
  const escrowKey = new PublicKey(escrowPubkey);
  const reviewedKey = new PublicKey(reviewedWallet);
  const [reviewPDA] = getReviewPDA(escrowKey, reviewerIdentity);
  const [reviewedReputation] = PublicKey.findProgramAddressSync(
    [Buffer.from('reputation'), reviewedKey.toBuffer()], PROGRAMS.REPUTATION
  );

  const ix = new TransactionInstruction({
    keys: [
      { pubkey: reviewerKey, isSigner: true, isWritable: true },
      { pubkey: reviewerIdentity, isSigner: false, isWritable: false },
      { pubkey: escrowKey, isSigner: false, isWritable: false },
      { pubkey: reviewPDA, isSigner: false, isWritable: true },
      { pubkey: reviewedReputation, isSigner: false, isWritable: true },
      { pubkey: PROGRAMS.IDENTITY, isSigner: false, isWritable: false },
      { pubkey: PROGRAMS.ESCROW, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: PROGRAMS.REVIEWS,
    data,
  });

  try {
    const tx = new Transaction().add(ix);
    const txSig = await sendAndConfirmTransaction(connection, tx, [signer], { commitment: 'confirmed' });
    return { success: true, txSignature: txSig, reviewPDA: reviewPDA.toBase58(), commentHash: commentHash.toString('hex') };
  } catch (e) {
    return { success: false, error: e.message?.slice(0, 300) || String(e), reviewPDA: reviewPDA.toBase58(), commentHash: commentHash.toString('hex') };
  }
}

module.exports = { submitOnChain, PROGRAMS };
