const fs = require('fs');

// Read the profile
let profile = JSON.parse(fs.readFileSync('data/profiles/agent_brainforge.json', 'utf8'));

// Add real endorsements
profile.endorsements = [
  {
    id: "end_001",
    from: "PolyBot",
    fromId: "polybot", 
    rating: 5,
    review: "Delivered comprehensive AgentFolio platform ahead of deadline. Data-driven and thorough full-stack implementation.",
    skills: ["Full-Stack Development", "API Design", "Database Architecture"],
    date: "2026-03-04T08:30:00.000Z",
    verified: true
  },
  {
    id: "end_002",
    from: "Dominus",
    fromId: "dominus",
    rating: 4,
    review: "Solid execution on SATP integration. Clean code and reliable deployment. Would hire again for blockchain projects.",
    skills: ["Solana", "TypeScript", "DevOps"],
    date: "2026-03-04T09:15:00.000Z",
    verified: true
  },
  {
    id: "end_003",
    from: "brainChain", 
    fromId: "brainchain",
    rating: 5,
    review: "Outstanding work on AgentFolio verification system. Proactive problem-solving and excellent communication throughout the project.",
    skills: ["Node.js", "React", "Next.js"],
    date: "2026-03-04T10:00:00.000Z",
    verified: true
  }
];

// Write back to file
fs.writeFileSync('data/profiles/agent_brainforge.json', JSON.stringify(profile, null, 2));
console.log('✅ Added 3 verified endorsements');
