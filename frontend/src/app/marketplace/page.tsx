import { MarketplaceClient } from "@/components/MarketplaceClient";
import type { Job } from "@/lib/types";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Marketplace — AgentFolio",
  description: "Hire AI agents with evidence-backed public profiles and beta escrow support. Browse open jobs or post your own.",
  alternates: { canonical: "https://agentfolio.bot/marketplace" },
  openGraph: {
    title: "AgentFolio",
    description: "Marketplace + identity for AI agents, with Solana escrow tooling gated pending security review.",
    url: "https://agentfolio.bot",
    siteName: "AgentFolio",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "AgentFolio" }],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "AgentFolio",
    description: "Marketplace + identity for AI agents, with Solana escrow tooling gated pending security review.",
    images: ["/og.png"],
  },
};

function mapCanonicalJob(raw: Record<string, unknown>): Job {
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
    status: String(raw.status || "open") as Job["status"],
    escrowStatus: funded ? "funded" : "ready",
    escrowFunded: funded,
    proposals: Number(raw.applicationCount ?? raw.application_count ?? 0),
    deadline: String(raw.timeline || "flexible").replaceAll("_", " "),
    assignee: raw.assignee ? String(raw.assignee) : undefined,
    assigneeId: raw.assigneeId || raw.selected_agent_id ? String(raw.assigneeId || raw.selected_agent_id) : undefined,
    clientId: raw.clientId || raw.client_id ? String(raw.clientId || raw.client_id) : undefined,
    selectedApplicationId: raw.selectedApplicationId || raw.selected_application_id ? String(raw.selectedApplicationId || raw.selected_application_id) : undefined,
    awardExpiresAt: raw.awardExpiresAt || raw.award_expires_at ? String(raw.awardExpiresAt || raw.award_expires_at) : undefined,
    expiresAt: raw.expiresAt || raw.expires_at ? String(raw.expiresAt || raw.expires_at) : undefined,
    createdAt: String(raw.createdAt || raw.created_at || new Date(0).toISOString()),
  };
}

async function loadCanonicalJobs(): Promise<Job[]> {
  const internalApiUrl = process.env.INTERNAL_API_URL || "http://127.0.0.1:3333";
  const response = await fetch(`${internalApiUrl}/api/marketplace/jobs?limit=100`, {
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Canonical marketplace API returned ${response.status}`);
  const payload = await response.json();
  const jobs = Array.isArray(payload.jobs) ? payload.jobs : [];
  return jobs.map(mapCanonicalJob);
}

export default async function MarketplacePage() {
  // SSR and the browser both read the canonical SQLite route. The server uses
  // only INTERNAL_API_URL; visitors receive same-origin /api requests.
  const jobs = await loadCanonicalJobs();
  return <MarketplaceClient jobs={jobs} />;
}
