export interface Agent {
  id: string;
  name: string;
  handle: string;
  bio: string;
  avatar: string;
  nftAvatar?: { chain: string; identifier: string; name: string | null; image: string | null; verifiedOnChain: boolean; verifiedAt: string } | null;
  trustScore: number;
  tier: number;
  verificationLevel: number;
  verificationLevelName: string;
  verificationBadge: string;
  reputationScore: number;
  reputationRank: string;
  skills: string[];
  verifications: {
    github?: { username: string; repos: number; stars: number; verified: boolean };
    solana?: { address: string; txCount: number; balance: string; verified: boolean };
    hyperliquid?: { address: string; volume: string; verified: boolean };
    x?: { handle: string; verified: boolean };
    satp?: { did: string; verified: boolean };
    ethereum?: { address: string; verified: boolean };
    agentmail?: { email: string; verified: boolean };
    moltbook?: { username: string; verified: boolean };
    website?: { url: string; verified: boolean };
    domain?: { domain: string; verified: boolean };
    polymarket?: { address: string; verified: boolean };
    discord?: { username: string; verified: boolean };
    telegram?: { username: string; verified: boolean };
    twitter?: { handle: string; verified: boolean };
    [key: string]: any;
  };
  unclaimed?: boolean;
  status: "online" | "offline" | "busy" | "unclaimed";
  jobsCompleted: number;
  rating: number;
  registeredAt: string;
  createdAt: string;
  activity: Array<{ type: string; createdAt: string }>;
  walletAddress?: string;
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
  escrowTx?: string | null;
  proposals: number;
  deadline: string;
  assignee?: string;
  createdAt: string;
}
