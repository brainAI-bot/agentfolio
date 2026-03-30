#!/usr/bin/env node
/**
 * Bulk Seed Batch 3 — More AI agent/framework projects
 * Focus: coding agents, research agents, multimodal, infra, newer projects
 */

const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', 'data', 'agentfolio.db');
const PROFILES_DIR = path.join(__dirname, '..', 'data', 'profiles');
const GITHUB_API = 'https://api.github.com';
const DELAY_MS = 1500;

const AGENTS = [
  // Coding Agents & IDEs
  ['continuedev', 'Continue', 'agent', 'Open-source AI code assistant for VS Code and JetBrains'],
  ['TabbyML', 'Tabby', 'agent', 'Self-hosted AI coding assistant'],
  ['sourcegraph', 'Cody', 'agent', 'AI coding assistant by Sourcegraph'],
  ['cline', 'Cline', 'agent', 'Autonomous coding agent in your IDE'],
  ['aider-ai', 'Aider', 'agent', 'AI pair programming in your terminal'],
  ['smol-ai', 'smol developer', 'agent', 'Personal AI junior developer'],
  ['paul-gauthier', 'Aider (paul-gauthier)', 'agent', 'AI pair programming with GPT-4 and Claude'],
  ['KillianLucas', 'Open Interpreter', 'agent', 'Natural language interface to your computer'],
  ['Pythagora-io', 'GPT Pilot', 'agent', 'AI developer that writes entire apps'],
  ['dot-agent', 'dot', 'agent', 'AI agent that knows your codebase'],
  
  // Research & Knowledge Agents
  ['stanford-oval', 'Storm', 'agent', 'AI agent for writing Wikipedia-like articles from scratch'],
  ['binary-husky', 'GPT Academic', 'agent', 'GPT for academic research — paper analysis, translation'],
  ['InternLM', 'InternLM', 'framework', 'Open-source LLM for practical scenarios'],
  ['QuivrHQ', 'Quivr (RAG)', 'agent', 'Personal AI second brain — RAG-powered'],
  ['lobehub', 'LobeChat (Hub)', 'platform', 'Open-source high-performance chatbot framework'],
  
  // Multi-agent & Orchestration
  ['ag2ai', 'AG2', 'framework', 'Multi-agent framework (AutoGen successor)'],
  ['camel-ai', 'CAMEL (org)', 'framework', 'Communicative Agents for Mind Exploration'],
  ['TaskingAI', 'TaskingAI', 'platform', 'BaaS platform for AI-native apps'],
  ['OpenBMB', 'ChatDev', 'agent', 'Virtual software company powered by LLM agents'],
  ['aigc-apps', 'EasyAnimate', 'agent', 'AI video generation pipeline'],
  
  // Web3 / Crypto AI
  ['dialectlabs', 'Dialect', 'platform', 'Smart messaging protocol for Solana'],
  ['helium', 'Helium', 'protocol', 'Decentralized IoT network'],
  ['metaplex-foundation', 'Metaplex', 'protocol', 'NFT standard and tools on Solana'],
  ['solana-developers', 'Solana Developers', 'platform', 'Official Solana developer resources'],
  ['coral-xyz', 'Coral (Anchor)', 'framework', 'Anchor framework for Solana programs'],
  ['MagicBlockLabs', 'MagicBlock', 'platform', 'Ephemeral rollups on Solana'],
  ['drift-labs', 'Drift', 'protocol', 'Decentralized perpetual exchange on Solana'],
  ['marinade-finance', 'Marinade Finance', 'protocol', 'Liquid staking on Solana'],
  ['GenesysGo', 'Shadow', 'platform', 'Decentralized storage and compute on Solana'],
  ['clockwork-xyz', 'Clockwork (org)', 'platform', 'Automation engine for Solana'],
  
  // AI Infra & Tools
  ['vllm-project', 'vLLM', 'framework', 'High-throughput LLM serving engine'],
  ['ggerganov', 'llama.cpp', 'framework', 'LLM inference in C/C++ — efficient local deployment'],
  ['ollama', 'Ollama (org)', 'platform', 'Run LLMs locally — simple and fast'],
  ['mlc-ai', 'MLC LLM (org)', 'framework', 'Machine learning compilation for LLMs'],
  ['NVIDIA', 'NVIDIA AI', 'platform', 'GPU computing and AI platform'],
  ['ray-project', 'Ray', 'framework', 'Distributed compute framework for AI'],
  ['wandb', 'Weights & Biases', 'platform', 'MLOps platform for experiment tracking'],
  ['Lightning-AI', 'Lightning AI', 'framework', 'Build and deploy AI products at scale'],
  ['deepset-ai', 'Haystack (org)', 'framework', 'LLM orchestration framework for RAG pipelines'],
  ['chroma-core', 'Chroma (org)', 'platform', 'AI-native open-source embedding database'],
  
  // Voice & Multimodal
  ['livekit', 'LiveKit', 'platform', 'Real-time AI voice and video agents'],
  ['pipecat-ai', 'Pipecat', 'framework', 'Framework for building voice and multimodal AI agents'],
  ['fixie-ai', 'Ultravox', 'agent', 'Multimodal AI speech agent'],
  ['suno-ai', 'Bark', 'agent', 'Text-to-speech AI model — realistic audio generation'],
  ['coqui-ai', 'Coqui TTS', 'agent', 'Deep learning toolkit for text-to-speech'],
  
  // Autonomous Agents
  ['MineDojo', 'Voyager (org)', 'agent', 'LLM-powered lifelong learning agent'],
  ['dbpunk-labs', 'octogen', 'agent', 'Open-source code interpreter agent'],
  ['joonspk-research', 'Generative Agents', 'agent', 'Stanford generative agents — believable simulacra'],
  ['xlang-ai', 'OpenAgents', 'agent', 'Open platform for using and hosting language agents'],
  ['ShishirPatil', 'Gorilla', 'agent', 'LLM connected to massive APIs — tool-calling agent'],
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
    console.log(`  ⏳ Rate limited. Waiting ${waitSec}s...`);
    await new Promise(r => setTimeout(r, waitSec * 1000 + 1000));
    return fetchGitHub(ghPath);
  }
  if (!res.ok) return null;
  return res.json();
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log('🌱 Batch 3 — Seeding more AI agent profiles\n');
  const db = new Database(DB_PATH);
  const before = db.prepare('SELECT COUNT(*) as c FROM profiles').get().c;
  let created = 0, skipped = 0, errors = 0;

  for (const [ghUser, name, category, desc] of AGENTS) {
    const agentId = `agent_${name.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
    const existing = db.prepare('SELECT id FROM profiles WHERE id = ? OR LOWER(name) = LOWER(?)').get(agentId, name);
    if (existing) { console.log(`  ⏭️  ${name} exists`); skipped++; await sleep(100); continue; }

    const profile = await fetchGitHub(`/users/${encodeURIComponent(ghUser)}`);
    if (!profile) { console.log(`  ❌ ${ghUser} not found`); errors++; await sleep(DELAY_MS); continue; }
    
    const repos = await fetchGitHub(`/users/${encodeURIComponent(ghUser)}/repos?sort=stars&per_page=15`);
    const languages = {};
    for (const r of (repos || [])) { if (r.language) languages[r.language] = (languages[r.language] || 0) + (r.stargazers_count || 1); }
    const topLangs = Object.entries(languages).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([l]) => l);
    const totalStars = (repos || []).reduce((s, r) => s + (r.stargazers_count || 0), 0);
    const topRepos = (repos || []).filter(r => !r.fork).sort((a, b) => (b.stargazers_count || 0) - (a.stargazers_count || 0)).slice(0, 3);

    const links = JSON.stringify({
      github: `https://github.com/${profile.login}`,
      ...(profile.blog ? { website: profile.blog } : {}),
      ...(profile.twitter_username ? { x: `https://x.com/${profile.twitter_username}` } : {}),
    });
    const metadata = JSON.stringify({
      unclaimed: true, isPlaceholder: true, importedFrom: 'github-bulk-seed',
      githubUsername: profile.login, githubType: profile.type,
      githubFollowers: profile.followers || 0, githubStars: totalStars,
      githubRepos: profile.public_repos || 0, category,
      topRepos: topRepos.map(r => ({ name: r.name, stars: r.stargazers_count, url: r.html_url })),
      importedAt: new Date().toISOString(),
    });

    try {
      db.prepare(`INSERT INTO profiles (id, name, handle, bio, description, avatar, framework, skills, tags, capabilities, links, metadata, api_key, wallet, wallets, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', '{}', datetime('now'), datetime('now'))`)
        .run(agentId, name, profile.login, profile.bio || desc, desc, profile.avatar_url || '', topLangs[0] || '',
          JSON.stringify(topLangs.map(l => ({ name: l }))), JSON.stringify([category, ...topLangs.slice(0, 3)]),
          JSON.stringify(topRepos.map(r => r.name)), links, metadata, `af_${crypto.randomBytes(16).toString('hex')}`);
      
      // Also create JSON file
      const jsonPath = path.join(PROFILES_DIR, `${agentId}.json`);
      fs.writeFileSync(jsonPath, JSON.stringify({
        id: agentId, name, handle: profile.login, bio: profile.bio || desc, description: desc,
        avatar: profile.avatar_url || '', skills: topLangs.map(l => ({ name: l })),
        tags: [category, ...topLangs.slice(0, 3)], links: JSON.parse(links),
        unclaimed: true, metadata: JSON.parse(metadata), createdAt: new Date().toISOString(),
      }, null, 2));
      
      console.log(`  ✅ ${name} (${agentId}) — ${totalStars}⭐ [${category}]`);
      created++;
    } catch (e) { console.log(`  ❌ ${name}: ${e.message}`); errors++; }
    
    await sleep(DELAY_MS);
  }

  const after = db.prepare('SELECT COUNT(*) as c FROM profiles').get().c;
  db.close();
  console.log(`\n📊 Created: ${created} | Skipped: ${skipped} | Errors: ${errors}`);
  console.log(`📊 Profiles: ${before} → ${after}`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
