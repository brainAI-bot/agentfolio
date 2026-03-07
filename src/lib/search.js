/**
 * AgentFolio Search & Discovery
 * Find agents by skills, verification status, and keywords
 */

const { listProfiles } = require('./profile');

/**
 * Simple fuzzy match - allows n character differences
 */
function fuzzyMatch(str1, str2, maxDiff = 1) {
  if (Math.abs(str1.length - str2.length) > maxDiff) return false;
  
  let diff = 0;
  const len = Math.min(str1.length, str2.length);
  
  for (let i = 0; i < len; i++) {
    if (str1[i] !== str2[i]) diff++;
    if (diff > maxDiff) return false;
  }
  
  diff += Math.abs(str1.length - str2.length);
  return diff <= maxDiff;
}

/**
 * Search profiles by various criteria
 */
function searchProfiles(query, options = {}) {
  const {
    dataDir = __dirname + '/../../data/profiles',
    skillCategory = null,
    skill = null,
    minVerificationScore = 0,
    verificationTier = null,
    limit = 20
  } = options;

  let profiles = listProfiles(dataDir);

  // Text search with fuzzy matching (name, handle, bio, skills)
  if (query) {
    const q = query.toLowerCase();
    const queryWords = q.split(/\s+/).filter(w => w.length > 0);
    
    profiles = profiles.map(p => {
      const searchText = [
        p.name,
        p.handle,
        p.bio,
        ...(p.skills || []).map(s => (typeof s === 'string' ? s : (s && s.name) || '')),
        ...(p.skills || []).map(s => (typeof s === 'string' ? '' : (s && s.category) || '')),
        ...(p.portfolio || []).map(item => item.title),
        ...(p.portfolio || []).map(item => item.description)
      ].join(' ').toLowerCase();
      
      // Exact match gets high score
      let score = 0;
      if (searchText.includes(q)) score += 100;
      
      // Word matches
      queryWords.forEach(word => {
        if (searchText.includes(word)) score += 10;
        // Fuzzy: check if any word starts with query word
        const words = searchText.split(/\s+/);
        words.forEach(w => {
          if (w.startsWith(word)) score += 5;
          // Levenshtein-lite: allow 1 char difference for words > 3 chars
          if (word.length > 3 && w.length > 3) {
            if (fuzzyMatch(word, w, 1)) score += 3;
          }
        });
      });
      
      return { ...p, _searchScore: score };
    }).filter(p => p._searchScore > 0);
    
    // Sort by search score first, then verification
    profiles.sort((a, b) => b._searchScore - a._searchScore);
  }

  // Filter by skill category
  if (skillCategory) {
    profiles = profiles.filter(p =>
      p.skills.some(s => s.category.toLowerCase() === skillCategory.toLowerCase())
    );
  }

  // Filter by specific skill
  if (skill) {
    profiles = profiles.filter(p =>
      (p.skills || []).some(s => {
        const name = typeof s === 'string' ? s : (s && s.name) || '';
        return name.toLowerCase() === skill.toLowerCase();
      })
    );
  }

  // Filter by verification score
  if (minVerificationScore > 0) {
    profiles = profiles.filter(p =>
      (p.verification?.score || 0) >= minVerificationScore
    );
  }

  // Filter by verification tier
  if (verificationTier) {
    profiles = profiles.filter(p =>
      p.verification?.tier === verificationTier
    );
  }

  // Sort by verification score (highest first)
  profiles.sort((a, b) => {
    const scoreA = a.verification?.score || 0;
    const scoreB = b.verification?.score || 0;
    return scoreB - scoreA;
  });

  // Limit results
  return profiles.slice(0, limit);
}

/**
 * Get all unique skills across profiles
 */
function getAllSkills(dataDir = __dirname + '/../../data/profiles') {
  const profiles = listProfiles(dataDir);
  const skillsMap = new Map();

  profiles.forEach(p => {
    (p.skills || []).forEach(s => {
      if (!s) return;
      const sName = typeof s === 'string' ? s : (s.name || '');
      const sCat = typeof s === 'string' ? 'Other' : (s.category || 'Other');
      const key = `${sCat}:${sName}`;
      if (!skillsMap.has(key)) {
        skillsMap.set(key, {
          name: sName,
          category: sCat,
          count: 0,
          verifiedCount: 0
        });
      }
      const skill = skillsMap.get(key);
      skill.count++;
      if (s.verified) skill.verifiedCount++;
    });
  });

  return Array.from(skillsMap.values())
    .sort((a, b) => b.count - a.count);
}

/**
 * Get skill categories with counts
 */
function getSkillCategories(dataDir = __dirname + '/../../data/profiles') {
  const skills = getAllSkills(dataDir);
  const categories = {};

  skills.forEach(s => {
    if (!categories[s.category]) {
      categories[s.category] = { count: 0, skills: [] };
    }
    categories[s.category].count += s.count;
    categories[s.category].skills.push(s);
  });

  return categories;
}

/**
 * Find similar agents based on skills overlap
 */
function findSimilarAgents(profileId, dataDir = __dirname + '/../../data/profiles') {
  const profiles = listProfiles(dataDir);
  const targetProfile = profiles.find(p => p.id === profileId);
  
  if (!targetProfile) return [];

  const getSkillName = (s) => {
    if (!s) return '';
    if (typeof s === 'string') return s.toLowerCase();
    if (s.name) return String(s.name).toLowerCase();
    return '';
  };
  const targetSkills = new Set(targetProfile.skills.map(getSkillName).filter(Boolean));

  const similar = profiles
    .filter(p => p.id !== profileId)
    .map(p => {
      const profileSkills = new Set((p.skills || []).map(getSkillName).filter(Boolean));
      const overlap = [...targetSkills].filter(s => profileSkills.has(s)).length;
      const similarity = overlap / Math.max(targetSkills.size, profileSkills.size);
      
      return { profile: p, overlap, similarity };
    })
    .filter(x => x.overlap > 0)
    .sort((a, b) => b.similarity - a.similarity);

  return similar;
}

module.exports = {
  searchProfiles,
  getAllSkills,
  getSkillCategories,
  findSimilarAgents
};
