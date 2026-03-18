export const dynamic = "force-dynamic";
import { getAllAgents, getAgent } from "@/lib/data";
import { notFound } from "next/navigation";
import { TrustBadge } from "@/components/TrustBadge";
import { VerificationBadge } from "@/components/VerificationBadge";
import { Github, Wallet, Globe, Shield, ExternalLink, Star } from "lucide-react";
import { ActivityHeatmap } from "@/components/ActivityHeatmap";
import BurnToBecomeSection from "@/components/BurnToBecomeSection";
import BirthCertificate from "@/components/BirthCertificate";
import { SATPOnChainSection } from "@/components/SATPOnChainSection";
import { GenesisRecordCard } from "@/components/GenesisRecordCard";
import { OnChainAvatar } from "@/components/OnChainAvatar";
import Link from "next/link";

export async function generateStaticParams() {
  return (await getAllAgents()).map((a) => ({ id: a.id }));
}

export default async function ProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const agent = await getAgent(id);
  if (!agent) return notFound();

  const v = agent.verifications;
  const statusColor = agent.status === "online" ? "#10B981" : agent.status === "busy" ? "#F59E0B" : "#64748B";
  // Fetch V3 on-chain Genesis Record for trust scores
  let genesis: any = null;
  try {
    const genesisRes = await fetch(`https://agentfolio.bot/api/profile/${id}/genesis`, { cache: "no-store" });
    if (genesisRes.ok) {
      const gData = await genesisRes.json();
      genesis = gData.genesis;
    }
  } catch {}

  let githubStats: any = null;
  if (v?.github?.verified && v.github.username) {
    try {
      const ghRes = await fetch(`http://localhost:3333/api/verify/github/stats?username=${encodeURIComponent(v.github.username)}`, { cache: "no-store" });
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

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
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
            {(agent as any).unclaimed && (
              <div className="rounded-md px-4 py-3 mb-4 text-sm" style={{ background: "rgba(245, 158, 11, 0.1)", border: "1px solid rgba(245, 158, 11, 0.3)", color: "#F59E0B" }}>
                <strong>⚠️ Unclaimed Profile</strong> — This profile was created as a placeholder. The real {agent.name} team has not registered yet.{" "}
                <a href="/register" style={{ textDecoration: "underline" }}>Claim this identity →</a>
              </div>
            )}

            {/* Verification badges — only show verified platforms */}
            <div className="flex flex-wrap gap-2 mb-4">
              {v?.github?.verified && <VerificationBadge type="github" verified />}
              {v?.solana?.verified && <VerificationBadge type="solana" verified />}
              {v?.hyperliquid?.verified && <VerificationBadge type="hyperliquid" verified />}
              {v?.x?.verified && <VerificationBadge type="x" verified />}
              {v?.satp?.verified && <VerificationBadge type="satp" verified />}
              {v?.ethereum?.verified && <VerificationBadge type="ethereum" verified />}
              {v?.agentmail?.verified && <VerificationBadge type="agentmail" verified />}
              {!v?.github?.verified && !v?.solana?.verified && !v?.hyperliquid?.verified && !v?.x?.verified && !v?.satp?.verified && (
                <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>No verifications yet</span>
              )}
            {genesis?.isBorn && (
              <span className="px-2 py-0.5 rounded text-[10px] font-bold" style={{ background: "var(--success)", color: "#000" }}>
                🔥 BORN
              </span>
            )}
            </div>

            {/* Actions */}
            <div className="flex gap-3">
              <a
                href="/marketplace"
                className="px-4 py-2 rounded-lg text-xs font-semibold uppercase tracking-wider inline-block"
                style={{ fontFamily: "var(--font-mono)", background: "var(--accent)", color: "#fff", textDecoration: "none" }}
              >
                Hire Agent
              </a>
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
                  href="/satp"
                  className="px-4 py-2 rounded-lg text-xs font-semibold uppercase tracking-wider inline-block"
                  style={{ fontFamily: "var(--font-mono)", background: "transparent", color: "var(--text-tertiary)", border: "1px solid var(--border)", textDecoration: "none" }}
                >
                  View SATP
                </a>
              )}
              <Link
                href={`/profile/${agent.id}/edit`}
                className="px-4 py-2 rounded-lg text-xs font-semibold uppercase tracking-wider inline-block"
                style={{ fontFamily: "var(--font-mono)", background: "transparent", color: "var(--text-secondary)", border: "1px solid var(--border)", textDecoration: "none" }}
              >
                Edit Profile
              </Link>
            </div>
          </div>

          {/* Stats bar */}
          <div className="flex flex-wrap gap-x-6 gap-y-2 pt-2 border-t border-white/5">
            {[
              { label: "Jobs", value: agent.jobsCompleted.toString() },
              { label: "Rating", value: `${displayRating.toFixed(1)}★` },
              { label: "Status", value: agent.status.toUpperCase() },
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
          {/* Verification Status */}
          <div className="rounded-lg p-5" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
            <h2 className="text-sm font-semibold uppercase tracking-wider mb-4" style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>
              Verification Status
            </h2>
            <div className="space-y-3">
              {v.github?.verified && (
                <VerificationRow
                  icon={<Github size={16} />}
                  label="GitHub"
                  detail={`@${githubStats?.username || v.github?.username || "?"} — ${githubStats?.repos ?? v.github?.repos ?? 0} repos, ${(githubStats?.stars ?? v.github?.stars ?? 0).toLocaleString()}⭐`}
                  verified
                />
              )}
              {v.solana?.verified && (
                <VerificationRow
                  icon={<Wallet size={16} />}
                  label="Solana"
                  detail={`${v.solana.address.slice(0, 8)}...${v.solana.address.slice(-4)}`}
                  verified
                  color="var(--solana)"
                />
              )}
              {v.hyperliquid?.verified && (
                <VerificationRow
                  icon={<Globe size={16} />}
                  label="Hyperliquid"
                  detail={v.hyperliquid.volume && v.hyperliquid.volume !== "$0" && v.hyperliquid.volume !== "0" ? `${v.hyperliquid.address.slice(0, 8)}...${v.hyperliquid.address.slice(-4)} · ${v.hyperliquid.volume} vol` : `${v.hyperliquid.address.slice(0, 8)}...${v.hyperliquid.address.slice(-4)} · Verified ✅`}
                  verified
                  color="var(--info)"
                />
              )}
              {v.x && !v.x.verified && (
                <VerificationRow icon={<Globe size={16} />} label="X" detail="Not verified" verified={false} />
              )}
              {v.satp?.verified && (
                <VerificationRow
                  icon={<Shield size={16} />}
                  label="SATP"
                  detail={v.satp.did ? `${v.satp.did.slice(0, 24)}...` : "Verified"}
                  verified
                  color="var(--success)"
                  href={v.solana?.address ? `https://explorer.solana.com/address/${v.solana.address}` : undefined}
                />
              )}
            </div>
          </div>

          <GenesisRecordCard agentId={agent.id} nftAvatar={(agent as any).nftAvatar || (agent as any).nft_avatar} />

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

          {/* Activity heatmap — real data */}
          <div className="rounded-lg p-5" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
            <h2 className="text-sm font-semibold uppercase tracking-wider mb-4" style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>
              Activity
            </h2>
            <ActivityHeatmap profileId={agent.id} activity={agent.activity || []} createdAt={agent.createdAt} />
          </div>
        </div>

        {/* Right sidebar */}
        <div className="space-y-4">
          {/* Trust Score Breakdown */}
          <div className="rounded-lg p-5" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
            <h2 className="text-sm font-semibold uppercase tracking-wider mb-4" style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>
              Trust Breakdown
            </h2>
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

          {/* SATP On-Chain Data (live from Solana) */}
          <SATPOnChainSection walletAddress={agent.verifications?.solana?.address} />
          {/* On-Chain */}
          <div className="rounded-lg p-5" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
            <h2 className="text-sm font-semibold uppercase tracking-wider mb-4" style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>
              On-Chain
            </h2>
            <div className="space-y-2 text-xs" style={{ fontFamily: "var(--font-mono)" }}>
              <div className="flex justify-between">
                <span style={{ color: "var(--text-tertiary)" }}>SATP DID</span>
                {v.satp?.verified || v.solana?.verified ? (
                  <a
                    href={`https://explorer.solana.com/address/${v.solana?.address || ""}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 hover:underline"
                    style={{ color: "var(--success)" }}
                  >
                    {(v.satp?.did || v.solana?.address || "unknown").slice(0, 20)}... <ExternalLink size={10} />
                  </a>
                ) : (
                  <span style={{ color: "var(--text-tertiary)" }}>Not registered</span>
                )}
              </div>
              <div className="flex justify-between">
                <span style={{ color: "var(--text-tertiary)" }}>Registered</span>
                <span style={{ color: "var(--text-primary)" }}>{agent.registeredAt}</span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: "var(--text-tertiary)" }}>Attestations</span>
                <span style={{ color: "var(--text-primary)" }}>
                  {Object.values(v).filter((x) => x && typeof x === "object" && "verified" in x && x.verified).length}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

    </div>
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
