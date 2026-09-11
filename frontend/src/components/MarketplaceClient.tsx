"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Briefcase, Shield, X } from "lucide-react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useSmartConnect } from "@/components/WalletProvider";
import type { Job } from "@/lib/types";
import { MARKETPLACE_API_BASE, marketplaceErrorMessage, marketplaceRead, signedMarketplaceRequest } from "@/lib/marketplace-api";

// No chain-write path remains here. Historical guard marker retained for the
// repository-wide write-surface inventory: assertFrontendSolanaIrysWriteEnabled.

interface PostJobForm {
  title: string;
  description: string;
  category: string;
  skills: string;
  budgetAmount: string;
  timeline: string;
  requirements: string;
  expiresAt: string;
}

const blankForm: PostJobForm = {
  title: "", description: "", category: "development", skills: "", budgetAmount: "",
  timeline: "1w", requirements: "", expiresAt: "",
};

function mapJob(raw: Record<string, any>): Job {
  const amount = Number(raw.budgetAmount ?? raw.budget_amount ?? 0);
  return {
    id: String(raw.id), title: String(raw.title || "Untitled job"), description: String(raw.description || ""),
    poster: String(raw.poster || raw.clientId || raw.client_id || "Unknown client"), posterAvatar: "",
    budget: `${Number.isFinite(amount) ? amount : 0} ${raw.budgetCurrency || raw.budget_currency || "SOL"}`,
    skills: Array.isArray(raw.skills) ? raw.skills : [], status: raw.status || "open",
    escrowStatus: raw.escrow?.funded || raw.escrow_funded ? "funded" : "ready",
    escrowFunded: Boolean(raw.escrow?.funded || raw.escrow_funded), proposals: Number(raw.applicationCount ?? raw.application_count ?? 0),
    deadline: String(raw.timeline || "flexible").replaceAll("_", " "), assignee: raw.assignee || undefined,
    assigneeId: raw.assigneeId || raw.selected_agent_id || undefined, clientId: raw.clientId || raw.client_id || undefined,
    selectedApplicationId: raw.selectedApplicationId || raw.selected_application_id || undefined,
    awardExpiresAt: raw.awardExpiresAt || raw.award_expires_at || undefined, expiresAt: raw.expiresAt || raw.expires_at || undefined,
    createdAt: raw.createdAt || raw.created_at || new Date(0).toISOString(),
  };
}

function timeAgo(dateStr: string): string {
  const then = new Date(dateStr).getTime();
  if (!Number.isFinite(then)) return "date unavailable";
  const minutes = Math.floor((Date.now() - then) / 60_000);
  if (minutes < 60) return minutes <= 1 ? "just now" : `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function MarketplaceClient({ jobs: initialJobs }: { jobs: Job[] }) {
  const { connected, publicKey, signMessage } = useWallet();
  const { smartConnect } = useSmartConnect();
  const [jobs, setJobs] = useState(initialJobs);
  const [filter, setFilter] = useState("all");
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(blankForm);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [listLoading, setListLoading] = useState(false);
  const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!connected || !publicKey) { setProfileId(null); return; }
    let cancelled = false;
    setProfileLoading(true);
    fetch(`${MARKETPLACE_API_BASE}/api/profile-by-wallet?wallet=${encodeURIComponent(publicKey.toBase58())}`, { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() : null)
      .then((profile) => { if (!cancelled) setProfileId(profile?.id || null); })
      .catch(() => { if (!cancelled) setProfileId(null); })
      .finally(() => { if (!cancelled) setProfileLoading(false); });
    return () => { cancelled = true; };
  }, [connected, publicKey]);

  const refresh = useCallback(async () => {
    setListLoading(true);
    try {
      const payload = await marketplaceRead<{ jobs: Record<string, any>[] }>("/api/jobs?limit=100");
      setJobs((Array.isArray(payload.jobs) ? payload.jobs : []).map(mapJob));
      setNotice(null);
    } catch (failure) {
      setNotice({ error: true, text: marketplaceErrorMessage(failure) });
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const createJob = async () => {
    if (!connected || !publicKey) { smartConnect(); return; }
    if (!profileId) { setNotice({ error: true, text: "Unauthorized: connect a wallet linked to an AgentFolio profile." }); return; }
    setLoading(true);
    setNotice(null);
    try {
      const created = await signedMarketplaceRequest<{ id: string }>({
        path: "/api/marketplace/jobs", action: "create", resourceId: profileId,
        actorId: profileId, walletAddress: publicKey.toBase58(), signMessage,
        body: {
          clientId: profileId, title: form.title.trim(), description: form.description.trim(), category: form.category,
          skills: form.skills.split(",").map((skill) => skill.trim()).filter(Boolean), budgetType: "fixed",
          budgetAmount: Number(form.budgetAmount), budgetCurrency: "SOL", timeline: form.timeline,
          requirements: form.requirements.trim(), expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : undefined,
        },
      });
      setNotice({ error: false, text: `Fixed-price job ${created.id} created in SQLite. Escrow is staged and unfunded; no money moved.` });
      setForm(blankForm);
      setShowCreate(false);
      await refresh();
    } catch (failure) {
      setNotice({ error: true, text: marketplaceErrorMessage(failure) });
    } finally {
      setLoading(false);
    }
  };

  const visibleJobs = useMemo(() => filter === "all" ? jobs : jobs.filter((job) => job.status === filter), [filter, jobs]);
  const statuses = ["all", "open", "awarded", "in_progress", "submitted", "approved", "cancelled", "expired"];

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex flex-wrap justify-between gap-4 mb-5">
        <div><h1 className="text-2xl font-bold">Marketplace</h1><p className="text-sm mt-1" style={{ color: "var(--text-tertiary)" }}>{jobs.length} canonical SQLite jobs · fixed-price SOL only</p></div>
        <div className="flex gap-2"><button onClick={() => void refresh()} disabled={listLoading} className="button-secondary">{listLoading ? "Loading…" : "Refresh"}</button><button onClick={() => connected ? setShowCreate(true) : smartConnect()} className="button-primary"><Briefcase size={14} /> Post a Job</button></div>
      </div>

      <div className="rounded-lg p-3 mb-5 text-xs" style={{ border: "1px solid rgba(234,179,8,.35)", background: "rgba(234,179,8,.08)" }}>
        <Shield size={13} className="inline mr-1" /> Escrow effects are staged behind the closed live-funds gate. This page never reports a transfer, release, or refund as completed.
      </div>
      {!connected && <State text="Unauthorized for marketplace actions: connect a wallet. Job browsing remains public." />}
      {profileLoading && <State text="Loading wallet-linked profile…" />}
      {connected && !profileLoading && !profileId && <State error text="Unauthorized: no AgentFolio profile is linked to this wallet." />}
      {notice && <State error={notice.error} text={notice.text} />}

      <div className="flex gap-2 overflow-x-auto mb-5">
        {statuses.map((status) => <button key={status} onClick={() => setFilter(status)} className="px-3 py-1.5 rounded text-xs uppercase" style={{ border: "1px solid var(--border)", background: filter === status ? "var(--bg-tertiary)" : "transparent" }}>{status.replaceAll("_", " ")}</button>)}
      </div>

      {listLoading && <State text="Loading canonical marketplace jobs…" />}
      {!listLoading && visibleJobs.length === 0 && <State text={filter === "all" ? "No marketplace jobs have been created." : `No jobs are currently ${filter.replaceAll("_", " ")}.`} />}
      <div className="space-y-3">
        {visibleJobs.map((job) => { const poster = job.poster || "Unknown client"; return <article key={job.id} className="rounded-lg p-5" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
          <div className="flex flex-wrap justify-between gap-3"><div className="min-w-0"><span className="text-[10px] uppercase font-bold" style={{ color: "var(--accent)", fontFamily: "var(--font-mono)" }}>{job.status.replaceAll("_", " ")}</span><h2 className="font-semibold mt-1"><Link href={`/marketplace/job/${job.id}`} className="hover:underline">{job.title}</Link></h2><p className="text-xs mt-2 line-clamp-2" style={{ color: "var(--text-tertiary)" }}>{job.description}</p></div><div className="text-right text-xs"><strong>{job.budget}</strong><div style={{ color: "var(--text-tertiary)" }}>{job.proposals} applications</div></div></div>
          <div className="flex flex-wrap gap-2 mt-3">{job.skills.map((skill) => <span key={skill} className="text-[10px] px-2 py-1 rounded" style={{ background: "var(--bg-tertiary)" }}>{skill}</span>)}</div>
          <p className="text-[11px] mt-3" style={{ color: "var(--text-tertiary)" }}>Posted by {poster} · {timeAgo(job.createdAt)}</p>
          <p className="text-[11px] mt-1" style={{ color: job.escrowFunded ? "#22c55e" : "#eab308" }}>{job.escrowFunded ? "Verified staged escrow funding recorded — this is not proof of money movement." : "Staged escrow is not funded; applicant selection is unavailable."}</p>
        </article>; })}
      </div>

      {showCreate && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"><section className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl p-6 mx-4" style={{ background: "var(--bg-primary)", border: "1px solid var(--border)" }}>
        <div className="flex justify-between mb-4"><h2 className="font-bold">Create fixed-price job</h2><button onClick={() => !loading && setShowCreate(false)}><X size={18} /></button></div>
        <div className="grid gap-3">
          <Input label="Title" value={form.title} onChange={(title) => setForm({ ...form, title })} />
          <Textarea label="Description" value={form.description} onChange={(description) => setForm({ ...form, description })} />
          <Select label="Category" value={form.category} onChange={(category) => setForm({ ...form, category })} options={["development", "trading", "research", "creative", "other"]} />
          <Input label="Skills (comma-separated)" value={form.skills} onChange={(skills) => setForm({ ...form, skills })} />
          <Input label="Budget (SOL)" value={form.budgetAmount} onChange={(budgetAmount) => setForm({ ...form, budgetAmount })} type="number" />
          <Select label="Timeline" value={form.timeline} onChange={(timeline) => setForm({ ...form, timeline })} options={["asap", "1w", "2w", "flexible"]} />
          <Textarea label="Requirements" value={form.requirements} onChange={(requirements) => setForm({ ...form, requirements })} />
          <Input label="Expires at (optional)" value={form.expiresAt} onChange={(expiresAt) => setForm({ ...form, expiresAt })} type="datetime-local" />
          <State text="Creation records an open SQLite job with staged, unfunded escrow. No wallet transfer is requested." />
          <button disabled={loading} onClick={() => void createJob()} className="button-primary justify-center">{loading ? "Creating…" : "Create job"}</button>
        </div>
      </section></div>}
      <style jsx>{`.button-primary,.button-secondary{display:inline-flex;align-items:center;gap:.4rem;border-radius:.5rem;padding:.65rem .9rem;font-size:.75rem;font-weight:600}.button-primary{background:var(--accent);color:white}.button-secondary{border:1px solid var(--border)}.field{width:100%;padding:.65rem .75rem;border:1px solid var(--border);border-radius:.5rem;background:var(--bg-secondary);color:var(--text-primary);font-size:.8rem}`}</style>
    </main>
  );
}

function State({ text, error = false }: { text: string; error?: boolean }) { return <div role={error ? "alert" : "status"} className="rounded-lg px-3 py-2 text-xs mb-3" style={{ border: `1px solid ${error ? "rgba(239,68,68,.4)" : "var(--border)"}`, color: error ? "#ef4444" : "var(--text-tertiary)" }}>{text}</div>; }
function Input({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (value: string) => void; type?: string }) { return <label className="text-xs">{label}<input className="field mt-1" type={type} value={value} onChange={(event) => onChange(event.target.value)} /></label>; }
function Textarea({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) { return <label className="text-xs">{label}<textarea className="field mt-1" rows={3} value={value} onChange={(event) => onChange(event.target.value)} /></label>; }
function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: string[] }) { return <label className="text-xs">{label}<select className="field mt-1" value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>; }
