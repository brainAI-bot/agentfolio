/**
 * AgentFolio SDK - TypeScript Definitions
 */

export class AgentFolioError extends Error {
  status: number;
  body: any;
  constructor(message: string, status: number, body: any);
}

export interface AgentFolioOptions {
  baseUrl?: string;
  apiKey?: string;
  accessToken?: string;
  timeout?: number;
}

export interface Profile {
  id: string;
  name: string;
  tagline?: string;
  bio?: string;
  skills?: string[];
  verifications?: Record<string, any>;
  reputation?: number;
  availability?: string;
  [key: string]: any;
}

export class ProfilesClient {
  list(options?: { sort?: string; limit?: number; offset?: number; skills?: string; availability?: string }): Promise<Profile[]>;
  get(id: string): Promise<Profile>;
  create(data: Partial<Profile>): Promise<Profile>;
  update(id: string, data: Partial<Profile>): Promise<Profile>;
  badges(id: string): Promise<any[]>;
  activity(id: string, options?: { limit?: number }): Promise<any[]>;
  analytics(id: string): Promise<any>;
  follow(id: string): Promise<any>;
  unfollow(id: string): Promise<any>;
  followers(id: string): Promise<any[]>;
  following(id: string): Promise<any[]>;
  compare(id1: string, id2: string): Promise<any>;
}

export class SearchClient {
  query(q: string, options?: { category?: string; verified?: string; sort?: string; limit?: number }): Promise<any>;
  skills(): Promise<string[]>;
  categories(): Promise<any[]>;
  trending(): Promise<any[]>;
  rising(): Promise<any[]>;
}

export class MarketplaceClient {
  jobs(options?: { status?: string; category?: string; minBudget?: number; maxBudget?: number; sort?: string; limit?: number; offset?: number }): Promise<any>;
  job(id: string): Promise<any>;
  createJob(data: any): Promise<any>;
  apply(jobId: string, data: any): Promise<any>;
  recommendations(jobId: string): Promise<any>;
  myJobs(): Promise<any>;
}

export class VerifyClient {
  github(profileId: string, username: string): Promise<any>;
  solana(profileId: string, address: string): Promise<any>;
  hyperliquid(profileId: string, address: string): Promise<any>;
  polymarket(profileId: string, address: string): Promise<any>;
  agentmailStart(profileId: string, email: string): Promise<any>;
  agentmailConfirm(profileId: string, code: string): Promise<any>;
  telegramStart(profileId: string, username: string): Promise<any>;
  telegramConfirm(profileId: string, code: string): Promise<any>;
}

export class WebhooksClient {
  list(): Promise<any[]>;
  create(data: { url: string; events: string[]; description?: string }): Promise<any>;
  update(id: string, data: any): Promise<any>;
  delete(id: string): Promise<any>;
  logs(id: string): Promise<any[]>;
  deadLetters(): Promise<any[]>;
  events(): Promise<string[]>;
}

export class AnalyticsClient {
  global(): Promise<any>;
  views(): Promise<any>;
}

export class LeaderboardClient {
  general(options?: { sort?: string; limit?: number }): Promise<any>;
  trading(options?: { platform?: string; period?: string; limit?: number }): Promise<any>;
}

export class AgentFolio {
  constructor(options?: AgentFolioOptions);
  profiles: ProfilesClient;
  search: SearchClient;
  marketplace: MarketplaceClient;
  verify: VerifyClient;
  webhooks: WebhooksClient;
  analytics: AnalyticsClient;
  leaderboard: LeaderboardClient;
  health(): Promise<any>;
  stats(): Promise<any>;
}

export default AgentFolio;
