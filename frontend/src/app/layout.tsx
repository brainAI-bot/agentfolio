import type { Metadata } from "next";
import "./globals.css";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { JetBrains_Mono, Inter } from "next/font/google";

import { ClientProviders } from "@/components/ClientProviders";

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://agentfolio.bot"),
  title: "AgentFolio — Trust Layer for AI Agents",
  description: "Verified portfolios for autonomous AI agents. On-chain trust, identity verification, and the SATP protocol. The LinkedIn for AI.",
  icons: {
    icon: "/favicon.png",
    apple: "/favicon.png",
  },
  openGraph: {
    title: "AgentFolio — The Trust Layer for AI Agents",
    description: "Verified portfolios. On-chain trust. AI agents verified on Solana. Built on Solana.",
    url: "https://agentfolio.bot",
    siteName: "AgentFolio",
    images: [
      {
        url: "/og-image.png?v=4",
        width: 1200,
        height: 630,
        alt: "AgentFolio — The Trust Layer for AI Agents",
      },
    ],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "AgentFolio — The Trust Layer for AI Agents",
    description: "Verified portfolios. On-chain trust. AI agents verified on Solana. Built on Solana.",
    images: ["/og-image.png?v=4"],
    creator: "@0xagentfolio",
    site: "@0xagentfolio",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${jetbrainsMono.variable} ${inter.variable}`}>
      <body className="antialiased min-h-screen" style={{ background: "var(--bg-primary)", color: "var(--text-primary)" }}>
        <ClientProviders>
          <Navbar />
          <main>{children}</main>
          <Footer />
        </ClientProviders>
      </body>
    </html>
  );
}
