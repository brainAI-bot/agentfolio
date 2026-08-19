/**
 * Public traction filter — exclude smoke/QA/fixture identities from
 * advertised counts and copy. Patterns are derived from live explorer
 * names and profile ids (agent_sm*, local_*, *test*, CPI Test, Full Test, forgetest).
 * Does not delete production data.
 */

function normalizeIdentity(value) {
  return String(value || '').trim().toLowerCase();
}

function isFixtureIdentity(...values) {
  for (const value of values) {
    const raw = String(value || '').trim();
    if (!raw) continue;
    const lower = raw.toLowerCase();
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

module.exports = {
  normalizeIdentity,
  isFixtureIdentity,
  isPublicTractionIdentity,
  isFixtureJob,
};
