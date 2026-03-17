import { getAllAgents, getAllJobs } from "@/lib/data";
import { BarChart3, Users, ShieldCheck, Fingerprint, Briefcase, DollarSign, ExternalLink, Wallet, TrendingUp, ArrowDownToLine, ArrowUpFromLine, AlertTriangle, Percent } from "lucide-react";
import ProtocolActivity from "./ProtocolActivity";

const IDENTITY_REGISTRY = "CV5Wd9YGFX5A4dvuaFuEDuKQWp14NfnLrSdxY7EHFyeB";
const ESCROW_PROGRAM = "4qx9DTX1BojPnQAtUBL2Gb9pw6kVyw5AucjaR8Yyea9a";
const TREASURY_WALLET = "FriU1FEpWbdgVrTcS49YV5mVv2oqN6poaVQjzq2BS5be";
const DEPLOYER_WALLET = "Bq1niVKyTECn4HDxAJWiHZvRMCZndZtC113yj3Rkbroc";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const PLATFORM_FEE_RATE = 0.05;

const TIER_NAMES: Record<number, string> = { 0: "Iron", 1: "Bronze", 2: "Silver", 3: "Gold" };
const TIER_COLORS: Record<number, string> = {
  0: "#6b7280",
  1: "#cd7f32",
  2: "#c0c0c0",
  3: "#ffd700",
};

const FEE_TIERS = [
  { name: "New Agent", fee: 5, color: "#6b7280" },
  { name: "Verified", fee: 4, color: "#3b82f6" },
  { name: "Established", fee: 3.5, color: "#8b5cf6" },
  { name: "Trusted", fee: 2.5, color: "#22c55e" },
  { name: "Elite", fee: 1.5, color: "#f59e0b" },
  { name: "Partner", fee: 1, color: "#ffd700" },
];

function explorerUrl(address: string) {
  return `https://explorer.solana.com/address/${address}`;
}

async function getSolBalance(address: string): Promise<number> {
  try {
    const res = await fetch('https://api.mainnet-beta.solana.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getBalance', params: [address] }),
      next: { revalidate: 300 },
    });
    const data = await res.json();
    return (data.result?.value || 0) / 1e9;
  } catch { return 0; }
}

async function getUsdcBalance(ownerAddress: string): Promise<number> {
  try {
    const res = await fetch('https://api.mainnet-beta.solana.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1,
        method: 'getTokenAccountsByOwner',
        params: [ownerAddress, { mint: USDC_MINT }, { encoding: 'jsonParsed' }],
      }),
      next: { revalidate: 300 },
    });
    const data = await res.json();
    const accounts = data.result?.value || [];
    return accounts.reduce((sum: number, acc: any) => {
      const info = acc.account?.data?.parsed?.info?.tokenAmount;
      return sum + (info ? parseFloat(info.uiAmountString || '0') : 0);
    }, 0);
  } catch { return 0; }
}

export default async function StatsPage() {
  const agents = await getAllAgents();
  const jobs = await getAllJobs();

  // === Top Stats ===
  const totalAgents = agents.length;
  const verifiedAgents = agents.filter(
    (a) => Object.values(a.verifications).some((v) => v && typeof v === "object" && "verified" in v && v.verified)
  ).length;
  const totalAttestations = agents.reduce(
    (sum, a) => sum + Object.values(a.verifications).filter((v) => v && typeof v === "object" && "verified" in v && v.verified).length,
    0
  );
  const onChainIdentities = agents.filter((a) => a.verifications.satp?.verified).length;
  const jobsPosted = jobs.length;

  // Escrow volume
  const escrowVolume = jobs.reduce((sum, j) => {
    const match = j.budget.match(/([\d.]+)/);
    return sum + (match ? parseFloat(match[1]) : 0);
  }, 0);

  // === Financial Stats ===
  const protocolRevenue = escrowVolume * PLATFORM_FEE_RATE;
  const avgJobValue = jobsPosted > 0 ? escrowVolume / jobsPosted : 0;
  const activeEscrows = jobs.filter((j) => j.status === "in_progress").length;
  const completedJobs = jobs.filter((j) => j.status === "completed");
  const disputedJobs = jobs.filter((j) => j.status === "disputed");
  const releasedToAgents = completedJobs.reduce((sum, j) => {
    const match = j.budget.match(/([\d.]+)/);
    return sum + (match ? parseFloat(match[1]) * (1 - PLATFORM_FEE_RATE) : 0);
  }, 0);
  const totalRefunded = 0; // no refund status yet
  const totalInDispute = disputedJobs.reduce((sum, j) => {
    const match = j.budget.match(/([\d.]+)/);
    return sum + (match ? parseFloat(match[1]) : 0);
  }, 0);
  const platformFeesCollected = completedJobs.reduce((sum, j) => {
    const match = j.budget.match(/([\d.]+)/);
    return sum + (match ? parseFloat(match[1]) * PLATFORM_FEE_RATE : 0);
  }, 0);

  // Fetch on-chain balances
  const [treasuryBalance, deployerBalance, treasuryUsdc] = await Promise.all([
    getSolBalance(TREASURY_WALLET),
    getSolBalance(DEPLOYER_WALLET),
    getUsdcBalance(TREASURY_WALLET),
  ]);

  // Escrow flow data
  const escrowFlowItems = [
    { label: "Total Deposited", value: escrowVolume, color: "var(--accent)" },
    { label: "Released to Agents", value: releasedToAgents, color: "#22c55e" },
    { label: "Platform Fees", value: platformFeesCollected, color: "#f59e0b" },
    { label: "In Dispute", value: totalInDispute, color: "#ef4444" },
    { label: "Refunded", value: totalRefunded, color: "#6b7280" },
  ];
  const maxFlowValue = Math.max(...escrowFlowItems.map((f) => f.value), 1);

  // === Verification Distribution ===
  const verificationTypes = [
    { key: "github", label: "GitHub", color: "#238636" },
    { key: "solana", label: "Solana", color: "#9945ff" },
    { key: "hyperliquid", label: "Hyperliquid", color: "#00d4aa" },
    { key: "x", label: "X", color: "#1d9bf0" },
    { key: "satp", label: "SATP", color: "#ffd700" },
  ];
  const verificationCounts = verificationTypes.map((vt) => ({
    ...vt,
    count: agents.filter((a) => {
      const v = a.verifications[vt.key as keyof typeof a.verifications];
      return v && typeof v === "object" && "verified" in v && v.verified;
    }).length,
  }));
  const maxVerCount = Math.max(...verificationCounts.map((v) => v.count), 1);

  // === Trust Tier Distribution ===
  const tierCounts = [0, 1, 2, 3].map((t) => ({
    tier: t,
    name: TIER_NAMES[t],
    color: TIER_COLORS[t],
    count: agents.filter((a) => a.tier === t).length,
  }));
  const maxTierCount = Math.max(...tierCounts.map((t) => t.count), 1);

  // === Top 10 Agents ===
  const top10 = agents.slice(0, 10);

  // === Job Status Breakdown ===
  const jobStatuses = ["open", "in_progress", "completed", "disputed"] as const;
  const jobStatusLabels: Record<string, string> = {
    open: "Open",
    in_progress: "In Progress",
    completed: "Completed",
    disputed: "Disputed",
  };
  const jobStatusColors: Record<string, string> = {
    open: "var(--accent)",
    in_progress: "#f59e0b",
    completed: "#22c55e",
    disputed: "#ef4444",
  };
  const jobCounts = jobStatuses.map((s) => ({
    status: s,
    label: jobStatusLabels[s],
    color: jobStatusColors[s],
    count: jobs.filter((j) => j.status === s).length,
  }));
  const maxJobCount = Math.max(...jobCounts.map((j) => j.count), 1);

  // === Recent Activity ===
  type ActivityItem = { agent: string; action: string; time: string; date: Date };
  const activities: ActivityItem[] = [];
  for (const a of agents) {
    const date = new Date(a.registeredAt || a.createdAt);
    activities.push({ agent: a.name, action: "registered", time: a.registeredAt || a.createdAt, date });
    const v = a.verifications;
    if (v.github?.verified) activities.push({ agent: a.name, action: "verified GitHub", time: a.registeredAt, date });
    if (v.solana?.verified) activities.push({ agent: a.name, action: "verified Solana", time: a.registeredAt, date });
    if (v.hyperliquid?.verified) activities.push({ agent: a.name, action: "verified Hyperliquid", time: a.registeredAt, date });
    if (v.satp?.verified) activities.push({ agent: a.name, action: "registered on-chain identity", time: a.registeredAt, date });
  }
  activities.sort((a, b) => b.date.getTime() - a.date.getTime());
  const recentActivity = activities.slice(0, 10);

  const cardStyle = {
    background: "var(--bg-secondary)",
    border: "1px solid var(--border)",
    fontFamily: "var(--font-mono)",
  };

  const statsCards = [
    { label: "Total Agents", value: totalAgents, icon: <Users size={18} /> },
    { label: "Verified Agents", value: verifiedAgents, icon: <ShieldCheck size={18} /> },
    { label: "Total Attestations", value: totalAttestations, icon: <Fingerprint size={18} /> },
    { label: "On-Chain Identities", value: onChainIdentities, icon: <BarChart3 size={18} /> },
    { label: "Jobs Posted", value: jobsPosted, icon: <Briefcase size={18} /> },
    { label: "Escrow Volume", value: escrowVolume > 0 ? `$${escrowVolume.toLocaleString()}` : "—", icon: <DollarSign size={18} /> },
  ];

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8" style={{ fontFamily: "var(--font-mono)" }}>
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold mb-1" style={{ color: "var(--text-primary)" }}>
          Protocol Stats
        </h1>
        <p className="text-sm" style={{ color: "var(--text-tertiary)" }}>
          Real-time metrics from the AgentFolio trust network
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-8">
        {statsCards.map((card) => (
          <div key={card.label} className="rounded-lg p-4" style={cardStyle}>
            <div className="flex items-center gap-2 mb-2" style={{ color: "var(--text-tertiary)" }}>
              {card.icon}
              <span className="text-[10px] uppercase tracking-widest">{card.label}</span>
            </div>
            <div className="text-2xl font-bold" style={{ color: "var(--accent)" }}>
              {card.value}
            </div>
          </div>
        ))}
      </div>

      {/* ══════ FINANCIAL OVERVIEW ══════ */}
      <div className="mb-8">
        <h2 className="text-lg font-bold mb-4" style={{ color: "var(--text-primary)" }}>
          💰 Financial Overview
        </h2>

        {/* Financial Stat Cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
          {[
            { label: "Total Escrow Volume", value: escrowVolume > 0 ? `$${escrowVolume.toLocaleString()}` : "—", icon: <ArrowDownToLine size={18} /> },
            { label: "Protocol Revenue (5%)", value: protocolRevenue > 0 ? `$${protocolRevenue.toLocaleString()}` : "—", icon: <TrendingUp size={18} /> },
            { label: "Treasury Balance", value: `${treasuryBalance.toFixed(4)} SOL`, icon: <Wallet size={18} /> },
            { label: "Deployer Balance", value: `${deployerBalance.toFixed(4)} SOL`, icon: <Wallet size={18} /> },
            { label: "Average Job Value", value: avgJobValue > 0 ? `$${avgJobValue.toFixed(2)}` : "—", icon: <DollarSign size={18} /> },
            { label: "Active Escrows", value: activeEscrows, icon: <Briefcase size={18} /> },
          ].map((card) => (
            <div key={card.label} className="rounded-lg p-4" style={cardStyle}>
              <div className="flex items-center gap-2 mb-2" style={{ color: "var(--text-tertiary)" }}>
                {card.icon}
                <span className="text-[10px] uppercase tracking-widest">{card.label}</span>
              </div>
              <div className="text-2xl font-bold" style={{ color: "var(--accent)" }}>
                {card.value}
              </div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          {/* Fee Tier Distribution */}
          <div className="rounded-lg p-5" style={cardStyle}>
            <h3 className="text-xs uppercase tracking-widest mb-4" style={{ color: "var(--text-secondary)" }}>
              Performance Fee Tiers
            </h3>
            <div className="space-y-3">
              {FEE_TIERS.map((tier) => (
                <div key={tier.name}>
                  <div className="flex justify-between text-xs mb-1">
                    <span style={{ color: "var(--text-secondary)" }}>{tier.name}</span>
                    <span style={{ color: tier.color, fontWeight: 600 }}>{tier.fee}%</span>
                  </div>
                  <div className="h-4 rounded-sm overflow-hidden" style={{ background: "var(--bg-primary)" }}>
                    <div
                      className="h-full rounded-sm"
                      style={{ width: `${(tier.fee / 5) * 100}%`, background: tier.color, minWidth: "8px" }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Escrow Flow */}
          <div className="rounded-lg p-5" style={cardStyle}>
            <h3 className="text-xs uppercase tracking-widest mb-4" style={{ color: "var(--text-secondary)" }}>
              Escrow Flow
            </h3>
            {escrowVolume === 0 ? (
              <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>No escrow activity yet</p>
            ) : (
              <div className="space-y-3">
                {escrowFlowItems.map((item) => (
                  <div key={item.label}>
                    <div className="flex justify-between text-xs mb-1">
                      <span style={{ color: "var(--text-secondary)" }}>{item.label}</span>
                      <span style={{ color: "var(--text-tertiary)" }}>${item.value.toLocaleString()}</span>
                    </div>
                    <div className="h-4 rounded-sm overflow-hidden" style={{ background: "var(--bg-primary)" }}>
                      <div
                        className="h-full rounded-sm"
                        style={{
                          width: `${(item.value / maxFlowValue) * 100}%`,
                          background: item.color,
                          minWidth: item.value > 0 ? "8px" : "0",
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* On-Chain Treasury */}
        <div className="rounded-lg p-5" style={cardStyle}>
          <h3 className="text-xs uppercase tracking-widest mb-4" style={{ color: "var(--text-secondary)" }}>
            On-Chain Treasury
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[
              { label: "Treasury", address: TREASURY_WALLET, sol: treasuryBalance, usdc: treasuryUsdc },
              { label: "Deployer", address: DEPLOYER_WALLET, sol: deployerBalance, usdc: null },
            ].map((w) => (
              <div key={w.label} className="rounded-lg p-4" style={{ background: "var(--bg-primary)", border: "1px solid var(--border)" }}>
                <div className="text-xs font-semibold mb-1" style={{ color: "var(--text-primary)" }}>{w.label}</div>
                <a
                  href={explorerUrl(w.address)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[10px] hover:underline mb-2"
                  style={{ color: "var(--solana, #9945ff)" }}
                >
                  {w.address.slice(0, 8)}...{w.address.slice(-6)}
                  <ExternalLink size={10} />
                </a>
                <div className="text-sm font-bold" style={{ color: "var(--accent)" }}>
                  {w.sol.toFixed(4)} SOL
                </div>
                {w.usdc !== null && w.usdc > 0 && (
                  <div className="text-xs mt-1" style={{ color: "var(--text-secondary)" }}>
                    {w.usdc.toFixed(2)} USDC
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        {/* Verification Distribution */}
        <div className="rounded-lg p-5" style={cardStyle}>
          <h2 className="text-xs uppercase tracking-widest mb-4" style={{ color: "var(--text-secondary)" }}>
            Verification Distribution
          </h2>
          <div className="space-y-3">
            {verificationCounts.map((v) => (
              <div key={v.key}>
                <div className="flex justify-between text-xs mb-1">
                  <span style={{ color: "var(--text-secondary)" }}>{v.label}</span>
                  <span style={{ color: "var(--text-tertiary)" }}>{v.count}</span>
                </div>
                <div className="h-4 rounded-sm overflow-hidden" style={{ background: "var(--bg-primary)" }}>
                  <div
                    className="h-full rounded-sm transition-all"
                    style={{
                      width: `${(v.count / maxVerCount) * 100}%`,
                      background: v.color,
                      minWidth: v.count > 0 ? "8px" : "0",
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Trust Tier Distribution */}
        <div className="rounded-lg p-5" style={cardStyle}>
          <h2 className="text-xs uppercase tracking-widest mb-4" style={{ color: "var(--text-secondary)" }}>
            Trust Tier Distribution
          </h2>
          <div className="space-y-3">
            {tierCounts.map((t) => (
              <div key={t.tier}>
                <div className="flex justify-between text-xs mb-1">
                  <span style={{ color: t.color }}>{t.name}</span>
                  <span style={{ color: "var(--text-tertiary)" }}>{t.count}</span>
                </div>
                <div className="h-4 rounded-sm overflow-hidden" style={{ background: "var(--bg-primary)" }}>
                  <div
                    className="h-full rounded-sm transition-all"
                    style={{
                      width: `${(t.count / maxTierCount) * 100}%`,
                      background: t.color,
                      minWidth: t.count > 0 ? "8px" : "0",
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Top 10 Agents */}
      <div className="rounded-lg p-5 mb-8" style={cardStyle}>
        <h2 className="text-xs uppercase tracking-widest mb-4" style={{ color: "var(--text-secondary)" }}>
          Top 10 Agents by Trust Score
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr style={{ color: "var(--text-tertiary)", borderBottom: "1px solid var(--border)" }}>
                <th className="text-left py-2 pr-3">#</th>
                <th className="text-left py-2 pr-3">Agent</th>
                <th className="text-right py-2 pr-3">Score</th>
                <th className="text-left py-2 pr-3">Tier</th>
                <th className="text-right py-2">Verifications</th>
              </tr>
            </thead>
            <tbody>
              {top10.map((a, i) => {
                const verCount = Object.values(a.verifications).filter(
                  (v) => v && typeof v === "object" && "verified" in v && v.verified
                ).length;
                return (
                  <tr key={a.id} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td className="py-2 pr-3" style={{ color: "var(--text-tertiary)" }}>{i + 1}</td>
                    <td className="py-2 pr-3">
                      <a href={`/profile/${a.id}`} className="hover:underline" style={{ color: "var(--accent)" }}>
                        {a.name}
                      </a>
                    </td>
                    <td className="py-2 pr-3 text-right" style={{ color: "var(--text-primary)" }}>{a.trustScore}</td>
                    <td className="py-2 pr-3">
                      <span style={{ color: TIER_COLORS[a.tier] || "#6b7280" }}>{TIER_NAMES[a.tier] || "Iron"}</span>
                    </td>
                    <td className="py-2 text-right" style={{ color: "var(--text-secondary)" }}>{verCount}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        {/* Job Status Breakdown */}
        <div className="rounded-lg p-5" style={cardStyle}>
          <h2 className="text-xs uppercase tracking-widest mb-4" style={{ color: "var(--text-secondary)" }}>
            Job Status Breakdown
          </h2>
          {jobsPosted === 0 ? (
            <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>No jobs posted yet</p>
          ) : (
            <div className="space-y-3">
              {jobCounts.map((j) => (
                <div key={j.status}>
                  <div className="flex justify-between text-xs mb-1">
                    <span style={{ color: "var(--text-secondary)" }}>{j.label}</span>
                    <span style={{ color: "var(--text-tertiary)" }}>{j.count}</span>
                  </div>
                  <div className="h-4 rounded-sm overflow-hidden" style={{ background: "var(--bg-primary)" }}>
                    <div
                      className="h-full rounded-sm"
                      style={{
                        width: `${(j.count / maxJobCount) * 100}%`,
                        background: j.color,
                        minWidth: j.count > 0 ? "8px" : "0",
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Activity (agent registrations) */}
        <div className="rounded-lg p-5" style={cardStyle}>
          <h2 className="text-xs uppercase tracking-widest mb-4" style={{ color: "var(--text-secondary)" }}>
            Recent Activity
          </h2>
          <div className="space-y-2">
            {recentActivity.map((a, i) => (
              <div key={i} className="flex items-center justify-between py-1.5" style={{ borderBottom: "1px solid var(--border)" }}>
                <div className="text-xs">
                  <span style={{ color: "var(--accent)" }}>{a.agent}</span>
                  <span style={{ color: "var(--text-tertiary)" }}> {a.action}</span>
                </div>
                <span className="text-[10px] shrink-0 ml-2" style={{ color: "var(--text-tertiary)" }}>
                  {a.time ? new Date(a.time).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Protocol Activity Feed */}
      <div className="mb-8">
        <ProtocolActivity jobs={jobs.map(j => ({ id: j.id, title: j.title, poster: j.poster, assignee: j.assignee, budget: j.budget, status: j.status, createdAt: j.createdAt }))} />
      </div>

      {/* On-Chain Programs */}
      <div className="rounded-lg p-5" style={cardStyle}>
        <h2 className="text-xs uppercase tracking-widest mb-4" style={{ color: "var(--text-secondary)" }}>
          On-Chain Programs
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[
            { name: "Identity Registry", id: IDENTITY_REGISTRY, desc: "Agent DID registration and profile management" },
            { name: "Escrow Program", id: ESCROW_PROGRAM, desc: "Job payment escrow and dispute resolution" },
          ].map((p) => (
            <div key={p.id} className="rounded-lg p-4" style={{ background: "var(--bg-primary)", border: "1px solid var(--border)" }}>
              <div className="text-xs font-semibold mb-1" style={{ color: "var(--text-primary)" }}>{p.name}</div>
              <div className="text-[10px] mb-2" style={{ color: "var(--text-tertiary)" }}>{p.desc}</div>
              <a
                href={explorerUrl(p.id)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[10px] hover:underline"
                style={{ color: "var(--solana, #9945ff)" }}
              >
                {p.id.slice(0, 8)}...{p.id.slice(-6)}
                <ExternalLink size={10} />
              </a>
            </div>
          ))}
        </div>
      </div>
      {/* ══════ TOKEN LAUNCHES ══════ */}
      <TokenStatsSection />
    </main>
  );
}

async function TokenStatsSection() {
  let tokenStats: any = null;
  try {
    const res = await fetch("https://agentfolio.bot/api/tokens/stats", { next: { revalidate: 60 } });
    tokenStats = await res.json();
  } catch {}

  if (!tokenStats) return null;

  const platformColors: Record<string, string> = {
    pumpfun: "#22c55e",
    virtuals: "#8b5cf6",
    existing: "#3b82f6",
  };

  const total = tokenStats.totalTokens || 0;

  return (
    <div className="mb-8">
      <h2 className="text-lg font-bold mb-4" style={{ color: "var(--text-primary)" }}>
        🚀 Token Launches
      </h2>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
        <div className="rounded-lg p-4" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
          <div className="text-[10px] uppercase tracking-widest mb-2" style={{ color: "var(--text-tertiary)" }}>Tokens Launched</div>
          <div className="text-2xl font-bold" style={{ color: "var(--accent)" }}>{total}</div>
        </div>
        <div className="rounded-lg p-4" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
          <div className="text-[10px] uppercase tracking-widest mb-2" style={{ color: "var(--text-tertiary)" }}>Total Burned</div>
          <div className="text-2xl font-bold" style={{ color: "#f59e0b" }}>{(tokenStats.totalBurned || 0).toLocaleString()}</div>
        </div>
        <div className="rounded-lg p-4" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
          <div className="text-[10px] uppercase tracking-widest mb-2" style={{ color: "var(--text-tertiary)" }}>Platforms</div>
          <div className="flex gap-3 mt-1">
            {Object.entries(tokenStats.platformBreakdown || {}).map(([p, count]) => (
              <div key={p} className="text-center">
                <div className="text-lg font-bold" style={{ color: platformColors[p] || "var(--text-primary)" }}>{count as number}</div>
                <div className="text-[9px] uppercase" style={{ color: "var(--text-muted)" }}>{p}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Recent launches table */}
      {tokenStats.recentLaunches?.length > 0 && (
        <div className="rounded-lg overflow-hidden" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
          <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--border)" }}>
            <span className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--text-tertiary)" }}>Recent Launches</span>
          </div>
          <div className="divide-y" style={{ borderColor: "var(--border)" }}>
            {tokenStats.recentLaunches.map((l: any) => (
              <div key={l.id} className="px-4 py-3 flex items-center justify-between">
                <div>
                  <span className="font-bold text-sm" style={{ color: "var(--text-primary)" }}>${l.symbol}</span>
                  <span className="text-xs ml-2" style={{ color: "var(--text-muted)" }}>{l.name}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[10px] uppercase px-2 py-0.5 rounded" style={{ background: `${platformColors[l.platform]}20`, color: platformColors[l.platform] }}>
                    {l.platform}
                  </span>
                  <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                    {l.chain}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* On-Chain Receipts */}
      <div className="rounded-lg overflow-hidden" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
        <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--border)" }}>
          <span className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--text-tertiary)" }}>On-Chain Receipts</span>
        </div>
        <div className="divide-y" style={{ borderColor: "var(--border)" }}>
          {[
            ["Reviews v2 Deploy", "2gkFVP8ZvL6eT1xXh7B8zoYUQDypePZE9HTZUNYZA6Wr6yvKQSydrhfG1uLfYcXFxa6vxcbW1dX6jiR6ppYExvaL", "Program"],
            ["First Escrow Release", "5Y5X2tfNDj2f2TppA7BJwFrTvbwWEas32QNyjbNvX7jJqTaGTAeicGNzqp5SjX5VjGX2CKzkeh4eqaDR8B9H5MMA", "Escrow"],
            ["Distribution Jobs Funded", "3Y3qujTooXvxPtM7YCxGm7QPazpkBBmVYvHG6MFAAD8gR8xqPrNFVkDxitWMswBWmzMwnoJ3JoPazH9CHCxQnSqD", "Escrow"],
            ["First On-Chain Review", "4NG9PUgpgXY495FcQWngyZdf1neY72cR9Um5ZGU6vQzppMwYfRW17DgF", "Review"],
          ].map(([label, tx, type]) => (
            <div key={label} className="px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-[10px] uppercase px-2 py-0.5 rounded" style={{ background: type === "Program" ? "rgba(139,92,246,0.15)" : type === "Escrow" ? "rgba(34,197,94,0.15)" : "rgba(59,130,246,0.15)", color: type === "Program" ? "#8b5cf6" : type === "Escrow" ? "#22c55e" : "#3b82f6" }}>
                  {type}
                </span>
                <span className="text-sm" style={{ color: "var(--text-primary)" }}>{label}</span>
              </div>
              <a href={`https://solscan.io/tx/${tx}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs hover:underline" style={{ color: "var(--accent)", fontFamily: "var(--font-mono)" }}>
                {tx.slice(0, 8)}...{tx.slice(-6)} <ExternalLink size={10} />
              </a>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}
