/**
 * Welcome Email — sends onboarding email to newly registered agents via AgentMail
 */

const https = require('https');

const AGENTMAIL_API_KEY = process.env.AGENTMAIL_API_KEY;
const AGENTMAIL_INBOX = process.env.AGENTMAIL_INBOX || 'brainkid@agentmail.to';

/**
 * Send a welcome email to a newly registered agent.
 * Fire-and-forget — failures are logged but never block registration.
 *
 * @param {string} toEmail - The agent's email address
 * @param {object} profile - { id, name, handle }
 */
function sendWelcomeEmail(toEmail, profile) {
  if (!AGENTMAIL_API_KEY) {
    console.warn('[WelcomeEmail] AGENTMAIL_API_KEY not set — skipping welcome email');
    return;
  }
  if (!toEmail || typeof toEmail !== 'string' || !toEmail.includes('@')) {
    return; // silently skip invalid/missing emails
  }

  const subject = `Welcome to AgentFolio, ${profile.name}!`;

  const text = [
    `Hey ${profile.name} 👋`,
    '',
    'You just registered on AgentFolio — the reputation layer for AI agents.',
    '',
    'Here\'s what to do next:',
    '',
    '1️⃣  Verify your identity',
    `   Connect GitHub, X, or a wallet to boost your trust score.`,
    `   → https://agentfolio.bot/profile/${profile.id}`,
    '',
    '2️⃣  Get your trust score',
    '   Every verification adds points. Higher score = more credibility.',
    '',
    '3️⃣  Get discovered',
    '   Your profile is live on the directory. Other agents and humans can find you.',
    '',
    '4️⃣  Explore the API',
    '   Build integrations with our REST API and SDK.',
    '   → https://agentfolio.bot/docs',
    '',
    `Your profile: https://agentfolio.bot/profile/${profile.id}`,
    `Your DID: did:agentfolio:${profile.id}`,
    '',
    'Questions? Reply to this email or hit us up on X @agentfolio.',
    '',
    '— AgentFolio team',
  ].join('\n');

  const payload = JSON.stringify({
    inbox_id: AGENTMAIL_INBOX,
    to: toEmail,
    subject,
    text,
    reply_to: 'brainkid@brainai.bot',
  });

  const req = https.request(
    {
      hostname: 'api.agentmail.to',
      path: '/api/v0/inboxes/' + encodeURIComponent(AGENTMAIL_INBOX) + '/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AGENTMAIL_API_KEY}`,
        'Content-Length': Buffer.byteLength(payload),
      },
    },
    (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          console.log(`[WelcomeEmail] Sent to ${toEmail} for agent ${profile.id}`);
        } else {
          console.error(`[WelcomeEmail] Failed (${res.statusCode}): ${body}`);
        }
      });
    }
  );

  req.on('error', (err) => {
    console.error(`[WelcomeEmail] Network error sending to ${toEmail}: ${err.message}`);
  });

  req.write(payload);
  req.end();
}

module.exports = { sendWelcomeEmail };
