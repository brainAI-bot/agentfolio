/**
 * GitHub Verification
 * Verify agent's GitHub profile and activity
 */

const https = require('https');

/**
 * Fetch GitHub user profile
 */
async function fetchGitHubUser(username) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: `/users/${username}`,
      headers: {
        'User-Agent': 'AgentFolio/1.0',
        'Accept': 'application/vnd.github.v3+json'
      }
    };

    https.get(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve(JSON.parse(data));
        } else if (res.statusCode === 404) {
          reject(new Error('GitHub user not found'));
        } else {
          reject(new Error(`GitHub API error: ${res.statusCode}`));
        }
      });
    }).on('error', reject);
  });
}

/**
 * Fetch user's repositories
 */
async function fetchGitHubRepos(username, limit = 10) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: `/users/${username}/repos?sort=updated&per_page=${limit}`,
      headers: {
        'User-Agent': 'AgentFolio/1.0',
        'Accept': 'application/vnd.github.v3+json'
      }
    };

    https.get(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve(JSON.parse(data));
        } else {
          reject(new Error(`GitHub API error: ${res.statusCode}`));
        }
      });
    }).on('error', reject);
  });
}

/**
 * Verify GitHub profile by checking for AgentFolio link in bio
 */
async function verifyGitHubProfile(username, agentId) {
  try {
    const user = await fetchGitHubUser(username);
    const repos = await fetchGitHubRepos(username);
    
    // Check if bio contains agentfolio link or agent ID
    const bio = (user.bio || '').toLowerCase();
    const isVerified = bio.includes('agentfolio') || 
                       bio.includes(agentId.toLowerCase()) ||
                       bio.includes('agentfolio.bot');
    
    // Calculate stats
    const totalStars = repos.reduce((sum, r) => sum + (r.stargazers_count || 0), 0);
    const totalForks = repos.reduce((sum, r) => sum + (r.forks_count || 0), 0);
    
    // Get languages
    const languages = {};
    repos.forEach(r => {
      if (r.language) {
        languages[r.language] = (languages[r.language] || 0) + 1;
      }
    });
    const topLanguages = Object.entries(languages)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([lang]) => lang);

    return {
      verified: isVerified,
      username: user.login,
      name: user.name,
      bio: user.bio,
      avatar: user.avatar_url,
      url: user.html_url,
      publicRepos: user.public_repos,
      followers: user.followers,
      following: user.following,
      createdAt: user.created_at,
      stats: {
        repos: user.public_repos,
        stars: totalStars,
        forks: totalForks,
        followers: user.followers
      },
      topLanguages,
      recentRepos: repos.slice(0, 5).map(r => ({
        name: r.name,
        description: r.description,
        url: r.html_url,
        stars: r.stargazers_count,
        forks: r.forks_count,
        language: r.language,
        updatedAt: r.updated_at
      })),
      verificationMethod: isVerified ? 'bio_link' : null,
      verificationHint: isVerified ? null : `Add "agentfolio.bot/${agentId}" to your GitHub bio to verify`
    };
  } catch (error) {
    return {
      verified: false,
      error: error.message
    };
  }
}

/**
 * Get GitHub stats for display
 */
async function getGitHubStats(username) {
  try {
    const user = await fetchGitHubUser(username);
    const repos = await fetchGitHubRepos(username, 30);
    
    const totalStars = repos.reduce((sum, r) => sum + (r.stargazers_count || 0), 0);
    
    // Get language breakdown
    const languages = {};
    repos.forEach(r => {
      if (r.language) {
        languages[r.language] = (languages[r.language] || 0) + 1;
      }
    });

    return {
      username: user.login,
      avatar: user.avatar_url,
      repos: user.public_repos,
      stars: totalStars,
      followers: user.followers,
      languages: Object.entries(languages)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([lang, count]) => ({ language: lang, repos: count })),
      accountAge: Math.floor((Date.now() - new Date(user.created_at)) / (1000 * 60 * 60 * 24 * 365)),
      recentActivity: repos[0] ? repos[0].updated_at : null
    };
  } catch (error) {
    return { error: error.message };
  }
}

module.exports = {
  fetchGitHubUser,
  fetchGitHubRepos,
  verifyGitHubProfile,
  getGitHubStats
};
