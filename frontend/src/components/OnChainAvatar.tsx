"use client";

import { useState, useEffect } from "react";

interface OnChainAvatarData {
  image: string | null;
  mint: string;
  name: string;
  permanent: boolean;
  burnTx: string | null;
  source: string;
}

interface Props {
  walletAddress: string | null;
  fallbackImage: string | null;
  agentName: string;
  size?: number;
  className?: string;
}

export function OnChainAvatar({ walletAddress, fallbackImage, agentName, size = 80, className = "" }: Props) {
  const [avatarData, setAvatarData] = useState<OnChainAvatarData | null>(null);
  const [loading, setLoading] = useState(!!walletAddress);
  const [imageSrc, setImageSrc] = useState(fallbackImage);

  useEffect(() => {
    if (!walletAddress) { setLoading(false); return; }
    
    fetch(`/api/avatar/onchain?wallet=${walletAddress}`)
      .then(r => r.json())
      .then(data => {
        if (data?.image) {
          setImageSrc(data.image);
          setAvatarData(data);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [walletAddress]);

  const isPermanent = avatarData?.permanent;
  const borderColor = isPermanent ? "#9945FF" : avatarData ? "var(--accent)" : "var(--border-bright)";

  return (
    <div className={`relative shrink-0 ${className}`}>
      {imageSrc ? (
        <div className="relative">
          <img
            src={imageSrc}
            alt={agentName}
            className="rounded-full object-cover"
            style={{ width: size, height: size, border: `2px solid ${borderColor}` }}
          />
          {isPermanent && (
            <div
              className="absolute -bottom-1 -right-1 rounded-full flex items-center justify-center"
              style={{ width: 24, height: 24, background: "#9945FF", border: "2px solid var(--bg-primary)" }}
              title={`Soulbound · On-chain verified · ${avatarData?.mint?.slice(0, 8)}...`}
            >
              <span style={{ fontSize: 12 }}>🔥</span>
            </div>
          )}
          {avatarData && !isPermanent && (
            <div
              className="absolute -bottom-1 -right-1 rounded-full flex items-center justify-center"
              style={{ width: 20, height: 20, background: "var(--accent)", border: "2px solid var(--bg-primary)" }}
              title="On-chain verified"
            >
              <span style={{ fontSize: 10 }}>✓</span>
            </div>
          )}
          {avatarData?.source === "on-chain" && (
            <div 
              className="absolute -top-1 -left-1 rounded-full"
              style={{ width: 10, height: 10, background: "#00ff88", border: "1px solid var(--bg-primary)" }}
              title="Live on-chain data"
            />
          )}
        </div>
      ) : (
        <div
          className="rounded-full flex items-center justify-center"
          style={{ width: size, height: size, background: "var(--bg-tertiary)", border: `2px solid ${borderColor}` }}
        >
          <span style={{ fontSize: size * 0.4, fontWeight: 700, color: "var(--text-muted)" }}>
            {agentName.charAt(0)}
          </span>
        </div>
      )}
    </div>
  );
}
