'use strict';

// Credentials, contact addresses, and bearer-style claim capabilities must never
// cross a public profile serializer. Matching is case-insensitive and ignores
// underscore/hyphen separators so schema/casing drift cannot reopen the leak.
const PRIVATE_PROFILE_FIELDS = new Set(['email', 'token', 'key', 'secret', 'claim']);

function normalizedProfileFieldName(key) {
  return String(key).toLowerCase().replace(/[_-]/g, '');
}

function isPrivateProfileField(key) {
  const normalized = normalizedProfileFieldName(key);
  return [...PRIVATE_PROFILE_FIELDS].some((marker) => normalized.includes(marker));
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
  isPrivateProfileField,
  normalizedProfileFieldName,
  sanitizePublicProfile,
};