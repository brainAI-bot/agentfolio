"use client";

import { useEffect, useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useConnection } from "@solana/wallet-adapter-react";
import { Transaction } from "@solana/web3.js";
import { CheckCircle, AlertTriangle, FileText, Star } from "lucide-react";
import { createMarketplaceWalletAuth } from "@/lib/marketplace-auth";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://agentfolio.bot";
const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

interface Props {
  jobId: string;
  jobStatus: string;
  deliverableDescription?: string;
  deliverableStatus?: string;
  deliverableSubmittedAt?: string;
  assigneeId?: string;
  clientId?: string;
  escrowStatus: string;
  jobPDA?: string | null;
}

interface ReviewRecord {
  id: string;
  reviewer_id: string;
  reviewee_id: string;
  job_id: string | null;
  rating: number;
  comment?: string;
  created_at: string;
}

export function JobReviewSection({
  jobId,
  jobStatus,
  deliverableDescription,
  deliverableSubmittedAt,
  assigneeId,
  clientId,
  escrowStatus,
  jobPDA,
}: Props) {
  const { publicKey, sendTransaction, signMessage } = useWallet();
  const { connection } = useConnection();
  const [approving, setApproving] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [changeNote, setChangeNote] = useState("");
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [viewerProfileId, setViewerProfileId] = useState("");
  const [viewerIdentityPDA, setViewerIdentityPDA] = useState("");
  const [reviews, setReviews] = useState<ReviewRecord[]>([]);
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const [rating, setRating] = useState(5);
  const [hoverRating, setHoverRating] = useState(0);
  const [comment, setComment] = useState("");
  const [submittingReview, setSubmittingReview] = useState(false);

  const walletAddr = publicKey?.toBase58() || "";
  const hasDeliverable = !!deliverableDescription;
  const isCompleted = jobStatus === "completed";

  useEffect(() => {
    if (!publicKey) {
      setViewerProfileId("");
      setViewerIdentityPDA("");
      return;
    }

    const addr = publicKey.toBase58();

    fetch(`${API_BASE}/api/wallet/lookup/${addr}`)
      .then((r) => r.json())
      .then((d) => setViewerProfileId(d?.profileId || d?.profile?.id || ""))
      .catch(() => setViewerProfileId(""));

    fetch(`${API_BASE}/api/satp/identity/${addr}`)
      .then((r) => r.json())
      .then((d) => setViewerIdentityPDA(d?.data?.pda || d?.identityPDA || ""))
      .catch(() => setViewerIdentityPDA(""));
  }, [publicKey]);

  useEffect(() => {
    if (!isCompleted || !clientId || !assigneeId) {
      setReviews([]);
      return;
    }

    let cancelled = false;
    setReviewsLoading(true);

    Promise.all([
      fetch(`${API_BASE}/api/reviews?agent=${encodeURIComponent(clientId)}`).then((r) => r.json()).catch(() => ({ reviews: [] })),
      fetch(`${API_BASE}/api/reviews?agent=${encodeURIComponent(assigneeId)}`).then((r) => r.json()).catch(() => ({ reviews: [] })),
    ])
      .then(([clientReviews, agentReviews]) => {
        if (cancelled) return;
        const merged = [...(clientReviews?.reviews || []), ...(agentReviews?.reviews || [])]
          .filter((review) => review?.job_id === jobId)
          .filter((review, index, arr) => arr.findIndex((item) => item.id === review.id) === index);
        setReviews(merged);
      })
      .finally(() => {
        if (!cancelled) setReviewsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [API_BASE, assigneeId, clientId, isCompleted, jobId]);

  const viewerRole = useMemo(() => {
    if (!viewerProfileId && !walletAddr) return null;
    if (viewerProfileId === clientId || walletAddr === clientId) return "client";
    if (viewerProfileId === assigneeId || walletAddr === assigneeId) return "agent";
    return null;
  }, [assigneeId, clientId, viewerProfileId, walletAddr]);

  const reviewType = viewerRole === "client" ? "client_to_agent" : viewerRole === "agent" ? "agent_to_client" : null;
  const revieweeId = viewerRole === "client" ? assigneeId : viewerRole === "agent" ? clientId : null;
  const existingReview = viewerProfileId
    ? reviews.find((review) => review.job_id === jobId && review.reviewer_id === viewerProfileId)
    : null;

  if (!hasDeliverable && !isCompleted) return null;

  const handleApprove = async () => {
    const actorId = viewerProfileId || walletAddr;
    if (!actorId || !walletAddr) {
      setResult({ ok: false, msg: "Connect the poster wallet first." });
      return;
    }
    setApproving(true);
    setResult(null);
    try {
      const authHeaders = await createMarketplaceWalletAuth({
        action: "complete_job",
        walletAddress: walletAddr,
        actorId,
        jobId,
        signMessage,
      });
      const res = await fetch(`${API_BASE}/api/marketplace/jobs/${jobId}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({
          approvedBy: actorId,
          completionNote: "Work approved and payment released.",
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setResult({ ok: true, msg: "Work approved! Payment released to worker." });
      setTimeout(() => window.location.reload(), 2000);
    } catch (e: any) {
      setResult({ ok: false, msg: e.message || "Failed to approve" });
    } finally {
      setApproving(false);
    }
  };

  const handleRequestChanges = async () => {
    if (!changeNote.trim()) {
      setResult({ ok: false, msg: "Please describe what changes are needed." });
      return;
    }
    const actorId = viewerProfileId || walletAddr;
    if (!actorId || !walletAddr) {
      setResult({ ok: false, msg: "Connect the poster wallet first." });
      return;
    }
    setRequesting(true);
    setResult(null);
    try {
      const authHeaders = await createMarketplaceWalletAuth({
        action: "request_changes",
        walletAddress: walletAddr,
        actorId,
        jobId,
        signMessage,
      });
      const res = await fetch(`${API_BASE}/api/marketplace/jobs/${jobId}/request-changes`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({
          requestedBy: actorId,
          note: changeNote.trim(),
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setResult({ ok: true, msg: "Changes requested. Worker has been notified." });
      setChangeNote("");
    } catch (e: any) {
      setResult({ ok: false, msg: e.message || "Failed to request changes" });
    } finally {
      setRequesting(false);
    }
  };

  const handleSubmitReview = async () => {
    if (!publicKey || !sendTransaction) {
      setResult({ ok: false, msg: "Connect your Solana wallet to submit a review." });
      return;
    }
    if (!viewerProfileId || !viewerRole || !reviewType || !revieweeId) {
      setResult({ ok: false, msg: "Only the completed job participants can submit reviews." });
      return;
    }
    if (!viewerIdentityPDA && jobPDA) {
      setResult({ ok: false, msg: "SATP identity required for job-scoped marketplace reviews. Verify your wallet first." });
      return;
    }
    if (existingReview) {
      setResult({ ok: false, msg: "You already submitted a review for this job." });
      return;
    }

    setSubmittingReview(true);
    setResult(null);

    try {
      let txBuildData: any;

      if (jobPDA) {
        const commentUri = `${SITE_URL}/marketplace/job/${jobId}#review-${viewerProfileId}`.slice(0, 200);
        const buildRes = await fetch(`${API_BASE}/api/reviews/submit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            reviewer: publicKey.toBase58(),
            reviewerIdentity: viewerIdentityPDA,
            jobPDA,
            rating,
            quality: rating,
            reliability: rating,
            communication: rating,
            commentUri,
            commentHash: comment.trim() || `${jobId}:${viewerProfileId}:${Date.now()}`,
          }),
        });
        txBuildData = await buildRes.json();
      } else {
        const buildRes = await fetch(`${API_BASE}/api/v3/reviews/create-safe`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            agentId: revieweeId,
            reviewerWallet: publicKey.toBase58(),
            rating,
            reviewText: comment.trim().slice(0, 256),
          }),
        });
        txBuildData = await buildRes.json();
      }

      if (txBuildData?.error) {
        throw new Error(txBuildData.error);
      }
      if (!txBuildData?.transaction) {
        throw new Error("Review builder did not return a transaction.");
      }

      const tx = Transaction.from(Buffer.from(txBuildData.transaction, "base64"));
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = publicKey;

      const txSignature = await sendTransaction(tx, connection);
      await connection.confirmTransaction({ signature: txSignature, blockhash, lastValidBlockHeight }, "confirmed");

      const submitRes = await fetch(`${API_BASE}/api/marketplace/jobs/${jobId}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reviewerId: viewerProfileId,
          reviewType,
          rating,
          comment: comment.trim(),
          category_quality: rating,
          category_reliability: rating,
          category_communication: rating,
          txSignature,
        }),
      });
      const submitData = await submitRes.json();

      if (!submitRes.ok) {
        throw new Error(submitData?.error || "Failed to save marketplace review.");
      }

      setResult({ ok: true, msg: `Review submitted. TX: ${txSignature.slice(0, 16)}...` });
      setReviews((current) => [
        {
          id: submitData.id,
          reviewer_id: submitData.reviewer_id,
          reviewee_id: submitData.reviewee_id,
          job_id: submitData.job_id,
          rating: submitData.rating,
          comment: submitData.comment,
          created_at: submitData.created_at,
        },
        ...current,
      ]);
      setComment("");
      setTimeout(() => window.location.reload(), 2000);
    } catch (e: any) {
      setResult({ ok: false, msg: e.message || "Failed to submit review" });
    } finally {
      setSubmittingReview(false);
    }
  };

  return (
    <div className="rounded-xl p-6 mt-6" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
      {!isCompleted && (
        <>
          <h2 className="text-sm font-bold uppercase tracking-widest mb-4" style={{ fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
            Deliverable Submitted
          </h2>

          <div className="rounded-lg p-4 mb-4" style={{ background: "var(--bg-primary)", border: "1px solid var(--border)" }}>
            <div className="flex items-center gap-2 mb-2">
              <FileText size={14} style={{ color: "var(--accent)" }} />
              <span className="text-xs font-semibold uppercase tracking-wider" style={{ fontFamily: "var(--font-mono)", color: "var(--text-tertiary)" }}>
                Submitted {deliverableSubmittedAt ? new Date(deliverableSubmittedAt).toLocaleDateString() : ""}
              </span>
            </div>
            <div className="text-sm whitespace-pre-wrap" style={{ color: "var(--text-secondary)" }}>
              {deliverableDescription}
            </div>
          </div>

          <div className="space-y-3">
            <button
              onClick={handleApprove}
              disabled={approving}
              className="w-full flex items-center justify-center gap-2 px-5 py-3 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
              style={{ background: "#22c55e" }}
            >
              <CheckCircle size={16} />
              {approving ? "Approving..." : "Approve & Release Payment"}
            </button>

            <div>
              <textarea
                value={changeNote}
                onChange={(e) => setChangeNote(e.target.value)}
                placeholder="Describe what changes are needed..."
                rows={2}
                className="w-full px-3 py-2 rounded-lg text-sm resize-none mb-2"
                style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", color: "var(--text-primary)", fontFamily: "var(--font-mono)" }}
              />
              <button
                onClick={handleRequestChanges}
                disabled={requesting}
                className="w-full flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold disabled:opacity-50"
                style={{ background: "transparent", border: "1px solid var(--warning, #f59e0b)", color: "var(--warning, #f59e0b)" }}
              >
                <AlertTriangle size={14} />
                {requesting ? "Sending..." : "Request Changes"}
              </button>
            </div>
          </div>
        </>
      )}

      {isCompleted && (
        <>
          <div className="flex items-center justify-between gap-3 mb-4">
            <h2 className="text-sm font-bold uppercase tracking-widest" style={{ fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
              Ratings & Reviews
            </h2>
            <span className="text-[11px] px-2.5 py-1 rounded-full" style={{ background: "var(--bg-primary)", color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>
              Escrow {escrowStatus}
            </span>
          </div>

          {reviewsLoading ? (
            <div className="text-sm" style={{ color: "var(--text-tertiary)" }}>Loading reviews...</div>
          ) : reviews.length > 0 ? (
            <div className="space-y-3 mb-4">
              {reviews.map((review) => (
                <div key={review.id} className="rounded-lg p-4" style={{ background: "var(--bg-primary)", border: "1px solid var(--border)" }}>
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <div className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                      {review.reviewer_id}
                    </div>
                    <div className="flex items-center gap-1" style={{ color: "#f59e0b" }}>
                      {Array.from({ length: review.rating }).map((_, index) => <Star key={index} size={14} fill="currentColor" />)}
                    </div>
                  </div>
                  {review.comment ? (
                    <div className="text-sm whitespace-pre-wrap" style={{ color: "var(--text-secondary)" }}>
                      {review.comment}
                    </div>
                  ) : null}
                  <div className="mt-2 text-xs" style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>
                    {new Date(review.created_at).toLocaleDateString()}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-lg p-4 mb-4 text-sm" style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", color: "var(--text-tertiary)" }}>
              No reviews submitted for this job yet.
            </div>
          )}

          {viewerRole && !existingReview && (
            <div className="rounded-lg p-4" style={{ background: "var(--bg-primary)", border: "1px solid var(--border)" }}>
              <div className="text-sm font-semibold mb-2" style={{ color: "var(--text-primary)" }}>
                {viewerRole === "client" ? "Leave a review for the assigned agent" : "Leave a review for the client"}
              </div>
              <div className="flex gap-1 mb-3">
                {[1, 2, 3, 4, 5].map((value) => {
                  const active = value <= (hoverRating || rating);
                  return (
                    <button
                      key={value}
                      type="button"
                      onMouseEnter={() => setHoverRating(value)}
                      onMouseLeave={() => setHoverRating(0)}
                      onClick={() => setRating(value)}
                      className="p-1"
                      style={{ color: active ? "#f59e0b" : "var(--text-tertiary)" }}
                    >
                      <Star size={20} fill={active ? "currentColor" : "none"} />
                    </button>
                  );
                })}
              </div>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Share your experience on this job..."
                rows={4}
                className="w-full px-3 py-2 rounded-lg text-sm resize-none mb-3"
                style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", color: "var(--text-primary)", fontFamily: "var(--font-mono)" }}
              />
              {!jobPDA ? (
                <div className="text-xs mb-3" style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>
                  Using fallback SATP review proof because this job record is missing an escrow PDA.
                </div>
              ) : null}
              <button
                type="button"
                onClick={handleSubmitReview}
                disabled={submittingReview}
                className="w-full flex items-center justify-center gap-2 px-5 py-3 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
                style={{ background: "var(--accent, #06b6d4)" }}
              >
                <CheckCircle size={16} />
                {submittingReview ? "Submitting review..." : "Submit On-Chain Review"}
              </button>
            </div>
          )}

          {viewerRole && existingReview ? (
            <div className="rounded-lg p-4 mt-4 text-sm" style={{ background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.2)", color: "#22c55e" }}>
              You already submitted a review for this job.
            </div>
          ) : null}

          {!viewerRole ? (
            <div className="rounded-lg p-4 mt-4 text-sm" style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", color: "var(--text-tertiary)" }}>
              Connect the client or assigned agent wallet to submit a marketplace review.
            </div>
          ) : null}
        </>
      )}

      {result && (
        <div
          className="mt-3 text-sm px-3 py-2 rounded-lg"
          style={{
            background: result.ok ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)",
            color: result.ok ? "#22c55e" : "#ef4444",
            border: `1px solid ${result.ok ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.2)"}`,
          }}
        >
          {result.msg}
        </div>
      )}
    </div>
  );
}
