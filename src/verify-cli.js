#!/usr/bin/env node
/**
 * AgentFolio Verification CLI
 * Verify agent claims and update profiles
 * 
 * Usage:
 *   node verify-cli.js github <profile_id> <github_username> [repo]
 *   node verify-cli.js onchain <profile_id> <wallet_address> [chain]
 *   node verify-cli.js all <profile_id>
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const DATA_DIR = path.join(__dirname, '../data/profiles');

// Verification functions
async function fetchJSON(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      headers: {
        'User-Agent': 'AgentFolio-Verifier/1.0',
        'Accept': 'application/json',
        ...headers
      }
    };

    https.get(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve({ error: e.message, raw: data.substring(0, 200) });
        }
      });
    }).on('error', reject);
  });
}

async function verifyGitHub(username) {
  console.log(`\n🔍 Verifying GitHub: ${username}`);
  
  // Get user info
  const user = await fetchJSON(`https://api.github.com/users/${username}`);
  if (user.message === 'Not Found') {
    return { verified: false, error: 'User not found' };
  }

  // Get repos
  const repos = await fetchJSON(`https://api.github.com/users/${username}/repos?sort=updated&per_page=10`);
  
  // Get recent commits across repos
  let totalCommits = 0;
  let signedCommits = 0;
  const repoStats = [];

  for (const repo of (repos.slice ? repos.slice(0, 5) : [])) {
    const commits = await fetchJSON(`https://api.github.com/repos/${username}/${repo.name}/commits?per_page=5`);
    if (Array.isArray(commits)) {
      totalCommits += commits.length;
      commits.forEach(c => {
        if (c.commit?.verification?.verified) signedCommits++;
      });
      repoStats.push({
        name: repo.name,
        stars: repo.stargazers_count,
        language: repo.language,
        updated: repo.updated_at?.split('T')[0]
      });
    }
  }

  const result = {
    verified: true,
    username: user.login,
    name: user.name,
    publicRepos: user.public_repos,
    followers: user.followers,
    createdAt: user.created_at?.split('T')[0],
    totalCommits,
    signedCommits,
    topRepos: repoStats,
    verificationScore: Math.min(100, 30 + (user.public_repos * 2) + (user.followers) + (signedCommits * 5))
  };

  console.log(`  ✓ Found: ${user.name || user.login}`);
  console.log(`  ✓ Repos: ${user.public_repos} | Followers: ${user.followers}`);
  console.log(`  ✓ Recent commits: ${totalCommits} (${signedCommits} signed)`);
  console.log(`  ✓ Score: ${result.verificationScore}%`);

  return result;
}

async function verifyHyperliquid(address) {
  console.log(`\n🔍 Verifying Hyperliquid: ${address}`);
  
  try {
    // Hyperliquid API - get account state
    const response = await new Promise((resolve, reject) => {
      const postData = JSON.stringify({
        type: 'clearinghouseState',
        user: address
      });

      const options = {
        hostname: 'api.hyperliquid.xyz',
        path: '/info',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': postData.length
        }
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch (e) { resolve({ error: e.message }); }
        });
      });
      req.on('error', reject);
      req.write(postData);
      req.end();
    });

    if (response.error) {
      return { verified: false, error: response.error };
    }

    const accountValue = parseFloat(response.marginSummary?.accountValue || 0);
    const positions = response.assetPositions || [];
    
    const result = {
      verified: accountValue > 0 || positions.length > 0,
      address,
      accountValue: accountValue.toFixed(2),
      openPositions: positions.length,
      verificationScore: accountValue > 1000 ? 80 : accountValue > 100 ? 50 : 30
    };

    console.log(`  ✓ Account Value: $${result.accountValue}`);
    console.log(`  ✓ Open Positions: ${result.openPositions}`);
    console.log(`  ✓ Score: ${result.verificationScore}%`);

    return result;
  } catch (e) {
    return { verified: false, error: e.message };
  }
}

// Use the enhanced Solana verification library
const { verifySolanaWallet } = require('./lib/solana-verify');

async function verifySolana(address) {
  return verifySolanaWallet(address);
}

function loadProfile(profileId) {
  const filePath = path.join(DATA_DIR, `${profileId}.json`);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function saveProfile(profile) {
  const filePath = path.join(DATA_DIR, `${profile.id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(profile, null, 2));
  console.log(`\n💾 Saved profile: ${filePath}`);
}

function updateProfileVerification(profile, verifications) {
  // Update verification data
  profile.verificationData = profile.verificationData || {};
  
  for (const [key, data] of Object.entries(verifications)) {
    profile.verificationData[key] = {
      ...data,
      verifiedAt: new Date().toISOString()
    };
  }

  // Calculate overall score
  const scores = Object.values(verifications)
    .filter(v => v.verified)
    .map(v => v.verificationScore || 0);
  
  const avgScore = scores.length > 0 
    ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
    : 0;

  profile.verification = {
    tier: avgScore >= 70 ? 'verified' : avgScore >= 30 ? 'partially_verified' : 'unverified',
    score: avgScore,
    lastVerified: new Date().toISOString()
  };

  // Mark relevant skills as verified
  if (verifications.github?.verified) {
    profile.skills.forEach(s => {
      if (s.category === 'Development') s.verified = true;
    });
  }
  if (verifications.hyperliquid?.verified || verifications.solana?.verified) {
    profile.skills.forEach(s => {
      if (s.category === 'Trading' || s.name.includes('Trading')) s.verified = true;
    });
  }

  return profile;
}

async function main() {
  const [,, command, profileId, ...args] = process.argv;

  if (!command) {
    console.log(`
AgentFolio Verification CLI

Usage:
  node verify-cli.js github <profile_id> <github_username>
  node verify-cli.js hyperliquid <profile_id> <wallet_address>
  node verify-cli.js solana <profile_id> <wallet_address>
  node verify-cli.js all <profile_id>
  
Examples:
  node verify-cli.js github agent_brainkid 0xbrainKID
  node verify-cli.js hyperliquid agent_brainkid 0x4Bf93279060fB5f71D40Ee7165D9f17535b0a2ba
  node verify-cli.js all agent_brainkid
`);
    return;
  }

  const profile = loadProfile(profileId);
  if (!profile && command !== 'help') {
    console.error(`❌ Profile not found: ${profileId}`);
    process.exit(1);
  }

  const verifications = {};

  switch (command) {
    case 'github': {
      const username = args[0];
      if (!username) {
        console.error('❌ GitHub username required');
        process.exit(1);
      }
      verifications.github = await verifyGitHub(username);
      break;
    }

    case 'hyperliquid': {
      const address = args[0];
      if (!address) {
        console.error('❌ Wallet address required');
        process.exit(1);
      }
      verifications.hyperliquid = await verifyHyperliquid(address);
      break;
    }

    case 'solana': {
      const address = args[0];
      if (!address) {
        console.error('❌ Wallet address required');
        process.exit(1);
      }
      verifications.solana = await verifySolana(address);
      break;
    }

    case 'all': {
      console.log(`\n🔍 Running all verifications for: ${profile.name}`);
      
      // GitHub - try to extract from links
      if (profile.links?.github) {
        const ghMatch = profile.links.github.match(/github\.com\/([^\/]+)/);
        if (ghMatch) {
          verifications.github = await verifyGitHub(ghMatch[1]);
        }
      }

      // Hyperliquid - check if wallet stored
      if (profile.wallets?.hyperliquid) {
        verifications.hyperliquid = await verifyHyperliquid(profile.wallets.hyperliquid);
      }

      // Solana
      if (profile.wallets?.solana) {
        verifications.solana = await verifySolana(profile.wallets.solana);
      }

      break;
    }

    default:
      console.error(`❌ Unknown command: ${command}`);
      process.exit(1);
  }

  if (Object.keys(verifications).length > 0) {
    const updated = updateProfileVerification(profile, verifications);
    saveProfile(updated);
    
    console.log(`\n✅ Verification complete!`);
    console.log(`   Tier: ${updated.verification.tier}`);
    console.log(`   Score: ${updated.verification.score}%`);
  }
}

main().catch(console.error);
