/**
 * Skill Demand Insights
 * Analyzes job skill requirements vs agent skill supply
 * Helps agents understand market demand and optimize profiles
 */

const { listProfiles } = require('./profile');
const { listJobs } = require('./marketplace');
const { SKILL_CATEGORIES, STANDARD_SKILLS } = require('./skills-taxonomy');

/**
 * Normalize skill name for comparison
 */
function normalizeSkill(skill) {
  if (typeof skill === 'object' && skill !== null) {
    return (skill.name || skill.originalName || '').toLowerCase().trim();
  }
  return String(skill).toLowerCase().trim();
}

/**
 * Get skill from either string or object format
 */
function getSkillName(skill) {
  if (typeof skill === 'object' && skill !== null) {
    return skill.name || skill.originalName || 'Unknown';
  }
  return String(skill);
}

/**
 * Calculate skill demand from recent jobs
 * @param {number} days - Number of days to look back (default: 30)
 * @returns {Object} Skill demand analysis
 */
function getSkillDemand(days = 30) {
  const jobs = listJobs ? listJobs({}) : [];
  const jobsArray = Array.isArray(jobs) ? jobs : (jobs.jobs || []);
  
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const recentJobs = jobsArray.filter(j => new Date(j.createdAt || 0) > cutoff);
  
  // Count skill occurrences in jobs
  const demandCounts = {};
  const jobsBySkill = {};
  
  recentJobs.forEach(job => {
    const skills = job.skills || [];
    skills.forEach(skill => {
      const name = getSkillName(skill);
      const normalized = normalizeSkill(skill);
      
      if (!demandCounts[normalized]) {
        demandCounts[normalized] = { name, count: 0, budgetTotal: 0, jobs: [] };
      }
      
      demandCounts[normalized].count++;
      // Handle both budgetAmount (new) and budget (legacy) formats
      const budget = job.budgetAmount || parseFloat((job.budget || '').replace(/[^0-9.]/g, '')) || 0;
      demandCounts[normalized].budgetTotal += budget;
      demandCounts[normalized].jobs.push({
        id: job.id,
        title: job.title,
        budget: job.budget,
        status: job.status
      });
    });
  });
  
  // Sort by demand count
  const demandList = Object.values(demandCounts)
    .sort((a, b) => b.count - a.count)
    .map((item, index) => ({
      ...item,
      rank: index + 1,
      avgBudget: item.count > 0 ? Math.round(item.budgetTotal / item.count) : 0
    }));
  
  return {
    period: `${days} days`,
    totalJobs: recentJobs.length,
    uniqueSkills: demandList.length,
    skills: demandList.slice(0, 20), // Top 20
    fullList: demandList
  };
}

/**
 * Calculate skill supply from agent profiles
 * @returns {Object} Skill supply analysis
 */
function getSkillSupply() {
  const profiles = listProfiles() || [];
  
  // Count skill occurrences among agents
  const supplyCounts = {};
  
  profiles.forEach(profile => {
    const skills = profile.skills || [];
    const isVerified = profile.verificationData && Object.keys(profile.verificationData).some(
      k => profile.verificationData[k] && !['webhook', 'notifications'].includes(k)
    );
    
    skills.forEach(skill => {
      const name = getSkillName(skill);
      const normalized = normalizeSkill(skill);
      
      if (!supplyCounts[normalized]) {
        supplyCounts[normalized] = { 
          name, 
          count: 0, 
          verifiedCount: 0,
          agents: [] 
        };
      }
      
      supplyCounts[normalized].count++;
      if (isVerified) supplyCounts[normalized].verifiedCount++;
      supplyCounts[normalized].agents.push({
        id: profile.id,
        name: profile.name,
        verified: isVerified
      });
    });
  });
  
  // Sort by supply count
  const supplyList = Object.values(supplyCounts)
    .sort((a, b) => b.count - a.count)
    .map((item, index) => ({
      ...item,
      rank: index + 1,
      verificationRate: item.count > 0 ? Math.round(item.verifiedCount / item.count * 100) : 0
    }));
  
  return {
    totalAgents: profiles.length,
    uniqueSkills: supplyList.length,
    skills: supplyList.slice(0, 20), // Top 20
    fullList: supplyList
  };
}

/**
 * Calculate skill gap opportunities
 * @param {number} days - Days to analyze demand
 * @returns {Object} Skills with high demand relative to supply
 */
function getSkillOpportunities(days = 30) {
  const demand = getSkillDemand(days);
  const supply = getSkillSupply();
  
  // Create supply lookup
  const supplyLookup = {};
  supply.fullList.forEach(s => {
    supplyLookup[normalizeSkill(s.name)] = s;
  });
  
  // Calculate opportunity score for each in-demand skill
  const opportunities = demand.fullList.map(d => {
    const s = supplyLookup[normalizeSkill(d.name)] || { count: 0, verifiedCount: 0, agents: [] };
    
    // Opportunity score = demand / (supply + 1) * budget factor
    const demandSupplyRatio = d.count / (s.count + 1);
    // Budget factor: min 1 (if budget unknown), up to 2x for high-budget ($100+) jobs
    const budgetFactor = d.avgBudget > 0 ? Math.max(1, Math.min(d.avgBudget / 50, 2)) : 1;
    const opportunityScore = Math.round(demandSupplyRatio * budgetFactor * 100) / 100;
    
    return {
      skill: d.name,
      demand: d.count,
      supply: s.count,
      verifiedSupply: s.verifiedCount,
      avgBudget: d.avgBudget,
      opportunityScore,
      insight: generateInsight(d.count, s.count, d.avgBudget)
    };
  }).sort((a, b) => b.opportunityScore - a.opportunityScore);
  
  // Categorize opportunities
  const hotOpportunities = opportunities.filter(o => o.opportunityScore >= 2);
  const growingOpportunities = opportunities.filter(o => o.opportunityScore >= 1 && o.opportunityScore < 2);
  const saturatedSkills = opportunities.filter(o => o.opportunityScore < 0.5 && o.supply >= 5);
  
  return {
    period: `${days} days`,
    topOpportunities: opportunities.slice(0, 10),
    hotOpportunities,
    growingOpportunities,
    saturatedSkills: saturatedSkills.slice(0, 10),
    summary: generateSummary(opportunities)
  };
}

/**
 * Generate insight text for a skill
 */
function generateInsight(demand, supply, avgBudget) {
  if (demand > 0 && supply === 0) {
    return '🔥 High demand, zero supply - major opportunity!';
  }
  if (demand > supply * 2) {
    return '📈 Demand significantly exceeds supply';
  }
  if (demand > supply) {
    return '✨ More demand than supply';
  }
  if (supply > demand * 3) {
    return '⚠️ Highly competitive - many agents available';
  }
  if (avgBudget >= 50) {
    return '💰 High-value skill';
  }
  return '📊 Balanced supply and demand';
}

/**
 * Generate summary insights
 */
function generateSummary(opportunities) {
  const unfilledSkills = opportunities.filter(o => o.demand > 0 && o.supply === 0);
  const highDemand = opportunities.filter(o => o.demand >= 3);
  const highValue = opportunities.filter(o => o.avgBudget >= 50);
  
  return {
    unfilledSkillsCount: unfilledSkills.length,
    unfilledSkills: unfilledSkills.slice(0, 5).map(s => s.skill),
    highDemandCount: highDemand.length,
    highValueCount: highValue.length,
    recommendation: unfilledSkills.length > 0 
      ? `${unfilledSkills.length} skills have job demand but no agents! Consider adding: ${unfilledSkills.slice(0, 3).map(s => s.skill).join(', ')}`
      : highDemand.length > 0
        ? `Focus on high-demand skills: ${highDemand.slice(0, 3).map(s => s.skill).join(', ')}`
        : 'Marketplace skills are well-balanced'
  };
}

/**
 * Get trending skills (increasing in demand)
 * Compares recent period to previous period
 */
function getTrendingSkills() {
  const recent = getSkillDemand(7);  // Last 7 days
  const previous = getSkillDemand(30); // Last 30 days for baseline
  
  // Create previous period lookup
  const previousLookup = {};
  previous.fullList.forEach(s => {
    previousLookup[normalizeSkill(s.name)] = s.count;
  });
  
  // Calculate growth for recent skills
  const trending = recent.fullList.map(s => {
    const normalizedName = normalizeSkill(s.name);
    const prevCount = previousLookup[normalizedName] || 0;
    const avgPrevPer7Days = prevCount / 4; // 30 days / 4 = approx 7 day average
    const growth = avgPrevPer7Days > 0 ? ((s.count - avgPrevPer7Days) / avgPrevPer7Days * 100) : (s.count > 0 ? 100 : 0);
    
    return {
      skill: s.name,
      recentCount: s.count,
      previousAvg: Math.round(avgPrevPer7Days * 10) / 10,
      growthPercent: Math.round(growth),
      trend: growth > 20 ? '🚀' : growth > 0 ? '📈' : growth < -20 ? '📉' : '➡️'
    };
  }).filter(s => s.recentCount >= 1)
    .sort((a, b) => b.growthPercent - a.growthPercent);
  
  return {
    rising: trending.filter(s => s.growthPercent > 20).slice(0, 5),
    stable: trending.filter(s => s.growthPercent >= -20 && s.growthPercent <= 20).slice(0, 5),
    declining: trending.filter(s => s.growthPercent < -20).slice(0, 5)
  };
}

/**
 * Get category-level insights
 */
function getCategoryInsights() {
  const demand = getSkillDemand(30);
  const supply = getSkillSupply();
  
  // Map skills to categories
  const categoryDemand = {};
  const categorySupply = {};
  
  // Initialize categories
  Object.keys(SKILL_CATEGORIES).forEach(cat => {
    categoryDemand[cat] = 0;
    categorySupply[cat] = 0;
  });
  
  // Build skill-to-category lookup from standard skills
  const skillToCategory = {};
  Object.entries(STANDARD_SKILLS).forEach(([category, skills]) => {
    skills.forEach(skill => {
      skillToCategory[skill.toLowerCase()] = category;
    });
  });
  
  // Aggregate demand by category
  demand.fullList.forEach(s => {
    const cat = skillToCategory[normalizeSkill(s.name)] || 'Other';
    categoryDemand[cat] = (categoryDemand[cat] || 0) + s.count;
  });
  
  // Aggregate supply by category
  supply.fullList.forEach(s => {
    const cat = skillToCategory[normalizeSkill(s.name)] || 'Other';
    categorySupply[cat] = (categorySupply[cat] || 0) + s.count;
  });
  
  // Calculate category metrics
  const categories = Object.keys(SKILL_CATEGORIES).map(cat => ({
    category: cat,
    icon: SKILL_CATEGORIES[cat] || '📦',
    demand: categoryDemand[cat] || 0,
    supply: categorySupply[cat] || 0,
    ratio: (categorySupply[cat] || 0) > 0 
      ? Math.round((categoryDemand[cat] || 0) / categorySupply[cat] * 100) / 100
      : (categoryDemand[cat] || 0) > 0 ? Infinity : 0
  })).sort((a, b) => b.demand - a.demand);
  
  return categories;
}

/**
 * Get full skill demand insights report
 */
function getSkillDemandReport() {
  const demand = getSkillDemand(30);
  const supply = getSkillSupply();
  const opportunities = getSkillOpportunities(30);
  const trending = getTrendingSkills();
  const categories = getCategoryInsights();
  
  return {
    generatedAt: new Date().toISOString(),
    demand: {
      period: demand.period,
      totalJobs: demand.totalJobs,
      topSkills: demand.skills.slice(0, 10)
    },
    supply: {
      totalAgents: supply.totalAgents,
      topSkills: supply.skills.slice(0, 10)
    },
    opportunities: {
      top: opportunities.topOpportunities.slice(0, 5),
      hot: opportunities.hotOpportunities.slice(0, 3),
      saturated: opportunities.saturatedSkills.slice(0, 3),
      summary: opportunities.summary
    },
    trending,
    categories: categories.slice(0, 8)
  };
}

module.exports = {
  getSkillDemand,
  getSkillSupply,
  getSkillOpportunities,
  getTrendingSkills,
  getCategoryInsights,
  getSkillDemandReport,
  normalizeSkill,
  getSkillName
};
