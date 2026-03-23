/**
 * SATP V3 — Genesis Record Client Library
 *
 * TypeScript SDK for interacting with the SATP V3 Genesis Record program.
 * One import = full identity management.
 *
 * Usage:
 *   import { SatpV3Client, deriveGenesisPda, agentIdHash } from '@brainai/satp-v3';
 */

import { PublicKey, Connection, SystemProgram, Transaction } from "@solana/web3.js";
import { createHash } from "crypto";

// ═══════════════════════════════════════════════
//  PROGRAM IDS (Mainnet — deployed 2026-03-16)
// ═══════════════════════════════════════════════

export const PROGRAM_IDS = {
  identity: new PublicKey("GTppU4E44BqXTQgbqMZ68ozFzhP1TLty3EGnzzjtNZfG"),
  reviews: new PublicKey("r9XX4frcqxxAZ6Au9V5PA3EAxs1zoNckqLLmoSRcNr4"),
  reputation: new PublicKey("2Lz7KzMvKdrGeAuS8WPHu7jK2yScrnKVgacpYVEuDjkJ"),
  attestations: new PublicKey("6Xd1dAQJPvQRJ4Ntr6LtPTjDjPUZ8nfnmYLZaZ2DtrdD"),
  validation: new PublicKey("6rYRiCYidJYV7QvKrzKGgNu4oMh6BAvynked69R7xMbV"),
};

// ═══════════════════════════════════════════════
//  HASH & PDA HELPERS
// ═══════════════════════════════════════════════

/**
 * Compute SHA-256 hash of an agent_id string.
 * Matches on-chain `agent_id_hash()` function.
 */
export function agentIdHash(agentId: string): Buffer {
  return createHash("sha256").update(agentId).digest();
}

/**
 * Derive the Genesis Record PDA for an agent.
 * Seeds: [b"genesis", sha256(agent_id)]
 */
export function deriveGenesisPda(agentId: string): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("genesis"), agentIdHash(agentId)],
    PROGRAM_IDS.identity
  );
}

/**
 * Derive a Linked Wallet PDA.
 * Seeds: [b"linked_wallet", genesis_pda, wallet]
 */
export function deriveLinkedWalletPda(
  genesisPda: PublicKey,
  wallet: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("linked_wallet"), genesisPda.toBuffer(), wallet.toBuffer()],
    PROGRAM_IDS.identity
  );
}

/**
 * Derive a Mint Tracker PDA.
 * Seeds: [b"mint_tracker", genesis_pda]
 */
export function deriveMintTrackerPda(genesisPda: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("mint_tracker"), genesisPda.toBuffer()],
    PROGRAM_IDS.identity
  );
}

/**
 * Derive a Review V3 PDA.
 * Seeds: [b"review_v3", sha256(agent_id), reviewer]
 */
export function deriveReviewPda(
  agentId: string,
  reviewer: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("review_v3"), agentIdHash(agentId), reviewer.toBuffer()],
    PROGRAM_IDS.reviews
  );
}

/**
 * Derive a Review Counter V3 PDA.
 * Seeds: [b"review_counter_v3", sha256(agent_id)]
 */
export function deriveReviewCounterPda(agentId: string): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("review_counter_v3"), agentIdHash(agentId)],
    PROGRAM_IDS.reviews
  );
}

/**
 * Derive a Reputation V3 Authority PDA.
 */
export function deriveReputationAuthorityPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("reputation_v3_authority")],
    PROGRAM_IDS.reputation
  );
}

/**
 * Derive a Validation V3 Authority PDA.
 */
export function deriveValidationAuthorityPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("validation_v3_authority")],
    PROGRAM_IDS.validation
  );
}

/**
 * Derive an Attestation V3 PDA.
 * Seeds: [b"attestation_v3", sha256(agent_id), issuer, attestation_type]
 */
export function deriveAttestationPda(
  agentId: string,
  issuer: PublicKey,
  attestationType: string
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("attestation_v3"),
      agentIdHash(agentId),
      issuer.toBuffer(),
      Buffer.from(attestationType),
    ],
    PROGRAM_IDS.attestations
  );
}

/**
 * Derive a Review Attestation V3 PDA (created via CPI from Reviews).
 * Seeds: [b"attestation_v3", sha256(agent_id), reviews_authority, b"review", reviewer]
 */
export function deriveReviewAttestationPda(
  agentId: string,
  reviewsAuthority: PublicKey,
  reviewer: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("attestation_v3"),
      agentIdHash(agentId),
      reviewsAuthority.toBuffer(),
      Buffer.from("review"),
      reviewer.toBuffer(),
    ],
    PROGRAM_IDS.attestations
  );
}

// ═══════════════════════════════════════════════
//  TYPES (matching on-chain structures)
// ═══════════════════════════════════════════════

export interface GenesisRecord {
  agentIdHash: number[]; // 32 bytes
  agentName: string;
  description: string;
  category: string;
  capabilities: string[];
  metadataUri: string;
  faceImage: string;
  faceMint: PublicKey;
  faceBurnTx: string;
  genesisRecord: number; // i64 — 0 = unborn, >0 = birth timestamp
  authority: PublicKey;
  pendingAuthority: PublicKey | null;
  reputationScore: number; // u64, 0-1_000_000
  verificationLevel: number; // u8, 0-5
  reputationUpdatedAt: number;
  verificationUpdatedAt: number;
  createdAt: number;
  updatedAt: number;
  bump: number;
}

export interface LinkedWallet {
  identity: PublicKey;
  wallet: PublicKey;
  chain: string;
  label: string;
  verifiedAt: number;
  isActive: boolean;
  bump: number;
}

export interface ReviewV3 {
  agentId: string;
  agentIdHash: number[];
  reviewer: PublicKey;
  rating: number;
  reviewText: string;
  metadata: string;
  createdAt: number;
  updatedAt: number;
  isActive: boolean;
  bump: number;
}

export interface ReviewCounterV3 {
  agentId: string;
  agentIdHash: number[];
  count: number;
  bump: number;
}

// ═══════════════════════════════════════════════
//  UTILITY FUNCTIONS
// ═══════════════════════════════════════════════

/**
 * Check if an agent has been "born" (completed burn-to-become).
 */
export function isBorn(genesis: GenesisRecord): boolean {
  return genesis.genesisRecord > 0;
}

/**
 * Get reputation as a human-readable percentage.
 * Score is in [0, 1_000_000], represents 0.0000 to 100.0000.
 */
export function reputationPct(genesis: GenesisRecord): string {
  return (genesis.reputationScore / 10_000).toFixed(2);
}

/**
 * Get verification level label.
 */
export function verificationLabel(level: number): string {
  const labels = [
    "Unverified",
    "Basic",
    "Standard",
    "Enhanced",
    "Premium",
    "Maximum",
  ];
  return labels[level] || "Unknown";
}

/**
 * Derive a Name Registry PDA.
 * Seeds: [b"name_registry", sha256(lowercase(name))]
 */
export function deriveNameRegistryPda(name: string): [PublicKey, number] {
  const nameHash = createHash("sha256").update(name.toLowerCase()).digest();
  return PublicKey.findProgramAddressSync(
    [Buffer.from("name_registry"), nameHash],
    PROGRAM_IDS.identity
  );
}

// ═══════════════════════════════════════════════
//  NAME REGISTRY TYPE
// ═══════════════════════════════════════════════

export interface NameRegistry {
  name: string;
  nameHash: number[];
  identity: PublicKey;
  authority: PublicKey;
  registeredAt: number;
  isActive: boolean;
  bump: number;
}

export interface MintTracker {
  identity: PublicKey;
  mintCount: number;
  lastMintTimestamp: number;
  bump: number;
}

// ═══════════════════════════════════════════════
//  UTILITY FUNCTIONS
// ═══════════════════════════════════════════════

/**
 * Resolve an agent_id to their Genesis Record PDA address.
 * This is the key operation: agent_id → on-chain identity, zero trust.
 */
export function resolveAgent(agentId: string): PublicKey {
  const [pda] = deriveGenesisPda(agentId);
  return pda;
}

/**
 * Trust tier from reputation score.
 */
export function trustTier(score: number): { tier: string; label: string } {
  if (score >= 500) return { tier: "L5", label: "Sovereign" };
  if (score >= 300) return { tier: "L4", label: "Established" };
  if (score >= 150) return { tier: "L3", label: "Trusted" };
  if (score >= 50)  return { tier: "L2", label: "Verified" };
  return { tier: "L1", label: "New" };
}

// ═══════════════════════════════════════════════
//  CLIENT CLASS — fetch on-chain data
// ═══════════════════════════════════════════════

export class SatpV3Client {
  private connection: Connection;

  constructor(rpcUrl: string = "https://api.mainnet-beta.solana.com") {
    this.connection = new Connection(rpcUrl, "confirmed");
  }

  /**
   * Fetch a Genesis Record by agent_id.
   * Returns null if the agent hasn't registered on-chain.
   */
  async getGenesis(agentId: string): Promise<{ pda: PublicKey; data: Buffer } | null> {
    const [pda] = deriveGenesisPda(agentId);
    const account = await this.connection.getAccountInfo(pda);
    if (!account) return null;
    return { pda, data: account.data };
  }

  /**
   * Check if an agent exists on-chain.
   */
  async agentExists(agentId: string): Promise<boolean> {
    const [pda] = deriveGenesisPda(agentId);
    const account = await this.connection.getAccountInfo(pda);
    return account !== null;
  }

  /**
   * Fetch the Name Registry for a name.
   * Returns null if the name isn't registered.
   */
  async getNameRegistry(name: string): Promise<{ pda: PublicKey; data: Buffer } | null> {
    const [pda] = deriveNameRegistryPda(name);
    const account = await this.connection.getAccountInfo(pda);
    if (!account) return null;
    return { pda, data: account.data };
  }

  /**
   * Check if a name is taken (registered and active).
   */
  async isNameTaken(name: string): Promise<boolean> {
    const result = await this.getNameRegistry(name);
    return result !== null;
  }

  /**
   * Fetch the MintTracker for an agent.
   */
  async getMintTracker(agentId: string): Promise<{ pda: PublicKey; data: Buffer } | null> {
    const [genesisPda] = deriveGenesisPda(agentId);
    const [trackerPda] = deriveMintTrackerPda(genesisPda);
    const account = await this.connection.getAccountInfo(trackerPda);
    if (!account) return null;
    return { pda: trackerPda, data: account.data };
  }

  /**
   * Fetch all linked wallets for an agent.
   * Uses getProgramAccounts with memcmp filter on identity field.
   */
  async getLinkedWallets(agentId: string): Promise<{ pubkey: PublicKey; data: Buffer }[]> {
    const [genesisPda] = deriveGenesisPda(agentId);
    const accounts = await this.connection.getProgramAccounts(PROGRAM_IDS.identity, {
      filters: [
        { dataSize: 138 }, // LinkedWallet::SPACE
        { memcmp: { offset: 8, bytes: genesisPda.toBase58() } }, // identity field after discriminator
      ],
    });
    return accounts.map(a => ({ pubkey: a.pubkey, data: a.account.data }));
  }

  /**
   * Fetch the review counter for an agent.
   */
  async getReviewCount(agentId: string): Promise<number | null> {
    const [pda] = deriveReviewCounterPda(agentId);
    const account = await this.connection.getAccountInfo(pda);
    if (!account) return null;
    // Review count is at offset: 8 (disc) + (4+64) (agent_id) + 32 (hash) = 108, then u64
    const data = account.data;
    if (data.length < 116) return null;
    return Number(data.readBigUInt64LE(108));
  }

  /**
   * Fetch all reviews for an agent.
   */
  async getReviews(agentId: string): Promise<{ pubkey: PublicKey; data: Buffer }[]> {
    const hash = agentIdHash(agentId);
    const accounts = await this.connection.getProgramAccounts(PROGRAM_IDS.reviews, {
      filters: [
        // Filter by agent_id_hash (after discriminator + agent_id string)
        { memcmp: { offset: 8 + 4 + 64, bytes: Buffer.from(hash).toString("base64") } },
      ],
    });
    return accounts.map(a => ({ pubkey: a.pubkey, data: a.account.data }));
  }

  /**
   * Get a summary of an agent's on-chain identity.
   * One call = full picture.
   */
  async getAgentSummary(agentId: string): Promise<{
    exists: boolean;
    pda: PublicKey;
    reviewCount: number | null;
    linkedWalletCount: number;
  }> {
    const [pda] = deriveGenesisPda(agentId);
    const [exists, reviewCount, linkedWallets] = await Promise.all([
      this.agentExists(agentId),
      this.getReviewCount(agentId),
      this.getLinkedWallets(agentId),
    ]);
    return {
      exists,
      pda,
      reviewCount,
      linkedWalletCount: linkedWallets.length,
    };
  }
}
