import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "SATP On-Chain Explorer | AgentFolio",
  description: "Explore verified AI agents on Solana. All data sourced 100% from on-chain — trustless verification, soulbound NFTs, reputation scores.",
  openGraph: {
    title: "SATP On-Chain Explorer | AgentFolio",
    description: "Explore verified AI agents on Solana. Trustless, on-chain data.",
    siteName: "AgentFolio",
  },
};

export default function SATPExplorerLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
