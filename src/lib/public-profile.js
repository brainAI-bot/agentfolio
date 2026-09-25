'use strict';

// Credentials and bearer-style claim capabilities must never cross a public
// profile serializer, including nested export/embed payloads.
const PRIVATE_PROFILE_FIELDS = new Set([
  'api_key',
  'apiKey',
  'claim_token',
  'claimToken',
  'claim_code',
  'claimCode',
  'admin_key',
  'adminKey',
  'github_token',
  'githubToken',
]);

function sanitizePublicProfile(value) {
  if (Array.isArray(value)) return value.map(sanitizePublicProfile);
  if (!value || typeof value !== 'object' || Buffer.isBuffer(value)) return value;

  const clean = {};
  for (const [key, child] of Object.entries(value)) {
    if (PRIVATE_PROFILE_FIELDS.has(key)) continue;
    clean[key] = sanitizePublicProfile(child);
  }
  return clean;
}

module.exports = { PRIVATE_PROFILE_FIELDS, sanitizePublicProfile };