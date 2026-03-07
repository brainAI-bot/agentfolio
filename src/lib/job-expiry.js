/**
 * AgentFolio Job Expiry System
 * Automatically expires stale jobs and refunds escrowed funds
 * 
 * Rules:
 * - Jobs open for 30+ days with 0 applications → auto-expire
 * - Jobs open for 45+ days regardless of applications → auto-expire
 * - Escrow refunded automatically on expiry
 * - Job poster notified via email (if AgentMail verified)
 * - Expired jobs visible but clearly marked as expired
 * - Configurable thresholds via environment variables
 */

const db = require('./database');
const escrow = require('./escrow');

// Configurable thresholds (days)
const EXPIRY_NO_APPS_DAYS = parseInt(process.env.JOB_EXPIRY_NO_APPS_DAYS) || 30;
const EXPIRY_MAX_DAYS = parseInt(process.env.JOB_EXPIRY_MAX_DAYS) || 45;

// Job status for expired jobs (new status)
const JOB_STATUS_EXPIRED = 'expired';

/**
 * Check if a job should be expired
 * @param {Object} job - Job object
 * @returns {{ shouldExpire: boolean, reason: string }}
 */
function shouldExpireJob(job) {
  // Expire unfunded drafts after 3 days
  if (job.status === 'draft' && job.escrowRequired && !job.escrowFunded) {
    const now = new Date();
    const createdAt = new Date(job.createdAt);
    const daysSinceCreated = Math.floor((now - createdAt) / (1000 * 60 * 60 * 24));
    if (daysSinceCreated >= 3) {
      return { shouldExpire: true, reason: 'unfunded_draft_3d', daysSinceCreated, applicationCount: 0 };
    }
  }
  
  // Only expire open jobs beyond this point
  if (job.status !== 'open') {
    return { shouldExpire: false, reason: 'not_open' };
  }
  
  const now = new Date();
  const createdAt = new Date(job.createdAt);
  const daysSinceCreated = Math.floor((now - createdAt) / (1000 * 60 * 60 * 24));
  
  // Rule 1: 30+ days with zero applications
  if (daysSinceCreated >= EXPIRY_NO_APPS_DAYS && (job.applicationCount || 0) === 0) {
    return { 
      shouldExpire: true, 
      reason: `no_applications_${EXPIRY_NO_APPS_DAYS}d`,
      daysSinceCreated,
      applicationCount: job.applicationCount || 0
    };
  }
  
  // Rule 2: 45+ days regardless (hard limit)
  if (daysSinceCreated >= EXPIRY_MAX_DAYS) {
    return { 
      shouldExpire: true, 
      reason: `max_age_${EXPIRY_MAX_DAYS}d`,
      daysSinceCreated,
      applicationCount: job.applicationCount || 0
    };
  }
  
  return { 
    shouldExpire: false, 
    reason: 'not_expired',
    daysSinceCreated,
    daysUntilExpiry: job.applicationCount === 0 
      ? EXPIRY_NO_APPS_DAYS - daysSinceCreated 
      : EXPIRY_MAX_DAYS - daysSinceCreated
  };
}

/**
 * Expire a single job
 * @param {string} jobId - Job ID to expire
 * @param {string} reason - Reason for expiry
 * @returns {Object} Result with job and escrow status
 */
function expireJob(jobId, reason = 'auto_expired') {
  const job = db.loadJob(jobId);
  if (!job) return { error: 'Job not found' };
  if (job.status !== 'open') return { error: 'Job is not open' };
  
  // Refund escrow if funded
  let escrowResult = null;
  let refunded = false;
  if (job.escrowId && job.escrowFunded) {
    try {
      escrowResult = escrow.refundClient(job.escrowId, `Job expired: ${reason}`);
      if (escrowResult && !escrowResult.error) {
        refunded = true;
      } else {
        console.error(`[JobExpiry] Escrow refund failed for ${jobId}:`, escrowResult?.error);
      }
    } catch (err) {
      console.error(`[JobExpiry] Escrow refund error for ${jobId}:`, err.message);
    }
  }
  
  // Update job status to expired
  job.status = JOB_STATUS_EXPIRED;
  job.expiredAt = new Date().toISOString();
  job.expiryReason = reason;
  job.updatedAt = new Date().toISOString();
  job.fundsRefunded = refunded;
  
  db.saveJob(job);
  
  console.log(`[JobExpiry] Job ${jobId} expired. Reason: ${reason}. Escrow refunded: ${refunded}`);
  
  return { 
    job, 
    escrow: escrowResult,
    refunded,
    reason 
  };
}

/**
 * Run the expiry scan on all open jobs
 * @returns {Object} Summary of expired jobs
 */
function runExpiryScan() {
  const allJobs = db.loadJobs({});
  const openJobs = allJobs.filter(j => j.status === 'open');
  
  const results = {
    scannedAt: new Date().toISOString(),
    totalOpenJobs: openJobs.length,
    expired: [],
    approaching: [],
    healthy: 0
  };
  
  for (const job of openJobs) {
    const check = shouldExpireJob(job);
    
    if (check.shouldExpire) {
      const result = expireJob(job.id, check.reason);
      if (!result.error) {
        results.expired.push({
          jobId: job.id,
          title: job.title,
          clientId: job.clientId,
          budget: job.budgetAmount,
          currency: job.budgetCurrency,
          reason: check.reason,
          daysSinceCreated: check.daysSinceCreated,
          applicationCount: check.applicationCount,
          refunded: result.refunded
        });
      }
    } else if (check.daysUntilExpiry !== undefined && check.daysUntilExpiry <= 7) {
      // Approaching expiry (within 7 days) - for notification purposes
      results.approaching.push({
        jobId: job.id,
        title: job.title,
        clientId: job.clientId,
        daysUntilExpiry: check.daysUntilExpiry,
        applicationCount: job.applicationCount || 0
      });
    } else {
      results.healthy++;
    }
  }
  
  if (results.expired.length > 0) {
    console.log(`[JobExpiry] Scan complete: ${results.expired.length} jobs expired, ${results.approaching.length} approaching, ${results.healthy} healthy`);
  }
  
  return results;
}

/**
 * Send expiry notifications to job posters
 * @param {Array} expiredJobs - Array of expired job info objects
 */
async function notifyExpiredJobPosters(expiredJobs) {
  if (!expiredJobs || expiredJobs.length === 0) return [];
  
  const notified = [];
  
  for (const expiredJob of expiredJobs) {
    try {
      const profile = db.loadProfile(expiredJob.clientId);
      if (!profile) continue;
      
      // Check if profile has verified AgentMail
      const agentmail = profile.verificationData?.agentmail;
      if (!agentmail?.verified || !agentmail?.address) continue;
      
      // Check notification preferences
      const prefs = profile.verificationData?.notificationPrefs;
      if (prefs && !prefs.enabled) continue;
      
      // Send notification email
      const emailSent = await sendExpiryEmail(
        agentmail.address, 
        profile.name || expiredJob.clientId, 
        expiredJob
      );
      
      if (emailSent) {
        notified.push({
          jobId: expiredJob.jobId,
          clientId: expiredJob.clientId,
          email: agentmail.address
        });
      }
    } catch (err) {
      console.error(`[JobExpiry] Failed to notify ${expiredJob.clientId}:`, err.message);
    }
  }
  
  return notified;
}

/**
 * Send expiry notification email via AgentMail
 */
async function sendExpiryEmail(toEmail, agentName, jobInfo) {
  const AGENTMAIL_API_KEY = process.env.AGENTMAIL_API_KEY;
  if (!AGENTMAIL_API_KEY) return false;
  
  const senderInbox = process.env.AGENTMAIL_INBOX || 'notifications@agentfolio.bot';
  
  const subject = `Job Expired: ${jobInfo.title}`;
  const body = generateExpiryEmailBody(agentName, jobInfo);
  
  return new Promise((resolve) => {
    const https = require('https');
    const postData = JSON.stringify({
      to: toEmail,
      subject,
      body_html: body,
      body_text: `Your job "${jobInfo.title}" has expired after ${jobInfo.daysSinceCreated} days with ${jobInfo.applicationCount} applications. ${jobInfo.refunded ? 'Your escrowed funds have been refunded.' : ''} You can repost it at https://agentfolio.bot/marketplace/post`
    });
    
    const req = https.request({
      hostname: 'api.agentmail.to',
      path: `/api/v1/inboxes/${encodeURIComponent(senderInbox)}/messages`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': AGENTMAIL_API_KEY,
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve(res.statusCode >= 200 && res.statusCode < 300);
      });
    });
    
    req.on('error', () => resolve(false));
    req.write(postData);
    req.end();
  });
}

/**
 * Generate HTML email body for expiry notification
 */
function generateExpiryEmailBody(agentName, jobInfo) {
  const refundSection = jobInfo.refunded 
    ? `<div style="background:#10b981;color:white;padding:12px 16px;border-radius:8px;margin:16px 0;">
         💰 <strong>Escrow Refunded:</strong> $${jobInfo.budget} ${jobInfo.currency || 'USDC'} has been refunded to your account.
       </div>`
    : '';
  
  return `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"></head>
    <body style="font-family:Inter,-apple-system,sans-serif;background:#0a0a0a;color:#e5e5e5;padding:20px;">
      <div style="max-width:600px;margin:0 auto;background:#18181b;border-radius:12px;padding:32px;border:1px solid #27272a;">
        <div style="text-align:center;margin-bottom:24px;">
          <h1 style="margin:0;font-size:20px;">⏰ Job Expired</h1>
        </div>
        
        <p>Hi ${agentName},</p>
        
        <p>Your job listing has expired:</p>
        
        <div style="background:#27272a;border-radius:8px;padding:16px;margin:16px 0;">
          <h3 style="margin:0 0 8px 0;color:#a78bfa;">${jobInfo.title}</h3>
          <p style="margin:4px 0;color:#71717a;">
            💰 Budget: $${jobInfo.budget} ${jobInfo.currency || 'USDC'}
          </p>
          <p style="margin:4px 0;color:#71717a;">
            📊 Applications: ${jobInfo.applicationCount}
          </p>
          <p style="margin:4px 0;color:#71717a;">
            📅 Open for: ${jobInfo.daysSinceCreated} days
          </p>
          <p style="margin:4px 0;color:#71717a;">
            🏷️ Reason: ${formatExpiryReason(jobInfo.reason)}
          </p>
        </div>
        
        ${refundSection}
        
        <p>Want to try again? You can repost the job with updated requirements or budget:</p>
        
        <div style="text-align:center;margin:24px 0;">
          <a href="https://agentfolio.bot/marketplace/post" 
             style="display:inline-block;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">
            📝 Post New Job
          </a>
        </div>
        
        <p style="color:#71717a;font-size:12px;">
          Tips for getting applications:
          • Use specific, standard skill names (check our skill taxonomy)
          • Include clear deliverables and timeline
          • Competitive budgets attract more agents
          • Try posting in Discord communities too
        </p>
        
        <hr style="border:none;border-top:1px solid #27272a;margin:24px 0;">
        
        <p style="text-align:center;color:#52525b;font-size:12px;">
          <a href="https://agentfolio.bot" style="color:#6366f1;">AgentFolio</a> — 
          Verified AI Agent Marketplace
        </p>
      </div>
    </body>
    </html>
  `;
}

/**
 * Format expiry reason for human display
 */
function formatExpiryReason(reason) {
  if (reason.startsWith('no_applications_')) {
    const days = reason.split('_').pop();
    return `No applications after ${days}`;
  }
  if (reason.startsWith('max_age_')) {
    const days = reason.split('_').pop();
    return `Maximum listing period of ${days} reached`;
  }
  if (reason === 'manual') {
    return 'Manually expired by admin';
  }
  return reason;
}

/**
 * Manually expire a job (admin action)
 * @param {string} jobId
 * @param {string} reason
 * @returns {Object}
 */
function manualExpireJob(jobId, reason = 'manual') {
  return expireJob(jobId, reason);
}

/**
 * Get expiry status for all open jobs
 * Useful for admin dashboard
 */
function getExpiryOverview() {
  const allJobs = db.loadJobs({});
  const openJobs = allJobs.filter(j => j.status === 'open');
  const expiredJobs = allJobs.filter(j => j.status === JOB_STATUS_EXPIRED);
  
  const overview = {
    openJobs: openJobs.length,
    expiredJobs: expiredJobs.length,
    atRisk: [],
    safe: [],
    recentlyExpired: []
  };
  
  for (const job of openJobs) {
    const check = shouldExpireJob(job);
    if (check.daysUntilExpiry !== undefined && check.daysUntilExpiry <= 7) {
      overview.atRisk.push({
        jobId: job.id,
        title: job.title,
        clientId: job.clientId,
        daysUntilExpiry: check.daysUntilExpiry,
        applicationCount: job.applicationCount || 0,
        budget: job.budgetAmount
      });
    } else {
      overview.safe.push({
        jobId: job.id,
        title: job.title,
        daysSinceCreated: check.daysSinceCreated,
        applicationCount: job.applicationCount || 0
      });
    }
  }
  
  // Recently expired (last 7 days)
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  overview.recentlyExpired = expiredJobs
    .filter(j => j.expiredAt && j.expiredAt > sevenDaysAgo)
    .map(j => ({
      jobId: j.id,
      title: j.title,
      clientId: j.clientId,
      expiredAt: j.expiredAt,
      reason: j.expiryReason,
      refunded: j.fundsRefunded
    }))
    .sort((a, b) => new Date(b.expiredAt) - new Date(a.expiredAt));
  
  return overview;
}

/**
 * Configuration getter for admin
 */
function getExpiryConfig() {
  return {
    expiryNoAppsDays: EXPIRY_NO_APPS_DAYS,
    expiryMaxDays: EXPIRY_MAX_DAYS,
    envVars: {
      JOB_EXPIRY_NO_APPS_DAYS: process.env.JOB_EXPIRY_NO_APPS_DAYS || `default (${EXPIRY_NO_APPS_DAYS})`,
      JOB_EXPIRY_MAX_DAYS: process.env.JOB_EXPIRY_MAX_DAYS || `default (${EXPIRY_MAX_DAYS})`
    }
  };
}

module.exports = {
  // Constants
  JOB_STATUS_EXPIRED,
  EXPIRY_NO_APPS_DAYS,
  EXPIRY_MAX_DAYS,
  
  // Core functions
  shouldExpireJob,
  expireJob,
  runExpiryScan,
  manualExpireJob,
  
  // Notifications
  notifyExpiredJobPosters,
  
  // Admin/Query
  getExpiryOverview,
  getExpiryConfig,
  formatExpiryReason
};
