/**
 * Security Headers Module
 * Adds security headers to protect against common web vulnerabilities
 */

/**
 * Security header configuration
 */
const SECURITY_CONFIG = {
  // Content Security Policy - allows inline scripts/styles for SSR app
  csp: [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https: blob:",
    "connect-src 'self' https://api.phantom.app https://api.solana.fm https://solana-mainnet.g.alchemy.com wss:",
    "frame-ancestors 'self'",
    "form-action 'self'",
    "base-uri 'self'"
  ].join('; '),
  
  // Allowed origins for CORS
  allowedOrigins: [
    'https://agentfolio.bot',
    'http://localhost:3333',
    'http://127.0.0.1:3333'
  ],
  
  // Methods allowed for CORS
  allowedMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  
  // Headers allowed in requests
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'X-API-Key',
    'Accept'
  ]
};

/**
 * Apply security headers to response
 * @param {http.ServerResponse} res - Response object
 * @param {http.IncomingMessage} req - Request object (for CORS origin check)
 */
function applySecurityHeaders(res, req = null) {
  // Prevent clickjacking
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  
  // Prevent MIME type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');
  
  // XSS Protection (legacy, but still useful for older browsers)
  res.setHeader('X-XSS-Protection', '1; mode=block');
  
  // Referrer Policy - don't leak referrer to other origins
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  // Content Security Policy
  res.setHeader('Content-Security-Policy', SECURITY_CONFIG.csp);
  
  // Permissions Policy (formerly Feature-Policy)
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  
  // HSTS - force HTTPS (1 year)
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  
  // CORS headers
  const origin = req?.headers?.origin;
  if (origin && SECURITY_CONFIG.allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    // For API access, allow all origins but be more restrictive on credentials
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  
  res.setHeader('Access-Control-Allow-Methods', SECURITY_CONFIG.allowedMethods.join(', '));
  res.setHeader('Access-Control-Allow-Headers', SECURITY_CONFIG.allowedHeaders.join(', '));
  res.setHeader('Access-Control-Max-Age', '86400'); // 24 hours preflight cache
}

/**
 * Handle CORS preflight requests
 * @param {http.ServerResponse} res - Response object
 * @param {http.IncomingMessage} req - Request object
 * @returns {boolean} - True if this was a preflight request (handled)
 */
function handlePreflight(req, res) {
  if (req.method === 'OPTIONS') {
    applySecurityHeaders(res, req);
    res.writeHead(204); // No Content
    res.end();
    return true;
  }
  return false;
}

/**
 * Validate content type for POST/PUT requests
 * @param {http.IncomingMessage} req - Request object
 * @returns {boolean} - True if content type is valid
 */
function validateContentType(req) {
  if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
    const contentType = req.headers['content-type'] || '';
    // Allow JSON and form data
    return contentType.includes('application/json') || 
           contentType.includes('application/x-www-form-urlencoded') ||
           contentType.includes('multipart/form-data') ||
           contentType === ''; // Allow empty for simple requests
  }
  return true;
}

/**
 * Sanitize user input to prevent XSS
 * @param {string} input - User input string
 * @returns {string} - Sanitized string
 */
function sanitizeInput(input) {
  if (typeof input !== 'string') return input;
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

/**
 * Check if request path looks suspicious
 * @param {string} path - Request path
 * @returns {boolean} - True if path looks safe
 */
function isPathSafe(path) {
  const suspiciousPatterns = [
    /\.\./,           // Path traversal
    /\.php/i,         // PHP file requests
    /\.asp/i,         // ASP file requests
    /\.jsp/i,         // JSP file requests
    /wp-admin/i,      // WordPress admin
    /wp-login/i,      // WordPress login
    /phpinfo/i,       // PHP info exposure
    /\.env/,          // Environment file
    /\.git/,          // Git directory
    /\.htaccess/i,    // Apache config
    /\/etc\//,        // System files
    /\/proc\//,       // Linux proc
    /%00/,            // Null byte injection
    /<script/i,       // XSS in URL
    /SELECT.*FROM/i,  // SQL injection
    /UNION.*SELECT/i  // SQL injection
  ];
  
  return !suspiciousPatterns.some(pattern => pattern.test(path));
}

/**
 * Log suspicious request
 * @param {http.IncomingMessage} req - Request object
 * @param {string} reason - Reason for suspicion
 */
function logSuspiciousRequest(req, reason) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 
             req.socket?.remoteAddress || 
             'unknown';
  const userAgent = req.headers['user-agent'] || 'unknown';
  
  console.warn(`[Security] SUSPICIOUS: ${ip} - ${req.method} ${req.url} - ${reason} - UA: ${userAgent}`);
}

/**
 * Security middleware - apply all security measures
 * @param {http.IncomingMessage} req - Request object
 * @param {http.ServerResponse} res - Response object
 * @returns {boolean} - True if request should proceed, false if blocked
 */
function securityMiddleware(req, res) {
  // Apply security headers to all responses
  applySecurityHeaders(res, req);
  
  // Handle CORS preflight
  if (handlePreflight(req, res)) {
    return false; // Request handled
  }
  
  // Check for suspicious paths
  const url = new URL(req.url, `http://localhost`);
  if (!isPathSafe(url.pathname)) {
    logSuspiciousRequest(req, 'Suspicious path pattern');
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Bad request' }));
    return false;
  }
  
  // Validate content type for write requests
  if (!validateContentType(req)) {
    logSuspiciousRequest(req, 'Invalid content type');
    res.writeHead(415, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unsupported Media Type' }));
    return false;
  }
  
  return true;
}

module.exports = {
  applySecurityHeaders,
  handlePreflight,
  validateContentType,
  sanitizeInput,
  isPathSafe,
  logSuspiciousRequest,
  securityMiddleware,
  SECURITY_CONFIG
};
