'use strict';

// Credentials, contact addresses, and bearer-style claim capabilities must never
// cross a public profile serializer. Matching is case-insensitive and ignores
// underscore/hyphen separators so schema/casing drift cannot reopen the leak,
// while explicit product status/public identifier fields remain available.
const PRIVATE_PROFILE_FIELDS = new Set([
  'apikey',
  'apikeys',
  'claimtoken',
  'claimcode',
  'claimurl',
  'adminkey',
  'admintoken',
  'githubtoken',
  'accesstoken',
  'refreshtoken',
  'token',
  'secret',
  'clientsecret',
  'webhooksecret',
  'secretkey',
  'privatekey',
  'password',
  'seed',
  'mnemonic',
  'email',
]);
const PRIVATE_PROFILE_FIELD_SUFFIXES = ['token', 'secret', 'apikey', 'privatekey', 'password'];
const PUBLIC_PROFILE_FIELDS = new Set(['claimed', 'claimedat', 'claimedby', 'unclaimed']);

function normalizedProfileFieldName(key) {
  return String(key).toLowerCase().replace(/[_-]/g, '');
}

function isPrivateProfileField(key) {
  const normalized = normalizedProfileFieldName(key);
  if (PUBLIC_PROFILE_FIELDS.has(normalized)) return false;
  if (PRIVATE_PROFILE_FIELDS.has(normalized)) return true;
  if (normalized.endsWith('email')) return true;
  return PRIVATE_PROFILE_FIELD_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
}

function sanitizeJsonObjectString(value) {
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return value;

  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object') return value;
    return JSON.stringify(sanitizePublicProfile(parsed));
  } catch {
    return value;
  }
}

function sanitizePublicProfile(value) {
  if (typeof value === 'string') return sanitizeJsonObjectString(value);
  if (Array.isArray(value)) return value.map(sanitizePublicProfile);
  if (!value || typeof value !== 'object' || Buffer.isBuffer(value)) return value;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (value instanceof Map) return sanitizePublicProfile(Object.fromEntries(value));
  if (value instanceof Set) return sanitizePublicProfile([...value]);
  if (typeof value.toJSON === 'function') return sanitizePublicProfile(value.toJSON());

  // Deliberately serialize enumerable fields from plain and class-backed values
  // rather than collapsing Date/non-plain objects to {} implicitly.
  const clean = {};
  for (const [key, child] of Object.entries(value)) {
    if (isPrivateProfileField(key)) continue;
    clean[key] = sanitizePublicProfile(child);
  }
  return clean;
}

module.exports = {
  PRIVATE_PROFILE_FIELDS,
  PRIVATE_PROFILE_FIELD_SUFFIXES,
  PUBLIC_PROFILE_FIELDS,
  isPrivateProfileField,
  normalizedProfileFieldName,
  sanitizePublicProfile,
};