/**
 * $FOLIO Token Fee Tier System
 * Checks FOLIO balance and returns fee tier discount
 */

const FEE_TIERS = [
  { minBalance: 250000, feePercent: 1.0, name: 'Diamond', emoji: '💎' },
  { minBalance: 50000,  feePercent: 1.5, name: 'Platinum', emoji: '🏆' },
  { minBalance: 10000,  feePercent: 2.5, name: 'Gold', emoji: '🥇' },
  { minBalance: 1000,   feePercent: 3.5, name: 'Silver', emoji: '🥈' },
  { minBalance: 0,      feePercent: 5.0, name: 'Standard', emoji: '📋' },
];

// Stub: mock balance based on wallet address hash
function getMockBalance(walletAddress) {
  if (!walletAddress) return 0;
  let hash = 0;
  for (let i = 0; i < walletAddress.length; i++) {
    hash = ((hash << 5) - hash) + walletAddress.charCodeAt(i);
    hash |= 0;
  }
  const balances = [0, 500, 2000, 15000, 75000, 300000];
  return balances[Math.abs(hash) % balances.length];
}

function getFeeTier(walletAddress) {
  const balance = getMockBalance(walletAddress);
  const tier = FEE_TIERS.find(t => balance >= t.minBalance) || FEE_TIERS[FEE_TIERS.length - 1];
  return {
    walletAddress,
    folioBalance: balance,
    feePercent: tier.feePercent,
    tierName: tier.name,
    tierEmoji: tier.emoji,
    allTiers: FEE_TIERS,
    discount: 5.0 - tier.feePercent,
  };
}

function getFeePercentForWallet(walletAddress) {
  return getFeeTier(walletAddress).feePercent;
}

module.exports = { FEE_TIERS, getFeeTier, getFeePercentForWallet, getMockBalance };
