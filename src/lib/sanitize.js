/**
 * Input Sanitization Library for AgentFolio
 * Provides server-side HTML escaping and input validation
 * 
 * Security audit: BUILD-017 (2026-02-11)
 */

// HTML entity map for escaping
const HTML_ENTITIES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#x27;',
  '/': '&#x2F;',
  '`': '&#x60;',
  '=': '&#x3D;'
};

/**
 * Escape HTML entities to prevent XSS
 * @param {string} str - Input string
 * @returns {string} - Escaped string safe for HTML output
 */
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  if (typeof str !== 'string') str = String(str);
  return str.replace(/[&<>"'`=\/]/g, char => HTML_ENTITIES[char]);
}

/**
 * Escape for use in HTML attributes
 * More aggressive escaping for attribute contexts
 * @param {string} str - Input string
 * @returns {string} - Escaped string safe for HTML attributes
 */
function escapeAttr(str) {
  if (str === null || str === undefined) return '';
  if (typeof str !== 'string') str = String(str);
  // Escape all non-alphanumeric characters
  return str.replace(/[^\w\s\-\.]/g, char => {
    const code = char.charCodeAt(0);
    return `&#x${code.toString(16).toUpperCase()};`;
  });
}

/**
 * Escape for use in JavaScript string contexts
 * @param {string} str - Input string
 * @returns {string} - Escaped string safe for JS strings
 */
function escapeJs(str) {
  if (str === null || str === undefined) return '';
  if (typeof str !== 'string') str = String(str);
  return str
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
    .replace(/</g, '\\x3C')
    .replace(/>/g, '\\x3E')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * Escape for URL parameter context
 * @param {string} str - Input string
 * @returns {string} - URL encoded string
 */
function escapeUrl(str) {
  if (str === null || str === undefined) return '';
  if (typeof str !== 'string') str = String(str);
  return encodeURIComponent(str);
}

/**
 * Strip HTML tags entirely (for plain text output)
 * @param {string} str - Input string
 * @returns {string} - String with HTML tags removed
 */
function stripHtml(str) {
  if (str === null || str === undefined) return '';
  if (typeof str !== 'string') str = String(str);
  return str.replace(/<[^>]*>/g, '').replace(/&[^;]+;/g, ' ').trim();
}

/**
 * Validate and sanitize a URL
 * Only allows http, https protocols
 * @param {string} url - Input URL
 * @returns {string|null} - Sanitized URL or null if invalid
 */
function sanitizeUrl(url) {
  if (!url || typeof url !== 'string') return null;
  url = url.trim();
  
  // Check for javascript: or data: URLs
  const lowerUrl = url.toLowerCase();
  if (lowerUrl.startsWith('javascript:') || 
      lowerUrl.startsWith('data:') ||
      lowerUrl.startsWith('vbscript:')) {
    return null;
  }
  
  // Only allow http(s) or relative URLs
  if (!url.startsWith('http://') && 
      !url.startsWith('https://') && 
      !url.startsWith('/') &&
      !url.startsWith('./')) {
    // Assume https if no protocol
    if (url.match(/^[\w\-\.]+\.[a-z]{2,}/i)) {
      url = 'https://' + url;
    } else {
      return null;
    }
  }
  
  return url;
}

/**
 * Validate email format
 * @param {string} email - Input email
 * @returns {boolean} - True if valid email format
 */
function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  // Basic email regex - intentionally not too strict
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/**
 * Sanitize text content for storage
 * Removes control characters but preserves formatting
 * @param {string} str - Input string
 * @param {object} options - Options
 * @param {number} options.maxLength - Maximum length (default: 10000)
 * @param {boolean} options.allowNewlines - Allow newlines (default: true)
 * @returns {string} - Sanitized string
 */
function sanitizeText(str, options = {}) {
  if (str === null || str === undefined) return '';
  if (typeof str !== 'string') str = String(str);
  
  const { maxLength = 10000, allowNewlines = true } = options;
  
  // Remove null bytes and other control characters (except newlines/tabs if allowed)
  if (allowNewlines) {
    str = str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  } else {
    str = str.replace(/[\x00-\x1F\x7F]/g, ' ');
  }
  
  // Normalize unicode (NFC form)
  str = str.normalize('NFC');
  
  // Trim excessive whitespace
  str = str.replace(/[ \t]+/g, ' ');
  if (allowNewlines) {
    str = str.replace(/\n{3,}/g, '\n\n');
  }
  
  // Truncate if too long
  if (str.length > maxLength) {
    str = str.slice(0, maxLength);
  }
  
  return str.trim();
}

/**
 * Sanitize a name/handle (alphanumeric + limited special chars)
 * @param {string} str - Input string
 * @param {number} maxLength - Maximum length (default: 100)
 * @returns {string} - Sanitized name
 */
function sanitizeName(str, maxLength = 100) {
  if (!str || typeof str !== 'string') return '';
  
  // Allow alphanumeric, spaces, hyphens, underscores, periods
  str = str.replace(/[^\w\s\-\.]/g, '').trim();
  
  if (str.length > maxLength) {
    str = str.slice(0, maxLength);
  }
  
  return str;
}

/**
 * Sanitize a Twitter/social handle
 * @param {string} handle - Input handle
 * @returns {string} - Sanitized handle
 */
function sanitizeHandle(handle) {
  if (!handle || typeof handle !== 'string') return '';
  
  // Remove @ prefix if present
  handle = handle.replace(/^@/, '');
  
  // Only allow alphanumeric and underscores
  handle = handle.replace(/[^\w]/g, '');
  
  // X handles max 15 chars
  if (handle.length > 15) {
    handle = handle.slice(0, 15);
  }
  
  return handle ? '@' + handle : '';
}

/**
 * Sanitize skills array
 * @param {Array} skills - Array of skill objects or strings
 * @returns {Array} - Sanitized skills array
 */
function sanitizeSkills(skills) {
  if (!Array.isArray(skills)) return [];
  
  return skills
    .slice(0, 50) // Max 50 skills
    .map(skill => {
      if (typeof skill === 'string') {
        return {
          name: sanitizeText(skill, { maxLength: 100, allowNewlines: false }),
          category: 'Other',
          verified: false,
          proofs: []
        };
      }
      if (typeof skill === 'object' && skill !== null) {
        return {
          name: sanitizeText(skill.name || '', { maxLength: 100, allowNewlines: false }),
          category: sanitizeText(skill.category || 'Other', { maxLength: 50, allowNewlines: false }),
          verified: Boolean(skill.verified),
          proofs: Array.isArray(skill.proofs) ? skill.proofs.slice(0, 10) : []
        };
      }
      return null;
    })
    .filter(s => s && s.name);
}

/**
 * Sanitize profile data for creation/update
 * @param {object} data - Profile data
 * @returns {object} - Sanitized profile data
 */
function sanitizeProfileData(data) {
  if (!data || typeof data !== 'object') return {};
  
  const sanitized = {};
  
  if (data.name !== undefined) {
    sanitized.name = sanitizeName(data.name, 100);
  }
  
  if (data.handle !== undefined) {
    sanitized.handle = sanitizeHandle(data.handle);
  }
  
  if (data.bio !== undefined) {
    sanitized.bio = sanitizeText(data.bio, { maxLength: 2000, allowNewlines: true });
  }
  
  if (data.avatar !== undefined) {
    sanitized.avatar = sanitizeUrl(data.avatar);
  }
  
  if (data.skills !== undefined) {
    sanitized.skills = sanitizeSkills(data.skills);
  }
  
  // Sanitize links
  if (data.links || data.twitter || data.github || data.website || data.moltbook || data.agentmail) {
    sanitized.links = {};
    const links = data.links || data;
    
    if (links.x) sanitized.links.twitter = sanitizeHandle(links.x);
    if (links.github) sanitized.links.github = sanitizeName(links.github, 39);
    if (links.website) sanitized.links.website = sanitizeUrl(links.website);
    if (links.moltbook) sanitized.links.moltbook = sanitizeName(links.moltbook, 100);
    if (links.agentmail) {
      const email = links.agentmail;
      sanitized.links.agentmail = isValidEmail(email) ? email.trim().toLowerCase() : null;
    }
  }
  
  // Sanitize wallet addresses (hex validation)
  if (data.wallets || data.hyperliquid || data.solana || data.ethereum) {
    sanitized.wallets = {};
    const wallets = data.wallets || data;
    
    // Ethereum/Hyperliquid addresses
    if (wallets.hyperliquid) {
      const addr = wallets.hyperliquid;
      if (/^0x[a-fA-F0-9]{40}$/.test(addr)) {
        sanitized.wallets.hyperliquid = addr.toLowerCase();
      }
    }
    if (wallets.ethereum) {
      const addr = wallets.ethereum;
      if (/^0x[a-fA-F0-9]{40}$/.test(addr)) {
        sanitized.wallets.ethereum = addr.toLowerCase();
      }
    }
    // Solana addresses (base58, 32-44 chars)
    if (wallets.solana) {
      const addr = wallets.solana;
      if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr)) {
        sanitized.wallets.solana = addr;
      }
    }
  }
  
  return sanitized;
}

/**
 * Sanitize job data for creation/update
 * @param {object} data - Job data
 * @returns {object} - Sanitized job data
 */
function sanitizeJobData(data) {
  if (!data || typeof data !== 'object') return {};
  
  const sanitized = {};
  
  if (data.title !== undefined) {
    sanitized.title = sanitizeText(data.title, { maxLength: 200, allowNewlines: false });
  }
  
  if (data.description !== undefined) {
    sanitized.description = sanitizeText(data.description, { maxLength: 10000, allowNewlines: true });
  }
  
  if (data.requirements !== undefined) {
    sanitized.requirements = sanitizeText(data.requirements, { maxLength: 5000, allowNewlines: true });
  }
  
  if (data.skills !== undefined) {
    sanitized.skills = (Array.isArray(data.skills) ? data.skills : [])
      .slice(0, 20)
      .map(s => sanitizeText(String(s), { maxLength: 100, allowNewlines: false }))
      .filter(Boolean);
  }
  
  if (data.category !== undefined) {
    const validCategories = ['development', 'research', 'trading', 'creative', 'automation', 'other'];
    sanitized.category = validCategories.includes(data.category) ? data.category : 'other';
  }
  
  if (data.budgetAmount !== undefined) {
    const amount = parseFloat(data.budgetAmount);
    sanitized.budgetAmount = isNaN(amount) || amount < 0 ? 0 : Math.min(amount, 1000000);
  }
  
  if (data.timeline !== undefined) {
    const validTimelines = ['urgent', '1_week', '2_weeks', '1_month', 'flexible'];
    sanitized.timeline = validTimelines.includes(data.timeline) ? data.timeline : 'flexible';
  }
  
  return sanitized;
}

/**
 * Sanitize review/comment data
 * @param {object} data - Review data
 * @returns {object} - Sanitized review data
 */
function sanitizeReviewData(data) {
  if (!data || typeof data !== 'object') return {};
  
  const sanitized = {};
  
  if (data.rating !== undefined) {
    const rating = parseInt(data.rating, 10);
    sanitized.rating = isNaN(rating) ? 0 : Math.max(1, Math.min(5, rating));
  }
  
  if (data.comment !== undefined) {
    sanitized.comment = sanitizeText(data.comment, { maxLength: 2000, allowNewlines: true });
  }
  
  return sanitized;
}

/**
 * Detect potential XSS patterns in input
 * @param {string} str - Input string
 * @returns {boolean} - True if suspicious patterns detected
 */
function hasSuspiciousPatterns(str) {
  if (!str || typeof str !== 'string') return false;
  
  const lowerStr = str.toLowerCase();
  
  // Common XSS patterns
  const patterns = [
    /<script/i,
    /javascript:/i,
    /on\w+\s*=/i,  // onclick=, onerror=, etc.
    /data:\s*text\/html/i,
    /<iframe/i,
    /<object/i,
    /<embed/i,
    /<form/i,
    /expression\s*\(/i,  // CSS expression
    /url\s*\(\s*['"]?\s*javascript/i
  ];
  
  return patterns.some(p => p.test(str));
}

// Audit report function
function generateAuditReport() {
  return {
    library: 'sanitize.js',
    version: '1.0.0',
    createdAt: '2026-02-11',
    task: 'BUILD-017',
    functions: [
      { name: 'escapeHtml', purpose: 'HTML entity escaping for safe rendering' },
      { name: 'escapeAttr', purpose: 'Aggressive escaping for HTML attributes' },
      { name: 'escapeJs', purpose: 'JavaScript string context escaping' },
      { name: 'escapeUrl', purpose: 'URL parameter encoding' },
      { name: 'stripHtml', purpose: 'Remove all HTML tags' },
      { name: 'sanitizeUrl', purpose: 'Validate and sanitize URLs' },
      { name: 'sanitizeText', purpose: 'Clean text for storage' },
      { name: 'sanitizeName', purpose: 'Clean names/handles' },
      { name: 'sanitizeSkills', purpose: 'Validate skills array' },
      { name: 'sanitizeProfileData', purpose: 'Full profile input validation' },
      { name: 'sanitizeJobData', purpose: 'Job posting validation' },
      { name: 'sanitizeReviewData', purpose: 'Review/comment validation' },
      { name: 'hasSuspiciousPatterns', purpose: 'XSS pattern detection' }
    ],
    inputPoints: [
      { endpoint: 'POST /api/register', fields: ['name', 'handle', 'bio', 'skills', 'links', 'wallets'] },
      { endpoint: 'POST /api/profiles', fields: ['name', 'handle', 'bio', 'skills', 'links', 'wallets'] },
      { endpoint: 'PATCH /api/profile/:id', fields: ['bio', 'skills', 'links', 'wallets'] },
      { endpoint: 'POST /api/marketplace/jobs', fields: ['title', 'description', 'skills', 'requirements'] },
      { endpoint: 'POST /api/marketplace/jobs/:id/apply', fields: ['coverMessage', 'proposedBudget'] },
      { endpoint: 'POST /api/marketplace/jobs/:id/review', fields: ['rating', 'comment'] },
      { endpoint: 'POST /api/profile/:id/report', fields: ['reason', 'details'] },
      { endpoint: 'POST /api/profile/:id/endorsements', fields: ['message'] }
    ]
  };
}

module.exports = {
  escapeHtml,
  escapeAttr,
  escapeJs,
  escapeUrl,
  stripHtml,
  sanitizeUrl,
  isValidEmail,
  sanitizeText,
  sanitizeName,
  sanitizeHandle,
  sanitizeSkills,
  sanitizeProfileData,
  sanitizeJobData,
  sanitizeReviewData,
  hasSuspiciousPatterns,
  generateAuditReport
};
