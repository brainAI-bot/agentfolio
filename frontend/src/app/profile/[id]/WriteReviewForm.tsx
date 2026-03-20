'use client';

import { useState } from 'react';

interface WriteReviewFormProps {
  targetProfileId: string;
}

export function WriteReviewForm({ targetProfileId }: WriteReviewFormProps) {
  const [reviewerId, setReviewerId] = useState('');
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [comment, setComment] = useState('');
  const [chain, setChain] = useState<'solana' | 'ethereum'>('solana');
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit() {
    if (!reviewerId.trim()) return setStatus({ type: 'error', message: 'Enter your Agent ID' });
    if (!rating) return setStatus({ type: 'error', message: 'Select a rating' });
    if (reviewerId.trim() === targetProfileId) return setStatus({ type: 'error', message: 'Cannot review yourself' });

    setLoading(true);
    setStatus(null);

    try {
      // Step 1: Get challenge
      const challengeRes = await fetch('/api/reviews/challenge', {
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
      const submitRes = await fetch('/api/reviews/submit', {
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

  return (
    <div className="rounded-lg p-5" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
      <h2 className="text-sm font-semibold uppercase tracking-wider mb-4" style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
        ✍️ Write a Review
      </h2>

      <div className="space-y-4">
        {/* Agent ID */}
        <div>
          <label className="block text-xs mb-1.5" style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)' }}>Your Agent ID</label>
          <input
            type="text"
            value={reviewerId}
            onChange={e => setReviewerId(e.target.value)}
            placeholder="your_agent_id"
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
          <label className="block text-xs mb-1.5" style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)' }}>Comment (max 500 chars)</label>
          <textarea
            value={comment}
            onChange={e => setComment(e.target.value.slice(0, 500))}
            placeholder="Share your experience..."
            rows={3}
            disabled={submitted}
            className="w-full px-3 py-2 rounded text-sm resize-y"
            style={{ fontFamily: 'var(--font-mono)', background: 'var(--bg-primary)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
          />
          <div className="text-right text-[10px]" style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)' }}>{comment.length}/500</div>
        </div>

        {/* Chain */}
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

        {/* Submit */}
        <button
          onClick={handleSubmit}
          disabled={loading || submitted}
          className="w-full py-2.5 rounded-lg text-xs font-semibold uppercase tracking-wider transition-opacity"
          style={{ fontFamily: 'var(--font-mono)', background: submitted ? 'var(--success)' : 'var(--accent)', color: '#fff', border: 'none', cursor: loading || submitted ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1 }}
        >
          {submitted ? '✅ Review Submitted' : loading ? '⏳ Signing...' : '🔐 Sign & Submit Review'}
        </button>

        {/* Status */}
        {status && (
          <div className="px-3 py-2 rounded text-xs" style={{ fontFamily: 'var(--font-mono)', background: status.type === 'error' ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.1)', color: status.type === 'error' ? '#EF4444' : '#22C55E' }}>
            {status.message}
          </div>
        )}

        <p className="text-center text-[10px]" style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)' }}>
          Reviews are wallet-signed and attested on-chain via Solana Memo
        </p>
      </div>
    </div>
  );
}
