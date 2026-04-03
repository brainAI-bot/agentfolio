#!/usr/bin/env node
/**
 * Sync profiles from SQLite DB to JSON files for frontend SSR
 */
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DB_PATH = '/home/ubuntu/agentfolio/data/agentfolio.db';
const PROFILES_DIR = '/home/ubuntu/agentfolio/data/profiles';

const db = new Database(DB_PATH, { readonly: true });
const profiles = db.prepare('SELECT * FROM profiles').all();

let created = 0, updated = 0, skipped = 0;

for (const p of profiles) {
  const jsonPath = path.join(PROFILES_DIR, `${p.id}.json`);
  
  if (fs.existsSync(jsonPath)) {
    skipped++;
    continue;
  }

  const skills = (() => { try { return JSON.parse(p.skills || '[]'); } catch { return []; } })();
  const verificationData = (() => { try { return JSON.parse(p.verification_data || '{}'); } catch { return {}; } })();
  
  const profile = {
    id: p.id,
    name: p.name || '',
    handle: p.handle || '',
    bio: p.bio || '',
    avatar: p.avatar || '/default-avatar.png',
    skills: skills,
    verificationData: verificationData,
    createdAt: p.created_at || new Date().toISOString(),
    updatedAt: p.updated_at || new Date().toISOString(),
    claimed: p.claimed || 0,
  };

  fs.writeFileSync(jsonPath, JSON.stringify(profile, null, 2));
  created++;
}

db.close();
console.log(`Synced: ${created} created, ${skipped} already exist, ${profiles.length} total in DB`);
