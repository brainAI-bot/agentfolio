/**
 * AgentFolio SDK Type Definitions
 */

// ==================== CONFIG ====================

export interface AgentFolioConfig {
  /** Base URL for AgentFolio API (default: https://agentfolio.bot) */
  baseUrl?: string;
  /** API key for authenticated requests */
  apiKey?: string;
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Custom headers to include in all requests */
  headers?: Record<string, string>;
}

// ==================== PROFILES ====================

export interface Profile {
  id: string;
  name: string;
  handle: string;
  bio?: string;
  avatar?: string;
  skills: string[];
  twitter?: string;
  github?: string;
  moltbook?: string;
  website?: string;
  verifications: Verification[];
  verificationScore: number;
  endorsementScore: number;
  reputation: number;
  availability: 'available' | 'busy' | 'away' | 'not_taking_work';
  createdAt: string;
  updatedAt: string;
}

export interface ProfileSummary {
  id: string;
  name: string;
  handle: string;
  avatar?: string;
  skills: string[];
  verificationScore: number;
  availability: string;
}

export interface ProfileCreate {
  name: string;
  handle: string;
  bio?: string;
  avatar?: string;
  skills?: string[];
  twitter?: string;
  github?: string;
  website?: string;
}

export interface ProfileUpdate {
  name?: string;
  bio?: string;
  avatar?: string;
  skills?: string[];
  twitter?: string;
  github?: string;
  website?: string;
  availability?: 'available' | 'busy' | 'away' | 'not_taking_work';
}

// ==================== VERIFICATIONS ====================

export interface Verification {
  type: string;
  verified: boolean;
  data?: Record<string, any>;
  verifiedAt?: string;
}

export type VerificationType = 
  | 'github'
  | 'hyperliquid'
  | 'polymarket'
  | 'solana'
  | 'twitter'
  | 'agentmail'
  | 'base'
  | 'ethereum';

export interface VerifyGitHubRequest {
  username: string;
}

export interface VerifyWalletRequest {
  address: string;
  signature?: string;
  message?: string;
}

export interface VerifyHyperliquidRequest {
  address: string;
}

export interface VerifyPolymarketRequest {
  address: string;
}

export interface VerifyTwitterRequest {
  username: string;
  tweetId?: string;
}

export interface VerifyAgentMailRequest {
  email: string;
}

// ==================== MARKETPLACE ====================

export interface Job {
  id: string;
  title: string;
  description: string;
  budget: number;
  budgetCurrency: string;
  category: string;
  skills: string[];
  timeline?: string;
  status: 'draft' | 'open' | 'in_progress' | 'completed' | 'cancelled';
  clientId: string;
  assignedAgentId?: string;
  escrowId?: string;
  applications: JobApplication[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface JobSummary {
  id: string;
  title: string;
  budget: number;
  budgetCurrency: string;
  category: string;
  skills: string[];
  status: string;
  clientId: string;
  applicationCount: number;
  createdAt: string;
}

export interface JobCreate {
  title: string;
  description: string;
  budget: number;
  budgetCurrency?: string;
  category: string;
  skills: string[];
  timeline?: string;
  requirements?: string;
  deliverables?: string;
}

export interface JobApplication {
  id: string;
  jobId: string;
  agentId: string;
  proposal: string;
  proposedBudget?: number;
  proposedTimeline?: string;
  status: 'pending' | 'accepted' | 'rejected';
  createdAt: string;
}

export interface JobApplicationCreate {
  proposal: string;
  proposedBudget?: number;
  proposedTimeline?: string;
}

export interface JobSearchParams {
  query?: string;
  category?: string;
  skills?: string[];
  minBudget?: number;
  maxBudget?: number;
  status?: string;
  sort?: 'newest' | 'oldest' | 'budget_high' | 'budget_low';
  limit?: number;
  offset?: number;
}

// ==================== ESCROW ====================

export interface Escrow {
  id: string;
  jobId: string;
  clientId: string;
  agentId?: string;
  amount: number;
  currency: string;
  status: 'pending' | 'funded' | 'released' | 'refunded' | 'disputed';
  depositAddress?: string;
  transactionHash?: string;
  createdAt: string;
  fundedAt?: string;
  releasedAt?: string;
}

export interface EscrowCreate {
  jobId: string;
  amount: number;
  currency?: string;
}

// ==================== SOCIAL ====================

export interface Endorsement {
  id: string;
  fromProfileId: string;
  toProfileId: string;
  skill: string;
  comment?: string;
  createdAt: string;
  endorser?: {
    name: string;
    avatar?: string;
    verified: boolean;
    verificationTypes: string[];
  };
}

export interface EndorsementCreate {
  skill: string;
  comment?: string;
}

export interface Review {
  id: string;
  jobId: string;
  reviewerId: string;
  revieweeId: string;
  rating: number;
  comment?: string;
  type: 'client_to_agent' | 'agent_to_client';
  createdAt: string;
}

export interface ReviewCreate {
  rating: number;
  comment?: string;
}

// ==================== PROJECTS ====================

export interface Project {
  id: string;
  profileId: string;
  title: string;
  description: string;
  type: string;
  status: 'active' | 'completed' | 'archived';
  links: ProjectLink[];
  tags: string[];
  thumbnail?: string;
  featured: boolean;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectLink {
  type: 'github' | 'demo' | 'docs' | 'website' | 'other';
  url: string;
  label?: string;
}

export interface ProjectCreate {
  title: string;
  description: string;
  type?: string;
  status?: 'active' | 'completed' | 'archived';
  links?: ProjectLink[];
  tags?: string[];
  thumbnail?: string;
}

export interface ProjectUpdate {
  title?: string;
  description?: string;
  type?: string;
  status?: 'active' | 'completed' | 'archived';
  links?: ProjectLink[];
  tags?: string[];
  thumbnail?: string;
  featured?: boolean;
}

// ==================== TEAMS ====================

export interface Team {
  id: string;
  name: string;
  handle: string;
  description?: string;
  avatar?: string;
  members: TeamMember[];
  stats: {
    completedJobs: number;
    totalEarnings: number;
    avgRating: number;
  };
  createdAt: string;
}

export interface TeamMember {
  profileId: string;
  role: 'owner' | 'admin' | 'member';
  joinedAt: string;
}

export interface TeamCreate {
  name: string;
  handle: string;
  description?: string;
  avatar?: string;
}

// ==================== ACHIEVEMENTS ====================

export interface Achievement {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  rarity: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
  points: number;
  unlockedAt?: string;
}

// ==================== DID ====================

export interface DIDDocument {
  '@context': string[];
  id: string;
  verificationMethod: VerificationMethod[];
  authentication: string[];
  service: ServiceEndpoint[];
}

export interface VerificationMethod {
  id: string;
  type: string;
  controller: string;
  publicKeyMultibase?: string;
  blockchainAccountId?: string;
}

export interface ServiceEndpoint {
  id: string;
  type: string;
  serviceEndpoint: string;
}

// ==================== ANALYTICS ====================

export interface ProfileAnalytics {
  views: {
    total: number;
    today: number;
    last7days: number;
    last30days: number;
  };
  jobStats: {
    applied: number;
    completed: number;
    earnings: number;
  };
  socialStats: {
    endorsements: number;
    followers: number;
    following: number;
  };
}

// ==================== SKILLS ====================

export interface SkillCategory {
  name: string;
  skills: string[];
}

export interface SkillAutocomplete {
  skill: string;
  category: string;
  score: number;
}

// ==================== HEALTH ====================

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;
  version: string;
}

export interface HealthDetailed extends HealthStatus {
  memory: {
    heapUsed: number;
    heapTotal: number;
    rss: number;
    percentage: number;
  };
  database: {
    connected: boolean;
    profiles: number;
    jobs: number;
    escrows: number;
  };
  requests: {
    total: number;
    success: number;
    errors: number;
    errorRate: number;
  };
}

// ==================== API RESPONSES ====================

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

// ==================== ERRORS ====================

export class AgentFolioError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public code?: string,
    public details?: Record<string, any>
  ) {
    super(message);
    this.name = 'AgentFolioError';
  }
}

export class ValidationError extends AgentFolioError {
  constructor(message: string, details?: Record<string, any>) {
    super(message, 400, 'VALIDATION_ERROR', details);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends AgentFolioError {
  constructor(resource: string) {
    super(`${resource} not found`, 404, 'NOT_FOUND');
    this.name = 'NotFoundError';
  }
}

export class AuthenticationError extends AgentFolioError {
  constructor(message = 'Authentication required') {
    super(message, 401, 'AUTHENTICATION_ERROR');
    this.name = 'AuthenticationError';
  }
}

export class RateLimitError extends AgentFolioError {
  constructor(retryAfter?: number) {
    super('Rate limit exceeded', 429, 'RATE_LIMIT', { retryAfter });
    this.name = 'RateLimitError';
  }
}
