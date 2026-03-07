/**
 * AgentFolio Email Notifications
 * Sends job event notifications via AgentMail API
 */

const https = require('https');
const crypto = require('crypto');
const db = require('./database');

// AgentMail API configuration
const AGENTMAIL_API_KEY = process.env.AGENTMAIL_API_KEY;
const AGENTMAIL_SENDER = process.env.AGENTMAIL_INBOX || 'notifications@agentfolio.bot';

// Notification types
const NOTIFICATION_TYPES = {
  NEW_APPLICATION: 'new_application',      // Someone applied to your job
  JOB_ASSIGNED: 'job_assigned',            // You were selected for a job
  JOB_COMPLETED: 'job_completed',          // Job you're involved in completed
  NEW_REVIEW: 'new_review',                // You received a new review
  JOB_MATCH: 'job_match'                   // New job matches your skills
};

// Default notification preferences (all enabled)
const DEFAULT_PREFERENCES = {
  enabled: true,
  types: {
    new_application: true,
    job_assigned: true,
    job_completed: true,
    new_review: true,
    job_match: true
  }
};

/**
 * Generate unsubscribe token for a profile
 */
function generateUnsubscribeToken(profileId) {
  const secret = process.env.NOTIFICATION_SECRET || 'agentfolio-notifications-secret';
  return crypto.createHmac('sha256', secret)
    .update(profileId)
    .digest('hex')
    .substring(0, 32);
}

/**
 * Verify unsubscribe token
 */
function verifyUnsubscribeToken(profileId, token) {
  return token === generateUnsubscribeToken(profileId);
}

/**
 * Get notification preferences for a profile
 */
function getNotificationPreferences(profileId) {
  const profile = db.loadProfile(profileId);
  if (!profile) return null;
  
  // Get preferences from verificationData (reusing existing JSON field)
  const prefs = profile.verificationData?.notificationPrefs || DEFAULT_PREFERENCES;
  return prefs;
}

/**
 * Update notification preferences for a profile
 */
function updateNotificationPreferences(profileId, preferences) {
  const profile = db.loadProfile(profileId);
  if (!profile) return { error: 'Profile not found' };
  
  // Merge with defaults
  const newPrefs = {
    enabled: preferences.enabled !== undefined ? preferences.enabled : true,
    types: {
      ...DEFAULT_PREFERENCES.types,
      ...(preferences.types || {})
    }
  };
  
  // Store in verificationData
  profile.verificationData = profile.verificationData || {};
  profile.verificationData.notificationPrefs = newPrefs;
  profile.updatedAt = new Date().toISOString();
  
  db.saveProfile(profile);
  
  return { success: true, preferences: newPrefs };
}

/**
 * Unsubscribe from all notifications
 */
function unsubscribeAll(profileId, token) {
  if (!verifyUnsubscribeToken(profileId, token)) {
    return { error: 'Invalid unsubscribe token' };
  }
  
  const result = updateNotificationPreferences(profileId, { enabled: false });
  return result.error ? result : { success: true, message: 'Unsubscribed from all notifications' };
}

/**
 * Check if a notification should be sent
 */
function shouldSendNotification(profileId, notificationType) {
  const profile = db.loadProfile(profileId);
  if (!profile) return false;
  
  // Must have verified AgentMail
  if (!profile.verificationData?.agentmail?.verified) return false;
  
  const prefs = getNotificationPreferences(profileId);
  if (!prefs || !prefs.enabled) return false;
  
  return prefs.types[notificationType] !== false;
}

/**
 * Get recipient email for a profile
 */
function getRecipientEmail(profileId) {
  const profile = db.loadProfile(profileId);
  if (!profile) return null;
  
  // Use verified AgentMail if available
  if (profile.verificationData?.agentmail?.verified) {
    return profile.verificationData.agentmail.email;
  }
  
  // Fallback to unverified agentmail link (with lower trust)
  return profile.links?.agentmail || null;
}

/**
 * Send email via AgentMail API
 */
async function sendEmail(to, subject, htmlBody, textBody) {
  if (!AGENTMAIL_API_KEY) {
    console.error('[Notifications] AGENTMAIL_API_KEY not configured');
    return { error: 'Email service not configured' };
  }
  
  return new Promise((resolve) => {
    const payload = JSON.stringify({
      to: to,
      subject: subject,
      html: htmlBody,
      text: textBody
    });
    
    const options = {
      hostname: 'api.agentmail.to',
      port: 443,
      path: `/v1/inboxes/${AGENTMAIL_SENDER}/messages`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AGENTMAIL_API_KEY}`,
        'Content-Length': Buffer.byteLength(payload)
      }
    };
    
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          console.log(`[Notifications] Email sent to ${to}: ${subject}`);
          resolve({ success: true });
        } else {
          console.error(`[Notifications] Failed to send email: ${res.statusCode} ${data}`);
          resolve({ error: `Email failed: ${res.statusCode}` });
        }
      });
    });
    
    req.on('error', (e) => {
      console.error(`[Notifications] Email error: ${e.message}`);
      resolve({ error: e.message });
    });
    
    req.write(payload);
    req.end();
  });
}

/**
 * Generate email footer with unsubscribe link
 */
function generateEmailFooter(profileId, baseUrl = 'https://agentfolio.bot') {
  const token = generateUnsubscribeToken(profileId);
  const unsubscribeUrl = `${baseUrl}/notifications/unsubscribe?profile=${profileId}&token=${token}`;
  const prefsUrl = `${baseUrl}/profile/${profileId}/edit`;
  
  return {
    html: `
      <hr style="border:none;border-top:1px solid #27272a;margin:32px 0;">
      <p style="color:#71717a;font-size:12px;text-align:center;">
        You're receiving this because you have email notifications enabled on AgentFolio.<br>
        <a href="${prefsUrl}" style="color:#a78bfa;">Manage preferences</a> · 
        <a href="${unsubscribeUrl}" style="color:#71717a;">Unsubscribe from all</a>
      </p>
    `,
    text: `\n\n---\nManage preferences: ${prefsUrl}\nUnsubscribe: ${unsubscribeUrl}`
  };
}

/**
 * Generate email template wrapper
 */
function wrapEmailTemplate(content, profileId) {
  const footer = generateEmailFooter(profileId);
  
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#0a0a0b;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:32px 24px;">
    <!-- Header -->
    <div style="text-align:center;margin-bottom:32px;">
      <span style="font-size:32px;">🧠</span>
      <h1 style="color:#e4e4e7;font-size:24px;margin:8px 0 0;">AgentFolio</h1>
    </div>
    
    <!-- Content -->
    <div style="background:#18181b;border:1px solid #27272a;border-radius:16px;padding:24px;">
      ${content}
    </div>
    
    ${footer.html}
  </div>
</body>
</html>`;

  return { html, textFooter: footer.text };
}

// ============ NOTIFICATION TEMPLATES ============

/**
 * Send notification: New application on your job
 */
async function notifyNewApplication(job, application, applicantProfile) {
  const recipientId = job.clientId;
  if (!shouldSendNotification(recipientId, NOTIFICATION_TYPES.NEW_APPLICATION)) {
    return { skipped: true, reason: 'notifications disabled' };
  }
  
  const email = getRecipientEmail(recipientId);
  if (!email) return { skipped: true, reason: 'no email' };
  
  const jobUrl = `https://agentfolio.bot/marketplace/jobs/${job.id}`;
  const profileUrl = `https://agentfolio.bot/profile/${applicantProfile.id}`;
  
  const content = `
    <h2 style="color:#e4e4e7;font-size:20px;margin:0 0 16px;">📬 New Application Received</h2>
    <p style="color:#a1a1aa;margin:0 0 16px;">
      <strong style="color:#e4e4e7;">${applicantProfile.name}</strong> has applied to your job:
    </p>
    <div style="background:#27272a;border-radius:10px;padding:16px;margin-bottom:16px;">
      <p style="color:#e4e4e7;font-weight:600;margin:0 0 8px;">${job.title}</p>
      ${application.coverMessage ? `<p style="color:#a1a1aa;font-size:14px;margin:0;font-style:italic;">"${application.coverMessage.substring(0, 200)}${application.coverMessage.length > 200 ? '...' : ''}"</p>` : ''}
    </div>
    <div style="text-align:center;">
      <a href="${jobUrl}" style="display:inline-block;background:linear-gradient(135deg,#a78bfa,#ec4899);color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">
        View Application →
      </a>
    </div>
    <p style="color:#71717a;font-size:13px;margin:16px 0 0;text-align:center;">
      <a href="${profileUrl}" style="color:#a78bfa;">View ${applicantProfile.name}'s profile</a>
    </p>
  `;
  
  const { html, textFooter } = wrapEmailTemplate(content, recipientId);
  const text = `New application on "${job.title}" from ${applicantProfile.name}.\n\nView: ${jobUrl}${textFooter}`;
  
  return sendEmail(email, `📬 New application: ${job.title}`, html, text);
}

/**
 * Send notification: You were assigned to a job
 */
async function notifyJobAssigned(job, agentProfile, clientProfile) {
  const recipientId = agentProfile.id;
  if (!shouldSendNotification(recipientId, NOTIFICATION_TYPES.JOB_ASSIGNED)) {
    return { skipped: true, reason: 'notifications disabled' };
  }
  
  const email = getRecipientEmail(recipientId);
  if (!email) return { skipped: true, reason: 'no email' };
  
  const jobUrl = `https://agentfolio.bot/marketplace/jobs/${job.id}`;
  const budget = job.agreedBudget || job.budgetAmount;
  
  const content = `
    <h2 style="color:#e4e4e7;font-size:20px;margin:0 0 16px;">🎉 You've Been Selected!</h2>
    <p style="color:#a1a1aa;margin:0 0 16px;">
      Congratulations! <strong style="color:#e4e4e7;">${clientProfile.name}</strong> has selected you for their job:
    </p>
    <div style="background:#27272a;border-radius:10px;padding:16px;margin-bottom:16px;">
      <p style="color:#e4e4e7;font-weight:600;margin:0 0 8px;">${job.title}</p>
      <p style="color:#22c55e;font-size:14px;margin:0;">💰 Budget: $${budget} ${job.budgetCurrency || 'USDC'}</p>
    </div>
    <p style="color:#a1a1aa;margin:0 0 16px;">
      The escrow funds have been locked and will be released upon successful completion. 
      Get started and deliver great work!
    </p>
    <div style="text-align:center;">
      <a href="${jobUrl}" style="display:inline-block;background:linear-gradient(135deg,#a78bfa,#ec4899);color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">
        View Job Details →
      </a>
    </div>
  `;
  
  const { html, textFooter } = wrapEmailTemplate(content, recipientId);
  const text = `You've been selected for "${job.title}"! Budget: $${budget} ${job.budgetCurrency || 'USDC'}.\n\nView: ${jobUrl}${textFooter}`;
  
  return sendEmail(email, `🎉 You've been selected: ${job.title}`, html, text);
}

/**
 * Send notification: Job completed
 */
async function notifyJobCompleted(job, agentProfile, clientProfile) {
  // Notify both parties
  const results = [];
  
  // Notify agent
  if (shouldSendNotification(agentProfile.id, NOTIFICATION_TYPES.JOB_COMPLETED)) {
    const agentEmail = getRecipientEmail(agentProfile.id);
    if (agentEmail) {
      const jobUrl = `https://agentfolio.bot/marketplace/jobs/${job.id}`;
      const payout = job.budgetAmount ? `$${(job.budgetAmount * 0.95).toFixed(2)}` : 'funds';
      
      const content = `
        <h2 style="color:#e4e4e7;font-size:20px;margin:0 0 16px;">✅ Job Completed!</h2>
        <p style="color:#a1a1aa;margin:0 0 16px;">
          Great work! The job has been marked complete and ${payout} will be released to your wallet.
        </p>
        <div style="background:#27272a;border-radius:10px;padding:16px;margin-bottom:16px;">
          <p style="color:#e4e4e7;font-weight:600;margin:0 0 8px;">${job.title}</p>
          <p style="color:#22c55e;font-size:14px;margin:0;">💸 Payout: ${payout} ${job.budgetCurrency || 'USDC'}</p>
        </div>
        <p style="color:#71717a;font-size:13px;margin:0 0 16px;">
          Don't forget to leave a review for ${clientProfile.name}!
        </p>
        <div style="text-align:center;">
          <a href="${jobUrl}" style="display:inline-block;background:linear-gradient(135deg,#a78bfa,#ec4899);color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">
            Leave Review →
          </a>
        </div>
      `;
      
      const { html, textFooter } = wrapEmailTemplate(content, agentProfile.id);
      const text = `Job completed: "${job.title}". ${payout} will be released to your wallet.\n\nView: ${jobUrl}${textFooter}`;
      
      results.push(await sendEmail(agentEmail, `✅ Job completed: ${job.title}`, html, text));
    }
  }
  
  // Notify client
  if (shouldSendNotification(clientProfile.id, NOTIFICATION_TYPES.JOB_COMPLETED)) {
    const clientEmail = getRecipientEmail(clientProfile.id);
    if (clientEmail) {
      const jobUrl = `https://agentfolio.bot/marketplace/jobs/${job.id}`;
      
      const content = `
        <h2 style="color:#e4e4e7;font-size:20px;margin:0 0 16px;">✅ Job Completed!</h2>
        <p style="color:#a1a1aa;margin:0 0 16px;">
          <strong style="color:#e4e4e7;">${agentProfile.name}</strong> has completed your job and the funds have been released.
        </p>
        <div style="background:#27272a;border-radius:10px;padding:16px;margin-bottom:16px;">
          <p style="color:#e4e4e7;font-weight:600;margin:0;">${job.title}</p>
        </div>
        <p style="color:#71717a;font-size:13px;margin:0 0 16px;">
          Please leave a review to help build ${agentProfile.name}'s reputation!
        </p>
        <div style="text-align:center;">
          <a href="${jobUrl}" style="display:inline-block;background:linear-gradient(135deg,#a78bfa,#ec4899);color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">
            Leave Review →
          </a>
        </div>
      `;
      
      const { html, textFooter } = wrapEmailTemplate(content, clientProfile.id);
      const text = `Job completed: "${job.title}" by ${agentProfile.name}. Please leave a review!\n\nView: ${jobUrl}${textFooter}`;
      
      results.push(await sendEmail(clientEmail, `✅ Job completed: ${job.title}`, html, text));
    }
  }
  
  return results;
}

/**
 * Send notification: New review received
 */
async function notifyNewReview(job, review, reviewerProfile) {
  const recipientId = review.revieweeId;
  if (!shouldSendNotification(recipientId, NOTIFICATION_TYPES.NEW_REVIEW)) {
    return { skipped: true, reason: 'notifications disabled' };
  }
  
  const email = getRecipientEmail(recipientId);
  if (!email) return { skipped: true, reason: 'no email' };
  
  const profileUrl = `https://agentfolio.bot/profile/${recipientId}`;
  const stars = '⭐'.repeat(review.rating);
  
  const content = `
    <h2 style="color:#e4e4e7;font-size:20px;margin:0 0 16px;">⭐ New Review Received</h2>
    <p style="color:#a1a1aa;margin:0 0 16px;">
      <strong style="color:#e4e4e7;">${reviewerProfile.name}</strong> left you a review:
    </p>
    <div style="background:#27272a;border-radius:10px;padding:16px;margin-bottom:16px;">
      <p style="margin:0 0 8px;font-size:20px;">${stars}</p>
      ${review.comment ? `<p style="color:#e4e4e7;font-style:italic;margin:0;">"${review.comment}"</p>` : ''}
      <p style="color:#71717a;font-size:13px;margin:8px 0 0;">For: ${job.title}</p>
    </div>
    <div style="text-align:center;">
      <a href="${profileUrl}" style="display:inline-block;background:linear-gradient(135deg,#a78bfa,#ec4899);color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">
        View Your Profile →
      </a>
    </div>
  `;
  
  const { html, textFooter } = wrapEmailTemplate(content, recipientId);
  const text = `${reviewerProfile.name} left you a ${review.rating}-star review for "${job.title}"${review.comment ? `: "${review.comment}"` : ''}.\n\nView: ${profileUrl}${textFooter}`;
  
  return sendEmail(email, `⭐ ${review.rating}-star review from ${reviewerProfile.name}`, html, text);
}

/**
 * Normalize skill name for matching
 * Converts to lowercase, removes punctuation, trims whitespace
 */
function normalizeSkill(skill) {
  return (skill || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim();
}

/**
 * Check if an agent's skills match a job's required skills
 * Uses fuzzy matching (substring/contains)
 */
function skillsMatch(agentSkills, jobSkills) {
  if (!agentSkills || !jobSkills || agentSkills.length === 0 || jobSkills.length === 0) {
    return { matches: false, matchedSkills: [] };
  }
  
  const normalizedJobSkills = jobSkills.map(normalizeSkill);
  const matchedSkills = [];
  
  for (const agentSkill of agentSkills) {
    const normalizedAgent = normalizeSkill(agentSkill.name || agentSkill);
    
    for (const jobSkill of normalizedJobSkills) {
      // Check for exact match, contains, or significant overlap
      if (normalizedAgent === jobSkill ||
          normalizedAgent.includes(jobSkill) ||
          jobSkill.includes(normalizedAgent) ||
          // Handle common variations
          normalizedAgent.replace(/\s+/g, '') === jobSkill.replace(/\s+/g, '')) {
        matchedSkills.push(agentSkill.name || agentSkill);
        break;
      }
    }
  }
  
  return {
    matches: matchedSkills.length > 0,
    matchedSkills
  };
}

/**
 * Send notification: New job matching your skills
 */
async function notifyJobMatch(agentProfile, job, matchedSkills, clientProfile) {
  const recipientId = agentProfile.id;
  
  // Don't notify the client who posted the job
  if (recipientId === job.clientId) {
    return { skipped: true, reason: 'agent is job client' };
  }
  
  if (!shouldSendNotification(recipientId, NOTIFICATION_TYPES.JOB_MATCH)) {
    return { skipped: true, reason: 'notifications disabled' };
  }
  
  const email = getRecipientEmail(recipientId);
  if (!email) return { skipped: true, reason: 'no email' };
  
  const jobUrl = `https://agentfolio.bot/marketplace/jobs/${job.id}`;
  const budget = job.budgetAmount ? `$${job.budgetAmount} ${job.budgetCurrency || 'USDC'}` : 'Open';
  const skillsText = matchedSkills.slice(0, 3).join(', ') + (matchedSkills.length > 3 ? `, +${matchedSkills.length - 3} more` : '');
  
  const content = `
    <h2 style="color:#e4e4e7;font-size:20px;margin:0 0 16px;">🎯 New Job Matches Your Skills</h2>
    <p style="color:#a1a1aa;margin:0 0 16px;">
      A new job matching your skills was just posted by <strong style="color:#e4e4e7;">${clientProfile?.name || 'an agent'}</strong>:
    </p>
    <div style="background:#27272a;border-radius:10px;padding:16px;margin-bottom:16px;">
      <p style="color:#e4e4e7;font-weight:600;margin:0 0 8px;">${job.title}</p>
      <p style="color:#a1a1aa;font-size:14px;margin:0 0 8px;">${(job.description || '').substring(0, 150)}${(job.description || '').length > 150 ? '...' : ''}</p>
      <div style="margin-top:12px;padding-top:12px;border-top:1px solid #3f3f46;">
        <span style="color:#22c55e;font-weight:500;">💰 ${budget}</span>
        <span style="color:#71717a;margin-left:16px;">⏱ ${job.timeline || 'Flexible'}</span>
      </div>
    </div>
    <p style="color:#a78bfa;font-size:13px;margin:0 0 16px;">
      Matched skills: ${skillsText}
    </p>
    <div style="text-align:center;">
      <a href="${jobUrl}" style="display:inline-block;background:linear-gradient(135deg,#a78bfa,#ec4899);color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">
        View Job & Apply →
      </a>
    </div>
  `;
  
  const { html, textFooter } = wrapEmailTemplate(content, recipientId);
  const text = `New job matches your skills: "${job.title}"\nBudget: ${budget}\nMatched skills: ${skillsText}\n\nApply: ${jobUrl}${textFooter}`;
  
  return sendEmail(email, `🎯 Job match: ${job.title}`, html, text);
}

/**
 * Scan all profiles and notify matching agents when a job is posted
 * Returns summary of notifications sent
 */
async function notifyMatchingAgents(job) {
  if (!job || !job.skills || job.skills.length === 0) {
    console.log('[Notifications] Job has no skills, skipping match notifications');
    return { sent: 0, skipped: 0, matches: 0 };
  }
  
  console.log(`[Notifications] Scanning for agents matching job "${job.title}" with skills: ${job.skills.join(', ')}`);
  
  // Load client profile for email
  const clientProfile = db.loadProfile(job.clientId);
  
  // Get all profiles
  const profiles = db.listProfiles();
  
  const results = {
    sent: 0,
    skipped: 0,
    matches: 0,
    errors: 0,
    details: []
  };
  
  for (const profile of profiles) {
    // Skip the job poster
    if (profile.id === job.clientId) continue;
    
    // Check skill match
    const { matches, matchedSkills } = skillsMatch(profile.skills, job.skills);
    if (!matches) continue;
    
    results.matches++;
    
    try {
      const notifyResult = await notifyJobMatch(profile, job, matchedSkills, clientProfile);
      
      if (notifyResult.success) {
        results.sent++;
        results.details.push({ profileId: profile.id, status: 'sent', skills: matchedSkills });
      } else if (notifyResult.skipped) {
        results.skipped++;
        results.details.push({ profileId: profile.id, status: 'skipped', reason: notifyResult.reason });
      } else if (notifyResult.error) {
        results.errors++;
        results.details.push({ profileId: profile.id, status: 'error', error: notifyResult.error });
      }
    } catch (err) {
      results.errors++;
      results.details.push({ profileId: profile.id, status: 'error', error: err.message });
    }
  }
  
  console.log(`[Notifications] Job match scan complete: ${results.matches} matches, ${results.sent} sent, ${results.skipped} skipped, ${results.errors} errors`);
  
  return results;
}

module.exports = {
  NOTIFICATION_TYPES,
  DEFAULT_PREFERENCES,
  getNotificationPreferences,
  updateNotificationPreferences,
  unsubscribeAll,
  verifyUnsubscribeToken,
  shouldSendNotification,
  notifyNewApplication,
  notifyJobAssigned,
  notifyJobCompleted,
  notifyNewReview,
  notifyJobMatch,
  notifyMatchingAgents,
  skillsMatch
};
