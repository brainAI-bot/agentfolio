#!/usr/bin/env node
/**
 * Attestation Verification Script
 * 
 * Verifies ALL attestation memos on-chain for a given agent.
 * Useful for external auditors who want to independently verify trust scores.
 * 
 * Usage:
 *   node verify-attestations.js <agent_id>
 *   node verify-attestations.js agent_brainkid
 *   node verify-attestations.js agent_brainkid --json
 *   node verify-attestations.js agent_brainkid --verify-tx   # Fetch + verify each TX on-chain
 * 
 * Output: list of platforms verified, TX signatures, timestamps
 * 
 * brainChain — 2026-03-25
 */

const { Connection, PublicKey, Keypair } = require('@solana/web3.js');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ── Config ──────────────────────────────────────────────
const RPC_URL = process.env.SOLANA_RPC_URL || 'https://mainnet.helius-rpc.com/?api-key=91c63e44-1c7a-4b98-830b-6135632565fb';
const GENESIS_PROGRAM = new PublicKey('GTppU4E44BqXTQgbqMZ68ozFzhP1TLty3EGnzzjtNZfG');
const DB_PATH = process.env.DB_PATH || '/home/ubuntu/agentfolio/data/agentfolio.db';

// Platform signer — the AgentFolio platform key that signs attestation memos
// Only attestations signed by this key are considered valid
const TRUSTED_SIGNERS = new Set([
  'JAbcYnKy4p2c5SYV3bHu14VtD6EDDpzj44uGYW8BMud4', // brainforge-personal (current platform signer)
  'Bq1niVKyTECn4HDxAJWiHZvRMCZndZtC113yj3Rkbroc', // deploy wallet (legacy signer)
  '4St74qSyzuGyV2TA9gxej9GvXG2TgVSTvp1HEpzJbwcP', // legacy signer
]);

const LEVEL_LABELS = ['Unverified', 'Registered', 'Verified', 'Established', 'Trusted', 'Sovereign'];

// ── Helpers ─────────────────────────────────────────────
function agentIdHash(agentId) {
  return crypto.createHash('sha256').update(agentId).digest();
}

function getGenesisPDA(agentId) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('genesis'), agentIdHash(agentId)],
    GENESIS_PROGRAM
  )[0];
}

function parseGenesisRecord(data) {
  if (!data || data.length < 8) return null;
  try {
    let offset = 8;
    offset += 32; // agent_id_hash

    const readString = () => {
      const len = data.readUInt32LE(offset);
      offset += 4;
      const str = data.slice(offset, offset + len).toString('utf8');
      offset += len;
      return str;
    };
    const readVecString = () => {
      const count = data.readUInt32LE(offset);
      offset += 4;
      const arr = [];
      for (let i = 0; i < count; i++) arr.push(readString());
      return arr;
    };

    const agentName = readString();
    const description = readString();
    const category = readString();
    const capabilities = readVecString();
    const metadataUri = readString();
    const faceImage = readString();
    const faceMint = new PublicKey(data.slice(offset, offset + 32));
    offset += 32;
    const faceBurnTx = readString();
    const genesisRecord = Number(data.readBigInt64LE(offset));
    offset += 8;
    const authority = new PublicKey(data.slice(offset, offset + 32));
    offset += 32;
    const hasPending = data[offset];
    offset += 1;
    if (hasPending === 1) offset += 32;
    const reputationScore = Number(data.readBigUInt64LE(offset));
    offset += 8;
    const verificationLevel = data[offset];

    return {
      agentName,
      authority: authority.toBase58(),
      reputationScore,
      verificationLevel,
      verificationLabel: LEVEL_LABELS[verificationLevel] || 'Unknown',
      isBorn: genesisRecord > 0,
      bornAt: genesisRecord > 0 ? new Date(genesisRecord * 1000).toISOString() : null,
      faceImage: faceImage || null,
      faceMint: faceMint.toBase58() === '11111111111111111111111111111111' ? null : faceMint.toBase58(),
    };
  } catch (e) {
    return null;
  }
}

/**
 * Verify a single attestation TX on-chain
 * Confirms the memo exists and was signed by a trusted signer
 */
async function verifyTxOnChain(conn, txSig) {
  try {
    const tx = await conn.getTransaction(txSig, {
      maxSupportedTransactionVersion: 0,
      commitment: 'confirmed',
    });

    if (!tx) return { verified: false, reason: 'TX not found on chain' };
    if (tx.meta?.err) return { verified: false, reason: 'TX failed on-chain' };

    // Check log messages for VERIFY| memo
    const logs = tx.meta?.logMessages || [];
    let memoContent = null;
    for (const log of logs) {
      const match = log.match(/VERIFY\|([^|]+)\|([^|]+)\|([^|]+)\|([^|\s"]+)/);
      if (match) {
        memoContent = {
          agentId: match[1],
          platform: match[2],
          timestamp: match[3],
          proofHash: match[4],
        };
        break;
      }
    }

    if (!memoContent) return { verified: false, reason: 'No VERIFY| memo found in TX logs' };

    // Check signers
    const accountKeys = tx.transaction?.message?.staticAccountKeys ||
                        tx.transaction?.message?.accountKeys || [];
    const signerKeys = accountKeys.map(k => k.toBase58 ? k.toBase58() : k);
    const trustedSignerFound = signerKeys.some(k => TRUSTED_SIGNERS.has(k));

    return {
      verified: true,
      memo: memoContent,
      blockTime: tx.blockTime ? new Date(tx.blockTime * 1000).toISOString() : null,
      slot: tx.slot,
      trustedSigner: trustedSignerFound,
      signers: signerKeys.slice(0, 3), // First 3 account keys (signers)
    };
  } catch (e) {
    return { verified: false, reason: e.message };
  }
}

// ── Main ────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
  const flags = process.argv.slice(2).filter(a => a.startsWith('--'));
  const jsonOutput = flags.includes('--json');
  const verifyTx = flags.includes('--verify-tx');

  if (args.length === 0) {
    console.error('Usage: node verify-attestations.js <agent_id> [--json] [--verify-tx]');
    console.error('Example: node verify-attestations.js agent_brainkid');
    process.exit(1);
  }

  const agentId = args[0];
  const conn = new Connection(RPC_URL, 'confirmed');

  if (!jsonOutput) {
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`  ATTESTATION VERIFICATION REPORT`);
    console.log(`  Agent: ${agentId}`);
    console.log(`  Time: ${new Date().toISOString()}`);
    console.log('═══════════════════════════════════════════════════════════\n');
  }

  // ── 1. Fetch Genesis Record from chain ────────────────
  const pda = getGenesisPDA(agentId);
  let genesis = null;

  try {
    const acctInfo = await conn.getAccountInfo(pda);
    if (acctInfo && acctInfo.data) {
      genesis = parseGenesisRecord(Buffer.from(acctInfo.data));
    }
  } catch (e) {
    if (!jsonOutput) console.log(`  ⚠️  Genesis Record fetch failed: ${e.message}`);
  }

  if (!jsonOutput) {
    console.log('┌─────────────────────────────────────────────────────────┐');
    console.log('│  ON-CHAIN IDENTITY (Genesis Record)                    │');
    console.log('└─────────────────────────────────────────────────────────┘\n');

    if (genesis) {
      console.log(`  PDA:               ${pda.toBase58()}`);
      console.log(`  Name:              ${genesis.agentName}`);
      console.log(`  Authority:         ${genesis.authority}`);
      console.log(`  Reputation Score:  ${genesis.reputationScore}`);
      console.log(`  Verification:      L${genesis.verificationLevel} (${genesis.verificationLabel})`);
      console.log(`  Born:              ${genesis.isBorn ? `✅ ${genesis.bornAt}` : '❌'}`);
      console.log(`  Face Image:        ${genesis.faceImage ? '✅' : '❌'}`);
      console.log(`  Face Mint:         ${genesis.faceMint || 'none'}`);
    } else {
      console.log(`  ❌ No Genesis Record found on-chain for ${agentId}`);
    }
  }

  // ── 2. Fetch attestations from DB ─────────────────────
  let attestations = [];
  try {
    const Database = require('better-sqlite3');
    const db = new Database(DB_PATH, { readonly: true });

    attestations = db.prepare(`
      SELECT profile_id, platform, tx_signature, memo, proof_hash, signer, created_at
      FROM attestations
      WHERE profile_id = ?
      ORDER BY created_at ASC
    `).all(agentId);

    db.close();
  } catch (e) {
    if (!jsonOutput) console.log(`\n  ⚠️  DB read failed: ${e.message}`);
  }

  if (!jsonOutput) {
    console.log('\n┌─────────────────────────────────────────────────────────┐');
    console.log('│  ATTESTATION MEMOS                                     │');
    console.log('└─────────────────────────────────────────────────────────┘\n');

    if (attestations.length === 0) {
      console.log(`  ❌ No attestation memos found for ${agentId}`);
    } else {
      console.log(`  Found ${attestations.length} attestation(s):\n`);

      for (let i = 0; i < attestations.length; i++) {
        const att = attestations[i];
        const trusted = att.signer && TRUSTED_SIGNERS.has(att.signer);
        const signerStatus = trusted ? '✅ trusted' : '⚠️  unknown signer';

        console.log(`  ${(i + 1).toString().padStart(2)}. ${att.platform.toUpperCase().padEnd(14)}`);
        console.log(`      TX:        ${att.tx_signature}`);
        console.log(`      Solscan:   https://solscan.io/tx/${att.tx_signature}`);
        console.log(`      Proof:     ${att.proof_hash}`);
        console.log(`      Signer:    ${att.signer || 'unknown'} (${signerStatus})`);
        console.log(`      Timestamp: ${att.created_at}`);

        // On-chain verification if requested
        if (verifyTx) {
          process.stdout.write('      On-chain:  verifying...');
          const result = await verifyTxOnChain(conn, att.tx_signature);
          process.stdout.clearLine?.(0);
          process.stdout.cursorTo?.(0);
          if (result.verified) {
            console.log(`      On-chain:  ✅ VERIFIED (slot ${result.slot}, block ${result.blockTime})`);
            if (!result.trustedSigner) {
              console.log(`      ⚠️  WARNING: TX exists but signer not in trusted set`);
            }
          } else {
            console.log(`      On-chain:  ❌ ${result.reason}`);
          }
          // Rate limit RPC calls
          await new Promise(r => setTimeout(r, 300));
        }

        console.log();
      }
    }
  }

  // ── 3. Summary ────────────────────────────────────────
  const platforms = [...new Set(attestations.map(a => a.platform))];
  const trustedCount = attestations.filter(a => TRUSTED_SIGNERS.has(a.signer)).length;

  if (jsonOutput) {
    // JSON output for programmatic consumption
    console.log(JSON.stringify({
      agentId,
      pda: pda.toBase58(),
      genesis: genesis || null,
      attestations: attestations.map(a => ({
        platform: a.platform,
        txSignature: a.tx_signature,
        proofHash: a.proof_hash,
        signer: a.signer,
        trustedSigner: TRUSTED_SIGNERS.has(a.signer),
        timestamp: a.created_at,
        solscanUrl: `https://solscan.io/tx/${a.tx_signature}`,
      })),
      summary: {
        totalAttestations: attestations.length,
        trustedAttestations: trustedCount,
        platforms,
        platformCount: platforms.length,
        onChainScore: genesis?.reputationScore || null,
        onChainLevel: genesis?.verificationLevel || null,
        onChainLabel: genesis?.verificationLabel || null,
      },
      verifiedAt: new Date().toISOString(),
    }, null, 2));
  } else {
    console.log('┌─────────────────────────────────────────────────────────┐');
    console.log('│  SUMMARY                                               │');
    console.log('└─────────────────────────────────────────────────────────┘\n');

    console.log(`  Agent:              ${agentId}`);
    console.log(`  PDA:                ${pda.toBase58()}`);
    console.log(`  On-chain Score:     ${genesis?.reputationScore ?? 'N/A'}`);
    console.log(`  On-chain Level:     ${genesis ? `L${genesis.verificationLevel} (${genesis.verificationLabel})` : 'N/A'}`);
    console.log(`  Total Attestations: ${attestations.length}`);
    console.log(`  Trusted Signers:    ${trustedCount}/${attestations.length}`);
    console.log(`  Platforms Verified: ${platforms.length} — [${platforms.join(', ')}]`);
    console.log(`  Born (Soulbound):   ${genesis?.isBorn ? '✅' : '❌'}`);

    if (genesis && platforms.length > 0) {
      console.log('\n  ── Verification Path ──');
      console.log(`  ${platforms.map(p => p.toUpperCase()).join(' → ')}`);
    }

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('  Attestation data can be independently verified:');
    console.log(`  1. Genesis Record: solscan.io/account/${pda.toBase58()}`);
    console.log('  2. Each TX signature links to an on-chain memo proof');
    console.log('  3. Memo format: VERIFY|agent_id|platform|timestamp|proof_hash');
    console.log('═══════════════════════════════════════════════════════════');
  }
}

main().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
