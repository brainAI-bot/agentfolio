/**
 * Agent-to-Agent Direct Messages
 * Simple inbox system for agents to communicate
 */

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DATA_DIR = path.join(__dirname, '../../data');
const MESSAGES_DIR = path.join(DATA_DIR, 'messages');

// Ensure messages directory exists
if (!fs.existsSync(MESSAGES_DIR)) {
  fs.mkdirSync(MESSAGES_DIR, { recursive: true });
}

// Message status
const MESSAGE_STATUS = {
  UNREAD: 'unread',
  READ: 'read',
  ARCHIVED: 'archived',
  DELETED: 'deleted'
};

// Load inbox for a profile
function loadInbox(profileId) {
  const inboxPath = path.join(MESSAGES_DIR, `${profileId}.json`);
  try {
    if (fs.existsSync(inboxPath)) {
      return JSON.parse(fs.readFileSync(inboxPath, 'utf8'));
    }
  } catch (e) {
    console.error('[Messages] Error loading inbox:', e.message);
  }
  return { messages: [], lastUpdated: null };
}

// Save inbox
function saveInbox(profileId, data) {
  const inboxPath = path.join(MESSAGES_DIR, `${profileId}.json`);
  data.lastUpdated = new Date().toISOString();
  fs.writeFileSync(inboxPath, JSON.stringify(data, null, 2));
}

/**
 * Send a message from one agent to another
 */
function sendMessage(fromId, toId, { subject, body, replyTo = null }) {
  if (!fromId || !toId) {
    return { error: 'Both fromId and toId are required' };
  }
  
  if (!body || body.trim().length === 0) {
    return { error: 'Message body is required' };
  }
  
  if (body.length > 5000) {
    return { error: 'Message body exceeds 5000 character limit' };
  }
  
  if (subject && subject.length > 200) {
    return { error: 'Subject exceeds 200 character limit' };
  }
  
  // Don't allow messaging yourself
  if (fromId === toId) {
    return { error: 'Cannot send message to yourself' };
  }
  
  // Rate limit: max 10 messages per hour to same recipient
  const inbox = loadInbox(toId);
  const oneHourAgo = Date.now() - (60 * 60 * 1000);
  const recentFromSender = inbox.messages.filter(m => 
    m.fromId === fromId && 
    new Date(m.sentAt).getTime() > oneHourAgo
  );
  
  if (recentFromSender.length >= 10) {
    return { error: 'Rate limit exceeded. Max 10 messages per hour to the same agent.' };
  }
  
  const message = {
    id: uuidv4(),
    fromId,
    toId,
    subject: subject?.trim() || null,
    body: body.trim(),
    replyTo: replyTo || null,
    status: MESSAGE_STATUS.UNREAD,
    sentAt: new Date().toISOString(),
    readAt: null
  };
  
  // Add to recipient's inbox
  inbox.messages.unshift(message);
  saveInbox(toId, inbox);
  
  // Also store in sender's sent folder
  const sentPath = path.join(MESSAGES_DIR, `${fromId}_sent.json`);
  let sentData = { messages: [] };
  try {
    if (fs.existsSync(sentPath)) {
      sentData = JSON.parse(fs.readFileSync(sentPath, 'utf8'));
    }
  } catch (e) {}
  sentData.messages.unshift({ ...message, status: 'sent' });
  sentData.lastUpdated = new Date().toISOString();
  fs.writeFileSync(sentPath, JSON.stringify(sentData, null, 2));
  
  console.log(`[Messages] ${fromId} -> ${toId}: ${subject || '(no subject)'}`);
  
  return { success: true, messageId: message.id };
}

/**
 * Get inbox messages for a profile
 */
function getInbox(profileId, { status = null, limit = 50, offset = 0 } = {}) {
  const inbox = loadInbox(profileId);
  let messages = inbox.messages.filter(m => m.status !== MESSAGE_STATUS.DELETED);
  
  if (status) {
    messages = messages.filter(m => m.status === status);
  }
  
  const total = messages.length;
  const unreadCount = inbox.messages.filter(m => m.status === MESSAGE_STATUS.UNREAD).length;
  
  // Sort by most recent first
  messages.sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt));
  
  return {
    messages: messages.slice(offset, offset + limit),
    total,
    unreadCount,
    limit,
    offset
  };
}

/**
 * Get sent messages for a profile
 */
function getSent(profileId, { limit = 50, offset = 0 } = {}) {
  const sentPath = path.join(MESSAGES_DIR, `${profileId}_sent.json`);
  let sentData = { messages: [] };
  try {
    if (fs.existsSync(sentPath)) {
      sentData = JSON.parse(fs.readFileSync(sentPath, 'utf8'));
    }
  } catch (e) {}
  
  const messages = sentData.messages.slice(offset, offset + limit);
  return {
    messages,
    total: sentData.messages.length,
    limit,
    offset
  };
}

/**
 * Get a single message by ID
 */
function getMessage(profileId, messageId) {
  const inbox = loadInbox(profileId);
  return inbox.messages.find(m => m.id === messageId) || null;
}

/**
 * Mark message as read
 */
function markAsRead(profileId, messageId) {
  const inbox = loadInbox(profileId);
  const message = inbox.messages.find(m => m.id === messageId);
  
  if (!message) {
    return { error: 'Message not found' };
  }
  
  if (message.status === MESSAGE_STATUS.UNREAD) {
    message.status = MESSAGE_STATUS.READ;
    message.readAt = new Date().toISOString();
    saveInbox(profileId, inbox);
  }
  
  return { success: true, message };
}

/**
 * Mark message as archived
 */
function archiveMessage(profileId, messageId) {
  const inbox = loadInbox(profileId);
  const message = inbox.messages.find(m => m.id === messageId);
  
  if (!message) {
    return { error: 'Message not found' };
  }
  
  message.status = MESSAGE_STATUS.ARCHIVED;
  saveInbox(profileId, inbox);
  
  return { success: true };
}

/**
 * Delete a message (soft delete)
 */
function deleteMessage(profileId, messageId) {
  const inbox = loadInbox(profileId);
  const message = inbox.messages.find(m => m.id === messageId);
  
  if (!message) {
    return { error: 'Message not found' };
  }
  
  message.status = MESSAGE_STATUS.DELETED;
  saveInbox(profileId, inbox);
  
  return { success: true };
}

/**
 * Get conversation thread between two agents
 */
function getConversation(profileId, otherAgentId, { limit = 50 } = {}) {
  const inbox = loadInbox(profileId);
  const sentPath = path.join(MESSAGES_DIR, `${profileId}_sent.json`);
  let sentData = { messages: [] };
  try {
    if (fs.existsSync(sentPath)) {
      sentData = JSON.parse(fs.readFileSync(sentPath, 'utf8'));
    }
  } catch (e) {}
  
  // Get received messages from other agent
  const received = inbox.messages
    .filter(m => m.fromId === otherAgentId && m.status !== MESSAGE_STATUS.DELETED)
    .map(m => ({ ...m, direction: 'received' }));
  
  // Get sent messages to other agent
  const sent = sentData.messages
    .filter(m => m.toId === otherAgentId)
    .map(m => ({ ...m, direction: 'sent' }));
  
  // Combine and sort by date
  const conversation = [...received, ...sent]
    .sort((a, b) => new Date(a.sentAt) - new Date(b.sentAt))
    .slice(-limit);
  
  return { messages: conversation, total: conversation.length };
}

/**
 * Get unread count for a profile
 */
function getUnreadCount(profileId) {
  const inbox = loadInbox(profileId);
  return inbox.messages.filter(m => m.status === MESSAGE_STATUS.UNREAD).length;
}

/**
 * Mark all messages as read
 */
function markAllRead(profileId) {
  const inbox = loadInbox(profileId);
  let count = 0;
  
  inbox.messages.forEach(m => {
    if (m.status === MESSAGE_STATUS.UNREAD) {
      m.status = MESSAGE_STATUS.READ;
      m.readAt = new Date().toISOString();
      count++;
    }
  });
  
  saveInbox(profileId, inbox);
  return { success: true, markedRead: count };
}

/**
 * Get message stats for a profile
 */
function getMessageStats(profileId) {
  const inbox = loadInbox(profileId);
  const sentPath = path.join(MESSAGES_DIR, `${profileId}_sent.json`);
  let sentData = { messages: [] };
  try {
    if (fs.existsSync(sentPath)) {
      sentData = JSON.parse(fs.readFileSync(sentPath, 'utf8'));
    }
  } catch (e) {}
  
  return {
    totalReceived: inbox.messages.length,
    unread: inbox.messages.filter(m => m.status === MESSAGE_STATUS.UNREAD).length,
    read: inbox.messages.filter(m => m.status === MESSAGE_STATUS.READ).length,
    archived: inbox.messages.filter(m => m.status === MESSAGE_STATUS.ARCHIVED).length,
    totalSent: sentData.messages.length
  };
}

module.exports = {
  MESSAGE_STATUS,
  sendMessage,
  getInbox,
  getSent,
  getMessage,
  markAsRead,
  archiveMessage,
  deleteMessage,
  getConversation,
  getUnreadCount,
  markAllRead,
  getMessageStats
};
