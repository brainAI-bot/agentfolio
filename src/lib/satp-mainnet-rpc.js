/**
 * Pin SATP explorer / V3 identity reads to mainnet-beta.
 *
 * Prod may still set SATP_NETWORK=devnet and SOLANA_RPC_URL to a leftover
 * cluster for the gated escrow surface. GTpp Genesis Records the explorer
 * lists live on mainnet (HmuetLjw is mainnet-only). A leftover cluster
 * GPA-scans 32 PDAs that exist only on public devnet.
 */

const NETWORK = 'mainnet-beta';
const LABEL = 'mainnet-beta';

function resolveSatpMainnetRpcUrl() {
  const rpc = String(process.env.SOLANA_RPC_URL || '').trim();
  if (rpc && !/devnet/i.test(rpc)) return rpc;
  return 'https://api.mainnet-beta.solana.com';
}

module.exports = {
  NETWORK,
  LABEL,
  resolveSatpMainnetRpcUrl,
};
