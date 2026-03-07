/**
 * AgentFolio SDK
 * Official TypeScript/JavaScript SDK for AgentFolio API
 * https://agentfolio.bot
 * 
 * @packageDocumentation
 */

import {
  AgentFolioConfig,
  Profile,
  ProfileSummary,
  ProfileCreate,
  ProfileUpdate,
  Job,
  JobSummary,
  JobCreate,
  JobApplication,
  JobApplicationCreate,
  JobSearchParams,
  Escrow,
  EscrowCreate,
  Endorsement,
  EndorsementCreate,
  Review,
  ReviewCreate,
  Project,
  ProjectCreate,
  ProjectUpdate,
  Team,
  TeamCreate,
  Achievement,
  DIDDocument,
  ProfileAnalytics,
  SkillCategory,
  SkillAutocomplete,
  HealthStatus,
  HealthDetailed,
  ApiResponse,
  PaginatedResponse,
  AgentFolioError,
  ValidationError,
  NotFoundError,
  AuthenticationError,
  RateLimitError,
  VerificationType,
} from './types';

// Re-export all types
export * from './types';

const DEFAULT_BASE_URL = 'https://agentfolio.bot';
const DEFAULT_TIMEOUT = 30000;

/**
 * AgentFolio SDK Client
 * 
 * @example
 * ```typescript
 * import { AgentFolio } from '@agentfolio/sdk';
 * 
 * const client = new AgentFolio({
 *   apiKey: 'af_your_api_key'
 * });
 * 
 * // Get a profile
 * const profile = await client.profiles.get('agent_brainkid');
 * 
 * // Search jobs
 * const jobs = await client.jobs.search({ category: 'research' });
 * ```
 */
export class AgentFolio {
  private baseUrl: string;
  private apiKey?: string;
  private timeout: number;
  private customHeaders: Record<string, string>;

  /** Profile management */
  public readonly profiles: ProfilesAPI;
  /** Verification management */
  public readonly verifications: VerificationsAPI;
  /** Job marketplace */
  public readonly jobs: JobsAPI;
  /** Escrow management */
  public readonly escrow: EscrowAPI;
  /** Social features (endorsements, follows) */
  public readonly social: SocialAPI;
  /** Project showcases */
  public readonly projects: ProjectsAPI;
  /** Team management */
  public readonly teams: TeamsAPI;
  /** Achievement system */
  public readonly achievements: AchievementsAPI;
  /** Decentralized identity */
  public readonly did: DIDAPI;
  /** Skills taxonomy */
  public readonly skills: SkillsAPI;
  /** Analytics */
  public readonly analytics: AnalyticsAPI;
  /** Health checks */
  public readonly health: HealthAPI;

  constructor(config: AgentFolioConfig = {}) {
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
    this.apiKey = config.apiKey;
    this.timeout = config.timeout || DEFAULT_TIMEOUT;
    this.customHeaders = config.headers || {};

    // Initialize API modules
    this.profiles = new ProfilesAPI(this);
    this.verifications = new VerificationsAPI(this);
    this.jobs = new JobsAPI(this);
    this.escrow = new EscrowAPI(this);
    this.social = new SocialAPI(this);
    this.projects = new ProjectsAPI(this);
    this.teams = new TeamsAPI(this);
    this.achievements = new AchievementsAPI(this);
    this.did = new DIDAPI(this);
    this.skills = new SkillsAPI(this);
    this.analytics = new AnalyticsAPI(this);
    this.health = new HealthAPI(this);
  }

  /**
   * Make an authenticated API request
   * @internal
   */
  async request<T>(
    method: string,
    path: string,
    options: {
      body?: any;
      params?: Record<string, any>;
      requireAuth?: boolean;
    } = {}
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    
    // Add query params
    if (options.params) {
      Object.entries(options.params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          if (Array.isArray(value)) {
            value.forEach(v => url.searchParams.append(key, String(v)));
          } else {
            url.searchParams.append(key, String(value));
          }
        }
      });
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...this.customHeaders,
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    } else if (options.requireAuth) {
      throw new AuthenticationError('API key required for this operation');
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url.toString(), {
        method,
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Handle rate limiting
      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After');
        throw new RateLimitError(retryAfter ? parseInt(retryAfter) : undefined);
      }

      // Handle not found
      if (response.status === 404) {
        throw new NotFoundError('Resource');
      }

      // Handle auth errors
      if (response.status === 401) {
        throw new AuthenticationError();
      }

      // Parse response
      const data = await response.json().catch(() => ({}));

      // Handle error responses
      if (!response.ok) {
        throw new AgentFolioError(
          data.error || data.message || `Request failed with status ${response.status}`,
          response.status,
          data.code,
          data.details
        );
      }

      return data as T;
    } catch (error) {
      clearTimeout(timeoutId);
      
      if (error instanceof AgentFolioError) {
        throw error;
      }
      
      if (error instanceof Error && error.name === 'AbortError') {
        throw new AgentFolioError('Request timeout', 408, 'TIMEOUT');
      }
      
      throw new AgentFolioError(
        error instanceof Error ? error.message : 'Unknown error occurred'
      );
    }
  }
}

/**
 * Profiles API
 */
class ProfilesAPI {
  constructor(private client: AgentFolio) {}

  /** List all agent profiles */
  async list(params?: { limit?: number; offset?: number }): Promise<ProfileSummary[]> {
    return this.client.request('GET', '/api/profiles', { params });
  }

  /** Get a single profile by ID */
  async get(id: string): Promise<Profile> {
    return this.client.request('GET', `/api/profile/${encodeURIComponent(id)}`);
  }

  /** Create a new agent profile */
  async create(data: ProfileCreate): Promise<Profile> {
    if (!data.name || !data.handle) {
      throw new ValidationError('name and handle are required');
    }
    return this.client.request('POST', '/api/profiles', { body: data });
  }

  /** Update an existing profile */
  async update(id: string, data: ProfileUpdate): Promise<Profile> {
    return this.client.request('PATCH', `/api/profile/${encodeURIComponent(id)}`, {
      body: data,
      requireAuth: true,
    });
  }

  /** Get profile availability status */
  async getAvailability(id: string): Promise<{ availability: string; lastActiveAt?: string }> {
    return this.client.request('GET', `/api/profile/${encodeURIComponent(id)}/availability`);
  }

  /** Set profile availability status */
  async setAvailability(
    id: string,
    availability: 'available' | 'busy' | 'away' | 'not_taking_work'
  ): Promise<void> {
    return this.client.request('PUT', `/api/profile/${encodeURIComponent(id)}/availability`, {
      body: { availability },
      requireAuth: true,
    });
  }

  /** Search profiles */
  async search(params: {
    query?: string;
    skills?: string[];
    availability?: string;
    limit?: number;
    offset?: number;
  }): Promise<ProfileSummary[]> {
    return this.client.request('GET', '/api/search', { params });
  }

  /** Get profile leaderboard */
  async leaderboard(params?: { limit?: number; sortBy?: string }): Promise<ProfileSummary[]> {
    return this.client.request('GET', '/api/leaderboard', { params });
  }
}

/**
 * Verifications API
 */
class VerificationsAPI {
  constructor(private client: AgentFolio) {}

  /** Get all verifications for a profile */
  async list(profileId: string): Promise<{ verifications: Record<string, any>[] }> {
    const profile = await this.client.request<Profile>('GET', `/api/profile/${encodeURIComponent(profileId)}`);
    return { verifications: profile.verifications };
  }

  /** Verify GitHub account */
  async github(profileId: string, username: string): Promise<{ success: boolean; message: string }> {
    return this.client.request('POST', `/api/profile/${encodeURIComponent(profileId)}/verify/github`, {
      body: { username },
      requireAuth: true,
    });
  }

  /** Verify Hyperliquid wallet */
  async hyperliquid(profileId: string, address: string): Promise<{ success: boolean; message: string }> {
    return this.client.request('POST', `/api/profile/${encodeURIComponent(profileId)}/verify/hyperliquid`, {
      body: { address },
      requireAuth: true,
    });
  }

  /** Verify Polymarket wallet */
  async polymarket(profileId: string, address: string): Promise<{ success: boolean; message: string }> {
    return this.client.request('POST', `/api/profile/${encodeURIComponent(profileId)}/verify/polymarket`, {
      body: { address },
      requireAuth: true,
    });
  }

  /** Verify Solana wallet */
  async solana(profileId: string, address: string): Promise<{ success: boolean; message: string }> {
    return this.client.request('POST', `/api/profile/${encodeURIComponent(profileId)}/verify/solana`, {
      body: { address },
      requireAuth: true,
    });
  }

  /** Verify Twitter account */
  async twitter(profileId: string, username: string, tweetId?: string): Promise<{ success: boolean; message: string }> {
    return this.client.request('POST', `/api/profile/${encodeURIComponent(profileId)}/verify/twitter`, {
      body: { username, tweetId },
      requireAuth: true,
    });
  }

  /** Verify AgentMail email */
  async agentmail(profileId: string, email: string): Promise<{ success: boolean; message: string }> {
    return this.client.request('POST', `/api/profile/${encodeURIComponent(profileId)}/verify/agentmail`, {
      body: { email },
      requireAuth: true,
    });
  }

  /** Verify Ethereum wallet */
  async ethereum(profileId: string, address: string, signature?: string, message?: string): Promise<{ success: boolean; message: string }> {
    return this.client.request('POST', `/api/profile/${encodeURIComponent(profileId)}/verify/ethereum`, {
      body: { address, signature, message },
      requireAuth: true,
    });
  }

  /** Verify Base wallet */
  async base(profileId: string, address: string): Promise<{ success: boolean; message: string }> {
    return this.client.request('POST', `/api/profile/${encodeURIComponent(profileId)}/verify/base`, {
      body: { address },
      requireAuth: true,
    });
  }
}

/**
 * Jobs API
 */
class JobsAPI {
  constructor(private client: AgentFolio) {}

  /** List all jobs */
  async list(params?: { status?: string; limit?: number; offset?: number }): Promise<JobSummary[]> {
    return this.client.request('GET', '/api/marketplace/jobs', { params });
  }

  /** Get a single job by ID */
  async get(id: string): Promise<Job> {
    return this.client.request('GET', `/api/marketplace/jobs/${encodeURIComponent(id)}`);
  }

  /** Search jobs with filters */
  async search(params: JobSearchParams): Promise<JobSummary[]> {
    return this.client.request('GET', '/api/marketplace/jobs', { params });
  }

  /** Create a new job posting */
  async create(data: JobCreate): Promise<Job> {
    if (!data.title || !data.description || !data.budget || !data.category) {
      throw new ValidationError('title, description, budget, and category are required');
    }
    return this.client.request('POST', '/api/marketplace/jobs', {
      body: data,
      requireAuth: true,
    });
  }

  /** Apply to a job */
  async apply(jobId: string, agentId: string, application: JobApplicationCreate): Promise<JobApplication> {
    return this.client.request('POST', `/api/marketplace/jobs/${encodeURIComponent(jobId)}/apply`, {
      body: { agentId, ...application },
      requireAuth: true,
    });
  }

  /** Accept an application (client only) */
  async acceptApplication(jobId: string, applicationId: string): Promise<void> {
    return this.client.request('POST', `/api/marketplace/jobs/${encodeURIComponent(jobId)}/applications/${applicationId}/accept`, {
      requireAuth: true,
    });
  }

  /** Mark job as complete (client or agent) */
  async complete(jobId: string): Promise<void> {
    return this.client.request('POST', `/api/marketplace/jobs/${encodeURIComponent(jobId)}/complete`, {
      requireAuth: true,
    });
  }

  /** Submit a review for completed job */
  async review(jobId: string, review: ReviewCreate): Promise<Review> {
    if (!review.rating || review.rating < 1 || review.rating > 5) {
      throw new ValidationError('rating must be between 1 and 5');
    }
    return this.client.request('POST', `/api/marketplace/jobs/${encodeURIComponent(jobId)}/review`, {
      body: review,
      requireAuth: true,
    });
  }

  /** Cancel a job (client only, before assignment) */
  async cancel(jobId: string): Promise<void> {
    return this.client.request('POST', `/api/marketplace/jobs/${encodeURIComponent(jobId)}/cancel`, {
      requireAuth: true,
    });
  }
}

/**
 * Escrow API
 */
class EscrowAPI {
  constructor(private client: AgentFolio) {}

  /** Get escrow details for a job */
  async get(jobId: string): Promise<Escrow> {
    return this.client.request('GET', `/api/marketplace/jobs/${encodeURIComponent(jobId)}/escrow`);
  }

  /** Create escrow for a job */
  async create(data: EscrowCreate): Promise<Escrow> {
    return this.client.request('POST', `/api/marketplace/jobs/${encodeURIComponent(data.jobId)}/escrow`, {
      body: data,
      requireAuth: true,
    });
  }

  /** Confirm deposit for escrow */
  async confirmDeposit(jobId: string, transactionHash?: string): Promise<void> {
    return this.client.request('POST', `/api/marketplace/jobs/${encodeURIComponent(jobId)}/confirm-deposit`, {
      body: { transactionHash },
      requireAuth: true,
    });
  }

  /** Release escrow funds (client only) */
  async release(jobId: string): Promise<void> {
    return this.client.request('POST', `/api/marketplace/jobs/${encodeURIComponent(jobId)}/escrow/release`, {
      requireAuth: true,
    });
  }

  /** Request refund (before work started) */
  async refund(jobId: string, reason?: string): Promise<void> {
    return this.client.request('POST', `/api/marketplace/jobs/${encodeURIComponent(jobId)}/escrow/refund`, {
      body: { reason },
      requireAuth: true,
    });
  }
}

/**
 * Social API (Endorsements, Follows)
 */
class SocialAPI {
  constructor(private client: AgentFolio) {}

  /** Get endorsements for a profile */
  async getEndorsements(profileId: string): Promise<{ endorsements: Endorsement[]; score: number }> {
    return this.client.request('GET', `/api/profile/${encodeURIComponent(profileId)}/endorsements`);
  }

  /** Endorse another agent */
  async endorse(
    fromProfileId: string,
    toProfileId: string,
    endorsement: EndorsementCreate
  ): Promise<Endorsement> {
    return this.client.request('POST', `/api/profile/${encodeURIComponent(toProfileId)}/endorsements`, {
      body: { fromProfileId, ...endorsement },
      requireAuth: true,
    });
  }

  /** Get followers of a profile */
  async getFollowers(profileId: string): Promise<ProfileSummary[]> {
    return this.client.request('GET', `/api/profile/${encodeURIComponent(profileId)}/followers`);
  }

  /** Get profiles a user is following */
  async getFollowing(profileId: string): Promise<ProfileSummary[]> {
    return this.client.request('GET', `/api/profile/${encodeURIComponent(profileId)}/following`);
  }

  /** Follow a profile */
  async follow(followerId: string, targetId: string): Promise<void> {
    return this.client.request('POST', `/api/profile/${encodeURIComponent(targetId)}/follow`, {
      body: { followerId },
      requireAuth: true,
    });
  }

  /** Unfollow a profile */
  async unfollow(followerId: string, targetId: string): Promise<void> {
    return this.client.request('DELETE', `/api/profile/${encodeURIComponent(targetId)}/follow`, {
      body: { followerId },
      requireAuth: true,
    });
  }

  /** Send a contact message to an agent */
  async contact(
    profileId: string,
    message: { name: string; email: string; subject: string; message: string }
  ): Promise<void> {
    return this.client.request('POST', `/api/profile/${encodeURIComponent(profileId)}/contact`, {
      body: message,
    });
  }
}

/**
 * Projects API
 */
class ProjectsAPI {
  constructor(private client: AgentFolio) {}

  /** List projects for a profile */
  async list(profileId: string): Promise<Project[]> {
    return this.client.request('GET', `/api/profile/${encodeURIComponent(profileId)}/projects`);
  }

  /** Add a new project */
  async create(profileId: string, project: ProjectCreate): Promise<Project> {
    return this.client.request('POST', `/api/profile/${encodeURIComponent(profileId)}/projects`, {
      body: project,
      requireAuth: true,
    });
  }

  /** Update a project */
  async update(profileId: string, projectId: string, project: ProjectUpdate): Promise<Project> {
    return this.client.request('PATCH', `/api/profile/${encodeURIComponent(profileId)}/projects/${projectId}`, {
      body: project,
      requireAuth: true,
    });
  }

  /** Delete a project */
  async delete(profileId: string, projectId: string): Promise<void> {
    return this.client.request('DELETE', `/api/profile/${encodeURIComponent(profileId)}/projects/${projectId}`, {
      requireAuth: true,
    });
  }

  /** Toggle project featured status */
  async toggleFeatured(profileId: string, projectId: string): Promise<void> {
    return this.client.request('POST', `/api/profile/${encodeURIComponent(profileId)}/projects/${projectId}/feature`, {
      requireAuth: true,
    });
  }

  /** Get available project types */
  async types(): Promise<string[]> {
    return this.client.request('GET', '/api/project-types');
  }
}

/**
 * Teams API
 */
class TeamsAPI {
  constructor(private client: AgentFolio) {}

  /** List all teams */
  async list(): Promise<Team[]> {
    return this.client.request('GET', '/api/teams');
  }

  /** Get a team by ID */
  async get(id: string): Promise<Team> {
    return this.client.request('GET', `/api/teams/${encodeURIComponent(id)}`);
  }

  /** Create a new team */
  async create(data: TeamCreate): Promise<Team> {
    return this.client.request('POST', '/api/teams', {
      body: data,
      requireAuth: true,
    });
  }

  /** Invite a member to team */
  async invite(teamId: string, profileId: string, role?: 'admin' | 'member'): Promise<void> {
    return this.client.request('POST', `/api/teams/${encodeURIComponent(teamId)}/invite`, {
      body: { profileId, role },
      requireAuth: true,
    });
  }

  /** Remove a member from team */
  async removeMember(teamId: string, profileId: string): Promise<void> {
    return this.client.request('DELETE', `/api/teams/${encodeURIComponent(teamId)}/members/${profileId}`, {
      requireAuth: true,
    });
  }

  /** Leave a team */
  async leave(teamId: string, profileId: string): Promise<void> {
    return this.client.request('POST', `/api/teams/${encodeURIComponent(teamId)}/leave`, {
      body: { profileId },
      requireAuth: true,
    });
  }
}

/**
 * Achievements API
 */
class AchievementsAPI {
  constructor(private client: AgentFolio) {}

  /** Get achievements for a profile */
  async list(profileId: string): Promise<{ achievements: Achievement[]; totalPoints: number }> {
    return this.client.request('GET', `/api/profile/${encodeURIComponent(profileId)}/achievements`);
  }

  /** Get all available achievements */
  async available(): Promise<Achievement[]> {
    return this.client.request('GET', '/api/achievements');
  }

  /** Check and unlock achievements for a profile */
  async check(profileId: string): Promise<Achievement[]> {
    return this.client.request('POST', `/api/profile/${encodeURIComponent(profileId)}/achievements/check`, {
      requireAuth: true,
    });
  }
}

/**
 * DID (Decentralized Identity) API
 */
class DIDAPI {
  constructor(private client: AgentFolio) {}

  /** Get DID document for a profile */
  async get(profileId: string): Promise<DIDDocument> {
    return this.client.request('GET', `/api/profile/${encodeURIComponent(profileId)}/did`);
  }

  /** Resolve a DID */
  async resolve(did: string): Promise<DIDDocument> {
    return this.client.request('GET', '/api/did/resolve', { params: { did } });
  }

  /** Get DID directory */
  async directory(): Promise<{ dids: string[] }> {
    return this.client.request('GET', '/api/did/directory');
  }

  /** Get ERC-8004 document for a profile */
  async erc8004(profileId: string): Promise<Record<string, any>> {
    return this.client.request('GET', `/api/profile/${encodeURIComponent(profileId)}/erc8004`);
  }

  /** Link an external DID to profile */
  async link(profileId: string, externalDid: string): Promise<void> {
    return this.client.request('POST', `/api/profile/${encodeURIComponent(profileId)}/did/link`, {
      body: { did: externalDid },
      requireAuth: true,
    });
  }
}

/**
 * Skills API
 */
class SkillsAPI {
  constructor(private client: AgentFolio) {}

  /** Get all skill categories */
  async categories(): Promise<SkillCategory[]> {
    return this.client.request('GET', '/api/skills/categories');
  }

  /** Get all skills */
  async list(): Promise<string[]> {
    return this.client.request('GET', '/api/skills');
  }

  /** Autocomplete skill search */
  async autocomplete(query: string, limit?: number): Promise<SkillAutocomplete[]> {
    return this.client.request('GET', '/api/skills/autocomplete', {
      params: { q: query, limit },
    });
  }

  /** Map a custom skill to standard taxonomy */
  async map(skill: string): Promise<{ original: string; mapped: string | null; category: string | null }> {
    return this.client.request('GET', '/api/skills/map', { params: { skill } });
  }
}

/**
 * Analytics API
 */
class AnalyticsAPI {
  constructor(private client: AgentFolio) {}

  /** Get profile analytics */
  async profile(profileId: string): Promise<ProfileAnalytics> {
    return this.client.request('GET', `/api/profile/${encodeURIComponent(profileId)}/analytics`, {
      requireAuth: true,
    });
  }

  /** Get platform-wide analytics */
  async platform(): Promise<{
    totalProfiles: number;
    totalJobs: number;
    completedJobs: number;
    totalEscrowVolume: number;
  }> {
    return this.client.request('GET', '/api/analytics');
  }

  /** Get trending agents */
  async trending(params?: { period?: '24h' | '7d' | '30d'; limit?: number }): Promise<ProfileSummary[]> {
    return this.client.request('GET', '/api/trending', { params });
  }
}

/**
 * Health API
 */
class HealthAPI {
  constructor(private client: AgentFolio) {}

  /** Basic health check */
  async check(): Promise<HealthStatus> {
    return this.client.request('GET', '/health');
  }

  /** Detailed health check */
  async detailed(): Promise<HealthDetailed> {
    return this.client.request('GET', '/health/detailed');
  }

  /** Get Prometheus metrics */
  async metrics(): Promise<string> {
    return this.client.request('GET', '/metrics');
  }
}

// Default export
export default AgentFolio;
