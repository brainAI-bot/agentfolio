/**
 * Verification Hook — Post-Verification On-Chain Attestation
 * 
 * Call this after any platform verification succeeds.
 * It creates an on-chain attestation via the SATP V3 bridge and triggers score recompute.
 * 
 * Usage (in any verification module):
 *   const { onVerificationSuccess } = require('../lib/verification-hook');
 *   // After verification confirmed:
 *   await onVerificationSuccess(profileId, 'moltbook', { moltbookUrl, verifiedAt });
 * 
 * The hook is fire-and-forget — if the on-chain write fails, the off-chain verification
 * still succeeds. Attestations can be retried via the admin recompute script.
 * 
 * Requirements:
 *   - Platform keypair at SATP_PLATFORM_KEYPAIR env var (or default path)
 *   - Keypair must be funded with SOL (~0.003 per attestation)
 *   - Agent must have a genesis record on-chain (identity_v3)
 */

let bridge = null;

function getBridge() {
  if (bridge) return bridge;
  try {
    bridge = require('./satp-verification-bridge');
    return bridge;
  } catch (e) {
    console.warn('[VerificationHook] Bridge not available:', e.message);
    return null;
  }
}

/**
 * Called after a verification succeeds off-chain.
 * Creates on-chain attestation + triggers score recompute.
 * 
 * @param {string} agentId - The agent/profile identifier  
 * @param {string} platform - Verification platform (moltbook, website, mcp, a2a, polymarket, telegram, solana, x, github, domain)
 * @param {object} proofObj - Proof data to store on-chain (JSON, max 512 chars)
 * @returns {object|null} - { attestation, scoreRecompute } or null if bridge unavailable
 */
async function onVerificationSuccess(agentId, platform, proofObj) {
  const b = getBridge();
  if (!b) {
    console.warn(`[VerificationHook] Skipping on-chain attestation for ${agentId}/${platform} — bridge not loaded`);
    return null;
  }

  try {
    console.log(`[VerificationHook] Creating on-chain attestation: ${agentId}/${platform}`);
    const result = await b.postVerificationAttestation(agentId, platform, proofObj);
    
    if (result) {
      console.log(`[VerificationHook] ✅ On-chain attestation created for ${agentId}/${platform}`);
      if (result.attestation?.txSignature) {
        console.log(`[VerificationHook]   Attestation TX: ${result.attestation.txSignature}`);
      }
      if (result.scoreRecompute?.txSignature) {
        console.log(`[VerificationHook]   Score recompute TX: ${result.scoreRecompute.txSignature}`);
      }
    } else {
      console.warn(`[VerificationHook] ⚠️ On-chain attestation failed for ${agentId}/${platform} (returned null)`);
    }

    return result;
  } catch (e) {
    // Fire-and-forget: don't break the off-chain flow
    console.error(`[VerificationHook] ❌ Error creating on-chain attestation for ${agentId}/${platform}:`, e.message);
    return null;
  }
}

/**
 * Check if the bridge is available and configured (has keypair).
 */
function isBridgeAvailable() {
  const b = getBridge();
  if (!b) return false;
  
  const fs = require('fs');
  const keypairPath = process.env.SATP_PLATFORM_KEYPAIR || '/home/ubuntu/.config/solana/satp-mainnet-platform.json';
  return fs.existsSync(keypairPath);
}

module.exports = {
  onVerificationSuccess,
  isBridgeAvailable,
};
