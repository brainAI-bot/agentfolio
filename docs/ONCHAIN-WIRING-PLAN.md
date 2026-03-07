# On-Chain Wiring Plan — AgentFolio

**Date:** 2026-02-17  
**Status:** Audit complete, implementation pending

---

## Deployed Programs (Mainnet)

| Program | ID | Anchor IDL |
|---|---|---|
| Identity Registry | `CV5Wd9YGFX5A4dvuaFuEDuKQWp14NfnLrSdxY7EHFyeB` | `onchain/target/idl/identity_registry.json` |
| Escrow | `4qx9DTX1BojPnQAtUBL2Gb9pw6kVyw5AucjaR8Yyea9a` | `onchain/target/idl/agentfolio_escrow.json` |

**Deployer wallet:** `Bq1niVKyTECn4HDxAJWiHZvRMCZndZtC113yj3Rkbroc` (~8 SOL)  
**Keypair:** `/home/ubuntu/.config/solana/devnet-deployer.json`

---

## Current State Summary

### ✅ What Works
1. **brainKID registered on-chain** — via `onchain/register-brainkid.js` (manual script, raw instruction building)
2. **Wallet connect UI** — Phantom/Solflare connection, signature verification
3. **On-chain status check** — `GET /api/wallet/onchain-status/:address` → calls `checkOnChainIdentity()` in `wallet.js`
4. **Build registration tx** — `POST /api/wallet/build-register-tx` → `buildIdentityRegistrationTx()` returns unsigned tx for frontend signing
5. **Chain sync on startup** — `server.js:138-176` fetches all program accounts from Identity Registry and updates local DB with `onChainAccount` field
6. **IDL files exist** for both programs (full Anchor IDLs with all instructions, accounts, events)
7. **Solana escrow lib** — `src/lib/solana-escrow.js` has `depositToEscrow()` and presumably `releaseFromEscrow()` using raw SPL token transfers to a custodial wallet

### ❌ What's Broken / Not Wired

| Flow | Current Behavior | On-Chain Status |
|---|---|---|
| **Agent registration** | Saves to SQLite + JSON file | Frontend can build tx via `buildIdentityRegistrationTx()` but uses **wrong program IDs** (wallet.js has old SATP devnet IDs, not the deployed mainnet ones) |
| **Verification (GitHub/Twitter/Solana/etc)** | Saves to `verification_data` JSON in DB | **No on-chain attestation at all** — Identity Registry has no `add_badge` instruction |
| **Escrow creation** | Creates JSON file in `data/escrow/` | **Not calling on-chain `create_escrow`** — escrow.js is purely file-based |
| **Escrow funding** | DB record update | `solana-escrow.js` does raw USDC transfer to custodial wallet — **NOT the program PDA vault** |
| **Escrow release** | DB record update | Same — raw SPL transfer, not program instruction |
| **Trust scores** | Computed in `satp-registry.js` from SQLite `satp_attestations` table | **Never posted on-chain** — Identity Registry only stores `reputation_score` field but has no `update_reputation` instruction |
| **Explorer links** | Not shown to users | No tx signatures stored in DB |

---

## Critical Issues

### 1. Program ID Mismatch in wallet.js
`src/lib/wallet.js` line ~10 has **old devnet SATP program IDs**:
```js
const SATP_PROGRAMS = {
  identity: 'BY4jzmnrui1K5gZ5z5xRQkVfEEMXYHYugtH1Ua867eyr',  // WRONG - devnet
  validation: 'AdDWFa9oEmZdrTrhu8YTWu4ozbTP7e6qa9rvyqfAvM7N',  // WRONG - devnet
  ...
};
```
Should be:
```js
identity: 'CV5Wd9YGFX5A4dvuaFuEDuKQWp14NfnLrSdxY7EHFyeB'  // mainnet
```
The chain sync in `server.js:145` correctly uses `IDENTITY_REGISTRY_PROGRAM` (need to verify what that constant is).

### 2. PDA Seed Mismatch
- `register-brainkid.js` uses seed `["agent", owner]` ✅ (matches IDL)
- `wallet.js:checkOnChainIdentity()` uses seed `["identity", wallet]` ❌ (wrong seed!)
- `wallet.js:buildIdentityRegistrationTx()` also uses `["identity", wallet]` ❌

### 3. Discriminator Mismatch
- `wallet.js:buildIdentityRegistrationTx()` computes discriminator as `sha256("global:register_identity")` ❌
- Actual Anchor discriminator from IDL: `[135, 157, 66, 195, 2, 113, 175, 30]` (sha256 of `"global:register_agent"`)
- `register-brainkid.js` correctly uses the right discriminator ✅

### 4. Identity Registry Missing Instructions
The deployed program only has:
- `register_agent` — create agent profile PDA
- `update_agent` — update name/desc/twitter/website
- `deactivate_agent` / `reactivate_agent`

**Missing:** No `add_badge`, `add_verification`, `update_reputation`, or any attestation instruction. Verifications and trust scores **cannot be stored on-chain** with the current program.

### 5. Escrow Program Never Called
`src/lib/escrow.js` is a pure file-based system. `src/lib/solana-escrow.js` does raw SPL token transfers (custodial model), NOT Anchor program calls. The deployed escrow program at `4qx9DTX1BojPnQAtUBL2Gb9pw6kVyw5AucjaR8Yyea9a` is **completely unused**.

### 6. satp-explorer.js Points to Devnet
`src/lib/satp-explorer.js` queries devnet RPC with old program IDs — not connected to the mainnet programs.

---

## Wiring Plan

### Phase 1: Fix Registration (Quick Wins)

**1a. Fix program IDs in wallet.js**
- Replace `SATP_PROGRAMS.identity` with `CV5Wd9YGFX5A4dvuaFuEDuKQWp14NfnLrSdxY7EHFyeB`
- Remove/ignore the old devnet program references

**1b. Fix PDA seeds in wallet.js**
- `checkOnChainIdentity()`: change `["identity", wallet]` → `["agent", wallet]`
- `buildIdentityRegistrationTx()`: same seed fix + correct discriminator

**1c. Fix discriminator in buildIdentityRegistrationTx()**
- Use `sha256("global:register_agent")` or hardcode `[135, 157, 66, 195, 2, 113, 175, 30]`
- Better: use `@coral-xyz/anchor` client to build instructions from IDL

**1d. Store tx signature after registration**
- After frontend sends signed tx, save signature to profile record
- Show Explorer link: `https://explorer.solana.com/tx/{sig}`

**Estimated cost:** ~0.003 SOL per registration (account rent + tx fee)  
**Location:** `src/lib/wallet.js` lines 100-170, `server.js` lines 22181-22210

### Phase 2: Wire Escrow Program

**2a. Create `src/lib/escrow-onchain.js`** — Anchor client for escrow program
- Load IDL from `onchain/target/idl/agentfolio_escrow.json`
- Implement: `buildCreateEscrowTx()`, `buildReleaseTx()`, `buildRefundTx()`, `buildSubmitWorkTx()`, `buildAcceptJobTx()`
- All return unsigned serialized transactions for frontend wallet signing

**2b. Wire escrow creation flow**
- In `server.js` job posting endpoint: after DB escrow record, return tx for `create_escrow` instruction
- Frontend signs and sends; backend confirms and updates DB with tx sig
- Accounts needed: escrow PDA `["escrow", job_id]`, vault PDA `["vault", job_id]`, client token account, USDC mint, client (signer), token program, system program, rent

**2c. Wire escrow release flow**
- `release` instruction: client signs to release to agent
- `auto_release` instruction: cranked by anyone after 24h
- `refund` instruction: client reclaims if no agent / deadline passed

**2d. Server-side crank for auto_release**
- Add cron job that scans escrows in `WorkSubmitted` status where `work_submitted_at + 24h < now`
- Server signs with deployer keypair to call `auto_release`

**Estimated costs:**
| Instruction | ~SOL Cost |
|---|---|
| `create_escrow` | 0.005 (rent for escrow + vault accounts) |
| `accept_job` | 0.000005 (just data write) |
| `submit_work` | 0.000005 |
| `release` | 0.000005 |
| `auto_release` | 0.000005 |
| `refund` | 0.000005 |

**Location:** New file `src/lib/escrow-onchain.js`; hooks in `server.js` at job creation/acceptance/completion endpoints

### Phase 3: On-Chain Attestations (Requires Program Upgrade)

The Identity Registry program **does not support** verification attestations or trust score updates. Two options:

**Option A: Upgrade Identity Registry** (recommended)
Add instructions:
- `add_verification(platform: String, proof_hash: [u8; 32])` — stores verification as PDA `["verification", agent, platform]`
- `update_reputation(score: u32)` — authority-gated, only deployer can call
- `revoke_verification(platform: String)`

Estimated development: ~2-4 hours Anchor code + deploy  
Cost: program upgrade is free (deployer authority), new account rent ~0.002 SOL per verification

**Option B: Use Memo Program as attestation layer**
- On each verification, send a memo transaction: `{"type":"verification","agent":"...","platform":"github","proof":"..."}`
- Cheap (~0.000005 SOL per memo) but not queryable on-chain
- Explorer links still work

**Recommendation:** Option A for real on-chain state, with Option B as interim quick-win

### Phase 4: Explorer Links & UI

**4a. Store all tx signatures**
- Add `tx_signature` column/field to: profiles, verifications, escrow records
- After any on-chain action, save the signature

**4b. Show Explorer links in UI**
- Profile page: "Registered on-chain" badge → link to registration tx
- Verification badges: "Verified on Solana" → link to attestation tx
- Escrow: "View on Explorer" for creation, release, refund txs
- Format: `https://explorer.solana.com/tx/{sig}`

**4c. Fix chain sync**
- Update `server.js:138-176` to use correct mainnet program ID and PDA seed
- Add periodic re-sync (not just startup)

---

## Existing Code Inventory

| File | Purpose | Status |
|---|---|---|
| `onchain/register-brainkid.js` | Manual registration script | ✅ Works (brainKID registered) |
| `onchain/target/idl/identity_registry.json` | Anchor IDL for identity program | ✅ Complete |
| `onchain/target/idl/agentfolio_escrow.json` | Anchor IDL for escrow program | ✅ Complete |
| `src/lib/wallet.js` | Wallet connect, sig verify, registration tx | ⚠️ Wrong program IDs, wrong PDA seeds, wrong discriminator |
| `src/lib/solana-escrow.js` | Raw SPL USDC transfers (custodial) | ⚠️ Doesn't use escrow program |
| `src/lib/escrow.js` | File-based escrow system | ⚠️ No on-chain calls |
| `src/lib/satp-registry.js` | SQLite attestations + trust scores | ⚠️ DB-only, no on-chain writes |
| `src/lib/satp-explorer.js` | Devnet SATP data fetcher | ❌ Wrong network, wrong programs |
| `src/lib/solana-verify.js` | Wallet signature verification | ✅ Works for verification |
| `solana/` | Old devnet Anchor workspace (5 programs) | ❌ Not the deployed programs |
| `onchain/` | Mainnet Anchor workspace (2 programs) | ✅ Source of truth |

---

## Implementation Priority

1. **Fix wallet.js** (program IDs, PDA seeds, discriminator) — 1 hour, zero risk
2. **Store + display tx signatures / Explorer links** — 2 hours
3. **Wire escrow program** via Anchor client — 4 hours
4. **Upgrade Identity Registry** with verification instructions — 4 hours
5. **Wire verification attestations** — 2 hours
6. **Wire trust score updates** — 1 hour
7. **Auto-release crank** — 1 hour

**Total estimated effort:** ~15 hours  
**SOL budget needed:** ~1 SOL for testing + ongoing operations (registrations + escrow rent)

---

## Dependencies

- `@coral-xyz/anchor` — for Anchor client (may need to `npm install`)
- `@solana/web3.js` — already installed
- `@solana/spl-token` — already installed
- Deployer keypair at `/home/ubuntu/.config/solana/devnet-deployer.json` — needed for authority-gated instructions
- USDC token accounts for treasury wallet
