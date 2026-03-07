/**
 * Agent Collaboration History
 * Track when agents work together on projects
 */

const fs = require('fs');
const path = require('path');

const STATUS = {
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  DECLINED: 'declined'
};

/**
 * Create/Add a collaboration between agents
 */
function createCollaboration(data, dataDir) {
  const { initiatorId, collaboratorId, projectName, projectUrl, description, role } = data;
  
  if (!initiatorId || !collaboratorId || !projectName) {
    return { error: 'initiatorId, collaboratorId, and projectName required' };
  }
  
  if (initiatorId === collaboratorId) {
    return { error: 'Cannot collaborate with yourself' };
  }
  
  const initiatorPath = path.join(dataDir, `${initiatorId}.json`);
  const collaboratorPath = path.join(dataDir, `${collaboratorId}.json`);
  
  if (!fs.existsSync(initiatorPath)) {
    return { error: 'Initiator profile not found' };
  }
  if (!fs.existsSync(collaboratorPath)) {
    return { error: 'Collaborator profile not found' };
  }
  
  const initiator = JSON.parse(fs.readFileSync(initiatorPath, 'utf8'));
  const collaborator = JSON.parse(fs.readFileSync(collaboratorPath, 'utf8'));
  
  const collab = {
    id: `collab_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    projectName,
    projectUrl: projectUrl || null,
    description: description || null,
    participants: [
      { id: initiatorId, name: initiator.name, role: role || 'Contributor' },
      { id: collaboratorId, name: collaborator.name, role: 'Contributor' }
    ],
    status: STATUS.PENDING,
    initiatedBy: initiatorId,
    createdAt: new Date().toISOString()
  };
  
  // Add to initiator's collaborations
  if (!initiator.collaborations) initiator.collaborations = [];
  initiator.collaborations.push(collab);
  initiator.updatedAt = new Date().toISOString();
  fs.writeFileSync(initiatorPath, JSON.stringify(initiator, null, 2));
  
  // Add pending to collaborator
  if (!collaborator.pendingCollaborations) collaborator.pendingCollaborations = [];
  collaborator.pendingCollaborations.push({
    ...collab,
    fromId: initiatorId,
    fromName: initiator.name
  });
  collaborator.updatedAt = new Date().toISOString();
  fs.writeFileSync(collaboratorPath, JSON.stringify(collaborator, null, 2));
  
  return { success: true, collaboration: collab };
}

/**
 * Confirm a collaboration (by the collaborator)
 */
function confirmCollaboration(collaboratorId, collabId, dataDir) {
  const collaboratorPath = path.join(dataDir, `${collaboratorId}.json`);
  
  if (!fs.existsSync(collaboratorPath)) {
    return { error: 'Profile not found' };
  }
  
  const collaborator = JSON.parse(fs.readFileSync(collaboratorPath, 'utf8'));
  
  const pendingIdx = (collaborator.pendingCollaborations || []).findIndex(c => c.id === collabId);
  if (pendingIdx === -1) {
    return { error: 'Pending collaboration not found' };
  }
  
  const pending = collaborator.pendingCollaborations[pendingIdx];
  
  // Move to confirmed collaborations
  if (!collaborator.collaborations) collaborator.collaborations = [];
  const confirmed = { ...pending, status: STATUS.CONFIRMED, confirmedAt: new Date().toISOString() };
  delete confirmed.fromId;
  delete confirmed.fromName;
  collaborator.collaborations.push(confirmed);
  collaborator.pendingCollaborations.splice(pendingIdx, 1);
  collaborator.updatedAt = new Date().toISOString();
  fs.writeFileSync(collaboratorPath, JSON.stringify(collaborator, null, 2));
  
  // Update initiator's collaboration status
  const initiatorPath = path.join(dataDir, `${pending.initiatedBy}.json`);
  if (fs.existsSync(initiatorPath)) {
    const initiator = JSON.parse(fs.readFileSync(initiatorPath, 'utf8'));
    const collabIdx = (initiator.collaborations || []).findIndex(c => c.id === collabId);
    if (collabIdx !== -1) {
      initiator.collaborations[collabIdx].status = STATUS.CONFIRMED;
      initiator.collaborations[collabIdx].confirmedAt = new Date().toISOString();
      initiator.updatedAt = new Date().toISOString();
      fs.writeFileSync(initiatorPath, JSON.stringify(initiator, null, 2));
    }
  }
  
  return { success: true, collaboration: confirmed };
}

/**
 * Decline a collaboration
 */
function declineCollaboration(collaboratorId, collabId, dataDir) {
  const collaboratorPath = path.join(dataDir, `${collaboratorId}.json`);
  
  if (!fs.existsSync(collaboratorPath)) {
    return { error: 'Profile not found' };
  }
  
  const collaborator = JSON.parse(fs.readFileSync(collaboratorPath, 'utf8'));
  
  const pendingIdx = (collaborator.pendingCollaborations || []).findIndex(c => c.id === collabId);
  if (pendingIdx === -1) {
    return { error: 'Pending collaboration not found' };
  }
  
  const pending = collaborator.pendingCollaborations[pendingIdx];
  collaborator.pendingCollaborations.splice(pendingIdx, 1);
  collaborator.updatedAt = new Date().toISOString();
  fs.writeFileSync(collaboratorPath, JSON.stringify(collaborator, null, 2));
  
  // Update initiator's collaboration status
  const initiatorPath = path.join(dataDir, `${pending.initiatedBy}.json`);
  if (fs.existsSync(initiatorPath)) {
    const initiator = JSON.parse(fs.readFileSync(initiatorPath, 'utf8'));
    const collabIdx = (initiator.collaborations || []).findIndex(c => c.id === collabId);
    if (collabIdx !== -1) {
      initiator.collaborations[collabIdx].status = STATUS.DECLINED;
      initiator.collaborations[collabIdx].declinedAt = new Date().toISOString();
      initiator.updatedAt = new Date().toISOString();
      fs.writeFileSync(initiatorPath, JSON.stringify(initiator, null, 2));
    }
  }
  
  return { success: true };
}

/**
 * Get collaborations for a profile (alias: getAgentCollaborations)
 */
function getAgentCollaborations(profileId, options = {}, dataDir) {
  // Handle case where dataDir is second param (legacy)
  if (typeof options === 'string') {
    dataDir = options;
    options = {};
  }
  
  const { confirmedOnly = false, limit = 100 } = options;
  const profilePath = path.join(dataDir || '', `${profileId}.json`);
  
  if (!fs.existsSync(profilePath)) {
    return [];
  }
  
  const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
  let collabs = profile.collaborations || [];
  
  if (confirmedOnly) {
    collabs = collabs.filter(c => c.status === STATUS.CONFIRMED);
  }
  
  return collabs.slice(0, limit);
}

/**
 * Get pending collaboration requests for a profile
 */
function getPendingRequests(profileId, dataDir) {
  const profilePath = path.join(dataDir, `${profileId}.json`);
  
  if (!fs.existsSync(profilePath)) {
    return [];
  }
  
  const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
  return profile.pendingCollaborations || [];
}

/**
 * Get a single collaboration by ID
 */
function getCollaboration(collabId, dataDir) {
  const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.json'));
  
  for (const file of files) {
    const profile = JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf8'));
    const collab = (profile.collaborations || []).find(c => c.id === collabId);
    if (collab) {
      return collab;
    }
  }
  
  return null;
}

/**
 * Get collaborations between two specific agents
 */
function getCollaborationsBetween(id1, id2, dataDir) {
  const collabs1 = getAgentCollaborations(id1, {}, dataDir);
  
  return collabs1.filter(c => 
    c.participants.some(p => p.id === id2)
  );
}

/**
 * Get collaboration statistics
 */
function getCollaborationStats(dataDir) {
  const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.json'));
  
  let total = 0;
  let confirmed = 0;
  let pending = 0;
  const uniquePairs = new Set();
  
  for (const file of files) {
    const profile = JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf8'));
    const collabs = profile.collaborations || [];
    
    for (const c of collabs) {
      total++;
      if (c.status === STATUS.CONFIRMED) confirmed++;
      if (c.status === STATUS.PENDING) pending++;
      
      const ids = c.participants.map(p => p.id).sort();
      uniquePairs.add(ids.join('|'));
    }
  }
  
  return {
    total,
    confirmed,
    pending,
    uniqueCollaborations: uniquePairs.size
  };
}

/**
 * Get unique collaborators for a profile
 */
function getUniqueCollaborators(profileId, dataDir) {
  const collabs = getAgentCollaborations(profileId, { confirmedOnly: true }, dataDir);
  const collaborators = new Map();
  
  for (const c of collabs) {
    for (const p of c.participants) {
      if (p.id !== profileId && !collaborators.has(p.id)) {
        collaborators.set(p.id, { id: p.id, name: p.name, count: 1 });
      } else if (p.id !== profileId) {
        collaborators.get(p.id).count++;
      }
    }
  }
  
  return Array.from(collaborators.values());
}

/**
 * Get shared collaborations between two agents (legacy alias)
 */
function getSharedCollaborations(id1, id2, dataDir) {
  return { shared: getCollaborationsBetween(id1, id2, dataDir) };
}

module.exports = {
  STATUS,
  createCollaboration,
  confirmCollaboration,
  declineCollaboration,
  getAgentCollaborations,
  getPendingRequests,
  getCollaboration,
  getCollaborationsBetween,
  getCollaborationStats,
  getUniqueCollaborators,
  // Legacy aliases
  addCollaboration: createCollaboration,
  getCollaborations: getAgentCollaborations,
  getSharedCollaborations
};
