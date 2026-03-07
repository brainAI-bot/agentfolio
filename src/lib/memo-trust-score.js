/**
 * Memo-based Trust Score Attestations
 * Posts trust score updates as Solana memos for on-chain verifiability
 */

const { Connection, Keypair, Transaction, TransactionInstruction, PublicKey } = require('@solana/web3.js');
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
 * Post a trust score update memo to Solana mainnet
 * @param {string} agentId - The agent profile ID
 * @param {number} score - Trust score (0-100)
 * @param {object} breakdown - Score breakdown by category
 * @returns {Promise<{signature: string, explorerUrl: string, memo: string}|null>}
 */
async function postTrustScoreMemo(agentId, score, breakdown = {}) {
  try {
    const keypair = getKeypair();
    const connection = new Connection(RPC_URL, 'confirmed');
    
    // Compact breakdown to fit memo limit
    const compactBreakdown = {};
    for (const [k, v] of Object.entries(breakdown)) {
      compactBreakdown[k.slice(0, 10)] = typeof v === 'number' ? Math.round(v) : v;
    }
    
    const memo = JSON.stringify({
      v: 1,
      type: 'trust_score',
      agent: agentId.slice(0, 64),
      score: Math.round(score),
      bd: compactBreakdown,
      ts: Math.floor(Date.now() / 1000)
    });
    
    if (Buffer.byteLength(memo) > 566) {
      // Fallback: drop breakdown if too large
      const fallback = JSON.stringify({
        v: 1,
        type: 'trust_score',
        agent: agentId.slice(0, 64),
        score: Math.round(score),
        ts: Math.floor(Date.now() / 1000)
      });
      if (Buffer.byteLength(fallback) > 566) {
        throw new Error('Memo too large even without breakdown');
      }
    }
    
    const memoData = Buffer.byteLength(memo) <= 566 ? memo : JSON.stringify({
      v: 1, type: 'trust_score', agent: agentId.slice(0, 64),
      score: Math.round(score), ts: Math.floor(Date.now() / 1000)
    });
    
    const tx = new Transaction().add(
      new TransactionInstruction({
        keys: [{ pubkey: keypair.publicKey, isSigner: true, isWritable: false }],
        programId: MEMO_PROGRAM_ID,
        data: Buffer.from(memoData, 'utf-8')
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
    
    await connection.confirmTransaction(signature, 'confirmed');
    
    const explorerUrl = `https://explorer.solana.com/tx/${signature}`;
    logger.info(`[MemoTrustScore] Posted trust score memo: ${agentId} score=${score} → ${explorerUrl}`);
    
    return { signature, explorerUrl, memo: memoData };
  } catch (err) {
    logger.error(`[MemoTrustScore] Failed: ${err.message}`);
    return null;
  }
}

module.exports = { postTrustScoreMemo };
