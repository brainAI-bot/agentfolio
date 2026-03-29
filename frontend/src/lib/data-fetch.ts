import type { Agent } from "./types";

const API_BASE = process.env.INTERNAL_API_URL || "http://localhost:3333";

/**
 * Fetch agent data via HTTP API instead of filesystem.
 * This allows Next.js ISR to work properly since no fs imports are used.
 */
export async function fetchAgent(id: string): Promise<Agent | null> {
  try {
    const url = `${API_BASE}/api/profile/${encodeURIComponent(id)}`;
    const res = await fetch(url, {
      next: { revalidate: 120 },
    });
    if (!res.ok) return null;
    const raw = await res.json();
    
    // Fetch trust credential breakdown (normalized)
    let trustBreakdown = null;
    try {
      const tcRes = await globalThis.fetch(`${API_BASE}/api/trust-credential/${encodeURIComponent(id)}?format=json`, { next: { revalidate: 120 } });
      if (tcRes.ok) {
        const tcData = await tcRes.json();
        trustBreakdown = tcData?.credential?.credentialSubject?.breakdown || null;
      }
    } catch {}

    // Map backend response to frontend Agent type
    // Use verification_data (snake_case from API) with fallback to verificationData
    // Then merge with raw.verifications (chain-cache, has all 14 platforms) for full coverage
    const vdRaw = raw.verification_data || raw.verificationData || {};
    const vChain = raw.verifications || {};
    // Merge: for each platform in vChain, if vdRaw doesn't have it or it's not verified, use vChain entry
    const vd: Record<string, any> = { ...vdRaw };
    for (const [platform, entry] of Object.entries(vChain)) {
      if (entry && typeof entry === 'object' && (entry as any).verified && !vd[platform]?.verified) {
        vd[platform] = entry;
      }
    }

    // V3 on-chain Genesis Record is canonical — prefer trust_score/v3 fields
    const v3ts = raw.trust_score?.source === 'satp_v3_onchain' ? raw.trust_score : null;
    const v3cache = raw.v3 || null;
    const repScore = v3ts?.reputationScore ?? v3cache?.reputationScore ?? raw.trustScore ?? raw.score ?? 0;
    const vLevel = v3ts?.verificationLevel ?? v3cache?.verificationLevel ?? raw.verificationLevel ?? 0;
    const vLabel = v3ts?.verificationLabel ?? v3cache?.verificationLabel ?? ["Unclaimed","Registered","Verified","Established","Trusted","Sovereign"][vLevel] ?? "Unclaimed";

    return {
      id: raw.id,
      name: raw.name,
      handle: raw.handle || "",
      bio: raw.bio || "",
      avatar: raw.avatar || "",
      nftAvatar: raw.nftAvatar || null,
      trustScore: repScore,
      tier: vLevel,
      verificationLevel: vLevel,
      verificationLevelName: vLabel,
      verificationBadge: ["⚪","🟡","🔵","🟢","🟠","🟣"][vLevel] || "⚪",
      reputationScore: repScore,
      reputationRank: ["Newcomer","Recognized","Competent","Expert","Master"][Math.min(Math.floor(repScore / 250), 4)] || "Newcomer",
      skills: Array.isArray(raw.skills) ? raw.skills.map((s: any) => typeof s === "string" ? s : s.name || "").filter(Boolean) : [],
      verifications: {
        github: vd.github?.verified ? { username: vd.github.username || vd.github.handle || "", repos: vd.github.repos || 0, stars: vd.github.stars || 0, verified: true } : undefined,
        solana: vd.solana?.verified ? { address: vd.solana.address || raw.walletAddress || "", txCount: vd.solana.txCount || 0, balance: vd.solana.balance || "0 SOL", verified: true } : undefined,
        hyperliquid: vd.hyperliquid?.verified ? { address: vd.hyperliquid.address || "", volume: vd.hyperliquid.volume || "$0", verified: true } : undefined,
        x: vd.x?.verified || vd.twitter?.verified ? { handle: vd.x?.handle || vd.twitter?.handle || "", verified: true } : undefined,
        satp: vd.satp?.verified ? { did: vd.satp.did || "", verified: true } : undefined,
        ethereum: vd.ethereum?.verified ? { address: vd.ethereum.address || "", verified: true } : undefined,
        agentmail: vd.agentmail?.verified ? { email: vd.agentmail.email || "", verified: true } : undefined,
        moltbook: vd.moltbook?.verified ? { username: vd.moltbook.username || "", verified: true } : undefined,
        polymarket: vd.polymarket?.verified ? { address: vd.polymarket.address || "", verified: true } : undefined,
        discord: vd.discord?.verified ? { username: vd.discord.username || "", verified: true } : undefined,
        website: vd.website?.verified ? { url: vd.website.url || "", verified: true } : undefined,
        domain: vd.domain?.verified ? { domain: vd.domain.domain || "", verified: true } : undefined,
        telegram: vd.telegram?.verified ? { username: vd.telegram.username || "", verified: true } : undefined,
        twitter: vd.twitter?.verified ? { handle: vd.twitter.handle || "", verified: true } : undefined,
        mcp: vd.mcp?.verified ? { url: vd.mcp.url || "", verified: true } : undefined,
        a2a: vd.a2a?.verified ? { url: vd.a2a.url || "", verified: true } : undefined,
        review: vd.review?.verified ? { verified: true } : undefined,
      },
      unclaimed: raw.unclaimed || false,
      status: raw.unclaimed ? "unclaimed" : "online",
      jobsCompleted: raw.stats?.jobsCompleted || 0,
      rating: raw.stats?.rating || 0,
      registeredAt: raw.createdAt || "",
      createdAt: raw.createdAt || "",
      activity: [],
      walletAddress: raw.walletAddress || raw.wallets?.solana || undefined,
      profileCompleteness: (() => {
        let filled = 0, total = 8;
        if (raw.name?.trim()) filled++;
        if ((raw.bio || raw.description)?.trim()) filled++;
        if (raw.avatar?.trim()) filled++;
        const skills = Array.isArray(raw.skills) ? raw.skills : [];
        if (skills.length > 0) filled++;
        const vd2 = raw.verification_data || raw.verificationData || {};
        const links = raw.links || {};
        if (vd2.x?.verified || vd2.twitter?.verified || links.x) filled++;
        if (vd2.github?.verified || links.github) filled++;
        if (links.website) filled++;
        if (raw.walletAddress || raw.wallets?.solana) filled++;
        return Math.round((filled / total) * 100);
      })(),
      trustBreakdown,
    };
  } catch {
    return null;
  }
}
