"use client";

import dynamic from "next/dynamic";
import { ReactNode, useState, useCallback, createContext, useContext } from "react";

const WalletProvider = dynamic(
  () => import("@/components/WalletProvider").then(m => m.WalletProvider),
  { ssr: false }
);

// Context to let any component trigger wallet loading
const WalletLoadContext = createContext<{ loaded: boolean; triggerLoad: () => void }>({
  loaded: false,
  triggerLoad: () => {},
});

export function useWalletLoad() {
  return useContext(WalletLoadContext);
}

export function ClientProviders({ children }: { children: ReactNode }) {
  const [walletReady, setWalletReady] = useState(false);

  const triggerLoad = useCallback(() => {
    if (!walletReady) setWalletReady(true);
  }, [walletReady]);

  // Always render WalletProvider so useWallet() never throws.
  // The dynamic import means the JS only loads client-side.
  return (
    <WalletLoadContext.Provider value={{ loaded: walletReady, triggerLoad }}>
      <WalletProvider>{children}</WalletProvider>
    </WalletLoadContext.Provider>
  );
}
