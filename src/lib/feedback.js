/**
 * Feature Requests & Feedback System
 */

const fs = require('fs');
const path = require('path');

const FEEDBACK_FILE = path.join(__dirname, '../../data/feedback.json');

function loadFeedback() {
  try {
    if (fs.existsSync(FEEDBACK_FILE)) {
      return JSON.parse(fs.readFileSync(FEEDBACK_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('[Feedback] Error loading:', e.message);
  }
  return { requests: [], votes: {} };
}

function saveFeedback(data) {
  fs.writeFileSync(FEEDBACK_FILE, JSON.stringify(data, null, 2));
}

/**
 * Submit a feature request
 */
function submitRequest(request) {
  const data = loadFeedback();
  
  const newRequest = {
    id: `req_${Date.now()}_${Math.random().toString(36).substring(7)}`,
    title: request.title,
    description: request.description || '',
    category: request.category || 'feature',
    submittedBy: request.submittedBy || 'anonymous',
    submitterType: request.submitterType || 'agent',
    status: 'open',
    votes: 0,
    createdAt: new Date().toISOString(),
    comments: []
  };
  
  data.requests.unshift(newRequest);
  saveFeedback(data);
  
  return newRequest;
}

/**
 * Vote on a request
 */
function voteRequest(requestId, voterId, vote = 1) {
  const data = loadFeedback();
  
  const request = data.requests.find(r => r.id === requestId);
  if (!request) {
    return { success: false, error: 'Request not found' };
  }
  
  // Track votes per user
  const voteKey = `${requestId}:${voterId}`;
  const existingVote = data.votes[voteKey];
  
  if (existingVote) {
    return { success: false, error: 'Already voted' };
  }
  
  data.votes[voteKey] = vote;
  request.votes += vote;
  
  saveFeedback(data);
  
  return { success: true, votes: request.votes };
}

/**
 * Add comment to request
 */
function addComment(requestId, comment) {
  const data = loadFeedback();
  
  const request = data.requests.find(r => r.id === requestId);
  if (!request) {
    return { success: false, error: 'Request not found' };
  }
  
  const newComment = {
    id: `cmt_${Date.now()}`,
    text: comment.text,
    author: comment.author || 'anonymous',
    createdAt: new Date().toISOString()
  };
  
  request.comments.push(newComment);
  saveFeedback(data);
  
  return { success: true, comment: newComment };
}

/**
 * Update request status
 */
function updateStatus(requestId, status) {
  const data = loadFeedback();
  
  const request = data.requests.find(r => r.id === requestId);
  if (!request) {
    return { success: false, error: 'Request not found' };
  }
  
  request.status = status;
  request.updatedAt = new Date().toISOString();
  
  saveFeedback(data);
  
  return { success: true, request };
}

/**
 * Get all requests
 */
function getRequests(options = {}) {
  const data = loadFeedback();
  let requests = data.requests;
  
  if (options.status) {
    requests = requests.filter(r => r.status === options.status);
  }
  
  if (options.category) {
    requests = requests.filter(r => r.category === options.category);
  }
  
  // Sort by votes (highest first) then by date
  requests.sort((a, b) => {
    if (b.votes !== a.votes) return b.votes - a.votes;
    return new Date(b.createdAt) - new Date(a.createdAt);
  });
  
  if (options.limit) {
    requests = requests.slice(0, options.limit);
  }
  
  return requests;
}

/**
 * Get single request
 */
function getRequest(requestId) {
  const data = loadFeedback();
  return data.requests.find(r => r.id === requestId);
}

/**
 * Get stats
 */
function getStats() {
  const data = loadFeedback();
  const requests = data.requests;
  
  return {
    total: requests.length,
    open: requests.filter(r => r.status === 'open').length,
    inProgress: requests.filter(r => r.status === 'in-progress').length,
    completed: requests.filter(r => r.status === 'completed').length,
    totalVotes: requests.reduce((sum, r) => sum + r.votes, 0)
  };
}

module.exports = {
  submitRequest,
  voteRequest,
  addComment,
  updateStatus,
  getRequests,
  getRequest,
  getStats
};
