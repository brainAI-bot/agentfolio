import fs from "fs";
import path from "path";
import { Connection, PublicKey } from "@solana/web3.js";
import type { Agent, Job } from "./types";
import { getAgentProfilePDA, AGENT_PROFILE_DISCRIMINATOR, SOLANA_RPC } from "./identity-registry";
import { fetchV3Scores, v3ToComputedScores } from "./v3-scores";
import { isCanonicalTrustProvider } from "./canonical-verifications";

// Cache on-chain lookups to avoid rate limiting during builds
const _onChainCache = new Map<string, boolean>();

function checkOnChainIdentitySync(walletAddress: string): boolean {
  // Check cache first
  if (_onChainCache.has(walletAddress)) return _onChainCache.get(walletAddress)!;
  // Default to false for sync - actual check happens via preload
  return false;
}

// Preload on-chain identities for all profiles with wallets
let _preloaded = false;
async function preloadOnChainIdentities(profiles: RawProfile[]) {
  if (_preloaded) return;
  _preloaded = true;
  try {
    const connection = new Connection(SOLANA_RPC, "confirmed");
    const walletsToCheck = profiles
      .filter(p => p.wallets?.solana)
      .map(p => ({ id: p.id, wallet: p.wallets.solana! }));
    
    // Batch check PDAs
    for (const { id, wallet } of walletsToCheck) {
      try {
        const ownerPk = new PublicKey(wallet);
        const [pda] = getAgentProfilePDA(ownerPk);
        const info = await connection.getAccountInfo(pda);
        const exists = !!(info && info.data && info.data.length > 8);
        _onChainCache.set(wallet, exists);
      } catch {
        _onChainCache.set(wallet, false);
      }
    }
  } catch {
    // RPC failure - gracefully degrade
  }
}

const PROFILES_DIR = "/home/ubuntu/agentfolio/data/profiles";
const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3333";
// Pre-warm V3 cache on module load (runs once at server startup)
if (typeof (globalThis as any).__v3WarmupDone === 'undefined') {
  (globalThis as any).__v3WarmupDone = true;
  // Read all profile IDs and batch-fetch V3 scores
  try {
    const _initFiles = require('fs').readdirSync(PROFILES_DIR).filter((f: string) => f.endsWith('.json'));
    const _initIds = _initFiles.map((f: string) => f.replace('.json', ''));
    fetchV3Scores(_initIds).then(scores => {
      (globalThis as any).__v3ScoresCache = scores;
      (globalThis as any).__v3ScoresCacheTime = Date.now();
      console.log(`[V3] Pre-warmed ${scores.size} on-chain scores at startup`);
    }).catch(() => {});
  } catch {}
}


interface RawProfile {
  id: string;
  name: string;
  handle: string;
  bio: string;
  avatar: string | null;
  links: Record<string, string | null>;
  wallets: Record<string, string | null>;
  skills: Array<{ name: string; category: string; verified: boolean; proofs?: any[] }>;
  portfolio?: any[];
  trackRecord?: any;
  verification: { tier: string; score: number; lastVerified?: string | null };
  verificationData?: Record<string, any>;
  moltbookStats?: any;
  endorsements?: Array<{ fromId: string; fromName: string; fromHandle: string; message?: string | null; skills?: string[]; createdAt: string }>;
  endorsementsGiven?: any[];
  stats?: { jobsCompleted: number; rating: number; reviewsReceived?: number };
  createdAt: string;
  updatedAt?: string;
  nftAvatar?: { chain: string; identifier: string; name: string | null; image: string | null; verifiedOnChain: boolean; verifiedAt: string } | null;
  activity?: any[];
  unclaimed?: boolean;
}

// Cache for performance (revalidates every 60 seconds)
let _agentsCache: Agent[] | null = null;
let _agentsCacheTime = 0;
const CACHE_TTL_MS = 5_000; // Reduced from 60s for faster profile availability // 60 seconds

function calcTrustScore(p: RawProfile): number {
  // CEO directive: V3 Genesis Records only. No Genesis = 0.
  return 0;
}

function calcTierFromScore(dbTier: string | undefined, score: number): number {  if (dbTier) {    const tierMap: Record<string, number> = { unverified: 0, bronze: 1, silver: 2, gold: 3, elite: 4 };    return tierMap[dbTier.toLowerCase()] || 0;  }  return calcTier(score);}
function calcTier(score: number): number {
  if (score >= 800) return 3;
  if (score >= 500) return 2;
  if (score >= 100) return 1;
  return 0;
}

function mapProfile(p: RawProfile): Agent {
  // V3 on-chain scores override local scoring
  const v3 = (globalThis as any).__v3ScoresCache?.get(p.id);
  const hasV3Evidence = !!v3;
  // Trust Score: SATP V3 on-chain records are the public source of truth.
  // Local/profile scores may be useful internally, but public reputation must
  // not present them as evidence-backed reputation.
  const trustScore = hasV3Evidence ? v3.reputationScore : 0;
  const vd = p.verificationData || {};
  const canonicalEntry = (platform: string) => {
    if (!isCanonicalTrustProvider(platform)) return null;
    if (platform === "solana") {
      const solanaEntries = [vd.solana, vd.solana_wallet].filter(Boolean);
      return solanaEntries.find((entry: any) => entry?.verified) || solanaEntries[0] || null;
    }
    return (vd as any)[platform] || null;
  };
  const isCanonicalVerified = (platform: string) => !!canonicalEntry(platform)?.verified;
  // Count local verifications for level fallback
  const localVerifCount = Object.values(vd).filter((v: any) => v && v.verified).length;
  const hasSATP = !!(vd.satp?.verified || (p.wallets?.solana));
  // Tier: SATP on-chain is source of truth. Local fallback for agents without genesis records.
  let tier: number;
  if (hasV3Evidence) {
    tier = v3.verificationLevel;
  } else {
    tier = 0;
  }
  const verificationLevel = hasV3Evidence ? v3.verificationLevel : 0;
  const verificationLevelName = hasV3Evidence
    ? (["Unclaimed","Registered","Verified","Established","Trusted","Sovereign"][v3.verificationLevel] || "Unclaimed")
    : (p.unclaimed ? "Unclaimed" : "Unverified");
  const verificationBadge = hasV3Evidence
    ? (["⚪","🟡","🔵","🟢","🟠","🟣"][v3.verificationLevel] || "⚪")
    : "○";

  return {
    id: p.id,
    name: p.name,
    handle: p.handle || "",
    bio: p.bio || "",
    avatar: p.avatar || "",
    nftAvatar: p.nftAvatar || null,
    trustScore,
    tier,
    trustEvidenceBacked: hasV3Evidence,
    trustEvidenceSource: hasV3Evidence ? "satp_v3_onchain" : "pending",
    skills: [...new Set((p.skills || []).map(s => typeof s === 'string' ? s : (s.name || '')).filter(Boolean))],
    verifications: {
      github: isCanonicalVerified("github") ? {
        username: canonicalEntry("github")?.handle || canonicalEntry("github")?.username || canonicalEntry("github")?.address || "",
        repos: canonicalEntry("github")?.repos || 0,
        stars: canonicalEntry("github")?.stars || 0,
        verified: true,
      } : undefined,
      solana: isCanonicalVerified("solana") ? {
        address: p.wallets?.solana || canonicalEntry("solana")?.address || "",
        txCount: canonicalEntry("solana")?.txCount || 0,
        balance: canonicalEntry("solana")?.balance || "0 SOL",
        verified: true,
      } : undefined,
      hyperliquid: (vd.hyperliquid?.verified || p.wallets?.hyperliquid) ? {
        address: p.wallets?.hyperliquid || vd.hyperliquid?.address || "",
        volume: vd.hyperliquid?.volume || "$0",
        verified: !!vd.hyperliquid?.verified,
      } : undefined,
      x: (vd.x || vd.twitter) ? {
        handle: vd.x?.handle || vd.twitter?.handle || vd.twitter?.address || p.handle || "",
        verified: !!(vd.x?.verified || vd.twitter?.verified),
      } : (p.links?.x ? {
        handle: p.handle || "",
        verified: false,
      } : undefined),
      satp: (vd.satp?.verified || (p.wallets?.solana && checkOnChainIdentitySync(p.wallets.solana))) ? {
        did: vd.satp?.did || `did:satp:sol:${p.wallets?.solana || p.id}`,
        verified: true,
      } : undefined,
      ethereum: vd.ethereum?.verified ? { address: vd.ethereum.address || p.wallets?.ethereum || "", verified: true } : undefined,
      moltbook: vd.moltbook?.verified ? { username: vd.moltbook.username || "", verified: true } : undefined,
      website: isCanonicalVerified("website") ? { url: canonicalEntry("website")?.url || "", verified: true } : undefined,
      domain: isCanonicalVerified("domain") ? { domain: canonicalEntry("domain")?.domain || "", verified: true } : undefined,
      polymarket: vd.polymarket?.verified ? { address: vd.polymarket.address || "", verified: true } : undefined,
      discord: vd.discord?.verified ? { username: vd.discord.username || "", verified: true } : undefined,
      twitter: vd.twitter?.verified ? { handle: vd.twitter.handle || vd.twitter.address || "", verified: true } : undefined,
    },
    status: p.unclaimed ? "unclaimed" : "online", // Unclaimed profiles show unclaimed status
    jobsCompleted: p.stats?.jobsCompleted || 0,
    rating: p.stats?.rating || 0,
    reviewCount: p.stats?.reviewsReceived || 0,
    registeredAt: p.createdAt || "",
    createdAt: p.createdAt || "",
    activity: (p.activity || []).map((a: any) => ({ type: a.type || "", createdAt: a.createdAt || "" })),
    walletAddress: p.wallets?.solana || undefined,
    // V3 on-chain scoring
    verificationLevel,
    verificationBadge,
    verificationLevelName,
    reputationScore: trustScore, // From SATP on-chain (v2 trust score) when available
    reputationRank: hasV3Evidence ? (["Newcomer","Recognized","Competent","Expert","Master"][Math.min(Math.floor(trustScore / 250), 4)] || "Newcomer") : "Reputation pending",
    unclaimed: p.unclaimed || false,
  };
}

function loadAllProfiles(): Agent[] {
  if (_agentsCache && (Date.now() - _agentsCacheTime < CACHE_TTL_MS)) return _agentsCache;
  try {
    const files = fs.readdirSync(PROFILES_DIR).filter(f => f.endsWith(".json"));
    const rawProfiles: RawProfile[] = [];
    for (const file of files) {
      try {
        rawProfiles.push(JSON.parse(fs.readFileSync(path.join(PROFILES_DIR, file), "utf-8")) as RawProfile);
      } catch { /* skip bad files */ }
    }
    // Fire-and-forget on-chain preload (will populate cache for next request)
    preloadOnChainIdentities(rawProfiles).catch(() => {});
    let agents: Agent[] = [];
    for (let i = 0; i < rawProfiles.length; i++) {
      try {
        agents.push(mapProfile(rawProfiles[i]));
      } catch (mapErr: any) {
        console.error("[AGENTFOLIO] mapProfile failed for", rawProfiles[i]?.id, mapErr?.message);
      }
    }
    // Sort by trust score desc
    agents.sort((a, b) => (b.verificationLevel ?? b.tier) - (a.verificationLevel ?? a.tier) || b.trustScore - a.trustScore);
    // Filter out test profiles from public views
    const TEST_IDS = ["test_satp", "test-no-sig", "test-check-id", "ghosttest", "ghosttest3806"];
    const TEST_EXACT_NAMES = ["SmokeTest", "TestCLI", "CEOTestAgent", "test", "E2E-Test-Agent", "BrainForgeQA", "ghosttest", "ghost_test_3806"];
    // Test filter removed per CEO directive Mar 24 — all profiles show
    // agents = agents.filter(a => !TEST_EXACT_NAMES.includes(a.name) && !TEST_IDS.some(t => a.id?.includes(t)));
    // Filter ghost profiles: unclaimed with no trust score
    // Show all profiles including unclaimed (CEO Mar 23)
    // agents = agents.filter(a => !a.unclaimed || a.trustScore > 0);
    _agentsCache = agents;
    _agentsCacheTime = Date.now();
    
    // V3 batch fetch — warm cache for next mapProfile call
    const v3CacheAge = Date.now() - ((globalThis as any).__v3ScoresCacheTime || 0);
    if (v3CacheAge > 300000 || !(globalThis as any).__v3ScoresCache) {
      const agentIds = rawProfiles.map(p => p.id);
      fetchV3Scores(agentIds).then(scores => {
        (globalThis as any).__v3ScoresCache = scores;
        (globalThis as any).__v3ScoresCacheTime = Date.now();
        _agentsCache = null; // Invalidate so next request uses V3 scores
        console.log(`[V3] Cached ${scores.size} on-chain scores`);
      }).catch(e => console.error("[V3] Batch fetch failed:", e.message));
    }
    
    return agents;
  } catch (outerErr: any) {
    console.error("[AGENTFOLIO] loadAllProfiles OUTER error:", outerErr?.message);
    return [];
  }
}

function mapApiJob(raw: any): Job {
  const statusMap: Record<string, Job["status"]> = {
    open: "open",
    draft: "open",
    awarded: "in_progress",
    agent_accepted: "in_progress",
    submitted: "in_progress",
    work_submitted: "in_progress",
    in_progress: "in_progress",
    approved: "completed",
    released: "completed",
    closed: "completed",
    completed: "completed",
    disputed: "disputed",
  };
  const amount = Number(raw.budgetAmount ?? raw.budget_amount ?? raw.agreed_budget ?? 0);
  const createdAt = raw.createdAt || raw.created_at;
  const applicationCount = Number(raw.applicationCount ?? raw.application_count ?? raw.proposals ?? 0);
  return {
    id: String(raw.id || "unknown-job"),
    title: String(raw.title || "Untitled job"),
    description: String(raw.description || "No description provided."),
    poster: String(raw.poster || raw.clientId || raw.client_id || "Unknown client"),
    posterAvatar: "",
    budget: `${Number.isFinite(amount) ? amount : 0} SOL`,
    skills: Array.isArray(raw.skills) ? raw.skills.filter((skill: unknown): skill is string => typeof skill === "string" && skill.length > 0) : [],
    status: statusMap[raw.status] || "open",
    escrowStatus: raw.funds_released || raw.fundsReleased ? "released" : raw.funds_locked || raw.escrow_funded || raw.escrowFunded ? "locked" : "ready",
    proposals: Number.isFinite(applicationCount) ? applicationCount : 0,
    deadline: String(raw.timeline || raw.deadline || "Flexible").replace(/_/g, " "),
    assignee: raw.assignee || raw.selectedAgentId || raw.selected_agent_id || undefined,
    assigneeId: raw.assigneeId || raw.selectedAgentId || raw.selected_agent_id || undefined,
    clientId: raw.clientId || raw.client_id || undefined,
    createdAt: createdAt && Number.isFinite(new Date(createdAt).getTime()) ? createdAt : new Date(0).toISOString(),
  };
}

export function getAllAgents(): Agent[] {
  return loadAllProfiles();
}

export function getAgent(id: string): Agent | undefined {
  return loadAllProfiles().find(a => a.id === id);
}

export function searchAgents(query: string): Agent[] {
  const q = query.toLowerCase();
  return loadAllProfiles().filter(a =>
    a.name.toLowerCase().includes(q) ||
    a.handle.toLowerCase().includes(q) ||
    a.skills.some(s => s.toLowerCase().includes(q)) ||
    a.bio.toLowerCase().includes(q)
  );
}

export function getStats() {
  const agents = loadAllProfiles();
  const totalSkills = new Set(agents.flatMap(a => a.skills)).size;
  const verified = agents.filter(a => (a.verificationLevel ?? a.tier ?? 0) >= 1).length;
  const onChain = agents.filter(a => a.verifications.satp?.verified || a.verifications.solana?.verified).length;
  // Count born agents from V3 cache
  let bornAgents = 0;
  const v3Cache = (globalThis as any).__v3ScoresCache as Map<string, any> | undefined;
  if (v3Cache) {
    for (const v3 of v3Cache.values()) {
      if (v3.isBorn) bornAgents++;
    }
  }
  // Count distinct verification types across all agents
  const verificationTypes = new Set<string>();
  for (const a of agents) {
    for (const [key, val] of Object.entries(a.verifications)) {
      if (val && (val as any).verified) verificationTypes.add(key);
    }
  }
  return {
    totalAgents: agents.length,
    totalSkills,
    verified,
    onChain,
    bornAgents,
    verificationTypes: verificationTypes.size,
  };
}


export function getTopVerifiedAgents(limit = 6): Agent[] {
  const agents = loadAllProfiles();
  return agents
    .filter(a => a.trustScore >= 50)
    .sort((a, b) => b.trustScore - a.trustScore)
    .slice(0, limit);
}

export async function getAllJobs(): Promise<Job[]> {
  try {
    const response = await fetch(`${API_BASE}/api/jobs?limit=100`, { cache: "no-store" });
    if (!response.ok) return [];
    const payload = await response.json();
    const rows = Array.isArray(payload?.jobs) ? payload.jobs : [];
    return rows.map(mapApiJob);
  } catch {
    return [];
  }
}

export async function getJob(id: string): Promise<Job | undefined> {
  try {
    const response = await fetch(`${API_BASE}/api/jobs/${encodeURIComponent(id)}`, { cache: "no-store" });
    if (!response.ok) return undefined;
    return mapApiJob(await response.json());
  } catch {
    return undefined;
  }
}

export function getActivityFeed() {
  const agents = loadAllProfiles();
  // Generate from real data - recent registrations and endorsements
  const activities: Array<{ agent: string; action: string; time: string }> = [];

  // Sort by updatedAt/createdAt for recent activity
  const sorted = [...agents].sort((a, b) =>
    new Date(b.registeredAt).getTime() - new Date(a.registeredAt).getTime()
  );

  for (const a of sorted.slice(0, 6)) {
    const date = new Date(a.registeredAt);
    const now = Date.now();
    const diff = now - date.getTime();
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(hours / 24);
    const time = days > 0 ? `${days}d ago` : hours > 0 ? `${hours}h ago` : "recently";

    if (a.verifications.solana?.verified) {
      activities.push({ agent: a.name, action: "verified Solana wallet", time });
    } else if (a.verifications.github?.verified) {
      activities.push({ agent: a.name, action: "verified GitHub", time });
    } else {
      activities.push({ agent: a.name, action: "registered", time });
    }
  }

  return activities.slice(0, 6);
}

export function getRecentlyVerified(limit = 5): Array<{ name: string; id: string; avatar: string | null; platform: string; date: string; trustScore: number; verificationLevel: number; verificationLevelName: string }> {
  const agents = loadAllProfiles();
  const results: Array<{ name: string; id: string; avatar: string | null; platform: string; date: string; trustScore: number; verificationLevel: number; verificationLevelName: string; ts: number }> = [];
  
  for (const a of agents) {
    // Check all verification activities
    for (const act of (a.activity || [])) {
      if (act.type?.startsWith('verification_') && act.createdAt) {
        const platform = act.type.replace('verification_', '');
        if (['profile_created', 'profile_updated'].includes(act.type)) continue;
        results.push({
          name: a.name,
          id: a.id,
          avatar: a.avatar || null,
          platform,
          date: act.createdAt,
          trustScore: a.trustScore,
          verificationLevel: a.verificationLevel ?? 0,
          verificationLevelName: a.verificationLevelName ?? 'Unclaimed',
          ts: new Date(act.createdAt).getTime(),
        });
      }
    }
  }
  
  // Sort by most recent, dedupe by agent (show only latest verification per agent)
  results.sort((a, b) => b.ts - a.ts);
  const seen = new Set<string>();
  const deduped = results.filter(r => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });
  
  return deduped.slice(0, limit).map(({ ts, ...rest }) => rest);
}
