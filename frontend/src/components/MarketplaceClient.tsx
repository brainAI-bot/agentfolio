"use client";

import { useState, useCallback, useEffect } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useSmartConnect } from "@/components/WalletProvider";
import { useConnection } from "@solana/wallet-adapter-react";
import { useDemoMode } from "@/lib/demo-mode";
import { Connection as SolConnection, PublicKey, Transaction, LAMPORTS_PER_SOL } from "@solana/web3.js";
const Connection = SolConnection;
import type { Job } from "@/lib/types";
import { Briefcase, Lock, Unlock, CheckCircle, AlertTriangle, Clock, X, Send, DollarSign, UserCheck, Link2, Shield } from "lucide-react";
import { buildUpdateAgentTransaction, fetchAgentProfile, SOLANA_RPC } from "@/lib/identity-registry";
import {
  buildV3EscrowCreate,
  buildV3Release,
  signAndSendV3Tx,
  resolveAgentWallet,
  getV3EscrowState,
} from "@/lib/v3-escrow";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://agentfolio.bot";
const API_BASE = process.env.NEXT_PUBLIC_API_URL || SITE_URL;
const SOLANA_CLUSTER = process.env.NEXT_PUBLIC_SOLANA_CLUSTER || "mainnet-beta";
const SOLSCAN_CLUSTER_SUFFIX = SOLANA_CLUSTER === "mainnet-beta" ? "" : `?cluster=${SOLANA_CLUSTER}`;
const solscanTxUrl = (tx: string) => `https://solscan.io/tx/${tx}${SOLSCAN_CLUSTER_SUFFIX}`;

const statusConfig: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  open: { label: "OPEN", color: "var(--success)", icon: CheckCircle },
  in_progress: { label: "IN PROGRESS", color: "var(--warning)", icon: Clock },
  completed: { label: "COMPLETED", color: "var(--info)", icon: CheckCircle },
  disputed: { label: "DISPUTED", color: "var(--accent)", icon: AlertTriangle },
};

const escrowConfig: Record<string, { label: string; icon: React.ElementType }> = {
  ready: { label: "Escrow Ready", icon: Unlock },
  locked: { label: "V3 Escrow Locked 🔒", icon: Lock },
  funded: { label: "V3 Escrow Funded 🔒", icon: Shield },
  released: { label: "Escrow Released", icon: CheckCircle },
  disputed: { label: "Escrow Disputed", icon: AlertTriangle },
};

type ModalType = "post-job" | "apply" | "fund-escrow" | "release" | "job-detail" | null;

interface PostJobForm {
  title: string;
  description: string;
  category: string;
  skills: string;
  budgetAmount: string;
  timeline: string;
  requirements: string;
}


function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return mins <= 1 ? "just now" : mins + "m ago";
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + "h ago";
  const days = Math.floor(hrs / 24);
  if (days < 30) return days + "d ago";
  const months = Math.floor(days / 30);
  return months + "mo ago";
}

export function MarketplaceClient({ jobs: initialJobs }: { jobs: Job[] }) {
  const wallet = useWallet();
  const { setVisible } = useWalletModal();
  const { smartConnect } = useSmartConnect();
  const { connection } = useConnection();
  const { isDemo, demoPublicKey } = useDemoMode();
  const connected = isDemo ? true : wallet.connected;
  const publicKey = isDemo ? demoPublicKey : wallet.publicKey;
  const signTransaction = wallet.signTransaction;
  const sendTransaction = wallet.sendTransaction;
  const [filter, setFilter] = useState<string>("all");
  const [skillFilter, setSkillFilter] = useState<string>("");
  const [modal, setModal] = useState<ModalType>(null);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [jobs, setJobs] = useState<Job[]>(initialJobs);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Post Job form
  const [postForm, setPostForm] = useState<PostJobForm>({
    title: "", description: "", category: "development", skills: "",
    budgetAmount: "", timeline: "1_week", requirements: "",
  });

  // Apply form
  const [applyMessage, setApplyMessage] = useState("");
  const [applyBid, setApplyBid] = useState("");
  const [resolvedProfileId, setResolvedProfileId] = useState<string | null>(null);
  const [resolvingProfile, setResolvingProfile] = useState(false);
  const [myProfileId, setMyProfileId] = useState<string | null>(null);

  // Auto-resolve wallet → profile for My Jobs filter
  useEffect(() => {
    if (connected && publicKey) {
      fetch(`${API_BASE}/api/profile-by-wallet?wallet=${publicKey.toBase58()}`)
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d?.id) setMyProfileId(d.id); })
        .catch(() => {});
    } else {
      setMyProfileId(null);
    }
  }, [connected, publicKey]);

  const statusFiltered = filter === "all"
    ? jobs
    : filter === "my_jobs"
      ? jobs.filter((j) =>
          (connected && publicKey && j.poster === publicKey.toBase58()) ||
          (myProfileId && (j.assigneeId === myProfileId || j.clientId === myProfileId))
        )
      : jobs.filter((j) => j.status === filter);
  const filtered = skillFilter
    ? statusFiltered.filter((j) => j.skills.some(s => s.toLowerCase().includes(skillFilter.toLowerCase())))
    : statusFiltered;
  const allSkills = [...new Set(jobs.flatMap(j => j.skills))].sort();

  const showMessage = (type: "success" | "error", text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 5000);
  };

  // Resolve wallet → profile ID when apply modal opens
  const resolveWalletProfile = useCallback(async (walletAddr: string) => {
    setResolvingProfile(true);
    try {
      const res = await fetch(`${API_BASE}/api/profile-by-wallet?wallet=${walletAddr}`);
      if (res.ok) {
        const data = await res.json();
        setResolvedProfileId(data.id || null);
      } else {
        setResolvedProfileId(null);
      }
    } catch {
      setResolvedProfileId(null);
    } finally {
      setResolvingProfile(false);
    }
  }, []);

  const refreshJobs = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/marketplace/jobs?status=all`);
      if (res.ok) {
        const data = await res.json();
        const jobList = data.jobs || data || [];
        setJobs(jobList.map((j: any) => ({
          id: j.id,
          title: j.title,
          description: j.description,
          poster: j.clientId || j.poster || "Unknown",
          posterAvatar: "",
          budget: `${j.budgetAmount || 0} ${j.budgetCurrency || "USDC"}`,
          skills: j.skills || [],
          status: j.status === "in_progress" ? "in_progress" : j.status || "open",
          escrowStatus: j.fundsReleased ? "released" : j.v3EscrowPDA ? "funded" : j.escrowFunded ? "locked" : "ready",
          escrowTx: j.v3EscrowTx || j.escrowTx || j.escrow_tx || null,
          v3EscrowPDA: j.v3EscrowPDA || null,
          proposals: j.applicationCount || 0,
          deadline: (j.timeline || "").replace("_", " "),
          assignee: j.selectedAgentId || j.acceptedApplicant || undefined,
          assigneeId: j.selectedAgentId || j.acceptedApplicant || undefined,
          clientId: j.clientId || j.postedBy || undefined,
          createdAt: j.createdAt || new Date().toISOString(),
          deliverableStatus: j.deliverableStatus || undefined,
        })));
      }
    } catch (e) { console.error("Failed to refresh jobs:", e); }
  }, []);

  // ─── POST JOB ───
  const handlePostJob = async () => {
    if (!connected || !publicKey) { smartConnect(); return; }
    if (!postForm.title || !postForm.description || !postForm.budgetAmount) {
      showMessage("error", "Fill in title, description, and budget");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/marketplace/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: resolvedProfileId || publicKey.toBase58(),
          title: postForm.title,
          description: postForm.description,
          category: postForm.category,
          skills: postForm.skills.split(",").map(s => s.trim()).filter(Boolean),
          budgetType: "fixed",
          budgetAmount: parseFloat(postForm.budgetAmount),
          budgetCurrency: "USDC",
          timeline: postForm.timeline,
          requirements: postForm.requirements,
          escrowRequired: true,
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      showMessage("success", `Job "${postForm.title}" posted! ID: ${data.id}`);
      setModal(null);
      setPostForm({ title: "", description: "", category: "development", skills: "", budgetAmount: "", timeline: "1_week", requirements: "" });
      await refreshJobs();
    } catch (e: any) {
      showMessage("error", e.message || "Failed to post job");
    } finally { setLoading(false); }
  };

  // ─── APPLY TO JOB ───
  const handleApply = async () => {
    if (!connected || !publicKey || !selectedJob) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/marketplace/jobs/${selectedJob.id}/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          applicantId: resolvedProfileId || publicKey.toBase58(),
          proposal: applyMessage,
          bidAmount: applyBid ? parseFloat(applyBid) : undefined,
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      showMessage("success", "Application submitted!");
      setModal(null);
      setApplyMessage("");
      setApplyBid("");
      await refreshJobs();
    } catch (e: any) {
      showMessage("error", e.message || "Failed to apply");
    } finally { setLoading(false); }
  };

  // ─── FUND ESCROW (V3 On-chain Identity-Verified Escrow) ───
  const handleFundEscrow = async () => {
    if (!connected || !publicKey || !sendTransaction || !selectedJob) return;
    setLoading(true);
    try {
      // Parse budget amount — V3 escrow uses USDC
      const budgetStr = selectedJob.budget.split(" ")[0];
      const amount = parseFloat(budgetStr);
      if (!amount || amount <= 0) throw new Error("Invalid budget amount");

      // V3 escrow uses USDC (amount in lamports for on-chain)
      const amountLamports = Math.round(amount * LAMPORTS_PER_SOL);

      // Resolve agent's wallet from their profile ID
      const agentId = selectedJob.assignee || selectedJob.assigneeId;
      if (!agentId) throw new Error("No agent assigned to this job yet. Accept an application first.");

      const agentWallet = await resolveAgentWallet(agentId);
      if (!agentWallet) throw new Error(`Could not resolve wallet for agent "${agentId}". Agent must have a verified Solana wallet.`);

      // Calculate deadline (job timeline → unix timestamp)
      const timelineMap: Record<string, number> = {
        "1 day": 1, "1_day": 1, "3 days": 3, "3_days": 3,
        "1 week": 7, "1_week": 7, "2 weeks": 14, "2_weeks": 14,
        "1 month": 30, "1_month": 30,
      };
      const daysFromNow = timelineMap[selectedJob.deadline] || 7;
      const deadlineUnix = Math.floor(Date.now() / 1000) + (daysFromNow * 86400);

      // Build unsigned V3 escrow creation TX
      const { tx, escrowPDA } = await buildV3EscrowCreate({
        clientWallet: publicKey.toBase58(),
        agentWallet,
        agentId,
        amountLamports,
        description: selectedJob.title,
        deadlineUnix,
        minVerificationLevel: 2, // Require at least "Verified" level
      });

      // User signs and sends via Phantom
      const sig = await signAndSendV3Tx(tx, connection, publicKey, sendTransaction);

      // Notify backend — store V3 escrow PDA on the job
      await fetch(`${API_BASE}/api/marketplace/jobs/${selectedJob.id}/v3-escrow-funded`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: resolvedProfileId || publicKey.toBase58(),
          escrowPDA,
          txSignature: sig,
          amount,
          agentWallet,
          agentId,
        }),
      });

      showMessage("success", `V3 Escrow funded on-chain! TX: ${sig.slice(0, 16)}... | PDA: ${escrowPDA.slice(0, 12)}...`);
      setModal(null);
      await refreshJobs();
    } catch (e: any) {
      console.error("V3 Escrow funding error:", e);
      showMessage("error", e.message || "Escrow funding failed");
    } finally { setLoading(false); }
  };

  // ─── RELEASE FUNDS (V3 On-chain Release) ───
  const handleRelease = async () => {
    if (!connected || !publicKey || !sendTransaction || !selectedJob) return;
    setLoading(true);
    try {
      const agentId = selectedJob.assignee || selectedJob.assigneeId;

      // Check if this job has a V3 escrow PDA — if so, do on-chain release
      if (selectedJob.v3EscrowPDA) {
        const escrowPDA = selectedJob.v3EscrowPDA;

        // Resolve agent wallet
        if (!agentId) throw new Error("No agent assigned to this job");
        const agentWallet = await resolveAgentWallet(agentId);
        if (!agentWallet) throw new Error(`Could not resolve wallet for agent "${agentId}"`);

        // Build unsigned V3 release TX
        const tx = await buildV3Release({
          escrowPDA,
          clientWallet: publicKey.toBase58(),
          agentWallet,
        });

        // User signs on-chain release
        const sig = await signAndSendV3Tx(tx, connection, publicKey, sendTransaction);

        // Notify backend
        await fetch(`${API_BASE}/api/marketplace/jobs/${selectedJob.id}/complete`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clientId: resolvedProfileId || publicKey.toBase58(),
            completionNote: "Work approved. V3 escrow released on-chain.",
            releaseTxSignature: sig,
            v3Release: true,
          }),
        });

        showMessage("success", `Funds released on-chain! TX: ${sig.slice(0, 16)}...`);
      } else {
        // Fallback: legacy release (no V3 escrow)
        const res = await fetch(`${API_BASE}/api/marketplace/jobs/${selectedJob.id}/complete`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clientId: resolvedProfileId || publicKey.toBase58(),
            completionNote: "Work completed and approved.",
          }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);

        // Optional: record completion on-chain via identity registry
        try {
          const conn = new Connection(SOLANA_RPC, "confirmed");
          const profile = await fetchAgentProfile(conn, publicKey);
          if (profile) {
            const tx = await buildUpdateAgentTransaction(conn, publicKey, null, null, null, null);
            const sig = await sendTransaction(tx, conn);
            await conn.confirmTransaction(sig, "confirmed");
            showMessage("success", `Funds released! On-chain record: ${sig.slice(0, 12)}...`);
          } else {
            showMessage("success", "Funds released! Job completed.");
          }
        } catch {
          showMessage("success", "Funds released! Job completed. (On-chain record skipped)");
        }
      }

      setModal(null);
      await refreshJobs();
    } catch (e: any) {
      console.error("Release error:", e);
      showMessage("error", e.message || "Failed to release funds");
    } finally { setLoading(false); }
  };

  // Auto-resolve wallet profile whenever wallet connects/changes
  useEffect(() => {
    if (connected && publicKey) {
      resolveWalletProfile(publicKey.toBase58());
    } else {
      setResolvedProfileId(null);
    }
  }, [connected, publicKey, resolveWalletProfile]);

  const openJobAction = (job: Job, action: ModalType) => {
    if ((action === "apply" || action === "post-job") && publicKey && !resolvedProfileId) {
      resolveWalletProfile(publicKey.toBase58());
    }
    setSelectedJob(job);
    setModal(action);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Toast */}
      {message && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[9999] px-6 py-4 rounded-xl text-base font-bold shadow-2xl animate-bounce-in"
          style={{
            background: message.type === "success" ? "rgba(16,185,129,0.95)" : "rgba(239,68,68,0.95)",
            color: "#fff",
            border: `2px solid ${message.type === "success" ? "#10b981" : "#ef4444"}`,
            fontFamily: "var(--font-mono)",
            minWidth: "300px",
            textAlign: "center",
            backdropFilter: "blur(8px)",
          }}>
          {message.type === "error" ? "⚠️ " : "✅ "}{message.text}
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold" style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>
            Marketplace
          </h1>
          <p className="text-sm mt-1" style={{ color: "var(--text-tertiary)" }}>
            {jobs.length} jobs · V3 Identity-Verified Escrow
          </p>
        </div>
        <button
          onClick={() => connected ? setModal("post-job") : smartConnect()}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold uppercase tracking-wider transition-all hover:shadow-lg"
          style={{ fontFamily: "var(--font-mono)", background: "var(--accent)", color: "#fff" }}
        >
          <Briefcase size={14} />
          Post Job
        </button>
      </div>

      {/* Wallet status */}
      {connected && publicKey && (
        <div className="mb-4 px-3 py-2 rounded-lg text-xs" style={{ background: "rgba(153,69,255,0.08)", border: "1px solid rgba(153,69,255,0.2)", fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
          🔗 Connected: {publicKey.toBase58().slice(0, 6)}...{publicKey.toBase58().slice(-4)}
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
        {[...(connected ? ["my_jobs"] : []), "all", "open", "in_progress", "completed", "disputed"].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className="px-3 py-1.5 rounded-lg text-[11px] uppercase tracking-wider whitespace-nowrap transition-all"
            style={{
              fontFamily: "var(--font-mono)",
              background: filter === f ? "var(--bg-tertiary)" : "transparent",
              color: filter === f ? "var(--text-primary)" : "var(--text-tertiary)",
              border: filter === f ? "1px solid var(--border-bright)" : "1px solid var(--border)",
            }}
          >
            {f === "my_jobs" ? "🧳 My Jobs" : f === "all" ? "All" : f.replace("_", " ")}
          </button>
        ))}
      </div>

      {/* Skill Filter */}
      {allSkills.length > 0 && (
        <div className="flex gap-1.5 mb-4 overflow-x-auto pb-1 flex-wrap">
          {skillFilter && (
            <button onClick={() => setSkillFilter("")}
              className="px-2 py-1 rounded text-[10px] font-semibold"
              style={{ fontFamily: "var(--font-mono)", background: "var(--accent)", color: "#fff" }}>
              ✕ {skillFilter}
            </button>
          )}
          {allSkills.filter(s => s !== skillFilter).slice(0, 12).map(s => (
            <button key={s} onClick={() => setSkillFilter(s === skillFilter ? "" : s)}
              className="px-2 py-1 rounded text-[10px] transition-all hover:border-[var(--accent)]"
              style={{ fontFamily: "var(--font-mono)", background: "var(--bg-tertiary)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}>
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Job List */}
      <div className="space-y-3">
        {filtered.map((job) => {
          const sc = statusConfig[job.status] || statusConfig.open;
          const ec = escrowConfig[job.escrowStatus] || escrowConfig.ready;
          const StatusIcon = sc.icon;
          const EscrowIcon = ec.icon;
          const isMyJob = connected && publicKey && job.poster === publicKey.toBase58();
          const isMyAssignment = myProfileId && (job.assigneeId === myProfileId);
          const hasV3Escrow = !!job.v3EscrowPDA;

          return (
            <div
              key={job.id}
              className="rounded-lg p-5 transition-all hover:bg-[var(--bg-tertiary)]"
              style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}
            >
              <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest"
                      style={{ fontFamily: "var(--font-mono)", color: sc.color }}>
                      <StatusIcon size={12} />
                      {sc.label}
                    </span>
                    {hasV3Escrow && (
                      <span className="text-[10px] px-2 py-0.5 rounded" style={{ background: "rgba(16,185,129,0.15)", color: "var(--success)", fontFamily: "var(--font-mono)" }}>
                        <Shield size={10} className="inline mr-0.5" /> V3 ESCROW
                      </span>
                    )}
                    {isMyJob && (
                      <span className="text-[10px] px-2 py-0.5 rounded" style={{ background: "rgba(153,69,255,0.15)", color: "var(--solana)", fontFamily: "var(--font-mono)" }}>
                        YOUR JOB
                      </span>
                    )}
                    {isMyAssignment && !isMyJob && (
                      <span className="text-[10px] px-2 py-0.5 rounded" style={{ background: "rgba(16,185,129,0.15)", color: "var(--success)", fontFamily: "var(--font-mono)" }}>
                        ASSIGNED TO YOU
                      </span>
                    )}
                  </div>
                  <h3 className="text-base font-semibold mb-1">
                    <a href={`/marketplace/job/${job.id}`} className="hover:underline" style={{ color: "var(--text-primary)" }}>{job.title}</a>
                    <button
                      onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(`${SITE_URL}/marketplace/job/${job.id}`); }}
                      className="ml-2 text-[10px] opacity-40 hover:opacity-100 transition-opacity"
                      title="Copy link"
                    >
                      <Link2 size={12} className="inline" />
                    </button>
                  </h3>
                  <p className="text-xs mb-3 line-clamp-2" style={{ color: "var(--text-tertiary)" }}>{job.description}</p>
                  <div className="flex flex-wrap items-center gap-3 text-xs" style={{ fontFamily: "var(--font-mono)" }}>
                    <span style={{ color: "var(--text-secondary)" }}>
                      Posted by <span style={{ color: "var(--text-primary)" }}>{job.poster.length > 20 ? `${job.poster.slice(0, 6)}...${job.poster.slice(-4)}` : job.poster}</span>
                    </span>
                    <span style={{ color: "var(--text-tertiary)" }}>·</span>
                    <span style={{ color: "var(--text-primary)" }}>{job.budget}</span>
                    <span style={{ color: "var(--text-tertiary)" }}>·</span>
                    <span style={{ color: "var(--text-tertiary)" }}>{timeAgo(job.createdAt)}</span>
                    <span style={{ color: "var(--text-tertiary)" }}>·</span>
                    <span className="flex items-center gap-1" style={{ color: "var(--text-secondary)" }}>
                      <EscrowIcon size={12} />
                      {job.escrowTx ? (
                        <a href={solscanTxUrl(job.escrowTx)} target="_blank" rel="noopener noreferrer" style={{ color: "var(--solana)", textDecoration: "underline" }}>
                          {ec.label} ↗
                        </a>
                      ) : ec.label}
                    </span>
                    {job.assignee && (
                      <>
                        <span style={{ color: "var(--text-tertiary)" }}>·</span>
                        <span style={{ color: "var(--text-secondary)" }}>
                          Assigned: <span style={{ color: "var(--text-primary)" }}>{job.assignee.length > 20 ? `${job.assignee.slice(0, 6)}...${job.assignee.slice(-4)}` : job.assignee}</span>
                        </span>
                      </>
                    )}
                    {job.deliverableStatus && (
                      <>
                        <span style={{ color: "var(--text-tertiary)" }}>·</span>
                        <span style={{ color: job.deliverableStatus === "submitted" ? "var(--warning)" : job.deliverableStatus === "approved" ? "var(--success)" : "var(--text-secondary)", fontFamily: "var(--font-mono)" }}>
                          {job.deliverableStatus === "submitted" ? "📦 Deliverable Submitted" : job.deliverableStatus === "approved" ? "✅ Approved" : job.deliverableStatus === "revision_requested" ? "🔄 Revision Requested" : job.deliverableStatus}
                        </span>
                      </>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {job.skills.map((s) => (
                      <span key={s} className="px-2 py-0.5 rounded text-[10px]"
                        style={{ fontFamily: "var(--font-mono)", background: "var(--bg-tertiary)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}>
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex sm:flex-col items-center sm:items-end gap-2 shrink-0">
                  <span className="text-xs" style={{ fontFamily: "var(--font-mono)", color: "var(--text-tertiary)" }}>
                    {job.proposals} proposals
                  </span>
                  <span className="text-xs" style={{ fontFamily: "var(--font-mono)", color: "var(--text-tertiary)" }}>
                    ⏱ {job.deadline}
                  </span>

                  {/* Action buttons based on state */}
                  {job.status === "open" && !isMyJob && connected && (
                    <button onClick={() => openJobAction(job, "apply")}
                      className="px-3 py-1.5 rounded text-[11px] font-semibold uppercase tracking-wider transition-all hover:shadow-[0_0_15px_rgba(153,69,255,0.2)]"
                      style={{ fontFamily: "var(--font-mono)", background: "var(--accent)", color: "#fff" }}>
                      <Send size={12} className="inline mr-1" /> Apply
                    </button>
                  )}
                  {job.status === "open" && !connected && (
                    <button onClick={() => smartConnect()}
                      className="px-3 py-1.5 rounded text-[11px] font-semibold uppercase tracking-wider"
                      style={{ fontFamily: "var(--font-mono)", background: "rgba(153,69,255,0.15)", color: "var(--solana)", border: "1px solid rgba(153,69,255,0.3)" }}>
                      Connect to Apply
                    </button>
                  )}
                  {isMyJob && job.status === "in_progress" && !hasV3Escrow && job.escrowStatus === "ready" && (
                    <button onClick={() => openJobAction(job, "fund-escrow")}
                      className="px-3 py-1.5 rounded text-[11px] font-semibold uppercase tracking-wider"
                      style={{ fontFamily: "var(--font-mono)", background: "rgba(16,185,129,0.15)", color: "#10b981", border: "1px solid rgba(16,185,129,0.3)" }}>
                      <Shield size={12} className="inline mr-1" /> Fund V3 Escrow
                    </button>
                  )}
                  {isMyJob && job.status === "open" && job.escrowStatus === "ready" && (
                    <button onClick={() => openJobAction(job, "fund-escrow")}
                      className="px-3 py-1.5 rounded text-[11px] font-semibold uppercase tracking-wider"
                      style={{ fontFamily: "var(--font-mono)", background: "rgba(16,185,129,0.15)", color: "#10b981", border: "1px solid rgba(16,185,129,0.3)" }}>
                      <Shield size={12} className="inline mr-1" /> Fund V3 Escrow
                    </button>
                  )}
                  {isMyJob && (hasV3Escrow || job.escrowStatus === "locked" || job.escrowStatus === "funded") && job.status === "in_progress" && (
                    <button onClick={() => openJobAction(job, "release")}
                      className="px-3 py-1.5 rounded text-[11px] font-semibold uppercase tracking-wider"
                      style={{ fontFamily: "var(--font-mono)", background: "rgba(59,130,246,0.15)", color: "#3b82f6", border: "1px solid rgba(59,130,246,0.3)" }}>
                      <UserCheck size={12} className="inline mr-1" /> Release Funds
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {filtered.length === 0 && (
          <div className="text-center py-12" style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>
            No jobs found
          </div>
        )}
      </div>

      {/* ─── MODALS ─── */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => !loading && setModal(null)}>
          <div className="w-full max-w-lg mx-4 rounded-xl p-6 max-h-[90vh] overflow-y-auto"
            style={{ background: "var(--bg-primary)", border: "1px solid var(--border)" }}
            onClick={(e) => e.stopPropagation()}>

            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold" style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>
                {modal === "post-job" && "Post a Job"}
                {modal === "apply" && `Apply: ${selectedJob?.title}`}
                {modal === "fund-escrow" && `Fund V3 Escrow: ${selectedJob?.title}`}
                {modal === "release" && `Release Funds: ${selectedJob?.title}`}
              </h2>
              <button onClick={() => !loading && setModal(null)} style={{ color: "var(--text-tertiary)" }}>
                <X size={18} />
              </button>
            </div>

            {/* POST JOB FORM */}
            {modal === "post-job" && (
              <div className="space-y-4">
                <Input label="Title" value={postForm.title} onChange={(v) => setPostForm(p => ({ ...p, title: v }))} placeholder="e.g. Build a trading bot" />
                <Textarea label="Description" value={postForm.description} onChange={(v) => setPostForm(p => ({ ...p, description: v }))} placeholder="Describe the work needed..." />
                <div className="grid grid-cols-2 gap-3">
                  <Select label="Category" value={postForm.category} onChange={(v) => setPostForm(p => ({ ...p, category: v }))}
                    options={[
                      { value: "development", label: "Development" },
                      { value: "trading", label: "Trading" },
                      { value: "research", label: "Research" },
                      { value: "design", label: "Design" },
                      { value: "content", label: "Content" },
                      { value: "other", label: "Other" },
                    ]} />
                  <Select label="Timeline" value={postForm.timeline} onChange={(v) => setPostForm(p => ({ ...p, timeline: v }))}
                    options={[
                      { value: "1_day", label: "1 Day" },
                      { value: "3_days", label: "3 Days" },
                      { value: "1_week", label: "1 Week" },
                      { value: "2_weeks", label: "2 Weeks" },
                      { value: "1_month", label: "1 Month" },
                    ]} />
                </div>
                <Input label="Budget (USDC)" value={postForm.budgetAmount} onChange={(v) => setPostForm(p => ({ ...p, budgetAmount: v }))} placeholder="1.0" type="number" />
                <Input label="Skills (comma separated)" value={postForm.skills} onChange={(v) => setPostForm(p => ({ ...p, skills: v }))} placeholder="Solana, Rust, TypeScript" />
                <Textarea label="Requirements (optional)" value={postForm.requirements} onChange={(v) => setPostForm(p => ({ ...p, requirements: v }))} placeholder="Must have experience with..." />
                <div className="p-3 rounded-lg text-xs" style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.2)", color: "#10b981" }}>
                  <Shield size={12} className="inline mr-1" /> Jobs use V3 identity-verified escrow. Agent must have SATP Genesis Record. Funds are held on-chain until you approve.
                </div>
                <button onClick={handlePostJob} disabled={loading}
                  className="w-full py-3 rounded-lg text-sm font-semibold uppercase tracking-wider transition-all disabled:opacity-50"
                  style={{ fontFamily: "var(--font-mono)", background: "var(--accent)", color: "#fff" }}>
                  {loading ? "Posting..." : "Post Job"}
                </button>
              </div>
            )}

            {/* APPLY FORM */}
            {modal === "apply" && selectedJob && (
              <div className="space-y-4">
                <div className="p-3 rounded-lg" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
                  <div className="text-xs" style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>Budget: {selectedJob.budget}</div>
                </div>
                {resolvingProfile && <div className="text-[11px]" style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>Resolving profile...</div>}
                {resolvedProfileId && <div className="text-[11px]" style={{ color: "var(--success)", fontFamily: "var(--font-mono)" }}>Applying as: <strong>{resolvedProfileId}</strong></div>}
                {!resolvingProfile && !resolvedProfileId && publicKey && <div className="text-[11px]" style={{ color: "var(--warning, #f59e0b)", fontFamily: "var(--font-mono)" }}>⚠️ No profile found for this wallet. Create a profile first.</div>}
                <Textarea label="Your Proposal" value={applyMessage} onChange={setApplyMessage} placeholder="Why are you the best fit for this job?" />
                <Input label="Your Bid (USDC, optional)" value={applyBid} onChange={setApplyBid} placeholder="Leave empty to match budget" type="number" />
                <button onClick={handleApply} disabled={loading}
                  className="w-full py-3 rounded-lg text-sm font-semibold uppercase tracking-wider transition-all disabled:opacity-50"
                  style={{ fontFamily: "var(--font-mono)", background: "var(--accent)", color: "#fff" }}>
                  {loading ? "Submitting..." : "Submit Application"}
                </button>
              </div>
            )}

            {/* FUND ESCROW — V3 Identity-Verified */}
            {modal === "fund-escrow" && selectedJob && (
              <div className="space-y-4">
                <div className="p-4 rounded-lg" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
                  <div className="text-sm mb-2" style={{ color: "var(--text-primary)", fontFamily: "var(--font-mono)" }}>
                    💰 Amount: <strong>{selectedJob.budget}</strong>
                  </div>
                  {selectedJob.assignee ? (
                    <div className="text-xs" style={{ color: "var(--success)" }}>
                      Agent: <strong>{selectedJob.assignee.length > 20 ? `${selectedJob.assignee.slice(0, 6)}...${selectedJob.assignee.slice(-4)}` : selectedJob.assignee}</strong>
                    </div>
                  ) : (
                    <div className="text-xs" style={{ color: "var(--warning, #f59e0b)" }}>
                      ⚠️ No agent assigned yet. Accept an application first.
                    </div>
                  )}
                </div>
                <div className="p-3 rounded-lg text-xs" style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.2)", color: "#10b981" }}>
                  <Shield size={12} className="inline mr-1" /> <strong>V3 Identity-Verified Escrow</strong>
                  <br />
                  Your funds are locked in an on-chain escrow program with SATP identity verification. The agent must have a verified Genesis Record. You control release.
                </div>
                <div className="p-3 rounded-lg text-xs" style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)", color: "#f59e0b" }}>
                  ⚠️ This will open your wallet (Phantom) to sign a Solana transaction. The funds go to the escrow program — not directly to the agent.
                </div>
                <button onClick={handleFundEscrow} disabled={loading || !selectedJob.assignee}
                  className="w-full py-3 rounded-lg text-sm font-semibold uppercase tracking-wider transition-all disabled:opacity-50"
                  style={{ fontFamily: "var(--font-mono)", background: "#10b981", color: "#fff" }}>
                  {loading ? "Signing Transaction..." : `Fund V3 Escrow — ${selectedJob.budget}`}
                </button>
              </div>
            )}

            {/* RELEASE FUNDS — V3 On-chain or Legacy */}
            {modal === "release" && selectedJob && (
              <div className="space-y-4">
                <div className="p-4 rounded-lg" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
                  <div className="text-sm mb-2" style={{ color: "var(--text-primary)", fontFamily: "var(--font-mono)" }}>
                    ✅ Release {selectedJob.budget} to assigned agent
                  </div>
                  <div className="text-xs" style={{ color: "var(--text-tertiary)" }}>
                    {selectedJob.assignee ? `Agent: ${selectedJob.assignee.length > 20 ? `${selectedJob.assignee.slice(0, 6)}...${selectedJob.assignee.slice(-4)}` : selectedJob.assignee}` : "No agent assigned yet"}
                  </div>
                </div>
                {selectedJob.v3EscrowPDA ? (
                  <div className="p-3 rounded-lg text-xs" style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.2)", color: "#10b981" }}>
                    <Shield size={12} className="inline mr-1" /> <strong>V3 On-Chain Release</strong>
                    <br />
                    This will release the escrowed funds directly to the agent's wallet via the SATP V3 escrow program. You'll sign the release transaction in your wallet.
                    <br />
                    <span className="opacity-70">Escrow: {selectedJob.v3EscrowPDA.slice(0, 12)}...</span>
                  </div>
                ) : (
                  <div className="p-3 rounded-lg text-xs" style={{ background: "rgba(59,130,246,0.08)", border: "1px solid rgba(59,130,246,0.2)", color: "#3b82f6" }}>
                    This will mark the job as completed and release escrowed funds to the agent.
                  </div>
                )}
                <button onClick={handleRelease} disabled={loading}
                  className="w-full py-3 rounded-lg text-sm font-semibold uppercase tracking-wider transition-all disabled:opacity-50"
                  style={{ fontFamily: "var(--font-mono)", background: "#3b82f6", color: "#fff" }}>
                  {loading ? "Signing Release..." : "Confirm Release"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Small form components ───

function Input({ label, value, onChange, placeholder, type = "text" }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string;
}) {
  return (
    <div>
      <label className="block text-[11px] uppercase tracking-wider mb-1.5" style={{ fontFamily: "var(--font-mono)", color: "var(--text-tertiary)" }}>{label}</label>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="w-full px-3 py-2.5 rounded-lg text-sm outline-none transition-all"
        style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", color: "var(--text-primary)", fontFamily: "var(--font-mono)" }} />
    </div>
  );
}

function Textarea({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-[11px] uppercase tracking-wider mb-1.5" style={{ fontFamily: "var(--font-mono)", color: "var(--text-tertiary)" }}>{label}</label>
      <textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={3}
        className="w-full px-3 py-2.5 rounded-lg text-sm outline-none transition-all resize-none"
        style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", color: "var(--text-primary)", fontFamily: "var(--font-mono)" }} />
    </div>
  );
}

function Select({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[];
}) {
  return (
    <div>
      <label className="block text-[11px] uppercase tracking-wider mb-1.5" style={{ fontFamily: "var(--font-mono)", color: "var(--text-tertiary)" }}>{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2.5 rounded-lg text-sm outline-none cursor-pointer"
        style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", color: "var(--text-primary)", fontFamily: "var(--font-mono)" }}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}
