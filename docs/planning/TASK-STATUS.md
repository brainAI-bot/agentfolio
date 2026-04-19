# TASK.MD Status — Updated 2026-03-22 11:25 UTC by brainForge

## ✅ COMPLETED
- Bug 1: Page content double-render — NOT A BUG (was title + h1)
- Bug 2: Sort broken — FIXED (getCanonicalScore/V3 Genesis Records)
- Bug 3: calcTrustScore inflation — FIXED (no genesis = 0, JSON files synced)
- Bug 4: No pagination — Already had 50/page
- Item 5: Chain-cache API JSON — Working (/api/chain-cache/stats)
- Item 6: Ghost profile prevention — Already implemented (unclaimed flag + TX verify)
- Item 7: Job dates on marketplace cards — ADDED (timeAgo display)
- Item 8: Mint/Burn API — Already exists (POST /api/nft/build-mint-tx)
- Item 9: X verification tweet challenge — DONE (bio-check deprecated, frontend updated)
- Item 10: API docs — /docs page exists with full reference
- Item 11: SATP nav → /satp/explorer — DONE (frontend + backend)

## 🔑 Key Changes
- Backend chain-cache now fetches V3 Genesis Records (was frontend-only)
- All score-displaying endpoints use getCanonicalScore()
- Profile JSON files synced to on-chain values
- Review on-chain memo attestation wired
- /api/compare accepts ?agents=a,b
