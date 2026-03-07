/**
 * Agent Availability Status Module
 * Manages availability status for agents (Available, Busy, Away, Not Taking Work)
 * Auto-sets Away after 7 days of inactivity
 */

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '../../data/agentfolio.db');

// Availability status options
const AVAILABILITY_STATUS = {
  AVAILABLE: 'available',
  BUSY: 'busy',
  AWAY: 'away',
  NOT_TAKING_WORK: 'not_taking_work'
};

// Status display info
const STATUS_INFO = {
  [AVAILABILITY_STATUS.AVAILABLE]: {
    label: 'Available',
    emoji: '🟢',
    color: '#22c55e',
    bgColor: 'rgba(34, 197, 94, 0.15)',
    borderColor: 'rgba(34, 197, 94, 0.3)',
    description: 'Open for new projects and collaborations'
  },
  [AVAILABILITY_STATUS.BUSY]: {
    label: 'Busy',
    emoji: '🟡',
    color: '#eab308',
    bgColor: 'rgba(234, 179, 8, 0.15)',
    borderColor: 'rgba(234, 179, 8, 0.3)',
    description: 'Currently working on projects, limited availability'
  },
  [AVAILABILITY_STATUS.AWAY]: {
    label: 'Away',
    emoji: '🔴',
    color: '#ef4444',
    bgColor: 'rgba(239, 68, 68, 0.15)',
    borderColor: 'rgba(239, 68, 68, 0.3)',
    description: 'Temporarily unavailable'
  },
  [AVAILABILITY_STATUS.NOT_TAKING_WORK]: {
    label: 'Not Taking Work',
    emoji: '⚫',
    color: '#71717a',
    bgColor: 'rgba(113, 113, 122, 0.15)',
    borderColor: 'rgba(113, 113, 122, 0.3)',
    description: 'Not accepting new projects at this time'
  }
};

// Auto-away threshold in days
const AUTO_AWAY_DAYS = 7;

/**
 * Get database connection
 */
function getDb() {
  return new Database(DB_PATH);
}

/**
 * Initialize availability schema (add columns if missing)
 */
function initializeSchema() {
  const db = getDb();
  
  try {
    // Check if availability column exists
    const tableInfo = db.prepare("PRAGMA table_info(profiles)").all();
    const hasAvailability = tableInfo.some(col => col.name === 'availability');
    const hasLastActive = tableInfo.some(col => col.name === 'last_active_at');
    
    if (!hasAvailability) {
      db.exec(`ALTER TABLE profiles ADD COLUMN availability TEXT DEFAULT 'available'`);
      console.log('[Availability] Added availability column to profiles');
    }
    
    if (!hasLastActive) {
      db.exec(`ALTER TABLE profiles ADD COLUMN last_active_at TEXT`);
      // Initialize last_active_at with created_at for existing profiles
      db.exec(`UPDATE profiles SET last_active_at = updated_at WHERE last_active_at IS NULL`);
      console.log('[Availability] Added last_active_at column to profiles');
    }
    
    db.close();
    return true;
  } catch (err) {
    console.error('[Availability] Schema init error:', err.message);
    db.close();
    return false;
  }
}

/**
 * Get agent's current availability status
 */
function getAvailability(profileId) {
  const db = getDb();
  
  try {
    const row = db.prepare(`
      SELECT availability, last_active_at, updated_at
      FROM profiles 
      WHERE id = ?
    `).get(profileId);
    
    db.close();
    
    if (!row) {
      return null;
    }
    
    const status = row.availability || AVAILABILITY_STATUS.AVAILABLE;
    const statusInfo = STATUS_INFO[status] || STATUS_INFO[AVAILABILITY_STATUS.AVAILABLE];
    
    return {
      status,
      ...statusInfo,
      lastActiveAt: row.last_active_at || row.updated_at,
      isAutoAway: false // Will be set by checkAutoAway
    };
  } catch (err) {
    console.error('[Availability] Get error:', err.message);
    db.close();
    return null;
  }
}

/**
 * Update agent's availability status
 */
function setAvailability(profileId, status) {
  if (!Object.values(AVAILABILITY_STATUS).includes(status)) {
    return { error: 'Invalid availability status' };
  }
  
  const db = getDb();
  
  try {
    const now = new Date().toISOString();
    
    const result = db.prepare(`
      UPDATE profiles 
      SET availability = ?, last_active_at = ?, updated_at = ?
      WHERE id = ?
    `).run(status, now, now, profileId);
    
    db.close();
    
    if (result.changes === 0) {
      return { error: 'Profile not found' };
    }
    
    return {
      success: true,
      status,
      ...STATUS_INFO[status],
      updatedAt: now
    };
  } catch (err) {
    console.error('[Availability] Set error:', err.message);
    db.close();
    return { error: err.message };
  }
}

/**
 * Update last active timestamp (call on profile activity)
 */
function updateLastActive(profileId) {
  const db = getDb();
  
  try {
    const now = new Date().toISOString();
    
    db.prepare(`
      UPDATE profiles 
      SET last_active_at = ?
      WHERE id = ?
    `).run(now, profileId);
    
    db.close();
    return true;
  } catch (err) {
    console.error('[Availability] Update last active error:', err.message);
    db.close();
    return false;
  }
}

/**
 * Check if agent should be auto-set to Away
 */
function checkAutoAway(profileId) {
  const db = getDb();
  
  try {
    const row = db.prepare(`
      SELECT availability, last_active_at, updated_at
      FROM profiles 
      WHERE id = ?
    `).get(profileId);
    
    if (!row) {
      db.close();
      return null;
    }
    
    const lastActive = new Date(row.last_active_at || row.updated_at);
    const now = new Date();
    const daysSinceActive = (now - lastActive) / (1000 * 60 * 60 * 24);
    
    // Only auto-away if currently Available or Busy
    const currentStatus = row.availability || AVAILABILITY_STATUS.AVAILABLE;
    const shouldAutoAway = daysSinceActive >= AUTO_AWAY_DAYS && 
      (currentStatus === AVAILABILITY_STATUS.AVAILABLE || currentStatus === AVAILABILITY_STATUS.BUSY);
    
    if (shouldAutoAway) {
      // Auto-set to Away
      db.prepare(`
        UPDATE profiles 
        SET availability = ?
        WHERE id = ?
      `).run(AVAILABILITY_STATUS.AWAY, profileId);
      
      db.close();
      
      return {
        autoAwayTriggered: true,
        previousStatus: currentStatus,
        daysSinceActive: Math.floor(daysSinceActive)
      };
    }
    
    db.close();
    return { autoAwayTriggered: false, daysSinceActive: Math.floor(daysSinceActive) };
  } catch (err) {
    console.error('[Availability] Check auto-away error:', err.message);
    db.close();
    return null;
  }
}

/**
 * Run auto-away check on all profiles
 */
function runAutoAwayCheck() {
  const db = getDb();
  
  try {
    const threshold = new Date();
    threshold.setDate(threshold.getDate() - AUTO_AWAY_DAYS);
    const thresholdStr = threshold.toISOString();
    
    // Find profiles to auto-away
    const result = db.prepare(`
      UPDATE profiles 
      SET availability = ?
      WHERE (availability = ? OR availability = ? OR availability IS NULL)
        AND (last_active_at < ? OR (last_active_at IS NULL AND updated_at < ?))
    `).run(
      AVAILABILITY_STATUS.AWAY,
      AVAILABILITY_STATUS.AVAILABLE,
      AVAILABILITY_STATUS.BUSY,
      thresholdStr,
      thresholdStr
    );
    
    db.close();
    
    console.log(`[Availability] Auto-away check: ${result.changes} profiles set to Away`);
    return { profilesUpdated: result.changes };
  } catch (err) {
    console.error('[Availability] Auto-away check error:', err.message);
    db.close();
    return { error: err.message };
  }
}

/**
 * Get profiles filtered by availability
 */
function getProfilesByAvailability(status = null, options = {}) {
  const db = getDb();
  const { limit = 50, offset = 0, includeAway = false } = options;
  
  try {
    let query = `
      SELECT id, name, handle, bio, avatar, skills, availability, last_active_at
      FROM profiles 
      WHERE 1=1
    `;
    const params = [];
    
    if (status) {
      query += ` AND availability = ?`;
      params.push(status);
    } else if (!includeAway) {
      // Default: exclude Away and Not Taking Work
      query += ` AND (availability = ? OR availability = ? OR availability IS NULL)`;
      params.push(AVAILABILITY_STATUS.AVAILABLE, AVAILABILITY_STATUS.BUSY);
    }
    
    query += ` ORDER BY 
      CASE availability 
        WHEN 'available' THEN 1 
        WHEN 'busy' THEN 2 
        WHEN 'away' THEN 3 
        WHEN 'not_taking_work' THEN 4 
        ELSE 5 
      END,
      last_active_at DESC
      LIMIT ? OFFSET ?`;
    params.push(limit, offset);
    
    const rows = db.prepare(query).all(...params);
    db.close();
    
    return rows.map(row => ({
      id: row.id,
      name: row.name,
      handle: row.handle,
      bio: row.bio,
      avatar: row.avatar,
      skills: JSON.parse(row.skills || '[]'),
      availability: row.availability || AVAILABILITY_STATUS.AVAILABLE,
      availabilityInfo: STATUS_INFO[row.availability || AVAILABILITY_STATUS.AVAILABLE],
      lastActiveAt: row.last_active_at
    }));
  } catch (err) {
    console.error('[Availability] Get profiles error:', err.message);
    db.close();
    return [];
  }
}

/**
 * Get availability stats across all profiles
 */
function getAvailabilityStats() {
  const db = getDb();
  
  try {
    const stats = db.prepare(`
      SELECT 
        COALESCE(availability, 'available') as status,
        COUNT(*) as count
      FROM profiles
      GROUP BY COALESCE(availability, 'available')
    `).all();
    
    db.close();
    
    const result = {
      total: 0,
      byStatus: {}
    };
    
    for (const stat of stats) {
      result.byStatus[stat.status] = {
        count: stat.count,
        ...STATUS_INFO[stat.status]
      };
      result.total += stat.count;
    }
    
    return result;
  } catch (err) {
    console.error('[Availability] Stats error:', err.message);
    db.close();
    return { total: 0, byStatus: {} };
  }
}

/**
 * Render availability badge HTML
 */
function renderAvailabilityBadge(status, options = {}) {
  const { size = 'medium', showLabel = true, inline = false } = options;
  const info = STATUS_INFO[status] || STATUS_INFO[AVAILABILITY_STATUS.AVAILABLE];
  
  const sizes = {
    small: { fontSize: '11px', padding: '2px 8px', gap: '4px' },
    medium: { fontSize: '13px', padding: '4px 12px', gap: '6px' },
    large: { fontSize: '14px', padding: '6px 16px', gap: '8px' }
  };
  
  const s = sizes[size] || sizes.medium;
  
  const baseStyle = `
    display: ${inline ? 'inline-flex' : 'flex'};
    align-items: center;
    gap: ${s.gap};
    padding: ${s.padding};
    background: ${info.bgColor};
    border: 1px solid ${info.borderColor};
    border-radius: 20px;
    font-size: ${s.fontSize};
    font-weight: 500;
  `.replace(/\s+/g, ' ').trim();
  
  return `
    <div class="availability-badge" style="${baseStyle}" title="${info.description}">
      <span style="font-size: ${parseInt(s.fontSize) + 2}px;">${info.emoji}</span>
      ${showLabel ? `<span style="color: ${info.color};">${info.label}</span>` : ''}
    </div>
  `.trim();
}

/**
 * Render availability selector HTML for edit page
 */
function renderAvailabilitySelector(currentStatus = AVAILABILITY_STATUS.AVAILABLE) {
  const statuses = Object.values(AVAILABILITY_STATUS);
  
  return `
    <div class="availability-selector">
      <label class="form-label">Availability Status</label>
      <p style="color:#71717a;font-size:13px;margin-bottom:12px;">
        Let others know if you're available for new projects.
      </p>
      <div style="display:grid;grid-template-columns:repeat(2, 1fr);gap:12px;">
        ${statuses.map(status => {
          const info = STATUS_INFO[status];
          const isSelected = status === currentStatus;
          return `
            <label class="availability-option" style="
              display:flex;
              align-items:center;
              gap:12px;
              padding:16px;
              background:${isSelected ? info.bgColor : '#18181b'};
              border:2px solid ${isSelected ? info.color : '#27272a'};
              border-radius:12px;
              cursor:pointer;
              transition:all 0.2s;
            " onmouseover="this.style.borderColor='${info.borderColor}'" onmouseout="this.style.borderColor='${isSelected ? info.color : '#27272a'}'">
              <input type="radio" name="availability" value="${status}" ${isSelected ? 'checked' : ''} style="display:none;">
              <span style="font-size:24px;">${info.emoji}</span>
              <div>
                <div style="font-weight:600;color:${isSelected ? info.color : '#e4e4e7'};margin-bottom:2px;">
                  ${info.label}
                </div>
                <div style="font-size:12px;color:#71717a;">
                  ${info.description}
                </div>
              </div>
            </label>
          `;
        }).join('')}
      </div>
      <p style="color:#71717a;font-size:12px;margin-top:12px;">
        💡 Your status will automatically change to "Away" after 7 days of inactivity.
      </p>
    </div>
  `;
}

/**
 * Get CSS styles for availability components
 */
function getAvailabilityStyles() {
  return `
    .availability-option:hover {
      transform: translateY(-2px);
    }
    .availability-option input:checked + span + div > div:first-child {
      font-weight: 700;
    }
    .availability-badge {
      white-space: nowrap;
    }
    .availability-filter {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .availability-filter-btn {
      padding: 6px 14px;
      background: #18181b;
      border: 1px solid #27272a;
      border-radius: 20px;
      color: #a1a1aa;
      font-size: 13px;
      cursor: pointer;
      transition: all 0.2s;
    }
    .availability-filter-btn:hover {
      border-color: #3f3f46;
      color: #e4e4e7;
    }
    .availability-filter-btn.active {
      background: linear-gradient(135deg, rgba(167,139,250,0.2), rgba(236,72,153,0.2));
      border-color: #a78bfa;
      color: #fff;
    }
  `;
}

// Initialize schema on module load
initializeSchema();

module.exports = {
  AVAILABILITY_STATUS,
  STATUS_INFO,
  AUTO_AWAY_DAYS,
  getAvailability,
  setAvailability,
  updateLastActive,
  checkAutoAway,
  runAutoAwayCheck,
  getProfilesByAvailability,
  getAvailabilityStats,
  renderAvailabilityBadge,
  renderAvailabilitySelector,
  getAvailabilityStyles,
  initializeSchema
};
