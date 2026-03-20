#!/usr/bin/env node
/**
 * Fix BUG-002: Verification saves to wrong field
 * 
 * Problem: hardened-verification-routes.js saves to JSON only (profile.verificationData)
 * but doesn't call addVerification() which handles:
 *  - SQLite verifications table
 *  - On-chain SATP level recalculation
 *  - Memo attestation
 *  - Activity feed
 * 
 * Also doesn't update profile.wallets for wallet verifications.
 * 
 * Fix: After each successful verification:
 *  1. Call addVerification() from profile-store.js
 *  2. Update profile.wallets for wallet-based verifications
 *  3. Recalculate trust score
 */
const fs = require('fs');
let code = fs.readFileSync('src/lib/hardened-verification-routes.js', 'utf8');

// 1. Add addVerification import at the top
if (!code.includes('addVerification')) {
  const anchor = "let getChallenge;";
  const idx = code.indexOf(anchor);
  if (idx !== -1) {
    code = code.slice(0, idx) + `// Profile store for SQLite verification + on-chain updates
let addVerification;
try { ({ addVerification } = require('../profile-store')); } catch(e) { console.warn('[Hardened] profile-store addVerification not loaded:', e.message); }

` + code.slice(idx);
    console.log('✅ Added addVerification import');
  }
}

// 2. Fix the Solana confirm handler to save properly
const oldSolanaConfirm = `        if (result.verified && getChallenge) {
          const challenge = await getChallenge(challengeId);
          if (challenge && loadProfile && dbSaveProfileFn) {
            const profile = loadProfile(challenge.challengeData.profileId, DATA_DIR);
            if (profile) {
              profile.verificationData = profile.verificationData || {};
              profile.verificationData.solana = { ...result, method: 'hardened_signature', verifiedAt: new Date().toISOString() };
              profile.updatedAt = new Date().toISOString();
              dbSaveProfileFn(profile);
            }
          }
        }`;

const newSolanaConfirm = `        if (result.verified && getChallenge) {
          const challenge = await getChallenge(challengeId);
          if (challenge) {
            const profileId = challenge.challengeData.profileId;
            const walletAddr = result.walletAddress;
            
            // Save to SQLite verifications table + trigger on-chain updates
            if (addVerification) {
              addVerification(profileId, 'solana', walletAddr, {
                type: 'ed25519_signature',
                signature: result.signature,
                message: result.proof?.message,
                challengeId,
                cryptoVerified: true,
                verifiedAt: new Date().toISOString(),
              });
            }
            
            // Update profile JSON (wallets + verificationData)
            if (loadProfile && dbSaveProfileFn) {
              const profile = loadProfile(profileId, DATA_DIR);
              if (profile) {
                profile.verificationData = profile.verificationData || {};
                profile.verificationData.solana = {
                  address: walletAddr,
                  verified: true,
                  linked: true,
                  method: 'hardened_ed25519_signature',
                  verifiedAt: new Date().toISOString(),
                };
                profile.wallets = profile.wallets || {};
                profile.wallets.solana = walletAddr;
                profile.updatedAt = new Date().toISOString();
                dbSaveProfileFn(profile);
              }
            }
            
            // Activity + memo attestation
            if (addActivityAndBroadcast) addActivityAndBroadcast(profileId, 'verification_solana', { address: walletAddr.slice(0,8) + '...' }, DATA_DIR);
            if (postVerificationMemo) postVerificationMemo(profileId, 'solana', { address: walletAddr }).catch(() => {});
          }
        }`;

if (code.includes(oldSolanaConfirm)) {
  code = code.replace(oldSolanaConfirm, newSolanaConfirm);
  console.log('✅ Fixed Solana confirm handler');
} else {
  console.log('⚠️  Solana confirm handler pattern not found — may need manual fix');
}

// 3. Now fix other verification handlers that have the same pattern
// For HL, PM, Moltbook, Website, Telegram, Discord — add addVerification calls

// Generic pattern: after `dbSaveProfileFn(profile)` in each handler, add addVerification call
// Let's find all the platform-specific save patterns

const platforms = [
  { name: 'hyperliquid', saveField: 'hyperliquid', identField: 'result.identifier || result.walletAddress', walletField: 'hyperliquid' },
  { name: 'polymarket', saveField: 'polymarket', identField: 'result.identifier || result.walletAddress', walletField: null },
  { name: 'moltbook', saveField: 'moltbook', identField: 'result.username', walletField: null },
  { name: 'website', saveField: 'website', identField: 'result.url', walletField: null },
  { name: 'telegram', saveField: 'telegram', identField: 'result.telegramHandle || result.username', walletField: null },
  { name: 'discord', saveField: 'discord', identField: 'result.discordUserId || result.identifier', walletField: null },
  { name: 'github', saveField: 'github', identField: 'result.username || result.identifier', walletField: null },
];

// For each platform handler that does dbSaveProfileFn, add addVerification before it
for (const p of platforms) {
  // Find the pattern: profile.verificationData.PLATFORM = { ... }; ... dbSaveProfileFn(profile);
  const marker = `profile.verificationData.${p.saveField} = `;
  const idx = code.indexOf(marker);
  if (idx === -1) continue;
  
  // Find the dbSaveProfileFn call after this marker
  const saveIdx = code.indexOf('dbSaveProfileFn(profile)', idx);
  if (saveIdx === -1 || saveIdx - idx > 500) continue; // sanity check
  
  // Check if addVerification already added here
  const section = code.slice(idx, saveIdx);
  if (section.includes('addVerification(')) continue;
  
  // Insert addVerification call before dbSaveProfileFn
  const insertPoint = saveIdx;
  const addVerifCode = `
              // Save to SQLite + trigger on-chain updates
              if (addVerification) addVerification(profileId, '${p.name}', ${p.identField}, { verifiedAt: new Date().toISOString() });
              `;
  code = code.slice(0, insertPoint) + addVerifCode + code.slice(insertPoint);
  console.log(`✅ Added addVerification for ${p.name}`);
}

fs.writeFileSync('src/lib/hardened-verification-routes.js', code);
console.log('✅ Saved hardened-verification-routes.js');
