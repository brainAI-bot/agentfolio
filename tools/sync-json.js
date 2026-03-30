#!/usr/bin/env node
/**
 * Sync DB profiles → JSON files for frontend SSR
 * Creates JSON files in data/profiles/ for any DB profiles that don't have one.
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', 'data', 'agentfolio.db');
const PROFILES_DIR = path.join(__dirname, '..', 'data', 'profiles');

function parseJson(val, fallback = {}) {
  if (!val) return fallback;
  if (typeof val === 'object') return val;
  try { return JSON.parse(val); } catch { return fallback; }
}

const db = new Database(DB_PATH, { readonly: true });
const rows = db.prepare('SELECT * FROM profiles WHERE status = ? ORDER BY name').all('active');

let created = 0, updated = 0, skipped = 0;

for (const row of rows) {
  const jsonPath = path.join(PROFILES_DIR, `${row.id}.json`);
  const exists = fs.existsSync(jsonPath);
  
  const metadata = parseJson(row.metadata);
  const links = parseJson(row.links);
  const wallets = parseJson(row.wallets);
  const skills = parseJson(row.skills, []);
  const tags = parseJson(row.tags, []);
  const capabilities = parseJson(row.capabilities, []);
  
  const profile = {
    id: row.id,
    name: row.name || '',
    handle: row.handle || '',
    bio: row.bio || row.description || '',
    description: row.description || row.bio || '',
    avatar: row.avatar || '',
    website: row.website || links.website || '',
    framework: row.framework || '',
    skills: Array.isArray(skills) ? skills : Object.values(skills),
    tags: Array.isArray(tags) ? tags : [],
    capabilities: Array.isArray(capabilities) ? capabilities : [],
    links,
    wallets,
    wallet: row.wallet || wallets.solana || '',
    status: row.status || 'active',
    unclaimed: metadata.unclaimed === true || metadata.isPlaceholder === true,
    metadata,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };

  if (exists) {
    // Only update if DB is newer
    try {
      const existing = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
      // Merge: keep existing fields, update from DB
      const merged = { ...existing, ...profile, links: { ...existing.links, ...profile.links } };
      fs.writeFileSync(jsonPath, JSON.stringify(merged, null, 2));
      updated++;
    } catch {
      fs.writeFileSync(jsonPath, JSON.stringify(profile, null, 2));
      updated++;
    }
  } else {
    fs.writeFileSync(jsonPath, JSON.stringify(profile, null, 2));
    created++;
  }
}

db.close();

const totalFiles = fs.readdirSync(PROFILES_DIR).filter(f => f.endsWith('.json')).length;
console.log(`✅ Sync complete: ${created} created, ${updated} updated, ${totalFiles} total JSON files`);
