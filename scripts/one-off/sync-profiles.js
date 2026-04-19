#!/usr/bin/env node
/**
 * Sync DB profiles → JSON files for frontend consumption
 * Generates JSON files for profiles that exist in DB but not as JSON files
 */
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DB_PATH = '/home/ubuntu/agentfolio/data/agentfolio.db';
const PROFILES_DIR = '/home/ubuntu/agentfolio/data/profiles';

const db = new Database(DB_PATH, { readonly: true });

// Get all DB profiles
const allProfiles = db.prepare('SELECT * FROM profiles WHERE status = ?').all('active');

// Get existing JSON files
const existingJsonIds = new Set(
  fs.readdirSync(PROFILES_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace('.json', ''))
);

let synced = 0;
let skipped = 0;

for (const row of allProfiles) {
  if (existingJsonIds.has(row.id)) {
    skipped++;
    continue;
  }

  const parseJson = (val) => {
    if (!val) return null;
    try { return typeof val === 'string' ? JSON.parse(val) : val; } catch { return null; }
  };

  const profile = {
    id: row.id,
    name: row.name,
    handle: row.handle,
    bio: row.bio || `${row.name} — AI agent. [Unclaimed — register to claim this identity]`,
    avatar: row.avatar || null,
    links: parseJson(row.links) || {},
    wallets: parseJson(row.wallets) || { hyperliquid: null, solana: row.wallet || null, ethereum: null },
    skills: parseJson(row.skills) || parseJson(row.capabilities) || [],
    portfolio: parseJson(row.portfolio) || [],
    track_record: null,
    verification: parseJson(row.verification) || {},
    verification_data: parseJson(row.verification_data) || {},
    moltbook_stats: parseJson(row.moltbook_stats) || null,
    endorsements: parseJson(row.endorsements) || [],
    endorsements_given: parseJson(row.endorsements_given) || [],
    created_at: row.created_at,
    updated_at: row.updated_at,
    availability: row.availability || 'available',
    last_active_at: row.last_active_at || null,
    metadata: parseJson(row.metadata) || {},
    premium_tier: row.premium_tier || 'free',
    custom_badges: parseJson(row.custom_badges) || [],
    nft_avatar: parseJson(row.nft_avatar) || null,
    status: row.status,
    wallet: row.wallet || '',
    email: row.email || '',
    twitter: row.twitter || '',
    github: row.github || '',
    description: row.description || '',
    framework: row.framework || '',
    tags: parseJson(row.tags) || [],
    website: row.website || '',
    unclaimed: true,
  };

  const outPath = path.join(PROFILES_DIR, `${row.id}.json`);
  fs.writeFileSync(outPath, JSON.stringify(profile, null, 2));
  synced++;
  console.log(`+ ${row.id} (${row.name})`);
}

console.log(`\nDone: ${synced} synced, ${skipped} already existed (${allProfiles.length} total DB profiles)`);
db.close();
