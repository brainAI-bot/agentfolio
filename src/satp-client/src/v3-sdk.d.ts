import { Connection, PublicKey, Transaction } from '@solana/web3.js';

export type Network = 'mainnet' | 'devnet';
export type AgentIdOrHash = string | Buffer;

export interface SATPV3SDKOptions {
  network?: Network;
  rpcUrl?: string;
  commitment?: 'processed' | 'confirmed' | 'finalized';
}

export interface V3ProgramIds {
  IDENTITY: PublicKey;
  REVIEWS: PublicKey;
  REPUTATION: PublicKey;
  ATTESTATIONS: PublicKey;
  VALIDATION: PublicKey;
  ESCROW: PublicKey;
}

export interface CreateIdentityMeta {
  name?: string;
  description?: string;
  category?: string;
  capabilities?: string[];
  metadataUri?: string;
}

export interface UpdateIdentityFields {
  name?: string | null;
  description?: string | null;
  category?: string | null;
  capabilities?: string[] | null;
  metadataUri?: string | null;
}

export interface GenesisRecord {
  agentId: string;
  authority: string;
  name: string;
  description: string;
  category: string;
  capabilities: string[];
  metadataUri: string;
  reputationScore: number;
  verificationLevel: number;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
  pendingAuthority: string | null;
  faceImage: string;
  faceMint: string | null;
  faceBurnTx: string;
  genesisRecord: boolean;
  pda: string;
}

export interface TransactionResult {
  transaction: Transaction;
}

export interface CreateIdentityResult extends TransactionResult {
  genesisPDA: PublicKey;
}

export interface RegisterNameResult extends TransactionResult {
  nameRegistryPDA: PublicKey;
}

export interface LinkWalletResult extends TransactionResult {
  linkedWalletPDA: PublicKey;
}

export interface MintTrackerResult extends TransactionResult {
  mintTrackerPDA: PublicKey;
}

export interface CreateAttestationResult extends TransactionResult {
  attestationPDA: PublicKey;
}

export interface CreateReviewResult extends TransactionResult {
  reviewPDA: PublicKey;
}

export interface InitReviewCounterResult extends TransactionResult {
  counterPDA: PublicKey;
}

export interface CreateReviewOpts {
  identityProgram?: PublicKey | string;
  identityAccount?: PublicKey | string;
}

export interface V3Review {
  pda: string;
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

export interface V3ReviewCounter {
  pda: string;
  agentId: string;
  count: number;
  bump: number;
}

export interface UpdateReviewFields {
  rating?: number;
  reviewText?: string;
  metadata?: string;
}

export type EscrowStatus = 'Active' | 'WorkSubmitted' | 'Released' | 'Cancelled' | 'Disputed' | 'Resolved';

export interface CreateEscrowOpts {
  minVerificationLevel?: number;
  requireBorn?: boolean;
  arbiter?: PublicKey | string;
}

export interface CreateEscrowResult extends TransactionResult {
  escrowPDA: PublicKey;
  descriptionHash: Buffer;
}

export interface SubmitWorkResult extends TransactionResult {
  workHash: Buffer;
}

export interface RaiseDisputeResult extends TransactionResult {
  reasonHash: Buffer;
}

export interface EscrowPDAResult {
  escrowPDA: string;
  bump: number;
  descriptionHash: string;
}

export interface V3Escrow {
  pda: string;
  client: string;
  agent: string;
  agentIdHash: string;
  amount: number;
  releasedAmount: number;
  remaining: number;
  descriptionHash: string;
  deadline: number;
  nonce: number;
  status: EscrowStatus;
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

export interface V3PDAs {
  genesis: string;
  reputationAuthority: string;
  validationAuthority: string;
  mintTracker: string;
}

export class SATPV3SDK {
  network: Network;
  rpcUrl: string;
  commitment: string;
  connection: Connection;
  programIds: V3ProgramIds;

  constructor(opts?: SATPV3SDKOptions);

  // ─── Identity — Genesis Record CRUD ───────────────────

  /** Build createIdentity transaction. */
  buildCreateIdentity(
    creator: PublicKey | string,
    agentId: string,
    meta: CreateIdentityMeta
  ): Promise<CreateIdentityResult>;

  /** Build burnToBecome transaction (set immutable face). */
  buildBurnToBecome(
    authority: PublicKey | string,
    agentIdOrHash: AgentIdOrHash,
    faceImage: string,
    faceMint: PublicKey | string,
    faceBurnTx: string
  ): Promise<TransactionResult>;

  /** Build updateIdentity transaction. */
  buildUpdateIdentity(
    authority: PublicKey | string,
    agentIdOrHash: AgentIdOrHash,
    updates: UpdateIdentityFields
  ): Promise<TransactionResult>;

  /** Build proposeAuthority transaction (step 1 of 2-step rotation). */
  buildProposeAuthority(
    authority: PublicKey | string,
    agentIdOrHash: AgentIdOrHash,
    newAuthority: PublicKey | string
  ): Promise<TransactionResult>;

  /** Build acceptAuthority transaction (step 2 of 2-step rotation). */
  buildAcceptAuthority(
    newAuthority: PublicKey | string,
    agentIdOrHash: AgentIdOrHash
  ): Promise<TransactionResult>;

  /** Build cancelAuthorityTransfer transaction. */
  buildCancelAuthorityTransfer(
    authority: PublicKey | string,
    agentIdOrHash: AgentIdOrHash
  ): Promise<TransactionResult>;

  /** Build deactivateIdentity transaction. */
  buildDeactivateIdentity(
    authority: PublicKey | string,
    agentIdOrHash: AgentIdOrHash
  ): Promise<TransactionResult>;

  /** Build reactivateIdentity transaction. */
  buildReactivateIdentity(
    authority: PublicKey | string,
    agentIdOrHash: AgentIdOrHash
  ): Promise<TransactionResult>;

  /** Build migrateV2ToV3 transaction. */
  buildMigrateV2ToV3(
    v2Authority: PublicKey | string,
    agentId: string,
    meta: CreateIdentityMeta
  ): Promise<CreateIdentityResult>;

  // ─── Name Registry ────────────────────────────────────

  /** Build registerName transaction (case-insensitive uniqueness). */
  buildRegisterName(
    authority: PublicKey | string,
    agentIdOrHash: AgentIdOrHash,
    name: string
  ): Promise<RegisterNameResult>;

  /** Build releaseName transaction. */
  buildReleaseName(
    authority: PublicKey | string,
    agentIdOrHash: AgentIdOrHash,
    name: string
  ): Promise<TransactionResult>;

  // ─── Linked Wallets ───────────────────────────────────

  /** Build linkWallet transaction. */
  buildLinkWallet(
    authority: PublicKey | string,
    agentIdOrHash: AgentIdOrHash,
    wallet: PublicKey | string,
    chain: string,
    label: string
  ): Promise<LinkWalletResult>;

  /** Build unlinkWallet transaction (soft-delete). */
  buildUnlinkWallet(
    authority: PublicKey | string,
    agentIdOrHash: AgentIdOrHash,
    wallet: PublicKey | string
  ): Promise<TransactionResult>;

  // ─── Mint Tracker ─────────────────────────────────────

  /** Build initMintTracker transaction. */
  buildInitMintTracker(
    authority: PublicKey | string,
    agentIdOrHash: AgentIdOrHash
  ): Promise<MintTrackerResult>;

  /** Build recordMint transaction (max 3 per identity). */
  buildRecordMint(
    authority: PublicKey | string,
    agentIdOrHash: AgentIdOrHash
  ): Promise<TransactionResult>;

  // ─── Attestations ─────────────────────────────────────

  /** Build createAttestation transaction. */
  buildCreateAttestation(
    issuer: PublicKey | string,
    agentId: string,
    attestationType: string,
    proofData: string,
    expiresAt?: number | null
  ): Promise<CreateAttestationResult>;

  /** Build verifyAttestation transaction. */
  buildVerifyAttestation(
    issuer: PublicKey | string,
    attestationPDA: PublicKey | string
  ): Promise<TransactionResult>;

  /** Build revokeAttestation transaction. */
  buildRevokeAttestation(
    issuer: PublicKey | string,
    attestationPDA: PublicKey | string
  ): Promise<TransactionResult>;

  // ─── Reviews ───────────────────────────────────────────

  /** Build initReviewCounter transaction. Must be called once per agent before reviews. */
  buildInitReviewCounter(
    payer: PublicKey | string,
    agentId: string
  ): Promise<InitReviewCounterResult>;

  /**
   * Build createReview transaction (V3.1 with optional self-review prevention).
   * Pass opts.identityProgram + opts.identityAccount to enable self-review check.
   * Omit opts (or pass {}) to skip the check (backwards compatible).
   */
  buildCreateReview(
    reviewer: PublicKey | string,
    agentId: string,
    rating: number,
    reviewText: string,
    metadata?: string,
    opts?: CreateReviewOpts
  ): Promise<CreateReviewResult>;

  /**
   * Build createReview with self-review prevention auto-enabled.
   * Automatically resolves identity PDA from agentId.
   */
  buildCreateReviewWithSelfCheck(
    reviewer: PublicKey | string,
    agentId: string,
    rating: number,
    reviewText: string,
    metadata?: string
  ): Promise<CreateReviewResult>;

  /** Build updateReview transaction (reviewer only). */
  buildUpdateReview(
    reviewer: PublicKey | string,
    reviewPDA: PublicKey | string,
    updates?: UpdateReviewFields
  ): Promise<TransactionResult>;

  /** Build deleteReview transaction (soft-delete, reviewer only). */
  buildDeleteReview(
    reviewer: PublicKey | string,
    reviewPDA: PublicKey | string
  ): Promise<TransactionResult>;

  // ─── Reputation (CPI → Identity) ─────────────────────

  /**
   * Build recomputeReputation transaction (permissionless).
   * Pass review account pubkeys as remaining_accounts for score computation.
   */
  buildRecomputeReputation(
    caller: PublicKey | string,
    agentIdOrHash: AgentIdOrHash,
    reviewAccounts?: (PublicKey | string)[]
  ): Promise<TransactionResult>;

  // ─── Validation (CPI → Identity) ─────────────────────

  /**
   * Build recomputeLevel transaction (permissionless).
   * Pass attestation account pubkeys as remaining_accounts for level computation.
   */
  buildRecomputeLevel(
    caller: PublicKey | string,
    agentIdOrHash: AgentIdOrHash,
    attestationAccounts?: (PublicKey | string)[]
  ): Promise<TransactionResult>;

  // ─── Escrow V3 (Identity-Verified) ───────────────────

  /**
   * Build createEscrow transaction (V3 — identity-verified).
   * Creates an escrow between a client and a verified SATP V3 agent.
   */
  buildCreateEscrow(
    client: PublicKey | string,
    agentWallet: PublicKey | string,
    agentId: string,
    amount: number,
    descriptionOrHash: string | Buffer,
    deadline: number,
    nonce?: number,
    opts?: CreateEscrowOpts
  ): Promise<CreateEscrowResult>;

  /** Build submitWork transaction (agent submits work proof). */
  buildSubmitWork(
    agent: PublicKey | string,
    escrowPDA: PublicKey | string,
    workProofOrHash: string | Buffer
  ): Promise<SubmitWorkResult>;

  /** Build release transaction (client releases full remaining funds). */
  buildEscrowRelease(
    client: PublicKey | string,
    agent: PublicKey | string,
    escrowPDA: PublicKey | string
  ): Promise<TransactionResult>;

  /** Build partialRelease transaction (milestone payment). */
  buildPartialRelease(
    client: PublicKey | string,
    agent: PublicKey | string,
    escrowPDA: PublicKey | string,
    amount: number
  ): Promise<TransactionResult>;

  /** Build cancel transaction (client cancels after deadline). */
  buildCancelEscrow(
    client: PublicKey | string,
    escrowPDA: PublicKey | string
  ): Promise<TransactionResult>;

  /** Build raiseDispute transaction (either client or agent). */
  buildRaiseDispute(
    signer: PublicKey | string,
    escrowPDA: PublicKey | string,
    reasonOrHash: string | Buffer
  ): Promise<RaiseDisputeResult>;

  /** Build resolveDispute transaction (arbiter splits funds). */
  buildResolveDispute(
    arbiter: PublicKey | string,
    agent: PublicKey | string,
    clientWallet: PublicKey | string,
    escrowPDA: PublicKey | string,
    agentAmount: number,
    clientAmount: number
  ): Promise<TransactionResult>;

  /** Build extendDeadline transaction (client extends escrow deadline). */
  buildExtendDeadline(
    client: PublicKey | string,
    escrowPDA: PublicKey | string,
    newDeadline: number
  ): Promise<TransactionResult>;

  /** Build closeEscrow transaction (returns rent to client). */
  buildCloseEscrow(
    client: PublicKey | string,
    escrowPDA: PublicKey | string
  ): Promise<TransactionResult>;

  /** Fetch and deserialize an Escrow V3 account. */
  getEscrow(escrowPDA: PublicKey | string): Promise<V3Escrow | null>;

  /** Derive Escrow V3 PDA without RPC calls. */
  getEscrowPDA(
    client: PublicKey | string,
    descriptionOrHash: string | Buffer,
    nonce?: number
  ): EscrowPDAResult;

  // ─── Read Methods ─────────────────────────────────────

  /** Fetch and deserialize a Genesis Record from on-chain. */
  getGenesisRecord(agentIdOrHash: AgentIdOrHash): Promise<GenesisRecord | null>;

  /** Check if a name is available in the registry. */
  isNameAvailable(name: string): Promise<boolean>;

  /** Check if an agent has a registered identity. */
  hasIdentity(agentId: string): Promise<boolean>;

  /** Fetch and deserialize a Review account. */
  getReview(agentId: string, reviewer: PublicKey | string): Promise<V3Review | null>;

  /** Fetch review counter for an agent. */
  getReviewCount(agentId: string): Promise<V3ReviewCounter | null>;

  // ─── Utility ──────────────────────────────────────────

  /**
   * Derive all V3 PDAs for an agent without RPC calls.
   * @param agentIdOrHash - Agent ID string or pre-computed SHA-256 hash buffer
   */
  getV3PDAs(agentIdOrHash: AgentIdOrHash): V3PDAs;
}
