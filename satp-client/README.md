# SATP JavaScript SDK

Lightweight SDK for interacting with SATP (Solana Agent Token Protocol) programs on Solana.

## Install

```bash
cd satp-sdk && npm install
```

## Quick Start

```js
const { SATPSDK } = require('./src');

const sdk = new SATPSDK(); // mainnet by default
// const sdk = new SATPSDK({ rpcUrl: 'https://api.devnet.solana.com' });

// Check if an agent is registered
const verified = await sdk.verifyAgent('SomeWalletPubkey...');

// Get identity data
const identity = await sdk.getIdentity('SomeWalletPubkey...');

// Get reputation
const rep = await sdk.getReputation('SomeWalletPubkey...');

// Derive PDAs (offline, no RPC)
const pdas = sdk.getPDAs('SomeWalletPubkey...');
```

## Write Operations (require a signer)

```js
const { Keypair } = require('@solana/web3.js');

const signer = Keypair.fromSecretKey(/* your key */);

// Register identity
const sig = await sdk.registerIdentity(signer, 'my-agent', { type: 'ai', version: '1.0' });

// Add reputation (endorser signs)
const sig2 = await sdk.addReputation(endorserKeypair, targetWallet, 100);
```

## Transaction Builders (for wallet adapters / frontends)

```js
// Get unsigned transaction for frontend signing
const { transaction, identityPDA } = await sdk.buildRegisterIdentity(
  walletPublicKey, 'agent-name', { metadata: true }
);
// Sign with wallet adapter, then send
```

## API

| Method | Type | Description |
|--------|------|-------------|
| `getIdentity(wallet)` | Read | Fetch identity data (or null) |
| `getReputation(wallet)` | Read | Fetch reputation data (or null) |
| `verifyAgent(wallet)` | Read | Check if wallet has SATP identity |
| `getPDAs(wallet)` | Offline | Derive identity + reputation PDAs |
| `registerIdentity(signer, name, metadata)` | Write | Register on-chain identity |
| `addReputation(endorser, target, score)` | Write | Add reputation score |
| `buildRegisterIdentity(wallet, name, meta)` | Builder | Unsigned tx for frontends |
| `buildAddReputation(wallet, score, endorser)` | Builder | Unsigned tx for frontends |

## Program IDs (Mainnet)

| Program | Address |
|---------|---------|
| Identity | `BY4jzmnrui1K5gZ5z5xRQkVfEEMXYHYugtH1Ua867eyr` |
| Reputation | `TQ4P9R2Y5FRyw1TZfwoWQ2Mf6XeohbGdhYNcDxh6YYh` |
| Validation | `AdDWFa9oEmZdrTrhu8YTWu4ozbTP7e6qa9rvyqfAvM7N` |
| Escrow | `STyY8w4ZHws3X1AMoocWuDYBoogVDwvymPy8Wifx5TH` |

## Notes

- Account schemas are best-guess based on Anchor conventions. Once we have the actual IDLs, we can generate exact schemas.
- Write operations require SOL for transaction fees + rent.
- Always test on devnet first: `new SATPSDK({ rpcUrl: 'https://api.devnet.solana.com' })`
