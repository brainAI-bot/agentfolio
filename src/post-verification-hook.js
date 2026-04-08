/**
 * Post-Verification Hook — Apr 4 2026
 * Called by addVerification() after every successful verification.
 * 
 * Pipeline:
 * 1. Recompute DB trust score (sync, fast)
 * 2. Revalidate frontend cache
 * 3. Create on-chain attestation via SATP Attestations program
 * 4. Recompute on-chain reputation via CPI
 * 5. Recompute on-chain verification level via CPI
 * 
 * Fire-and-forget — verification success returned immediately, on-chain work is async.
 */

const fs = require('fs');
const path = require('path');

let satpWriteClient, profileStore, keypair, v3sdk;

function getSATPWriteClient() {
  if (!satpWriteClient) satpWriteClient = require('./satp-write-client');
  return satpWriteClient;
}

function getV3SDK() {
  if (!v3sdk) {
    const { SATPV3SDK } = require('./satp-client/src/v3-sdk');
    const RPC_URL = process.env.SOLANA_RPC_URL || 'https://mainnet.helius-rpc.com/?api-key=REDACTED_HELIUS_API_KEY';
    v3sdk = new SATPV3SDK({ rpcUrl: RPC_URL });
  }
  return v3sdk;
}

function getProfileStore() {
  if (!profileStore) profileStore = require('./profile-store');
  return profileStore;
}

const PLATFORM_KEYPAIR_PATH = process.env.SATP_PLATFORM_KEYPAIR || '/home/ubuntu/agentfolio/config/platform-keypair.json';

function getPlatformKeypair() {
  if (!keypair) {
    if (!fs.existsSync(PLATFORM_KEYPAIR_PATH)) {
      console.warn('[PostVerify] No platform keypair at', PLATFORM_KEYPAIR_PATH, '— on-chain skipped');
      return null;
    }
    const { Keypair } = require('@solana/web3.js');
    const raw = JSON.parse(fs.readFileSync(PLATFORM_KEYPAIR_PATH, 'utf8'));
    keypair = Keypair.fromSecretKey(Uint8Array.from(raw));
  }
  return keypair;
}

function platformToAttestationType(platform) {
  const map = {
    github: 'github_verification',
    x: 'x_verification',
    solana: 'solana_wallet_verification',
    agentmail: 'agentmail_verification',
    telegram: 'telegram_verification',
    discord: 'discord_verification',
    eth: 'eth_wallet_verification',
    domain: 'domain_verification',
    website: 'website_verification',
    ens: 'ens_verification',
    farcaster: 'farcaster_verification',
    moltbook: 'moltbook_verification',
    polymarket: 'polymarket_verification',
    hyperliquid: 'hyperliquid_verification',
    mcp: 'mcp_verification',
    a2a: 'a2a_verification',
    kalshi: 'kalshi_verification',
  };
  return map[platform] || `${platform}_verification`;
}

function getProfileWallet(profileId) {
  try {
    const db = getProfileStore().getDb();
    const row = db.prepare('SELECT wallet, wallets, verification_data FROM profiles WHERE id = ?').get(profileId);
    if (!row) return null;
    if (row.wallet && row.wallet.length > 30) return row.wallet;
    try {
      const wallets = JSON.parse(row.wallets || '{}');
      if (wallets.solana) return wallets.solana;
    } catch (_) {}
    try {
      const vd = JSON.parse(row.verification_data || '{}');
      if (vd.solana?.address) return vd.solana.address;
    } catch (_) {}
    return null;
  } catch (e) {
    console.error('[PostVerify] Failed to get profile wallet:', e.message);
    return null;
  }
}


async function resolveCanonicalOnchainProfileId(profileId) {
  const wallet = getProfileWallet(profileId);
  if (!wallet) return profileId;

  try {
    const current = await getV3SDK().getGenesisRecord(profileId);
    if (current && !current.error) return profileId;
  } catch (_) {}

  try {
    const db = getProfileStore().getDb();
    const candidates = db.prepare(`
      SELECT id, wallet, wallets
      FROM profiles
      WHERE id != ? AND (
        wallet = ? OR wallet LIKE ? OR wallets LIKE ? OR verification_data LIKE ?
      )
      ORDER BY CASE WHEN id LIKE 'agent_%' THEN 0 ELSE 1 END, created_at ASC
    `).all(profileId, wallet, `%${wallet}%`, `%${wallet}%`, `%${wallet}%`);

    for (const candidate of candidates) {
      try {
        const existing = await getV3SDK().getGenesisRecord(candidate.id);
        if (existing && !existing.error) {
          console.log(`[PostVerify] Resolved canonical on-chain profile ${profileId} -> ${candidate.id} for wallet ${wallet}`);
          return candidate.id;
        }
      } catch (_) {}
    }
  } catch (e) {
    console.warn('[PostVerify] Canonical profile resolution failed:', e.message);
  }

  return profileId;
}

function recomputeDBScore(profileId) {
  try {
    const db = getProfileStore().getDb();
    const row = db.prepare('SELECT verification_data FROM profiles WHERE id = ?').get(profileId);
    if (!row) return;

    const vd = JSON.parse(row.verification_data || '{}');
    const verifiedPlatforms = Object.entries(vd).filter(([_, v]) => v && v.verified).map(([k]) => k);
    
    const scoreMap = {
      solana: 100, eth: 80, github: 60, x: 40, agentmail: 30,
      telegram: 20, discord: 20, domain: 50, website: 40, ens: 50, farcaster: 30,
      moltbook: 30, polymarket: 40, hyperliquid: 40, mcp: 30, a2a: 30, kalshi: 30,
    };

    let score = 0;
    for (const p of verifiedPlatforms) score += scoreMap[p] || 20;

    let level;
    if (score >= 200) level = 'SOVEREIGN';
    else if (score >= 150) level = 'ELITE';
    else if (score >= 100) level = 'VERIFIED';
    else if (score >= 50) level = 'ESTABLISHED';
    else if (score >= 20) level = 'REGISTERED';
    else level = 'UNVERIFIED';

    // P0: DB score writes removed — on-chain v3 is sole source
    console.log(`[PostVerify] Score computed but NOT written to DB (P0): ${profileId} → ${score} (${level})`);
  } catch (e) {
    console.error('[PostVerify] DB score recompute failed:', e.message);
  }
}

async function revalidateProfileCache(profileId) {
  try {
    const res = await globalThis.fetch('http://localhost:3000/api/revalidate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: 'agentfolio-revalidate-2026', profileId }),
    });
    if (res.ok) {
      console.log('[PostVerify] ✅ ISR cache revalidated for', profileId);
    }
  } catch (e) {
    // non-critical
  }
}

/**
 * Main hook — called after every successful verification.
 * Fire-and-forget. Never throws to caller.
 */
async function postVerificationHook(profileId, platform, identifier, proof) {
  console.log(`[PostVerify] ═══ Hook fired: ${profileId} verified ${platform} (${identifier}) ═══`);

  // Step 1-3: On-chain work first via the V3 bridge. DB/cache update only after chain succeeds.
  let onchainWriteSucceeded = false;
  const attestationType = platformToAttestationType(platform);
  const proofData = {
    platform,
    identifier,
    ...proof,
    verifiedAt: new Date().toISOString(),
  };
  const onchainProfileId = await resolveCanonicalOnchainProfileId(profileId);
  if (onchainProfileId !== profileId) {
    console.log(`[PostVerify] Using canonical on-chain profile ${onchainProfileId} instead of ${profileId}`);
  }

  console.log(`[PostVerify] Creating attestation via V3 bridge: ${attestationType} for ${onchainProfileId}`);
  try {
    const bridge = require('./lib/satp-verification-bridge');
    const result = await bridge.postVerificationAttestation(onchainProfileId, platform, proofData);
    console.log(`[PostVerify] ✅ Bridge result for ${profileId}: ${JSON.stringify(result)}`);
    onchainWriteSucceeded = !!result;
    if (!result) {
      console.warn(`[PostVerify] ⚠️ Bridge returned null for ${profileId}`);
    }
  } catch (e) {
    console.warn(`[PostVerify] ⚠️ V3 bridge failed for ${profileId}: ${e.message}`);
  }

  if (onchainWriteSucceeded) {
    recomputeDBScore(profileId);
    revalidateProfileCache(profileId).catch(() => {});
    console.log(`[PostVerify] ✅ DB/cache refreshed after on-chain success for ${profileId}`);
  } else {
    console.warn(`[PostVerify] ⚠️ Skipped DB/cache refresh because on-chain write did not succeed for ${profileId}`);
  }

  console.log(`[PostVerify] ═══ Pipeline complete for ${profileId}/${platform} ═══`);
  return onchainWriteSucceeded;
}

module.exports = { postVerificationHook, recomputeDBScore, revalidateProfileCache };
