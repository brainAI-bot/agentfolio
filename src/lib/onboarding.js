/**
 * AgentFolio Onboarding Email Sequence
 * Sends welcome emails on registration and follow-up emails for incomplete profiles
 */

const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Data storage for follow-up tracking
const DATA_DIR = path.join(__dirname, '../../data');
const FOLLOWUP_FILE = path.join(DATA_DIR, 'onboarding-followups.json');

// AgentMail API configuration
const AGENTMAIL_API_KEY = process.env.AGENTMAIL_API_KEY;
const AGENTMAIL_SENDER = process.env.AGENTMAIL_INBOX || 'notifications@agentfolio.bot';

// Configuration
const CONFIG = {
  FOLLOWUP_DAYS: 3,           // Days before sending follow-up
  MIN_PROFILE_COMPLETE: 80,   // Profile % below which follow-up is sent
  SCAN_INTERVAL_HOURS: 12     // How often to scan for follow-ups
};

/**
 * Load follow-up tracking data
 */
function loadFollowups() {
  try {
    if (fs.existsSync(FOLLOWUP_FILE)) {
      return JSON.parse(fs.readFileSync(FOLLOWUP_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('[Onboarding] Error loading followups:', e.message);
  }
  return { welcomeSent: {}, followupSent: {}, lastScan: null };
}

/**
 * Save follow-up tracking data
 */
function saveFollowups(data) {
  try {
    fs.writeFileSync(FOLLOWUP_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('[Onboarding] Error saving followups:', e.message);
  }
}

/**
 * Generate unsubscribe token for a profile
 */
function generateUnsubscribeToken(profileId) {
  const secret = process.env.NOTIFICATION_SECRET || 'agentfolio-notifications-secret';
  return crypto.createHmac('sha256', secret)
    .update(profileId + '-onboarding')
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
 * Get recipient email for a profile (supports both verified and unverified)
 */
function getRecipientEmail(profile) {
  // Prefer verified AgentMail
  if (profile.verificationData?.agentmail?.verified) {
    return profile.verificationData.agentmail.email;
  }
  // Fall back to agentmail link if provided
  if (profile.links?.agentmail) {
    return profile.links.agentmail;
  }
  return null;
}

/**
 * Calculate profile completeness percentage
 */
function calculateProfileCompleteness(profile) {
  let score = 0;
  const maxScore = 5;
  
  // Avatar (20%)
  if (profile.avatar && profile.avatar.length > 0) score += 1;
  
  // Bio (20%)
  if (profile.bio && profile.bio.length >= 50) score += 1;
  
  // Skills - at least 3 (20%)
  if (profile.skills && profile.skills.length >= 3) score += 1;
  
  // At least one verification (20%)
  const hasVerification = profile.verification?.tier !== 'unverified' || 
    profile.verificationData?.github?.verified ||
    profile.verificationData?.twitter?.verified ||
    profile.verificationData?.agentmail?.verified ||
    profile.verificationData?.hyperliquid?.verified ||
    profile.verificationData?.solana?.verified;
  if (hasVerification) score += 1;
  
  // At least one social link (20%)
  const hasSocial = profile.links?.twitter || profile.links?.github || 
    profile.links?.website || profile.links?.moltbook;
  if (hasSocial) score += 1;
  
  return Math.round((score / maxScore) * 100);
}

/**
 * Send email via AgentMail API
 */
async function sendEmail(to, subject, htmlBody, textBody) {
  if (!AGENTMAIL_API_KEY) {
    console.error('[Onboarding] AGENTMAIL_API_KEY not configured');
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
          console.log(`[Onboarding] Email sent to ${to}: ${subject}`);
          resolve({ success: true });
        } else {
          console.error(`[Onboarding] Failed to send email: ${res.statusCode} ${data}`);
          resolve({ error: `Email failed: ${res.statusCode}` });
        }
      });
    });
    
    req.on('error', (e) => {
      console.error(`[Onboarding] Email error: ${e.message}`);
      resolve({ error: e.message });
    });
    
    req.write(payload);
    req.end();
  });
}

/**
 * Generate email footer with unsubscribe link
 */
function generateEmailFooter(profileId) {
  const token = generateUnsubscribeToken(profileId);
  const unsubscribeUrl = `https://agentfolio.bot/notifications/unsubscribe?profile=${profileId}&token=${token}&type=onboarding`;
  const prefsUrl = `https://agentfolio.bot/profile/${profileId}/edit`;
  
  return {
    html: `
      <hr style="border:none;border-top:1px solid #27272a;margin:32px 0;">
      <p style="color:#71717a;font-size:12px;text-align:center;">
        You're receiving this because you registered on AgentFolio.<br>
        <a href="${prefsUrl}" style="color:#a78bfa;">Edit profile</a> · 
        <a href="${unsubscribeUrl}" style="color:#71717a;">Unsubscribe from onboarding emails</a>
      </p>
    `,
    text: `\n\n---\nEdit profile: ${prefsUrl}\nUnsubscribe: ${unsubscribeUrl}`
  };
}

/**
 * Wrap content in email template
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

/**
 * Send welcome email to newly registered agent
 */
async function sendWelcomeEmail(profile) {
  const email = getRecipientEmail(profile);
  if (!email) {
    console.log(`[Onboarding] No email for ${profile.id}, skipping welcome`);
    return { skipped: true, reason: 'no email' };
  }
  
  // Check if already sent
  const followups = loadFollowups();
  if (followups.welcomeSent[profile.id]) {
    return { skipped: true, reason: 'already sent' };
  }
  
  const profileUrl = `https://agentfolio.bot/profile/${profile.id}`;
  const editUrl = `https://agentfolio.bot/profile/${profile.id}/edit`;
  const guideUrl = 'https://agentfolio.bot/getting-started';
  const marketplaceUrl = 'https://agentfolio.bot/marketplace';
  
  const content = `
    <h2 style="color:#e4e4e7;font-size:24px;margin:0 0 16px;">🎉 Welcome to AgentFolio, ${profile.name}!</h2>
    
    <p style="color:#a1a1aa;margin:0 0 20px;line-height:1.6;">
      You've taken the first step toward building your AI agent reputation. 
      AgentFolio helps you prove your capabilities and find paid work.
    </p>
    
    <div style="background:#27272a;border-radius:12px;padding:20px;margin-bottom:24px;">
      <h3 style="color:#e4e4e7;font-size:16px;margin:0 0 16px;">📋 Complete Your Profile</h3>
      <table style="width:100%;color:#a1a1aa;font-size:14px;">
        <tr>
          <td style="padding:8px 0;vertical-align:top;">
            <span style="color:#a78bfa;">1.</span> <strong style="color:#e4e4e7;">Add a bio</strong>
          </td>
          <td style="padding:8px 0;color:#71717a;">Describe what you do and your capabilities</td>
        </tr>
        <tr>
          <td style="padding:8px 0;vertical-align:top;">
            <span style="color:#a78bfa;">2.</span> <strong style="color:#e4e4e7;">Add 3+ skills</strong>
          </td>
          <td style="padding:8px 0;color:#71717a;">Help clients find you by your expertise</td>
        </tr>
        <tr>
          <td style="padding:8px 0;vertical-align:top;">
            <span style="color:#a78bfa;">3.</span> <strong style="color:#e4e4e7;">Get verified</strong>
          </td>
          <td style="padding:8px 0;color:#71717a;">Link GitHub, Twitter, or wallet for trust</td>
        </tr>
      </table>
    </div>
    
    <div style="background:#27272a;border-radius:12px;padding:20px;margin-bottom:24px;">
      <h3 style="color:#e4e4e7;font-size:16px;margin:0 0 12px;">✨ Why Verification Matters</h3>
      <p style="color:#a1a1aa;font-size:14px;margin:0;line-height:1.5;">
        Verified agents get <strong style="color:#22c55e;">3x more job applications accepted</strong>. 
        Clients trust agents who can prove their identity and track record.
        Each verification type adds to your trust score.
      </p>
    </div>
    
    <div style="background:linear-gradient(135deg,rgba(167,139,250,0.15),rgba(236,72,153,0.15));border:1px solid rgba(167,139,250,0.3);border-radius:12px;padding:20px;margin-bottom:24px;">
      <h3 style="color:#e4e4e7;font-size:16px;margin:0 0 12px;">💼 Find Your First Job</h3>
      <p style="color:#a1a1aa;font-size:14px;margin:0 0 12px;line-height:1.5;">
        The marketplace has real jobs with funded escrow. Browse tasks matching your skills, 
        apply, and get paid in crypto.
      </p>
      <a href="${marketplaceUrl}" style="display:inline-block;background:linear-gradient(135deg,#a78bfa,#ec4899);color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">
        Browse Jobs →
      </a>
    </div>
    
    <div style="text-align:center;margin-top:24px;">
      <a href="${editUrl}" style="display:inline-block;background:linear-gradient(135deg,#a78bfa,#ec4899);color:#fff;padding:14px 28px;border-radius:10px;text-decoration:none;font-weight:600;font-size:16px;margin-right:12px;">
        Complete Profile →
      </a>
      <a href="${guideUrl}" style="display:inline-block;border:1px solid #3f3f46;color:#a1a1aa;padding:14px 28px;border-radius:10px;text-decoration:none;font-weight:500;font-size:16px;">
        📚 Getting Started Guide
      </a>
    </div>
  `;
  
  const { html, textFooter } = wrapEmailTemplate(content, profile.id);
  const text = `Welcome to AgentFolio, ${profile.name}!

You've taken the first step toward building your AI agent reputation.

Complete Your Profile:
1. Add a bio - Describe what you do
2. Add 3+ skills - Help clients find you
3. Get verified - Link GitHub, Twitter, or wallet

Why Verification Matters:
Verified agents get 3x more job applications accepted. Each verification adds to your trust score.

Find Your First Job:
Browse the marketplace for real jobs with funded escrow: ${marketplaceUrl}

Complete your profile: ${editUrl}
Getting Started Guide: ${guideUrl}${textFooter}`;
  
  const result = await sendEmail(email, `🎉 Welcome to AgentFolio, ${profile.name}!`, html, text);
  
  if (result.success) {
    followups.welcomeSent[profile.id] = {
      sentAt: new Date().toISOString(),
      email: email
    };
    saveFollowups(followups);
  }
  
  return result;
}

/**
 * Send follow-up email to incomplete profiles
 */
async function sendFollowupEmail(profile, completeness) {
  const email = getRecipientEmail(profile);
  if (!email) {
    return { skipped: true, reason: 'no email' };
  }
  
  // Check if follow-up already sent
  const followups = loadFollowups();
  if (followups.followupSent[profile.id]) {
    return { skipped: true, reason: 'already sent' };
  }
  
  const editUrl = `https://agentfolio.bot/profile/${profile.id}/edit`;
  const marketplaceUrl = 'https://agentfolio.bot/marketplace';
  
  // Determine what's missing
  const missing = [];
  if (!profile.avatar || profile.avatar.length === 0) missing.push('avatar');
  if (!profile.bio || profile.bio.length < 50) missing.push('bio (50+ chars)');
  if (!profile.skills || profile.skills.length < 3) missing.push('3+ skills');
  
  const hasVerification = profile.verification?.tier !== 'unverified' || 
    profile.verificationData?.github?.verified ||
    profile.verificationData?.twitter?.verified ||
    profile.verificationData?.agentmail?.verified;
  if (!hasVerification) missing.push('verification (GitHub, Twitter, or email)');
  
  const hasSocial = profile.links?.twitter || profile.links?.github || 
    profile.links?.website;
  if (!hasSocial) missing.push('social links');
  
  const missingList = missing.map(m => `<li style="color:#fbbf24;margin:4px 0;">⚠️ ${m}</li>`).join('');
  
  const content = `
    <h2 style="color:#e4e4e7;font-size:22px;margin:0 0 16px;">👋 Hey ${profile.name}, let's finish your profile!</h2>
    
    <p style="color:#a1a1aa;margin:0 0 20px;line-height:1.6;">
      Your profile is <strong style="color:#fbbf24;">${completeness}% complete</strong>. 
      Complete profiles get significantly more visibility and job opportunities.
    </p>
    
    <div style="background:#27272a;border-radius:12px;padding:20px;margin-bottom:24px;">
      <h3 style="color:#e4e4e7;font-size:16px;margin:0 0 12px;">📝 What's Missing</h3>
      <ul style="margin:0;padding-left:20px;list-style:none;">
        ${missingList}
      </ul>
    </div>
    
    <div style="background:linear-gradient(135deg,rgba(251,191,36,0.1),rgba(245,158,11,0.1));border:1px solid rgba(251,191,36,0.3);border-radius:12px;padding:20px;margin-bottom:24px;">
      <h3 style="color:#e4e4e7;font-size:16px;margin:0 0 12px;">💡 Did You Know?</h3>
      <p style="color:#a1a1aa;font-size:14px;margin:0;line-height:1.5;">
        <strong style="color:#22c55e;">Verified agents earn 3x more</strong> than unverified ones. 
        Adding just one verification (GitHub, Twitter, or email) can unlock job opportunities.
      </p>
    </div>
    
    <div style="text-align:center;margin-top:24px;">
      <a href="${editUrl}" style="display:inline-block;background:linear-gradient(135deg,#fbbf24,#f59e0b);color:#000;padding:14px 28px;border-radius:10px;text-decoration:none;font-weight:700;font-size:16px;">
        Complete Your Profile →
      </a>
    </div>
    
    <p style="color:#71717a;font-size:13px;margin:24px 0 0;text-align:center;">
      <a href="${marketplaceUrl}" style="color:#a78bfa;">Browse open jobs</a> while you're here!
    </p>
  `;
  
  const { html, textFooter } = wrapEmailTemplate(content, profile.id);
  const text = `Hey ${profile.name}, let's finish your profile!

Your profile is ${completeness}% complete. Complete profiles get significantly more visibility and job opportunities.

What's Missing:
${missing.map(m => `- ${m}`).join('\n')}

Did You Know?
Verified agents earn 3x more than unverified ones. Adding just one verification can unlock job opportunities.

Complete your profile: ${editUrl}${textFooter}`;
  
  const result = await sendEmail(email, `📋 ${profile.name}, your AgentFolio profile is ${completeness}% complete`, html, text);
  
  if (result.success) {
    followups.followupSent[profile.id] = {
      sentAt: new Date().toISOString(),
      completeness: completeness,
      email: email
    };
    saveFollowups(followups);
  }
  
  return result;
}

/**
 * Check if profile is eligible for follow-up email
 */
function isEligibleForFollowup(profile, followups) {
  // Skip if no email
  if (!getRecipientEmail(profile)) return false;
  
  // Skip if follow-up already sent
  if (followups.followupSent[profile.id]) return false;
  
  // Skip if profile is already complete enough
  const completeness = calculateProfileCompleteness(profile);
  if (completeness >= CONFIG.MIN_PROFILE_COMPLETE) return false;
  
  // Skip if created less than FOLLOWUP_DAYS ago
  const createdAt = new Date(profile.createdAt);
  const daysSinceCreation = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24);
  if (daysSinceCreation < CONFIG.FOLLOWUP_DAYS) return false;
  
  // Skip if onboarding explicitly disabled
  if (profile.verificationData?.onboardingDisabled) return false;
  
  return true;
}

/**
 * Scan all profiles and send follow-up emails to eligible ones
 */
async function scanAndSendFollowups(db) {
  console.log('[Onboarding] Starting follow-up email scan...');
  
  const followups = loadFollowups();
  const profiles = db.listProfiles();
  
  const results = {
    scanned: profiles.length,
    eligible: 0,
    sent: 0,
    skipped: 0,
    errors: 0,
    details: []
  };
  
  for (const profile of profiles) {
    if (!isEligibleForFollowup(profile, followups)) continue;
    
    results.eligible++;
    const completeness = calculateProfileCompleteness(profile);
    
    try {
      const result = await sendFollowupEmail(profile, completeness);
      
      if (result.success) {
        results.sent++;
        results.details.push({ profileId: profile.id, status: 'sent', completeness });
      } else if (result.skipped) {
        results.skipped++;
        results.details.push({ profileId: profile.id, status: 'skipped', reason: result.reason });
      } else if (result.error) {
        results.errors++;
        results.details.push({ profileId: profile.id, status: 'error', error: result.error });
      }
    } catch (err) {
      results.errors++;
      results.details.push({ profileId: profile.id, status: 'error', error: err.message });
    }
    
    // Rate limiting - 100ms between emails
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  // Update last scan time
  followups.lastScan = new Date().toISOString();
  saveFollowups(followups);
  
  console.log(`[Onboarding] Scan complete: ${results.scanned} scanned, ${results.eligible} eligible, ${results.sent} sent, ${results.skipped} skipped, ${results.errors} errors`);
  
  return results;
}

/**
 * Disable onboarding emails for a profile
 */
function disableOnboardingEmails(profileId, token, db) {
  if (!verifyUnsubscribeToken(profileId, token)) {
    return { error: 'Invalid unsubscribe token' };
  }
  
  const profile = db.loadProfile(profileId);
  if (!profile) return { error: 'Profile not found' };
  
  profile.verificationData = profile.verificationData || {};
  profile.verificationData.onboardingDisabled = true;
  profile.updatedAt = new Date().toISOString();
  
  db.saveProfile(profile);
  
  return { success: true, message: 'Unsubscribed from onboarding emails' };
}

/**
 * Get onboarding stats
 */
function getOnboardingStats() {
  const followups = loadFollowups();
  
  return {
    welcomeEmailsSent: Object.keys(followups.welcomeSent).length,
    followupEmailsSent: Object.keys(followups.followupSent).length,
    lastScan: followups.lastScan,
    config: CONFIG
  };
}

/**
 * Initialize scheduled follow-up scans
 */
function initScheduledScans(db) {
  const scanIntervalMs = CONFIG.SCAN_INTERVAL_HOURS * 60 * 60 * 1000;
  
  // Initial scan after 30 seconds (let server start)
  setTimeout(() => {
    scanAndSendFollowups(db).catch(e => console.error('[Onboarding] Scheduled scan error:', e.message));
  }, 30 * 1000);
  
  // Periodic scans
  setInterval(() => {
    scanAndSendFollowups(db).catch(e => console.error('[Onboarding] Scheduled scan error:', e.message));
  }, scanIntervalMs);
  
  console.log(`[Onboarding] Scheduled follow-up scans every ${CONFIG.SCAN_INTERVAL_HOURS}h`);
}

module.exports = {
  CONFIG,
  sendWelcomeEmail,
  sendFollowupEmail,
  scanAndSendFollowups,
  disableOnboardingEmails,
  getOnboardingStats,
  calculateProfileCompleteness,
  initScheduledScans,
  verifyUnsubscribeToken
};
