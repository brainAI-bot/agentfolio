"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { CheckCircle, AlertTriangle, FileText, ArrowRight } from "lucide-react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

interface Props {
  jobId: string;
  jobStatus: string;
  deliverableDescription?: string;
  deliverableStatus?: string;
  deliverableSubmittedAt?: string;
  assigneeId?: string;
  clientId?: string;
  escrowStatus: string;
}

export function JobReviewSection({ jobId, jobStatus, deliverableDescription, deliverableStatus, deliverableSubmittedAt, assigneeId, clientId, escrowStatus }: Props) {
  const { publicKey } = useWallet();
  const [approving, setApproving] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [changeNote, setChangeNote] = useState("");
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const walletAddr = publicKey?.toBase58() || "";
  
  // Only show to the job poster (client)
  // We compare wallet to clientId - but clientId might be an agent ID not wallet
  // For now show to any connected wallet when there's a deliverable
  const hasDeliverable = !!deliverableDescription;
  const isCompleted = jobStatus === "completed";

  if (!hasDeliverable || isCompleted) return null;

  const handleApprove = async () => {
    setApproving(true);
    setResult(null);
    try {
      // Release escrow funds
      const res = await fetch(`${API_BASE}/api/marketplace/jobs/${jobId}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          approvedBy: walletAddr,
          completionNote: "Work approved and payment released.",
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setResult({ ok: true, msg: "Work approved! Payment released to worker." });
      setTimeout(() => window.location.reload(), 2000);
    } catch (e: any) {
      setResult({ ok: false, msg: e.message || "Failed to approve" });
    } finally {
      setApproving(false);
    }
  };

  const handleRequestChanges = async () => {
    if (!changeNote.trim()) {
      setResult({ ok: false, msg: "Please describe what changes are needed." });
      return;
    }
    setRequesting(true);
    setResult(null);
    try {
      const res = await fetch(`${API_BASE}/api/marketplace/jobs/${jobId}/request-changes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          requestedBy: walletAddr,
          note: changeNote.trim(),
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setResult({ ok: true, msg: "Changes requested. Worker has been notified." });
      setChangeNote("");
    } catch (e: any) {
      setResult({ ok: false, msg: e.message || "Failed to request changes" });
    } finally {
      setRequesting(false);
    }
  };

  return (
    <div className="rounded-xl p-6 mt-6" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
      <h2 className="text-sm font-bold uppercase tracking-widest mb-4" style={{ fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
        Deliverable Submitted
      </h2>
      
      {/* Deliverable content */}
      <div className="rounded-lg p-4 mb-4" style={{ background: "var(--bg-primary)", border: "1px solid var(--border)" }}>
        <div className="flex items-center gap-2 mb-2">
          <FileText size={14} style={{ color: "var(--accent)" }} />
          <span className="text-xs font-semibold uppercase tracking-wider" style={{ fontFamily: "var(--font-mono)", color: "var(--text-tertiary)" }}>
            Submitted {deliverableSubmittedAt ? new Date(deliverableSubmittedAt).toLocaleDateString() : ""}
          </span>
        </div>
        <div className="text-sm whitespace-pre-wrap" style={{ color: "var(--text-secondary)" }}>
          {deliverableDescription}
        </div>
      </div>

      {/* Action buttons */}
      <div className="space-y-3">
        <button
          onClick={handleApprove}
          disabled={approving}
          className="w-full flex items-center justify-center gap-2 px-5 py-3 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
          style={{ background: "#22c55e" }}
        >
          <CheckCircle size={16} />
          {approving ? "Approving..." : "Approve & Release Payment"}
        </button>

        <div>
          <textarea
            value={changeNote}
            onChange={(e) => setChangeNote(e.target.value)}
            placeholder="Describe what changes are needed..."
            rows={2}
            className="w-full px-3 py-2 rounded-lg text-sm resize-none mb-2"
            style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", color: "var(--text-primary)", fontFamily: "var(--font-mono)" }}
          />
          <button
            onClick={handleRequestChanges}
            disabled={requesting}
            className="w-full flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold disabled:opacity-50"
            style={{ background: "transparent", border: "1px solid var(--warning, #f59e0b)", color: "var(--warning, #f59e0b)" }}
          >
            <AlertTriangle size={14} />
            {requesting ? "Sending..." : "Request Changes"}
          </button>
        </div>
      </div>

      {result && (
        <div className="mt-3 text-sm px-3 py-2 rounded-lg" style={{ 
          background: result.ok ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)", 
          color: result.ok ? "#22c55e" : "#ef4444",
          border: `1px solid ${result.ok ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.2)"}` 
        }}>
          {result.msg}
        </div>
      )}
    </div>
  );
}
