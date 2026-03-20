#!/usr/bin/env node
/**
 * Patch profile-store.js to use scoring-engine-v2 for trust score calculation
 * Replaces the simple additive formula with the v2 engine
 */
const fs = require('fs');
const serverPath = 'src/profile-store.js';
let code = fs.readFileSync(serverPath, 'utf8');

// 1. Add require for scoring-engine-v2 at top (after existing requires)
const scoringRequire = `\n// Scoring Engine V2 — 2D scoring (verification level + reputation)\nlet scoringEngineV2;\ntry {\n  scoringEngineV2 = require('./lib/scoring-engine-v2');\n  console.log('[ProfileStore] Scoring Engine V2 loaded');\n} catch (e) {\n  console.warn('[ProfileStore] Scoring Engine V2 not available:', e.message);\n}\n`;

if (!code.includes('scoring-engine-v2')) {
  // Insert after the v3ScoreService require block
  const insertAfter = "console.log('[V3 Scores] Score service loaded');";
  const insertIdx = code.indexOf(insertAfter);
  if (insertIdx !== -1) {
    const endOfLine = code.indexOf('\n', insertIdx + insertAfter.length);
    code = code.slice(0, endOfLine + 1) + scoringRequire + code.slice(endOfLine + 1);
    console.log('✅ Added scoring-engine-v2 require');
  } else {
    console.log('⚠️  Could not find insertion point for require');
  }
}

// 2. Replace the simple additive trust score calculation with v2 engine
const oldScoring = `        // Calculate v2 Trust Score (0-800 scale)
        // Profile completeness (30 max): name + bio + skills + avatar
        const profile = d.prepare('SELECT name, bio, skills, avatar FROM profiles WHERE id = ?').get(profileId);
        let profileScore = 0;
        if (profile?.name) profileScore += 8;
        if (profile?.bio && profile.bio.length > 20) profileScore += 8;
        if (profile?.skills) profileScore += 8;
        if (profile?.avatar) profileScore += 6;
        profileScore = Math.min(30, profileScore);
        
        // Social verifications (200 max): github, x, discord, telegram, etc
        const socialPlatforms = ['github', 'x', 'twitter', 'discord', 'telegram'];
        const socialCount = allVerifs.filter(v => socialPlatforms.includes(v.platform)).length;
        const socialScore = Math.min(200, socialCount * 50);
        
        // Marketplace verifications (300 max): polymarket, hyperliquid, mcp, a2a
        const marketplacePlatforms = ['polymarket', 'hyperliquid', 'mcp', 'a2a'];
        const marketplaceCount = allVerifs.filter(v => marketplacePlatforms.includes(v.platform)).length;
        const marketplaceScore = Math.min(300, marketplaceCount * 100);
        
        // On-chain verifications (100 max): solana, ethereum, satp
        const onchainPlatforms = ['solana', 'ethereum', 'satp'];
        const onchainCount = allVerifs.filter(v => onchainPlatforms.includes(v.platform)).length;
        const onchainScore = Math.min(100, onchainCount * 50);
        
        // Tenure bonus (170 max): based on profile age
        const profileCreated = new Date(profile?.created_at || Date.now());
        const ageInDays = Math.floor((Date.now() - profileCreated.getTime()) / (1000 * 60 * 60 * 24));
        const tenureScore = Math.min(170, Math.floor(ageInDays / 7) * 10); // 10 points per week, max 170
        
        const newTrustScore = profileScore + socialScore + marketplaceScore + onchainScore + tenureScore;
        console.log(\`[SATP V3] Calculated trust score for \${profileId}: P=\${profileScore} S=\${socialScore} M=\${marketplaceScore} O=\${onchainScore} T=\${tenureScore} = \${newTrustScore}\`);`;

const newScoring = `        // Calculate trust score using Scoring Engine V2
        let newTrustScore = 0;
        try {
          // Build profile object for v2 engine from DB data
          const profileRow = d.prepare('SELECT * FROM profiles WHERE id = ?').get(profileId);
          const endorsements = d.prepare('SELECT * FROM endorsements WHERE profile_id = ?').all(profileId);
          const rfk = module.exports._reviewFk || 'profile_id';
          const reviews = d.prepare(\`SELECT * FROM reviews WHERE \${rfk} = ?\`).all(profileId);
          const jobCount = (() => { try { return d.prepare("SELECT COUNT(*) as c FROM jobs WHERE selected_agent_id = ? AND status = 'completed'").get(profileId)?.c || 0; } catch { return 0; } })();
          
          // Build verificationData from DB verifications table
          const verifData = {};
          for (const v of allVerifs) {
            verifData[v.platform] = { verified: true };
          }
          
          const profileObj = {
            id: profileId,
            name: profileRow?.name || '',
            handle: profileRow?.handle || '',
            bio: profileRow?.bio || profileRow?.description || '',
            avatar: profileRow?.avatar || '',
            skills: parseJsonField(profileRow?.skills, []),
            verificationData: verifData,
            endorsements: endorsements,
            stats: {
              jobsCompleted: jobCount,
              reviewsReceived: reviews.length,
              rating: reviews.length > 0 ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : 0,
            },
            lastActivity: profileRow?.updated_at || profileRow?.created_at,
            createdAt: profileRow?.created_at,
            nftAvatar: parseJsonField(profileRow?.nft_avatar, {}),
          };
          
          if (scoringEngineV2) {
            const scoreResult = scoringEngineV2.getCompleteScore(profileObj);
            newTrustScore = scoreResult.reputationScore.score;
            console.log(\`[SATP V3] V2 Score for \${profileId}: L\${scoreResult.verificationLevel.level} \${scoreResult.verificationLevel.name}, Rep=\${newTrustScore}, Tier=\${scoreResult.overall.tier}\`);
          } else {
            // Fallback: simple verification count * 50
            newTrustScore = Math.min(800, verifCount * 50);
            console.log(\`[SATP V3] Fallback score for \${profileId}: \${newTrustScore}\`);
          }
        } catch (scoreErr) {
          console.error(\`[SATP V3] Score calculation error for \${profileId}:\`, scoreErr.message);
          newTrustScore = Math.min(800, verifCount * 50); // fallback
        }`;

if (code.includes(oldScoring)) {
  code = code.replace(oldScoring, newScoring);
  console.log('✅ Replaced additive scoring with V2 engine');
} else {
  console.log('⚠️  Old scoring block not found — may already be patched or format changed');
  // Try to find a partial match
  if (code.includes('// Calculate v2 Trust Score (0-800 scale)')) {
    console.log('  Found partial match — scoring block exists but format differs');
  }
}

fs.writeFileSync(serverPath, code);
console.log('✅ profile-store.js saved');
