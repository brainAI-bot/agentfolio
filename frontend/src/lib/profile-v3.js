/**
 * Synthetic local profile ids are generated for temporary/local-only entities
 * and never have SATP V3 Genesis records on-chain.
 *
 * @param {string | null | undefined} profileId
 * @returns {boolean}
 */
function shouldFetchV3Reputation(profileId) {
  if (!profileId || typeof profileId !== 'string') return false;
  return !profileId.startsWith('local_');
}

module.exports = { shouldFetchV3Reputation };
