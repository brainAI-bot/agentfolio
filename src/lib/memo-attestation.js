/**
 * Memo-based On-chain Verification Attestations (V2)
 * Posts structured memos to Solana mainnet for permanent verification records
 * 
 * Memo format: VERIFY|<agent_id>|<platform>|<timestamp>|<proof_hash>
 * 
 * Also stores TX signatures in DB (attestations table) for API retrieval.
 */

const { Connection, Keypair, Transaction, TransactionInstruction, PublicKey } = require('@solana/web3.js');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const KEYPAIR_PATH = process.env.SATP_PLATFORM_KEYPAIR || '/home/ubuntu/.config/solana/brainforge-personal.json';
const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const DB_PATH = path.join(__dirname, '..', '..', 'data', 'agentfolio.db');

let _keypair = null;
function getKeypair() {
  if (!_keypair) {
    const raw = JSON.parse(fs.readFileSync(KEYPAIR_PATH, 'utf-8'));
    _keypair = Keypair.fromSecretKey(Uint8Array.from(raw));
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

/**
 * Initialize attestations table in SQLite
 */
function initAttestationsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS attestations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      tx_signature TEXT NOT NULL,
      memo TEXT NOT NULL,
      proof_hash TEXT NOT NULL,
      signer TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(profile_id, platform)
    );
    CREATE INDEX IF NOT EXISTS idx_attestations_profile ON attestations(profile_id);
  `);
}

/**
 * Get or create DB handle with attestations table
 */
function getAttestationsDb() {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  initAttestationsTable(db);
  return db;
}

/**
 * Post a verification attestation memo to Solana mainnet
 * Format: VERIFY|<agent_id>|<platform>|<timestamp>|<proof_hash>
 */
async function postVerificationMemo(agentId, platform, proofData = {}) {
  try {
    const keypair = getKeypair();
    const connection = getConnection();

    // Create proof hash
    const proofString = typeof proofData === 'string' ? proofData : JSON.stringify(proofData);
    const proofHash = crypto.createHash('sha256').update(proofString).digest('hex').slice(0, 16);
    const ts = Math.floor(Date.now() / 1000);

    // Memo format: pipe-delimited for easy parsing
    const memo = `VERIFY|${agentId}|${platform}|${ts}|${proofHash}`;

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

    await connection.confirmTransaction(signature, 'confirmed');

    const explorerUrl = `https://solscan.io/tx/${signature}`;
    console.log(`[MemoAttestation] ${platform} for ${agentId} → ${explorerUrl}`);

    // Store in DB
    try {
      const db = getAttestationsDb();
      db.prepare(`
        INSERT OR REPLACE INTO attestations (profile_id, platform, tx_signature, memo, proof_hash, signer, created_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(agentId, platform, signature, memo, proofHash, keypair.publicKey.toBase58());
      db.close();
    } catch (dbErr) {
      console.error(`[MemoAttestation] DB save failed: ${dbErr.message}`);
    }

    return { signature, explorerUrl, memo, proofHash };
  } catch (err) {
    console.error(`[MemoAttestation] Failed for ${agentId}/${platform}: ${err.message}`);
    return null;
  }
}

/**
 * Post multiple verification attestations, batching where possible
 * Returns array of results
 */
async function batchPostMemos(items) {
  const results = [];
  for (const item of items) {
    const result = await postVerificationMemo(item.agentId, item.platform, item.proofData || {});
    results.push({ ...item, result });
    // Small delay to avoid RPC rate limits
    await new Promise(r => setTimeout(r, 500));
  }
  return results;
}

/**
 * Get all attestations for a profile
 */
function getAttestations(profileId) {
  try {
    const db = getAttestationsDb();
    const rows = db.prepare('SELECT * FROM attestations WHERE profile_id = ? ORDER BY created_at DESC').all(profileId);
    db.close();
    return rows.map(r => ({
      platform: r.platform,
      tx_signature: r.tx_signature,
      solscan_url: `https://solscan.io/tx/${r.tx_signature}`,
      memo: r.memo,
      proof_hash: r.proof_hash,
      signer: r.signer,
      created_at: r.created_at,
    }));
  } catch (e) {
    console.error(`[MemoAttestation] getAttestations error: ${e.message}`);
    return [];
  }
}

/**
 * Get attestation for a specific platform
 */
function getAttestation(profileId, platform) {
  try {
    const db = getAttestationsDb();
    const row = db.prepare('SELECT * FROM attestations WHERE profile_id = ? AND platform = ?').get(profileId, platform);
    db.close();
    if (!row) return null;
    return {
      platform: row.platform,
      tx_signature: row.tx_signature,
      solscan_url: `https://solscan.io/tx/${row.tx_signature}`,
      memo: row.memo,
      proof_hash: row.proof_hash,
      signer: row.signer,
      created_at: row.created_at,
    };
  } catch (e) {
    return null;
  }
}

module.exports = { postVerificationMemo, batchPostMemos, getAttestations, getAttestation, initAttestationsTable };
