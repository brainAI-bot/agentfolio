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
  nftAvatar?: {
    image?: string;
    soulboundMint?: string;
    burnTx?: string;
    attestationTx?: string;
    permanent?: boolean;
    arweaveUrl?: string;
  } | null;
}

export function OnChainAvatar({ walletAddress, fallbackImage, agentName, size = 80, className = "", nftAvatar }: Props) {
  const [avatarData, setAvatarData] = useState<OnChainAvatarData | null>(null);
  const [loading, setLoading] = useState(!!walletAddress && !nftAvatar);
  const [imageSrc, setImageSrc] = useState(nftAvatar?.image || nftAvatar?.arweaveUrl || fallbackImage);

  // Use nftAvatar data directly if available (no fetch needed)
  useEffect(() => {
    if (nftAvatar?.permanent) {
      setAvatarData({
        image: nftAvatar.image || nftAvatar.arweaveUrl || null,
        mint: nftAvatar.soulboundMint || "",
        name: agentName,
        permanent: true,
        burnTx: nftAvatar.burnTx || null,
        source: "on-chain",
      });
      setImageSrc(nftAvatar.image || nftAvatar.arweaveUrl || fallbackImage);
      setLoading(false);
      return;
    }

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
  }, [walletAddress, nftAvatar]);

  const isPermanent = avatarData?.permanent || nftAvatar?.permanent;
  const borderColor = isPermanent ? "#9945FF" : avatarData ? "var(--accent)" : "var(--border-bright)";
  
  const solscanUrl = nftAvatar?.soulboundMint 
    ? `https://solscan.io/token/${nftAvatar.soulboundMint}` 
    : avatarData?.mint 
      ? `https://solscan.io/token/${avatarData.mint}` 
      : null;

  const arweaveUrl = nftAvatar?.arweaveUrl || nftAvatar?.image || avatarData?.image || null;

  const avatarContent = imageSrc ? (
    <div className="relative">
      <img
        src={imageSrc}
        alt={agentName}
        className="rounded-full object-cover"
        style={{ width: size, height: size, border: `3px solid ${borderColor}`, cursor: solscanUrl ? "pointer" : "default" }}
      />
      {isPermanent && (
        <div
          className="absolute -bottom-1 -right-1 rounded-full flex items-center justify-center"
          style={{ width: 26, height: 26, background: "#9945FF", border: "2px solid var(--bg-primary)", cursor: "pointer" }}
          title={`Soulbound NFT · Permanent · On-chain verified\nMint: ${nftAvatar?.soulboundMint || avatarData?.mint || "?"}\nClick to view on Solscan`}
          onClick={() => solscanUrl && window.open(solscanUrl, "_blank")}
        >
          <span style={{ fontSize: 13 }}>🔥</span>
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
  );

  if (solscanUrl && isPermanent) {
    return (
      <div className={`relative shrink-0 ${className}`}>
        <a href={solscanUrl} target="_blank" rel="noopener noreferrer" title="View soulbound NFT on Solscan">
          {avatarContent}
        </a>
      </div>
    );
  }

  return (
    <div className={`relative shrink-0 ${className}`}>
      {avatarContent}
    </div>
  );
}
