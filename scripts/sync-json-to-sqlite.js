#!/usr/bin/env node
/**
 * Sync JSON Profiles to SQLite
 * 
 * This script fixes the bug where profiles created via JSON file system
 * are not visible via API (which reads from SQLite).
 * 
 * Run: node scripts/sync-json-to-sqlite.js
 */

const fs = require('fs');
const path = require('path');

const PROFILES_DIR = path.join(__dirname, '../data/profiles');
const { saveProfile, loadProfile } = require('../src/lib/database');

async function syncProfiles() {
  console.log('🔄 Syncing JSON profiles to SQLite database...\n');
  
  // Get all JSON profile files
  const files = fs.readdirSync(PROFILES_DIR).filter(f => f.endsWith('.json'));
  console.log(`Found ${files.length} JSON profile files\n`);
  
  let synced = 0;
  let skipped = 0;
  let errors = 0;
  
  for (const file of files) {
    const profileId = file.replace('.json', '');
    const filePath = path.join(PROFILES_DIR, file);
    
    try {
      // Read JSON profile
      const jsonProfile = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      
      // Check if already in SQLite
      const existingProfile = loadProfile(profileId);
      
      if (existingProfile) {
        // Compare timestamps - only update if JSON is newer
        const jsonUpdated = new Date(jsonProfile.updatedAt || jsonProfile.createdAt).getTime();
        const dbUpdated = new Date(existingProfile.updatedAt || existingProfile.createdAt).getTime();
        
        if (jsonUpdated > dbUpdated) {
          saveProfile(jsonProfile);
          console.log(`✅ Updated: ${profileId} (JSON was newer)`);
          synced++;
        } else {
          console.log(`⏭️  Skipped: ${profileId} (already in sync)`);
          skipped++;
        }
      } else {
        // Not in SQLite - add it
        saveProfile(jsonProfile);
        console.log(`✅ Added: ${profileId} (was missing from SQLite)`);
        synced++;
      }
    } catch (err) {
      console.error(`❌ Error: ${profileId} - ${err.message}`);
      errors++;
    }
  }
  
  console.log('\n' + '='.repeat(50));
  console.log(`📊 Sync Complete:`);
  console.log(`   ✅ Synced: ${synced}`);
  console.log(`   ⏭️  Skipped: ${skipped}`);
  console.log(`   ❌ Errors: ${errors}`);
  console.log(`   📁 Total: ${files.length}`);
}

syncProfiles().catch(console.error);
