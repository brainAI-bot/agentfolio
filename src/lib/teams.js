/**
 * AgentFolio Teams Module
 * Allows agents to form teams for collaborative work
 */

const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');

const DB_PATH = path.join(__dirname, '../../data/agentfolio.db');
const db = new Database(DB_PATH);

// Team member roles
const ROLES = {
  owner: 'owner',      // Full control, can delete team
  admin: 'admin',      // Can manage members
  member: 'member'     // Regular member
};

const ROLE_LEVELS = {
  [ROLES.owner]: 3,
  [ROLES.admin]: 2,
  [ROLES.member]: 1
};

// Invitation status
const INVITE_STATUS = {
  pending: 'pending',
  accepted: 'accepted',
  declined: 'declined',
  expired: 'expired'
};

// Initialize teams schema
function initializeTeamsSchema() {
  // Teams table
  db.exec(`
    CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      handle TEXT UNIQUE NOT NULL,
      description TEXT DEFAULT '',
      avatar TEXT,
      owner_id TEXT NOT NULL,
      skills TEXT DEFAULT '[]',
      links TEXT DEFAULT '{}',
      portfolio TEXT DEFAULT '[]',
      is_public INTEGER DEFAULT 1,
      accepting_members INTEGER DEFAULT 1,
      max_members INTEGER DEFAULT 10,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_teams_owner ON teams(owner_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_teams_handle ON teams(handle)`);

  // Team members table
  db.exec(`
    CREATE TABLE IF NOT EXISTS team_members (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL,
      profile_id TEXT NOT NULL,
      role TEXT DEFAULT 'member',
      joined_at TEXT NOT NULL,
      FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
      UNIQUE(team_id, profile_id)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_team_members_team ON team_members(team_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_team_members_profile ON team_members(profile_id)`);

  // Team invitations table
  db.exec(`
    CREATE TABLE IF NOT EXISTS team_invites (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL,
      profile_id TEXT NOT NULL,
      invited_by TEXT NOT NULL,
      role TEXT DEFAULT 'member',
      message TEXT DEFAULT '',
      status TEXT DEFAULT 'pending',
      expires_at TEXT,
      created_at TEXT NOT NULL,
      responded_at TEXT,
      FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
      UNIQUE(team_id, profile_id, status)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_team_invites_profile ON team_invites(profile_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_team_invites_team ON team_invites(team_id)`);

  // Team activity table
  db.exec(`
    CREATE TABLE IF NOT EXISTS team_activity (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL,
      profile_id TEXT,
      type TEXT NOT NULL,
      data TEXT DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_team_activity_team ON team_activity(team_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_team_activity_created ON team_activity(created_at DESC)`);

  console.log('[Teams] Schema initialized');
}

// Generate unique ID
function generateId(prefix = 'team') {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

// Create a new team
function createTeam(ownerId, data) {
  const { name, description = '', avatar = null, skills = [], links = {}, isPublic = true, maxMembers = 10 } = data;
  
  if (!name || name.length < 2) {
    return { error: 'Team name must be at least 2 characters' };
  }
  
  // Generate handle from name
  const handle = name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 30);
  
  // Check if handle exists
  const existing = db.prepare('SELECT id FROM teams WHERE handle = ?').get(handle);
  if (existing) {
    return { error: 'A team with this name already exists' };
  }
  
  const teamId = generateId('team');
  const now = new Date().toISOString();
  
  try {
    // Create team
    db.prepare(`
      INSERT INTO teams (id, name, handle, description, avatar, owner_id, skills, links, is_public, accepting_members, max_members, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
    `).run(
      teamId,
      name,
      handle,
      description,
      avatar,
      ownerId,
      JSON.stringify(skills),
      JSON.stringify(links),
      isPublic ? 1 : 0,
      maxMembers,
      now,
      now
    );
    
    // Add owner as first member
    db.prepare(`
      INSERT INTO team_members (id, team_id, profile_id, role, joined_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(generateId('tm'), teamId, ownerId, ROLES.owner, now);
    
    // Log activity
    addTeamActivity(teamId, ownerId, 'team_created', { name });
    
    return { 
      success: true, 
      teamId, 
      handle,
      message: 'Team created successfully' 
    };
  } catch (err) {
    console.error('[Teams] Create error:', err);
    return { error: err.message };
  }
}

// Get team by ID or handle
function getTeam(idOrHandle) {
  const team = db.prepare(`
    SELECT * FROM teams WHERE id = ? OR handle = ?
  `).get(idOrHandle, idOrHandle);
  
  if (!team) return null;
  
  // Parse JSON fields
  team.skills = JSON.parse(team.skills || '[]');
  team.links = JSON.parse(team.links || '{}');
  team.portfolio = JSON.parse(team.portfolio || '[]');
  team.isPublic = !!team.is_public;
  team.acceptingMembers = !!team.accepting_members;
  team.maxMembers = team.max_members;
  
  return team;
}

// Get team with members and stats
function getTeamWithDetails(idOrHandle) {
  const team = getTeam(idOrHandle);
  if (!team) return null;
  
  // Get members with profiles
  const members = db.prepare(`
    SELECT tm.*, p.name as profile_name, p.avatar as profile_avatar, p.handle as profile_handle
    FROM team_members tm
    JOIN profiles p ON tm.profile_id = p.id
    WHERE tm.team_id = ?
    ORDER BY 
      CASE tm.role 
        WHEN 'owner' THEN 1 
        WHEN 'admin' THEN 2 
        ELSE 3 
      END,
      tm.joined_at ASC
  `).all(team.id);
  
  // Get combined stats
  const stats = calculateTeamStats(team.id);
  
  // Get recent activity
  const activity = getTeamActivity(team.id, 10);
  
  return {
    ...team,
    members,
    memberCount: members.length,
    stats,
    activity
  };
}

// Calculate combined team stats
function calculateTeamStats(teamId) {
  const members = db.prepare('SELECT profile_id FROM team_members WHERE team_id = ?').all(teamId);
  const profileIds = members.map(m => m.profile_id);
  
  if (profileIds.length === 0) {
    return { jobsCompleted: 0, avgRating: 0, totalEarnings: 0, verificationScore: 0 };
  }
  
  const placeholders = profileIds.map(() => '?').join(',');
  
  // Count completed jobs by any team member
  const jobsCompleted = db.prepare(`
    SELECT COUNT(*) as count FROM jobs 
    WHERE selected_agent_id IN (${placeholders}) AND status = 'completed'
  `).get(...profileIds)?.count || 0;
  
  // Average rating across all members
  const ratingResult = db.prepare(`
    SELECT AVG(rating) as avg, COUNT(*) as count FROM reviews 
    WHERE reviewee_id IN (${placeholders})
  `).get(...profileIds);
  
  // Total earnings
  const earnings = db.prepare(`
    SELECT SUM(agreed_budget) as total FROM jobs 
    WHERE selected_agent_id IN (${placeholders}) AND status = 'completed'
  `).get(...profileIds)?.total || 0;
  
  // Combined verification score
  const profiles = db.prepare(`
    SELECT verification FROM profiles WHERE id IN (${placeholders})
  `).all(...profileIds);
  
  let totalScore = 0;
  for (const p of profiles) {
    const verification = JSON.parse(p.verification || '{}');
    totalScore += verification.score || 0;
  }
  
  return {
    jobsCompleted,
    avgRating: ratingResult?.avg ? Math.round(ratingResult.avg * 10) / 10 : 0,
    reviewCount: ratingResult?.count || 0,
    totalEarnings: Math.round(earnings * 100) / 100,
    verificationScore: Math.round(totalScore / profileIds.length),
    memberCount: profileIds.length
  };
}

// Update team
function updateTeam(teamId, profileId, updates) {
  const team = getTeam(teamId);
  if (!team) return { error: 'Team not found' };
  
  // Check permission
  const member = db.prepare('SELECT role FROM team_members WHERE team_id = ? AND profile_id = ?').get(teamId, profileId);
  if (!member || (member.role !== ROLES.owner && member.role !== ROLES.admin)) {
    return { error: 'Insufficient permissions' };
  }
  
  const allowed = ['name', 'description', 'avatar', 'skills', 'links', 'isPublic', 'acceptingMembers', 'maxMembers'];
  const setClauses = [];
  const values = [];
  
  for (const key of allowed) {
    if (updates[key] !== undefined) {
      const dbKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
      if (key === 'skills' || key === 'links') {
        setClauses.push(`${dbKey} = ?`);
        values.push(JSON.stringify(updates[key]));
      } else if (key === 'isPublic' || key === 'acceptingMembers') {
        setClauses.push(`${dbKey} = ?`);
        values.push(updates[key] ? 1 : 0);
      } else {
        setClauses.push(`${dbKey} = ?`);
        values.push(updates[key]);
      }
    }
  }
  
  if (setClauses.length === 0) {
    return { error: 'No valid updates provided' };
  }
  
  setClauses.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(teamId);
  
  try {
    db.prepare(`UPDATE teams SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);
    addTeamActivity(teamId, profileId, 'team_updated', { fields: Object.keys(updates) });
    return { success: true, message: 'Team updated' };
  } catch (err) {
    return { error: err.message };
  }
}

// Delete team (owner only)
function deleteTeam(teamId, profileId) {
  const team = getTeam(teamId);
  if (!team) return { error: 'Team not found' };
  
  if (team.owner_id !== profileId) {
    return { error: 'Only the owner can delete the team' };
  }
  
  try {
    db.prepare('DELETE FROM teams WHERE id = ?').run(teamId);
    return { success: true, message: 'Team deleted' };
  } catch (err) {
    return { error: err.message };
  }
}

// Invite a profile to the team
function inviteToTeam(teamId, inviterId, profileId, role = ROLES.member, message = '') {
  const team = getTeam(teamId);
  if (!team) return { error: 'Team not found' };
  
  // Check inviter permission
  const inviter = db.prepare('SELECT role FROM team_members WHERE team_id = ? AND profile_id = ?').get(teamId, inviterId);
  if (!inviter || (inviter.role !== ROLES.owner && inviter.role !== ROLES.admin)) {
    return { error: 'Only owner or admin can invite members' };
  }
  
  // Can't invite higher role than yourself
  if (ROLE_LEVELS[role] > ROLE_LEVELS[inviter.role]) {
    return { error: 'Cannot invite with higher role than your own' };
  }
  
  // Check if already a member
  const existing = db.prepare('SELECT id FROM team_members WHERE team_id = ? AND profile_id = ?').get(teamId, profileId);
  if (existing) {
    return { error: 'Profile is already a team member' };
  }
  
  // Check for pending invite
  const pendingInvite = db.prepare(`
    SELECT id FROM team_invites 
    WHERE team_id = ? AND profile_id = ? AND status = 'pending'
  `).get(teamId, profileId);
  if (pendingInvite) {
    return { error: 'Invitation already pending' };
  }
  
  // Check team capacity
  const memberCount = db.prepare('SELECT COUNT(*) as count FROM team_members WHERE team_id = ?').get(teamId)?.count || 0;
  if (memberCount >= team.maxMembers) {
    return { error: 'Team is at maximum capacity' };
  }
  
  const inviteId = generateId('inv');
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days
  
  try {
    db.prepare(`
      INSERT INTO team_invites (id, team_id, profile_id, invited_by, role, message, status, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `).run(inviteId, teamId, profileId, inviterId, role, message, expiresAt, now);
    
    addTeamActivity(teamId, inviterId, 'member_invited', { inviteeId: profileId, role });
    
    return { success: true, inviteId, message: 'Invitation sent' };
  } catch (err) {
    return { error: err.message };
  }
}

// Respond to invitation
function respondToInvite(inviteId, profileId, accept) {
  const invite = db.prepare(`
    SELECT * FROM team_invites WHERE id = ? AND profile_id = ? AND status = 'pending'
  `).get(inviteId, profileId);
  
  if (!invite) {
    return { error: 'Invitation not found or already responded' };
  }
  
  // Check expiry
  if (new Date(invite.expires_at) < new Date()) {
    db.prepare(`UPDATE team_invites SET status = 'expired' WHERE id = ?`).run(inviteId);
    return { error: 'Invitation has expired' };
  }
  
  const now = new Date().toISOString();
  
  if (accept) {
    // Check team capacity again
    const team = getTeam(invite.team_id);
    const memberCount = db.prepare('SELECT COUNT(*) as count FROM team_members WHERE team_id = ?').get(invite.team_id)?.count || 0;
    if (memberCount >= team.maxMembers) {
      return { error: 'Team is now at maximum capacity' };
    }
    
    try {
      // Add to team
      db.prepare(`
        INSERT INTO team_members (id, team_id, profile_id, role, joined_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(generateId('tm'), invite.team_id, profileId, invite.role, now);
      
      // Update invite status
      db.prepare(`UPDATE team_invites SET status = 'accepted', responded_at = ? WHERE id = ?`).run(now, inviteId);
      
      addTeamActivity(invite.team_id, profileId, 'member_joined', { role: invite.role });
      
      return { success: true, teamId: invite.team_id, message: 'Joined team successfully' };
    } catch (err) {
      return { error: err.message };
    }
  } else {
    db.prepare(`UPDATE team_invites SET status = 'declined', responded_at = ? WHERE id = ?`).run(now, inviteId);
    return { success: true, message: 'Invitation declined' };
  }
}

// Leave team
function leaveTeam(teamId, profileId) {
  const team = getTeam(teamId);
  if (!team) return { error: 'Team not found' };
  
  const member = db.prepare('SELECT role FROM team_members WHERE team_id = ? AND profile_id = ?').get(teamId, profileId);
  if (!member) {
    return { error: 'Not a member of this team' };
  }
  
  if (member.role === ROLES.owner) {
    // Owner must transfer ownership first
    const otherMembers = db.prepare('SELECT profile_id FROM team_members WHERE team_id = ? AND profile_id != ?').all(teamId, profileId);
    if (otherMembers.length > 0) {
      return { error: 'Owner must transfer ownership before leaving. Use transferOwnership().' };
    }
    // If owner is only member, delete team
    db.prepare('DELETE FROM teams WHERE id = ?').run(teamId);
    return { success: true, message: 'Team deleted (you were the only member)' };
  }
  
  db.prepare('DELETE FROM team_members WHERE team_id = ? AND profile_id = ?').run(teamId, profileId);
  addTeamActivity(teamId, profileId, 'member_left', {});
  
  return { success: true, message: 'Left team successfully' };
}

// Remove member (admin/owner only)
function removeMember(teamId, actorId, targetId) {
  const team = getTeam(teamId);
  if (!team) return { error: 'Team not found' };
  
  const actor = db.prepare('SELECT role FROM team_members WHERE team_id = ? AND profile_id = ?').get(teamId, actorId);
  const target = db.prepare('SELECT role FROM team_members WHERE team_id = ? AND profile_id = ?').get(teamId, targetId);
  
  if (!actor || !target) {
    return { error: 'Member not found' };
  }
  
  // Can only remove lower roles
  if (ROLE_LEVELS[actor.role] <= ROLE_LEVELS[target.role]) {
    return { error: 'Cannot remove member with equal or higher role' };
  }
  
  db.prepare('DELETE FROM team_members WHERE team_id = ? AND profile_id = ?').run(teamId, targetId);
  addTeamActivity(teamId, actorId, 'member_removed', { removedId: targetId });
  
  return { success: true, message: 'Member removed' };
}

// Update member role
function updateMemberRole(teamId, actorId, targetId, newRole) {
  const team = getTeam(teamId);
  if (!team) return { error: 'Team not found' };
  
  if (!Object.values(ROLES).includes(newRole)) {
    return { error: 'Invalid role' };
  }
  
  const actor = db.prepare('SELECT role FROM team_members WHERE team_id = ? AND profile_id = ?').get(teamId, actorId);
  const target = db.prepare('SELECT role FROM team_members WHERE team_id = ? AND profile_id = ?').get(teamId, targetId);
  
  if (!actor || !target) {
    return { error: 'Member not found' };
  }
  
  // Only owner can change roles
  if (actor.role !== ROLES.owner) {
    return { error: 'Only owner can change member roles' };
  }
  
  // Can't demote owner
  if (target.role === ROLES.owner) {
    return { error: 'Cannot change owner role. Use transferOwnership().' };
  }
  
  db.prepare('UPDATE team_members SET role = ? WHERE team_id = ? AND profile_id = ?').run(newRole, teamId, targetId);
  addTeamActivity(teamId, actorId, 'role_changed', { targetId, newRole });
  
  return { success: true, message: 'Role updated' };
}

// Transfer ownership
function transferOwnership(teamId, currentOwnerId, newOwnerId) {
  const team = getTeam(teamId);
  if (!team) return { error: 'Team not found' };
  
  if (team.owner_id !== currentOwnerId) {
    return { error: 'Only current owner can transfer ownership' };
  }
  
  const newOwner = db.prepare('SELECT role FROM team_members WHERE team_id = ? AND profile_id = ?').get(teamId, newOwnerId);
  if (!newOwner) {
    return { error: 'New owner must be a team member' };
  }
  
  try {
    db.prepare('UPDATE teams SET owner_id = ?, updated_at = ? WHERE id = ?').run(newOwnerId, new Date().toISOString(), teamId);
    db.prepare('UPDATE team_members SET role = ? WHERE team_id = ? AND profile_id = ?').run(ROLES.owner, teamId, newOwnerId);
    db.prepare('UPDATE team_members SET role = ? WHERE team_id = ? AND profile_id = ?').run(ROLES.admin, teamId, currentOwnerId);
    
    addTeamActivity(teamId, currentOwnerId, 'ownership_transferred', { newOwnerId });
    
    return { success: true, message: 'Ownership transferred' };
  } catch (err) {
    return { error: err.message };
  }
}

// Get teams for a profile
function getProfileTeams(profileId) {
  const teams = db.prepare(`
    SELECT t.*, tm.role as member_role, tm.joined_at
    FROM team_members tm
    JOIN teams t ON tm.team_id = t.id
    WHERE tm.profile_id = ?
    ORDER BY tm.joined_at DESC
  `).all(profileId);
  
  return teams.map(t => ({
    ...t,
    skills: JSON.parse(t.skills || '[]'),
    links: JSON.parse(t.links || '{}'),
    isPublic: !!t.is_public,
    memberRole: t.member_role
  }));
}

// Get pending invites for a profile
function getPendingInvites(profileId) {
  return db.prepare(`
    SELECT i.*, t.name as team_name, t.avatar as team_avatar, p.name as inviter_name
    FROM team_invites i
    JOIN teams t ON i.team_id = t.id
    JOIN profiles p ON i.invited_by = p.id
    WHERE i.profile_id = ? AND i.status = 'pending' AND i.expires_at > datetime('now')
    ORDER BY i.created_at DESC
  `).all(profileId);
}

// List all public teams
function listTeams(options = {}) {
  const { limit = 20, offset = 0, search = '', sortBy = 'created_at' } = options;
  
  let query = `
    SELECT t.*, 
      (SELECT COUNT(*) FROM team_members WHERE team_id = t.id) as member_count
    FROM teams t
    WHERE t.is_public = 1
  `;
  const params = [];
  
  if (search) {
    query += ` AND (t.name LIKE ? OR t.description LIKE ?)`;
    params.push(`%${search}%`, `%${search}%`);
  }
  
  const validSorts = ['created_at', 'name', 'member_count'];
  const orderBy = validSorts.includes(sortBy) ? sortBy : 'created_at';
  query += ` ORDER BY ${orderBy} DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);
  
  const teams = db.prepare(query).all(...params);
  
  return teams.map(t => ({
    ...t,
    skills: JSON.parse(t.skills || '[]'),
    isPublic: true,
    memberCount: t.member_count
  }));
}

// Add team activity
function addTeamActivity(teamId, profileId, type, data) {
  const id = generateId('ta');
  const now = new Date().toISOString();
  
  db.prepare(`
    INSERT INTO team_activity (id, team_id, profile_id, type, data, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, teamId, profileId, type, JSON.stringify(data), now);
  
  return { id, teamId, profileId, type, data, createdAt: now };
}

// Get team activity
function getTeamActivity(teamId, limit = 20) {
  const activities = db.prepare(`
    SELECT a.*, p.name as profile_name, p.avatar as profile_avatar
    FROM team_activity a
    LEFT JOIN profiles p ON a.profile_id = p.id
    WHERE a.team_id = ?
    ORDER BY a.created_at DESC
    LIMIT ?
  `).all(teamId, limit);
  
  return activities.map(a => ({
    ...a,
    data: JSON.parse(a.data || '{}')
  }));
}

// Get team stats for admin/analytics
function getTeamsStats() {
  const totalTeams = db.prepare('SELECT COUNT(*) as count FROM teams').get()?.count || 0;
  const publicTeams = db.prepare('SELECT COUNT(*) as count FROM teams WHERE is_public = 1').get()?.count || 0;
  const totalMembers = db.prepare('SELECT COUNT(*) as count FROM team_members').get()?.count || 0;
  const avgMemberCount = db.prepare(`
    SELECT AVG(cnt) as avg FROM (SELECT COUNT(*) as cnt FROM team_members GROUP BY team_id)
  `).get()?.avg || 0;
  
  return {
    totalTeams,
    publicTeams,
    privateTeams: totalTeams - publicTeams,
    totalMemberships: totalMembers,
    avgMemberCount: Math.round(avgMemberCount * 10) / 10
  };
}

// Check if profile is team member
function isMember(teamId, profileId) {
  const member = db.prepare('SELECT id FROM team_members WHERE team_id = ? AND profile_id = ?').get(teamId, profileId);
  return !!member;
}

// Get member role
function getMemberRole(teamId, profileId) {
  const member = db.prepare('SELECT role FROM team_members WHERE team_id = ? AND profile_id = ?').get(teamId, profileId);
  return member?.role || null;
}

// Initialize schema on module load
initializeTeamsSchema();

module.exports = {
  ROLES,
  INVITE_STATUS,
  createTeam,
  getTeam,
  getTeamWithDetails,
  updateTeam,
  deleteTeam,
  inviteToTeam,
  respondToInvite,
  leaveTeam,
  removeMember,
  updateMemberRole,
  transferOwnership,
  getProfileTeams,
  getPendingInvites,
  listTeams,
  calculateTeamStats,
  addTeamActivity,
  getTeamActivity,
  getTeamsStats,
  isMember,
  getMemberRole
};
