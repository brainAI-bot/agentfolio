/**
 * Health Check & Monitoring Library
 * Production reliability infrastructure for AgentFolio
 */

const os = require('os');
const fs = require('fs');
const path = require('path');

// Server start time for uptime calculation
const SERVER_START_TIME = Date.now();

// Request counters
const requestStats = {
  total: 0,
  success: 0,
  errors: 0,
  byMethod: {},
  byEndpoint: {},
  recentErrors: []
};

// Max recent errors to keep
const MAX_RECENT_ERRORS = 50;

/**
 * Record a request
 * Can be called without args (just increments total) or with full details
 */
function recordRequest(method, endpoint, statusCode, duration) {
  requestStats.total++;
  
  // If called without args, just increment total and return
  if (!method || !endpoint) {
    return;
  }
  
  if (statusCode >= 200 && statusCode < 400) {
    requestStats.success++;
  } else if (statusCode >= 400) {
    requestStats.errors++;
    
    // Track recent errors
    requestStats.recentErrors.push({
      timestamp: Date.now(),
      method,
      endpoint,
      statusCode,
      duration
    });
    
    // Keep only recent errors
    if (requestStats.recentErrors.length > MAX_RECENT_ERRORS) {
      requestStats.recentErrors = requestStats.recentErrors.slice(-MAX_RECENT_ERRORS);
    }
  }
  
  // Count by method
  requestStats.byMethod[method] = (requestStats.byMethod[method] || 0) + 1;
  
  // Count by endpoint (normalize to remove IDs)
  const normalizedEndpoint = normalizeEndpoint(endpoint);
  requestStats.byEndpoint[normalizedEndpoint] = (requestStats.byEndpoint[normalizedEndpoint] || 0) + 1;
}

/**
 * Normalize endpoint for aggregation (remove dynamic IDs)
 */
function normalizeEndpoint(endpoint) {
  return endpoint
    .replace(/\/agent_[a-z0-9]+/g, '/:id')
    .replace(/\/job_[a-f0-9]+/g, '/:jobId')
    .replace(/\/escrow_[a-f0-9]+/g, '/:escrowId')
    .replace(/\/[a-f0-9]{8,}/g, '/:uuid')
    .split('?')[0]; // Remove query params
}

/**
 * Get memory usage stats
 */
function getMemoryStats() {
  const used = process.memoryUsage();
  return {
    heapUsed: Math.round(used.heapUsed / 1024 / 1024),
    heapTotal: Math.round(used.heapTotal / 1024 / 1024),
    rss: Math.round(used.rss / 1024 / 1024),
    external: Math.round(used.external / 1024 / 1024),
    arrayBuffers: Math.round(used.arrayBuffers / 1024 / 1024),
    heapUsedPct: Math.round((used.heapUsed / used.heapTotal) * 100)
  };
}

/**
 * Get system stats
 */
function getSystemStats() {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  
  return {
    platform: os.platform(),
    arch: os.arch(),
    nodeVersion: process.version,
    cpus: os.cpus().length,
    loadAvg: os.loadavg().map(l => Math.round(l * 100) / 100),
    totalMemoryMB: Math.round(totalMem / 1024 / 1024),
    freeMemoryMB: Math.round(freeMem / 1024 / 1024),
    usedMemoryMB: Math.round(usedMem / 1024 / 1024),
    memoryUsedPct: Math.round((usedMem / totalMem) * 100)
  };
}

/**
 * Check database connectivity
 */
function checkDatabase(dataDir) {
  try {
    // Check if data directory exists
    if (!fs.existsSync(dataDir)) {
      return { status: 'error', message: 'Data directory not found' };
    }
    
    // Check profiles directory
    const profilesDir = path.join(dataDir, 'profiles');
    if (!fs.existsSync(profilesDir)) {
      return { status: 'warning', message: 'Profiles directory not found' };
    }
    
    // Count profiles
    const profiles = fs.readdirSync(profilesDir).filter(f => f.endsWith('.json'));
    
    // Check marketplace directory
    const marketDir = path.join(dataDir, 'marketplace');
    let jobCount = 0;
    let escrowCount = 0;
    
    if (fs.existsSync(marketDir)) {
      const jobsDir = path.join(marketDir, 'jobs');
      const escrowDir = path.join(marketDir, 'escrows');
      
      if (fs.existsSync(jobsDir)) {
        jobCount = fs.readdirSync(jobsDir).filter(f => f.endsWith('.json')).length;
      }
      if (fs.existsSync(escrowDir)) {
        escrowCount = fs.readdirSync(escrowDir).filter(f => f.endsWith('.json')).length;
      }
    }
    
    return {
      status: 'healthy',
      profiles: profiles.length,
      jobs: jobCount,
      escrows: escrowCount,
      lastCheck: Date.now()
    };
  } catch (err) {
    return {
      status: 'error',
      message: err.message,
      lastCheck: Date.now()
    };
  }
}

/**
 * Check SQLite database connectivity (if exists)
 */
function checkSQLite(dbPath) {
  try {
    if (!fs.existsSync(dbPath)) {
      return { status: 'not_configured', message: 'SQLite database not found' };
    }
    
    const Database = require('better-sqlite3');
    const db = new Database(dbPath, { readonly: true });
    
    // Run a simple query
    const result = db.prepare('SELECT COUNT(*) as count FROM profiles').get();
    
    db.close();
    
    return {
      status: 'healthy',
      profileCount: result.count,
      lastCheck: Date.now()
    };
  } catch (err) {
    return {
      status: 'error',
      message: err.message,
      lastCheck: Date.now()
    };
  }
}

/**
 * Get uptime info
 */
function getUptime() {
  const uptimeMs = Date.now() - SERVER_START_TIME;
  const uptimeSec = Math.floor(uptimeMs / 1000);
  const days = Math.floor(uptimeSec / 86400);
  const hours = Math.floor((uptimeSec % 86400) / 3600);
  const minutes = Math.floor((uptimeSec % 3600) / 60);
  const seconds = uptimeSec % 60;
  
  return {
    startedAt: new Date(SERVER_START_TIME).toISOString(),
    uptimeMs,
    uptimeSec,
    formatted: `${days}d ${hours}h ${minutes}m ${seconds}s`
  };
}

/**
 * Get request statistics
 */
function getRequestStats() {
  const errorRate = requestStats.total > 0 
    ? Math.round((requestStats.errors / requestStats.total) * 10000) / 100 
    : 0;
  
  return {
    total: requestStats.total,
    success: requestStats.success,
    errors: requestStats.errors,
    errorRate: `${errorRate}%`,
    byMethod: requestStats.byMethod,
    topEndpoints: getTopEndpoints(10),
    recentErrors: requestStats.recentErrors.slice(-10)
  };
}

/**
 * Get top endpoints by request count
 */
function getTopEndpoints(limit = 10) {
  return Object.entries(requestStats.byEndpoint)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([endpoint, count]) => ({ endpoint, count }));
}

/**
 * Basic health check (for load balancers)
 */
function getBasicHealth(dataDir) {
  const db = checkDatabase(dataDir);
  const memory = getMemoryStats();
  
  // Determine overall status
  let status = 'healthy';
  if (db.status === 'error') status = 'unhealthy';
  else if (memory.heapUsedPct > 90) status = 'degraded';
  else if (db.status === 'warning') status = 'degraded';
  
  return {
    status,
    timestamp: new Date().toISOString(),
    version: '2.0.0',
    uptime: getUptime().formatted
  };
}

/**
 * Detailed health check (for monitoring dashboards)
 */
function getDetailedHealth(dataDir, dbPath = null) {
  const db = checkDatabase(dataDir);
  const sqlite = dbPath ? checkSQLite(dbPath) : null;
  const memory = getMemoryStats();
  const system = getSystemStats();
  const uptime = getUptime();
  const requests = getRequestStats();
  
  // Determine overall status
  let status = 'healthy';
  let issues = [];
  
  if (db.status === 'error') {
    status = 'unhealthy';
    issues.push('Database error: ' + db.message);
  }
  
  if (sqlite && sqlite.status === 'error') {
    status = 'unhealthy';
    issues.push('SQLite error: ' + sqlite.message);
  }
  
  if (memory.heapUsedPct > 90) {
    status = status === 'unhealthy' ? 'unhealthy' : 'degraded';
    issues.push(`High memory usage: ${memory.heapUsedPct}%`);
  }
  
  if (system.loadAvg[0] > system.cpus * 0.8) {
    status = status === 'unhealthy' ? 'unhealthy' : 'degraded';
    issues.push(`High CPU load: ${system.loadAvg[0]}`);
  }
  
  if (requests.errorRate && parseFloat(requests.errorRate) > 5) {
    status = status === 'unhealthy' ? 'unhealthy' : 'degraded';
    issues.push(`High error rate: ${requests.errorRate}`);
  }
  
  return {
    status,
    timestamp: new Date().toISOString(),
    version: '2.0.0',
    issues: issues.length > 0 ? issues : undefined,
    uptime,
    memory,
    system,
    database: db,
    sqlite: sqlite || undefined,
    requests,
    pid: process.pid
  };
}

/**
 * Prometheus-compatible metrics format
 */
function getPrometheusMetrics(dataDir) {
  const memory = getMemoryStats();
  const system = getSystemStats();
  const uptime = getUptime();
  const db = checkDatabase(dataDir);
  
  const lines = [
    '# HELP agentfolio_uptime_seconds Server uptime in seconds',
    '# TYPE agentfolio_uptime_seconds gauge',
    `agentfolio_uptime_seconds ${uptime.uptimeSec}`,
    '',
    '# HELP agentfolio_requests_total Total request count',
    '# TYPE agentfolio_requests_total counter',
    `agentfolio_requests_total{status="success"} ${requestStats.success}`,
    `agentfolio_requests_total{status="error"} ${requestStats.errors}`,
    '',
    '# HELP agentfolio_memory_heap_bytes Heap memory usage in bytes',
    '# TYPE agentfolio_memory_heap_bytes gauge',
    `agentfolio_memory_heap_bytes{type="used"} ${memory.heapUsed * 1024 * 1024}`,
    `agentfolio_memory_heap_bytes{type="total"} ${memory.heapTotal * 1024 * 1024}`,
    '',
    '# HELP agentfolio_memory_rss_bytes RSS memory usage in bytes',
    '# TYPE agentfolio_memory_rss_bytes gauge',
    `agentfolio_memory_rss_bytes ${memory.rss * 1024 * 1024}`,
    '',
    '# HELP agentfolio_system_load System load average',
    '# TYPE agentfolio_system_load gauge',
    `agentfolio_system_load{period="1m"} ${system.loadAvg[0]}`,
    `agentfolio_system_load{period="5m"} ${system.loadAvg[1]}`,
    `agentfolio_system_load{period="15m"} ${system.loadAvg[2]}`,
    '',
    '# HELP agentfolio_profiles_total Total number of profiles',
    '# TYPE agentfolio_profiles_total gauge',
    `agentfolio_profiles_total ${db.profiles || 0}`,
    '',
    '# HELP agentfolio_jobs_total Total number of jobs',
    '# TYPE agentfolio_jobs_total gauge',
    `agentfolio_jobs_total ${db.jobs || 0}`,
    '',
    '# HELP agentfolio_escrows_total Total number of escrows',
    '# TYPE agentfolio_escrows_total gauge',
    `agentfolio_escrows_total ${db.escrows || 0}`
  ];
  
  // Add per-method request counts
  for (const [method, count] of Object.entries(requestStats.byMethod)) {
    lines.push(`agentfolio_requests_by_method{method="${method}"} ${count}`);
  }
  
  return lines.join('\n');
}

/**
 * Reset request stats (for testing)
 */
function resetStats() {
  requestStats.total = 0;
  requestStats.success = 0;
  requestStats.errors = 0;
  requestStats.byMethod = {};
  requestStats.byEndpoint = {};
  requestStats.recentErrors = [];
}

module.exports = {
  recordRequest,
  getBasicHealth,
  getDetailedHealth,
  getPrometheusMetrics,
  getMemoryStats,
  getSystemStats,
  getUptime,
  getRequestStats,
  resetStats,
  SERVER_START_TIME
};
