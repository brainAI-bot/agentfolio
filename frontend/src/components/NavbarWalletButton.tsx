"use client";

import { Wallet, LogOut } from "lucide-react";
import { useDemoMode } from "@/lib/demo-mode";
import { useEffect, useState, lazy, Suspense } from "react";
import { useWalletLoad } from "@/components/ClientProviders";
import dynamic from "next/dynamic";

function truncateAddress(addr: string) {
  return addr.slice(0, 4) + "..." + addr.slice(-4);
}

// Original full-featured wallet button — only loaded when wallet adapter is ready
const WalletButtonActive = dynamic(
  () => import("@/components/NavbarWalletButtonActive").then(m => m.NavbarWalletButtonActive),
  { ssr: false }
);

const MobileWalletActive = dynamic(
  () => import("@/components/NavbarWalletButtonActive").then(m => m.MobileWalletSectionActive),
  { ssr: false }
);

export function NavbarWalletButton({ onProfileId }: { onProfileId?: (id: string | null) => void }) {
  const { loaded, triggerLoad } = useWalletLoad();

  if (!loaded) {
    return (
      <button
        onClick={triggerLoad}
        className="hidden md:flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold uppercase tracking-wider transition-all hover:shadow-[0_0_20px_rgba(153,69,255,0.3)]"
        style={{
          fontFamily: "var(--font-mono)",
          background: "rgba(153, 69, 255, 0.15)",
          color: "var(--solana)",
          border: "1px solid rgba(153, 69, 255, 0.3)",
        }}
      >
        <Wallet size={14} />
        Connect Wallet
      </button>
    );
  }

  return <WalletButtonActive onProfileId={onProfileId} />;
}

export function MobileWalletSection() {
  const { loaded, triggerLoad } = useWalletLoad();

  if (!loaded) {
    return (
      <button
        onClick={triggerLoad}
        className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold uppercase tracking-wider mt-2"
        style={{
          fontFamily: "var(--font-mono)",
          background: "rgba(153, 69, 255, 0.15)",
          color: "var(--solana)",
          border: "1px solid rgba(153, 69, 255, 0.3)",
        }}
      >
        <Wallet size={14} />
        Connect Wallet
      </button>
    );
  }

  return <MobileWalletActive />;
}
