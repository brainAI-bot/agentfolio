#!/usr/bin/env node
'use strict';

const path = require('path');
const Database = require('better-sqlite3');
const {
  classifyJobReview,
  classifyPeerReview,
} = require('../src/lib/canonical-review-evidence');

const DEFAULT_DB_PATH = path.join(__dirname, '..', 'data', 'agentfolio.db');

function tableExists(db, table) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
}

function ensureClassificationColumns(db, table) {
  const columns = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name));
  if (!columns.has('trust_status')) db.exec(`ALTER TABLE ${table} ADD COLUMN trust_status TEXT DEFAULT 'quarantined'`);
  if (!columns.has('trust_quarantine_reason')) db.exec(`ALTER TABLE ${table} ADD COLUMN trust_quarantine_reason TEXT`);
  if (!columns.has('trust_classified_at')) db.exec(`ALTER TABLE ${table} ADD COLUMN trust_classified_at TEXT`);
}

function classifyTable(db, table, classifier) {
  if (!tableExists(db, table)) return { table, eligible: 0, quarantined: 0 };
  ensureClassificationColumns(db, table);
  const rows = db.prepare(`SELECT * FROM ${table}`).all();
  const update = db.prepare(`
    UPDATE ${table}
    SET trust_status = ?, trust_quarantine_reason = ?, trust_classified_at = ?
    WHERE id = ?
  `);
  let eligible = 0;
  let quarantined = 0;
  const now = new Date().toISOString();
  const transaction = db.transaction(() => {
    for (const review of rows) {
      const result = classifier(db, review);
      if (result.eligible) eligible += 1;
      else quarantined += 1;
      update.run(result.eligible ? 'canonical' : 'quarantined', result.reason || null, now, review.id);
    }
  });
  transaction();
  return { table, eligible, quarantined };
}

function migrate(db) {
  const tables = [
    classifyTable(db, 'reviews', classifyJobReview),
    classifyTable(db, 'peer_reviews', classifyPeerReview),
  ];
  return {
    tables,
    eligible: tables.reduce((sum, item) => sum + item.eligible, 0),
    quarantined: tables.reduce((sum, item) => sum + item.quarantined, 0),
  };
}

if (require.main === module) {
  const dbArg = process.argv.find((arg) => arg.startsWith('--db='));
  const expectedArg = process.argv.find((arg) => arg.startsWith('--expect-quarantined='));
  const dbPath = dbArg ? path.resolve(dbArg.slice('--db='.length)) : DEFAULT_DB_PATH;
  const expected = expectedArg ? Number(expectedArg.slice('--expect-quarantined='.length)) : null;
  const db = new Database(dbPath);
  try {
    const result = migrate(db);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (Number.isFinite(expected) && result.quarantined !== expected) {
      process.stderr.write(`Expected ${expected} quarantined reviews, found ${result.quarantined}\n`);
      process.exitCode = 1;
    }
  } finally {
    db.close();
  }
}

module.exports = { migrate };
