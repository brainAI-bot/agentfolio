"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Shield } from "lucide-react";
import { useWallet } from "@solana/wallet-adapter-react";
import { marketplaceErrorMessage, marketplaceRead, signedMarketplaceRequest } from "@/lib/marketplace-api";

export interface MarketplaceApplication {
  id: string;
  applicantId: string;
  applicantName?: string;
  applicantProfileId?: string;
  proposal: string;
  proposedBudget?: number;
  bidAmount?: number;
  proposedTimeline?: string;
  status: string;
  createdAt: string;
}

interface Props {
  jobId: string;
  jobStatus: string;
  clientId?: string;
  selectedApplicationId?: string;
  escrowFunded?: boolean;
  viewerProfileId?: string | null;
  onChanged?: () => void | Promise<void>;
  reloadToken?: number;
}

function applicationTime(dateStr: string): string {
  const createdAt = new Date(dateStr).getTime();
  if (!Number.isFinite(createdAt)) return "date unavailable";
  const days = Math.floor((Date.now() - createdAt) / 86_400_000);
  return days < 1 ? "today" : `${days}d ago`;
}

export function ApplicationsList({
  jobId,
  jobStatus,
  clientId,
  selectedApplicationId,
  escrowFunded = false,
  viewerProfileId,
  onChanged,
  reloadToken,
}: Props) {
  const { publicKey, signMessage } = useWallet();
  const [apps, setApps] = useState<MarketplaceApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await marketplaceRead<{ applications: MarketplaceApplication[] }>(`/api/jobs/${jobId}/applications`);
      setApps(Array.isArray(data.applications) ? data.applications : []);
    } catch (failure) {
      setError(marketplaceErrorMessage(failure));
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => { void load(); }, [load, reloadToken]);

  const act = async (application: MarketplaceApplication, action: "select" | "reject" | "accept" | "decline" | "withdraw") => {
    if (!viewerProfileId || !publicKey) {
      setError("Unauthorized: connect the wallet linked to the acting AgentFolio profile.");
      return;
    }
    setActing(`${application.id}:${action}`);
    setError(null);
    try {
      await signedMarketplaceRequest({
        path: `/api/marketplace/applications/${encodeURIComponent(application.id)}/${action}`,
        action,
        resourceId: application.id,
        actorId: viewerProfileId,
        walletAddress: publicKey.toBase58(),
        signMessage,
      });
      await load();
      await onChanged?.();
    } catch (failure) {
      setError(marketplaceErrorMessage(failure));
    } finally {
      setActing(null);
    }
  };

  if (loading) return <State text="Loading applications from the canonical SQLite API…" />;
  if (error && apps.length === 0) return <State text={error} error retry={load} />;
  if (apps.length === 0) return <State text="No applications yet." />;

  const isClient = Boolean(viewerProfileId && viewerProfileId === clientId);
  return (
    <div className="space-y-3">
      {error && <State text={error} error retry={load} />}
      {apps.map((application) => {
        const isApplicant = viewerProfileId === application.applicantId;
        const isSelected = selectedApplicationId === application.id || application.status === "selected";
        return (
          <article key={application.id} className="rounded-lg p-4" style={{ background: "var(--bg-primary)", border: isSelected ? "1px solid #eab308" : "1px solid var(--border)" }}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <Link href={`/profile/${application.applicantProfileId || application.applicantId}`} className="text-sm font-bold hover:underline">
                  {application.applicantName || application.applicantId}
                </Link>
                <div className="text-[10px] uppercase mt-1" style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>
                  {application.status}{isSelected ? " · award awaiting agent response" : ""} · {applicationTime(application.createdAt)}
                </div>
              </div>
              <div className="text-right text-xs" style={{ fontFamily: "var(--font-mono)" }}>
                {(application.proposedBudget ?? application.bidAmount) != null && <strong>{application.proposedBudget ?? application.bidAmount} SOL</strong>}
                {application.proposedTimeline && <div style={{ color: "var(--text-tertiary)" }}>{application.proposedTimeline.replaceAll("_", " ")}</div>}
              </div>
            </div>
            <p className="text-sm mt-3 whitespace-pre-wrap" style={{ color: "var(--text-secondary)" }}>{application.proposal}</p>
            <div className="flex flex-wrap gap-2 mt-4">
              {isClient && jobStatus === "open" && application.status === "pending" && (
                <>
                  <button type="button" disabled={!escrowFunded || Boolean(acting)} onClick={() => act(application, "select")} className="px-3 py-1.5 rounded text-xs disabled:opacity-40" style={{ background: "var(--accent)", color: "white" }}>
                    {acting === `${application.id}:select` ? "Selecting…" : escrowFunded ? "Select funded offer" : "Selection requires verified staged funding"}
                  </button>
                  <button type="button" disabled={Boolean(acting)} onClick={() => act(application, "reject")} className="px-3 py-1.5 rounded text-xs disabled:opacity-40" style={{ border: "1px solid var(--border)" }}>
                    Reject
                  </button>
                </>
              )}
              {isApplicant && jobStatus === "open" && application.status === "pending" && (
                <button type="button" disabled={Boolean(acting)} onClick={() => act(application, "withdraw")} className="px-3 py-1.5 rounded text-xs disabled:opacity-40" style={{ border: "1px solid var(--border)" }}>
                  {acting === `${application.id}:withdraw` ? "Withdrawing…" : "Withdraw application"}
                </button>
              )}
              {isApplicant && jobStatus === "awarded" && isSelected && (
                <>
                  <button type="button" disabled={Boolean(acting)} onClick={() => act(application, "accept")} className="px-3 py-1.5 rounded text-xs disabled:opacity-40" style={{ background: "#22c55e", color: "white" }}>
                    {acting === `${application.id}:accept` ? "Accepting…" : "Accept award"}
                  </button>
                  <button type="button" disabled={Boolean(acting)} onClick={() => act(application, "decline")} className="px-3 py-1.5 rounded text-xs disabled:opacity-40" style={{ border: "1px solid #ef4444", color: "#ef4444" }}>
                    Decline award
                  </button>
                </>
              )}
            </div>
            {!escrowFunded && isClient && jobStatus === "open" && application.status === "pending" && (
              <div className="mt-3 text-[11px]" style={{ color: "#eab308" }}><Shield size={11} className="inline mr-1" />No funds moved. Selection stays disabled until the canonical API reports verified staged escrow funding.</div>
            )}
          </article>
        );
      })}
    </div>
  );
}

function State({ text, error = false, retry }: { text: string; error?: boolean; retry?: () => void | Promise<void> }) {
  return (
    <div role={error ? "alert" : "status"} className="text-xs py-4 text-center rounded-lg" style={{ color: error ? "#ef4444" : "var(--text-tertiary)", border: "1px solid var(--border)", fontFamily: "var(--font-mono)" }}>
      {text} {retry && <button type="button" className="underline ml-2" onClick={() => void retry()}>Retry</button>}
    </div>
  );
}
