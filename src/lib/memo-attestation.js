/**
 * Memo-based On-chain Verification Attestations
 * Posts structured JSON memos to Solana mainnet for permanent verification records
 */

const { Connection, Keypair, Transaction, TransactionInstruction, PublicKey } = require('@solana/web3.js');
const crypto = require('crypto');
const fs = require('fs');
const logger = require('../logger');

const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const KEYPAIR_PATH = '/home/ubuntu/.config/solana/devnet-deployer.json';
const RPC_URL = process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com';

let _keypair = null;
function getKeypair() {
  if (!_keypair) {
    const raw = JSON.parse(fs.readFileSync(KEYPAIR_PATH, 'utf-8'));
    _keypair = Keypair.fromSecretKey(Uint8Array.from(raw));
  }
  return _keypair;
}

/**
 * Post a verification attestation memo to Solana mainnet
 * @param {string} agentId - The agent profile ID
 * @param {string} platform - Platform verified (github, twitter, solana, hyperliquid, etc.)
 * @param {object} proofData - Proof data to hash (username, address, etc.)
 * @returns {Promise<{signature: string, explorerUrl: string, memo: string}>}
 */
async function postVerificationMemo(agentId, platform, proofData = {}) {
  try {
    const keypair = getKeypair();
    const connection = new Connection(RPC_URL, 'confirmed');
    
    // Create proof hash from proof data
    const proofString = typeof proofData === 'string' ? proofData : JSON.stringify(proofData);
    const proofHash = crypto.createHash('sha256').update(proofString).digest('hex').slice(0, 16);
    
    const memo = JSON.stringify({
      v: 1,
      type: 'verification',
      agent: agentId.slice(0, 64),
      platform: platform.slice(0, 20),
      proof: proofHash,
      ts: Math.floor(Date.now() / 1000)
    });
    
    // Ensure under 566 bytes
    if (Buffer.byteLength(memo) > 566) {
      throw new Error(`Memo too large: ${Buffer.byteLength(memo)} bytes`);
    }
    
    const tx = new Transaction().add(
      new TransactionInstruction({
        keys: [{ pubkey: keypair.publicKey, isSigner: true, isWritable: false }],
        programId: MEMO_PROGRAM_ID,
        data: Buffer.from(memo, 'utf-8')
      })
    );
    
    tx.feePayer = keypair.publicKey;
    const { blockhash } = await connection.getLatestBlockhash('confirmed');
    tx.recentBlockhash = blockhash;
    tx.sign(keypair);
    
    const signature = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed'
    });
    
    // Wait for confirmation
    await connection.confirmTransaction(signature, 'confirmed');
    
    const explorerUrl = `https://explorer.solana.com/tx/${signature}`;
    logger.info(`[MemoAttestation] Posted verification memo: ${platform} for ${agentId} → ${explorerUrl}`);
    
    return { signature, explorerUrl, memo };
  } catch (err) {
    logger.error(`[MemoAttestation] Failed to post memo for ${agentId}/${platform}: ${err.message}`);
    // Don't throw - memo failure shouldn't break verification
    return null;
  }
}

module.exports = { postVerificationMemo };
