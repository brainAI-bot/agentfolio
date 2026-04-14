"use client";

import { useState, useCallback } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { Transaction, VersionedTransaction } from "@solana/web3.js";
import { Shield, Wallet, ArrowRight, CheckCircle, AlertTriangle, Loader2 } from "lucide-react";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://agentfolio.bot";
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

function formatBudgetLabel(budget: string | number | null | undefined): string {
  const raw = String(budget ?? "").trim();
  if (!raw) return "1 USDC";
  return /\busdc\b/i.test(raw) ? raw : `${raw} USDC`;
}

export function OnChainEscrowActions({
  jobId, jobStatus, escrowStatus, escrowId, clientId, assigneeId, budget, onchainEscrowPDA
}: Props) {
  const { publicKey, signTransaction } = useWallet();
  const { connection } = useConnection();
  const [step, setStep] = useState<Step>("idle");
  const [msg, setMsg] = useState("");
  const [action, setAction] = useState<"fund" | "release" | "refund" | null>(null);

  const walletAddr = publicKey?.toBase58() || "";
  const budgetLabel = formatBudgetLabel(budget);

  const executeAction = useCallback(async (actionType: "fund" | "release" | "refund") => {
    if (!publicKey || !signTransaction) {
      setMsg("Connect your wallet first");
      setStep("error");
      return;
    }

    setAction(actionType);
    setStep("building");
    setMsg("");

    try {
      // Step 1: Get unsigned transaction from backend
      let buildUrl: string;
      let buildBody: Record<string, any>;

      if (actionType === "fund") {
        buildUrl = `${API_BASE}/api/marketplace/jobs/${jobId}/escrow/onchain`;
        buildBody = {
          clientWallet: walletAddr,
          amount: parseFloat(budget) || 1,
          deadlineUnix: Math.floor(Date.now() / 1000) + 30 * 86400, // 30 days
        };
      } else if (actionType === "release") {
        buildUrl = `${API_BASE}/api/marketplace/escrow/${escrowId}/release/onchain`;
        buildBody = { clientWallet: walletAddr };
      } else {
        buildUrl = `${API_BASE}/api/marketplace/escrow/${escrowId}/refund/onchain`;
        buildBody = { clientWallet: walletAddr };
      }

      const buildRes = await fetch(buildUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildBody),
      });
      const buildData = await buildRes.json();
      if (buildData.error) throw new Error(buildData.error);

      // Step 2: Deserialize and sign
      setStep("signing");
      const txBytes = Uint8Array.from(Buffer.from(buildData.transaction, "base64"));
      const isVersioned = (txBytes[0] & 0x80) !== 0;
      const tx = isVersioned
        ? VersionedTransaction.deserialize(txBytes)
        : Transaction.from(Buffer.from(txBytes));
      const signed = await signTransaction(tx as any);
      const serialized = Buffer.from(signed.serialize()).toString("base64");

      // Step 3: Confirm with backend
      setStep("confirming");
      let confirmUrl: string;
      if (actionType === "fund") {
        confirmUrl = `${API_BASE}/api/marketplace/jobs/${jobId}/escrow/confirm`;
      } else if (actionType === "release") {
        confirmUrl = `${API_BASE}/api/marketplace/escrow/${escrowId}/release/confirm`;
      } else {
        confirmUrl = `${API_BASE}/api/marketplace/escrow/${escrowId}/refund/confirm`;
      }

      const confirmRes = await fetch(confirmUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signedTransaction: serialized, wallet: walletAddr }),
      });
      const confirmData = await confirmRes.json();
      if (confirmData.error) throw new Error(confirmData.error);

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
  }, [publicKey, signTransaction, jobId, escrowId, budget, walletAddr]);

  // Determine which actions are available
  const canFund = jobStatus === "in_progress" && !onchainEscrowPDA && escrowStatus !== "released";
  const canRelease = !!onchainEscrowPDA && jobStatus !== "completed" && escrowStatus !== "released";
  const canRefund = !!onchainEscrowPDA && jobStatus !== "completed" && escrowStatus !== "released";

  if (!canFund && !canRelease && !canRefund) {
    if (onchainEscrowPDA) {
      return (
        <div className="mt-4 p-4 rounded-xl" style={{ background: "rgba(153,69,255,0.06)", border: "1px solid rgba(153,69,255,0.15)" }}>
          <div className="flex items-center gap-2 text-xs" style={{ fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
            <Shield size={14} style={{ color: "#9945ff" }} />
            On-chain escrow: <a href={`${solanaExplorerUrl(`account/${onchainEscrowPDA}`)}`} target="_blank" rel="noopener" className="underline" style={{ color: "#9945ff" }}>{onchainEscrowPDA.slice(0, 8)}...{onchainEscrowPDA.slice(-4)}</a>
          </div>
        </div>
      );
    }
    return null;
  }

  const stepLabels: Record<Step, string> = {
    idle: "",
    building: "Building transaction...",
    signing: "Sign in your wallet...",
    confirming: "Confirming on-chain...",
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
          Connect the poster wallet to sign the on-chain escrow transaction.
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
