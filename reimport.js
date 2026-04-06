const Database = require('better-sqlite3');
const path = require('path');

const backupDb = new Database(path.join(__dirname, 'data/agentfolio.db.bak-20260404-verif-cleanup'), { readonly: true });
const liveDb = new Database(path.join(__dirname, 'data/agentfolio.db'));

// Get all columns
const cols = backupDb.pragma('table_info(profiles)').map(c => c.name);
// Exclude api_key (security) - generate new ones
const importCols = cols.filter(c => c !== 'api_key');

const profiles = backupDb.prepare('SELECT * FROM profiles WHERE name != ""').all();
console.log('Found', profiles.length, 'profiles to import');

// Check existing
const existing = new Set(liveDb.prepare('SELECT id FROM profiles').all().map(r => r.id));
console.log('Already in live DB:', existing.size);

let imported = 0, skipped = 0;
const insertStmt = liveDb.prepare(
  'INSERT OR IGNORE INTO profiles (' + importCols.join(', ') + ') VALUES (' + importCols.map(() => '?').join(', ') + ')'
);

const txn = liveDb.transaction(() => {
  for (const p of profiles) {
    if (existing.has(p.id)) { skipped++; continue; }
    // Set as unclaimed import
    const meta = JSON.parse(p.metadata || '{}');
    meta.importedFrom = meta.importedFrom || 'backup-reimport';
    meta.reimportedAt = new Date().toISOString();
    p.metadata = JSON.stringify(meta);
    // Mark as unclaimed
    p.claimed = 0;
    p.claimed_at = null;
    p.claimed_by = null;
    
    const vals = importCols.map(c => p[c]);
    try {
      insertStmt.run(...vals);
      imported++;
    } catch (e) {
      console.error('Failed:', p.id, e.message);
    }
  }
});
txn();

console.log('Imported:', imported, 'Skipped (existing):', skipped);
console.log('Total in live DB:', liveDb.prepare('SELECT COUNT(*) as c FROM profiles').get().c);

backupDb.close();
liveDb.close();
