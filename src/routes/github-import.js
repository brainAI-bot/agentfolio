/**
 * GitHub Profile Import — Backend Routes
 * Scrapes a GitHub profile/org and auto-populates an AgentFolio draft profile.
 * 
 * Endpoints:
 *   GET  /api/import/github/preview?username=XXX  — Preview what we'd import
 *   POST /api/import/github/create                — Create profile from GitHub data
 */

const GITHUB_API = 'https://api.github.com';

// Rate limit: 60 req/hr unauthenticated
const importAttempts = new Map(); // ip -> { count, windowStart }
const IMPORT_WINDOW_MS = 60 * 60 * 1000;
const MAX_IMPORTS_PER_HOUR = 10;

function checkImportLimit(ip) {
  const now = Date.now();
  const attempts = importAttempts.get(ip);
  if (!attempts || (now - attempts.windowStart > IMPORT_WINDOW_MS)) {
    importAttempts.set(ip, { count: 1, windowStart: now });
    return true;
  }
  if (attempts.count >= MAX_IMPORTS_PER_HOUR) return false;
  attempts.count++;
  return true;
}

async function fetchGitHub(path) {
  const headers = { 'User-Agent': 'AgentFolio/1.0', Accept: 'application/vnd.github.v3+json' };
  const token = process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  
  const res = await fetch(`${GITHUB_API}${path}`, { headers, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${res.statusText}`);
  return res.json();
}

function extractLanguages(repos) {
  const langCount = {};
  for (const repo of repos) {
    if (repo.language) {
      langCount[repo.language] = (langCount[repo.language] || 0) + (repo.stargazers_count || 1);
    }
  }
  return Object.entries(langCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([lang]) => lang);
}

function extractTopRepos(repos, limit = 5) {
  return repos
    .filter(r => !r.fork && !r.archived)
    .sort((a, b) => (b.stargazers_count || 0) - (a.stargazers_count || 0))
    .slice(0, limit)
    .map(r => ({
      name: r.name,
      description: r.description || '',
      stars: r.stargazers_count || 0,
      language: r.language || '',
      url: r.html_url,
      updatedAt: r.pushed_at || r.updated_at,
    }));
}

function buildSkills(languages, repos) {
  const skills = [];
  // Languages as skills
  for (const lang of languages.slice(0, 5)) {
    skills.push({ name: lang, category: 'language' });
  }
  // Infer skills from repo topics/names
  const topicSet = new Set();
  for (const repo of repos) {
    if (repo.topics) repo.topics.forEach(t => topicSet.add(t));
  }
  const knownSkills = ['machine-learning', 'ai', 'blockchain', 'solana', 'ethereum', 'defi', 'nft', 
    'web3', 'react', 'nextjs', 'typescript', 'rust', 'python', 'api', 'llm', 'agent', 'chatbot'];
  for (const topic of topicSet) {
    if (knownSkills.includes(topic) && !skills.find(s => s.name.toLowerCase() === topic)) {
      skills.push({ name: topic, category: 'topic' });
    }
  }
  return skills.slice(0, 10);
}

/**
 * Register GitHub import routes
 * @param {import('express').Express} app
 * @param {Function} getDb
 */
function registerGitHubImportRoutes(app, getDb) {

  // ── GET /api/import/github/preview ────────────────────────────
  app.get('/api/import/github/preview', async (req, res) => {
    try {
      const { username } = req.query;
      if (!username || typeof username !== 'string') {
        return res.status(400).json({ error: 'username query parameter required' });
      }

      const ip = req.headers['x-forwarded-for'] || req.ip || 'unknown';
      if (!checkImportLimit(ip)) {
        return res.status(429).json({ error: 'Rate limit exceeded. Try again later.' });
      }

      // Check if profile already exists
      const db = getDb();
      const existing = db.prepare("SELECT id, name FROM profiles WHERE LOWER(name) = LOWER(?) OR id = ?")
        .get(username.trim(), `agent_${username.toLowerCase().trim()}`);
      
      // Fetch GitHub profile
      const profile = await fetchGitHub(`/users/${encodeURIComponent(username.trim())}`);
      
      // Fetch repos (sorted by stars)
      const repos = await fetchGitHub(`/users/${encodeURIComponent(username.trim())}/repos?sort=stars&per_page=30`);
      
      const languages = extractLanguages(repos);
      const topRepos = extractTopRepos(repos);
      const skills = buildSkills(languages, repos);
      
      const totalStars = repos.reduce((sum, r) => sum + (r.stargazers_count || 0), 0);
      
      const preview = {
        github: {
          login: profile.login,
          name: profile.name || profile.login,
          bio: profile.bio || '',
          avatar: profile.avatar_url,
          website: profile.blog || '',
          twitter: profile.twitter_username || '',
          company: profile.company || '',
          location: profile.location || '',
          publicRepos: profile.public_repos || 0,
          followers: profile.followers || 0,
          type: profile.type, // 'User' or 'Organization'
          createdAt: profile.created_at,
        },
        stats: {
          totalStars,
          topLanguages: languages,
          totalRepos: repos.length,
        },
        topRepos,
        skills,
        // Pre-filled profile data for import
        draft: {
          name: profile.name || profile.login,
          handle: profile.login,
          bio: profile.bio || `${profile.name || profile.login} — ${profile.public_repos} repos, ${totalStars} stars on GitHub`,
          avatar: profile.avatar_url,
          links: {
            github: `https://github.com/${profile.login}`,
            website: profile.blog || undefined,
            x: profile.twitter_username ? `https://x.com/${profile.twitter_username}` : undefined,
          },
          skills,
          framework: languages[0] || '',
          tags: languages.slice(0, 5),
        },
        existing: existing ? { id: existing.id, name: existing.name } : null,
      };

      res.json(preview);
    } catch (err) {
      console.error('[GitHub Import] preview error:', err.message);
      if (err.message.includes('404')) {
        return res.status(404).json({ error: `GitHub user '${req.query.username}' not found` });
      }
      res.status(500).json({ error: 'Failed to fetch GitHub profile' });
    }
  });

  // ── POST /api/import/github/create ────────────────────────────
  app.post('/api/import/github/create', async (req, res) => {
    try {
      const { username, wallet, signature, signedMessage, overrides } = req.body;
      if (!username) return res.status(400).json({ error: 'username required' });
      if (!wallet) return res.status(400).json({ error: 'wallet required — connect your Solana wallet' });
      if (!signature || !signedMessage) return res.status(400).json({ error: 'signature + signedMessage required for wallet proof' });

      const ip = req.headers['x-forwarded-for'] || req.ip || 'unknown';
      if (!checkImportLimit(ip)) {
        return res.status(429).json({ error: 'Rate limit exceeded' });
      }

      // Verify wallet signature
      try {
        const nacl = require('tweetnacl');
        const bs58 = require('bs58');
        const msgBytes = Buffer.from(signedMessage);
        const sigBytes = Buffer.from(signature, 'base64');
        const pubBytes = bs58.decode(wallet);
        if (!nacl.sign.detached.verify(msgBytes, sigBytes, pubBytes)) {
          return res.status(401).json({ error: 'Invalid wallet signature' });
        }
      } catch (e) {
        return res.status(401).json({ error: 'Signature verification failed' });
      }

      // Fetch GitHub data
      const profile = await fetchGitHub(`/users/${encodeURIComponent(username.trim())}`);
      const repos = await fetchGitHub(`/users/${encodeURIComponent(username.trim())}/repos?sort=stars&per_page=30`);
      
      const languages = extractLanguages(repos);
      const topRepos = extractTopRepos(repos);
      const skills = buildSkills(languages, repos);
      const totalStars = repos.reduce((sum, r) => sum + (r.stargazers_count || 0), 0);

      // Build profile data (allow overrides)
      const name = overrides?.name || profile.name || profile.login;
      const handle = profile.login;
      const bio = overrides?.bio || profile.bio || `${name} — ${profile.public_repos} repos, ${totalStars} stars on GitHub`;
      const avatar = overrides?.avatar || profile.avatar_url;

      // Check for existing profile
      const db = getDb();
      const existing = db.prepare("SELECT id FROM profiles WHERE LOWER(name) = LOWER(?) OR id = ?")
        .get(name, `agent_${handle.toLowerCase()}`);
      if (existing) {
        return res.status(409).json({ error: 'A profile with this name already exists', existingId: existing.id });
      }

      // Forward to the register endpoint internally (reuse existing registration logic)
      const registerData = {
        name,
        handle,
        description: bio,
        bio,
        avatar,
        wallet,
        wallets: { solana: wallet },
        signature,
        signedMessage,
        skills: skills.map(s => s.name),
        links: {
          github: `https://github.com/${profile.login}`,
          website: profile.blog || undefined,
          x: profile.twitter_username ? `https://x.com/${profile.twitter_username}` : undefined,
          ...(overrides?.links || {}),
        },
        tags: languages.slice(0, 5),
        framework: languages[0] || '',
        capabilities: topRepos.slice(0, 3).map(r => r.name),
        metadata: {
          importedFrom: 'github',
          githubUsername: profile.login,
          githubType: profile.type,
          githubFollowers: profile.followers,
          githubStars: totalStars,
          githubRepos: profile.public_repos,
          importedAt: new Date().toISOString(),
        },
      };

      // Use internal fetch to register endpoint
      const port = process.env.PORT || 3333;
      const registerRes = await fetch(`http://localhost:${port}/api/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(registerData),
      });
      const registerResult = await registerRes.json();

      if (registerResult.error) {
        return res.status(registerRes.status || 400).json({ error: registerResult.error });
      }

      console.log(`✅ [GitHub Import] Created profile for ${profile.login} (${registerResult.id}) — ${totalStars} stars, ${profile.public_repos} repos`);

      res.json({
        success: true,
        profileId: registerResult.id,
        profileUrl: `/profile/${registerResult.id}`,
        imported: {
          name,
          handle,
          stars: totalStars,
          repos: profile.public_repos,
          languages: languages.slice(0, 5),
        },
      });
    } catch (err) {
      console.error('[GitHub Import] create error:', err.message);
      if (err.message.includes('404')) {
        return res.status(404).json({ error: `GitHub user not found` });
      }
      res.status(500).json({ error: 'Failed to import from GitHub' });
    }
  });

  console.log('✅ GitHub import routes registered: /api/import/github/preview, /api/import/github/create');
}

module.exports = { registerGitHubImportRoutes };
