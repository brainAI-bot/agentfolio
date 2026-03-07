/**
 * Verification Request System
 * Allows agents to request verification for their unverified skills
 */

const fs = require('fs');
const path = require('path');

const REQUESTS_FILE = path.join(__dirname, '../../data/verification-requests.json');

// Request statuses
const STATUS = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  EXPIRED: 'expired'
};

// Proof types that can be submitted
const PROOF_TYPES = {
  GITHUB_REPO: 'github_repo',
  GITHUB_COMMIT: 'github_commit',
  TWEET: 'tweet',
  WEBSITE: 'website',
  ARTIFACT: 'artifact',
  TRANSACTION: 'transaction',
  API_ENDPOINT: 'api_endpoint',
  SCREENSHOT: 'screenshot',
  TESTIMONIAL: 'testimonial',
  OTHER: 'other'
};

function loadRequests() {
  try {
    if (fs.existsSync(REQUESTS_FILE)) {
      return JSON.parse(fs.readFileSync(REQUESTS_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('[VerificationRequests] Error loading:', e.message);
  }
  return { requests: [], nextId: 1 };
}

function saveRequests(data) {
  const dir = path.dirname(REQUESTS_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(REQUESTS_FILE, JSON.stringify(data, null, 2));
}

/**
 * Create a verification request
 */
function createRequest(agentId, skillName, proofs, notes) {
  const data = loadRequests();
  
  // Check for existing pending request
  const existing = data.requests.find(r => 
    r.agentId === agentId && 
    r.skillName === skillName && 
    r.status === STATUS.PENDING
  );
  
  if (existing) {
    return { error: 'Pending request already exists for this skill', existingId: existing.id };
  }
  
  const request = {
    id: data.nextId++,
    agentId,
    skillName,
    proofs: proofs || [],
    notes: notes || '',
    status: STATUS.PENDING,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    reviewedAt: null,
    reviewedBy: null,
    reviewNotes: null
  };
  
  data.requests.push(request);
  saveRequests(data);
  
  return { success: true, request };
}

/**
 * Get all requests with optional filters
 */
function getRequests(filters = {}) {
  const data = loadRequests();
  let requests = data.requests;
  
  if (filters.agentId) {
    requests = requests.filter(r => r.agentId === filters.agentId);
  }
  
  if (filters.status) {
    requests = requests.filter(r => r.status === filters.status);
  }
  
  if (filters.skillName) {
    requests = requests.filter(r => r.skillName.toLowerCase().includes(filters.skillName.toLowerCase()));
  }
  
  // Sort by createdAt desc (newest first)
  requests.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  
  if (filters.limit) {
    requests = requests.slice(0, filters.limit);
  }
  
  return requests;
}

/**
 * Get a single request by ID
 */
function getRequest(requestId) {
  const data = loadRequests();
  return data.requests.find(r => r.id === parseInt(requestId));
}

/**
 * Approve a verification request
 */
function approveRequest(requestId, reviewedBy, reviewNotes) {
  const data = loadRequests();
  const request = data.requests.find(r => r.id === parseInt(requestId));
  
  if (!request) {
    return { error: 'Request not found' };
  }
  
  if (request.status !== STATUS.PENDING) {
    return { error: `Request already ${request.status}` };
  }
  
  request.status = STATUS.APPROVED;
  request.reviewedAt = new Date().toISOString();
  request.reviewedBy = reviewedBy || 'system';
  request.reviewNotes = reviewNotes || '';
  request.updatedAt = new Date().toISOString();
  
  saveRequests(data);
  
  return { success: true, request };
}

/**
 * Reject a verification request
 */
function rejectRequest(requestId, reviewedBy, reviewNotes) {
  const data = loadRequests();
  const request = data.requests.find(r => r.id === parseInt(requestId));
  
  if (!request) {
    return { error: 'Request not found' };
  }
  
  if (request.status !== STATUS.PENDING) {
    return { error: `Request already ${request.status}` };
  }
  
  request.status = STATUS.REJECTED;
  request.reviewedAt = new Date().toISOString();
  request.reviewedBy = reviewedBy || 'system';
  request.reviewNotes = reviewNotes || 'Does not meet verification criteria';
  request.updatedAt = new Date().toISOString();
  
  saveRequests(data);
  
  return { success: true, request };
}

/**
 * Add proof to an existing request
 */
function addProofToRequest(requestId, proof) {
  const data = loadRequests();
  const request = data.requests.find(r => r.id === parseInt(requestId));
  
  if (!request) {
    return { error: 'Request not found' };
  }
  
  if (request.status !== STATUS.PENDING) {
    return { error: 'Cannot modify non-pending request' };
  }
  
  request.proofs.push({
    type: proof.type || PROOF_TYPES.OTHER,
    url: proof.url || null,
    description: proof.description || '',
    addedAt: new Date().toISOString()
  });
  request.updatedAt = new Date().toISOString();
  
  saveRequests(data);
  
  return { success: true, request };
}

/**
 * Cancel a request (by the agent who created it)
 */
function cancelRequest(requestId, agentId) {
  const data = loadRequests();
  const request = data.requests.find(r => r.id === parseInt(requestId));
  
  if (!request) {
    return { error: 'Request not found' };
  }
  
  if (request.agentId !== agentId) {
    return { error: 'Not authorized to cancel this request' };
  }
  
  if (request.status !== STATUS.PENDING) {
    return { error: 'Can only cancel pending requests' };
  }
  
  // Remove the request
  data.requests = data.requests.filter(r => r.id !== parseInt(requestId));
  saveRequests(data);
  
  return { success: true };
}

/**
 * Get stats about verification requests
 */
function getRequestStats() {
  const data = loadRequests();
  const requests = data.requests;
  
  return {
    total: requests.length,
    pending: requests.filter(r => r.status === STATUS.PENDING).length,
    approved: requests.filter(r => r.status === STATUS.APPROVED).length,
    rejected: requests.filter(r => r.status === STATUS.REJECTED).length,
    bySkill: requests.reduce((acc, r) => {
      acc[r.skillName] = (acc[r.skillName] || 0) + 1;
      return acc;
    }, {}),
    recentRequests: requests.slice(0, 5)
  };
}

module.exports = {
  STATUS,
  PROOF_TYPES,
  createRequest,
  getRequests,
  getRequest,
  approveRequest,
  rejectRequest,
  addProofToRequest,
  cancelRequest,
  getRequestStats
};
