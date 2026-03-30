#!/usr/bin/env node
/**
 * Bulk Seed Batch 2 — More AI agent profiles from GitHub
 * Targets awesome-ai-agents, HuggingFace ecosystem, Solana agents, and more.
 */

const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');

const DB_PATH = path.join(__dirname, '..', 'data', 'agentfolio.db');
const GITHUB_API = 'https://api.github.com';
const DELAY_MS = 2000;

const AGENTS = [
  // AI Coding & Dev Tools
  ['continuedev', 'Continue', 'agent', 'Open-source AI code assistant for VS Code and JetBrains'],
  ['TabbyML', 'Tabby', 'agent', 'Self-hosted AI coding assistant'],
  ['sourcegraph', 'Cody', 'agent', 'AI coding assistant by Sourcegraph'],
  ['Codium-ai', 'CodiumAI', 'agent', 'AI test generation and code integrity'],
  ['sweepai', 'Sweep', 'agent', 'AI-powered junior developer that handles GitHub issues'],
  ['aorwall', 'Moatless Tools', 'agent', 'Tools for autonomous coding agents'],
  ['paul-gauthier', 'Aider', 'agent', 'AI pair programming in your terminal'],
  ['OpenInterpreter', 'Open Interpreter', 'agent', 'Natural language interface for code execution'],
  ['plandex-ai', 'Plandex', 'agent', 'AI coding engine for complex tasks'],
  ['potpie-ai', 'Potpie', 'agent', 'AI agents for your codebase'],

  // AI Agent Platforms & Orchestration
  ['n8n-io', 'n8n', 'platform', 'Fair-code workflow automation platform'],
  ['langflow-ai', 'Langflow', 'platform', 'Visual framework for building multi-agent AI applications'],
  ['FlowiseAI', 'Flowise', 'platform', 'Drag & drop UI to build LLM flows'],
  ['run-llama', 'LlamaHub', 'platform', 'Community-driven LLM data loaders and tools'],
  ['chatchat-space', 'Langchain-Chatchat', 'agent', 'Local knowledge-based LLM chat application'],
  ['embedchain', 'Embedchain', 'framework', 'Framework to create LLM-powered bots over any dataset'],
  ['BerriAI', 'LiteLLM', 'framework', 'Call 100+ LLM APIs in OpenAI format'],
  ['instructor-ai', 'Instructor', 'framework', 'Structured outputs from LLMs'],
  ['outlines-dev', 'Outlines', 'framework', 'Structured text generation with LLMs'],
  ['guidance-ai', 'Guidance', 'framework', 'Control modern language models by Microsoft'],

  // Web3 / Crypto AI Agents
  ['solana-developers', 'Solana Developers', 'protocol', 'Official Solana developer tools and examples'],
  ['coral-xyz', 'Coral (Anchor)', 'framework', 'Framework for Solana program development'],
  ['metaplex-foundation', 'Metaplex', 'protocol', 'NFT standard on Solana'],
  ['helium', 'Helium', 'protocol', 'Decentralized wireless network on Solana'],
  ['drift-labs', 'Drift', 'protocol', 'Solana perpetual futures DEX'],
  ['marinade-finance', 'Marinade', 'protocol', 'Liquid staking on Solana'],
  ['squads-protocol', 'Squads', 'protocol', 'Smart account standard for Solana'],
  ['switchboard-xyz', 'Switchboard', 'protocol', 'Oracle network for Solana'],
  ['clockwork-xyz', 'Clockwork', 'protocol', 'Automation engine for Solana'],

  // Research & Multi-modal Agents
  ['stanford-oval', 'Genie', 'agent', 'Stanford open virtual assistant'],
  ['microsoft', 'JARVIS', 'agent', 'HuggingGPT — connecting AI models with ChatGPT'],
  ['camel-ai', 'CAMEL', 'framework', 'Communicative Agents for Mind Exploration of Large Language Model Society'],
  ['homanp', 'Superagent', 'platform', 'Build, deploy, and manage AI agents'],
  ['Mintplex-Labs', 'AnythingLLM', 'platform', 'All-in-one desktop AI application with RAG'],
  ['QuivrHQ', 'Quivr', 'platform', 'Your second brain powered by generative AI'],
  ['khoj-ai', 'Khoj', 'agent', 'Self-hostable AI personal assistant'],
  ['danny-avila', 'LibreChat', 'platform', 'Enhanced ChatGPT clone with multi-model support'],
  ['lobehub', 'LobeChat', 'platform', 'Open-source high-performance chatbot framework'],
  ['ollama', 'Ollama', 'platform', 'Get up and running with large language models locally'],
  ['open-webui', 'Open WebUI', 'platform', 'User-friendly AI interface'],
  ['oobabooga', 'Text Generation WebUI', 'platform', 'Gradio web UI for large language models'],
  ['mlc-ai', 'MLC LLM', 'platform', 'Enable everyone to develop and run LLMs natively'],
];

async function fetchGitHub(ghPath) {
  const headers = { 'User-Agent': 'AgentFolio-Seed/2.0', Accept: 'application/vnd.github.v3+json' };
  const token = process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  
  const res = await fetch(`${GITHUB_API}${ghPath}`, { headers, signal: AbortSignal.timeout(10000) });
  if (res.status === 404) return null;
  if (res.status === 403 || res.status === 429) {
    const reset = res.headers.get('x-ratelimit-reset');
    const waitSec = reset ? Math.max(0, parseInt(reset) - Math.floor(Date.now() / 1000)) : 60;
    console.log(`⏳ Rate limited. Waiting ${waitSec}s...`);
    await new Promise(r => setTimeout(r, waitSec * 1000 + 1000));
    return fetchGitHub(ghPath);
  }
  if (!res.ok) throw new Error(`GitHub ${res.status}`);
  return res.json();
}

function extractLanguages(repos) {
  const lc = {};
  for (const r of (repos || [])) { if (r.language) lc[r.language] = (lc[r.language] || 0) + (r.stargazers_count || 1); }
  return Object.entries(lc).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([l]) => l);
}

function extractTopRepos(repos, limit = 3) {
  return (repos || []).filter(r => !r.fork && !r.archived)
    .sort((a, b) => (b.stargazers_count || 0) - (a.stargazers_count || 0))
    .slice(0, limit).map(r => ({ name: r.name, stars: r.stargazers_count || 0, language: r.language || '', url: r.html_url }));
}

async function seedAgent(db, ghUsername, displayName, category, fallbackDesc) {
  const agentId = `agent_${displayName.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
  const existing = db.prepare('SELECT id FROM profiles WHERE id = ? OR LOWER(name) = LOWER(?)').get(agentId, displayName);
  if (existing) { console.log(`  ⏭️  ${displayName} exists`); return 'skipped'; }

  let ghProfile, repos;
  try {
    ghProfile = await fetchGitHub(`/users/${encodeURIComponent(ghUsername)}`);
    if (!ghProfile) { console.log(`  ❌ ${ghUsername} not found`); return 'not_found'; }
    repos = await fetchGitHub(`/users/${encodeURIComponent(ghUsername)}/repos?sort=stars&per_page=20`);
  } catch (e) { console.log(`  ❌ ${ghUsername}: ${e.message}`); return 'error'; }

  const languages = extractLanguages(repos);
  const topRepos = extractTopRepos(repos);
  const totalStars = (repos || []).reduce((s, r) => s + (r.stargazers_count || 0), 0);
  const bio = ghProfile.bio || fallbackDesc;
  const links = JSON.stringify({
    github: `https://github.com/${ghProfile.login}`,
    ...(ghProfile.blog ? { website: ghProfile.blog } : {}),
    ...(ghProfile.twitter_username ? { x: `https://x.com/${ghProfile.twitter_username}` } : {}),
  });
  const metadata = JSON.stringify({
    unclaimed: true, isPlaceholder: true, importedFrom: 'github-bulk-seed',
    githubUsername: ghProfile.login, githubType: ghProfile.type,
    githubFollowers: ghProfile.followers || 0, githubStars: totalStars,
    githubRepos: ghProfile.public_repos || 0, category, topRepos,
    importedAt: new Date().toISOString(),
  });
  const apiKey = `af_${crypto.randomBytes(16).toString('hex')}`;

  try {
    db.prepare(`INSERT INTO profiles (id, name, handle, bio, description, avatar, framework, skills, tags, capabilities, links, metadata, api_key, wallet, wallets, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', '{}', datetime('now'), datetime('now'))`)
      .run(agentId, displayName, ghProfile.login, bio, fallbackDesc, ghProfile.avatar_url || '', languages[0] || '',
        JSON.stringify(languages.slice(0, 5).map(l => ({ name: l }))),
        JSON.stringify([category, ...languages.slice(0, 3)]),
        JSON.stringify(topRepos.map(r => r.name)), links, metadata, apiKey);
    console.log(`  ✅ ${displayName} (${agentId}) — ${totalStars}⭐ [${category}]`);
    return 'created';
  } catch (e) { console.log(`  ❌ ${displayName}: ${e.message}`); return 'error'; }
}

async function main() {
  console.log('🌱 Batch 2 — Seeding more agent profiles\n');
  const db = new Database(DB_PATH);
  const before = db.prepare('SELECT COUNT(*) as c FROM profiles').get().c;
  console.log(`📊 Current: ${before}\n`);
  const results = { created: 0, skipped: 0, not_found: 0, error: 0 };
  for (const [gh, name, cat, desc] of AGENTS) {
    const r = await seedAgent(db, gh, name, cat, desc);
    results[r] = (results[r] || 0) + 1;
    await new Promise(r => setTimeout(r, DELAY_MS));
  }
  const after = db.prepare('SELECT COUNT(*) as c FROM profiles').get().c;
  console.log(`\n${'═'.repeat(50)}`);
  console.log(`Created: ${results.created} | Skipped: ${results.skipped} | Not found: ${results.not_found} | Errors: ${results.error}`);
  console.log(`Total: ${before} → ${after}`);
  db.close();
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
