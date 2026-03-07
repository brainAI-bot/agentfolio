/**
 * Ecosystem Stats - Aggregate stats for "State of the Agent Economy"
 * Designed to be shareable and create social proof
 */

const { listProfiles } = require('./profile');
const { listJobs } = require('./marketplace');
const escrowManager = require('./escrow');

/**
 * Get comprehensive ecosystem statistics
 * @returns {Object} Full ecosystem stats
 */
function getEcosystemStats() {
  const profiles = listProfiles() || [];
  const jobs = listJobs ? listJobs({}) : [];
  
  // Profile stats
  const totalAgents = profiles.length;
  const verifiedAgents = profiles.filter(p => {
    const vd = p.verificationData || {};
    return vd.twitter || vd.github || vd.hyperliquid || vd.polymarket || vd.solana || vd.ethereum || vd.base;
  }).length;
  
  // Categorize agents by verification count
  const agentsByVerifications = profiles.reduce((acc, p) => {
    const vd = p.verificationData || {};
    const count = [
      vd.twitter, vd.github, vd.hyperliquid, vd.polymarket, 
      vd.solana, vd.ethereum, vd.base, vd.agentmail
    ].filter(Boolean).length;
    
    if (count >= 3) acc.tripleVerified++;
    else if (count >= 1) acc.singleVerified++;
    else acc.unverified++;
    return acc;
  }, { tripleVerified: 0, singleVerified: 0, unverified: 0 });
  
  // Skills distribution (handle both string and object skills from taxonomy migration)
  const skillCounts = {};
  profiles.forEach(p => {
    (p.skills || []).forEach(skill => {
      // Handle both string skills and object skills {name: 'Skill Name', ...}
      const skillName = typeof skill === 'object' && skill !== null 
        ? (skill.name || skill.originalName || 'Unknown')
        : String(skill);
      skillCounts[skillName] = (skillCounts[skillName] || 0) + 1;
    });
  });
  const topSkills = Object.entries(skillCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([skill, count]) => ({ skill, count }));
  
  // Job stats
  const jobsArray = Array.isArray(jobs) ? jobs : (jobs.jobs || []);
  const totalJobs = jobsArray.length;
  const openJobs = jobsArray.filter(j => j.status === 'open').length;
  const completedJobs = jobsArray.filter(j => j.status === 'completed').length;
  const inProgressJobs = jobsArray.filter(j => j.status === 'in_progress').length;
  
  // Calculate total escrow/budget value
  let totalBudgetPosted = 0;
  let totalEscrowFunded = 0;
  let totalPaidOut = 0;
  
  jobsArray.forEach(job => {
    const budget = parseFloat((job.budget || '').replace(/[^0-9.]/g, '')) || 0;
    totalBudgetPosted += budget;
    if (job.escrowStatus === 'funded' || job.status === 'in_progress' || job.status === 'completed') {
      totalEscrowFunded += budget;
    }
    if (job.status === 'completed') {
      totalPaidOut += budget;
    }
  });
  
  // Category distribution
  const categoryDistribution = {};
  jobsArray.forEach(job => {
    const cat = job.category || 'other';
    categoryDistribution[cat] = (categoryDistribution[cat] || 0) + 1;
  });
  
  // Get escrow stats if available
  let escrowStats = {
    totalEscrows: 0,
    fundedEscrows: 0,
    releasedEscrows: 0,
    totalVolume: 0
  };
  try {
    const escrows = escrowManager.listEscrows ? escrowManager.listEscrows() : [];
    escrowStats.totalEscrows = escrows.length;
    escrowStats.fundedEscrows = escrows.filter(e => e.status === 'funded').length;
    escrowStats.releasedEscrows = escrows.filter(e => e.status === 'released').length;
    escrowStats.totalVolume = escrows.reduce((sum, e) => sum + (e.amount || 0), 0);
  } catch (e) {
    // Escrow stats not available
  }
  
  // Calculate engagement metrics
  const avgSkillsPerAgent = profiles.length > 0 
    ? Math.round(profiles.reduce((sum, p) => sum + (p.skills || []).length, 0) / profiles.length * 10) / 10
    : 0;
  
  // Time-based calculations
  const now = new Date();
  const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000);
  const oneWeekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
  
  const recentProfiles = profiles.filter(p => new Date(p.createdAt || 0) > oneWeekAgo).length;
  const recentJobs = jobsArray.filter(j => new Date(j.createdAt || 0) > oneWeekAgo).length;
  
  // Milestone calculations
  const milestones = [
    { target: 100, current: totalAgents, label: 'Agents', icon: '🤖' },
    { target: 10, current: completedJobs, label: 'Completed Jobs', icon: '✅' },
    { target: 1000, current: Math.round(escrowStats.totalVolume), label: 'Escrow Volume ($)', icon: '💰' },
    { target: 50, current: verifiedAgents, label: 'Verified Agents', icon: '✓' }
  ];
  
  return {
    timestamp: now.toISOString(),
    agents: {
      total: totalAgents,
      verified: verifiedAgents,
      verificationRate: totalAgents > 0 ? Math.round(verifiedAgents / totalAgents * 100) : 0,
      byVerificationLevel: agentsByVerifications,
      newThisWeek: recentProfiles,
      avgSkills: avgSkillsPerAgent
    },
    marketplace: {
      totalJobs: totalJobs,
      openJobs: openJobs,
      inProgress: inProgressJobs,
      completed: completedJobs,
      completionRate: totalJobs > 0 ? Math.round(completedJobs / totalJobs * 100) : 0,
      newThisWeek: recentJobs,
      categoryDistribution
    },
    economy: {
      totalBudgetPosted: Math.round(totalBudgetPosted),
      totalEscrowFunded: Math.round(totalEscrowFunded),
      totalPaidOut: Math.round(totalPaidOut),
      escrowStats
    },
    topSkills,
    milestones,
    health: calculateHealthScore({
      totalAgents, verifiedAgents, totalJobs, completedJobs, 
      recentProfiles, recentJobs, totalEscrowFunded
    })
  };
}

/**
 * Calculate overall ecosystem health score (0-100)
 */
function calculateHealthScore(metrics) {
  let score = 0;
  let maxScore = 0;
  
  // Agent growth (25 points)
  maxScore += 25;
  if (metrics.totalAgents >= 100) score += 25;
  else if (metrics.totalAgents >= 50) score += 15;
  else if (metrics.totalAgents >= 20) score += 10;
  else if (metrics.totalAgents >= 5) score += 5;
  
  // Verification rate (25 points)
  maxScore += 25;
  const verificationRate = metrics.totalAgents > 0 ? metrics.verifiedAgents / metrics.totalAgents : 0;
  score += Math.round(verificationRate * 25);
  
  // Marketplace activity (25 points)
  maxScore += 25;
  if (metrics.completedJobs >= 10) score += 25;
  else if (metrics.completedJobs >= 5) score += 15;
  else if (metrics.completedJobs >= 1) score += 10;
  else if (metrics.totalJobs >= 1) score += 5;
  
  // Economic activity (25 points)
  maxScore += 25;
  if (metrics.totalEscrowFunded >= 1000) score += 25;
  else if (metrics.totalEscrowFunded >= 500) score += 20;
  else if (metrics.totalEscrowFunded >= 100) score += 15;
  else if (metrics.totalEscrowFunded >= 50) score += 10;
  else if (metrics.totalEscrowFunded > 0) score += 5;
  
  return {
    score: Math.round(score / maxScore * 100),
    level: score >= 80 ? 'thriving' : score >= 60 ? 'healthy' : score >= 40 ? 'growing' : 'emerging',
    color: score >= 80 ? '#22c55e' : score >= 60 ? '#84cc16' : score >= 40 ? '#eab308' : '#f97316'
  };
}

/**
 * Generate shareable summary text for Twitter
 */
function generateShareText(stats) {
  const lines = [
    `🤖 State of the Agent Economy`,
    ``,
    `📊 ${stats.agents.total} AI agents registered`,
    `✅ ${stats.agents.verified} verified (${stats.agents.verificationRate}%)`,
    `💼 ${stats.marketplace.openJobs} open jobs`,
    `💰 $${stats.economy.totalEscrowFunded} in funded escrow`,
    ``,
    `Health Score: ${stats.health.score}/100 (${stats.health.level})`,
    ``,
    `Build your agent portfolio at agentfolio.bot`
  ];
  return lines.join('\n');
}

module.exports = {
  getEcosystemStats,
  calculateHealthScore,
  generateShareText
};
