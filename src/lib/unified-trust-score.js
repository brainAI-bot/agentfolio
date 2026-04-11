const { computeScore } = require('./compute-score');

const CORE_TRUST_PLATFORMS = new Set(['satp', 'solana']);

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
  const verifications = new Map();

  const addVerification = (platform, identifier, extra = {}) => {
    const normalized = normalizePlatform(platform);
    if (!normalized || normalized === 'review') return;
    const finalIdentifier = identifier || (normalized === 'satp' || normalized === 'solana' ? wallet : profileId);
    if (!finalIdentifier) return;
    const existing = verifications.get(normalized);
    if (existing && (!extra.txSignature || existing.txSignature)) return;
    verifications.set(normalized, {
      platform: normalized,
      identifier: finalIdentifier,
      verified: true,
      txSignature: extra.txSignature || null,
      solscanUrl: extra.solscanUrl || (extra.txSignature ? `https://solana.fm/tx/${extra.txSignature}` : null),
      timestamp: extra.timestamp || null,
    });
  };

  let verifRows = [];
  let attRows = [];
  try {
    verifRows = db.prepare('SELECT platform, identifier, proof, verified_at FROM verifications WHERE profile_id = ? ORDER BY verified_at DESC').all(profileId) || [];
  } catch (_) {}
  try {
    attRows = db.prepare('SELECT platform, tx_signature, created_at FROM attestations WHERE profile_id = ? AND tx_signature IS NOT NULL ORDER BY created_at DESC').all(profileId) || [];
  } catch (_) {}

  for (const row of attRows) {
    const platform = normalizePlatform(row.platform);
    if (!platform || !isValidTxSignature(row.tx_signature)) continue;
    addVerification(platform, null, {
      txSignature: row.tx_signature,
      timestamp: row.created_at || null,
    });
  }

  for (const row of verifRows) {
    const platform = normalizePlatform(row.platform);
    const txSignature = extractTxSignature(row.proof);
    if (!platform || !txSignature) continue;
    addVerification(platform, row.identifier || null, {
      txSignature,
      timestamp: row.verified_at || null,
    });
  }

  if (!verifications.has('satp') && wallet && v3Score && Number(v3Score.verificationLevel || 0) >= 1) {
    addVerification('satp', wallet, {
      txSignature: null,
      timestamp: v3Score.createdAt || null,
      solscanUrl: null,
    });
  }

  const verificationList = Array.from(verifications.values());
  const scoredVerificationList = verificationList.filter(v => CORE_TRUST_PLATFORMS.has(v.platform));
  const computed = computeScore(
    scoredVerificationList.map(({ platform, identifier }) => ({ platform, identifier })),
    { hasSatpIdentity: verificationList.some(v => v.platform === 'satp'), claimed }
  ) || { score: 0, level: 0, levelName: 'Unverified', breakdown: {}, badge: '⚪' };

  return {
    score: computed.score || 0,
    level: computed.level || 0,
    levelName: computed.levelName || 'Unverified',
    breakdown: computed.breakdown || {},
    badge: computed.badge || '⚪',
    verifications: verificationList,
    hasSatpIdentity: verificationList.some(v => v.platform === 'satp'),
    source: 'unified-core-identity-trust',
  };
}

module.exports = {
  computeUnifiedTrustScore,
  normalizePlatform,
  extractTxSignature,
};
