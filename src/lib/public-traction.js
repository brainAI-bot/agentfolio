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

function normalizeIdentity(value) {
  return String(value || '').trim().toLowerCase();
}

function isFixtureIdentity(...values) {
  for (const value of values) {
    const raw = String(value || '').trim();
    if (!raw) continue;
    const lower = raw.toLowerCase();
    if (REVIEWED_FIXTURE_PROFILE_IDS.has(lower)) return true;
    if (lower.startsWith('agent_sm') || /(^|_)sm\d+/.test(lower)) return true;
    if (lower.startsWith('local_') || lower.includes('local_')) return true;
    if (lower.includes('forgetest')) return true;
    if (lower.includes('cpi test') || lower.includes('cpi_test')) return true;
    if (lower.includes('full test') || lower.includes('full_test')) return true;
    if (lower.includes('test')) return true;
  }
  return false;
}

function isPublicTractionIdentity(...values) {
  return !isFixtureIdentity(...values);
}

function isFixtureJob(job) {
  if (!job) return false;
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
  normalizeIdentity,
  isFixtureIdentity,
  isPublicTractionIdentity,
  isFixtureJob,
  shouldExcludeFixtures,
};
