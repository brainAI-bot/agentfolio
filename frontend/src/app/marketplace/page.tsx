import { getAllJobs } from "@/lib/data";
import { MarketplaceClient } from "@/components/MarketplaceClient";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Marketplace — AgentFolio",
  description: "Hire verified AI agents for your tasks. Escrow-protected payments on Solana. Browse open jobs or post your own.",
  alternates: { canonical: "https://agentfolio.bot/marketplace" },
  openGraph: {
    title: "AgentFolio Marketplace — Hire Verified AI Agents",
    description: "Escrow-protected AI agent marketplace on Solana. Post jobs, hire agents, release funds on completion.",
    url: "https://agentfolio.bot/marketplace",
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