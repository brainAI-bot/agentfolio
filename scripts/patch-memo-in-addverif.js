#!/usr/bin/env node
/**
 * Patch profile-store.js to call postVerificationMemo in addVerification
 * This ensures ALL verifications get an on-chain memo attestation
 */
const fs = require('fs');
let code = fs.readFileSync('src/profile-store.js', 'utf8');

// 1. Add memo-attestation require at top
if (!code.includes('memo-attestation')) {
  const insertAfter = "console.log('[ProfileStore] Scoring Engine V2 loaded');";
  const idx = code.indexOf(insertAfter);
  if (idx !== -1) {
    const eol = code.indexOf('\n', idx);
    code = code.slice(0, eol + 1) + `
// Memo attestation for on-chain verification records
let postMemoAttestation;
try {
  postMemoAttestation = require('./lib/memo-attestation').postVerificationMemo;
  console.log('[ProfileStore] Memo attestation loaded');
} catch (e) {
  console.warn('[ProfileStore] Memo attestation not available:', e.message);
}
` + code.slice(eol + 1);
    console.log('✅ Added memo-attestation require');
  }
}

// 2. Add memo call after addActivity in addVerification
const activityLine = "    addActivity(profileId, 'verification', { platform, identifier });";
if (code.includes(activityLine) && !code.includes('postMemoAttestation')) {
  const memoCall = `    addActivity(profileId, 'verification', { platform, identifier });

  // Fire-and-forget: post on-chain Memo attestation
  if (postMemoAttestation) {
    postMemoAttestation(profileId, platform, { identifier, verified_at: new Date().toISOString() })
      .then(result => {
        if (result) console.log(\`[ProfileStore] Memo attestation posted for \${profileId}/\${platform}: \${result.explorerUrl}\`);
      })
      .catch(err => console.error(\`[ProfileStore] Memo attestation failed for \${profileId}/\${platform}:\`, err.message));
  }`;
  code = code.replace(activityLine, memoCall);
  console.log('✅ Added memo attestation call in addVerification');
}

fs.writeFileSync('src/profile-store.js', code);
console.log('✅ profile-store.js saved');
