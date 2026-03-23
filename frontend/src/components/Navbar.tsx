"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { Menu, X, Terminal } from "lucide-react";
import { useState, useCallback } from "react";

const NavbarWalletButton = dynamic(
  () => import("@/components/NavbarWalletButton").then(m => m.NavbarWalletButton),
  { ssr: false, loading: () => <div className="hidden md:block w-[140px] h-[36px] rounded-lg animate-pulse" style={{ background: "rgba(153,69,255,0.08)" }} /> }
);

const MobileWalletSection = dynamic(
  () => import("@/components/NavbarWalletButton").then(m => m.MobileWalletSection),
  { ssr: false }
);

const staticNavLinks = [
  { href: "/", label: "Directory" },
  { href: "/marketplace", label: "Marketplace" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/satp/explorer", label: "SATP" },
  { href: "/verify", label: "Verify" },
  { href: "/mint", label: "Mint" },
  { href: "/stats", label: "Stats" },
  { href: "/how-it-works", label: "How It Works" },
];

export function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [myProfileId, setMyProfileId] = useState<string | null>(null);

  const handleProfileId = useCallback((id: string | null) => {
    setMyProfileId(id);
  }, []);

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
            <NavbarWalletButton onProfileId={handleProfileId} />
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
            <MobileWalletSection />
          </div>
        </div>
      )}
    </nav>
  );
}
