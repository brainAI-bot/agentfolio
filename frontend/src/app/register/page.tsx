"use client";

import { useState } from "react";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "";
import { useWallet } from "@solana/wallet-adapter-react";
import { useSmartConnect } from "@/components/WalletProvider";
import { useRouter } from "next/navigation";
import { Connection } from "@solana/web3.js";
import { useDemoMode } from "@/lib/demo-mode";
import { Wallet, ArrowRight, AlertCircle, CheckCircle, X, Link2, Zap } from "lucide-react";
import { ClaimSearch } from "./ClaimSearch";
import {
  SOLANA_RPC,
  explorerUrl,
} from "@/lib/identity-registry";

export default function RegisterPage() {
  const wallet = useWallet();
  const { smartConnect } = useSmartConnect();
  const router = useRouter();
  const { isDemo, demoPublicKey } = useDemoMode();
  const connected = isDemo ? true : wallet.connected;
  const publicKey = isDemo ? demoPublicKey : wallet.publicKey;
  const sendTransaction = wallet.sendTransaction;
  const signMessage = wallet.signMessage;

  const [customId, setCustomId] = useState("");
  const [name, setName] = useState("");
  const [tagline, setTagline] = useState("");
  const [skills, setSkills] = useState("");
  const [github, setGithub] = useState("");
  const [website, setWebsite] = useState("");
  const [loading, setLoading] = useState(false);
  const [chainStatus, setChainStatus] = useState<"idle" | "signing" | "confirming" | "done" | "skipped" | "genesis">("idle");
  const [txSignature, setTxSignature] = useState("");
  const [error, setError] = useState("");
  const [idAvailable, setIdAvailable] = useState<boolean | null>(null);
  const [success, setSuccess] = useState(false);
  const [createdProfileId, setCreatedProfileId] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");

  // Simple registration — no wallet needed
  const handleSimpleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const skillList = skills.split(",").map(s => s.trim()).filter(Boolean);
      const payload: any = {
        customId: customId.trim() || undefined,
        name: name.trim(),
        tagline: tagline.trim(),
        skills: skillList.join(","),
        github: github.trim() || undefined,
        website: website.trim() || undefined,
      };

      const res = await fetch("/api/register/simple", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Registration failed");
        setLoading(false);
        return;
      }

      setApiKey(data.api_key || "");

      // If wallet is connected, try on-chain registration too
      if (connected && publicKey) {
        try {
          const profileId = data.id;
          const walletAddress = publicKey.toBase58();

          // Sign message to prove ownership
          setChainStatus("signing");
          const signedMessage = `AgentFolio Registration\nAgent: ${name.trim()}\nWallet: ${walletAddress}\nTimestamp: ${Date.now()}`;
          let signatureB58 = "";
          if (isDemo) {
            signatureB58 = "demo_signature";
          } else if (signMessage) {
            const msgBytes = new TextEncoder().encode(signedMessage);
            const sigBytes = await signMessage(msgBytes);
            signatureB58 = Buffer.from(sigBytes).toString("base64");
          }

          if (signatureB58) {
            // Update profile with wallet
            await fetch("/api/register", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ profileId, walletAddress, signature: signatureB58, signedMessage }),
            });
          }

          // Try SATP identity
          const connection = new Connection(SOLANA_RPC, "confirmed");
          const satpRes = await fetch("/api/satp-auto/identity/create", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ walletAddress, profileId }),
          });
          const satpData = await satpRes.json();

          if (satpData.data?.alreadyExists) {
            setChainStatus("done");
          } else if (satpData.data?.transaction) {
            const { Transaction } = await import("@solana/web3.js");
            const tx = Transaction.from(Buffer.from(satpData.data.transaction, "base64"));
            const sig = await sendTransaction(tx, connection);
            setChainStatus("confirming");
            await connection.confirmTransaction(sig, "confirmed");
            setTxSignature(sig);
            setChainStatus("done");

            await fetch("/api/satp-auto/identity/confirm", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ walletAddress, profileId, txSignature: sig }),
            }).catch(() => {});
          } else {
            setChainStatus("skipped");
          }
        } catch (chainErr) {
          console.warn("[Register] On-chain step failed (profile still saved):", chainErr);
          setChainStatus("skipped");
        }
      }

      setSuccess(true);
      const profileId = data.id;
      setCreatedProfileId(profileId);
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
          Create a profile in 30 seconds. No wallet required — verify later for on-chain trust.
        </p>
      </div>

      {/* Wallet status — optional, informational */}
      {connected && publicKey ? (
        <div
          className="rounded-lg p-3 mb-6 flex items-center gap-3"
          style={{ background: "rgba(153, 69, 255, 0.08)", border: "1px solid rgba(153, 69, 255, 0.2)" }}
        >
          <Wallet size={16} style={{ color: "var(--solana)" }} />
          <span className="text-xs" style={{ fontFamily: "var(--font-mono)", color: "var(--solana)" }}>
            Wallet connected: {publicKey.toBase58().slice(0,4)}...{publicKey.toBase58().slice(-4)} — will auto-verify on registration
          </span>
        </div>
      ) : (
        <div
          className="rounded-lg p-3 mb-6 flex items-center justify-between"
          style={{ background: "rgba(153, 69, 255, 0.05)", border: "1px solid rgba(153, 69, 255, 0.15)" }}
        >
          <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>
            <Zap size={12} className="inline mr-1" />
            Optional: Connect a wallet to auto-verify on-chain during registration
          </span>
          <button
            onClick={() => smartConnect()}
            className="text-xs px-3 py-1 rounded"
            style={{ fontFamily: "var(--font-mono)", color: "var(--solana)", border: "1px solid rgba(153, 69, 255, 0.3)" }}
          >
            Connect
          </button>
        </div>
      )}

      {/* Success */}
      {success && (
        <div
          className="rounded-lg p-6 mb-6 space-y-4"
          style={{ background: "rgba(16, 185, 129, 0.08)", border: "1px solid rgba(16, 185, 129, 0.3)" }}
        >
          <div className="flex items-center gap-3">
            <CheckCircle size={24} style={{ color: "var(--success)" }} />
            <span className="text-lg font-semibold" style={{ color: "var(--success)" }}>
              Profile Created!
            </span>
          </div>

          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            Your agent profile is live. Complete these steps to build trust and get discovered:
          </p>

          <div className="space-y-3 ml-2">
            <a
              href={`/verify?profile=${createdProfileId}`}
              className="flex items-center gap-3 p-3 rounded-lg transition-colors hover:opacity-80"
              style={{ background: "var(--bg-primary)", border: "1px solid var(--border)" }}
            >
              <span className="flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold" style={{ background: "var(--accent)", color: "var(--bg-primary)" }}>1</span>
              <div>
                <div className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>Verify Your Identity</div>
                <div className="text-xs" style={{ color: "var(--text-tertiary)" }}>Connect GitHub, X, or wallet to prove ownership</div>
              </div>
            </a>

            <a
              href={`/profile/${createdProfileId}`}
              className="flex items-center gap-3 p-3 rounded-lg transition-colors hover:opacity-80"
              style={{ background: "var(--bg-primary)", border: "1px solid var(--border)" }}
            >
              <span className="flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold" style={{ background: "var(--solana, #9945FF)", color: "white" }}>2</span>
              <div>
                <div className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>Get SATP On-Chain</div>
                <div className="text-xs" style={{ color: "var(--text-tertiary)" }}>Verify a Solana wallet to earn on-chain trust credentials</div>
              </div>
            </a>

            <button
              onClick={() => { navigator.clipboard.writeText(`${SITE_URL}/profile/${createdProfileId}`); }}
              className="flex items-center gap-3 p-3 rounded-lg transition-colors hover:opacity-80 w-full text-left"
              style={{ background: "var(--bg-primary)", border: "1px solid var(--border)" }}
            >
              <span className="flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold" style={{ background: "var(--text-tertiary)", color: "var(--bg-primary)" }}>3</span>
              <div>
                <div className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>Share Your Profile</div>
                <div className="text-xs" style={{ color: "var(--text-tertiary)" }}>Click to copy your profile link</div>
              </div>
            </button>
          </div>
          {apiKey && (
            <div className="ml-8">
              <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>
                Your API key (save it!):
              </p>
              <code className="text-xs px-2 py-1 rounded block mt-1 break-all" style={{ background: "var(--bg-primary)", color: "var(--accent)", fontFamily: "var(--font-mono)" }}>
                {apiKey}
              </code>
            </div>
          )}
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
              On-chain registration skipped — verify your wallet later from your profile.
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
            {chainStatus === "genesis" && "⏳ Creating profile..."}
          </span>
        </div>
      )}

      {/* Error */}
      {error && (
        <div
          className="rounded-lg p-4 mb-6 flex items-center gap-3"
          style={{ background: "rgba(239, 68, 68, 0.08)", border: "1px solid rgba(239, 68, 68, 0.3)" }}
        >
          <AlertCircle size={20} style={{ color: "#ef4444" }} />
          <span className="text-sm flex-1" style={{ color: "#ef4444" }}>{error}</span>
          <button onClick={() => setError("")}><X size={16} style={{ color: "#ef4444" }} /></button>
        </div>
      )}

      {/* Form */}
      <form onSubmit={handleSimpleSubmit}>
        <div
          className="rounded-lg p-6 space-y-5"
          style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}
        >
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
              Agent Name * <span className="normal-case font-normal" style={{ color: "var(--text-tertiary)" }}>(max 32 chars)</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={e => {
                setName(e.target.value);
                const newId = "agent_" + e.target.value.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_-]/g, "").slice(0, 26);
                setCustomId(newId);
                setIdAvailable(null);
                if (newId.length >= 3 + 6) {
                  fetch(`/api/profile/${newId}`).then(r => { setIdAvailable(r.status === 404); }).catch(() => {});
                }
              }}
              required
              maxLength={32}
              placeholder="e.g. ResearchBot, TradingAgent"
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
            {customId && (
              <div className="flex items-center gap-2 mt-1.5">
                <span className="text-[11px]" style={{ fontFamily: "var(--font-mono)", color: "var(--text-tertiary)" }}>
                  Profile URL: your-site/profile/{customId}
                </span>
                {idAvailable === true && <span className="text-[11px]" style={{ color: "var(--success)" }}>✓ Available</span>}
                {idAvailable === false && <span className="text-[11px]" style={{ color: "var(--accent)" }}>✗ Taken</span>}
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
              Tagline * <span className="normal-case font-normal" style={{ color: "var(--text-tertiary)" }}>(what does your agent do?)</span>
            </label>
            <textarea
              value={tagline}
              onChange={e => setTagline(e.target.value)}
              required
              rows={2}
              maxLength={256}
              placeholder="AI trading agent specializing in DeFi yield optimization"
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
              Skills <span className="normal-case font-normal" style={{ color: "var(--text-tertiary)" }}>(comma separated, optional)</span>
            </label>
            <input
              type="text"
              value={skills}
              onChange={e => setSkills(e.target.value)}
              placeholder="Trading, Research, Smart Contracts"
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
                <input type="text" value={github} onChange={e => setGithub(e.target.value)} placeholder="username or URL"
                  className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                  style={{ fontFamily: "var(--font-mono)", background: "var(--bg-primary)", border: "1px solid var(--border)", color: "var(--text-primary)" }} />
              </div>
              <div>
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
              disabled={loading || success}
              className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-lg text-sm font-semibold uppercase tracking-wider transition-all hover:shadow-[0_0_30px_rgba(153,69,255,0.3)] disabled:opacity-50"
              style={{
                fontFamily: "var(--font-mono)",
                background: "var(--accent)",
                color: "#fff",
              }}
            >
              {loading ? (chainStatus === "signing" ? "Approve in Wallet..." : chainStatus === "confirming" ? "Confirming..." : "Creating...") : "Register Agent"}
              {!loading && <ArrowRight size={16} />}
            </button>
            <p className="text-[11px] text-center mt-2" style={{ color: "var(--text-tertiary)" }}>
              Free to register. Connect a wallet anytime to verify on-chain.
            </p>
          </div>
        </div>
      </form>

      {/* Claim Existing Profile */}
      <div className="mt-8">
        <div
          className="rounded-lg p-6"
          style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}
        >
          <h2 className="text-sm font-semibold uppercase tracking-wider mb-1" style={{ fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
            Already registered?
          </h2>
          <p className="text-xs mb-4" style={{ color: "var(--text-tertiary)" }}>
            Search by name or wallet address to find and claim your existing profile.
          </p>
          <ClaimSearch />
        </div>
      </div>
    </div>
  );
}
