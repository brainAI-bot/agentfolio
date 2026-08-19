/**
 * SATP V3 join policy — confirm only a real profile after on-chain genesis exists.
 */
'use strict';

function getProfileSolanaWallet(profile) {
  if (!profile) return null;
  const direct = String(profile.wallet || '').trim();
  if (direct) return direct;
  try {
    const wallets = typeof profile.wallets === 'string' ? JSON.parse(profile.wallets || '{}') : (profile.wallets || {});
    const solana = String(wallets.solana || wallets.wallet || '').trim();
    if (solana) return solana;
  } catch {}
  try {
    const vd = typeof profile.verification_data === 'string' ? JSON.parse(profile.verification_data || '{}') : (profile.verification_data || {});
    const fromVd = String(vd?.solana?.address || vd?.solana?.identifier || '').trim();
    if (fromVd) return fromVd;
  } catch {}
  return null;
}

function evaluateV3JoinConfirm({ profile, onChainAccountExists, walletAddress }) {
  if (!walletAddress) {
    return { ok: false, status: 400, error: 'walletAddress required' };
  }
  if (!profile) {
    return { ok: false, status: 404, error: 'Profile not found. Create an AgentFolio profile first.' };
  }
  if (!onChainAccountExists) {
    return { ok: false, status: 409, error: 'V3 genesis record not found on-chain for this profileId. Create and sign the identity TX first.' };
  }
  const storedWallet = getProfileSolanaWallet(profile);
  if (storedWallet && storedWallet !== walletAddress) {
    return { ok: false, status: 403, error: 'walletAddress does not match the profile wallet' };
  }
  return { ok: true };
}

module.exports = {
  getProfileSolanaWallet,
  evaluateV3JoinConfirm,
};
