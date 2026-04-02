/**
 * Post-Verification Hook
 * After a verification succeeds (GitHub, X, Solana, AgentMail, etc.):
 * 1. Recomputes trust score in DB
 * 2. Creates on-chain attestation via SATP Attestations program
 * 3. Recomputes reputation score via SATP Reputation program
 * 
 * Fire-and-forget — verification success returned immediately, on-chain work is async.
 */

const fs = require('fs');
const path = require('path');

let satpWriteClient, profileStore, keypair;

function getSATPWriteClient() {
  if (!satpWriteClient) satpWriteClient = require('./satp-write-client');
  return satpWriteClient;
}

function getProfileStore() {
  if (!profileStore) profileStore = require('./profile-store');
  return profileStore;
}

function getPlatformKeypair() {
  if (!keypair) {
    const keypairPath = process.env.SATP_PLATFORM_KEYPAIR;
    if (!keypairPath || !fs.existsSync(keypairPath)) {
      console.warn('[PostVerify] No platform keypair configured — on-chain attestation skipped');
      return null;
    }
    const { Keypair } = require('@solana/web3.js');
    const raw = JSON.parse(fs.readFileSync(keypairPath, 'utf8'));
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

    db.prepare(`
      INSERT INTO satp_trust_scores (agent_id, overall_score, level, score_breakdown, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(agent_id) DO UPDATE SET
        overall_score = excluded.overall_score, level = excluded.level,
        score_breakdown = excluded.score_breakdown, updated_at = excluded.updated_at
    `).run(profileId, score, level, JSON.stringify({
      platforms: verifiedPlatforms,
      perPlatform: Object.fromEntries(verifiedPlatforms.map(p => [p, scoreMap[p] || 20]))
    }));

    console.log(`[PostVerify] DB score updated: ${profileId} → ${score} (${level})`);
  } catch (e) {
    console.error('[PostVerify] DB score recompute failed:', e.message);
  }
}

async function postVerificationHook(profileId, platform, identifier, proof) {
  console.log(`[PostVerify] Hook fired: ${profileId} verified ${platform} (${identifier})`);

  // Step 1: Recompute DB trust score (fast, sync)
  recomputeDBScore(profileId);

  // Step 2: On-chain attestation (async, non-blocking)
  const kp = getPlatformKeypair();
  if (!kp) return;

  const wallet = getProfileWallet(profileId);
  if (!wallet) {
    console.log(`[PostVerify] No Solana wallet for ${profileId} — on-chain attestation deferred`);
    return;
  }

  try {
    const client = getSATPWriteClient();
    const attestationType = platformToAttestationType(platform);
    const proofData = JSON.stringify({
      platform, identifier,
      verifiedAt: proof?.verifiedAt || new Date().toISOString(),
      challengeId: proof?.challengeId || 'direct',
    }).slice(0, 200);

    console.log(`[PostVerify] Creating on-chain attestation: ${attestationType} for ${wallet}`);
    const result = await client.createAttestation({
      agentId: wallet, attestationType, proofData,
    }, kp, 'mainnet');
    console.log(`[PostVerify] ✅ Attestation TX: ${result.txSignature}`);

    // Step 3: Recompute on-chain reputation
    try {
      const repResult = await client.recomputeReputation(wallet, kp, 'mainnet');
      console.log(`[PostVerify] ✅ Reputation recomputed: ${repResult.txSignature}`);
    } catch (repErr) {
      console.warn(`[PostVerify] Reputation recompute skipped: ${repErr.message}`);
    }
  } catch (e) {
    console.error(`[PostVerify] On-chain attestation failed: ${e.message}`);
  }
}

module.exports = { postVerificationHook, recomputeDBScore };
