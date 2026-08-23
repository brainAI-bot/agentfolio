'use strict';

const net = require('node:net');
const ipaddr = require('ipaddr.js');

const CANONICAL_TRUST_PROVIDERS = Object.freeze(['solana', 'github', 'domain', 'website']);
const CANONICAL_TRUST_PROVIDER_SET = new Set(CANONICAL_TRUST_PROVIDERS);

const PLATFORM_ALIASES = Object.freeze({
  solana_wallet: 'solana',
});

const RETIRED_TRUST_PROVIDERS = Object.freeze([
  'agentmail',
  'ens',
  'farcaster',
  'telegram',
  'email',
  'custom',
]);
const RETIRED_TRUST_PROVIDER_SET = new Set(RETIRED_TRUST_PROVIDERS);
const LIVE_DISPLAY_VERIFICATION_PROVIDERS = Object.freeze([
  ...CANONICAL_TRUST_PROVIDERS,
  'discord',
  'ethereum',
  'hyperliquid',
  'moltbook',
  'polymarket',
  'satp',
  'twitter',
  'x',
  'mcp',
  'a2a',
  'review',
]);
const LIVE_DISPLAY_VERIFICATION_PROVIDER_SET = new Set(LIVE_DISPLAY_VERIFICATION_PROVIDERS);
const AUTO_PASS_MARKERS = new Set([
  'auto',
  'auto-pass',
  'autopass',
  'auto_pass',
  'auto verified',
  'auto-verified',
  'auto_verified',
  'platform_auto_verified',
  'satp-auto',
  'satp-auto-v3-confirm',
]);

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
  return RETIRED_TRUST_PROVIDER_SET.has(normalized);
}

function isLiveDisplayVerificationProvider(platform) {
  const normalized = normalizeTrustProvider(platform);
  return LIVE_DISPLAY_VERIFICATION_PROVIDER_SET.has(normalized);
}

function normalizeMarkerValue(value) {
  return String(value || '').trim().toLowerCase();
}

function isKnownAutoPassMarker(value) {
  return AUTO_PASS_MARKERS.has(normalizeMarkerValue(value));
}

function isAutoPassAttestation(data = {}) {
  if (!data || typeof data !== 'object') return false;
  if (data.auto === true || data.autoPass === true || data.auto_pass === true || data.autoVerified === true) return true;

  const proof = parseJsonish(data.proof, {});
  if (proof.auto === true || proof.autoPass === true || proof.auto_pass === true || proof.autoVerified === true) return true;

  return [
    data.source,
    data.method,
    data.type,
    proof.source,
    proof.method,
    proof.type,
  ].some(isKnownAutoPassMarker);
}

function isPublicVerificationHostname(hostname) {
  const normalized = String(hostname || '')
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
  if (!normalized) return false;
  if (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local') ||
    normalized.endsWith('.internal')
  ) return false;

  const ipVersion = net.isIP(normalized);
  if (ipVersion) {
    let address;
    try {
      address = ipaddr.parse(normalized);
    } catch (_) {
      return false;
    }

    if (address.kind() === 'ipv6') {
      const groups = address.parts;
      const compatiblePrefix = groups.slice(0, 6).every((group) => group === 0);
      if (address.isIPv4MappedAddress() || compatiblePrefix) {
        const ipv4 = [
          groups[6] >> 8,
          groups[6] & 0xff,
          groups[7] >> 8,
          groups[7] & 0xff,
        ].join('.');
        return isPublicVerificationHostname(ipv4);
      }
    }

    // ipaddr.js maintains the IANA special-purpose ranges. Fail closed by
    // accepting only addresses it classifies as globally routable unicast.
    return address.range() === 'unicast';
  }

  return normalized.includes('.');
}

function isPublicVerificationUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return false;
  try {
    const parsed = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    return (
      ['http:', 'https:'].includes(parsed.protocol) &&
      !parsed.username &&
      !parsed.password &&
      !parsed.port &&
      isPublicVerificationHostname(parsed.hostname)
    );
  } catch (_) {
    return false;
  }
}

function isCanonicalTrustDataEntry(platform, data = {}) {
  const normalized = normalizeTrustProvider(platform);
  if (!isCanonicalTrustProvider(normalized) || isAutoPassAttestation(data)) return false;
  if (!data || typeof data !== 'object') return false;

  if (normalized === 'website') {
    return isPublicVerificationUrl(data.url || data.websiteUrl || data.identifier || data.address);
  }
  if (normalized === 'domain') {
    return isPublicVerificationUrl(data.domain || data.identifier || data.address || data.url);
  }
  return true;
}

function isPublicDisplayVerificationDataEntry(platform, data = {}) {
  const normalized = normalizeTrustProvider(platform);
  if (!isLiveDisplayVerificationProvider(normalized) || !data || typeof data !== 'object') return false;
  if (isCanonicalTrustProvider(normalized)) return isCanonicalTrustDataEntry(normalized, data);
  return Boolean(data.identifier || data.address || normalized === 'mcp' || normalized === 'a2a');
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
    if (isCanonicalTrustDataEntry(normalized, data)) filtered[normalized] = data;
  }
  return filtered;
}

function sanitizeLegacyVerificationSummary(summary, verificationData = {}) {
  const parsed = parseJsonish(summary, {});
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

  const canonicalData = filterCanonicalTrustData(verificationData);
  const verifiedCanonicalPlatforms = new Set(
    Object.entries(canonicalData)
      .filter(([, data]) => data && (data.verified === true || data.linked === true || data.success === true))
      .map(([platform]) => platform)
  );
  const verifiedPlatforms = [...new Set(
    (Array.isArray(parsed.verifiedPlatforms) ? parsed.verifiedPlatforms : [])
      .map(normalizeTrustProvider)
      .filter((platform) => verifiedCanonicalPlatforms.has(platform))
  )];
  const sanitized = { ...parsed, verifiedPlatforms };
  // Legacy score/tier values were computed from the unsanitized provider set.
  // Public serializers must not retain a score whose supporting proofs were removed.
  delete sanitized.score;
  delete sanitized.tier;
  return sanitized;
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
  LIVE_DISPLAY_VERIFICATION_PROVIDERS,
  normalizeTrustProvider,
  isCanonicalTrustProvider,
  isRetiredTrustProvider,
  isLiveDisplayVerificationProvider,
  isAutoPassAttestation,
  isPublicVerificationHostname,
  isPublicVerificationUrl,
  isCanonicalTrustDataEntry,
  isPublicDisplayVerificationDataEntry,
  filterCanonicalTrustVerifications,
  filterCanonicalTrustData,
  hasVerifiedCanonicalTrustData,
  sanitizeLegacyVerificationSummary,
  retiredProviderResponse,
};
