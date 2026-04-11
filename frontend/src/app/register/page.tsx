"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useSmartConnect } from "@/components/WalletProvider";
import { Connection } from "@solana/web3.js";
import { useDemoMode } from "@/lib/demo-mode";
import { Wallet, ArrowRight, AlertCircle, CheckCircle, X, Link2, Zap } from "lucide-react";
import { ClaimSearch } from "./ClaimSearch";
import { SOLANA_RPC, explorerUrl } from "@/lib/identity-registry";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "";

export default function RegisterPage() {
  const wallet = useWallet();
  const { smartConnect } = useSmartConnect();
  const { isDemo, demoPublicKey } = useDemoMode();
  const connected = isDemo ? true : wallet.connected;
  const publicKey = isDemo ? demoPublicKey : wallet.publicKey;
  const sendTransaction = wallet.sendTransaction;

  const [customId, setCustomId] = useState("");
  const [name, setName] = useState("");
  const [tagline, setTagline] = useState("");
  const [skills, setSkills] = useState("");
  const [github, setGithub] = useState("");
  const [website, setWebsite] = useState("");
  const [loading, setLoading] = useState(false);
  const [chainStatus, setChainStatus] = useState<"idle" | "preparing" | "signing" | "confirming" | "done">("idle");
  const [txSignature, setTxSignature] = useState("");
  const [error, setError] = useState("");
  const [idAvailable, setIdAvailable] = useState<boolean | null>(null);
  const [success, setSuccess] = useState(false);
  const [createdProfileId, setCreatedProfileId] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");

  const handleAtomicSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setTxSignature("");

    if (!connected || !publicKey) {
      await smartConnect();
      return;
    }

    if (!sendTransaction) {
      setError("Connected wallet cannot sign transactions");
      return;
    }

    if (isDemo) {
      setError("Demo mode cannot complete production registration. Use a real Solana wallet.");
      return;
    }

    setLoading(true);
    setChainStatus("preparing");

    try {
      const walletAddress = publicKey.toBase58();
      const skillList = skills.split(",").map((s) => s.trim()).filter(Boolean);
      const payload = {
        customId: customId.trim() || undefined,
        name: name.trim(),
        tagline: tagline.trim(),
        skills: skillList.join(","),
        github: github.trim() || undefined,
        website: website.trim() || undefined,
        walletAddress,
      };

      const prepareRes = await fetch("/api/register/atomic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const prepareData = await prepareRes.json().catch(() => null);
      if (!prepareRes.ok || !prepareData?.data?.transaction) {
        throw new Error(prepareData?.error || "Failed to prepare SATP registration");
      }

      const { Transaction } = await import("@solana/web3.js");
      const tx = Transaction.from(Buffer.from(prepareData.data.transaction, "base64"));
      const connection = new Connection(SOLANA_RPC, "confirmed");

      setChainStatus("signing");
      const sig = await sendTransaction(tx, connection);
      setTxSignature(sig);

      setChainStatus("confirming");
      const confirmRes = await fetch("/api/register/atomic/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...payload,
          txSignature: sig,
        }),
      });
      const confirmData = await confirmRes.json().catch(() => null);
      if (!confirmRes.ok) {
        throw new Error(confirmData?.error || "Failed to finalize atomic registration");
      }

      setApiKey(confirmData?.api_key || "");
      setCreatedProfileId(confirmData?.id || prepareData.data.profileId || null);
      setSuccess(true);
      setChainStatus("done");
    } catch (err: any) {
      console.error("[Register] Atomic registration failed:", err);
      setError(err?.message || "Registration failed before profile creation completed");
      setChainStatus("idle");
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
          One wallet signature, one registration flow. Your SATP genesis is created first, then the profile goes live.
        </p>
      </div>

      {connected && publicKey ? (
        <div
          className="rounded-lg p-3 mb-6 flex items-center gap-3"
          style={{ background: "rgba(153, 69, 255, 0.08)", border: "1px solid rgba(153, 69, 255, 0.2)" }}
        >
          <Wallet size={16} style={{ color: "var(--solana)" }} />
          <span className="text-xs" style={{ fontFamily: "var(--font-mono)", color: "var(--solana)" }}>
            Wallet connected: {publicKey.toBase58().slice(0, 4)}...{publicKey.toBase58().slice(-4)}. Registration will create your SATP identity and profile atomically.
          </span>
        </div>
      ) : (
        <div
          className="rounded-lg p-3 mb-6 flex items-center justify-between gap-3"
          style={{ background: "rgba(153, 69, 255, 0.05)", border: "1px solid rgba(153, 69, 255, 0.15)" }}
        >
          <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>
            <Zap size={12} className="inline mr-1" />
            Wallet required. No DB profile is created unless the SATP transaction confirms.
          </span>
          <button
            type="button"
            onClick={() => smartConnect()}
            className="text-xs px-3 py-1 rounded shrink-0"
            style={{ fontFamily: "var(--font-mono)", color: "var(--solana)", border: "1px solid rgba(153, 69, 255, 0.3)" }}
          >
            Connect
          </button>
        </div>
      )}

      {success && (
        <div
          className="rounded-lg p-6 mb-6 space-y-4"
          style={{ background: "rgba(16, 185, 129, 0.08)", border: "1px solid rgba(16, 185, 129, 0.3)" }}
        >
          <div className="flex items-center gap-3">
            <CheckCircle size={24} style={{ color: "var(--success)" }} />
            <span className="text-lg font-semibold" style={{ color: "var(--success)" }}>
              Agent Registered!
            </span>
          </div>

          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            Your SATP genesis and AgentFolio profile were created together. You are live at Registered level from the first transaction.
          </p>

          <div className="space-y-3 ml-2">
            <a
              href={`/profile/${createdProfileId}`}
              className="flex items-center gap-3 p-3 rounded-lg transition-colors hover:opacity-80"
              style={{ background: "var(--bg-primary)", border: "1px solid var(--border)" }}
            >
              <span className="flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold" style={{ background: "var(--solana, #9945FF)", color: "white" }}>1</span>
              <div>
                <div className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>View your live profile</div>
                <div className="text-xs" style={{ color: "var(--text-tertiary)" }}>Open the profile that was just anchored to your SATP identity</div>
              </div>
            </a>

            <a
              href={`/verify?profile=${createdProfileId}`}
              className="flex items-center gap-3 p-3 rounded-lg transition-colors hover:opacity-80"
              style={{ background: "var(--bg-primary)", border: "1px solid var(--border)" }}
            >
              <span className="flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold" style={{ background: "var(--accent)", color: "var(--bg-primary)" }}>2</span>
              <div>
                <div className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>Add more verifications</div>
                <div className="text-xs" style={{ color: "var(--text-tertiary)" }}>SATP is already done. Connect more credentials to climb beyond Registered.</div>
              </div>
            </a>

            <button
              onClick={() => { navigator.clipboard.writeText(`${SITE_URL}/profile/${createdProfileId}`); }}
              className="flex items-center gap-3 p-3 rounded-lg transition-colors hover:opacity-80 w-full text-left"
              style={{ background: "var(--bg-primary)", border: "1px solid var(--border)" }}
            >
              <span className="flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold" style={{ background: "var(--text-tertiary)", color: "var(--bg-primary)" }}>3</span>
              <div>
                <div className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>Share your profile</div>
                <div className="text-xs" style={{ color: "var(--text-tertiary)" }}>Click to copy your profile link</div>
              </div>
            </button>
          </div>

          {apiKey && (
            <div className="ml-8">
              <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>
                Your API key (save it):
              </p>
              <code className="text-xs px-2 py-1 rounded block mt-1 break-all" style={{ background: "var(--bg-primary)", color: "var(--accent)", fontFamily: "var(--font-mono)" }}>
                {apiKey}
              </code>
            </div>
          )}

          {txSignature && (
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
        </div>
      )}

      {!success && chainStatus !== "idle" && (
        <div
          className="rounded-lg p-3 mb-6 flex items-center gap-3"
          style={{ background: "rgba(153, 69, 255, 0.08)", border: "1px solid rgba(153, 69, 255, 0.2)" }}
        >
          <span className="text-xs" style={{ fontFamily: "var(--font-mono)", color: "var(--solana)" }}>
            {chainStatus === "preparing" && "⏳ Preparing SATP registration..."}
            {chainStatus === "signing" && "⏳ Approve the transaction in your wallet..."}
            {chainStatus === "confirming" && "⏳ Waiting for on-chain confirmation before creating your profile..."}
            {chainStatus === "done" && "✅ Registration complete."}
          </span>
        </div>
      )}

      {error && (
        <div
          className="rounded-lg p-4 mb-6 flex items-center gap-3"
          style={{ background: "rgba(239, 68, 68, 0.08)", border: "1px solid rgba(239, 68, 68, 0.3)" }}
        >
          <AlertCircle size={20} style={{ color: "#ef4444" }} />
          <span className="text-sm flex-1" style={{ color: "#ef4444" }}>{error}</span>
          <button type="button" onClick={() => setError("")}><X size={16} style={{ color: "#ef4444" }} /></button>
        </div>
      )}

      <form onSubmit={handleAtomicSubmit}>
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
                if (newId.length >= 9) {
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
                <input
                  type="text"
                  value={github}
                  onChange={e => setGithub(e.target.value)}
                  placeholder="username or URL"
                  className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                  style={{ fontFamily: "var(--font-mono)", background: "var(--bg-primary)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
                />
              </div>
              <div>
                <label className="block text-[11px] uppercase tracking-wider mb-1" style={{ fontFamily: "var(--font-mono)", color: "var(--text-tertiary)" }}>Website</label>
                <input
                  type="text"
                  value={website}
                  onChange={e => setWebsite(e.target.value)}
                  placeholder="https://..."
                  className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                  style={{ fontFamily: "var(--font-mono)", background: "var(--bg-primary)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
                />
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
              {loading
                ? chainStatus === "preparing"
                  ? "Preparing..."
                  : chainStatus === "signing"
                    ? "Approve in Wallet..."
                    : "Confirming..."
                : connected
                  ? "Register Agent"
                  : "Connect Wallet to Register"}
              {!loading && <ArrowRight size={16} />}
            </button>
            <p className="text-[11px] text-center mt-2" style={{ color: "var(--text-tertiary)" }}>
              The profile is only created after the SATP transaction confirms.
            </p>
          </div>
        </div>
      </form>

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
