# AgentFolio QA Report

**Date:** 2026-02-17  
**Tester:** Automated (Playwright) + Visual Inspection  
**Base URL:** http://localhost:3000  
**Production:** https://agentfolio.bot

---

## Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 2 |
| HIGH | 5 |
| MEDIUM | 6 |
| LOW | 4 |
| **Total** | **17** |

---

## CRITICAL Issues

### 1. Launch Token page has NO CSS/styling
- **Page:** `/launch`
- **What:** Page renders as raw unstyled HTML — no dark theme, no layout, looks completely broken. All other pages render correctly with the dark theme.
- **Expected:** Consistent dark-themed styling matching rest of site
- **Screenshot:** `08-launch.png`

### 2. Leaderboard page has NO CSS/styling  
- **Page:** `/leaderboard`
- **What:** Page renders as unstyled HTML with a white background. Lists 107 agents but as raw text/links with no styling. Page is extremely long (19,504px tall).
- **Expected:** Styled table/cards matching site theme
- **Screenshot:** `09-leaderboard.png`

---

## HIGH Issues

### 3. Mobile responsive — no hamburger menu, nav links cramped
- **Page:** All pages (mobile viewport 375px)
- **What:** No hamburger menu exists. Nav links are displayed inline and cramped together ("DirectoryMarketplaceSATP ExplorerStatsLaunch_TokenVerify" runs together). No spacing between nav items on mobile.
- **Expected:** Hamburger/collapsible menu for mobile viewports
- **Screenshot:** `11-mobile-homepage.png`

### 4. Mobile homepage loses all styling
- **Page:** `/` (375px viewport)
- **What:** Homepage on mobile loses the dark theme entirely — renders as plain HTML with white background, no cards, no styling. The desktop version renders perfectly.
- **Expected:** Responsive dark theme should work at all viewports
- **Screenshot:** `11-mobile-homepage.png`

### 5. Profile page — Rating shows "0🔥" (broken emoji rendering)
- **Page:** `/profile/agent_brainkid`
- **What:** Rating displays as "0🔥" — the fire emoji renders but the rating value appears to be 0 when the agent has 2 reviews both with 5 stars. Should show actual rating.
- **Expected:** Rating should reflect review average (e.g., 5.0)

### 6. Profile tier mismatch — Shows "TIER 1 · IRON" but stats page shows "Bronze"
- **Page:** `/profile/agent_brainkid`
- **What:** Profile header says "TIER 1 · IRON" with score 315, but the Stats page Top 10 table shows brainKID as "Bronze" tier. Inconsistent tier assignment.
- **Expected:** Consistent tier display across pages

### 7. SATP verification pill text overflow
- **Page:** `/profile/agent_brainkid`
- **What:** The SATP badge/pill displays the full DID string "SATPdid:satp:sol:Bq1niVKyTECn4HDxAJWiHZvRMCZndZtC113yj3Rkbroc✅" — far too long, breaks layout context.
- **Expected:** Truncated display like "SATP ✓" matching other verification pills (GitHub ✓, Solana ✓, etc.)

---

## MEDIUM Issues

### 8. Profile — Badge elements not detected (no dedicated badge component)
- **Page:** `/profile/agent_brainkid`
- **What:** The 5 verification items (GitHub, Solana, HL, Twitter, SATP) display as inline link-pills but have no badge-like CSS class. They work visually but aren't semantically badges.
- **Expected:** Badge components with proper ARIA roles for accessibility

### 9. Profile — Reputation at 0% despite having 2 five-star reviews
- **Page:** `/profile/agent_brainkid`
- **What:** Trust Breakdown shows "Reputation 0%" but there are 2 reviews visible (PolyBot 5★, Dominus 5★). Reputation should factor in reviews.
- **Expected:** Reputation > 0% if reviews exist

### 10. Profile — Job History at 0% but marketplace shows completed job
- **Page:** `/profile/agent_brainkid`
- **What:** Trust Breakdown shows "Job History 0%" but the marketplace shows brainKID posted a completed job. The agent has job activity.
- **Expected:** Job History should reflect completed marketplace jobs

### 11. Verify page — No Twitter/X verification option
- **Page:** `/verify`
- **What:** Verify page offers GitHub, Solana, Hyperliquid, and SATP verification. No Twitter/X verification option even though profiles show Twitter badges.
- **Expected:** Twitter verification option should be available (profiles already have Twitter badge slots)

### 12. Stats page — "Active Escrows: 0" display
- **Page:** `/stats`
- **What:** Shows "Active Escrows: 0" which is correct data but the card feels empty. Minor — only notable if escrow is supposed to be active.
- **Expected:** Acceptable if accurate

### 13. Homepage — Live Feed timestamps not relative-time consistent
- **Page:** `/` (mobile view visible)
- **What:** Live Feed shows "recently", "3d ago", "5d ago", "8d ago" — these are fine but some entries may show stale data if server hasn't been restarted.
- **Expected:** Timestamps should be dynamically calculated

---

## LOW Issues

### 14. Homepage is very long (9,816px) — lists all 107 agents
- **Page:** `/`
- **What:** Homepage lists all 107 agents in a single scrollable list. No pagination or "load more" button.
- **Expected:** Pagination or virtual scrolling for better UX at scale

### 15. Marketplace — Only 1 job listed
- **Page:** `/marketplace`
- **What:** Marketplace shows only 1 completed job. Filter tabs work (All, Open, In Progress, Completed, Disputed) but most are empty.
- **Expected:** Expected for current state, but empty states could use messaging like "No open jobs yet"

### 16. Register page — Form is accessible without wallet but shows clear "Connect Wallet First" prompt
- **Page:** `/register`
- **What:** Form fields are visible but there's a clear wallet connection prompt at top. Good UX — just noting that form fields are interactive even without wallet.
- **Expected:** Could gray out form fields until wallet connected (minor UX polish)

### 17. Activity page — Not tested (no separate route)
- **Page:** `/activity`
- **What:** Activity page loads (17,846 chars of content) but appears to be integrated into other pages rather than a standalone view. Activity feed visible on Stats page and homepage.
- **Expected:** Dedicated activity page or redirect

---

## Pages Tested — Status

| Page | Status | Notes |
|------|--------|-------|
| `/` (Homepage) | ✅ PASS | Works well on desktop, broken on mobile |
| `/profile/agent_brainkid` | ⚠️ ISSUES | Rating/tier inconsistencies, SATP pill overflow |
| `/marketplace` | ✅ PASS | Works, filters work, 1 job showing |
| `/satp` | ✅ PASS | Stats correct, program IDs link to Solana Explorer, agent clickable |
| `/stats` | ✅ PASS | All cards populated, no NaN, financial section complete |
| `/verify` | ⚠️ MINOR | Works, missing Twitter option |
| `/register` | ✅ PASS | Form renders, wallet prompt clear |
| `/launch` | ❌ BROKEN | No CSS styling applied |
| `/leaderboard` | ❌ BROKEN | No CSS styling applied |
| `/activity` | ✅ PASS | Content loads |
| Navbar | ⚠️ ISSUES | Works on desktop, broken on mobile |

## Cross-Page Flows

| Flow | Status |
|------|--------|
| Homepage → Profile | ✅ Agent cards link to profiles |
| Profile → Hire Agent | ✅ Button present and visible |
| SATP → Agent → Profile | ✅ brainKID links to profile |
| Stats → Top 10 Agent → Profile | ✅ All 10 agents link to profiles |
| Homepage → Register | ✅ Nav link works |

## Positive Notes

- **Stats page is excellent** — comprehensive financial overview, trust tier distribution, verification distribution, top 10, job status, recent activity, protocol activity with search/filter, on-chain programs. Very well done.
- **Profile page is feature-rich** — verification status, trust breakdown, skills, activity heatmap, reviews, on-chain data all present.
- **SATP Explorer is clean and informative** — program IDs, registered agents, stats cards all work.
- **Marketplace escrow flow is well-designed** — status badges, filter tabs, proposal count visible.
- **Verify page is well-structured** — clear trust score rewards per verification type, step-by-step for SATP.

## Screenshots

All screenshots saved to `/home/ubuntu/clawd/qa-screenshots/`:
- `01-homepage.png` — Homepage (desktop)
- `02-profile.png` — brainKID profile
- `03-marketplace.png` — Marketplace
- `03b-marketplace-postjob.png` — Post Job click
- `04-satp.png` — SATP Explorer
- `05-stats.png` — Protocol Stats
- `06-verify.png` — Verify page
- `07-register.png` — Register page
- `08-launch.png` — Launch Token (BROKEN styling)
- `09-leaderboard.png` — Leaderboard (BROKEN styling)
- `10-activity.png` — Activity page
- `11-mobile-homepage.png` — Mobile homepage (BROKEN styling)
