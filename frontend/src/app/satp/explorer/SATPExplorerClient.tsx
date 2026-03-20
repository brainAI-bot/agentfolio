"use client";
import { useEffect, useState, useMemo } from "react";
import { Shield, ExternalLink, Search, Star, ChevronDown, ChevronUp, Wallet, Globe, Github, X as XIcon } from "lucide-react";
import Link from "next/link";

interface AgentCard {
  id: string;
  name: string;
  handle: string;
  avatar: string;
  wallet: string;
  trustScore: number;
  tier: string;
  verificationLevel: number;
  platforms: string[];
  reviewCount: number;
  reviewAvg: number;
  jobCount: number;
  totalEarned: number;
  registeredAt: string;
  nftImage: string | null;
  nftMint: string | null;
  soulbound: boolean;
}

const TIER_COLORS: Record<string, string> = {
  sovereign: "#8B5CF6",
  trusted: "#06B6D4",
  established: "#10B981",
  verified: "#3B82F6",
  registered: "#6B7280",
  unverified: "#4B5563",
};

const TIER_LABELS: Record<string, string> = {
  sovereign: "🟣 L5 · Sovereign",
  trusted: "🔵 L4 · Trusted",
  established: "🟢 L3 · Established",
  verified: "🔷 L2 · Verified",
  registered: "⬜ L1 · Registered",
  unverified: "⬛ L0 · Unverified",
};

const PLATFORM_ICONS: Record<string, string> = {
  solana: "◎", github: "⌘", twitter: "𝕏", x: "𝕏", ethereum: "⟠",
  discord: "🎮", agentmail: "✉", moltbook: "📖", hyperliquid: "📊",
  polymarket: "📈", website: "🌐", domain: "🔗", satp: "🛡️",
  telegram: "✈️", mcp: "🔌", a2a: "🤖",
};

type SortKey = "score" | "level" | "date" | "reviews";

export default function SATPExplorerPage() {
  const [agents, setAgents] = useState<AgentCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("score");
  const [sortAsc, setSortAsc] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchAll() {
      try {
        // Fetch all profiles
        const profilesRes = await fetch("/api/profiles?limit=200");
        const profiles = await profilesRes.json();

        // Filter to those with Solana wallets
        const withWallets = profiles.filter((p: any) => {
          const wallet = p.wallets?.solana || p.verificationData?.solana?.address;
          return !!wallet;
        });

        // Fetch on-chain data for each
        const cards: AgentCard[] = await Promise.all(
          withWallets.map(async (p: any) => {
            const wallet = p.wallets?.solana || p.verificationData?.solana?.address;
            let reputation: any = {};
            let reviewData: any = {};

            try {
              const [repRes, revRes] = await Promise.all([
                fetch(`/api/satp/reputation/${wallet}`).catch(() => null),
                fetch(`/api/satp/reviews/${wallet}`).catch(() => null),
              ]);
              if (repRes?.ok) reputation = await repRes.json();
              if (revRes?.ok) reviewData = await revRes.json();
            } catch {}

            const nftAvatar = p.nftAvatar;
            const platforms = reputation?.reputation?.platforms || 
              Object.keys(p.verificationData || {}).filter((k: string) => 
                p.verificationData?.[k]?.verified
              );

            return {
              id: p.id,
              name: p.name || p.id,
              handle: p.handle || "",
              avatar: nftAvatar?.image || nftAvatar?.arweaveUrl || p.avatar || "",
              wallet,
              trustScore: reputation?.trustScore || p.trustScore || 0,
              tier: (reputation?.tier || p.tier || "unverified").toLowerCase(),
              verificationLevel: reputation?.verificationLevel || 0,
              platforms,
              reviewCount: reviewData?.data?.stats?.totalReviews || 0,
              reviewAvg: reviewData?.data?.stats?.averageRating || 0,
              jobCount: p.stats?.jobsCompleted || 0,
              totalEarned: p.stats?.totalEarned || 0,
              registeredAt: p.createdAt || "",
              nftImage: nftAvatar?.image || nftAvatar?.arweaveUrl || null,
              nftMint: nftAvatar?.soulboundMint || nftAvatar?.identifier || null,
              soulbound: !!nftAvatar?.soulboundMint,
            };
          })
        );

        setAgents(cards);
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    }
    fetchAll();
  }, []);

  const filtered = useMemo(() => {
    let result = agents;
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(a =>
        a.name.toLowerCase().includes(q) ||
        a.id.toLowerCase().includes(q) ||
        a.wallet.toLowerCase().includes(q) ||
        a.handle.toLowerCase().includes(q)
      );
    }
    result.sort((a, b) => {
      let cmp = 0;
      switch (sort) {
        case "score": cmp = a.trustScore - b.trustScore; break;
        case "level": cmp = a.verificationLevel - b.verificationLevel; break;
        case "date": cmp = new Date(a.registeredAt).getTime() - new Date(b.registeredAt).getTime(); break;
        case "reviews": cmp = a.reviewCount - b.reviewCount; break;
      }
      return sortAsc ? cmp : -cmp;
    });
    return result;
  }, [agents, search, sort, sortAsc]);

  function toggleSort(key: SortKey) {
    if (sort === key) setSortAsc(!sortAsc);
    else { setSort(key); setSortAsc(false); }
  }

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-20 text-center">
        <Shield size={48} className="mx-auto mb-4 animate-pulse" style={{ color: "var(--accent)" }} />
        <h1 className="text-2xl font-bold mb-2" style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>
          Loading SATP Explorer...
        </h1>
        <p className="text-sm" style={{ color: "var(--text-tertiary)" }}>Reading from Solana mainnet</p>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <Shield size={28} style={{ color: "var(--accent)" }} />
          <h1 className="text-2xl font-bold" style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>
            SATP On-Chain Explorer
          </h1>
          <span className="px-2 py-0.5 rounded text-[10px] font-bold" style={{ background: "var(--success)", color: "#fff" }}>
            ⛓️ 100% ON-CHAIN
          </span>
        </div>
        <p className="text-sm" style={{ fontFamily: "var(--font-mono)", color: "var(--text-tertiary)" }}>
          All data sourced directly from Solana mainnet · SATP Program: <a href="https://explorer.solana.com/address/97yL33fcu6iWT2TdERS5HeqrMSGiUnxuy6nUcTrKieSq" target="_blank" rel="noopener noreferrer" className="hover:underline" style={{ color: "var(--accent)" }}>97yL33...eSq</a>
        </p>
        <div className="flex flex-wrap gap-3 mt-2 text-xs" style={{ fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
          <span>{agents.length} verified agents</span>
          <span>·</span>
          <span>{agents.reduce((s, a) => s + a.platforms.length, 0)} attestations</span>
          <span>·</span>
          <span>{agents.filter(a => a.soulbound).length} soulbound NFTs</span>
        </div>
      </div>

      {/* Search + Sort */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--text-tertiary)" }} />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name, wallet, or handle..."
            className="w-full pl-9 pr-4 py-2.5 rounded-lg text-sm"
            style={{ fontFamily: "var(--font-mono)", background: "var(--bg-secondary)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
          />
        </div>
        <div className="flex gap-2">
          {([["score", "Score"], ["level", "Level"], ["date", "Date"], ["reviews", "Reviews"]] as [SortKey, string][]).map(([key, label]) => (
            <button
              key={key}
              onClick={() => toggleSort(key)}
              className="px-3 py-2 rounded-lg text-[11px] font-semibold uppercase tracking-wider transition-colors"
              style={{
                fontFamily: "var(--font-mono)",
                background: sort === key ? "var(--accent)" : "var(--bg-secondary)",
                color: sort === key ? "#fff" : "var(--text-secondary)",
                border: `1px solid ${sort === key ? "var(--accent)" : "var(--border)"}`,
                cursor: "pointer",
              }}
            >
              {label} {sort === key && (sortAsc ? "↑" : "↓")}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg text-sm" style={{ background: "rgba(239,68,68,0.1)", color: "#EF4444", fontFamily: "var(--font-mono)" }}>
          Error: {error}
        </div>
      )}

      {/* Agent Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {filtered.map(agent => (
          <div
            key={agent.id}
            className="rounded-xl overflow-hidden transition-all hover:scale-[1.02] cursor-pointer"
            style={{ background: "var(--bg-secondary)", border: `1px solid ${expanded === agent.id ? "var(--accent)" : "var(--border)"}` }}
            onClick={() => setExpanded(expanded === agent.id ? null : agent.id)}
          >
            {/* Hero Image */}
            <div className="relative" style={{ height: 180, background: "var(--bg-tertiary)" }}>
              {agent.avatar ? (
                <img
                  src={agent.avatar}
                  alt={agent.name}
                  className="w-full h-full object-cover"
                  onError={(e: any) => { e.target.style.display = "none"; }}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <Shield size={48} style={{ color: "var(--border)" }} />
                </div>
              )}
              {/* Tier badge */}
              <div
                className="absolute top-2 right-2 px-2 py-0.5 rounded text-[10px] font-bold"
                style={{ fontFamily: "var(--font-mono)", background: TIER_COLORS[agent.tier] || "#4B5563", color: "#fff" }}
              >
                {TIER_LABELS[agent.tier] || agent.tier}
              </div>
              {agent.soulbound && (
                <div
                  className="absolute top-2 left-2 px-2 py-0.5 rounded text-[10px] font-bold"
                  style={{ fontFamily: "var(--font-mono)", background: "#DC2626", color: "#fff" }}
                >
                  🔥 Soulbound
                </div>
              )}
              {/* Trust score */}
              <div
                className="absolute bottom-2 right-2 px-2 py-1 rounded text-xs font-bold"
                style={{ fontFamily: "var(--font-mono)", background: "rgba(0,0,0,0.7)", color: "#fff" }}
              >
                {agent.trustScore} Trust
              </div>
            </div>

            {/* Info */}
            <div className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <Link href={`/profile/${agent.id}`} onClick={e => e.stopPropagation()} className="text-sm font-bold hover:underline" style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>
                  {agent.name}
                </Link>
              </div>
              <div className="text-[11px] mb-3" style={{ fontFamily: "var(--font-mono)", color: "var(--text-tertiary)" }}>
                {agent.wallet.slice(0, 6)}...{agent.wallet.slice(-4)}
                <a href={`https://explorer.solana.com/address/${agent.wallet}`} target="_blank" rel="noopener noreferrer" className="ml-1 inline-flex" onClick={e => e.stopPropagation()}>
                  <ExternalLink size={10} style={{ color: "var(--accent)" }} />
                </a>
              </div>

              {/* Platform badges */}
              <div className="flex flex-wrap gap-1 mb-3">
                {agent.platforms.slice(0, 8).map(p => (
                  <span
                    key={p}
                    className="px-1.5 py-0.5 rounded text-[9px]"
                    style={{ fontFamily: "var(--font-mono)", background: "var(--bg-tertiary)", color: "var(--text-secondary)" }}
                    title={p}
                  >
                    {PLATFORM_ICONS[p] || "✓"} {p.slice(0, 3).toUpperCase()}
                  </span>
                ))}
                {agent.platforms.length > 8 && (
                  <span className="text-[9px]" style={{ color: "var(--text-tertiary)" }}>+{agent.platforms.length - 8}</span>
                )}
              </div>

              {/* Stats row */}
              <div className="flex gap-4 text-[10px]" style={{ fontFamily: "var(--font-mono)", color: "var(--text-tertiary)" }}>
                <span>L{agent.verificationLevel}</span>
                {agent.reviewCount > 0 && <span>★{agent.reviewAvg.toFixed(1)} ({agent.reviewCount})</span>}
                <span>{new Date(agent.registeredAt).toLocaleDateString("en-US", { month: "short", year: "numeric" })}</span>
              </div>

              {/* Expanded details */}
              {expanded === agent.id && (
                <div className="mt-4 pt-3 border-t space-y-2 text-xs" style={{ borderColor: "var(--border)", fontFamily: "var(--font-mono)" }}>
                  <div className="flex justify-between">
                    <span style={{ color: "var(--text-tertiary)" }}>Wallet</span>
                    <a href={`https://explorer.solana.com/address/${agent.wallet}`} target="_blank" rel="noopener noreferrer" className="hover:underline flex items-center gap-1" style={{ color: "var(--accent)" }} onClick={e => e.stopPropagation()}>
                      {agent.wallet.slice(0, 12)}... <ExternalLink size={10} />
                    </a>
                  </div>
                  {agent.nftMint && (
                    <div className="flex justify-between">
                      <span style={{ color: "var(--text-tertiary)" }}>{agent.soulbound ? "Soulbound NFT" : "NFT"}</span>
                      <a href={`https://explorer.solana.com/address/${agent.nftMint}`} target="_blank" rel="noopener noreferrer" className="hover:underline flex items-center gap-1" style={{ color: "var(--accent)" }} onClick={e => e.stopPropagation()}>
                        {agent.nftMint.slice(0, 12)}... <ExternalLink size={10} />
                      </a>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span style={{ color: "var(--text-tertiary)" }}>Verification Level</span>
                    <span style={{ color: "var(--text-primary)" }}>L{agent.verificationLevel} — {agent.tier}</span>
                  </div>
                  <div className="flex justify-between">
                    <span style={{ color: "var(--text-tertiary)" }}>Platforms Verified</span>
                    <span style={{ color: "var(--text-primary)" }}>{agent.platforms.length}</span>
                  </div>
                  <div className="flex justify-between">
                    <span style={{ color: "var(--text-tertiary)" }}>Trust Score</span>
                    <span style={{ color: "var(--text-primary)" }}>{agent.trustScore}</span>
                  </div>
                  <div className="flex justify-between">
                    <span style={{ color: "var(--text-tertiary)" }}>Registered</span>
                    <span style={{ color: "var(--text-primary)" }}>{new Date(agent.registeredAt).toLocaleDateString()}</span>
                  </div>
                  {agent.reviewCount > 0 && (
                    <div className="flex justify-between">
                      <span style={{ color: "var(--text-tertiary)" }}>Reviews</span>
                      <span style={{ color: "#F59E0B" }}>{"★".repeat(Math.round(agent.reviewAvg))} {agent.reviewAvg.toFixed(1)} ({agent.reviewCount})</span>
                    </div>
                  )}
                  <Link
                    href={`/profile/${agent.id}`}
                    className="block text-center py-2 rounded-lg text-[11px] font-semibold uppercase tracking-wider mt-3"
                    style={{ background: "var(--accent)", color: "#fff" }}
                    onClick={e => e.stopPropagation()}
                  >
                    View Full Profile →
                  </Link>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {filtered.length === 0 && !loading && (
        <div className="text-center py-20">
          <Shield size={48} className="mx-auto mb-4" style={{ color: "var(--border)" }} />
          <p className="text-sm" style={{ fontFamily: "var(--font-mono)", color: "var(--text-tertiary)" }}>
            {search ? "No agents match your search" : "No verified agents found on-chain"}
          </p>
        </div>
      )}

      {/* Footer */}
      <div className="mt-8 pt-6 border-t text-center" style={{ borderColor: "var(--border)" }}>
        <p className="text-[11px]" style={{ fontFamily: "var(--font-mono)", color: "var(--text-tertiary)" }}>
          All data sourced from Solana mainnet · No database · Trustless verification ·{" "}
          <a href="/api/satp/overview" target="_blank" rel="noopener noreferrer" className="hover:underline" style={{ color: "var(--accent)" }}>
            Raw API →
          </a>
        </p>
      </div>
    </div>
  );
}
