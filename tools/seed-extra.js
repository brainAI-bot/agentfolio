#!/usr/bin/env node
/**
 * Supplementary seed — adds more AI agent profiles to reach 100+
 * Uses the same pattern as bulk-seed.js
 */
const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');

const DB_PATH = path.join(__dirname, '..', 'data', 'agentfolio.db');
const GITHUB_API = 'https://api.github.com';
const DELAY_MS = 1500;

const AGENTS = [
  // AI coding agents & tools
  ['continuedev', 'Continue', 'agent', 'Open-source AI code assistant for VS Code and JetBrains'],
  ['TabbyML', 'Tabby', 'agent', 'Self-hosted AI coding assistant'],
  ['sourcegraph', 'Cody', 'agent', 'AI coding assistant by Sourcegraph'],
  ['cohere-ai', 'Cohere', 'platform', 'Enterprise AI with Command, Embed, and Rerank models'],
  ['mistralai', 'Mistral AI', 'platform', 'Open and portable generative AI for developers'],
  ['ollama', 'Ollama', 'platform', 'Get up and running with large language models locally'],
  ['ggerganov', 'llama.cpp', 'framework', 'LLM inference in C/C++ — runs models on consumer hardware'],
  ['mlc-ai', 'MLC LLM', 'framework', 'Universal LLM deployment on any hardware platform'],
  
  // More AI agent frameworks
  ['BerriAI', 'LiteLLM', 'framework', 'Call 100+ LLM APIs using the OpenAI format'],
  ['vllm-project', 'vLLM', 'framework', 'High-throughput and memory-efficient LLM serving'],
  ['guidance-ai', 'Guidance', 'framework', 'Control language models with structured generation'],
  ['stanfordnlp', 'DSPy', 'framework', 'Programming—not prompting—LLMs'],
  ['livekit', 'LiveKit Agents', 'framework', 'Build real-time multimodal AI agents'],
  
  // Web3 / DeFi agents  
  ['dialectlabs', 'Dialect', 'protocol', 'Smart messaging protocol for Solana'],
  ['helium', 'Helium', 'protocol', 'Decentralized wireless infrastructure'],
  ['marinade-finance', 'Marinade', 'protocol', 'Solana liquid staking'],
  ['solana-mobile', 'Solana Mobile', 'platform', 'Mobile-first Solana development'],
  
  // Data & Research agents
  ['deepset-ai', 'Haystack', 'framework', 'LLM orchestration framework for building AI applications'],
  ['chroma-core', 'Chroma', 'platform', 'AI-native open-source embedding database'],
  ['weaviate', 'Weaviate', 'platform', 'AI-native vector database'],
  ['qdrant', 'Qdrant', 'platform', 'High-performance vector search engine'],
  ['pinecone-io', 'Pinecone', 'platform', 'Vector database for AI applications'],
];

async function fetchGitHub(ghPath) {
  const headers = { 'User-Agent': 'AgentFolio-Seed/1.0', Accept: 'application/vnd.github.v3+json' };
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

async function main() {
  console.log('🌱 Extra seed batch\n');
  const db = new Database(DB_PATH);
  const before = db.prepare('SELECT COUNT(*) as c FROM profiles').get().c;
  console.log(`Current: ${before} profiles\n`);
  
  let created = 0, skipped = 0, errors = 0;
  
  for (const [ghUser, name, category, desc] of AGENTS) {
    const agentId = `agent_${name.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
    const existing = db.prepare('SELECT id FROM profiles WHERE id = ? OR LOWER(name) = LOWER(?)').get(agentId, name);
    if (existing) { console.log(`  ⏭️  ${name} exists`); skipped++; continue; }
    
    try {
      const profile = await fetchGitHub(`/users/${encodeURIComponent(ghUser)}`);
      if (!profile) { console.log(`  ❌ ${ghUser} not found`); errors++; continue; }
      const repos = await fetchGitHub(`/users/${encodeURIComponent(ghUser)}/repos?sort=stars&per_page=20`);
      const languages = extractLanguages(repos);
      const totalStars = (repos || []).reduce((s, r) => s + (r.stargazers_count || 0), 0);
      
      const apiKey = `af_${crypto.randomBytes(16).toString('hex')}`;
      const links = JSON.stringify({ github: `https://github.com/${profile.login}`, ...(profile.blog ? { website: profile.blog } : {}), ...(profile.twitter_username ? { x: `https://x.com/${profile.twitter_username}` } : {}) });
      const skills = JSON.stringify(languages.slice(0, 5).map(l => ({ name: l })));
      const tags = JSON.stringify([category, ...languages.slice(0, 3)]);
      const metadata = JSON.stringify({ unclaimed: true, isPlaceholder: true, importedFrom: 'github-bulk-seed', githubUsername: profile.login, githubStars: totalStars, githubRepos: profile.public_repos || 0, category, importedAt: new Date().toISOString() });
      
      db.prepare(`INSERT INTO profiles (id, name, handle, bio, description, avatar, framework, skills, tags, capabilities, links, metadata, api_key, wallet, wallets, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, '', '{}', datetime('now'), datetime('now'))`)
        .run(agentId, name, profile.login, profile.bio || desc, desc, profile.avatar_url || '', languages[0] || '', skills, tags, links, metadata, apiKey);
      
      console.log(`  ✅ ${name} (${agentId}) — ${totalStars}⭐`);
      created++;
    } catch (e) { console.log(`  ❌ ${name}: ${e.message}`); errors++; }
    await new Promise(r => setTimeout(r, DELAY_MS));
  }
  
  const after = db.prepare('SELECT COUNT(*) as c FROM profiles').get().c;
  console.log(`\n📊 Created: ${created}, Skipped: ${skipped}, Errors: ${errors}`);
  console.log(`📊 Profiles: ${before} → ${after}`);
  db.close();
}

main().catch(e => { console.error(e); process.exit(1); });
