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
  pda: string;
  trustScore: number;
  tier: string;
  verificationLevel: number;
  platforms: string[];
  onChainAttestations: number;
  reviewCount: number;
  reviewAvg: number;
  jobCount: number;
  totalEarned: number;
  registeredAt: string;
  nftImage: string | null;
  nftMint: string | null;
  soulbound: boolean;
  description: string;
  programId: string;
  profileId: string | null;
  isBorn: boolean;
  verificationBadge?: string;
  verificationLevelName?: string;
  trustCredentialUrl?: string | null;
  attestationMemos: Array<{ platform: string; txSignature: string | null; timestamp: string | null; solscanUrl: string | null; memo?: string | null; displayType?: string | null }>;
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

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "On-chain";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "On-chain";
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function formatDateFull(dateStr: string | null | undefined): string {
  if (!dateStr) return "On-chain genesis";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "On-chain genesis";
  return d.toLocaleDateString();
}

function normalizePlatformLabel(value: string | null | undefined): string {
  const normalized = String(value || "")
    .replace(/^verification_/, "")
    .replace(/_wallet_verification$/, "")
    .replace(/_verification$/, "")
    .replace(/_/g, " ")
    .trim();
  if (!normalized) return "Unknown";
  return normalized.split(" ").map(part => part ? part[0].toUpperCase() + part.slice(1) : "").join(" ");
}

function normalizeAttestation(att: any) {
  let proofData: any = {};
  try { proofData = typeof att?.proofData === "string" ? JSON.parse(att.proofData) : (att?.proofData || {}); } catch {}
  const txSignature = att?.txSignature || proofData?.txSignature || proofData?.signature || proofData?.transactionSignature || null;
  const rawPlatform = att?.platform || att?.type || att?.attestationType || proofData?.platform || "attestation";
  return {
    ...att,
    platform: String(rawPlatform).toLowerCase(),
    displayType: normalizePlatformLabel(rawPlatform),
    memo: att?.memo || proofData?.memo || proofData?.identifier || proofData?.wallet || proofData?.address || null,
    txSignature,
    solscanUrl: txSignature ? `https://solscan.io/tx/${txSignature}` : (att?.solscanUrl || att?.url || att?.proof?.url || (att?.pda ? `https://solscan.io/account/${att.pda}` : null)),
    timestamp: att?.timestamp || att?.verifiedAt || att?.verified_at || att?.createdAt || null,
  };
}

export default function SATPExplorerPage() {
  const [agents, setAgents] = useState<AgentCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("score");
  const [sortAsc, setSortAsc] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detailData, setDetailData] = useState<Record<string, any>>({});
  const [detailLoading, setDetailLoading] = useState<Record<string, boolean>>({});

  useEffect(() => {
    async function fetchAll() {
      try {
        // Step 1: Fetch on-chain agents from SATP Explorer API
        const onChainRes = await fetch("/api/satp/explorer/agents");
        if (!onChainRes.ok) throw new Error("Failed to fetch on-chain agents");
        const onChainData = await onChainRes.json();
        const onChainAgents = onChainData.agents || [];

        // Step 2: Fetch profiles for NFT avatar cross-referencing
        let profilesByWallet: Record<string, any> = {};
        try {
          const profilesRes = await fetch("/api/profiles?limit=200");
          if (profilesRes.ok) {
            const profilesPayload = await profilesRes.json();
            const profiles = profilesPayload?.profiles || profilesPayload || [];
            for (const p of profiles) {
              const wallet = p.wallets?.solana || p.wallet || p.verifications?.solana?.address || p.verifications?.solana?.identifier;
              if (wallet) {
                profilesByWallet[wallet] = p;
              }
            }
          }
        } catch {}

        // Step 3: Enrich each on-chain agent with scores, reputation, and NFT data
        const cards: AgentCard[] = await Promise.all(
          onChainAgents.map(async (agent: any) => {
            const wallet = agent.authority;
            const profile = profilesByWallet[wallet] || null;
            
            // Fetch trust score + verification level
            let scores: any = {};
            let reputation: any = {};
            let reviewData: any = {};

            try {
              // 5s timeout per request to prevent hanging on RPC 429s
              const fetchWithTimeout = (url: string, ms = 5000) => {
                const ctrl = new AbortController();
                const timer = setTimeout(() => ctrl.abort(), ms);
                return fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(timer)).catch(() => null);
              };
              const [scoresRes, repRes, revRes] = await Promise.all([
                fetchWithTimeout(`/api/satp/scores/${wallet}`),
                fetchWithTimeout(`/api/satp/reputation/${wallet}`),
                fetchWithTimeout(`/api/satp/reviews/${wallet}`),
              ]);
              if (scoresRes?.ok) scores = await scoresRes.json();
              if (repRes?.ok) reputation = await repRes.json();
              if (revRes?.ok) reviewData = await revRes.json();
            } catch {}

            // NFT avatar from profile cross-reference
            const nftAvatar = profile?.nftAvatar;
            
            // Platforms: use on-chain agent.platforms as primary, merge with profile verifications
            const onChainPlatforms: string[] = agent.platforms || [];
            const profilePlatforms = profile ? Object.keys(profile.verifications || {}).filter((k: string) => 
              profile.verifications?.[k]?.verified
            ) : [];
            const platforms = [...new Set([...onChainPlatforms, ...profilePlatforms])];

            // Use profile name if available (more human-readable), else on-chain name
            const displayName = profile?.name || agent.name || "Unknown Agent";
            const profileId = scores?.data?.profileId || scores?.profileId || profile?.id || null;

            const verificationLevel = agent.verificationLevel || scores?.data?.verificationLevel || scores?.verificationLevel || 0;
            const verificationLevelName = agent.verificationLevelName || agent.verificationLabel || scores?.data?.verificationLabel || scores?.data?.levelName || ['Unverified','Registered','Verified','Established','Trusted','Sovereign'][verificationLevel] || 'Unverified';
            const verificationBadge = agent.verificationBadge || ['⚪','🟡','🔵','🟢','🟠','🟣'][verificationLevel] || '⚪';
            return {
              id: agent.pda, // Use PDA as unique ID
              name: displayName,
              handle: profile?.handle || "",
              avatar: nftAvatar?.image || nftAvatar?.arweaveUrl || agent.nftImage || profile?.avatar || "",
              wallet,
              pda: agent.pda,
              trustScore: agent.reputationScore || scores?.data?.trustScore || scores?.trustScore || 0,
              tier: (agent.tier || scores?.data?.tier || scores?.tier || "unverified").toLowerCase(),
              verificationLevel,
              verificationLevelName,
              verificationBadge,
              platforms,
              reviewCount: reviewData?.data?.stats?.total || reviewData?.stats?.total || 0,
              reviewAvg: reviewData?.data?.stats?.avg_rating || reviewData?.stats?.avg_rating || 0,
              jobCount: profile?.stats?.jobsCompleted || 0,
              totalEarned: profile?.stats?.totalEarned || 0,
              onChainAttestations: agent.onChainAttestations || 0,
              registeredAt: agent.createdAt || profile?.createdAt || "",
              nftImage: nftAvatar?.image || nftAvatar?.arweaveUrl || agent.nftImage || null,
              nftMint: nftAvatar?.soulboundMint || nftAvatar?.identifier || agent.nftMint || null,
              soulbound: !!nftAvatar?.soulboundMint || !!agent.soulbound,
              isBorn: !!agent.isBorn,
              attestationMemos: Array.isArray(agent.attestationMemos) ? agent.attestationMemos.map(normalizeAttestation) : [],
              description: agent.description || profile?.tagline || "",
              programId: agent.programId,
              profileId,
              trustCredentialUrl: agent.trustCredentialUrl || (profileId ? `/api/trust-credential/${profileId}` : null),
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

  // Fetch detailed data (attestations + explorer) when card is expanded
  async function fetchDetail(profileId: string) {
    if (detailData[profileId] || detailLoading[profileId]) return;
    setDetailLoading(prev => ({ ...prev, [profileId]: true }));
    try {
      const [attRes, explorerRes] = await Promise.all([
        fetch(`/api/satp/attestations/by-agent/${profileId}`).catch(() => null),
        fetch(`/api/explorer/${profileId}`).catch(() => null),
      ]);
      const attData = attRes?.ok ? await attRes.json() : null;
      const explorerData = explorerRes?.ok ? await explorerRes.json() : null;
      
      // Show all attestation memos (no dedup — multiple per platform is valid)
      const rawAtts = attData?.data?.attestations || [];
      const normalizedAttestations = rawAtts.map(normalizeAttestation);
      const normalizedExplorer = explorerData ? {
        ...explorerData,
        verifications: Array.isArray(explorerData.verifications) ? explorerData.verifications.map((item: any) => normalizeAttestation(item)) : [],
        attestationMemos: Array.isArray(explorerData.attestationMemos) ? explorerData.attestationMemos.map((item: any) => normalizeAttestation(item)) : normalizedAttestations,
      } : { verifications: [], attestationMemos: normalizedAttestations };

      setDetailData(prev => ({
        ...prev,
        [profileId]: {
          attestations: normalizedAttestations,
          explorer: normalizedExplorer,
        },
      }));
    } catch (e) {
      console.error("Detail fetch failed:", e);
    } finally {
      setDetailLoading(prev => ({ ...prev, [profileId]: false }));
    }
  }

  const filtered = useMemo(() => {
    let result = agents;
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(a =>
        a.name.toLowerCase().includes(q) ||
        a.wallet.toLowerCase().includes(q) ||
        a.handle.toLowerCase().includes(q) ||
        a.description.toLowerCase().includes(q) ||
        a.pda.toLowerCase().includes(q)
      );
    }
    result.sort((a, b) => {
      let cmp = 0;
      switch (sort) {
        case "score": cmp = a.trustScore - b.trustScore; break;
        case "level": cmp = a.verificationLevel - b.verificationLevel; break;
        case "date": {
          const da = a.registeredAt ? new Date(a.registeredAt).getTime() : 0;
          const db = b.registeredAt ? new Date(b.registeredAt).getTime() : 0;
          cmp = (isNaN(da) ? 0 : da) - (isNaN(db) ? 0 : db);
          break;
        }
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
          <span>{agents.length} on-chain agents</span>
          <span>·</span>
          <span>{agents.reduce((s, a) => s + (a.onChainAttestations || a.platforms.length), 0)} attestations</span>
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
            placeholder="Search by name, wallet, PDA, or description..."
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
            onClick={() => {
              const newExpanded = expanded === agent.id ? null : agent.id;
              setExpanded(newExpanded);
              if (newExpanded && agent.profileId) {
                fetchDetail(agent.profileId);
              }
            }}
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
              {/* Verification badge */}
              <div
                className="absolute top-2 right-2 px-2 py-0.5 rounded text-[10px] font-bold"
                style={{ fontFamily: "var(--font-mono)", background: TIER_COLORS[agent.tier] || "#4B5563", color: "#fff" }}
              >
                {agent.verificationBadge || "⚪"} {agent.verificationLevelName || TIER_LABELS[agent.tier] || agent.tier}
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
                {agent.profileId ? (
                  <Link href={`/profile/${agent.profileId}`} onClick={e => e.stopPropagation()} className="text-sm font-bold hover:underline" style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>
                    {agent.name}
                  </Link>
                ) : (
                  <span className="text-sm font-bold" style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>
                    {agent.name}
                  </span>
                )}
              </div>
              {agent.description && (
                <div className="text-[10px] mb-1 truncate" style={{ fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
                  {agent.description}
                </div>
              )}
              <div className="text-[11px] mb-3" style={{ fontFamily: "var(--font-mono)", color: "var(--text-tertiary)" }}>
                {agent.wallet.slice(0, 6)}...{agent.wallet.slice(-4)}
                <a href={`https://explorer.solana.com/address/${agent.wallet}`} target="_blank" rel="noopener noreferrer" className="ml-1 inline-flex" onClick={e => e.stopPropagation()}>
                  <ExternalLink size={10} style={{ color: "var(--accent)" }} />
                </a>
              </div>

              {/* Platform badges */}
              {agent.platforms.length > 0 && (
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
              )}

              {/* Stats row */}
              <div className="flex gap-4 text-[10px]" style={{ fontFamily: "var(--font-mono)", color: "var(--text-tertiary)" }}>
                <span>{agent.verificationBadge || '⚪'} L{agent.verificationLevel}{agent.verificationLevelName ? ` · ${agent.verificationLevelName}` : ''}</span>
                <span>{agent.attestationMemos.length || agent.platforms.length} attestations</span>
                {agent.reviewCount > 0 && <span>★{agent.reviewAvg.toFixed(1)} ({agent.reviewCount})</span>}
                <span>{formatDate(agent.registeredAt)}</span>
              </div>

              {/* Expanded details */}
              {expanded === agent.id && (() => {
                const detail = agent.profileId ? detailData[agent.profileId] : null;
                const isLoading = agent.profileId ? detailLoading[agent.profileId] : false;
                // Use attestation memos from explorer API (already loaded), fallback to detail fetch
                const attestations = agent.attestationMemos.length > 0 ? agent.attestationMemos : (detail?.attestations || []);
                const v3 = detail?.explorer?.v3 || {};

                return (
                <div className="mt-4 pt-3 border-t space-y-2 text-xs" style={{ borderColor: "var(--border)", fontFamily: "var(--font-mono)" }}>
                  {/* Genesis Record Data */}
                  <div className="mb-2">
                    <div className="text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: "var(--accent)" }}>
                      ⛓️ Genesis Record
                    </div>
                    <div className="flex justify-between">
                      <span style={{ color: "var(--text-tertiary)" }}>Authority</span>
                      <a href={`https://explorer.solana.com/address/${agent.wallet}`} target="_blank" rel="noopener noreferrer" className="hover:underline flex items-center gap-1" style={{ color: "var(--accent)" }} onClick={e => e.stopPropagation()}>
                        {agent.wallet.slice(0, 8)}...{agent.wallet.slice(-4)} <ExternalLink size={10} />
                      </a>
                    </div>
                    <div className="flex justify-between">
                      <span style={{ color: "var(--text-tertiary)" }}>PDA</span>
                      <a href={`https://explorer.solana.com/address/${agent.pda}`} target="_blank" rel="noopener noreferrer" className="hover:underline flex items-center gap-1" style={{ color: "var(--accent)" }} onClick={e => e.stopPropagation()}>
                        {agent.pda.slice(0, 8)}...{agent.pda.slice(-4)} <ExternalLink size={10} />
                      </a>
                    </div>
                    <div className="flex justify-between">
                      <span style={{ color: "var(--text-tertiary)" }}>Trust Score</span>
                      <span style={{ color: "var(--text-primary)" }}>{agent.trustScore} / 800</span>
                    </div>
                    <div className="flex justify-between">
                      <span style={{ color: "var(--text-tertiary)" }}>Verification Level</span>
                      <span style={{ color: TIER_COLORS[agent.tier] || "var(--text-primary)" }}>{TIER_LABELS[agent.tier] || `L${agent.verificationLevel} · ${agent.tier}`}</span>
                    </div>
                    <div className="flex justify-between">
                      <span style={{ color: "var(--text-tertiary)" }}>Born (Soulbound)</span>
                      <span style={{ color: "var(--text-primary)" }}>
                        {agent.isBorn || v3.isBorn ? `🔥 ${v3.bornAt ? new Date(v3.bornAt).toLocaleDateString() : "Yes"}` : "❌ Not yet"}
                      </span>
                    </div>
                    {(agent.nftMint || v3.faceMint) && (
                      <div className="flex justify-between">
                        <span style={{ color: "var(--text-tertiary)" }}>Face NFT</span>
                        <a href={`https://explorer.solana.com/address/${agent.nftMint || v3.faceMint}`} target="_blank" rel="noopener noreferrer" className="hover:underline flex items-center gap-1" style={{ color: "var(--accent)" }} onClick={e => e.stopPropagation()}>
                          {(agent.nftMint || v3.faceMint || "").slice(0, 8)}... <ExternalLink size={10} />
                        </a>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span style={{ color: "var(--text-tertiary)" }}>SATP Program</span>
                      <a href={`https://explorer.solana.com/address/${agent.programId}`} target="_blank" rel="noopener noreferrer" className="hover:underline flex items-center gap-1" style={{ color: "var(--accent)" }} onClick={e => e.stopPropagation()}>
                        {agent.programId.slice(0, 8)}... <ExternalLink size={10} />
                      </a>
                    </div>
                    <div className="flex justify-between">
                      <span style={{ color: "var(--text-tertiary)" }}>Registered</span>
                      <span style={{ color: "var(--text-primary)" }}>{formatDateFull(agent.registeredAt)}</span>
                    </div>
                  </div>

                  {/* Attestation List */}
                  <div className="mb-2">
                    <div className="text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: "var(--accent)" }}>
                      🛡️ Attestation Memos ({attestations.length})
                    </div>
                    {isLoading ? (
                      <div className="text-[10px] animate-pulse" style={{ color: "var(--text-tertiary)" }}>Loading attestations...</div>
                    ) : attestations.length > 0 ? (
                      <div className="space-y-1.5 max-h-48 overflow-y-auto">
                        {attestations.map((att: any, i: number) => (
                          <div key={i} className="py-1.5 px-2 rounded" style={{ background: "var(--bg-tertiary)" }}>
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-1.5">
                                <span className="text-[10px]">{PLATFORM_ICONS[att.platform] || "✓"}</span>
                                <span className="text-[10px] font-semibold uppercase" style={{ color: "var(--text-primary)" }}>{att.platform}</span>
                              </div>
                              {att.txSignature ? (
                                <a
                                  href={att.solscanUrl || `https://solscan.io/tx/${att.txSignature}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="hover:underline flex items-center gap-1 text-[9px]"
                                  style={{ color: "var(--accent)" }}
                                  onClick={e => e.stopPropagation()}
                                  title={att.txSignature}
                                >
                                  {att.txSignature.slice(0, 8)}...{att.txSignature.slice(-4)} <ExternalLink size={8} />
                                </a>
                              ) : (
                                <span className="text-[9px]" style={{ color: "var(--text-tertiary)" }}>no tx</span>
                              )}
                            </div>
                            {att.memo && (
                              <div className="text-[9px] mt-0.5 truncate" style={{ color: "var(--text-tertiary)" }} title={att.memo}>
                                {att.memo}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>No attestation memos found</div>
                    )}
                  </div>

                  {/* Reviews */}
                  {agent.reviewCount > 0 && (
                    <div className="flex justify-between">
                      <span style={{ color: "var(--text-tertiary)" }}>Reviews</span>
                      <span style={{ color: "#F59E0B" }}>{"★".repeat(Math.round(agent.reviewAvg))} {agent.reviewAvg.toFixed(1)} ({agent.reviewCount})</span>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex gap-2 mt-3">
                    {agent.profileId && (
                      <Link
                        href={`/profile/${agent.profileId}`}
                        className="flex-1 block text-center py-2 rounded-lg text-[11px] font-semibold uppercase tracking-wider"
                        style={{ background: "var(--accent)", color: "#fff" }}
                        onClick={e => e.stopPropagation()}
                      >
                        Profile →
                      </Link>
                    )}
                    {agent.profileId && (
                      <a
                        href={agent.trustCredentialUrl || `/api/trust-credential/${agent.profileId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-1 block text-center py-2 rounded-lg text-[11px] font-semibold uppercase tracking-wider"
                        style={{ background: "var(--bg-tertiary)", color: "var(--text-primary)", border: "1px solid var(--border)" }}
                        onClick={e => e.stopPropagation()}
                      >
                        Trust Credential →
                      </a>
                    )}
                  </div>
                </div>
                );
              })()}
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
          <a href="/api/satp/explorer/agents" target="_blank" rel="noopener noreferrer" className="hover:underline" style={{ color: "var(--accent)" }}>
            Raw API →
          </a>
        </p>
      </div>
    </div>
  );
}
