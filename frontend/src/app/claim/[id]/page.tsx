"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { Shield, ArrowRight, Loader2, AlertCircle, ExternalLink } from "lucide-react";
import { ClaimModal } from "@/components/ClaimModal";

interface ProfileData {
  id: string;
  name: string;
  handle: string;
  bio: string;
  avatar?: string;
  unclaimed?: boolean;
  verifications?: any[];
  trust_score?: any;
}

export default function ClaimPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;

  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [claimOpen, setClaimOpen] = useState(false);

  useEffect(() => {
    if (!id) return;
    fetch(`/api/profile/${id}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) {
          setError("Profile not found");
        } else {
          setProfile(data);
          if (!data.unclaimed) {
            setError("This profile is already claimed.");
          }
        }
      })
      .catch(() => setError("Failed to load profile"))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg-primary)" }}>
        <Loader2 size={32} className="animate-spin" style={{ color: "var(--solana)" }} />
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg-primary)" }}>
        <div className="text-center max-w-md px-6">
          <AlertCircle size={48} className="mx-auto mb-4 opacity-50" style={{ color: "#ef4444" }} />
          <h1 className="text-xl font-bold mb-2" style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>
            {error || "Profile Not Found"}
          </h1>
          <p className="text-sm mb-6" style={{ color: "var(--text-tertiary)" }}>
            {error === "This profile is already claimed."
              ? "Someone has already claimed this profile. If this is you, visit the profile page."
              : "The profile you're looking for doesn't exist."
            }
          </p>
          <a
            href={error === "This profile is already claimed." ? `/profile/${id}` : "/"}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold"
            style={{
              fontFamily: "var(--font-mono)",
              background: "var(--accent)",
              color: "#fff",
              textDecoration: "none",
            }}
          >
            {error === "This profile is already claimed." ? "View Profile" : "Browse Directory"} <ArrowRight size={14} />
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: "var(--bg-primary)" }}>
      <div className="max-w-2xl mx-auto px-6 py-16">
        {/* Hero */}
        <div className="text-center mb-10">
          <div
            className="w-20 h-20 rounded-2xl mx-auto mb-6 flex items-center justify-center text-3xl"
            style={{
              background: "linear-gradient(135deg, rgba(153,69,255,0.2), rgba(20,241,149,0.2))",
              border: "2px solid var(--border)",
            }}
          >
            {profile.avatar ? (
              <img src={profile.avatar} alt={profile.name} className="w-full h-full rounded-2xl object-cover" />
            ) : (
              profile.name?.charAt(0) || "?"
            )}
          </div>
          <h1 className="text-3xl font-bold mb-2" style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>
            Claim {profile.name}
          </h1>
          <p className="text-sm" style={{ color: "var(--text-tertiary)" }}>
            This profile is unclaimed on AgentFolio. If this is your agent, claim it to take full control.
          </p>
        </div>

        {/* Profile preview card */}
        <div
          className="rounded-xl p-6 mb-8"
          style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}
        >
          <div className="flex items-start gap-4">
            <div
              className="w-14 h-14 rounded-xl flex-shrink-0 flex items-center justify-center text-xl font-bold"
              style={{
                background: "linear-gradient(135deg, rgba(153,69,255,0.15), rgba(20,241,149,0.15))",
                color: "var(--solana)",
              }}
            >
              {profile.avatar ? (
                <img src={profile.avatar} alt="" className="w-full h-full rounded-xl object-cover" />
              ) : (
                profile.name?.charAt(0)
              )}
            </div>
            <div className="flex-1">
              <h2 className="text-lg font-bold" style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>
                {profile.name}
              </h2>
              {profile.handle && (
                <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>@{profile.handle}</p>
              )}
              {profile.bio && (
                <p className="text-sm mt-2" style={{ color: "var(--text-secondary)" }}>{profile.bio}</p>
              )}
            </div>
            <span
              className="px-3 py-1 rounded-full text-xs font-bold uppercase"
              style={{
                background: "rgba(245, 158, 11, 0.15)",
                color: "#F59E0B",
                border: "1px solid rgba(245, 158, 11, 0.3)",
              }}
            >
              Unclaimed
            </span>
          </div>
        </div>

        {/* What you get */}
        <div
          className="rounded-xl p-6 mb-8"
          style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}
        >
          <h3 className="text-sm font-bold uppercase tracking-wider mb-4" style={{ fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
            What claiming gives you
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[
              { icon: "✏️", text: "Edit bio, links, and skills" },
              { icon: "🔐", text: "Wallet-based authentication" },
              { icon: "⭐", text: "Build reputation & trust score" },
              { icon: "🏆", text: "Receive endorsements & reviews" },
              { icon: "⛓️", text: "On-chain identity (SATP)" },
              { icon: "📊", text: "Track performance & activity" },
            ].map(({ icon, text }) => (
              <div key={text} className="flex items-center gap-2 text-xs" style={{ color: "var(--text-secondary)" }}>
                <span className="text-base">{icon}</span> {text}
              </div>
            ))}
          </div>
        </div>

        {/* CTA */}
        <div className="text-center">
          <button
            onClick={() => setClaimOpen(true)}
            className="inline-flex items-center gap-3 px-8 py-4 rounded-xl text-base font-bold uppercase tracking-wider transition-all hover:shadow-[0_0_30px_rgba(153,69,255,0.4)] hover:scale-[1.02]"
            style={{
              fontFamily: "var(--font-mono)",
              background: "linear-gradient(135deg, #9945FF, #14F195)",
              color: "#fff",
              border: "none",
              cursor: "pointer",
            }}
          >
            <Shield size={20} />
            Claim This Profile
          </button>
          <p className="text-xs mt-4" style={{ color: "var(--text-tertiary)" }}>
            You'll need to prove ownership via X, GitHub, domain, or wallet signature.
          </p>
        </div>

        {/* Link to profile */}
        <div className="text-center mt-8">
          <a
            href={`/profile/${id}`}
            className="inline-flex items-center gap-1 text-xs"
            style={{ color: "var(--text-tertiary)", textDecoration: "none" }}
          >
            View full profile <ExternalLink size={12} />
          </a>
        </div>
      </div>

      {/* Claim modal */}
      <ClaimModal
        profileId={profile.id}
        profileName={profile.name}
        isOpen={claimOpen}
        onClose={() => setClaimOpen(false)}
        onClaimed={() => {
          // Redirect to profile page after brief delay
          setTimeout(() => router.push(`/profile/${id}`), 1500);
        }}
      />
    </div>
  );
}
