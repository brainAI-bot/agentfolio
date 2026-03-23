"use client";
import { WalletRequired } from "@/components/WalletRequired";

import { useState, useEffect } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useSmartConnect } from "@/components/WalletProvider";
import { Rocket, Link2, ArrowLeft, Loader2, ExternalLink, CheckCircle2, Copy, Check } from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "https://agentfolio.bot";

type Platform = "virtuals" | "pumpfun" | "existing" | null;

interface LaunchForm {
  agentId: string;
  tokenName: string;
  tokenSymbol: string;
  description: string;
  tokenAddress: string;
  chain: "solana" | "base";
  agentType: string;
  preBuyVirtual: string;
  virtualsChain: "solana" | "base";
}

interface AgentOption {
  id: string;
  name: string;
  avatar?: string;
}

const VIRTUALS_PREBUY_TABLE = [
  { virtual: 100, pct: "0% (min)" },
  { virtual: 1100, pct: "~15%" },
  { virtual: 2600, pct: "~30%" },
  { virtual: 4100, pct: "~40%" },
  { virtual: 6000, pct: "~50%" },
  { virtual: 9000, pct: "~60%" },
  { virtual: 14000, pct: "~70%" },
  { virtual: 24000, pct: "~80%" },
  { virtual: 42000, pct: "87.5% (graduates)" },
];

export default function LaunchPage() {
  const wallet = useWallet();
  const { setVisible } = useWalletModal();
  const { smartConnect } = useSmartConnect();
  const [platform, setPlatform] = useState<Platform>(null);
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [launching, setLaunching] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [form, setForm] = useState<LaunchForm>({
    agentId: "",
    tokenName: "",
    tokenSymbol: "",
    description: "",
    tokenAddress: "",
    chain: "solana",
    agentType: "ON-CHAIN",
    preBuyVirtual: "100",
    virtualsChain: "solana",
  });

  useEffect(() => {
    fetch(`${API}/api/profiles`)
      .then((r) => r.json())
      .then((data) => {
        const list = (data.profiles || data || []).map((p: any) => ({
          id: p.id,
          name: p.name,
          avatar: p.avatar,
        }));
        setAgents(list);
      })
      .catch(() => {});
  }, []);

  const handleLaunch = async () => {
    if (!platform || !form.agentId) return;
    setLaunching(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`${API}/api/tokens/launch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: form.agentId,
          platform,
          tokenName: form.tokenName,
          tokenSymbol: form.tokenSymbol.toUpperCase(),
          description: form.description,
          tokenAddress: platform === "existing" ? form.tokenAddress : undefined,
          chain: platform === "existing" ? form.chain : undefined,
          agentType: platform === "virtuals" ? form.agentType : undefined,
          preBuyVirtual: platform === "virtuals" ? parseInt(form.preBuyVirtual) : undefined,
          virtualsChain: platform === "virtuals" ? form.virtualsChain : undefined,
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setResult(data.launch);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLaunching(false);
    }
  };

  const copyText = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Success view — Virtuals guided flow
  if (result) {
    const isVirtuals = result.platform === "virtuals";
    const instructions = result.metadata?.instructions || [];

    return (
      <div className="max-w-2xl mx-auto px-4 py-12" style={{ background: "var(--bg-primary)", minHeight: "calc(100vh - 56px)" }}>
      <WalletRequired />
        <div className="p-8 rounded-2xl" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
          {isVirtuals ? (
            <>
              <div className="text-4xl text-center mb-4">🟣</div>
              <h2 className="text-2xl font-bold mb-2 text-center" style={{ color: "var(--text-primary)" }}>
                Launch Created — Complete on Virtuals
              </h2>
              <p className="text-center mb-6" style={{ color: "var(--text-secondary)" }}>
                <span className="font-mono font-bold text-lg" style={{ color: "#a78bfa" }}>${result.symbol}</span> on {result.chain === "solana" ? "Solana" : "Base"}
              </p>

              {/* Cost summary */}
              <div className="grid grid-cols-2 gap-3 mb-6">
                <div className="p-3 rounded-lg text-center" style={{ background: "var(--bg-tertiary)" }}>
                  <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: "var(--text-muted)" }}>Creation Fee</div>
                  <div className="font-bold" style={{ color: "#a78bfa" }}>100 $VIRTUAL</div>
                </div>
                <div className="p-3 rounded-lg text-center" style={{ background: "var(--bg-tertiary)" }}>
                  <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: "var(--text-muted)" }}>Pre-buy</div>
                  <div className="font-bold" style={{ color: "#a78bfa" }}>{result.metadata?.estimatedCost || "100 $VIRTUAL"}</div>
                </div>
                <div className="p-3 rounded-lg text-center" style={{ background: "var(--bg-tertiary)" }}>
                  <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: "var(--text-muted)" }}>Est. Supply</div>
                  <div className="font-bold" style={{ color: "var(--text-primary)" }}>{result.metadata?.estimatedSupplyPct || "—"}</div>
                </div>
                <div className="p-3 rounded-lg text-center" style={{ background: "var(--bg-tertiary)" }}>
                  <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: "var(--text-muted)" }}>DEX Target</div>
                  <div className="font-bold" style={{ color: "var(--text-primary)" }}>{result.metadata?.dexTarget || "Meteora"}</div>
                </div>
              </div>

              {/* Step-by-step instructions */}
              <div className="mb-6">
                <h3 className="text-sm font-bold uppercase tracking-wider mb-3" style={{ color: "var(--text-muted)" }}>
                  Complete These Steps
                </h3>
                <ol className="space-y-2">
                  {instructions.map((step: string, i: number) => (
                    <li key={i} className="flex gap-3 text-sm" style={{ color: "var(--text-secondary)" }}>
                      <span className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold" style={{ background: "rgba(139, 92, 246, 0.15)", color: "#a78bfa" }}>
                        {i + 1}
                      </span>
                      <span className="pt-0.5">{step}</span>
                    </li>
                  ))}
                </ol>
              </div>

              {/* Quick copy details */}
              <div className="space-y-2 mb-6">
                {[
                  { label: "Name", value: result.name },
                  { label: "Ticker", value: result.symbol },
                  { label: "Description", value: result.description },
                ].map(({ label, value }) => (
                  <div key={label} className="flex items-center justify-between p-2 rounded-lg" style={{ background: "var(--bg-tertiary)" }}>
                    <span className="text-xs" style={{ color: "var(--text-muted)" }}>{label}:</span>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-mono" style={{ color: "var(--text-primary)" }}>{value?.length > 40 ? value.slice(0, 40) + "…" : value}</span>
                      <button onClick={() => copyText(value)} className="p-1 rounded hover:bg-white/5">
                        {copied ? <Check size={12} className="text-green-400" /> : <Copy size={12} style={{ color: "var(--text-muted)" }} />}
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex gap-3 justify-center flex-wrap">
                <a
                  href="https://fun.virtuals.io/"
                  target="_blank"
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold"
                  style={{ background: "rgba(139, 92, 246, 0.2)", color: "#a78bfa", border: "1px solid rgba(139, 92, 246, 0.4)" }}
                >
                  <ExternalLink size={14} /> Open fun.virtuals.io
                </a>
                <button
                  onClick={() => { setResult(null); setPlatform(null); }}
                  className="px-4 py-2.5 rounded-xl text-sm"
                  style={{ background: "var(--bg-tertiary)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}
                >
                  Back
                </button>
              </div>

              <p className="text-center text-xs mt-4" style={{ color: "var(--text-muted)" }}>
                After launching on Virtuals, come back and link the token address via the API or profile page.
              </p>
            </>
          ) : (
            <>
              <CheckCircle2 size={48} className="mx-auto mb-4 text-green-400" />
              <h2 className="text-2xl font-bold mb-2 text-center" style={{ color: "var(--text-primary)" }}>
                {result.status === "live" ? "Token Launched! 🎉" : "Launch Created"}
              </h2>
              <p className="text-center mb-6" style={{ color: "var(--text-secondary)" }}>
                <span className="font-mono font-bold text-lg">${result.symbol}</span> on {result.platform}
              </p>
              {result.tokenAddress && (
                <div className="p-3 rounded-lg mb-4 font-mono text-xs break-all" style={{ background: "var(--bg-tertiary)", color: "var(--text-secondary)" }}>
                  {result.tokenAddress}
                </div>
              )}
              <div className="flex gap-3 justify-center flex-wrap">
                {result.pumpUrl && (
                  <a href={result.pumpUrl} target="_blank" className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold" style={{ background: "rgba(34, 197, 94, 0.15)", color: "#22c55e", border: "1px solid rgba(34, 197, 94, 0.3)" }}>
                    <ExternalLink size={14} /> View on pump.fun
                  </a>
                )}
                <button onClick={() => { setResult(null); setPlatform(null); }} className="px-4 py-2 rounded-lg text-sm" style={{ background: "var(--bg-tertiary)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}>
                  Launch Another
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-12" style={{ background: "var(--bg-primary)", minHeight: "calc(100vh - 56px)" }}>
      <div className="text-center mb-12">
        <h1 className="text-3xl font-bold mb-3" style={{ color: "var(--text-primary)" }}>
          Launch a Token
        </h1>
        <p style={{ color: "var(--text-secondary)" }}>
          Give your agent a token — launch on Virtuals Protocol for instant ecosystem distribution.
        </p>
      </div>

      {/* Platform selection */}
      {!platform && (
        <div className="max-w-4xl mx-auto">
          {/* Virtuals — Featured hero card */}
          <button
            onClick={() => setPlatform("virtuals")}
            className="w-full p-8 rounded-2xl text-left mb-6 transition-all hover:scale-[1.01] hover:shadow-xl group relative overflow-hidden"
            style={{
              background: "linear-gradient(135deg, rgba(139, 92, 246, 0.12), rgba(168, 85, 247, 0.06))",
              border: "2px solid rgba(139, 92, 246, 0.4)",
            }}
          >
            <div className="absolute top-4 right-4 text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded-full" style={{ background: "rgba(139, 92, 246, 0.2)", color: "#a78bfa" }}>
              Recommended
            </div>
            <div className="flex items-start gap-6">
              <div className="text-5xl">🟣</div>
              <div className="flex-1">
                <h3 className="text-xl font-bold mb-2 group-hover:text-[#a78bfa]" style={{ color: "var(--text-primary)" }}>
                  Launch on Virtuals Protocol
                </h3>
                <p className="text-sm mb-4" style={{ color: "var(--text-secondary)" }}>
                  The premier AI agent launchpad. Instant access to the Virtuals ecosystem of agent token traders on Solana.
                </p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    { label: "Cost", value: "100 $VIRTUAL" },
                    { label: "Paired with", value: "$VIRTUAL" },
                    { label: "Chain", value: "Solana" },
                    { label: "DEX", value: "Meteora" },
                  ].map(({ label, value }) => (
                    <div key={label} className="p-2 rounded-lg" style={{ background: "rgba(139, 92, 246, 0.08)" }}>
                      <div className="text-[9px] uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>{label}</div>
                      <div className="text-sm font-semibold" style={{ color: "#c4b5fd" }}>{value}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="mt-4 py-2.5 rounded-xl text-center text-sm font-bold uppercase tracking-wider" style={{ background: "rgba(139, 92, 246, 0.2)", color: "#a78bfa", border: "1px solid rgba(139, 92, 246, 0.3)" }}>
              Launch on Virtuals →
            </div>
          </button>

          {/* Bottom row: pump.fun (coming soon) + Link Existing */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* pump.fun — Coming Soon */}
            <div
              className="p-6 rounded-2xl relative opacity-50 cursor-not-allowed"
              style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}
            >
              <div className="absolute top-3 right-3 text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full" style={{ background: "rgba(255,255,255,0.06)", color: "var(--text-muted)" }}>
                Coming Soon
              </div>
              <div className="text-3xl mb-3">🚀</div>
              <h3 className="text-lg font-bold mb-2" style={{ color: "var(--text-tertiary)" }}>
                Launch on pump.fun
              </h3>
              <ul className="space-y-1.5 mb-4">
                {["~0.02 SOL cost", "SOL paired", "Raydium LP", "Instant launch"].map((f) => (
                  <li key={f} className="text-sm flex items-center gap-2" style={{ color: "var(--text-muted)" }}>
                    <span style={{ color: "#4b5563" }}>•</span> {f}
                  </li>
                ))}
              </ul>
              <div className="py-2 rounded-lg text-center text-xs font-bold uppercase tracking-wider" style={{ background: "rgba(255,255,255,0.03)", color: "var(--text-muted)", border: "1px solid var(--border)" }}>
                Phase 2
              </div>
            </div>

            {/* Link Existing */}
            <button
              onClick={() => setPlatform("existing")}
              className="p-6 rounded-2xl text-left transition-all hover:scale-[1.02] group"
              style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}
            >
              <div className="text-3xl mb-3">🔗</div>
              <h3 className="text-lg font-bold mb-2 group-hover:text-[var(--accent)]" style={{ color: "var(--text-primary)" }}>
                Link Existing Token
              </h3>
              <ul className="space-y-1.5 mb-4">
                {["Any SPL or ERC-20", "Free to link", "Keep your community", "Instant setup"].map((f) => (
                  <li key={f} className="text-sm flex items-center gap-2" style={{ color: "var(--text-secondary)" }}>
                    <span style={{ color: "#3b82f6" }}>•</span> {f}
                  </li>
                ))}
              </ul>
              <div className="py-2 rounded-lg text-center text-xs font-bold uppercase tracking-wider" style={{ background: "rgba(59, 130, 246, 0.1)", color: "#60a5fa", border: "1px solid rgba(59, 130, 246, 0.2)" }}>
                Select
              </div>
            </button>
          </div>
        </div>
      )}

      {/* Launch form */}
      {platform && (
        <div className="max-w-lg mx-auto">
          <button
            onClick={() => { setPlatform(null); setError(null); }}
            className="flex items-center gap-2 mb-6 text-sm transition-colors hover:text-[var(--accent)]"
            style={{ color: "var(--text-muted)" }}
          >
            <ArrowLeft size={16} /> Back to platforms
          </button>

          <div className="p-6 rounded-2xl" style={{ background: "var(--bg-secondary)", border: platform === "virtuals" ? "2px solid rgba(139, 92, 246, 0.3)" : "1px solid var(--border)" }}>
            <h2 className="text-xl font-bold mb-6" style={{ color: "var(--text-primary)" }}>
              {platform === "virtuals" && "🟣 Launch on Virtuals Protocol"}
              {platform === "existing" && "🔗 Link Existing Token"}
            </h2>

            <div className="space-y-4">
              {/* Agent selector */}
              <Field label="Agent">
                <select
                  value={form.agentId}
                  onChange={(e) => {
                    const agent = agents.find((a) => a.id === e.target.value);
                    setForm({ ...form, agentId: e.target.value, tokenName: agent?.name || form.tokenName });
                  }}
                  className="w-full px-3 py-2.5 rounded-lg text-sm"
                  style={{ background: "var(--bg-tertiary)", color: "var(--text-primary)", border: "1px solid var(--border)", fontFamily: "var(--font-mono)" }}
                >
                  <option value="">Select an agent...</option>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>{a.name} ({a.id})</option>
                  ))}
                </select>
              </Field>

              {/* Token Name */}
              <Field label="Token Name">
                <input value={form.tokenName} onChange={(e) => setForm({ ...form, tokenName: e.target.value })} placeholder="e.g. brainKID" className="w-full px-3 py-2.5 rounded-lg text-sm" style={{ background: "var(--bg-tertiary)", color: "var(--text-primary)", border: "1px solid var(--border)" }} />
              </Field>

              {/* Symbol */}
              <Field label={`Token Symbol (${platform === "virtuals" ? "≤6" : "3-10"} chars)`}>
                <input value={form.tokenSymbol} onChange={(e) => setForm({ ...form, tokenSymbol: e.target.value.toUpperCase().slice(0, platform === "virtuals" ? 6 : 10) })} placeholder="e.g. BKID" maxLength={platform === "virtuals" ? 6 : 10} className="w-full px-3 py-2.5 rounded-lg text-sm font-mono" style={{ background: "var(--bg-tertiary)", color: "var(--text-primary)", border: "1px solid var(--border)" }} />
              </Field>

              {/* Description */}
              {platform !== "existing" && (
                <Field label="Description">
                  <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What makes this agent special?" rows={3} className="w-full px-3 py-2.5 rounded-lg text-sm resize-none" style={{ background: "var(--bg-tertiary)", color: "var(--text-primary)", border: "1px solid var(--border)" }} />
                </Field>
              )}

              {/* Virtuals-specific fields */}
              {platform === "virtuals" && (
                <>
                  {/* Chain — Solana only */}
                  <Field label="Launch Chain">
                    <div className="px-3 py-2.5 rounded-lg text-sm font-semibold" style={{ background: "rgba(153, 69, 255, 0.15)", color: "#9945ff", border: "2px solid rgba(153, 69, 255, 0.4)" }}>
                      ◎ Solana
                    </div>
                    <p className="text-[11px] mt-1" style={{ color: "var(--text-muted)" }}>
                      Single token mechanism • Meteora DEX pool • Matches AgentFolio on-chain infrastructure
                    </p>
                  </Field>

                  {/* Agent Type */}
                  <Field label="Agent Type">
                    <select value={form.agentType} onChange={(e) => setForm({ ...form, agentType: e.target.value })} className="w-full px-3 py-2.5 rounded-lg text-sm" style={{ background: "var(--bg-tertiary)", color: "var(--text-primary)", border: "1px solid var(--border)", fontFamily: "var(--font-mono)" }}>
                      <option value="ON-CHAIN">On-Chain (Trading / DeFi)</option>
                      <option value="INFORMATION">Information (Insights / Research)</option>
                      <option value="PRODUCTIVITY">Productivity (Task Automation)</option>
                      <option value="CREATIVE">Creative (Memes / Art / Music)</option>
                      <option value="ENTERTAINMENT">Entertainment (KOL / Personality)</option>
                    </select>
                  </Field>

                  {/* Pre-buy amount */}
                  <Field label="Pre-buy Amount ($VIRTUAL)">
                    <input value={form.preBuyVirtual} onChange={(e) => setForm({ ...form, preBuyVirtual: e.target.value })} placeholder="100" type="number" min="100" className="w-full px-3 py-2.5 rounded-lg text-sm font-mono" style={{ background: "var(--bg-tertiary)", color: "var(--text-primary)", border: "1px solid var(--border)" }} />
                    <div className="mt-2 text-[11px]" style={{ color: "var(--text-muted)" }}>
                      Min 100 (creation fee only). Supply %:{" "}
                      {VIRTUALS_PREBUY_TABLE.filter(r => parseInt(form.preBuyVirtual) >= r.virtual).pop()?.pct || "0%"}
                    </div>
                  </Field>

                  {/* Info box */}
                  <div className="p-3 rounded-lg text-xs" style={{ background: "rgba(139, 92, 246, 0.08)", border: "1px solid rgba(139, 92, 246, 0.15)", color: "#c4b5fd" }}>
                    <strong>How it works:</strong> Your agent launches on a bonding curve at fun.virtuals.io. When 42,000 $VIRTUAL accumulates, it graduates to a full DEX pool. Creator earns 30% of post-graduation trading fees.
                  </div>
                </>
              )}

              {/* Existing token fields */}
              {platform === "existing" && (
                <>
                  <Field label="Token Address">
                    <input value={form.tokenAddress} onChange={(e) => setForm({ ...form, tokenAddress: e.target.value })} placeholder="Token contract address..." className="w-full px-3 py-2.5 rounded-lg text-sm font-mono" style={{ background: "var(--bg-tertiary)", color: "var(--text-primary)", border: "1px solid var(--border)" }} />
                  </Field>
                  <Field label="Chain">
                    <select value={form.chain} onChange={(e) => setForm({ ...form, chain: e.target.value as "solana" | "base" })} className="w-full px-3 py-2.5 rounded-lg text-sm" style={{ background: "var(--bg-tertiary)", color: "var(--text-primary)", border: "1px solid var(--border)", fontFamily: "var(--font-mono)" }}>
                      <option value="solana">Solana</option>
                      <option value="base">Base</option>
                    </select>
                  </Field>
                </>
              )}

              {error && (
                <div className="p-3 rounded-lg text-sm" style={{ background: "rgba(239, 68, 68, 0.1)", border: "1px solid rgba(239, 68, 68, 0.2)", color: "#f87171" }}>
                  {error}
                </div>
              )}

              {/* Launch button */}
              {!wallet.connected ? (
                <button onClick={() => smartConnect()} className="w-full py-3 rounded-xl text-sm font-bold uppercase tracking-wider" style={{ background: "rgba(153, 69, 255, 0.15)", color: "var(--solana)", border: "1px solid rgba(153, 69, 255, 0.3)" }}>
                  Connect Wallet to Continue
                </button>
              ) : (
                <button
                  onClick={handleLaunch}
                  disabled={launching || !form.agentId || !form.tokenName || !form.tokenSymbol}
                  className="w-full py-3 rounded-xl text-sm font-bold uppercase tracking-wider transition-all disabled:opacity-40"
                  style={{
                    background: platform === "virtuals" ? "rgba(139, 92, 246, 0.2)" : "rgba(59, 130, 246, 0.2)",
                    color: platform === "virtuals" ? "#a78bfa" : "#60a5fa",
                    border: `1px solid ${platform === "virtuals" ? "rgba(139, 92, 246, 0.4)" : "rgba(59, 130, 246, 0.3)"}`,
                  }}
                >
                  {launching ? (
                    <span className="flex items-center justify-center gap-2"><Loader2 size={16} className="animate-spin" /> Creating...</span>
                  ) : platform === "virtuals" ? (
                    "Create Launch → Complete on Virtuals"
                  ) : (
                    "Link Token"
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
        {label}
      </label>
      {children}
    </div>
  );
}
