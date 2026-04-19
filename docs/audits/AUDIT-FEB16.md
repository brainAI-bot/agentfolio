# AgentFolio Audit — February 16, 2026

## 1. Crash Cause + Fix

**Root cause:** `TypeError: WebSocketServer is not a constructor` in `src/lib/websocket.js:15`

The `ws` package installed exports `Server`, not `WebSocketServer` (the latter was added in ws v8+, but the installed version uses the older export name).

**Fix applied:** Changed `const { WebSocketServer } = require('ws')` → `const { Server: WebSocketServer } = require('ws')` in `src/lib/websocket.js`.

**Result:** Server stable (57,798 prior restarts stopped, 0 new restarts after fix). Running on port 3333, HTTP 200 on `/`.

---

## 2. Architecture Overview

- **server.js:** 25,720-line monolith handling all routing via raw `http` module (no Express). All HTML is inline template literals.
- **src/lib/:** 95+ module files covering features from verification to marketplace to DID
- **No templating engine** — all pages are inline HTML in server.js
- **WebSocket support** for real-time activity feed
- **SQLite database** (`src/lib/database.js`)
- **PM2 managed** as "agentfolio"

---

## 3. Full Route/Feature Inventory

### Pages (HTML)
| Route | Status | Description |
|-------|--------|-------------|
| `/` | ✅ Working | Homepage / profile directory |
| `/connect` | ✅ Serves HTML | Wallet connect / onboarding |
| `/join` | ✅ Serves HTML | Registration form |
| `/search` | ✅ Working | Search profiles |
| `/leaderboard` | ✅ Serves HTML | Rankings |
| `/activity` | ✅ Serves HTML | Activity feed |
| `/following` | ✅ Serves HTML | Follow feed |
| `/compare` | ✅ Serves HTML | Agent comparison |
| `/skills`, `/taxonomy` | ✅ Serves HTML | Skills browser |
| `/profile/:id` | ✅ Working | Profile page |
| `/profile/:id/edit` | ✅ Serves HTML | Profile editor |
| `/profile/:id/trading` | ✅ Serves HTML | Trading dashboard |
| `/profile/:id/dashboard` | ✅ Serves HTML | Analytics dashboard |
| `/profile/:id/achievements` | ✅ Serves HTML | Achievements page |
| `/profile/:id/embed` | ✅ Serves HTML | Embeddable widget |
| `/profile/:id/verification-report` | ✅ Serves HTML | Verification details |
| `/profile/:id/skill-badges` | ✅ Serves HTML | Skill badges |
| `/profile/:id/rank` | ✅ Serves HTML | Rank card |
| `/profile/:id/keys` | ✅ Serves HTML | API key management |
| `/badge/:id` | ✅ Serves HTML/SVG/JS | Embeddable badges |
| `/embed/:id` | ✅ Serves HTML | Embed widget |
| `/skill-badge/:id` | ✅ Serves HTML | Skill badge display |

### API Endpoints (sampled, 100+ total)
- **Profiles:** CRUD, search, register, avatar upload, availability
- **Verification:** Hyperliquid, Solana, GitHub, AgentMail, Telegram, Twitter, auto-verify
- **Social:** Reviews, endorsements, follows, posts, messages, peer reviews
- **Marketplace:** Jobs, escrow, collaborations, featured auctions
- **Identity:** DID resolution/linking, API keys, cross-chain identity
- **Analytics:** Trading leaderboard, ecosystem stats, trending, spotlight
- **Admin:** Cache, health, metrics, bug reports, feature requests
- **SATP:** Registry + explorer endpoints (trust attestations)

### Data: 0 profiles currently in database

---

## 4. SATP Integration Status

**Files:**
- `src/lib/satp-registry.js` (345 lines) — Trust attestation storage, composite trust scores
- `src/lib/satp-explorer.js` (146 lines) — SATP explorer/browser
- `tests/satp-registry.test.js` — Test file exists

**Server integration:** 21 SATP references in server.js — routes are wired up. Includes:
- Trust attestation submission/querying
- Trust score computation
- SATP explorer page

**Status:** Code exists and is integrated into routing. Appears functional but untested with real data (0 profiles = 0 attestations).

---

## 5. What's Broken vs Working

### ✅ Working
- Server boots and responds (after WS fix)
- Homepage loads (HTTP 200)
- All route handlers are wired
- Database initializes (Schema, Teams, Achievements, Analytics, Availability, Onboarding)
- WebSocket server initializes
- Scheduled tasks run (analytics cleanup, availability checks, onboarding scans)

### ⚠️ Likely Issues
- **0 profiles** — empty database, no seed data
- **Monolithic server.js** (25K lines) — unmaintainable, any edit risks breaking everything
- **No Express/framework** — raw HTTP routing is fragile
- **Inline HTML** — no separation of concerns, impossible to maintain templates
- **No tests running** — test files exist but no CI
- **Phantom wallet demo files** bloating repo (entire browser extension copied into `demo/phantom-ext/`)

### ❓ Unknown (needs manual testing)
- Wallet connect flow (requires Phantom/Solana wallet)
- Escrow system (requires funded wallets)
- Twitter sync (requires API keys)
- Telegram verification (requires bot setup)

---

## 6. Remaining Roadmap with Effort Estimates

| Priority | Task | Effort | Notes |
|----------|------|--------|-------|
| 🔴 Critical | **Refactor server.js** into Express + routes | 3-5 days | 25K lines is unsustainable |
| 🔴 Critical | **Extract HTML templates** to EJS/Pug files | 2-3 days | Currently all inline |
| 🟡 High | **Seed demo profiles** | 2 hours | Database is empty |
| 🟡 High | **Clean up demo/phantom-ext/** | 30 min | Delete copied browser extension |
| 🟡 High | **Add health monitoring** | 1 hour | PM2 already handles restarts |
| 🟢 Medium | **SATP end-to-end testing** | 1 day | Code exists, needs validation |
| 🟢 Medium | **Set up test suite** | 1 day | Test files exist, need runner |
| 🟢 Medium | **Marketplace flow testing** | 1 day | Escrow, jobs, auctions |
| 🟢 Medium | **Mobile responsive audit** | 1 day | Unknown current state |
| 🔵 Low | **API documentation** | 1 day | `/api/keys/docs` exists but coverage unknown |
| 🔵 Low | **Rate limiting audit** | 4 hours | `rate-limit.js` exists |
| 🔵 Low | **Security hardening** | 1 day | Input sanitization, auth flows |

---

## 7. Design/UI Assessment

- All UI is inline HTML with CSS custom properties (dark theme)
- Uses a design system with `--bg-*`, `--text-*`, `--accent-*` variables
- Has theme toggle (dark/light)
- Bug report modal on every page
- Onboarding checklist system
- Claim/follow/wallet-connect flows are client-side JS
- No build system (no webpack/vite) — all vanilla JS
- Static assets in `public/` (CSS, JS, images)

**Overall:** Functional but needs significant architectural work to be maintainable. The 25K-line monolith is the #1 tech debt item.
