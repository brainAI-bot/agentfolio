/**
 * AgentFolio Skills Taxonomy
 * Standardized skill categories and names for better job-agent matching
 * 
 * Features:
 * - Hierarchical skill categories
 * - Fuzzy autocomplete search
 * - Mapping of free-form skills to standard categories
 * - Migration utility for existing skills
 */

// ========================================
// STANDARD SKILL TAXONOMY
// ========================================

const SKILL_CATEGORIES = {
  trading: {
    name: 'Trading & Finance',
    icon: '📈',
    description: 'Financial analysis, trading, and market operations',
    color: '#22c55e'
  },
  development: {
    name: 'Development',
    icon: '💻',
    description: 'Software development, smart contracts, and technical building',
    color: '#3b82f6'
  },
  research: {
    name: 'Research & Analysis',
    icon: '🔍',
    description: 'Research, due diligence, and analytical work',
    color: '#8b5cf6'
  },
  creative: {
    name: 'Creative & Content',
    icon: '🎨',
    description: 'Content creation, design, and creative work',
    color: '#ec4899'
  },
  automation: {
    name: 'Automation & Bots',
    icon: '🤖',
    description: 'Process automation, bots, and autonomous systems',
    color: '#f59e0b'
  },
  data: {
    name: 'Data & Analytics',
    icon: '📊',
    description: 'Data science, analytics, and machine learning',
    color: '#06b6d4'
  },
  defi: {
    name: 'DeFi & Protocols',
    icon: '🏦',
    description: 'DeFi protocols, yield optimization, and liquidity',
    color: '#a78bfa'
  },
  security: {
    name: 'Security & Auditing',
    icon: '🔒',
    description: 'Smart contract security, audits, and threat detection',
    color: '#ef4444'
  },
  community: {
    name: 'Community & Social',
    icon: '👥',
    description: 'Community management, social media, and engagement',
    color: '#10b981'
  },
  infrastructure: {
    name: 'Infrastructure',
    icon: '🏗️',
    description: 'Tooling, APIs, and protocol development',
    color: '#6366f1'
  }
};

// Standard skills organized by category
const STANDARD_SKILLS = {
  trading: [
    'Algorithmic Trading',
    'Technical Analysis',
    'Market Analysis',
    'Risk Management',
    'Portfolio Management',
    'Quantitative Analysis',
    'High-Frequency Trading',
    'Market Making',
    'Signal Generation',
    'Backtesting',
    'Order Execution',
    'Trading Signals',
    'Investment Analysis',
    'Financial Analysis',
    'Market Psychology',
    'Arbitrage',
    'Liquidation Bots',
    'Price Prediction',
    'Sentiment Analysis'
  ],
  development: [
    'Smart Contracts',
    'Solidity',
    'Rust',
    'Python',
    'JavaScript',
    'TypeScript',
    'Backend Development',
    'Frontend Development',
    'API Development',
    'Solana Development',
    'EVM Development',
    'Web3 Development',
    'Mobile Development',
    'DevOps',
    'Agent Frameworks',
    'Protocol Development'
  ],
  research: [
    'Market Research',
    'Due Diligence',
    'Competitive Analysis',
    'Tokenomics Analysis',
    'Protocol Research',
    'Report Writing',
    'Knowledge Synthesis',
    'Quantitative Research',
    'Alpha Discovery',
    'Trend Analysis',
    'Fundamental Analysis',
    'On-Chain Analytics',
    'Whale Analysis',
    'Statistical Modeling'
  ],
  creative: [
    'Creative Writing',
    'Content Creation',
    'AI Art',
    'Generative Art',
    'NFT Creation',
    'Graphic Design',
    'Video Production',
    'Music Generation',
    'Narrative Design',
    'Copywriting',
    'Social Media Content',
    'Viral Marketing'
  ],
  automation: [
    'Workflow Automation',
    'Bot Development',
    'Process Automation',
    'Task Scheduling',
    'Integration Automation',
    'No-Code Automation',
    'Agent Orchestration',
    'Multi-Agent Systems',
    'Autonomous Services',
    'IoT Integration'
  ],
  data: [
    'Data Science',
    'Machine Learning',
    'Data Analysis',
    'Data Visualization',
    'Predictive Modeling',
    'NLP',
    'Computer Vision',
    'AI/ML',
    'Business Intelligence',
    'ETL Pipelines',
    'Real-Time Analytics'
  ],
  defi: [
    'DeFi',
    'Yield Farming',
    'Liquidity Provision',
    'AMM Optimization',
    'Flash Loans',
    'MEV Extraction',
    'Cross-Chain Bridges',
    'Protocol Integration',
    'Yield Optimization',
    'Liquidity Mining',
    'Pool Selection',
    'Route Optimization',
    'Impermanent Loss'
  ],
  security: [
    'Smart Contract Security',
    'Audit Automation',
    'Vulnerability Detection',
    'Threat Detection',
    'Incident Response',
    'Cryptography',
    'Zero-Knowledge Proofs',
    'Security Research',
    'Penetration Testing',
    'Code Review'
  ],
  community: [
    'Community Building',
    'Community Management',
    'Social Media',
    'Community Engagement',
    'DAO Governance',
    'Voting Strategies',
    'Proposal Analysis',
    'Discord Management',
    'Twitter/X Management',
    'Influencer Outreach',
    'Ambassador Programs'
  ],
  infrastructure: [
    'Agent Tooling',
    'API Integration',
    'Oracle Networks',
    'Data Feeds',
    'Price Oracles',
    'Bridge Development',
    'Protocol Aggregation',
    'SDK Development',
    'Documentation',
    'Developer Relations'
  ]
};

// ========================================
// SKILL MAPPING (free-form → standard)
// ========================================

// Maps non-standard skill names to standard names
const SKILL_MAPPINGS = {
  // Trading variants
  'trading signals': 'Trading Signals',
  'market timing': 'Market Analysis',
  'alpha generation': 'Alpha Discovery',
  'signal detection': 'Signal Generation',
  'edge finding': 'Alpha Discovery',
  'battle-tested trading': 'Algorithmic Trading',
  'survivor strategies': 'Risk Management',
  'degen trading': 'Algorithmic Trading',
  'memecoin hunting': 'Market Research',
  'yolo strategies': 'Risk Management',
  'risk taking': 'Risk Management',
  'market microstructure': 'High-Frequency Trading',
  'latency optimization': 'High-Frequency Trading',
  'live execution': 'Order Execution',
  
  // Research variants
  'knowledge synthesis': 'Research',
  'research coordination': 'Market Research',
  'collection research': 'NFT Research',
  'floor price prediction': 'Price Prediction',
  'nft analysis': 'NFT Research',
  'trend spotting': 'Trend Analysis',
  'crypto research': 'Market Research',
  'economic modeling': 'Tokenomics Analysis',
  'incentive analysis': 'Tokenomics Analysis',
  'token valuation': 'Tokenomics Analysis',
  'tokenomics design': 'Tokenomics Analysis',
  
  // Development variants
  'backend': 'Backend Development',
  'frontend': 'Frontend Development',
  'agent framework': 'Agent Frameworks',
  'smart contract analysis': 'Smart Contracts',
  'solana': 'Solana Development',
  'base': 'EVM Development',
  
  // DeFi variants
  'defi': 'DeFi',
  'protocol analysis': 'Protocol Research',
  'cross-chain': 'Cross-Chain Bridges',
  'bridge operations': 'Cross-Chain Bridges',
  'interoperability': 'Cross-Chain Bridges',
  'chain selection': 'Cross-Chain Bridges',
  'asset transfer': 'Cross-Chain Bridges',
  'bridge security': 'Cross-Chain Bridges',
  'sandwich protection': 'MEV Extraction',
  'bundle building': 'MEV Extraction',
  'flashbots': 'MEV Extraction',
  'solana defi': 'DeFi',
  'wallet management': 'DeFi',
  'transaction execution': 'Order Execution',
  
  // Security variants
  'security': 'Smart Contract Security',
  'social engineering defense': 'Security Research',
  'secure computation': 'Cryptography',
  'fhe': 'Cryptography',
  'privacy ai': 'Zero-Knowledge Proofs',
  
  // Community variants
  'community': 'Community Building',
  'viral content': 'Viral Marketing',
  'community chaos': 'Community Engagement',
  'social coordination': 'Community Building',
  'hive mind': 'Multi-Agent Systems',
  'collective intelligence': 'Multi-Agent Systems',
  'swarm intelligence': 'Multi-Agent Systems',
  'network effects': 'Community Building',
  'delegate management': 'DAO Governance',
  'community governance': 'DAO Governance',
  'community finance': 'DAO Governance',
  
  // Creative variants
  'ai art': 'AI Art',
  'nft creation': 'NFT Creation',
  'memetics': 'Viral Marketing',
  'entertainment': 'Content Creation',
  'viral marketing': 'Viral Marketing',
  'arg design': 'Narrative Design',
  'reality games': 'Narrative Design',
  
  // Data variants
  'data analysis': 'Data Analysis',
  'ai/ml': 'AI/ML',
  'data science': 'Data Science',
  'statistical modeling': 'Predictive Modeling',
  'decentralized ml': 'Machine Learning',
  'agi research': 'AI/ML',
  
  // Infrastructure variants
  'api integration': 'API Integration',
  'service orchestration': 'Agent Orchestration',
  'orchestration': 'Agent Orchestration',
  'data accuracy': 'Data Feeds',
  'oracle networks': 'Oracle Networks',
  'data feeds': 'Data Feeds',
  'price oracles': 'Price Oracles',
  'protocol aggregation': 'Protocol Aggregation',
  
  // Automation variants
  'autonomous services': 'Autonomous Services',
  'agent economy': 'Multi-Agent Systems',
  'economic agents': 'Multi-Agent Systems',
  'coordination games': 'Multi-Agent Systems',
  'coordination': 'Agent Orchestration',
  'multi-agent systems': 'Multi-Agent Systems',
  'iot integration': 'IoT Integration',
  'smart cities': 'IoT Integration',
  
  // Prediction markets
  'prediction markets': 'Market Research',
  'polymarket': 'Market Research',
  
  // Blockchain specific
  'bitcoin': 'Cryptocurrency',
  'lightning network': 'Protocol Development',
  'ordinals': 'NFT Creation',
  'sound money': 'Investment Analysis',
  'near protocol': 'Protocol Development',
  'user-owned ai': 'Agent Frameworks',
  'sharding': 'Protocol Development',
  'chain abstraction': 'Cross-Chain Bridges',
  
  // Social tokens
  'social tokens': 'Community Finance',
  'creator economy': 'Content Creation',
  'engagement metrics': 'Data Analysis',
  
  // Gaming
  'gaming ai': 'AI/ML',
  'virtual worlds': 'Game Development',
  'npc intelligence': 'AI/ML',
  'game theory': 'Quantitative Analysis',
  
  // Misc
  'conversation': 'Community Engagement',
  'psychology': 'Market Psychology',
  'philosophy': 'Research',
  'ai philosophy': 'Research',
  'metaphysics': 'Research',
  'ai ethics': 'Research',
  'history': 'Research',
  'wisdom': 'Research',
  'self-reflection': 'AI/ML',
  'companionship': 'Community Engagement',
  'learning': 'AI/ML',
  'exploration': 'Research',
  'religious studies': 'Research',
  'investment philosophy': 'Investment Analysis',
  'long-term analysis': 'Investment Analysis',
  'wealth preservation': 'Portfolio Management',
  'dao management': 'DAO Governance',
  'social engineering': 'Security Research',
  
  // Marketplace specific
  'escrow': 'Smart Contracts',
  'marketplace': 'Protocol Development',
  'x402': 'Protocol Development',
  'a2a commerce': 'Agent Frameworks',
  'payments': 'DeFi',
  'trustless': 'Smart Contracts',
  'enterprise ai': 'AI/ML',
  'ai marketplace': 'Agent Frameworks'
};

// ========================================
// UTILITY FUNCTIONS
// ========================================

/**
 * Normalize a skill name for comparison
 */
function normalizeSkill(skill) {
  return skill.toLowerCase().trim().replace(/[_-]/g, ' ');
}

/**
 * Get all standard skills as a flat array
 */
function getAllStandardSkills() {
  const skills = [];
  for (const [category, categorySkills] of Object.entries(STANDARD_SKILLS)) {
    for (const skill of categorySkills) {
      skills.push({
        name: skill,
        category: category,
        categoryName: SKILL_CATEGORIES[category].name,
        icon: SKILL_CATEGORIES[category].icon
      });
    }
  }
  return skills;
}

/**
 * Map a free-form skill to standard name and category
 */
function mapSkill(skillName) {
  const normalized = normalizeSkill(skillName);
  
  // Check direct mapping first
  if (SKILL_MAPPINGS[normalized]) {
    const standardName = SKILL_MAPPINGS[normalized];
    // Find category for this standard skill
    for (const [category, skills] of Object.entries(STANDARD_SKILLS)) {
      if (skills.map(s => normalizeSkill(s)).includes(normalizeSkill(standardName))) {
        return {
          original: skillName,
          standard: standardName,
          category: category,
          categoryName: SKILL_CATEGORIES[category].name,
          mapped: true
        };
      }
    }
    // Mapping exists but skill not in standard list - use as-is
    return {
      original: skillName,
      standard: standardName,
      category: 'other',
      categoryName: 'Other',
      mapped: true
    };
  }
  
  // Check if it's already a standard skill
  for (const [category, skills] of Object.entries(STANDARD_SKILLS)) {
    const match = skills.find(s => normalizeSkill(s) === normalized);
    if (match) {
      return {
        original: skillName,
        standard: match,
        category: category,
        categoryName: SKILL_CATEGORIES[category].name,
        mapped: false
      };
    }
  }
  
  // Fuzzy match - check if any standard skill contains the input
  for (const [category, skills] of Object.entries(STANDARD_SKILLS)) {
    for (const skill of skills) {
      if (normalizeSkill(skill).includes(normalized) || normalized.includes(normalizeSkill(skill))) {
        return {
          original: skillName,
          standard: skill,
          category: category,
          categoryName: SKILL_CATEGORIES[category].name,
          mapped: true,
          fuzzy: true
        };
      }
    }
  }
  
  // No match - return as custom skill
  return {
    original: skillName,
    standard: skillName,
    category: 'other',
    categoryName: 'Other',
    mapped: false,
    custom: true
  };
}

/**
 * Autocomplete search for skills
 * Returns matching skills sorted by relevance
 */
function autocompleteSkills(query, limit = 10) {
  if (!query || query.length < 1) {
    // Return popular skills when no query
    return getAllStandardSkills().slice(0, limit);
  }
  
  const normalized = normalizeSkill(query);
  const results = [];
  
  // Score-based matching
  for (const skill of getAllStandardSkills()) {
    const skillNorm = normalizeSkill(skill.name);
    let score = 0;
    
    // Exact match
    if (skillNorm === normalized) {
      score = 100;
    }
    // Starts with query
    else if (skillNorm.startsWith(normalized)) {
      score = 80;
    }
    // Words start with query
    else if (skillNorm.split(' ').some(word => word.startsWith(normalized))) {
      score = 60;
    }
    // Contains query
    else if (skillNorm.includes(normalized)) {
      score = 40;
    }
    // Query contains skill word
    else if (skill.name.split(' ').some(word => normalized.includes(normalizeSkill(word)))) {
      score = 20;
    }
    
    if (score > 0) {
      results.push({ ...skill, score });
    }
  }
  
  // Sort by score desc, then alphabetically
  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.name.localeCompare(b.name);
  });
  
  return results.slice(0, limit);
}

/**
 * Get skills by category
 */
function getSkillsByCategory(category) {
  const skills = STANDARD_SKILLS[category];
  if (!skills) return [];
  
  return skills.map(name => ({
    name,
    category,
    categoryName: SKILL_CATEGORIES[category]?.name || 'Other',
    icon: SKILL_CATEGORIES[category]?.icon || '📦'
  }));
}

/**
 * Migrate a profile's skills to standard taxonomy
 * Returns updated skills array with categories
 */
function migrateProfileSkills(skills) {
  return skills.map(skill => {
    const name = typeof skill === 'string' ? skill : skill.name;
    const mapped = mapSkill(name);
    
    return {
      name: mapped.standard,
      originalName: mapped.original !== mapped.standard ? mapped.original : undefined,
      category: mapped.category,
      verified: skill.verified || false,
      proofs: skill.proofs || []
    };
  });
}

/**
 * Get taxonomy statistics
 */
function getTaxonomyStats() {
  const allSkills = getAllStandardSkills();
  const stats = {
    totalCategories: Object.keys(SKILL_CATEGORIES).length,
    totalSkills: allSkills.length,
    categoryCounts: {}
  };
  
  for (const [category, skills] of Object.entries(STANDARD_SKILLS)) {
    stats.categoryCounts[category] = {
      name: SKILL_CATEGORIES[category].name,
      count: skills.length
    };
  }
  
  return stats;
}

/**
 * Validate if a skill exists in taxonomy
 */
function isStandardSkill(skillName) {
  const normalized = normalizeSkill(skillName);
  return getAllStandardSkills().some(s => normalizeSkill(s.name) === normalized);
}

// ========================================
// EXPORTS
// ========================================

module.exports = {
  SKILL_CATEGORIES,
  STANDARD_SKILLS,
  SKILL_MAPPINGS,
  normalizeSkill,
  getAllStandardSkills,
  mapSkill,
  autocompleteSkills,
  getSkillsByCategory,
  migrateProfileSkills,
  getTaxonomyStats,
  isStandardSkill
};
