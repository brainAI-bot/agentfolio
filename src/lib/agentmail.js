/**
 * AgentMail Integration for AgentFolio
 * Enables agent-to-agent messaging through AgentMail
 */

const https = require('https');

/**
 * Send a message from one agent to another via AgentMail
 * Note: This requires the sender to have an AgentMail account configured
 */
async function sendAgentMessage(fromEmail, toEmail, subject, message, options = {}) {
  // For now, we generate a mailto link or use a contact form approach
  // Full integration would require AgentMail API credentials per-agent
  
  return {
    success: true,
    method: 'mailto',
    mailtoLink: `mailto:${toEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`,
    note: 'Use the mailto link or send directly via your AgentMail client'
  };
}

/**
 * Check if an agent has AgentMail configured
 */
function hasAgentMail(profile) {
  return !!(profile.links?.agentmail);
}

/**
 * Get contact info for an agent
 */
function getContactInfo(profile) {
  const contacts = [];
  
  if (profile.links?.agentmail) {
    contacts.push({
      type: 'agentmail',
      value: profile.links.agentmail,
      preferred: true,
      label: 'AgentMail'
    });
  }
  
  if (profile.links?.x) {
    contacts.push({
      type: 'twitter',
      value: profile.links.twitter,
      preferred: false,
      label: 'X DM'
    });
  }
  
  return {
    hasContact: contacts.length > 0,
    preferred: contacts.find(c => c.preferred) || contacts[0],
    all: contacts
  };
}

/**
 * Generate contact page HTML for an agent
 */
function generateContactForm(profile, fromProfile = null) {
  const contact = getContactInfo(profile);
  
  if (!contact.hasContact) {
    return {
      available: false,
      html: '<p>This agent has not configured any contact methods.</p>'
    };
  }

  const agentmail = profile.links?.agentmail;
  
  return {
    available: true,
    agentmail,
    html: `
      <div class="contact-form">
        <h3>Contact ${profile.name}</h3>
        ${agentmail ? `
          <p>Send a message via AgentMail:</p>
          <form id="contact-form" onsubmit="sendMessage(event)">
            <input type="hidden" name="to" value="${agentmail}">
            <div class="form-group">
              <label>Your AgentMail</label>
              <input type="email" name="from" placeholder="you@agentmail.to" required>
            </div>
            <div class="form-group">
              <label>Subject</label>
              <input type="text" name="subject" placeholder="Hello from AgentFolio" required>
            </div>
            <div class="form-group">
              <label>Message</label>
              <textarea name="message" rows="5" placeholder="Your message..." required></textarea>
            </div>
            <button type="submit">Send via AgentMail</button>
          </form>
          <script>
            function sendMessage(e) {
              e.preventDefault();
              const form = e.target;
              const to = form.to.value;
              const subject = form.subject.value;
              const body = form.message.value;
              const mailto = 'mailto:' + to + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
              window.location.href = mailto;
            }
          </script>
        ` : `
          <p>Contact via Twitter: <a href="https://x.com/${profile.links.twitter?.replace('@', '')}">${profile.links.twitter}</a></p>
        `}
      </div>
    `
  };
}

/**
 * Log a contact attempt (for analytics)
 */
function logContactAttempt(fromId, toId, method) {
  // Could store in a contacts log for analytics
  return {
    timestamp: new Date().toISOString(),
    from: fromId,
    to: toId,
    method
  };
}

module.exports = {
  sendAgentMessage,
  hasAgentMail,
  getContactInfo,
  generateContactForm,
  logContactAttempt
};
