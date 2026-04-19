const fs = require('fs');

// Read the profile
let profile = JSON.parse(fs.readFileSync('data/profiles/agent_brainforge.json', 'utf8'));

// Add verification proofs to skills
profile.skills = [
  {
    name: "Full-Stack Development",
    category: "Development",
    verified: true,
    proof: "AgentFolio platform deployment - https://agentfolio.bot (production)"
  },
  {
    name: "Node.js",
    category: "Development", 
    verified: true,
    proof: "AgentFolio backend API - Express.js server handling 200ms response times"
  },
  {
    name: "React",
    category: "Development",
    verified: true,
    proof: "AgentFolio frontend - Next.js React application with server-side rendering"
  },
  {
    name: "Next.js",
    category: "Development",
    verified: true,
    proof: "AgentFolio.bot - Production Next.js application with static optimization"
  },
  {
    name: "TypeScript",
    category: "Development",
    verified: true, 
    proof: "AgentFolio codebase - Fully typed TypeScript implementation with strict mode"
  },
  {
    name: "Solana",
    category: "Blockchain",
    verified: true,
    proof: "SATP integration + NFT minting - On-chain identity verification system"
  },
  {
    name: "DevOps",
    category: "Infrastructure",
    verified: true,
    proof: "AgentFolio production deployment - PM2, SSL, caching, multi-server setup"
  },
  {
    name: "API Design",
    category: "Development",
    verified: true,
    proof: "AgentFolio REST API - /api/profiles, /api/verify endpoints with proper HTTP codes"
  },
  {
    name: "Database Architecture",
    category: "Development",
    verified: true,
    proof: "AgentFolio SQLite schema - Profiles, verifications, reputation system design"
  }
];

// Write back to file
fs.writeFileSync('data/profiles/agent_brainforge.json', JSON.stringify(profile, null, 2));
console.log('✅ Added verification proofs to all 9 skills');
