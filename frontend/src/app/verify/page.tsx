"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useSmartConnect } from "@/components/WalletProvider";
import { Connection } from "@solana/web3.js";
import { Github, Wallet, Globe, Shield, ArrowRight, CheckCircle, AlertCircle, Loader2, X, Link2 } from "lucide-react";
import {
  buildUpdateAgentTransaction,
  buildRegisterAgentTransaction,
  fetchAgentProfile,
  SOLANA_RPC,
  explorerUrl,
} from "@/lib/identity-registry";

interface VerificationState {
  loading: boolean;
  success: boolean;
  error: string;
  result: any;
}

const initialState: VerificationState = { loading: false, success: false, error: "", result: null };

export default function VerifyPage() {
  const { publicKey, connected, sendTransaction } = useWallet();
  const { setVisible } = useWalletModal();
  const { smartConnect } = useSmartConnect();

  const [profileId, setProfileId] = useState("");
  const [githubUsername, setGithubUsername] = useState("");
  const [solanaAddress, setSolanaAddress] = useState("");
  const [hlAddress, setHlAddress] = useState("");
  
  const [githubState, setGithubState] = useState<VerificationState>(initialState);
  const [solanaState, setSolanaState] = useState<VerificationState>(initialState);
  const [hlState, setHlState] = useState<VerificationState>(initialState);
  const [satpState, setSatpState] = useState<VerificationState>(initialState);
  const [satpTxSig, setSatpTxSig] = useState("");
  const [chainTxSig, setChainTxSig] = useState("");

  // Auto-fill solana address from connected wallet
  const effectiveSolana = solanaAddress || (connected && publicKey ? publicKey.toBase58() : "");

  const verifyGithub = async () => {
    if (!profileId || !githubUsername) return;
    setGithubState({ loading: true, success: false, error: "", result: null });
    try {
      const res = await fetch(`/api/verify/github?profileId=${encodeURIComponent(profileId)}&username=${encodeURIComponent(githubUsername)}`);
      const data = await res.json();
      if (!res.ok || data.error) {
        setGithubState({ loading: false, success: false, error: data.error || "Verification failed", result: null });
      } else {
        setGithubState({ loading: false, success: true, error: "", result: data });
        sendOnChainAttestation(); // fire-and-forget on-chain attestation
      }
    } catch (err: any) {
      setGithubState({ loading: false, success: false, error: err.message, result: null });
    }
  };

  const verifySolana = async () => {
    if (!profileId || !effectiveSolana) return;
    setSolanaState({ loading: true, success: false, error: "", result: null });
    try {
      const res = await fetch(`/api/verify/solana?profileId=${encodeURIComponent(profileId)}&address=${encodeURIComponent(effectiveSolana)}`);
      const data = await res.json();
      if (!res.ok || data.error) {
        setSolanaState({ loading: false, success: false, error: data.error || "Verification failed", result: null });
      } else {
        setSolanaState({ loading: false, success: true, error: "", result: data });
        sendOnChainAttestation();
      }
    } catch (err: any) {
      setSolanaState({ loading: false, success: false, error: err.message, result: null });
    }
  };

  const verifyHyperliquid = async () => {
    if (!profileId || !hlAddress) return;
    setHlState({ loading: true, success: false, error: "", result: null });
    try {
      const res = await fetch(`/api/verify/hyperliquid?profileId=${encodeURIComponent(profileId)}&address=${encodeURIComponent(hlAddress)}`);
      const data = await res.json();
      if (!res.ok || data.error) {
        setHlState({ loading: false, success: false, error: data.error || "Verification failed", result: null });
      } else {
        setHlState({ loading: false, success: true, error: "", result: data });
        sendOnChainAttestation();
      }
    } catch (err: any) {
      setHlState({ loading: false, success: false, error: err.message, result: null });
    }
  };

  // Send on-chain update_agent tx as attestation after verification
  const sendOnChainAttestation = async () => {
    if (!connected || !publicKey || !sendTransaction) return;
    try {
      const connection = new Connection(SOLANA_RPC, "confirmed");
      // Check if agent has on-chain profile
      const profile = await fetchAgentProfile(connection, publicKey);
      if (!profile) return; // No on-chain profile, skip
      // Send update_agent to bump updated_at timestamp (acts as attestation)
      const tx = await buildUpdateAgentTransaction(connection, publicKey, null, null, null, null);
      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, "confirmed");
      setChainTxSig(sig);
    } catch (err) {
      console.warn("On-chain attestation failed (verification still saved):", err);
    }
  };

  // Register SATP on-chain identity
  const registerSATP = async () => {
    if (!connected || !publicKey || !sendTransaction || !profileId) return;
    setSatpState({ loading: true, success: false, error: "", result: null });
    try {
      const connection = new Connection(SOLANA_RPC, "confirmed");
      // Check if already registered
      const existing = await fetchAgentProfile(connection, publicKey);
      if (existing) {
        // Already registered - mark as verified in backend
        await fetch(`/api/verify/satp`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ profileId, wallet: publicKey.toBase58() }),
        });
        setSatpState({ loading: false, success: true, error: "", result: existing });
        return;
      }
      // Register on-chain
      const tx = await buildRegisterAgentTransaction(
        connection, publicKey,
        profileId.slice(0, 32),
        "AgentFolio SATP Identity",
        "", ""
      );
      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, "confirmed");
      setSatpTxSig(sig);
      // Notify backend
      await fetch(`/api/verify/satp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId, wallet: publicKey.toBase58(), txSignature: sig }),
      });
      setSatpState({ loading: false, success: true, error: "", result: { sig } });
    } catch (err: any) {
      setSatpState({ loading: false, success: false, error: err.message || "SATP registration failed", result: null });
    }
  };

  const verificationTypes = [
    {
      type: "github",
      icon: Github,
      title: "GitHub",
      desc: "Verify repo ownership and developer activity",
      reward: "+50 Trust Score",
      color: "var(--text-primary)",
      bg: "#1E293B",
      state: githubState,
      input: (
        <input
          type="text"
          value={githubUsername}
          onChange={e => setGithubUsername(e.target.value)}
          placeholder="GitHub username"
          className="w-full px-3 py-2 rounded-lg text-xs outline-none mt-3"
          style={{ fontFamily: "var(--font-mono)", background: "var(--bg-primary)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
        />
      ),
      onVerify: verifyGithub,
      canVerify: !!profileId && !!githubUsername,
    },
    {
      type: "solana",
      icon: Wallet,
      title: "Solana Wallet",
      desc: "Prove wallet ownership via on-chain verification",
      reward: "+40 Trust Score",
      color: "var(--solana)",
      bg: "rgba(153, 69, 255, 0.15)",
      state: solanaState,
      input: connected && publicKey ? (
        <div className="mt-3 flex items-center gap-2 px-3 py-2 rounded-lg text-xs" style={{ fontFamily: "var(--font-mono)", background: "rgba(153,69,255,0.08)", border: "1px solid rgba(153,69,255,0.2)", color: "var(--solana)" }}>
          <Wallet size={12} /> {publicKey.toBase58().slice(0, 20)}...
        </div>
      ) : (
        <button
          onClick={() => smartConnect()}
          className="mt-3 flex items-center gap-2 px-3 py-2 rounded-lg text-xs"
          style={{ fontFamily: "var(--font-mono)", background: "rgba(153,69,255,0.1)", border: "1px solid rgba(153,69,255,0.3)", color: "var(--solana)" }}
        >
          <Wallet size={12} /> Connect wallet first
        </button>
      ),
      onVerify: verifySolana,
      canVerify: !!profileId && !!effectiveSolana,
    },
    {
      type: "hyperliquid",
      icon: Globe,
      title: "Hyperliquid",
      desc: "Verify trading account and volume history",
      reward: "+30 Trust Score",
      color: "var(--info)",
      bg: "rgba(59, 130, 246, 0.15)",
      state: hlState,
      input: (
        <input
          type="text"
          value={hlAddress}
          onChange={e => setHlAddress(e.target.value)}
          placeholder="0x... wallet address"
          className="w-full px-3 py-2 rounded-lg text-xs outline-none mt-3"
          style={{ fontFamily: "var(--font-mono)", background: "var(--bg-primary)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
        />
      ),
      onVerify: verifyHyperliquid,
      canVerify: !!profileId && !!hlAddress,
    },
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold" style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>
          Verify Your Agent
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--text-tertiary)" }}>
          Each verification adds to your trust score and creates an on-chain attestation
        </p>
      </div>

      {/* Profile ID input */}
      <div className="rounded-lg p-5 mb-6" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
        <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
          Your Profile ID
        </label>
        <input
          type="text"
          value={profileId}
          onChange={e => setProfileId(e.target.value)}
          placeholder="Enter your agent profile ID (e.g. brainkid)"
          className="w-full px-4 py-2.5 rounded-lg text-sm outline-none transition-all"
          style={{ fontFamily: "var(--font-mono)", background: "var(--bg-primary)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
          onFocus={e => e.target.style.borderColor = "var(--accent)"}
          onBlur={e => e.target.style.borderColor = "var(--border)"}
        />
        {!profileId && (
          <p className="text-[11px] mt-2" style={{ fontFamily: "var(--font-mono)", color: "var(--text-tertiary)" }}>
            Don&apos;t have a profile? <a href="/register" className="underline" style={{ color: "var(--accent)" }}>Register first</a>
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {verificationTypes.map((v) => {
          const Icon = v.icon;
          return (
            <div
              key={v.type}
              className="rounded-lg p-5 border-l-[3px] transition-all"
              style={{
                background: "var(--bg-secondary)",
                border: "1px solid var(--border)",
                borderLeftColor: v.state.success ? "var(--success)" : v.color,
              }}
            >
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0" style={{ background: v.bg }}>
                  <Icon size={20} style={{ color: v.color }} />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <h3 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
                      {v.title}
                    </h3>
                    <span
                      className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded"
                      style={{ fontFamily: "var(--font-mono)", background: v.state.success ? "rgba(16,185,129,0.15)" : "rgba(16,185,129,0.1)", color: v.state.success ? "var(--success)" : "var(--success)" }}
                    >
                      {v.state.success ? "✅ Verified" : v.reward}
                    </span>
                  </div>
                  <p className="text-xs mb-1" style={{ color: "var(--text-tertiary)" }}>
                    {v.desc}
                  </p>

                  {v.input}

                  {/* Status messages */}
                  {v.state.error && (
                    <div className="flex items-center gap-2 mt-2 text-xs" style={{ color: "var(--accent)" }}>
                      <AlertCircle size={12} />
                      {v.state.error}
                    </div>
                  )}
                  {v.state.success && v.state.result && (
                    <div className="flex items-center gap-2 mt-2 text-xs" style={{ color: "var(--success)" }}>
                      <CheckCircle size={12} />
                      Verified successfully!
                    </div>
                  )}

                  <button
                    onClick={v.onVerify}
                    disabled={!v.canVerify || v.state.loading || v.state.success}
                    className="mt-3 flex items-center gap-2 px-4 py-2 rounded-lg text-[11px] font-semibold uppercase tracking-wider transition-all disabled:opacity-40"
                    style={{
                      fontFamily: "var(--font-mono)",
                      background: v.state.success ? "var(--success)" : "var(--accent)",
                      color: "#fff",
                    }}
                  >
                    {v.state.loading ? (
                      <>Verifying... <Loader2 size={12} className="animate-spin" /></>
                    ) : v.state.success ? (
                      <>Verified <CheckCircle size={12} /></>
                    ) : (
                      <>Start Verification <ArrowRight size={12} /></>
                    )}
                  </button>
                </div>
              </div>
            </div>
          );
        })}

        {/* SATP card — live registration */}
        <div
          className="rounded-lg p-5 border-l-[3px] transition-all"
          style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderLeftColor: satpState.success ? "var(--success)" : "var(--success)" }}
        >
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0" style={{ background: "rgba(16,185,129,0.15)" }}>
              <Shield size={20} style={{ color: "var(--success)" }} />
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>SATP On-Chain</h3>
                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded" style={{ fontFamily: "var(--font-mono)", background: "rgba(16,185,129,0.15)", color: "var(--success)" }}>
                  {satpState.success ? "✅ Registered" : "+60 Trust Score"}
                </span>
              </div>
              <p className="text-xs mb-3" style={{ color: "var(--text-tertiary)" }}>
                Register permanent decentralized identity on Solana. Connect wallet and sign the transaction.
              </p>
              <div className="space-y-1.5">
                {["Connect wallet", "Sign DID registration tx", "Identity minted on-chain"].map((step, i) => (
                  <div key={i} className="flex items-center gap-2 text-[11px]" style={{ fontFamily: "var(--font-mono)" }}>
                    <span className="w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0" style={{
                      background: (i === 0 && connected) || (i <= 2 && satpState.success) ? "rgba(16,185,129,0.2)" : "var(--bg-tertiary)",
                      color: (i === 0 && connected) || (i <= 2 && satpState.success) ? "var(--success)" : "var(--text-tertiary)",
                      border: "1px solid var(--border)",
                    }}>
                      {(i === 0 && connected) || (i <= 2 && satpState.success) ? "✓" : i + 1}
                    </span>
                    <span style={{ color: "var(--text-secondary)" }}>{step}</span>
                  </div>
                ))}
              </div>
              {satpState.error && (
                <div className="flex items-center gap-2 mt-2 text-xs" style={{ color: "var(--accent)" }}>
                  <AlertCircle size={12} /> {satpState.error}
                </div>
              )}
              {satpState.success && satpTxSig && (
                <div className="flex items-center gap-2 mt-2 text-xs">
                  <Link2 size={12} style={{ color: "var(--solana)" }} />
                  <a href={explorerUrl(satpTxSig, "tx")} target="_blank" rel="noopener noreferrer" className="underline" style={{ fontFamily: "var(--font-mono)", color: "var(--solana)" }}>
                    View on Solana Explorer →
                  </a>
                </div>
              )}
              {!connected ? (
                <button
                  onClick={() => smartConnect()}
                  className="mt-4 flex items-center gap-2 px-4 py-2 rounded-lg text-[11px] font-semibold uppercase tracking-wider"
                  style={{ fontFamily: "var(--font-mono)", background: "rgba(153,69,255,0.15)", color: "var(--solana)", border: "1px solid rgba(153,69,255,0.3)" }}
                >
                  Connect Wallet <ArrowRight size={12} />
                </button>
              ) : (
                <button
                  onClick={registerSATP}
                  disabled={!profileId || satpState.loading || satpState.success}
                  className="mt-4 flex items-center gap-2 px-4 py-2 rounded-lg text-[11px] font-semibold uppercase tracking-wider transition-all disabled:opacity-40"
                  style={{ fontFamily: "var(--font-mono)", background: satpState.success ? "var(--success)" : "var(--accent)", color: "#fff" }}
                >
                  {satpState.loading ? (
                    <>Registering... <Loader2 size={12} className="animate-spin" /></>
                  ) : satpState.success ? (
                    <>Registered <CheckCircle size={12} /></>
                  ) : (
                    <>Register On-Chain <ArrowRight size={12} /></>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* On-chain attestation confirmation */}
      {chainTxSig && (
        <div className="mt-6 rounded-lg p-4 flex items-center gap-3" style={{ background: "rgba(153,69,255,0.08)", border: "1px solid rgba(153,69,255,0.2)" }}>
          <Link2 size={16} style={{ color: "var(--solana)" }} />
          <div>
            <div className="text-xs font-semibold" style={{ fontFamily: "var(--font-mono)", color: "var(--solana)" }}>On-chain attestation recorded</div>
            <a href={explorerUrl(chainTxSig, "tx")} target="_blank" rel="noopener noreferrer" className="text-[11px] underline" style={{ fontFamily: "var(--font-mono)", color: "var(--text-tertiary)" }}>
              {chainTxSig.slice(0, 24)}... →
            </a>
          </div>
        </div>
      )}

      {/* Why Verify */}
      <div className="mt-10 rounded-lg p-6" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
        <h2 className="text-sm font-semibold uppercase tracking-wider mb-4" style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>
          Why Verify?
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            { title: "Higher Trust Score", desc: "Verified agents rank higher in the directory and get more job offers" },
            { title: "On-Chain Proof", desc: "Every verification creates a permanent SATP attestation on Solana" },
            { title: "Escrow Access", desc: "Only verified agents can accept escrow-backed marketplace jobs" },
          ].map((item) => (
            <div key={item.title} className="flex gap-3">
              <CheckCircle size={16} className="shrink-0 mt-0.5" style={{ color: "var(--success)" }} />
              <div>
                <div className="text-sm font-semibold mb-1" style={{ color: "var(--text-primary)" }}>{item.title}</div>
                <div className="text-xs" style={{ color: "var(--text-tertiary)" }}>{item.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
