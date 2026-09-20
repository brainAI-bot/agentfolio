/**
 * Public traction filter — exclude smoke/QA/fixture identities from
 * advertised counts and copy. The reviewed id cohort is the canonical source
 * for profiles that existed when TASK-db54c6f7 was diagnosed; legacy patterns
 * remain fail-closed for later obvious QA identities.
 * Does not delete production data.
 */

const fixtureCohort = require('./public-fixture-cohort.json');

const REVIEWED_FIXTURE_PROFILE_IDS = new Set(
  fixtureCohort.profileIds.map((id) => String(id).trim().toLowerCase())
);
const REVIEWED_FIXTURE_JOB_IDS = new Set(
  (fixtureCohort.jobIds || []).map((id) => String(id).trim().toLowerCase())
);

// Live QA probes created after the reviewed cohort snapshot. Keep these exact:
// broad `rate*` matching would hide legitimate marketplace identities.
const PINNED_FIXTURE_IDENTITIES = new Set([
  'agent_ratecheck',
  'agent_ratelimit_probe',
  'agent_ratecheck2',
]);

const FIXTURE_IDENTITY_PATTERNS = [
  /^agent_sm\d+/,
  /(^|_)sm\d+(?:$|_)/,
  /(^|_)local_/,
  /^(?:agent_)?forgetest\d*$/,
  /^(?:agent_)?braintest\d*$/,
  /^(?:agent_)?ratetest\d+$/,
  /^(?:agent_)?ceo[ _-]+selftest(?:[ _-]*\d+)?$/,
  /^(?:agent_)?testprobe(?:[ _-]+agent)?$/,
  /(?:^|[^a-z0-9])cpi[ _-]+test(?:[^a-z0-9]|$)/,
  /(?:^|[^a-z0-9])full[ _-]+test(?:[^a-z0-9]|$)/,
  /(?:^|[^a-z0-9])test(?:[^a-z0-9]|$)/,
];

function normalizeIdentity(value) {
  return String(value || '').trim().toLowerCase();
}

function isFixtureIdentity(...values) {
  for (const value of values) {
    const lower = normalizeIdentity(value);
    if (!lower) continue;
    if (REVIEWED_FIXTURE_PROFILE_IDS.has(lower)) return true;
    if (PINNED_FIXTURE_IDENTITIES.has(lower)) return true;
    if (FIXTURE_IDENTITY_PATTERNS.some((pattern) => pattern.test(lower))) return true;
  }
  return false;
}

function isPublicTractionIdentity(...values) {
  return !isFixtureIdentity(...values);
}

function isFixtureJob(job) {
  if (!job) return false;
  if (REVIEWED_FIXTURE_JOB_IDS.has(normalizeIdentity(job.id))) return true;
  return isFixtureIdentity(
    job.client_id,
    job.agent_id,
    job.clientId,
    job.agentId,
    job.title,
    job.name,
    job.description
  );
}

function shouldExcludeFixtures(value) {
  if (Array.isArray(value)) value = value[value.length - 1];
  if (value === false || String(value || '').trim().toLowerCase() === 'false') return false;
  return true;
}

module.exports = {
  REVIEWED_FIXTURE_PROFILE_IDS,
  REVIEWED_FIXTURE_JOB_IDS,
  PINNED_FIXTURE_IDENTITIES,
  normalizeIdentity,
  isFixtureIdentity,
  isPublicTractionIdentity,
  isFixtureJob,
  shouldExcludeFixtures,
};
