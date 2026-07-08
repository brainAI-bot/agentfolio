#!/usr/bin/env node
/**
 * Rescore all profiles — recalculate verification levels and push on-chain updates
 * Run after sync-verifications.js to update on-chain levels
 */
const Database = require('better-sqlite3');
const path = require('path');
const {
  CANONICAL_TRUST_PROVIDERS,
  isCanonicalTrustProvider,
} = require('../src/lib/canonical-verification-providers');

const DB_PATH = path.join(__dirname, '../data/agentfolio.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

const CATEGORY_MAP = {
  solana: 'wallets',
  github: 'platforms',
  domain: 'infrastructure',
  website: 'infrastructure',
};

const HUMAN_PLATFORMS = ['github'];
const LEVEL_NAMES = ['Unregistered', 'Registered', 'Verified', 'Established', 'Trusted', 'Sovereign'];

// Get all profiles with verifications
const profiles = db.prepare(`
  SELECT p.id, p.name, COUNT(v.id) as verif_count,
    GROUP_CONCAT(v.platform, ',') as platforms
  FROM profiles p
  LEFT JOIN verifications v ON v.profile_id = p.id
  GROUP BY p.id
  ORDER BY verif_count DESC
`).all();

console.log('📊 Level Recalculation\n');
console.log(`Canonical trust providers: ${CANONICAL_TRUST_PROVIDERS.join(', ')}\n`);

for (const p of profiles) {
  const platforms = (p.platforms || '').split(',').filter(isCanonicalTrustProvider);
  const verifCount = platforms.length;
  const categories = new Set(platforms.map(pl => CATEGORY_MAP[pl] || 'other'));
  const hasHumanProof = platforms.some(pl => HUMAN_PLATFORMS.includes(pl));
  
  let level = 0;
  if (verifCount >= 8 && categories.size >= 3 && hasHumanProof) level = 5;
  else if (verifCount >= 8 && categories.size >= 3) level = 4;
  else if (verifCount >= 5 && categories.size >= 2) level = 3;
  else if (verifCount >= 2) level = 2;
  else if (verifCount >= 1) level = 1;
  
  const label = LEVEL_NAMES[level] || 'Unknown';
  const emoji = ['⚪', '🟡', '🔵', '🟢', '🟠', '👑'][level] || '?';
  
  console.log(`  ${emoji} ${p.id}: L${level} ${label} (${verifCount} canonical verifs, ${categories.size} cats${hasHumanProof ? ', human✓' : ''})`);
  console.log(`     Platforms: ${platforms.join(', ')}`);
}

db.close();
console.log('\n✅ Done. On-chain updates will happen on next server restart via addVerification flow.');
