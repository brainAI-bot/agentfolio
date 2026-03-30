"use client";

import { useState, useEffect, useCallback } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useSmartConnect } from "@/components/WalletProvider";
import { useDemoMode } from "@/lib/demo-mode";
import { X, Shield, Github, Globe, MessageSquare, Wallet, ArrowRight, CheckCircle, AlertCircle, Loader2 } from "lucide-react";

interface ClaimMethod {
  method: string;
  identifier: string;
}

interface ClaimModalProps {
  profileId: string;
  profileName: string;
  isOpen: boolean;
  onClose: () => void;
  onClaimed?: () => void;
}

export function ClaimModal({ profileId, profileName, isOpen, onClose, onClaimed }: ClaimModalProps) {
  const wallet = useWallet();
  const { smartConnect } = useSmartConnect();
  const { isDemo, demoPublicKey } = useDemoMode();
  const connected = isDemo ? true : wallet.connected;
  const publicKey = isDemo ? demoPublicKey : wallet.publicKey;

  const [step, setStep] = useState<"methods" | "challenge" | "signing" | "success" | "error">("methods");
  const [methods, setMethods] = useState<ClaimMethod[]>([]);
  const [selectedMethod, setSelectedMethod] = useState<string | null>(null);
  const [challengeId, setChallengeId] = useState("");
  const [instructions, setInstructions] = useState("");
  const [challengeString, setChallengeString] = useState("");
  const [proof, setProof] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Fetch available claim methods
  useEffect(() => {
    if (!isOpen) return;
    setStep("methods");
    setError("");
    setMethods([]);
    fetch(`/api/claims/eligible?profileId=${encodeURIComponent(profileId)}`)
      .then(r => r.json())
      .then(data => {
        if (data.eligible && data.methods) {
          setMethods(data.methods);
        } else {
          setError(data.reason || "This profile cannot be claimed");
          setStep("error");
        }
      })
      .catch(() => {
        setError("Failed to check eligibility");
        setStep("error");
      });
  }, [isOpen, profileId]);

  const methodIcons: Record<string, typeof Github> = {
    x: MessageSquare,
    github: Github,
    domain: Globe,
    wallet: Wallet,
  };

  const methodLabels: Record<string, string> = {
    x: "Verify via X (Twitter)",
    github: "Verify via GitHub",
    domain: "Verify via Domain",
    wallet: "Sign with Wallet",
  };

  const methodDescriptions: Record<string, string> = {
    x: "Tweet a verification code",
    github: "Create a public gist",
    domain: "Add DNS TXT or .well-known file",
    wallet: "Sign a message to prove ownership",
  };

  async function handleInitiate(method: string) {
    if (!connected || !publicKey) {
      smartConnect();
      return;
    }

    setLoading(true);
    setError("");
    setSelectedMethod(method);

    try {
      const res = await fetch("/api/claims/initiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profileId,
          method,
          wallet: publicKey.toBase58(),
        }),
      });
      const data = await res.json();

      if (data.success) {
        setChallengeId(data.challengeId);
        setInstructions(data.instructions);
        setChallengeString(data.challengeString);

        // Wallet method: auto-sign
        if (method === "wallet") {
          setStep("signing");
          await handleWalletSign(data.challengeId, data.challengeString);
        } else {
          setStep("challenge");
        }
      } else {
        setError(data.error || "Failed to initiate claim");
      }
    } catch (e: any) {
      setError(e.message || "Network error");
    } finally {
      setLoading(false);
    }
  }

  async function handleWalletSign(cId: string, msg: string) {
    if (!wallet.signMessage) {
      setError("Wallet does not support message signing. Try a different method.");
      setStep("methods");
      return;
    }

    setLoading(true);
    try {
      const encoded = new TextEncoder().encode(msg);
      const signature = await wallet.signMessage(encoded);
      const sigBase64 = Buffer.from(signature).toString("base64");

      // Submit signature as proof
      const res = await fetch("/api/claims/self-verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId: cId, proof: sigBase64 }),
      });
      const data = await res.json();

      if (data.success) {
        setStep("success");
        onClaimed?.();
      } else {
        setError(data.error || "Wallet verification failed");
        setStep("methods");
      }
    } catch (e: any) {
      if (e.message?.includes("User rejected")) {
        setError("Signature rejected. Try again or use a different method.");
      } else {
        setError(e.message || "Signing failed");
      }
      setStep("methods");
    } finally {
      setLoading(false);
    }
  }

  async function handleVerify() {
    if (!proof.trim()) {
      setError("Please provide proof (URL or content)");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/claims/self-verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId, proof: proof.trim() }),
      });
      const data = await res.json();

      if (data.success) {
        setStep("success");
        onClaimed?.();
      } else {
        setError(data.error || "Verification failed");
      }
    } catch (e: any) {
      setError(e.message || "Network error");
    } finally {
      setLoading(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.7)" }}>
      <div
        className="relative w-full max-w-md rounded-xl p-6"
        style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1 rounded-lg hover:bg-white/10"
          style={{ color: "var(--text-tertiary)" }}
        >
          <X size={18} />
        </button>

        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <Shield size={24} style={{ color: "var(--solana)" }} />
          <div>
            <h2 className="text-lg font-bold" style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>
              Claim {profileName}
            </h2>
            <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>
              Prove you own this identity to take control
            </p>
          </div>
        </div>

        {/* Error display */}
        {error && (
          <div
            className="rounded-lg p-3 mb-4 flex items-center gap-2"
            style={{ background: "rgba(220, 38, 38, 0.1)", border: "1px solid rgba(220, 38, 38, 0.3)" }}
          >
            <AlertCircle size={16} style={{ color: "#ef4444" }} />
            <span className="text-xs flex-1" style={{ color: "#ef4444" }}>{error}</span>
            <button onClick={() => setError("")}><X size={14} style={{ color: "#ef4444" }} /></button>
          </div>
        )}

        {/* Step: Connect wallet */}
        {!connected && (
          <div className="text-center py-6">
            <Wallet size={48} className="mx-auto mb-4 opacity-50" style={{ color: "var(--solana)" }} />
            <p className="text-sm mb-4" style={{ color: "var(--text-secondary)" }}>
              Connect your Solana wallet to start claiming.
            </p>
            <button
              onClick={() => smartConnect()}
              className="px-6 py-3 rounded-lg text-sm font-semibold transition-all hover:shadow-lg"
              style={{
                fontFamily: "var(--font-mono)",
                background: "linear-gradient(135deg, #9945FF, #14F195)",
                color: "#fff",
              }}
            >
              Connect Wallet
            </button>
          </div>
        )}

        {/* Step: Choose method */}
        {connected && step === "methods" && (
          <div className="space-y-3">
            <p className="text-xs mb-3" style={{ color: "var(--text-secondary)" }}>
              Choose how to prove you own this profile:
            </p>
            {methods.map((m) => {
              const Icon = methodIcons[m.method] || Shield;
              return (
                <button
                  key={m.method}
                  onClick={() => handleInitiate(m.method)}
                  disabled={loading}
                  className="w-full flex items-center gap-3 p-4 rounded-lg transition-all hover:shadow-md"
                  style={{
                    background: "var(--bg-primary)",
                    border: "1px solid var(--border)",
                    textAlign: "left",
                    cursor: loading ? "wait" : "pointer",
                    opacity: loading && selectedMethod !== m.method ? 0.5 : 1,
                  }}
                >
                  <Icon size={20} style={{ color: m.method === "wallet" ? "#14F195" : "var(--solana)" }} />
                  <div className="flex-1">
                    <div className="text-sm font-semibold" style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>
                      {methodLabels[m.method] || m.method}
                    </div>
                    <div className="text-xs" style={{ color: "var(--text-tertiary)" }}>
                      {m.method === "wallet" ? methodDescriptions[m.method] : `@${m.identifier}`}
                    </div>
                  </div>
                  {loading && selectedMethod === m.method ? (
                    <Loader2 size={16} className="animate-spin" style={{ color: "var(--solana)" }} />
                  ) : (
                    <ArrowRight size={16} style={{ color: "var(--text-tertiary)" }} />
                  )}
                </button>
              );
            })}
            {methods.length === 0 && !error && (
              <div className="flex items-center justify-center py-6">
                <Loader2 size={20} className="animate-spin" style={{ color: "var(--solana)" }} />
                <span className="ml-2 text-xs" style={{ color: "var(--text-tertiary)" }}>Loading methods...</span>
              </div>
            )}
          </div>
        )}

        {/* Step: Wallet signing in progress */}
        {connected && step === "signing" && (
          <div className="text-center py-8">
            <Loader2 size={48} className="mx-auto mb-4 animate-spin" style={{ color: "var(--solana)" }} />
            <p className="text-sm font-semibold mb-2" style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>
              Sign the message in your wallet
            </p>
            <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>
              Approve the signature request to prove wallet ownership
            </p>
          </div>
        )}

        {/* Step: Show challenge (for X/GitHub/Domain) */}
        {connected && step === "challenge" && (
          <div className="space-y-4">
            <div
              className="rounded-lg p-4"
              style={{ background: "var(--bg-primary)", border: "1px solid var(--border)" }}
            >
              <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
                Instructions
              </p>
              <pre className="text-xs whitespace-pre-wrap" style={{ color: "var(--text-primary)", fontFamily: "var(--font-mono)" }}>
                {instructions}
              </pre>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
                Paste proof URL
              </label>
              <input
                type="text"
                value={proof}
                onChange={(e) => setProof(e.target.value)}
                placeholder={
                  selectedMethod === "x" ? "https://x.com/..." :
                  selectedMethod === "github" ? "https://gist.github.com/..." :
                  "Verification proof"
                }
                className="w-full px-4 py-2.5 rounded-lg text-sm outline-none"
                style={{
                  fontFamily: "var(--font-mono)",
                  background: "var(--bg-primary)",
                  border: "1px solid var(--border)",
                  color: "var(--text-primary)",
                }}
                onKeyDown={(e) => { if (e.key === "Enter" && proof.trim()) handleVerify(); }}
              />
            </div>

            <button
              onClick={handleVerify}
              disabled={loading || !proof.trim()}
              className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-lg text-sm font-semibold uppercase tracking-wider disabled:opacity-50 transition-all hover:shadow-lg"
              style={{
                fontFamily: "var(--font-mono)",
                background: "var(--accent)",
                color: "#fff",
              }}
            >
              {loading ? (
                <><Loader2 size={16} className="animate-spin" /> Verifying...</>
              ) : (
                <>Verify & Claim <ArrowRight size={16} /></>
              )}
            </button>

            <button
              onClick={() => { setStep("methods"); setError(""); setProof(""); }}
              className="w-full text-center text-xs py-2"
              style={{ color: "var(--text-tertiary)" }}
            >
              ← Back to methods
            </button>
          </div>
        )}

        {/* Step: Success */}
        {step === "success" && (
          <div className="text-center py-6">
            <CheckCircle size={48} className="mx-auto mb-4" style={{ color: "#10B981" }} />
            <h3 className="text-lg font-bold mb-2" style={{ fontFamily: "var(--font-mono)", color: "#10B981" }}>
              Profile Claimed! 🎉
            </h3>
            <p className="text-sm mb-2" style={{ color: "var(--text-secondary)" }}>
              <strong>{profileName}</strong> is now yours.
            </p>
            <p className="text-xs mb-6" style={{ color: "var(--text-tertiary)" }}>
              Your wallet has been linked. You can now edit your bio, links, and skills.
            </p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={() => window.location.reload()}
                className="px-5 py-2.5 rounded-lg text-sm font-semibold"
                style={{
                  fontFamily: "var(--font-mono)",
                  background: "var(--accent)",
                  color: "#fff",
                }}
              >
                View Profile
              </button>
              <a
                href={`/profile/${profileId}/edit`}
                className="px-5 py-2.5 rounded-lg text-sm font-semibold inline-flex items-center"
                style={{
                  fontFamily: "var(--font-mono)",
                  background: "rgba(153, 69, 255, 0.15)",
                  color: "var(--solana)",
                  border: "1px solid rgba(153, 69, 255, 0.3)",
                  textDecoration: "none",
                }}
              >
                Edit Profile <ArrowRight size={14} className="ml-1" />
              </a>
            </div>
          </div>
        )}

        {/* Error state (no methods available) */}
        {step === "error" && !methods.length && (
          <div className="text-center py-6">
            <AlertCircle size={48} className="mx-auto mb-4 opacity-50" style={{ color: "#ef4444" }} />
            <p className="text-sm mb-2" style={{ color: "var(--text-secondary)" }}>
              {error || "This profile is not available for claiming."}
            </p>
            <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>
              If you believe this is your profile, contact us on Discord.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
