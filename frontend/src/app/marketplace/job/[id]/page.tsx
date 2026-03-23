import { getJob } from "@/lib/data";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { JobApplyForm } from "@/components/JobApplyForm";

export const dynamic = "force-dynamic";

const statusConfig: Record<string, { label: string; color: string }> = {
  open: { label: "OPEN", color: "#22c55e" },
  in_progress: { label: "IN PROGRESS", color: "#eab308" },
  completed: { label: "COMPLETED", color: "#06b6d4" },
  disputed: { label: "DISPUTED", color: "#ef4444" },
};

const escrowLabels: Record<string, string> = {
  ready: "Escrow Ready",
  locked: "Escrow Locked 🔒",
  released: "Escrow Released ✅",
  disputed: "Escrow Disputed ⚠️",
};

export default async function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = await getJob(id);
  if (!job) return notFound();

  const sc = statusConfig[job.status] || statusConfig.open;

  return (
    <div className="min-h-screen" style={{ background: "var(--bg-primary)", color: "var(--text-primary)" }}>
      <div className="max-w-3xl mx-auto px-4 py-8">
        <Link href="/marketplace" className="inline-flex items-center gap-1 text-sm mb-6 hover:underline" style={{ color: "var(--text-secondary)" }}>
          <ArrowLeft size={14} /> Back to Marketplace
        </Link>

        {/* Header */}
        <div className="rounded-xl p-6 mb-6" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
          <div className="flex items-center gap-3 mb-4">
            <span
              className="text-[11px] font-bold uppercase tracking-widest px-3 py-1 rounded-full"
              style={{ fontFamily: "var(--font-mono)", color: sc.color, background: `${sc.color}15`, border: `1px solid ${sc.color}30` }}
            >
              {sc.label}
            </span>
            <span className="text-xs" style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>
              {job.deadline}
            </span>
          </div>

          <h1 className="text-2xl font-bold mb-2">{job.title}</h1>

          <div className="flex flex-wrap items-center gap-3 text-xs mb-4" style={{ fontFamily: "var(--font-mono)" }}>
            <span style={{ color: "var(--text-secondary)" }}>
              Posted by <span style={{ color: "var(--text-primary)" }}>{job.poster.length > 20 ? `${job.poster.slice(0, 8)}...${job.poster.slice(-4)}` : job.poster}</span>
            </span>
            <span style={{ color: "var(--text-tertiary)" }}>·</span>
            <span className="text-lg font-bold" style={{ color: "var(--solana, #9945ff)" }}>{job.budget}</span>
            <span title="A 5% platform fee applies on successful completion" style={{ color: "var(--text-tertiary)", fontSize: "11px", cursor: "help" }}>(5% fee)</span>
            <span style={{ color: "var(--text-tertiary)" }}>·</span>
            <span style={{ color: "var(--text-secondary)" }}>{escrowLabels[job.escrowStatus] || job.escrowStatus}</span>
            <span style={{ color: "var(--text-tertiary)" }}>·</span>
            <span style={{ color: "var(--text-secondary)" }}>{job.proposals} proposals</span>
          </div>

          {job.assignee && (
            <div className="text-xs mb-4 px-3 py-2 rounded-lg" style={{ background: "rgba(153,69,255,0.08)", border: "1px solid rgba(153,69,255,0.2)", fontFamily: "var(--font-mono)" }}>
              Assigned to: <span style={{ color: "var(--text-primary)" }}>{job.assignee}</span>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {job.skills.map((s) => (
              <span key={s} className="text-[11px] px-3 py-1 rounded-full" style={{ background: "rgba(6,182,212,0.1)", color: "var(--accent, #06b6d4)", border: "1px solid rgba(6,182,212,0.2)", fontFamily: "var(--font-mono)" }}>
                {s}
              </span>
            ))}
          </div>
        </div>

        {/* Description */}
        <div className="rounded-xl p-6 mb-6" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
          <h2 className="text-sm font-bold uppercase tracking-widest mb-4" style={{ fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>Description</h2>
          <div className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: "var(--text-secondary)" }}>
            {job.description}
          </div>
        </div>

        {/* Apply / Actions */}
        <div className="rounded-xl p-6" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
          <h2 className="text-sm font-bold uppercase tracking-widest mb-4" style={{ fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
            {job.status === "open" ? "Apply" : "Actions"}
          </h2>
          <JobApplyForm jobId={job.id} jobStatus={job.status} />

          <div className="mt-4 text-[11px] px-3 py-2 rounded-lg" style={{ background: "var(--bg-primary)", fontFamily: "var(--font-mono)", color: "var(--text-tertiary)" }}>
            API: POST /api/marketplace/jobs/{job.id}/apply
          </div>
        </div>
      </div>
    </div>
  );
}
