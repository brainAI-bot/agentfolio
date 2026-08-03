#!/usr/bin/env node
'use strict';

/**
 * Removes retired/non-verifying trust providers and auto-pass attestations
 * from mutable profile state.
 *
 * Default mode is a dry run. Pass --write to delete retired/auto-pass rows
 * from SQLite verification/attestation tables, strip retired keys from JSON
 * profile state, and rescore affected profiles from canonical providers only.
 */

const fs = require('fs');
const path = require('path');
const {
  CANONICAL_TRUST_PROVIDERS,
  filterCanonicalTrustData,
  isAutoPassAttestation,
  isRetiredTrustProvider,
} = require('../src/lib/canonical-verification-providers');
const { computeTrustScore } = require('../src/lib/compute-trust-score');

const ROOT = path.join(__dirname, '..');
const DB_PATH = process.env.AGENTFOLIO_DB_PATH || path.join(ROOT, 'data', 'agentfolio.db');
const PROFILES_DIR = process.env.AGENTFOLIO_PROFILES_DIR || path.join(ROOT, 'data', 'profiles');

function readOption(argv, name) {
  const prefix = `${name}=`;
  const inline = argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = argv.indexOf(name);
  if (index >= 0 && argv[index + 1] && !argv[index + 1].startsWith('--')) return argv[index + 1];
  return '';
}

function readRepeatedOption(argv, names) {
  const values = [];
  for (const name of names) {
    const prefix = `${name}=`;
    argv.forEach((arg, index) => {
      if (arg.startsWith(prefix)) values.push(arg.slice(prefix.length));
      if (arg === name && argv[index + 1] && !argv[index + 1].startsWith('--')) values.push(argv[index + 1]);
    });
  }
  return values;
}

function splitList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseCliOptions(argv = process.argv.slice(2)) {
  return {
    write: argv.includes('--write'),
    dbPath: readOption(argv, '--db-path') || DB_PATH,
    profilesDir: readOption(argv, '--profiles-dir') || PROFILES_DIR,
    deployedBaseUrl: readOption(argv, '--deployed-base-url') || process.env.AGENTFOLIO_DEPLOYED_BASE_URL || '',
    deployedProfilePageLimit: Number(readOption(argv, '--deployed-profile-page-limit') || 100),
    deployedProfileMaxPages: Number(readOption(argv, '--deployed-profile-max-pages') || 100),
    deployedAgentIds: [
      ...readRepeatedOption(argv, ['--deployed-agent-id', '--agent-id']),
      ...splitList(process.env.AGENTFOLIO_DEPLOYED_AGENT_IDS),
    ],
  };
}

function parseJson(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

function jsonChanged(before, after) {
  return JSON.stringify(before || {}) !== JSON.stringify(after || {});
}

function cleanupMatchForRow(row = {}) {
  const platform = row.platform || row.type || null;
  if (isRetiredTrustProvider(platform)) {
    return {
      platform,
      reason: 'retired_provider',
      tuple: [platform, 'platform'],
    };
  }

  const data = {
    ...row,
    proof: parseJson(row.proof, row.proof || {}),
  };
  if (isAutoPassAttestation(data)) {
    const proof = parseJson(row.proof, {});
    const marker = data.auto === true ? 'auto=true'
      : data.autoPass === true ? 'autoPass=true'
      : data.auto_pass === true ? 'auto_pass=true'
      : data.autoVerified === true ? 'autoVerified=true'
      : proof.auto === true ? 'proof.auto=true'
      : proof.autoPass === true ? 'proof.autoPass=true'
      : proof.auto_pass === true ? 'proof.auto_pass=true'
      : proof.autoVerified === true ? 'proof.autoVerified=true'
      : data.source ? `source=${data.source}`
      : data.method ? `method=${data.method}`
      : data.type ? `type=${data.type}`
      : proof.source ? `proof.source=${proof.source}`
      : proof.method ? `proof.method=${proof.method}`
      : proof.type ? `proof.type=${proof.type}`
      : 'auto_pass_marker';
    return {
      platform,
      reason: 'auto_pass_attestation',
      tuple: [platform, marker],
    };
  }

  return null;
}

function rowIsRetiredOrAutoPass(row = {}) {
  return Boolean(cleanupMatchForRow(row));
}

function sqliteMatchTuple(table, row = {}) {
  const match = cleanupMatchForRow(row);
  if (!match) return null;
  return {
    table,
    rowId: row.id ?? row.rowid ?? null,
    platform: match.platform,
    reason: match.reason,
    match: match.tuple,
  };
}

function jsonProfileMatchTuple(file, platform, data = {}) {
  const match = cleanupMatchForRow({ platform, ...data });
  if (!match) return null;
  return {
    file,
    platform: match.platform,
    reason: match.reason,
    match: match.tuple,
  };
}

function rescoreProfileRecord(profile = {}, verificationData = {}) {
  const trust = computeTrustScore({
    profile: {
      ...profile,
      verificationData,
      verification_data: verificationData,
    },
  });
  const score = trust.trustScore;
  return {
    trustScore: score,
    reputationScore: score,
    verification: {
      ...parseJson(profile.verification, profile.verification || {}),
      score,
    },
  };
}

function sqliteTableExists(db, tableName) {
  return Boolean(db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName));
}

function createSummary(write) {
  return {
    mode: write ? 'write' : 'dry-run',
    canonicalTrustProviders: CANONICAL_TRUST_PROVIDERS,
    sqliteVerificationRowsRemoved: 0,
    sqliteAttestationRowsRemoved: 0,
    sqliteProfilesUpdated: 0,
    sqliteProfilesRescored: 0,
    jsonProfilesUpdated: 0,
    jsonProfilesRescored: 0,
    sqliteVerificationMatches: [],
    sqliteAttestationMatches: [],
    sqliteProfileMatches: [],
    jsonProfileMatches: [],
    deployedDetectionRan: false,
    deployedDetectionComplete: false,
    deployedVerifiedClean: false,
    deployedDetectionSource: null,
    deployedBaseUrl: null,
    deployedProfilesTotal: null,
    deployedProfilesDiscovered: 0,
    deployedProfilesCovered: 0,
    deployedProfilePagesFetched: 0,
    deployedProfilesTruncated: false,
    deployedProfileCoverage: {
      source: 'skipped',
      requestedAgentIds: 0,
      discoveredAgentIds: 0,
      coveredAgentIds: 0,
      totalProfiles: null,
      pagesFetched: 0,
      truncated: false,
    },
    deployedAttestationRowsDetected: 0,
    deployedAttestationMatches: [],
    deployedAttestationErrors: [],
    deployedAttestationEmptyAgents: [],
    deployedAnomalies: [],
    skipped: [],
  };
}

function cleanupSqlite({ dbPath, write, summary }) {
  if (!fs.existsSync(dbPath)) return;

  let Database;
  try {
    Database = require('better-sqlite3');
  } catch (error) {
    summary.skipped.push(`sqlite cleanup skipped: ${error.code || error.message}`);
    return;
  }

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  const hasVerifications = sqliteTableExists(db, 'verifications');
  const retiredVerificationRows = hasVerifications
    ? db.prepare('SELECT id, platform, proof FROM verifications').all().filter(rowIsRetiredOrAutoPass)
    : [];
  summary.sqliteVerificationRowsRemoved = retiredVerificationRows.length;
  summary.sqliteVerificationMatches = retiredVerificationRows
    .map((row) => sqliteMatchTuple('verifications', row))
    .filter(Boolean);

  const hasAttestations = sqliteTableExists(db, 'attestations');
  const retiredAttestationRows = hasAttestations
    ? db.prepare('SELECT rowid, platform, proof, source, method FROM attestations').all().filter(rowIsRetiredOrAutoPass)
    : [];
  summary.sqliteAttestationRowsRemoved = retiredAttestationRows.length;
  summary.sqliteAttestationMatches = retiredAttestationRows
    .map((row) => sqliteMatchTuple('attestations', row))
    .filter(Boolean);

  const profiles = sqliteTableExists(db, 'profiles') ? db.prepare('SELECT * FROM profiles').all() : [];
  const profileUpdates = [];
  for (const profile of profiles) {
    const current = parseJson(profile.verification_data, {});
    const filteredForScore = filterCanonicalTrustData(current);
    const scores = rescoreProfileRecord(profile, filteredForScore);
    const storedScore = Number(profile.trust_score ?? profile.trustScore ?? profile.reputation_score ?? profile.reputationScore ?? 0);
    const needsScore = storedScore !== scores.trustScore;
    const cleaned = { ...current };
    for (const [platform, data] of Object.entries(current || {})) {
      const match = cleanupMatchForRow({ platform, ...data });
      if (match) delete cleaned[platform];
    }
    if (jsonChanged(current, cleaned) || needsScore) {
      profileUpdates.push({ id: profile.id, verificationData: cleaned, scores });
      for (const [platform, data] of Object.entries(current || {})) {
        const match = jsonProfileMatchTuple(profile.id, platform, data);
        if (match) summary.sqliteProfileMatches.push(match);
      }
    }
  }
  summary.sqliteProfilesUpdated = profileUpdates.length;
  summary.sqliteProfilesRescored = profileUpdates.length;

  if (write) {
    const deleteVerificationById = hasVerifications ? db.prepare('DELETE FROM verifications WHERE id = ?') : null;
    const deleteAttestationByRowid = hasAttestations ? db.prepare('DELETE FROM attestations WHERE rowid = ?') : null;
    const columns = new Set(db.prepare('PRAGMA table_info(profiles)').all().map((column) => column.name));
    const now = new Date().toISOString();

    db.transaction(() => {
      if (deleteVerificationById) {
        for (const row of retiredVerificationRows) deleteVerificationById.run(row.id);
      }
      if (deleteAttestationByRowid) {
        for (const row of retiredAttestationRows) deleteAttestationByRowid.run(row.rowid);
      }
      for (const profile of profileUpdates) {
        const sets = [];
        const values = [];
        if (columns.has('verification_data')) {
          sets.push('verification_data = ?');
          values.push(JSON.stringify(profile.verificationData));
        }
        if (columns.has('trust_score')) {
          sets.push('trust_score = ?');
          values.push(profile.scores.trustScore);
        }
        if (columns.has('reputation_score')) {
          sets.push('reputation_score = ?');
          values.push(profile.scores.reputationScore);
        }
        if (columns.has('verification')) {
          sets.push('verification = ?');
          values.push(JSON.stringify(profile.scores.verification));
        }
        if (columns.has('updated_at')) {
          sets.push('updated_at = ?');
          values.push(now);
        }
        if (sets.length > 0) {
          db.prepare(`UPDATE profiles SET ${sets.join(', ')} WHERE id = ?`).run(...values, profile.id);
        }
      }
    })();
  }

  db.close();
}

function cleanupJsonProfiles({ profilesDir, write, summary }) {
  if (!fs.existsSync(profilesDir)) return;

  const files = fs.readdirSync(profilesDir).filter((file) => file.endsWith('.json'));
  for (const file of files) {
    const filePath = path.join(profilesDir, file);
    let profile;
    try {
      profile = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (_) {
      continue;
    }

    const current = profile.verificationData || {};
    const filteredForScore = filterCanonicalTrustData(current);
    const scores = rescoreProfileRecord(profile, filteredForScore);
    const cleaned = { ...current };
    for (const [platform, data] of Object.entries(current || {})) {
      const match = cleanupMatchForRow({ platform, ...data });
      if (match) delete cleaned[platform];
    }
    const changed = jsonChanged(current, cleaned);
    const scoreChanged = profile.trustScore !== scores.trustScore || profile.reputationScore !== scores.reputationScore;
    if (!changed && !scoreChanged) continue;

    summary.jsonProfilesUpdated += 1;
    summary.jsonProfilesRescored += 1;
    for (const [platform, data] of Object.entries(current || {})) {
      const match = jsonProfileMatchTuple(file, platform, data);
      if (match) summary.jsonProfileMatches.push(match);
    }

    if (write) {
      profile.verificationData = cleaned;
      profile.trustScore = scores.trustScore;
      profile.reputationScore = scores.reputationScore;
      profile.verification = scores.verification;
      profile.updatedAt = new Date().toISOString();
      fs.writeFileSync(filePath, JSON.stringify(profile, null, 2));
    }
  }
}

function cleanup({ write = false, dbPath = DB_PATH, profilesDir = PROFILES_DIR } = {}) {
  const summary = createSummary(write);
  cleanupSqlite({ dbPath, write, summary });
  cleanupJsonProfiles({ profilesDir, write, summary });
  return summary;
}

function unique(values) {
  return [...new Set((values || []).map((value) => String(value || '').trim()).filter(Boolean))];
}

function normalizeBaseUrl(value) {
  const normalized = String(value || '').trim().replace(/\/+$/, '');
  if (!normalized) return '';
  try {
    const parsed = new URL(normalized);
    return ['http:', 'https:'].includes(parsed.protocol) ? normalized : '';
  } catch (_) {
    return '';
  }
}

function extractProfiles(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.profiles)) return payload.profiles;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.data?.profiles)) return payload.data.profiles;
  if (Array.isArray(payload?.results)) return payload.results;
  if (Array.isArray(payload?.data?.results)) return payload.data.results;
  return [];
}

function extractAgentIdFromProfile(profile = {}) {
  return profile?.id || profile?.profileId || profile?.agentId || profile?.handle;
}

function extractAgentIdsFromProfiles(payload) {
  return unique(extractProfiles(payload).map(extractAgentIdFromProfile));
}

function profileHasVerificationEvidence(profile = {}) {
  const candidates = [
    profile?.verificationData,
    profile?.verification_data,
    profile?.verifications,
    profile?.verification,
  ];
  return candidates.some((value) => {
    const data = parseJson(value, value || {});
    if (!data || typeof data !== 'object') return false;
    return Object.values(data).some((entry) => (
      entry === true
      || entry?.verified === true
      || Boolean(entry?.txSignature || entry?.tx_signature || entry?.proof || entry?.memo)
    ));
  });
}

function readNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number >= 0) return number;
  }
  return null;
}

function extractProfilePagination(payload, fallbackPage, fallbackLimit, count) {
  const page = readNumber(payload?.page, payload?.pagination?.page, payload?.meta?.page, fallbackPage) || fallbackPage;
  const limit = readNumber(
    payload?.limit,
    payload?.pageSize,
    payload?.pagination?.limit,
    payload?.pagination?.pageSize,
    payload?.meta?.limit,
    fallbackLimit,
  ) || fallbackLimit;
  const total = readNumber(payload?.total, payload?.totalProfiles, payload?.pagination?.total, payload?.meta?.total);
  const pages = readNumber(
    payload?.pages,
    payload?.totalPages,
    payload?.pagination?.pages,
    payload?.pagination?.totalPages,
    payload?.meta?.pages,
    payload?.meta?.totalPages,
  );
  const nextCursor = payload?.nextCursor || payload?.pagination?.nextCursor || payload?.meta?.nextCursor || null;
  const nextUrl = payload?.next || payload?.nextUrl || payload?.pagination?.next || payload?.meta?.next || null;

  return {
    page,
    limit,
    total,
    pages: pages || (total !== null && limit > 0 ? Math.ceil(total / limit) : null),
    nextCursor,
    nextUrl,
    count,
  };
}

function extractAttestations(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.attestations)) return payload.attestations;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.data?.attestations)) return payload.data.attestations;
  return [];
}

async function fetchJson(url, fetchImpl = global.fetch) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch unavailable in this Node runtime');
  }
  const response = await fetchImpl(url, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText || ''}`.trim());
  return response.json();
}

function buildProfilesUrl(baseUrl, page, limit, cursor) {
  const url = new URL('/api/profiles', `${baseUrl}/`);
  if (cursor) {
    url.searchParams.set('cursor', cursor);
  } else {
    url.searchParams.set('page', String(page));
    url.searchParams.set('limit', String(limit));
  }
  return url.toString();
}

async function resolveDeployedAgentIds(baseUrl, explicitAgentIds, fetchImpl, options = {}) {
  const fromArgs = unique(explicitAgentIds);
  if (fromArgs.length > 0) {
    return {
      agentIds: fromArgs,
      profilesById: new Map(fromArgs.map((agentId) => [agentId, null])),
      coverage: {
        source: 'explicit-agent-ids',
        requestedAgentIds: fromArgs.length,
        discoveredAgentIds: fromArgs.length,
        totalProfiles: null,
        pagesFetched: 0,
        truncated: false,
      },
    };
  }

  const limit = Number.isFinite(options.profilePageLimit) && options.profilePageLimit > 0
    ? options.profilePageLimit
    : 100;
  const maxPages = Number.isFinite(options.maxProfilePages) && options.maxProfilePages > 0
    ? options.maxProfilePages
    : 100;
  const profilesById = new Map();
  let page = 1;
  let cursor = null;
  let nextUrl = null;
  let totalProfiles = null;
  let expectedPages = null;
  let pagesFetched = 0;
  let truncated = false;

  while (pagesFetched < maxPages) {
    const url = nextUrl || buildProfilesUrl(baseUrl, page, limit, cursor);
    const payload = await fetchJson(url, fetchImpl);
    const profiles = extractProfiles(payload);
    for (const profile of profiles) {
      const agentId = extractAgentIdFromProfile(profile);
      if (agentId) profilesById.set(String(agentId), profile);
    }

    pagesFetched += 1;
    const pagination = extractProfilePagination(payload, page, limit, profiles.length);
    totalProfiles = pagination.total ?? totalProfiles;
    expectedPages = pagination.pages ?? expectedPages;

    if (pagination.nextUrl) {
      nextUrl = new URL(pagination.nextUrl, `${baseUrl}/`).toString();
      cursor = null;
      page += 1;
      continue;
    }
    if (pagination.nextCursor) {
      cursor = pagination.nextCursor;
      nextUrl = null;
      page += 1;
      continue;
    }
    if (expectedPages && page < expectedPages) {
      page += 1;
      nextUrl = null;
      cursor = null;
      continue;
    }
    break;
  }

  if (expectedPages && pagesFetched < expectedPages) truncated = true;
  if (totalProfiles !== null && profilesById.size < totalProfiles) truncated = true;

  return {
    agentIds: [...profilesById.keys()],
    profilesById,
    coverage: {
      source: 'api-profiles',
      requestedAgentIds: 0,
      discoveredAgentIds: profilesById.size,
      totalProfiles,
      pagesFetched,
      truncated,
    },
  };
}

function updateDeployedCoverage(summary, coverage = {}) {
  summary.deployedProfilesTotal = coverage.totalProfiles ?? null;
  summary.deployedProfilesDiscovered = coverage.discoveredAgentIds || 0;
  summary.deployedProfilePagesFetched = coverage.pagesFetched || 0;
  summary.deployedProfilesTruncated = Boolean(coverage.truncated);
  summary.deployedProfileCoverage = {
    source: coverage.source || 'unknown',
    requestedAgentIds: coverage.requestedAgentIds || 0,
    discoveredAgentIds: coverage.discoveredAgentIds || 0,
    coveredAgentIds: summary.deployedProfilesCovered || 0,
    totalProfiles: coverage.totalProfiles ?? null,
    pagesFetched: coverage.pagesFetched || 0,
    truncated: Boolean(coverage.truncated),
  };
}

function updateDeployedVerdict(summary) {
  summary.deployedDetectionComplete = Boolean(
    summary.deployedDetectionRan
    && !summary.deployedProfilesTruncated
    && summary.deployedAttestationErrors.length === 0
  );
  summary.deployedProfileCoverage.coveredAgentIds = summary.deployedProfilesCovered;
  summary.deployedVerifiedClean = Boolean(
    summary.deployedDetectionComplete
    && summary.deployedAttestationMatches.length === 0
    && summary.deployedAnomalies.length === 0
  );
  return summary;
}

async function detectDeployedAttestations({
  baseUrl,
  agentIds = [],
  summary,
  fetchImpl = global.fetch,
  profilePageLimit,
  maxProfilePages,
}) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  if (!normalizedBaseUrl) {
    summary.deployedAnomalies.push({
      type: 'deployed_detection_skipped',
      reason: baseUrl ? 'invalid_base_url' : 'missing_base_url',
    });
    summary.skipped.push('deployed attestation detection skipped: missing or invalid deployed base URL');
    return updateDeployedVerdict(summary);
  }

  summary.deployedDetectionRan = true;
  summary.deployedDetectionSource = 'public-api-chain-cache';
  summary.deployedBaseUrl = normalizedBaseUrl;

  let resolvedAgentIds = [];
  let profilesById = new Map();
  try {
    const resolved = await resolveDeployedAgentIds(normalizedBaseUrl, agentIds, fetchImpl, {
      profilePageLimit,
      maxProfilePages,
    });
    resolvedAgentIds = resolved.agentIds;
    profilesById = resolved.profilesById;
    updateDeployedCoverage(summary, resolved.coverage);
    if (resolved.coverage.truncated) {
      summary.deployedAnomalies.push({
        type: 'profile_detection_truncated',
        discoveredAgentIds: resolved.coverage.discoveredAgentIds,
        totalProfiles: resolved.coverage.totalProfiles,
        pagesFetched: resolved.coverage.pagesFetched,
      });
    }
  } catch (error) {
    summary.deployedAttestationErrors.push({
      url: `${normalizedBaseUrl}/api/profiles`,
      error: error.message,
    });
    return updateDeployedVerdict(summary);
  }

  for (const agentId of resolvedAgentIds) {
    const url = `${normalizedBaseUrl}/api/satp/attestations/by-agent/${encodeURIComponent(agentId)}`;
    try {
      const payload = await fetchJson(url, fetchImpl);
      const attestations = extractAttestations(payload);
      summary.deployedProfilesCovered += 1;
      summary.deployedAttestationRowsDetected += attestations.length;
      if (attestations.length === 0) {
        summary.deployedAttestationEmptyAgents.push(agentId);
        const profile = profilesById.get(agentId);
        summary.deployedAnomalies.push({
          type: 'empty_attestations',
          agentId,
          reason: profileHasVerificationEvidence(profile)
            ? 'profile_has_verification_evidence_but_chain_cache_returned_empty'
            : 'chain_cache_returned_empty',
        });
      }
      for (const attestation of attestations) {
        const match = cleanupMatchForRow({
          ...attestation,
          platform: attestation?.platform || attestation?.attestationType || attestation?.type,
          proof: attestation?.proof || attestation?.memo || {},
        });
        if (!match) continue;
        summary.deployedAttestationMatches.push({
          agentId,
          platform: match.platform,
          reason: match.reason,
          match: match.tuple,
          txSignature: attestation?.txSignature || attestation?.tx_signature || null,
          solscanUrl: attestation?.solscanUrl || null,
        });
      }
    } catch (error) {
      summary.deployedAttestationErrors.push({ agentId, url, error: error.message });
    }
  }

  return updateDeployedVerdict(summary);
}

async function cleanupWithDeployedAttestations(options = {}) {
  const summary = cleanup(options);
  return detectDeployedAttestations({
    baseUrl: options.deployedBaseUrl,
    agentIds: options.deployedAgentIds,
    summary,
    fetchImpl: options.fetchImpl,
    profilePageLimit: options.deployedProfilePageLimit,
    maxProfilePages: options.deployedProfileMaxPages,
  });
}

if (require.main === module) {
  cleanupWithDeployedAttestations(parseCliOptions())
    .then((summary) => {
      console.log(JSON.stringify(summary, null, 2));
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}

module.exports = {
  cleanup,
  cleanupWithDeployedAttestations,
  cleanupMatchForRow,
  detectDeployedAttestations,
  rowIsRetiredOrAutoPass,
  rescoreProfileRecord,
};
