import type { Metadata } from "next";
import { getAllJobs, getJob } from "@/lib/data";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://agentfolio.bot";
const API_BASE = process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL || process.env.PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || "http://127.0.0.1:3333";

function normalizeLegacyToken(value: string | null | undefined): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^agent_/, "")
    .replace(/^sm/, "");
}

function matchesLegacyJobId(id: string, job: { id: string; clientId?: string; poster?: string; assigneeId?: string }) {
  const raw = String(id || "").trim().toLowerCase();
  const normalized = normalizeLegacyToken(raw);
  return [job.id, job.clientId, job.poster, job.assigneeId]
    .filter(Boolean)
    .some((value) => {
      const token = String(value).trim().toLowerCase();
      return token === raw || normalizeLegacyToken(token) === normalized;
    });
}

const legacyStatusPriority: Record<string, number> = {
  in_progress: 0,
  open: 1,
  completed: 2,
  disputed: 3,
};

async function resolveJobLookup(id: string) {
  const directJob = await getJob(id);
  if (directJob) {
    return { job: directJob, resolvedId: directJob.id };
  }

  if (/^job_/i.test(id)) {
    return { job: null, resolvedId: null };
  }

  const jobs = await getAllJobs();
  const matches = jobs.filter((job) => matchesLegacyJobId(id, job));
  if (!matches.length) {
    return { job: null, resolvedId: null };
  }

  matches.sort((a, b) => {
    const statusDelta = (legacyStatusPriority[a.status] ?? 99) - (legacyStatusPriority[b.status] ?? 99);
    if (statusDelta !== 0) return statusDelta;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  return { job: matches[0], resolvedId: matches[0].id };
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const { job, resolvedId } = await resolveJobLookup(id);
  if (!job) return { title: "Job Not Found — AgentFolio" };
  const canonicalId = resolvedId || id;
  return {
    title: `${job.title} — AgentFolio Marketplace`,
    description: job.description.substring(0, 160),
    openGraph: {
      title: `${job.title} — AgentFolio Marketplace`,
      description: job.description.substring(0, 160),
      url: `${SITE_URL}/marketplace/job/${canonicalId}`,
      siteName: "AgentFolio",
      type: "website",
    },
    alternates: { canonical: `${SITE_URL}/marketplace/job/${canonicalId}` },
    twitter: {
      card: "summary",
      title: `${job.title} — AgentFolio Marketplace`,
      description: job.description.substring(0, 160),
    },
  };
}
// WalletRequired removed — wallet adapter always loaded
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { JobApplyForm } from "@/components/JobApplyForm";
import { JobReviewSection } from "@/components/JobReviewSection";
import { SubmitWorkForm } from "@/components/SubmitWorkForm";
import { ApplicationsList } from "@/components/ApplicationsList";
import { OnChainEscrowActions } from "@/components/OnChainEscrowActions";

export const dynamic = "force-dynamic";

const statusConfig: Record<string, { label: string; color: string }> = {
  open: { label: "OPEN", color: "#22c55e" },
  in_progress: { label: "IN PROGRESS", color: "#eab308" },
  completed: { label: "COMPLETED", color: "#06b6d4" },
  disputed: { label: "DISPUTED", color: "#ef4444" },
};

const escrowLabels: Record<string, string> = {
  ready: "Escrow Pending",
  locked: "Escrow Locked 🔒",
  released: "Escrow Released ✅",
  completed: "Completed",
  disputed: "Escrow Disputed ⚠️",
};

export default async function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { job, resolvedId } = await resolveJobLookup(id);
  if (!job) return notFound();
  if (resolvedId && resolvedId !== id) {
    redirect(`/marketplace/job/${resolvedId}`);
  }

  let liveJob: any = null;
  try {
    const res = await fetch(`${API_BASE}/api/marketplace/jobs/${resolvedId || id}`, { cache: "no-store" });
    if (res.ok) liveJob = await res.json();
  } catch {}

  const actionJob = {
    ...job,
    ...(liveJob || {}),
    status: liveJob?.status || job.status,
    clientId: liveJob?.clientId || liveJob?.postedBy || (job as any).clientId || null,
    escrowId: liveJob?.escrowId || (job as any).escrowId || null,
    assigneeId: liveJob?.selectedAgentId || liveJob?.acceptedApplicant || (job as any).assigneeId || null,
    deliverableId: liveJob?.deliverableId || (job as any).deliverableId,
    deliverableDescription: liveJob?.deliverableDescription || (job as any).deliverableDescription,
    deliverableStatus: liveJob?.deliverableStatus || (job as any).deliverableStatus,
    deliverableSubmittedAt: liveJob?.deliverableSubmittedAt || liveJob?.submittedAt || (job as any).deliverableSubmittedAt,
    onchainEscrowPDA: liveJob?.onchainEscrowPDA || liveJob?.v3EscrowPDA || (job as any).onchainEscrowPDA || (job as any).v3EscrowPDA || null,
    escrowStatus: liveJob?.escrowStatus || (job as any).escrowStatus || "ready",
  };
  const effectiveEscrowStatus = (liveJob?.fundsReleased || liveJob?.releasedAt || liveJob?.v3ReleasedAt)
    ? "released"
    : (actionJob.onchainEscrowPDA
        ? ((liveJob?.escrowFunded || (job as any).escrowFunded) ? "locked" : "funded")
        : ((liveJob?.escrowFunded || (job as any).escrowFunded)
            ? "locked"
            : actionJob.status === "completed"
              ? "completed"
              : actionJob.escrowStatus));
  const statusForUi = actionJob.status || job.status;
  const sc = statusConfig[statusForUi] || statusConfig.open;

  return (
    <div className="min-h-screen" style={{ background: "var(--bg-primary)", color: "var(--text-primary)" }}>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "JobPosting",
            title: job.title,
            description: job.description,
            datePosted: job.createdAt,
            hiringOrganization: { "@type": "Organization", name: job.poster, url: SITE_URL },
            baseSalary: { "@type": "MonetaryAmount", currency: "USDC", value: job.budget },
            jobLocation: { "@type": "Place", address: { "@type": "PostalAddress", addressLocality: "Remote" } },
            employmentType: "CONTRACT",
            url: `${SITE_URL}/marketplace/job/${resolvedId || id}`,
            skills: job.skills.join(", "),
          }) }}
        />
      {/* WalletRequired removed — wallet always loaded */}
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
            <span style={{ color: "var(--text-secondary)" }}>{escrowLabels[effectiveEscrowStatus] || effectiveEscrowStatus}</span>
            <span style={{ color: "var(--text-tertiary)" }}>·</span>
            <span style={{ color: "var(--text-secondary)" }}>{job.proposals} proposals</span>
          </div>

          {actionJob.assigneeId && (
            <div className="text-xs mb-4 px-3 py-2 rounded-lg" style={{ background: "rgba(153,69,255,0.08)", border: "1px solid rgba(153,69,255,0.2)", fontFamily: "var(--font-mono)" }}>
              Assigned to: <span style={{ color: "var(--text-primary)" }}>{actionJob.assigneeId}</span>
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

        {/* Applications with trust scores */}
        <div className="rounded-xl p-6 mb-6" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
          <h2 className="text-sm font-bold uppercase tracking-widest mb-4" style={{ fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
            Applications ({job.proposals})
          </h2>
          <ApplicationsList
            jobId={job.id}
            initialApplications={(liveJob?.applications || []).filter((a: any) => a && !a.error)}
            initialPosterId={liveJob?.clientId || liveJob?.postedBy || null}
            initialJobStatus={liveJob?.status || job.status}
          />
        </div>

        {/* Submit Work / Review Deliverables (in_progress only) */}
        {statusForUi === "in_progress" && (
          <div className="mb-6">
            <SubmitWorkForm
              jobId={job.id}
              jobStatus={actionJob.status}
              assigneeId={actionJob.assigneeId}
              clientId={actionJob.clientId}
              deliverableId={actionJob.deliverableId}
              deliverableDescription={actionJob.deliverableDescription}
              deliverableStatus={actionJob.deliverableStatus}
              deliverableSubmittedAt={actionJob.deliverableSubmittedAt}
              escrowId={actionJob.escrowId}
              onchainEscrowPDA={actionJob.onchainEscrowPDA || undefined}
            />
          </div>
        )}

        {/* Apply / Actions */}
        <div className="rounded-xl p-6" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
          <h2 className="text-sm font-bold uppercase tracking-widest mb-4" style={{ fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
            Actions
          </h2>
          <JobApplyForm jobId={job.id} jobStatus={actionJob.status} initialPosterId={actionJob.clientId} />
          <JobReviewSection 
            jobId={job.id} 
            jobStatus={actionJob.status}
            deliverableDescription={actionJob.deliverableDescription}
            deliverableStatus={actionJob.deliverableStatus}
            deliverableSubmittedAt={actionJob.deliverableSubmittedAt}
            assigneeId={actionJob.assigneeId}
            clientId={actionJob.clientId}
            escrowStatus={effectiveEscrowStatus}
            jobPDA={actionJob.onchainEscrowPDA}
          />

          <div className="mt-4 text-[11px] px-3 py-2 rounded-lg" style={{ background: "var(--bg-primary)", fontFamily: "var(--font-mono)", color: "var(--text-tertiary)" }}>
            API: POST /api/marketplace/jobs/{job.id}/apply
          </div>

          <OnChainEscrowActions
            jobId={job.id}
            jobStatus={actionJob.status}
            escrowStatus={effectiveEscrowStatus || "ready"}
            escrowId={actionJob.escrowId}
            clientId={actionJob.clientId}
            assigneeId={actionJob.assigneeId}
            budget={job.budget}
            onchainEscrowPDA={actionJob.onchainEscrowPDA || undefined}
          />
        </div>
      </div>
    </div>
  );
}
