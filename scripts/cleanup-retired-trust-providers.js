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
  isCanonicalTrustProvider,
} = require('../src/lib/canonical-verification-providers');
const { computeTrustScore } = require('../src/lib/compute-trust-score');

const WRITE = process.argv.includes('--write');
const ROOT = path.join(__dirname, '..');
const DB_PATH = process.env.AGENTFOLIO_DB_PATH || path.join(ROOT, 'data', 'agentfolio.db');
const PROFILES_DIR = process.env.AGENTFOLIO_PROFILES_DIR || path.join(ROOT, 'data', 'profiles');

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

function rowIsRetiredOrAutoPass(row = {}) {
  return !isCanonicalTrustProvider(row.platform) || isAutoPassAttestation({
    ...row,
    proof: parseJson(row.proof, row.proof || {}),
  });
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

  const hasAttestations = sqliteTableExists(db, 'attestations');
  const retiredAttestationRows = hasAttestations
    ? db.prepare('SELECT rowid, platform, proof, source, method FROM attestations').all().filter(rowIsRetiredOrAutoPass)
    : [];
  summary.sqliteAttestationRowsRemoved = retiredAttestationRows.length;

  const profiles = sqliteTableExists(db, 'profiles') ? db.prepare('SELECT * FROM profiles').all() : [];
  const profileUpdates = [];
  for (const profile of profiles) {
    const current = parseJson(profile.verification_data, {});
    const filtered = filterCanonicalTrustData(current);
    const scores = rescoreProfileRecord(profile, filtered);
    const storedScore = Number(profile.trust_score ?? profile.trustScore ?? profile.reputation_score ?? profile.reputationScore ?? 0);
    const needsScore = storedScore !== scores.trustScore;
    if (jsonChanged(current, filtered) || needsScore) {
      profileUpdates.push({ id: profile.id, verificationData: filtered, scores });
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
    const filtered = filterCanonicalTrustData(current);
    const scores = rescoreProfileRecord(profile, filtered);
    const changed = jsonChanged(current, filtered);
    const scoreChanged = profile.trustScore !== scores.trustScore || profile.reputationScore !== scores.reputationScore;
    if (!changed && !scoreChanged) continue;

    summary.jsonProfilesUpdated += 1;
    summary.jsonProfilesRescored += 1;

    if (write) {
      profile.verificationData = filtered;
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

if (require.main === module) {
  console.log(JSON.stringify(cleanup({ write: WRITE }), null, 2));
}

module.exports = {
  cleanup,
  rowIsRetiredOrAutoPass,
  rescoreProfileRecord,
};
