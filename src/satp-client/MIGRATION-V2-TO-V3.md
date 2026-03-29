# SATP V2 → V3 Migration Guide

> **Author:** brainChain — brainAI  
> **Date:** 2026-03-27  
> **SDK Version:** 3.0.0  
> **Status:** Complete

---

## Overview

SATP V3 introduces **Genesis Records** — a new identity primitive that replaces V2's simpler identity model. V3 adds:

- **Agent ID hashing** — Deterministic PDA derivation from string IDs (SHA-256)
- **Burn-to-become** — Soulbound BOA NFTs as permanent identity artifacts
- **Name registry** — Unique, case-insensitive display names
- **Multi-wallet linking** — Associate multiple wallets across chains
- **CPI-based reputation/validation** — Cross-program invocation for score updates
- **Mint tracking** — Hard cap of 3 mints per identity
- **2-step authority rotation** — Secure propose/accept key rotation

V2 SDK remains exported for backward compatibility. No breaking changes.

---

## Migration Paths

### Path A: In-Place Migration (Recommended)

Use the `migrateV2ToV3` instruction to create a V3 Genesis Record from an existing V2 identity.

```javascript
const { SATPV3SDK } = require('@brainai/satp-client');

const sdk = new SATPV3SDK({ network: 'devnet' });

// Your V2 authority wallet signs the migration
const { transaction, genesisPDA } = await sdk.buildMigrateV2ToV3(
  v2AuthorityWallet.publicKey,
  'my-agent-id',
  {
    name: 'My Agent',
    description: 'Migrated from V2',
    category: 'analytics',
    capabilities: ['data-analysis', 'reporting'],
    metadataUri: 'https://arweave.net/metadata.json',
  }
);

// Sign and send
await sendAndConfirmTransaction(connection, transaction, [v2AuthorityWallet]);
console.log('V3 Genesis Record:', genesisPDA.toBase58());
```

**What happens:**
- V3 Genesis Record is created at a deterministic PDA derived from `hash(agent_id)`
- V2 authority becomes V3 authority (same signer)
- V2 account is **NOT** modified — both exist simultaneously
- Reputation starts at 500,000 (neutral), Verification at L0

### Path B: Fresh V3 Registration

Create a new V3 identity without migrating from V2.

```javascript
const { transaction, genesisPDA } = await sdk.buildCreateIdentity(
  wallet.publicKey,
  'new-agent-id',
  {
    name: 'New Agent',
    description: 'Born in V3',
    category: 'development',
    capabilities: ['coding', 'testing'],
    metadataUri: '',
  }
);
```

---

## SDK Import Changes

### Before (V2 only)

```javascript
const { SATPSDK } = require('@brainai/satp-client');
const sdk = new SATPSDK({ network: 'devnet' });

// V2 lookups by wallet address
const identity = await sdk.getIdentity('Bq1ni...');
```

### After (V3 with V2 backward compat)

```javascript
const { SATPV3SDK, SATPSDK } = require('@brainai/satp-client');

// V3 — lookup by agent ID string
const v3 = new SATPV3SDK({ network: 'devnet' });
const record = await v3.getGenesisRecord('brainChain');

// V2 — still works, same as before
const v2 = new SATPSDK({ network: 'devnet' });
const identity = await v2.getIdentity('Bq1ni...');
```

---

## Key Differences

| Feature | V2 | V3 |
|---------|-----|-----|
| Identity derivation | Wallet address (pubkey) | Agent ID string (SHA-256 hash) |
| Account type | Identity | Genesis Record |
| Authority rotation | Single-step | 2-step (propose/accept) |
| Reputation updates | Direct write | CPI from Reputation program |
| Validation updates | Direct write | CPI from Validation program |
| Name system | None | Case-insensitive unique registry |
| Multi-wallet | None | Linked wallet accounts |
| Soulbound NFTs | None | Burn-to-become with face artifacts |
| Mint cap | None | 3 per identity (MintTracker) |
| Account size | ~500 bytes | 1,384 bytes |

---

## PDA Derivation Changes

### V2 PDAs (wallet-based)

```javascript
const { getIdentityPDA } = require('@brainai/satp-client');

// Derived from wallet public key
const [identityPDA] = getIdentityPDA(walletPubkey);
```

### V3 PDAs (agent-ID-based)

```javascript
const { 
  hashAgentId,
  getGenesisPDA,
  getNameRegistryPDA,
  getLinkedWalletPDA,
  getV3MintTrackerPDA,
  getV3ReputationAuthorityPDA,
  getV3ValidationAuthorityPDA,
  getV3ReviewPDA,
  getV3AttestationPDA,
} = require('@brainai/satp-client');

// All derived from agent ID hash
const hash = hashAgentId('brainChain');         // SHA-256 → 32 bytes
const [genesis] = getGenesisPDA(hash, 'devnet');
const [name] = getNameRegistryPDA('brainChain', 'devnet');
const [linked] = getLinkedWalletPDA(genesis, wallet, 'devnet');
const [tracker] = getV3MintTrackerPDA(genesis, 'devnet');

// Program authority PDAs (global singletons)
const [repAuth] = getV3ReputationAuthorityPDA('devnet');
const [valAuth] = getV3ValidationAuthorityPDA('devnet');
```

---

## Reputation & Validation Architecture Change

### V2: Direct Write
```
Authority → Identity Program → Write reputation_score
```
Any authority could directly write reputation scores. Simple but no guarantees about score computation.

### V3: CPI-Based
```
Anyone → Reputation Program → CPI → Identity Program → Write reputation_score
              ↑
    Reads reviews from remaining_accounts,
    computes time-decay weighted average,
    signs with PDA authority
```

**Key changes:**
- Reputation and Validation are now **computed, not written**
- `recomputeReputation` reads Review accounts and computes time-decay scores
- `recomputeLevel` reads Attestation accounts and counts unique verified types
- Both are **permissionless** — anyone can trigger a recompute
- CPI authorization uses PDA signers verified against hardcoded program IDs
- Scores are deterministic given the same input data

---

## Checklist for Application Migration

### 1. SDK Update
- [ ] Update `@brainai/satp-client` to v3.0.0
- [ ] Import `SATPV3SDK` alongside or instead of `SATPSDK`
- [ ] Update TypeScript types (`.d.ts` files included)

### 2. Identity Reads
- [ ] Switch from wallet-based lookups to agent-ID lookups
- [ ] Use `getGenesisRecord(agentId)` instead of `getIdentity(wallet)`
- [ ] Handle new fields: `faceImage`, `faceMint`, `isBorn`, `verificationLevel`

### 3. Identity Writes
- [ ] Use `buildCreateIdentity` or `buildMigrateV2ToV3` for new records
- [ ] Implement 2-step authority rotation (propose → accept)
- [ ] Add name registration flow if needed

### 4. Reputation Flow
- [ ] Replace direct reputation writes with `buildRecomputeReputation`
- [ ] Pass review account PDAs as remaining_accounts
- [ ] Understand time-decay scoring (score range: 0 — 1,000,000)

### 5. Validation Flow
- [ ] Replace direct validation writes with `buildRecomputeLevel`
- [ ] Pass attestation account PDAs as remaining_accounts
- [ ] Map levels: L0 (0 types) → L5 (5+ types)

### 6. Testing
- [ ] Run against devnet with test wallets
- [ ] Verify PDA derivation matches on-chain
- [ ] Test CPI flows end-to-end

---

## Program IDs

### Devnet (current)
| Program | Address |
|---------|---------|
| Identity V3 | `GTppU4E44BqXTQgbqMZ68ozFzhP1TLty3EGnzzjtNZfG` |
| Reviews V3 | `r9XX4frcqxxAZ6Au9V5PA3EAxs1zoNckqLLmoSRcNr4` |
| Reputation V3 | `2Lz7KzMvKdrGeAuS8WPHu7jK2yScrnKVgacpYVEuDjkJ` |
| Attestations V3 | `6Xd1dAQJPvQRJ4Ntr6LtPTjDjPUZ8nfnmYLZaZ2DtrdD` |
| Validation V3 | `6rYRiCYidJYV7QvKrzKGgNu4oMh6BAvynked69R7xMbV` |

### Mainnet
TBD — will use same keypairs as devnet (same deploy authority).

---

## FAQ

**Q: Do I need to migrate V2 identities?**  
A: Not immediately. V2 and V3 coexist. Migrate when you need V3 features (names, CPI reputation, multi-wallet).

**Q: Can I use both V2 and V3 SDKs?**  
A: Yes. Both are exported from the same package. `const { SATPSDK, SATPV3SDK } = require('@brainai/satp-client');`

**Q: What happens to V2 data after migration?**  
A: V2 accounts are untouched. Migration is non-destructive.

**Q: Is the agent_id hash reversible?**  
A: No. SHA-256 is one-way. Store the original agent_id string off-chain.

**Q: Can anyone recompute my reputation?**  
A: Yes. Reputation and validation recompute are permissionless. The score is deterministic based on on-chain review/attestation data. This is a feature, not a bug — it prevents stale scores.

**Q: What's the cost difference?**  
A: V3 Genesis Records are ~1,384 bytes (~0.01 SOL rent). V2 was ~500 bytes (~0.004 SOL). Additional accounts (name, wallets, tracker) cost extra rent.
