"use client";

import Link from "next/link";
import { Menu, X, Terminal } from "lucide-react";
import { useState, useCallback, useEffect } from "react";
import { NavbarWalletButton, MobileWalletSection } from "@/components/NavbarWalletButton";

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
  const [isExplorerHost, setIsExplorerHost] = useState(false);

  const handleProfileId = useCallback((id: string | null) => {
    setMyProfileId(id);
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setIsExplorerHost(window.location.hostname === "explorer.satp.bot");
    }
  }, []);

  const externalizeHref = (href: string) => {
    if (!isExplorerHost) return href;
    if (href === "/satp/explorer") return href;
    if (href.startsWith("/profile/")) return `https://agentfolio.bot${href}`;
    return `https://agentfolio.bot${href}`;
  };

  const navLinks = [
    staticNavLinks[0],
    myProfileId
      ? { href: `/profile/${myProfileId}`, label: "My Profile", highlight: true }
      : { href: "/register", label: "Register", highlight: true },
    { href: "/import/github", label: "Import" },
    ...staticNavLinks.slice(1),
  ];

  return (
    <nav className="sticky top-0 z-50 border-b-2 border-b-[var(--accent)]" style={{ background: "var(--bg-secondary)" }}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14">
          {/* Logo */}
          <Link href={externalizeHref("/")} className="flex items-center gap-2">
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
                href={externalizeHref(link.href)}
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
                href={externalizeHref(link.href)}
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
