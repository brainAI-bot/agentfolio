/**
 * AgentMail Email Verification for AgentFolio
 * Prove ownership of AgentMail addresses via verification codes
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// AgentMail client (lazy-loaded)
let agentMailClient = null;

const PENDING_FILE = path.join(__dirname, '../../data/agentmail-verifications.json');
const CODE_EXPIRY_MS = 30 * 60 * 1000; // 30 minutes
const SENDER_INBOX = 'brainkid@agentmail.to';

/**
 * Get or create AgentMail client
 */
function getClient() {
  if (!agentMailClient) {
    try {
      const { AgentMailClient } = require('agentmail');
      const apiKey = process.env.AGENTMAIL_API_KEY;
      if (!apiKey) {
        console.warn('AGENTMAIL_API_KEY not set - email verification disabled');
        return null;
      }
      agentMailClient = new AgentMailClient({ apiKey });
    } catch (err) {
      console.error('Failed to init AgentMail client:', err.message);
      return null;
    }
  }
  return agentMailClient;
}

/**
 * Load pending verifications
 */
function loadPending() {
  try {
    if (fs.existsSync(PENDING_FILE)) {
      return JSON.parse(fs.readFileSync(PENDING_FILE, 'utf8'));
    }
  } catch (err) {
    console.error('Error loading pending verifications:', err.message);
  }
  return {};
}

/**
 * Save pending verifications
 */
function savePending(pending) {
  const dir = path.dirname(PENDING_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(PENDING_FILE, JSON.stringify(pending, null, 2));
}

/**
 * Generate a verification code
 */
function generateCode() {
  return crypto.randomBytes(3).toString('hex').toUpperCase(); // 6 char hex code
}

/**
 * Start verification - generate code and send email
 * @param {string} profileId - The profile claiming the email
 * @param {string} email - The AgentMail address to verify (e.g., "agent@agentmail.to")
 * @returns {Promise<{success: boolean, message: string, code?: string}>}
 */
async function startVerification(profileId, email) {
  // Validate email format
  if (!email || !email.includes('@')) {
    return { success: false, message: 'Invalid email format' };
  }

  // Normalize email
  email = email.toLowerCase().trim();

  // Check if already verified for another profile
  const pending = loadPending();
  
  // Clean up expired codes
  const now = Date.now();
  for (const key of Object.keys(pending)) {
    if (pending[key].expiresAt < now) {
      delete pending[key];
    }
  }

  // Generate verification code
  const code = generateCode();
  const verificationKey = `${profileId}:${email}`;

  // Store pending verification
  pending[verificationKey] = {
    profileId,
    email,
    code,
    createdAt: now,
    expiresAt: now + CODE_EXPIRY_MS
  };
  savePending(pending);

  // Try to send email
  const client = getClient();
  if (!client) {
    // Return code for manual verification if email sending fails
    return {
      success: true,
      message: 'Verification code generated. Email sending not available - use manual code entry.',
      code, // Return code for testing/debugging
      manualOnly: true
    };
  }

  try {
    // AgentMail JS SDK: send(inbox_id, request)
    await client.inboxes.messages.send(SENDER_INBOX, {
      to: [email],
      subject: `🧠 AgentFolio Verification Code: ${code}`,
      text: `Hi there!

Your AgentFolio verification code is: ${code}

Enter this code on AgentFolio to verify ownership of ${email}.

This code expires in 30 minutes.

If you didn't request this verification, you can safely ignore this email.

— AgentFolio (https://agentfolio.bot)
Built by @0xbrainKID`,
      html: `
        <div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #6366f1;">🧠 AgentFolio Verification</h2>
          <p>Your verification code is:</p>
          <div style="background: #1a1a2e; color: #00ff88; font-size: 32px; font-family: monospace; padding: 20px; text-align: center; border-radius: 8px; letter-spacing: 4px;">
            ${code}
          </div>
          <p style="color: #666; margin-top: 20px;">
            Enter this code on AgentFolio to verify ownership of <strong>${email}</strong>.
          </p>
          <p style="color: #999; font-size: 12px;">
            This code expires in 30 minutes. If you didn't request this, you can ignore this email.
          </p>
          <hr style="border: none; border-top: 1px solid #333; margin: 20px 0;">
          <p style="color: #666; font-size: 12px;">
            <a href="https://agentfolio.bot" style="color: #6366f1;">AgentFolio</a> — Portfolio & Reputation for AI Agents
            <br>Built by <a href="https://x.com/0xbrainKID" style="color: #6366f1;">@0xbrainKID</a>
          </p>
        </div>
      `
    });

    return {
      success: true,
      message: `Verification email sent to ${email}. Check your inbox and enter the 6-character code.`,
      emailSent: true
    };
  } catch (err) {
    console.error('Failed to send verification email:', err.message);
    return {
      success: true,
      message: `Could not send email (${err.message}). Use code: ${code}`,
      code, // Return code as fallback
      manualOnly: true
    };
  }
}

/**
 * Confirm verification with code
 * @param {string} profileId - The profile ID
 * @param {string} email - The email being verified
 * @param {string} code - The verification code entered by user
 * @returns {{success: boolean, message: string}}
 */
function confirmVerification(profileId, email, code) {
  if (!code || code.length !== 6) {
    return { success: false, message: 'Invalid code format (must be 6 characters)' };
  }

  email = email.toLowerCase().trim();
  code = code.toUpperCase().trim();

  const pending = loadPending();
  const verificationKey = `${profileId}:${email}`;
  const verification = pending[verificationKey];

  if (!verification) {
    return { success: false, message: 'No pending verification found. Please start a new verification.' };
  }

  if (Date.now() > verification.expiresAt) {
    delete pending[verificationKey];
    savePending(pending);
    return { success: false, message: 'Verification code expired. Please request a new one.' };
  }

  if (verification.code !== code) {
    return { success: false, message: 'Invalid verification code.' };
  }

  // Success - remove pending
  delete pending[verificationKey];
  savePending(pending);

  return {
    success: true,
    message: `Successfully verified ${email}!`,
    email,
    verifiedAt: new Date().toISOString()
  };
}

/**
 * Get pending verification status
 */
function getPendingStatus(profileId, email) {
  email = email?.toLowerCase().trim();
  const pending = loadPending();
  const verificationKey = `${profileId}:${email}`;
  const verification = pending[verificationKey];

  if (!verification) {
    return { hasPending: false };
  }

  if (Date.now() > verification.expiresAt) {
    return { hasPending: false, expired: true };
  }

  return {
    hasPending: true,
    email: verification.email,
    expiresAt: verification.expiresAt,
    expiresIn: Math.round((verification.expiresAt - Date.now()) / 1000)
  };
}

/**
 * Check if AgentMail verification is available
 */
function isVerificationAvailable() {
  return !!process.env.AGENTMAIL_API_KEY;
}

module.exports = {
  startVerification,
  confirmVerification,
  getPendingStatus,
  isVerificationAvailable,
  SENDER_INBOX
};
