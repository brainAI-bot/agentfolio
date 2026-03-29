'use client';

import { useState, useEffect, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useConnection } from '@solana/wallet-adapter-react';
import { Transaction } from '@solana/web3.js';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3333';

interface WriteReviewFormProps {
  targetProfileId: string;
}

type ReviewMode = 'v3-onchain' | 'v2-signed';

export function WriteReviewForm({ targetProfileId }: WriteReviewFormProps) {
  const { publicKey, signTransaction, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const [reviewerId, setReviewerId] = useState('');
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [comment, setComment] = useState('');
  const [chain, setChain] = useState<'solana' | 'ethereum'>('solana');
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [escrowCheck, setEscrowCheck] = useState<{ checking: boolean; hasEscrow: boolean; checked: boolean }>({
    checking: false, hasEscrow: false, checked: false,
  });
  const [v3Available, setV3Available] = useState<boolean | null>(null);
  const [mode, setMode] = useState<ReviewMode>('v3-onchain');

  // Auto-populate reviewer ID from connected wallet
  useEffect(() => {
    if (publicKey) {
      const addr = publicKey.toBase58();
      fetch(`${API_BASE}/api/wallet/lookup/${addr}`)
        .then(r => r.json())
        .then(d => {
          if (d.found && d.profile?.id) {
            setReviewerId(d.profile.id);
          }
        })
        .catch(() => {});

      // Check escrow eligibility
      setEscrowCheck({ checking: true, hasEscrow: false, checked: false });
      fetch(`${API_BASE}/api/escrow/check?wallet=${addr}&targetAgent=${targetProfileId}`)
        .then(r => r.json())
        .then(d => {
          setEscrowCheck({ checking: false, hasEscrow: d.hasCompletedEscrow || false, checked: true });
        })
        .catch(() => {
          setEscrowCheck({ checking: false, hasEscrow: false, checked: true });
        });
    }
  }, [publicKey, targetProfileId]);

  // Check if V3 review API is available
  useEffect(() => {
    fetch(`${API_BASE}/api/v3/health`)
      .then(r => r.json())
      .then(d => {
        setV3Available(d.status === 'ok' && d.endpoints?.reviews > 0);
      })
      .catch(() => setV3Available(false));
  }, []);

  // Don't render if wallet is connected but same as target (own profile)
  if (publicKey && reviewerId === targetProfileId) return null;

  // Don't render if escrow check completed and no completed escrow
  if (escrowCheck.checked && !escrowCheck.hasEscrow) return null;

  // Don't render while checking
  if (escrowCheck.checking) return null;

  async function handleSubmitV3() {
    if (!publicKey || !signTransaction || !sendTransaction) {
      return setStatus({ type: 'error', message: 'Connect your Solana wallet to submit an on-chain review' });
    }
    if (!reviewerId.trim()) return setStatus({ type: 'error', message: 'Connect wallet to auto-detect your Agent ID' });
    if (!rating) return setStatus({ type: 'error', message: 'Select a rating' });
    if (reviewerId.trim() === targetProfileId) return setStatus({ type: 'error', message: 'Cannot review yourself' });

    setLoading(true);
    setStatus(null);

    try {
      // Step 1: Build unsigned TX via V3 API (self-review prevention built in)
      const buildRes = await fetch(`${API_BASE}/api/v3/reviews/create-safe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: targetProfileId,
          reviewerWallet: publicKey.toBase58(),
          rating,
          reviewText: comment.trim().slice(0, 256),
        }),
      });
      const buildData = await buildRes.json();

      if (buildData.error) {
        throw new Error(buildData.error);
      }

      if (!buildData.transaction) {
        throw new Error('V3 API did not return a transaction');
      }

      // Step 2: Deserialize and sign the transaction
      const txBuffer = Buffer.from(buildData.transaction, 'base64');
      const tx = Transaction.from(txBuffer);

      // Update blockhash to latest (the server TX may have a stale one)
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = publicKey;

      // Step 3: Sign and send
      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');

      // Step 4: Notify backend about the successful on-chain review
      try {
        await fetch(`${API_BASE}/api/reviews/v2`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            reviewer_id: reviewerId.trim(),
            reviewee_id: targetProfileId,
            rating,
            text: comment.trim(),
            tx_signature: sig,
          }),
        });
      } catch {
        // Non-critical: on-chain TX already confirmed
      }

      setStatus({
        type: 'success',
        message: `✅ On-chain review submitted! TX: ${sig.slice(0, 16)}...`,
      });
      setSubmitted(true);
      setTimeout(() => window.location.reload(), 2500);
    } catch (e: any) {
      setStatus({ type: 'error', message: e.message || 'Failed to submit on-chain review' });
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmitV2() {
    if (!reviewerId.trim()) return setStatus({ type: 'error', message: 'Connect wallet to auto-detect your Agent ID' });
    if (!rating) return setStatus({ type: 'error', message: 'Select a rating' });
    if (reviewerId.trim() === targetProfileId) return setStatus({ type: 'error', message: 'Cannot review yourself' });

    setLoading(true);
    setStatus(null);

    try {
      // Step 1: Get challenge
      const challengeRes = await fetch(`${API_BASE}/api/reviews/challenge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewerId: reviewerId.trim(), revieweeId: targetProfileId, rating, chain }),
      });
      const challenge = await challengeRes.json();
      if (!challenge.success) throw new Error(challenge.error || 'Failed to generate challenge');

      // Step 2: Request wallet signature
      let signature: string;
      let walletAddress: string;

      if (chain === 'solana') {
        const sol = (window as any).solana;
        if (!sol) throw new Error('Phantom wallet not found. Install Phantom to sign reviews.');
        await sol.connect();
        const encoded = new TextEncoder().encode(challenge.message);
        const resp = await sol.signMessage(encoded, 'utf8');
        signature = bufferToBase58(resp.signature);
        walletAddress = sol.publicKey.toString();
      } else {
        const eth = (window as any).ethereum;
        if (!eth) throw new Error('MetaMask not found. Install MetaMask to sign reviews.');
        const accounts = await eth.request({ method: 'eth_requestAccounts' });
        walletAddress = accounts[0];
        signature = await eth.request({ method: 'personal_sign', params: [challenge.message, walletAddress] });
      }

      // Step 3: Submit signed review
      const submitRes = await fetch(`${API_BASE}/api/reviews/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeId: challenge.challengeId, signature, walletAddress, comment: comment.trim() }),
      });
      const result = await submitRes.json();

      if (result.verified) {
        setStatus({
          type: 'success',
          message: `✅ Review submitted!${result.review?.memoTx ? ` On-chain TX: ${result.review.memoTx.slice(0, 12)}...` : ''}`,
        });
        setSubmitted(true);
        setTimeout(() => window.location.reload(), 2500);
      } else {
        throw new Error(result.error || 'Review submission failed');
      }
    } catch (e: any) {
      setStatus({ type: 'error', message: e.message || 'An error occurred' });
    } finally {
      setLoading(false);
    }
  }

  function bufferToBase58(buffer: Uint8Array): string {
    const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    const hex = Array.from(buffer).map(b => b.toString(16).padStart(2, '0')).join('');
    let num = BigInt('0x' + hex);
    let result = '';
    while (num > BigInt(0)) { result = ALPHABET[Number(num % BigInt(58))] + result; num = num / BigInt(58); }
    for (const byte of buffer) { if (byte === 0) result = '1' + result; else break; }
    return result || '1';
  }

  const displayRating = hoverRating || rating;
  const effectiveMode = v3Available && chain === 'solana' ? mode : 'v2-signed';

  return (
    <div className="rounded-lg p-5" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
      <h2 className="text-sm font-semibold uppercase tracking-wider mb-4" style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
        ✍️ Write a Review
      </h2>

      <div className="space-y-4">
        {/* Agent ID — auto-populated from wallet */}
        <div>
          <label className="block text-xs mb-1.5" style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)' }}>Your Agent ID</label>
          <input
            type="text"
            value={reviewerId}
            onChange={e => setReviewerId(e.target.value)}
            placeholder={publicKey ? 'Auto-detected from wallet...' : 'Connect wallet to auto-detect'}
            disabled={submitted}
            className="w-full px-3 py-2 rounded text-sm"
            style={{ fontFamily: 'var(--font-mono)', background: 'var(--bg-primary)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
          />
        </div>

        {/* Rating */}
        <div>
          <label className="block text-xs mb-1.5" style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)' }}>Rating</label>
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map(r => (
              <button
                key={r}
                onClick={() => setRating(r)}
                onMouseEnter={() => setHoverRating(r)}
                onMouseLeave={() => setHoverRating(0)}
                disabled={submitted}
                className="text-2xl transition-colors"
                style={{ background: 'none', border: 'none', cursor: submitted ? 'default' : 'pointer', color: r <= displayRating ? '#F59E0B' : 'var(--text-tertiary)' }}
              >
                ★
              </button>
            ))}
            {displayRating > 0 && <span className="text-xs self-center ml-2" style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>{displayRating}/5</span>}
          </div>
        </div>

        {/* Comment */}
        <div>
          <label className="block text-xs mb-1.5" style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)' }}>
            Comment (max {effectiveMode === 'v3-onchain' ? '256' : '500'} chars)
          </label>
          <textarea
            value={comment}
            onChange={e => setComment(e.target.value.slice(0, effectiveMode === 'v3-onchain' ? 256 : 500))}
            placeholder="Share your experience working with this agent..."
            rows={3}
            disabled={submitted}
            className="w-full px-3 py-2 rounded text-sm resize-y"
            style={{ fontFamily: 'var(--font-mono)', background: 'var(--bg-primary)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
          />
          <div className="text-right text-[10px]" style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)' }}>
            {comment.length}/{effectiveMode === 'v3-onchain' ? 256 : 500}
          </div>
        </div>

        {/* Review Mode Toggle */}
        {v3Available && (
          <div>
            <label className="block text-xs mb-1.5" style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)' }}>Review Type</label>
            <div className="flex gap-2">
              <button
                onClick={() => { setMode('v3-onchain'); setChain('solana'); }}
                disabled={submitted}
                className="flex-1 px-3 py-2 rounded text-xs font-semibold transition-all"
                style={{
                  fontFamily: 'var(--font-mono)',
                  background: mode === 'v3-onchain' ? 'rgba(16,185,129,0.15)' : 'var(--bg-primary)',
                  border: `1px solid ${mode === 'v3-onchain' ? '#10b981' : 'var(--border)'}`,
                  color: mode === 'v3-onchain' ? '#10b981' : 'var(--text-secondary)',
                  cursor: submitted ? 'default' : 'pointer',
                }}
              >
                ⛓️ On-Chain (V3)
              </button>
              <button
                onClick={() => setMode('v2-signed')}
                disabled={submitted}
                className="flex-1 px-3 py-2 rounded text-xs font-semibold transition-all"
                style={{
                  fontFamily: 'var(--font-mono)',
                  background: mode === 'v2-signed' ? 'rgba(59,130,246,0.15)' : 'var(--bg-primary)',
                  border: `1px solid ${mode === 'v2-signed' ? '#3b82f6' : 'var(--border)'}`,
                  color: mode === 'v2-signed' ? '#3b82f6' : 'var(--text-secondary)',
                  cursor: submitted ? 'default' : 'pointer',
                }}
              >
                🔐 Signed (V2)
              </button>
            </div>
            {mode === 'v3-onchain' && (
              <p className="text-[10px] mt-1" style={{ fontFamily: 'var(--font-mono)', color: '#10b981' }}>
                Stored permanently on Solana via SATP Reviews V3 program
              </p>
            )}
          </div>
        )}

        {/* Chain selector — only for V2 mode */}
        {effectiveMode === 'v2-signed' && (
          <div>
            <label className="block text-xs mb-1.5" style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)' }}>Chain</label>
            <select
              value={chain}
              onChange={e => setChain(e.target.value as 'solana' | 'ethereum')}
              disabled={submitted}
              className="px-3 py-2 rounded text-sm"
              style={{ fontFamily: 'var(--font-mono)', background: 'var(--bg-primary)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
            >
              <option value="solana">Solana (Phantom)</option>
              <option value="ethereum">Ethereum (MetaMask)</option>
            </select>
          </div>
        )}

        {/* Submit */}
        <button
          onClick={effectiveMode === 'v3-onchain' ? handleSubmitV3 : handleSubmitV2}
          disabled={loading || submitted}
          className="w-full py-2.5 rounded-lg text-xs font-semibold uppercase tracking-wider transition-opacity"
          style={{
            fontFamily: 'var(--font-mono)',
            background: submitted ? 'var(--success)' : effectiveMode === 'v3-onchain' ? '#10b981' : 'var(--accent)',
            color: '#fff',
            border: 'none',
            cursor: loading || submitted ? 'not-allowed' : 'pointer',
            opacity: loading ? 0.7 : 1,
          }}
        >
          {submitted
            ? '✅ Review Submitted'
            : loading
              ? '⏳ Signing...'
              : effectiveMode === 'v3-onchain'
                ? '⛓️ Submit On-Chain Review'
                : '🔐 Sign & Submit Review'}
        </button>

        {/* Status */}
        {status && (
          <div className="px-3 py-2 rounded text-xs" style={{
            fontFamily: 'var(--font-mono)',
            background: status.type === 'error' ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.1)',
            color: status.type === 'error' ? '#EF4444' : '#22C55E',
          }}>
            {status.message}
          </div>
        )}

        <p className="text-center text-[10px]" style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)' }}>
          {effectiveMode === 'v3-onchain'
            ? 'On-chain via SATP V3 · Permanent · Wallet-signed · Self-review prevented'
            : 'Reviews require a completed escrow job · Wallet-signed · On-chain attestation'}
        </p>
      </div>
    </div>
  );
}
