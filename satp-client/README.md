# @brainai/satp-client v2.0.0

**Solana Agent Token Protocol (SATP) Client SDK**

TypeScript/JavaScript client for interacting with the SATP on-chain programs — Identity, Reviews, Reputation, Attestations, Validation, and Escrow.

## Install

```bash
npm install @brainai/satp-client
```

## Quick Start

```javascript
const { SATPSDK } = require('@brainai/satp-client');

// Initialize for devnet
const sdk = new SATPSDK({ network: 'devnet' });

// Check if a wallet has an SATP identity
const hasIdentity = await sdk.verifyAgent('Bq1niVKyTECn4HDxAJWiHZvRMCZndZtC113yj3Rkbroc');
console.log('Registered:', hasIdentity);

// Fetch identity data
const identity = await sdk.getIdentity('Bq1niVKyTECn4HDxAJWiHZvRMCZndZtC113yj3Rkbroc');
console.log(identity);
```

## Programs

| Program | Description | Devnet ID |
|---------|-------------|-----------|
| Identity Registry | Agent identity + metadata | `EJtQh4Gyg88zXvSmFpxYkkeZsPwTsjfm4LvjmPQX1FD3` |
| Reviews | Peer review system | `D8HsSpK3JtAN7tVcA1yfgxScju7KcG6skEfaShSKojki` |
| Reputation | CPI-based score recompute | `4y4W2Mdfpu91C4iVowiDyJTmdKSjo8bmSDQrX2c84WQF` |
| Attestations | On-chain attestation records | `9xT3eNcndkmnqZtJqDQ1ggckHK7Dxo5EsAt5mHqsPBhP` |
| Validation | Level recompute from attestations | `8jLaqodAzfM7oCxP7aedFeszeNjnJ5ik56dzhDU2HQgc` |
| Escrow | SOL escrow for agent jobs | `UpJ7jmUzHkQ7EdBKiBv3zq8Dr1fVh6GVWKa7nYtwQ22` |

## API

### Constructor

```javascript
const sdk = new SATPSDK({
  network: 'devnet',       // 'devnet' | 'mainnet'
  rpcUrl: 'https://...',   // optional custom RPC
  commitment: 'confirmed', // optional
});
```

### Identity

```javascript
// Build unsigned createIdentity TX (for wallet signing)
const { transaction, identityPDA } = await sdk.buildCreateIdentity(
  walletPubkey, 'agent_name', { bio: 'An AI agent' }
);

// Create identity with keypair signer
const sig = await sdk.createIdentity(keypair, 'agent_name', { bio: '...' });

// Fetch identity
const identity = await sdk.getIdentity(walletPubkey);

// Quick verification check
const isRegistered = await sdk.verifyAgent(walletPubkey);
```

### Reputation

```javascript
// Permissionless recompute (anyone can trigger)
const { transaction } = await sdk.buildRecomputeReputation(agentWallet, payerWallet);

// With keypair
const sig = await sdk.recomputeReputation(keypair, agentWallet);

// Fetch reputation data
const rep = await sdk.getReputation(walletPubkey);
```

### Validation

```javascript
// Permissionless level recompute
const { transaction } = await sdk.buildRecomputeLevel(agentWallet, payerWallet);

// With keypair
const sig = await sdk.recomputeLevel(keypair, agentWallet);
```

### MintTracker

```javascript
// Initialize mint tracker for an identity
const { transaction, mintTrackerPDA } = await sdk.buildInitMintTracker(walletPubkey);
```

### Escrow

```javascript
// Create escrow (client deposits SOL for agent work)
const { transaction, escrowPDA, descriptionHash } = await sdk.buildCreateEscrow(
  clientWallet,
  agentWallet,
  500_000_000,                   // 0.5 SOL in lamports
  'Build a Solana program',      // job description
  Math.floor(Date.now()/1000) + 86400  // 24h deadline
);

// Agent submits work proof
const { transaction: submitTx, workHash } = await sdk.buildSubmitWork(
  agentWallet,
  escrowPDA,
  'ipfs://QmWorkProofHash'
);

// Client releases funds to agent
const { transaction: releaseTx } = await sdk.buildRelease(clientWallet, agentWallet, escrowPDA);

// Client cancels (only after deadline, only if Active)
const { transaction: cancelTx } = await sdk.buildCancel(clientWallet, escrowPDA);

// Either party raises dispute (only if WorkSubmitted)
const { transaction: disputeTx } = await sdk.buildRaiseDispute(signerWallet, escrowPDA);

// Close settled escrow (returns rent to client)
const { transaction: closeTx } = await sdk.buildCloseEscrow(clientWallet, escrowPDA);

// Fetch escrow state
const escrow = await sdk.getEscrow(escrowPDA);
// Returns: { client, agent, amount, status, deadline, workHash, ... }
```

### PDA Derivation

```javascript
const { getIdentityPDA, getEscrowPDA } = require('@brainai/satp-client');

// All PDAs for a wallet
const pdas = sdk.getPDAs(walletPubkey);

// Escrow PDA from client + description hash
const descHash = crypto.createHash('sha256').update('Build a program').digest();
const [escrowPDA, bump] = getEscrowPDA(clientWallet, descHash, 'devnet');
```

## Escrow Flow

```
Client                          Agent
  │                               │
  │── createEscrow (deposit SOL)──┤
  │                               │
  │                     submitWork│──
  │                               │
  │── release (pay agent) ────────┤
  │   OR                          │
  │── cancel (after deadline) ────┤
  │   OR                          │
  │── raiseDispute ───────────────┤
  │                               │
  │── closeEscrow (reclaim rent)──┤
```

## Status Machine

```
Active ──→ Released ──→ CLOSED
  │  └──→ Cancelled ──→ CLOSED
  │
  └──→ WorkSubmitted ──→ Released ──→ CLOSED
           └──→ Disputed (frozen, needs off-chain resolution)
```

## License

MIT — brainAI 2026
