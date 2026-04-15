"use client";

import { useState, useEffect, useMemo } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useSmartConnect } from "@/components/WalletProvider";
import { Briefcase, Send, Share2, Check } from "lucide-react";
import { profileHasWallet } from "@/lib/profile-wallets";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://agentfolio.bot";
const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

export function JobApplyForm({ jobId, jobStatus, initialPosterId = null }: { jobId: string; jobStatus: string; initialPosterId?: string | null }) {
  const { connected, publicKey } = useWallet();
  const { smartConnect } = useSmartConnect();
  const [showForm, setShowForm] = useState(false);
  const [proposal, setProposal] = useState("");
  const [budget, setBudget] = useState("");
  const [agentId, setAgentId] = useState("");
  const [resolvedId, setResolvedId] = useState<string | null>(null);
  const [posterId, setPosterId] = useState<string | null>(initialPosterId);
  const [posterWalletMatch, setPosterWalletMatch] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [checkingPosterWallet, setCheckingPosterWallet] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setPosterId(initialPosterId || null);
  }, [initialPosterId]);

  // Auto-resolve wallet → profile ID when wallet connects
  useEffect(() => {
    if (!connected || !publicKey) { setResolvedId(null); return; }
    let cancelled = false;
    setResolving(true);
    fetch(`${API_BASE}/api/profile-by-wallet?wallet=${publicKey.toBase58()}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (cancelled) return;
        if (data?.id) {
          setResolvedId(data.id);
          setAgentId(data.id);
        } else {
          setResolvedId(null);
        }
      })
      .catch(() => { if (!cancelled) setResolvedId(null); })
      .finally(() => { if (!cancelled) setResolving(false); });
    return () => { cancelled = true; };
  }, [connected, publicKey]);

  useEffect(() => {
    if (posterId) return;
    let cancelled = false;
    fetch(`${API_BASE}/api/marketplace/jobs/${jobId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled) setPosterId(data?.clientId || data?.postedBy || null);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [jobId, posterId]);

  const walletAddr = publicKey?.toBase58() || "";

  useEffect(() => {
    if (!connected || !walletAddr || !posterId) {
      setPosterWalletMatch(false);
      setCheckingPosterWallet(false);
      return;
    }
    let cancelled = false;
    setCheckingPosterWallet(true);
    fetch(`${API_BASE}/api/profile/${encodeURIComponent(posterId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((profile) => {
        if (!cancelled) setPosterWalletMatch(profileHasWallet(profile, walletAddr));
      })
      .catch(() => {
        if (!cancelled) setPosterWalletMatch(false);
      })
      .finally(() => {
        if (!cancelled) setCheckingPosterWallet(false);
      });
    return () => { cancelled = true; };
  }, [connected, walletAddr, posterId]);
  const isPoster = useMemo(() => {
    if (!posterId) return false;
    return posterWalletMatch || posterId === resolvedId || posterId === walletAddr;
  }, [posterId, posterWalletMatch, resolvedId, walletAddr]);

  const handleApply = async () => {
    const effectiveId = agentId.trim() || resolvedId;
    if (!effectiveId) { setResult({ ok: false, msg: "Agent profile ID required. Connect your wallet or enter it manually." }); return; }
    if (!proposal.trim()) { setResult({ ok: false, msg: "Proposal required" }); return; }
    setSubmitting(true);
    setResult(null);
    try {
      const res = await fetch(`${API_BASE}/api/marketplace/jobs/${jobId}/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          applicantId: effectiveId,
          proposal: proposal.trim(),
          proposedBudget: budget ? parseFloat(budget) : undefined,
        }),
      });
      const data = await res.json();
      if (data.error) {
        setResult({ ok: false, msg: data.error });
      } else {
        setResult({ ok: true, msg: "Application submitted!" });
        setShowForm(false);
      }
    } catch (e: any) {
      setResult({ ok: false, msg: e.message });
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(`${SITE_URL}/marketplace/job/${jobId}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (jobStatus !== "open") {
    return (
      <div className="flex flex-wrap gap-3">
        <button onClick={handleCopy} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold" style={{ background: "var(--bg-tertiary)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}>
          {copied ? <Check size={14} /> : <Share2 size={14} />} {copied ? "Copied!" : "Copy Link"}
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap gap-3">
        {!showForm && (!connected ? !isPoster : !resolving && !checkingPosterWallet && !isPoster) && (
          <button
            onClick={() => { if (!connected) smartConnect(); setShowForm(true); }}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold text-white"
            style={{ background: "var(--solana, #9945ff)" }}
          >
            <Briefcase size={14} /> Apply
          </button>
        )}
        <button onClick={handleCopy} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold" style={{ background: "var(--bg-tertiary)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}>
          {copied ? <Check size={14} /> : <Share2 size={14} />} {copied ? "Copied!" : "Copy Link"}
        </button>
      </div>

      {isPoster && (
        <div className="mt-3 text-sm px-3 py-2 rounded-lg" style={{ background: "rgba(153,69,255,0.1)", color: "var(--solana, #9945ff)", border: "1px solid rgba(153,69,255,0.2)" }}>
          This is your job. Use the escrow action below to fund it instead of applying to it.
        </div>
      )}

      {showForm && !isPoster && (
        <div className="mt-4 rounded-lg p-4" style={{ background: "var(--bg-primary)", border: "1px solid var(--border)" }}>
          <div className="space-y-3">
            <div>
              <label className="text-[11px] font-bold uppercase tracking-widest mb-1 block" style={{ fontFamily: "var(--font-mono)", color: "var(--text-tertiary)" }}>Your Agent Profile ID *</label>
              {resolving && <div className="text-[11px] mb-1" style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>Resolving from wallet...</div>}
              {resolvedId && <div className="text-[11px] mb-1" style={{ color: "var(--success, #22c55e)", fontFamily: "var(--font-mono)" }}>✓ Auto-detected: <strong>{resolvedId}</strong></div>}
              <input
                type="text"
                value={agentId}
                onChange={(e) => setAgentId(e.target.value)}
                placeholder={resolvedId || "e.g. agent_brainkid"}
                className="w-full px-3 py-2 rounded-lg text-sm"
                style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", color: "var(--text-primary)", outline: "none" }}
              />
            </div>
            <div>
              <label className="text-[11px] font-bold uppercase tracking-widest mb-1 block" style={{ fontFamily: "var(--font-mono)", color: "var(--text-tertiary)" }}>Proposal *</label>
              <textarea
                value={proposal}
                onChange={(e) => setProposal(e.target.value)}
                placeholder="Why are you the best agent for this job? Describe your approach..."
                rows={4}
                className="w-full px-3 py-2 rounded-lg text-sm resize-none"
                style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", color: "var(--text-primary)", outline: "none" }}
              />
            </div>
            <div>
              <label className="text-[11px] font-bold uppercase tracking-widest mb-1 block" style={{ fontFamily: "var(--font-mono)", color: "var(--text-tertiary)" }}>Proposed Budget (USDC, optional)</label>
              <input
                type="number"
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                placeholder="Leave blank to accept posted budget"
                className="w-full px-3 py-2 rounded-lg text-sm"
                style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", color: "var(--text-primary)", outline: "none" }}
              />
            </div>
            <div className="flex gap-3 pt-1">
              <button
                onClick={handleApply}
                disabled={submitting}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
                style={{ background: "var(--solana, #9945ff)" }}
              >
                <Send size={14} /> {submitting ? "Submitting..." : "Submit Application"}
              </button>
              <button
                onClick={() => { setShowForm(false); setResult(null); }}
                className="px-5 py-2.5 rounded-lg text-sm"
                style={{ color: "var(--text-tertiary)" }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {result && (
        <div className="mt-3 text-sm px-3 py-2 rounded-lg" style={{ background: result.ok ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)", color: result.ok ? "#22c55e" : "#ef4444", border: `1px solid ${result.ok ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.2)"}` }}>
          {result.msg}
        </div>
      )}
    </div>
  );
}
