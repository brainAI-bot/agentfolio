#!/usr/bin/env node
/**
 * Migrate existing profile skills to standard taxonomy
 * 
 * Usage:
 *   node migrate-skills.js --dry-run    # Preview changes
 *   node migrate-skills.js              # Apply changes
 */

const db = require('../src/lib/database');
const { mapSkill, migrateProfileSkills, getTaxonomyStats } = require('../src/lib/skills-taxonomy');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const VERBOSE = args.includes('--verbose') || args.includes('-v');

console.log('\n========================================');
console.log('   AgentFolio Skills Migration Script');
console.log('========================================\n');

if (DRY_RUN) {
  console.log('🔍 DRY RUN MODE - No changes will be made\n');
} else {
  console.log('⚠️  LIVE MODE - Changes will be applied\n');
}

// Show taxonomy stats
const stats = getTaxonomyStats();
console.log(`📊 Taxonomy Stats:`);
console.log(`   - ${stats.totalCategories} categories`);
console.log(`   - ${stats.totalSkills} standard skills\n`);

// Load all profiles
const profiles = db.listProfiles();
console.log(`📋 Found ${profiles.length} profiles to process\n`);

let totalSkills = 0;
let mappedSkills = 0;
let customSkills = 0;
let fuzzyMatches = 0;
let profilesUpdated = 0;

const skillMappingReport = {};
const unmappedSkills = new Set();

// Process each profile
for (const profile of profiles) {
  if (!profile.skills || profile.skills.length === 0) continue;
  
  const originalSkills = profile.skills.map(s => typeof s === 'string' ? s : s.name);
  let hasChanges = false;
  
  const migratedSkills = profile.skills.map(skill => {
    const name = typeof skill === 'string' ? skill : skill.name;
    const mapped = mapSkill(name);
    totalSkills++;
    
    // Track mapping
    if (!skillMappingReport[name]) {
      skillMappingReport[name] = {
        original: name,
        standard: mapped.standard,
        category: mapped.category,
        mapped: mapped.mapped,
        fuzzy: mapped.fuzzy,
        custom: mapped.custom
      };
    }
    
    if (mapped.mapped) {
      mappedSkills++;
      if (mapped.fuzzy) fuzzyMatches++;
      hasChanges = hasChanges || (mapped.standard !== name);
    } else if (mapped.custom) {
      customSkills++;
      unmappedSkills.add(name);
    }
    
    return {
      name: mapped.standard,
      originalName: mapped.original !== mapped.standard ? mapped.original : undefined,
      category: mapped.category,
      verified: skill.verified || false,
      proofs: skill.proofs || []
    };
  });
  
  if (hasChanges && !DRY_RUN) {
    profile.skills = migratedSkills;
    db.saveProfile(profile);
    profilesUpdated++;
  } else if (hasChanges) {
    profilesUpdated++;
  }
  
  if (VERBOSE && hasChanges) {
    console.log(`\n📝 ${profile.name} (${profile.id}):`);
    originalSkills.forEach((orig, i) => {
      const migrated = migratedSkills[i];
      if (orig !== migrated.name) {
        console.log(`   "${orig}" → "${migrated.name}" [${migrated.category}]`);
      }
    });
  }
}

// Report
console.log('\n========================================');
console.log('              MIGRATION REPORT');
console.log('========================================\n');

console.log(`📈 Skills Processed: ${totalSkills}`);
console.log(`   ✅ Mapped to standard: ${mappedSkills} (${((mappedSkills/totalSkills)*100).toFixed(1)}%)`);
console.log(`   🔄 Fuzzy matches: ${fuzzyMatches}`);
console.log(`   ⚙️  Custom (unmapped): ${customSkills}`);
console.log(`\n📋 Profiles with changes: ${profilesUpdated} / ${profiles.length}`);

if (unmappedSkills.size > 0) {
  console.log(`\n⚠️  Unmapped custom skills (${unmappedSkills.size}):`);
  Array.from(unmappedSkills).sort().forEach(s => {
    console.log(`   - ${s}`);
  });
}

// Show all mappings if verbose
if (VERBOSE) {
  console.log('\n📊 Full Mapping Report:');
  Object.entries(skillMappingReport)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .forEach(([orig, info]) => {
      const marker = info.custom ? '⚙️' : info.fuzzy ? '🔄' : info.mapped ? '✅' : '➡️';
      console.log(`   ${marker} "${orig}" → "${info.standard}" [${info.category}]`);
    });
}

if (DRY_RUN) {
  console.log('\n💡 Run without --dry-run to apply changes');
} else {
  console.log('\n✅ Migration complete!');
}

console.log('');
