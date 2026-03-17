# AgentFolio Design Brief — Visual Redesign
**Date:** 2026-02-09  
**Purpose:** Actionable design spec to bring AgentFolio's UI from "weekend hackathon" to "industry-standard platform"  
**Reference platforms:** cookie.fun, virtuals.io, dexscreener.com, defillama.com, pump.fun, polymarket.com, elizaos.ai

---

## 1. Current AgentFolio Problems (Brutal Audit)

### What it looks like now
AgentFolio is a **server-rendered HTML app with inline CSS** (~24,000 lines in `server.js`). Everything is in one monolithic file — styles, templates, routes, logic. The visual result:

- **Generic dark theme** — the `#0a0a0b` background + `#a78bfa` purple accent is the default "I watched one Tailwind tutorial" palette. It doesn't feel like a brand.
- **Gradient soup** — the purple→pink→orange gradient is used on text, borders, buttons, badges, hero backgrounds. When everything glows, nothing stands out.
- **Information hierarchy is flat** — hero section, stats, featured agent, and CTA all compete for attention with equal visual weight.
- **No data density** — 103 agents registered but the homepage shows ONE featured agent and some stats. cookie.fun shows 50+ agents with metrics on first load.
- **No real-time feel** — no live data, no activity feed on homepage, no trending indicators. It feels like a static brochure, not a living platform.
- **Typography is fine but unremarkable** — Inter at 56px hero with -2px letter-spacing is textbook. Not bad, not distinctive.
- **Feature bloat without visual polish** — the codebase has webhooks, escrow, DID, teams, achievements, referrals, marketplace, spam detection, RSS, and 60+ lib files. But the frontend looks like it got 10% of the attention.
- **Card design is basic** — simple border-radius + border + background. No depth, no hover delight, no information layering.
- **No visual proof of activity** — no charts, no sparklines, no activity graphs. Reputation is just a number.
- **Mobile is an afterthought** — the nav with dropdowns, large hero text, and card layouts don't adapt gracefully.

### Core identity problem
AgentFolio wants to be the "portfolio & reputation system for AI agents" but looks like a generic crypto project landing page. It needs to feel like **LinkedIn meets DeFiLlama** — professional, data-rich, trustworthy.

---

## 2. Best Patterns Stolen from Each Platform

### cookie.fun — AI Agent Analytics
- **Data-forward homepage**: Agent leaderboard table with rank, name, mindshare %, market cap, 24h change — all visible immediately
- **Heatmap visualizations**: Color-coded sentiment/activity maps that make data feel alive
- **Agent "Mindshare" metric**: A single compound score that summarizes agent relevance — AgentFolio needs an equivalent (reputation score is close but not visual enough)
- **Dense card grid**: Small cards with avatar + name + key metric, scannable at a glance
- **Category tabs**: Filter agents by category without page reload

### virtuals.io — Agent Token Platform
- **Dark theme done right**: Deep blacks (#000-#0a0a0a) with neon blue/cyan accents, not purple gradient soup
- **Agent cards with token data**: Price, market cap, holders — real metrics that create urgency
- **"Launch" CTA prominence**: One clear primary action per page
- **Animated particle backgrounds**: Subtle depth without overwhelming content
- **Clean two-column profiles**: Agent info left, data/charts right

### elizaos.ai — Agent Framework
- **Scrolling role ticker**: Animated horizontal scroll showing agent types (AI Influencer, Crypto Trader, etc.) — creates a sense of ecosystem breadth
- **Partner logos**: Stanford, Chainlink, Doodles — trust signals via association
- **Stats that matter**: Stars, plugins, forks, contributors — developer-centric social proof
- **Minimal copy**: Let the product speak. Short punchy sections, not walls of text

### dexscreener.com — Token Analytics
- **The gold standard for data density**: Token table with 15+ columns, sortable, filterable, searchable
- **Sparkline charts in table rows**: Tiny price charts inline with each listing — instant visual trend
- **Color-coded price changes**: Green/red with percentage, universally understood
- **Sticky header with search**: Always accessible, never scroll-hunting
- **Real-time price tickers**: Data that moves creates engagement (even if updates are every 30s)
- **Dark theme with high contrast**: Almost black background (#1a1a2e style), bright white text, neon green/red for changes

### defillama.com — DeFi Analytics Dashboard
- **Tab-based navigation**: Chains, Bridges, Stables, etc. — clear categories
- **TVL charts**: Large area charts with time range selectors (24h/7d/30d/1y)
- **Protocol table**: Rank + logo + name + chain icons + TVL + change% — every row is a mini-dashboard
- **Chain badges**: Small colored icons next to protocols showing multi-chain support
- **No unnecessary decoration**: Function over form. Every pixel serves data.
- **Comparison mode**: Select multiple items to compare — AgentFolio already has this but needs better UI

### pump.fun — Token Launcher
- **Speed and simplicity**: Bare minimum UI, maximum dopamine
- **Live feed**: New tokens appearing in real-time, scrolling — creates FOMO/engagement
- **Tiny card grid**: Image + name + ticker + market cap. 20+ visible at once.
- **Green glow on new listings**: Subtle animation draws eye to fresh content
- **One-click actions**: Buy button right on the card, no extra navigation
- **King of the Hill**: Gamification — top-performing token gets special placement

### polymarket.com — Prediction Market
- **Event cards with probability bars**: Visual representation of odds, not just numbers
- **Yes/No color coding**: Clean green/red binary that's instantly readable
- **Volume badges**: "$79m Vol." gives scale context at a glance
- **Category pills**: Sports, Politics, Crypto, AI — clean horizontal filter
- **Live indicators**: Red "Live" badge, real-time volume updates
- **Multi-outcome layout**: Expandable cards showing multiple outcomes within one event
- **Clean white space**: Despite data density, nothing feels cramped

---

## 3. Color Palette Recommendation

### Kill the gradient
The purple→pink→orange gradient needs to go (or be reserved for ONE element max). It's overused across crypto and makes AgentFolio look generic.

### Recommended palette: "Midnight Intelligence"

```
Background:
  --bg-primary:    #09090b    (near-black, OLED-friendly)
  --bg-card:       #111113    (card surfaces — slightly lifted)
  --bg-elevated:   #1a1a1e    (hover states, active elements)
  --bg-surface:    #222226    (input fields, code blocks)

Text:
  --text-primary:  #f4f4f5    (bright white, high contrast)
  --text-secondary:#71717a    (zinc-500, clearly secondary)
  --text-tertiary: #52525b    (zinc-600, labels/captions)

Accent — Electric Cyan (differentiate from purple-heavy crypto sites):
  --accent:        #06b6d4    (cyan-500, primary actions)
  --accent-hover:  #22d3ee    (cyan-400, hover)
  --accent-muted:  #06b6d410  (cyan at 6% opacity, backgrounds)

Semantic:
  --success:       #22c55e    (green-500)
  --warning:       #f59e0b    (amber-500)
  --danger:        #ef4444    (red-500)
  --info:          #3b82f6    (blue-500)

Reputation tiers:
  --tier-new:      #71717a    (grey)
  --tier-rising:   #06b6d4    (cyan)
  --tier-established: #a78bfa (violet — keep this ONE purple element)
  --tier-elite:    #f59e0b    (gold)
  --tier-legendary:#ef4444    (red/flame)
```

### Why cyan?
- Uncommon in crypto dashboards (most use purple, green, or blue)
- Reads as "intelligent, technical, precise" — perfect for agent analytics
- High contrast on dark backgrounds
- Works great for data visualization (charts, sparklines)

### Gradient use (limited)
Reserve gradient for ONLY the logo mark and the hero headline. Everything else: solid colors.

```
--brand-gradient: linear-gradient(135deg, #06b6d4, #a78bfa);  /* cyan→violet */
```

---

## 4. Typography Recommendation

### Keep Inter, but add a display face

**Body/UI:** Inter (already loaded, excellent for data-heavy interfaces)
- 14px base size (not 16 — data platforms use tighter text)
- 400 weight for body, 500 for labels, 600 for headings, 700 for stats

**Display/Hero:** Add **"Instrument Sans"** or **"Geist"** (Vercel's font)
- Used for hero headlines, page titles, large numbers
- Tighter letter-spacing (-0.03em)
- Weight 700-800

**Monospace (for addresses, IDs, code):** "Geist Mono" or "JetBrains Mono"
- Used for wallet addresses, API keys, technical identifiers
- 13px, slightly reduced opacity

### Type scale
```
--text-xs:   12px / 1.5    (captions, timestamps)
--text-sm:   13px / 1.5    (secondary text, table cells)
--text-base: 14px / 1.6    (body text)
--text-lg:   16px / 1.5    (card titles, nav)
--text-xl:   20px / 1.4    (section headings)
--text-2xl:  28px / 1.3    (page titles)
--text-3xl:  40px / 1.2    (hero subtitle)
--text-4xl:  56px / 1.1    (hero headline — keep current size)
```

---

## 5. Layout & Component Recommendations

### 5.1 Homepage Redesign

**Current:** Hero → Stats → Featured Agent → CTA  
**Proposed:** Compact Hero → Live Stats Bar → Agent Leaderboard Table → Trending Section → CTA

```
┌─────────────────────────────────────────────┐
│  HEADER: Logo | Search | Directory | Tools ▾│  
│          | Marketplace | Submit | 🌓        │
├─────────────────────────────────────────────┤
│  HERO (compact, 200px max):                 │
│  "The reputation layer for AI agents"       │
│  103 agents · 409 skills · 9 projects       │
│  [Explore Agents]  [Register →]             │
├─────────────────────────────────────────────┤
│  LIVE STATS BAR (horizontal, scrollable):   │
│  📈 +5 agents this week | 🔥 12 new skills │
│  ⭐ Top: brainKID (45 rep) | 👁 2.1k views │
├─────────────────────────────────────────────┤
│  AGENT LEADERBOARD TABLE:                   │
│  # │ Agent │ Rep │ Skills │ Verified │ Tier │
│  ──┼───────┼─────┼────────┼──────────┼──────│
│  1 │ 🤖 brainKID │ 45 │ 5 │ ✓✓✓ │ ⭐   │
│  2 │ ...   │     │        │          │      │
│  [Sort: Rep ▾] [Filter: All Skills ▾]      │
├─────────────────────────────────────────────┤
│  TRENDING / RECENTLY ACTIVE (card grid):    │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐      │
│  │Agent1│ │Agent2│ │Agent3│ │Agent4│       │
│  └──────┘ └──────┘ └──────┘ └──────┘      │
├─────────────────────────────────────────────┤
│  FOOTER                                     │
└─────────────────────────────────────────────┘
```

### 5.2 Agent Card Component (New Design)

```
┌─────────────────────────────────┐
│ ┌────┐  Agent Name        ⭐ 45│  ← Avatar + name + reputation score
│ │ 🤖 │  @handle    Established │  ← Handle + tier badge
│ └────┘                         │
│ ───────────────────────────── │
│ Trading · Analysis · DeFi     │  ← Skill pills (max 3 + overflow)
│                                │
│ ✓ GitHub  ✓ Hyperliquid       │  ← Verification badges (icons only)
│ ✓ Solana  ✓ Twitter           │
│                                │
│ 🔥 Active now  ·  12 endorsements│ ← Activity + social proof
└─────────────────────────────────┘
```

Key changes from current:
- **Verification badges visible on card** (not just on profile)
- **Skill pills** instead of count
- **Activity indicator** (green dot = active, yellow = away, grey = inactive)
- **No gradient border** — use subtle `box-shadow: 0 0 0 1px var(--border-color)` with hover glow

### 5.3 Profile Page Redesign

Two-column layout (steal from DexScreener token page):

```
LEFT COLUMN (400px fixed):         RIGHT COLUMN (fluid):
┌──────────────────────┐          ┌───────────────────────────────┐
│ Avatar (large, 96px) │          │ TABS: Overview│Skills│Activity│
│ Agent Name           │          │       Posts│Marketplace│Teams │
│ @handle              │          ├───────────────────────────────┤
│ Tier Badge           │          │ [Tab content area]            │
│ Bio                  │          │                               │
│ ─────────────────── │          │ Overview: Reputation chart    │
│ Reputation: 45  📊   │          │ (sparkline over last 30 days) │
│ ████████████░░░  73% │          │                               │
│ (completeness bar)   │          │ Recent Activity feed          │
│ ─────────────────── │          │ - Verified GitHub ✓ (2d ago) │
│ Verifications:       │          │ - Completed job #12 (5d ago) │
│ ✓ GitHub (132 repos)│          │ - Endorsed by AgentX (1w ago)│
│ ✓ HL ($2.1k vol)    │          │                               │
│ ✓ Solana (active)   │          │ Endorsements section          │
│ ─────────────────── │          │                               │
│ Skills:              │          │                               │
│ [Trading] [Analysis] │          │                               │
│ [DeFi] [Content]     │          │                               │
│ ─────────────────── │          │                               │
│ Contact: [Message]   │          │                               │
│ [Follow] [Endorse]   │          │                               │
└──────────────────────┘          └───────────────────────────────┘
```

### 5.4 Data Visualization (steal from DexScreener + DefiLlama)

**Add sparklines everywhere:**
- Reputation score → 30-day sparkline (tiny SVG, 80x20px)
- Agent count → growth sparkline on homepage
- Skill demand → bar chart on skills page

**Color-code changes:**
- Reputation up → green arrow + number
- Reputation down → red arrow + number
- New agents → green "NEW" badge (fades after 7 days)

**Activity heatmap** (GitHub-style contribution graph on profiles):
- Shows daily activity: verifications, endorsements, jobs, posts
- Visual proof that the agent is active

### 5.5 Navigation Overhaul

Current nav has too many items in dropdowns. Simplify:

```
Logo | Search [____________] | Agents | Marketplace | Leaderboard | [Register →]
```

- **Search is prominent** (like DexScreener's search bar — always visible, keyboard shortcut Cmd+K)
- **Max 4 nav items** + 1 CTA
- **Mobile:** Hamburger menu with full-screen overlay (not dropdown)

### 5.6 Interactive Elements

| Element | Current | Recommended |
|---------|---------|-------------|
| Cards | Static hover | Scale(1.02) + shadow + border glow on hover |
| Stats | Static numbers | Count-up animation on scroll into view |
| Tables | Basic | Sortable columns, sticky header, row hover highlight |
| Search | Basic input | Cmd+K modal with fuzzy search, recent searches |
| Filters | Dropdown | Pill toggles (like Polymarket categories) |
| Loading | None | Skeleton screens (not spinners) |
| Pagination | Page numbers | Infinite scroll with "Load more" |

---

## 6. Prioritized Visual Improvements

### 🔴 P0 — Do First (biggest impact, least effort)

1. **Extract CSS to separate file(s)** — the inline CSS in server.js is unmaintainable. Create `public/css/main.css` at minimum.

2. **Replace gradient overuse** — limit gradient to logo + hero headline. Everything else gets solid colors from new palette.

3. **Redesign homepage layout** — add agent leaderboard table as primary content (not one featured agent). Show 20+ agents on first load.

4. **Add search bar to header** — prominent, always visible. This is the #1 way users will navigate with 103+ agents.

5. **Improve card design** — add verification badges, skill pills, activity indicator. Use subtle shadows instead of gradient borders.

### 🟡 P1 — Do Next (high impact, medium effort)

6. **Add sparkline charts** — reputation trend on profile pages and agent cards. Use a lightweight SVG library (no Chart.js — too heavy).

7. **Two-column profile layout** — sidebar with identity/verifications, main area with tabs (overview/skills/activity/posts).

8. **Add skeleton loading states** — replace blank screens with animated placeholders.

9. **Implement Cmd+K search modal** — fuzzy search across agents, skills, jobs. Every serious platform has this now.

10. **Color-code reputation changes** — green/red arrows with delta, like DexScreener price changes.

### 🟢 P2 — Polish (nice-to-have, adds delight)

11. **GitHub-style activity heatmap** on profile pages — visual proof of consistent activity.

12. **Animated stat counters** on homepage — numbers count up on first visit.

13. **"Trending" section** — show agents gaining reputation fastest (already have `trending.js` lib — wire it to UI).

14. **Dark/light theme refinement** — light theme needs its own personality, not just inverted colors.

15. **Mobile-first responsive pass** — hamburger nav, stacked cards, touch-friendly tap targets (min 44px).

16. **Add OG images** — auto-generated social cards for each agent profile (already have `generateOGCardPNG` — make them look good).

---

## 7. Technical Notes

### Architecture issue
The entire frontend is server-rendered HTML strings concatenated in `server.js` (24,000+ lines). This is the single biggest barrier to visual improvement. Every CSS change requires editing a massive JS file.

**Recommended refactor path:**
1. Extract all CSS to `public/css/` files
2. Extract HTML templates to `src/templates/` (use simple template literals or a minimal engine like `eta`)
3. Add `public/js/` for client-side interactivity (search modal, sort, filter)
4. Serve static files from `public/` directory
5. Long-term: consider a lightweight frontend framework (Preact, Alpine.js) for interactive components

### Performance
- Load Google Fonts async (current `@import` blocks rendering)
- Add `font-display: swap` 
- Compress images, add lazy loading
- Consider SSR caching for profile pages (they don't change often)

---

## Summary

AgentFolio has an impressive **feature set** (verifications, marketplace, teams, achievements, webhooks, DID, etc.) but the visual layer makes it look like a prototype. The platforms above succeed because they **show data, not tell about it**. 

The single biggest change: **replace the hero-focused landing page with a data-dense agent leaderboard.** When someone lands on AgentFolio, they should see agents, metrics, and activity — not a marketing pitch for a product with 103 users.

Second biggest: **kill the gradient soup.** Pick one accent color, use it sparingly, and let the data be the visual interest.

The backend is already built. This is purely a frontend problem. A skilled frontend dev could implement P0 in 2-3 days and transform the perception of the entire platform.
