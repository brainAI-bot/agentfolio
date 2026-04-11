const { computeScore } = require('./compute-score');
const chainCache = require('./chain-cache');

function normalizePlatform(platform) {
  if (!platform) return null;
  const map = {
    twitter: 'x',
    satp_v3: 'satp',
    eth: 'ethereum',
  };
  return map[platform] || platform;
}

function parseProof(proof) {
  if (!proof) return {};
  if (typeof proof === 'string') {
    try { return JSON.parse(proof); } catch (_) { return {}; }
  }
  return proof;
}

function isValidTxSignature(sig) {
  return !!(sig && typeof sig === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,}$/.test(sig));
}

function extractTxSignature(proof) {
  const parsed = parseProof(proof);
  const candidate = parsed.txSignature || parsed.signature || parsed.transactionSignature || parsed.tx_signature || null;
  return isValidTxSignature(candidate) ? candidate : null;
}

function computeUnifiedTrustScore(db, profile, options = {}) {
  const profileId = profile?.id || profile?.profileId || profile;
  const wallet = profile?.wallet || profile?.walletAddress || profile?.wallets?.solana || null;
  const claimed = !!(profile?.claimed === 1 || profile?.claimed === true || profile?.claimed === '1');
  const v3Score = options.v3Score || null;
  const verifications = [];

  const addVerification = (platform, identifier, extra = {}) => {
    const normalized = normalizePlatform(platform);
    if (!normalized) return;
    const finalIdentifier = identifier || extra.identifier || extra.address || (normalized === 'satp' || normalized === 'solana' ? wallet : profileId) || profileId;
    verifications.push({
      platform: normalized,
      identifier: finalIdentifier,
      verified: true,
      txSignature: extra.txSignature || null,
      solscanUrl: extra.solscanUrl || (extra.txSignature ? `https://solana.fm/tx/${extra.txSignature}` : null),
      timestamp: extra.timestamp || null,
      memo: extra.memo || null,
      signer: extra.signer || null,
      proofHash: extra.proofHash || null,
    });
  };

  let chainAttestations = [];
  try {
    chainAttestations = chainCache.getVerifications(profileId) || [];
  } catch (_) {}

  if (chainAttestations.length > 0) {
    for (const att of chainAttestations) {
      addVerification(att.platform, att.identifier || att.address || null, {
        txSignature: att.txSignature || null,
        solscanUrl: att.solscanUrl || null,
        timestamp: att.timestamp || null,
        memo: att.memo || null,
        signer: att.signer || null,
        proofHash: att.proofHash || null,
        address: att.address || null,
      });
    }
  } else {
    let verifRows = [];
    let attRows = [];
    try {
      verifRows = db.prepare('SELECT platform, identifier, proof, verified_at FROM verifications WHERE profile_id = ? ORDER BY verified_at DESC').all(profileId) || [];
    } catch (_) {}
    try {
      attRows = db.prepare('SELECT platform, tx_signature, created_at FROM attestations WHERE profile_id = ? ORDER BY created_at DESC').all(profileId) || [];
    } catch (_) {}

    for (const row of attRows) {
      addVerification(row.platform, null, {
        txSignature: row.tx_signature || null,
        timestamp: row.created_at || null,
      });
    }

    for (const row of verifRows) {
      addVerification(row.platform, row.identifier || null, {
        txSignature: extractTxSignature(row.proof),
        timestamp: row.verified_at || null,
      });
    }
  }

  const hasSatpIdentity = !!(wallet && v3Score && Number(v3Score.verificationLevel || 0) >= 1);
  const computed = computeScore(
    verifications.map(({ platform, identifier }) => ({ platform, identifier })),
    { hasSatpIdentity, claimed }
  ) || { score: 0, level: 0, levelName: 'Unverified', breakdown: {}, badge: '⚪' };

  return {
    score: computed.score || 0,
    level: computed.level || 0,
    levelName: computed.levelName || 'Unverified',
    breakdown: computed.breakdown || {},
    badge: computed.badge || '⚪',
    verifications,
    hasSatpIdentity,
    source: 'unfiltered-onchain-attestations',
  };
}

module.exports = {
  computeUnifiedTrustScore,
  normalizePlatform,
  extractTxSignature,
};
