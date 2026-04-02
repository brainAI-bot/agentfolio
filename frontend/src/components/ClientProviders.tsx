"use client";

import { ReactNode } from "react";
import { WalletProvider } from "@/components/WalletProvider";

// No lazy loading, no dynamic imports. Wallet adapter is ALWAYS loaded.
export function useWalletLoad() {
  return { loaded: true, triggerLoad: () => {}, pendingConnect: false, clearPendingConnect: () => {} };
}

export function ClientProviders({ children }: { children: ReactNode }) {
  return <WalletProvider>{children}</WalletProvider>;
}
