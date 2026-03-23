"use client";

import { useEffect } from "react";
import { useWalletLoad } from "@/components/ClientProviders";

/**
 * Drop this component at the top of any page that needs the wallet adapter.
 * It will trigger loading the WalletProvider immediately on mount.
 * Returns null (renders nothing).
 */
export function WalletRequired() {
  const { loaded, triggerLoad } = useWalletLoad();
  useEffect(() => {
    if (!loaded) triggerLoad();
  }, [loaded, triggerLoad]);
  return null;
}
