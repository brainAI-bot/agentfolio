/**
 * Resolve a profile id for a Solana wallet across legacy and current storage shapes.
 * Supports:
 * - profiles.wallet
 * - profiles.wallets JSON { solana }
 * - profiles.verification_data JSON { solana: { address } }
 *
 * @param {Array<any>} profiles
 * @param {string} wallet
 * @returns {string | null}
 */
function findProfileIdByWallet(profiles, wallet) {
  const target = String(wallet || '').trim();
  if (!target) return null;

  for (const profile of Array.isArray(profiles) ? profiles : []) {
    const directWallet = String(profile?.wallet || '').trim();
    if (directWallet && directWallet === target) {
      return profile.id || null;
    }

    try {
      const wallets = JSON.parse(profile?.wallets || '{}');
      if (String(wallets?.solana || '').trim() === target) {
        return profile.id || null;
      }
    } catch {}

    try {
      const verificationData = JSON.parse(profile?.verification_data || '{}');
      if (String(verificationData?.solana?.address || '').trim() === target) {
        return profile.id || null;
      }
    } catch {}
  }

  return null;
}

module.exports = { findProfileIdByWallet };
