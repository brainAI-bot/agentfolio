#!/usr/bin/env node
'use strict';

/**
 * Removes retired/non-verifying trust providers from mutable profile state.
 *
 * Default mode is a dry run. Pass --write to delete retired rows from SQLite
 * verification/attestation tables and strip retired keys from profiles.
 */

const fs = require('fs');
const path = require('path');
const {
  CANONICAL_TRUST_PROVIDERS,
  filterCanonicalTrustData,
  isCanonicalTrustProvider,
} = require('../src/lib/canonical-verification-providers');

const WRITE = process.argv.includes('--write');
const ROOT = path.join(__dirname, '..');
const DB_PATH = process.env.AGENTFOLIO_DB_PATH || path.join(ROOT, 'data', 'agentfolio.db');
const PROFILES_DIR = process.env.AGENTFOLIO_PROFILES_DIR || path.join(ROOT, 'data', 'profiles');

function jsonChanged(before, after) {
  return JSON.stringify(before || {}) !== JSON.stringify(after || {});
}

function listRetiredKeys(obj = {}) {
  return Object.keys(obj || {}).filter((key) => !isCanonicalTrustProvider(key));
}

const summary = {
  mode: WRITE ? 'write' : 'dry-run',
  canonicalTrustProviders: CANONICAL_TRUST_PROVIDERS,
  sqliteVerificationRowsRemoved: 0,
  sqliteAttestationRowsRemoved: 0,
  sqliteProfilesUpdated: 0,
  jsonProfilesUpdated: 0,
  skipped: [],
};

if (fs.existsSync(DB_PATH)) {
  let Database;
  try {
    Database = require('better-sqlite3');
  } catch (error) {
    summary.skipped.push(`sqlite cleanup skipped: ${error.code || error.message}`);
  }

  if (Database) {
    const db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');

    const retiredVerificationRows = db
      .prepare('SELECT id FROM verifications WHERE platform NOT IN (?, ?, ?, ?)')
      .all(...CANONICAL_TRUST_PROVIDERS);
    summary.sqliteVerificationRowsRemoved = retiredVerificationRows.length;

    const hasAttestations = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'attestations'")
      .get();
    if (hasAttestations) {
      const retiredAttestationRows = db
        .prepare('SELECT rowid FROM attestations WHERE platform NOT IN (?, ?, ?, ?)')
        .all(...CANONICAL_TRUST_PROVIDERS);
      summary.sqliteAttestationRowsRemoved = retiredAttestationRows.length;
    }

    const profiles = db.prepare('SELECT id, verification_data FROM profiles').all();
    const profileUpdates = [];
    for (const profile of profiles) {
      let current = {};
      try {
        current = JSON.parse(profile.verification_data || '{}');
      } catch (_) {
        current = {};
      }
      const filtered = filterCanonicalTrustData(current);
      if (jsonChanged(current, filtered)) {
        profileUpdates.push({ id: profile.id, verificationData: filtered });
      }
    }
    summary.sqliteProfilesUpdated = profileUpdates.length;

    if (WRITE) {
      const deleteVerifications = db.prepare('DELETE FROM verifications WHERE platform NOT IN (?, ?, ?, ?)');
      const deleteAttestations = hasAttestations
        ? db.prepare('DELETE FROM attestations WHERE platform NOT IN (?, ?, ?, ?)')
        : null;
      const updateProfile = db.prepare('UPDATE profiles SET verification_data = ?, updated_at = ? WHERE id = ?');
      const now = new Date().toISOString();

      db.transaction(() => {
        deleteVerifications.run(...CANONICAL_TRUST_PROVIDERS);
        if (deleteAttestations) deleteAttestations.run(...CANONICAL_TRUST_PROVIDERS);
        for (const profile of profileUpdates) {
          updateProfile.run(JSON.stringify(profile.verificationData), now, profile.id);
        }
      })();
    }

    db.close();
  }
}

if (fs.existsSync(PROFILES_DIR)) {
  const files = fs.readdirSync(PROFILES_DIR).filter((file) => file.endsWith('.json'));
  for (const file of files) {
    const filePath = path.join(PROFILES_DIR, file);
    let profile;
    try {
      profile = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (_) {
      continue;
    }
    const retiredKeys = listRetiredKeys(profile.verificationData || {});
    if (retiredKeys.length === 0) continue;
    profile.verificationData = filterCanonicalTrustData(profile.verificationData || {});
    summary.jsonProfilesUpdated += 1;
    if (WRITE) {
      profile.updatedAt = profile.updatedAt || new Date().toISOString();
      fs.writeFileSync(filePath, JSON.stringify(profile, null, 2));
    }
  }
}

console.log(JSON.stringify(summary, null, 2));
