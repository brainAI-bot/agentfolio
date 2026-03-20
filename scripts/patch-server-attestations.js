#!/usr/bin/env node
/**
 * Patch server.js to add:
 * 1. GET /api/agent/:id/attestations endpoint
 * 2. Wire postVerificationMemo into missing verification flows (ethereum, github, polymarket, domain)
 */
const fs = require('fs');
let code = fs.readFileSync('src/server.js', 'utf8');

// 1. Add getAttestations import
if (!code.includes('getAttestations')) {
  const memoRequire = "const { postVerificationMemo } = require('./lib/memo-attestation');";
  const newRequire = "const { postVerificationMemo, getAttestations } = require('./lib/memo-attestation');";
  code = code.replace(memoRequire, newRequire);
  console.log('✅ Added getAttestations import');
}

// 2. Add attestations API endpoint (before the AVAILABILITY section)
if (!code.includes('/api/agent/:id/attestations') && !code.includes('api/agent/.*attestations')) {
  const anchor = '  // ============ AVAILABILITY API ============';
  const idx = code.indexOf(anchor);
  if (idx !== -1) {
    const endpoint = `
  // GET /api/agent/:id/attestations — On-chain verification attestation TXs
  else if (url.pathname.match(/^\\/api\\/(?:agent|profile)\\/([^/]+)\\/attestations$/) && req.method === 'GET') {
    const profileId = url.pathname.split('/')[3];
    const attestations = getAttestations(profileId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      profileId,
      attestations,
      total: attestations.length,
      description: 'On-chain Memo TX attestations for each verified platform. Each TX contains: VERIFY|agent_id|platform|timestamp|proof_hash',
    }, null, 2));
    return;
  }
`;
    code = code.slice(0, idx) + endpoint + '\n  ' + code.slice(idx);
    console.log('✅ Added /api/agent/:id/attestations endpoint');
  }
}

// 3. Add attestation links to verificationProofs in the profile response
// Find the buildVerificationProofs call and enhance it with attestation data
if (!code.includes('attestationTxs')) {
  // Find where we build the basic response object for the profile endpoint
  // After: verificationProofs: buildVerificationProofs(profile.verificationData)
  const proofLine = 'verificationProofs: buildVerificationProofs(profile.verificationData)';
  
  // Replace both occurrences to also include attestation links
  let count = 0;
  while (code.includes(proofLine)) {
    code = code.replace(proofLine, `verificationProofs: (() => {
            const proofs = buildVerificationProofs(profile.verificationData);
            const attestationTxs = getAttestations(profile.id);
            for (const att of attestationTxs) {
              if (proofs[att.platform]) {
                proofs[att.platform].attestation_tx = att.tx_signature;
                proofs[att.platform].solscan_url = att.solscan_url;
              }
            }
            return proofs;
          })()`);
    count++;
  }
  console.log(`✅ Enhanced verificationProofs with attestation TX links (${count} occurrences)`);
}

fs.writeFileSync('src/server.js', code);
console.log('✅ server.js saved');
