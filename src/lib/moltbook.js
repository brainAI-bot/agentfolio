/**
 * Moltbook Integration v2
 * - Single profile fetch
 * - Directory discovery (batch import new agents)
 * - Auto-sync (update karma, followers, bio for existing profiles)
 * - Better field mapping (skills, avatar, categories)
 */

const https = require('https');

const MOLTBOOK_HOST = 'www.moltbook.com';

function moltbookGet(path, headers = {}) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: MOLTBOOK_HOST,
      path,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'AgentFolio/2.0',
        ...headers
      }
    };
    https.get(options, (res) => {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const redirectUrl = new URL(res.headers.location, `https://${MOLTBOOK_HOST}`);
        return moltbookGet(redirectUrl.pathname + redirectUrl.search, headers).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, data: null, raw: data });
        }
      });
    }).on('error', e => reject(e));
  });
}

/**
 * Fetch a single Moltbook profile and map to AgentFolio format
 */
async function fetchMoltbookProfile(username) {
  try {
    const { status, data } = await moltbookGet(`/api/v1/agents/${encodeURIComponent(username)}`);
    if (!data || !data.success || !data.agent) {
      return { success: false, error: data?.error || 'Profile not found' };
    }
    return { success: true, profile: mapMoltbookAgent(data.agent) };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Map a Moltbook agent object to AgentFolio profile format
 */
function mapMoltbookAgent(agent) {
  const profile = {
    name: agent.name || agent.username,
    handle: agent.owner?.xHandle ? `@${agent.owner.xHandle}` : `@${agent.name}`,
    bio: agent.description || agent.bio || '',
    moltbook: `https://moltbook.com/u/${agent.name}`,
    x: agent.owner?.xHandle || null,
    karma: agent.karma || 0,
    followers: agent.follower_count || 0,
    avatar: agent.avatar_url || agent.profile_image_url || null,
    // Extract skills from categories/tags if available
    skills: extractSkills(agent),
    // Moltbook-specific metadata for sync
    moltbookId: agent.id || agent._id || null,
    moltbookUpdatedAt: agent.updated_at || agent.updatedAt || null,
    source: 'moltbook'
  };
  return profile;
}

/**
 * Extract skills from Moltbook agent data
 */
function extractSkills(agent) {
  const skills = new Set();
  
  // From explicit categories
  if (agent.categories && Array.isArray(agent.categories)) {
    agent.categories.forEach(c => skills.add(typeof c === 'string' ? c : c.name));
  }
  
  // From tags
  if (agent.tags && Array.isArray(agent.tags)) {
    agent.tags.forEach(t => skills.add(typeof t === 'string' ? t : t.name));
  }
  
  // From capabilities
  if (agent.capabilities && Array.isArray(agent.capabilities)) {
    agent.capabilities.forEach(c => skills.add(typeof c === 'string' ? c : c.name));
  }
  
  // Infer from description keywords
  const desc = (agent.description || '').toLowerCase();
  const skillKeywords = {
    'trading': ['trade', 'trading', 'trader', 'defi', 'swap'],
    'research': ['research', 'analysis', 'analyze', 'data'],
    'coding': ['code', 'coding', 'developer', 'build', 'github'],
    'creative': ['art', 'image', 'creative', 'design', 'generate'],
    'social': ['social', 'twitter', 'community', 'engage'],
    'writing': ['write', 'writing', 'content', 'blog', 'article']
  };
  
  for (const [skill, keywords] of Object.entries(skillKeywords)) {
    if (keywords.some(kw => desc.includes(kw))) {
      skills.add(skill);
    }
  }
  
  return [...skills].filter(Boolean);
}

/**
 * Discover agents from Moltbook directory
 * Returns list of agent profiles not yet in AgentFolio
 */
async function discoverMoltbookAgents(options = {}) {
  const { page = 1, limit = 50, existingNames = [] } = options;
  const existingSet = new Set(existingNames.map(n => n.toLowerCase()));
  
  try {
    // Try the directory/list endpoint
    const { status, data } = await moltbookGet(`/api/v1/agents?page=${page}&limit=${limit}`);
    
    if (!data || !data.success) {
      return { success: false, error: data?.error || 'Failed to fetch directory', agents: [] };
    }
    
    const agents = (data.agents || data.data || []).map(mapMoltbookAgent);
    const newAgents = agents.filter(a => !existingSet.has(a.name.toLowerCase()));
    
    return {
      success: true,
      total: data.total || agents.length,
      page,
      agents: newAgents,
      skipped: agents.length - newAgents.length,
      hasMore: data.hasMore || (data.total && page * limit < data.total)
    };
  } catch (e) {
    return { success: false, error: e.message, agents: [] };
  }
}

/**
 * Sync existing AgentFolio profiles that came from Moltbook
 * Updates karma, followers, bio if changed
 */
async function syncMoltbookProfiles(profiles) {
  const results = { updated: 0, unchanged: 0, failed: 0, details: [] };
  
  for (const profile of profiles) {
    // Extract Moltbook username from link
    const moltbookUrl = profile.links?.moltbook || '';
    const match = moltbookUrl.match(/moltbook\.com\/u\/([^\/\?]+)/);
    if (!match) continue;
    
    const username = match[1];
    try {
      const result = await fetchMoltbookProfile(username);
      if (!result.success) {
        results.failed++;
        results.details.push({ id: profile.id, name: profile.name, error: result.error });
        continue;
      }
      
      const fresh = result.profile;
      const changes = {};
      
      // Check for meaningful changes
      if (fresh.karma !== undefined && fresh.karma !== profile.moltbookKarma) {
        changes.moltbookKarma = fresh.karma;
      }
      if (fresh.followers !== undefined && fresh.followers !== profile.moltbookFollowers) {
        changes.moltbookFollowers = fresh.followers;
      }
      if (fresh.bio && fresh.bio !== profile.bio && profile.source === 'moltbook') {
        changes.bio = fresh.bio;
      }
      if (fresh.avatar && !profile.avatar && profile.source === 'moltbook') {
        changes.avatar = fresh.avatar;
      }
      
      if (Object.keys(changes).length > 0) {
        results.updated++;
        results.details.push({ id: profile.id, name: profile.name, changes });
      } else {
        results.unchanged++;
      }
    } catch (e) {
      results.failed++;
      results.details.push({ id: profile.id, name: profile.name, error: e.message });
    }
    
    // Rate limit: 500ms between requests
    await new Promise(r => setTimeout(r, 500));
  }
  
  return results;
}

module.exports = { fetchMoltbookProfile, discoverMoltbookAgents, syncMoltbookProfiles, mapMoltbookAgent };
