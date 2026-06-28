/**
 * SATP On-Chain Verification Utility
 * Checks if a wallet has an SATP identity PDA on-chain (program 97yL33)
 * Cached for 60 seconds to avoid spamming RPC
 */

const { Connection, PublicKey } = require('@solana/web3.js');

const SATP_V2_PROGRAM = new PublicKey('97yL33fcu6iWT2TdERS5HeqrMSGiUnxuy6nUcTrKieSq');
const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const CACHE_TTL_MS = 60_000; // 60 seconds

const _cache = new Map();
let _connection = null;

function getConnection() {
  if (!_connection) _connection = new Connection(RPC_URL, 'confirmed');
  return _connection;
}

/**
 * Derive SATP Identity PDA: ["identity", wallet_pubkey]
 */
function getSatpIdentityPDA(wallet) {
  const walletKey = new PublicKey(wallet);
  return PublicKey.findProgramAddressSync(
    [Buffer.from('identity'), walletKey.toBuffer()],
    SATP_V2_PROGRAM
  );
}

/**
 * Check if wallet has SATP identity on-chain
 * @param {string} walletAddress - Solana wallet address
 * @returns {Promise<{verified: boolean, identityPDA: string, cachedAt: number}>}
 */
async function isVerifiedOnChain(walletAddress) {
  if (!walletAddress || typeof walletAddress !== 'string') {
    return { verified: false, identityPDA: null, cachedAt: 0 };
  }

  // Check cache
  const cached = _cache.get(walletAddress);
  if (cached && (Date.now() - cached.cachedAt < CACHE_TTL_MS)) {
    return cached;
  }

  try {
    const [pda] = getSatpIdentityPDA(walletAddress);
    const conn = getConnection();
    const info = await conn.getAccountInfo(pda);
    
    const result = {
      verified: info !== null && info.data.length > 0,
      identityPDA: pda.toBase58(),
      cachedAt: Date.now(),
    };
    
    _cache.set(walletAddress, result);
    return result;
  } catch (e) {
    console.error('[SATP-Verify] RPC error for', walletAddress, ':', e.message);
    // On error, return cached value if available, else false
    if (cached) return cached;
    return { verified: false, identityPDA: null, cachedAt: Date.now(), error: e.message };
  }
}

/**
 * Check if a profile has on-chain verification (by profile ID)
 * Looks up wallet from profile, then checks on-chain
 * @param {string} profileId
 * @param {Function} loadProfile - profile loader function
 * @param {string} dataDir - data directory
 * @returns {Promise<{verified: boolean, wallet: string|null, identityPDA: string|null}>}
 */
async function isProfileVerifiedOnChain(profileId, loadProfile, dataDir) {
  try {
    const profile = loadProfile(profileId, dataDir);
    if (!profile) return { verified: false, wallet: null, identityPDA: null };
    
    const wallet = profile.wallets?.solana;
    if (!wallet) return { verified: false, wallet: null, identityPDA: null };
    
    const result = await isVerifiedOnChain(wallet);
    return { ...result, wallet };
  } catch (e) {
    return { verified: false, wallet: null, identityPDA: null, error: e.message };
  }
}

/**
 * Clear cache for a specific wallet or all
 */
function clearCache(walletAddress) {
  if (walletAddress) {
    _cache.delete(walletAddress);
  } else {
    _cache.clear();
  }
}

module.exports = {
  isVerifiedOnChain,
  isProfileVerifiedOnChain,
  getSatpIdentityPDA,
  clearCache,
  SATP_V2_PROGRAM,
};
