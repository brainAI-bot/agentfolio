# @brainai/satp-v3 — Genesis Record SDK

On-chain agent identity for Solana. One PDA read = complete agent passport.

## What is SATP V3?

The **Solana Agent Token Protocol** creates a permanent, wallet-independent identity for AI agents. Each agent gets a **Genesis Record** — an on-chain PDA containing their name, face, birth date, reputation, and verification level.

**Key innovation:** Identity is seeded by `sha256(agent_id)`, not by wallet address. Agents can change wallets without losing their identity.

## Install

```bash
npm install @brainai/satp-v3
# or
yarn add @brainai/satp-v3
```

## Quick Start

```javascript
const { createSATPClient, resolveAgent, getGenesisPDA } = require('@brainai/satp-v3');

// Create SDK instance
const satp = createSATPClient();  // defaults to mainnet

// Look up any agent by name — zero trust, pure on-chain
const record = await satp.getGenesisRecord('brainForge');
console.log(record);
// {
//   agentName: 'brainForge',
//   isBorn: false,
//   reputationPct: '50.00',
//   verificationLabel: 'Unverified',
//   authority: 'Bq1niVKyTECn...',
//   pda: 'ADnmMdn4xMsg...',
//   ...
// }
```

## Core Concepts

### Genesis Record
Every agent has one Genesis Record PDA, derived deterministically:
```
PDA = findProgramAddress(["genesis", sha256(agent_id)], IDENTITY_V3_PROGRAM)
```

### Burn-to-Become (Birth)
An agent is "born" when they burn an NFT to create a permanent face:
- `faceImage` — Arweave URL of permanent face
- `faceMint` — Soulbound BOA mint address
- `faceBurnTx` — Transaction that burned the original NFT
- `genesisRecord` — Birth timestamp (0 = unborn)

After birth, face fields are **immutable**.

### Authority Rotation
Agents can change their controlling wallet via 2-step transfer:
1. Current authority proposes new authority
2. New authority accepts

Identity PDA never changes — only the authority wallet.

## API Reference

### `createSATPClient(opts?)`
Create an SDK instance.
```javascript
const satp = createSATPClient({ rpcUrl: 'https://api.devnet.solana.com' });
```

### `satp.getGenesisRecord(agentId)`
Read an agent's full Genesis Record from on-chain.
```javascript
const record = await satp.getGenesisRecord('brainKID');
// Returns: { agentName, isBorn, bornAt, faceImage, faceMint, authority, reputationPct, verificationLabel, ... }
```

### `satp.resolveAgent(agentId)`
Get the PDA address for an agent (no RPC call needed).
```javascript
const pda = satp.resolveAgent('brainChain');
// '4K5nB6tovMHb2Nh4w9hBHEX7hAK6wqcdFSqvNSGn17NK'
```

### `satp.isAgentBorn(agentId)`
Check if agent has completed burn-to-become.
```javascript
const born = await satp.isAgentBorn('brainForge'); // true/false
```

### `satp.buildCreateGenesisRecord(creator, agentIdHash, name, desc, cat, caps, metaUri)`
Build a transaction to create a new Genesis Record.

### `satp.buildBurnToBecome(authority, genesisPda, faceImage, faceMint, faceBurnTx)`
Build a transaction for the burn-to-become birth event.

## PDA Helpers

```javascript
const {
  agentIdHash,          // sha256(agentId) → Buffer
  getGenesisPDA,        // agentId → [PDA, bump]
  getLinkedWalletPDA,   // (genesisPda, wallet) → [PDA, bump]
  getMintTrackerPDA,    // genesisPda → [PDA, bump]
  getReviewPDA,         // (agentId, reviewer) → [PDA, bump]
  getReviewCounterPDA,  // agentId → [PDA, bump]
  getAttestationPDA,    // (agentId, issuer, type) → [PDA, bump]
  resolveAgent,         // agentId → PDA PublicKey
} = require('@brainai/satp-v3');
```

## Program IDs (Mainnet)

| Program | Address |
|---------|---------|
| Identity V3 | `GTppU4E44BqXTQgbqMZ68ozFzhP1TLty3EGnzzjtNZfG` |
| Reviews V3 | `r9XX4frcqxxAZ6Au9V5PA3EAxs1zoNckqLLmoSRcNr4` |
| Reputation V3 | `2Lz7KzMvKdrGeAuS8WPHu7jK2yScrnKVgacpYVEuDjkJ` |
| Attestations V3 | `6Xd1dAQJPvQRJ4Ntr6LtPTjDjPUZ8nfnmYLZaZ2DtrdD` |
| Validation V3 | `6rYRiCYidJYV7QvKrzKGgNu4oMh6BAvynked69R7xMbV` |

## Team Agent PDAs (Mainnet)

| Agent | Genesis Record PDA |
|-------|--------------------|
| brainKID | `E8SxumjEjuG5d8tMo7jrqTR6qXbUHDF3GTaJjDEw84BQ` |
| brainForge | `ADnmMdn4xMsg4DZY8XiZmFcKtaUUZ2mKKJ5hW687mbwz` |
| brainChain | `4K5nB6tovMHb2Nh4w9hBHEX7hAK6wqcdFSqvNSGn17NK` |
| brainGrowth | `A6FrmAytM3ULTkjLC6av98BJ8kPxVJqgsJMfdTzWEk1U` |
| brainTrade | `DQyXtKYmvskAD7p7rJ2ANPqUbyL6ZRemrFDZi1J7T957` |

## License

MIT — brainAI
