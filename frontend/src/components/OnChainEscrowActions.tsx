"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { Transaction, VersionedTransaction } from "@solana/web3.js";
import { Shield, Wallet, ArrowRight, CheckCircle, AlertTriangle, Loader2 } from "lucide-react";
import { createMarketplaceWalletAuth } from "@/lib/marketplace-auth";
import { resolveAgentWallet } from "@/lib/v3-escrow";

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

export function OnChainEscrowActions({
  jobId, jobStatus, escrowStatus, escrowId, clientId, assigneeId, budget, onchainEscrowPDA
}: Props) {
  const { publicKey, connected, signMessage, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const [step, setStep] = useState<Step>("idle");
  const [msg, setMsg] = useState("");
  const [action, setAction] = useState<EscrowAction | null>(null);
  const [resolvedId, setResolvedId] = useState<string | null>(null);

  const walletAddr = publicKey?.toBase58() || "";
  const budgetLabel = formatBudgetLabel(budget);

  useEffect(() => {
    if (!connected || !walletAddr) {
      setResolvedId(null);
      return;
    }
    let cancelled = false;
    fetch(`${API_BASE}/api/profile-by-wallet?wallet=${walletAddr}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled) setResolvedId(data?.id || null);
      })
      .catch(() => {
        if (!cancelled) setResolvedId(null);
      });
    return () => {
      cancelled = true;
    };
  }, [connected, walletAddr]);

  const actorId = resolvedId || clientId || walletAddr;
  const isPoster = useMemo(() => {
    if (!clientId) return !!walletAddr;
    return clientId === resolvedId || clientId === walletAddr;
  }, [clientId, resolvedId, walletAddr]);

  const executeAction = useCallback(async (actionType: EscrowAction) => {
    if (!publicKey || !sendTransaction || !signMessage) {
      setMsg("Connect a wallet that supports signing first");
      setStep("error");
      return;
    }
    if (!actorId) {
      setMsg("Could not resolve the poster profile for this wallet");
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
      const txBytes = Uint8Array.from(Buffer.from(buildData.transaction, "base64"));
      const isVersioned = (txBytes[0] & 0x80) !== 0;
      const tx = isVersioned
        ? VersionedTransaction.deserialize(txBytes)
        : Transaction.from(Buffer.from(txBytes));
      const txSignature = await sendTransaction(tx as any, connection);
      await connection.confirmTransaction(txSignature, "confirmed");

      setStep("confirming");
      if (actionType === "fund") {
        confirmBody = {
          txSignature,
          escrowPDA: buildData.escrowPDA,
          clientWallet: walletAddr,
        };
        authEscrowId = buildData.escrowPDA || authEscrowId;
      } else {
        confirmBody = {
          ...confirmBody,
          txSignature,
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
  }, [publicKey, sendTransaction, signMessage, actorId, isPoster, jobId, escrowId, onchainEscrowPDA, walletAddr, budget, assigneeId, connection]);

  const posterGate = !publicKey || isPoster;
  const canFund = posterGate && jobStatus === "in_progress" && !onchainEscrowPDA && escrowStatus !== "released" && !!assigneeId;
  const canRelease = posterGate && !!onchainEscrowPDA && !!escrowId && jobStatus !== "completed" && escrowStatus !== "released";
  const canRefund = posterGate && !!onchainEscrowPDA && !!escrowId && jobStatus !== "completed" && escrowStatus !== "released";

  if (!canFund && !canRelease && !canRefund) {
    if (onchainEscrowPDA) {
      return (
        <div className="mt-4 p-4 rounded-xl" style={{ background: "rgba(153,69,255,0.06)", border: "1px solid rgba(153,69,255,0.15)" }}>
          <div className="flex items-center gap-2 text-xs" style={{ fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
            <Shield size={14} style={{ color: "#9945ff" }} />
            On-chain escrow: <a href={`${solanaExplorerUrl(`account/${onchainEscrowPDA}`)}`} target="_blank" rel="noopener" className="underline" style={{ color: "#9945ff" }}>{onchainEscrowPDA.slice(0, 8)}...{onchainEscrowPDA.slice(-4)}</a>
          </div>
          {publicKey && !isPoster && (
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
            disabled={isProcessing || !publicKey}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: "#9945ff", color: "#fff" }}
            title={!publicKey ? "Connect your Solana wallet to fund escrow" : undefined}
          >
            {isProcessing && action === "fund" ? <Loader2 size={14} className="animate-spin" /> : <Wallet size={14} />}
            {publicKey ? `Fund Escrow (${budgetLabel})` : `Connect Wallet to Fund Escrow (${budgetLabel})`}
          </button>
        )}

        {canRelease && (
          <button
            onClick={() => publicKey ? executeAction("release") : null}
            disabled={isProcessing || !publicKey}
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
            disabled={isProcessing || !publicKey}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: "rgba(239,68,68,0.15)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.3)" }}
            title={!publicKey ? "Connect your Solana wallet to refund escrow" : undefined}
          >
            {isProcessing && action === "refund" ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />}
            {publicKey ? "Refund" : "Connect Wallet to Refund"}
          </button>
        )}
      </div>

      {!publicKey && (canFund || canRelease || canRefund) && (
        <div className="mt-3 flex items-center gap-2 text-xs" style={{ fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
          <Wallet size={12} />
          Connect the poster wallet to sign and broadcast the escrow transaction.
        </div>
      )}

      {publicKey && !isPoster && (
        <div className="mt-3 flex items-center gap-2 text-xs" style={{ fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
          <AlertTriangle size={12} />
          Only the job poster wallet can fund, release, or refund escrow.
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
