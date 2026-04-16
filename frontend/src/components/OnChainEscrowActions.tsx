"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { Transaction, VersionedTransaction } from "@solana/web3.js";
import { Shield, Wallet, ArrowRight, CheckCircle, AlertTriangle, Loader2 } from "lucide-react";
import { createMarketplaceWalletAuth } from "@/lib/marketplace-auth";
import { resolveAgentWallet } from "@/lib/v3-escrow";
import { profileHasWallet } from "@/lib/profile-wallets";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";
const SOLANA_CLUSTER = process.env.NEXT_PUBLIC_SOLANA_CLUSTER || "mainnet-beta";
const SOLANA_EXPLORER_SUFFIX = SOLANA_CLUSTER === "mainnet-beta" ? "" : `?cluster=${SOLANA_CLUSTER}`;
const solanaExplorerUrl = (path: string) => `https://solscan.io/${path}${SOLANA_EXPLORER_SUFFIX}`;

interface Props {
  jobId: string;
  jobStatus: string;
  escrowStatus: string;
  escrowId?: string;
  clientId?: string;
  assigneeId?: string;
  budget: string;
  onchainEscrowPDA?: string;
}

type Step = "idle" | "building" | "signing" | "confirming" | "done" | "error";
type EscrowAction = "fund" | "release" | "refund";

function formatBudgetLabel(budget: string | number | null | undefined): string {
  const raw = String(budget ?? "").trim();
  if (!raw) return "1 USDC";
  return /\busdc\b/i.test(raw) ? raw : `${raw} USDC`;
}

function parseBudgetAmount(budget: string | number | null | undefined): number {
  const parsed = parseFloat(String(budget ?? "").trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
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

function deserializeEscrowTransaction(base64Tx: string): { tx: Transaction | VersionedTransaction; isVersioned: boolean } {
  const raw = Uint8Array.from(Buffer.from(base64Tx, "base64"));
  const isVersioned = isVersionedSerializedTransaction(raw);
  return isVersioned
    ? { tx: VersionedTransaction.deserialize(raw), isVersioned: true }
    : { tx: Transaction.from(Buffer.from(raw)), isVersioned: false };
}

async function signEscrowTransaction(
  tx: Transaction | VersionedTransaction,
  signTransaction?: ((tx: Transaction | VersionedTransaction) => Promise<Transaction | VersionedTransaction>) | null,
): Promise<string> {
  if (!signTransaction) {
    throw new Error("Connected wallet must support signTransaction() for on-chain escrow actions");
  }
  const signedTx = await signTransaction(tx);
  return Buffer.from(signedTx.serialize()).toString("base64");
}

export function OnChainEscrowActions({
  jobId, jobStatus, escrowStatus, escrowId, clientId, assigneeId, budget, onchainEscrowPDA
}: Props) {
  const { publicKey, connected, signMessage, signTransaction } = useWallet();
  const [step, setStep] = useState<Step>("idle");
  const [msg, setMsg] = useState("");
  const [action, setAction] = useState<EscrowAction | null>(null);
  const [resolvedId, setResolvedId] = useState<string | null>(null);
  const [resolvingActor, setResolvingActor] = useState(false);
  const [walletLookupSettled, setWalletLookupSettled] = useState(false);
  const [posterWalletMatch, setPosterWalletMatch] = useState(false);
  const [checkingPosterWallet, setCheckingPosterWallet] = useState(false);
  const [posterWalletCheckSettled, setPosterWalletCheckSettled] = useState(false);

  const walletAddr = publicKey?.toBase58() || "";
  const budgetLabel = formatBudgetLabel(budget);

  useEffect(() => {
    if (!connected || !walletAddr) {
      setResolvedId(null);
      setResolvingActor(false);
      setWalletLookupSettled(false);
      return;
    }
    let cancelled = false;
    setWalletLookupSettled(false);
    setResolvingActor(true);
    const params = new URLSearchParams({ wallet: walletAddr });
    if (clientId) params.set('preferredProfileId', clientId);
    fetch(`${API_BASE}/api/profile-by-wallet?${params.toString()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled) setResolvedId(data?.id || null);
      })
      .catch(() => {
        if (!cancelled) setResolvedId(null);
      })
      .finally(() => {
        if (!cancelled) {
          setResolvingActor(false);
          setWalletLookupSettled(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [connected, walletAddr]);

  useEffect(() => {
    if (!connected || !walletAddr || !clientId) {
      setPosterWalletMatch(false);
      setCheckingPosterWallet(false);
      setPosterWalletCheckSettled(false);
      return;
    }
    let cancelled = false;
    setPosterWalletCheckSettled(false);
    setCheckingPosterWallet(true);
    fetch(`${API_BASE}/api/profile/${encodeURIComponent(clientId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((profile) => {
        if (!cancelled) setPosterWalletMatch(profileHasWallet(profile, walletAddr));
      })
      .catch(() => {
        if (!cancelled) setPosterWalletMatch(false);
      })
      .finally(() => {
        if (!cancelled) {
          setCheckingPosterWallet(false);
          setPosterWalletCheckSettled(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [clientId, connected, walletAddr]);

  const actorId = useMemo(() => {
    if (clientId && (posterWalletMatch || clientId === resolvedId || clientId === walletAddr)) {
      return clientId;
    }
    return resolvedId || clientId || walletAddr;
  }, [clientId, posterWalletMatch, resolvedId, walletAddr]);
  const isPoster = useMemo(() => {
    if (!clientId) return !!walletAddr;
    return posterWalletMatch || clientId === resolvedId || clientId === walletAddr;
  }, [clientId, posterWalletMatch, resolvedId, walletAddr]);
  const posterIdentityPending = !!publicKey && !!clientId && (!walletLookupSettled || !posterWalletCheckSettled);

  const executeAction = useCallback(async (actionType: EscrowAction) => {
    if (!publicKey || !signMessage || !signTransaction) {
      setMsg("Connect a wallet that supports message and transaction signing first");
      setStep("error");
      return;
    }
    if (!actorId) {
      setMsg("Could not resolve a funding actor for this wallet");
      setStep("error");
      return;
    }
    if (posterIdentityPending) {
      setMsg("Still resolving the poster wallet. Please wait a moment and try again.");
      setStep("error");
      return;
    }
    if (!isPoster) {
      setMsg("Only the job poster can manage escrow");
      setStep("error");
      return;
    }

    setAction(actionType);
    setStep("building");
    setMsg("");

    try {
      let buildUrl = "";
      let buildBody: Record<string, any> = {};
      let confirmUrl = "";
      let confirmBody: Record<string, any> = {};
      let authAction = "";
      let authEscrowId = escrowId || onchainEscrowPDA || "";

      if (actionType === "fund") {
        buildUrl = `${API_BASE}/api/marketplace/jobs/${jobId}/escrow/onchain`;
        buildBody = {
          clientWallet: walletAddr,
          amount: parseBudgetAmount(budget),
          deadlineUnix: Math.floor(Date.now() / 1000) + 30 * 86400,
        };
        confirmUrl = `${API_BASE}/api/marketplace/jobs/${jobId}/escrow/confirm`;
        authAction = "confirm_onchain_escrow";
      } else if (actionType === "release") {
        if (!escrowId) throw new Error("Escrow record missing for release");
        if (!assigneeId) throw new Error("No accepted worker assigned to this job");
        const agentWallet = await resolveAgentWallet(assigneeId);
        if (!agentWallet) throw new Error(`Could not resolve wallet for ${assigneeId}`);
        buildUrl = `${API_BASE}/api/marketplace/escrow/${escrowId}/release/onchain`;
        buildBody = { clientWallet: walletAddr, agentWallet };
        confirmUrl = `${API_BASE}/api/marketplace/escrow/${escrowId}/release/confirm`;
        confirmBody = { clientWallet: walletAddr };
        authAction = "confirm_onchain_release";
        authEscrowId = escrowId;
      } else {
        if (!escrowId) throw new Error("Escrow record missing for refund");
        buildUrl = `${API_BASE}/api/marketplace/escrow/${escrowId}/refund/onchain`;
        buildBody = { clientWallet: walletAddr };
        confirmUrl = `${API_BASE}/api/marketplace/escrow/${escrowId}/refund/confirm`;
        confirmBody = { clientWallet: walletAddr };
        authAction = "confirm_onchain_refund";
        authEscrowId = escrowId;
      }

      const buildRes = await fetch(buildUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildBody),
      });
      const buildData = await buildRes.json();
      if (!buildRes.ok || buildData.error) throw new Error(buildData.error || `Failed to build ${actionType} transaction`);

      setStep("signing");
      const { tx } = deserializeEscrowTransaction(buildData.transaction);
      const signedTransaction = await signEscrowTransaction(tx as any, signTransaction);

      setStep("confirming");
      if (actionType === "fund") {
        confirmBody = {
          signedTransaction,
          escrowPDA: buildData.escrowPDA,
          clientWallet: walletAddr,
        };
        authEscrowId = buildData.escrowPDA || authEscrowId;
      } else {
        confirmBody = {
          ...confirmBody,
          signedTransaction,
        };
      }

      const authHeaders = await createMarketplaceWalletAuth({
        action: authAction,
        walletAddress: walletAddr,
        actorId,
        jobId,
        escrowId: authEscrowId,
        signMessage,
      });

      const confirmRes = await fetch(confirmUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify(confirmBody),
      });
      const confirmData = await confirmRes.json();
      if (!confirmRes.ok || confirmData.error) throw new Error(confirmData.error || `Failed to confirm ${actionType}`);

      setStep("done");
      setMsg(
        actionType === "fund" ? "Escrow funded on-chain! 🔒" :
        actionType === "release" ? "Payment released on-chain! ✅" :
        "Escrow refunded on-chain! ↩️"
      );
      setTimeout(() => window.location.reload(), 2500);
    } catch (e: any) {
      setStep("error");
      setMsg(e.message || "Transaction failed");
    }
  }, [publicKey, signTransaction, signMessage, actorId, isPoster, jobId, escrowId, onchainEscrowPDA, walletAddr, budget, assigneeId]);

  const posterGate = isPoster || posterIdentityPending;
  const canFund = (!publicKey || posterGate) && ["open", "awaiting_funding", "in_progress"].includes(jobStatus) && !onchainEscrowPDA && escrowStatus !== "released";
  const canRelease = (!publicKey || (!posterIdentityPending && isPoster)) && !!onchainEscrowPDA && !!escrowId && jobStatus !== "completed" && escrowStatus !== "released";
  const canRefund = (!publicKey || (!posterIdentityPending && isPoster)) && !!onchainEscrowPDA && !!escrowId && jobStatus !== "completed" && escrowStatus !== "released";

  if (!canFund && !canRelease && !canRefund) {
    if (onchainEscrowPDA) {
      return (
        <div className="mt-4 p-4 rounded-xl" style={{ background: "rgba(153,69,255,0.06)", border: "1px solid rgba(153,69,255,0.15)" }}>
          <div className="flex items-center gap-2 text-xs" style={{ fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
            <Shield size={14} style={{ color: "#9945ff" }} />
            On-chain escrow: <a href={`${solanaExplorerUrl(`account/${onchainEscrowPDA}`)}`} target="_blank" rel="noopener" className="underline" style={{ color: "#9945ff" }}>{onchainEscrowPDA.slice(0, 8)}...{onchainEscrowPDA.slice(-4)}</a>
          </div>
          {publicKey && !posterIdentityPending && !isPoster && (
            <div className="mt-2 text-xs" style={{ fontFamily: "var(--font-mono)", color: "var(--text-tertiary)" }}>
              Only the job poster can manage this escrow.
            </div>
          )}
        </div>
      );
    }
    return null;
  }

  const stepLabels: Record<Step, string> = {
    idle: "",
    building: "Building transaction...",
    signing: "Approve in your wallet and broadcast on-chain...",
    confirming: "Recording confirmed on-chain state...",
    done: "",
    error: "",
  };

  const isProcessing = step === "building" || step === "signing" || step === "confirming";

  return (
    <div className="mt-6 rounded-xl p-5" style={{ background: "rgba(153,69,255,0.06)", border: "1px solid rgba(153,69,255,0.2)" }}>
      <div className="flex items-center gap-2 mb-4">
        <Shield size={16} style={{ color: "#9945ff" }} />
        <span className="text-sm font-bold" style={{ fontFamily: "var(--font-mono)", color: "#9945ff" }}>
          ON-CHAIN ESCROW
        </span>
      </div>

      {onchainEscrowPDA && (
        <div className="mb-3 text-xs" style={{ fontFamily: "var(--font-mono)", color: "var(--text-tertiary)" }}>
          PDA: <a href={`${solanaExplorerUrl(`account/${onchainEscrowPDA}`)}`} target="_blank" rel="noopener" className="underline" style={{ color: "#9945ff" }}>{onchainEscrowPDA.slice(0, 12)}...{onchainEscrowPDA.slice(-6)}</a>
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        {canFund && (
          <button
            onClick={() => publicKey ? executeAction("fund") : null}
            disabled={isProcessing || !publicKey || posterIdentityPending}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: "#9945ff", color: "#fff" }}
            title={!publicKey ? "Connect your Solana wallet to fund escrow" : posterIdentityPending ? "Resolving poster wallet before escrow actions are enabled" : undefined}
          >
            {isProcessing && action === "fund" ? <Loader2 size={14} className="animate-spin" /> : posterIdentityPending ? <Loader2 size={14} className="animate-spin" /> : <Wallet size={14} />}
            {publicKey ? (posterIdentityPending ? "Resolving poster wallet..." : `Fund Escrow (${budgetLabel})`) : `Connect Wallet to Fund Escrow (${budgetLabel})`}
          </button>
        )}

        {canRelease && (
          <button
            onClick={() => publicKey ? executeAction("release") : null}
            disabled={isProcessing || !publicKey || posterIdentityPending}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: "#22c55e", color: "#fff" }}
            title={!publicKey ? "Connect your Solana wallet to release escrow" : undefined}
          >
            {isProcessing && action === "release" ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
            {publicKey ? "Release Payment" : "Connect Wallet to Release Payment"}
          </button>
        )}

        {canRefund && (
          <button
            onClick={() => publicKey ? executeAction("refund") : null}
            disabled={isProcessing || !publicKey || posterIdentityPending}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: "rgba(239,68,68,0.15)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.3)" }}
            title={!publicKey ? "Connect your Solana wallet to refund escrow" : undefined}
          >
            {isProcessing && action === "refund" ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />}
            {publicKey ? "Refund" : "Connect Wallet to Refund"}
          </button>
        )}
      </div>

      {publicKey && posterIdentityPending && canFund && (
        <div className="mt-3 flex items-center gap-2 text-xs" style={{ fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
          <Loader2 size={12} className="animate-spin" />
          Resolving the connected wallet to its poster profile so escrow can be funded safely.
        </div>
      )}

      {!publicKey && (canFund || canRelease || canRefund) && (
        <div className="mt-3 flex items-center gap-2 text-xs" style={{ fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
          <Wallet size={12} />
          Connect the poster wallet to sign and broadcast the escrow transaction.
        </div>
      )}

      {publicKey && !posterIdentityPending && !isPoster && (
        <div className="mt-3 flex items-center gap-2 text-xs" style={{ fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
          <AlertTriangle size={12} />
          Only the job poster wallet can complete funding or payout actions. If this is your job, connect the poster wallet and try again.
        </div>
      )}

      {isProcessing && (
        <div className="mt-3 flex items-center gap-2 text-xs" style={{ fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
          <Loader2 size={12} className="animate-spin" />
          {stepLabels[step]}
        </div>
      )}

      {msg && (
        <div className="mt-3 flex items-center gap-2 text-xs" style={{
          fontFamily: "var(--font-mono)",
          color: step === "error" ? "#ef4444" : step === "done" ? "#22c55e" : "var(--text-secondary)"
        }}>
          {step === "error" ? <AlertTriangle size={12} /> : step === "done" ? <CheckCircle size={12} /> : null}
          {msg}
        </div>
      )}
    </div>
  );
}
