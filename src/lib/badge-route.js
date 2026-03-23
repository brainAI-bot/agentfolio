// Badge route handler — add to server.js URL routing
// GET /api/badge/:profileId — returns SVG trust badge
// GET /api/badge/:profileId?style=flat — flat style

const { generateBadgeSVG } = require('./badge');
const { loadProfile } = require('./profile');
const { getCanonicalScore } = require('./chain-cache');

function handleBadgeRequest(url, req, res) {
  const match = url.pathname.match(/^\/api\/badge\/(.+)$/);
  if (!match) return false;
  
  const profileId = match[1].replace('.svg', '');
  const profile = loadProfile(profileId);
  
  if (!profile) {
    const svg = generateBadgeSVG('Unknown', 0, 0, 'unknown');
    res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=300' });
    res.end(svg);
    return true;
  }
  
  const { score, tier } = getCanonicalScore(profile);
  const level = profile.verificationLevel || 0;
  const svg = generateBadgeSVG(profile.name, score, level, tier);
  
  res.writeHead(200, { 
    'Content-Type': 'image/svg+xml',
    'Cache-Control': 'public, max-age=300'
  });
  res.end(svg);
  return true;
}

module.exports = { handleBadgeRequest };
