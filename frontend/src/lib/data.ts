import fs from "fs";
import path from "path";
import type { Agent, Job } from "./types";
import { fetchV3Scores, v3ToComputedScores } from "./v3-scores";

const API_BASE = process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL || process.env.PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || "http://127.0.0.1:3333";

const PROFILES_DIR = "/home/ubuntu/agentfolio/data/profiles";
const JOBS_DIR = "/home/ubuntu/agentfolio/data/marketplace/jobs";
const DELIVERABLES_DIR = "/home/ubuntu/agentfolio/data/marketplace/deliverables";
const ESCROW_DIR = "/home/ubuntu/agentfolio/data/marketplace/escrow";
// Pre-warm V3 cache on module load (runs once at server startup)
if (typeof (globalThis as any).__v3WarmupDone === 'undefined') {
  (globalThis as any).__v3WarmupDone = true;
  // Read all profile IDs and batch-fetch V3 scores
  try {
    const _initFiles = require('fs').readdirSync(PROFILES_DIR).filter((f: string) => f.endsWith('.json'));
    const _initIds = _initFiles.map((f: string) => f.replace('.json', ''));
    // Backend API is authoritative (reads from on-chain via v3-score-service)
    fetch(`${API_BASE}/api/profiles?limit=300`).then(r => r.json()).then((data: any) => {
      const profiles = Array.isArray(data) ? data : (data.profiles || []);
      const scoreMap = new Map();
      for (const p of profiles) {
        if (p.id && (p.score !== undefined)) {
          scoreMap.set(p.id, { reputationScore: p.score ?? 0, verificationLevel: p.level ?? 0, verificationLabel: p.levelName ?? "Unknown", isBorn: p.isBorn ?? false, faceImage: p.faceImage ?? "", pda: "", reputationPct: (p.score ?? 0) / 10000 });
        }
      }
      (globalThis as any).__v3ScoresCache = scoreMap;
      (globalThis as any).__v3ScoresCacheTime = Date.now();
      console.log(`[V3] Pre-warmed ${scoreMap.size} scores from backend API`);
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
  verifications?: Record<string, any>;
  moltbookStats?: any;
  endorsements?: Array<{ fromId: string; fromName: string; fromHandle: string; message?: string | null; skills?: string[]; createdAt: string }>;
  endorsementsGiven?: any[];
  stats?: { jobsCompleted: number; rating: number };
  createdAt: string;
  updatedAt?: string;
  score?: number;
  trust_score?: number;
  verificationLevel?: number;
  level?: number;
  nftAvatar?: { chain: string; identifier: string; name: string | null; image: string | null; verifiedOnChain: boolean; verifiedAt: string } | null;
  activity?: any[];
  unclaimed?: boolean;
  claimed?: boolean | number;
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
  timeline: string;
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
  onchainEscrowPDA?: string | null;
  v3EscrowPDA?: string | null;
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

const NON_PUBLIC_FRONTEND_PROFILE_IDS = new Set([
  'agent_sm423064591',
  'agent_sm423302531',
  'agent_sm423302532',
  'agent_braintest',
  'agent_braintest2',
  'agent_forgetest',
  'agent_forgetest2',
]);

function isPublicFrontendProfileId(id: string | undefined | null): boolean {
  const normalized = String(id || '').toLowerCase();
  if (!normalized) return false;
  if (NON_PUBLIC_FRONTEND_PROFILE_IDS.has(normalized)) return false;
  if (normalized.startsWith('local_') || normalized.startsWith('lauc_') || normalized.startsWith('laur_')) return false;
  return true;
}

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
  const trustScoreObj: any = (p as any).trust_score;
  const rawTrustScore = typeof trustScoreObj === 'number'
    ? trustScoreObj
    : (trustScoreObj && typeof trustScoreObj === 'object' ? trustScoreObj.overall_score || 0 : 0);
  const trustScore = p.score || rawTrustScore || (v3 ? v3.reputationScore : 0) || 0;
  const vd: Record<string, any> = {
    ...((p as any).verification_data || {}),
    ...(p.verificationData || {}),
    ...(p.verifications || {}),
  };
  if (vd.eth && !vd.ethereum) vd.ethereum = vd.eth;
  if (vd.solana_wallet && !vd.solana) vd.solana = vd.solana_wallet;
  if (vd.twitter && !vd.x) vd.x = vd.twitter;
  const tier: number = p.verificationLevel || p.level || (v3 ? v3.verificationLevel : 0) || 0;

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
      solana: vd.solana?.verified ? {
        address: vd.solana?.address || p.wallets?.solana || "",
        txCount: vd.solana?.txCount || 0,
        balance: vd.solana?.balance || "0 SOL",
        verified: true,
      } : undefined,
      hyperliquid: vd.hyperliquid?.verified ? {
        address: vd.hyperliquid?.address || p.wallets?.hyperliquid || "",
        volume: vd.hyperliquid?.volume || "$0",
        verified: true,
      } : undefined,
      x: (vd.x?.verified || vd.twitter?.verified) ? {
        handle: vd.x?.handle || vd.twitter?.handle || vd.twitter?.address || p.handle || "",
        verified: true,
      } : undefined,
      satp: vd.satp?.verified ? {
        did: vd.satp?.did || `did:satp:sol:${p.wallets?.solana || p.id}`,
        identifier: vd.satp?.identifier || vd.satp?.address || p.wallets?.solana || "",
        identityPDA: vd.satp?.proof?.identityPDA || "",
        txSignature: vd.satp?.proof?.txSignature || "",
        verified: true,
      } : undefined,
      ethereum: (vd.ethereum?.verified || vd.eth?.verified) ? {
        address: vd.ethereum?.address || vd.eth?.address || p.wallets?.ethereum || p.wallets?.eth || "",
        verified: true,
      } : undefined,
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
    claimed: p.claimed === 1 || p.claimed === true || false,
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
    let agents: Agent[] = [];
    for (let i = 0; i < rawProfiles.length; i++) {
      try {
        agents.push(mapProfile(rawProfiles[i]));
      } catch (mapErr: any) {
        console.error("[AGENTFOLIO] mapProfile failed for", rawProfiles[i]?.id, mapErr?.message);
      }
    }
    // Sort by trust score desc
    agents.sort((a, b) => b.trustScore - a.trustScore); // CEO directive: sort by score only, not level-first
    agents = agents.filter(a => isPublicFrontendProfileId(a.id));
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
      // Use profile IDs (agent_xxx) for V3 PDA derivation — names like "Suppi" derive wrong PDAs
      const agentIds = rawProfiles.map(p => p.id || p.name);
      fetchV3Scores(agentIds).then(scores => {
        // MERGE with existing cache (warm-up from /api/profiles has more data than 429-limited RPC)
        const existing = (globalThis as any).__v3ScoresCache || new Map();
        scores.forEach((v, k) => { if (v) existing.set(k, v); });
        (globalThis as any).__v3ScoresCache = existing;
        (globalThis as any).__v3ScoresCacheTime = Date.now();
        _agentsCache = null; // Invalidate so next request uses V3 scores
        console.log(`[V3] Merged ${scores.size} on-chain scores into cache (${existing.size} total)`);
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
          awaiting_funding: "awaiting_funding",
          agent_accepted: "awaiting_funding",
          work_submitted: "in_progress",
          in_progress: "in_progress",
          completed: "completed",
          disputed: "disputed",
          cancelled: "open",
        };

        let escrowReleased = !!(raw.fundsReleased || (raw as any).releaseTxHash || (raw as any).v3ReleaseTx || (raw as any).v3ReleasedAt);
        if (!escrowReleased && raw.escrowId) {
          try {
            const escrow = JSON.parse(fs.readFileSync(path.join(ESCROW_DIR, `${raw.escrowId}.json`), "utf-8"));
            escrowReleased = escrow?.status === "released" || escrow?.status === "auto_released";
          } catch {}
        }

        const escrowStatus: Job["escrowStatus"] = escrowReleased ? "released" :
          raw.fundsLocked ? "locked" :
          raw.escrowFunded ? "locked" :
          "ready";

        jobs.push({
          id: raw.id,
          title: raw.title || raw.id,
          description: raw.description || "",
          poster: posterName,
          posterAvatar: "",
          budget: `${raw.budgetAmount ?? raw.agreedBudget ?? 0} ${raw.budgetCurrency || "USDC"}`,
          skills: Array.isArray(raw.skills) ? raw.skills : [],
          status: statusMap[raw.status] || "open",
          escrowStatus,
          proposals: raw.applicationCount || (Array.isArray((raw as any).applications) ? (raw as any).applications.length : 0),
          deadline: typeof raw.timeline === "string" && raw.timeline ? raw.timeline.replace("_", " ") : "Flexible",
          assignee: assigneeName,
          assigneeId: raw.selectedAgentId || raw.acceptedApplicant || undefined,
          clientId: raw.clientId,
          escrowId: raw.escrowId || null,
          onchainEscrowPDA: raw.onchainEscrowPDA || null,
          v3EscrowPDA: raw.v3EscrowPDA || null,
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
    jobs.sort((a: Job, b: Job) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    _jobsCache = jobs;
    _jobsCacheTime = Date.now();
    return jobs;
  } catch {
    return [];
  }
}

export async function getAllAgents(): Promise<Agent[]> {
  const API = API_BASE;
  try {
    const res = await fetch(API + "/api/profiles?limit=200", { next: { revalidate: 30 } });
    if (res.ok) {
      const profiles = await res.json();
      const arr = Array.isArray(profiles) ? profiles : profiles.profiles || [];
      return arr.map((p: any) => {
        const rawTrustScore = typeof p.trust_score === 'number'
          ? p.trust_score
          : (p.trust_score && typeof p.trust_score === 'object' ? p.trust_score.overall_score || 0 : 0);
        const trustScore = p.score || rawTrustScore || 0;
        const verificationEntries = Array.isArray(p.metadata?.verifications) ? p.metadata.verifications : [];
        const metadataVerifications = Object.fromEntries(verificationEntries
          .filter((entry: any) => entry && typeof entry.platform === "string")
          .map((entry: any) => [entry.platform, { ...(entry.proof || {}), ...entry, verified: entry.status === "verified" }])
        );
        const vd: Record<string, any> = {
          ...metadataVerifications,
          ...(p.verification_data || {}),
          ...(p.verificationData || {}),
          ...(p.verifications || {}),
        };
        if (vd.eth && !vd.ethereum) vd.ethereum = vd.eth;
        if (vd.solana_wallet && !vd.solana) vd.solana = vd.solana_wallet;
        if (vd.twitter && !vd.x) vd.x = vd.twitter;
        return {
          id: p.id, name: p.name || "", handle: p.handle || "", bio: p.bio || p.description || "",
          avatar: p.avatar || "", nftAvatar: null, trustScore,
          tier: p.tier || p.levelName || "Unclaimed", verificationLevel: p.verificationLevel || p.level || 0,
          verificationLevelName: p.verificationLevelName || p.tier || p.levelName || "Unclaimed",
          verificationBadge: ["⚪","🟡","🔵","🟢","🟠","🟣"][p.verificationLevel || p.level || 0] || "⚪",
          reputationScore: trustScore, reputationRank: "Newcomer",
          skills: [], verifications: {
            github: vd.github?.verified ? { verified: true } : undefined,
            solana: vd.solana?.verified ? { verified: true } : undefined,
            hyperliquid: vd.hyperliquid?.verified ? { verified: true } : undefined,
            x: (vd.x?.verified || vd.twitter?.verified) ? { verified: true } : undefined,
            satp: vd.satp?.verified ? { verified: true } : undefined,
            ethereum: (vd.ethereum?.verified || vd.eth?.verified) ? { verified: true } : undefined,
            agentmail: vd.agentmail?.verified ? { verified: true } : undefined,
            moltbook: vd.moltbook?.verified ? { verified: true } : undefined,
            polymarket: vd.polymarket?.verified ? { verified: true } : undefined,
            discord: vd.discord?.verified ? { verified: true } : undefined,
            website: vd.website?.verified ? { verified: true } : undefined,
            domain: vd.domain?.verified ? { verified: true } : undefined,
            telegram: vd.telegram?.verified ? { verified: true } : undefined,
            twitter: vd.twitter?.verified ? { verified: true } : undefined,
          }, unclaimed: p.unclaimed || false,
          status: p.unclaimed ? "unclaimed" : "online", jobsCompleted: 0, rating: 0,
          registeredAt: p.created_at || "", createdAt: p.created_at || "", activity: [],
          walletAddress: p.wallet || undefined, profileCompleteness: 0,
        };
      });
    }
  } catch {}
  return [];
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

export async function getStats() {
  const API = API_BASE;
  try {
    const res = await fetch(API + "/api/stats", { next: { revalidate: 30 } });
    if (res.ok) {
      const d = await res.json();
      return {
        totalAgents: d.totalAgents || d.total_agents || 0,
        totalSkills: 0,
        verified: d.verified || 0,
        onChain: d.on_chain || 0,
        bornAgents: 0,
        totalVerifications: d.verified || 0,
        recentSignups: 0,
        verificationTypes: 14,
      };
    }
  } catch {}
  return { totalAgents: 0, totalSkills: 0, verified: 0, onChain: 0, bornAgents: 0, totalVerifications: 0, recentSignups: 0, verificationTypes: 14 };
}


export async function getTopVerifiedAgents(limit = 6): Promise<Agent[]> {
  const all = await getAllAgents();
  return all.filter(a => a.trustScore > 0).sort((a, b) => b.trustScore - a.trustScore).slice(0, limit);
}

function mapMarketplaceApiJob(raw: any): Job | null {
  if (!raw || !raw.id) return null;
  const applications = Array.isArray(raw.applications) ? raw.applications.filter(Boolean) : [];
  const status = raw.status === "awaiting_funding"
    ? "awaiting_funding"
    : raw.status === "in_progress"
      ? "in_progress"
      : raw.status === "completed"
        ? "completed"
        : raw.status === "disputed"
          ? "disputed"
          : "open";
  const escrowStatus: Job["escrowStatus"] = (raw.fundsReleased || raw.releasedAt || raw.v3ReleasedAt)
    ? "released"
    : (raw.v3EscrowPDA || raw.onchainEscrowPDA)
      ? ((raw.fundsLocked || raw.escrowFunded) ? "locked" : "funded")
      : (raw.fundsLocked || raw.escrowFunded)
        ? "locked"
        : status === "completed"
          ? "completed"
          : "ready";

  return {
    id: raw.id,
    title: raw.title || raw.id,
    description: raw.description || "",
    poster: raw.clientId || raw.postedBy || "Unknown",
    posterAvatar: "",
    budget: `${raw.agreedBudget ?? raw.budgetAmount ?? raw.budget ?? 0} ${raw.budgetCurrency || raw.currency || "USDC"}`,
    skills: Array.isArray(raw.skills) ? raw.skills : [],
    status,
    escrowStatus,
    escrowTx: raw.v3EscrowTx || raw.escrowTx || raw.escrow_tx || raw.releaseTxHash || null,
    escrowId: raw.escrowId || null,
    v3EscrowPDA: raw.v3EscrowPDA || null,
    onchainEscrowPDA: raw.onchainEscrowPDA || null,
    proposals: raw.applicationCount || applications.length,
    deadline: typeof raw.timeline === "string" && raw.timeline ? raw.timeline.replaceAll("_", " ") : "Flexible",
    assignee: raw.selectedAgentId || raw.acceptedApplicant || undefined,
    assigneeId: raw.selectedAgentId || raw.acceptedApplicant || undefined,
    clientId: raw.clientId || raw.postedBy || undefined,
    clientWallet: raw.clientWallet || raw.v3EscrowClientWallet || undefined,
    deliverableId: raw.deliverableId || undefined,
    deliverableDescription: raw.deliverableDescription || undefined,
    deliverableStatus: raw.deliverableStatus || undefined,
    deliverableSubmittedAt: raw.deliverableSubmittedAt || raw.submittedAt || undefined,
    createdAt: raw.createdAt || new Date().toISOString(),
  };
}

async function fetchMarketplaceJobsFromApi(): Promise<Job[] | null> {
  try {
    const res = await fetch(`${API_BASE}/api/marketplace/jobs?status=all`, { next: { revalidate: 5 } });
    if (!res.ok) return null;
    const data = await res.json();
    const list = Array.isArray(data) ? data : (data.jobs || []);
    const jobs = list
      .map((job: any) => mapMarketplaceApiJob(job))
      .filter((job: Job | null): job is Job => !!job);
    jobs.sort((a: Job, b: Job) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return jobs;
  } catch {
    return null;
  }
}

async function fetchMarketplaceJobFromApi(id: string): Promise<Job | undefined> {
  try {
    const res = await fetch(`${API_BASE}/api/marketplace/jobs/${encodeURIComponent(id)}`, { cache: "no-store" });
    if (!res.ok) return undefined;
    const data = await res.json();
    return mapMarketplaceApiJob(data) || undefined;
  } catch {
    return undefined;
  }
}

export async function getAllJobs(): Promise<Job[]> {
  return (await fetchMarketplaceJobsFromApi()) || loadAllJobs();
}

export async function getJob(id: string): Promise<Job | undefined> {
  return (await fetchMarketplaceJobFromApi(id)) || loadAllJobs().find(j => j.id === id);
}

export async function getActivityFeed(): Promise<Array<{agent: string; action: string; detail: string; date: string; time: string}>> {
  return [];
}

export async function getRecentlyVerified(limit = 5): Promise<Array<{name: string; id: string; avatar: string|null; platform: string; date: string; trustScore: number; verificationLevel: number; verificationLevelName: string}>> {
  return [];
}
