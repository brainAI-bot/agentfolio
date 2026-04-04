"use client";

import { Wallet, LogOut } from "lucide-react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useSmartConnect } from "@/components/WalletProvider";
import { useDemoMode } from "@/lib/demo-mode";
import { useEffect } from "react";

function truncateAddress(addr: string) {
  return addr.slice(0, 4) + "..." + addr.slice(-4);
}

export function NavbarWalletButtonActive({ onProfileId }: { onProfileId?: (id: string | null) => void }) {
  const wallet = useWallet();
  const { smartConnect } = useSmartConnect();
  const { isDemo, demoPublicKey } = useDemoMode();
  const connected = isDemo ? true : wallet.connected;
  const publicKey = isDemo ? demoPublicKey : wallet.publicKey;

  const handleConnect = () => { smartConnect(); };
  const handleDisconnect = () => { if (!isDemo) wallet.disconnect(); onProfileId?.(null); };

  useEffect(() => {
    if (!publicKey) { onProfileId?.(null); return; }
    const addr = publicKey.toBase58();
    fetch(`/api/wallet/lookup/${addr}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => onProfileId?.(d?.profileId || d?.profile?.id || d?.id || null))
      .catch(() => onProfileId?.(null));
  }, [publicKey, onProfileId]);

  if (connected && publicKey) {
    return (
      <>
        <div className="hidden md:flex items-center gap-2">
          <div
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs"
            style={{
              fontFamily: "var(--font-mono)",
              background: "rgba(153, 69, 255, 0.1)",
              border: "1px solid rgba(153, 69, 255, 0.2)",
              color: "var(--solana)",
            }}
          >
            <Wallet size={12} />
            <span>{truncateAddress(publicKey.toBase58())}</span>
          </div>
          <button
            onClick={handleDisconnect}
            className="p-1.5 rounded-lg transition-all hover:bg-[var(--bg-tertiary)]"
            style={{ color: "var(--text-tertiary)" }}
            title="Disconnect wallet"
          >
            <LogOut size={14} />
          </button>
        </div>
      </>
    );
  }

  return (
    <button
      onClick={handleConnect}
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

export function MobileWalletSectionActive() {
  const wallet = useWallet();
  const { smartConnect } = useSmartConnect();
  const { isDemo, demoPublicKey } = useDemoMode();
  const connected = isDemo ? true : wallet.connected;
  const publicKey = isDemo ? demoPublicKey : wallet.publicKey;

  const handleConnect = () => { smartConnect(); };
  const handleDisconnect = () => { if (!isDemo) wallet.disconnect(); };

  if (connected && publicKey) {
    return (
      <div className="space-y-2 pt-2">
        <div
          className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-xs"
          style={{
            fontFamily: "var(--font-mono)",
            background: "rgba(153, 69, 255, 0.1)",
            border: "1px solid rgba(153, 69, 255, 0.2)",
            color: "var(--solana)",
          }}
        >
          <Wallet size={12} />
          {truncateAddress(publicKey.toBase58())}
        </div>
        <button
          onClick={handleDisconnect}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold uppercase tracking-wider"
          style={{
            fontFamily: "var(--font-mono)",
            color: "var(--text-tertiary)",
            border: "1px solid var(--border)",
          }}
        >
          <LogOut size={14} />
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={handleConnect}
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
