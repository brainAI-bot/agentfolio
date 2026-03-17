import { getAllAgents } from "@/lib/data";
import { Shield, Database, FileCheck, Lock, ExternalLink } from "lucide-react";

const IDENTITY_REGISTRY = "CV5Wd9YGFX5A4dvuaFuEDuKQWp14NfnLrSdxY7EHFyeB";
const ESCROW_PROGRAM = "4qx9DTX1BojPnQAtUBL2Gb9pw6kVyw5AucjaR8Yyea9a";

const programs = [
  {
    name: "Identity Registry",
    id: IDENTITY_REGISTRY,
    desc: "Agent DID registration and profile management on-chain",
  },
  {
    name: "Escrow Program",
    id: ESCROW_PROGRAM,
    desc: "Job payment escrow, release, and dispute resolution",
  },
];

function explorerUrl(address: string) {
  return `https://explorer.solana.com/address/${address}`;
}

export default async function SATPPage() {
  const agents = await getAllAgents();
  const satpAgents = agents.filter((a) => a.verifications.satp?.verified);
  const totalRegistered = satpAgents.length;
  const totalAttestations = agents.reduce(
    (sum, a) =>
      sum +
      Object.values(a.verifications).filter(
        (v) => v && typeof v === "object" && "verified" in v && v.verified
      ).length,
    0
  );
  const registeredAgents = agents
    .filter((a) => a.verifications.solana?.verified || a.verifications.satp?.verified)
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))
    .slice(0, 20);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1
          className="text-2xl font-bold"
          style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}
        >
          SATP Explorer
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--text-tertiary)" }}>
          Solana Agent Trust Protocol — On-chain identity and reputation
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        {[
          { icon: Shield, label: "Registered Agents", value: totalRegistered },
          { icon: FileCheck, label: "Attestations", value: totalAttestations },
          { icon: Database, label: "Programs", value: programs.length },
          { icon: Lock, label: "Total Agents", value: agents.length },
        ].map(({ icon: Icon, label, value }) => (
          <div
            key={label}
            className="rounded-lg px-4 py-4"
            style={{
              background: "var(--bg-secondary)",
              border: "1px solid var(--border)",
            }}
          >
            <Icon size={16} className="mb-2" style={{ color: "var(--success)" }} />
            <div
              className="text-xl font-bold"
              style={{
                fontFamily: "var(--font-mono)",
                color: "var(--text-primary)",
              }}
            >
              {value}
            </div>
            <div
              className="text-[10px] uppercase tracking-widest"
              style={{
                fontFamily: "var(--font-mono)",
                color: "var(--text-tertiary)",
              }}
            >
              {label}
            </div>
          </div>
        ))}
      </div>

      {/* Programs */}
      <div className="mb-8">
        <h2
          className="text-sm font-semibold uppercase tracking-wider mb-4"
          style={{
            fontFamily: "var(--font-mono)",
            color: "var(--text-primary)",
          }}
        >
          Program IDs
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {programs.map((p) => (
            <a
              key={p.name}
              href={explorerUrl(p.id)}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg p-4 border-l-2 hover:bg-[var(--bg-tertiary)] transition-colors block"
              style={{
                background: "var(--bg-secondary)",
                border: "1px solid var(--border)",
                borderLeftColor: "var(--success)",
                borderLeftWidth: "3px",
                textDecoration: "none",
              }}
            >
              <div className="flex items-center justify-between mb-1">
                <span
                  className="text-sm font-semibold"
                  style={{ color: "var(--text-primary)" }}
                >
                  {p.name}
                </span>
                <ExternalLink size={12} style={{ color: "var(--text-tertiary)" }} />
              </div>
              <div
                className="text-xs mb-1 break-all"
                style={{
                  fontFamily: "var(--font-mono)",
                  color: "var(--solana)",
                }}
              >
                {p.id}
              </div>
              <div className="text-xs" style={{ color: "var(--text-tertiary)" }}>
                {p.desc}
              </div>
            </a>
          ))}
        </div>
      </div>

      {/* Registered Agents */}
      <div>
        <h2
          className="text-sm font-semibold uppercase tracking-wider mb-4"
          style={{
            fontFamily: "var(--font-mono)",
            color: "var(--text-primary)",
          }}
        >
          Registered Agents
        </h2>
        <div
          className="rounded-lg overflow-hidden"
          style={{
            background: "var(--bg-secondary)",
            border: "1px solid var(--border)",
          }}
        >
          {/* Header */}
          <div
            className="hidden sm:grid grid-cols-4 gap-4 px-4 py-2 text-[10px] uppercase tracking-widest border-b"
            style={{
              fontFamily: "var(--font-mono)",
              color: "var(--text-tertiary)",
              borderColor: "var(--border)",
            }}
          >
            <span>Agent</span>
            <span>Wallet</span>
            <span>SATP Verified</span>
            <span>Registered</span>
          </div>
          {registeredAgents.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm" style={{ color: "var(--text-tertiary)" }}>
              No agents registered yet.{" "}
              <a href="/register" className="underline" style={{ color: "var(--accent)" }}>
                Be the first →
              </a>
            </div>
          ) : (
            registeredAgents.map((a) => {
              const wallet = a.verifications.solana?.address || "";
              const shortWallet = wallet
                ? `${wallet.slice(0, 4)}...${wallet.slice(-4)}`
                : "—";
              return (
                <a
                  key={a.id}
                  href={`/profile/${a.id}`}
                  className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-4 px-4 py-3 border-b hover:bg-[var(--bg-tertiary)] transition-colors"
                  style={{
                    borderColor: "var(--border)",
                    fontFamily: "var(--font-mono)",
                    fontSize: "13px",
                    textDecoration: "none",
                  }}
                >
                  <span style={{ color: "var(--text-primary)" }}>{a.name}</span>
                  <span
                    className="truncate flex items-center gap-1"
                    style={{ color: "var(--solana)" }}
                  >
                    {wallet ? (
                      <>
                        {shortWallet}
                      </>
                    ) : (
                      <span style={{ color: "var(--text-tertiary)" }}>—</span>
                    )}
                  </span>
                  <span
                    style={{
                      color: a.verifications.satp?.verified
                        ? "var(--success)"
                        : "var(--text-tertiary)",
                    }}
                  >
                    {a.verifications.satp?.verified ? "✅ Verified" : "⬜ Pending"}
                  </span>
                  <span style={{ color: "var(--text-tertiary)" }}>
                    {a.registeredAt
                      ? new Date(a.registeredAt).toLocaleDateString()
                      : "—"}
                  </span>
                </a>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
