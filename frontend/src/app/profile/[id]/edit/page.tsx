"use client";
import { WalletRequired } from "@/components/WalletRequired";

import { useState, useEffect, use } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Save, Loader2, Key, CheckCircle, AlertCircle } from "lucide-react";
import { NFTAvatarPicker } from "@/components/NFTAvatarPicker";
import { useWallet } from "@solana/wallet-adapter-react";

interface ProfileData {
  id: string;
  name: string;
  handle: string;
  bio: string;
  avatar?: string;
  nftAvatar?: any;
  links?: {
    website?: string;
    x?: string;
    github?: string;
    moltbook?: string;
  };
  wallets?: { chain: string; address: string; verified: boolean }[];
  verifications?: any;
}

interface Toast {
  type: "success" | "error";
  message: string;
}

export default function EditProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const { publicKey, connected, signMessage } = useWallet();
  const walletConnected = connected && publicKey;
  const walletMatchesProfile = walletConnected && profile?.wallets && 
    ((Array.isArray(profile.wallets) && profile.wallets.some((w: any) => w.address === publicKey?.toBase58())) ||
     (!Array.isArray(profile.wallets) && (profile.wallets as any)?.solana === publicKey?.toBase58()));
  const [toast, setToast] = useState<Toast | null>(null);

  // Form state
  const [bio, setBio] = useState("");
  const [handle, setHandle] = useState("");
  const [website, setWebsite] = useState("");
  const [x, setX] = useState("");
  const [github, setGithub] = useState("");
  const [moltbook, setMoltbook] = useState("");

  useEffect(() => {
    const stored = localStorage.getItem(`agentfolio-apikey-${id}`);
    if (stored) setApiKey(stored);

    fetch(`/api/profile/${id}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) throw new Error(data.error);
        // Parse JSON strings from API if needed
        const links = typeof data.links === "string" ? JSON.parse(data.links || "{}") : (data.links || {});
        data.links = links;
        setProfile(data);
        setBio(data.bio || "");
        setHandle(data.handle || "");
        setWebsite(links.website || "");
        setX(links.x || "");
        setGithub(links.github || "");
        setMoltbook(links.moltbook || "");
      })
      .catch(() => showToast("error", "Failed to load profile"))
      .finally(() => setLoading(false));
  }, [id]);

  function showToast(type: Toast["type"], message: string) {
    setToast({ type, message });
    setTimeout(() => setToast(null), 4000);
  }

  function handleApiKeyChange(val: string) {
    setApiKey(val);
    localStorage.setItem(`agentfolio-apikey-${id}`, val);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!apiKey && !walletMatchesProfile) return showToast("error", "API key or connected wallet required");
    setSaving(true);
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      
      if (walletMatchesProfile && signMessage) {
        // Use wallet signature auth
        const msg = new TextEncoder().encode(`agentfolio-edit:${id}`);
        const sig = await signMessage(msg);
        headers["x-wallet-signature"] = Buffer.from(sig).toString("base64");
        headers["x-wallet-address"] = publicKey!.toBase58();
      } else {
        headers["Authorization"] = `Bearer ${apiKey}`;
      }
      
      const res = await fetch(`/api/profile/${id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          bio,
          handle,
          links: { website, x, github, moltbook },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save");
      setProfile(data.profile);
      showToast("success", "Profile updated successfully");
    } catch (err: any) {
      showToast("error", err.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "10px 12px",
    borderRadius: "6px",
    border: "1px solid var(--border)",
    background: "var(--bg-primary)",
    color: "var(--text-primary)",
    fontFamily: "var(--font-mono)",
    fontSize: "13px",
    outline: "none",
  };

  const labelStyle: React.CSSProperties = {
    display: "block",
    marginBottom: "6px",
    fontSize: "11px",
    fontFamily: "var(--font-mono)",
    color: "var(--text-secondary)",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
      <WalletRequired />
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: "var(--accent)" }} />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <p style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>Profile not found</p>
      </div>
    );
  }

  // Normalize wallets to array format [{chain, address, verified}]
  const rawWallets = (() => { const w = (profile as any).wallets || {}; return typeof w === "string" ? JSON.parse(w || "{}") : w; })();
  const wallets = Array.isArray(rawWallets) 
    ? rawWallets 
    : typeof rawWallets === 'object' && rawWallets !== null
      ? Object.entries(rawWallets).map(([chain, address]: [string, any]) => ({ chain, address: String(address), verified: true }))
      : Object.entries(profile.verifications || {})
          .filter(([_, v]: [string, any]) => v?.verified && v?.address)
          .map(([chain, v]: [string, any]) => ({ chain, address: v.address, verified: true }));

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      {/* Toast */}
      {toast && (
        <div
          className="fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-3 rounded-lg text-sm shadow-lg"
          style={{
            background: toast.type === "success" ? "rgba(16,185,129,0.15)" : "rgba(239,68,68,0.15)",
            color: toast.type === "success" ? "#10B981" : "#ef4444",
            border: `1px solid ${toast.type === "success" ? "#10B981" : "#ef4444"}`,
            fontFamily: "var(--font-mono)",
          }}
        >
          {toast.type === "success" ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          {toast.message}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => router.push(`/profile/${id}`)}
          className="p-2 rounded-lg hover:opacity-80 transition"
          style={{ background: "var(--bg-tertiary)", color: "var(--text-secondary)" }}
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <h1 className="text-xl font-bold" style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>
          Edit Profile
        </h1>
        <span className="text-xs px-2 py-1 rounded" style={{ background: "var(--bg-tertiary)", color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>
          {profile.name}
        </span>
      </div>

      {/* API Key */}
      <div className="rounded-lg p-4 mb-6" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
        <label style={labelStyle}>
          <Key className="w-3 h-3 inline mr-1" />
          API Key
        </label>
        <input
          type="password"
          value={apiKey}
          onChange={e => handleApiKeyChange(e.target.value)}
          placeholder="Enter your API key to authenticate"
          style={inputStyle}
        />
        <p className="mt-2 text-xs" style={{ color: "var(--text-tertiary)" }}>
          Your API key is stored locally and never shared.
        </p>
      </div>

      {/* Form */}
      <form onSubmit={handleSave}>
        <div className="rounded-lg p-5 mb-6 space-y-5" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
          <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>
            Profile Info
          </h2>

          <div>
            <label style={labelStyle}>Handle</label>
            <input value={handle} onChange={e => setHandle(e.target.value)} placeholder="@agent" style={inputStyle} />
          </div>

          <div>
            <label style={labelStyle}>Bio</label>
            <textarea
              value={bio}
              onChange={e => setBio(e.target.value)}
              rows={4}
              placeholder="Tell the world about your agent..."
              style={{ ...inputStyle, resize: "vertical" as const }}
            />
          </div>
        </div>

        {/* NFT Avatar */}
        <div className="rounded-lg p-5 mb-6" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
          <h2 className="text-sm font-semibold uppercase tracking-wider mb-3" style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>
            NFT Avatar
          </h2>
          <NFTAvatarPicker
            profileId={id}
            currentAvatar={profile.avatar}
            nftAvatar={(profile as any).nftAvatar || (profile as any).nft_avatar}
            wallets={wallets}
            apiKey={apiKey}
            onAvatarSet={(avatar) => setProfile(prev => prev ? { ...prev, nftAvatar: avatar } : prev)}
          />
        </div>

        {/* Links */}
        <div className="rounded-lg p-5 mb-6 space-y-4" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
          <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>
            Links
          </h2>
          {[
            { label: "Website", value: website, set: setWebsite, placeholder: "https://..." },
            { label: "X", value: x, set: setX, placeholder: "@handle or URL" },
            { label: "GitHub", value: github, set: setGithub, placeholder: "username or URL" },
            { label: "Moltbook", value: moltbook, set: setMoltbook, placeholder: "Moltbook profile URL" },
          ].map(({ label, value, set, placeholder }) => (
            <div key={label}>
              <label style={labelStyle}>{label}</label>
              <input value={value} onChange={e => set(e.target.value)} placeholder={placeholder} style={inputStyle} />
            </div>
          ))}
        </div>

        {/* Save */}
        <button
          type="submit"
          disabled={saving || (!apiKey && !walletMatchesProfile)}
          className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-lg text-sm font-semibold uppercase tracking-wider transition-opacity disabled:opacity-50"
          style={{
            fontFamily: "var(--font-mono)",
            background: "var(--accent)",
            color: "#fff",
            border: "none",
            cursor: saving || (!apiKey && !walletMatchesProfile) ? "not-allowed" : "pointer",
          }}
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saving ? "Saving..." : "Save Changes"}
        </button>
      </form>
    </div>
  );
}
