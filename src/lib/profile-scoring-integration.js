/**
 * Profile Scoring Integration - Bridge to 2D Scoring Engine v2
 * Integrates new verification levels and reputation scores into profile display
 */

const getCompleteScore = () => ({ overall: 0, level: 'Unverified' }); const calculateVerificationLevel = () => 0; const calculateReputationScore = () => 0; // scoring-engine-v2 disabled

/**
 * Get complete scoring data for profile display
 */
function getProfileScoringData(profile) {
  if (!profile) {
    return {
      verificationLevel: {
        level: 0,
        name: 'Unregistered',
        description: 'No requirements',
        badge: '🔴',
        color: '#dc2626'
      },
      reputationScore: {
        score: 0,
        rank: 'Newcomer',
        color: '#6b7280'
      },
      legacy: {
        trustScore: 0,
        verificationScore: 0
      }
    };
  }

  const rawScoring = getCompleteScore(profile) || {};
  const verificationLevel = rawScoring.verificationLevel || {
    level: typeof rawScoring.level === 'number' ? rawScoring.level : 0,
    name: rawScoring.levelName || rawScoring.level || 'Unverified',
    description: 'No verification requirements met yet',
    progress: null,
  };
  const reputationScore = rawScoring.reputationScore || {
    score: typeof rawScoring.overall === 'number' ? rawScoring.overall : 0,
    rank: rawScoring.rank || 'Newcomer',
    breakdown: rawScoring.breakdown || null,
  };
  const overall = rawScoring.overall && typeof rawScoring.overall === 'object'
    ? rawScoring.overall
    : {
        tier: rawScoring.tier || verificationLevel.name || 'Unverified',
        summary: rawScoring.summary || 'Fallback scoring active',
      };
  
  return {
    verificationLevel: {
      level: verificationLevel.level,
      name: verificationLevel.name,
      description: verificationLevel.description,
      progress: verificationLevel.progress,
      badge: getVerificationBadge(verificationLevel.level),
      color: getVerificationColor(verificationLevel.level)
    },
    reputationScore: {
      score: reputationScore.score,
      rank: reputationScore.rank,
      breakdown: reputationScore.breakdown,
      color: getReputationColor(reputationScore.score)
    },
    overall,
    // Keep legacy scores for backward compatibility during transition
    legacy: {
      trustScore: getLegacyTrustScore(profile),
      verificationScore: getLegacyVerificationScore(profile)
    }
  };
}

/**
 * Get verification level badge emoji
 */
function getVerificationBadge(level) {
  switch (level) {
    case 0: return '⚪'; // Unregistered
    case 1: return '🟡'; // Registered
    case 2: return '🔵'; // Verified
    case 3: return '🟢'; // On-Chain
    case 4: return '🟠'; // Trusted
    case 5: return '👑'; // Sovereign
    default: return '⚪';
  }
}

/**
 * Get verification level color
 */
function getVerificationColor(level) {
  switch (level) {
    case 0: return '#6b7280'; // gray
    case 1: return '#eab308'; // yellow
    case 2: return '#3b82f6'; // blue
    case 3: return '#10b981'; // green
    case 4: return '#f97316'; // orange
    case 5: return '#8b5cf6'; // purple/gold
    default: return '#6b7280';
  }
}

/**
 * Get reputation score color
 */
function getReputationColor(score) {
  if (score >= 800) return '#8b5cf6'; // Elite purple
  if (score >= 600) return '#f97316'; // Expert orange
  if (score >= 400) return '#10b981'; // Skilled green
  if (score >= 200) return '#3b82f6'; // Competent blue
  if (score >= 100) return '#eab308'; // Developing yellow
  return '#6b7280'; // Newcomer gray
}

/**
 * Legacy trust score for backward compatibility
 */
function getLegacyTrustScore(profile) {
  // This would call the old reputation calculation for compatibility
  // during transition period - simplified for now
  return 0;
}

/**
 * Legacy verification score for backward compatibility
 */
function getLegacyVerificationScore(profile) {
  // This would call the old verification scoring for compatibility
  // during transition period - simplified for now
  return 0;
}

/**
 * Generate profile display components for frontend
 */
function generateProfileDisplay(profile) {
  const scoring = getProfileScoringData(profile);
  
  return {
    // Level badge component
    levelBadge: {
      badge: scoring.verificationLevel.badge,
      text: scoring.verificationLevel.name,
      level: scoring.verificationLevel.level,
      color: scoring.verificationLevel.color,
      tooltip: scoring.verificationLevel.description
    },
    
    // Reputation score component
    repScore: {
      score: scoring.reputationScore.score,
      text: scoring.reputationScore.rank,
      color: scoring.reputationScore.color,
      maxScore: 800
    },
    
    // Progress indicator (what's needed for next level)
    progress: scoring.verificationLevel.progress,
    
    // Overall tier display
    tier: {
      name: scoring.overall.tier,
      summary: scoring.overall.summary
    }
  };
}

/**
 * Get scoring data for API responses
 */
function getAPIScoringData(profile) {
  const scoring = getProfileScoringData(profile);
  
  return {
    verification: {
      level: scoring.verificationLevel.level,
      name: scoring.verificationLevel.name,
      description: scoring.verificationLevel.description,
      nextLevel: scoring.verificationLevel.progress?.nextLevel,
      missing: scoring.verificationLevel.progress?.missing
    },
    reputation: {
      score: scoring.reputationScore.score,
      rank: scoring.reputationScore.rank,
      breakdown: scoring.reputationScore.breakdown
    },
    tier: scoring.overall.tier,
    summary: scoring.overall.summary
  };
}

module.exports = {
  getProfileScoringData,
  generateProfileDisplay,
  getAPIScoringData,
  getVerificationBadge,
  getVerificationColor,
  getReputationColor
};
