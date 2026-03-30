#!/usr/bin/env node
/**
 * Bulk Seed — Import external agent profiles from GitHub
 * Creates unclaimed placeholder profiles for well-known AI agent projects.
 * 
 * Usage: node bulk-seed.js
 * 
 * Profiles are marked as unclaimed so owners can claim them via the claim flow.
 */

const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');

const DB_PATH = path.join(__dirname, '..', 'data', 'agentfolio.db');
const GITHUB_API = 'https://api.github.com';
const DELAY_MS = 1200; // Rate limit: stay under 60 req/hr

// ─── Agent list: [githubUsername, displayName, category, optional description] ───
const AGENTS = [
  // LLM Frameworks & Agent Frameworks
  ['langchain-ai', 'LangChain', 'framework', 'Build context-aware reasoning applications'],
  ['run-llama', 'LlamaIndex', 'framework', 'Data framework for LLM applications'],
  ['crewAIInc', 'CrewAI', 'framework', 'Framework for orchestrating autonomous AI agents'],
  ['Significant-Gravitas', 'AutoGPT', 'agent', 'Autonomous AI agent powered by GPT-4'],
  ['geekan', 'MetaGPT', 'agent', 'Multi-agent framework — assign different roles to GPTs'],
  ['yoheinakajima', 'BabyAGI', 'agent', 'Task-driven autonomous agent'],
  ['microsoft', 'AutoGen', 'framework', 'Framework for building multi-agent conversational AI'],
  ['openai', 'OpenAI', 'platform', 'Creator of GPT, DALL-E, and the Assistants API'],
  ['anthropics', 'Anthropic', 'platform', 'AI safety company building Claude'],
  ['google-deepmind', 'DeepMind', 'platform', 'AI research lab by Google'],

  // Coding Agents
  ['princeton-nlp', 'SWE-agent', 'agent', 'Autonomous software engineering agent'],
  ['OpenDevin', 'OpenDevin', 'agent', 'Open-source autonomous software engineer'],
  ['stitionai', 'Devika', 'agent', 'AI software engineer — understand, plan, write code'],
  ['All-Hands-AI', 'OpenHands', 'agent', 'Platform for software development agents'],
  ['codestoryai', 'Aide', 'agent', 'AI-native IDE with proactive agent capabilities'],
  ['block', 'goose', 'agent', 'Developer agent that automates engineering tasks'],

  // Browser & Web Agents
  ['browser-use', 'browser-use', 'agent', 'Make websites accessible for AI agents'],
  ['AbanteAI', 'mentat', 'agent', 'AI coding assistant that coordinates edits across files'],
  ['lavague-ai', 'LaVague', 'agent', 'Large Action Model framework for web automation'],
  ['nicepkg', 'gpt-runner', 'agent', 'Talk with files using AI and run scripts'],

  // Crypto / Web3 AI Agents
  ['elizaOS', 'ElizaOS', 'agent', 'Autonomous AI agent operating system for Web3'],
  ['goat-sdk', 'GOAT', 'framework', 'AI agent framework for crypto and DeFi'],
  ['ai16z', 'ai16z', 'agent', 'AI-powered DAO and venture fund'],
  ['virtuals-protocol', 'Virtuals', 'platform', 'Co-own AI agents on-chain'],
  ['fetchai', 'Fetch.ai', 'platform', 'Autonomous AI agent economy'],
  ['griffain', 'Griffain', 'agent', 'AI agent for Solana DeFi'],
  ['sendaifun', 'SendAI', 'agent', 'AI agent toolkit for Solana'],
  ['jup-ag', 'Jupiter', 'protocol', 'Solana liquidity aggregator with agent integrations'],
  ['orca-so', 'Orca', 'protocol', 'Solana DEX with concentrated liquidity'],
  ['tensor-hq', 'Tensor', 'protocol', 'Solana NFT trading with AI tools'],

  // Research & Specialized Agents
  ['assafelovic', 'GPT Researcher', 'agent', 'Autonomous agent for comprehensive online research'],
  ['mnotgod', 'AgentGPT', 'agent', 'Assemble, configure, and deploy autonomous AI agents in browser'],
  ['reworkd', 'AgentGPT (Reworkd)', 'agent', 'Autonomous AI in the browser'],
  ['SamurAIGPT', 'Camel-AutoGPT', 'agent', 'Multi-agent role-playing for complex tasks'],
  ['TransformerOptimus', 'SuperAGI', 'framework', 'Autonomous AI agent framework'],
  ['MineDojo', 'Voyager', 'agent', 'LLM-powered embodied lifelong learning agent in Minecraft'],
  ['e2b-dev', 'E2B', 'platform', 'Cloud runtime for AI agents — secure code execution'],
  ['phidatahq', 'Phidata', 'framework', 'Build multi-modal agents with memory and knowledge'],
  ['composiohq', 'Composio', 'platform', 'Integration platform for AI agents — 200+ tools'],
  ['AgentOps-AI', 'AgentOps', 'platform', 'Observability and DevOps for AI agents'],

  // Multi-modal & Task Agents
  ['THUDM', 'CogAgent', 'agent', 'Visual language model for GUI agents'],
  ['OthersideAI', 'HyperWrite', 'agent', 'AI writing and task agent'],
  ['dendrite-systems', 'Dendrite', 'agent', 'Natural language web interaction agent'],
  ['huggingface', 'Hugging Face', 'platform', 'The AI community building the future'],
  ['modal-labs', 'Modal', 'platform', 'Serverless cloud for AI and ML'],
  ['replicate', 'Replicate', 'platform', 'Run ML models in the cloud'],
  ['vercel', 'Vercel AI SDK', 'framework', 'Build AI-powered applications with Next.js'],
  ['fixie-ai', 'Fixie', 'platform', 'Build natural language agents for any API'],
  ['letta-ai', 'Letta', 'framework', 'Framework for building stateful LLM agents'],
  ['mem0ai', 'Mem0', 'framework', 'Memory layer for AI applications'],
];

async function fetchGitHub(path) {
  const headers = { 'User-Agent': 'AgentFolio-BulkSeed/1.0', Accept: 'application/vnd.github.v3+json' };
  const token = process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  
  const res = await fetch(`${GITHUB_API}${path}`, { headers, signal: AbortSignal.timeout(10000) });
  if (res.status === 404) return null;
  if (res.status === 403 || res.status === 429) {
    const reset = res.headers.get('x-ratelimit-reset');
    const waitSec = reset ? Math.max(0, parseInt(reset) - Math.floor(Date.now() / 1000)) : 60;
    console.log(`⏳ Rate limited. Waiting ${waitSec}s...`);
    await sleep(waitSec * 1000 + 1000);
    return fetchGitHub(path); // retry
  }
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${res.statusText}`);
  return res.json();
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function extractLanguages(repos) {
  const langCount = {};
  for (const repo of (repos || [])) {
    if (repo.language) langCount[repo.language] = (langCount[repo.language] || 0) + (repo.stargazers_count || 1);
  }
  return Object.entries(langCount).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([l]) => l);
}

function extractTopRepos(repos, limit = 3) {
  return (repos || [])
    .filter(r => !r.fork && !r.archived)
    .sort((a, b) => (b.stargazers_count || 0) - (a.stargazers_count || 0))
    .slice(0, limit)
    .map(r => ({ name: r.name, stars: r.stargazers_count || 0, language: r.language || '', url: r.html_url }));
}

async function seedAgent(db, ghUsername, displayName, category, fallbackDesc) {
  const agentId = `agent_${displayName.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
  
  // Check if already exists
  const existing = db.prepare('SELECT id FROM profiles WHERE id = ? OR LOWER(name) = LOWER(?)').get(agentId, displayName);
  if (existing) {
    console.log(`  ⏭️  ${displayName} already exists (${existing.id})`);
    return 'skipped';
  }

  // Fetch from GitHub
  let ghProfile, repos;
  try {
    ghProfile = await fetchGitHub(`/users/${encodeURIComponent(ghUsername)}`);
    if (!ghProfile) {
      console.log(`  ❌ ${ghUsername} not found on GitHub`);
      return 'not_found';
    }
    repos = await fetchGitHub(`/users/${encodeURIComponent(ghUsername)}/repos?sort=stars&per_page=20`);
  } catch (e) {
    console.log(`  ❌ ${ghUsername} fetch failed: ${e.message}`);
    return 'error';
  }

  const languages = extractLanguages(repos);
  const topRepos = extractTopRepos(repos);
  const totalStars = (repos || []).reduce((s, r) => s + (r.stargazers_count || 0), 0);

  const name = displayName;
  const handle = ghProfile.login;
  const bio = ghProfile.bio || fallbackDesc || `${name} — ${category}`;
  const description = fallbackDesc || ghProfile.bio || `${name} — AI ${category}`;
  const avatar = ghProfile.avatar_url || '';
  const website = ghProfile.blog || '';
  const twitter = ghProfile.twitter_username || '';

  const links = JSON.stringify({
    github: `https://github.com/${ghProfile.login}`,
    ...(website ? { website } : {}),
    ...(twitter ? { x: `https://x.com/${twitter}` } : {}),
  });

  const skills = JSON.stringify(languages.slice(0, 5).map(l => ({ name: l })));
  const tags = JSON.stringify([category, ...languages.slice(0, 3)]);
  const capabilities = JSON.stringify(topRepos.map(r => r.name));
  
  const metadata = JSON.stringify({
    unclaimed: true,
    isPlaceholder: true,
    importedFrom: 'github-bulk-seed',
    githubUsername: ghProfile.login,
    githubType: ghProfile.type,
    githubFollowers: ghProfile.followers || 0,
    githubStars: totalStars,
    githubRepos: ghProfile.public_repos || 0,
    category,
    topRepos,
    importedAt: new Date().toISOString(),
  });

  const apiKey = `af_${crypto.randomBytes(16).toString('hex')}`;

  try {
    db.prepare(`
      INSERT INTO profiles (id, name, handle, bio, description, avatar, framework, skills, tags, capabilities, links, metadata, api_key, wallet, wallets, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', '{}', datetime('now'), datetime('now'))
    `).run(agentId, name, handle, bio, description, avatar, languages[0] || '', skills, tags, capabilities, links, metadata, apiKey);
    
    console.log(`  ✅ ${name} (${agentId}) — ${totalStars}⭐ ${ghProfile.public_repos} repos [${category}]`);
    return 'created';
  } catch (e) {
    console.log(`  ❌ ${name} insert failed: ${e.message}`);
    return 'error';
  }
}

async function main() {
  console.log('🌱 AgentFolio Bulk Seed — Importing external agent profiles\n');
  
  const db = new Database(DB_PATH);
  
  // Get current count
  const beforeCount = db.prepare('SELECT COUNT(*) as c FROM profiles').get().c;
  console.log(`📊 Current profiles: ${beforeCount}\n`);

  const results = { created: 0, skipped: 0, not_found: 0, error: 0 };

  for (const [ghUser, name, category, desc] of AGENTS) {
    const result = await seedAgent(db, ghUser, name, category, desc);
    results[result] = (results[result] || 0) + 1;
    await sleep(DELAY_MS);
  }

  const afterCount = db.prepare('SELECT COUNT(*) as c FROM profiles').get().c;
  
  console.log('\n' + '═'.repeat(50));
  console.log(`📊 Results:`);
  console.log(`   Created: ${results.created}`);
  console.log(`   Skipped (existing): ${results.skipped}`);
  console.log(`   Not found: ${results.not_found}`);
  console.log(`   Errors: ${results.error}`);
  console.log(`   Total profiles: ${beforeCount} → ${afterCount}`);
  console.log('═'.repeat(50));

  db.close();
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
