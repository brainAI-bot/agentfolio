/**
 * Spam Detection System for AgentFolio
 * Auto-flags suspicious profiles for admin review
 * Never auto-deletes - flags for human review only
 */

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DATA_DIR = path.join(__dirname, '../../data');
const FLAGS_FILE = path.join(DATA_DIR, 'spam-flags.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Flag reasons
const FLAG_REASONS = {
  NO_BIO_24H: 'no_bio_24h',           // No bio after 24 hours
  DUPLICATE_NAME: 'duplicate_name',    // Same name as existing profile
  ALL_CAPS_NAME: 'all_caps_name',      // Name is ALL CAPS
  RANDOM_CHARS: 'random_chars',        // Name/bio contains suspicious random chars
  SUSPICIOUS_PATTERN: 'suspicious_pattern',  // Common spam patterns
  BOT_LIKE_NAME: 'bot_like_name',      // Name matches bot pattern (agent123, bot_xyz)
  EXCESSIVE_LINKS: 'excessive_links',   // Too many external links
  GIBBERISH_BIO: 'gibberish_bio',       // Bio appears to be gibberish
  MANUAL: 'manual'                      // Manually flagged by admin
};

// Flag status
const FLAG_STATUS = {
  PENDING: 'pending',
  CLEARED: 'cleared',         // Reviewed and found not spam
  CONFIRMED: 'confirmed',     // Confirmed as spam
  WATCHLIST: 'watchlist'      // Not spam but keep monitoring
};

// Spam score thresholds
const THRESHOLDS = {
  AUTO_FLAG: 40,    // Auto-flag if score >= 40
  HIGH_RISK: 70     // High risk if score >= 70
};

// Load flags from file
function loadFlags() {
  try {
    if (fs.existsSync(FLAGS_FILE)) {
      return JSON.parse(fs.readFileSync(FLAGS_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('[SpamDetection] Error loading flags:', e.message);
  }
  return { flags: [], lastUpdated: null, stats: { totalScans: 0, totalFlags: 0 } };
}

// Save flags to file
function saveFlags(data) {
  data.lastUpdated = new Date().toISOString();
  fs.writeFileSync(FLAGS_FILE, JSON.stringify(data, null, 2));
}

/**
 * Calculate spam score for a profile
 * Returns { score, reasons, details }
 */
function calculateSpamScore(profile, allProfiles = []) {
  let score = 0;
  const reasons = [];
  const details = {};

  const name = profile.name || '';
  const bio = profile.bio || '';
  const createdAt = new Date(profile.createdAt);
  const ageHours = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60);

  // 1. No bio after 24 hours (+25 points)
  if (!bio.trim() && ageHours > 24) {
    score += 25;
    reasons.push(FLAG_REASONS.NO_BIO_24H);
    details.noBioAge = Math.round(ageHours);
  }

  // 2. Duplicate name detection (+20 points)
  const duplicates = allProfiles.filter(p => 
    p.id !== profile.id && 
    p.name.toLowerCase().trim() === name.toLowerCase().trim()
  );
  if (duplicates.length > 0) {
    score += 20;
    reasons.push(FLAG_REASONS.DUPLICATE_NAME);
    details.duplicateOf = duplicates.map(d => d.id);
  }

  // 3. ALL CAPS name (+15 points)
  if (name.length > 3 && name === name.toUpperCase() && /[A-Z]/.test(name)) {
    score += 15;
    reasons.push(FLAG_REASONS.ALL_CAPS_NAME);
  }

  // 4. Random characters / gibberish in name (+20 points)
  // Check for excessive consonant clusters, repeating chars, or lack of vowels
  const nameAlphaOnly = name.replace(/[^a-zA-Z]/g, '').toLowerCase();
  if (nameAlphaOnly.length > 4) {
    const vowelRatio = (nameAlphaOnly.match(/[aeiou]/g) || []).length / nameAlphaOnly.length;
    const repeatingChars = /(.)\1{3,}/.test(nameAlphaOnly);
    const consonantCluster = /[bcdfghjklmnpqrstvwxyz]{5,}/i.test(nameAlphaOnly);
    
    if (vowelRatio < 0.1 || repeatingChars || consonantCluster) {
      score += 20;
      reasons.push(FLAG_REASONS.RANDOM_CHARS);
      details.nameAnalysis = { vowelRatio, repeatingChars, consonantCluster };
    }
  }

  // 5. Bot-like naming patterns (+15 points)
  // Matches: agent123, bot_xyz, user12345, test_agent_001
  const botPatterns = [
    /^(agent|bot|user|test|demo|fake|spam|temp)[_-]?\d+$/i,
    /^[a-z]{3,6}\d{4,}$/i,  // abc12345
    /^(auto|generated|random)[_-]?[a-z0-9]+$/i
  ];
  if (botPatterns.some(p => p.test(name.replace(/\s/g, '_')))) {
    score += 15;
    reasons.push(FLAG_REASONS.BOT_LIKE_NAME);
    details.matchedBotPattern = true;
  }

  // 6. Suspicious spam patterns (+25 points)
  const spamPatterns = [
    /\$\$\$/,                          // Money symbols
    /free\s*(money|crypto|tokens)/i,   // Free money offers
    /(dm|message)\s*me\s*(for|to)/i,   // DM me for...
    /click\s*(here|link|this)/i,       // Click bait
    /join\s*(my|our)\s*(discord|telegram)/i,  // Join my Discord
    /airdrop|giveaway|winner/i,        // Common spam keywords
    /t\.me\/|discord\.gg\//i,          // Telegram/Discord links in bio
    /(100|1000)x\s*(guaranteed|profits?)/i  // Unrealistic promises
  ];
  
  const textToCheck = `${name} ${bio}`;
  const matchedPatterns = spamPatterns.filter(p => p.test(textToCheck));
  if (matchedPatterns.length > 0) {
    score += 25;
    reasons.push(FLAG_REASONS.SUSPICIOUS_PATTERN);
    details.matchedSpamPatterns = matchedPatterns.length;
  }

  // 7. Excessive external links (+10 points)
  const linkCount = (bio.match(/https?:\/\//g) || []).length;
  if (linkCount > 3) {
    score += 10;
    reasons.push(FLAG_REASONS.EXCESSIVE_LINKS);
    details.linkCount = linkCount;
  }

  // 8. Gibberish bio detection (+20 points)
  if (bio.length > 20) {
    const words = bio.split(/\s+/);
    const avgWordLength = words.reduce((s, w) => s + w.length, 0) / words.length;
    const hasRealWords = /\b(the|a|an|is|are|and|or|for|to|of|in|on|with|agent|ai|crypto|blockchain|trading)\b/i.test(bio);
    
    // Gibberish often has very long "words" or no common words
    if ((avgWordLength > 15 || !hasRealWords) && words.length > 3) {
      score += 20;
      reasons.push(FLAG_REASONS.GIBBERISH_BIO);
      details.avgWordLength = avgWordLength;
      details.hasRealWords = hasRealWords;
    }
  }

  // Bonus: Reduce score for verified profiles (-20 points per verification)
  const verifications = Object.keys(profile.verification || {}).filter(
    k => profile.verification[k]
  );
  if (verifications.length > 0) {
    score -= verifications.length * 20;
    details.verifications = verifications;
  }

  // Bonus: Reduce score for endorsements received (-5 points each, max -20)
  const endorsementCount = (profile.endorsements || []).length;
  if (endorsementCount > 0) {
    score -= Math.min(endorsementCount * 5, 20);
    details.endorsementBonus = Math.min(endorsementCount * 5, 20);
  }

  return {
    score: Math.max(0, score), // Floor at 0
    reasons,
    details,
    riskLevel: score >= THRESHOLDS.HIGH_RISK ? 'high' : 
               score >= THRESHOLDS.AUTO_FLAG ? 'medium' : 'low'
  };
}

/**
 * Scan a single profile and optionally flag it
 */
function scanProfile(profile, allProfiles = [], autoFlag = true) {
  const result = calculateSpamScore(profile, allProfiles);
  
  if (autoFlag && result.score >= THRESHOLDS.AUTO_FLAG) {
    // Check if already flagged
    const data = loadFlags();
    const existingFlag = data.flags.find(f => 
      f.profileId === profile.id && 
      f.status === FLAG_STATUS.PENDING
    );
    
    if (!existingFlag) {
      flagProfile(profile.id, result.reasons, {
        score: result.score,
        details: result.details,
        autoFlagged: true
      });
    }
  }
  
  // Update scan stats
  const data = loadFlags();
  data.stats.totalScans = (data.stats.totalScans || 0) + 1;
  saveFlags(data);
  
  return result;
}

/**
 * Scan all profiles and flag suspicious ones
 */
function scanAllProfiles(profiles) {
  const results = {
    scanned: 0,
    flagged: 0,
    highRisk: 0,
    mediumRisk: 0,
    profiles: []
  };
  
  for (const profile of profiles) {
    const result = scanProfile(profile, profiles, true);
    results.scanned++;
    
    if (result.score >= THRESHOLDS.AUTO_FLAG) {
      results.flagged++;
      if (result.score >= THRESHOLDS.HIGH_RISK) {
        results.highRisk++;
      } else {
        results.mediumRisk++;
      }
      results.profiles.push({
        id: profile.id,
        name: profile.name,
        score: result.score,
        reasons: result.reasons,
        riskLevel: result.riskLevel
      });
    }
  }
  
  console.log(`[SpamDetection] Scanned ${results.scanned} profiles, flagged ${results.flagged}`);
  return results;
}

/**
 * Flag a profile for review
 */
function flagProfile(profileId, reasons, metadata = {}) {
  const data = loadFlags();
  
  const flag = {
    id: uuidv4(),
    profileId,
    reasons: Array.isArray(reasons) ? reasons : [reasons],
    score: metadata.score || 0,
    details: metadata.details || {},
    autoFlagged: metadata.autoFlagged || false,
    status: FLAG_STATUS.PENDING,
    adminNotes: null,
    reviewedBy: null,
    reviewedAt: null,
    createdAt: new Date().toISOString()
  };
  
  data.flags.push(flag);
  data.stats.totalFlags = (data.stats.totalFlags || 0) + 1;
  saveFlags(data);
  
  console.log(`[SpamDetection] Flagged profile ${profileId} (score: ${flag.score})`);
  return { success: true, flagId: flag.id };
}

/**
 * Get flagged profiles
 */
function getFlaggedProfiles({ status = null, limit = 50, offset = 0 } = {}) {
  const data = loadFlags();
  let flags = data.flags;
  
  if (status) {
    flags = flags.filter(f => f.status === status);
  }
  
  // Sort by score (highest first), then by date
  flags.sort((a, b) => b.score - a.score || new Date(b.createdAt) - new Date(a.createdAt));
  
  const total = flags.length;
  flags = flags.slice(offset, offset + limit);
  
  return { flags, total, limit, offset };
}

/**
 * Get a single flag by ID
 */
function getFlag(flagId) {
  const data = loadFlags();
  return data.flags.find(f => f.id === flagId) || null;
}

/**
 * Get flag for a specific profile
 */
function getProfileFlag(profileId) {
  const data = loadFlags();
  return data.flags.find(f => f.profileId === profileId && f.status === FLAG_STATUS.PENDING) || null;
}

/**
 * Update flag status (admin action)
 */
function updateFlagStatus(flagId, { status, adminNotes = null, reviewedBy = null }) {
  if (!Object.values(FLAG_STATUS).includes(status)) {
    return { error: 'Invalid status. Options: ' + Object.values(FLAG_STATUS).join(', ') };
  }
  
  const data = loadFlags();
  const flag = data.flags.find(f => f.id === flagId);
  
  if (!flag) {
    return { error: 'Flag not found' };
  }
  
  flag.status = status;
  flag.adminNotes = adminNotes || flag.adminNotes;
  flag.reviewedBy = reviewedBy || 'admin';
  flag.reviewedAt = new Date().toISOString();
  
  saveFlags(data);
  
  console.log(`[SpamDetection] Flag ${flagId} updated to ${status}`);
  return { success: true, flag };
}

/**
 * Get spam detection statistics
 */
function getSpamStats() {
  const data = loadFlags();
  const flags = data.flags;
  
  const stats = {
    totalScans: data.stats?.totalScans || 0,
    totalFlags: flags.length,
    byStatus: {},
    byReason: {},
    pendingCount: 0,
    highRiskCount: 0,
    recentFlags: flags.filter(f => 
      Date.now() - new Date(f.createdAt).getTime() < 7 * 24 * 60 * 60 * 1000
    ).length,
    avgScore: 0
  };
  
  // Count by status
  Object.values(FLAG_STATUS).forEach(s => {
    stats.byStatus[s] = flags.filter(f => f.status === s).length;
  });
  stats.pendingCount = stats.byStatus[FLAG_STATUS.PENDING] || 0;
  
  // Count by reason
  Object.values(FLAG_REASONS).forEach(r => {
    stats.byReason[r] = flags.filter(f => f.reasons.includes(r)).length;
  });
  
  // High risk count and average score
  stats.highRiskCount = flags.filter(f => f.score >= THRESHOLDS.HIGH_RISK).length;
  if (flags.length > 0) {
    stats.avgScore = Math.round(flags.reduce((s, f) => s + f.score, 0) / flags.length);
  }
  
  return stats;
}

/**
 * Check if profile is flagged (for display purposes)
 */
function isProfileFlagged(profileId) {
  const data = loadFlags();
  return data.flags.some(f => f.profileId === profileId && f.status === FLAG_STATUS.PENDING);
}

/**
 * Clear expired cleared flags (cleanup, optional)
 */
function cleanupOldFlags(daysToKeep = 30) {
  const data = loadFlags();
  const cutoff = Date.now() - (daysToKeep * 24 * 60 * 60 * 1000);
  
  const before = data.flags.length;
  data.flags = data.flags.filter(f => 
    f.status === FLAG_STATUS.PENDING || 
    f.status === FLAG_STATUS.WATCHLIST ||
    new Date(f.createdAt).getTime() > cutoff
  );
  
  const removed = before - data.flags.length;
  if (removed > 0) {
    saveFlags(data);
    console.log(`[SpamDetection] Cleaned up ${removed} old flags`);
  }
  
  return { removed };
}

module.exports = {
  FLAG_REASONS,
  FLAG_STATUS,
  THRESHOLDS,
  calculateSpamScore,
  scanProfile,
  scanAllProfiles,
  flagProfile,
  getFlaggedProfiles,
  getFlag,
  getProfileFlag,
  updateFlagStatus,
  getSpamStats,
  isProfileFlagged,
  cleanupOldFlags
};
