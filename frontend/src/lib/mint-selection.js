/**
 * Reconcile the currently selected NFT against a freshly fetched NFT list.
 * If the selected mint is no longer present, drop the selection and move the UI
 * back to either `select` or `choose` depending on whether any candidates remain.
 *
 * @param {string} step
 * @param {{ mint: string } | null} selectedNft
 * @param {{ mint: string }[]} nextNfts
 * @param {boolean} hasGenesisOption
 * @returns {{ selectedNft: { mint: string } | null, step: string }}
 */
function reconcileMintSelection(step, selectedNft, nextNfts, hasGenesisOption) {
  if (!selectedNft) {
    return { selectedNft: null, step };
  }

  const stillExists = nextNfts.some((nft) => nft.mint === selectedNft.mint);
  if (stillExists) {
    return { selectedNft, step };
  }

  const selectionSensitiveSteps = new Set(['select', 'preview', 'burning', 'error']);
  return {
    selectedNft: null,
    step: selectionSensitiveSteps.has(step)
      ? (nextNfts.length > 0 || hasGenesisOption ? 'select' : 'choose')
      : step,
  };
}

module.exports = { reconcileMintSelection };
