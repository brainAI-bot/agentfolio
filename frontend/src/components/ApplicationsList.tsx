"use client";

import { useState, useEffect } from "react";
import { Shield } from "lucide-react";
import Link from "next/link";
import { getTrustSurface } from "@/lib/trust-surface";
import { useWallet } from "@solana/wallet-adapter-react";
import { signMarketplaceAction } from "@/lib/marketplace-auth";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3333";

interface Application {
  id: string;
  applicantId: string;
  applicantName?: string;
  applicantAvatar?: string;
  applicantProfileId?: string;
  proposal: string;
  coverMessage?: string;
  bidAmount?: number;
  proposedBudget?: number;
  proposedTimeline?: string;
  portfolioItems?: string[];
  status: string;
  createdAt: string;
  trustScore?: number;
  rating?: number;
  reviewCount?: number;
  jobsCompleted?: number;
  verificationLevel?: number;
  verificationLevelName?: string;
  verificationBadges?: string[];
}

const badgeIcons: Record<string, string> = {
  solana: "◎",
  github: "💻",
  x: "𝕏",
  satp: "⛓️",
  agentmail: "📧",
};

const levelColors: Record<number, string> = {
  0: "#6b7280",
  1: "#9ca3af",
  2: "#06b6d4",
  3: "#22c55e",
  4: "#eab308",
  5: "#9945ff",
};

function timeAgo(dateStr: string): string {
  const createdAt = new Date(dateStr).getTime();
  if (!Number.isFinite(createdAt)) return "date unavailable";
  const diff = Date.now() - createdAt;
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return mins <= 1 ? "just now" : `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function ApplicationsList({ jobId }: { jobId: string }) {
  const { connected, publicKey, signMessage } = useWallet();
  const [apps, setApps] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewerProfileId, setViewerProfileId] = useState<string | null>(null);
  const [withdrawingId, setWithdrawingId] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/api/jobs/${jobId}/applications`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.applications) {
          setApps(data.applications.filter((a: any) => a && !a.error));
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [jobId]);

  useEffect(() => {
    if (!connected || !publicKey) {
      setViewerProfileId(null);
      return;
    }
    fetch(`${API_BASE}/api/profile-by-wallet?wallet=${publicKey.toBase58()}`)
      .then((response) => response.ok ? response.json() : null)
      .then((profile) => setViewerProfileId(profile?.id || null))
      .catch(() => setViewerProfileId(null));
  }, [connected, publicKey]);

  const withdrawApplication = async (application: Application) => {
    if (!viewerProfileId || !publicKey) return;
    setWithdrawingId(application.id);
    try {
      const walletChallenge = await signMarketplaceAction({
        action: "withdraw",
        resourceId: application.id,
        actorId: viewerProfileId,
        walletAddress: publicKey.toBase58(),
        signMessage,
      });
      const response = await fetch(`${API_BASE}/api/marketplace/applications/${application.id}/withdraw`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ withdrawnBy: viewerProfileId, walletChallenge }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to withdraw application");
      setApps((current) => current.map((item) => item.id === application.id ? { ...item, status: "withdrawn" } : item));
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Unable to withdraw application");
    } finally {
      setWithdrawingId(null);
    }
  };

  if (loading) return (
    <div className="text-xs py-4 text-center" style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>
      Loading applications...
    </div>
  );

  if (apps.length === 0) return (
    <div className="text-xs py-4 text-center" style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>
      No applications yet
    </div>
  );

  return (
    <div className="space-y-3">
      {apps.map(app => {
        const trust = getTrustSurface(app);
        const lvlColor = levelColors[trust.verificationLevel] || "#6b7280";
        const profileUrl = app.applicantProfileId
          ? `/profile/${app.applicantName || app.applicantProfileId}`
          : null;

        return (
          <div
            key={app.id}
            className="rounded-lg p-4"
            style={{
              background: "var(--bg-primary)",
              border: app.status === "accepted"
                ? "1px solid rgba(34,197,94,0.4)"
                : "1px solid var(--border)",
            }}
          >
            {/* Applicant header */}
            <div className="flex items-center gap-3 mb-2">
              {/* Avatar */}
              {app.applicantAvatar ? (
                <img
                  src={app.applicantAvatar}
                  alt={app.applicantName || app.applicantId}
                  className="w-8 h-8 rounded-full object-cover"
                  style={{ border: `2px solid ${lvlColor}` }}
                />
              ) : (
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold"
                  style={{ background: `${lvlColor}20`, color: lvlColor, border: `2px solid ${lvlColor}` }}
                >
                  {(app.applicantName || app.applicantId || "?")[0].toUpperCase()}
                </div>
              )}

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  {profileUrl ? (
                    <Link
                      href={profileUrl}
                      className="text-sm font-bold hover:underline truncate"
                      style={{ color: "var(--text-primary)" }}
                    >
                      {app.applicantName || app.applicantId}
                    </Link>
                  ) : (
                    <span className="text-sm font-bold truncate" style={{ color: "var(--text-primary)" }}>
                      {app.applicantName || app.applicantId}
                    </span>
                  )}

                  {/* Verification level badge */}
                  {trust.verificationLevel > 0 && (
                    <span
                      className="text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap"
                      style={{
                        color: lvlColor,
                        background: `${lvlColor}15`,
                        border: `1px solid ${lvlColor}30`,
                        fontFamily: "var(--font-mono)",
                      }}
                    >
                      {trust.tierLabel}
                    </span>
                  )}

                  {app.status === "accepted" && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ color: "#22c55e", background: "rgba(34,197,94,0.1)", fontFamily: "var(--font-mono)" }}>
                      ✓ ACCEPTED
                    </span>
                  )}
                  {app.status !== "pending" && app.status !== "accepted" && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase" style={{ color: "var(--text-tertiary)", background: "var(--bg-secondary)", fontFamily: "var(--font-mono)" }}>
                      {app.status}
                    </span>
                  )}
                </div>

                {/* Trust score + badges */}
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[10px]" style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>
                    <Shield size={10} className="inline mr-0.5" style={{ verticalAlign: "middle" }} />
                    {trust.trustScoreFraction}
                  </span>
                  <span className="text-[10px]" style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>
                    {trust.reviewSummary}
                  </span>
                  <span className="text-[10px]" style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>
                    {trust.jobHistory}
                  </span>
                  {app.verificationBadges && app.verificationBadges.length > 0 && (
                    <span className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>
                      {app.verificationBadges.map(b => badgeIcons[b] || b).join(" ")}
                    </span>
                  )}
                  <span className="text-[10px]" style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>
                    {timeAgo(app.createdAt)}
                  </span>
                </div>
              </div>

              {/* Bid amount */}
              {(app.proposedBudget ?? app.bidAmount) != null && (app.proposedBudget ?? app.bidAmount ?? 0) > 0 && (
                <div className="text-right">
                  <span className="text-sm font-bold" style={{ color: "var(--solana, #9945ff)", fontFamily: "var(--font-mono)" }}>
                    {app.proposedBudget ?? app.bidAmount} USDC
                  </span>
                  {app.proposedTimeline && (
                    <div className="text-[10px] mt-0.5" style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>
                      {app.proposedTimeline.replaceAll("_", " ")}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Proposal text */}
            <div
              className="text-xs mt-2 leading-relaxed"
              style={{ color: "var(--text-secondary)", paddingLeft: "44px" }}
            >
              {app.coverMessage || app.proposal}
            </div>
            {app.portfolioItems && app.portfolioItems.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-3" style={{ paddingLeft: "44px" }}>
                {app.portfolioItems.map((item) => (
                  <span key={item} className="text-[10px] px-2 py-1 rounded" style={{ background: "var(--bg-secondary)", color: "var(--text-tertiary)", border: "1px solid var(--border)", fontFamily: "var(--font-mono)" }}>
                    {item}
                  </span>
                ))}
              </div>
            )}
            {app.status === "pending" && viewerProfileId === app.applicantId && (
              <div className="mt-3 text-right">
                <button
                  type="button"
                  onClick={() => withdrawApplication(app)}
                  disabled={withdrawingId === app.id}
                  className="text-[10px] px-3 py-1.5 rounded disabled:opacity-50"
                  style={{ color: "var(--text-tertiary)", border: "1px solid var(--border)", fontFamily: "var(--font-mono)" }}
                >
                  {withdrawingId === app.id ? "Signing..." : "Withdraw application"}
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
