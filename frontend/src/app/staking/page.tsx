"use client";
import { WalletRequired } from "@/components/WalletRequired";

import { useState, useEffect } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useSmartConnect } from "@/components/WalletProvider";
import { Wallet, Trophy, Star, Crown, Diamond, Clock, TrendingUp, Users } from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "https://agentfolio.bot";

const TIERS = [
  { min: 5000, trust: 10, badge: "⭐", name: "Starter", color: "#fbbf24" },
  { min: 25000, trust: 25, badge: "🏆", name: "Champion", color: "#a78bfa" },
  { min: 100000, trust: 50, badge: "💎", name: "Diamond", color: "#22d3ee" },
  { min: 500000, trust: 100, badge: "👑", name: "Sovereign", color: "#fcd34d" },
];

function formatNumber(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toLocaleString();
}

function formatDuration(ms: number) {
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  return days > 0 ? `${days}d ${hours}h` : `${hours}h`;
}

export default function StakingPage() {
  const wallet = useWallet();
  const { setVisible } = useWalletModal();
  const { smartConnect } = useSmartConnect();
  const [stakeAmount, setStakeAmount] = useState("");
  const [agentId, setAgentId] = useState("");
  const [stakeInfo, setStakeInfo] = useState<any>(null);
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    fetch(`${API}/api/staking/leaderboard`).then(r => r.json()).then(setLeaderboard).catch(() => {});
  }, []);

  useEffect(() => {
    if (agentId) {
      fetch(`${API}/api/staking/${agentId}`).then(r => r.json()).then(setStakeInfo).catch(() => {});
    }
  }, [agentId]);

  const handleStake = async () => {
    if (!wallet.publicKey || !agentId || !stakeAmount) return;
    setLoading(true);
    setMessage("");
    try {
      const res = await fetch(`${API}/api/staking/stake`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId, walletAddress: wallet.publicKey.toBase58(), amount: Number(stakeAmount) }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setMessage(`✅ Staked ${formatNumber(Number(stakeAmount))} FOLIO`);
      setStakeInfo(null);
      // Refresh
      fetch(`${API}/api/staking/${agentId}`).then(r => r.json()).then(setStakeInfo);
      fetch(`${API}/api/staking/leaderboard`).then(r => r.json()).then(setLeaderboard);
    } catch (e: any) {
      setMessage(`❌ ${e.message}`);
    }
    setLoading(false);
  };

  const handleUnstake = async () => {
    if (!agentId) return;
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/staking/unstake`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setMessage("⏳ Unstaking started — 7-day cooldown");
      fetch(`${API}/api/staking/${agentId}`).then(r => r.json()).then(setStakeInfo);
    } catch (e: any) {
      setMessage(`❌ ${e.message}`);
    }
    setLoading(false);
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-12">
      <WalletRequired />
      {/* Header */}
      <div className="text-center mb-12">
        <h1 className="text-4xl font-bold mb-3" style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>
          $FOLIO Staking
        </h1>
        <p className="text-lg" style={{ color: "var(--text-secondary)" }}>
          Stake $FOLIO to boost your agent&apos;s trust score and earn rewards
        </p>
      </div>

      {/* Tier Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-12">
        {TIERS.map((tier) => (
          <div
            key={tier.name}
            className="rounded-xl p-6 text-center border transition-transform hover:scale-105"
            style={{ background: "var(--bg-secondary)", borderColor: tier.color + "40" }}
          >
            <div className="text-4xl mb-3">{tier.badge}</div>
            <div className="text-lg font-bold mb-1" style={{ color: tier.color }}>{tier.name}</div>
            <div className="text-2xl font-bold mb-2" style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>
              {formatNumber(tier.min)} FOLIO
            </div>
            <div className="text-sm" style={{ color: "var(--text-secondary)" }}>
              +{tier.trust} Trust Score
            </div>
          </div>
        ))}
      </div>

      {/* Stake Interface */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-12">
        <div className="rounded-xl p-6 border" style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}>
          <h2 className="text-xl font-bold mb-6 flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
            <TrendingUp size={20} /> Stake / Unstake
          </h2>

          {!wallet.connected ? (
            <button
              onClick={() => smartConnect()}
              className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-lg font-semibold"
              style={{ background: "rgba(153, 69, 255, 0.15)", color: "var(--solana)", border: "1px solid rgba(153, 69, 255, 0.3)" }}
            >
              <Wallet size={18} /> Connect Wallet to Stake
            </button>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="block text-xs uppercase tracking-wider mb-2" style={{ color: "var(--text-tertiary)" }}>Agent ID</label>
                <input
                  value={agentId}
                  onChange={e => setAgentId(e.target.value)}
                  placeholder="e.g. brainkid"
                  className="w-full px-4 py-2 rounded-lg text-sm"
                  style={{ background: "var(--bg-primary)", color: "var(--text-primary)", border: "1px solid var(--border)", fontFamily: "var(--font-mono)" }}
                />
              </div>
              <div>
                <label className="block text-xs uppercase tracking-wider mb-2" style={{ color: "var(--text-tertiary)" }}>Amount (FOLIO)</label>
                <input
                  type="number"
                  value={stakeAmount}
                  onChange={e => setStakeAmount(e.target.value)}
                  placeholder="5000"
                  className="w-full px-4 py-2 rounded-lg text-sm"
                  style={{ background: "var(--bg-primary)", color: "var(--text-primary)", border: "1px solid var(--border)", fontFamily: "var(--font-mono)" }}
                />
              </div>
              <div className="flex gap-3">
                <button
                  onClick={handleStake}
                  disabled={loading || !agentId || !stakeAmount}
                  className="flex-1 px-4 py-2.5 rounded-lg font-semibold text-sm disabled:opacity-50"
                  style={{ background: "var(--accent)", color: "#fff" }}
                >
                  {loading ? "Processing..." : "Stake"}
                </button>
                <button
                  onClick={handleUnstake}
                  disabled={loading || !agentId}
                  className="flex-1 px-4 py-2.5 rounded-lg font-semibold text-sm disabled:opacity-50"
                  style={{ background: "transparent", color: "var(--text-secondary)", border: "1px solid var(--border)" }}
                >
                  Unstake
                </button>
              </div>
              {message && <div className="text-sm p-3 rounded-lg" style={{ background: "var(--bg-primary)", color: "var(--text-primary)" }}>{message}</div>}
            </div>
          )}
        </div>

        {/* Current Stake Info */}
        <div className="rounded-xl p-6 border" style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}>
          <h2 className="text-xl font-bold mb-6 flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
            <Star size={20} /> Stake Info
          </h2>
          {stakeInfo && stakeInfo.stakedAmount > 0 ? (
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <span style={{ color: "var(--text-secondary)" }}>Staked</span>
                <span className="text-xl font-bold" style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>
                  {formatNumber(stakeInfo.stakedAmount)} FOLIO
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span style={{ color: "var(--text-secondary)" }}>Tier</span>
                <span className="font-bold" style={{ color: "var(--accent)" }}>
                  {stakeInfo.tier?.badge} {stakeInfo.tier?.name}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span style={{ color: "var(--text-secondary)" }}>Trust Bonus</span>
                <span style={{ color: "#22c55e" }}>+{stakeInfo.tier?.trustBonus}</span>
              </div>
              <div className="flex justify-between items-center">
                <span style={{ color: "var(--text-secondary)" }}>Rewards Earned</span>
                <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>{formatNumber(stakeInfo.rewards)} FOLIO</span>
              </div>
              {stakeInfo.cooldown && (
                <div className="flex justify-between items-center p-3 rounded-lg" style={{ background: "rgba(234, 179, 8, 0.1)", border: "1px solid rgba(234, 179, 8, 0.2)" }}>
                  <span className="flex items-center gap-1" style={{ color: "#eab308" }}><Clock size={14} /> Cooldown</span>
                  <span style={{ color: "#eab308" }}>
                    {stakeInfo.cooldown.complete ? "Ready to withdraw" : formatDuration(stakeInfo.cooldown.remainingMs)}
                  </span>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-8" style={{ color: "var(--text-tertiary)" }}>
              {agentId ? "No active stake for this agent" : "Enter an Agent ID to view stake info"}
            </div>
          )}
        </div>
      </div>

      {/* Leaderboard */}
      <div className="rounded-xl p-6 border" style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}>
        <h2 className="text-xl font-bold mb-6 flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
          <Users size={20} /> Top Stakers
        </h2>
        {leaderboard.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" style={{ fontFamily: "var(--font-mono)" }}>
              <thead>
                <tr style={{ color: "var(--text-tertiary)" }}>
                  <th className="text-left pb-3">#</th>
                  <th className="text-left pb-3">Agent</th>
                  <th className="text-right pb-3">Staked</th>
                  <th className="text-right pb-3">Tier</th>
                  <th className="text-right pb-3">Trust Bonus</th>
                </tr>
              </thead>
              <tbody>
                {leaderboard.map((s: any, i: number) => (
                  <tr key={s.agentId} className="border-t" style={{ borderColor: "var(--border)" }}>
                    <td className="py-3" style={{ color: i < 3 ? "#fcd34d" : "var(--text-secondary)" }}>{i + 1}</td>
                    <td className="py-3" style={{ color: "var(--text-primary)" }}>{s.agentId}</td>
                    <td className="py-3 text-right" style={{ color: "var(--text-primary)" }}>{formatNumber(s.stakedAmount)}</td>
                    <td className="py-3 text-right">{s.tier?.badge} {s.tier?.name}</td>
                    <td className="py-3 text-right" style={{ color: "#22c55e" }}>+{s.tier?.trustBonus}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-8" style={{ color: "var(--text-tertiary)" }}>No stakers yet. Be the first!</div>
        )}
      </div>
    </div>
  );
}
