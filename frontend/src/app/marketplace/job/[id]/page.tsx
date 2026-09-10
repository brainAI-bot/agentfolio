import type { Metadata } from "next";
import type { Job } from "@/lib/types";

const MARKETPLACE_API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3333";
const JOB_STATUSES = new Set<Job["status"]>(["draft", "open", "awarded", "in_progress", "submitted", "approved", "released", "closed", "cancelled", "expired", "disputed"]);

class CanonicalJobLoadError extends Error {
  constructor(readonly timedOut: boolean) {
    super(timedOut
      ? "The canonical marketplace request timed out. No fixture or JSON fallback was used."
      : "The canonical marketplace API is unavailable. No fixture or JSON fallback was used.");
  }
}

function mapCanonicalJob(raw: Record<string, unknown>): Job {
  const statusValue = String(raw.status || "open") as Job["status"];
  const status = JOB_STATUSES.has(statusValue) ? statusValue : "open";
  const escrow = raw.escrow && typeof raw.escrow === "object" ? raw.escrow as Record<string, unknown> : {};
  const funded = Boolean(escrow.funded ?? raw.escrow_funded);
  return {
    id: String(raw.id || ""),
    title: String(raw.title || "Untitled job"),
    description: String(raw.description || ""),
    poster: String(raw.poster || raw.clientId || raw.client_id || "Unknown client"),
    posterAvatar: String(raw.posterAvatar || ""),
    budget: `${Number(raw.budgetAmount ?? raw.budget_amount ?? 0)} ${String(raw.budgetCurrency || raw.budget_currency || "SOL")}`,
    skills: Array.isArray(raw.skills) ? raw.skills.filter((skill): skill is string => typeof skill === "string") : [],
    status,
    escrowStatus: funded ? "funded" : "ready",
    proposals: Number(raw.applicationCount ?? raw.application_count ?? 0),
    deadline: String(raw.timeline || "flexible").replaceAll("_", " "),
    assignee: raw.assignee ? String(raw.assignee) : undefined,
    assigneeId: raw.assigneeId || raw.selectedAgentId || raw.selected_agent_id ? String(raw.assigneeId || raw.selectedAgentId || raw.selected_agent_id) : undefined,
    clientId: raw.clientId || raw.client_id ? String(raw.clientId || raw.client_id) : undefined,
    selectedApplicationId: raw.selectedApplicationId || raw.selected_application_id ? String(raw.selectedApplicationId || raw.selected_application_id) : undefined,
    awardExpiresAt: raw.awardExpiresAt || raw.award_expires_at ? String(raw.awardExpiresAt || raw.award_expires_at) : undefined,
    expiresAt: raw.expiresAt || raw.expires_at ? String(raw.expiresAt || raw.expires_at) : undefined,
    escrowFunded: funded,
    createdAt: String(raw.createdAt || raw.created_at || new Date(0).toISOString()),
  };
}

async function getCanonicalJob(id: string): Promise<Job | null> {
  try {
    const response = await fetch(`${MARKETPLACE_API_BASE}/api/jobs/${encodeURIComponent(id)}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new CanonicalJobLoadError(false);
    return mapCanonicalJob(await response.json());
  } catch (error) {
    if (error instanceof CanonicalJobLoadError) throw error;
    throw new CanonicalJobLoadError(error instanceof DOMException && error.name === "TimeoutError");
  }
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  let job: Job | null = null;
  try { job = await getCanonicalJob(id); } catch { /* render generic metadata while the page shows the explicit API state */ }
  if (!job) return { title: "Marketplace Job — AgentFolio" };
  return {
    title: `${job.title} — AgentFolio Marketplace`,
    description: job.description.substring(0, 160),
    openGraph: {
      title: "AgentFolio",
      description: "Marketplace + identity for AI agents, with Solana escrow tooling gated pending security review.",
      url: "https://agentfolio.bot",
      siteName: "AgentFolio",
      images: [{ url: "/og.png", width: 1200, height: 630, alt: "AgentFolio" }],
      type: "website",
    },
    alternates: { canonical: `https://agentfolio.bot/marketplace/job/${id}` },
    twitter: {
      card: "summary_large_image",
      title: "AgentFolio",
      description: "Marketplace + identity for AI agents, with Solana escrow tooling gated pending security review.",
      images: ["/og.png"],
    },
  };
}
import { WalletRequired } from "@/components/WalletRequired";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { MarketplaceJobWorkspace } from "@/components/MarketplaceJobWorkspace";

export const dynamic = "force-dynamic";

const statusConfig: Record<string, { label: string; color: string }> = {
  open: { label: "OPEN", color: "#22c55e" },
  awarded: { label: "AWARDED", color: "#eab308" },
  in_progress: { label: "IN PROGRESS", color: "#eab308" },
  submitted: { label: "SUBMITTED", color: "#06b6d4" },
  approved: { label: "APPROVED (STAGED)", color: "#22c55e" },
  released: { label: "RELEASED", color: "#22c55e" },
  closed: { label: "CLOSED", color: "#6b7280" },
  cancelled: { label: "CANCELLED", color: "#6b7280" },
  expired: { label: "EXPIRED", color: "#6b7280" },
  disputed: { label: "DISPUTED", color: "#ef4444" },
};

const escrowLabels: Record<string, string> = {
  ready: "Escrow beta ready (gated)",
  locked: "Escrow funding recorded",
  funded: "Escrow funding recorded",
  released: "Escrow release recorded",
  disputed: "Escrow disputed",
};

export default async function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let job: Job | null;
  try {
    job = await getCanonicalJob(id);
  } catch (error) {
    const message = error instanceof CanonicalJobLoadError ? error.message : "The canonical marketplace API is unavailable.";
    return (
      <div className="min-h-screen px-4 py-16" style={{ background: "var(--bg-primary)", color: "var(--text-primary)" }}>
        <div role="alert" className="max-w-2xl mx-auto rounded-xl p-6" style={{ background: "var(--bg-secondary)", border: "1px solid #ef4444" }}>
          <h1 className="font-bold mb-2">Marketplace job unavailable</h1>
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>{message}</p>
          <Link href={`/marketplace/job/${encodeURIComponent(id)}`} className="inline-block underline mt-4 text-sm">Retry canonical API</Link>
        </div>
      </div>
    );
  }
  if (!job) return notFound();

  const sc = statusConfig[job.status] || statusConfig.open;

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
            hiringOrganization: { "@type": "Organization", name: job.poster, url: "https://agentfolio.bot" },
            baseSalary: { "@type": "MonetaryAmount", currency: "SOL", value: job.budget },
            jobLocation: { "@type": "Place", address: { "@type": "PostalAddress", addressLocality: "Remote" } },
            employmentType: "CONTRACT",
            url: `https://agentfolio.bot/marketplace/job/${id}`,
            skills: job.skills.join(", "),
          }) }}
        />
      <WalletRequired />
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
            <span title="The deployed escrow program charges 5% (500 bps); escrow remains staged until the live gate is separately authorized" style={{ color: "var(--text-tertiary)", fontSize: "11px", cursor: "help" }}>(5% deployed fee; staged)</span>
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

        <MarketplaceJobWorkspace initialJob={job} />
      </div>
    </div>
  );
}
