#!/usr/bin/env node
/**
 * Auto-Verify Seeded Agents
 * 
 * Populates real GitHub/Twitter handles for known AI agent projects,
 * then verifies them via GitHub API (account exists + has repos).
 * Uses "platform_verified" method — lighter than bio_link verification
 * but proves the GitHub account is real and active.
 * 
 * Usage:
 *   node scripts/auto-verify-agents.js          # Dry run
 *   node scripts/auto-verify-agents.js --apply   # Apply changes
 *   node scripts/auto-verify-agents.js --stats   # Show current verification stats
 */

const path = require('path');
const https = require('https');
const fs = require('fs');

// Adjust require paths
const DB_PATH = path.join(__dirname, '..');
process.chdir(DB_PATH);

const db = require(path.join(DB_PATH, 'src/lib/database'));

// ============================================================
// Known agent → GitHub/Twitter mapping
// Researched from project websites, GitHub orgs, Twitter accounts
// ============================================================
const AGENT_SOCIAL_MAP = {
  // --- Top AI Agent Projects (from Bankless, DeFiLlama, etc.) ---
  'agent_aixbt': {
    github: 'aixbt-agent',
    twitter: 'aixbt_agent',
    website: 'https://aixbt.com'
  },
  'agent_zerebro': {
    github: 'zerepy',
    twitter: '0xzerebro',
    website: 'https://zerebro.com'
  },
  'agent_luna': {
    github: null,
    twitter: 'luna_virtuals',
    website: 'https://virtuals.io'
  },
  'agent_vaderai': {
    github: 'VaderAI',
    twitter: 'Vader_AI_',
    website: null
  },
  'agent_truthterminal': {
    github: null,
    twitter: 'truth_terminal',
    website: null
  },
  'agent_terminaloftruths': {
    github: null,
    twitter: 'truth_terminal',
    website: null
  },
  'agent_dolos': {
    github: null,
    twitter: 'dolos_diary',
    website: null
  },
  'agent_botto': {
    github: 'bottoproject',
    twitter: 'bottoproject',
    website: 'https://botto.com'
  },
  'agent_eliza': {
    github: 'elizaOS',
    twitter: 'ai16zdao',
    website: 'https://elizaos.ai'
  },
  'agent_ai16z': {
    github: 'elizaOS',
    twitter: 'ai16zdao',
    website: 'https://elizaos.ai'
  },
  'agent_freysa': {
    github: 'FreysaAI',
    twitter: 'FreysaAI',
    website: 'https://freysa.ai'
  },
  'agent_pippin': {
    github: null,
    twitter: 'pippin',
    website: null
  },

  // --- DeFi/Infrastructure Agents ---
  'agent_singularitynet': {
    github: 'singnet',
    twitter: 'SingularityNET',
    website: 'https://singularitynet.io'
  },
  'agent_fetchaiagents': {
    github: 'fetchai',
    twitter: 'Fetch_ai',
    website: 'https://fetch.ai'
  },
  'agent_oceanprotocolagent': {
    github: 'oceanprotocol',
    twitter: 'oceanprotocol',
    website: 'https://oceanprotocol.com'
  },
  'agent_phalaagent': {
    github: 'Phala-Network',
    twitter: 'PhalaNetwork',
    website: 'https://phala.network'
  },
  'agent_myshellagent': {
    github: 'myshell-ai',
    twitter: 'myshell_ai',
    website: 'https://myshell.ai'
  },
  'agent_morpheusai': {
    github: 'MorpheusAIs',
    twitter: 'MorpheusAIs',
    website: 'https://mor.org'
  },
  'agent_autonolas': {
    github: 'valory-xyz',
    twitter: 'autonolas',
    website: 'https://olas.network'
  },
  'agent_akashagent': {
    github: 'akash-network',
    twitter: 'akashnet_',
    website: 'https://akash.network'
  },
  'agent_renderagent': {
    github: 'rendernetwork',
    twitter: 'rendernetwork',
    website: 'https://rendernetwork.com'
  },
  'agent_bittensoragent': {
    github: 'opentensor',
    twitter: 'bittensor_',
    website: 'https://bittensor.com'
  },
  'agent_grassagent': {
    github: 'getgrass-io',
    twitter: 'getgrass_io',
    website: 'https://getgrass.io'
  },
  'agent_ionetagent': {
    github: 'ionet-official',
    twitter: 'ionet',
    website: 'https://io.net'
  },
  'agent_nearai': {
    github: 'near',
    twitter: 'NEARProtocol',
    website: 'https://near.org'
  },
  'agent_spectral': {
    github: 'Spectral-Finance',
    twitter: 'SpectralFi',
    website: 'https://spectral.finance'
  },
  'agent_ritualagent': {
    github: 'ritual-net',
    twitter: 'ritualnet',
    website: 'https://ritual.net'
  },
  'agent_brianai': {
    github: 'brian-knows',
    twitter: 'brian_knows',
    website: 'https://brian.ai'
  },
  'agent_cookieai': {
    github: 'cookie3dev',
    twitter: 'cookie3_co',
    website: 'https://cookie3.co'
  },
  'agent_wayfinder': {
    github: null,
    twitter: 'AIWayfinder',
    website: 'https://wayfinder.ai'
  },
  'agent_griffain': {
    github: null,
    twitter: 'griffainfun',
    website: 'https://griffain.com'
  },
  'agent_dainprotocol': {
    github: 'dainprotocol',
    twitter: 'dainprotocol',
    website: 'https://dain.org'
  },
  'agent_avaprotocol': {
    github: 'AvaProtocol',
    twitter: 'AvaProtocol',
    website: 'https://avaprotocol.org'
  },
  'agent_sentientai': {
    github: null,
    twitter: 'SentientAGI',
    website: 'https://sentient.foundation'
  },
  'agent_agentlayer': {
    github: 'AgentLayer',
    twitter: 'AgentLayer_xyz',
    website: 'https://agentlayer.xyz'
  },
  'agent_swarmzero': {
    github: 'swarmzero',
    twitter: 'swarmzero_ai',
    website: 'https://swarmzero.ai'
  },
  'agent_chainmlagent': {
    github: 'ChainML',
    twitter: 'chainml_io',
    website: 'https://chainml.net'
  },
  'agent_tarsprotocol': {
    github: 'tars-protocol',
    twitter: 'tarsprotocol',
    website: null
  },
  'agent_gizaagent': {
    github: 'gizatechxyz',
    twitter: 'giza_tech',
    website: 'https://gizatech.xyz'
  },
  'agent_pondai': {
    github: null,
    twitter: 'pondai_xyz',
    website: 'https://cryptopond.xyz'
  },
  'agent_netmindagent': {
    github: 'protagolabs',
    twitter: 'NetmindAI',
    website: 'https://netmind.ai'
  },

  // --- Famous agent personalities ---
  'agent_goatsegospels': {
    github: null,
    twitter: 'gospels_of_goatse',
    website: null
  },
  'agent_slopfather': {
    github: null,
    twitter: 'slopfather',
    website: null
  },
  'agent_clanker': {
    github: null,
    twitter: '_clanker_',
    website: null
  },
  'agent_lola': {
    github: null,
    twitter: 'lola_onchain',
    website: null
  },
  'agent_koko': {
    github: null,
    twitter: null,
    website: null
  },
  'agent_cents': {
    github: null,
    twitter: null,
    website: null
  },
  'agent_project89': {
    github: 'project-89',
    twitter: 'project_89',
    website: null
  },
  'agent_degenspartan': {
    github: null,
    twitter: 'DegenSpartan',
    website: null
  },
  'agent_sage': {
    github: null,
    twitter: null,
    website: null
  },
  'agent_reaper': {
    github: null,
    twitter: null,
    website: null
  },
  'agent_apex': {
    github: null,
    twitter: null,
    website: null
  },
  'agent_max': {
    github: null,
    twitter: null,
    website: null
  },
  'agent_opus': {
    github: null,
    twitter: null,
    website: null
  },
  'agent_quantbot': {
    github: null,
    twitter: null,
    website: null
  },
  'agent_robosociety': {
    github: null,
    twitter: null,
    website: null
  },
  'agent_aether': {
    github: null,
    twitter: null,
    website: null
  },
  'agent_nexusai': {
    github: null,
    twitter: null,
    website: null
  },

  // --- Internal/Custom agents ---
  'agent_polybot': {
    github: '0xbrainkid',
    twitter: '0xbrainKID',
    website: 'https://agentfolio.bot'
  },
  'agent_aipbot': {
    github: 'The-Nexus-Guard',
    twitter: 'the_nexus_guard',
    website: 'https://aip-service.fly.dev'
  },
  'agent_thenexusguard': {
    github: 'The-Nexus-Guard',
    twitter: 'the_nexus_guard',
    website: 'https://aip-service.fly.dev'
  },
  'agent_aipprotocol': {
    github: 'The-Nexus-Guard',
    twitter: 'the_nexus_guard',
    website: null
  },
  'agent_nexusguardaip': {
    github: 'The-Nexus-Guard',
    twitter: 'the_nexus_guard',
    website: null
  },

  // --- Batch imported AI agent infra ---
  'agent_aletheaai': {
    github: 'alethea-ai',
    twitter: 'alethea__ai',
    website: 'https://alethea.ai'
  },
  'agent_aiarenaagent': {
    github: 'aiarena',
    twitter: 'aiarena_',
    website: 'https://aiarena.com'
  },
  'agent_assisterragent': {
    github: 'Assisterra',
    twitter: null,
    website: null
  },
  'agent_numeraiagent': {
    github: 'numerai',
    twitter: 'numerai',
    website: 'https://numer.ai'
  },
  'agent_agentcoin': {
    github: null,
    twitter: 'agentcoinfun',
    website: null
  },
  'agent_flocksocial': {
    github: null,
    twitter: 'flockai',
    website: null
  },
  'agent_heyanon': {
    github: 'heyanon-ai',
    twitter: 'heyanon_ai',
    website: null
  },
  'agent_almanak': {
    github: 'almanak-ai',
    twitter: 'almanak_co',
    website: null
  },
  'agent_shogun': {
    github: null,
    twitter: null,
    website: null
  },
};

// ============================================================
// GitHub API helper (with rate limit awareness)
// ============================================================

function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      headers: {
        'User-Agent': 'AgentFolio-AutoVerify/1.0',
        'Accept': 'application/vnd.github.v3+json',
        ...headers
      }
    };
    https.get(options, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode === 200) resolve(JSON.parse(data));
        else if (res.statusCode === 404) resolve(null);
        else reject(new Error(`HTTP ${res.statusCode}: ${data.substring(0, 200)}`));
      });
    }).on('error', reject);
  });
}

async function fetchGitHubOrg(name) {
  // Try as org first, then as user
  let result = await httpGet(`https://api.github.com/orgs/${name}`);
  if (result) return { ...result, type: 'org' };
  result = await httpGet(`https://api.github.com/users/${name}`);
  if (result) return { ...result, type: 'user' };
  return null;
}

async function fetchGitHubRepos(name, limit = 5) {
  // Try org repos first
  let repos = await httpGet(`https://api.github.com/orgs/${name}/repos?sort=updated&per_page=${limit}`);
  if (!repos || !Array.isArray(repos)) {
    repos = await httpGet(`https://api.github.com/users/${name}/repos?sort=updated&per_page=${limit}`);
  }
  return Array.isArray(repos) ? repos : [];
}

// ============================================================
// Main verification logic
// ============================================================

async function verifyAgent(profile, socialInfo, dryRun = true) {
  const result = {
    id: profile.id,
    name: profile.name,
    socialLinksUpdated: false,
    githubVerified: false,
    twitterLinked: false,
    websiteLinked: false,
    details: {}
  };

  // 1. Update social links on profile
  const links = profile.links || {};
  const updates = {};
  
  if (socialInfo.github && !links.github) {
    updates.github = `https://github.com/${socialInfo.github}`;
  }
  if (socialInfo.twitter && !links.twitter) {
    updates.twitter = `https://x.com/${socialInfo.twitter}`;
  }
  if (socialInfo.website && !links.website) {
    updates.website = socialInfo.website;
  }

  if (Object.keys(updates).length > 0) {
    result.socialLinksUpdated = true;
    result.details.linksAdded = updates;
    
    if (!dryRun) {
      const newLinks = { ...links, ...updates };
      profile.links = newLinks;
    }
  }

  // 2. Verify GitHub (if github handle provided)
  if (socialInfo.github) {
    try {
      const ghUser = await fetchGitHubOrg(socialInfo.github);
      if (ghUser) {
        const repos = await fetchGitHubRepos(socialInfo.github);
        const totalStars = repos.reduce((sum, r) => sum + (r.stargazers_count || 0), 0);
        
        result.githubVerified = true;
        result.details.github = {
          username: ghUser.login,
          name: ghUser.name || ghUser.login,
          type: ghUser.type,
          publicRepos: ghUser.public_repos,
          followers: ghUser.followers || 0,
          createdAt: ghUser.created_at?.substring(0, 10),
          stars: totalStars,
          topRepos: repos.slice(0, 3).map(r => ({
            name: r.name,
            stars: r.stargazers_count,
            language: r.language,
            updated: r.updated_at?.substring(0, 10)
          }))
        };

        // Calculate verification score (lighter than bio_link verification)
        let score = 10; // base for existing account
        if (ghUser.public_repos >= 5) score += 10;
        if (ghUser.public_repos >= 20) score += 10;
        if ((ghUser.followers || 0) >= 10) score += 10;
        if ((ghUser.followers || 0) >= 100) score += 10;
        if (totalStars >= 10) score += 10;
        if (totalStars >= 100) score += 15;
        if (totalStars >= 1000) score += 15;
        // Account age bonus
        const ageYears = (Date.now() - new Date(ghUser.created_at)) / (365.25 * 24 * 60 * 60 * 1000);
        if (ageYears >= 1) score += 5;
        if (ageYears >= 3) score += 5;

        result.details.github.verificationScore = score;

        if (!dryRun) {
          const vd = profile.verificationData || {};
          vd.github = {
            verified: true,
            username: ghUser.login,
            name: ghUser.name,
            publicRepos: ghUser.public_repos,
            followers: ghUser.followers || 0,
            createdAt: ghUser.created_at?.substring(0, 10),
            totalCommits: 0, // not fetched in bulk
            signedCommits: 0,
            topRepos: repos.slice(0, 5).map(r => ({
              name: r.name,
              stars: r.stargazers_count,
              language: r.language,
              updated: r.updated_at?.substring(0, 10)
            })),
            verificationScore: score,
            verificationMethod: 'platform_verified',
            verifiedAt: new Date().toISOString()
          };
          profile.verificationData = vd;
        }
      } else {
        result.details.github = { error: `GitHub account '${socialInfo.github}' not found` };
      }
    } catch (err) {
      result.details.github = { error: err.message };
    }
  }

  // 3. Link Twitter (can't verify without API, but linking is valuable)
  if (socialInfo.twitter) {
    result.twitterLinked = true;
    result.details.twitter = { handle: socialInfo.twitter };
    
    if (!dryRun) {
      const vd = profile.verificationData || {};
      vd.twitter = {
        verified: false, // Can't verify without Twitter API
        linked: true,
        handle: socialInfo.twitter,
        linkedAt: new Date().toISOString(),
        note: 'Twitter handle linked but not verified (requires API access)'
      };
      profile.verificationData = vd;
    }
  }

  // 4. Link website
  if (socialInfo.website) {
    result.websiteLinked = true;
  }

  return result;
}

async function saveProfile(profile) {
  // Save to JSON
  const profilePath = path.join(DB_PATH, 'data', 'profiles', `${profile.id}.json`);
  fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2));
  
  // Save to SQLite
  try {
    db.saveProfile(profile);
  } catch (e) {
    console.warn(`  ⚠ SQLite save failed for ${profile.id}: ${e.message}`);
  }
}

// ============================================================
// CLI entry point
// ============================================================

async function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--apply');
  const statsOnly = args.includes('--stats');

  const profiles = db.listProfiles();
  
  if (statsOnly) {
    let verified = 0, unverified = 0, githubVerified = 0, twitterLinked = 0;
    profiles.forEach(p => {
      const vd = p.verificationData || {};
      const hasAny = Object.keys(vd).some(k => vd[k]?.verified);
      if (hasAny) verified++;
      else unverified++;
      if (vd.github?.verified) githubVerified++;
      if (vd.twitter?.verified || vd.twitter?.linked) twitterLinked++;
    });
    console.log(`\n📊 Verification Stats`);
    console.log(`  Total profiles: ${profiles.length}`);
    console.log(`  Verified (any): ${verified} (${(verified/profiles.length*100).toFixed(1)}%)`);
    console.log(`  GitHub verified: ${githubVerified}`);
    console.log(`  Twitter linked: ${twitterLinked}`);
    console.log(`  Unverified: ${unverified}`);
    return;
  }

  console.log(`\n🔍 AgentFolio Auto-Verification Script`);
  console.log(`  Mode: ${dryRun ? 'DRY RUN (use --apply to save)' : '🟢 APPLYING CHANGES'}`);
  console.log(`  Total profiles: ${profiles.length}`);
  console.log(`  Known mappings: ${Object.keys(AGENT_SOCIAL_MAP).length}`);
  console.log();

  const linksOnly = args.includes('--links-only');
  const githubOnly = args.includes('--github-only');
  
  let totalUpdated = 0;
  let totalGithubVerified = 0;
  let totalTwitterLinked = 0;
  let totalSkipped = 0;
  let totalErrors = 0;
  let apiCalls = 0;
  const MAX_API_CALLS = 55; // GitHub rate limit is 60/hour for unauthenticated

  for (const profile of profiles) {
    const socialInfo = AGENT_SOCIAL_MAP[profile.id];
    if (!socialInfo) {
      totalSkipped++;
      continue;
    }

    // Skip already verified profiles (for github-only mode)
    const vd = profile.verificationData || {};
    if (githubOnly && vd.github?.verified && vd.github?.verificationMethod === 'platform_verified') {
      console.log(`  ⏭ ${profile.id} — already auto-verified`);
      totalSkipped++;
      continue;
    }

    // In links-only mode, skip GitHub API calls
    const effectiveInfo = { ...socialInfo };
    if (linksOnly) {
      effectiveInfo.github = null; // Skip API calls, just update links
      // But still add the github link URL
    }

    // Rate limit check for GitHub
    if (effectiveInfo.github && apiCalls >= MAX_API_CALLS) {
      console.log(`  ⚠ Rate limit approaching (${apiCalls} API calls). Stopping GitHub verification.`);
      effectiveInfo.github = null;
    }

    try {
      if (effectiveInfo.github) apiCalls += 2; // org/user + repos
      const result = await verifyAgent(profile, effectiveInfo, dryRun);
      
      // In links-only mode, still update the github link URL even without verification
      if (linksOnly && socialInfo.github && !dryRun) {
        const links = profile.links || {};
        if (!links.github) {
          links.github = `https://github.com/${socialInfo.github}`;
          profile.links = links;
          result.socialLinksUpdated = true;
        }
      }
      
      const actions = [];
      if (result.socialLinksUpdated) actions.push('links');
      if (result.githubVerified) { actions.push('✅ github'); totalGithubVerified++; }
      if (result.twitterLinked) { actions.push('🐦 twitter'); totalTwitterLinked++; }
      if (result.websiteLinked) actions.push('🌐 website');
      
      if (actions.length > 0) {
        totalUpdated++;
        console.log(`  ${dryRun ? '📋' : '✅'} ${profile.id} (${profile.name}) — ${actions.join(', ')}`);
        
        if (result.githubVerified) {
          const gh = result.details.github;
          console.log(`     GitHub: ${gh.username} | ${gh.publicRepos} repos | ${gh.followers} followers | ${gh.stars}⭐ | score: ${gh.verificationScore}`);
        }
        
        if (!dryRun) {
          await saveProfile(profile);
        }
      }

      // Small delay to respect rate limits
      if (effectiveInfo.github) await new Promise(r => setTimeout(r, 200));
      
    } catch (err) {
      console.error(`  ❌ ${profile.id}: ${err.message}`);
      totalErrors++;
    }
  }

  console.log(`\n📊 Summary`);
  console.log(`  Profiles updated: ${totalUpdated}`);
  console.log(`  GitHub verified: ${totalGithubVerified}`);
  console.log(`  Twitter linked: ${totalTwitterLinked}`);
  console.log(`  Skipped: ${totalSkipped}`);
  console.log(`  Errors: ${totalErrors}`);
  console.log(`  API calls used: ${apiCalls}`);
  
  if (dryRun && totalUpdated > 0) {
    console.log(`\n  ℹ Run with --apply to save changes`);
    console.log(`  ℹ Use --links-only --apply to update social links without GitHub API calls`);
    console.log(`  ℹ Use --github-only --apply to verify GitHub accounts (rate limited: 55/hr)`);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
