# Token Launch Business Model Research

**Date:** 2025-02-12  
**Purpose:** Evaluate business models for AI agent token launchpads to inform AgentFolio's token launch feature

---

## 1. Pump.fun — The Gold Standard

### Revenue Model
- **Total revenue:** $571M+ since March 2024 launch; ~$780M+ by mid-2025
- **Peak day:** $15.5M in fees (Jan 24, 2025)
- **Market share:** ~62% of Solana memecoin launches

### Fee Structure
| Fee Type | Amount | Who Pays |
|----------|--------|----------|
| Token creation (no buy) | **Free** | Creator |
| Token creation (with buy) | **0.025 SOL** (~network fee) | Creator |
| Trading fee (pre-graduation) | **1.25% total** | Traders (buyer/seller) |
| Graduation fee | **1.5 SOL** (~$300-400 at current prices) | Deducted from bonding curve pool |
| Post-graduation (Project Ascend) | **Dynamic 0.05%-0.95%** based on mcap | Traders |

### Key Design Choices
- **No token allocation to platform** — 100% fair launch, all supply on bonding curve
- **Creator gets 0%** of supply (but Project Ascend now shares trading fees with creators: up to 0.95% per trade at low mcap, declining as mcap grows)
- **Bonding curve model:** Token trades on internal AMM until ~$69K mcap, then "graduates" to Raydium with real liquidity
- **Gas:** Solana's low fees (~$0.01-0.05) make this friction-free; user pays their own gas

### Why It Works
- Near-zero creation cost = maximum experimentation
- 1% on every trade = massive volume-based revenue
- Graduation fee = one-time extraction at success milestone

---

## 2. Virtuals Protocol (Base Chain)

### Revenue Model
- Built on Base (Ethereum L2)
- Focus on AI agents specifically (not generic memecoins)

### Fee Structure
| Fee Type | Amount | Who Pays |
|----------|--------|----------|
| Agent creation | **100 $VIRTUAL tokens** (~varies with price) | Creator |
| Trading tax | **1% on all trades** | Traders |
| Graduation threshold | **42,000 $VIRTUAL** accumulated in bonding curve | Market participants |

### Post-Graduation Fee Distribution (1% tax)
- **50%** → Agent SubDAO treasury (funds agent operations: inference, GPU)
- **30%** → Protocol treasury
- **20%** → Agent Affiliates (trading platforms, TG bots that integrate)

### Key Design Choices
- **Fair launch** — no pre-allocation to creators
- **1 billion tokens** minted per agent at graduation
- **Liquidity locked for 10 years** after graduation
- Revenue from agent interactions (inference costs) feeds back into token buyback & burn
- **$VIRTUAL is the base pair** for all agent tokens (not SOL/ETH directly)

### Why It's Different
- Agents are meant to be *productive* — generate revenue from services
- Token value tied to agent utility, not just speculation
- Ecosystem token ($VIRTUAL) captures value from all agents

---

## 3. ElizaOS / ai16z (Solana)

### Status (as of Feb 2025)
- Rebranded from ai16z to ElizaOS
- **Launchpad planned but not fully live** — announced for Q1 2025
- Built on Eliza framework (open-source AI agent framework)

### Planned Model
- AI agent launchpad similar to pump.fun but specifically for Eliza-based agents
- $AI16Z (now elizaOS token) as base currency
- Listing fees for new agents
- Staking mechanisms
- Liquidity pools paired with AI16Z token
- Trading fees used to buy back AI16Z tokens

### Key Difference
- Framework-first approach: you build the agent with Eliza, then tokenize it
- Token ($AI16Z) hit $2B mcap before launchpad even launched
- Considering own L1 blockchain for AI agent operations

---

## 4. Other Competitors & Adjacent Platforms

| Platform | Chain | Model | Status |
|----------|-------|-------|--------|
| **pump.fun** | Solana | Generic memecoin launchpad | Dominant, $780M+ rev |
| **Virtuals** | Base | AI agent launchpad | Live, leading on Base |
| **ElizaOS/ai16z** | Solana | AI agent framework + planned launchpad | Partially live |
| **DAIN Protocol** | Solana | Agent-to-agent commerce | Early stage |
| **Creator.Bid** | Multiple | AI agent creation + tokenization | Niche |
| **TopHat** | Solana | Agent token launcher | Small |

### Gap in Market
**Nobody is doing "agent token launch as a managed service"** — all existing platforms require the agent creator to handle the launch themselves. There's no platform where an AI agent can autonomously decide to launch its own token with minimal human intervention.

---

## 5. Recommended Model for AgentFolio

### The Opportunity
AgentFolio already has agent profiles with verified credentials (GitHub, Hyperliquid, Solana wallets). Adding token launch = **turning reputation into liquidity**.

### Proposed Fee Structure

#### Option A: Lean Pump.fun Wrapper (Recommended)
| Fee | Amount | Rationale |
|-----|--------|-----------|
| Launch fee | **0.1 SOL** (~$20) | Covers gas + small margin; low enough for experimentation |
| Trading happens on pump.fun | pump.fun takes their 1% | We don't touch trading fees |
| AgentFolio service fee | **2% of initial buy** (if agent buys own token) | One-time extraction |
| Profile badge | Free | "Token Launched" badge on AgentFolio profile |

**Revenue model:** Volume × small fee. If 100 agents launch tokens/month with avg 0.5 SOL initial buy → ~1 SOL/month revenue. Scales with adoption.

#### Option B: Full Platform (Higher Revenue, More Work)
| Fee | Amount | Rationale |
|-----|--------|-----------|
| Launch fee | **0.5 SOL** | Premium positioning |
| Platform allocation | **2-5% of token supply** to AgentFolio treasury | Revenue from successful tokens |
| Ongoing trading fee | **0.5% on trades** through AgentFolio interface | Only if building own DEX frontend |

**Problem with Option B:** Requires building/maintaining trading infrastructure. Not worth it early on.

#### Option C: Freemium (Growth-First)
| Tier | Fee | Features |
|------|-----|----------|
| Free | 0 SOL | Basic launch on pump.fun, standard profile |
| Pro | 0.25 SOL | Custom branding, launch analytics, promoted placement |
| Enterprise | 1 SOL | White-glove launch, marketing support, featured on homepage |

### Recommendation: **Option A with elements of C**

1. **Free to launch** (agent pays only pump.fun's native fees + gas)
2. **AgentFolio takes 0% of supply** — maintain trust and fair launch ethos
3. **Monetize through premium features:**
   - Featured placement on AgentFolio directory: 0.1 SOL
   - Launch analytics dashboard: 0.05 SOL/month
   - "Verified Agent" badge (requires AgentFolio profile with credentials): Free (drives platform adoption)
4. **Long-term monetize through volume:**
   - If AgentFolio becomes the go-to place agents launch from, add referral fees or integrate as a Virtuals-style affiliate (20% of trading fees from platforms that integrate)

---

## 6. Self-Service vs. Gated?

### Self-Service (Recommended for MVP)
- Any agent with an AgentFolio profile can launch
- Requires: connected Solana wallet, at least 1 verified credential
- Automated process: agent calls API → token created on pump.fun
- **Why:** Lower friction = more launches = more activity = more visibility

### Light Gating (Phase 2)
- "Verified Agent" launches get promoted
- Unverified launches still work but don't appear in curated feed
- Anti-spam: require minimum profile age (7 days) or GitHub verification

### Hard Gating (Not Recommended)
- Approval process kills momentum
- Pump.fun proved permissionless > curated for volume

---

## 7. Key Takeaways

1. **1% trading fee is the proven model** — pump.fun and Virtuals both use it
2. **Don't take supply allocation** — fair launch ethos is critical in this space; taking % of supply = instant trust deficit
3. **Creation should be free or near-free** — pump.fun's $0 creation fee drove adoption
4. **Graduation/migration fee is clever** — extract value at the success milestone, not at creation
5. **The real money is in trading volume**, not launch fees
6. **AgentFolio's edge:** Verified agent identity + reputation makes token launches more credible than anonymous pump.fun launches
7. **Nobody else is doing agent-native token launches** — most platforms are human-operated; AgentFolio could be the first where agents autonomously launch and manage their own tokens

### Revenue Projections (Conservative)

| Scenario | Monthly Launches | Avg Trading Vol/Token | AgentFolio Rev (if 0.25% referral) |
|----------|-----------------|----------------------|-----------------------------------|
| Early | 10 | 50 SOL | 1.25 SOL (~$250) |
| Growth | 100 | 200 SOL | 50 SOL (~$10K) |
| Scale | 1,000 | 500 SOL | 1,250 SOL (~$250K) |

The real upside is **not direct fees** — it's becoming the trusted registry for agent tokens, which drives traffic, partnerships, and platform value.

---

## Sources
- pump.fun docs & Wikipedia
- Virtuals Protocol Whitepaper (whitepaper.virtuals.io)
- Forbes, CoinMarketCap, Decrypt, The Block reporting
- ElizaOS/ai16z ecosystem announcements
- Research date: February 2025
