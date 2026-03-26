/**
 * safe-burn-to-become.js
 * 
 * Safe wrapper for server-side burnToBecome that checks authority before signing.
 * Prevents 0x7d1 (ConstraintHasOne) when authority has been rotated to agent wallet.
 * 
 * Drop-in replacement for inline burnToBecome calls in burn-to-become-public.js
 */

const { Connection, Keypair } = require('@solana/web3.js');
const fs = require('fs');

const DEPLOYER_KEY_PATH = '/home/ubuntu/.config/solana/mainnet-deployer.json';
const RPC_URL = process.env.SOLANA_RPC_URL || 'https://mainnet.helius-rpc.com/?api-key=HELIUS_API_KEY_REDACTED';

let _deployerPubkey = null;
function getDeployerPubkey() {
  if (!_deployerPubkey) {
    try {
      const keyData = JSON.parse(fs.readFileSync(DEPLOYER_KEY_PATH));
      const kp = Keypair.fromSecretKey(Uint8Array.from(keyData));
      _deployerPubkey = kp.publicKey.toBase58();
    } catch (e) {
      console.warn('[SafeBurn] Cannot load deployer key:', e.message);
    }
  }
  return _deployerPubkey;
}

/**
 * Attempt server-side burnToBecome for an agent.
 * Returns { success, txSignature, skipped, reason }
 * 
 * @param {string} agentId - Agent profile ID (e.g. 'agent_braintest')
 * @param {string} faceImageUri - Arweave image URL
 * @param {string} soulboundMint - Soulbound mint address
 * @param {string} burnTx - Burn transaction signature
 * @returns {Promise<object>}
 */
async function safeBurnToBecome(agentId, faceImageUri, soulboundMint, burnTx) {
  try {
    const { createSATPClient, getGenesisPDA } = require('../satp-client/src');
    const client = createSATPClient({ rpcUrl: RPC_URL });
    
    // Read genesis record to check authority
    const record = await client.getGenesisRecord(agentId);
    if (!record || record.error) {
      return { success: false, skipped: true, reason: 'No genesis record for ' + agentId };
    }
    if (record.isBorn) {
      return { success: false, skipped: true, reason: 'Agent already born: ' + agentId };
    }
    
    // Check if deployer is the authority
    const deployerPubkey = getDeployerPubkey();
    if (!deployerPubkey) {
      return { success: false, skipped: true, reason: 'Deployer key not available' };
    }
    
    if (record.authority !== deployerPubkey) {
      console.log('[SafeBurn] Authority mismatch for ' + agentId + 
        ': on-chain authority is ' + record.authority + 
        ', deployer is ' + deployerPubkey + 
        '. Agent must sign client-side via /api/burn-to-become/prepare-birth');
      return { 
        success: false, 
        skipped: true, 
        reason: 'Authority rotated to ' + record.authority + '. Agent must sign client-side.',
        authority: record.authority,
        needsClientSign: true,
      };
    }
    
    // Deployer IS the authority — proceed with server-side signing
    const signerKey = JSON.parse(fs.readFileSync(DEPLOYER_KEY_PATH, 'utf-8'));
    const signer = Keypair.fromSecretKey(Uint8Array.from(signerKey));
    const [genesisPda] = getGenesisPDA(agentId);
    
    const { transaction } = await client.buildBurnToBecome(
      signer.publicKey,
      genesisPda.toBase58(),
      faceImageUri || '',
      soulboundMint || '',
      burnTx || ''
    );
    transaction.sign(signer);
    
    const conn = new Connection(RPC_URL, 'confirmed');
    const sig = await conn.sendRawTransaction(transaction.serialize());
    await conn.confirmTransaction(sig, 'confirmed');
    
    console.log('[SafeBurn] burnToBecome completed for ' + agentId + ': tx=' + sig);
    return { success: true, txSignature: sig };
    
  } catch (e) {
    console.error('[SafeBurn] burnToBecome failed for ' + agentId + ':', e.message);
    return { success: false, skipped: false, reason: e.message };
  }
}

module.exports = { safeBurnToBecome };
