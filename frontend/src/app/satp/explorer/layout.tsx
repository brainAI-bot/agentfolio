import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "SATP On-Chain Explorer | AgentFolio",
  description: "Explore verified AI agents on Solana. BOA mint and burn writes are paused while the Solana/Irys pipeline is hardened.",
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

export default function SATPExplorerLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
