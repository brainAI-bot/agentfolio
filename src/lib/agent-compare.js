/**
 * Agent Comparison Tool
 * Compare two agents side-by-side
 */

const fs = require('fs');
const path = require('path');

// Data directory
const dataDir = path.join(__dirname, '../../data');

/**
 * Get profile data (from JSON file)
 */
function getProfile(profileId) {
  const profilePath = path.join(dataDir, 'profiles', `${profileId}.json`);
  if (fs.existsSync(profilePath)) {
    return JSON.parse(fs.readFileSync(profilePath, 'utf8'));
  }
  return null;
}

/**
 * Calculate comprehensive agent score
 */
function calculateAgentScore(profile) {
  if (!profile) return { total: 0, breakdown: {} };
  
  const breakdown = {
    completeness: 0,     // Profile completeness (0-20)
    verification: 0,     // Verification level (0-25)
    skills: 0,           // Skills count & quality (0-15)
    experience: 0,       // Jobs completed, reviews (0-20)
    social: 0,           // Endorsements, followers (0-10)
    activity: 0          // Recent activity (0-10)
  };
  
  // Profile completeness (0-20)
  if (profile.avatar) breakdown.completeness += 5;
  if (profile.bio && profile.bio.length > 50) breakdown.completeness += 5;
  if (profile.website) breakdown.completeness += 3;
  if (profile.wallets && Object.keys(profile.wallets).length > 0) breakdown.completeness += 4;
  if (profile.social && Object.keys(profile.social).length > 0) breakdown.completeness += 3;
  
  // Verification level (0-25)
  const verificationData = profile.verificationData || {};
  const verificationTypes = ['github', 'hyperliquid', 'polymarket', 'solana', 'twitter', 'ethereum', 'base', 'agentmail'];
  let verifiedCount = 0;
  verificationTypes.forEach(type => {
    if (verificationData[type]?.verified) {
      verifiedCount++;
      breakdown.verification += 3;
    }
  });
  if (verifiedCount >= 3) breakdown.verification += 1; // Triple verified bonus
  
  // Skills (0-15)
  const skills = profile.skills || [];
  breakdown.skills = Math.min(15, skills.length * 2);
  
  // Experience - from stats (0-20)
  const stats = profile.stats || {};
  breakdown.experience += Math.min(10, (stats.jobsCompleted || 0) * 2);
  breakdown.experience += Math.min(5, (stats.reviewCount || 0));
  const avgRating = stats.averageRating || 0;
  if (avgRating >= 4.5) breakdown.experience += 5;
  else if (avgRating >= 4) breakdown.experience += 3;
  else if (avgRating >= 3) breakdown.experience += 1;
  
  // Social (0-10)
  breakdown.social += Math.min(5, (stats.endorsementCount || 0));
  breakdown.social += Math.min(5, Math.floor((stats.followers || 0) / 5));
  
  // Activity (0-10)
  const activity = profile.activity || [];
  const recentActivity = activity.filter(a => {
    const activityDate = new Date(a.timestamp);
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    return activityDate > weekAgo;
  });
  breakdown.activity = Math.min(10, recentActivity.length * 2);
  
  const total = Object.values(breakdown).reduce((a, b) => a + b, 0);
  
  return {
    total,
    maxScore: 100,
    breakdown,
    percentile: Math.round((total / 100) * 100)
  };
}

/**
 * Get shared skills between two agents
 */
function getSharedSkills(profile1, profile2) {
  const skills1 = (profile1.skills || []).map(s => 
    typeof s === 'object' ? s.name?.toLowerCase() : s?.toLowerCase()
  ).filter(Boolean);
  const skills2 = (profile2.skills || []).map(s => 
    typeof s === 'object' ? s.name?.toLowerCase() : s?.toLowerCase()
  ).filter(Boolean);
  
  return skills1.filter(s => skills2.includes(s));
}

/**
 * Get unique skills for each agent
 */
function getUniqueSkills(profile1, profile2) {
  const skills1 = (profile1.skills || []).map(s => 
    typeof s === 'object' ? s.name : s
  ).filter(Boolean);
  const skills2 = (profile2.skills || []).map(s => 
    typeof s === 'object' ? s.name : s
  ).filter(Boolean);
  
  const skills1Lower = skills1.map(s => s.toLowerCase());
  const skills2Lower = skills2.map(s => s.toLowerCase());
  
  const unique1 = skills1.filter((s, i) => !skills2Lower.includes(skills1Lower[i]));
  const unique2 = skills2.filter((s, i) => !skills1Lower.includes(skills2Lower[i]));
  
  return { agent1Unique: unique1, agent2Unique: unique2 };
}

/**
 * Compare two agents
 */
function compareAgents(profileId1, profileId2) {
  const profile1 = getProfile(profileId1);
  const profile2 = getProfile(profileId2);
  
  if (!profile1 || !profile2) {
    return {
      error: true,
      message: !profile1 ? `Agent ${profileId1} not found` : `Agent ${profileId2} not found`
    };
  }
  
  const score1 = calculateAgentScore(profile1);
  const score2 = calculateAgentScore(profile2);
  
  const sharedSkills = getSharedSkills(profile1, profile2);
  const { agent1Unique, agent2Unique } = getUniqueSkills(profile1, profile2);
  
  // Determine winner in each category
  const categories = ['completeness', 'verification', 'skills', 'experience', 'social', 'activity'];
  const categoryWinners = {};
  categories.forEach(cat => {
    if (score1.breakdown[cat] > score2.breakdown[cat]) {
      categoryWinners[cat] = profileId1;
    } else if (score2.breakdown[cat] > score1.breakdown[cat]) {
      categoryWinners[cat] = profileId2;
    } else {
      categoryWinners[cat] = 'tie';
    }
  });
  
  // Overall winner
  let winner = 'tie';
  if (score1.total > score2.total) winner = profileId1;
  else if (score2.total > score1.total) winner = profileId2;
  
  return {
    agent1: {
      id: profileId1,
      name: profile1.name,
      avatar: profile1.avatar,
      bio: profile1.bio,
      skills: profile1.skills || [],
      score: score1,
      verifications: getVerificationSummary(profile1),
      stats: profile1.stats || {}
    },
    agent2: {
      id: profileId2,
      name: profile2.name,
      avatar: profile2.avatar,
      bio: profile2.bio,
      skills: profile2.skills || [],
      score: score2,
      verifications: getVerificationSummary(profile2),
      stats: profile2.stats || {}
    },
    comparison: {
      winner,
      categoryWinners,
      sharedSkills,
      agent1UniqueSkills: agent1Unique,
      agent2UniqueSkills: agent2Unique,
      scoreDifference: Math.abs(score1.total - score2.total)
    },
    timestamp: new Date().toISOString()
  };
}

/**
 * Get verification summary
 */
function getVerificationSummary(profile) {
  const verificationData = profile.verificationData || {};
  const verifications = [];
  
  const types = [
    { key: 'github', icon: '💻', name: 'GitHub' },
    { key: 'hyperliquid', icon: '📈', name: 'Hyperliquid' },
    { key: 'polymarket', icon: '🎲', name: 'Polymarket' },
    { key: 'solana', icon: '◎', name: 'Solana' },
    { key: 'ethereum', icon: 'Ξ', name: 'Ethereum' },
    { key: 'base', icon: '🔵', name: 'Base' },
    { key: 'twitter', icon: '🐦', name: 'Twitter' },
    { key: 'agentmail', icon: '📧', name: 'AgentMail' }
  ];
  
  types.forEach(type => {
    if (verificationData[type.key]?.verified) {
      verifications.push({
        type: type.key,
        icon: type.icon,
        name: type.name
      });
    }
  });
  
  return verifications;
}

/**
 * Get all profiles for comparison selector
 */
function getAllProfilesForComparison() {
  const profilesDir = path.join(dataDir, 'profiles');
  if (!fs.existsSync(profilesDir)) return [];
  
  const files = fs.readdirSync(profilesDir).filter(f => f.endsWith('.json'));
  return files.map(f => {
    const profile = JSON.parse(fs.readFileSync(path.join(profilesDir, f), 'utf8'));
    return {
      id: profile.id,
      name: profile.name,
      avatar: profile.avatar
    };
  }).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

module.exports = {
  compareAgents,
  calculateAgentScore,
  getSharedSkills,
  getUniqueSkills,
  getVerificationSummary,
  getAllProfilesForComparison
};
