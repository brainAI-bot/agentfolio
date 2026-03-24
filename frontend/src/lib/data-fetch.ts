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
    
    // Map backend response to frontend Agent type
    const vd = raw.verificationData || {};
    
    return {
      id: raw.id,
      name: raw.name,
      handle: raw.handle || "",
      bio: raw.bio || "",
      avatar: raw.avatar || "",
      nftAvatar: raw.nftAvatar || null,
      trustScore: raw.trustScore || raw.score || 0,
      tier: raw.tier || 0,
      verificationLevel: raw.verificationLevel || 0,
      verificationLevelName: ["Unclaimed","Registered","Verified","Established","Trusted","Sovereign"][raw.verificationLevel || 0] || "Unclaimed",
      verificationBadge: ["⚪","🟡","🔵","🟢","🟠","🟣"][raw.verificationLevel || 0] || "⚪",
      reputationScore: raw.trustScore || raw.score || 0,
      reputationRank: ["Newcomer","Recognized","Competent","Expert","Master"][Math.min(Math.floor((raw.trustScore || 0) / 250), 4)] || "Newcomer",
      skills: Array.isArray(raw.skills) ? raw.skills.map((s: any) => typeof s === "string" ? s : s.name || "").filter(Boolean) : [],
      verifications: raw.verifications || {
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
      },
      unclaimed: raw.unclaimed || false,
      status: raw.unclaimed ? "unclaimed" : "online",
      jobsCompleted: raw.stats?.jobsCompleted || 0,
      rating: raw.stats?.rating || 0,
      registeredAt: raw.createdAt || "",
      createdAt: raw.createdAt || "",
      activity: [],
      walletAddress: raw.walletAddress || raw.wallets?.solana || undefined,
    };
  } catch {
    return null;
  }
}
