"use client";

import { useState, useEffect } from "react";
import { Download, Share2, ExternalLink, Award } from "lucide-react";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://agentfolio.bot";
const API = process.env.NEXT_PUBLIC_API_URL || SITE_URL;
const SOLANA_CLUSTER = process.env.NEXT_PUBLIC_SOLANA_CLUSTER || "mainnet-beta";

function solanaExplorerUrl(path: string) {
  const clusterParam = SOLANA_CLUSTER !== "mainnet-beta" ? `?cluster=${encodeURIComponent(SOLANA_CLUSTER)}` : "";
  return `https://explorer.solana.com/${path}${clusterParam}`;
}

interface BirthCertificateData {
  certNumber: string;
  certificateUrl: string;
  certificateMint: string | null;
  burnTxSignature: string;
  arweaveUrl: string;
  generatedAt: string;
}

interface Props {
  profileId: string;
  profileName?: string;
  apiKey?: string;
  onGenerated?: (data: BirthCertificateData) => void;
  autoGenerate?: boolean;
  burnTxSignature?: string;
  arweaveUrl?: string;
}

export default function BirthCertificate({ profileId, profileName, apiKey, onGenerated, autoGenerate, burnTxSignature, arweaveUrl }: Props) {
  const [cert, setCert] = useState<BirthCertificateData | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch existing certificate
  useEffect(() => {
    fetch(`${API}/api/agent/${profileId}/genesis-record`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data && !data.error) setCert(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [profileId]);

  // Auto-generate after burn
  useEffect(() => {
    if (autoGenerate && !cert && !loading && apiKey) {
      generateCertificate();
    }
  }, [autoGenerate, cert, loading]);

  const generateCertificate = async () => {
    if (!apiKey) return;
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch(`${API}/api/avatar/genesis-record`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey },
        body: JSON.stringify({ profileId, burnTxSignature, arweaveUrl }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setCert(data);
      onGenerated?.(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setGenerating(false);
    }
  };

  const getCertImageUrl = () => {
    if (!cert) return "";
    if (cert.certificateUrl.startsWith("http")) return cert.certificateUrl;
    return `${API}${cert.certificateUrl}`;
  };

  const handleDownload = () => {
    const link = document.createElement("a");
    link.href = getCertImageUrl();
    link.download = `genesis-record-${cert?.certNumber || profileId}.png`;
    link.click();
  };

  const handleShareX = () => {
    const text = encodeURIComponent(
      `🔥 I burned my NFT and became permanent on @AgentFolio.\n\nGenesis Record ${cert?.certNumber}\nThis identity is permanent. No changes. No undo.\n\n${SITE_URL}/profile/${profileId}`
    );
    window.open(`https://x.com/intent/tweet?text=${text}`, "_blank");
  };

  if (loading) {
    return (
      <div className="rounded-xl border p-6 text-center animate-pulse" style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}>
        <Award size={24} className="mx-auto mb-2 opacity-30" />
        <p className="text-sm" style={{ color: "var(--text-tertiary)" }}>Loading certificate...</p>
      </div>
    );
  }

  if (generating) {
    return (
      <div className="rounded-xl border p-8 text-center" style={{ background: "var(--bg-secondary)", borderColor: "#9945FF" }}>
        <div className="animate-spin w-8 h-8 border-2 border-t-transparent rounded-full mx-auto mb-4" style={{ borderColor: "#9945FF", borderTopColor: "transparent" }} />
        <p className="text-sm font-mono" style={{ color: "#9945FF" }}>Generating genesis record...</p>
      </div>
    );
  }

  if (!cert) {
    if (error) {
      return (
        <div className="rounded-xl border p-6 text-center" style={{ background: "var(--bg-secondary)", borderColor: "#ef4444" }}>
          <p className="text-sm" style={{ color: "#ef4444" }}>{error}</p>
        </div>
      );
    }
    return null; // No certificate, don't render
  }

  return (
    <div className="rounded-xl border overflow-hidden" style={{ background: "var(--bg-secondary)", borderColor: "#9945FF" }}>
      {/* Certificate Image */}
      <div className="relative">
        <img
          src={getCertImageUrl()}
          alt={`Genesis Record ${cert.certNumber}`}
          className="w-full"
          style={{ imageRendering: "auto" }}
        />
        {/* Subtle glow overlay */}
        <div className="absolute inset-0 pointer-events-none" style={{
          background: "radial-gradient(ellipse at center, rgba(153,69,255,0.05) 0%, transparent 70%)"
        }} />
      </div>

      {/* Actions */}
      <div className="p-4 flex flex-wrap gap-3 justify-center" style={{ borderTop: "1px solid rgba(153,69,255,0.2)" }}>
        <button
          onClick={handleDownload}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors hover:opacity-80"
          style={{ background: "rgba(153,69,255,0.15)", color: "#9945FF", border: "1px solid rgba(153,69,255,0.3)" }}
        >
          <Download size={14} /> Download
        </button>

        <button
          onClick={handleShareX}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors hover:opacity-80"
          style={{ background: "rgba(153,69,255,0.15)", color: "#9945FF", border: "1px solid rgba(153,69,255,0.3)" }}
        >
          <Share2 size={14} /> Share on X
        </button>

        {cert.burnTxSignature && (
          <a
            href={solanaExplorerUrl(`tx/${cert.burnTxSignature}`)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors hover:opacity-80"
            style={{ background: "rgba(153,69,255,0.15)", color: "#9945FF", border: "1px solid rgba(153,69,255,0.3)" }}
          >
            <ExternalLink size={14} /> View on Solana
          </a>
        )}

        {cert.certificateMint && (
          <a
            href={solanaExplorerUrl(`address/${cert.certificateMint}`)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors hover:opacity-80"
            style={{ background: "rgba(153,69,255,0.15)", color: "#9945FF", border: "1px solid rgba(153,69,255,0.3)" }}
          >
            <Award size={14} /> Soulbound NFT
          </a>
        )}
      </div>

      {/* Meta */}
      <div className="px-4 pb-3 text-center">
        <p className="text-xs font-mono" style={{ color: "var(--text-tertiary)" }}>
          {cert.certNumber} · Generated {new Date(cert.generatedAt).toLocaleDateString()}
        </p>
      </div>
    </div>
  );
}
