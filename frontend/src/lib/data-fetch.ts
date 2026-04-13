import type { Agent } from "./types";

const API_BASE = process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL || process.env.PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || "http://127.0.0.1:3333";

/**
 * Fetch agent data via HTTP API instead of filesystem.
 * This allows Next.js ISR to work properly since no fs imports are used.
 */
export async function fetchAgent(id: string): Promise<Agent | null> {
  try {
    const url = `${API_BASE}/api/profile/${encodeURIComponent(id)}`;
    const res = await fetch(url, {
      next: { revalidate: 30 },
    });
    if (!res.ok) return null;
    const raw = await res.json();
    
    // Fetch trust credential breakdown (normalized)
    let trustBreakdown = null;
    try {
      const tcRes = await globalThis.fetch(`${API_BASE}/api/trust-credential/${encodeURIComponent(id)}?format=json`, { next: { revalidate: 30 } });
      if (tcRes.ok) {
        const tcData = await tcRes.json();
        trustBreakdown = tcData?.credential?.credentialSubject?.breakdown || null;
      }
    } catch {}

    // Map backend response to frontend Agent type
    // Chain-cache ONLY — zero DB reads for verifications
    const vd: Record<string, any> = raw.verifications || {};

    // V3 on-chain Genesis Record is canonical — prefer trust_score/v3 fields
    // A1: Single scoring source — computeScore via API
    const repScore = raw.trustScore ?? raw.score ?? raw.trust_score?.overall_score ?? 0;
    // Map tier string to numeric level (BUG 2 fix)
    const tierToLevel: Record<string, number> = { "Unclaimed": 0, "NEW": 0, "Registered": 1, "Verified": 2, "Established": 3, "Trusted": 4, "Sovereign": 5 };
    const vLevel = raw.verificationLevel ?? raw.level ?? (typeof raw.tier === 'string' ? tierToLevel[raw.tier] ?? 0 : 0);
    const vLabel = raw.tier ?? ["Unclaimed","Registered","Verified","Established","Trusted","Sovereign"][vLevel] ?? "Unclaimed";
    // Fallback: derive trustBreakdown from trust_score.score_breakdown if trust-credential failed
    if (!trustBreakdown && raw.trust_score?.score_breakdown) {
      const sb = raw.trust_score.score_breakdown;
      trustBreakdown = {
        onChainReputation: sb.satp || 0,
        verifications: (sb.solana || 0) + (sb.github || 0) + (sb.x || 0) + (sb.hyperliquid || 0) + (sb.ethereum || 0) + (sb.discord || 0) + (sb.telegram || 0) + (sb.domain || 0) + (sb.mcp || 0) + (sb.a2a || 0),
        socialProof: (sb.moltbook || 0) + (sb.agentmail || 0),
        completeness: sb.completeness || 0,
        marketplace: sb.marketplace || 0,
        tenure: sb.tenure || 0,
      };
    }

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
        github: vd.github?.verified ? { username: vd.github.username || vd.github.handle || vd.github.identifier || vd.github.address || "", repos: vd.github.repos || 0, stars: vd.github.stars || 0, verified: true } : undefined,
        solana: vd.solana?.verified ? { address: vd.solana.address || raw.walletAddress || "", txCount: vd.solana.txCount || 0, balance: vd.solana.balance || "0 SOL", verified: true } : undefined,
        hyperliquid: vd.hyperliquid?.verified ? { address: vd.hyperliquid.address || "", volume: vd.hyperliquid.volume || "$0", verified: true } : undefined,
        x: vd.x?.verified || vd.twitter?.verified ? { handle: vd.x?.handle || vd.twitter?.handle || "", verified: true } : undefined,
        satp: vd.satp?.verified ? { did: vd.satp.did || "", identifier: vd.satp.identifier || vd.satp.address || "", identityPDA: vd.satp.proof?.identityPDA || "", txSignature: vd.satp.proof?.txSignature || "", verified: true } : undefined,
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
      wallet: raw.wallet || undefined,
      wallets: raw.wallets || undefined,
      profileCompleteness: (() => {
        const profilePoints = (() => {
          const authoritative = raw.trustBreakdown?.profile?.total;
          if (Number.isFinite(authoritative)) return Math.max(0, Math.min(30, Number(authoritative)));

          let points = 0;
          const bio = String(raw.bio || raw.description || '').trim();
          if (bio.length >= 50) points += 5;
          if (String(raw.avatar || '').trim()) points += 5;

          const skills = Array.isArray(raw.skills) ? raw.skills.filter(Boolean) : [];
          if (skills.length >= 3) points += 5;

          if (String(raw.handle || '').trim()) points += 5;

          const portfolio = Array.isArray(raw.portfolio)
            ? raw.portfolio.filter((item: any) => item && (String(item.title || '').trim() || String(item.url || '').trim() || String(item.description || '').trim()))
            : [];
          points += Math.min(2, portfolio.length) * 5;

          return Math.max(0, Math.min(30, points));
        })();

        return Math.round((profilePoints / 30) * 100);
      })(),
      trustBreakdown,
    };
  } catch {
    return null;
  }
}
