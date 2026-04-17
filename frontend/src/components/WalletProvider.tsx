"use client";

import { useMemo, useCallback, ReactNode, useState, createContext, useContext } from "react";
import { ConnectionProvider, WalletProvider as SolanaWalletProvider, useWallet } from "@solana/wallet-adapter-react";
import { WalletModalProvider, useWalletModal } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter, SolflareWalletAdapter } from "@solana/wallet-adapter-wallets";
import { clusterApiUrl } from "@solana/web3.js";

import "@solana/wallet-adapter-react-ui/styles.css";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "";
const SOLANA_CLUSTER = process.env.NEXT_PUBLIC_SOLANA_CLUSTER || "mainnet-beta";
const FALLBACK_HELIUS_RPC_URL = "https://mainnet.helius-rpc.com/?api-key=91c63e44-1c7a-4b98-830b-6135632565fb";
const SOLANA_RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || FALLBACK_HELIUS_RPC_URL || clusterApiUrl(SOLANA_CLUSTER as "devnet" | "testnet" | "mainnet-beta");

function isMobileBrowser(): boolean {
  if (typeof window === "undefined") return false;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

function isPhantomInjected(): boolean {
  if (typeof window === "undefined") return false;
  return !!(window as any).phantom?.solana?.isPhantom;
}

function isSolflareInjected(): boolean {
  if (typeof window === "undefined") return false;
  return !!(window as any).solflare?.isSolflare;
}

// Mobile wallet deep link modal
function MobileDeepLinkModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  if (!visible) return null;

  const currentUrl = typeof window !== "undefined" ? window.location.href : (SITE_URL || "");
  const refUrl = typeof window !== "undefined" ? window.location.origin : (SITE_URL || currentUrl);
  // Phantom universal link — opens the current page inside Phantom's in-app browser
  const phantomLink = `https://phantom.app/ul/browse/${encodeURIComponent(currentUrl)}?ref=${encodeURIComponent(refUrl)}`;
  const solflareLink = `https://solflare.com/ul/v1/browse/${encodeURIComponent(currentUrl)}`;

  return (
    <div className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-sm mx-4 mb-6 sm:mb-0 rounded-2xl overflow-hidden animate-in slide-in-from-bottom"
        style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6">
          <div className="flex items-center justify-between mb-5">
            <h3 className="text-base font-bold" style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>
              Open in Wallet App
            </h3>
            <button onClick={onClose} className="text-xl leading-none p-1" style={{ color: "var(--text-tertiary)" }}>✕</button>
          </div>
          <p className="text-xs mb-5 leading-relaxed" style={{ color: "var(--text-secondary)" }}>
            Mobile wallets work through their in-app browser. Tap below to open AgentFolio inside your wallet app — your wallet will connect automatically.
          </p>
          <div className="space-y-3">
            <a
              href={phantomLink}
              className="flex items-center gap-3 w-full p-4 rounded-xl transition-all active:scale-[0.98]"
              style={{ background: "rgba(171, 154, 255, 0.08)", border: "1px solid rgba(171, 154, 255, 0.2)" }}
            >
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, #AB9AFF, #534AB6)" }}>
                <span className="text-white text-lg">👻</span>
              </div>
              <div className="flex-1">
                <div className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>Phantom</div>
                <div className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>Open in Phantom browser</div>
              </div>
              <span style={{ color: "var(--text-tertiary)" }}>→</span>
            </a>
            <a
              href={solflareLink}
              className="flex items-center gap-3 w-full p-4 rounded-xl transition-all active:scale-[0.98]"
              style={{ background: "rgba(252, 148, 31, 0.06)", border: "1px solid rgba(252, 148, 31, 0.2)" }}
            >
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, #FC941F, #E87B00)" }}>
                <span className="text-white text-lg">☀️</span>
              </div>
              <div className="flex-1">
                <div className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>Solflare</div>
                <div className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>Open in Solflare browser</div>
              </div>
              <span style={{ color: "var(--text-tertiary)" }}>→</span>
            </a>
          </div>
          <p className="text-[10px] mt-5 text-center leading-relaxed" style={{ color: "var(--text-tertiary)" }}>
            Already inside a wallet browser? Close this and tap Connect again.
          </p>
        </div>
      </div>
    </div>
  );
}

// Context for smart wallet connect
const SmartConnectContext = createContext<{ smartConnect: () => void }>({ smartConnect: () => {} });
export function useSmartConnect() { return useContext(SmartConnectContext); }

function SmartConnectProvider({ children }: { children: ReactNode }) {
  const [showMobileModal, setShowMobileModal] = useState(false);
  const { setVisible } = useWalletModal();

  const smartConnect = useCallback(() => {
    // If we're on mobile and NO wallet is injected, show deep link modal
    if (isMobileBrowser() && !isPhantomInjected() && !isSolflareInjected()) {
      setShowMobileModal(true);
    } else {
      // Desktop (extension available) or inside wallet browser — use standard modal
      setVisible(true);
    }
  }, [setVisible]);

  return (
    <SmartConnectContext.Provider value={{ smartConnect }}>
      {children}
      <MobileDeepLinkModal visible={showMobileModal} onClose={() => setShowMobileModal(false)} />
    </SmartConnectContext.Provider>
  );
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const endpoint = useMemo(() => SOLANA_RPC_URL, []);
  const wallets = useMemo(() => [
    new PhantomWalletAdapter(),
    new SolflareWalletAdapter(),
  ], []);

  return (
    <ConnectionProvider endpoint={endpoint}>
      <SolanaWalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <SmartConnectProvider>
            {children}
          </SmartConnectProvider>
        </WalletModalProvider>
      </SolanaWalletProvider>
    </ConnectionProvider>
  );
}
