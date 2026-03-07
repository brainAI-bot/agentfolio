/**
 * Avatar CDN - Local avatar storage with optimization
 * 
 * Features:
 * - Upload avatars via multipart form or base64
 * - Auto-resize & optimize (WebP output, multiple sizes)
 * - Cache external avatar URLs locally
 * - Serve with long cache headers + ETag
 * - Fallback generated avatars (initials)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const http = require('http');
let sharp;
try { sharp = require('sharp'); } catch(e) { sharp = null; }

const AVATAR_DIR = path.join(__dirname, '..', '..', 'public', 'avatars');
const SIZES = { sm: 64, md: 128, lg: 256, xl: 512 };
const MAX_UPLOAD_SIZE = 5 * 1024 * 1024; // 5MB
const CACHE_MAX_AGE = 30 * 24 * 3600; // 30 days

// Ensure dirs exist
for (const size of Object.keys(SIZES)) {
  const dir = path.join(AVATAR_DIR, size);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
if (!fs.existsSync(path.join(AVATAR_DIR, 'original'))) {
  fs.mkdirSync(path.join(AVATAR_DIR, 'original'), { recursive: true });
}

/**
 * Process and save avatar from buffer
 * Returns the avatar ID (hash-based filename)
 */
async function processAvatar(buffer, profileId) {
  if (!sharp) {
    // Fallback: save as-is without optimization
    const hash = crypto.createHash('md5').update(buffer).digest('hex').slice(0, 12);
    const filename = `${profileId}-${hash}`;
    fs.writeFileSync(path.join(AVATAR_DIR, 'original', `${filename}.jpg`), buffer);
    // Copy to size dirs without resize
    for (const size of Object.keys(SIZES)) {
      fs.writeFileSync(path.join(AVATAR_DIR, size, `${filename}.webp`), buffer);
    }
    return filename;
  }

  const hash = crypto.createHash('md5').update(buffer).digest('hex').slice(0, 12);
  const filename = `${profileId}-${hash}`;

  // Save original
  fs.writeFileSync(path.join(AVATAR_DIR, 'original', `${filename}.jpg`), buffer);

  // Generate optimized sizes
  for (const [sizeName, pixels] of Object.entries(SIZES)) {
    await sharp(buffer)
      .resize(pixels, pixels, { fit: 'cover', position: 'center' })
      .webp({ quality: 85 })
      .toFile(path.join(AVATAR_DIR, sizeName, `${filename}.webp`));
  }

  // Also generate a JPEG fallback for the main size
  await sharp(buffer)
    .resize(256, 256, { fit: 'cover', position: 'center' })
    .jpeg({ quality: 85 })
    .toFile(path.join(AVATAR_DIR, 'lg', `${filename}.jpg`));

  return filename;
}

/**
 * Download and cache an external avatar URL
 */
function fetchExternalAvatar(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, { timeout: 10000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchExternalAvatar(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_UPLOAD_SIZE) {
          res.destroy();
          return reject(new Error('Image too large'));
        }
        chunks.push(chunk);
      });
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

/**
 * Cache an external avatar URL locally, return local path
 */
async function cacheExternalAvatar(externalUrl, profileId) {
  try {
    const buffer = await fetchExternalAvatar(externalUrl);
    const avatarId = await processAvatar(buffer, profileId);
    return avatarId;
  } catch (e) {
    console.error(`Failed to cache avatar for ${profileId}: ${e.message}`);
    return null;
  }
}

/**
 * Parse multipart form data (simple implementation for avatar upload)
 */
function parseMultipart(body, boundary) {
  const parts = body.split(`--${boundary}`);
  for (const part of parts) {
    if (part.includes('Content-Disposition') && part.includes('name="avatar"')) {
      const headerEnd = part.indexOf('\r\n\r\n');
      if (headerEnd === -1) continue;
      const data = part.slice(headerEnd + 4);
      // Remove trailing \r\n--
      const end = data.lastIndexOf('\r\n');
      return Buffer.from(end > 0 ? data.slice(0, end) : data, 'binary');
    }
  }
  return null;
}

/**
 * Get avatar URL for a profile (local CDN path)
 */
function getAvatarUrl(avatarId, size = 'lg') {
  if (!avatarId) return null;
  const webpPath = path.join(AVATAR_DIR, size, `${avatarId}.webp`);
  if (fs.existsSync(webpPath)) {
    return `/avatars/${size}/${avatarId}.webp`;
  }
  const jpgPath = path.join(AVATAR_DIR, size, `${avatarId}.jpg`);
  if (fs.existsSync(jpgPath)) {
    return `/avatars/${size}/${avatarId}.jpg`;
  }
  return null;
}

/**
 * Generate a simple SVG avatar with initials
 */
function generateInitialsAvatar(name) {
  const initials = (name || '?').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const colors = ['#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f97316', '#14b8a6', '#06b6d4', '#3b82f6'];
  const color = colors[name ? name.charCodeAt(0) % colors.length : 0];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
    <rect width="256" height="256" rx="32" fill="${color}"/>
    <text x="128" y="140" text-anchor="middle" fill="white" font-family="system-ui,sans-serif" font-size="96" font-weight="600">${initials}</text>
  </svg>`;
}

/**
 * Serve avatar with proper caching headers
 */
function serveAvatar(req, res, urlPath) {
  // Parse: /avatars/lg/profileid-hash.webp or /avatars/profileid-hash.webp
  const parts = urlPath.replace('/avatars/', '').split('/');
  let size, filename;
  
  if (parts.length === 2) {
    size = parts[0];
    filename = parts[1];
  } else if (parts.length === 1) {
    size = 'lg';
    filename = parts[0];
  } else {
    res.writeHead(404); res.end('Not found');
    return;
  }

  // Handle initials avatar: /avatars/initials/Name.svg
  if (size === 'initials') {
    const name = decodeURIComponent(filename.replace('.svg', ''));
    const svg = generateInitialsAvatar(name);
    res.writeHead(200, {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': `public, max-age=${CACHE_MAX_AGE}`,
    });
    res.end(svg);
    return;
  }

  if (!SIZES[size] && size !== 'original') {
    size = 'lg';
    filename = parts.join('/');
  }

  const filePath = path.join(AVATAR_DIR, size, filename);
  if (!fs.existsSync(filePath)) {
    // Try original
    const origPath = path.join(AVATAR_DIR, 'original', filename);
    if (fs.existsSync(origPath)) {
      serveFile(res, origPath);
      return;
    }
    res.writeHead(404); res.end('Not found');
    return;
  }

  serveFile(res, filePath);
}

function serveFile(res, filePath) {
  const stat = fs.statSync(filePath);
  const etag = `"${stat.size}-${stat.mtimeMs}"`;
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.png': 'image/png', '.gif': 'image/gif', '.svg': 'image/svg+xml'
  };

  res.writeHead(200, {
    'Content-Type': mimeTypes[ext] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': `public, max-age=${CACHE_MAX_AGE}, immutable`,
    'ETag': etag,
  });
  fs.createReadStream(filePath).pipe(res);
}

/**
 * Handle avatar upload request
 * POST /api/profile/:id/avatar
 * Body: multipart/form-data with "avatar" field, OR JSON { base64: "...", mimeType: "image/png" }, OR JSON { url: "https://..." }
 */
async function handleAvatarUpload(req, res, profileId, loadProfile, saveProfile) {
  const profile = loadProfile(profileId);
  if (!profile) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Profile not found' }));
    return;
  }

  // Collect body
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_UPLOAD_SIZE) {
      res.writeHead(413, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'File too large (max 5MB)' }));
      return;
    }
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks);

  let avatarBuffer;
  const contentType = req.headers['content-type'] || '';

  if (contentType.includes('multipart/form-data')) {
    const boundary = contentType.split('boundary=')[1];
    if (!boundary) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing boundary' }));
      return;
    }
    avatarBuffer = parseMultipart(body.toString('binary'), boundary);
  } else if (contentType.includes('application/json')) {
    try {
      const json = JSON.parse(body.toString());
      if (json.url) {
        avatarBuffer = await fetchExternalAvatar(json.url);
      } else if (json.base64) {
        avatarBuffer = Buffer.from(json.base64, 'base64');
      }
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON' }));
      return;
    }
  } else {
    // Raw binary
    avatarBuffer = body;
  }

  if (!avatarBuffer || avatarBuffer.length < 100) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'No valid image data' }));
    return;
  }

  try {
    const avatarId = await processAvatar(avatarBuffer, profileId);
    const avatarUrl = getAvatarUrl(avatarId) || `/avatars/lg/${avatarId}.webp`;

    // Update profile with local avatar URL
    profile.avatar = `https://agentfolio.bot${avatarUrl}`;
    profile.avatarCdn = avatarId;
    saveProfile(profile);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      avatarId,
      urls: {
        sm: `/avatars/sm/${avatarId}.webp`,
        md: `/avatars/md/${avatarId}.webp`,
        lg: `/avatars/lg/${avatarId}.webp`,
        xl: `/avatars/xl/${avatarId}.webp`,
        original: `/avatars/original/${avatarId}.jpg`,
      }
    }));
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Failed to process image: ' + e.message }));
  }
}

/**
 * Batch cache all external avatars for existing profiles
 */
async function cacheAllExternalAvatars(listProfiles, loadProfile, saveProfile) {
  const profiles = listProfiles();
  let cached = 0, failed = 0, skipped = 0;

  for (const p of profiles) {
    if (p.avatarCdn) { skipped++; continue; } // Already cached
    if (!p.avatar || !p.avatar.startsWith('http')) { skipped++; continue; }
    
    try {
      const profile = loadProfile(p.id);
      const avatarId = await cacheExternalAvatar(profile.avatar, p.id);
      if (avatarId) {
        profile.avatarCdn = avatarId;
        // Keep original URL as fallback
        profile.avatarOriginal = profile.avatar;
        profile.avatar = `https://agentfolio.bot/avatars/lg/${avatarId}.webp`;
        saveProfile(profile);
        cached++;
      } else {
        failed++;
      }
    } catch (e) {
      failed++;
    }
  }

  return { cached, failed, skipped, total: profiles.length };
}

module.exports = {
  processAvatar,
  cacheExternalAvatar,
  cacheAllExternalAvatars,
  getAvatarUrl,
  generateInitialsAvatar,
  serveAvatar,
  handleAvatarUpload,
  SIZES,
  AVATAR_DIR,
};
