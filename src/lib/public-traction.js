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

function parseVerificationData(verificationData) {
  if (!verificationData) return {};
  if (typeof verificationData === 'object') return verificationData;
  try {
    return JSON.parse(verificationData);
  } catch (_) {
    return {};
  }
}

/**
 * Designed SATP join / on-chain identity signal for /api/stats onChain.
 * Counts a real profile that has SATP V3/V2 join evidence or a verified Solana wallet.
 * Reads RAW verification_data (canonical filter strips satp_v3 / auto-pass solana).
 */
function isSatpJoinedOrSolanaVerified(verificationData) {
  const vd = parseVerificationData(verificationData);
  if (vd.satp_v3 && vd.satp_v3.verified) return true;
  if (vd.satp && vd.satp.verified) return true;
  if (vd.solana && vd.solana.verified) return true;
  return false;
}

module.exports = {
  normalizeIdentity,
  isFixtureIdentity,
  isPublicTractionIdentity,
  isFixtureJob,
  parseVerificationData,
  isSatpJoinedOrSolanaVerified,
};
