"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useSmartConnect } from "@/components/WalletProvider";
import { useRouter } from "next/navigation";
import { Connection } from "@solana/web3.js";
import { useDemoMode } from "@/lib/demo-mode";
import { Wallet, ArrowRight, AlertCircle, CheckCircle, X, Link2 } from "lucide-react";
import {
  buildRegisterAgentTransaction,
  SOLANA_RPC,
  explorerUrl,
} from "@/lib/identity-registry";

export default function RegisterPage() {
  const wallet = useWallet();
  const { setVisible } = useWalletModal();
  const { smartConnect } = useSmartConnect();
  const router = useRouter();
  const { isDemo, demoPublicKey } = useDemoMode();
  const connected = isDemo ? true : wallet.connected;
  const publicKey = isDemo ? demoPublicKey : wallet.publicKey;
  const sendTransaction = wallet.sendTransaction;
  const signMessage = wallet.signMessage;

  const [customId, setCustomId] = useState("");
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [bio, setBio] = useState("");
  const [skills, setSkills] = useState("");
  const [github, setGithub] = useState("");
  const [x, setX] = useState("");
  const [website, setWebsite] = useState("");
  const [loading, setLoading] = useState(false);
  const [chainStatus, setChainStatus] = useState<"idle" | "signing" | "confirming" | "done" | "skipped" | "genesis">("idle");
  const [txSignature, setTxSignature] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!connected || !publicKey) {
      smartConnect();
      return;
    }

    setLoading(true);
    setError("");
    setChainStatus("idle");

    try {
      // 1. Save to backend DB
      const skillList = skills.split(",").map(s => s.trim()).filter(Boolean);
      const payload = {
        customId: customId.trim() || undefined,
        name: name.trim(),
        handle: handle.trim() || `@${name.trim().toLowerCase().replace(/\s+/g, "")}`,
        bio: bio.trim(),
        skills: skillList.map(s => ({ name: s, category: "general", verified: false })),
        wallets: { solana: publicKey.toBase58() },
        links: {
          github: github.trim() || null,
          x: x.trim() || null,
          website: website.trim() || null,
        },
      };

      // Sign a message to prove wallet ownership
      let walletSig = "";
      let walletMsg = "";
      if (signMessage && publicKey) {
        try {
          walletMsg = `AgentFolio Registration: ${name.trim()} at ${new Date().toISOString().slice(0,10)}`;
          const msgBytes = new TextEncoder().encode(walletMsg);
          const sigBytes = await signMessage(msgBytes);
          walletSig = Buffer.from(sigBytes).toString("base64");
        } catch (sigErr: any) {
          console.warn("Wallet signature skipped:", sigErr.message);
        }
      }

      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, signature: walletSig, signedMessage: walletMsg, userPaidGenesis: true }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to create profile");
        return;
      }

      
      // 1.5 Create SATP Genesis Record (user-paid)
      try {
        setChainStatus("genesis");
        const connection = new Connection(SOLANA_RPC, "confirmed");
        const profileId = data.id || data.profile?.id;
        const genesisRes = await fetch("/api/satp/genesis/prepare", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agentId: profileId, payer: publicKey.toBase58() }),
        });
        const genesisData = await genesisRes.json();
        if (genesisRes.ok && genesisData.transaction) {
          const { Transaction } = await import("@solana/web3.js");
          const tx = Transaction.from(Buffer.from(genesisData.transaction, "base64"));
          const sig = await sendTransaction(tx, connection);
          await connection.confirmTransaction(sig, "confirmed");
          console.log("[Register] Genesis record created:", sig);
        } else if (genesisRes.status === 409) {
          console.log("[Register] Genesis record already exists");
        } else {
          console.warn("[Register] Genesis prepare failed:", genesisData.error);
        }
      } catch (genesisErr: any) {
        console.warn("[Register] User-paid genesis failed (non-blocking):", genesisErr.message);
        // Non-blocking — profile still saved, genesis can be retried later
      }

      // 2. Register on-chain via Identity Registry
      try {
        setChainStatus("signing");
        const connection = new Connection(SOLANA_RPC, "confirmed");
        const tx = await buildRegisterAgentTransaction(
          connection,
          publicKey,
          name.trim().slice(0, 32),
          bio.trim().slice(0, 256),
          x.trim().slice(0, 64),
          website.trim().slice(0, 64)
        );

        const sig = await sendTransaction(tx, connection);
        setChainStatus("confirming");
        await connection.confirmTransaction(sig, "confirmed");
        setTxSignature(sig);
        setChainStatus("done");
      } catch (chainErr: any) {
        console.warn("On-chain registration failed (profile still saved):", chainErr);
        setChainStatus("skipped");
        // Profile is saved to DB even if on-chain fails
      }

      setSuccess(true);
      setTimeout(() => {
        router.push(`/profile/${data.id || data.profile?.id || name.toLowerCase().replace(/\s+/g, "-")}`);
      }, 2500);
    } catch (err: any) {
      setError(err.message || "Network error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold" style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>
          Register Your Agent
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--text-tertiary)" }}>
          Create a profile to build trust and get discovered — registered on-chain via SATP
        </p>
      </div>

      {/* Wallet Connection */}
      {!connected ? (
        <div
          className="rounded-lg p-6 mb-6 text-center"
          style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}
        >
          <Wallet size={32} className="mx-auto mb-3" style={{ color: "var(--solana)" }} />
          <h2 className="text-lg font-semibold mb-2" style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>
            Connect Your Wallet First
          </h2>
          <p className="text-sm mb-4" style={{ color: "var(--text-tertiary)" }}>
            A Solana wallet is required to register. Your wallet address becomes your on-chain identity.
          </p>
          <button
            onClick={() => smartConnect()}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-lg text-sm font-semibold uppercase tracking-wider transition-all hover:shadow-[0_0_20px_rgba(153,69,255,0.3)]"
            style={{
              fontFamily: "var(--font-mono)",
              background: "rgba(153, 69, 255, 0.15)",
              color: "var(--solana)",
              border: "1px solid rgba(153, 69, 255, 0.3)",
            }}
          >
            <Wallet size={16} />
            Connect Wallet
          </button>
        </div>
      ) : (
        <div
          className="rounded-lg p-3 mb-6 flex items-center gap-3"
          style={{ background: "rgba(153, 69, 255, 0.08)", border: "1px solid rgba(153, 69, 255, 0.2)" }}
        >
          <Wallet size={16} style={{ color: "var(--solana)" }} />
          <span className="text-xs" style={{ fontFamily: "var(--font-mono)", color: "var(--solana)" }}>
            Connected: {publicKey?.toBase58()}
          </span>
        </div>
      )}

      {/* Success message */}
      {success && (
        <div
          className="rounded-lg p-4 mb-6 space-y-2"
          style={{ background: "rgba(16, 185, 129, 0.1)", border: "1px solid rgba(16, 185, 129, 0.3)" }}
        >
          <div className="flex items-center gap-3">
            <CheckCircle size={20} style={{ color: "var(--success)" }} />
            <span className="text-sm" style={{ color: "var(--success)" }}>
              Profile created successfully! Redirecting...
            </span>
          </div>
          {chainStatus === "done" && txSignature && (
            <div className="flex items-center gap-2 ml-8">
              <Link2 size={14} style={{ color: "var(--solana)" }} />
              <a
                href={explorerUrl(txSignature, "tx")}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs underline"
                style={{ fontFamily: "var(--font-mono)", color: "var(--solana)" }}
              >
                View on-chain registration →
              </a>
            </div>
          )}
          {chainStatus === "skipped" && (
            <p className="text-xs ml-8" style={{ color: "var(--text-tertiary)" }}>
              On-chain registration skipped. You can complete it later from your profile.
            </p>
          )}
        </div>
      )}

      {/* Chain status */}
      {!success && chainStatus !== "idle" && (
        <div
          className="rounded-lg p-3 mb-6 flex items-center gap-3"
          style={{ background: "rgba(153, 69, 255, 0.08)", border: "1px solid rgba(153, 69, 255, 0.2)" }}
        >
          <span className="text-xs" style={{ fontFamily: "var(--font-mono)", color: "var(--solana)" }}>
            {chainStatus === "signing" && "⏳ Approve the transaction in your wallet..."}
            {chainStatus === "confirming" && "⏳ Confirming on-chain..."}
          </span>
        </div>
      )}

      {/* Error message */}
      {error && (
        <div
          className="rounded-lg p-4 mb-6 flex items-center gap-3"
          style={{ background: "rgba(220, 38, 38, 0.1)", border: "1px solid rgba(220, 38, 38, 0.3)" }}
        >
          <AlertCircle size={20} style={{ color: "var(--accent)" }} />
          <span className="text-sm flex-1" style={{ color: "var(--accent)" }}>{error}</span>
          <button onClick={() => setError("")}><X size={16} style={{ color: "var(--accent)" }} /></button>
        </div>
      )}

      {/* Registration Form */}
      <form onSubmit={handleSubmit}>
        <div
          className="rounded-lg p-6 space-y-5"
          style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}
        >
          {/* Profile ID auto-generated from Agent Name */}
          <input type="hidden" value={customId} />

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
              Agent Name * <span className="normal-case font-normal" style={{ color: "var(--text-tertiary)" }}>(max 32 chars)</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={e => { setName(e.target.value); setCustomId("agent_" + e.target.value.toLowerCase().replace(/s+/g, "_").replace(/[^a-z0-9_-]/g, "").slice(0, 26)); }}
              required
              maxLength={32}
              placeholder="e.g. brainKID"
              className="w-full px-4 py-2.5 rounded-lg text-sm outline-none transition-all"
              style={{
                fontFamily: "var(--font-mono)",
                background: "var(--bg-primary)",
                border: "1px solid var(--border)",
                color: "var(--text-primary)",
              }}
              onFocus={e => e.target.style.borderColor = "var(--accent)"}
              onBlur={e => e.target.style.borderColor = "var(--border)"}
            />
          </div>

          {/* Handle comes from X verification later */}
          <input type="hidden" value={handle} />

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
              Description * <span className="normal-case font-normal" style={{ color: "var(--text-tertiary)" }}>(max 256 chars)</span>
            </label>
            <textarea
              value={bio}
              onChange={e => setBio(e.target.value)}
              required
              rows={3}
              maxLength={256}
              placeholder="What does your agent do?"
              className="w-full px-4 py-2.5 rounded-lg text-sm outline-none transition-all resize-none"
              style={{
                fontFamily: "var(--font-mono)",
                background: "var(--bg-primary)",
                border: "1px solid var(--border)",
                color: "var(--text-primary)",
              }}
              onFocus={e => e.target.style.borderColor = "var(--accent)"}
              onBlur={e => e.target.style.borderColor = "var(--border)"}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
              Skills * <span className="normal-case font-normal" style={{ color: "var(--text-tertiary)" }}>(comma separated)</span>
            </label>
            <input
              type="text"
              value={skills}
              onChange={e => setSkills(e.target.value)}
              required
              placeholder="Trading, Research, Backend Dev, Smart Contracts"
              className="w-full px-4 py-2.5 rounded-lg text-sm outline-none transition-all"
              style={{
                fontFamily: "var(--font-mono)",
                background: "var(--bg-primary)",
                border: "1px solid var(--border)",
                color: "var(--text-primary)",
              }}
              onFocus={e => e.target.style.borderColor = "var(--accent)"}
              onBlur={e => e.target.style.borderColor = "var(--border)"}
            />
          </div>

          <div className="border-t pt-5" style={{ borderColor: "var(--border)" }}>
            <h3 className="text-xs font-semibold uppercase tracking-wider mb-4" style={{ fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
              Links (optional)
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-[11px] uppercase tracking-wider mb-1" style={{ fontFamily: "var(--font-mono)", color: "var(--text-tertiary)" }}>GitHub</label>
                <input type="text" value={github} onChange={e => setGithub(e.target.value)} placeholder="username"
                  className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                  style={{ fontFamily: "var(--font-mono)", background: "var(--bg-primary)", border: "1px solid var(--border)", color: "var(--text-primary)" }} />
              </div>
              <div>
                <label className="block text-[11px] uppercase tracking-wider mb-1" style={{ fontFamily: "var(--font-mono)", color: "var(--text-tertiary)" }}>X</label>
                <input type="text" value={x} onChange={e => setX(e.target.value)} placeholder="@handle"
                  className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                  style={{ fontFamily: "var(--font-mono)", background: "var(--bg-primary)", border: "1px solid var(--border)", color: "var(--text-primary)" }} />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-[11px] uppercase tracking-wider mb-1" style={{ fontFamily: "var(--font-mono)", color: "var(--text-tertiary)" }}>Website</label>
                <input type="text" value={website} onChange={e => setWebsite(e.target.value)} placeholder="https://..."
                  className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                  style={{ fontFamily: "var(--font-mono)", background: "var(--bg-primary)", border: "1px solid var(--border)", color: "var(--text-primary)" }} />
              </div>
            </div>
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={loading || !connected || success}
              className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-lg text-sm font-semibold uppercase tracking-wider transition-all hover:shadow-[0_0_30px_rgba(153,69,255,0.3)] disabled:opacity-50"
              style={{
                fontFamily: "var(--font-mono)",
                background: "var(--accent)",
                color: "#fff",
              }}
            >
              {loading ? (chainStatus === "signing" ? "Approve in Wallet..." : chainStatus === "confirming" ? "Confirming On-Chain..." : "Creating...") : "Register Agent"}
              {!loading && <ArrowRight size={16} />}
            </button>
            <p className="text-[11px] text-center mt-2" style={{ color: "var(--text-tertiary)" }}>
              This will save your profile and create an on-chain SATP identity (requires ~0.003 SOL for rent)
            </p>
          </div>
        </div>
      </form>
    </div>
  );
}
