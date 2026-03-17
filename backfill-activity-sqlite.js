#!/usr/bin/env node
/**
 * Backfill escrow + marketplace events into SQLite activity table.
 * Skips profiles not in DB, deduplicates by profile+type+timestamp.
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DATA = path.join(__dirname, 'data');
const db = new Database(path.join(DATA, 'agentfolio.db'));

const before = db.prepare('SELECT COUNT(*) as c FROM activity').get().c;
console.log(`Existing activity rows: ${before}`);

const existing = new Set();
db.prepare('SELECT profile_id, type, created_at FROM activity').all().forEach(r => {
  existing.add(`${r.profile_id}|${r.type}|${r.created_at.slice(0,19)}`);
});

const validProfiles = new Set(db.prepare('SELECT id FROM profiles').all().map(r => r.id));
console.log(`Valid profiles in DB: ${validProfiles.size}`);

const stmt = db.prepare('INSERT INTO activity (id, profile_id, type, data, created_at) VALUES (?, ?, ?, ?, ?)');
let inserted = 0;
let skipped = 0;

function tryInsert(pid, type, data, date) {
  if (!pid || !date) return;
  if (!validProfiles.has(pid)) { skipped++; return; }
  const key = `${pid}|${type}|${date.slice(0,19)}`;
  if (existing.has(key)) return;
  const id = `act_bf_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
  try {
    stmt.run(id, pid, type, JSON.stringify(data), date);
    existing.add(key);
    inserted++;
  } catch(e) { console.log(`  ERR: ${pid} ${type}: ${e.message}`); }
}

// --- Escrows ---
const escDir = path.join(DATA, 'escrow', 'escrows');
if (fs.existsSync(escDir)) {
  for (const f of fs.readdirSync(escDir).filter(f => f.endsWith('.json'))) {
    const e = JSON.parse(fs.readFileSync(path.join(escDir, f), 'utf-8'));
    tryInsert(e.clientId, 'escrow_created', { escrowId: e.id, amount: e.amount, currency: e.currency || 'USDC' }, e.createdAt);
    if (e.depositConfirmedAt) tryInsert(e.clientId, 'escrow_funded', { escrowId: e.id, amount: e.amount }, e.depositConfirmedAt);
    if (e.status === 'released' && e.releasedAt) {
      tryInsert(e.clientId, 'escrow_released', { escrowId: e.id, amount: e.amount, to: e.agentId }, e.releasedAt);
      tryInsert(e.agentId, 'escrow_released', { escrowId: e.id, amount: e.amount, from: e.clientId }, e.releasedAt);
    }
    if (e.status === 'refunded') tryInsert(e.clientId, 'escrow_refunded', { escrowId: e.id, amount: e.amount }, e.updatedAt || e.createdAt);
  }
}

// --- Jobs ---
const jobsDir = path.join(DATA, 'marketplace', 'jobs');
if (fs.existsSync(jobsDir)) {
  for (const f of fs.readdirSync(jobsDir).filter(f => f.endsWith('.json'))) {
    const j = JSON.parse(fs.readFileSync(path.join(jobsDir, f), 'utf-8'));
    tryInsert(j.clientId, 'job_posted', { jobId: j.id, title: (j.title||'').slice(0,80) }, j.createdAt);
    if (j.status === 'completed') tryInsert(j.clientId, 'job_completed', { jobId: j.id, title: (j.title||'').slice(0,80) }, j.updatedAt || j.createdAt);
  }
}

// --- Applications ---
const appsDir = path.join(DATA, 'marketplace', 'applications');
if (fs.existsSync(appsDir)) {
  for (const f of fs.readdirSync(appsDir).filter(f => f.endsWith('.json'))) {
    let a = JSON.parse(fs.readFileSync(path.join(appsDir, f), 'utf-8'));
    if (Array.isArray(a)) a = a[0];
    if (!a) continue;
    let pid = a.agentId || a.applicantId;
    if (pid && !pid.startsWith('agent_')) pid = `agent_${pid}`;
    tryInsert(pid, 'application_submitted', { jobId: a.jobId, appId: a.id }, a.createdAt || a.appliedAt);
    if (a.status === 'accepted' && a.acceptedAt) tryInsert(pid, 'application_accepted', { jobId: a.jobId }, a.acceptedAt);
  }
}

// --- Deliverables ---
const dlvDir = path.join(DATA, 'marketplace', 'deliverables');
if (fs.existsSync(dlvDir)) {
  for (const f of fs.readdirSync(dlvDir).filter(f => f.endsWith('.json'))) {
    const d = JSON.parse(fs.readFileSync(path.join(dlvDir, f), 'utf-8'));
    let pid = d.submittedBy;
    if (pid && !pid.startsWith('agent_')) pid = `agent_${pid}`;
    tryInsert(pid, 'deliverable_submitted', { jobId: d.jobId, dlvId: d.id }, d.submittedAt);
  }
}

const after = db.prepare('SELECT COUNT(*) as c FROM activity').get().c;
console.log(`\nBackfill complete: ${inserted} inserted, ${skipped} skipped (no profile)`);
console.log(`Activity rows: ${before} → ${after}`);

const stats = db.prepare('SELECT profile_id, COUNT(*) as c FROM activity GROUP BY profile_id ORDER BY c DESC LIMIT 10').all();
console.log(`\nTop profiles:`);
stats.forEach(s => console.log(`  ${s.profile_id}: ${s.c} events`));
db.close();
