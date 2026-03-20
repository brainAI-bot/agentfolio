#!/usr/bin/env node
/**
 * Patch server.js to show on-chain attestation badges on profile pages
 * Adds a small Solana icon linking to Solscan next to each verified platform
 */
const fs = require('fs');
let code = fs.readFileSync('src/server.js', 'utf8');

// 1. Load attestations for the profile in the profile page rendering section
// Find where verificationItems are built (after "const verificationItems = [];")
const anchor = 'const verificationItems = [];';
const anchorIdx = code.indexOf(anchor);
if (anchorIdx === -1) {
  console.log('⚠️  Could not find verificationItems anchor');
  process.exit(1);
}

// Add attestation loading right after
if (!code.includes('_profileAttestations')) {
  const insertPoint = code.indexOf('\n', anchorIdx) + 1;
  const attestationLoad = `  // Load on-chain attestation TXs for this profile
  let _profileAttestations = {};
  try {
    const atts = getAttestations(profile.id);
    for (const a of atts) _profileAttestations[a.platform] = a;
  } catch (e) {}
\n`;
  code = code.slice(0, insertPoint) + attestationLoad + code.slice(insertPoint);
  console.log('✅ Added attestation loading');
}

// 2. Modify the verification HTML to include on-chain badge
// Replace the verification-item template to add attestation link
const oldTemplate = `          <div class="v-badge">✓ Verified</div>`;
const newTemplate = `          <div class="v-badge">✓ Verified</div>
          \${_profileAttestations[item.platform] ? '<a href="' + _profileAttestations[item.platform].solscan_url + '" target="_blank" rel="noopener" class="v-onchain-badge" title="Verified on-chain (Solana Memo TX)">⛓️</a>' : ''}`;

if (code.includes(oldTemplate) && !code.includes('v-onchain-badge')) {
  // Replace only the first occurrence (in the verification items loop)
  code = code.replace(oldTemplate, newTemplate);
  console.log('✅ Added on-chain badge to verification items');
}

// 3. Add platform name to each verificationItem for matching
// We need to add the platform key to each item so we can look up attestations
// Find and update each push to include platform
const platformMappings = [
  ["type: 'Ethereum Wallet'", "platform: 'ethereum', type: 'Ethereum Wallet'"],
  ["type: 'Solana Wallet'", "platform: 'solana', type: 'Solana Wallet'"],
  ["type: 'Base Wallet'", "platform: 'base', type: 'Base Wallet'"],
  ["type: 'GitHub'", "platform: 'github', type: 'GitHub'"],
  ["type: 'X'", "platform: 'x', type: 'X'"],
  ["type: 'Telegram'", "platform: 'telegram', type: 'Telegram'"],
  ["type: 'Discord'", "platform: 'discord', type: 'Discord'"],
  ["type: 'Hyperliquid'", "platform: 'hyperliquid', type: 'Hyperliquid'"],
  ["type: 'Polymarket'", "platform: 'polymarket', type: 'Polymarket'"],
  ["type: 'AgentMail'", "platform: 'agentmail', type: 'AgentMail'"],
];

let mappingCount = 0;
for (const [oldStr, newStr] of platformMappings) {
  if (code.includes(oldStr) && !code.includes(newStr)) {
    // Only replace within the verificationItems section (after anchor)
    const sectionStart = code.indexOf(anchor);
    const sectionEnd = code.indexOf('const verifiedCount', sectionStart);
    const section = code.slice(sectionStart, sectionEnd);
    if (section.includes(oldStr)) {
      const newSection = section.replace(oldStr, newStr);
      code = code.slice(0, sectionStart) + newSection + code.slice(sectionEnd);
      mappingCount++;
    }
  }
}
console.log(`✅ Added platform keys to ${mappingCount} verification items`);

// 4. Add CSS for on-chain badge
const cssAnchor = '.endorsement-from .verified-badge';
const cssIdx = code.indexOf(cssAnchor);
if (cssIdx !== -1 && !code.includes('.v-onchain-badge')) {
  const eol = code.indexOf('\n', cssIdx);
  const css = `
      .v-onchain-badge { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 50%; background: linear-gradient(135deg, #9945FF, #14F195); color: white; font-size: 12px; text-decoration: none; margin-left: 6px; transition: transform 0.2s; }
      .v-onchain-badge:hover { transform: scale(1.2); }`;
  code = code.slice(0, eol) + css + code.slice(eol);
  console.log('✅ Added CSS for on-chain badge');
}

fs.writeFileSync('src/server.js', code);
console.log('✅ server.js saved');
