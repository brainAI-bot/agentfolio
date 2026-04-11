const CATEGORY_MAP = {
  satp: 'onchain',
  satp_v3: 'onchain',
  solana: 'wallet',
  solana_wallet: 'wallet',
  eth: 'wallet',
  eth_wallet: 'wallet',
  ethereum: 'wallet',
  bitcoin: 'wallet',
  github: 'platform',
  x: 'platform',
  twitter: 'platform',
  discord: 'platform',
  telegram: 'platform',
  agentmail: 'platform',
  moltbook: 'platform',
  hyperliquid: 'platform',
  polymarket: 'platform',
  website: 'infra',
  domain: 'infra',
  mcp: 'infra',
  a2a: 'infra',
};

const PLATFORM_ALIASES = {
  twitter: 'x',
  solana: 'solana_wallet',
  eth_wallet: 'eth',
  ethereum: 'eth',
  satp_v3: 'satp',
  satp_identity: 'satp',
  satp_verification: 'satp',
};

function normalizeVerificationPlatform(platform) {
  let value = String(platform || '').trim().toLowerCase();
  if (!value) return null;
  if (value.startsWith('verification_')) value = value.slice('verification_'.length);
  if (value.endsWith('_verification')) value = value.slice(0, -'_verification'.length);
  return PLATFORM_ALIASES[value] || value;
}

function isSatpPlatform(platform) {
  return normalizeVerificationPlatform(platform) === 'satp';
}

function getVerificationCategory(platform) {
  return CATEGORY_MAP[normalizeVerificationPlatform(platform)] || null;
}

function normalizeVerifications(verifications = [], { includeSatp = false, dedupe = true } = {}) {
  const items = [];
  const seen = new Set();

  for (const raw of verifications || []) {
    const platform = normalizeVerificationPlatform(raw?.platform || raw?.type);
    if (!platform || platform === 'review') continue;
    if (!includeSatp && platform === 'satp') continue;

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
