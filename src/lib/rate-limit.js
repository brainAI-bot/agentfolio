/**
 * Simple in-memory rate limiter with logging
 */

const fs = require('fs');
const path = require('path');

const rateLimitStore = new Map();
const blockedRequestsLog = [];
const MAX_LOG_ENTRIES = 1000;

// Log file path
const LOG_DIR = path.join(__dirname, '..', '..', 'logs');
const RATE_LIMIT_LOG = path.join(LOG_DIR, 'rate-limit.log');

// Ensure log directory exists
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

// Clean up old entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, data] of rateLimitStore.entries()) {
    if (now - data.windowStart > 60000) {
      rateLimitStore.delete(key);
    }
  }
}, 300000);

/**
 * Log blocked request to file and memory
 */
function logBlockedRequest(ip, path, method, tier, limit) {
  const entry = {
    timestamp: new Date().toISOString(),
    ip,
    path,
    method,
    tier,
    limit
  };
  
  // Add to in-memory log (with cap)
  blockedRequestsLog.push(entry);
  if (blockedRequestsLog.length > MAX_LOG_ENTRIES) {
    blockedRequestsLog.shift();
  }
  
  // Append to log file
  const logLine = `${entry.timestamp} | BLOCKED | IP: ${ip} | ${method} ${path} | Tier: ${tier} (${limit}/min)\n`;
  try {
    fs.appendFileSync(RATE_LIMIT_LOG, logLine);
  } catch (e) {
    console.error('[RateLimit] Failed to write log:', e.message);
  }
  
  console.log(`[RateLimit] BLOCKED: ${ip} - ${method} ${path} (${tier}: ${limit}/min)`);
}

/**
 * Get recent blocked requests
 */
function getBlockedRequests(limit = 100) {
  return blockedRequestsLog.slice(-limit).reverse();
}

/**
 * Get rate limit statistics
 */
function getRateLimitStats() {
  const now = Date.now();
  const activeClients = [];
  
  for (const [key, data] of rateLimitStore.entries()) {
    if (now - data.windowStart <= 60000) {
      activeClients.push({
        ip: key,
        requests: data.count,
        windowStart: new Date(data.windowStart).toISOString()
      });
    }
  }
  
  return {
    activeClients: activeClients.length,
    totalBlocked: blockedRequestsLog.length,
    recentBlocked: blockedRequestsLog.slice(-10).reverse(),
    topClients: activeClients.sort((a, b) => b.requests - a.requests).slice(0, 10)
  };
}

/**
 * Check if request should be rate limited
 * @param {string} key - identifier (usually IP)
 * @param {number} limit - max requests per window
 * @param {number} windowMs - window size in ms
 * @returns {object} { limited: boolean, remaining: number, resetMs: number }
 */
function checkRateLimit(key, limit = 100, windowMs = 60000) {
  const now = Date.now();
  let data = rateLimitStore.get(key);

  if (!data || now - data.windowStart > windowMs) {
    // New window
    data = { count: 1, windowStart: now };
    rateLimitStore.set(key, data);
    return { limited: false, remaining: limit - 1, resetMs: windowMs };
  }

  data.count++;
  
  if (data.count > limit) {
    const resetMs = windowMs - (now - data.windowStart);
    return { limited: true, remaining: 0, resetMs };
  }

  return { limited: false, remaining: limit - data.count, resetMs: windowMs - (now - data.windowStart) };
}

/**
 * Apply rate limit headers to response
 */
function applyRateLimitHeaders(res, limit, remaining, resetMs) {
  res.setHeader('X-RateLimit-Limit', limit);
  res.setHeader('X-RateLimit-Remaining', Math.max(0, remaining));
  res.setHeader('X-RateLimit-Reset', Math.ceil((Date.now() + resetMs) / 1000));
}

/**
 * Handle rate limited response
 */
function handleRateLimited(res, resetMs) {
  res.writeHead(429, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    error: 'Too many requests',
    message: 'Rate limit exceeded. Please slow down.',
    retryAfter: Math.ceil(resetMs / 1000)
  }));
}

/**
 * Rate limit middleware for http server
 */
function rateLimitMiddleware(req, res, options = {}) {
  const { limit = 100, windowMs = 60000, keyFn, tier = 'api' } = options;
  
  // Get client IP
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 
             req.socket?.remoteAddress || 
             'unknown';
  
  // Whitelist localhost/loopback from rate limiting
  const normalizedIp = ip.replace(/^::ffff:/, '');
  if (normalizedIp === '127.0.0.1' || normalizedIp === '::1' || normalizedIp === 'localhost') {
    return true;
  }
  
  const key = keyFn ? keyFn(req) : ip;
  const result = checkRateLimit(key, limit, windowMs);

  // Set rate limit headers
  applyRateLimitHeaders(res, limit, result.remaining, result.resetMs);

  if (result.limited) {
    // Log the blocked request
    logBlockedRequest(ip, req.url, req.method, tier, limit);
    handleRateLimited(res, result.resetMs);
    return false;
  }

  return true;
}

/**
 * Different rate limit tiers
 */
const RATE_LIMITS = {
  // Read operations: 100/min
  read: { limit: 100, windowMs: 60000, tier: 'read' },
  // General API: 100/min
  api: { limit: 100, windowMs: 60000, tier: 'api' },
  // Search: 30/min (more expensive)
  search: { limit: 30, windowMs: 60000, tier: 'search' },
  // Write operations: 10/min
  write: { limit: 30, windowMs: 60000, tier: 'write' },
  // Verification triggers: 5/min
  verify: { limit: 15, windowMs: 60000, tier: 'verify' }
};

module.exports = {
  checkRateLimit,
  rateLimitMiddleware,
  applyRateLimitHeaders,
  handleRateLimited,
  RATE_LIMITS,
  getBlockedRequests,
  getRateLimitStats,
  logBlockedRequest
};
