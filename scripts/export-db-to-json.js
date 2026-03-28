const db = require('better-sqlite3')('/home/ubuntu/agentfolio/data/agentfolio.db');
const fs = require('fs');
const path = require('path');

const PROFILES_DIR = '/home/ubuntu/agentfolio/data/profiles';

// Get all profiles from DB
const rows = db.prepare('SELECT * FROM profiles WHERE status = ? AND (hidden = 0 OR hidden IS NULL)').all('active');

// Check which already have JSON files
const existingFiles = new Set(fs.readdirSync(PROFILES_DIR).filter(f => f.endsWith('.json')).map(f => f.replace('.json', '')));

let created = 0;
for (const row of rows) {
  if (existingFiles.has(row.id)) continue;
  
  // Convert DB row to profile JSON format
  const profile = {
    id: row.id,
    name: row.name,
    handle: row.handle,
    bio: row.bio || '',
    avatar: row.avatar || null,
    links: JSON.parse(row.links || '{}'),
    wallets: JSON.parse(row.wallets || '{}'),
    skills: JSON.parse(row.skills || '[]').map(s => typeof s === 'string' ? { name: s, category: 'general', verified: false } : s),
    portfolio: JSON.parse(row.portfolio || '[]'),
    trackRecord: row.track_record ? JSON.parse(row.track_record) : null,
    verification: JSON.parse(row.verification || '{}'),
    verificationData: JSON.parse(row.verification_data || '{}'),
    endorsements: JSON.parse(row.endorsements || '[]'),
    endorsementsGiven: JSON.parse(row.endorsements_given || '[]'),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    unclaimed: true,  // Mark these as unclaimed directory listings
    stats: { jobsCompleted: 0, rating: 0 }
  };
  
  fs.writeFileSync(path.join(PROFILES_DIR, row.id + '.json'), JSON.stringify(profile, null, 2));
  created++;
}

console.log('Created', created, 'new JSON files');
console.log('Total JSON files now:', fs.readdirSync(PROFILES_DIR).filter(f => f.endsWith('.json')).length);
db.close();
