"use client";

import { useState, useEffect, useMemo } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { Shield } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createMarketplaceWalletAuth } from "@/lib/marketplace-auth";
import { profileHasWallet } from "@/lib/profile-wallets";

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

export function ApplicationsList({
  jobId,
  initialApplications = [],
  initialPosterId = null,
  initialJobStatus = "open",
}: {
  jobId: string;
  initialApplications?: Application[];
  initialPosterId?: string | null;
  initialJobStatus?: string;
}) {
  const { publicKey, connected, signMessage } = useWallet();
  const router = useRouter();
  const hasInitialData = initialApplications.length > 0 || !!initialPosterId || !!initialJobStatus;
  const [apps, setApps] = useState<Application[]>(initialApplications);
  const [loading, setLoading] = useState(!hasInitialData);
  const [resolvedId, setResolvedId] = useState<string | null>(null);
  const [posterId, setPosterId] = useState<string | null>(initialPosterId);
  const [jobStatus, setJobStatus] = useState<string>(initialJobStatus || "open");
  const [actingId, setActingId] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<{ ok: boolean; msg: string } | null>(null);
  const [posterWalletMatch, setPosterWalletMatch] = useState(false);
  const [posterWalletCheckSettled, setPosterWalletCheckSettled] = useState(false);

  const walletAddr = publicKey?.toBase58() || "";

  const loadJob = (showSpinner = !hasInitialData) => {
    if (showSpinner) setLoading(true);
    fetch(`${API_BASE}/api/marketplace/jobs/${jobId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        setApps((data.applications || []).filter((a: any) => a && !a.error));
        setPosterId(data.clientId || data.postedBy || null);
        setJobStatus(data.status || "open");
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadJob(false);
  }, [jobId]);

  useEffect(() => {
    if (!connected || !publicKey) {
      setResolvedId(null);
      setPosterWalletMatch(false);
      setPosterWalletCheckSettled(false);
      return;
    }
    let cancelled = false;
    fetch(`${API_BASE}/api/profile-by-wallet?wallet=${publicKey.toBase58()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled) setResolvedId(data?.id || null);
      })
      .catch(() => {
        if (!cancelled) setResolvedId(null);
      });
    return () => {
      cancelled = true;
    };
  }, [connected, publicKey]);

  useEffect(() => {
    if (!connected || !walletAddr || !posterId) {
      setPosterWalletMatch(false);
      setPosterWalletCheckSettled(false);
      return;
    }
    let cancelled = false;
    setPosterWalletCheckSettled(false);
    fetch(`${API_BASE}/api/profile/${encodeURIComponent(posterId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((profile) => {
        if (!cancelled) setPosterWalletMatch(profileHasWallet(profile, walletAddr));
      })
      .catch(() => {
        if (!cancelled) setPosterWalletMatch(false);
      })
      .finally(() => {
        if (!cancelled) setPosterWalletCheckSettled(true);
      });
    return () => {
      cancelled = true;
    };
  }, [connected, walletAddr, posterId]);

  const isPoster = useMemo(() => {
    if (!posterId) return false;
    return posterWalletMatch || posterId === resolvedId || posterId === walletAddr;
  }, [posterId, posterWalletMatch, resolvedId, walletAddr]);
  const posterIdentityPending = connected && !!walletAddr && !!posterId && !posterWalletCheckSettled;

  const handleAccept = async (applicationId: string) => {
    const acceptedBy = posterId || resolvedId || walletAddr;
    if (!acceptedBy || !walletAddr) {
      setActionMsg({ ok: false, msg: "Connect the poster wallet to accept an application." });
      return;
    }
    setActingId(applicationId);
    setActionMsg(null);
    try {
      const authHeaders = await createMarketplaceWalletAuth({
        action: "accept_application",
        walletAddress: walletAddr,
        actorId: acceptedBy,
        jobId,
        applicationId,
        signMessage,
      });
      const res = await fetch(`${API_BASE}/api/marketplace/jobs/${jobId}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ applicationId, acceptedBy }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setActionMsg({ ok: true, msg: "Application accepted. Refreshing job actions..." });
      loadJob(false);
      router.refresh();
      setTimeout(() => {
        window.location.reload();
      }, 400);
    } catch (e: any) {
      setActionMsg({ ok: false, msg: e.message || "Failed to accept application" });
    } finally {
      setActingId(null);
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
      {apps.map((app) => {
        const lvlColor = levelColors[app.verificationLevel ?? 0] || "#6b7280";
        const profileId = app.applicantProfileId || null;
        const profileUrl = profileId ? `/profile/${profileId}` : null;
        const canAccept = !posterIdentityPending && isPoster && jobStatus === "open" && app.status === "pending";

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
            <div className="flex items-center gap-3 mb-2">
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
                <div className="flex items-center gap-2 flex-wrap">
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

                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  {app.trustScore != null && app.trustScore > 0 && (
                    <span className="text-[10px]" style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>
                      <Shield size={10} className="inline mr-0.5" style={{ verticalAlign: "middle" }} />
                      {app.trustScore}/800
                    </span>
                  )}
                  {app.verificationBadges && app.verificationBadges.length > 0 && (
                    <span className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>
                      {app.verificationBadges.map((b) => badgeIcons[b] || b).join(" ")}
                    </span>
                  )}
                  <span className="text-[10px]" style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>
                    {timeAgo(app.createdAt)}
                  </span>
                </div>
              </div>

              <div className="text-right">
                {app.bidAmount != null && app.bidAmount > 0 && (
                  <div>
                    <span className="text-sm font-bold" style={{ color: "var(--solana, #9945ff)", fontFamily: "var(--font-mono)" }}>
                      {app.bidAmount} USDC
                    </span>
                  </div>
                )}
                {canAccept && (
                  <button
                    onClick={() => handleAccept(app.id)}
                    disabled={actingId === app.id}
                    className="mt-2 px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50"
                    style={{ background: "#22c55e", color: "white" }}
                  >
                    {actingId === app.id ? "Accepting..." : "Accept"}
                  </button>
                )}
              </div>
            </div>

            <div
              className="text-xs mt-2 leading-relaxed"
              style={{ color: "var(--text-secondary)", paddingLeft: "44px" }}
            >
              {app.proposal}
            </div>
          </div>
        );
      })}

      {posterIdentityPending && (
        <div
          className="text-xs px-3 py-2 rounded-lg"
          style={{
            background: "rgba(153,69,255,0.1)",
            color: "var(--solana, #9945ff)",
            border: "1px solid rgba(153,69,255,0.2)",
            fontFamily: "var(--font-mono)",
          }}
        >
          Resolving the connected wallet against the poster profile before marketplace actions are enabled.
        </div>
      )}

      {actionMsg && (
        <div
          className="text-xs px-3 py-2 rounded-lg"
          style={{
            background: actionMsg.ok ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)",
            color: actionMsg.ok ? "#22c55e" : "#ef4444",
            border: `1px solid ${actionMsg.ok ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.2)"}`,
            fontFamily: "var(--font-mono)",
          }}
        >
          {actionMsg.msg}
        </div>
      )}
    </div>
  );
}
