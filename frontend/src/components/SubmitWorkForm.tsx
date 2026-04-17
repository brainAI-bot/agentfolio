"use client";

import { useState, useEffect } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { Transaction, VersionedTransaction } from "@solana/web3.js";
import { Send, Package, AlertCircle } from "lucide-react";
import { createMarketplaceWalletAuth } from "@/lib/marketplace-auth";
import { profileHasWallet } from "@/lib/profile-wallets";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://agentfolio.bot";
const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

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

function deserializeEscrowTransaction(base64Tx: string): Transaction | VersionedTransaction {
  const raw = Uint8Array.from(Buffer.from(base64Tx, "base64"));
  return isVersionedSerializedTransaction(raw) ? VersionedTransaction.deserialize(raw) : Transaction.from(Buffer.from(raw));
}

async function signEscrowTransaction(
  base64Tx: string,
  signTransaction?: ((tx: Transaction | VersionedTransaction) => Promise<Transaction | VersionedTransaction>) | null,
): Promise<string> {
  if (!signTransaction) {
    throw new Error("Connected wallet must support signTransaction() for on-chain work submission");
  }
  const tx = deserializeEscrowTransaction(base64Tx);
  const signedTx = await signTransaction(tx);
  return Buffer.from(signedTx.serialize()).toString("base64");
}

interface SubmitWorkFormProps {
  jobId: string;
  jobStatus: string;
  assigneeId?: string;
  clientId?: string;
  deliverableId?: string;
  deliverableDescription?: string;
  deliverableStatus?: string;
  deliverableSubmittedAt?: string;
  escrowId?: string;
  onchainEscrowPDA?: string;
}

export function SubmitWorkForm({
  jobId,
  jobStatus,
  assigneeId,
  clientId,
  deliverableId,
  deliverableDescription,
  deliverableStatus,
  deliverableSubmittedAt,
  escrowId,
  onchainEscrowPDA,
}: SubmitWorkFormProps) {
  const { connected, publicKey, signMessage, signTransaction } = useWallet();
  const [resolvedId, setResolvedId] = useState<string | null>(null);
  const [resolvedWorkerId, setResolvedWorkerId] = useState<string | null>(null);
  const [resolvedClientId, setResolvedClientId] = useState<string | null>(null);
  const [assigneeWalletMatch, setAssigneeWalletMatch] = useState(false);
  const [clientWalletMatch, setClientWalletMatch] = useState(false);
  const [description, setDescription] = useState("");
  const [deliverableUrl, setDeliverableUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const [reviewing, setReviewing] = useState(false);
  const [reviewResult, setReviewResult] = useState<{ ok: boolean; msg: string } | null>(null);

  useEffect(() => {
    if (!connected || !publicKey) {
      setResolvedId(null);
      setResolvedWorkerId(null);
      setResolvedClientId(null);
      return;
    }
    let cancelled = false;
    const wallet = publicKey.toBase58();
    const fetchResolvedId = async (preferredProfileId?: string) => {
      const params = new URLSearchParams({ wallet });
      if (preferredProfileId) params.set("preferredProfileId", preferredProfileId);
      const res = await fetch(`${API_BASE}/api/profile-by-wallet?${params.toString()}`);
      if (!res.ok) return null;
      const data = await res.json().catch(() => null);
      return data?.id || null;
    };

    Promise.all([
      fetchResolvedId(),
      assigneeId ? fetchResolvedId(assigneeId) : Promise.resolve(null),
      clientId ? fetchResolvedId(clientId) : Promise.resolve(null),
    ])
      .then(([genericId, workerId, clientResolvedId]) => {
        if (cancelled) return;
        setResolvedId(genericId);
        setResolvedWorkerId(workerId);
        setResolvedClientId(clientResolvedId);
      })
      .catch(() => {
        if (cancelled) return;
        setResolvedId(null);
        setResolvedWorkerId(null);
        setResolvedClientId(null);
      });
    return () => {
      cancelled = true;
    };
  }, [assigneeId, clientId, connected, publicKey]);

  useEffect(() => {
    if (!connected || !publicKey) {
      setAssigneeWalletMatch(false);
      setClientWalletMatch(false);
      return;
    }

    const wallet = publicKey.toBase58();
    let cancelled = false;

    const checkProfileWallet = async (profileId: string | undefined, setter: (value: boolean) => void) => {
      if (!profileId) {
        setter(false);
        return;
      }
      try {
        const res = await fetch(`${API_BASE}/api/profile/${encodeURIComponent(profileId)}`);
        const profile = res.ok ? await res.json() : null;
        if (!cancelled) setter(profileHasWallet(profile, wallet));
      } catch {
        if (!cancelled) setter(false);
      }
    };

    checkProfileWallet(assigneeId, setAssigneeWalletMatch);
    checkProfileWallet(clientId, setClientWalletMatch);

    return () => {
      cancelled = true;
    };
  }, [assigneeId, clientId, connected, publicKey]);

  const workerActorId = assigneeWalletMatch ? assigneeId : (resolvedWorkerId || resolvedId);
  const clientActorId = clientWalletMatch ? clientId : (resolvedClientId || resolvedId);
  const isWorker = !!assigneeId && (assigneeWalletMatch || resolvedWorkerId === assigneeId || resolvedId === assigneeId);
  const isClient = !!clientId && (clientWalletMatch || resolvedClientId === clientId || resolvedId === clientId);
  const hasDeliverable = !!deliverableId;

  const handleSubmitWork = async () => {
    if (!description.trim()) {
      setResult({ ok: false, msg: "Please describe your deliverables" });
      return;
    }
    if (!workerActorId || !publicKey) {
      setResult({ ok: false, msg: "Connect the accepted worker wallet first" });
      return;
    }
    if (!signMessage || !signTransaction) {
      setResult({ ok: false, msg: "Connect a wallet that supports message and transaction signing first" });
      return;
    }

    setSubmitting(true);
    setResult(null);
    try {
      const walletAddress = publicKey.toBase58();
      let acceptTxSignature: string | null = null;
      let submitTxSignature: string | null = null;

      if (onchainEscrowPDA) {
        let onchainStatus: string | null = null;
        if (escrowId) {
          const stateRes = await fetch(`${API_BASE}/api/marketplace/escrow/${escrowId}/onchain`);
          const stateData = await stateRes.json().catch(() => null);
          if (!stateRes.ok || stateData?.error) {
            throw new Error(stateData?.error || "Failed to read on-chain escrow state");
          }
          onchainStatus = stateData?.onchain?.status || null;
        }

        if (onchainStatus === "created") {
          const acceptRes = await fetch(`${API_BASE}/api/marketplace/jobs/${jobId}/escrow/accept/onchain`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ agentWallet: walletAddress, agentId: workerActorId }),
          });
          const acceptData = await acceptRes.json();
          if (!acceptRes.ok || acceptData?.error) {
            throw new Error(acceptData?.error || "Failed to build on-chain escrow acceptance");
          }
          const signedAcceptTransaction = await signEscrowTransaction(acceptData.transaction, signTransaction);
          const acceptAuthHeaders = await createMarketplaceWalletAuth({
            action: "confirm_onchain_accept",
            walletAddress,
            actorId: workerActorId,
            jobId,
            escrowId: acceptData.escrowPDA,
            signMessage,
          });
          const acceptConfirmRes = await fetch(`${API_BASE}/api/marketplace/jobs/${jobId}/escrow/accept/confirm`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...acceptAuthHeaders },
            body: JSON.stringify({
              signedTransaction: signedAcceptTransaction,
              agentWallet: walletAddress,
            }),
          });
          const acceptConfirmData = await acceptConfirmRes.json();
          if (!acceptConfirmRes.ok || acceptConfirmData?.error) {
            throw new Error(acceptConfirmData?.error || "Failed to confirm on-chain escrow acceptance");
          }
          acceptTxSignature = acceptConfirmData?.signature || null;
        }

        const submitRes = await fetch(`${API_BASE}/api/marketplace/jobs/${jobId}/escrow/submit/onchain`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agentWallet: walletAddress, agentId: workerActorId }),
        });
        const submitData = await submitRes.json();
        if (!submitRes.ok || submitData?.error) {
          throw new Error(submitData?.error || "Failed to build on-chain submit-work transaction");
        }
        const signedSubmitTransaction = await signEscrowTransaction(submitData.transaction, signTransaction);
        const submitAuthHeaders = await createMarketplaceWalletAuth({
          action: "confirm_onchain_submit",
          walletAddress,
          actorId: workerActorId,
          jobId,
          escrowId: submitData.escrowPDA,
          signMessage,
        });
        const submitConfirmRes = await fetch(`${API_BASE}/api/marketplace/jobs/${jobId}/escrow/submit/confirm`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...submitAuthHeaders },
          body: JSON.stringify({
            signedTransaction: signedSubmitTransaction,
            agentWallet: walletAddress,
          }),
        });
        const submitConfirmData = await submitConfirmRes.json();
        if (!submitConfirmRes.ok || submitConfirmData?.error) {
          throw new Error(submitConfirmData?.error || "Failed to confirm on-chain submit-work transaction");
        }
        submitTxSignature = submitConfirmData?.signature || null;
      }

      const authHeaders = await createMarketplaceWalletAuth({
        action: "submit_deliverable",
        walletAddress,
        actorId: workerActorId,
        jobId,
        signMessage,
      });
      const res = await fetch(`${API_BASE}/api/marketplace/jobs/${jobId}/deliver`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({
          submittedBy: workerActorId,
          description: description.trim(),
          deliverableUrl: deliverableUrl.trim() || undefined,
          acceptOnchainTxHash: acceptTxSignature || undefined,
          submitOnchainTxHash: submitTxSignature || undefined,
        }),
      });
      const data = await res.json();
      if (data.error) {
        setResult({ ok: false, msg: data.error });
      } else {
        setResult({
          ok: true,
          msg: onchainEscrowPDA
            ? "Work submitted on-chain and sent to the client for review."
            : "Work submitted! The client will review your deliverables.",
        });
      }
    } catch (e: any) {
      setResult({ ok: false, msg: e.message });
    } finally {
      setSubmitting(false);
    }
  };

  const handleRequestChanges = async () => {
    if (!clientActorId || !publicKey || !deliverableId) {
      setReviewResult({ ok: false, msg: "Connect the poster wallet first" });
      return;
    }

    setReviewing(true);
    setReviewResult(null);
    try {
      const authHeaders = await createMarketplaceWalletAuth({
        action: "request_revision",
        walletAddress: publicKey.toBase58(),
        actorId: clientActorId,
        jobId,
        deliverableId,
        signMessage,
      });
      const res = await fetch(`${API_BASE}/api/marketplace/deliverables/${deliverableId}/revision`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ requestedBy: clientActorId }),
      });
      const data = await res.json();
      if (data.error) {
        setReviewResult({ ok: false, msg: data.error });
      } else {
        setReviewResult({ ok: true, msg: "Revision requested. The worker will be notified." });
      }
    } catch (e: any) {
      setReviewResult({ ok: false, msg: e.message });
    } finally {
      setReviewing(false);
    }
  };

  if (jobStatus !== "in_progress") return null;

  if (!connected) {
    return (
      <div className="rounded-xl p-6" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
        <h2 className="text-sm font-bold uppercase tracking-widest mb-3" style={{ fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
          Submit Work / Review
        </h2>
        <p className="text-sm" style={{ color: "var(--text-tertiary)" }}>Connect your wallet to submit work or review deliverables.</p>
      </div>
    );
  }

  if (hasDeliverable && !(isWorker && deliverableStatus === "revision_requested")) {
    return (
      <div className="rounded-xl p-6" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
        <div className="flex items-center gap-2 mb-4">
          <Package size={16} style={{ color: "var(--accent, #06b6d4)" }} />
          <h2 className="text-sm font-bold uppercase tracking-widest" style={{ fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
            Deliverable {deliverableStatus === "approved" ? "Approved ✅" : deliverableStatus === "revision_requested" ? "Revision Requested ⚠️" : "Submitted"}
          </h2>
        </div>

        <div className="rounded-lg p-4 mb-4" style={{ background: "var(--bg-primary)", border: "1px solid var(--border)" }}>
          <div className="text-xs mb-2" style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>
            Submitted {deliverableSubmittedAt ? new Date(deliverableSubmittedAt).toLocaleString() : ""}
          </div>
          <div className="text-sm whitespace-pre-wrap" style={{ color: "var(--text-primary)" }}>
            {deliverableDescription}
          </div>
        </div>

        {isClient && deliverableStatus === "submitted" && (
          <div>
            <div className="mb-3 text-sm px-3 py-2 rounded-lg" style={{ background: "rgba(34,197,94,0.08)", color: "var(--text-secondary)", border: "1px solid rgba(34,197,94,0.2)" }}>
              Use the on-chain escrow controls below to approve this work and release funds securely.
            </div>
            <div className="flex gap-3">
              <button
                onClick={handleRequestChanges}
                disabled={reviewing}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold disabled:opacity-50"
                style={{ background: "var(--bg-tertiary)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}
              >
                <AlertCircle size={14} /> Request Changes
              </button>
            </div>
            {reviewResult && (
              <div className="mt-3 text-sm px-3 py-2 rounded-lg" style={{ background: reviewResult.ok ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)", color: reviewResult.ok ? "#22c55e" : "#ef4444", border: `1px solid ${reviewResult.ok ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.2)"}` }}>
                {reviewResult.msg}
              </div>
            )}
          </div>
        )}

        {isWorker && deliverableStatus === "submitted" && (
          <div className="text-sm px-3 py-2 rounded-lg" style={{ background: "rgba(234,179,8,0.1)", color: "#eab308", border: "1px solid rgba(234,179,8,0.2)" }}>
            ⏳ Waiting for client review...
          </div>
        )}

        {isWorker && deliverableStatus === "revision_requested" && (
          <div className="text-sm px-3 py-2 rounded-lg" style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.2)" }}>
            ⚠️ Client requested changes. Please revise and resubmit.
          </div>
        )}
      </div>
    );
  }

  if (isWorker) {
    return (
      <div className="rounded-xl p-6" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
        <div className="flex items-center gap-2 mb-4">
          <Send size={16} style={{ color: "var(--solana, #9945ff)" }} />
          <h2 className="text-sm font-bold uppercase tracking-widest" style={{ fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
            {hasDeliverable && deliverableStatus === "revision_requested" ? "Resubmit Work" : "Submit Work"}
          </h2>
        </div>

        <div className="space-y-3">
          {hasDeliverable && deliverableStatus === "revision_requested" && (
            <div className="text-sm px-3 py-2 rounded-lg" style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.2)" }}>
              ⚠️ Client requested changes. Update your work and resubmit here.
            </div>
          )}
          <div>
            <label className="text-[11px] font-bold uppercase tracking-widest mb-1 block" style={{ fontFamily: "var(--font-mono)", color: "var(--text-tertiary)" }}>Deliverable Description *</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe what you built, include details, links, or paste your deliverable here..."
              rows={5}
              className="w-full px-3 py-2 rounded-lg text-sm resize-none"
              style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", color: "var(--text-primary)", outline: "none" }}
            />
          </div>
          <div>
            <label className="text-[11px] font-bold uppercase tracking-widest mb-1 block" style={{ fontFamily: "var(--font-mono)", color: "var(--text-tertiary)" }}>Deliverable URL (optional)</label>
            <input
              type="url"
              value={deliverableUrl}
              onChange={(e) => setDeliverableUrl(e.target.value)}
              placeholder="https://github.com/... or link to your work"
              className="w-full px-3 py-2 rounded-lg text-sm"
              style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", color: "var(--text-primary)", outline: "none" }}
            />
          </div>
          <button
            onClick={handleSubmitWork}
            disabled={submitting}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
            style={{ background: "var(--solana, #9945ff)" }}
          >
            <Package size={14} /> {submitting ? "Submitting..." : hasDeliverable && deliverableStatus === "revision_requested" ? "Resubmit Work" : "Submit Work"}
          </button>
        </div>

        {result && (
          <div className="mt-3 text-sm px-3 py-2 rounded-lg" style={{ background: result.ok ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)", color: result.ok ? "#22c55e" : "#ef4444", border: `1px solid ${result.ok ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.2)"}` }}>
            {result.msg}
          </div>
        )}
      </div>
    );
  }

  if (isClient) {
    return (
      <div className="rounded-xl p-6" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
        <h2 className="text-sm font-bold uppercase tracking-widest mb-3" style={{ fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
          Awaiting Deliverables
        </h2>
        <div className="text-sm px-3 py-2 rounded-lg" style={{ background: "rgba(234,179,8,0.1)", color: "#eab308", border: "1px solid rgba(234,179,8,0.2)" }}>
          ⏳ The assigned agent is working on this job. Deliverables will appear here once submitted.
        </div>
      </div>
    );
  }

  return null;
}
