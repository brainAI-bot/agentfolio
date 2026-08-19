'use strict';

/**
 * Shared SATP V3 mainnet RPC pin (same rule as 249 / explorer).
 * Ignore leftover SATP_NETWORK=devnet and any SOLANA_RPC_URL that contains "devnet".
 */
function resolveSatpMainnetRpcUrl(env) {
  const source = env || process.env;
  const rpc = String(source.SOLANA_RPC_URL || '').trim();
  if (rpc && !/devnet/i.test(rpc)) return rpc;
  return 'https://api.mainnet-beta.solana.com';
}

module.exports = { resolveSatpMainnetRpcUrl };
