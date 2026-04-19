"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useSmartConnect } from "@/components/WalletProvider";
import { useDemoMode } from "@/lib/demo-mode";
import { Github, ArrowRight, Loader2, CheckCircle, AlertCircle, Star, GitBranch, Users, Search, ExternalLink } from "lucide-react";
import Link from "next/link";

interface GitHubPreview {
  github: {
    login: string;
    name: string;
    bio: string;
    avatar: string;
    website: string;
    twitter: string;
    publicRepos: number;
    followers: number;
    type: string;
  };
  stats: {
    totalStars: number;
    topLanguages: string[];
    totalRepos: number;
  };
  topRepos: { name: string; description: string; stars: number; language: string; url: string }[];
  skills: { name: string; category: string }[];
  draft: any;
  existing: { id: string; name: string } | null;
}

export default function ImportPage() {
  const wallet = useWallet();
  const { smartConnect } = useSmartConnect();
  const { isDemo, demoPublicKey } = useDemoMode();
  const connected = isDemo ? true : wallet.connected;
  const publicKey = isDemo ? demoPublicKey : wallet.publicKey;

  const [username, setUsername] = useState("");
  const [preview, setPreview] = useState<GitHubPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ profileId: string; profileUrl: string } | null>(null);

  // Editable overrides
  const [editName, setEditName] = useState("");
  const [editBio, setEditBio] = useState("");

  async function handlePreview() {
    if (!username.trim()) return;
    setLoading(true);
    setError("");
    setPreview(null);
    setResult(null);

    try {
      const res = await fetch(`/api/import/github/preview?username=${encodeURIComponent(username.trim())}`);
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        setPreview(data);
        setEditName(data.draft.name);
        setEditBio(data.draft.bio);
      }
    } catch {
      setError("Failed to fetch GitHub profile");
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate() {
    if (!preview || !connected || !publicKey) return;
    if (!wallet.signMessage) {
      setError("Wallet does not support message signing");
      return;
    }

    setCreating(true);
    setError("");

    try {
      const signedMessage = `agentfolio-register:${preview.github.login}:${Date.now()}`;
      const encoded = new TextEncoder().encode(signedMessage);
      const signature = await wallet.signMessage(encoded);
      const sigBase64 = Buffer.from(signature).toString("base64");

      const res = await fetch("/api/import/github/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: preview.github.login,
          wallet: publicKey.toBase58(),
          signature: sigBase64,
          signedMessage,
          overrides: {
            name: editName !== preview.draft.name ? editName : undefined,
            bio: editBio !== preview.draft.bio ? editBio : undefined,
          },
        }),
      });
      const data = await res.json();

      if (data.success) {
        setResult(data);
      } else {
        setError(data.error || "Import failed");
      }
    } catch (e: any) {
      if (e.message?.includes("User rejected")) {
        setError("Signature rejected");
      } else {
        setError(e.message || "Failed to create profile");
      }
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="min-h-screen" style={{ background: "var(--bg-primary)" }}>
      <div className="max-w-2xl mx-auto px-6 py-16">
        {/* Header */}
        <div className="text-center mb-10">
          <Github size={48} className="mx-auto mb-4" style={{ color: "var(--text-primary)" }} />
          <h1 className="text-3xl font-bold mb-2" style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>
            Import from GitHub
          </h1>
          <p className="text-sm" style={{ color: "var(--text-tertiary)" }}>
            Auto-populate your AgentFolio profile from your GitHub account.
            <br />We&apos;ll pull your bio, languages, top repos, and more.
          </p>
        </div>

        {/* Search */}
        <div
          className="rounded-xl p-6 mb-6"
          style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}
        >
          <label className="block text-xs font-semibold uppercase tracking-wider mb-3" style={{ fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
            GitHub Username or Organization
          </label>
          <div className="flex gap-3">
            <div className="flex-1 relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--text-tertiary)" }} />
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handlePreview(); }}
                placeholder="e.g. elizaOS, openai, your-username"
                className="w-full pl-10 pr-4 py-3 rounded-lg text-sm outline-none"
                style={{
                  fontFamily: "var(--font-mono)",
                  background: "var(--bg-primary)",
                  border: "1px solid var(--border)",
                  color: "var(--text-primary)",
                }}
              />
            </div>
            <button
              onClick={handlePreview}
              disabled={loading || !username.trim()}
              className="px-6 py-3 rounded-lg text-sm font-semibold uppercase tracking-wider disabled:opacity-50 transition-all hover:shadow-lg"
              style={{ fontFamily: "var(--font-mono)", background: "var(--accent)", color: "#fff" }}
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : "Preview"}
            </button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div
            className="rounded-lg p-4 mb-6 flex items-center gap-2"
            style={{ background: "rgba(220, 38, 38, 0.1)", border: "1px solid rgba(220, 38, 38, 0.3)" }}
          >
            <AlertCircle size={16} style={{ color: "#ef4444" }} />
            <span className="text-sm" style={{ color: "#ef4444" }}>{error}</span>
          </div>
        )}

        {/* Preview */}
        {preview && !result && (
          <div className="space-y-6">
            {/* Existing profile warning */}
            {preview.existing && (
              <div
                className="rounded-lg p-4 flex items-center gap-3"
                style={{ background: "rgba(245, 158, 11, 0.1)", border: "1px solid rgba(245, 158, 11, 0.3)" }}
              >
                <AlertCircle size={18} style={{ color: "#F59E0B" }} />
                <div className="flex-1">
                  <p className="text-sm font-semibold" style={{ color: "#F59E0B" }}>Profile already exists</p>
                  <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>
                    A profile for this name exists. You may want to <Link href={`/claim/${preview.existing.id}`} className="underline">claim it instead</Link>.
                  </p>
                </div>
              </div>
            )}

            {/* GitHub profile card */}
            <div
              className="rounded-xl p-6"
              style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}
            >
              <div className="flex items-start gap-4 mb-4">
                <img
                  src={preview.github.avatar}
                  alt={preview.github.name}
                  className="w-16 h-16 rounded-xl"
                />
                <div className="flex-1">
                  <h2 className="text-lg font-bold" style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>
                    {preview.github.name}
                  </h2>
                  <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>@{preview.github.login} · {preview.github.type}</p>
                  {preview.github.bio && (
                    <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>{preview.github.bio}</p>
                  )}
                </div>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-3 gap-3 mb-4">
                {[
                  { icon: <GitBranch size={14} />, label: "Repos", value: preview.stats.totalRepos },
                  { icon: <Star size={14} />, label: "Stars", value: preview.stats.totalStars },
                  { icon: <Users size={14} />, label: "Followers", value: preview.github.followers },
                ].map(({ icon, label, value }) => (
                  <div
                    key={label}
                    className="rounded-lg p-3 text-center"
                    style={{ background: "var(--bg-primary)", border: "1px solid var(--border)" }}
                  >
                    <div className="flex items-center justify-center gap-1 mb-1" style={{ color: "var(--solana)" }}>
                      {icon} <span className="text-lg font-bold" style={{ fontFamily: "var(--font-mono)" }}>{value.toLocaleString()}</span>
                    </div>
                    <div className="text-[10px] uppercase tracking-wider" style={{ color: "var(--text-tertiary)" }}>{label}</div>
                  </div>
                ))}
              </div>

              {/* Languages */}
              <div className="flex flex-wrap gap-2 mb-4">
                {preview.stats.topLanguages.map((lang) => (
                  <span
                    key={lang}
                    className="px-2 py-1 rounded text-[10px] font-mono"
                    style={{ background: "rgba(153,69,255,0.1)", color: "var(--solana)", border: "1px solid rgba(153,69,255,0.2)" }}
                  >
                    {lang}
                  </span>
                ))}
              </div>

              {/* Top repos */}
              {preview.topRepos.length > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
                    Top Repositories
                  </p>
                  <div className="space-y-2">
                    {preview.topRepos.slice(0, 3).map((repo) => (
                      <div key={repo.name} className="flex items-center gap-2 text-xs" style={{ color: "var(--text-secondary)" }}>
                        <Star size={12} style={{ color: "#F59E0B" }} />
                        <span className="font-mono font-semibold" style={{ color: "var(--text-primary)" }}>{repo.name}</span>
                        <span className="text-[10px]">⭐ {repo.stars}</span>
                        {repo.language && <span className="text-[10px] opacity-60">· {repo.language}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Editable fields */}
            <div
              className="rounded-xl p-6"
              style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}
            >
              <h3 className="text-sm font-bold uppercase tracking-wider mb-4" style={{ fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
                Review & Edit
              </h3>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold mb-1" style={{ color: "var(--text-tertiary)" }}>Display Name</label>
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-lg text-sm outline-none"
                    style={{ fontFamily: "var(--font-mono)", background: "var(--bg-primary)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1" style={{ color: "var(--text-tertiary)" }}>Bio</label>
                  <textarea
                    value={editBio}
                    onChange={(e) => setEditBio(e.target.value)}
                    rows={3}
                    className="w-full px-4 py-2.5 rounded-lg text-sm outline-none resize-none"
                    style={{ fontFamily: "var(--font-mono)", background: "var(--bg-primary)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
                  />
                </div>
              </div>
            </div>

            {/* Create button */}
            <div className="text-center">
              {!connected ? (
                <button
                  onClick={() => smartConnect()}
                  className="px-8 py-4 rounded-xl text-sm font-bold uppercase tracking-wider transition-all hover:shadow-lg"
                  style={{ fontFamily: "var(--font-mono)", background: "linear-gradient(135deg, #9945FF, #14F195)", color: "#fff" }}
                >
                  Connect Wallet to Import
                </button>
              ) : (
                <button
                  onClick={handleCreate}
                  disabled={creating || !!preview.existing}
                  className="inline-flex items-center gap-3 px-8 py-4 rounded-xl text-base font-bold uppercase tracking-wider transition-all hover:shadow-[0_0_30px_rgba(153,69,255,0.4)] hover:scale-[1.02] disabled:opacity-50"
                  style={{ fontFamily: "var(--font-mono)", background: "linear-gradient(135deg, #9945FF, #14F195)", color: "#fff" }}
                >
                  {creating ? (
                    <><Loader2 size={20} className="animate-spin" /> Creating Profile...</>
                  ) : (
                    <><Github size={20} /> Create AgentFolio Profile</>
                  )}
                </button>
              )}
              <p className="text-xs mt-3" style={{ color: "var(--text-tertiary)" }}>
                You&apos;ll sign a message to prove wallet ownership. No transaction fees.
              </p>
            </div>
          </div>
        )}

        {/* Success */}
        {result && (
          <div className="text-center py-10">
            <CheckCircle size={64} className="mx-auto mb-6" style={{ color: "#10B981" }} />
            <h2 className="text-2xl font-bold mb-2" style={{ fontFamily: "var(--font-mono)", color: "#10B981" }}>
              Profile Created! 🎉
            </h2>
            <p className="text-sm mb-6" style={{ color: "var(--text-secondary)" }}>
              Your GitHub profile has been imported to AgentFolio. You can edit it anytime.
            </p>
            <div className="flex gap-3 justify-center">
              <Link
                href={result.profileUrl}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-lg text-sm font-semibold"
                style={{ fontFamily: "var(--font-mono)", background: "var(--accent)", color: "#fff", textDecoration: "none" }}
              >
                View Profile <ExternalLink size={14} />
              </Link>
              <Link
                href={`${result.profileUrl}/edit`}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-lg text-sm font-semibold"
                style={{ fontFamily: "var(--font-mono)", background: "rgba(153,69,255,0.15)", color: "var(--solana)", border: "1px solid rgba(153,69,255,0.3)", textDecoration: "none" }}
              >
                Edit Profile <ArrowRight size={14} />
              </Link>
            </div>
          </div>
        )}

        {/* No preview yet — show examples */}
        {!preview && !result && !loading && (
          <div
            className="rounded-xl p-6 text-center"
            style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}
          >
            <p className="text-xs uppercase tracking-wider mb-4" style={{ fontFamily: "var(--font-mono)", color: "var(--text-tertiary)" }}>
              Try these examples
            </p>
            <div className="flex flex-wrap gap-2 justify-center">
              {["elizaOS", "openai", "langchain-ai", "anthropics", "solana-labs"].map((name) => (
                <button
                  key={name}
                  onClick={() => { setUsername(name); }}
                  className="px-3 py-1.5 rounded-lg text-xs font-mono transition-all hover:shadow-md"
                  style={{ background: "var(--bg-primary)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}
                >
                  {name}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
