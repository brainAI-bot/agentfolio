"use client";

import { useState, useEffect, useCallback } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { Flame, AlertTriangle, Check, Loader2, X, Image, Skull, Shield, ExternalLink } from "lucide-react";
import BirthCertificate from "./BirthCertificate";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://agentfolio.bot";
const API = process.env.NEXT_PUBLIC_API_URL || SITE_URL;
const SOLANA_CLUSTER = process.env.NEXT_PUBLIC_SOLANA_CLUSTER || "mainnet-beta";
const solanaExplorerUrl = (path: string) => SOLANA_CLUSTER === "mainnet-beta" ? `https://explorer.solana.com/${path}` : `https://explorer.solana.com/${path}?cluster=${SOLANA_CLUSTER}`;

interface NFT {
  mint: string;
  name: string | null;
  image: string | null;
  collection: string | null;
}

interface BurnState {
  step: "browse" | "preview" | "confirm" | "burning" | "success" | "error";
  selectedNFT: NFT | null;
  burnProgress: {
    arweave: "pending" | "active" | "complete" | "error";
    burn: "pending" | "active" | "complete" | "error";
    soulbound: "pending" | "active" | "complete" | "error";
    lock: "pending" | "active" | "complete" | "error";
  };
  error: string | null;
  result: any;
}

interface Props {
  profileId: string;
  walletAddress: string;
  apiKey: string;
  currentAvatar?: { image: string; permanent?: boolean } | null;
  onComplete?: (avatar: any) => void;
}

const STEPS = [
  { key: "arweave", label: "Preparing burn", icon: "🌐" },
  { key: "burn", label: "Burning NFT on-chain", icon: "🔥" },
  { key: "soulbound", label: "Minting Soulbound Token", icon: "🛡️" },
  { key: "lock", label: "Locking Avatar Forever", icon: "🔒" },
] as const;

function isVersionedSerializedTransaction(raw: Uint8Array): boolean {
  let offset = 0;
  let sigCount = 0;
  let shift = 0;
  while (offset < raw.length) {
    const byte = raw[offset];
    sigCount |= (byte & 0x7f) << shift;
    offset += 1;
    if ((byte & 0x80) === 0) break;
    shift += 7;
  }
  const messageOffset = offset + sigCount * 64;
  return messageOffset < raw.length && (raw[messageOffset] & 0x80) !== 0;
}

async function deserializeBurnTransaction(base64Tx: string) {
  const { Transaction, VersionedTransaction } = await import("@solana/web3.js");
  const raw = Uint8Array.from(Buffer.from(base64Tx, "base64"));
  return isVersionedSerializedTransaction(raw) ? VersionedTransaction.deserialize(raw) : Transaction.from(Buffer.from(raw));
}

export default function BurnToBecome({ profileId, walletAddress, apiKey, currentAvatar, onComplete }: Props) {
  const { connection } = useConnection();
  const { sendTransaction, signTransaction } = useWallet();
  const [nfts, setNfts] = useState<NFT[]>([]);
  const [loading, setLoading] = useState(true);
  const [state, setState] = useState<BurnState>({
    step: "browse",
    selectedNFT: null,
    burnProgress: { arweave: "pending", burn: "pending", soulbound: "pending", lock: "pending" },
    error: null,
    result: null,
  });

  // If already has permanent avatar, show locked state
  if (currentAvatar?.permanent) {
    return (
      <div className="rounded-xl border p-8 text-center" style={{ background: "var(--bg-secondary)", borderColor: "var(--accent)" }}>
        <div className="mb-4">
          <div className="w-32 h-32 mx-auto rounded-full overflow-hidden border-4" style={{ borderColor: "var(--accent)" }}>
            <img loading="lazy" src={currentAvatar.image} alt="Permanent Avatar" className="w-full h-full object-cover" />
          </div>
        </div>
        <div className="flex items-center justify-center gap-2 mb-2">
          <Shield size={20} style={{ color: "var(--accent)" }} />
          <span className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>This is you, forever.</span>
        </div>
        <p className="text-sm" style={{ color: "var(--text-tertiary)" }}>
          Soulbound avatar — permanently locked on-chain. No changes. No undo.
        </p>
      </div>
    );
  }

  // Fetch wallet NFTs
  useEffect(() => {
    if (!walletAddress) return;
    setLoading(true);
    fetch(`${API}/api/burn-to-become/wallet-nfts?wallet=${encodeURIComponent(walletAddress)}`)
      .then((r) => r.json())
      .then((data) => {
        const rawNfts = Array.isArray(data?.nfts) ? data.nfts : [];
        const burnable = rawNfts.filter((nft: any) => {
          const name = String(nft?.name || "").toLowerCase();
          return !name.includes("soulbound") && !name.includes("soul bound") && !name.includes("soul-bound");
        });
        setNfts(burnable);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [walletAddress]);

  const selectNFT = (nft: NFT) => {
    setState((s) => ({ ...s, step: "preview", selectedNFT: nft }));
  };

  const goBack = () => {
    setState((s) => ({ ...s, step: "browse", selectedNFT: null, error: null }));
  };

  const confirmBurn = () => {
    setState((s) => ({ ...s, step: "confirm" }));
  };

  const executeBurn = async () => {
    if (!state.selectedNFT) return;

    setState((s) => ({
      ...s,
      step: "burning",
      burnProgress: { arweave: "active", burn: "pending", soulbound: "pending", lock: "pending" },
    }));

    try {
      if (!sendTransaction && !signTransaction) {
        throw new Error("Solana wallet not connected. Please connect your wallet.");
      }

      const prepRes = await fetch(`${API}/api/burn-to-become/prepare`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wallet: walletAddress,
          nftMint: state.selectedNFT.mint,
        }),
      });
      const prepData = await prepRes.json().catch(() => ({}));
      if (!prepRes.ok) throw new Error(prepData.error || "Failed to prepare burn");

      setState((s) => ({
        ...s,
        burnProgress: { ...s.burnProgress, arweave: "complete", burn: "active" },
      }));

      const tx = await deserializeBurnTransaction(prepData.transaction);
      const submitPayload: Record<string, string> = {
        wallet: walletAddress,
        nftMint: state.selectedNFT.mint,
      };
      if (sendTransaction) {
        const burnSignature = await sendTransaction(tx as any, connection, { skipPreflight: false });
        submitPayload.txSignature = burnSignature;
        submitPayload.submissionMode = "sendTransaction";
      } else if (signTransaction) {
        const signed = await signTransaction(tx as any);
        submitPayload.signedTransaction = Buffer.from(signed.serialize()).toString("base64");
        submitPayload.submissionMode = "signTransaction";
      } else {
        throw new Error("Connected wallet cannot sign burn transaction");
      }

      const submitRes = await fetch(`${API}/api/burn-to-become/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(submitPayload),
      });
      const submitData = await submitRes.json().catch(() => ({}));
      if (!submitRes.ok) throw new Error(submitData.error || "Burn failed");

      setState((s) => ({
        ...s,
        burnProgress: { ...s.burnProgress, burn: "complete", soulbound: "active" },
      }));

      if (submitData.burnToBecomeTx && (sendTransaction || signTransaction)) {
        try {
          const burnToBecomeTx = await deserializeBurnTransaction(submitData.burnToBecomeTx);
          const genesisPayload: Record<string, string> = {};
          if (sendTransaction) {
            const genesisSignature = await sendTransaction(burnToBecomeTx as any, connection, { skipPreflight: false });
            genesisPayload.txSignature = genesisSignature;
            genesisPayload.submissionMode = "sendTransaction";
          } else if (signTransaction) {
            const signedGenesis = await signTransaction(burnToBecomeTx as any);
            genesisPayload.signedTransaction = Buffer.from(signedGenesis.serialize()).toString("base64");
            genesisPayload.submissionMode = "signTransaction";
          }
          await fetch(`${API}/api/burn-to-become/submit-genesis`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(genesisPayload),
          });
        } catch (genesisErr) {
          console.warn("[BurnToBecome] submit-genesis failed (non-critical):", genesisErr);
        }
      }

      setState((s) => ({
        ...s,
        burnProgress: { ...s.burnProgress, soulbound: "complete", lock: "active" },
      }));

      const avatar = {
        image: submitData.artworkUri || state.selectedNFT?.image || null,
        arweaveUrl: submitData.artworkUri || null,
        burnTxSignature: submitData.burnTx || null,
        soulboundMint: submitData.soulboundMint || null,
        permanent: true,
        name: state.selectedNFT?.name || "Soulbound Avatar",
      };

      setState((s) => ({
        ...s,
        step: "success",
        burnProgress: { arweave: "complete", burn: "complete", soulbound: "complete", lock: "complete" },
        result: { ...submitData, avatar },
      }));

      onComplete?.(avatar);
    } catch (e: any) {
      setState((s) => ({
        ...s,
        step: "error",
        error: e.message || "Burn failed",
      }));
    }
  };

  // ── RENDER ──

  // Browse NFTs
  if (state.step === "browse") {
    return (
      <div className="rounded-xl border p-6" style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}>
        <div className="flex items-center gap-3 mb-6">
          <Flame size={24} className="text-orange-500" />
          <div>
            <h2 className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>Burn to Become</h2>
            <p className="text-sm" style={{ color: "var(--text-tertiary)" }}>
              Sacrifice an NFT to forge your permanent identity
            </p>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 size={24} className="animate-spin" style={{ color: "var(--text-tertiary)" }} />
            <span className="ml-2" style={{ color: "var(--text-tertiary)" }}>Loading your NFTs...</span>
          </div>
        ) : nfts.length === 0 ? (
          <div className="text-center py-12">
            <Image size={48} className="mx-auto mb-4" style={{ color: "var(--text-tertiary)" }} />
            <p style={{ color: "var(--text-secondary)" }}>No NFTs found in your wallet</p>
            <p className="text-sm mt-1" style={{ color: "var(--text-tertiary)" }}>
              Connect a wallet with NFTs to use Burn to Become
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {nfts.map((nft) => (
              <button
                key={nft.mint}
                onClick={() => selectNFT(nft)}
                className="rounded-lg overflow-hidden border transition-all hover:scale-[1.02] hover:border-orange-500 text-left"
                style={{ background: "var(--bg-primary)", borderColor: "var(--border)" }}
              >
                <div className="aspect-square bg-black/20">
                  {nft.image ? (
                    <img loading="lazy" src={nft.image} alt={nft.name || "NFT"} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Image size={32} style={{ color: "var(--text-tertiary)" }} />
                    </div>
                  )}
                </div>
                <div className="p-2">
                  <div className="text-xs font-medium truncate" style={{ color: "var(--text-primary)" }}>
                    {nft.name || "Unknown NFT"}
                  </div>
                  <div className="text-[10px] truncate" style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>
                    {nft.mint.slice(0, 8)}...{nft.mint.slice(-4)}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Preview selected NFT
  if (state.step === "preview" && state.selectedNFT) {
    return (
      <div className="rounded-xl border p-6" style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}>
        <button onClick={goBack} className="flex items-center gap-1 mb-6 text-sm hover:underline" style={{ color: "var(--text-tertiary)" }}>
          ← Back to NFTs
        </button>

        <div className="flex flex-col items-center">
          <div className="w-48 h-48 rounded-xl overflow-hidden border-2 mb-6" style={{ borderColor: "#f97316" }}>
            {state.selectedNFT.image ? (
              <img loading="lazy" src={state.selectedNFT.image} alt={state.selectedNFT.name || "NFT"} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-black/20">
                <Image size={48} style={{ color: "var(--text-tertiary)" }} />
              </div>
            )}
          </div>

          <h3 className="text-lg font-bold mb-1" style={{ color: "var(--text-primary)" }}>
            {state.selectedNFT.name || "Unknown NFT"}
          </h3>
          <p className="text-xs mb-6" style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>
            {state.selectedNFT.mint}
          </p>

          <div className="w-full rounded-lg border p-4 mb-6" style={{ borderColor: "#f97316", background: "rgba(249, 115, 22, 0.05)" }}>
            <div className="flex items-start gap-3">
              <AlertTriangle size={20} className="flex-shrink-0 mt-0.5" style={{ color: "#f97316" }} />
              <div>
                <p className="font-bold text-sm mb-1" style={{ color: "#f97316" }}>This is permanent.</p>
                <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
                  Your NFT will be <strong>burned on-chain</strong>. The image will be uploaded to Arweave forever.
                  A soulbound token will be minted as your permanent face. <strong>There is no undo.</strong>
                </p>
              </div>
            </div>
          </div>

          <button
            onClick={confirmBurn}
            className="px-8 py-3 rounded-lg font-bold text-white transition-all hover:scale-[1.02]"
            style={{ background: "linear-gradient(135deg, #f97316, #ef4444)" }}
          >
            <span className="flex items-center gap-2">
              <Flame size={18} /> I understand — proceed to burn
            </span>
          </button>
        </div>
      </div>
    );
  }

  // Final confirmation
  if (state.step === "confirm" && state.selectedNFT) {
    return (
      <div className="rounded-xl border p-6" style={{ background: "var(--bg-secondary)", borderColor: "#ef4444" }}>
        <div className="flex flex-col items-center text-center">
          <Skull size={48} className="mb-4" style={{ color: "#ef4444" }} />
          <h2 className="text-2xl font-bold mb-2" style={{ color: "#ef4444" }}>Final Confirmation</h2>
          <p className="text-sm mb-6" style={{ color: "var(--text-secondary)" }}>
            You are about to permanently burn <strong>{state.selectedNFT.name || state.selectedNFT.mint.slice(0, 12) + "..."}</strong>.
            <br />This action is <strong>irreversible</strong>.
          </p>

          <div className="w-24 h-24 rounded-full overflow-hidden border-2 mb-6 opacity-75" style={{ borderColor: "#ef4444" }}>
            {state.selectedNFT.image && (
              <img loading="lazy" src={state.selectedNFT.image} alt="" className="w-full h-full object-cover" />
            )}
          </div>

          <div className="flex gap-3">
            <button
              onClick={goBack}
              className="px-6 py-3 rounded-lg font-medium border"
              style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
            >
              Cancel
            </button>
            <button
              onClick={executeBurn}
              className="px-8 py-4 rounded-lg font-bold text-white text-lg transition-all hover:scale-[1.05]"
              style={{ background: "#ef4444", boxShadow: "0 0 30px rgba(239, 68, 68, 0.3)" }}
            >
              🔥 BURN IT — BECOME FOREVER
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Burning in progress
  if (state.step === "burning") {
    return (
      <div className="rounded-xl border p-8" style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}>
        <div className="text-center mb-8">
          <Flame size={40} className="mx-auto mb-3 animate-pulse" style={{ color: "#f97316" }} />
          <h2 className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>Becoming...</h2>
          <p className="text-sm" style={{ color: "var(--text-tertiary)" }}>Do not close this window</p>
        </div>

        <div className="space-y-4 max-w-md mx-auto">
          {STEPS.map(({ key, label, icon }) => {
            const status = state.burnProgress[key as keyof typeof state.burnProgress];
            return (
              <div key={key} className="flex items-center gap-3">
                <div className="w-8 h-8 flex items-center justify-center">
                  {status === "complete" ? (
                    <Check size={20} style={{ color: "#10b981" }} />
                  ) : status === "active" ? (
                    <Loader2 size={20} className="animate-spin" style={{ color: "#f97316" }} />
                  ) : status === "error" ? (
                    <X size={20} style={{ color: "#ef4444" }} />
                  ) : (
                    <span className="text-lg opacity-30">{icon}</span>
                  )}
                </div>
                <span
                  className="text-sm font-medium"
                  style={{
                    color:
                      status === "complete" ? "#10b981" : status === "active" ? "var(--text-primary)" : "var(--text-tertiary)",
                  }}
                >
                  {label}
                  {status === "active" && "..."}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // Success
  if (state.step === "success") {
    const avatar = state.result?.avatar;
    return (
      <div className="rounded-xl border p-8 text-center" style={{ background: "var(--bg-secondary)", borderColor: "var(--accent)" }}>
        <div className="mb-6">
          <div
            className="w-40 h-40 mx-auto rounded-full overflow-hidden border-4"
            style={{ borderColor: "var(--accent)", boxShadow: "0 0 40px rgba(var(--accent-rgb), 0.3)" }}
          >
            {avatar?.image && <img loading="lazy" src={avatar.image} alt="Your permanent face" className="w-full h-full object-cover" />}
          </div>
        </div>

        <h2 className="text-2xl font-bold mb-2" style={{ color: "var(--text-primary)" }}>This is you, forever.</h2>
        <p className="text-sm mb-4" style={{ color: "var(--text-tertiary)" }}>
          Your NFT has been burned. Your soulbound identity is minted. No changes. No undo.
        </p>

        {avatar?.burnTxSignature && (
          <a
            href={solanaExplorerUrl(`tx/${avatar.burnTxSignature}`)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm hover:underline"
            style={{ color: "var(--accent)" }}
          >
            View burn transaction <ExternalLink size={12} />
          </a>
        )}

        {avatar?.arweaveUrl && avatar.arweaveUrl.includes("arweave.net") && (
          <div className="mt-2">
            <a
              href={avatar.arweaveUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm hover:underline"
              style={{ color: "var(--accent)" }}
            >
              View on Arweave (permanent) <ExternalLink size={12} />
            </a>
          </div>
        )}

        {/* Genesis Record */}
        <div className="mt-6">
          <BirthCertificate
            profileId={profileId}
            profileName={state.result?.avatar?.name}
            apiKey={apiKey}
            autoGenerate={true}
            burnTxSignature={state.result?.avatar?.burnTxSignature}
            arweaveUrl={state.result?.avatar?.arweaveUrl}
          />
        </div>
      </div>

    );
  }

  // Error
  if (state.step === "error") {
    return (
      <div className="rounded-xl border p-8 text-center" style={{ background: "var(--bg-secondary)", borderColor: "#ef4444" }}>
        <X size={40} className="mx-auto mb-3" style={{ color: "#ef4444" }} />
        <h2 className="text-xl font-bold mb-2" style={{ color: "#ef4444" }}>Burn Failed</h2>
        <p className="text-sm mb-6" style={{ color: "var(--text-secondary)" }}>{state.error}</p>
        <button
          onClick={goBack}
          className="px-6 py-2 rounded-lg border font-medium"
          style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
        >
          Try Again
        </button>
      </div>
    );
  }

  return null;
}
