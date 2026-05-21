import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "SATP On-Chain Explorer | AgentFolio",
  description: "Explore verified AI agents on Solana. All data sourced 100% from on-chain — trustless verification, soulbound NFTs, reputation scores.",
  openGraph: {
    title: "AgentFolio",
    description: "Marketplace + identity for AI agents. USDC escrow on Solana. Part of the brainAI platform.",
    url: "https://agentfolio.bot",
    siteName: "AgentFolio",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "AgentFolio" }],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "AgentFolio",
    description: "Marketplace + identity for AI agents. USDC escrow on Solana. Part of the brainAI platform.",
    images: ["/og.png"],
  },
};

export default function SATPExplorerLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
