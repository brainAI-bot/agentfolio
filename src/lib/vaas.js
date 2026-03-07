/**
 * Verification-as-a-Service (VaaS) for AgentFolio
 * 
 * External services can verify wallets, social accounts, and trading history
 * via API without needing an AgentFolio profile. Results are returned as
 * standardized verification reports with cryptographic attestations.
 * 
 * Requires Pro or Enterprise API key tier.
 */

const crypto = require('crypto');
const { db } = require('./database');
const { verifyGitHubProfile, getGitHubStats } = require('./github-verify');
const { verifySolanaWallet, getSolanaTokenAccounts } = require('./solana-verify');
const { verifyHyperliquidTrading } = require('./hyperliquid-verify');
const { verifyTwitterBio, getTwitterStats } = require('./twitter-verify');
const { getPolymarketStats } = require('./polymarket-verify');

// Supported verification types
const VERIFICATION_TYPES = {
  github: {
    label: 'GitHub',
    description: 'Verify GitHub profile ownership and fetch repo/commit stats',
    requiredFields: ['username'],
    optionalFields: [],
    tier: 'pro'
  },
  solana: {
    label: 'Solana Wallet',
    description: 'Verify Solana wallet ownership, balances, and token holdings',
    requiredFields: ['address'],
    optionalFields: [],
    tier: 'pro'
  },
  hyperliquid: {
    label: 'Hyperliquid',
    description: 'Verify Hyperliquid trading account with P&L and position history',
    requiredFields: ['address'],
    optionalFields: [],
    tier: 'pro'
  },
  x: {
    label: 'Twitter/X',
    description: 'Fetch X profile stats (followers, tweets, engagement)',
    requiredFields: ['username'],
    optionalFields: [],
    tier: 'pro'
  },
  polymarket: {
    label: 'Polymarket',
    description: 'Verify Polymarket trading stats (positions, P&L, volume)',
    requiredFields: ['address'],
    optionalFields: [],
    tier: 'pro'
  },
  composite: {
    label: 'Composite Identity',
    description: 'Run multiple verifications and return a composite trust score',
    requiredFields: ['checks'],
    optionalFields: [],
    tier: 'enterprise'
  }
};

// Initialize VaaS table
function initVaasTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS vaas_reports (
      id TEXT PRIMARY KEY,
      api_key_hash TEXT NOT NULL,
      type TEXT NOT NULL,
      subject TEXT NOT NULL,
      status TEXT DEFAULT 'completed',
      result TEXT,
      trust_score REAL,
      attestation TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      expires_at TEXT
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_vaas_api_key ON vaas_reports(api_key_hash)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_vaas_subject ON vaas_reports(subject)`);
}

try { initVaasTable(); } catch(e) { /* table may already exist */ }

// Generate attestation hash for a verification result
function generateAttestation(reportId, type, subject, result) {
  const payload = JSON.stringify({ reportId, type, subject, result, timestamp: new Date().toISOString() });
  const hmac = crypto.createHmac('sha256', process.env.AGENTFOLIO_ADMIN_KEY || 'agentfolio-vaas-secret');
  hmac.update(payload);
  return {
    hash: hmac.digest('hex'),
    algorithm: 'hmac-sha256',
    payload: Buffer.from(payload).toString('base64')
  };
}

// Calculate trust score from verification result
function calculateTrustScore(type, result) {
  if (!result || result.error) return 0;

  switch (type) {
    case 'github': {
      let score = 0;
      if (result.repos > 0) score += 20;
      if (result.repos > 5) score += 10;
      if (result.repos > 20) score += 10;
      if (result.followers > 0) score += 10;
      if (result.followers > 10) score += 10;
      if (result.followers > 100) score += 10;
      if (result.totalCommits > 50) score += 15;
      if (result.totalCommits > 500) score += 15;
      return Math.min(100, score);
    }
    case 'solana': {
      let score = 0;
      if (result.balance > 0) score += 30;
      if (result.balance > 1) score += 20;
      if (result.balance > 10) score += 20;
      if (result.tokenCount > 0) score += 15;
      if (result.tokenCount > 5) score += 15;
      return Math.min(100, score);
    }
    case 'hyperliquid': {
      let score = 0;
      if (result.accountValue > 0) score += 30;
      if (result.accountValue > 1000) score += 20;
      if (result.totalPnl > 0) score += 25;
      if (result.positions > 0) score += 25;
      return Math.min(100, score);
    }
    case 'twitter': {
      let score = 0;
      if (result.followers > 0) score += 20;
      if (result.followers > 100) score += 15;
      if (result.followers > 1000) score += 15;
      if (result.tweets > 10) score += 15;
      if (result.tweets > 100) score += 15;
      if (result.verified) score += 20;
      return Math.min(100, score);
    }
    case 'polymarket': {
      let score = 0;
      if (result.marketsTraded > 0) score += 25;
      if (result.marketsTraded > 10) score += 15;
      if (result.volume > 100) score += 20;
      if (result.volume > 10000) score += 20;
      if (result.profitLoss > 0) score += 20;
      return Math.min(100, score);
    }
    default:
      return 0;
  }
}

// Run a single verification
async function runVerification(type, params) {
  switch (type) {
    case 'github': {
      const stats = await getGitHubStats(params.username);
      if (!stats || stats.error) {
        return { error: stats?.error || 'GitHub profile not found', verified: false };
      }
      return {
        verified: true,
        username: params.username,
        repos: stats.public_repos || 0,
        followers: stats.followers || 0,
        following: stats.following || 0,
        bio: stats.bio || null,
        company: stats.company || null,
        location: stats.location || null,
        created: stats.created_at,
        topLanguages: stats.topLanguages || [],
        totalCommits: stats.totalCommits || 0
      };
    }
    case 'solana': {
      const result = await verifySolanaWallet(params.address);
      if (!result || result.error) {
        return { error: result?.error || 'Solana wallet verification failed', verified: false };
      }
      const tokens = await getSolanaTokenAccounts(params.address).catch(() => []);
      return {
        verified: true,
        address: params.address,
        balance: result.balance || 0,
        tokenCount: Array.isArray(tokens) ? tokens.length : 0,
        tokens: Array.isArray(tokens) ? tokens.slice(0, 10) : []
      };
    }
    case 'hyperliquid': {
      const result = await verifyHyperliquidTrading(params.address);
      if (!result || result.error) {
        return { error: result?.error || 'Hyperliquid verification failed', verified: false };
      }
      return {
        verified: true,
        address: params.address,
        accountValue: result.accountValue || 0,
        totalPnl: result.totalPnl || 0,
        positions: result.openPositions || 0,
        volume: result.totalVolume || 0
      };
    }
    case 'twitter': {
      const stats = await getTwitterStats(params.username);
      if (!stats || stats.error) {
        return { error: stats?.error || 'X profile not found', verified: false };
      }
      return {
        verified: true,
        username: params.username,
        name: stats.name || params.username,
        followers: stats.followers_count || 0,
        following: stats.following_count || 0,
        tweets: stats.tweet_count || 0,
        verified: stats.verified || false,
        created: stats.created_at
      };
    }
    case 'polymarket': {
      const stats = await getPolymarketStats(params.address);
      if (!stats || stats.error) {
        return { error: stats?.error || 'Polymarket stats unavailable', verified: false };
      }
      return {
        verified: true,
        address: params.address,
        marketsTraded: stats.marketsTraded || 0,
        volume: stats.volume || 0,
        profitLoss: stats.profitLoss || 0,
        positions: stats.positions || []
      };
    }
    default:
      return { error: `Unknown verification type: ${type}`, verified: false };
  }
}

// Run composite verification (multiple checks)
async function runCompositeVerification(checks) {
  const results = {};
  let totalScore = 0;
  let count = 0;

  for (const check of checks) {
    if (!VERIFICATION_TYPES[check.type] || check.type === 'composite') continue;
    try {
      const result = await runVerification(check.type, check.params || {});
      const score = calculateTrustScore(check.type, result);
      results[check.type] = { result, trustScore: score };
      totalScore += score;
      count++;
    } catch (err) {
      results[check.type] = { result: { error: err.message, verified: false }, trustScore: 0 };
      count++;
    }
  }

  return {
    verified: Object.values(results).some(r => r.result.verified),
    checks: results,
    compositeTrustScore: count > 0 ? Math.round(totalScore / count) : 0,
    checksRun: count
  };
}

// Main VaaS entry point
async function verify(type, params, apiKeyHash) {
  const reportId = 'vr_' + crypto.randomBytes(12).toString('hex');
  const subject = type === 'composite' 
    ? JSON.stringify((params.checks || []).map(c => `${c.type}:${c.params?.address || c.params?.username}`))
    : (params.address || params.username || 'unknown');

  let result;
  if (type === 'composite') {
    result = await runCompositeVerification(params.checks || []);
  } else {
    result = await runVerification(type, params);
  }

  const trustScore = type === 'composite' 
    ? result.compositeTrustScore 
    : calculateTrustScore(type, result);

  const attestation = generateAttestation(reportId, type, subject, result);
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days

  // Store report
  try {
    db.prepare(`
      INSERT INTO vaas_reports (id, api_key_hash, type, subject, status, result, trust_score, attestation, expires_at)
      VALUES (?, ?, ?, ?, 'completed', ?, ?, ?, ?)
    `).run(reportId, apiKeyHash, type, subject, JSON.stringify(result), trustScore, JSON.stringify(attestation), expiresAt);
  } catch(e) {
    // Non-fatal — report still returned
  }

  return {
    reportId,
    type,
    subject,
    status: 'completed',
    result,
    trustScore,
    attestation,
    createdAt: new Date().toISOString(),
    expiresAt
  };
}

// Get a previously generated report
function getReport(reportId) {
  const row = db.prepare(`SELECT * FROM vaas_reports WHERE id = ?`).get(reportId);
  if (!row) return null;
  return {
    reportId: row.id,
    type: row.type,
    subject: row.subject,
    status: row.status,
    result: JSON.parse(row.result || '{}'),
    trustScore: row.trust_score,
    attestation: JSON.parse(row.attestation || '{}'),
    createdAt: row.created_at,
    expiresAt: row.expires_at
  };
}

// List reports for an API key
function listReports(apiKeyHash, limit = 50) {
  const rows = db.prepare(`
    SELECT id, type, subject, status, trust_score, created_at, expires_at 
    FROM vaas_reports WHERE api_key_hash = ? 
    ORDER BY created_at DESC LIMIT ?
  `).all(apiKeyHash, limit);
  
  return rows.map(r => ({
    reportId: r.id,
    type: r.type,
    subject: r.subject,
    status: r.status,
    trustScore: r.trust_score,
    createdAt: r.created_at,
    expiresAt: r.expires_at
  }));
}

// Get VaaS usage stats for an API key
function getUsageStats(apiKeyHash) {
  const stats = db.prepare(`
    SELECT 
      COUNT(*) as totalReports,
      COUNT(CASE WHEN trust_score > 0 THEN 1 END) as successfulVerifications,
      AVG(trust_score) as avgTrustScore,
      MIN(created_at) as firstReport,
      MAX(created_at) as lastReport
    FROM vaas_reports WHERE api_key_hash = ?
  `).get(apiKeyHash);
  
  const byType = db.prepare(`
    SELECT type, COUNT(*) as count, AVG(trust_score) as avgScore
    FROM vaas_reports WHERE api_key_hash = ?
    GROUP BY type
  `).all(apiKeyHash);

  return { ...stats, byType };
}

// Verify attestation
function verifyAttestation(attestationHash, payload) {
  const hmac = crypto.createHmac('sha256', process.env.AGENTFOLIO_ADMIN_KEY || 'agentfolio-vaas-secret');
  hmac.update(payload);
  return hmac.digest('hex') === attestationHash;
}

module.exports = {
  VERIFICATION_TYPES,
  verify,
  getReport,
  listReports,
  getUsageStats,
  verifyAttestation,
  calculateTrustScore
};
