function buildBurnToBecomeCollectionsPayload(mintedCount = 0) {
  const minted = Number.isSafeInteger(mintedCount) && mintedCount >= 0 ? mintedCount : 0;

  return {
    collections: [{
      name: 'Burned-Out Agents',
      total: 100,
      minted,
      remaining: Math.max(0, 100 - minted),
      mintPrice: '1 SOL',
      freeMintThreshold: 100,
    }],
    total: 1,
    message: 'Burn-to-Become collections',
  };
}

module.exports = { buildBurnToBecomeCollectionsPayload };
