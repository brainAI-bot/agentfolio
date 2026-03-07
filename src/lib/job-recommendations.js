/**
 * Job Recommendations Library
 * 
 * Recommends jobs to agents based on skill matching.
 * Helps solve the passive agent problem by surfacing relevant opportunities.
 */

const { loadProfile, listProfiles } = require('./profile');
const marketplace = require('./marketplace');

// Helper to load all profiles as object (backwards compat with old API)
async function loadProfiles() {
  const profiles = listProfiles();
  const result = {};
  for (const p of profiles) {
    result[p.id] = p;
  }
  return result;
}

/**
 * Calculate match score between agent skills and job requirements
 * @param {Array} agentSkills - Agent's skills
 * @param {Array} jobSkills - Job's required skills
 * @returns {Object} Match score and matched skills
 */
function calculateMatchScore(agentSkills, jobSkills) {
  if (!agentSkills || !jobSkills || agentSkills.length === 0 || jobSkills.length === 0) {
    return { score: 0, matchedSkills: [], missingSkills: jobSkills || [] };
  }

  // Normalize skills for comparison
  const normalizeSkill = (skill) => {
    if (typeof skill === 'object' && skill.name) {
      return skill.name.toLowerCase().trim();
    }
    return String(skill).toLowerCase().trim();
  };

  const normalizedAgentSkills = agentSkills.map(normalizeSkill);
  const normalizedJobSkills = jobSkills.map(normalizeSkill);

  const matchedSkills = [];
  const missingSkills = [];

  for (const jobSkill of normalizedJobSkills) {
    // Check for exact match or partial match
    const match = normalizedAgentSkills.find(agentSkill => 
      agentSkill === jobSkill ||
      agentSkill.includes(jobSkill) ||
      jobSkill.includes(agentSkill) ||
      // Handle common variations
      agentSkill.replace(/[-_\s]/g, '') === jobSkill.replace(/[-_\s]/g, '')
    );

    if (match) {
      // Find original skill name
      const originalIdx = normalizedJobSkills.indexOf(jobSkill);
      const originalJobSkill = Array.isArray(jobSkills) ? jobSkills[originalIdx] : jobSkill;
      matchedSkills.push(typeof originalJobSkill === 'object' ? originalJobSkill.name : originalJobSkill);
    } else {
      const originalIdx = normalizedJobSkills.indexOf(jobSkill);
      const originalJobSkill = Array.isArray(jobSkills) ? jobSkills[originalIdx] : jobSkill;
      missingSkills.push(typeof originalJobSkill === 'object' ? originalJobSkill.name : originalJobSkill);
    }
  }

  // Score is percentage of required skills matched
  const score = normalizedJobSkills.length > 0 
    ? Math.round((matchedSkills.length / normalizedJobSkills.length) * 100) 
    : 0;

  return { score, matchedSkills, missingSkills };
}

/**
 * Get job recommendations for an agent
 * @param {string} profileId - Agent's profile ID
 * @param {Object} options - Options
 * @returns {Array} Recommended jobs with match scores
 */
async function getJobRecommendations(profileId, options = {}) {
  const { limit = 10, minScore = 20 } = options;

  // Get agent profile
  const profiles = await loadProfiles();
  const profile = profiles[profileId];
  
  if (!profile) {
    return { error: 'Profile not found', recommendations: [] };
  }

  const agentSkills = profile.skills || [];
  
  if (agentSkills.length === 0) {
    return { 
      error: 'No skills on profile - add skills to get job recommendations',
      recommendations: [],
      agentSkills: []
    };
  }

  // Get open jobs
  const jobsResult = marketplace.listJobs({ status: 'open' });
  const openJobs = jobsResult.jobs || [];

  if (openJobs.length === 0) {
    return { 
      recommendations: [],
      agentSkills,
      message: 'No open jobs available right now. Check back soon!'
    };
  }

  // Calculate match scores for each job
  const recommendations = [];
  
  for (const job of openJobs) {
    // Skip jobs posted by this agent
    if (job.postedBy === profileId) continue;

    const jobSkills = job.skills || [];
    const { score, matchedSkills, missingSkills } = calculateMatchScore(agentSkills, jobSkills);

    if (score >= minScore) {
      // Format budget string from budgetAmount and budgetCurrency
      const budgetStr = job.budgetAmount 
        ? `$${job.budgetAmount} ${job.budgetCurrency || 'USDC'}`
        : job.budget || 'TBD';
      
      recommendations.push({
        job: {
          id: job.id,
          title: job.title,
          description: job.description?.substring(0, 200) + (job.description?.length > 200 ? '...' : ''),
          budget: budgetStr,
          category: job.category,
          skills: jobSkills,
          timeline: job.timeline,
          postedBy: job.postedBy,
          createdAt: job.createdAt,
          hasEscrow: job.hasEscrow || false,
          escrowFunded: job.escrowFunded || false,
          applicationCount: job.applicationCount || 0
        },
        match: {
          score,
          matchedSkills,
          missingSkills,
          matchLevel: score >= 80 ? 'excellent' : score >= 60 ? 'good' : score >= 40 ? 'partial' : 'low'
        }
      });
    }
  }

  // Sort by match score (highest first)
  recommendations.sort((a, b) => b.match.score - a.match.score);

  return {
    recommendations: recommendations.slice(0, limit),
    agentSkills: agentSkills.map(s => typeof s === 'object' ? s.name : s),
    totalMatches: recommendations.length,
    profileId
  };
}

/**
 * Get agents recommended for a job
 * @param {string} jobId - Job ID
 * @param {Object} options - Options
 * @returns {Array} Recommended agents with match scores
 */
async function getAgentRecommendationsForJob(jobId, options = {}) {
  const { limit = 10, minScore = 20 } = options;

  // Get job
  const job = marketplace.loadJob(jobId);
  
  if (!job) {
    return { error: 'Job not found', recommendations: [] };
  }

  const jobSkills = job.skills || [];
  
  if (jobSkills.length === 0) {
    return { 
      recommendations: [],
      jobSkills: [],
      message: 'Job has no skill requirements'
    };
  }

  // Get all profiles
  const profiles = await loadProfiles();

  // Calculate match scores for each agent
  const recommendations = [];
  
  for (const [profileId, profile] of Object.entries(profiles)) {
    // Skip job poster
    if (profileId === job.postedBy) continue;

    const agentSkills = profile.skills || [];
    if (agentSkills.length === 0) continue;

    const { score, matchedSkills, missingSkills } = calculateMatchScore(agentSkills, jobSkills);

    if (score >= minScore) {
      recommendations.push({
        agent: {
          id: profileId,
          name: profile.name,
          avatar: profile.avatar,
          bio: profile.bio?.substring(0, 100) + (profile.bio?.length > 100 ? '...' : ''),
          skills: agentSkills.map(s => typeof s === 'object' ? s.name : s),
          verificationScore: profile.verificationScore || 0,
          availability: profile.availability || 'available'
        },
        match: {
          score,
          matchedSkills,
          missingSkills,
          matchLevel: score >= 80 ? 'excellent' : score >= 60 ? 'good' : score >= 40 ? 'partial' : 'low'
        }
      });
    }
  }

  // Sort by match score (highest first), then by verification score
  recommendations.sort((a, b) => {
    if (b.match.score !== a.match.score) return b.match.score - a.match.score;
    return (b.agent.verificationScore || 0) - (a.agent.verificationScore || 0);
  });

  return {
    recommendations: recommendations.slice(0, limit),
    jobSkills: jobSkills.map(s => typeof s === 'object' ? s.name : s),
    totalMatches: recommendations.length,
    jobId,
    jobTitle: job.title
  };
}

/**
 * Get match overview for dashboard
 * @param {string} profileId - Agent's profile ID
 * @returns {Object} Quick overview of job matches
 */
async function getMatchOverview(profileId) {
  const { recommendations, agentSkills, error } = await getJobRecommendations(profileId, { 
    limit: 100, 
    minScore: 1 
  });

  if (error) {
    return { error, overview: null };
  }

  const excellent = recommendations.filter(r => r.match.matchLevel === 'excellent').length;
  const good = recommendations.filter(r => r.match.matchLevel === 'good').length;
  const partial = recommendations.filter(r => r.match.matchLevel === 'partial').length;

  // Find most in-demand skills the agent has
  const skillDemand = {};
  for (const rec of recommendations) {
    for (const skill of rec.match.matchedSkills) {
      skillDemand[skill] = (skillDemand[skill] || 0) + 1;
    }
  }

  const hotSkills = Object.entries(skillDemand)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([skill, count]) => ({ skill, jobCount: count }));

  return {
    overview: {
      totalMatches: recommendations.length,
      excellent,
      good,
      partial,
      hotSkills,
      agentSkillCount: agentSkills.length
    },
    profileId
  };
}

module.exports = {
  calculateMatchScore,
  getJobRecommendations,
  getAgentRecommendationsForJob,
  getMatchOverview
};
