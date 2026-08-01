'use strict';

const CANONICAL_TRUST_PROVIDERS = Object.freeze(['solana', 'github', 'domain', 'website']);
const CANONICAL_TRUST_PROVIDER_SET = new Set(CANONICAL_TRUST_PROVIDERS);

const PLATFORM_ALIASES = Object.freeze({
  solana_wallet: 'solana',
});

const RETIRED_TRUST_PROVIDERS = Object.freeze([
  'agentmail',
  'discord',
  'ens',
  'farcaster',
  'moltbook',
  'telegram',
  'x',
  'twitter',
  'eth',
  'ethereum',
  'hyperliquid',
  'polymarket',
  'kalshi',
  'mcp',
  'a2a',
  'satp',
  'satp_v3',
  'email',
  'custom',
]);
const RETIRED_TRUST_PROVIDER_SET = new Set(RETIRED_TRUST_PROVIDERS);
const AUTO_PASS_MARKERS = [
  'auto-pass',
  'autopass',
  'auto_pass',
  'auto verified',
  'auto-verified',
  'auto_verified',
  'satp-auto',
];

function parseJsonish(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

function normalizeTrustProvider(platform) {
  const value = String(platform || '').trim().toLowerCase();
  return PLATFORM_ALIASES[value] || value || null;
}

function isCanonicalTrustProvider(platform) {
  return CANONICAL_TRUST_PROVIDER_SET.has(normalizeTrustProvider(platform));
}

function isRetiredTrustProvider(platform) {
  const normalized = normalizeTrustProvider(platform);
  return Boolean(normalized && !CANONICAL_TRUST_PROVIDER_SET.has(normalized));
}

function isAutoPassAttestation(data = {}) {
  if (!data || typeof data !== 'object') return false;
  if (data.auto === true || data.autoPass === true || data.auto_pass === true || data.autoVerified === true) return true;

  const proof = parseJsonish(data.proof, {});
  if (proof.auto === true || proof.autoPass === true || proof.auto_pass === true || proof.autoVerified === true) return true;

  const text = [
    data.source,
    data.method,
    data.reason,
    data.status,
    data.type,
    proof.source,
    proof.method,
    proof.reason,
    proof.status,
    proof.type,
  ].filter(Boolean).join(' ').toLowerCase();

  return AUTO_PASS_MARKERS.some((marker) => text.includes(marker));
}

function filterCanonicalTrustVerifications(verifications = []) {
  return (verifications || []).filter((verification) => (
    isCanonicalTrustProvider(verification?.platform || verification?.type) &&
    !isAutoPassAttestation(verification)
  ));
}

function filterCanonicalTrustData(verificationData = {}) {
  const filtered = {};
  for (const [platform, data] of Object.entries(verificationData || {})) {
    const normalized = normalizeTrustProvider(platform);
    if (isCanonicalTrustProvider(normalized) && !isAutoPassAttestation(data)) filtered[normalized] = data;
  }
  return filtered;
}

function hasVerifiedCanonicalTrustData(verificationData = {}) {
  return Object.values(filterCanonicalTrustData(verificationData)).some(
    (data) => data && (data.verified === true || data.linked === true || data.success === true)
  );
}

function retiredProviderResponse(platform) {
  const normalized = normalizeTrustProvider(platform);
  return {
    verified: false,
    platform: normalized,
    retired: true,
    reason: `${normalized} is a non-verifying profile link and no longer grants AgentFolio trust credit`,
    canonicalTrustProviders: CANONICAL_TRUST_PROVIDERS,
  };
}

module.exports = {
  CANONICAL_TRUST_PROVIDERS,
  RETIRED_TRUST_PROVIDERS,
  normalizeTrustProvider,
  isCanonicalTrustProvider,
  isRetiredTrustProvider,
  isAutoPassAttestation,
  filterCanonicalTrustVerifications,
  filterCanonicalTrustData,
  hasVerifiedCanonicalTrustData,
  retiredProviderResponse,
};
