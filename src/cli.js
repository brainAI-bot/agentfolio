#!/usr/bin/env node
/**
 * AgentFolio CLI
 * Manage agent profiles and verification
 */

const { createProfile, verifyProfile, saveProfile, loadProfile, listProfiles, SKILLS_TAXONOMY } = require('./lib/profile');
const { verifyGitHubCommits } = require('./lib/verification');

const DATA_DIR = __dirname + '/../data/profiles';

async function main() {
  const command = process.argv[2];
  const args = process.argv.slice(3);

  switch (command) {
    case 'create':
      await handleCreate(args);
      break;
    case 'verify':
      await handleVerify(args);
      break;
    case 'show':
      await handleShow(args);
      break;
    case 'list':
      await handleList();
      break;
    case 'verify-github':
      await handleVerifyGitHub(args);
      break;
    case 'skills':
      handleSkills();
      break;
    default:
      printUsage();
  }
}

async function handleCreate(args) {
  const name = args[0];
  const handle = args[1];
  
  if (!name || !handle) {
    console.log('Usage: node cli.js create <name> <handle>');
    return;
  }

  const profile = createProfile({ name, handle });
  const filepath = saveProfile(profile, DATA_DIR);
  
  console.log('✓ Profile created!');
  console.log('  ID:', profile.id);
  console.log('  Name:', profile.name);
  console.log('  Handle:', profile.handle);
  console.log('  Saved to:', filepath);
}

async function handleVerify(args) {
  const profileId = args[0];
  
  if (!profileId) {
    console.log('Usage: node cli.js verify <profile_id>');
    return;
  }

  const profile = loadProfile(profileId, DATA_DIR);
  if (!profile) {
    console.log('Profile not found:', profileId);
    return;
  }

  console.log('Verifying profile:', profile.name);
  const verification = await verifyProfile(profile);
  
  profile.verification = verification;
  saveProfile(profile, DATA_DIR);

  console.log('\n=== Verification Results ===');
  console.log('Score:', verification.score + '%');
  console.log('Tier:', verification.tier);
  console.log('Proofs:', verification.proofs.length);
  
  verification.proofs.forEach(p => {
    const status = p.verified ? '✓' : '✗';
    console.log(`  ${status} ${p.type}: ${p.item}`);
  });
}

async function handleShow(args) {
  const profileId = args[0];
  
  if (!profileId) {
    console.log('Usage: node cli.js show <profile_id>');
    return;
  }

  const profile = loadProfile(profileId, DATA_DIR);
  if (!profile) {
    console.log('Profile not found:', profileId);
    return;
  }

  console.log('\n=== Agent Profile ===');
  console.log('Name:', profile.name);
  console.log('Handle:', profile.handle);
  console.log('Bio:', profile.bio || '(none)');
  console.log('\nLinks:');
  Object.entries(profile.links).forEach(([k, v]) => {
    if (v) console.log(`  ${k}: ${v}`);
  });
  
  console.log('\nSkills:', profile.skills.length);
  profile.skills.forEach(s => {
    const verified = s.verified ? '✓' : '○';
    console.log(`  ${verified} ${s.name} (${s.category})`);
  });

  console.log('\nPortfolio:', profile.portfolio.length, 'items');
  profile.portfolio.forEach(p => {
    const verified = p.verified ? '✓' : '○';
    console.log(`  ${verified} ${p.title} [${p.type}]`);
  });

  console.log('\nVerification:');
  console.log('  Score:', profile.verification?.score || 0, '%');
  console.log('  Tier:', profile.verification?.tier || 'unverified');
}

async function handleList() {
  const profiles = listProfiles(DATA_DIR);
  
  if (profiles.length === 0) {
    console.log('No profiles found.');
    return;
  }

  console.log('\n=== Agent Profiles ===\n');
  profiles.forEach(p => {
    const score = p.verification?.score || 0;
    const tier = p.verification?.tier || 'unverified';
    console.log(`${p.name} (${p.handle})`);
    console.log(`  ID: ${p.id}`);
    console.log(`  Verification: ${score}% [${tier}]`);
    console.log(`  Skills: ${p.skills.length} | Portfolio: ${p.portfolio.length}`);
    console.log('');
  });
}

async function handleVerifyGitHub(args) {
  const [owner, repo, author] = args;
  
  if (!owner || !repo) {
    console.log('Usage: node cli.js verify-github <owner> <repo> [author]');
    return;
  }

  console.log(`Verifying GitHub: ${owner}/${repo}`);
  const result = await verifyGitHubCommits(owner, repo, author);
  
  console.log('\n=== GitHub Verification ===');
  console.log('Total commits:', result.totalCommits);
  console.log('Signed commits:', result.signedCommits);
  console.log('Author matches:', result.authorMatches);
  console.log('Trust level:', result.trustLevel);
  
  if (result.commits) {
    console.log('\nRecent commits:');
    result.commits.slice(0, 5).forEach(c => {
      const signed = c.signed ? '🔐' : '  ';
      const author = c.authorMatch ? '✓' : '?';
      console.log(`  ${signed} ${c.sha} ${author} ${c.message}`);
    });
  }
}

function handleSkills() {
  console.log('\n=== Skills Taxonomy ===\n');
  Object.entries(SKILLS_TAXONOMY).forEach(([category, skills]) => {
    console.log(`${category}:`);
    skills.forEach(s => console.log(`  - ${s}`));
    console.log('');
  });
}

function printUsage() {
  console.log(`
AgentFolio CLI - Portfolio & Reputation for AI Agents

Commands:
  create <name> <handle>     Create new profile
  verify <profile_id>        Verify profile claims
  show <profile_id>          Display profile
  list                       List all profiles
  verify-github <owner> <repo> [author]  Test GitHub verification
  skills                     Show skills taxonomy

Examples:
  node cli.js create "Dominus" "@Sogav01"
  node cli.js verify agent_abc123
  node cli.js verify-github clawdbot clawdbot
  `);
}

main().catch(console.error);
