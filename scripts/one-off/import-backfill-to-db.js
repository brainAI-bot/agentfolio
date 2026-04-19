#!/usr/bin/env node
/**
 * Import backfilled activity events into SQLite DB
 * Only imports events that don't already exist (deduplication by profile_id + type + date)
 */

const fs = require('fs');
const path = require('path');
const db = require('/home/ubuntu/agentfolio/src/lib/database');

const ACTIVITY_DIR = '/home/ubuntu/agentfolio/data/activity';

// Map backfill event types to DB activity types
const TYPE_MAP = {
  'profile_created': 'profile_created',
  'verification': null, // Will be mapped per-platform
  'endorsement_received': 'endorsement_received',
  'endorsement_given': 'endorsement_given',
  'escrow_created': 'escrow_created',
  'escrow_funded': 'escrow_funded',
  'escrow_released': 'escrow_released',
  'escrow_refunded': 'escrow_refunded',
  'job_posted': 'job_posted',
  'job_completed': 'job_completed',
  'application_submitted': 'application_submitted',
  'application_accepted': 'application_accepted',
  'deliverable_submitted': 'deliverable_submitted',
  'deliverable_approved': 'deliverable_approved',
  'nft_burned': 'nft_burned',
  'nft_minted': 'nft_minted'
};

const VERIFICATION_TYPE_MAP = {
  'github': 'verification_github',
  'twitter': 'verification_twitter',
  'solana': 'verification_solana',
  'hyperliquid': 'verification_hyperliquid',
  'agentmail': 'verification_agentmail',
  'polymarket': 'verification_polymarket',
  'satp': 'verification_satp',
  'telegram': 'verification_telegram',
  'discord': 'verification_discord'
};

// Prepare insert statement
const insert = db.db.prepare(
  'INSERT OR IGNORE INTO activity (id, profile_id, type, data, created_at) VALUES (?, ?, ?, ?, ?)'
);

let imported = 0;
let skipped = 0;
let errors = 0;

const files = fs.readdirSync(ACTIVITY_DIR).filter(f => f.endsWith('.activity.json'));

const importAll = db.db.transaction(() => {
  for (const file of files) {
    const data = JSON.parse(fs.readFileSync(path.join(ACTIVITY_DIR, file), 'utf-8'));
    const profileId = data.profileId;
    
    // Get existing events for this profile to dedup
    const existing = db.db.prepare(
      'SELECT type, created_at FROM activity WHERE profile_id = ?'
    ).all(profileId);
    const existingSet = new Set(existing.map(e => `${e.type}:${e.created_at.slice(0,19)}`));
    
    for (const event of data.events) {
      let actType = TYPE_MAP[event.type];
      if (event.type === 'verification') {
        actType = VERIFICATION_TYPE_MAP[event.platform] || `verification_${event.platform}`;
      }
      if (!actType) actType = event.type;
      
      const dateStr = event.date;
      const dedupKey = `${actType}:${dateStr.slice(0,19)}`;
      
      if (existingSet.has(dedupKey)) {
        skipped++;
        continue;
      }
      
      const id = `act_bf_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
      const eventData = { ...event };
      delete eventData.type;
      delete eventData.date;
      
      try {
        insert.run(id, profileId, actType, JSON.stringify(eventData), dateStr);
        imported++;
        existingSet.add(dedupKey);
      } catch (e) {
        errors++;
      }
    }
  }
});

importAll();

console.log(`Import complete: ${imported} imported, ${skipped} skipped (dupes), ${errors} errors`);
console.log(`Total activity rows: ${db.db.prepare('SELECT COUNT(*) as c FROM activity').get().c}`);
