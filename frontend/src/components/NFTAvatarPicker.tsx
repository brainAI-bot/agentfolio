"use client";

import { useState, useEffect } from "react";
import { Wallet, Image, Check, Loader2, X, LinkIcon } from "lucide-react";

interface NFT {
  mint: string;
  name: string | null;
  image: string | null;
  collection: string | null;
  chain: string;
}

interface NFTAvatar {
  chain: string;
  identifier: string;
  name: string | null;
  image: string | null;
  verifiedOnChain: boolean;
  verifiedAt: string;
}

interface Props {
  profileId: string;
  currentAvatar?: string | null;
  nftAvatar?: NFTAvatar | null;
  wallets: { chain: string; address: string; verified: boolean }[];
  apiKey?: string;
  connectedWalletAddress?: string | null;
  signMessage?: ((message: Uint8Array) => Promise<Uint8Array>) | null;
  onAvatarSet?: (avatar: NFTAvatar) => void;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

export function NFTAvatarPicker({ profileId, currentAvatar, nftAvatar, wallets, apiKey, connectedWalletAddress, signMessage, onAvatarSet }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [nfts, setNfts] = useState<NFT[]>([]);
  const [selectedWallet, setSelectedWallet] = useState<{ chain: string; address: string } | null>(null);
  const [setting, setSetting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const verifiedWallets = wallets.filter(w => w.verified);

  async function loadNFTs(chain: string, address: string) {
    setLoading(true);
    setError(null);
    setSelectedWallet({ chain, address });
    try {
      const res = await fetch(`/api/avatar/nfts/${chain}/${address}`, {
        headers: apiKey ? { "Authorization": `Bearer ${apiKey}` } : {}
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setNfts(data.nfts || []);
      if (data.nfts?.length === 0) setError("No NFTs found in this wallet");
    } catch (e: any) {
      setError(e.message || "Failed to load NFTs");
      setNfts([]);
    } finally {
      setLoading(false);
    }
  }

  async function selectNFT(nft: NFT) {
    if (!selectedWallet) return;
    setSetting(nft.mint);
    setError(null);
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };

      if (apiKey) {
        headers["Authorization"] = `Bearer ${apiKey}`;
        headers["x-api-key"] = apiKey;
      } else {
        if (!connectedWalletAddress || !signMessage) {
          throw new Error("Connect the verified Solana wallet for this profile or use an API key");
        }
        if (selectedWallet.chain !== "solana" || selectedWallet.address !== connectedWalletAddress) {
          throw new Error("Wallet auth currently requires selecting the connected verified Solana wallet");
        }

        const msg = new TextEncoder().encode(`agentfolio-edit:${profileId}`);
        const sig = await signMessage(msg);
        headers["x-wallet-address"] = connectedWalletAddress;
        headers["x-wallet-signature"] = bytesToBase64(sig);
        headers["x-profile-id"] = profileId;
      }

      const res = await fetch("/api/avatar/set", {
        method: "POST",
        headers,
        body: JSON.stringify({
          profileId,
          chain: selectedWallet.chain,
          walletAddress: selectedWallet.address,
          nftIdentifier: nft.mint,
          nftName: nft.name,
          nftImage: nft.image
        })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      onAvatarSet?.(data.avatar);
      setIsOpen(false);
    } catch (e: any) {
      setError(e.message || "Failed to set avatar");
    } finally {
      setSetting(null);
    }
  }

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
        style={{
          background: "var(--bg-tertiary)",
          color: "var(--accent)",
          border: "1px solid var(--border)"
        }}
      >
        <Image className="w-3.5 h-3.5" />
        {nftAvatar ? "Change NFT Avatar" : "Set NFT Avatar"}
      </button>
    );
  }

  return (
    <div
      className="rounded-lg p-4 mt-3"
      style={{ background: "var(--bg-tertiary)", border: "1px solid var(--border)" }}
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)", fontFamily: "var(--font-mono)" }}>
          NFT Avatar
        </h3>
        <button onClick={() => setIsOpen(false)} className="p-1 rounded" style={{ color: "var(--text-tertiary)" }}>
          <X className="w-4 h-4" />
        </button>
      </div>

      {nftAvatar && (
        <div
          className="flex items-center gap-3 p-3 rounded-md mb-3"
          style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}
        >
          {nftAvatar.image && (
            <img loading="lazy" src={nftAvatar.image} alt={nftAvatar.name || "Current avatar"} className="w-12 h-12 rounded-md object-cover" />
          )}
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium truncate" style={{ color: "var(--text-primary)" }}>
              {nftAvatar.name || "NFT Avatar"}
            </div>
            <div className="flex items-center gap-1 text-xs" style={{ color: "var(--text-success)" }}>
              <Check className="w-3 h-3" />
              Verified on-chain · {nftAvatar.chain}
            </div>
          </div>
        </div>
      )}

      <p className="text-xs mb-3" style={{ color: "var(--text-secondary)" }}>
        Link any NFT you own as your agent&apos;s permanent face. Ownership is verified on-chain.
      </p>

      {verifiedWallets.length === 0 ? (
        <div className="text-xs p-3 rounded-md" style={{ background: "var(--bg-secondary)", color: "var(--text-tertiary)" }}>
          <Wallet className="w-4 h-4 inline mr-1.5" />
          No verified wallets. Verify a Solana or Ethereum wallet first to link an NFT avatar.
        </div>
      ) : (
        <>
          <div className="text-xs font-medium mb-2" style={{ color: "var(--text-secondary)" }}>
            Select wallet to browse NFTs:
          </div>
          <div className="flex flex-wrap gap-2 mb-3">
            {verifiedWallets.map((w, i) => (
              <button
                key={i}
                onClick={() => loadNFTs(w.chain, w.address)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs transition-colors"
                style={{
                  background: selectedWallet?.address === w.address ? "var(--accent)" : "var(--bg-secondary)",
                  color: selectedWallet?.address === w.address ? "white" : "var(--text-secondary)",
                  border: "1px solid var(--border)"
                }}
              >
                <LinkIcon className="w-3 h-3" />
                {w.chain} · {w.address.slice(0, 6)}...{w.address.slice(-4)}
              </button>
            ))}
          </div>

          {loading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin" style={{ color: "var(--accent)" }} />
              <span className="ml-2 text-xs" style={{ color: "var(--text-secondary)" }}>Loading NFTs...</span>
            </div>
          )}

          {error && (
            <div className="text-xs p-2 rounded-md mb-2" style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444" }}>
              {error}
            </div>
          )}

          {!loading && nfts.length > 0 && (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-64 overflow-y-auto">
              {nfts.map((nft) => (
                <button
                  key={nft.mint}
                  onClick={() => selectNFT(nft)}
                  disabled={setting === nft.mint}
                  className="relative rounded-md overflow-hidden aspect-square group transition-all"
                  style={{ border: "2px solid var(--border)" }}
                >
                  {nft.image ? (
                    <img loading="lazy" src={nft.image} alt={nft.name || "NFT"} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center" style={{ background: "var(--bg-secondary)" }}>
                      <Image className="w-6 h-6" style={{ color: "var(--text-tertiary)" }} />
                    </div>
                  )}
                  <div
                    className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ background: "rgba(0,0,0,0.6)" }}
                  >
                    {setting === nft.mint ? (
                      <Loader2 className="w-5 h-5 text-white animate-spin" />
                    ) : (
                      <span className="text-white text-xs font-medium">Select</span>
                    )}
                  </div>
                  {nft.name && (
                    <div
                      className="absolute bottom-0 left-0 right-0 px-1.5 py-0.5 text-xs truncate"
                      style={{ background: "rgba(0,0,0,0.7)", color: "white", fontSize: "10px" }}
                    >
                      {nft.name}
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
