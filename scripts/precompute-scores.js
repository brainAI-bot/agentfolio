/**
 * Pre-compute scores for all profiles using scoring-engine-v2
 * Run after any profile update to keep JSON files in sync
 */
const fs = require('fs');
const path = require('path');
const { getCompleteScore } = require('../src/lib/scoring-engine-v2');

const PROFILES_DIR = path.join(__dirname, '..', 'data', 'profiles');
const files = fs.readdirSync(PROFILES_DIR).filter(f => f.endsWith('.json'));

let updated = 0;
for (const file of files) {
  try {
    const fpath = path.join(PROFILES_DIR, file);
    const profile = JSON.parse(fs.readFileSync(fpath, 'utf8'));
    const scoreResult = getCompleteScore(profile);
    const level = scoreResult.verificationLevel?.level || 0;
    const levelName = scoreResult.verificationLevel?.name || 'Unregistered';
    const repScore = scoreResult.reputationScore?.score || 0;
    const repRank = scoreResult.reputationScore?.rank || 'Newcomer';
    
    profile._computedScores = { level, levelName, repScore, repRank, updatedAt: new Date().toISOString() };
    fs.writeFileSync(fpath, JSON.stringify(profile, null, 2));
    updated++;
  } catch (e) {
    console.error(`Error processing ${file}:`, e.message);
  }
}
console.log(`Updated ${updated}/${files.length} profiles`);
