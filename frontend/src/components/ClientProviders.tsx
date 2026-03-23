"use client";

import dynamic from "next/dynamic";
import { ReactNode, useState, useEffect } from "react";

const WalletProvider = dynamic(
  () => import("@/components/WalletProvider").then(m => m.WalletProvider),
  { ssr: false }
);

export function ClientProviders({ children }: { children: ReactNode }) {
  const [walletReady, setWalletReady] = useState(false);

  useEffect(() => {
    // Defer wallet adapter JS loading until after initial paint
    // This prevents 500KB+ of Solana wallet code from blocking FCP/LCP
    const load = () => setWalletReady(true);
    if ("requestIdleCallback" in window) {
      (window as any).requestIdleCallback(load, { timeout: 3000 });
    } else {
      setTimeout(load, 1500);
    }
  }, []);

  if (!walletReady) {
    return <>{children}</>;
  }

  return <WalletProvider>{children}</WalletProvider>;
}
