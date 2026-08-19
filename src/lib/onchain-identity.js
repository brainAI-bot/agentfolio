'use strict';

/**
 * Honest on-chain identity detection for public stats.
 * Counts SATP V3 genesis joins and Solana-verified wallets.
 * Does not invent profileIds and does not treat fixtures specially
 * (callers must exclude fixtures before counting).
 */

function parseVerificationData(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch (_) { return {}; }
}

function hasSatpGenesis(vd) {
  const satpV3 = vd.satp_v3 || {};
  if (satpV3.verified === true && (satpV3.genesisPDA || satpV3.txSignature || satpV3.program)) {
    return true;
  }
  const satp = vd.satp || {};
  if (satp.verified === true && (satp.genesisPDA || satp.identityPDA || satp.txSignature)) {
    return true;
  }
  return false;
}

function isOnChainIdentity(verificationData) {
  const vd = parseVerificationData(verificationData);
  if (hasSatpGenesis(vd)) return true;
  return vd.solana?.verified === true;
}

module.exports = {
  parseVerificationData,
  hasSatpGenesis,
  isOnChainIdentity,
};
