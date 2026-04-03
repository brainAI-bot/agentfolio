#!/usr/bin/env node
/**
 * Import agents from Universal Agent Registry (hol.org) into AgentFolio
 * Pulls top agents by registry, creates unclaimed profiles
 */

const https = require('https');
const fs = require('fs');

const API_BASE = 'https://hol.org/registry/api/v1';
const AGENTFOLIO_API = 'http://localhost:3333';
const ADMIN_KEY = 'bf-admin-2026';

// Registries to import from (skip moltbook - low quality)
const REGISTRIES = [
  { name: 'a2a-protocol', limit: 15 },
  { name: 'a2a-registry', limit: 10 },
  { name: 'virtuals-protocol', limit: 10 },
  { name: 'openrouter', limit: 5 },
  { name: 'near-ai', limit: 5 },
  { name: 'coinbase-x402-bazaar', limit: 5 },
];

function fetch(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : require('http');
    mod.get(url, { headers: { 'Accept': 'application/json' } }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(new Error(`JSON parse error: ${data.slice(0, 200)}`)); }
      });
    }).on('error', reject);
  });
}

function post(url, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : require('http');
    const data = JSON.stringify(body);
    const req = mod.request({
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Key': ADMIN_KEY, 'Content-Length': Buffer.byteLength(data) }
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(d) }); } catch { resolve({ status: res.statusCode, body: d }); } });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function sanitizeName(name) {
  if (!name) return null;
  // Remove emoji/special chars at start, trim
  return name.replace(/^[^\w]+/, '').trim().slice(0, 100);
}

function makeId(name, registry) {
  const clean = (name || 'unknown').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  return `agent_${clean}`;
}

async function searchRegistry(registry, limit) {
  const url = `${API_BASE}/search?registry=${encodeURIComponent(registry)}&limit=${limit}`;
  console.log(`  Fetching ${registry} (limit ${limit})...`);
  const data = await fetch(url);
  console.log(`  Found ${data.total} total, got ${(data.hits || []).length} hits`);
  return data.hits || [];
}

async function main() {
  console.log('=== Universal Agent Registry → AgentFolio Import ===\n');

  // Get existing profiles to avoid duplicates
  const existing = await fetch(`${AGENTFOLIO_API}/api/profiles`);
  const existingIds = new Set((existing.profiles || existing || []).map(p => p.id));
  const existingNames = new Set((existing.profiles || existing || []).map(p => (p.name || '').toLowerCase()));
  console.log(`Existing profiles: ${existingIds.size}\n`);

  const allAgents = [];

  for (const reg of REGISTRIES) {
    try {
      const hits = await searchRegistry(reg.name, reg.limit);
      for (const h of hits) {
        const name = sanitizeName(h.name);
        if (!name || name.length < 2) continue;
        if (existingNames.has(name.toLowerCase())) continue;

        const desc = (h.description || h.profile?.bio || '').slice(0, 500);
        if (!desc || desc.length < 10) continue; // Skip agents with no real description

        const meta = h.metadata || {};
        const github = meta.githubUrl || meta.github || '';
        const website = meta.agentDomain || meta.website || '';
        const capabilities = (meta.capabilityLabels || []).slice(0, 5);

        allAgents.push({
          name,
          id: makeId(name, reg.name),
          description: desc,
          registry: reg.name,
          uaid: h.uaid || '',
          github,
          website,
          capabilities,
          protocols: h.protocols || [],
        });
      }
    } catch (err) {
      console.error(`  Error fetching ${reg.name}: ${err.message}`);
    }
  }

  // Deduplicate by id
  const seen = new Set();
  const unique = allAgents.filter(a => {
    if (seen.has(a.id) || existingIds.has(a.id)) return false;
    seen.add(a.id);
    return true;
  });

  console.log(`\nFiltered to ${unique.length} new agents to import\n`);

  // Save to file for review
  const outPath = '/home/ubuntu/agentfolio/data/universal-registry-import.json';
  fs.writeFileSync(outPath, JSON.stringify(unique, null, 2));
  console.log(`Saved import data to ${outPath}`);

  // Register via API
  let imported = 0, failed = 0;
  for (const agent of unique) {
    try {
      const result = await post(`${AGENTFOLIO_API}/api/register`, {
        name: agent.name,
        bio: agent.description,
        skills: agent.capabilities.length > 0 ? agent.capabilities : ['ai-agent'],
        github: agent.github || undefined,
        website: agent.website || undefined,
      });
      
      if (result.status === 201 || result.status === 200) {
        imported++;
        console.log(`  ✅ ${agent.name} (${agent.id}) — ${agent.registry}`);
      } else if (result.status === 409) {
        console.log(`  ⏭️  ${agent.name} already exists`);
      } else {
        failed++;
        console.log(`  ❌ ${agent.name}: ${result.status} — ${JSON.stringify(result.body).slice(0, 100)}`);
      }
    } catch (err) {
      failed++;
      console.error(`  ❌ ${agent.name}: ${err.message}`);
    }
  }

  console.log(`\n=== Import Complete ===`);
  console.log(`Imported: ${imported}, Failed: ${failed}, Skipped (existing): ${allAgents.length - unique.length}`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
