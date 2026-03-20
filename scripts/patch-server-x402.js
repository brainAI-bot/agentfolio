#!/usr/bin/env node
/**
 * Patch server.js to wire x402 payment middleware and trust-score endpoint
 */
const fs = require('fs');
let code = fs.readFileSync('src/server.js', 'utf8');

// 1. Add x402 require
if (!code.includes('x402-middleware')) {
  const anchor = "const { buildVerificationProofs } = require('./lib/build-verification-proofs');";
  const idx = code.indexOf(anchor);
  if (idx !== -1) {
    const eol = code.indexOf('\n', idx);
    code = code.slice(0, eol + 1) + "const { x402Gate, getX402Info, initX402 } = require('./lib/x402-middleware');\n" + code.slice(eol + 1);
    console.log('✅ Added x402-middleware require');
  }
}

// 2. Initialize x402 after server start
if (!code.includes('initX402()')) {
  const anchor = "console.log(`[x402]";
  if (!code.includes(anchor)) {
    // Find server start message
    const startAnchor = "AgentFolio server started";
    const startIdx = code.indexOf(startAnchor);
    if (startIdx !== -1) {
      const eol = code.indexOf('\n', startIdx);
      code = code.slice(0, eol + 1) + "  try { initX402(); } catch (e) { console.warn('[x402] Init failed:', e.message); }\n" + code.slice(eol + 1);
      console.log('✅ Added initX402() call');
    }
  }
}

// 3. Add /api/x402/info endpoint  
if (!code.includes('/api/x402/info')) {
  // Add before the AVAILABILITY section
  const anchor = '  // ============ AVAILABILITY API ============';
  const idx = code.indexOf(anchor);
  if (idx !== -1) {
    const endpoint = `
  // GET /api/x402/info — x402 payment protocol info
  else if (url.pathname === '/api/x402/info' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(getX402Info(), null, 2));
    return;
  }
  // GET /api/profile/:id/trust-score — Paid endpoint via x402
  else if (url.pathname.match(/^\\/api\\/profile\\/([^/]+)\\/trust-score$/) && req.method === 'GET') {
    const profileId = url.pathname.split('/')[3];
    
    // x402 gate: returns 402 for unpaid programmatic requests
    (async () => {
      try {
        const handled = await x402Gate('GET', url.pathname, req, res);
        if (handled) return; // 402 sent
        
        // Serve the trust score
        const profile = loadProfile(profileId, DATA_DIR);
        if (!profile) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Profile not found' }));
          return;
        }
        
        // Get on-chain SATP scores
        const satpScores = await getOnChainScores(profileId);
        const rep = calculateReputation(profile);
        
        // Build detailed trust score response
        const scoringV2 = require('./lib/scoring-engine-v2');
        const v2Score = scoringV2.getCompleteScore(profile);
        
        const response = {
          profileId,
          trustScore: satpScores ? satpScores.trustScore : rep.score,
          tier: satpScores ? satpScores.tier : rep.tier,
          verificationLevel: satpScores ? satpScores.verificationLevel : v2Score.verificationLevel.level,
          v2Score: {
            verificationLevel: v2Score.verificationLevel,
            reputationScore: v2Score.reputationScore,
            overall: v2Score.overall,
          },
          onChain: satpScores ? {
            source: 'satp_v3',
            trustScore: satpScores.trustScore,
            verificationLevel: satpScores.verificationLevel,
            tier: satpScores.tier,
          } : null,
          attestations: getAttestations(profileId).length,
          verifiedPlatforms: Object.keys(profile.verificationData || {}).filter(k => 
            profile.verificationData[k]?.verified
          ),
          paid: req._x402Paid || false,
          generatedAt: new Date().toISOString(),
        };
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(response, null, 2));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    })();
    return;
  }
`;
    code = code.slice(0, idx) + endpoint + '\n  ' + code.slice(idx);
    console.log('✅ Added /api/x402/info and /api/profile/:id/trust-score endpoints');
  }
}

fs.writeFileSync('src/server.js', code);
console.log('✅ server.js saved');
