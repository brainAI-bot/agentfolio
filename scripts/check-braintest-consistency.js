#!/usr/bin/env node

const BASE = process.env.BASE_URL || 'https://agentfolio.bot';
const AGENT_ID = process.env.AGENT_ID || 'agent_braintest';
const SEARCH = process.env.SEARCH || 'brainTEST';

const WEIGHTS = {
  github: 50,
  solana: 30,
  x: 40,
  twitter: 40,
  satp: 20,
  domain: 20,
  ethereum: 20,
  agentmail: 15,
  moltbook: 15,
  hyperliquid: 15,
  polymarket: 10,
  discord: 10,
  telegram: 10,
  website: 10,
  mcp: 15,
  a2a: 15,
  review: 10,
};

function normalize(platform) {
  if (!platform) return null;
  if (platform === 'twitter') return 'x';
  return platform;
}

function setFrom(iterable) {
  return new Set([...iterable].filter(Boolean).map(normalize));
}

function sorted(arr) {
  return [...arr].sort();
}

function expect(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function getJson(path) {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}

(async () => {
  const [profile, trust, explorer, satpScore, satpExplorer] = await Promise.all([
    getJson(`/api/profile/${encodeURIComponent(AGENT_ID)}`),
    getJson(`/api/profile/${encodeURIComponent(AGENT_ID)}/trust-score`),
    getJson(`/api/explorer/${encodeURIComponent(AGENT_ID)}`),
    getJson(`/api/satp/score/${encodeURIComponent(AGENT_ID)}`),
    getJson(`/api/satp/explorer/agents?search=${encodeURIComponent(SEARCH)}&limit=5`),
  ]);

  const satpExplorerAgent = (satpExplorer.agents || []).find((a) => a.agentId === AGENT_ID);
  expect(!!satpExplorerAgent, `SATP explorer did not return ${AGENT_ID}`);

  const trustData = trust.data || trust;
  const satpScoreData = satpScore.data || satpScore;

  const profilePlatforms = setFrom(Object.entries(profile.verification_data || {})
    .filter(([, value]) => value && value.verified)
    .map(([platform]) => platform));
  const explorerPlatforms = setFrom((explorer.verifications || []).filter((v) => v && v.verified !== false).map((v) => v.platform));
  const satpExplorerPlatforms = setFrom((satpExplorerAgent.verifications || []).filter((v) => v && v.verified !== false).map((v) => v.platform));
  const breakdownPlatforms = setFrom(Object.keys(trustData.breakdown || {}));

  const recomputedExplorerScore = [...explorerPlatforms].reduce((sum, platform) => sum + (WEIGHTS[platform] || 0), 0);

  expect(profile.trustScore === trustData.reputationScore, `profile.trustScore=${profile.trustScore} != trust-score=${trustData.reputationScore}`);
  expect(profile.trustScore === explorer.trustScore, `profile.trustScore=${profile.trustScore} != explorer.trustScore=${explorer.trustScore}`);
  expect(profile.trustScore === satpExplorerAgent.trustScore, `profile.trustScore=${profile.trustScore} != satpExplorer.trustScore=${satpExplorerAgent.trustScore}`);
  expect(profile.trustScore === satpScoreData.score, `profile.trustScore=${profile.trustScore} != satp-score=${satpScoreData.score}`);
  expect(profile.trustScore === recomputedExplorerScore, `profile.trustScore=${profile.trustScore} != recomputedExplorerScore=${recomputedExplorerScore}`);

  expect(JSON.stringify(sorted(profilePlatforms)) === JSON.stringify(sorted(explorerPlatforms)), `profile platforms ${JSON.stringify(sorted(profilePlatforms))} != explorer platforms ${JSON.stringify(sorted(explorerPlatforms))}`);
  expect(JSON.stringify(sorted(explorerPlatforms)) === JSON.stringify(sorted(satpExplorerPlatforms)), `explorer platforms ${JSON.stringify(sorted(explorerPlatforms))} != satp explorer platforms ${JSON.stringify(sorted(satpExplorerPlatforms))}`);
  expect(JSON.stringify(sorted(explorerPlatforms)) === JSON.stringify(sorted(breakdownPlatforms)), `explorer platforms ${JSON.stringify(sorted(explorerPlatforms))} != breakdown platforms ${JSON.stringify(sorted(breakdownPlatforms))}`);

  console.log(JSON.stringify({
    ok: true,
    agentId: AGENT_ID,
    score: profile.trustScore,
    level: profile.verificationLevel,
    platforms: sorted(explorerPlatforms),
    breakdown: trustData.breakdown,
    recomputedExplorerScore,
    source: trustData.source,
  }, null, 2));
})().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
