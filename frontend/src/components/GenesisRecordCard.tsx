"use client";

import { useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { Shield, ExternalLink, Flame, Loader2, AlertTriangle } from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "";

function isLikelyBroadcastSignature(signature: unknown): signature is string {
  return typeof signature === "string" && signature.length >= 80 && signature.length <= 100 && !/^1+$/.test(signature);
}

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

async function deserializeBirthTransaction(base64Tx: string) {
  const { Transaction, VersionedTransaction } = await import("@solana/web3.js");
  const raw = Uint8Array.from(Buffer.from(base64Tx, "base64"));
  return isVersionedSerializedTransaction(raw) ? VersionedTransaction.deserialize(raw) : Transaction.from(Buffer.from(raw));
}

interface GenesisData {
  pda: string;
  agentName: string;
  description: string;
  category: string;
  verificationLevel: number;
  verificationLabel: string;
  reputationScore: number;
  reputationPct: string;
  isBorn: boolean;
  bornAt: number | null;
  faceImage: string;
  faceMint: string;
  faceBurnTx: string;
  createdAt: number;
  authority: string;
}

interface NftAvatar {
  image?: string;
  arweaveUrl?: string;
  permanent?: boolean;
  burnTxSignature?: string;
  verifiedAt?: string;
  name?: string;
}

export function GenesisRecordCard({ agentId, nftAvatar }: { agentId: string; nftAvatar?: NftAvatar }) {
  const { connection } = useConnection();
  const { publicKey, sendTransaction, signTransaction } = useWallet();
  const [genesis, setGenesis] = useState<GenesisData | null>(null);
  const [recoveringBirth, setRecoveringBirth] = useState(false);
  const [recoverMessage, setRecoverMessage] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
        fetch(`/api/profile/${agentId}/genesis`).then(r => r.json()).catch(() => ({})),
        fetch(`/api/profile/${agentId}/trust-score`).then(r => r.json()).catch(() => ({})),
      ]).then(([gRes, tsRes]) => {
        const g = gRes.genesis;
        if (!g || g.error) return;
        // Merge trust-score DB-enriched data for face/born
        if (tsRes.data) {
          g.isBorn = tsRes.data.isBorn ?? g.isBorn;
          g.bornAt = tsRes.data.bornAt ?? g.bornAt;
          g.faceImage = tsRes.data.faceImage || g.faceImage || "";
          g.faceMint = tsRes.data.faceMint || g.faceMint || "";
          g.verificationLevel = tsRes.data.verificationLevel ?? g.verificationLevel;
          g.verificationLabel = tsRes.data.verificationLabel || g.verificationLabel;
          g.reputationScore = tsRes.data.reputationScore ?? g.reputationScore;
        }
        setGenesis(g);
      }).catch(() => {});
  }, [agentId]);

  if (!genesis) return null;

  // Get face image: prefer nft_avatar (DB has burn data), fallback to on-chain faceImage
  const faceUrl = nftAvatar?.arweaveUrl || nftAvatar?.image || genesis.faceImage || null;
  const isBorn = genesis.isBorn || nftAvatar?.permanent;
  const burnTx = genesis.faceBurnTx || nftAvatar?.burnTxSignature || null;
  const burnDate = genesis.bornAt
    ? (typeof genesis.bornAt === 'string' ? new Date(genesis.bornAt) : new Date(genesis.bornAt * 1000))
    : nftAvatar?.verifiedAt
    ? new Date(nftAvatar.verifiedAt)
    : null;

  const authorityWallet = genesis.authority || "";
  const connectedWallet = publicKey?.toBase58() || "";
  const canRecoverBirth = !isBorn && !!faceUrl && !!genesis.faceMint && !!burnTx;
  const isAuthorityWallet = !!connectedWallet && !!authorityWallet && connectedWallet === authorityWallet;

  const handleRecoverBirth = async () => {
    if (!genesis || !faceUrl || !genesis.faceMint || !burnTx) return;
    if (!publicKey || (!sendTransaction && !signTransaction)) {
      setRecoverMessage("Connect the authority wallet to complete this birth.");
      return;
    }
    if (authorityWallet && publicKey.toBase58() !== authorityWallet) {
      setRecoverMessage(`Wrong wallet connected. Birth must be signed by ${authorityWallet.slice(0, 8)}...${authorityWallet.slice(-6)}.`);
      return;
    }

    setRecoveringBirth(true);
    setRecoverMessage(null);
    try {
      const prepRes = await fetch(`${API}/api/burn-to-become/prepare-birth`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId,
          faceImage: faceUrl,
          faceMint: genesis.faceMint,
          faceBurnTx: burnTx,
        }),
      });
      const prepData = await prepRes.json().catch(() => ({}));
      if (!prepRes.ok) throw new Error(prepData.error || "Failed to prepare birth recovery transaction");

      const tx = await deserializeBirthTransaction(prepData.transaction);
      const submitPayload: Record<string, string> = {};
      if (sendTransaction) {
        const signature = await sendTransaction(tx as any, connection, { skipPreflight: false });
        if (isLikelyBroadcastSignature(signature)) {
          submitPayload.txSignature = signature;
          submitPayload.submissionMode = "sendTransaction";
        } else if (signTransaction) {
          const signed = await signTransaction(tx as any);
          submitPayload.signedTransaction = Buffer.from(signed.serialize()).toString("base64");
          submitPayload.submissionMode = "signTransaction";
        } else {
          throw new Error("Wallet returned an invalid birth transaction signature");
        }
      } else if (signTransaction) {
        const signed = await signTransaction(tx as any);
        submitPayload.signedTransaction = Buffer.from(signed.serialize()).toString("base64");
        submitPayload.submissionMode = "signTransaction";
      } else {
        throw new Error("Connected wallet cannot sign birth recovery transaction");
      }

      const submitRes = await fetch(`${API}/api/burn-to-become/submit-genesis`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(submitPayload),
      });
      const submitData = await submitRes.json().catch(() => ({}));
      if (!submitRes.ok) throw new Error(submitData.error || "Failed to submit birth recovery transaction");

      setGenesis((prev) => prev ? { ...prev, isBorn: true, bornAt: prev.bornAt || Math.floor(Date.now() / 1000) } : prev);
      setRecoverMessage("Birth completed on-chain.");
    } catch (err: any) {
      setRecoverMessage(err?.message || "Birth recovery failed");
    } finally {
      setRecoveringBirth(false);
    }
  };

  // Level color coding
  const levelColor = genesis.verificationLevel >= 5 ? "#A855F7" :
                     genesis.verificationLevel >= 4 ? "#3B82F6" :
                     genesis.verificationLevel >= 3 ? "#10B981" :
                     genesis.verificationLevel >= 2 ? "#F59E0B" : "var(--text-secondary)";

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
      {/* Header */}
      <div className="px-4 py-3 flex items-center gap-2" style={{ borderBottom: "1px solid var(--border)", background: "rgba(153,69,255,0.04)" }}>
        <Shield size={14} style={{ color: "var(--accent)" }} />
        <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ fontFamily: "var(--font-mono)", color: "var(--accent)" }}>
          Genesis Record
        </span>
        {isBorn && (
          <span className="ml-auto flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-semibold" style={{ background: "rgba(249,115,22,0.15)", color: "#F97316" }}>
            <Flame size={10} /> BORN
          </span>
        )}
      </div>

      {/* ID Card Body */}
      <div className="p-4">
        <div className="flex gap-4">
          {/* Left: Face / Soulbound NFT */}
          <div className="shrink-0">
            {faceUrl ? (
              <div className="relative">
                <img
                  src={faceUrl}
                  alt={`${genesis.agentName} face`}
                  className="w-20 h-20 rounded-lg object-cover"
                  style={{ border: isBorn ? "2px solid #F97316" : "2px solid var(--border)" }}
                />
                {isBorn && (
                  <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center text-[10px]" style={{ background: "#F97316", color: "#fff" }}>
                    🔥
                  </div>
                )}
              </div>
            ) : (
              <div className="w-20 h-20 rounded-lg flex items-center justify-center" style={{ background: "var(--bg-tertiary)", border: "2px dashed var(--border)" }}>
                <span className="text-[10px] text-center px-1" style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>
                  No face
                </span>
              </div>
            )}
          </div>

          {/* Right: Identity Info */}
          <div className="flex-1 space-y-2 text-xs" style={{ fontFamily: "var(--font-mono)" }}>
            <div>
              <div className="text-[10px] uppercase tracking-wider" style={{ color: "var(--text-tertiary)" }}>Agent</div>
              <div className="font-semibold" style={{ color: "var(--text-primary)" }}>{genesis.agentName}</div>
            </div>

            {genesis.description && (
              <div>
                <div className="text-[10px] uppercase tracking-wider" style={{ color: "var(--text-tertiary)" }}>Description</div>
                <div style={{ color: "var(--text-secondary)" }}>{genesis.description}</div>
              </div>
            )}

            {/* Level + Trust Score row */}
            <div className="flex gap-4">
              {genesis.verificationLevel > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider" style={{ color: "var(--text-tertiary)" }}>Level</div>
                  <div className="font-semibold" style={{ color: levelColor }}>
                    L{genesis.verificationLevel}{genesis.verificationLabel ? ` · ${genesis.verificationLabel}` : ""}
                  </div>
                </div>
              )}
              {genesis.reputationScore > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider" style={{ color: "var(--text-tertiary)" }}>Trust</div>
                  <div className="font-semibold" style={{ color: levelColor }}>
                    {genesis.reputationScore}
                  </div>
                </div>
              )}
            </div>

            {isBorn && burnDate && (
              <div>
                <div className="text-[10px] uppercase tracking-wider" style={{ color: "var(--text-tertiary)" }}>Burn Date</div>
                <div style={{ color: "#F97316" }}>
                  {burnDate.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}
                </div>
              </div>
            )}

          </div>
        </div>

        {canRecoverBirth && (
          <div className="mt-3 rounded-lg p-3" style={{ background: "rgba(249,115,22,0.08)", border: "1px solid rgba(249,115,22,0.25)" }}>
            <div className="flex items-start gap-2">
              <AlertTriangle size={14} style={{ color: "#F97316", marginTop: 2 }} />
              <div className="flex-1">
                <div className="text-[11px] font-semibold uppercase tracking-wider mb-1" style={{ color: "#F97316", fontFamily: "var(--font-mono)" }}>
                  Birth Recovery Available
                </div>
                <div className="text-xs" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-mono)" }}>
                  This agent has burn evidence but is not yet marked born on-chain. The authority wallet can finish the final genesis signature here.
                </div>
                {authorityWallet && (
                  <div className="mt-2 text-[10px]" style={{ color: isAuthorityWallet ? "#10B981" : "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>
                    {connectedWallet
                      ? isAuthorityWallet
                        ? `Authority wallet connected: ${connectedWallet.slice(0, 8)}...${connectedWallet.slice(-6)}`
                        : `Connect authority wallet ${authorityWallet.slice(0, 8)}...${authorityWallet.slice(-6)} to recover`
                      : `Required authority: ${authorityWallet.slice(0, 8)}...${authorityWallet.slice(-6)}`}
                  </div>
                )}
                <button
                  onClick={handleRecoverBirth}
                  disabled={recoveringBirth || !isAuthorityWallet}
                  className="mt-3 inline-flex items-center gap-2 rounded-md px-3 py-2 text-xs font-semibold transition-opacity"
                  style={{
                    background: !isAuthorityWallet || recoveringBirth ? "var(--bg-tertiary)" : "linear-gradient(135deg, #f97316, #ea580c)",
                    color: !isAuthorityWallet || recoveringBirth ? "var(--text-tertiary)" : "#fff",
                    border: !isAuthorityWallet || recoveringBirth ? "1px solid var(--border)" : "none",
                    cursor: !isAuthorityWallet || recoveringBirth ? "not-allowed" : "pointer",
                    opacity: recoveringBirth ? 0.8 : 1,
                  }}
                >
                  {recoveringBirth ? <Loader2 size={14} className="animate-spin" /> : <Flame size={14} />}
                  {recoveringBirth ? "Completing Birth..." : "Complete Birth"}
                </button>
                {recoverMessage && (
                  <div className="mt-2 text-[10px]" style={{ color: recoverMessage === "Birth completed on-chain." ? "#10B981" : "#F97316", fontFamily: "var(--font-mono)" }}>
                    {recoverMessage}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Footer: PDA + Authority + Burn TX links */}
        <div className="mt-3 pt-3 space-y-1" style={{ borderTop: "1px solid var(--border)" }}>
          {genesis.authority && (
            <div className="flex items-center justify-between text-[10px]" style={{ fontFamily: "var(--font-mono)" }}>
              <span style={{ color: "var(--text-tertiary)" }}>Authority</span>
              <a
                href={`https://explorer.solana.com/address/${genesis.authority}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 hover:underline"
                style={{ color: "var(--text-secondary)" }}
              >
                {genesis.authority.slice(0, 12)}...{genesis.authority.slice(-6)} <ExternalLink size={9} />
              </a>
            </div>
          )}
          <div className="flex items-center justify-between text-[10px]" style={{ fontFamily: "var(--font-mono)" }}>
            <span style={{ color: "var(--text-tertiary)" }}>PDA</span>
            <a
              href={`https://explorer.solana.com/address/${genesis.pda}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 hover:underline"
              style={{ color: "var(--accent)" }}
            >
              {genesis.pda.slice(0, 16)}...{genesis.pda.slice(-8)} <ExternalLink size={9} />
            </a>
          </div>
          {burnTx && (
            <div className="flex items-center justify-between text-[10px]" style={{ fontFamily: "var(--font-mono)" }}>
              <span style={{ color: "var(--text-tertiary)" }}>Burn TX</span>
              <a
                href={`https://solscan.io/tx/${burnTx}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 hover:underline"
                style={{ color: "#F97316" }}
              >
                {burnTx.slice(0, 16)}...{burnTx.slice(-8)} <ExternalLink size={9} />
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
