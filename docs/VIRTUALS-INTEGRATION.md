# Virtuals Protocol Integration — $FOLIO Token Launch

> **Last updated:** 2026-02-17  
> **Status:** Research complete — ready for execution planning

---

## Table of Contents
1. [Overview](#overview)
2. [Contract Addresses](#contract-addresses)
3. [Launch Mechanisms](#launch-mechanisms)
4. [Standard Launch — Step by Step](#standard-launch--step-by-step)
5. [60 Days Framework](#60-days-framework)
6. [Costs & Requirements](#costs--requirements)
7. [SDK & Tooling](#sdk--tooling)
8. [ACP (Agent Commerce Protocol)](#acp-agent-commerce-protocol)
9. [Practical Steps to Launch $FOLIO](#practical-steps-to-launch-folio)

---

## Overview

Virtuals Protocol is an on-chain ecosystem on **Base** (and Solana) for tokenized AI agents. Each agent gets an ERC-20 token paired with $VIRTUAL on a bonding curve. Once 42,000 $VIRTUAL accumulates, the agent "graduates" (red-pills) to a Uniswap V2 pool.

**Key facts:**
- Chain: **Base** (primary), Solana (secondary)
- Token pair: Agent token / $VIRTUAL
- Fixed supply per agent: **1,000,000,000 tokens**
- Graduation threshold: **42,000 $VIRTUAL** (technically 41,600 in bonding curve)
- Creation fee: **100 $VIRTUAL**
- Framework-agnostic — no requirement to use GAME framework

---

## Contract Addresses

| Contract | Address |
|----------|---------|
| **$VIRTUAL Token (Base)** | `0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b` |
| **$VIRTUAL Token (ETH)** | `0x44ff8620b8cA30902395A7bD3F2407e1A091BF73` |
| **Pre-bonding Token Lock Vault** | `0xdAd686299FB562f89e55DA05F1D96FaBEb2A2E32` |
| **Sell Wall Wallet** | `0xe2890629EF31b32132003C02B29a50A025dEeE8a` |
| **Sell Order Executor** | `0xF8DD39c71A278FE9F4377D009D7627EF140f809e` |

**Smart Contract Architecture** (from audit repo `code-423n4/2025-04-virtuals-protocol`):
- `AgentFactoryV4.sol` — Main factory for creating agents (proxy, upgradeable)
- `Bonding.sol` — Bonding curve logic (300 lines, ReentrancyGuard)
- `FFactory.sol` — Fun Factory for deploying prototype tokens
- `FRouter.sol` — Router for bonding curve trades
- `FERC20.sol` — Prototype agent token (ERC-20)
- `AgentToken.sol` — Graduated agent token (422 lines, upgradeable)
- `AgentNftV2.sol` — Agent NFT minted on graduation
- `Genesis.sol` — Genesis launch mechanism

---

## Launch Mechanisms

### 1. Standard Launch (Recommended for $FOLIO)
- **Anyone can launch** — no approval needed
- Pay 100 $VIRTUAL → agent deploys on bonding curve as "Prototype"
- Optional: pre-buy up to 87.5% of supply at creation
- Once 42K $VIRTUAL accumulates → graduates to "Sentient Agent"
- Uniswap V2 LP created, LP tokens locked for 10 years

### 2. Genesis Launch
- Scheduled launch date, 24h pledge window
- Requires community pledging (points-based)
- Dynamic thresholds: 21K / 42K / 100K $VIRTUAL
- Agent is immediately Sentient on success
- **Not recommended for $FOLIO** — requires existing Virtuals community support

### 3. Existing Token Migration (Base only)
- Pair existing Base ERC-20 with 42K $VIRTUAL
- Bypasses bonding curve, immediately Sentient
- Token must already be on Base chain

---

## Standard Launch — Step by Step

### On-Chain Creation Form (via app.virtuals.io)

**Mandatory fields:**
1. **Profile Picture** — Logo/avatar for the agent
2. **AI Agent Name** — e.g., "AgentFolio"
3. **Ticker** — Max 10 chars, no `$` prefix (e.g., `FOLIO`)
4. **Biography** — Agent description, purpose, personality

**Agent Type** (select one):
- ON-CHAIN (trading)
- INFORMATION
- PRODUCTIVITY ← Best fit for AgentFolio
- CREATIVE
- ENTERTAINMENT

### Pre-buy Supply Table

| $VIRTUAL Spent | Supply Acquired |
|----------------|-----------------|
| 1,100 | 15% |
| 2,600 | 30% |
| 4,100 | 40% |
| 6,000 | 50% |
| 9,000 | 60% |
| 14,000 | 70% |
| 24,000 | 80% |
| 42,000 | 87.5% (max) |

**After graduation**, remaining 12.5% goes to Uniswap pool.

### Post-Graduation On-Chain Flow
1. Agent NFT minted → stored in Agent Creation Factory
2. Immutable Contribution Vault (ICV) created (ERC-1155 TBA)
3. ERC-20 token created (1B fixed supply)
4. Full supply minted
5. Uniswap V2 LP created ($AGENT / $VIRTUAL)
6. LP tokens staked with **10-year lock**
7. $sAGENT tokens distributed as LP receipt

### Fee Structure (Post-Graduation)
- 1% trading fee on all trades
- 30% → Creator
- 70% → Agent Wallet + SubDAO

---

## 60 Days Framework

### What It Is
A **trial-based launch** where founders build publicly for 60 days. At end of trial, founder decides to **Commit** or **Not Commit**.

- If Commit → token continues, raised funds unlock over time
- If Not Commit → token winds down, raised funds returned to holders

### Key Features
- **Reversibility by design** — shutting down is a legitimate outcome
- **Credibility preservation** — no permanent on-chain stain if you wind down
- Token launches on Base with standard bonding curve
- Private pools initially → Uniswap V2 after 42K $VIRTUAL volume

### Founder Compensation During Trial
1. **Trading fees**: 1% fee split 30:70 (protocol:founder), founder's share locked until commitment
2. **ACF (Automated Capital Formation)**: Capital released as market reprices project higher
3. **Stipends**: 10% of collected funds every 30 days (Day 30 & Day 60), capped at $5,000 USDC
4. **Growth Allocation (optional)**: Sell up to 5% team tokens at fixed FDV, USDC held in escrow until commit

### Application
- **Form:** https://forms.gle/Hn3FWLq12GafujRP8
- **Requirements:** Need to apply (not permissionless like Standard Launch)
- **Info needed:** Project details, team background, what you're building, why 60 days

### Should $FOLIO Use 60 Days?
**Pros:**
- Lower risk — can walk away if traction doesn't materialize
- Built-in narrative ("we're building in public for 60 days")
- Access to stipends during trial

**Cons:**
- Requires application approval (not instant)
- Funds locked during trial
- Newer mechanism, less proven
- Full refunds not guaranteed on wind-down

**Recommendation:** Start with **Standard Launch** for speed and control. 60 Days is better suited for projects still validating product-market fit. AgentFolio already has a live product.

---

## Costs & Requirements

### Minimum Cost
- **Agent creation fee:** 100 $VIRTUAL (~$69 at current $0.69/VIRTUAL)
- **Recommended pre-buy:** 1,100–6,000 $VIRTUAL (15-50% supply)
- **Gas fees:** Base L2, minimal (< $1)

### Wallet Requirements
- **Chain:** Base (Ethereum L2)
- **Wallet:** Any EVM wallet (MetaMask, etc.)
- **Token:** Need $VIRTUAL on Base chain
- **ETH on Base:** Small amount for gas

### Getting $VIRTUAL on Base
1. **If starting from SOL:** Bridge SOL → ETH via Wormhole/deBridge → Bridge ETH to Base → Swap ETH for $VIRTUAL on Uniswap/Aerodrome
2. **If starting from ETH:** Bridge to Base via official bridge → Swap for $VIRTUAL
3. **Direct buy:** Purchase $VIRTUAL on CEX (listed on major exchanges), withdraw to Base

### Bridge Path (SOL → Base)
```
SOL → (sell on CEX or bridge to ETH) → ETH on Base → Swap to $VIRTUAL on Base
```
Recommended DEX for $VIRTUAL: **Aerodrome** or **Uniswap** on Base.

---

## SDK & Tooling

### GAME Framework SDK (Agent AI Logic)
```bash
npm install @virtuals-protocol/game
```

```typescript
import { GameFunction, ExecutableGameFunctionResponse, ExecutableGameFunctionStatus } from "@virtuals-protocol/game";

const myFunction = new GameFunction({
  name: "action_name",
  description: "Description of action",
  args: [
    { name: "arg1", description: "First argument" }
  ],
  executable: async (args) => {
    // Agent logic here
    return new ExecutableGameFunctionResponse(
      ExecutableGameFunctionStatus.Done,
      "Action completed"
    );
  }
});
```

**API Key:** Request at https://console.game.virtuals.io/

> **Note:** GAME framework is optional. Virtuals is framework-agnostic. AgentFolio can use its own agent logic.

### ACP SDK (Agent Commerce Protocol)
```bash
npm install @virtuals-protocol/acp-node
```

Available in both **Python** and **Node.js**.

### React SDK (Frontend Integration)
GitHub: `Virtual-Protocol/react-virtual-ai`
- React components and hooks for Virtuals integration
- Useful if embedding Virtuals agent interaction in AgentFolio frontend

### No Programmatic Token Launch SDK
**Important:** There is **no public SDK for programmatically creating agent tokens**. Token creation is done through:
1. **app.virtuals.io UI** (primary method)
2. **Direct smart contract interaction** (advanced, requires understanding factory contract ABI)

For programmatic launch, you'd need to interact with `AgentFactoryV4` or the bonding curve contracts (`Bonding.sol`, `FFactory.sol`, `FRouter.sol`) directly on Base. The audit repo has contract source code but deployed addresses for factory/router are not publicly documented beyond the token addresses above.

---

## ACP (Agent Commerce Protocol)

### What It Is
A standardized coordination and settlement layer for **agent-to-agent commerce**. Agents can discover, hire, and pay each other autonomously on-chain.

### Key Components
- **Smart contract escrow** — funds held until job completion verified
- **Cryptographic verification** — agreements are signed on-chain
- **Independent evaluation** — dispute resolution phase
- **Service discovery** — agents can find other agents' capabilities

### Integration with AgentFolio
**YES — ACP is highly relevant for AgentFolio:**

1. **AgentFolio agents as service providers:** Registered agents could offer services (analysis, trading, content) through ACP
2. **Agent-to-agent jobs:** AgentFolio's marketplace could use ACP for escrow and settlement
3. **Revenue generation:** Agents earn $VIRTUAL through ACP jobs → flows to token holders

### ACP SDK Setup
```bash
npm install @virtuals-protocol/acp-node
```

**Requirements:**
- Create two agents on Virtuals: buyer agent + seller agent
- Each agent needs a wallet on Base
- Register agent capabilities in ACP registry

### Butler Agent
Virtuals' "Butler" is a human-facing interface that connects users to the agentic supply chain. It translates human intent into coordinated agent execution. AgentFolio could potentially integrate as a Butler-compatible interface.

---

## Practical Steps to Launch $FOLIO

### Phase 1: Preparation
- [ ] **Create Base wallet** for deployer (fresh, dedicated wallet)
- [ ] **Acquire $VIRTUAL on Base** — minimum 100, recommended 2,600-6,000 for pre-buy
- [ ] **Acquire small ETH on Base** for gas (~0.001 ETH)
- [ ] **Prepare agent profile:**
  - Logo/avatar for AgentFolio
  - Name: "AgentFolio" 
  - Ticker: `FOLIO`
  - Bio: Description of AgentFolio as portfolio & reputation platform for AI agents
  - Type: PRODUCTIVITY
- [ ] **Create @AgentFolio X account** (or use existing)
- [ ] **Prepare 7-day content calendar** for X

### Phase 2: Launch
1. Go to https://app.virtuals.io
2. Connect deployer wallet (Base chain)
3. Click "Create New Agent"
4. Select "Launch with new token"
5. Fill in agent details (name, ticker, bio, logo)
6. Set pre-buy amount (recommended: 2,600 $VIRTUAL for 30% supply)
7. Approve $VIRTUAL spend
8. Sign transaction — agent deploys on bonding curve
9. **IMPORTANT:** Pre-buy in same block to prevent snipers

### Phase 3: Growth to Graduation
- Market and promote to accumulate 42K $VIRTUAL in bonding curve
- Share app.virtuals.io link as official buy page
- Build in public, ship AgentFolio updates
- Engage Virtuals community

### Phase 4: Post-Graduation
- Update X bio with new CA (new token address after graduation)
- Setup DexScreener
- Integrate ACP for agent-to-agent commerce
- Consider bridging to Solana via Wormhole

### Phase 5: ACP Integration (Optional, High Value)
- Register AgentFolio agents as ACP service providers
- Enable agent-to-agent job execution through Virtuals ecosystem
- Generate revenue through ACP fees → flows to $FOLIO holders

---

## Key Risks & Considerations

1. **No programmatic launch API** — must use UI or reverse-engineer contracts
2. **Graduation not guaranteed** — need community to buy 42K $VIRTUAL worth
3. **Two-token mechanism on Base** — prototype token burns on graduation, new token minted (different CA)
4. **LP locked 10 years** — permanent liquidity commitment
5. **1% trading fee** — affects trader experience
6. **$VIRTUAL price volatility** — cost denominated in $VIRTUAL, not USD
7. **Framework-agnostic** — no requirement to use GAME, but ACP integration requires Virtuals-compatible agent

---

## Resources

- **Whitepaper:** https://whitepaper.virtuals.io
- **App (launch agents):** https://app.virtuals.io
- **GAME Console (API keys):** https://console.game.virtuals.io
- **GitHub:** https://github.com/Virtual-Protocol
- **GAME SDK:** `npm i @virtuals-protocol/game`
- **ACP SDK:** `npm i @virtuals-protocol/acp-node`
- **Contract Audit:** https://github.com/code-423n4/2025-04-virtuals-protocol
- **60 Days Form:** https://forms.gle/Hn3FWLq12GafujRP8
- **BD Contact:** @ehwangah on Telegram
