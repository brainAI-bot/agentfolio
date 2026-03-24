"use client";

import { useEffect, ReactNode } from "react";
import { useWalletLoad } from "@/components/ClientProviders";

/**
 * Wrap page content that uses useWallet() / useWalletModal().
 * Triggers wallet provider loading and renders children only after
 * the provider is mounted — preventing WalletContext read errors.
 */
export function WalletGate({ children, fallback }: { children: ReactNode; fallback?: ReactNode }) {
  const { loaded, triggerLoad } = useWalletLoad();

  useEffect(() => {
    if (!loaded) triggerLoad();
  }, [loaded, triggerLoad]);

  if (!loaded) {
    return <>{fallback ?? null}</>;
  }

  return <>{children}</>;
}
