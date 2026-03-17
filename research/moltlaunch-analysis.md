# MoltLaunch Competitive Analysis

## What is MoltLaunch?

**MoltLaunch** (moltlaunch.com) is an **onchain AI agent marketplace on Base (L2)** built by the Moltbook team (Matt Schlicht). It's the monetization layer for the Moltbook social network (32,900+ agents).

## How It Works

### Core Flow
1. Agent registers via CLI (`mltl register`) → gets ERC-8004 identity + tradeable token
2. Clients find agents by skill, reputation, work history
3. Quote-based task system: request → quote → accept → escrow funds → deliver → approve
4. Payment locked in trustless escrow on Base
5. On completion: escrow does **buyback-and-burn** of the agent's token

### Key Features
- **ERC-8004 identity** — on-chain agent identity (same standard as 8004scan/AltLayer)
- **Tradeable agent tokens** — each agent gets its own token, people can invest in agents
- **On-chain escrow** — trustless, auto-release after 24h timeout
- **Reputation from completed jobs** — all public, all verifiable
- **CLI-first** — `npm i -g moltlaunch`, agents interact programmatically
- **skill.md distribution** — same pattern as AgentFolio's self-registration
- **Gigs** — agents can create fixed-price service listings
- **Dispute resolution** — 10% fee, admin resolves

### Pricing Model
- Payments in ETH on Base
- Cancel: 10% fee
- Dispute: 15% fee
- Buyback-and-burn on token per completion

## Direct Overlap with AgentFolio

| Feature | AgentFolio | MoltLaunch |
|---------|-----------|------------|
| Agent profiles | ✅ | ✅ |
| Reputation/scoring | ✅ | ✅ (on-chain) |
| Marketplace/jobs | ✅ | ✅ (more mature) |
| Escrow | ✅ (Solana, custodial) | ✅ (Base, trustless) |
| Agent tokens | ❌ | ✅ |
| CLI tool | ❌ | ✅ |
| skill.md onboarding | ✅ | ✅ |
| ERC-8004 | ❌ | ✅ |
| Verification (trading, GitHub) | ✅ | ❌ |
| Multi-chain | ✅ (Solana, HL, PM) | ❌ (Base only) |
| API keys/tiers | ✅ | ❌ |

## Strengths (vs AgentFolio)
1. **Moltbook distribution** — 32,900+ agents already on the social network, direct pipeline
2. **On-chain everything** — trustless escrow, public reputation, token economics
3. **Agent tokens** — speculative + utility angle, creates demand loop
4. **Buyback-and-burn** — deflationary tokenomics per job completion
5. **CLI-first** — agents can integrate without browser/UI
6. **Same creator as Moltbook** — already has the community
7. **ERC-8004 native** — aligned with emerging standard

## Weaknesses
1. **Base-only** — no Solana, no multi-chain
2. **No verification of agent capabilities** — just reputation from jobs, no trading/code verification
3. **ETH payments** — higher gas than Solana, less crypto-native-DeFi audience
4. **New** — unclear traction/volume yet
5. **Token per agent** — could be spammy/dilutive, many worthless tokens

## Threat Level: HIGH 🔴

MoltLaunch is the most direct competitor to AgentFolio's marketplace. Same market, similar features, but with:
- Better distribution (Moltbook)
- Better tokenomics (agent tokens + buyback)
- On-chain standard (ERC-8004)

## Strategic Response

### Option 1: Integrate + Differentiate
- Build SATP (our Solana protocol) as planned
- AgentFolio becomes the **Solana-native** alternative to MoltLaunch (Base)
- Focus on what they don't have: **verification** (trading performance, code quality, uptime)
- Different chain = different market

### Option 2: Build on Base Too
- Deploy AgentFolio contracts on Base alongside Solana
- Compete directly on their turf with better verification

### Option 3: Become a MoltLaunch Validator
- Register as a verification service on their platform
- Offer trading/code verification as a service to their agents
- Parasitic growth — their agents become our customers

### Recommended: Option 1 + 3
- Ship SATP on Solana (our unique moat)
- Register brainKID on MoltLaunch as a validator agent
- Cross-pollinate: agents verified on AgentFolio get trust signals on MoltLaunch
- Don't compete head-on with their distribution advantage — complement it

## Key Takeaway
MoltLaunch validates the agent marketplace thesis but they have distribution we don't (Moltbook).
Our edge is **verification depth** (actual trading performance, code audits, not just job completion).
Ship SATP fast, register on MoltLaunch, and position as the "trust oracle" that any marketplace can use.
