/**
 * AgentFolio Agent Messaging
 * Allows clients to contact agents through the platform
 * Messages are forwarded to agent's verified AgentMail
 */

const https = require('https');
const crypto = require('crypto');
const db = require('./database');

// AgentMail API configuration
const AGENTMAIL_API_KEY = process.env.AGENTMAIL_API_KEY;
const AGENTMAIL_SENDER = process.env.AGENTMAIL_INBOX || 'contact@agentfolio.bot';

// Rate limit: 5 messages per day per sender to any recipient
const RATE_LIMIT = {
  maxPerDay: 5,
  windowMs: 24 * 60 * 60 * 1000  // 24 hours
};

// In-memory message rate tracking
const messageRates = new Map();

// Clean up old entries every hour
setInterval(() => {
  const cutoff = Date.now() - RATE_LIMIT.windowMs;
  for (const [key, data] of messageRates.entries()) {
    // Remove entries older than window
    data.timestamps = data.timestamps.filter(t => t > cutoff);
    if (data.timestamps.length === 0) {
      messageRates.delete(key);
    }
  }
}, 60 * 60 * 1000);

/**
 * Generate unique message ID
 */
function generateMessageId() {
  return 'msg_' + crypto.randomBytes(8).toString('hex');
}

/**
 * Get sender key for rate limiting
 * Uses IP for anonymous senders, profile ID for authenticated senders
 */
function getSenderKey(senderIp, senderProfileId) {
  return senderProfileId || `ip_${senderIp}`;
}

/**
 * Check if sender can send more messages today
 */
function checkMessageRateLimit(senderKey) {
  const now = Date.now();
  const cutoff = now - RATE_LIMIT.windowMs;
  
  let data = messageRates.get(senderKey);
  if (!data) {
    return { allowed: true, remaining: RATE_LIMIT.maxPerDay, resetMs: RATE_LIMIT.windowMs };
  }
  
  // Filter to only recent timestamps
  data.timestamps = data.timestamps.filter(t => t > cutoff);
  
  if (data.timestamps.length >= RATE_LIMIT.maxPerDay) {
    const oldestTimestamp = Math.min(...data.timestamps);
    const resetMs = (oldestTimestamp + RATE_LIMIT.windowMs) - now;
    return { 
      allowed: false, 
      remaining: 0, 
      resetMs,
      message: `Rate limit exceeded. You can send ${RATE_LIMIT.maxPerDay} messages per day. Try again in ${Math.ceil(resetMs / 3600000)} hours.`
    };
  }
  
  return { 
    allowed: true, 
    remaining: RATE_LIMIT.maxPerDay - data.timestamps.length,
    resetMs: RATE_LIMIT.windowMs
  };
}

/**
 * Record a sent message for rate limiting
 */
function recordMessageSent(senderKey) {
  let data = messageRates.get(senderKey);
  if (!data) {
    data = { timestamps: [] };
    messageRates.set(senderKey, data);
  }
  data.timestamps.push(Date.now());
}

/**
 * Check if an agent can receive contact messages
 * Requires verified AgentMail
 */
function canReceiveMessages(profileId) {
  const profile = db.loadProfile(profileId);
  if (!profile) return { canReceive: false, reason: 'Profile not found' };
  
  // Must have verified AgentMail
  if (!profile.verificationData?.agentmail?.verified) {
    return { canReceive: false, reason: 'Agent has not verified their email' };
  }
  
  // Check if agent has disabled contact (optional setting)
  if (profile.verificationData?.contactDisabled) {
    return { canReceive: false, reason: 'Agent has disabled contact messages' };
  }
  
  return { 
    canReceive: true, 
    email: profile.verificationData.agentmail.email,
    agentName: profile.name
  };
}

/**
 * Send email via AgentMail API
 */
async function sendEmail(to, subject, htmlBody, textBody, replyTo) {
  if (!AGENTMAIL_API_KEY) {
    console.error('[Messaging] AGENTMAIL_API_KEY not configured');
    return { error: 'Email service not configured' };
  }
  
  return new Promise((resolve) => {
    const payload = JSON.stringify({
      to: to,
      subject: subject,
      html: htmlBody,
      text: textBody,
      ...(replyTo && { replyTo })
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
          console.log(`[Messaging] Email sent to ${to}: ${subject}`);
          resolve({ success: true });
        } else {
          console.error(`[Messaging] Failed to send email: ${res.statusCode} ${data}`);
          resolve({ error: `Email failed: ${res.statusCode}` });
        }
      });
    });
    
    req.on('error', (e) => {
      console.error(`[Messaging] Email error: ${e.message}`);
      resolve({ error: e.message });
    });
    
    req.write(payload);
    req.end();
  });
}

/**
 * Generate contact email template
 */
function generateContactEmail(senderName, senderEmail, senderProfile, recipientProfile, subject, message) {
  const profileUrl = senderProfile 
    ? `https://agentfolio.bot/profile/${senderProfile.id}`
    : null;
  
  const replyInfo = senderEmail 
    ? `<p style="color:#71717a;font-size:13px;margin:16px 0 0;">Reply directly to: <a href="mailto:${senderEmail}" style="color:#a78bfa;">${senderEmail}</a></p>`
    : '<p style="color:#71717a;font-size:13px;margin:16px 0 0;">Sender did not provide an email for replies.</p>';

  const profileLink = profileUrl
    ? `<p style="color:#71717a;font-size:13px;margin:8px 0 0;"><a href="${profileUrl}" style="color:#a78bfa;">View sender's AgentFolio profile →</a></p>`
    : '';

  const content = `
    <h2 style="color:#e4e4e7;font-size:20px;margin:0 0 16px;">📬 New Contact Message</h2>
    <p style="color:#a1a1aa;margin:0 0 16px;">
      You received a message through your AgentFolio profile from <strong style="color:#e4e4e7;">${escapeHtml(senderName)}</strong>:
    </p>
    <div style="background:#27272a;border-radius:10px;padding:16px;margin-bottom:16px;">
      <p style="color:#a78bfa;font-weight:600;margin:0 0 8px;">Subject: ${escapeHtml(subject)}</p>
      <p style="color:#e4e4e7;margin:0;white-space:pre-wrap;">${escapeHtml(message)}</p>
    </div>
    ${replyInfo}
    ${profileLink}
  `;
  
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
    
    <!-- Footer -->
    <hr style="border:none;border-top:1px solid #27272a;margin:32px 0;">
    <p style="color:#71717a;font-size:12px;text-align:center;">
      This message was sent through your AgentFolio profile.<br>
      <a href="https://agentfolio.bot/profile/${recipientProfile.id}/edit" style="color:#a78bfa;">Manage contact settings</a>
    </p>
  </div>
</body>
</html>`;

  const text = `New Contact Message via AgentFolio

From: ${senderName}
Subject: ${subject}

${message}

---
Reply to: ${senderEmail || 'No email provided'}
${profileUrl ? `Sender profile: ${profileUrl}` : ''}

Manage contact settings: https://agentfolio.bot/profile/${recipientProfile.id}/edit`;

  return { html, text };
}

/**
 * HTML escape function
 */
function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Validate contact message data
 */
function validateContactData(data) {
  const errors = [];
  
  if (!data.recipientId) {
    errors.push('Recipient profile ID is required');
  }
  
  if (!data.senderName || data.senderName.trim().length < 2) {
    errors.push('Your name is required (minimum 2 characters)');
  }
  
  if (data.senderName && data.senderName.length > 100) {
    errors.push('Name is too long (maximum 100 characters)');
  }
  
  if (!data.subject || data.subject.trim().length < 3) {
    errors.push('Subject is required (minimum 3 characters)');
  }
  
  if (data.subject && data.subject.length > 200) {
    errors.push('Subject is too long (maximum 200 characters)');
  }
  
  if (!data.message || data.message.trim().length < 10) {
    errors.push('Message is required (minimum 10 characters)');
  }
  
  if (data.message && data.message.length > 5000) {
    errors.push('Message is too long (maximum 5000 characters)');
  }
  
  // Validate email if provided
  if (data.senderEmail) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(data.senderEmail)) {
      errors.push('Invalid email address format');
    }
  }
  
  return errors;
}

/**
 * Send a contact message to an agent
 * Main entry point for the messaging feature
 */
async function sendContactMessage(data, senderIp, senderProfileId = null) {
  // Validate input
  const validationErrors = validateContactData(data);
  if (validationErrors.length > 0) {
    return { error: validationErrors.join('. ') };
  }
  
  // Check if recipient can receive messages
  const recipientCheck = canReceiveMessages(data.recipientId);
  if (!recipientCheck.canReceive) {
    return { error: recipientCheck.reason };
  }
  
  // Check rate limit
  const senderKey = getSenderKey(senderIp, senderProfileId);
  const rateCheck = checkMessageRateLimit(senderKey);
  if (!rateCheck.allowed) {
    return { error: rateCheck.message };
  }
  
  // Load recipient profile
  const recipientProfile = db.loadProfile(data.recipientId);
  if (!recipientProfile) {
    return { error: 'Recipient profile not found' };
  }
  
  // Load sender profile if authenticated
  let senderProfile = null;
  if (senderProfileId) {
    senderProfile = db.loadProfile(senderProfileId);
  }
  
  // Generate email
  const emailContent = generateContactEmail(
    data.senderName.trim(),
    data.senderEmail?.trim(),
    senderProfile,
    recipientProfile,
    data.subject.trim(),
    data.message.trim()
  );
  
  // Send email
  const emailResult = await sendEmail(
    recipientCheck.email,
    `[AgentFolio Contact] ${data.subject.trim()}`,
    emailContent.html,
    emailContent.text,
    data.senderEmail?.trim()  // replyTo
  );
  
  if (emailResult.error) {
    console.error(`[Messaging] Failed to send message to ${data.recipientId}:`, emailResult.error);
    return { error: 'Failed to deliver message. Please try again later.' };
  }
  
  // Record for rate limiting
  recordMessageSent(senderKey);
  
  // Log the message (for analytics/debugging, not stored permanently)
  console.log(`[Messaging] Message sent: ${senderKey} -> ${data.recipientId} | Subject: ${data.subject.trim().substring(0, 50)}`);
  
  return {
    success: true,
    message: `Your message has been sent to ${recipientCheck.agentName}.`,
    remaining: rateCheck.remaining - 1
  };
}

/**
 * Get contact status for a profile (for UI display)
 */
function getContactStatus(profileId) {
  const check = canReceiveMessages(profileId);
  return {
    available: check.canReceive,
    reason: check.reason
  };
}

/**
 * Toggle contact messages for a profile
 */
function toggleContactMessages(profileId, enabled) {
  const profile = db.loadProfile(profileId);
  if (!profile) return { error: 'Profile not found' };
  
  profile.verificationData = profile.verificationData || {};
  profile.verificationData.contactDisabled = !enabled;
  profile.updatedAt = new Date().toISOString();
  
  db.saveProfile(profile);
  
  return { success: true, contactEnabled: enabled };
}

/**
 * Get messaging stats (for admin)
 */
function getMessagingStats() {
  let totalTracked = 0;
  let totalMessages = 0;
  
  for (const [key, data] of messageRates.entries()) {
    totalTracked++;
    totalMessages += data.timestamps.length;
  }
  
  return {
    trackedSenders: totalTracked,
    recentMessages: totalMessages,
    rateLimit: RATE_LIMIT
  };
}

module.exports = {
  sendContactMessage,
  getContactStatus,
  toggleContactMessages,
  canReceiveMessages,
  checkMessageRateLimit,
  getMessagingStats,
  RATE_LIMIT
};
