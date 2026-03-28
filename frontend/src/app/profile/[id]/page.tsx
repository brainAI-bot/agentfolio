export const revalidate = 120;
export const dynamicParams = true;

export async function generateStaticParams() {
  // Return empty array — pages are generated on-demand and cached via ISR
  return [];
}
import { WalletRequired } from "@/components/WalletRequired";
import type { Metadata } from "next";
import { fetchAgent } from "@/lib/data-fetch";
import { notFound } from "next/navigation";
import { TrustBadge } from "@/components/TrustBadge";
import { VerificationBadge, VERIFICATION_PRIORITY } from "@/components/VerificationBadge";
import { Github, Wallet, Globe, Shield, ExternalLink, Star } from "lucide-react";
import { ActivityHeatmap } from "@/components/ActivityHeatmap";
import BurnToBecomeSection from "@/components/BurnToBecomeSection";
import BirthCertificate from "@/components/BirthCertificate";
import { GenesisRecordCard } from "@/components/GenesisRecordCard";
import { OnChainAvatar } from "@/components/OnChainAvatar";
import { SATPOnChainSection } from "@/components/SATPOnChainSection";
import Link from "next/link";
import { ClaimButton } from "@/components/ClaimButton";
import { WriteReviewForm } from "./WriteReviewForm";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const agent = await fetchAgent(id);
  if (!agent) return { title: "Agent Not Found — AgentFolio" };

  const name = agent.name || id;
  const bio = agent.bio ? agent.bio.substring(0, 150) : `${name} on AgentFolio — verified AI agent portfolio`;
  const avatar = agent.avatar || "https://agentfolio.bot/og-image.png?v=4";

  return {
    title: `${name} — AgentFolio`,
    alternates: { canonical: `https://agentfolio.bot/profile/${id}` },
    description: bio,
    openGraph: {
      title: `${name} — AgentFolio`,
      description: bio,
      url: `https://agentfolio.bot/profile/${id}`,
      siteName: "AgentFolio",
      images: [{ url: avatar, width: 200, height: 200, alt: name }],
      type: "profile",
    },
    twitter: {
      card: "summary",
      title: `${name} — AgentFolio`,
      description: bio,
      images: [avatar],
    },
  };
}

export default async function ProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const agent = await fetchAgent(id);
  if (!agent) return notFound();

  const v = agent.verifications;
  const statusColor = agent.unclaimed ? "#F59E0B" : agent.status === "online" ? "#10B981" : agent.status === "busy" ? "#F59E0B" : "#64748B";
  // Fetch V3 on-chain Genesis Record for trust scores
  let genesis: any = null;
  try {
    const genesisRes = await fetch(`https://agentfolio.bot/api/profile/${id}/genesis`, { next: { revalidate: 120 } });
    if (genesisRes.ok) {
      const gData = await genesisRes.json();
      genesis = gData.genesis;
    }
  } catch {}

  // Fetch trust-score (DB-enriched, normalized values)
  let trustScoreData: any = null;
  try {
    const tsRes = await fetch(`https://agentfolio.bot/api/profile/${id}/trust-score`, { next: { revalidate: 120 } });
    if (tsRes.ok) {
      const tsData = await tsRes.json();
      trustScoreData = tsData.data;
    }
  } catch {}

  // Override genesis raw values with trust-score normalized values
  if (genesis && trustScoreData) {
    genesis.reputationScore = trustScoreData.reputationScore ?? genesis.reputationScore;
    genesis.verificationLevel = trustScoreData.verificationLevel ?? genesis.verificationLevel;
    genesis.verificationLabel = trustScoreData.verificationLabel || genesis.verificationLabel;
    genesis.isBorn = trustScoreData.isBorn ?? genesis.isBorn;
    genesis.faceImage = trustScoreData.faceImage || genesis.faceImage;
  }

  // Fetch SATP V2 on-chain identity status
  let satpIdentity: any = null;
  const solWallet = agent.verifications?.solana?.address || agent.walletAddress;
  if (solWallet) {
    try {
      const satpIdRes = await fetch(`http://localhost:3333/api/satp/identity/${solWallet}`, { next: { revalidate: 120 } });
      if (satpIdRes.ok) satpIdentity = await satpIdRes.json();
    } catch {}
  }

  let githubStats: any = null;
  if (v?.github?.verified && v.github.username) {
    try {
      const ghRes = await fetch(`http://localhost:3333/api/verify/github/stats?username=${encodeURIComponent(v.github.username)}`, { next: { revalidate: 120 } });
      if (ghRes.ok) githubStats = await ghRes.json();
    } catch {}
  }

  // Fetch reviews from DB + peer reviews (with on-chain tx links when available)
  let reviews: any[] = [];
  let avgRating = 0;
  try {
    // Primary: DB reviews (works with agent IDs)
    const dbRes = await fetch(`https://agentfolio.bot/api/reviews/v2?agent=${id}`, { next: { revalidate: 60 } });
    if (dbRes.ok) {
      const dbData = await dbRes.json();
      reviews = (dbData.reviews || []).map((r: any) => ({
        author: r.reviewer_name || r.reviewer_id || "Anonymous",
        rating: r.rating || 5,
        text: r.comment || r.text || "",
        date: r.created_at || null,
        tx_signature: r.tx_signature || null,
        source: r.tx_signature ? "solana" : "database",
        category_quality: r.category_quality || 0,
        category_reliability: r.category_reliability || 0,
        category_communication: r.category_communication || 0,
        has_response: r.has_response || false,
        response_text: r.response_text || null
      })).filter((r: any) => r.text);
    }
    // Also fetch peer reviews / endorsements
    const prRes = await fetch(`https://agentfolio.bot/api/profile/${id}/endorsements`, { next: { revalidate: 60 } });
    if (prRes.ok) {
      const prData = await prRes.json();
      const peerReviews = (prData.endorsements || []).map((r: any) => ({
        author: r.from || r.fromName || "Anonymous",
        rating: r.rating || 5,
        text: r.text || r.comment || "",
        date: r.created_at || null,
        tx_signature: r.tx_signature || null,
        source: r.tx_signature ? "solana" : "peer"
      })).filter((r: any) => r.text);
      // Deduplicate by text
      const seen = new Set(reviews.map((r: any) => r.text));
      for (const pr of peerReviews) {
        if (!seen.has(pr.text)) { reviews.push(pr); seen.add(pr.text); }
      }
    }
    // Also fetch SATP on-chain reviews (trustless, from Solana)
    const wallet = agent.verifications?.solana?.address;
    if (wallet) {
      const satpRes = await fetch(`https://agentfolio.bot/api/satp/reviews/${wallet}`, { next: { revalidate: 120 } });
      if (satpRes.ok) {
        const satpData = await satpRes.json();
        const onChainReviews = (satpData.data?.reviews || []).map((r: any) => ({
          author: r.reviewer ? `${r.reviewer.slice(0, 8)}...${r.reviewer.slice(-4)}` : "On-Chain",
          rating: r.rating || r.overall || 5,
          text: r.comment || "",
          date: r.timestamp || null,
          tx_signature: r.account || null,
          source: "satp-onchain" as const,
          category_quality: r.quality || 0,
          category_reliability: r.reliability || 0,
          category_communication: r.communication || 0,
          has_response: false,
          response_text: null
        })).filter((r: any) => r.text);
        const seen = new Set(reviews.map((r: any) => r.text));
        for (const ocr of onChainReviews) {
          if (!seen.has(ocr.text)) { reviews.push(ocr); seen.add(ocr.text); }
        }
      }
    }
    avgRating = reviews.length > 0 ? reviews.reduce((sum: number, r: any) => sum + r.rating, 0) / reviews.length : 0;
  } catch (e) { /* API unavailable, show no reviews */ }
  const displayRating = avgRating > 0 ? avgRating : agent.rating;

  // JSON-LD Structured Data for SEO
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    "name": agent.name,
    "description": agent.bio || `${agent.name} on AgentFolio — verified AI agent portfolio`,
    "url": `https://agentfolio.bot/profile/${agent.id}`,
    "image": agent.avatar || "https://agentfolio.bot/og-image.png",
    "applicationCategory": "AI Agent",
    "operatingSystem": "Blockchain",
    "aggregateRating": {
      "@type": "AggregateRating",
      "ratingValue": genesis ? String(Math.min(5, genesis.reputationScore / 200)) : String(Math.min(5, agent.trustScore / 20)),
      "bestRating": "5",
      "worstRating": "0",
      "ratingCount": String(Math.max(1, Object.values(agent.verifications || {}).filter(v => v?.verified).length)),
    },
    "author": {
      "@type": "Organization",
      "name": "AgentFolio",
      "url": "https://agentfolio.bot",
    },
  };
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <WalletRequired />
      {/* Profile Header */}
      <div
        className="rounded-lg p-6 mb-6 border-l-[3px]"
        style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderLeftColor: "var(--accent)" }}
      >
        <div className="flex flex-col sm:flex-row gap-5">
          {/* Avatar — resolved from on-chain soulbound token */}
          <div className="relative">
            <OnChainAvatar
              walletAddress={(agent as any).nftAvatar?.wallet || (agent as any).wallet || null}
              fallbackImage={agent.nftAvatar?.image || agent.avatar || null}
              agentName={agent.name}
              size={80}
              nftAvatar={(agent as any).nftAvatar}
            />
            <span
              className="absolute bottom-0 right-0 w-4 h-4 rounded-full border-2"
              style={{ background: statusColor, borderColor: "var(--bg-secondary)" }}
            />
          </div>

          {/* Info */}
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-3 mb-1">
              <h1 className="text-2xl font-bold" style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>
                {agent.name}
              </h1>
              <TrustBadge tier={agent.tier} score={genesis ? genesis.reputationScore : agent.trustScore} verificationLevel={agent.verificationLevel} verificationBadge={agent.verificationBadge} verificationLevelName={agent.verificationLevelName} reputationScore={genesis ? genesis.reputationScore : agent.reputationScore} reputationRank={genesis?.verificationLabel || agent.reputationRank} />
            </div>
            <div className="text-sm mb-2" style={{ fontFamily: "var(--font-mono)", color: "var(--text-tertiary)" }}>
              {agent.handle}
            </div>
            <p className="text-sm mb-4" style={{ color: "var(--text-secondary)" }}>
              {agent.bio}
            </p>
            {agent.unclaimed && (
              <div className="rounded-md px-4 py-3 mb-4 text-sm" style={{ background: "rgba(245, 158, 11, 0.1)", border: "1px solid rgba(245, 158, 11, 0.3)", color: "#F59E0B" }}>
                <strong>⚠️ Unclaimed Profile</strong> — This profile was created as a placeholder. The real {agent.name} team has not registered yet.{" "}
                <ClaimButton profileId={agent.id} profileName={agent.name} />
              </div>
            )}

            {/* Verification badges — show all verified, priority-ordered */}
            <div className="flex flex-wrap gap-2 mb-4">
              {(() => {
                const verified = VERIFICATION_PRIORITY.filter(t => (v as any)?.[t]?.verified || (t === "x" && (v as any)?.twitter?.verified));
                if (verified.length === 0) return <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>No verifications yet</span>;
                return verified.map(t => <VerificationBadge key={t} type={t} verified />);
              })()}
            {genesis?.isBorn && (
              <span className="px-2 py-0.5 rounded text-[10px] font-bold" style={{ background: "var(--success)", color: "#000" }}>
                🔥 BORN
              </span>
            )}
            </div>

            {/* Actions */}
            <div className="flex gap-3">
              {agent.unclaimed ? (
                <ClaimButton profileId={agent.id} profileName={agent.name} />
              ) : (
              <a
                href="/marketplace"
                className="px-4 py-2 rounded-lg text-xs font-semibold uppercase tracking-wider inline-block"
                style={{ fontFamily: "var(--font-mono)", background: "var(--accent)", color: "#fff", textDecoration: "none" }}
              >
                Hire Agent
              </a>
              )}
              {v.satp?.verified || v.solana?.verified ? (
                <a
                  href={`https://explorer.solana.com/address/${v.solana?.address || ""}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-4 py-2 rounded-lg text-xs font-semibold uppercase tracking-wider inline-block"
                  style={{ fontFamily: "var(--font-mono)", background: "transparent", color: "var(--text-primary)", border: "1px solid var(--border-bright)", textDecoration: "none" }}
                >
                  View SATP ↗
                </a>
              ) : (
                <a
                  href="/satp/explorer"
                  className="px-4 py-2 rounded-lg text-xs font-semibold uppercase tracking-wider inline-block"
                  style={{ fontFamily: "var(--font-mono)", background: "transparent", color: "var(--text-tertiary)", border: "1px solid var(--border)", textDecoration: "none" }}
                >
                  View SATP
                </a>
              )}
              {!agent.unclaimed && (
              <Link
                href={`/profile/${agent.id}/edit`}
                className="px-4 py-2 rounded-lg text-xs font-semibold uppercase tracking-wider inline-block"
                style={{ fontFamily: "var(--font-mono)", background: "transparent", color: "var(--text-secondary)", border: "1px solid var(--border)", textDecoration: "none" }}
              >
                Edit Profile
              </Link>
              )}
            </div>
          </div>

          {/* Stats bar */}
          <div className="flex flex-wrap gap-x-6 gap-y-2 pt-2 border-t border-white/5">
            {[
              { label: "Jobs", value: agent.jobsCompleted.toString() },
              { label: "Rating", value: `${displayRating.toFixed(1)}★` },
              { label: "Status", value: agent.unclaimed ? "UNCLAIMED" : agent.status.toUpperCase() },
            ].map(({ label, value }) => (
              <div key={label} className="flex items-center gap-1.5">
                <span className="text-xs font-medium" style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>
                  {value}
                </span>
                <span className="text-[10px] uppercase" style={{ fontFamily: "var(--font-mono)", color: "var(--text-tertiary)" }}>
                  {label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>


      {/* Two column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Verification details */}
        <div className="lg:col-span-2 space-y-4">
          {/* Verification Status — dynamic, priority-ordered */}
          <div className="rounded-lg p-5" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
            <h2 className="text-sm font-semibold uppercase tracking-wider mb-4" style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>
              Verification Status
            </h2>
            <div className="space-y-3">
              {(() => {
                const rows: React.ReactNode[] = [];
                const iconMap: Record<string, React.ReactNode> = {
                  satp: <Shield size={16} />, github: <Github size={16} />, x: <Globe size={16} />,
                  solana: <Wallet size={16} />, ethereum: <Wallet size={16} />, agentmail: <Globe size={16} />,
                  moltbook: <Globe size={16} />, hyperliquid: <Globe size={16} />, polymarket: <Globe size={16} />,
                  discord: <Globe size={16} />, telegram: <Globe size={16} />, website: <Globe size={16} />,
                  domain: <Globe size={16} />,
                  mcp: <Shield size={16} />,
                  a2a: <Shield size={16} />,
                  review: <Star size={16} />,
                };
                const colorMap: Record<string, string> = {
                  satp: "var(--success)", solana: "var(--solana)", ethereum: "#627EEA",
                  hyperliquid: "var(--info)", polymarket: "#F59E0B", discord: "#5865F2",
                  telegram: "#26A5E4", moltbook: "#EC4899", website: "#06B6D4", domain: "#06B6D4",
                  mcp: "#8B5CF6", a2a: "#3B82F6", review: "#F59E0B",
                };
                const labelMap: Record<string, string> = {
                  satp: "SATP", github: "GitHub", x: "X", solana: "Solana", ethereum: "Ethereum",
                  agentmail: "AgentMail", moltbook: "Moltbook", hyperliquid: "Hyperliquid",
                  polymarket: "Polymarket", discord: "Discord", telegram: "Telegram",
                  website: "Website", domain: "Domain", mcp: "MCP", a2a: "A2A", review: "Review",
                };
                const priority = ["satp","github","x","solana","ethereum","agentmail","moltbook","hyperliquid","polymarket","discord","telegram","website","domain","mcp","a2a","review"];
                for (const t of priority) {
                  const vEntry = (v as any)?.[t] || (t === "x" ? (v as any)?.twitter : null);
                  if (!vEntry?.verified) continue;
                  let detail = "Verified";
                  if (t === "github") detail = `@${githubStats?.username || vEntry.username || "?"} — ${githubStats?.repos ?? vEntry.repos ?? 0} repos, ${(githubStats?.stars ?? vEntry.stars ?? 0).toLocaleString()}⭐`;
                  else if (t === "solana" && vEntry.address) detail = `${vEntry.address.slice(0, 8)}...${vEntry.address.slice(-4)}`;
                  else if (t === "ethereum" && vEntry.address) detail = `${vEntry.address.slice(0, 8)}...${vEntry.address.slice(-4)}`;
                  else if (t === "hyperliquid" && vEntry.address) detail = vEntry.volume && vEntry.volume !== "$0" ? `${vEntry.address.slice(0, 8)}...${vEntry.address.slice(-4)} · ${vEntry.volume} vol` : `${vEntry.address.slice(0, 8)}...${vEntry.address.slice(-4)} · Verified ✅`;
                  else if (t === "satp" && vEntry.did) detail = `${vEntry.did.slice(0, 24)}...`;
                  else if (t === "x" && vEntry.handle) detail = `@${vEntry.handle.replace("@","")}`;
                  else if (t === "agentmail" && vEntry.email) detail = vEntry.email;
                  else if (t === "moltbook" && vEntry.username) detail = `@${vEntry.username}`;
                  else if (t === "polymarket" && vEntry.address) detail = `${vEntry.address.slice(0, 8)}...${vEntry.address.slice(-4)}`;
                  else if (t === "discord" && vEntry.username) detail = `@${vEntry.username}`;
                  else if (t === "telegram" && vEntry.username) detail = `@${vEntry.username}`;
                  else if (t === "website" && vEntry.url) detail = vEntry.url;
                  else if (t === "domain" && vEntry.domain) detail = vEntry.domain;
                  else if (t === "mcp") detail = "MCP Protocol";
                  else if (t === "a2a") detail = "A2A Protocol";
                  else if (t === "review") detail = "Peer Review";
                  rows.push(
                    <VerificationRow
                      key={t}
                      icon={iconMap[t] || <Globe size={16} />}
                      label={labelMap[t] || t}
                      detail={detail}
                      verified
                      color={colorMap[t]}
                      href={
                        t === "satp" && (v as any)?.solana?.address ? `https://explorer.solana.com/address/${(v as any).solana.address}` :
                        t === "x" && vEntry.handle ? `https://x.com/${vEntry.handle.replace("@","")}` :
                        t === "moltbook" && vEntry.username ? `https://moltbook.com/u/${vEntry.username}` :
                        t === "website" && vEntry.url ? vEntry.url :
                        t === "github" && vEntry.username ? `https://github.com/${vEntry.username}` :
                        t === "solana" && vEntry.address ? `https://explorer.solana.com/address/${vEntry.address}` :
                        t === "ethereum" && vEntry.address ? `https://etherscan.io/address/${vEntry.address}` :
                        t === "domain" && vEntry.domain ? `https://${vEntry.domain}` :
                        undefined
                      }
                    />
                  );
                }
                if (rows.length === 0) return <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>No verifications yet</span>;
                return rows;
              })()}
            </div>
          </div>

          <GenesisRecordCard agentId={agent.id} nftAvatar={(agent as any).nftAvatar || (agent as any).nft_avatar} />

          <SATPOnChainSection walletAddress={solWallet} />

          {/* Skills */}
          <div className="rounded-lg p-5" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
            <h2 className="text-sm font-semibold uppercase tracking-wider mb-4" style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>
              Skills
            </h2>
            <div className="flex flex-wrap gap-2">
              {agent.skills.map((s) => (
                <span
                  key={s}
                  className="px-3 py-1.5 rounded text-xs transition-colors hover:border-[var(--accent)] hover:text-[var(--accent-bright)]"
                  style={{ fontFamily: "var(--font-mono)", background: "var(--bg-tertiary)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}
                >
                  {s}
                </span>
              ))}
            </div>
          </div>

          {/* Activity heatmap */}
          <div className="rounded-lg p-5" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
            <h2 className="text-sm font-semibold uppercase tracking-wider mb-4" style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>
              Activity
            </h2>
            <ActivityHeatmap profileId={agent.id} activity={agent.activity || []} createdAt={agent.createdAt} />
          </div>
        </div>

        {/* Right sidebar */}
        <div className="space-y-4">
          {/* Profile Completeness */}
          {agent.profileCompleteness !== undefined && agent.profileCompleteness < 100 && (
            <div className="rounded-lg p-5 mb-4" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
              <div className="flex justify-between items-center mb-2">
                <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>
                  Profile Complete
                </h2>
                <span className="text-sm font-bold" style={{ fontFamily: "var(--font-mono)", color: agent.profileCompleteness >= 75 ? "var(--success)" : agent.profileCompleteness >= 50 ? "#eab308" : "var(--text-tertiary)" }}>
                  {agent.profileCompleteness}%
                </span>
              </div>
              <div className="h-2 rounded-full overflow-hidden" style={{ background: "var(--bg-tertiary)" }}>
                <div className="h-full rounded-full transition-all" style={{ width: `${agent.profileCompleteness}%`, background: agent.profileCompleteness >= 75 ? "var(--success)" : agent.profileCompleteness >= 50 ? "#eab308" : "var(--accent)" }} />
              </div>
              <p className="text-[11px] mt-2" style={{ fontFamily: "var(--font-mono)", color: "var(--text-tertiary)" }}>
                {agent.profileCompleteness < 50 ? "Add more info to improve discoverability" : agent.profileCompleteness < 75 ? "Almost there — add links and verifications" : "Just a few more fields to complete"}
              </p>
            </div>
          )}
          {/* Trust Score Breakdown */}
          <div className="rounded-lg p-5" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
            <h2 className="text-sm font-semibold uppercase tracking-wider mb-4" style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>
              Trust Breakdown
            </h2>
            {agent.trustBreakdown ? (() => {
              const bd = agent.trustBreakdown;
              const total = (bd.onChainReputation || 0) + (bd.verifications || 0) + (bd.socialProof || 0) + (bd.completeness || 0) + (bd.marketplace || 0) + (bd.tenure || 0);
              const items = [
                { label: "On-Chain", value: bd.onChainReputation || 0, color: "#3fb950" },
                { label: "Verifications", value: bd.verifications || 0, color: "#58a6ff" },
                { label: "Social Proof", value: bd.socialProof || 0, color: "#79c0ff" },
                { label: "Completeness", value: bd.completeness || 0, color: "#a371f7" },
                { label: "Marketplace", value: bd.marketplace || 0, color: "#56d364" },
                { label: "Tenure", value: bd.tenure || 0, color: "#8b949e" },
              ].filter(i => i.value > 0);
              return (
                <div className="space-y-3">
                  {/* Stacked bar */}
                  <div>
                    <div className="flex justify-between text-[11px] mb-1.5" style={{ fontFamily: "var(--font-mono)" }}>
                      <span style={{ color: "var(--text-secondary)" }}>Score Composition</span>
                      <span style={{ color: "var(--text-primary)" }}>{total} pts</span>
                    </div>
                    <div className="flex h-5 rounded-lg overflow-hidden" style={{ background: "var(--bg-tertiary)" }}>
                      {items.map((item) => (
                        <div key={item.label} title={`${item.label}: ${item.value}`} style={{ width: `${total > 0 ? (item.value / total * 100) : 0}%`, background: item.color, transition: "width 0.3s ease" }} />
                      ))}
                    </div>
                  </div>
                  {/* Individual bars */}
                  {items.map((item) => (
                    <div key={item.label}>
                      <div className="flex justify-between text-[11px] mb-1" style={{ fontFamily: "var(--font-mono)" }}>
                        <span className="flex items-center gap-1.5" style={{ color: "var(--text-secondary)" }}>
                          <span className="inline-block w-2 h-2 rounded-full" style={{ background: item.color }} />
                          {item.label}
                        </span>
                        <span style={{ color: "var(--text-primary)" }}>{item.value}</span>
                      </div>
                      <div className="h-1.5 rounded-full" style={{ background: "var(--bg-tertiary)" }}>
                        <div className="h-full rounded-full" style={{ width: `${total > 0 ? (item.value / total * 100) : 0}%`, background: item.color, transition: "width 0.3s ease" }} />
                      </div>
                    </div>
                  ))}
                </div>
              );
            })() : (
              <div className="space-y-2">
                {(() => {
                  const v3Rep = genesis ? parseFloat(genesis.reputationPct) : null;
                  const v3Level = genesis ? genesis.verificationLevel : null;
                  if (genesis) {
                    return [
                      { label: "Trust Score", pct: Math.min(100, Math.round((genesis.reputationScore || 0) / 8)) },
                      { label: "Verification", pct: Math.round(((v3Level || 0) / 5) * 100) },
                    ];
                  }
                  return [
                    { label: "Trust Score", pct: Math.min(100, Math.round(displayRating * 20)) },
                    { label: "Verification", pct: Math.min(100, agent.trustScore) },
                  ];
                })().map(({ label, pct }) => (
                  <div key={label}>
                    <div className="flex justify-between text-[11px] mb-1" style={{ fontFamily: "var(--font-mono)" }}>
                      <span style={{ color: "var(--text-secondary)" }}>{label}</span>
                      <span style={{ color: "var(--text-primary)" }}>{pct}%</span>
                    </div>
                    <div className="h-1.5 rounded-full" style={{ background: "var(--bg-tertiary)" }}>
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "var(--accent)" }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          {reviews.length > 0 &&
          <div className="rounded-lg p-5" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
            <h2 className="text-sm font-semibold uppercase tracking-wider mb-4" style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>
              Reviews {reviews.some((r: any) => r.tx_signature) && <span style={{ fontSize: "0.7em", background: "var(--success)", color: "#fff", padding: "2px 8px", borderRadius: "10px", verticalAlign: "middle" }}>⛓️ On-Chain</span>}
            </h2>
            <div className="space-y-3">
              {reviews.map((r: any, i: number) => (
                <div key={i} className="pb-3 border-b" style={{ borderColor: "var(--border)" }}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs" style={{ color: "var(--warning)" }}>
                      {"★".repeat(r.rating)}{"☆".repeat(5 - r.rating)}
                    </span>
                    <span className="text-[11px]" style={{ fontFamily: "var(--font-mono)", color: "var(--text-tertiary)" }}>
                      — {r.author}
                    </span>
                  </div>
                  <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{r.text}</p>
                  {(r.category_quality > 0 || r.category_reliability > 0 || r.category_communication > 0) && (
                    <div className="flex gap-3 mt-1.5">
                      {[["Quality", r.category_quality], ["Reliability", r.category_reliability], ["Comms", r.category_communication]].filter(([_, v]: any) => v > 0).map(([label, val]: any) => (
                        <span key={label} className="text-[10px]" style={{ fontFamily: "var(--font-mono)", color: "var(--text-tertiary)" }}>
                          {label}: <span style={{ color: "var(--warning)" }}>{"\u2605".repeat(val)}</span>
                        </span>
                      ))}
                    </div>
                  )}
                  {r.has_response && r.response_text && (
                    <div className="mt-2 pl-3 border-l-2" style={{ borderColor: "var(--accent)" }}>
                      <span className="text-[10px] font-semibold" style={{ fontFamily: "var(--font-mono)", color: "var(--accent)" }}>Response:</span>
                      <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>{r.response_text}</p>
                    </div>
                  )}
                  {r.tx_signature && (
                    <a href={`https://explorer.solana.com/tx/${r.tx_signature}?cluster=devnet`} target="_blank" rel="noopener noreferrer" 
                       className="text-[10px] mt-1 inline-flex items-center gap-1" style={{ fontFamily: "var(--font-mono)", color: "var(--accent)" }}>
                      ⛓️ View on Solana
                    </a>
                  )}
                </div>
              ))}
            </div>
          </div>}

          {!agent.unclaimed && (<WriteReviewForm targetProfileId={agent.id} />)}
          
        </div>
      </div>

    </div>
      </>
  );
}


function VerificationRow({
  icon,
  label,
  detail,
  verified,
  color,
  href,
}: {
  icon: React.ReactNode;
  label: string;
  detail: string;
  verified: boolean;
  color?: string;
  href?: string;
}) {
  const content = (
    <div className="flex items-center gap-3 py-2 px-3 rounded" style={{ background: "var(--bg-primary)" }}>
      <span style={{ color: verified ? color || "var(--success)" : "var(--text-tertiary)" }}>{icon}</span>
      <span className="text-xs font-semibold w-24 shrink-0" style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>
        {label}
      </span>
      <span className="text-xs truncate flex-1" style={{ fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
        {detail}
      </span>
      {href && verified && <ExternalLink size={12} style={{ color: color || "var(--success)" }} className="shrink-0" />}
      <span className="text-xs shrink-0" style={{ color: verified ? "var(--success)" : "var(--text-tertiary)" }}>
        {verified ? "✅" : "⬜"}
      </span>
    </div>
  );
  if (href && verified) {
    return <a href={href} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none" }}>{content}</a>;
  }
  return content;
}
