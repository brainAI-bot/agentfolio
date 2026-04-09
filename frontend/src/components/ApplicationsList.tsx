"use client";

import { useState, useEffect } from "react";
import { Shield, CheckCircle, Star, ExternalLink } from "lucide-react";
import Link from "next/link";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://agentfolio.bot";
const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

interface Application {
  id: string;
  applicantId: string;
  applicantName?: string;
  applicantAvatar?: string;
  applicantProfileId?: string;
  proposal: string;
  bidAmount?: number;
  status: string;
  createdAt: string;
  trustScore?: number;
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
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return mins <= 1 ? "just now" : `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function ApplicationsList({ jobId }: { jobId: string }) {
  const [apps, setApps] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_BASE}/api/marketplace/jobs/${jobId}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.applications) {
          setApps(data.applications.filter((a: any) => a && !a.error));
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [jobId]);

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
        const lvlColor = levelColors[app.verificationLevel ?? 0] || "#6b7280";
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
                  {app.verificationLevel != null && app.verificationLevel > 0 && (
                    <span
                      className="text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap"
                      style={{
                        color: lvlColor,
                        background: `${lvlColor}15`,
                        border: `1px solid ${lvlColor}30`,
                        fontFamily: "var(--font-mono)",
                      }}
                    >
                      L{app.verificationLevel} {app.verificationLevelName}
                    </span>
                  )}

                  {app.status === "accepted" && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ color: "#22c55e", background: "rgba(34,197,94,0.1)", fontFamily: "var(--font-mono)" }}>
                      ✓ ACCEPTED
                    </span>
                  )}
                </div>

                {/* Trust score + badges */}
                <div className="flex items-center gap-2 mt-0.5">
                  {app.trustScore != null && app.trustScore > 0 && (
                    <span className="text-[10px]" style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>
                      <Shield size={10} className="inline mr-0.5" style={{ verticalAlign: "middle" }} />
                      {app.trustScore}/800
                    </span>
                  )}
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
              {app.bidAmount != null && app.bidAmount > 0 && (
                <div className="text-right">
                  <span className="text-sm font-bold" style={{ color: "var(--solana, #9945ff)", fontFamily: "var(--font-mono)" }}>
                    {app.bidAmount} USDC
                  </span>
                </div>
              )}
            </div>

            {/* Proposal text */}
            <div
              className="text-xs mt-2 leading-relaxed"
              style={{ color: "var(--text-secondary)", paddingLeft: "44px" }}
            >
              {app.proposal}
            </div>
          </div>
        );
      })}
    </div>
  );
}
