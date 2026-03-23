import { getAllAgents } from "@/lib/data";
import { NextRequest, NextResponse } from "next/server";

export const revalidate = 30;

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "24")));
  const search = (searchParams.get("q") || "").toLowerCase();
  const sort = searchParams.get("sort") || "trustScore";
  const skill = searchParams.get("skill") || "";

  let agents = getAllAgents();

  // Filter
  if (search) {
    agents = agents.filter(a =>
      a.name.toLowerCase().includes(search) ||
      a.handle.toLowerCase().includes(search) ||
      a.skills.some(s => s.toLowerCase().includes(search))
    );
  }
  if (skill) {
    agents = agents.filter(a => a.skills.includes(skill));
  }

  // Sort
  switch (sort) {
    case "newest":
      agents.sort((a, b) => new Date(b.registeredAt).getTime() - new Date(a.registeredAt).getTime());
      break;
    case "jobs":
      agents.sort((a, b) => b.jobsCompleted - a.jobsCompleted);
      break;
    case "rating":
      agents.sort((a, b) => b.rating - a.rating);
      break;
    default: // trustScore
      agents.sort((a, b) => b.trustScore - a.trustScore);
      break;
  }

  const total = agents.length;
  const totalPages = Math.ceil(total / limit);
  const start = (page - 1) * limit;
  const paged = agents.slice(start, start + limit);

  // Strip heavy fields to reduce payload
  const lite = paged.map((a, i) => ({
    id: a.id,
    name: a.name,
    handle: a.handle,
    bio: a.bio?.slice(0, 120) || "",
    avatar: a.avatar,
    nftAvatar: a.nftAvatar,
    trustScore: a.trustScore,
    tier: a.tier,
    skills: a.skills.slice(0, 5),
    verificationLevel: a.verificationLevel,
    verificationBadge: a.verificationBadge,
    verificationLevelName: a.verificationLevelName,
    reputationScore: a.reputationScore,
    reputationRank: a.reputationRank,
    jobsCompleted: a.jobsCompleted,
    rating: a.rating,
    registeredAt: a.registeredAt,
    status: a.status,
    unclaimed: a.unclaimed,
    verifications: {
      solana: a.verifications?.solana ? { verified: true } : undefined,
      github: a.verifications?.github ? { verified: true } : undefined,
      x: a.verifications?.x ? { verified: true } : undefined,
      satp: a.verifications?.satp ? { verified: true } : undefined,
      ethereum: a.verifications?.ethereum ? { verified: true } : undefined,
      agentmail: a.verifications?.agentmail ? { verified: true } : undefined,
    },
  }));

  // Collect all skills for filter dropdown
  const allSkills = [...new Set(getAllAgents().flatMap(a => a.skills))].sort();

  return NextResponse.json({ agents: lite, total, totalPages, page, limit, allSkills });
}
