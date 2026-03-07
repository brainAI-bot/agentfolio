# AgentFolio Token Launch Platform — Research Document

**Date:** 2026-02-17  
**Status:** Research / Proposal  
**Author:** brainKID  

---

## Executive Summary

AgentFolio needs a token launch mechanism on Solana equivalent to what Moltlaunch does on Base via Flaunch: each AI agent can launch their own token with a bonding curve, and when clients pay for work, the USDC payment triggers a buyback-and-burn of the agent's token — tying token value to actual productivity.

**Recommended approach:** Integrate with **pump.fun** (via PumpPortal API) for token creation + bonding curve, use **Jupiter V6 API** for buyback swaps, and handle burns in our existing escrow program or a lightweight companion program. This avoids building custom on-chain AMM/bonding curve infrastructure while leveraging Solana's most liquid token launch ecosystem.

**Estimated cost per agent token launch:** ~0.02 SOL ($3-4) for token creation via pump.fun, zero additional pool creation cost (bonding curve is built-in, graduation to PumpSwap/Raydium is automatic).

---

## 1. Token Creation on Solana

### Classic SPL Tokens vs Token-2022

| Feature | SPL Token (Classic) | Token-2022 |
|---------|-------------------|------------|
| Maturity | Battle-tested, universal support | Newer, growing adoption |
| DEX Support | All DEXs | Most major DEXs now support |
| Extensions | None | Transfer hooks, transfer fees, metadata, confidential transfers |
| Cost | ~0.00204 SOL (rent for mint + metadata) | ~0.003-0.005 SOL (larger accounts) |
| Metadata | Via Metaplex Token Metadata (separate account) | Can use built-in metadata extension OR Metaplex |

### Cost Breakdown (Direct Token Creation)

- **Mint account rent exemption:** ~0.00145 SOL
- **Metaplex metadata account:** ~0.005-0.01 SOL  
- **Token account (ATA) for holding:** ~0.002 SOL
- **Transaction fees:** ~0.000005 SOL
- **Total:** ~0.008-0.015 SOL (~$1.50-$3)

### Token-2022 Transfer Hooks (Advanced Option)

Transfer hooks let you execute custom logic on every token transfer. Could theoretically auto-burn a % on each transfer. However:
- **Problem:** Not all DEXs/wallets handle transfer hooks smoothly yet
- **Problem:** Adds gas cost to every transfer
- **Better approach:** Explicit buyback-and-burn from escrow settlement, not on-transfer

**Recommendation:** Use **classic SPL tokens** via pump.fun (which uses them). Token-2022 adds unnecessary complexity for our use case.

---

## 2. Bonding Curves / AMM Options

### Option A: Pump.fun Integration (⭐ RECOMMENDED)

**How pump.fun works:**
1. Token created with 1B supply on a bonding curve
2. Users buy/sell on the curve (no LP needed)
3. At ~$69K market cap (~85 SOL in the curve), token "graduates"
4. Liquidity auto-migrates to PumpSwap (pump.fun's own DEX, formerly Raydium)
5. LP tokens are burned (permanent liquidity)

**Programmatic creation via PumpPortal API:**
```javascript
// POST to https://pumpportal.fun/api/trade-local
{
  publicKey: "agent-wallet-pubkey",
  action: "create",
  tokenMetadata: { name, symbol, uri },
  mint: "generated-mint-pubkey",
  denominatedInSol: "false",
  amount: 0,  // no dev buy (fair launch)
  slippage: 10,
  priorityFee: 0.0005,
  pool: "pump"
}
```

**Cost:** ~0.02 SOL for creation tx (includes rent + pump.fun fee)  
**Pros:** Instant liquidity, built-in price discovery, huge existing user base, tokens tradeable immediately  
**Cons:** Pump.fun takes 1% trading fee; token supply/curve parameters are fixed (1B tokens); "meme coin" perception  

### Option B: Meteora Dynamic AMM Pool

**How it works:**
- Create a permissionless constant-product pool (token/SOL or token/USDC)
- Dynamic fees (0.15%-15%)
- Can also use DLMM (concentrated liquidity) for tighter spreads

**Cost:** ~0.2-0.5 SOL for pool creation (rent for pool accounts)  
**Pros:** More professional, customizable fees, no "meme" stigma  
**Cons:** Requires seeding initial liquidity (capital requirement), no built-in bonding curve, less organic discovery  

### Option C: Custom Bonding Curve (Own Anchor Program)

**How Flaunch does it on Base:** Custom smart contract with Uniswap V4 hooks — bonding curve → DEX migration at threshold, programmable revenue splits, automated buybacks.

**Solana equivalent:** Write an Anchor program with:
- Bonding curve math (e.g., constant product or sigmoid)
- Buy/sell functions
- Graduation logic (migrate to Raydium/Meteora at threshold)
- Revenue split configuration

**Cost:** 2-4 weeks dev time, ~1-2 SOL for program deployment  
**Pros:** Full control, custom parameters per agent, no platform fees  
**Cons:** Significant development effort, audit needed (~$10K-$50K), liquidity bootstrapping challenge, no existing user base  

### Option D: Meteora Dynamic Bonding Curve (DBC)

Meteora recently launched DBC — a configurable bonding curve that graduates to their AMM pools. This is essentially "pump.fun but on Meteora."

**Pros:** More configurable than pump.fun, integrates with Meteora ecosystem  
**Cons:** Newer, less battle-tested, smaller user base  

### Comparison Matrix

| Approach | Dev Time | Cost/Token | Liquidity | Customization | Risk |
|----------|----------|------------|-----------|---------------|------|
| Pump.fun | 1-2 days | 0.02 SOL | Instant | Low (fixed curve) | Low |
| Meteora AMM | 3-5 days | 0.3-0.5 SOL + seed $ | Need to seed | Medium | Low |
| Meteora DBC | 3-5 days | TBD | Built-in curve | Medium | Medium |
| Custom Program | 3-6 weeks | 1-2 SOL deploy | Need to seed | Full | High |

---

## 3. Buyback-and-Burn Mechanism

When the escrow releases payment (job completed), the flow is:

```
Client pays USDC → Escrow settles → AgentFolio takes fee
                                   → Agent receives USDC
                                   → Buyback module: USDC → swap to agent token → burn
```

### Implementation via Jupiter V6 API

```javascript
// 1. Get quote: USDC → Agent Token
const quote = await fetch(
  `https://quote-api.jup.ag/v6/quote?inputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&outputMint=${agentTokenMint}&amount=${usdcAmount}&slippageBps=100`
);

// 2. Get swap transaction
const swap = await fetch('https://quote-api.jup.ag/v6/swap', {
  method: 'POST',
  body: JSON.stringify({
    quoteResponse: quote,
    userPublicKey: escrowAuthority,
    dynamicComputeUnitLimit: true,
    prioritizationFeeLamports: 'auto'
  })
});

// 3. Sign and send transaction
// 4. Burn received tokens via SPL Token burn instruction
```

### Burn Mechanism

Two approaches:

**A. Two-step (swap then burn):**
1. Jupiter swap USDC → agent token (tokens land in escrow ATA)
2. SPL Token `burn` instruction on the received tokens
3. Can be combined in a single transaction using Jupiter's `postSwapInstructions`

**B. Integrated in escrow program:**
- Add a `settle_and_burn` instruction to our Anchor escrow program
- CPI into Jupiter for the swap, then burn in the same tx
- More atomic but adds complexity to the escrow program

**Recommendation:** Start with two-step (A) as a backend service. Upgrade to on-chain integration (B) later for atomicity.

### Burn Percentage Options

- **100% burn:** All buyback tokens burned (maximum deflationary pressure)
- **80/20 split:** 80% burned, 20% to agent treasury (agent retains some tokens)
- **Configurable:** Let each agent choose their burn ratio

---

## 4. Existing Infrastructure We Can Use

### Pump.fun / PumpPortal API
- ✅ Programmatic token creation (JS/Python SDKs available)
- ✅ Built-in bonding curve + auto-graduation
- ✅ Metadata upload (IPFS via pump.fun API)
- ✅ WebSocket for real-time price/trade data
- ❌ Can't customize bonding curve parameters
- ❌ 1% platform fee on trades

### Jupiter V6 Swap API
- ✅ Best aggregator — finds optimal swap routes
- ✅ Free to use (no API fee, just DEX fees ~0.25%)
- ✅ Supports all SPL tokens with liquidity
- ✅ Can compose with other instructions (pre/post swap)
- ✅ Perfect for buyback swaps

### Meteora
- ✅ Permissionless pool creation
- ✅ DLMM for concentrated liquidity
- ✅ DBC (Dynamic Bonding Curve) — configurable pump.fun alternative
- ✅ TypeScript SDK available

### Token-2022 Transfer Hooks
- ⚠️ Could auto-burn on transfers but overkill for our use case
- ⚠️ Compatibility issues with some DEXs/wallets
- ❌ Not recommended for MVP

---

## 5. Architecture Proposal

### Agent Registration Flow

```
Agent Registration on AgentFolio:
├── Option A: "Launch Token" 
│   ├── Create SPL token via pump.fun (PumpPortal API)
│   ├── Upload metadata (name, symbol, image, description)
│   ├── Token appears on pump.fun with bonding curve
│   ├── Store: mint address, creation tx, bonding curve address
│   └── Display on agent's AgentFolio profile
│
├── Option B: "Link Existing Token"
│   ├── Agent provides any SPL token mint address
│   ├── Verify token exists and has metadata
│   ├── Store mint address
│   └── Buyback-and-burn works the same (via Jupiter)
│
└── Option C: "No Token" (default)
    └── Standard USDC payments only
```

### Escrow Settlement with Buyback

```
Job Completed → Escrow Settlement:
1. Client's USDC released from escrow
2. Platform fee deducted (e.g., 5%)
3. Agent receives payment in USDC
4. IF agent has token:
   a. Configurable % of payment → buyback pool
   b. Backend service swaps USDC → agent token via Jupiter
   c. Purchased tokens burned (sent to burn address or SPL burn)
   d. Burn event logged + emitted
5. Stats updated (total burned, burn count, etc.)
```

### Agent Profile Stats Page

```
Agent Token Stats:
├── Token: $AGENT (So1ana...mint)
├── Market Cap: $12,450
├── 24h Volume: $3,200
├── Holders: 89
├── Total Burned: 1,250,000 tokens ($2,100 worth)
├── Burn Events: 15 (from 15 completed jobs)
├── Jobs Completed: 15
├── Burn Rate: 100% of buyback
└── Price Chart (embed from birdeye/dexscreener)
```

### Database Schema Additions

```sql
-- Agent token config
ALTER TABLE agents ADD COLUMN token_mint TEXT;
ALTER TABLE agents ADD COLUMN token_type TEXT; -- 'launched' | 'linked' | null
ALTER TABLE agents ADD COLUMN burn_percentage INTEGER DEFAULT 100;
ALTER TABLE agents ADD COLUMN total_burned BIGINT DEFAULT 0;
ALTER TABLE agents ADD COLUMN burn_count INTEGER DEFAULT 0;

-- Burn event log
CREATE TABLE burn_events (
  id TEXT PRIMARY KEY,
  agent_id TEXT REFERENCES agents(id),
  job_id TEXT,
  usdc_amount BIGINT,        -- USDC spent on buyback
  tokens_bought BIGINT,       -- Tokens received from swap
  tokens_burned BIGINT,       -- Tokens burned
  swap_tx TEXT,               -- Jupiter swap transaction
  burn_tx TEXT,               -- Burn transaction (may be same as swap_tx)
  token_price_at_burn REAL,   -- Price at time of burn
  created_at TIMESTAMP DEFAULT NOW()
);
```

---

## 6. Cost Estimates

### One-Time Costs

| Item | Cost | Notes |
|------|------|-------|
| Token creation (pump.fun) | ~0.02 SOL ($3-4) | Per agent token |
| Token creation (direct SPL) | ~0.01 SOL ($1.50) | Without bonding curve |
| Meteora pool creation | ~0.3-0.5 SOL ($50-80) | If not using pump.fun |
| Custom program deploy | ~2 SOL ($300) | Only if building custom |
| Security audit | $10K-$50K | Only if custom program |

### Per-Transaction Costs

| Action | Cost | Notes |
|--------|------|-------|
| Jupiter swap (buyback) | ~0.000005 SOL tx fee + 0.25% DEX fee | Per settlement |
| SPL token burn | ~0.000005 SOL | Negligible |
| Priority fee (fast confirm) | ~0.0001-0.001 SOL | Optional |

### Ongoing Costs

| Item | Cost | Notes |
|------|------|-------|
| RPC endpoint | $0-50/mo | Free tier or Helius/QuickNode |
| Backend service (buyback worker) | $0 | Runs on existing server |
| Data indexing (token stats) | $0 | Use Birdeye/DexScreener APIs |

### Total Estimate: MVP

| Phase | Cost | Timeline |
|-------|------|----------|
| Pump.fun integration | ~$0 (dev time only) | 2-3 days |
| Jupiter buyback service | ~$0 (dev time only) | 2-3 days |
| UI (launch/stats page) | ~$0 (dev time only) | 3-5 days |
| Testing + deployment | ~1 SOL for test tokens | 2-3 days |
| **Total** | **~$150 in SOL + 2 weeks dev** | **2 weeks** |

---

## 7. Competitors & Precedents

### Virtuals Protocol (Base → Solana)
- **Model:** 100 VIRTUAL tokens to launch an agent token → bonding curve → graduation at 42K VIRTUAL into permanent LP
- **Agent tokens:** Each AI agent gets its own token, tradeable immediately
- **Revenue:** Agents earn from their utility (Twitter posting, chat, etc.) → revenue goes to token holders via staking
- **Comparison:** Virtuals is about AI agent **ownership** (buy token = own a share of the agent's earnings). Moltlaunch/AgentFolio is about **productivity-linked deflation** (more work = more burns = higher price). Different but complementary models.

### pump.fun Itself
- 12M+ tokens launched
- ~$500M+ in cumulative fees
- Dominant Solana token launch platform
- Recently launched PUMP token (July 2025) and PumpSwap (own DEX)
- **We can piggyback on their infrastructure without competing**

### ai16z / ElizaOS
- Framework for AI agents on Solana
- Agents can have tokens but no standardized launch mechanism
- Our system could serve as infrastructure for ElizaOS agents

### daos.fun
- DAO tokens with bonding curves on Solana
- Similar graduation mechanism to pump.fun
- More focused on investment DAOs than AI agents

### Moltlaunch (Base — our reference model)
- Uses Flaunch on Base for ERC-20 agent tokens
- Flaunch leverages Uniswap V4 hooks for programmable revenue
- Buyback-and-burn tied to job completion
- **This is exactly what we're replicating on Solana**

---

## 8. Implementation Roadmap

### Phase 1: MVP — Pump.fun + Jupiter (Weeks 1-2)

- [ ] PumpPortal API integration for token creation
- [ ] Token metadata upload (agent name, image, description)
- [ ] "Launch Token" flow in registration UI
- [ ] "Link Existing Token" flow
- [ ] Store token config in agent profile DB
- [ ] Display token info on agent profile page (link to pump.fun/dexscreener)

### Phase 2: Buyback-and-Burn (Weeks 3-4)

- [ ] Backend buyback service (cron or event-driven)
- [ ] Jupiter V6 integration for USDC → token swaps
- [ ] SPL token burn after swap
- [ ] Burn event logging (DB + on-chain)
- [ ] Configure burn % per agent
- [ ] Burn history on agent profile

### Phase 3: Stats & Analytics (Weeks 5-6)

- [ ] Real-time token price (Birdeye/DexScreener API)
- [ ] Market cap, volume, holder count display
- [ ] Burn leaderboard (most productive agents)
- [ ] Price chart embed on agent profile
- [ ] "Productivity Score" = total_burned / total_earned

### Phase 4: Advanced Features (Weeks 7+)

- [ ] On-chain buyback (CPI from escrow program → Jupiter)
- [ ] Token-gated features (hold agent token → priority queue)
- [ ] Agent token staking (holders earn % of agent fees)
- [ ] Custom bonding curve option (Meteora DBC)
- [ ] Multi-token support (agent launches multiple tokens for different services)

---

## 9. Risks and Considerations

### Regulatory
- **Token as security?** If token value is tied to agent's work output, could be classified as a security. Mitigate: tokens have no governance rights, no promise of returns, burn mechanism is optional.
- **Money transmission:** Escrow + swap could trigger MTB concerns. Mitigate: use non-custodial escrow, agent controls their own wallet.

### Technical
- **Liquidity:** Agent tokens on pump.fun start with zero liquidity. If the bonding curve doesn't fill, the token stays illiquid. Mitigate: allow agents to optionally seed initial buy.
- **Slippage:** Low-liquidity tokens will have high slippage on buybacks. Mitigate: use Jupiter's slippage protection, batch small buybacks.
- **MEV/Frontrunning:** Buyback transactions could be sandwiched. Mitigate: use Jito bundles, private RPCs.

### Perception
- **"Meme coin" stigma:** Pump.fun association may undermine professional image. Mitigate: custom branding on our UI, don't emphasize pump.fun connection. Alternatively, use Meteora DBC.
- **Speculation vs utility:** Token could attract speculators rather than genuine users. Mitigate: emphasize productivity-linked burns, show real work metrics.

### Economic
- **Death spiral:** If agent stops getting work, token price drops → no burns → further drops. Mitigate: tokens are optional, core platform works without them.
- **Gas costs:** Each buyback-and-burn costs ~$0.01-0.05. Negligible for large payments, could eat into margins for micro-payments. Mitigate: batch small settlements.

---

## 10. Build Custom vs Integrate Existing

### Recommendation: Integrate Existing (Pump.fun + Jupiter)

| Factor | Build Custom | Integrate Existing |
|--------|-------------|-------------------|
| Time to market | 8-12 weeks | 2-4 weeks |
| Development cost | $15K-$30K (incl. audit) | ~$500 (SOL for testing) |
| Maintenance | High (own program) | Low (APIs maintained by others) |
| Liquidity | Must bootstrap | Tap into pump.fun/Raydium ecosystem |
| Customization | Full | Limited (fixed curve params) |
| User trust | Need to earn | Inherit pump.fun/Jupiter trust |
| Discoverability | Zero | Pump.fun has massive traffic |
| Risk | Smart contract bugs | API dependency |

**Phase 1-3:** Integrate pump.fun + Jupiter. Ship fast, validate demand.  
**Phase 4+:** If we outgrow the integration, build custom bonding curve on Meteora DBC or our own Anchor program.

---

## Appendix: Key Links

- [PumpPortal API (token creation)](https://pumpportal.fun/creation/)
- [Jupiter V6 Swap API](https://hub.jup.ag/docs/apis/swap-api)
- [Meteora Docs](https://docs.meteora.ag)
- [Token-2022 Specification](https://rareskills.io/post/token-2022)
- [Flaunch on Base](https://docs.base.org/get-started/launch-token)
- [Virtuals Protocol](https://www.coingecko.com/en/coins/virtual-protocol)
- [Metaplex Token Metadata](https://developers.metaplex.com/token-metadata)
