import { PublicKey } from '@solana/web3.js';

/**
 * BorshReader — streaming Borsh deserializer for raw account data.
 */
export class BorshReader {
  buf: Buffer;
  offset: number;

  constructor(buf: Buffer, offset?: number);

  readBytes(n: number): Buffer;
  readU8(): number;
  readU16(): number;
  readU32(): number;
  readU64Num(): number;
  readU64BigInt(): bigint;
  readI64(): number;
  readI64BigInt(): bigint;
  readBool(): boolean;
  readFixedBytes32(): Buffer;
  readPubkey(): PublicKey;
  readPubkeyBase58(): string;
  readString(): string;
  readVecString(): string[];
  readOption<T>(readerFn: (this: BorshReader) => T): T | null;
  readOptionPubkey(): string | null;
  readOptionI64(): number | null;
  readOptionBytes32Hex(): string | null;
  skipDiscriminator(): this;
  remaining(): number;
}

// ─── Parsed Account Types ─────────────────────────

export interface ParsedGenesisRecord {
  agentIdHash: string;
  agentName: string;
  description: string;
  category: string;
  capabilities: string[];
  metadataUri: string;
  faceImage: string | null;
  faceMint: string | null;
  faceBurnTx: string | null;
  genesisRecord: number;
  isBorn: boolean;
  isActive: boolean;
  authority: string;
  pendingAuthority: string | null;
  reputationScore: number;
  verificationLevel: number;
  reputationUpdatedAt: number;
  verificationUpdatedAt: number;
  createdAt: number;
  updatedAt: number;
  bump: number;
}

export interface ParsedLinkedWallet {
  identity: string;
  wallet: string;
  chain: string;
  label: string;
  verifiedAt: number;
  isActive: boolean;
  bump: number;
}

export interface ParsedMintTracker {
  identity: string;
  mintCount: number;
  lastMintTimestamp: number;
  bump: number;
}

export interface ParsedNameRegistry {
  name: string;
  nameHash: string;
  identity: string;
  authority: string;
  registeredAt: number;
  isActive: boolean;
  bump: number;
}

export interface ParsedReview {
  agentId: string;
  agentIdHash: string;
  reviewer: string;
  rating: number;
  reviewText: string;
  metadata: string;
  createdAt: number;
  updatedAt: number;
  isActive: boolean;
  bump: number;
}

export interface ParsedReviewCounter {
  agentId: string;
  agentIdHash: string;
  count: number;
  bump: number;
}

export interface ParsedAttestation {
  agentId: string;
  agentIdHash: string;
  attestationType: string;
  issuer: string;
  proofData: string;
  verified: boolean;
  createdAt: number;
  expiresAt: number | null;
  isRevoked: boolean;
  isExpired: boolean;
  isValid: boolean;
  bump: number;
}

export type EscrowStatusV3 =
  | 'Active'
  | 'WorkSubmitted'
  | 'Released'
  | 'Cancelled'
  | 'Disputed'
  | 'Resolved';

export interface ParsedEscrowV3 {
  client: string;
  agent: string;
  agentIdHash: string;
  amount: number;
  releasedAmount: number;
  remaining: number;
  descriptionHash: string;
  deadline: number;
  nonce: number;
  status: EscrowStatusV3 | string;
  statusCode: number;
  minVerificationLevel: number;
  requireBorn: boolean;
  createdAt: number;
  arbiter: string;
  workHash: string | null;
  workSubmittedAt: number | null;
  disputeReasonHash: string | null;
  disputedAt: number | null;
  disputedBy: string | null;
  bump: number;
}

// ─── Account Type Names ───────────────────────────

export type AccountTypeName =
  | 'GenesisRecord'
  | 'LinkedWallet'
  | 'MintTracker'
  | 'NameRegistry'
  | 'Review'
  | 'ReviewCounter'
  | 'Attestation'
  | 'EscrowV3';

export type ParsedAccountData =
  | ParsedGenesisRecord
  | ParsedLinkedWallet
  | ParsedMintTracker
  | ParsedNameRegistry
  | ParsedReview
  | ParsedReviewCounter
  | ParsedAttestation
  | ParsedEscrowV3;

// ─── Deserializer Functions ───────────────────────

export function deserializeGenesisRecord(data: Buffer): ParsedGenesisRecord;
export function deserializeLinkedWallet(data: Buffer): ParsedLinkedWallet;
export function deserializeMintTracker(data: Buffer): ParsedMintTracker;
export function deserializeNameRegistry(data: Buffer): ParsedNameRegistry;
export function deserializeReview(data: Buffer): ParsedReview;
export function deserializeReviewCounter(data: Buffer): ParsedReviewCounter;
export function deserializeAttestation(data: Buffer): ParsedAttestation;
export function deserializeEscrowV3(data: Buffer): ParsedEscrowV3;

/** Auto-detect and deserialize any SATP V3 account. */
export function deserializeAccount(data: Buffer): {
  type: AccountTypeName;
  data: ParsedAccountData;
};

/** Batch deserialize getProgramAccounts results. */
export function deserializeBatch(
  accounts: Array<{ pubkey: PublicKey; account: { data: Buffer } }>,
  expectedType?: AccountTypeName
): Array<{
  pubkey: string;
  type: AccountTypeName;
  data: ParsedAccountData;
}>;

/** Get the 8-byte Anchor discriminator for a known account type. */
export function getAccountDiscriminator(accountName: string): Buffer;

/** Compute Anchor account discriminator: SHA256("account:<name>")[0..8] */
export function accountDiscriminator(accountName: string): Buffer;

/** Check if raw data matches a specific account type's discriminator. */
export function isAccountType(data: Buffer, accountName: AccountTypeName): boolean;

/** Pre-computed discriminators for all V3 account types. */
export const DISCRIMINATORS: Record<AccountTypeName, Buffer>;
