import fs from "fs";
import path from "path";
import { Connection, PublicKey } from "@solana/web3.js";
import type { Agent, Job } from "./types";
import { getAgentProfilePDA, AGENT_PROFILE_DISCRIMINATOR, SOLANA_RPC } from "./identity-registry";
import { fetchV3Scores, v3ToComputedScores } from "./v3-scores";

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
const JOBS_DIR = "/home/ubuntu/agentfolio/data/marketplace/jobs";
const DELIVERABLES_DIR = "/home/ubuntu/agentfolio/data/marketplace/deliverables";
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
  stats?: { jobsCompleted: number; rating: number };
  createdAt: string;
  updatedAt?: string;
  nftAvatar?: { chain: string; identifier: string; name: string | null; image: string | null; verifiedOnChain: boolean; verifiedAt: string } | null;
  activity?: any[];
  unclaimed?: boolean;
}

interface RawJob {
  id: string;
  clientId: string;
  title: string;
  description: string;
  category: string;
  skills: string[];
  budgetType: string;
  budgetAmount: number;
  budgetCurrency: string;
  budgetMax: number | null;
  timeline: string | null;
  deadline?: string | null;
  status: string;
  attachments: any[];
  requirements: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
  selectedAgentId: string | null;
  applicationCount: number;
  viewCount: number;
  escrowId: string | null;
  escrowRequired: boolean;
  escrowFunded: boolean;
  depositConfirmedAt?: string | null;
  selectedAt?: string | null;
  agreedBudget?: number | null;
  agreedTimeline?: string | null;
  fundsLocked?: boolean;
  completedAt?: string | null;
  completionNote?: string | null;
  fundsReleased?: boolean;
  deliverableId?: string;
  acceptedApplicant?: string;
}

// Cache for performance (revalidates every 60 seconds)
let _agentsCache: Agent[] | null = null;
let _agentsCacheTime = 0;
let _jobsCache: Job[] | null = null;
let _jobsCacheTime = 0;
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
  // Trust Score: SATP on-chain is source of truth (synced by backend score engine)
  // V3 reputationPct is 0-100 scale, multiply by 8 to get 0-800 v2 trust score
  const trustScore = v3 ? v3.reputationScore : (p.verification?.score || calcTrustScore(p));
  const vd = p.verificationData || {};
  // Count local verifications for level fallback
  const localVerifCount = Object.values(vd).filter((v: any) => v && v.verified).length;
  const hasSATP = !!(vd.satp?.verified || (p.wallets?.solana));
  // Tier: SATP on-chain is source of truth. Local fallback for agents without genesis records.
  let tier: number;
  if (v3) {
    tier = v3.verificationLevel;
  } else if (localVerifCount >= 2) {
    tier = localVerifCount >= 5 ? 3 : (localVerifCount >= 2 ? 2 : 1); // L1 registered, L2 verified (2+), L3 established (5+)
  } else if (hasSATP || localVerifCount >= 1) {
    tier = 1; // L1 Registered — has SATP or at least 1 verification
  } else {
    tier = calcTierFromScore(p.verification?.tier, trustScore);
  }

  return {
    id: p.id,
    name: p.name,
    handle: p.handle || "",
    bio: p.bio || "",
    avatar: p.avatar || "",
    nftAvatar: p.nftAvatar || null,
    trustScore,
    tier,
    skills: [...new Set((p.skills || []).map(s => typeof s === 'string' ? s : (s.name || '')).filter(Boolean))],
    verifications: {
      github: vd.github ? {
        username: vd.github.handle || vd.github.username || vd.github.address || "",
        repos: vd.github.repos || 0,
        stars: vd.github.stars || 0,
        verified: !!vd.github.verified,
      } : undefined,
      solana: (vd.solana?.verified || p.wallets?.solana) ? {
        address: p.wallets?.solana || vd.solana?.address || "",
        txCount: vd.solana?.txCount || 0,
        balance: vd.solana?.balance || "0 SOL",
        verified: !!vd.solana?.verified,
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
      agentmail: vd.agentmail?.verified ? { email: vd.agentmail.email || "", verified: true } : undefined,
      moltbook: vd.moltbook?.verified ? { username: vd.moltbook.username || "", verified: true } : undefined,
      website: vd.website?.verified ? { url: vd.website.url || "", verified: true } : undefined,
      domain: vd.domain?.verified ? { domain: vd.domain.domain || "", verified: true } : undefined,
      polymarket: vd.polymarket?.verified ? { address: vd.polymarket.address || "", verified: true } : undefined,
      discord: vd.discord?.verified ? { username: vd.discord.username || "", verified: true } : undefined,
      telegram: vd.telegram?.verified ? { username: vd.telegram.username || "", verified: true } : undefined,
      twitter: vd.twitter?.verified ? { handle: vd.twitter.handle || vd.twitter.address || "", verified: true } : undefined,
    },
    status: p.unclaimed ? "unclaimed" : "online", // Unclaimed profiles show unclaimed status
    jobsCompleted: p.stats?.jobsCompleted || 0,
    rating: p.stats?.rating || 0,
    registeredAt: p.createdAt || "",
    createdAt: p.createdAt || "",
    activity: (p.activity || []).map((a: any) => ({ type: a.type || "", createdAt: a.createdAt || "" })),
    walletAddress: p.wallets?.solana || undefined,
    // V3 on-chain scoring
    verificationLevel: v3 ? v3.verificationLevel : Math.min(tier, 5),
    verificationBadge: v3 ? ["⚪","🟡","🔵","🟢","🟠","🟣"][v3.verificationLevel] || "⚪" : ["⚪","🟡","🔵","🟢","🟠","🟣"][Math.min(tier, 5)] || "⚪",
    verificationLevelName: ["Unclaimed","Registered","Verified","Established","Trusted","Sovereign"][v3 ? v3.verificationLevel : Math.min(tier, 5)] || "Unclaimed",
    reputationScore: trustScore, // From SATP on-chain (v2 trust score) when available
    reputationRank: ["Newcomer","Recognized","Competent","Expert","Master"][Math.min(Math.floor(trustScore / 250), 4)] || "Newcomer",
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

function loadAllJobs(): Job[] {
  if (_jobsCache && (Date.now() - _jobsCacheTime < CACHE_TTL_MS)) return _jobsCache;
  try {
    const files = fs.readdirSync(JOBS_DIR).filter(f => f.endsWith(".json"));
    const jobs: Job[] = [];
    // Load agent names for poster lookup
    const agents = loadAllProfiles();
    const agentMap = new Map(agents.map(a => [a.id, a.name]));

    for (const file of files) {
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(JOBS_DIR, file), "utf-8")) as RawJob;
        const posterName = agentMap.get(raw.clientId) || raw.clientId;
        const assigneeName = raw.selectedAgentId ? (agentMap.get(raw.selectedAgentId) || raw.selectedAgentId) : undefined;

        const statusMap: Record<string, Job["status"]> = {
          open: "open",
          draft: "open",
          agent_accepted: "in_progress",
          work_submitted: "in_progress",
          in_progress: "in_progress",
          completed: "completed",
          disputed: "disputed",
          cancelled: "open",
        };

        const escrowStatus: Job["escrowStatus"] = raw.fundsReleased ? "released" :
          raw.fundsLocked ? "locked" :
          raw.escrowFunded ? "locked" :
          "ready";

        jobs.push({
          id: raw.id,
          title: raw.title,
          description: raw.description,
          poster: posterName,
          posterAvatar: "",
          budget: `${raw.budgetAmount} ${raw.budgetCurrency}`,
          skills: raw.skills,
          status: statusMap[raw.status] || "open",
          escrowStatus,
          proposals: raw.applicationCount,
          deadline: (raw.timeline || raw.deadline || "Flexible").replace(/_/g, " "),
          assignee: assigneeName,
          assigneeId: raw.selectedAgentId || raw.acceptedApplicant || undefined,
          clientId: raw.clientId,
          ...(() => {
            if (raw.deliverableId) {
              try {
                const dlv = JSON.parse(fs.readFileSync(path.join(DELIVERABLES_DIR, raw.deliverableId + ".json"), "utf-8"));
                return {
                  deliverableId: dlv.id,
                  deliverableDescription: dlv.description,
                  deliverableStatus: dlv.status,
                  deliverableSubmittedAt: dlv.submittedAt,
                };
              } catch { return {}; }
            }
            return {};
          })(),
          createdAt: raw.createdAt,
        });
      } catch { /* skip */ }
    }
    jobs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    _jobsCache = jobs;
    _jobsCacheTime = Date.now();
    return jobs;
  } catch {
    return [];
  }
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
    verificationTypes: verificationTypes.size || 10, // fallback to known count
  };
}


export function getTopVerifiedAgents(limit = 6): Agent[] {
  const agents = loadAllProfiles();
  return agents
    .filter(a => a.trustScore >= 50)
    .sort((a, b) => b.trustScore - a.trustScore)
    .slice(0, limit);
}

export function getAllJobs(): Job[] {
  return loadAllJobs();
}

export function getJob(id: string): Job | undefined {
  return loadAllJobs().find(j => j.id === id);
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
