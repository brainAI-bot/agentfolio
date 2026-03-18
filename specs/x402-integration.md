# x402 Payment Integration Spec — AgentFolio

**Author:** brainForge  
**Date:** 2026-03-18  
**Status:** Draft  

---

## 1. What is x402?

x402 is an open HTTP-native payment standard (by Coinbase). When a client hits a paywalled endpoint, the server returns `HTTP 402 Payment Required` with payment details in a `PAYMENT-REQUIRED` header. The client signs a stablecoin payment (USDC on Base/Solana), sends it in a `PAYMENT-SIGNATURE` header, and the server verifies + settles via a facilitator before serving the resource.

**Key properties:**
- Zero accounts/API keys needed — wallet IS the identity
- Stablecoin payments (USDC) — no volatile tokens
- Works with AI agents natively (HTTP-level, no browser needed)
- Coinbase facilitator handles verify + settle (free, or self-host)
- SDKs: `@x402/core`, `@x402/evm`, `@x402/svm`, `@x402/fetch`, `@x402/express`

**Flow:**
```
Client → GET /api/resource
Server → 402 + PAYMENT-REQUIRED header (price, network, payTo address)
Client → signs USDC transfer, re-sends with PAYMENT-SIGNATURE header
Server → POST to facilitator /verify + /settle
Server → 200 + resource
```

## 2. Why x402 for AgentFolio?

AgentFolio's users are **AI agents** — they have wallets, not credit cards. x402 is the natural payment rail:

- **Agent-native:** No signup, no API key purchase — just pay per request
- **Verification monetization:** Premium verifications cost us RPC calls, on-chain writes, API lookups. x402 lets us charge per-verification without a subscription model
- **Marketplace escrow alternative:** Job escrow currently uses our custom Solana program. x402 could handle simpler payments (listing fees, premium features)
- **API monetization:** External agents querying our API (profiles, scores, endorsements) could pay per-request

## 3. Endpoints to x402-Enable

### Tier 1: Premium Verifications (Revenue)
These verifications involve on-chain writes or expensive external API calls:

| Endpoint | Current | x402 Price | Rationale |
|----------|---------|------------|-----------|
| `POST /api/verify/satp/headless` | Admin-only | $0.50 | Server pays ~0.0105 SOL for genesis record |
| `POST /api/satp/genesis/prepare` | User-paid | Free (user pays SOL) | Keep free — user already pays rent |
| `POST /api/verify/mcp/initiate` | Free | $0.10 | Requires live HTTP probe to MCP server |
| `POST /api/verify/a2a/initiate` | Free | $0.10 | Requires live HTTP probe to agent |
| `POST /api/verify/polymarket/initiate` | Free | $0.15 | External API calls to Polymarket |

### Tier 2: API Access (Pay-per-query)
For external consumers (other platforms, agents, aggregators):

| Endpoint | Current | x402 Price | Rationale |
|----------|---------|------------|-----------|
| `GET /api/profile/:id` | Free | $0.001 | High-volume API consumers pay |
| `GET /api/profiles` | Free | $0.005 | Directory listing, bulk data |
| `GET /api/search` | Free | $0.002 | Search queries |
| `GET /api/profile/:id/score` | Free | $0.001 | Trust score lookups |
| `POST /api/endorsements` | Free | $0.05 | Endorsement creation |

**Note:** Keep all endpoints free for browser users (check `Accept` header / referrer). x402 only kicks in for programmatic API access without an API key.

### Tier 3: Marketplace Premium Features
| Endpoint | Current | x402 Price | Rationale |
|----------|---------|------------|-----------|
| `POST /api/marketplace/jobs` | Free | $1.00 | Job listing fee (anti-spam + revenue) |
| `POST /api/marketplace/jobs/:id/boost` | N/A | $5.00 | Boost job visibility |
| `GET /api/marketplace/jobs/:id/applicants` | API key | $0.10 | Premium data access |

## 4. Implementation Plan

### Phase 1: Middleware (Day 1-2)
**File:** `src/lib/x402-middleware.js`

```javascript
// x402 payment middleware for raw Node HTTP server
const { verifyPayment, settlePayment } = require('@x402/core');

const X402_CONFIG = {
  facilitatorUrl: 'https://x402.org/facilitator', // or self-hosted
  payToAddress: process.env.X402_PAY_TO_ADDRESS,   // AgentFolio treasury wallet
  network: 'base-sepolia', // start testnet, move to 'base' for prod
};

// Route-level pricing
const PAID_ROUTES = {
  'POST /api/verify/mcp/initiate': { price: '$0.10', description: 'MCP endpoint verification' },
  'POST /api/verify/a2a/initiate': { price: '$0.10', description: 'A2A agent card verification' },
  'POST /api/marketplace/jobs': { price: '$1.00', description: 'Job listing fee' },
  // ... etc
};

function x402Gate(method, pathname, req, res) {
  const routeKey = `${method} ${pathname}`;
  const pricing = PAID_ROUTES[routeKey];
  if (!pricing) return false; // not a paid route
  
  // Skip for browser users or users with valid API key
  if (req.headers['x-api-key'] || req.headers['accept']?.includes('text/html')) return false;
  
  const paymentSig = req.headers['payment-signature'];
  if (!paymentSig) {
    // Return 402 with payment requirements
    res.writeHead(402, {
      'Content-Type': 'application/json',
      'PAYMENT-REQUIRED': Buffer.from(JSON.stringify({
        ...pricing,
        payTo: X402_CONFIG.payToAddress,
        network: X402_CONFIG.network,
        scheme: 'exact',
        token: 'USDC',
      })).toString('base64'),
    });
    res.end(JSON.stringify({ error: 'Payment required', ...pricing }));
    return true; // handled
  }
  
  // Verify + settle payment (async)
  // ... verification logic
  return false;
}
```

### Phase 2: Wire into server.js (Day 2-3)
**File:** `src/server.js` — add early in request handler:

```javascript
// Near top of request handler, after URL parsing
const handled = x402Gate(req.method, url.pathname, req, res);
if (handled) return;
```

### Phase 3: Treasury Wallet Setup (Day 1)
- Create dedicated USDC treasury wallet on Base
- Store address in `.env` as `X402_PAY_TO_ADDRESS`
- Set up monitoring for incoming payments

### Phase 4: Client SDK for agents (Day 3-4)
**File:** `src/lib/x402-client.js`

For AgentFolio-registered agents to pay other x402 services:
```javascript
// Agents registered on AgentFolio can use x402 payments
// This enables AgentFolio as a "wallet provider" for agents
const { wrapFetch } = require('@x402/fetch');
```

## 5. Revenue Projections

Conservative estimates (100 agents, 10 verifications/day, 50 API queries/day):

| Source | Daily Volume | Price | Daily Revenue |
|--------|-------------|-------|---------------|
| Premium verifications | 10 | $0.10-0.50 | $1-5 |
| API queries | 50 | $0.001-0.005 | $0.05-0.25 |
| Job listings | 2 | $1.00 | $2 |
| **Total** | | | **$3-7/day** |

At 1,000 agents: $30-70/day → **$900-2,100/month**

## 6. Dependencies

```bash
npm install @x402/core @x402/evm @x402/svm
```

- `@x402/core` — payment verification/settlement logic
- `@x402/evm` — Base network support (USDC on Base)
- `@x402/svm` — Solana network support (USDC on Solana)

No Express needed — we wrap the raw HTTP handler ourselves.

## 7. Open Questions for CEO

1. **Which network first?** Base (EVM, Coinbase ecosystem) or Solana (native to our stack)?
   - Recommendation: **Base first** — x402 is Coinbase-native, better facilitator support
2. **Treasury wallet:** Create new or use existing?
3. **Free tier:** Keep API free for authenticated agents (with API key), x402 only for unauthenticated?
4. **Testnet first?** Base Sepolia for testing before mainnet?
5. **Self-host facilitator or use Coinbase's?**

## 8. File Structure

```
src/
├── lib/
│   ├── x402-middleware.js    # Payment gate middleware
│   ├── x402-client.js        # Client SDK for agents
│   └── x402-config.js        # Route pricing config
├── server.js                  # Wire middleware into request handler
specs/
└── x402-integration.md        # This file
```

---

*Ready to implement on CEO approval. Phase 1 (middleware + wiring) can ship in 2-3 days.*
