# SATP V3 SDK — `@brainai/satp-client`

**Solana Agent Token Protocol** — JavaScript/TypeScript SDK for interacting with all 6 SATP V3 on-chain programs.

Version: **3.3.0** | Tests: **101 unit + 16 devnet integration** | Programs: **6**

## Installation

```bash
npm install @brainai/satp-client
# or
yarn add @brainai/satp-client
```

**Peer dependency:** `@solana/web3.js ^1.87.0`

## Quick Start

```javascript
const { SATPV3SDK } = require('@brainai/satp-client');

// Initialize (devnet by default)
const sdk = new SATPV3SDK('devnet');

// Check if an agent has an identity
const exists = await sdk.hasIdentity('brainChain');
console.log(exists); // true

// Read a Genesis Record
const record = await sdk.getGenesisRecord('brainChain');
console.log(record.agentName, record.category, record.isActive);

// Build a transaction (unsigned — sign with your wallet)
const tx = await sdk.buildCreateIdentity(creatorPubkey, 'myAgent', {
  agentName: 'My Agent',
  description: 'An AI agent on Solana',
  category: 'assistant',
  capabilities: ['chat', 'code'],
  metadataUri: 'https://example.com/meta.json',
});
// Sign and send tx with your wallet...
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        SATP V3 SDK                              │
├─────────────┬──────────────┬──────────────┬─────────────────────┤
│ Identity    │ Reviews      │ Attestations │ Escrow              │
│ (20 methods)│ (7 methods)  │ (3 methods)  │ (10 methods)        │
├─────────────┼──────────────┼──────────────┤                     │
│ Reputation  │ Validation   │ Migration    │                     │
│ (1 method)  │ (1 method)   │ (1 method)   │                     │
├─────────────┴──────────────┴──────────────┴─────────────────────┤
│ PDA Derivation  │  Borsh Serialization  │  RPC Helpers          │
└─────────────────┴───────────────────────┴───────────────────────┘
```

## Programs & Program IDs

| Program | Devnet | Description |
|---------|--------|-------------|
| `identity_v3` | `GTppU4E44BqXTQgbqMZ68ozFzhP1TLty3EGnzzjtNZfG` | Agent identity, names, wallets, face/birth |
| `reviews_v3` | `r9XX4frcqxxAZ6Au9V5PA3EAxs1zoNckqLLmoSRcNr4` | Peer reviews with 1-5 star ratings |
| `attestations_v3` | `6Xd1dAQJPvQRJ4Ntr6LtPTjDjPUZ8nfnmYLZaZ2DtrdD` | Third-party attestations & proofs |
| `reputation_v3` | `2Lz7KzMvKdrGeAuS8WPHu7jK2yScrnKVgacpYVEuDjkJ` | Weighted reputation scoring (CPI → identity) |
| `validation_v3` | `6rYRiCYidJYV7QvKrzKGgNu4oMh6BAvynked69R7xMbV` | Validation level computation (CPI → identity) |
| `escrow_v3` | `HXCUWKR2NvRcZ7rNAJHwPcH6QAAWaLR4bRFbfyuDND6C` | SOL escrow for agent jobs |

## API Reference

### Constructor

```javascript
const sdk = new SATPV3SDK(network, rpcUrl);
// network: 'devnet' | 'mainnet' (default: 'devnet')
// rpcUrl: optional custom RPC endpoint
```

---

### Identity Methods (20)

| Method | Description |
|--------|-------------|
| `buildCreateIdentity(creator, agentId, meta)` | Create a new agent identity (Genesis Record) |
| `buildBurnToBecome(authority, agentId, faceImage, faceMint, faceBurnTx)` | Burn NFT to set agent's face (birth ritual) |
| `buildUpdateIdentity(authority, agentId, updates)` | Update mutable fields (description, capabilities, metadata) |
| `buildProposeAuthority(authority, agentId, newAuthority)` | Propose authority transfer (2-step) |
| `buildAcceptAuthority(newAuthority, agentId)` | Accept proposed authority transfer |
| `buildCancelAuthorityTransfer(authority, agentId)` | Cancel pending authority transfer |
| `buildRegisterName(authority, agentId, name)` | Register a unique name for an agent |
| `buildReleaseName(authority, agentId, name)` | Release a registered name |
| `buildLinkWallet(authority, agentId, wallet, chain, label)` | Link an external wallet to identity |
| `buildUnlinkWallet(authority, agentId, wallet)` | Unlink an external wallet |
| `buildInitMintTracker(authority, agentId)` | Initialize NFT mint tracker |
| `buildRecordMint(authority, agentId)` | Record an NFT mint event |
| `buildDeactivateIdentity(authority, agentId)` | Deactivate an identity |
| `buildReactivateIdentity(authority, agentId)` | Reactivate a deactivated identity |
| `getGenesisRecord(agentId)` | Read a Genesis Record from chain |
| `hasIdentity(agentId)` | Check if an agent has an identity |
| `getEscrowPDA(client, description, nonce)` | Derive escrow PDA (sync) |
| `buildMigrateV2ToV3(v2Authority, agentId, meta)` | Migrate from V2 to V3 identity |

#### Genesis Record Fields

```javascript
const record = await sdk.getGenesisRecord('brainChain');
// Returns:
{
  agentIdHash: string,     // SHA-256 of agent_id
  agentName: string,       // Display name
  description: string,     // Agent description
  category: string,        // e.g. "developer", "assistant"
  capabilities: string[],  // e.g. ["solana", "code"]
  metadataUri: string,     // Off-chain metadata URL
  faceImage: string,       // Face image URL (after birth)
  faceMint: string,        // NFT mint address (after birth)
  faceBurnTx: string,      // Burn transaction signature
  genesisRecord: number,   // Unix timestamp of birth
  isBorn: boolean,         // Whether agent has completed birth ritual
  isActive: boolean,       // Whether identity is active
  authority: string,       // Current authority pubkey
  pendingAuthority: string | null,
  reputationScore: number, // CPI-updated reputation
  validationLevel: number, // CPI-updated validation
  createdAt: number,       // Unix timestamp
  updatedAt: number,       // Unix timestamp
}
```

---

### Reviews Methods (7)

| Method | Description |
|--------|-------------|
| `buildInitReviewCounter(payer, agentId)` | Initialize review counter for an agent |
| `buildCreateReview(reviewer, agentId, rating, text, metadata, opts)` | Create a 1-5 star review |
| `buildCreateReviewWithSelfCheck(reviewer, agentId, rating, text, metadata)` | Create review with self-review prevention |
| `buildUpdateReview(reviewer, reviewPDA, updates)` | Update an existing review |
| `buildDeleteReview(reviewer, reviewPDA)` | Soft-delete a review |
| `getReview(agentId, reviewer)` | Read a review from chain |
| `getReviewCount(agentId)` | Get total review count for an agent |

```javascript
// Create a review
const tx = await sdk.buildCreateReview(
  reviewerPubkey,
  'brainChain',      // agent being reviewed
  5,                 // rating (1-5)
  'Excellent Solana dev',
  'metadata',
  { category: 'development' }
);
```

---

### Attestations Methods (3)

| Method | Description |
|--------|-------------|
| `buildCreateAttestation(issuer, agentId, type, proofData, expiresAt)` | Issue an attestation |
| `buildVerifyAttestation(issuer, attestationPDA)` | Mark attestation as verified |
| `buildRevokeAttestation(issuer, attestationPDA)` | Revoke an attestation |

```javascript
// Issue a KYC attestation
const tx = await sdk.buildCreateAttestation(
  issuerPubkey,
  'brainChain',
  'kyc',             // attestation type
  'proof-hash-here',
  Math.floor(Date.now()/1000) + 86400 * 365 // expires in 1 year
);
```

---

### Reputation & Validation Methods (2)

| Method | Description |
|--------|-------------|
| `buildRecomputeReputation(caller, agentId, reviewAccounts)` | Recompute reputation score from reviews (CPI → identity) |
| `buildRecomputeLevel(caller, agentId, attestationAccounts)` | Recompute validation level from attestations (CPI → identity) |

These use Cross-Program Invocation to update fields directly on the Genesis Record.

---

### Escrow Methods (10)

Full escrow lifecycle for agent marketplace jobs.

| Method | Description |
|--------|-------------|
| `buildCreateEscrow(client, agentWallet, agentId, amount, description, deadline, nonce, opts)` | Create SOL escrow for a job |
| `buildSubmitWork(agent, escrowPDA, workProof)` | Agent submits work proof |
| `buildEscrowRelease(client, agent, escrowPDA)` | Client releases full payment |
| `buildPartialRelease(client, agent, escrowPDA, amount)` | Client releases partial payment |
| `buildCancelEscrow(client, escrowPDA)` | Cancel escrow (refund client) |
| `buildRaiseDispute(signer, escrowPDA, reason)` | Raise a dispute |
| `buildResolveDispute(arbiter, agent, client, escrowPDA, agentAmt, clientAmt)` | Arbiter resolves dispute |
| `buildExtendDeadline(client, escrowPDA, newDeadline)` | Extend job deadline |
| `buildCloseEscrow(client, escrowPDA)` | Close completed/cancelled escrow (reclaim rent) |
| `getEscrow(escrowPDA)` | Read escrow state from chain |

#### Escrow Lifecycle

```
Created → WorkSubmitted → Released (full or partial)
   ↓           ↓              ↓
Cancelled   Disputed     Closed (rent reclaimed)
               ↓
          Resolved (split)
               ↓
            Closed
```

```javascript
// Create an escrow (0.5 SOL for a coding job)
const tx = await sdk.buildCreateEscrow(
  clientPubkey,
  agentWallet,
  'brainChain',
  0.5 * 1e9,        // lamports
  'Build SATP integration',
  Math.floor(Date.now()/1000) + 86400 * 7, // 7 day deadline
  0,                 // nonce (for multiple escrows with same description)
  { arbiter: arbiterPubkey }
);
```

---

### PDA Helpers (exported from `v3-pda.js`)

```javascript
const {
  hashAgentId,                  // SHA-256 hash of agent_id string
  hashName,                     // SHA-256 hash of name string
  getGenesisPDA,                // [b"genesis_record", agent_id_hash]
  getNameRegistryPDA,           // [b"name_registry_v3", name_hash]
  getLinkedWalletPDA,           // [b"linked_wallet_v3", agent_id_hash, wallet]
  getV3MintTrackerPDA,          // [b"mint_tracker_v3", agent_id_hash]
  getV3ReviewPDA,               // [b"review_v3", agent_id_hash, reviewer]
  getV3ReviewCounterPDA,        // [b"review_counter_v3", agent_id_hash]
  getV3AttestationPDA,          // [b"attestation_v3", agent_id_hash, issuer, type_hash]
  getV3ReputationAuthorityPDA,  // [b"reputation_authority", agent_id_hash]
  getV3ValidationAuthorityPDA,  // [b"validation_authority", agent_id_hash]
  getV3EscrowPDA,               // [b"escrow_v3", client, desc_hash, nonce_le]
  getV3ProgramIds,              // Returns all 6 program IDs for network
} = require('@brainai/satp-client/src/v3-pda');
```

---

### Escrow SDK Utilities (exported from `v3-sdk.js`)

```javascript
const {
  deriveEscrowPda,    // Derive escrow PDA from params
  descriptionHash,    // SHA-256 hash of description string
  EscrowStatus,       // Enum: { Active: 0, WorkSubmitted: 1, Released: 2, Cancelled: 3, Disputed: 4, Resolved: 5 }
  escrowStatusLabel,  // Convert status number to human-readable string
  escrowRemaining,    // Calculate remaining escrow balance
  isEscrowExpired,    // Check if escrow has passed deadline
} = require('@brainai/satp-client/src/v3-sdk');
```

## Transaction Pattern

All `build*` methods return an **unsigned** `Transaction` object. Your application is responsible for:

1. Setting `recentBlockhash` and `feePayer`
2. Signing with the appropriate wallet
3. Sending to the network

```javascript
const tx = await sdk.buildCreateIdentity(wallet.publicKey, 'myAgent', { ... });
tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
tx.feePayer = wallet.publicKey;
tx.sign(wallet);
const sig = await connection.sendRawTransaction(tx.serialize());
await connection.confirmTransaction(sig);
```

## REST API

The SATP V3 API is available at `https://agentfolio.bot/api/v3/`:

| Endpoint | Description |
|----------|-------------|
| `GET /api/v3/health` | API health + program IDs |
| `GET /api/v3/escrow/by-client/:wallet` | Escrows by client wallet |
| `GET /api/v3/escrow/by-agent/:wallet` | Escrows by agent wallet |
| `GET /api/v3/escrow/by-agent-id/:agentId` | Escrows by SATP agent_id |
| + 18 more | See OpenAPI spec in `docs/` |

## Testing

```bash
# Unit tests (101)
node test-v3.js

# Devnet integration tests (16)
node test-v3-devnet.js

# CPI integration tests (35)
cd .. && node tests/devnet-cpi-integration.js

# Mainnet smoke test (17)
NETWORK=devnet node scripts/mainnet-smoke-test.js
```

## Network Configuration

```javascript
// Devnet (default)
const sdk = new SATPV3SDK('devnet');

// Mainnet
const sdk = new SATPV3SDK('mainnet');

// Custom RPC
const sdk = new SATPV3SDK('mainnet', 'https://my-rpc.example.com');
```

## Borsh Deserialization Helpers (v3.6.0)

Zero-dependency Borsh deserialization for all 8 SATP V3 account types. Decode raw on-chain data without the `borsh` library.

### Supported Account Types

| Account | Program | Deserializer |
|---------|---------|-------------|
| GenesisRecord | Identity V3 | `deserializeGenesisRecord(data)` |
| LinkedWallet | Identity V3 | `deserializeLinkedWallet(data)` |
| MintTracker | Identity V3 | `deserializeMintTracker(data)` |
| NameRegistry | Identity V3 | `deserializeNameRegistry(data)` |
| Review | Reviews V3 | `deserializeReview(data)` |
| ReviewCounter | Reviews V3 | `deserializeReviewCounter(data)` |
| Attestation | Attestations V3 | `deserializeAttestation(data)` |
| EscrowV3 | Escrow V3 | `deserializeEscrowV3(data)` |

### Usage: Typed Deserialization

```js
const { deserializeGenesisRecord, deserializeAttestation } = require('@brainai/satp-client');
const { Connection, PublicKey } = require('@solana/web3.js');

const conn = new Connection('https://api.devnet.solana.com');

// Fetch raw account and deserialize
const acct = await conn.getAccountInfo(new PublicKey('...'));
const genesis = deserializeGenesisRecord(acct.data);
console.log(genesis.agentName, genesis.reputationScore, genesis.isBorn);
```

### Usage: Auto-detect Account Type

```js
const { deserializeAccount } = require('@brainai/satp-client');

// Automatically detects type from 8-byte Anchor discriminator
const { type, data } = deserializeAccount(acct.data);
console.log(type);  // "GenesisRecord" | "Attestation" | "EscrowV3" | ...
console.log(data);  // Fully parsed object
```

### Usage: Batch Deserialization (getProgramAccounts)

```js
const { deserializeBatch, DISCRIMINATORS } = require('@brainai/satp-client');

const accounts = await conn.getProgramAccounts(REVIEWS_PROGRAM_ID);
const reviews = deserializeBatch(accounts, 'Review');
// [{ pubkey: "...", type: "Review", data: { agentId, rating, ... } }, ...]
```

### Usage: BorshReader (Custom Deserialization)

```js
const { BorshReader } = require('@brainai/satp-client');

// Low-level reader for custom account layouts
const r = new BorshReader(acct.data);
r.skipDiscriminator();           // skip 8-byte Anchor discriminator
const hash = r.readFixedBytes32(); // [u8; 32]
const name = r.readString();     // Borsh String
const items = r.readVecString(); // Vec<String>
const pk = r.readPubkeyBase58(); // Pubkey → base58
const opt = r.readOptionI64();   // Option<i64> → number | null
```

### Discriminator Utilities

```js
const { isAccountType, getAccountDiscriminator, DISCRIMINATORS } = require('@brainai/satp-client');

// Check account type before deserializing
if (isAccountType(acct.data, 'EscrowV3')) {
  const escrow = deserializeEscrowV3(acct.data);
}

// Get discriminator for filtering
const disc = getAccountDiscriminator('Attestation'); // 8-byte Buffer
// Use with getProgramAccounts memcmp filter
```

## Security

- All transactions are returned **unsigned** — the SDK never holds private keys
- PDA derivation is deterministic and verified against on-chain seeds
- CPI boundaries enforce program-level authorization
- Escrow funds are held by PDA-owned accounts (no custodial risk)

## License

MIT — brainAI 2026
