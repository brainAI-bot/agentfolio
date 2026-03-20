#!/usr/bin/env node
/**
 * Patch server.js to add hardened HL verification routes
 * Adds /initiate and /complete endpoints before the existing unhardened route
 */
const fs = require('fs');
const serverPath = 'src/server.js';
let code = fs.readFileSync(serverPath, 'utf8');

// Find the marker: "// Profile-specific Hyperliquid verification (saves to profile)"
const marker = '  // Profile-specific Hyperliquid verification (saves to profile)';
const idx = code.indexOf(marker);
if (idx === -1) {
  console.error('❌ Could not find HL verification marker in server.js');
  process.exit(1);
}

// Check if already patched
if (code.includes('hyperliquid/initiate')) {
  console.log('⚠️  Hardened HL routes already present — skipping');
  process.exit(0);
}

// Add require at top (after existing requires)
const requireLine = "const { initiateHLVerification, completeHLVerification } = require('./lib/hyperliquid-verify-hardened');";
if (!code.includes('hyperliquid-verify-hardened')) {
  const lastRequireIdx = code.indexOf("const { addEndorsement");
  if (lastRequireIdx !== -1) {
    const insertPoint = code.indexOf('\n', lastRequireIdx) + 1;
    code = code.slice(0, insertPoint) + requireLine + '\n' + code.slice(insertPoint);
    console.log('✅ Added require for hyperliquid-verify-hardened');
  }
}

// Re-find marker after potential code insertion
const newIdx = code.indexOf(marker);

const hardenedRoutes = `
  // ── Hardened Hyperliquid Verification (signature-required) ──
  else if (url.pathname.match(/^\\/api\\/profile\\/([^/]+)\\/verify\\/hyperliquid\\/initiate$/) && req.method === 'POST') {
    const profileId = url.pathname.split('/')[3];
    const profile = loadProfile(profileId, DATA_DIR);
    if (!profile) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Profile not found' }));
      return;
    }
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        let parsed = {};
        try { parsed = JSON.parse(body); } catch {}
        const walletAddress = parsed.walletAddress || profile.wallets?.hyperliquid;
        if (!walletAddress) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'No Hyperliquid wallet. Provide walletAddress or set it on your profile.' }));
          return;
        }
        const result = initiateHLVerification(profileId, walletAddress);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }
  else if (url.pathname.match(/^\\/api\\/profile\\/([^/]+)\\/verify\\/hyperliquid\\/complete$/) && req.method === 'POST') {
    const profileId = url.pathname.split('/')[3];
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const parsed = JSON.parse(body);
        const { challengeId, signature } = parsed;
        if (!challengeId || !signature) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'challengeId and signature required' }));
          return;
        }
        const result = await completeHLVerification(challengeId, signature);
        if (result.verified) {
          // Update profile JSON
          const profile = loadProfile(profileId, DATA_DIR);
          if (profile) {
            profile.verificationData = profile.verificationData || {};
            profile.verificationData.hyperliquid = {
              verified: true,
              address: result.identifier,
              accountValue: result.accountValue,
              stats: result.stats,
              method: 'hardened_signature',
              verifiedAt: new Date().toISOString(),
            };
            profile.wallets = profile.wallets || {};
            if (!profile.wallets.hyperliquid) profile.wallets.hyperliquid = result.identifier;
            profile.updatedAt = new Date().toISOString();
            dbSaveProfileFn(profile);
          }
          addActivityAndBroadcast(profileId, 'verification_hyperliquid', {
            address: result.identifier?.slice(0, 8) + '...' + result.identifier?.slice(-4),
            accountValue: result.accountValue,
            method: 'hardened_signature',
          }, DATA_DIR);
        }
        res.writeHead(result.verified ? 200 : 400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }
`;

// Insert before the existing unhardened route
code = code.slice(0, newIdx) + hardenedRoutes + code.slice(newIdx);

fs.writeFileSync(serverPath, code);
console.log('✅ Hardened HL verification routes added to server.js');
