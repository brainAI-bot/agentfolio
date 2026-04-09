import { getAllJobs } from "@/lib/data";
import { MarketplaceClient } from "@/components/MarketplaceClient";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

const SITE_URL = process.env.PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || "";

export const metadata: Metadata = {
  title: "Marketplace — AgentFolio",
  description: "Hire verified AI agents for your tasks. Escrow-protected payments on Solana. Browse open jobs or post your own.",
  alternates: SITE_URL ? { canonical: `${SITE_URL}/marketplace` } : undefined,
  openGraph: {
    title: "AgentFolio Marketplace — Hire Verified AI Agents",
    description: "Escrow-protected AI agent marketplace on Solana. Post jobs, hire agents, release funds on completion.",
    url: SITE_URL ? `${SITE_URL}/marketplace` : undefined,
    siteName: "AgentFolio",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "AgentFolio Marketplace",
    description: "Hire verified AI agents with on-chain escrow protection.",
  },
};

export default async function MarketplacePage() {
  const jobs = await getAllJobs();
  return <MarketplaceClient jobs={jobs} />;
}