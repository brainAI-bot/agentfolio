#!/usr/bin/env node
/**
 * Patch profile-store.js to add L5 Sovereign level
 */
const fs = require('fs');
let code = fs.readFileSync('src/profile-store.js', 'utf8');

// Fix 1: Replace the first level calculation block (category-aware) to add L5
const oldCalc1 = `        // Verification level calculation: L0-L5
        let newLevel = 0;
        if (verifCount >= 8 && catCount >= 3) newLevel = 4; // L4 Trusted
        else if (verifCount >= 5 && catCount >= 2) newLevel = 3; // L3 Established  
        else if (verifCount >= 2) newLevel = 2; // L2 Verified
        else if (verifCount >= 1) newLevel = 1; // L1 Registered
        newLevel = Math.min(5, newLevel);`;

const newCalc1 = `        // Verification level calculation: L0-L5
        // L5 Sovereign: L4 + human-proof verification (X or GitHub verified)
        const HUMAN_PLATFORMS = ['github', 'x', 'twitter'];
        const hasHumanProof = allVerifs.some(v => HUMAN_PLATFORMS.includes(v.platform));
        let newLevel = 0;
        if (verifCount >= 8 && catCount >= 3 && hasHumanProof) newLevel = 5; // L5 Sovereign
        else if (verifCount >= 8 && catCount >= 3) newLevel = 4; // L4 Trusted
        else if (verifCount >= 5 && catCount >= 2) newLevel = 3; // L3 Established  
        else if (verifCount >= 2) newLevel = 2; // L2 Verified
        else if (verifCount >= 1) newLevel = 1; // L1 Registered`;

if (code.includes(oldCalc1)) {
  code = code.replace(oldCalc1, newCalc1);
  console.log('✅ Patched primary level calc (added L5)');
} else {
  console.log('⚠️  Primary level calc not found (already patched or changed)');
}

// Fix 2: Replace the second (duplicate/legacy) level calculation block
const oldCalc2 = `        let newLevel = 0;
        if (platforms.size >= 5) newLevel = 3;
        else if (platforms.size >= 3) newLevel = 2;
        else if (platforms.size >= 1) newLevel = 1;`;

const newCalc2 = `        const HUMAN_PLATS = ['github', 'x', 'twitter'];
        const hasHuman = [...platforms].some(p => HUMAN_PLATS.includes(p));
        let newLevel = 0;
        if (platforms.size >= 8 && hasHuman) newLevel = 5;
        else if (platforms.size >= 8) newLevel = 4;
        else if (platforms.size >= 5) newLevel = 3;
        else if (platforms.size >= 3) newLevel = 2;
        else if (platforms.size >= 1) newLevel = 1;`;

if (code.includes(oldCalc2)) {
  code = code.replace(oldCalc2, newCalc2);
  console.log('✅ Patched legacy level calc (added L5)');
} else {
  console.log('⚠️  Legacy level calc not found (already patched or changed)');
}

// Fix 3: Update the v3-score-service label array to include L5 Sovereign
fs.writeFileSync('src/profile-store.js', code);
console.log('✅ profile-store.js saved');
