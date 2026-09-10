"use client";

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import type { Job } from "@/lib/types";
import { MARKETPLACE_API_BASE, marketplaceErrorMessage, marketplaceRead, signedMarketplaceRequest } from "@/lib/marketplace-api";
import { ApplicationsList } from "@/components/ApplicationsList";
import { JobApplyForm } from "@/components/JobApplyForm";

interface Thread {
  deliverables: Array<{ id: string; text: string; links: string[]; submissionNumber: number; submittedAt: string; autoApproveAt: string }>;
  revisions: Array<{ id: string; reason: string; revisionNumber: number; createdAt: string }>;
  comments: Array<{ id: string; authorId: string; text: string; attachmentLinks: string[]; createdAt: string }>;
}

type Notice = { kind: "success" | "error"; text: string } | null;

export function MarketplaceJobWorkspace({ initialJob }: { initialJob: Job }) {
  const { connected, publicKey, signMessage } = useWallet();
  const [job, setJob] = useState(initialJob);
  const [viewerProfileId, setViewerProfileId] = useState<string | null>(null);
  const [identityLoading, setIdentityLoading] = useState(false);
  const [identityError, setIdentityError] = useState<string | null>(null);
  const [thread, setThread] = useState<Thread | null>(null);
  const [threadState, setThreadState] = useState<"idle" | "loading" | "unauthorized" | "error">("idle");
  const [notice, setNotice] = useState<Notice>(null);
  const [acting, setActing] = useState<string | null>(null);
  const [deliveryText, setDeliveryText] = useState("");
  const [deliveryLinks, setDeliveryLinks] = useState("");
  const [revisionReason, setRevisionReason] = useState("");
  const [commentText, setCommentText] = useState("");
  const [commentLinks, setCommentLinks] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const [applicationsVersion, setApplicationsVersion] = useState(0);

  const mapJob = useCallback((raw: Record<string, any>): Job => ({
    ...job,
    id: String(raw.id),
    title: String(raw.title || "Untitled job"),
    description: String(raw.description || ""),
    status: raw.status,
    poster: String(raw.poster || raw.clientId || raw.client_id || "Unknown client"),
    budget: `${Number(raw.budgetAmount ?? raw.budget_amount ?? 0)} ${raw.budgetCurrency || raw.budget_currency || "SOL"}`,
    skills: Array.isArray(raw.skills) ? raw.skills : [],
    proposals: Number(raw.applicationCount ?? raw.application_count ?? 0),
    clientId: raw.clientId || raw.client_id,
    assignee: raw.assignee || raw.selectedAgentId || raw.selected_agent_id || undefined,
    assigneeId: raw.assigneeId || raw.selectedAgentId || raw.selected_agent_id || undefined,
    selectedApplicationId: raw.selectedApplicationId || raw.selected_application_id || undefined,
    awardExpiresAt: raw.awardExpiresAt || raw.award_expires_at || undefined,
    expiresAt: raw.expiresAt || raw.expires_at || undefined,
    escrowFunded: Boolean(raw.escrow?.funded ?? raw.escrow_funded),
    escrowStatus: raw.escrow?.funded || raw.escrow_funded ? "funded" : "ready",
  }), [job]);

  const refreshJob = useCallback(async () => {
    try {
      const raw = await marketplaceRead<Record<string, any>>(`/api/jobs/${encodeURIComponent(job.id)}`);
      setJob((current) => ({ ...mapJob(raw), posterAvatar: current.posterAvatar, createdAt: raw.createdAt || raw.created_at || current.createdAt, deadline: String(raw.timeline || current.deadline).replaceAll("_", " ") }));
    } catch (failure) {
      setNotice({ kind: "error", text: marketplaceErrorMessage(failure) });
    }
  }, [job.id, mapJob]);

  useEffect(() => {
    if (!connected || !publicKey) {
      setViewerProfileId(null);
      setIdentityError(null);
      return;
    }
    let cancelled = false;
    setIdentityLoading(true);
    setIdentityError(null);
    fetch(`${MARKETPLACE_API_BASE}/api/profile-by-wallet?wallet=${encodeURIComponent(publicKey.toBase58())}`, { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() : null)
      .then((profile) => {
        if (cancelled) return;
        setViewerProfileId(profile?.id || null);
        if (!profile?.id) setIdentityError("Unauthorized: this wallet is not linked to an AgentFolio profile.");
      })
      .catch(() => { if (!cancelled) setIdentityError("Profile lookup failed. Marketplace actions remain unavailable."); })
      .finally(() => { if (!cancelled) setIdentityLoading(false); });
    return () => { cancelled = true; };
  }, [connected, publicKey]);

  const isParty = viewerProfileId === job.clientId || viewerProfileId === job.assigneeId;
  const latest = thread?.deliverables.at(-1);

  const loadThread = useCallback(async () => {
    if (!viewerProfileId || !publicKey || !isParty) {
      setThreadState("unauthorized");
      return;
    }
    setThreadState("loading");
    try {
      const data = await signedMarketplaceRequest<Thread>({
        path: `/api/marketplace/jobs/${encodeURIComponent(job.id)}/thread`, action: "thread", resourceId: job.id,
        actorId: viewerProfileId, walletAddress: publicKey.toBase58(), signMessage, method: "GET",
      });
      setThread(data);
      setThreadState("idle");
    } catch (failure) {
      const message = marketplaceErrorMessage(failure);
      setNotice({ kind: "error", text: message });
      setThreadState(message.startsWith("Unauthorized:") ? "unauthorized" : "error");
    }
  }, [isParty, job.id, publicKey, signMessage, viewerProfileId]);

  const mutate = async (action: string, path: string, body: Record<string, unknown> = {}, resourceId = job.id) => {
    if (!viewerProfileId || !publicKey) {
      setNotice({ kind: "error", text: "Unauthorized: connect the wallet linked to your AgentFolio profile." });
      return;
    }
    setActing(action);
    setNotice(null);
    try {
      const result = await signedMarketplaceRequest<Record<string, any>>({
        path, action, resourceId, actorId: viewerProfileId,
        walletAddress: publicKey.toBase58(), signMessage, body,
      });
      const escrowTruth = result.escrow?.moneyMoved === false ? " Any escrow effect is staged." : "";
      setNotice({ kind: "success", text: `Action recorded by the canonical SQLite API. No money movement is reported.${escrowTruth}` });
      await refreshJob();
      if (isParty && ["submit", "revise", "approve", "comment"].includes(action)) await loadThread();
      if (action === "submit") { setDeliveryText(""); setDeliveryLinks(""); }
      if (action === "revise") setRevisionReason("");
      if (action === "comment") { setCommentText(""); setCommentLinks(""); }
    } catch (failure) {
      setNotice({ kind: "error", text: marketplaceErrorMessage(failure) });
    } finally {
      setActing(null);
    }
  };

  const awardExpired = Boolean(job.awardExpiresAt && Date.now() >= new Date(job.awardExpiresAt).getTime());
  const listingExpired = Boolean(job.expiresAt && Date.now() >= new Date(job.expiresAt).getTime());
  const isClient = viewerProfileId === job.clientId;
  const isWorker = viewerProfileId === job.assigneeId;
  const links = (value: string) => value.split(",").map((item) => item.trim()).filter(Boolean);

  return (
    <div className="space-y-6">
      <section className="rounded-xl p-5" style={{ background: "rgba(234,179,8,0.08)", border: "1px solid rgba(234,179,8,0.3)" }}>
        <strong className="text-sm">Staged escrow — no live-funds movement</strong>
        <p className="text-xs mt-1" style={{ color: "var(--text-secondary)" }}>The UI records canonical SQLite transitions and displays escrow readiness. It does not claim that payment, release, or refund occurred.</p>
      </section>

      {!connected && <State text="Unauthorized for actions: connect your wallet. Public job details remain readable." />}
      {identityLoading && <State text="Loading wallet-linked AgentFolio identity…" />}
      {identityError && <State text={identityError} error />}
      {notice && <State text={notice.text} error={notice.kind === "error"} />}

      <section className="rounded-xl p-6" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
        <h2 className="section-title">Applications ({job.proposals})</h2>
        <ApplicationsList jobId={job.id} jobStatus={job.status} clientId={job.clientId} selectedApplicationId={job.selectedApplicationId} escrowFunded={job.escrowFunded} viewerProfileId={viewerProfileId} onChanged={refreshJob} reloadToken={applicationsVersion} />
      </section>

      {job.status === "open" && !isClient && <section className="panel"><h2 className="section-title">Apply</h2><JobApplyForm jobId={job.id} jobStatus={job.status} onApplied={async () => { await refreshJob(); setApplicationsVersion((value) => value + 1); }} /></section>}

      <section className="panel">
        <h2 className="section-title">Lifecycle actions</h2>
        <div className="flex flex-wrap gap-2">
          {isClient && job.status === "open" && <>
            <input aria-label="Cancellation reason" value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} placeholder="Cancellation reason" className="field" />
            <ActionButton disabled={!cancelReason.trim() || Boolean(acting)} onClick={() => mutate("cancel", `/api/marketplace/jobs/${job.id}/cancel`, { reason: cancelReason.trim() })} label={acting === "cancel" ? "Cancelling…" : "Cancel job"} />
            {job.expiresAt && <ActionButton disabled={!listingExpired || Boolean(acting)} onClick={() => mutate("expire", `/api/marketplace/jobs/${job.id}/expire`)} label={listingExpired ? "Expire listing" : `Expiry available ${new Date(job.expiresAt).toLocaleString()}`} />}
          </>}
          {isClient && job.status === "awarded" && <ActionButton disabled={!awardExpired || Boolean(acting)} onClick={() => mutate("award-timeout", `/api/marketplace/jobs/${job.id}/award-timeout`)} label={awardExpired ? "Process 48-hour award timeout" : `Award response due ${job.awardExpiresAt ? new Date(job.awardExpiresAt).toLocaleString() : "unknown"}`} />}
          {!isClient && !isWorker && connected && <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>No legal transition is available to this profile.</span>}
        </div>
      </section>

      {["in_progress", "submitted", "approved"].includes(job.status) && (
        <section className="panel">
          <div className="flex items-center justify-between gap-3"><h2 className="section-title">Deliverables, revisions & comments</h2>{isParty && <button className="text-xs underline" onClick={() => void loadThread()}>Load / refresh private thread</button>}</div>
          {threadState === "loading" && <State text="Loading the private SQLite-backed job thread…" />}
          {threadState === "unauthorized" && <State text="Unauthorized: the deliverable and comment thread is limited to job parties." error />}
          {threadState === "error" && <State text="Thread request failed or timed out. Retry before taking another action." error />}
          {thread && <div className="space-y-3 mb-5">
            {thread.deliverables.length === 0 && thread.comments.length === 0 && thread.revisions.length === 0 && <State text="The private thread is empty." />}
            {thread.deliverables.map((item) => <article key={item.id} className="thread-item"><strong>Submission {item.submissionNumber}</strong><p className="whitespace-pre-wrap mt-1">{item.text}</p><small>Submitted {new Date(item.submittedAt).toLocaleString()} · auto-approval eligible {new Date(item.autoApproveAt).toLocaleString()}</small></article>)}
            {thread.revisions.map((item) => <article key={item.id} className="thread-item"><strong>Revision request {item.revisionNumber}/2</strong><p>{item.reason}</p></article>)}
            {thread.comments.map((item) => <article key={item.id} className="thread-item"><strong>{item.authorId}</strong><p>{item.text}</p>{item.attachmentLinks.map((link) => <a key={link} className="block underline" href={link} target="_blank" rel="noreferrer">{link}</a>)}</article>)}
          </div>}

          {isWorker && job.status === "in_progress" && <div className="form-grid">
            <textarea aria-label="Deliverable text" value={deliveryText} onChange={(event) => setDeliveryText(event.target.value)} placeholder="Describe the completed work" className="field" rows={4} />
            <input aria-label="Deliverable links" value={deliveryLinks} onChange={(event) => setDeliveryLinks(event.target.value)} placeholder="HTTP(S) links, comma-separated" className="field" />
            <ActionButton disabled={!deliveryText.trim() || Boolean(acting)} onClick={() => mutate("submit", `/api/marketplace/jobs/${job.id}/deliverables`, { text: deliveryText.trim(), links: links(deliveryLinks) })} label={acting === "submit" ? "Submitting…" : latest ? "Submit revised work" : "Submit work"} />
          </div>}
          {isClient && job.status === "submitted" && latest && <div className="form-grid">
            <textarea aria-label="Revision reason" value={revisionReason} onChange={(event) => setRevisionReason(event.target.value)} placeholder="Reason for changes (maximum two requests)" className="field" rows={3} />
            <div className="flex flex-wrap gap-2"><ActionButton disabled={!revisionReason.trim() || Boolean(acting)} onClick={() => mutate("revise", `/api/marketplace/jobs/${job.id}/deliverables/${latest.id}/revisions`, { reason: revisionReason.trim() }, latest.id)} label="Request revision" /><ActionButton disabled={Boolean(acting)} onClick={() => mutate("approve", `/api/marketplace/jobs/${job.id}/deliverables/${latest.id}/approve`, {}, latest.id)} label={acting === "approve" ? "Approving…" : "Approve work (stage only)"} /></div>
          </div>}
          {isParty && <div className="form-grid mt-5">
            <textarea aria-label="Comment" value={commentText} onChange={(event) => setCommentText(event.target.value)} placeholder="Add immutable job comment" className="field" rows={2} />
            <input aria-label="Comment attachment links" value={commentLinks} onChange={(event) => setCommentLinks(event.target.value)} placeholder="Attachment links only, comma-separated" className="field" />
            <ActionButton disabled={!commentText.trim() || Boolean(acting)} onClick={() => mutate("comment", `/api/marketplace/jobs/${job.id}/comments`, { text: commentText.trim(), attachmentLinks: links(commentLinks) })} label={acting === "comment" ? "Posting…" : "Post comment"} />
          </div>}
        </section>
      )}

      <style jsx>{`
        .panel { border: 1px solid var(--border); border-radius: .75rem; padding: 1.5rem; background: var(--bg-secondary); }
        .section-title { font: 700 .75rem var(--font-mono); letter-spacing: .1em; text-transform: uppercase; color: var(--text-secondary); margin-bottom: 1rem; }
        .field { width: 100%; border: 1px solid var(--border); border-radius: .5rem; padding: .65rem .75rem; color: var(--text-primary); background: var(--bg-primary); font-size: .8rem; }
        .form-grid { display: grid; gap: .75rem; }
        .thread-item { border: 1px solid var(--border); border-radius: .5rem; padding: .75rem; font-size: .75rem; color: var(--text-secondary); }
        small { color: var(--text-tertiary); }
      `}</style>
    </div>
  );
}

function ActionButton({ disabled, onClick, label }: { disabled?: boolean; onClick: () => void; label: string }) {
  return <button type="button" disabled={disabled} onClick={onClick} className="px-4 py-2 rounded-lg text-xs font-semibold disabled:opacity-40" style={{ background: "var(--accent)", color: "white" }}>{label}</button>;
}

function State({ text, error = false }: { text: string; error?: boolean }) {
  return <div role={error ? "alert" : "status"} className="rounded-lg px-3 py-2 text-xs my-2" style={{ border: `1px solid ${error ? "rgba(239,68,68,.4)" : "var(--border)"}`, color: error ? "#ef4444" : "var(--text-tertiary)" }}>{text}</div>;
}
