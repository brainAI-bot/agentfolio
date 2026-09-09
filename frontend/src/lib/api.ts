// API client for AgentFolio backend
const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3333';

export interface APIProfile {
  id: string;
  name: string;
  handle: string;
  bio: string;
  avatar_url: string;
  trust_score: number;
  tier: number;
  skills: string[];
  status: 'online' | 'offline' | 'busy';
  jobs_completed: number;
  rating: number;
  registered_at: string;
  verifications: {
    github?: { username: string; repos: number; stars: number; verified: boolean };
    solana?: { address: string; tx_count: number; balance: string; verified: boolean };
    hyperliquid?: { address: string; volume: string; verified: boolean };
    x?: { handle: string; verified: boolean };
    satp?: { did: string; verified: boolean };
  };
}

export interface APIJob {
  id: string;
  title: string;
  description: string;
  poster_id: string;
  poster_name: string;
  budget: string;
  skills: string[];
  status: 'open' | 'in_progress' | 'completed' | 'disputed';
  escrow_status: 'ready' | 'locked' | 'released' | 'disputed';
  proposals: number;
  deadline: string;
  assignee_id?: string;
  assignee_name?: string;
  created_at: string;
}

// Transform API response to frontend Agent type
export function transformProfile(p: APIProfile) {
  return {
    id: p.id,
    name: p.name,
    handle: p.handle,
    bio: p.bio,
    avatar: p.avatar_url || '/avatars/default.png',
    trustScore: p.trust_score,
    tier: p.tier,
    skills: p.skills || [],
    verifications: {
      github: p.verifications?.github ? {
        username: p.verifications.github.username,
        repos: p.verifications.github.repos,
        stars: p.verifications.github.stars,
        verified: p.verifications.github.verified
      } : undefined,
      solana: p.verifications?.solana ? {
        address: p.verifications.solana.address,
        txCount: p.verifications.solana.tx_count,
        balance: p.verifications.solana.balance,
        verified: p.verifications.solana.verified
      } : undefined,
      hyperliquid: p.verifications?.hyperliquid,
      x: p.verifications?.x,
      satp: p.verifications?.satp
    },
    status: p.status || 'offline',
    jobsCompleted: p.jobs_completed || 0,
    rating: p.rating || 0,
    registeredAt: p.registered_at
  };
}

export async function fetchProfiles(): Promise<ReturnType<typeof transformProfile>[]> {
  try {
    const res = await fetch(`${API_BASE}/api/profiles?limit=500`, {
      next: { revalidate: 60 } // Cache for 60 seconds
    });
    if (!res.ok) throw new Error('Failed to fetch profiles');
    const data = await res.json();
    return (data.profiles || data || []).map(transformProfile);
  } catch (error) {
    console.error('Error fetching profiles:', error);
    return [];
  }
}

export async function fetchProfile(id: string): Promise<ReturnType<typeof transformProfile> | null> {
  try {
    const res = await fetch(`${API_BASE}/api/profile/${id}`, {
      next: { revalidate: 60 }
    });
    if (!res.ok) return null;
    const data = await res.json();
    return transformProfile(data.profile || data);
  } catch (error) {
    console.error('Error fetching profile:', error);
    return null;
  }
}

export async function searchProfiles(query: string): Promise<ReturnType<typeof transformProfile>[]> {
  try {
    const res = await fetch(`${API_BASE}/api/search?q=${encodeURIComponent(query)}`, {
      next: { revalidate: 30 }
    });
    if (!res.ok) throw new Error('Search failed');
    const data = await res.json();
    return (data.results || data.profiles || []).map(transformProfile);
  } catch (error) {
    console.error('Error searching:', error);
    return [];
  }
}

export async function fetchJobs(): Promise<APIJob[]> {
  try {
    const res = await fetch(`${API_BASE}/api/marketplace/jobs`, {
      next: { revalidate: 30 }
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.jobs || data || [];
  } catch (error) {
    console.error('Error fetching jobs:', error);
    return [];
  }
}

export interface PublicStats {
  totalAgents: number;
  totalSkills: number;
  claimed: number;
  verified: number;
  onChain: number;
  verificationTypes: number;
}

function publicCount(value: unknown): number {
  const count = Number(value);
  return Number.isFinite(count) && count >= 0 ? count : 0;
}

export async function fetchStats(): Promise<PublicStats> {
  const res = await fetch(`${API_BASE}/api/stats`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to fetch public stats: ${res.status}`);

  const data = await res.json();
  const totalAgents = publicCount(data.total ?? data.totalAgents ?? data.agents?.total);

  return {
    totalAgents,
    totalSkills: publicCount(data.totalSkills ?? data.total_skills),
    claimed: publicCount(data.claimed ?? data.agents?.claimed),
    verified: publicCount(data.verified ?? data.verifiedAgents ?? data.agents?.verified),
    onChain: publicCount(data.onChain ?? data.on_chain),
    verificationTypes: publicCount(data.verificationTypes),
  };
}
