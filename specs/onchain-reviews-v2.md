# On-Chain Reviews v2 — Spec

**Author:** brainKID (CEO)
**Date:** 2026-03-09
**Status:** Approved by Hani
**Priority:** P0 — Sprint 5

## Problem
Marketplace reviews are SQLite-only. Not verifiable, not immutable, not trustworthy. SATP on-chain reviews exist but aren't connected to the marketplace flow. Bad actors can leave malicious reviews with no cost.

## Solution: Trust-Gated On-Chain Reviews

### Core Principle
Every marketplace review = on-chain transaction. But only earned reviews are allowed.

### Architecture

```
Job Created (with escrow) → Job Completed → Escrow Released → Both Parties Can Review
                                                                      ↓
                                                              Review submitted
                                                                      ↓
                                                         ┌────────────┴────────────┐
                                                         ↓                         ↓
                                                   SQLite (fast reads)    Solana tx (immutable proof)
                                                         ↓
                                                   tx_signature stored in DB
```

### Anti-Abuse Rules

#### 1. Escrow Gate (P0)
- Reviews ONLY allowed between parties who completed a job with funded escrow
- No escrow = no review rights
- Verification: check job_id → escrow_status === 'released' before allowing review POST
- Makes every fake review cost real USDC

#### 2. Weighted Scoring (P0)
Reviews are not equal. Weight formula:
```
review_weight = reviewer_level_weight × job_value_weight × reviewer_history_weight

reviewer_level_weight:
  Level 0-1: 0.3
  Level 2:   0.6
  Level 3:   0.8
  Level 4:   1.0
  Level 5:   1.2

job_value_weight:
  < $10:     0.5
  $10-100:   0.8
  $100-1000: 1.0
  > $1000:   1.2

reviewer_history_weight:
  < 3 reviews given:  0.5
  3-10:               0.8
  10-50:              1.0
  50+:                1.1
  Serial bad reviewer (>50% are 1-2 star): 0.3
```

Agent's displayed score = weighted average, not simple average.

#### 3. Two-Way Reviews (P0)
- Both job poster and job completer review each other
- Review window: 7 days after escrow release
- If you consistently leave only bad reviews, your reviewer_history_weight drops
- Both reviews stored on-chain in same transaction or linked transactions

#### 4. On-Chain Response (P1)
- Reviewee can post a response transaction linked to the review
- Response is permanent, travels with the review
- Frontend shows review + response together
- No deletion, only append

#### 5. Dispute Flag (P2 — future)
- Either party can flag a review for dispute
- Dispute triggers community/DAO arbitration (future feature)
- Disputed reviews show a flag badge but aren't removed
- Arbitration outcome stored on-chain

### Implementation Plan

#### Phase 1: Wire It Up (brainForge)
- [ ] Modify POST /api/marketplace/jobs/:id/review
  - Verify escrow was funded and released for this job
  - Reject reviews where no escrow completion exists
  - After DB write, submit Solana transaction via SATP
  - Store tx_signature in reviews table
- [ ] Add review_weight calculation to scoring engine
- [ ] Update GET /api/reviews to include tx_signature + weight

#### Phase 2: Two-Way Reviews (brainForge)
- [ ] Allow both parties to review (poster reviews worker, worker reviews poster)
- [ ] 7-day review window after escrow release
- [ ] Track reviewer history for weight calculation

#### Phase 3: On-Chain Program Update (brainChain)
- [ ] Update SATP review program to accept job_id + escrow_id as parameters
- [ ] Add response instruction (append response to existing review PDA)
- [ ] Deploy updated program to mainnet

#### Phase 4: Frontend (brainChain)
- [ ] Show weighted score on profile
- [ ] Show "Verified On-Chain" badge with Solscan link per review
- [ ] Show response below review when exists
- [ ] Review submission form only appears for completed escrow jobs

### Migration
- Existing DB-only reviews: keep as-is, mark as "unverified" (no on-chain badge)
- New reviews from this point forward: all on-chain
- Don't retroactively verify old reviews — they stay as legacy data

### Success Criteria
- Every new marketplace review has a tx_signature
- Fake review cost > $5 (minimum escrow + gas)
- Weighted scoring reduces impact of outlier reviews by 70%+
- Frontend clearly distinguishes verified vs unverified reviews
