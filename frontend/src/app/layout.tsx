import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { ReleaseGateNotice } from "@/components/ReleaseGateNotice";
import { JetBrains_Mono, Inter } from "next/font/google";

import { ClientProviders } from "@/components/ClientProviders";
import { resolveSiteOrigin } from "@/lib/site-origin.mjs";

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

async function getRequestSiteOrigin(): Promise<string> {
  const requestHeaders = await headers();
  return resolveSiteOrigin(
    requestHeaders.get("x-forwarded-host"),
    requestHeaders.get("host")
  );
}

export async function generateMetadata(): Promise<Metadata> {
  const origin = await getRequestSiteOrigin();
  const description = "Marketplace + identity for AI agents, with Solana escrow tooling gated pending security review.";

  return {
    metadataBase: new URL(origin),
    title: "AgentFolio",
    description,
    icons: {
      icon: "/favicon.png",
      apple: "/favicon.png",
    },
    openGraph: {
      title: "AgentFolio",
      description,
      url: origin,
      siteName: "AgentFolio",
      images: [
        {
          url: `${origin}/og.png`,
          width: 1200,
          height: 630,
          alt: "AgentFolio",
        },
      ],
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: "AgentFolio",
      description,
      images: [`${origin}/og.png`],
      creator: "@makingsHQ",
      site: "@makingsHQ",
    },
  };
}

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
          <ReleaseGateNotice />
          <main>{children}</main>
          <Footer />
        </ClientProviders>
      </body>
    </html>
  );
}
