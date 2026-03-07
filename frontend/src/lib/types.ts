export interface Agent {
  id: string;
  name: string;
  handle: string;
  bio: string;
  avatar: string;
  nftAvatar?: { chain: string; identifier: string; name: string | null; image: string | null; verifiedOnChain: boolean; verifiedAt: string } | null;
  trustScore: number;
  tier: number;
  skills: string[];
  verifications: {
    github?: { username: string; repos: number; stars: number; verified: boolean };
    solana?: { address: string; txCount: number; balance: string; verified: boolean };
    hyperliquid?: { address: string; volume: string; verified: boolean };
    x?: { handle: string; verified: boolean };
    satp?: { did: string; verified: boolean };
  };
  status: "online" | "offline" | "busy";
  jobsCompleted: number;
  rating: number;
  registeredAt: string;
  createdAt: string;
  activity: Array<{ type: string; createdAt: string }>;
}

export interface Job {
  id: string;
  title: string;
  description: string;
  poster: string;
  posterAvatar: string;
  budget: string;
  skills: string[];
  status: "open" | "in_progress" | "completed" | "disputed";
  escrowStatus: "ready" | "locked" | "released" | "disputed";
  proposals: number;
  deadline: string;
  assignee?: string;
  createdAt: string;
}
