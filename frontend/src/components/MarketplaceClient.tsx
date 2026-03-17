"use client";

import { useState, useCallback } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useSmartConnect } from "@/components/WalletProvider";
import { useConnection } from "@solana/wallet-adapter-react";
import { useDemoMode } from "@/lib/demo-mode";
import { Connection as SolConnection, PublicKey, Transaction, TransactionInstruction, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
// Re-alias to avoid conflict with wallet adapter's useConnection
const Connection = SolConnection;
import { getAssociatedTokenAddress, createTransferInstruction, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import type { Job } from "@/lib/types";
import { Briefcase, Lock, Unlock, CheckCircle, AlertTriangle, Clock, X, Send, DollarSign, UserCheck, Link2 } from "lucide-react";
import { buildUpdateAgentTransaction, fetchAgentProfile, SOLANA_RPC } from "@/lib/identity-registry";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3333";
const ESCROW_PROGRAM_ID = new PublicKey("4qx9DTX1BojPnQAtUBL2Gb9pw6kVyw5AucjaR8Yyea9a");
const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

const statusConfig: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  open: { label: "OPEN", color: "var(--success)", icon: CheckCircle },
  in_progress: { label: "IN PROGRESS", color: "var(--warning)", icon: Clock },
  completed: { label: "COMPLETED", color: "var(--info)", icon: CheckCircle },
  disputed: { label: "DISPUTED", color: "var(--accent)", icon: AlertTriangle },
};

const escrowConfig: Record<string, { label: string; icon: React.ElementType }> = {
  ready: { label: "Escrow Ready", icon: Unlock },
  locked: { label: "Escrow Locked 🔒", icon: Lock },
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

  const filtered = filter === "all" ? jobs : jobs.filter((j) => j.status === filter);

  const showMessage = (type: "success" | "error", text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 5000);
  };

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
          escrowStatus: j.fundsReleased ? "released" : j.escrowFunded ? "locked" : "ready",
          escrowTx: j.escrowTx || j.escrow_tx || null,
          proposals: j.applicationCount || 0,
          deadline: (j.timeline || "").replace("_", " "),
          assignee: j.selectedAgentId || undefined,
          createdAt: j.createdAt || new Date().toISOString(),
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
          clientId: publicKey.toBase58(),
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
          agentId: publicKey.toBase58(),
          message: applyMessage,
          proposedBudget: applyBid ? parseFloat(applyBid) : undefined,
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

  // ─── FUND ESCROW (On-chain USDC transfer to program PDA) ───
  const handleFundEscrow = async () => {
    if (!connected || !publicKey || !signTransaction || !selectedJob) return;
    setLoading(true);
    try {
      // Parse budget amount
      const budgetStr = selectedJob.budget.split(" ")[0];
      const amount = parseFloat(budgetStr);
      if (!amount || amount <= 0) throw new Error("Invalid budget amount");

      // USDC has 6 decimals
      const usdcAmount = Math.round(amount * 1_000_000);

      // Derive escrow PDA from program
      const [escrowPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("escrow"), new PublicKey(publicKey).toBuffer(), Buffer.from(selectedJob.id)],
        ESCROW_PROGRAM_ID
      );

      // Get token accounts
      const senderATA = await getAssociatedTokenAddress(USDC_MINT, publicKey);
      const escrowATA = await getAssociatedTokenAddress(USDC_MINT, escrowPDA, true);

      // Build transfer instruction
      const transferIx = createTransferInstruction(
        senderATA, escrowATA, publicKey, usdcAmount, [], TOKEN_PROGRAM_ID
      );

      const tx = new Transaction().add(transferIx);
      tx.feePayer = publicKey;
      tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

      const signedTx = await signTransaction(tx);
      const sig = await connection.sendRawTransaction(signedTx.serialize());
      await connection.confirmTransaction(sig, "confirmed");

      // Notify backend
      await fetch(`${API_BASE}/api/marketplace/jobs/${selectedJob.id}/confirm-deposit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: publicKey.toBase58(),
          txSignature: sig,
          amount,
          currency: "USDC",
        }),
      });

      showMessage("success", `Escrow funded! TX: ${sig.slice(0, 16)}...`);
      setModal(null);
      await refreshJobs();
    } catch (e: any) {
      showMessage("error", e.message || "Escrow funding failed");
    } finally { setLoading(false); }
  };

  // ─── RELEASE FUNDS ───
  const handleRelease = async () => {
    if (!connected || !publicKey || !selectedJob) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/marketplace/jobs/${selectedJob.id}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: publicKey.toBase58(),
          completionNote: "Work completed and approved.",
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      // Record job completion on-chain via update_agent (bumps updated_at)
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
      setModal(null);
      await refreshJobs();
    } catch (e: any) {
      showMessage("error", e.message || "Failed to release funds");
    } finally { setLoading(false); }
  };

  const openJobAction = (job: Job, action: ModalType) => {
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
            {jobs.length} jobs · Escrow-backed execution
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
        {["all", "open", "in_progress", "completed", "disputed"].map((f) => (
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
            {f === "all" ? "All" : f.replace("_", " ")}
          </button>
        ))}
      </div>

      {/* Job List */}
      <div className="space-y-3">
        {filtered.map((job) => {
          const sc = statusConfig[job.status] || statusConfig.open;
          const ec = escrowConfig[job.escrowStatus] || escrowConfig.ready;
          const StatusIcon = sc.icon;
          const EscrowIcon = ec.icon;
          const isMyJob = connected && publicKey && job.poster === publicKey.toBase58();

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
                    {isMyJob && (
                      <span className="text-[10px] px-2 py-0.5 rounded" style={{ background: "rgba(153,69,255,0.15)", color: "var(--solana)", fontFamily: "var(--font-mono)" }}>
                        YOUR JOB
                      </span>
                    )}
                  </div>
                  <h3 className="text-base font-semibold mb-1">
                    <a href={`/marketplace/job/${job.id}`} className="hover:underline" style={{ color: "var(--text-primary)" }}>{job.title}</a>
                    <button
                      onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(`https://agentfolio.bot/marketplace/job/${job.id}`); }}
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
                    <span className="flex items-center gap-1" style={{ color: "var(--text-secondary)" }}>
                      <EscrowIcon size={12} />
                      {job.escrowTx ? (
                        <a href={`https://solscan.io/tx/${job.escrowTx}`} target="_blank" rel="noopener noreferrer" style={{ color: "var(--solana)", textDecoration: "underline" }}>
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
                  {isMyJob && job.status === "in_progress" && job.escrowStatus === "ready" && (
                    <button onClick={() => openJobAction(job, "fund-escrow")}
                      className="px-3 py-1.5 rounded text-[11px] font-semibold uppercase tracking-wider"
                      style={{ fontFamily: "var(--font-mono)", background: "rgba(16,185,129,0.15)", color: "#10b981", border: "1px solid rgba(16,185,129,0.3)" }}>
                      <DollarSign size={12} className="inline mr-1" /> Fund Escrow
                    </button>
                  )}
                  {isMyJob && job.status === "open" && job.escrowStatus === "ready" && (
                    <button onClick={() => openJobAction(job, "fund-escrow")}
                      className="px-3 py-1.5 rounded text-[11px] font-semibold uppercase tracking-wider"
                      style={{ fontFamily: "var(--font-mono)", background: "rgba(16,185,129,0.15)", color: "#10b981", border: "1px solid rgba(16,185,129,0.3)" }}>
                      <DollarSign size={12} className="inline mr-1" /> Fund Escrow
                    </button>
                  )}
                  {isMyJob && job.escrowStatus === "locked" && job.status === "in_progress" && (
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
                {modal === "fund-escrow" && `Fund Escrow: ${selectedJob?.title}`}
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
                <Input label="Budget (USDC)" value={postForm.budgetAmount} onChange={(v) => setPostForm(p => ({ ...p, budgetAmount: v }))} placeholder="100" type="number" />
                <Input label="Skills (comma separated)" value={postForm.skills} onChange={(v) => setPostForm(p => ({ ...p, skills: v }))} placeholder="Solana, Rust, TypeScript" />
                <Textarea label="Requirements (optional)" value={postForm.requirements} onChange={(v) => setPostForm(p => ({ ...p, requirements: v }))} placeholder="Must have experience with..." />
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
                <Textarea label="Your Proposal" value={applyMessage} onChange={setApplyMessage} placeholder="Why are you the best fit for this job?" />
                <Input label="Your Bid (USDC, optional)" value={applyBid} onChange={setApplyBid} placeholder="Leave empty to match budget" type="number" />
                <button onClick={handleApply} disabled={loading}
                  className="w-full py-3 rounded-lg text-sm font-semibold uppercase tracking-wider transition-all disabled:opacity-50"
                  style={{ fontFamily: "var(--font-mono)", background: "var(--accent)", color: "#fff" }}>
                  {loading ? "Submitting..." : "Submit Application"}
                </button>
              </div>
            )}

            {/* FUND ESCROW */}
            {modal === "fund-escrow" && selectedJob && (
              <div className="space-y-4">
                <div className="p-4 rounded-lg" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
                  <div className="text-sm mb-2" style={{ color: "var(--text-primary)", fontFamily: "var(--font-mono)" }}>
                    💰 Amount: <strong>{selectedJob.budget}</strong>
                  </div>
                  <div className="text-xs" style={{ color: "var(--text-tertiary)" }}>
                    Funds will be sent to the escrow program ({ESCROW_PROGRAM_ID.toBase58().slice(0, 8)}...) and held until you release them on completion.
                  </div>
                </div>
                <div className="p-3 rounded-lg text-xs" style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)", color: "#f59e0b" }}>
                  ⚠️ This will initiate a Solana transaction from your connected wallet. Make sure you have enough USDC.
                </div>
                <button onClick={handleFundEscrow} disabled={loading}
                  className="w-full py-3 rounded-lg text-sm font-semibold uppercase tracking-wider transition-all disabled:opacity-50"
                  style={{ fontFamily: "var(--font-mono)", background: "#10b981", color: "#fff" }}>
                  {loading ? "Processing..." : `Fund Escrow — ${selectedJob.budget}`}
                </button>
              </div>
            )}

            {/* RELEASE FUNDS */}
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
                <div className="p-3 rounded-lg text-xs" style={{ background: "rgba(59,130,246,0.08)", border: "1px solid rgba(59,130,246,0.2)", color: "#3b82f6" }}>
                  This will mark the job as completed and release escrowed funds to the agent.
                </div>
                <button onClick={handleRelease} disabled={loading}
                  className="w-full py-3 rounded-lg text-sm font-semibold uppercase tracking-wider transition-all disabled:opacity-50"
                  style={{ fontFamily: "var(--font-mono)", background: "#3b82f6", color: "#fff" }}>
                  {loading ? "Releasing..." : "Confirm Release"}
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
