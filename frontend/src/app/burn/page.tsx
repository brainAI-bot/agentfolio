"use client";

import { useState, useEffect, useRef } from "react";
import { Flame, TrendingDown, BarChart3, ExternalLink, Clock } from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_SITE_URL || "";
const SOLANA_CLUSTER = process.env.NEXT_PUBLIC_SOLANA_CLUSTER || "mainnet-beta";
const SOLANA_EXPLORER_BASE = process.env.NEXT_PUBLIC_SOLANA_EXPLORER_BASE || "https://explorer.solana.com";
const solanaExplorerUrl = (path: string) => SOLANA_CLUSTER === "mainnet-beta" ? `${SOLANA_EXPLORER_BASE}/${path}` : `${SOLANA_EXPLORER_BASE}/${path}?cluster=${SOLANA_CLUSTER}`;

function formatNumber(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toLocaleString();
}

function AnimatedCounter({ target }: { target: number }) {
  const [count, setCount] = useState(0);
  const ref = useRef<number>(0);

  useEffect(() => {
    const duration = 2000;
    const start = ref.current;
    const diff = target - start;
    const startTime = Date.now();
    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.floor(start + diff * eased);
      setCount(current);
      ref.current = current;
      if (progress < 1) requestAnimationFrame(animate);
    };
    animate();
  }, [target]);

  return <span>{count.toLocaleString()}</span>;
}

export default function BurnPage() {
  const [data, setData] = useState<any>(null);
  const [view, setView] = useState<"daily" | "weekly" | "monthly">("daily");

  useEffect(() => {
    fetch(`${API}/api/tokens/burns`).then(r => r.json()).then(setData).catch(() => {});
  }, []);

  if (!data) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-lg" style={{ color: "var(--text-tertiary)" }}>Loading burn data...</div>
      </div>
    );
  }

  const progressPct = Math.min((data.totalBurned / data.totalSupply) * 100, 100);

  // Aggregate burns by period for chart
  const getBuckets = () => {
    const burns = data.burns || [];
    const buckets: Record<string, number> = {};
    burns.forEach((b: any) => {
      const d = new Date(b.date);
      let key: string;
      if (view === "daily") key = d.toISOString().slice(0, 10);
      else if (view === "weekly") {
        const week = Math.floor(d.getTime() / (7 * 86400000));
        key = `W${week}`;
      } else {
        key = d.toISOString().slice(0, 7);
      }
      buckets[key] = (buckets[key] || 0) + b.amount;
    });
    return Object.entries(buckets).sort((a, b) => a[0].localeCompare(b[0])).slice(-14);
  };

  const buckets = getBuckets();
  const maxBucket = Math.max(...buckets.map(b => b[1]), 1);

  return (
    <div className="max-w-6xl mx-auto px-4 py-12">
      {/* Header with animated counter */}
      <div className="text-center mb-12">
        <div className="flex items-center justify-center gap-3 mb-4">
          <Flame size={40} className="text-orange-500" />
          <h1 className="text-4xl font-bold" style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>
            $FOLIO Burn Tracker
          </h1>
        </div>
        <div
          className="text-6xl font-bold my-8 tabular-nums"
          style={{ fontFamily: "var(--font-mono)", color: "#f97316", textShadow: "0 0 40px rgba(249, 115, 22, 0.3)" }}
        >
          <AnimatedCounter target={data.totalBurned} /> <span className="text-2xl" style={{ color: "var(--text-secondary)" }}>FOLIO burned</span>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {[
          { label: "24h Burns", value: formatNumber(data.dailyBurns), icon: <Flame size={16} /> },
          { label: "7d Burns", value: formatNumber(data.weeklyBurns), icon: <TrendingDown size={16} /> },
          { label: "30d Burns", value: formatNumber(data.monthlyBurns), icon: <BarChart3 size={16} /> },
          { label: "Avg Daily", value: formatNumber(data.avgDailyBurn), icon: <Clock size={16} /> },
        ].map((s) => (
          <div key={s.label} className="rounded-xl p-4 border" style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}>
            <div className="flex items-center gap-2 mb-1" style={{ color: "var(--text-tertiary)" }}>
              {s.icon} <span className="text-xs uppercase tracking-wider">{s.label}</span>
            </div>
            <div className="text-xl font-bold" style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Progress Bar */}
      <div className="rounded-xl p-6 border mb-8" style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}>
        <div className="flex justify-between items-center mb-3">
          <span style={{ color: "var(--text-secondary)" }}>Total Burned vs Supply</span>
          <span className="font-bold" style={{ fontFamily: "var(--font-mono)", color: "#f97316" }}>{data.burnPercent}%</span>
        </div>
        <div className="w-full h-6 rounded-full overflow-hidden" style={{ background: "var(--bg-primary)" }}>
          <div
            className="h-full rounded-full transition-all duration-1000"
            style={{ width: `${Math.max(progressPct, 0.5)}%`, background: "linear-gradient(90deg, #f97316, #ef4444)" }}
          />
        </div>
        <div className="flex justify-between mt-2 text-xs" style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>
          <span>{formatNumber(data.totalBurned)} burned</span>
          <span>{formatNumber(data.totalSupply)} total supply</span>
        </div>
        <div className="mt-3 text-sm" style={{ color: "var(--text-secondary)" }}>
          📊 Next burn estimate: {data.nextBurnEstimate}
        </div>
      </div>

      {/* Burn Rate Chart */}
      <div className="rounded-xl p-6 border mb-8" style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>Burn Rate</h2>
          <div className="flex gap-1">
            {(["daily", "weekly", "monthly"] as const).map(v => (
              <button
                key={v}
                onClick={() => setView(v)}
                className="px-3 py-1 rounded text-xs uppercase"
                style={{
                  background: view === v ? "var(--accent)" : "transparent",
                  color: view === v ? "#fff" : "var(--text-tertiary)",
                  border: view === v ? "none" : "1px solid var(--border)",
                }}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-end gap-1 h-40">
          {buckets.map(([label, amount]) => (
            <div key={label} className="flex-1 flex flex-col items-center gap-1">
              <div className="text-[9px]" style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>
                {formatNumber(amount)}
              </div>
              <div
                className="w-full rounded-t transition-all duration-500"
                style={{
                  height: `${(amount / maxBucket) * 100}%`,
                  minHeight: "4px",
                  background: "linear-gradient(180deg, #f97316, #ea580c)",
                }}
              />
              <div className="text-[8px] truncate w-full text-center" style={{ color: "var(--text-tertiary)" }}>
                {view === "daily" ? label.slice(5) : label}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Burn History Table */}
      <div className="rounded-xl p-6 border" style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}>
        <h2 className="text-lg font-bold mb-4" style={{ color: "var(--text-primary)" }}>Burn History</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ fontFamily: "var(--font-mono)" }}>
            <thead>
              <tr style={{ color: "var(--text-tertiary)" }}>
                <th className="text-left pb-3">Date</th>
                <th className="text-right pb-3">Amount</th>
                <th className="text-left pb-3">Source</th>
                <th className="text-left pb-3">Tx Hash</th>
              </tr>
            </thead>
            <tbody>
              {(data.burns || []).slice(0, 25).map((b: any) => (
                <tr key={b.id} className="border-t" style={{ borderColor: "var(--border)" }}>
                  <td className="py-2" style={{ color: "var(--text-secondary)" }}>{new Date(b.date).toLocaleDateString()}</td>
                  <td className="py-2 text-right font-bold" style={{ color: "#f97316" }}>{formatNumber(b.amount)}</td>
                  <td className="py-2" style={{ color: "var(--text-secondary)" }}>{b.source}</td>
                  <td className="py-2">
                    {b.txHash ? (
                      <a
                        href={solanaExplorerUrl(`tx/${b.txHash}`)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 hover:underline"
                        style={{ color: "var(--accent)" }}
                      >
                        {b.txHash.slice(0, 8)}... <ExternalLink size={10} />
                      </a>
                    ) : (
                      <span style={{ color: "var(--text-tertiary)" }}>—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
