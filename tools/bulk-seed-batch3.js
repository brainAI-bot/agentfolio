#!/usr/bin/env node
/**
 * Bulk Seed Batch 3 — More AI agent projects
 * Target: push from ~112 to 200+ profiles
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const DB_PATH = path.join(__dirname, '..', 'data', 'agentfolio.db');
const PROFILES_DIR = path.join(__dirname, '..', 'data', 'profiles');
const GITHUB_API = 'https://api.github.com';
const DELAY_MS = 1500;

const AGENTS = [
  // HuggingFace ecosystem
  ['huggingface', 'Smolagents', 'agent', 'HuggingFace agent framework for building tool-using AI'],
  ['gradio-app', 'Gradio', 'framework', 'Build ML-powered web apps in Python'],
  
  // More coding agents
  ['cline', 'Cline', 'agent', 'Autonomous coding agent right in your IDE'],
  ['continuedev', 'Continue', 'agent', 'Open-source AI code assistant for VS Code and JetBrains'],
  ['TabbyML', 'Tabby', 'agent', 'Self-hosted AI coding assistant'],
  ['sourcegraph', 'Cody', 'agent', 'AI coding assistant by Sourcegraph'],
  ['cursor-ai', 'Cursor', 'agent', 'The AI-first code editor'],
  ['Pythagora-io', 'GPT Pilot', 'agent', 'AI developer that writes scalable apps from scratch'],
  ['paul-gauthier', 'Aider', 'agent', 'AI pair programming in your terminal'],
  ['smol-ai', 'smol developer', 'agent', 'Human-centric & coherent whole program synthesis'],
  
  // Multi-agent frameworks
  ['camel-ai', 'CAMEL', 'framework', 'Communicative agents for mind exploration of LLM society'],
  ['taskingai', 'TaskingAI', 'platform', 'Build, test, and deploy AI agent applications'],
  ['joaomdmoura', 'CrewAI Tools', 'framework', 'Tools for CrewAI agent framework'],
  ['modelscope', 'AgentScope', 'framework', 'Multi-agent platform by ModelScope'],
  
  // Crypto/Web3 AI
  ['autonome-labs', 'Autonome', 'platform', 'Deploy and manage AI agents on-chain'],
  ['ritual-net', 'Ritual', 'platform', 'Decentralized AI infrastructure'],
  ['bittensor', 'Bittensor', 'platform', 'Decentralized machine intelligence network'],
  ['autonolas', 'Olas', 'platform', 'Autonomous AI services on-chain'],
  ['masa-finance', 'Masa', 'platform', 'Decentralized AI data network'],
  ['MyShell-TTS', 'MyShell', 'platform', 'Build, share, and earn with AI agents'],
  ['alethea-ai', 'Alethea AI', 'platform', 'Intelligent NFTs and AI agent protocol'],
  ['rss3-network', 'RSS3', 'platform', 'Open information layer for AI agents'],
  ['KIP-Protocol', 'KIP Protocol', 'platform', 'Decentralized AI marketplace'],
  ['0xPlaygrounds', 'Rig', 'framework', 'Rust library for building LLM-powered applications'],
  ['arcxmoney', 'ARC', 'framework', 'AI agent framework for crypto'],
  
  // Research & specialized
  ['NVIDIA', 'NVIDIA AI', 'platform', 'AI computing and agent frameworks'],
  ['microsoft', 'Semantic Kernel', 'framework', 'AI orchestration SDK by Microsoft'],
  ['IBM', 'IBM watsonx', 'platform', 'Enterprise AI and automation platform'],
  ['salesforce', 'xGen Agent', 'agent', 'Salesforce open-source AI agent'],
  ['cohere-ai', 'Cohere', 'platform', 'Enterprise AI with advanced RAG and agents'],
  ['mistralai', 'Mistral AI', 'platform', 'Open and portable generative AI'],
  
  // Observability & infra
  ['langfuse', 'Langfuse', 'platform', 'Open-source LLM engineering and observability'],
  ['traceloop', 'OpenLLMetry', 'platform', 'Open-source observability for LLM applications'],
  ['helicone-ai', 'Helicone', 'platform', 'Open-source LLM observability platform'],
  ['lunary-ai', 'Lunary', 'platform', 'Production toolkit for LLM apps'],
  ['promptfoo', 'Promptfoo', 'platform', 'Test your LLM app before you ship'],
  
  // Task & workflow agents
  ['n8n-io', 'n8n', 'platform', 'Workflow automation with AI agent capabilities'],
  ['activepieces', 'Activepieces', 'platform', 'Open-source automation with AI agents'],
  ['windmill-labs', 'Windmill', 'platform', 'Developer platform for scripts, workflows, and UIs'],
  ['FlowiseAI', 'Flowise', 'platform', 'Drag & drop UI to build LLM agents'],
  ['logspace-ai', 'Langflow', 'platform', 'Visual framework for building multi-agent AI'],
  
  // Voice & multimodal
  ['pipecat-ai', 'Pipecat', 'framework', 'Open-source framework for voice and multimodal AI agents'],
  ['livekit', 'LiveKit Agents', 'framework', 'Build real-time AI agents with voice and video'],
  ['fixie-ai', 'Ultravox', 'agent', 'Open-source multimodal AI agent'],
  
  // Security & safety
  ['rebuff-ai', 'Rebuff', 'platform', 'AI prompt injection detector'],
  ['guardrails-ai', 'Guardrails', 'framework', 'Adding guardrails to large language models'],
  ['NVIDIA', 'NeMo Guardrails', 'framework', 'Programmable guardrails for LLM-based AI systems'],
  
  // Data & RAG
  ['chroma-core', 'Chroma', 'platform', 'AI-native open-source embedding database'],
  ['qdrant', 'Qdrant', 'platform', 'Vector similarity search engine for AI agents'],
  ['weaviate', 'Weaviate', 'platform', 'Open-source vector database for AI'],
  ['milvus-io', 'Milvus', 'platform', 'Open-source vector database for scalable similarity search'],
  ['pinecone-io', 'Pinecone', 'platform', 'Vector database for machine learning'],
  
  // Solana ecosystem
  ['clockwork-xyz', 'Clockwork', 'protocol', 'Automation infrastructure for Solana'],
  ['switchboard-xyz', 'Switchboard', 'protocol', 'Permissionless oracle protocol on Solana'],
  ['dialectlabs', 'Dialect', 'protocol', 'Smart messaging protocol for Solana'],
  ['squads-protocol', 'Squads', 'protocol', 'Smart account standard for Solana'],
  ['marinade-finance', 'Marinade', 'protocol', 'Liquid staking protocol on Solana'],
  
  // More AI agents
  ['deepset-ai', 'Haystack', 'framework', 'LLM orchestration framework for building RAG applications'],
  ['BerriAI', 'LiteLLM', 'framework', 'Call 100+ LLMs using the same format'],
  ['confident-ai', 'DeepEval', 'platform', 'Evaluation framework for LLMs'],
  ['embedchain', 'Embedchain', 'framework', 'Framework to create LLM-powered bots over any dataset'],
  ['superagent-ai', 'Superagent', 'platform', 'Build, deploy, and manage LLM-powered agents'],
  ['labelbox', 'Labelbox', 'platform', 'Training data platform for AI'],
  ['weights-biases', 'Weights & Biases', 'platform', 'ML experiment tracking and model management'],
  ['ray-project', 'Ray', 'framework', 'Unified framework for scaling AI applications'],
  ['mlflow', 'MLflow', 'platform', 'Open-source platform for ML lifecycle'],
  ['bentoml', 'BentoML', 'platform', 'Build, ship, and scale AI applications'],
  
  // Browser automation
  ['nicepkg', 'gpt-runner', 'agent', 'AI-powered file interaction and script runner'],
  ['AkariAsai', 'Self-RAG', 'agent', 'Self-reflective retrieval augmented generation'],
  ['kyegomez', 'Swarms', 'framework', 'Multi-agent orchestration framework'],
  ['llmware-ai', 'LLMWare', 'framework', 'Unified framework for building LLM-based applications'],
  ['run-llama', 'LlamaHub', 'framework', 'Community-driven LLM data loaders and tools'],
  
  // More Web3 AI
  ['ora-io', 'ORA', 'platform', 'Verifiable oracle protocol for AI on blockchain'],
  ['flock-io', 'FLock', 'platform', 'Federated learning on blockchain'],
  ['vanna-ai', 'Vanna', 'agent', 'AI SQL agent — chat with your database'],
  ['ai21labs', 'AI21 Labs', 'platform', 'Enterprise language models and AI agents'],
  ['Stability-AI', 'Stability AI', 'platform', 'Open generative AI for the people'],
  ['together-ai', 'Together AI', 'platform', 'Fast inference for open-source models'],
  ['perplexityai', 'Perplexity', 'platform', 'AI-powered answer engine'],
  ['anyscale', 'Anyscale', 'platform', 'Scalable AI compute platform'],
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
    console.log(`⏳ Rate limited. Waiting ${Math.min(waitSec, 120)}s...`);
    await new Promise(r => setTimeout(r, Math.min(waitSec, 120) * 1000 + 1000));
    return fetchGitHub(ghPath);
  }
  if (!res.ok) return null;
  return res.json();
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function seedAgent(db, ghUsername, displayName, category, desc) {
  const agentId = `agent_${displayName.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
  
  const existing = db.prepare('SELECT id FROM profiles WHERE id = ? OR LOWER(name) = LOWER(?)').get(agentId, displayName);
  if (existing) {
    console.log(`  ⏭️  ${displayName} exists`);
    return 'skipped';
  }

  const ghProfile = await fetchGitHub(`/users/${encodeURIComponent(ghUsername)}`);
  if (!ghProfile) {
    console.log(`  ❌ ${ghUsername} not found`);
    return 'not_found';
  }

  let repos = [];
  try {
    repos = await fetchGitHub(`/users/${encodeURIComponent(ghUsername)}/repos?sort=stars&per_page=10`) || [];
  } catch {}

  const languages = {};
  for (const r of repos) { if (r.language) languages[r.language] = (languages[r.language] || 0) + (r.stargazers_count || 1); }
  const topLangs = Object.entries(languages).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([l]) => l);
  const totalStars = repos.reduce((s, r) => s + (r.stargazers_count || 0), 0);

  const links = JSON.stringify({
    github: `https://github.com/${ghProfile.login}`,
    ...(ghProfile.blog ? { website: ghProfile.blog } : {}),
    ...(ghProfile.twitter_username ? { x: `https://x.com/${ghProfile.twitter_username}` } : {}),
  });

  const metadata = JSON.stringify({
    unclaimed: true, isPlaceholder: true,
    importedFrom: 'github-bulk-seed',
    githubUsername: ghProfile.login, githubType: ghProfile.type,
    githubFollowers: ghProfile.followers || 0, githubStars: totalStars,
    githubRepos: ghProfile.public_repos || 0, category,
    importedAt: new Date().toISOString(),
  });

  const apiKey = `af_${crypto.randomBytes(16).toString('hex')}`;

  try {
    db.prepare(`INSERT INTO profiles (id, name, handle, bio, description, avatar, framework, skills, tags, capabilities, links, metadata, api_key, wallet, wallets, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, '', '{}', datetime('now'), datetime('now'))
    `).run(agentId, displayName, ghProfile.login, ghProfile.bio || desc, desc, ghProfile.avatar_url || '',
      topLangs[0] || '', JSON.stringify(topLangs.map(l => ({ name: l }))), JSON.stringify([category, ...topLangs.slice(0, 2)]),
      links, metadata, apiKey);

    // Also create JSON file
    const profile = {
      id: agentId, name: displayName, handle: ghProfile.login,
      bio: ghProfile.bio || desc, description: desc,
      avatar: ghProfile.avatar_url || '', skills: topLangs.map(l => ({ name: l })),
      tags: [category, ...topLangs.slice(0, 2)], links: JSON.parse(links),
      wallets: {}, unclaimed: true, metadata: JSON.parse(metadata),
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(PROFILES_DIR, `${agentId}.json`), JSON.stringify(profile, null, 2));

    console.log(`  ✅ ${displayName} (${agentId}) — ${totalStars}⭐ [${category}]`);
    return 'created';
  } catch (e) {
    console.log(`  ❌ ${displayName} error: ${e.message}`);
    return 'error';
  }
}

async function main() {
  console.log('🌱 Batch 3 Seed\n');
  const db = new Database(DB_PATH);
  const before = db.prepare('SELECT COUNT(*) as c FROM profiles').get().c;
  console.log(`📊 Current: ${before}\n`);

  const results = { created: 0, skipped: 0, not_found: 0, error: 0 };
  for (const [gh, name, cat, desc] of AGENTS) {
    const r = await seedAgent(db, gh, name, cat, desc);
    results[r] = (results[r] || 0) + 1;
    await sleep(DELAY_MS);
  }

  const after = db.prepare('SELECT COUNT(*) as c FROM profiles').get().c;
  console.log(`\n${'═'.repeat(40)}`);
  console.log(`Created: ${results.created} | Skipped: ${results.skipped} | Not found: ${results.not_found} | Errors: ${results.error}`);
  console.log(`Total: ${before} → ${after}`);
  db.close();
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
