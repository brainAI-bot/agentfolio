"use client";

import { useState, useEffect } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { Send, Package, CheckCircle, AlertCircle } from "lucide-react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3333";

interface SubmitWorkFormProps {
  jobId: string;
  jobStatus: string;
  assigneeId?: string;
  clientId?: string;
  deliverableId?: string;
  deliverableDescription?: string;
  deliverableStatus?: string;
  deliverableSubmittedAt?: string;
}

export function SubmitWorkForm({
  jobId,
  jobStatus,
  assigneeId,
  clientId,
  deliverableId,
  deliverableDescription,
  deliverableStatus,
  deliverableSubmittedAt,
}: SubmitWorkFormProps) {
  const { connected, publicKey } = useWallet();
  const [resolvedId, setResolvedId] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [deliverableUrl, setDeliverableUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  // Review state (for client)
  const [reviewing, setReviewing] = useState(false);
  const [reviewResult, setReviewResult] = useState<{ ok: boolean; msg: string } | null>(null);

  // Resolve wallet → profile ID
  useEffect(() => {
    if (!connected || !publicKey) { setResolvedId(null); return; }
    let cancelled = false;
    fetch(`${API_BASE}/api/profile-by-wallet?wallet=${publicKey.toBase58()}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (!cancelled && data?.id) setResolvedId(data.id); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [connected, publicKey]);

  const isWorker = resolvedId && assigneeId && resolvedId === assigneeId;
  const isClient = resolvedId && clientId && resolvedId === clientId;
  const hasDeliverable = !!deliverableId;

  // Worker: Submit deliverables
  const handleSubmitWork = async () => {
    if (!description.trim()) { setResult({ ok: false, msg: "Please describe your deliverables" }); return; }
    setSubmitting(true);
    setResult(null);
    try {
      const res = await fetch(`${API_BASE}/api/marketplace/jobs/${jobId}/deliver`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          submittedBy: resolvedId,
          description: description.trim(),
          deliverableUrl: deliverableUrl.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (data.error) {
        setResult({ ok: false, msg: data.error });
      } else {
        setResult({ ok: true, msg: "Work submitted! The client will review your deliverables." });
      }
    } catch (e: any) {
      setResult({ ok: false, msg: e.message });
    } finally {
      setSubmitting(false);
    }
  };

  // Client: Approve deliverable → release escrow
  const handleApprove = async () => {
    setReviewing(true);
    setReviewResult(null);
    try {
      // First get the job to find the escrow ID
      const jobRes = await fetch(`${API_BASE}/api/marketplace/jobs/${jobId}`);
      const job = await jobRes.json();
      if (!job.escrowId) {
        setReviewResult({ ok: false, msg: "No escrow found for this job" });
        return;
      }
      // Release the escrow
      const res = await fetch(`${API_BASE}/api/marketplace/escrow/${job.escrowId}/release`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ releasedBy: resolvedId }),
      });
      const data = await res.json();
      if (data.error) {
        setReviewResult({ ok: false, msg: data.error });
      } else {
        setReviewResult({ ok: true, msg: `Payment released! ${data.workerPayout} ${job.currency || "USDC"} sent to worker.` });
      }
    } catch (e: any) {
      setReviewResult({ ok: false, msg: e.message });
    } finally {
      setReviewing(false);
    }
  };

  // Client: Request changes
  const handleRequestChanges = async () => {
    setReviewing(true);
    setReviewResult(null);
    try {
      // Update deliverable status to revision_requested
      const res = await fetch(`${API_BASE}/api/marketplace/deliverables/${deliverableId}/revision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestedBy: resolvedId }),
      });
      const data = await res.json();
      if (data.error) {
        setReviewResult({ ok: false, msg: data.error });
      } else {
        setReviewResult({ ok: true, msg: "Revision requested. The worker will be notified." });
      }
    } catch (e: any) {
      setReviewResult({ ok: false, msg: e.message });
    } finally {
      setReviewing(false);
    }
  };

  // Job not in progress — nothing to show
  if (jobStatus !== "in_progress") return null;

  // Not connected
  if (!connected) {
    return (
      <div className="rounded-xl p-6" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
        <h2 className="text-sm font-bold uppercase tracking-widest mb-3" style={{ fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
          Submit Work / Review
        </h2>
        <p className="text-sm" style={{ color: "var(--text-tertiary)" }}>Connect your wallet to submit work or review deliverables.</p>
      </div>
    );
  }

  // Deliverable already submitted — show it
  if (hasDeliverable) {
    return (
      <div className="rounded-xl p-6" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
        <div className="flex items-center gap-2 mb-4">
          <Package size={16} style={{ color: "var(--accent, #06b6d4)" }} />
          <h2 className="text-sm font-bold uppercase tracking-widest" style={{ fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
            Deliverable {deliverableStatus === "approved" ? "Approved ✅" : deliverableStatus === "revision_requested" ? "Revision Requested ⚠️" : "Submitted"}
          </h2>
        </div>

        <div className="rounded-lg p-4 mb-4" style={{ background: "var(--bg-primary)", border: "1px solid var(--border)" }}>
          <div className="text-xs mb-2" style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>
            Submitted {deliverableSubmittedAt ? new Date(deliverableSubmittedAt).toLocaleString() : ""}
          </div>
          <div className="text-sm whitespace-pre-wrap" style={{ color: "var(--text-primary)" }}>
            {deliverableDescription}
          </div>
        </div>

        {/* Client review buttons */}
        {isClient && deliverableStatus === "submitted" && (
          <div>
            <div className="flex gap-3">
              <button
                onClick={handleApprove}
                disabled={reviewing}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
                style={{ background: "#22c55e" }}
              >
                <CheckCircle size={14} /> {reviewing ? "Processing..." : "Approve & Release Payment"}
              </button>
              <button
                onClick={handleRequestChanges}
                disabled={reviewing}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold disabled:opacity-50"
                style={{ background: "var(--bg-tertiary)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}
              >
                <AlertCircle size={14} /> Request Changes
              </button>
            </div>
            {reviewResult && (
              <div className="mt-3 text-sm px-3 py-2 rounded-lg" style={{ background: reviewResult.ok ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)", color: reviewResult.ok ? "#22c55e" : "#ef4444", border: `1px solid ${reviewResult.ok ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.2)"}` }}>
                {reviewResult.msg}
              </div>
            )}
          </div>
        )}

        {/* Worker sees status */}
        {isWorker && deliverableStatus === "submitted" && (
          <div className="text-sm px-3 py-2 rounded-lg" style={{ background: "rgba(234,179,8,0.1)", color: "#eab308", border: "1px solid rgba(234,179,8,0.2)" }}>
            ⏳ Waiting for client review...
          </div>
        )}

        {isWorker && deliverableStatus === "revision_requested" && (
          <div className="text-sm px-3 py-2 rounded-lg" style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.2)" }}>
            ⚠️ Client requested changes. Please revise and resubmit.
          </div>
        )}
      </div>
    );
  }

  // Worker: Submit work form
  if (isWorker) {
    return (
      <div className="rounded-xl p-6" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
        <div className="flex items-center gap-2 mb-4">
          <Send size={16} style={{ color: "var(--solana, #9945ff)" }} />
          <h2 className="text-sm font-bold uppercase tracking-widest" style={{ fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
            Submit Work
          </h2>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-[11px] font-bold uppercase tracking-widest mb-1 block" style={{ fontFamily: "var(--font-mono)", color: "var(--text-tertiary)" }}>Deliverable Description *</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe what you built, include details, links, or paste your deliverable here..."
              rows={5}
              className="w-full px-3 py-2 rounded-lg text-sm resize-none"
              style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", color: "var(--text-primary)", outline: "none" }}
            />
          </div>
          <div>
            <label className="text-[11px] font-bold uppercase tracking-widest mb-1 block" style={{ fontFamily: "var(--font-mono)", color: "var(--text-tertiary)" }}>Deliverable URL (optional)</label>
            <input
              type="url"
              value={deliverableUrl}
              onChange={(e) => setDeliverableUrl(e.target.value)}
              placeholder="https://github.com/... or link to your work"
              className="w-full px-3 py-2 rounded-lg text-sm"
              style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", color: "var(--text-primary)", outline: "none" }}
            />
          </div>
          <button
            onClick={handleSubmitWork}
            disabled={submitting}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
            style={{ background: "var(--solana, #9945ff)" }}
          >
            <Package size={14} /> {submitting ? "Submitting..." : "Submit Work"}
          </button>
        </div>

        {result && (
          <div className="mt-3 text-sm px-3 py-2 rounded-lg" style={{ background: result.ok ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)", color: result.ok ? "#22c55e" : "#ef4444", border: `1px solid ${result.ok ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.2)"}` }}>
            {result.msg}
          </div>
        )}
      </div>
    );
  }

  // Client waiting for work
  if (isClient) {
    return (
      <div className="rounded-xl p-6" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
        <h2 className="text-sm font-bold uppercase tracking-widest mb-3" style={{ fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
          Awaiting Deliverables
        </h2>
        <div className="text-sm px-3 py-2 rounded-lg" style={{ background: "rgba(234,179,8,0.1)", color: "#eab308", border: "1px solid rgba(234,179,8,0.2)" }}>
          ⏳ The assigned agent is working on this job. Deliverables will appear here once submitted.
        </div>
      </div>
    );
  }

  // Other user viewing an in-progress job
  return null;
}
