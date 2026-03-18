"use client";

import Link from "next/link";

import { Menu, X, Terminal, Wallet, LogOut } from "lucide-react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useSmartConnect } from "@/components/WalletProvider";
import { useDemoMode } from "@/lib/demo-mode";
import { useEffect, useState } from "react";

const staticNavLinks = [
  { href: "/", label: "Directory" },
  { href: "/marketplace", label: "Marketplace" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/satp", label: "SATP" },
  { href: "/verify", label: "Verify" },
  { href: "/mint", label: "Mint" },
  { href: "/stats", label: "Stats" },
  { href: "/how-it-works", label: "How It Works" },
];

function truncateAddress(addr: string) {
  return addr.slice(0, 4) + "..." + addr.slice(-4);
}

export function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const wallet = useWallet();
  const { setVisible } = useWalletModal();
  const { smartConnect } = useSmartConnect();
  const { isDemo, demoPublicKey } = useDemoMode();
  const [myProfileId, setMyProfileId] = useState<string | null>(null);
  const connected = isDemo ? true : wallet.connected;
  const publicKey = isDemo ? demoPublicKey : wallet.publicKey;

  const handleConnect = () => {
    smartConnect();
  };

  const handleDisconnect = () => {
    if (!isDemo) wallet.disconnect();
    setMyProfileId(null);
  };

  useEffect(() => {
    if (!publicKey) { setMyProfileId(null); return; }
    const addr = publicKey.toBase58();
    fetch(`/api/wallet/lookup/${addr}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.profile?.id) setMyProfileId(d.profile.id); else setMyProfileId(null); })
      .catch(() => setMyProfileId(null));
  }, [publicKey]);

  const navLinks = [
    staticNavLinks[0],
    myProfileId
      ? { href: `/profile/${myProfileId}`, label: "My Profile", highlight: true }
      : { href: "/register", label: "Register", highlight: true },
    ...staticNavLinks.slice(1),
  ];

  return (
    <nav className="sticky top-0 z-50 border-b-2 border-b-[var(--accent)]" style={{ background: "var(--bg-secondary)" }}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2">
            <Terminal size={20} className="text-[var(--accent)]" />
            <span
              className="text-lg font-bold tracking-tight"
              style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}
            >
              AgentFolio
            </span>
          </Link>

          {/* Desktop nav */}
          <div className="hidden md:flex items-center gap-6">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-sm uppercase tracking-widest transition-colors hover:text-[var(--accent-bright)]"
                style={{ fontFamily: "var(--font-mono)", color: "var(--text-secondary)", fontSize: "11px", fontWeight: 500, letterSpacing: "0.08em" }}
              >
                {link.label}
              </Link>
            ))}
          </div>

          {/* Wallet + mobile */}
          <div className="flex items-center gap-3">
            {connected && publicKey ? (
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
            ) : (
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
            )}
            <button
              className="md:hidden"
              onClick={() => setMobileOpen(!mobileOpen)}
              style={{ color: "var(--text-primary)" }}
            >
              {mobileOpen ? <X size={24} /> : <Menu size={24} />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="md:hidden border-t" style={{ borderColor: "var(--border)", background: "var(--bg-secondary)" }}>
          <div className="px-4 py-3 space-y-2">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="block px-3 py-2 rounded text-sm uppercase tracking-wider"
                style={{ fontFamily: "var(--font-mono)", color: "var(--text-secondary)", fontSize: "12px" }}
                onClick={() => setMobileOpen(false)}
              >
                {link.label}
              </Link>
            ))}
            {connected && publicKey ? (
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
            ) : (
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
            )}
          </div>
        </div>
      )}
    </nav>
  );
}
