#!/usr/bin/env node
/**
 * Migration Script: JSON to SQLite
 * Imports all existing JSON data into SQLite database
 */

const fs = require('fs');
const path = require('path');
const db = require('./lib/database');

const DATA_DIR = path.join(__dirname, '../data');
const PROFILES_DIR = path.join(DATA_DIR, 'profiles');
const MARKETPLACE_DIR = path.join(DATA_DIR, 'marketplace');
const ESCROW_DIR = path.join(DATA_DIR, 'escrow');

let stats = {
  profiles: 0,
  activities: 0,
  jobs: 0,
  applications: 0,
  reviews: 0,
  escrows: 0,
  follows: 0,
  webhooks: 0,
  analytics: 0,
  errors: []
};

function log(msg) {
  console.log(`[Migration] ${msg}`);
}

function logError(msg, err) {
  const errMsg = `${msg}: ${err?.message || err}`;
  console.error(`[Migration ERROR] ${errMsg}`);
  stats.errors.push(errMsg);
}

// Import profiles
function migrateProfiles() {
  log('Migrating profiles...');
  
  if (!fs.existsSync(PROFILES_DIR)) {
    log('No profiles directory found, skipping');
    return;
  }
  
  const files = fs.readdirSync(PROFILES_DIR).filter(f => f.endsWith('.json'));
  
  for (const file of files) {
    try {
      const filePath = path.join(PROFILES_DIR, file);
      const profile = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      
      // Save profile (without activity - we'll handle that separately)
      const activity = profile.activity || [];
      delete profile.activity;
      
      db.saveProfile(profile);
      stats.profiles++;
      
      // Import activities
      for (const act of activity) {
        try {
          db.addActivity(profile.id, act.type, act.data || {});
          stats.activities++;
        } catch (e) {
          // Activity might have duplicate ID, skip
        }
      }
      
    } catch (err) {
      logError(`Failed to migrate profile ${file}`, err);
    }
  }
  
  log(`Migrated ${stats.profiles} profiles, ${stats.activities} activities`);
}

// Import jobs
function migrateJobs() {
  log('Migrating jobs...');
  
  const jobsDir = path.join(MARKETPLACE_DIR, 'jobs');
  if (!fs.existsSync(jobsDir)) {
    log('No jobs directory found, skipping');
    return;
  }
  
  const files = fs.readdirSync(jobsDir).filter(f => f.endsWith('.json'));
  
  for (const file of files) {
    try {
      const filePath = path.join(jobsDir, file);
      const job = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      
      db.saveJob(job);
      stats.jobs++;
    } catch (err) {
      logError(`Failed to migrate job ${file}`, err);
    }
  }
  
  log(`Migrated ${stats.jobs} jobs`);
}

// Import applications
function migrateApplications() {
  log('Migrating applications...');
  
  const appsDir = path.join(MARKETPLACE_DIR, 'applications');
  if (!fs.existsSync(appsDir)) {
    log('No applications directory found, skipping');
    return;
  }
  
  const files = fs.readdirSync(appsDir).filter(f => f.endsWith('.json'));
  
  for (const file of files) {
    try {
      const filePath = path.join(appsDir, file);
      const applications = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      
      if (Array.isArray(applications)) {
        for (const app of applications) {
          db.saveApplication(app);
          stats.applications++;
        }
      }
    } catch (err) {
      logError(`Failed to migrate applications ${file}`, err);
    }
  }
  
  log(`Migrated ${stats.applications} applications`);
}

// Import reviews
function migrateReviews() {
  log('Migrating reviews...');
  
  const reviewsDir = path.join(MARKETPLACE_DIR, 'reviews');
  if (!fs.existsSync(reviewsDir)) {
    log('No reviews directory found, skipping');
    return;
  }
  
  const files = fs.readdirSync(reviewsDir).filter(f => f.endsWith('.json'));
  
  for (const file of files) {
    try {
      const filePath = path.join(reviewsDir, file);
      const reviews = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      
      if (Array.isArray(reviews)) {
        for (const review of reviews) {
          try {
            db.saveReview(review);
            stats.reviews++;
          } catch (e) {
            // Review might already exist
          }
        }
      }
    } catch (err) {
      logError(`Failed to migrate reviews ${file}`, err);
    }
  }
  
  log(`Migrated ${stats.reviews} reviews`);
}

// Import escrows
function migrateEscrows() {
  log('Migrating escrows...');
  
  const escrowsDir = path.join(ESCROW_DIR, 'escrows');
  if (!fs.existsSync(escrowsDir)) {
    log('No escrows directory found, skipping');
    return;
  }
  
  const files = fs.readdirSync(escrowsDir).filter(f => f.endsWith('.json'));
  
  for (const file of files) {
    try {
      const filePath = path.join(escrowsDir, file);
      const escrow = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      
      db.saveEscrow(escrow);
      stats.escrows++;
    } catch (err) {
      logError(`Failed to migrate escrow ${file}`, err);
    }
  }
  
  log(`Migrated ${stats.escrows} escrows`);
}

// Import follows
function migrateFollows() {
  log('Migrating follows...');
  
  const followsFile = path.join(DATA_DIR, 'follows.json');
  if (!fs.existsSync(followsFile)) {
    log('No follows file found, skipping');
    return;
  }
  
  try {
    const data = JSON.parse(fs.readFileSync(followsFile, 'utf8'));
    
    // Format: { followerId: [followingIds...] }
    for (const [followerId, following] of Object.entries(data)) {
      if (Array.isArray(following)) {
        for (const followingId of following) {
          db.followProfile(followerId, followingId);
          stats.follows++;
        }
      }
    }
    
    log(`Migrated ${stats.follows} follows`);
  } catch (err) {
    logError('Failed to migrate follows', err);
  }
}

// Import analytics
function migrateAnalytics() {
  log('Migrating analytics...');
  
  const analyticsFile = path.join(DATA_DIR, 'analytics.json');
  if (!fs.existsSync(analyticsFile)) {
    log('No analytics file found, skipping');
    return;
  }
  
  try {
    const data = JSON.parse(fs.readFileSync(analyticsFile, 'utf8'));
    
    // Migrate profile views
    if (data.profileViews) {
      for (const [profileId, views] of Object.entries(data.profileViews)) {
        if (views.daily) {
          for (const [date, count] of Object.entries(views.daily)) {
            // Insert into analytics - we'll use hour 12 as default
            for (let i = 0; i < count; i++) {
              db.trackProfileView(profileId);
              stats.analytics++;
            }
          }
        }
      }
    }
    
    log(`Migrated ${stats.analytics} analytics records`);
  } catch (err) {
    logError('Failed to migrate analytics', err);
  }
}

// Run migration
function runMigration() {
  console.log('='.repeat(50));
  console.log('AgentFolio JSON to SQLite Migration');
  console.log('='.repeat(50));
  console.log();
  
  const startTime = Date.now();
  
  // Run all migrations
  migrateProfiles();
  migrateJobs();
  migrateApplications();
  migrateReviews();
  migrateEscrows();
  migrateFollows();
  migrateAnalytics();
  
  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  
  console.log();
  console.log('='.repeat(50));
  console.log('Migration Complete!');
  console.log('='.repeat(50));
  console.log();
  console.log('Statistics:');
  console.log(`  Profiles:     ${stats.profiles}`);
  console.log(`  Activities:   ${stats.activities}`);
  console.log(`  Jobs:         ${stats.jobs}`);
  console.log(`  Applications: ${stats.applications}`);
  console.log(`  Reviews:      ${stats.reviews}`);
  console.log(`  Escrows:      ${stats.escrows}`);
  console.log(`  Follows:      ${stats.follows}`);
  console.log(`  Analytics:    ${stats.analytics}`);
  console.log();
  console.log(`Duration: ${duration}s`);
  
  if (stats.errors.length > 0) {
    console.log();
    console.log(`Errors (${stats.errors.length}):`);
    stats.errors.forEach(e => console.log(`  - ${e}`));
  }
  
  console.log();
  console.log('Database file: data/agentfolio.db');
  console.log();
  console.log('Next steps:');
  console.log('1. Test the database with: node -e "console.log(require(\'./src/lib/database\').listProfiles().length)"');
  console.log('2. Backup JSON files (optional): mv data/profiles data/profiles.bak');
  console.log('3. Restart the server: pm2 restart agentfolio');
}

// Run if called directly
if (require.main === module) {
  runMigration();
}

module.exports = { runMigration, stats };
