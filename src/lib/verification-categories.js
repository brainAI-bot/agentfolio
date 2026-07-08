const {
  isCanonicalTrustProvider,
  normalizeTrustProvider,
} = require('./canonical-verification-providers');

const CATEGORY_MAP = {
  satp: 'onchain',
  satp_v3: 'onchain',
  solana: 'wallet',
  github: 'platform',
  website: 'infra',
  domain: 'infra',
};

const PLATFORM_ALIASES = {
  solana_wallet: 'solana',
  satp_v3: 'satp',
  satp_identity: 'satp',
  satp_verification: 'satp',
};

function normalizeVerificationPlatform(platform) {
  let value = String(platform || '').trim().toLowerCase();
  if (!value) return null;
  if (value.startsWith('verification_')) value = value.slice('verification_'.length);
  if (value.endsWith('_verification')) value = value.slice(0, -'_verification'.length);
  return PLATFORM_ALIASES[value] || normalizeTrustProvider(value);
}

function isSatpPlatform(platform) {
  return normalizeVerificationPlatform(platform) === 'satp';
}

function getVerificationCategory(platform) {
  const normalized = normalizeVerificationPlatform(platform);
  if (normalized === 'satp') return CATEGORY_MAP.satp;
  if (!isCanonicalTrustProvider(normalized)) return null;
  return CATEGORY_MAP[normalized] || null;
}

function normalizeVerifications(verifications = [], { includeSatp = false, dedupe = true } = {}) {
  const items = [];
  const seen = new Set();

  for (const raw of verifications || []) {
    const platform = normalizeVerificationPlatform(raw?.platform || raw?.type);
    if (!platform || platform === 'review') continue;
    if (!includeSatp && platform === 'satp') continue;
    if (platform !== 'satp' && !isCanonicalTrustProvider(platform)) continue;

    const item = {
      ...raw,
      platform,
      identifier: raw?.identifier || raw?.address || raw?.did || raw?.wallet || raw?.handle || null,
      category: getVerificationCategory(platform),
    };

    const key = dedupe ? platform : `${platform}:${items.length}`;
    if (dedupe && seen.has(key)) continue;
    seen.add(key);
    items.push(item);
  }

  return items;
}

module.exports = {
  CATEGORY_MAP,
  normalizeVerificationPlatform,
  normalizeVerifications,
  isSatpPlatform,
  getVerificationCategory,
};
