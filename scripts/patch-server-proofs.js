#!/usr/bin/env node
/**
 * Patch server.js to add verificationProofs to profile API response
 */
const fs = require('fs');
let code = fs.readFileSync('src/server.js', 'utf8');

// 1. Add require
const requireLine = "const { buildVerificationProofs } = require('./lib/build-verification-proofs');";
if (!code.includes('build-verification-proofs')) {
  // Insert after the scoring require
  const anchor = "const { getV2Scoring } = require('./scoring');";
  const idx = code.indexOf(anchor);
  if (idx !== -1) {
    const eol = code.indexOf('\n', idx);
    code = code.slice(0, eol + 1) + requireLine + '\n' + code.slice(eol + 1);
    console.log('✅ Added require for build-verification-proofs');
  } else {
    console.log('⚠️  Could not find anchor for require insertion');
  }
}

// 2. Add verificationProofs to the successful response path
// Find: "unclaimed: profile.unclaimed || false" in the first basic block (after getOnChainScores)
// There are two occurrences — we need both
const target1 = "          unclaimed: profile.unclaimed || false\n        };\n        res.writeHead(200, { 'Content-Type': 'application/json' });\n        res.end(JSON.stringify(basic, null, 2));";
const replacement1 = "          unclaimed: profile.unclaimed || false,\n          verificationProofs: buildVerificationProofs(profile.verificationData)\n        };\n        res.writeHead(200, { 'Content-Type': 'application/json' });\n        res.end(JSON.stringify(basic, null, 2));";

let count = 0;
// Replace all occurrences (there are 2 — success and fallback)
while (code.includes(target1)) {
  code = code.replace(target1, replacement1);
  count++;
}
console.log(`✅ Added verificationProofs to ${count} response paths`);

fs.writeFileSync('src/server.js', code);
console.log('✅ server.js saved');
