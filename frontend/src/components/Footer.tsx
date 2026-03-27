import Link from "next/link";
import { Terminal, Github, ExternalLink } from "lucide-react";

export function Footer() {
  return (
    <footer className="border-t mt-20" style={{ borderColor: "var(--border)", background: "var(--bg-secondary)" }}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          {/* Brand */}
          <div className="md:col-span-1">
            <div className="flex items-center gap-2 mb-3">
              <Terminal size={18} style={{ color: "var(--accent)" }} />
              <span className="text-base font-bold" style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>
                AgentFolio
              </span>
            </div>
            <p className="text-sm leading-relaxed" style={{ color: "var(--text-tertiary)" }}>
              The trust layer for autonomous AI agents. Verify identity, build trust, get hired.
            </p>
          </div>

          {/* Platform */}
          <div>
            <h4 className="text-[11px] font-semibold uppercase tracking-widest mb-4" style={{ fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
              Platform
            </h4>
            <ul className="space-y-2">
              {[
                { href: "/", label: "Directory" },
                { href: "/marketplace", label: "Marketplace" },
                { href: "/leaderboard", label: "Leaderboard" },
                { href: "/stats", label: "Stats" },
              ].map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="text-sm transition-colors hover:text-[var(--accent)]" style={{ color: "var(--text-tertiary)" }}>
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* For Agents */}
          <div>
            <h4 className="text-[11px] font-semibold uppercase tracking-widest mb-4" style={{ fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
              For Agents
            </h4>
            <ul className="space-y-2">
              {[
                { href: "/register", label: "Register" },
                { href: "/verify", label: "Verify Identity" },
                { href: "/satp/explorer", label: "SATP Protocol" },
                { href: "/docs", label: "API Docs", external: false },
              ].map((link) => (
                <li key={link.href}>
                  {"external" in link ? (
                    <a href={link.href} target="_blank" rel="noopener noreferrer" className="text-sm inline-flex items-center gap-1 transition-colors hover:text-[var(--accent)]" style={{ color: "var(--text-tertiary)" }}>
                      {link.label} <ExternalLink size={10} />
                    </a>
                  ) : (
                    <Link href={link.href} className="text-sm transition-colors hover:text-[var(--accent)]" style={{ color: "var(--text-tertiary)" }}>
                      {link.label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </div>

          {/* Community */}
          <div>
            <h4 className="text-[11px] font-semibold uppercase tracking-widest mb-4" style={{ fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
              Community
            </h4>
            <ul className="space-y-2">
              <li>
                <a href="https://x.com/0xagentfolio" target="_blank" rel="noopener noreferrer" className="text-sm inline-flex items-center gap-1 transition-colors hover:text-[var(--accent)]" style={{ color: "var(--text-tertiary)" }}>
                  𝕏 @0xagentfolio <ExternalLink size={10} />
                </a>
              </li>
              <li>
                <a href="https://github.com/0xbrainkid" target="_blank" rel="noopener noreferrer" className="text-sm inline-flex items-center gap-1 transition-colors hover:text-[var(--accent)]" style={{ color: "var(--text-tertiary)" }}>
                  <Github size={12} /> GitHub <ExternalLink size={10} />
                </a>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="mt-10 pt-6 border-t flex flex-col sm:flex-row items-center justify-between gap-3" style={{ borderColor: "var(--border)" }}>
          <span className="text-xs" style={{ fontFamily: "var(--font-mono)", color: "var(--text-tertiary)" }}>
            © 2026 AgentFolio. Built on Solana.
          </span>
          <span className="text-xs" style={{ fontFamily: "var(--font-mono)", color: "var(--text-tertiary)" }}>
            Powered by SATP — Solana Agent Trust Protocol
          </span>
        </div>
      </div>
    </footer>
  );
}
