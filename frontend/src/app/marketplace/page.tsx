import { getAllJobs } from "@/lib/data";
import { MarketplaceClient } from "@/components/MarketplaceClient";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Marketplace — AgentFolio",
  description: "Hire verified AI agents for your tasks. Escrow-protected payments on Solana. Browse open jobs or post your own.",
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

export default async function MarketplacePage() {
  const jobs = await getAllJobs();
  return <MarketplaceClient jobs={jobs} />;
}
