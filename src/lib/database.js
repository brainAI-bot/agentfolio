/**
 * AgentFolio SQLite Database Module
 * Replaces JSON file storage with SQLite for scale
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '../../data/agentfolio.db');

// Ensure data directory exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Initialize database connection
const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ===== SCHEMA INITIALIZATION =====

function initializeSchema() {
  // Profiles table
  db.exec(`
    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      handle TEXT NOT NULL,
      bio TEXT DEFAULT '',
      avatar TEXT,
      links TEXT DEFAULT '{}',  -- JSON
      wallets TEXT DEFAULT '{}',  -- JSON
      skills TEXT DEFAULT '[]',  -- JSON array
      portfolio TEXT DEFAULT '[]',  -- JSON array
      track_record TEXT,  -- JSON
      verification TEXT DEFAULT '{}',  -- JSON
      verification_data TEXT DEFAULT '{}',  -- JSON
      moltbook_stats TEXT,  -- JSON
      endorsements TEXT DEFAULT '[]',  -- JSON array
      endorsements_given TEXT DEFAULT '[]',  -- JSON array
      metadata TEXT DEFAULT '{}',  -- JSON overflow for arbitrary extra fields
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  
  // Add metadata column if missing (migration for existing DBs)
  try {
    db.exec(`ALTER TABLE profiles ADD COLUMN metadata TEXT DEFAULT '{}'`);
  } catch (e) {
    // Column already exists - ignore
  }

  // Activity table (separate for efficient querying)
  db.exec(`
    CREATE TABLE IF NOT EXISTS activity (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL,
      type TEXT NOT NULL,
      data TEXT DEFAULT '{}',  -- JSON
      created_at TEXT NOT NULL,
      FOREIGN KEY (profile_id) REFERENCES profiles(id)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_activity_profile ON activity(profile_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_activity_created ON activity(created_at DESC)`);

  // Jobs table (marketplace)
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      category TEXT DEFAULT 'other',
      skills TEXT DEFAULT '[]',  -- JSON array
      budget_type TEXT DEFAULT 'fixed',
      budget_amount REAL DEFAULT 0,
      budget_currency TEXT DEFAULT 'USDC',
      budget_max REAL,
      timeline TEXT DEFAULT 'flexible',
      status TEXT DEFAULT 'open',
      attachments TEXT DEFAULT '[]',  -- JSON array
      requirements TEXT DEFAULT '',
      expires_at TEXT,
      selected_agent_id TEXT,
      selected_at TEXT,
      agreed_budget REAL,
      agreed_timeline TEXT,
      application_count INTEGER DEFAULT 0,
      view_count INTEGER DEFAULT 0,
      escrow_id TEXT,
      escrow_required INTEGER DEFAULT 0,
      escrow_funded INTEGER DEFAULT 0,
      deposit_confirmed_at TEXT,
      funds_locked INTEGER DEFAULT 0,
      completed_at TEXT,
      completion_note TEXT,
      funds_released INTEGER DEFAULT 0,
      cancelled_at TEXT,
      cancel_reason TEXT,
      funds_refunded INTEGER DEFAULT 0,
      disputed_at TEXT,
      dispute_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_jobs_client ON jobs(client_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_jobs_category ON jobs(category)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs(created_at DESC)`);

  // Add expired_at and expiry_reason columns if not present (job expiry feature)
  try { db.exec(`ALTER TABLE jobs ADD COLUMN expired_at TEXT`); } catch (e) { /* column already exists */ }
  try { db.exec(`ALTER TABLE jobs ADD COLUMN expiry_reason TEXT`); } catch (e) { /* column already exists */ }

  // Applications table
  db.exec(`
    CREATE TABLE IF NOT EXISTS applications (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      cover_message TEXT DEFAULT '',
      proposed_budget REAL,
      proposed_timeline TEXT,
      portfolio_items TEXT DEFAULT '[]',  -- JSON array
      status TEXT DEFAULT 'pending',
      status_note TEXT,
      accepted_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (job_id) REFERENCES jobs(id),
      UNIQUE(job_id, agent_id)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_applications_job ON applications(job_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_applications_agent ON applications(agent_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status)`);
  
  // Add team_id column to applications if not exists (for team-based job applications)
  try {
    db.exec(`ALTER TABLE applications ADD COLUMN team_id TEXT DEFAULT NULL`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_applications_team ON applications(team_id)`);
  } catch (e) {
    // Column already exists
  }
  
  // Add wallet_address column to applications if not exists (for escrow payments)
  try {
    db.exec(`ALTER TABLE applications ADD COLUMN wallet_address TEXT DEFAULT NULL`);
    console.log('[Database] Added team_id column to applications');
  } catch (e) {
    // Column already exists
  }

  // Bounty submissions table
  db.exec(`
    CREATE TABLE IF NOT EXISTS bounty_submissions (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      submission_url TEXT,
      attachments TEXT DEFAULT '[]',
      status TEXT DEFAULT 'pending',
      score REAL,
      judge_notes TEXT,
      is_winner INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (job_id) REFERENCES jobs(id)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_bounty_submissions_job ON bounty_submissions(job_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_bounty_submissions_agent ON bounty_submissions(agent_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_bounty_submissions_winner ON bounty_submissions(is_winner)`);

  // Reviews table
  db.exec(`
    CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      reviewer_id TEXT NOT NULL,
      reviewee_id TEXT NOT NULL,
      rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
      comment TEXT DEFAULT '',
      type TEXT NOT NULL,  -- 'client_to_agent' or 'agent_to_client'
      created_at TEXT NOT NULL,
      FOREIGN KEY (job_id) REFERENCES jobs(id),
      UNIQUE(job_id, reviewer_id, reviewee_id)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_reviews_reviewee ON reviews(reviewee_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_reviews_job ON reviews(job_id)`);

  // Escrows table
  db.exec(`
    CREATE TABLE IF NOT EXISTS escrows (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      client_wallet TEXT,
      agent_id TEXT,
      agent_wallet TEXT,
      amount REAL NOT NULL,
      currency TEXT DEFAULT 'USDC',
      platform_fee REAL,
      agent_payout REAL,
      status TEXT DEFAULT 'pending',
      deposit_address TEXT,
      deposit_tx_hash TEXT,
      deposit_confirmed_at TEXT,
      release_tx_hash TEXT,
      released_at TEXT,
      refund_tx_hash TEXT,
      refunded_at TEXT,
      locked_at TEXT,
      expires_at TEXT,
      notes TEXT DEFAULT '[]',  -- JSON array
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (job_id) REFERENCES jobs(id)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_escrows_job ON escrows(job_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_escrows_client ON escrows(client_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_escrows_status ON escrows(status)`);

  // Disputes table
  db.exec(`
    CREATE TABLE IF NOT EXISTS disputes (
      id TEXT PRIMARY KEY,
      escrow_id TEXT NOT NULL,
      opened_by TEXT NOT NULL,
      reason TEXT NOT NULL,
      evidence TEXT DEFAULT '[]',  -- JSON array
      status TEXT DEFAULT 'open',
      resolved_at TEXT,
      resolution TEXT,
      admin_notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (escrow_id) REFERENCES escrows(id)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_disputes_escrow ON disputes(escrow_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_disputes_status ON disputes(status)`);

  // Follows table
  db.exec(`
    CREATE TABLE IF NOT EXISTS follows (
      follower_id TEXT NOT NULL,
      following_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (follower_id, following_id)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_follows_follower ON follows(follower_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_follows_following ON follows(following_id)`);

  // Webhooks table
  db.exec(`
    CREATE TABLE IF NOT EXISTS webhooks (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      url TEXT NOT NULL,
      secret TEXT,
      events TEXT DEFAULT '[]',  -- JSON array
      enabled INTEGER DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_webhooks_owner ON webhooks(owner_id)`);

  // Webhook logs table
  db.exec(`
    CREATE TABLE IF NOT EXISTS webhook_logs (
      id TEXT PRIMARY KEY,
      webhook_id TEXT NOT NULL,
      event TEXT NOT NULL,
      payload TEXT,  -- JSON
      response_status INTEGER,
      response_body TEXT,
      success INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (webhook_id) REFERENCES webhooks(id)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_webhook_logs_webhook ON webhook_logs(webhook_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_webhook_logs_created ON webhook_logs(created_at DESC)`);

  // API Keys table
  db.exec(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      key_hash TEXT NOT NULL UNIQUE,
      owner_id TEXT NOT NULL,
      name TEXT DEFAULT '',
      permissions TEXT DEFAULT '[]',  -- JSON array
      last_used_at TEXT,
      usage_count INTEGER DEFAULT 0,
      rate_limit INTEGER DEFAULT 100,
      enabled INTEGER DEFAULT 1,
      created_at TEXT NOT NULL,
      expires_at TEXT
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_api_keys_owner ON api_keys(owner_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash)`);

  // Add tier columns if they don't exist (migration for existing installs)
  try {
    db.exec(`ALTER TABLE api_keys ADD COLUMN tier TEXT DEFAULT 'free'`);
  } catch (e) { /* column already exists */ }
  try {
    db.exec(`ALTER TABLE api_keys ADD COLUMN requests_today INTEGER DEFAULT 0`);
  } catch (e) { /* column already exists */ }
  try {
    db.exec(`ALTER TABLE api_keys ADD COLUMN requests_today_date TEXT DEFAULT ''`);
  } catch (e) { /* column already exists */ }

  // Verification requests table
  db.exec(`
    CREATE TABLE IF NOT EXISTS verification_requests (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      skill_name TEXT NOT NULL,
      proof_type TEXT NOT NULL,
      proof_data TEXT DEFAULT '{}',  -- JSON
      status TEXT DEFAULT 'pending',
      reviewer_id TEXT,
      review_note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_vreq_agent ON verification_requests(agent_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_vreq_status ON verification_requests(status)`);

  // Collaborations table
  db.exec(`
    CREATE TABLE IF NOT EXISTS collaborations (
      id TEXT PRIMARY KEY,
      agents TEXT NOT NULL,  -- JSON array of agent IDs
      project TEXT NOT NULL,  -- JSON { name, description, url }
      roles TEXT DEFAULT '{}',  -- JSON { agentId: role }
      status TEXT DEFAULT 'pending',
      initiated_by TEXT NOT NULL,
      confirmed_by TEXT DEFAULT '[]',  -- JSON array
      declined_by TEXT DEFAULT '[]',  -- JSON array
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_collab_status ON collaborations(status)`);

  // Claims table (profile ownership claims)
  db.exec(`
    CREATE TABLE IF NOT EXISTS claims (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL,
      claimed_by TEXT NOT NULL,
      verification_method TEXT NOT NULL,
      verification_code TEXT,
      status TEXT DEFAULT 'pending',
      expires_at TEXT,
      verified_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (profile_id) REFERENCES profiles(id)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_claims_profile ON claims(profile_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_claims_status ON claims(status)`);

  // Feature requests / feedback table
  db.exec(`
    CREATE TABLE IF NOT EXISTS feedback (
      id TEXT PRIMARY KEY,
      author_id TEXT NOT NULL,
      type TEXT DEFAULT 'feature',  -- feature, bug, improvement
      title TEXT NOT NULL,
      description TEXT,
      status TEXT DEFAULT 'open',
      votes INTEGER DEFAULT 0,
      voters TEXT DEFAULT '[]',  -- JSON array
      comments TEXT DEFAULT '[]',  -- JSON array
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback(status)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_feedback_votes ON feedback(votes DESC)`);

  // Analytics table (profile views)
  db.exec(`
    CREATE TABLE IF NOT EXISTS analytics_views (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id TEXT NOT NULL,
      date TEXT NOT NULL,  -- YYYY-MM-DD
      hour INTEGER,  -- 0-23
      count INTEGER DEFAULT 1,
      UNIQUE(profile_id, date, hour)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_analytics_profile ON analytics_views(profile_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_analytics_date ON analytics_views(date DESC)`);

  // API call analytics
  db.exec(`
    CREATE TABLE IF NOT EXISTS analytics_api (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      endpoint TEXT NOT NULL,
      date TEXT NOT NULL,  -- YYYY-MM-DD
      hour INTEGER,
      count INTEGER DEFAULT 1,
      UNIQUE(endpoint, date, hour)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_api_analytics_endpoint ON analytics_api(endpoint)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_api_analytics_date ON analytics_api(date DESC)`);

  // Custom proofs table
  db.exec(`
    CREATE TABLE IF NOT EXISTS custom_proofs (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT,
      description TEXT,
      url TEXT,
      file_name TEXT,
      mime_type TEXT,
      related_to TEXT,
      verified INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (profile_id) REFERENCES profiles(id)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_proofs_profile ON custom_proofs(profile_id)`);

  // Telegram verifications
  db.exec(`
    CREATE TABLE IF NOT EXISTS telegram_verifications (
      profile_id TEXT PRIMARY KEY,
      telegram_id TEXT NOT NULL,
      username TEXT,
      verified INTEGER DEFAULT 0,
      verified_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (profile_id) REFERENCES profiles(id)
    )
  `);

  // Discord verifications
  db.exec(`
    CREATE TABLE IF NOT EXISTS discord_verifications (
      profile_id TEXT PRIMARY KEY,
      discord_id TEXT NOT NULL,
      username TEXT,
      discriminator TEXT,
      avatar TEXT,
      verified INTEGER DEFAULT 0,
      verified_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (profile_id) REFERENCES profiles(id)
    )
  `);

  // AgentMail verifications
  db.exec(`
    CREATE TABLE IF NOT EXISTS agentmail_verifications (
      profile_id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      verified INTEGER DEFAULT 0,
      verified_at TEXT,
      verification_code TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (profile_id) REFERENCES profiles(id)
    )
  `);

  // SATP Attestations table
  db.exec(`
    CREATE TABLE IF NOT EXISTS satp_attestations (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      attestation_type TEXT NOT NULL CHECK(attestation_type IN ('verification','endorsement','collaboration','trading','github')),
      score INTEGER NOT NULL CHECK(score >= 0 AND score <= 100),
      evidence TEXT DEFAULT '{}',
      issued_at TEXT NOT NULL,
      expires_at TEXT,
      issuer TEXT NOT NULL,
      FOREIGN KEY (agent_id) REFERENCES profiles(id)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_satp_att_agent ON satp_attestations(agent_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_satp_att_type ON satp_attestations(attestation_type)`);

  // SATP Trust Scores table
  db.exec(`
    CREATE TABLE IF NOT EXISTS satp_trust_scores (
      agent_id TEXT PRIMARY KEY,
      overall_score INTEGER DEFAULT 0 CHECK(overall_score >= 0 AND overall_score <= 100),
      verification_score INTEGER DEFAULT 0,
      activity_score INTEGER DEFAULT 0,
      social_score INTEGER DEFAULT 0,
      last_computed TEXT NOT NULL,
      FOREIGN KEY (agent_id) REFERENCES profiles(id)
    )
  `);

  // Framework integrations table
  db.exec(`
    CREATE TABLE IF NOT EXISTS integrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id TEXT NOT NULL,
      framework TEXT NOT NULL,
      api_key TEXT,
      config TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(profile_id, framework)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_integrations_profile ON integrations(profile_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_integrations_framework ON integrations(framework)`);

  console.log('[Database] Schema initialized');
}

// Initialize schema on module load
initializeSchema();

// ===== PROFILE OPERATIONS =====

const profileStmts = {
  insert: db.prepare(`
    INSERT INTO profiles (id, name, handle, bio, avatar, links, wallets, skills, portfolio, 
      track_record, verification, verification_data, moltbook_stats, endorsements, 
      endorsements_given, metadata, created_at, updated_at)
    VALUES (@id, @name, @handle, @bio, @avatar, @links, @wallets, @skills, @portfolio,
      @track_record, @verification, @verification_data, @moltbook_stats, @endorsements,
      @endorsements_given, @metadata, @created_at, @updated_at)
  `),
  
  update: db.prepare(`
    UPDATE profiles SET
      name = @name, handle = @handle, bio = @bio, avatar = @avatar, 
      links = @links, wallets = @wallets, skills = @skills, portfolio = @portfolio,
      track_record = @track_record, verification = @verification, 
      verification_data = @verification_data, moltbook_stats = @moltbook_stats,
      endorsements = @endorsements, endorsements_given = @endorsements_given,
      metadata = @metadata, updated_at = @updated_at
    WHERE id = @id
  `),
  
  getById: db.prepare('SELECT * FROM profiles WHERE id = ?'),
  getByHandle: db.prepare('SELECT * FROM profiles WHERE handle = ?'),
  getAll: db.prepare('SELECT * FROM profiles ORDER BY created_at DESC'),
  search: db.prepare(`
    SELECT * FROM profiles 
    WHERE name LIKE ? OR handle LIKE ? OR bio LIKE ? OR skills LIKE ?
    ORDER BY created_at DESC
    LIMIT ?
  `),
  delete: db.prepare('DELETE FROM profiles WHERE id = ?'),
  count: db.prepare('SELECT COUNT(*) as count FROM profiles')
};

function serializeProfile(profile) {
  // Collect known fields
  const knownKeys = new Set([
    'id', 'name', 'handle', 'bio', 'avatar', 'links', 'wallets', 'skills',
    'portfolio', 'trackRecord', 'verification', 'verificationData',
    'moltbookStats', 'endorsements', 'endorsementsGiven', 'createdAt',
    'updatedAt', 'activity', 'metadata'
  ]);
  
  // Gather any extra fields into metadata
  const metadata = { ...(profile.metadata || {}) };
  for (const key of Object.keys(profile)) {
    if (!knownKeys.has(key)) {
      metadata[key] = profile[key];
    }
  }
  
  return {
    id: profile.id,
    name: profile.name,
    handle: profile.handle,
    bio: profile.bio || '',
    avatar: profile.avatar || null,
    links: JSON.stringify(profile.links || {}),
    wallets: JSON.stringify(profile.wallets || {}),
    skills: JSON.stringify(profile.skills || []),
    portfolio: JSON.stringify(profile.portfolio || []),
    track_record: profile.trackRecord ? JSON.stringify(profile.trackRecord) : null,
    verification: JSON.stringify(profile.verification || {}),
    verification_data: JSON.stringify(profile.verificationData || {}),
    moltbook_stats: profile.moltbookStats ? JSON.stringify(profile.moltbookStats) : null,
    endorsements: JSON.stringify(profile.endorsements || []),
    endorsements_given: JSON.stringify(profile.endorsementsGiven || []),
    metadata: JSON.stringify(metadata),
    created_at: profile.createdAt || new Date().toISOString(),
    updated_at: profile.updatedAt || new Date().toISOString()
  };
}

function deserializeProfile(row) {
  if (!row) return null;
  const metadata = JSON.parse(row.metadata || '{}');
  const profile = {
    id: row.id,
    name: row.name,
    handle: row.handle,
    bio: row.bio,
    avatar: row.avatar,
    links: JSON.parse(row.links || '{}'),
    wallets: JSON.parse(row.wallets || '{}'),
    skills: JSON.parse(row.skills || '[]'),
    portfolio: JSON.parse(row.portfolio || '[]'),
    trackRecord: row.track_record ? JSON.parse(row.track_record) : null,
    verification: JSON.parse(row.verification || '{}'),
    verificationData: JSON.parse(row.verification_data || '{}'),
    moltbookStats: row.moltbook_stats ? JSON.parse(row.moltbook_stats) : null,
    endorsements: JSON.parse(row.endorsements || '[]'),
    endorsementsGiven: JSON.parse(row.endorsements_given || '[]'),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    // Activity is loaded separately for efficiency
    activity: [],
    // NFT avatar (Burn to Become permanent avatar)
    nftAvatar: row.nft_avatar ? JSON.parse(row.nft_avatar) : null,
  };
  // Spread metadata overflow fields back onto the profile
  for (const [key, value] of Object.entries(metadata)) {
    if (!(key in profile)) {
      profile[key] = value;
    }
  }
  return profile;
}

function saveProfile(profile) {
  const data = serializeProfile(profile);
  const existing = profileStmts.getById.get(profile.id);
  
  if (existing) {
    profileStmts.update.run(data);
  } else {
    profileStmts.insert.run(data);
  }
  
  return profile;
}

function loadProfile(profileId) {
  const row = profileStmts.getById.get(profileId);
  return deserializeProfile(row);
}

function loadProfileByHandle(handle) {
  const row = profileStmts.getByHandle.get(handle);
  return deserializeProfile(row);
}

function loadProfileByWallet(walletAddress) {
  // Search all profiles for matching solana wallet in JSON wallets column
  const rows = db.prepare(`SELECT * FROM profiles WHERE wallets LIKE ?`).all(`%${walletAddress}%`);
  for (const row of rows) {
    const profile = deserializeProfile(row);
    if (profile && profile.wallets && 
        (profile.wallets.solana === walletAddress || profile.wallets.ethereum === walletAddress)) {
      return profile;
    }
  }
  return null;
}

function listProfiles() {
  const rows = profileStmts.getAll.all();
  return rows.map(deserializeProfile);
}

function searchProfiles(query, limit = 50) {
  const searchTerm = `%${query}%`;
  const rows = profileStmts.search.all(searchTerm, searchTerm, searchTerm, searchTerm, limit);
  return rows.map(deserializeProfile);
}

function deleteProfile(profileId) {
  // Delete related data first (activity, etc.) due to foreign key constraints
  db.prepare('DELETE FROM activity WHERE profile_id = ?').run(profileId);
  db.prepare('DELETE FROM analytics_views WHERE profile_id = ?').run(profileId);
  db.prepare('DELETE FROM custom_proofs WHERE profile_id = ?').run(profileId);
  db.prepare('DELETE FROM follows WHERE follower_id = ? OR following_id = ?').run(profileId, profileId);
  profileStmts.delete.run(profileId);
}

function getProfileCount() {
  return profileStmts.count.get().count;
}

// ===== ACTIVITY OPERATIONS =====

const activityStmts = {
  insert: db.prepare(`
    INSERT INTO activity (id, profile_id, type, data, created_at)
    VALUES (@id, @profile_id, @type, @data, @created_at)
  `),
  getByProfile: db.prepare(`
    SELECT * FROM activity WHERE profile_id = ? 
    ORDER BY created_at DESC LIMIT ?
  `),
  getGlobalFeed: db.prepare(`
    SELECT a.*, p.name as profile_name, p.handle as profile_handle 
    FROM activity a
    JOIN profiles p ON a.profile_id = p.id
    ORDER BY a.created_at DESC LIMIT ?
  `),
  deleteOld: db.prepare(`
    DELETE FROM activity WHERE profile_id = ? 
    AND id NOT IN (SELECT id FROM activity WHERE profile_id = ? ORDER BY created_at DESC LIMIT 50)
  `)
};

function addActivity(profileId, type, data = {}) {
  const activity = {
    id: `act_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    profile_id: profileId,
    type,
    data: JSON.stringify(data),
    created_at: new Date().toISOString()
  };
  
  activityStmts.insert.run(activity);
  
  // Keep only last 50 per profile
  activityStmts.deleteOld.run(profileId, profileId);
  
  return { ...activity, data };
}

function getActivities(profileId, limit = 10) {
  const rows = activityStmts.getByProfile.all(profileId, limit);
  return rows.map(row => ({
    id: row.id,
    profileId: row.profile_id,
    type: row.type,
    data: JSON.parse(row.data || '{}'),
    createdAt: row.created_at
  }));
}

function getGlobalFeed(limit = 20) {
  const rows = activityStmts.getGlobalFeed.all(limit);
  return rows.map(row => ({
    id: row.id,
    profileId: row.profile_id,
    profileName: row.profile_name,
    profileHandle: row.profile_handle,
    type: row.type,
    data: JSON.parse(row.data || '{}'),
    createdAt: row.created_at
  }));
}

// ===== JOB OPERATIONS =====

const jobStmts = {
  insert: db.prepare(`
    INSERT INTO jobs (id, client_id, title, description, category, skills, budget_type,
      budget_amount, budget_currency, budget_max, timeline, status, attachments,
      requirements, expires_at, escrow_id, escrow_required, created_at, updated_at)
    VALUES (@id, @client_id, @title, @description, @category, @skills, @budget_type,
      @budget_amount, @budget_currency, @budget_max, @timeline, @status, @attachments,
      @requirements, @expires_at, @escrow_id, @escrow_required, @created_at, @updated_at)
  `),
  
  update: db.prepare(`
    UPDATE jobs SET
      title = @title, description = @description, category = @category, skills = @skills,
      budget_type = @budget_type, budget_amount = @budget_amount, budget_currency = @budget_currency,
      budget_max = @budget_max, timeline = @timeline, status = @status, attachments = @attachments,
      requirements = @requirements, expires_at = @expires_at, selected_agent_id = @selected_agent_id,
      selected_at = @selected_at, agreed_budget = @agreed_budget, agreed_timeline = @agreed_timeline,
      application_count = @application_count, view_count = @view_count, escrow_id = @escrow_id,
      escrow_required = @escrow_required, escrow_funded = @escrow_funded,
      deposit_confirmed_at = @deposit_confirmed_at, funds_locked = @funds_locked,
      completed_at = @completed_at, completion_note = @completion_note, funds_released = @funds_released,
      cancelled_at = @cancelled_at, cancel_reason = @cancel_reason, funds_refunded = @funds_refunded,
      disputed_at = @disputed_at, dispute_id = @dispute_id,
      expired_at = @expired_at, expiry_reason = @expiry_reason, updated_at = @updated_at
    WHERE id = @id
  `),
  
  getById: db.prepare('SELECT * FROM jobs WHERE id = ?'),
  getAll: db.prepare('SELECT * FROM jobs ORDER BY created_at DESC'),
  getByStatus: db.prepare('SELECT * FROM jobs WHERE status = ? ORDER BY created_at DESC'),
  getByClient: db.prepare('SELECT * FROM jobs WHERE client_id = ? ORDER BY created_at DESC'),
  getByAgent: db.prepare('SELECT * FROM jobs WHERE selected_agent_id = ? ORDER BY created_at DESC'),
  delete: db.prepare('DELETE FROM jobs WHERE id = ?'),
  incrementViews: db.prepare('UPDATE jobs SET view_count = view_count + 1 WHERE id = ?')
};

function serializeJob(job) {
  return {
    id: job.id,
    client_id: job.clientId,
    title: job.title,
    description: job.description || '',
    category: job.category || 'other',
    skills: JSON.stringify(job.skills || []),
    budget_type: job.budgetType || 'fixed',
    budget_amount: job.budgetAmount || 0,
    budget_currency: job.budgetCurrency || 'USDC',
    budget_max: job.budgetMax || null,
    timeline: job.timeline || 'flexible',
    status: job.status || 'open',
    attachments: JSON.stringify(job.attachments || []),
    requirements: job.requirements || '',
    expires_at: job.expiresAt || null,
    selected_agent_id: job.selectedAgentId || null,
    selected_at: job.selectedAt || null,
    agreed_budget: job.agreedBudget || null,
    agreed_timeline: job.agreedTimeline || null,
    application_count: job.applicationCount || 0,
    view_count: job.viewCount || 0,
    escrow_id: job.escrowId || null,
    escrow_required: job.escrowRequired ? 1 : 0,
    escrow_funded: job.escrowFunded ? 1 : 0,
    deposit_confirmed_at: job.depositConfirmedAt || null,
    funds_locked: job.fundsLocked ? 1 : 0,
    completed_at: job.completedAt || null,
    completion_note: job.completionNote || null,
    funds_released: job.fundsReleased ? 1 : 0,
    cancelled_at: job.cancelledAt || null,
    cancel_reason: job.cancelReason || null,
    funds_refunded: job.fundsRefunded ? 1 : 0,
    disputed_at: job.disputedAt || null,
    dispute_id: job.disputeId || null,
    expired_at: job.expiredAt || null,
    expiry_reason: job.expiryReason || null,
    created_at: job.createdAt || new Date().toISOString(),
    updated_at: job.updatedAt || new Date().toISOString()
  };
}

function deserializeJob(row) {
  if (!row) return null;
  return {
    id: row.id,
    clientId: row.client_id,
    title: row.title,
    description: row.description,
    category: row.category,
    skills: JSON.parse(row.skills || '[]'),
    budgetType: row.budget_type,
    budgetAmount: row.budget_amount,
    budgetCurrency: row.budget_currency,
    budgetMax: row.budget_max,
    timeline: row.timeline,
    status: row.status,
    attachments: JSON.parse(row.attachments || '[]'),
    requirements: row.requirements,
    expiresAt: row.expires_at,
    selectedAgentId: row.selected_agent_id,
    selectedAt: row.selected_at,
    agreedBudget: row.agreed_budget,
    agreedTimeline: row.agreed_timeline,
    applicationCount: row.application_count,
    viewCount: row.view_count,
    escrowId: row.escrow_id,
    escrowRequired: !!row.escrow_required,
    escrowFunded: !!row.escrow_funded,
    depositConfirmedAt: row.deposit_confirmed_at,
    fundsLocked: !!row.funds_locked,
    completedAt: row.completed_at,
    completionNote: row.completion_note,
    fundsReleased: !!row.funds_released,
    cancelledAt: row.cancelled_at,
    cancelReason: row.cancel_reason,
    fundsRefunded: !!row.funds_refunded,
    disputedAt: row.disputed_at,
    disputeId: row.dispute_id,
    expiredAt: row.expired_at,
    expiryReason: row.expiry_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function saveJob(job) {
  const data = serializeJob(job);
  const existing = jobStmts.getById.get(job.id);
  
  if (existing) {
    jobStmts.update.run(data);
  } else {
    jobStmts.insert.run(data);
  }
  
  // Sync to JSON file for Next.js frontend
  try {
    const fs = require('fs');
    const path = require('path');
    const jobsDir = path.join(__dirname, '../../data/marketplace/jobs');
    if (fs.existsSync(jobsDir)) {
      fs.writeFileSync(path.join(jobsDir, job.id + '.json'), JSON.stringify(job, null, 2));
    }
  } catch (e) { /* silent */ }
  
  return job;
}

function loadJob(jobId) {
  const row = jobStmts.getById.get(jobId);
  return deserializeJob(row);
}

function loadJobs(filters = {}) {
  let rows;
  if (filters.status) {
    rows = jobStmts.getByStatus.all(filters.status);
  } else if (filters.clientId) {
    rows = jobStmts.getByClient.all(filters.clientId);
  } else if (filters.agentId) {
    rows = jobStmts.getByAgent.all(filters.agentId);
  } else {
    rows = jobStmts.getAll.all();
  }
  return rows.map(deserializeJob);
}

function incrementJobViews(jobId) {
  jobStmts.incrementViews.run(jobId);
}

// ===== APPLICATION OPERATIONS =====

const appStmts = {
  insert: db.prepare(`
    INSERT INTO applications (id, job_id, agent_id, team_id, cover_message, proposed_budget,
      proposed_timeline, portfolio_items, wallet_address, status, created_at, updated_at)
    VALUES (@id, @job_id, @agent_id, @team_id, @cover_message, @proposed_budget,
      @proposed_timeline, @portfolio_items, @wallet_address, @status, @created_at, @updated_at)
  `),
  
  update: db.prepare(`
    UPDATE applications SET
      team_id = @team_id, cover_message = @cover_message, proposed_budget = @proposed_budget,
      proposed_timeline = @proposed_timeline, portfolio_items = @portfolio_items,
      wallet_address = @wallet_address, status = @status, status_note = @status_note, 
      accepted_at = @accepted_at, updated_at = @updated_at
    WHERE id = @id
  `),
  
  getById: db.prepare('SELECT * FROM applications WHERE id = ?'),
  getByJob: db.prepare('SELECT * FROM applications WHERE job_id = ? ORDER BY created_at DESC'),
  getByAgent: db.prepare('SELECT * FROM applications WHERE agent_id = ? ORDER BY created_at DESC'),
  getByJobAndAgent: db.prepare('SELECT * FROM applications WHERE job_id = ? AND agent_id = ?'),
  countByJob: db.prepare('SELECT COUNT(*) as count FROM applications WHERE job_id = ?')
};

function serializeApplication(app) {
  return {
    id: app.id,
    job_id: app.jobId,
    agent_id: app.agentId,
    team_id: app.teamId || null, // For team-based applications
    cover_message: app.coverMessage || '',
    proposed_budget: app.proposedBudget || null,
    proposed_timeline: app.proposedTimeline || null,
    portfolio_items: JSON.stringify(app.portfolioItems || []),
    wallet_address: app.walletAddress || null, // Solana wallet for escrow payments
    status: app.status || 'pending',
    status_note: app.statusNote || null,
    accepted_at: app.acceptedAt || null,
    created_at: app.createdAt || new Date().toISOString(),
    updated_at: app.updatedAt || new Date().toISOString()
  };
}

function deserializeApplication(row) {
  if (!row) return null;
  return {
    id: row.id,
    jobId: row.job_id,
    agentId: row.agent_id,
    teamId: row.team_id || null, // For team-based applications
    coverMessage: row.cover_message,
    proposedBudget: row.proposed_budget,
    proposedTimeline: row.proposed_timeline,
    portfolioItems: JSON.parse(row.portfolio_items || '[]'),
    walletAddress: row.wallet_address || null, // Solana wallet for escrow payments
    status: row.status,
    statusNote: row.status_note,
    acceptedAt: row.accepted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function saveApplication(app) {
  const data = serializeApplication(app);
  const existing = appStmts.getById.get(app.id);
  
  if (existing) {
    appStmts.update.run(data);
  } else {
    appStmts.insert.run(data);
  }
  
  return app;
}

function loadApplications(jobId) {
  const rows = appStmts.getByJob.all(jobId);
  return rows.map(deserializeApplication);
}

function getApplication(jobId, appId) {
  const row = appStmts.getById.get(appId);
  if (row && row.job_id === jobId) {
    return deserializeApplication(row);
  }
  return null;
}

function getAgentApplications(agentId) {
  const rows = appStmts.getByAgent.all(agentId);
  return rows.map(deserializeApplication);
}

function hasApplied(jobId, agentId) {
  const row = appStmts.getByJobAndAgent.get(jobId, agentId);
  return !!row;
}

function getApplicationCount(jobId) {
  return appStmts.countByJob.get(jobId).count;
}

// ===== ESCROW OPERATIONS =====

const escrowStmts = {
  insert: db.prepare(`
    INSERT INTO escrows (id, job_id, client_id, client_wallet, amount, currency,
      platform_fee, agent_payout, status, deposit_address, expires_at, notes, created_at, updated_at)
    VALUES (@id, @job_id, @client_id, @client_wallet, @amount, @currency,
      @platform_fee, @agent_payout, @status, @deposit_address, @expires_at, @notes, @created_at, @updated_at)
  `),
  
  update: db.prepare(`
    UPDATE escrows SET
      client_wallet = @client_wallet, agent_id = @agent_id, agent_wallet = @agent_wallet,
      amount = @amount, platform_fee = @platform_fee, agent_payout = @agent_payout,
      status = @status, deposit_tx_hash = @deposit_tx_hash, deposit_confirmed_at = @deposit_confirmed_at,
      release_tx_hash = @release_tx_hash, released_at = @released_at,
      refund_tx_hash = @refund_tx_hash, refunded_at = @refunded_at, locked_at = @locked_at,
      notes = @notes, updated_at = @updated_at
    WHERE id = @id
  `),
  
  getById: db.prepare('SELECT * FROM escrows WHERE id = ?'),
  getByJob: db.prepare('SELECT * FROM escrows WHERE job_id = ?'),
  getByClient: db.prepare('SELECT * FROM escrows WHERE client_id = ? ORDER BY created_at DESC'),
  getByStatus: db.prepare('SELECT * FROM escrows WHERE status = ? ORDER BY created_at DESC'),
  getAll: db.prepare('SELECT * FROM escrows ORDER BY created_at DESC')
};

function serializeEscrow(escrow) {
  return {
    id: escrow.id,
    job_id: escrow.jobId,
    client_id: escrow.clientId,
    client_wallet: escrow.clientWallet || null,
    agent_id: escrow.agentId || null,
    agent_wallet: escrow.agentWallet || null,
    amount: escrow.amount,
    currency: escrow.currency || 'USDC',
    platform_fee: escrow.platformFee || null,
    agent_payout: escrow.agentPayout || null,
    status: escrow.status || 'pending',
    deposit_address: escrow.depositAddress || null,
    deposit_tx_hash: escrow.depositTxHash || null,
    deposit_confirmed_at: escrow.depositConfirmedAt || null,
    release_tx_hash: escrow.releaseTxHash || null,
    released_at: escrow.releasedAt || null,
    refund_tx_hash: escrow.refundTxHash || null,
    refunded_at: escrow.refundedAt || null,
    locked_at: escrow.lockedAt || null,
    expires_at: escrow.expiresAt || null,
    notes: JSON.stringify(escrow.notes || []),
    created_at: escrow.createdAt || new Date().toISOString(),
    updated_at: escrow.updatedAt || new Date().toISOString()
  };
}

function deserializeEscrow(row) {
  if (!row) return null;
  return {
    id: row.id,
    jobId: row.job_id,
    clientId: row.client_id,
    clientWallet: row.client_wallet,
    agentId: row.agent_id,
    agentWallet: row.agent_wallet,
    amount: row.amount,
    currency: row.currency,
    platformFee: row.platform_fee,
    agentPayout: row.agent_payout,
    status: row.status,
    depositAddress: row.deposit_address,
    depositTxHash: row.deposit_tx_hash,
    depositConfirmedAt: row.deposit_confirmed_at,
    releaseTxHash: row.release_tx_hash,
    releasedAt: row.released_at,
    refundTxHash: row.refund_tx_hash,
    refundedAt: row.refunded_at,
    lockedAt: row.locked_at,
    expiresAt: row.expires_at,
    notes: JSON.parse(row.notes || '[]'),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function saveEscrow(escrow) {
  const data = serializeEscrow(escrow);
  const existing = escrowStmts.getById.get(escrow.id);
  
  if (existing) {
    escrowStmts.update.run(data);
  } else {
    escrowStmts.insert.run(data);
  }
  
  return escrow;
}

function loadEscrow(escrowId) {
  const row = escrowStmts.getById.get(escrowId);
  return deserializeEscrow(row);
}

function loadEscrowByJob(jobId) {
  const row = escrowStmts.getByJob.get(jobId);
  return deserializeEscrow(row);
}

function listEscrows(filters = {}) {
  let rows;
  if (filters.status) {
    rows = escrowStmts.getByStatus.all(filters.status);
  } else if (filters.clientId) {
    rows = escrowStmts.getByClient.all(filters.clientId);
  } else {
    rows = escrowStmts.getAll.all();
  }
  return rows.map(deserializeEscrow);
}

// ===== REVIEW OPERATIONS =====

const reviewStmts = {
  insert: db.prepare(`
    INSERT INTO reviews (id, job_id, reviewer_id, reviewee_id, rating, comment, type, created_at)
    VALUES (@id, @job_id, @reviewer_id, @reviewee_id, @rating, @comment, @type, @created_at)
  `),
  getByReviewee: db.prepare('SELECT * FROM reviews WHERE reviewee_id = ? ORDER BY created_at DESC'),
  getByJob: db.prepare('SELECT * FROM reviews WHERE job_id = ?'),
  exists: db.prepare('SELECT 1 FROM reviews WHERE job_id = ? AND reviewer_id = ? AND reviewee_id = ?'),
  getAverage: db.prepare('SELECT AVG(rating) as avg, COUNT(*) as count FROM reviews WHERE reviewee_id = ?')
};

function saveReview(review) {
  reviewStmts.insert.run({
    id: review.id,
    job_id: review.jobId,
    reviewer_id: review.reviewerId,
    reviewee_id: review.revieweeId,
    rating: review.rating,
    comment: review.comment || '',
    type: review.type,
    created_at: review.createdAt || new Date().toISOString()
  });
  return review;
}

function loadReviews(revieweeId) {
  const rows = reviewStmts.getByReviewee.all(revieweeId);
  return rows.map(row => ({
    id: row.id,
    jobId: row.job_id,
    reviewerId: row.reviewer_id,
    revieweeId: row.reviewee_id,
    rating: row.rating,
    comment: row.comment,
    type: row.type,
    createdAt: row.created_at
  }));
}

function reviewExists(jobId, reviewerId, revieweeId) {
  return !!reviewStmts.exists.get(jobId, reviewerId, revieweeId);
}

function getAverageRating(revieweeId) {
  const result = reviewStmts.getAverage.get(revieweeId);
  return {
    average: result.avg ? Math.round(result.avg * 10) / 10 : null,
    count: result.count
  };
}

function getJobReviews(jobId) {
  const rows = reviewStmts.getByJob.all(jobId);
  return rows.map(row => ({
    id: row.id,
    jobId: row.job_id,
    reviewerId: row.reviewer_id,
    revieweeId: row.reviewee_id,
    rating: row.rating,
    comment: row.comment,
    type: row.type,
    createdAt: row.created_at
  }));
}

// ===== FOLLOWS OPERATIONS =====

const followStmts = {
  insert: db.prepare('INSERT OR IGNORE INTO follows (follower_id, following_id, created_at) VALUES (?, ?, ?)'),
  delete: db.prepare('DELETE FROM follows WHERE follower_id = ? AND following_id = ?'),
  isFollowing: db.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?'),
  getFollowing: db.prepare('SELECT following_id FROM follows WHERE follower_id = ?'),
  getFollowers: db.prepare('SELECT follower_id FROM follows WHERE following_id = ?'),
  countFollowers: db.prepare('SELECT COUNT(*) as count FROM follows WHERE following_id = ?'),
  countFollowing: db.prepare('SELECT COUNT(*) as count FROM follows WHERE follower_id = ?')
};

function followProfile(followerId, followingId) {
  followStmts.insert.run(followerId, followingId, new Date().toISOString());
}

function unfollowProfile(followerId, followingId) {
  followStmts.delete.run(followerId, followingId);
}

function isFollowing(followerId, followingId) {
  return !!followStmts.isFollowing.get(followerId, followingId);
}

function getFollowing(followerId) {
  return followStmts.getFollowing.all(followerId).map(r => r.following_id);
}

function getFollowers(followingId) {
  return followStmts.getFollowers.all(followingId).map(r => r.follower_id);
}

function getFollowerCount(profileId) {
  return followStmts.countFollowers.get(profileId).count;
}

// ===== ANALYTICS OPERATIONS =====

const analyticsStmts = {
  upsertView: db.prepare(`
    INSERT INTO analytics_views (profile_id, date, hour, count)
    VALUES (@profile_id, @date, @hour, 1)
    ON CONFLICT(profile_id, date, hour) DO UPDATE SET count = count + 1
  `),
  upsertApi: db.prepare(`
    INSERT INTO analytics_api (endpoint, date, hour, count)
    VALUES (@endpoint, @date, @hour, 1)
    ON CONFLICT(endpoint, date, hour) DO UPDATE SET count = count + 1
  `),
  getProfileViews: db.prepare(`
    SELECT SUM(count) as total FROM analytics_views WHERE profile_id = ?
  `),
  getProfileViewsToday: db.prepare(`
    SELECT SUM(count) as total FROM analytics_views WHERE profile_id = ? AND date = ?
  `),
  getProfileViewsRange: db.prepare(`
    SELECT SUM(count) as total FROM analytics_views WHERE profile_id = ? AND date >= ?
  `),
  getTopProfiles: db.prepare(`
    SELECT profile_id, SUM(count) as views FROM analytics_views 
    WHERE date >= ? GROUP BY profile_id ORDER BY views DESC LIMIT ?
  `),
  getGlobalViews: db.prepare('SELECT SUM(count) as total FROM analytics_views'),
  getGlobalViewsToday: db.prepare('SELECT SUM(count) as total FROM analytics_views WHERE date = ?'),
  cleanupOld: db.prepare('DELETE FROM analytics_views WHERE date < ?'),
  cleanupApiOld: db.prepare('DELETE FROM analytics_api WHERE date < ?')
};

function trackProfileView(profileId) {
  const now = new Date();
  const date = now.toISOString().split('T')[0];
  const hour = now.getHours();
  
  analyticsStmts.upsertView.run({ profile_id: profileId, date, hour });
}

function trackApiCall(endpoint) {
  const now = new Date();
  const date = now.toISOString().split('T')[0];
  const hour = now.getHours();
  
  // Normalize endpoint
  const normalized = endpoint
    .replace(/\/agent_[a-z0-9]+/g, '/:id')
    .replace(/\/[a-f0-9]{8,}/g, '/:id');
  
  analyticsStmts.upsertApi.run({ endpoint: normalized, date, hour });
}

function getProfileAnalytics(profileId) {
  const today = new Date().toISOString().split('T')[0];
  const week = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const month = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  
  return {
    total: analyticsStmts.getProfileViews.get(profileId)?.total || 0,
    today: analyticsStmts.getProfileViewsToday.get(profileId, today)?.total || 0,
    last7Days: analyticsStmts.getProfileViewsRange.get(profileId, week)?.total || 0,
    last30Days: analyticsStmts.getProfileViewsRange.get(profileId, month)?.total || 0
  };
}

function getGlobalAnalytics() {
  const today = new Date().toISOString().split('T')[0];
  const week = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  
  // Get traffic trend (last 14 days)
  const trafficTrend = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    const dateStr = d.toISOString().split('T')[0];
    const views = db.prepare('SELECT SUM(count) as total FROM analytics_views WHERE date = ?').get(dateStr)?.total || 0;
    trafficTrend.push({ date: dateStr, views });
  }
  
  // Get top profiles
  const topProfiles = analyticsStmts.getTopProfiles.all(week, 10).map(r => ({
    id: r.profile_id,
    views: r.views
  }));
  
  // Get top endpoints
  const topEndpoints = db.prepare(`
    SELECT endpoint, SUM(count) as calls FROM analytics_api 
    WHERE date >= ? GROUP BY endpoint ORDER BY calls DESC LIMIT 10
  `).all(week).map(r => ({
    endpoint: r.endpoint,
    calls: r.calls
  }));
  
  // Get API call totals
  const totalApiCalls = db.prepare('SELECT SUM(count) as total FROM analytics_api').get()?.total || 0;
  const todayApiCalls = db.prepare('SELECT SUM(count) as total FROM analytics_api WHERE date = ?').get(today)?.total || 0;
  
  return {
    totalProfileViews: analyticsStmts.getGlobalViews.get()?.total || 0,
    todayViews: analyticsStmts.getGlobalViewsToday.get(today)?.total || 0,
    totalApiCalls,
    todayApiCalls,
    uniqueProfiles: getProfileCount(),
    trafficTrend,
    topProfiles,
    topEndpoints,
    lastUpdated: new Date().toISOString()
  };
}

function getViewsLeaderboard(limit = 10) {
  const week = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  return analyticsStmts.getTopProfiles.all(week, limit).map(r => ({
    profileId: r.profile_id,
    views: r.views
  }));
}

function cleanupOldAnalytics(daysToKeep = 90) {
  const cutoff = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  analyticsStmts.cleanupOld.run(cutoff);
  analyticsStmts.cleanupApiOld.run(cutoff);
}

// ===== UTILITY FUNCTIONS =====

// ===== BOUNTY SUBMISSIONS =====

function saveBountySubmission(sub) {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO bounty_submissions (id, job_id, agent_id, title, description, submission_url, attachments, status, score, judge_notes, is_winner, created_at, updated_at)
    VALUES (@id, @job_id, @agent_id, @title, @description, @submission_url, @attachments, @status, @score, @judge_notes, @is_winner, @created_at, @updated_at)
  `);
  stmt.run({
    id: sub.id,
    job_id: sub.jobId,
    agent_id: sub.agentId,
    title: sub.title,
    description: sub.description || '',
    submission_url: sub.submissionUrl || null,
    attachments: JSON.stringify(sub.attachments || []),
    status: sub.status || 'pending',
    score: sub.score || null,
    judge_notes: sub.judgeNotes || null,
    is_winner: sub.isWinner ? 1 : 0,
    created_at: sub.createdAt,
    updated_at: sub.updatedAt
  });
  return sub;
}

function loadBountySubmissions(jobId) {
  const rows = db.prepare('SELECT * FROM bounty_submissions WHERE job_id = ? ORDER BY created_at DESC').all(jobId);
  return rows.map(r => ({
    id: r.id,
    jobId: r.job_id,
    agentId: r.agent_id,
    title: r.title,
    description: r.description,
    submissionUrl: r.submission_url,
    attachments: JSON.parse(r.attachments || '[]'),
    status: r.status,
    score: r.score,
    judgeNotes: r.judge_notes,
    isWinner: !!r.is_winner,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }));
}

function getBountySubmission(submissionId) {
  const r = db.prepare('SELECT * FROM bounty_submissions WHERE id = ?').get(submissionId);
  if (!r) return null;
  return {
    id: r.id,
    jobId: r.job_id,
    agentId: r.agent_id,
    title: r.title,
    description: r.description,
    submissionUrl: r.submission_url,
    attachments: JSON.parse(r.attachments || '[]'),
    status: r.status,
    score: r.score,
    judgeNotes: r.judge_notes,
    isWinner: !!r.is_winner,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  };
}

function hasSubmittedBounty(jobId, agentId) {
  const row = db.prepare('SELECT COUNT(*) as count FROM bounty_submissions WHERE job_id = ? AND agent_id = ?').get(jobId, agentId);
  return row.count > 0;
}

function getBountySubmissionCount(jobId) {
  const row = db.prepare('SELECT COUNT(*) as count FROM bounty_submissions WHERE job_id = ?').get(jobId);
  return row.count;
}

function getAgentBountySubmissions(agentId) {
  const rows = db.prepare('SELECT * FROM bounty_submissions WHERE agent_id = ? ORDER BY created_at DESC').all(agentId);
  return rows.map(r => ({
    id: r.id,
    jobId: r.job_id,
    agentId: r.agent_id,
    title: r.title,
    description: r.description,
    submissionUrl: r.submission_url,
    attachments: JSON.parse(r.attachments || '[]'),
    status: r.status,
    score: r.score,
    judgeNotes: r.judge_notes,
    isWinner: !!r.is_winner,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }));
}

function runTransaction(fn) {
  return db.transaction(fn)();
}

function close() {
  db.close();
}

// ===== API KEYS =====

// Prepared statements for API keys
const apiKeyStmts = {
  create: db.prepare(`
    INSERT INTO api_keys (id, key_hash, owner_id, name, permissions, created_at, expires_at, enabled, usage_count, rate_limit, tier, requests_today, requests_today_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?, 0, '')
  `),
  getByHash: db.prepare('SELECT * FROM api_keys WHERE key_hash = ?'),
  getById: db.prepare('SELECT * FROM api_keys WHERE id = ?'),
  listByOwner: db.prepare('SELECT * FROM api_keys WHERE owner_id = ? ORDER BY created_at DESC'),
  updateUsage: db.prepare('UPDATE api_keys SET last_used_at = ?, usage_count = usage_count + 1 WHERE key_hash = ?'),
  revoke: db.prepare('UPDATE api_keys SET enabled = 0 WHERE id = ?'),
  revokeByHash: db.prepare('UPDATE api_keys SET enabled = 0 WHERE key_hash = ?'),
  delete: db.prepare('DELETE FROM api_keys WHERE id = ?'),
  getAll: db.prepare('SELECT * FROM api_keys ORDER BY created_at DESC'),
  getStats: db.prepare(`
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN enabled = 1 THEN 1 ELSE 0 END) as active,
      SUM(CASE WHEN enabled = 0 THEN 1 ELSE 0 END) as revoked,
      SUM(usage_count) as total_usage
    FROM api_keys
  `)
};

function createApiKey(keyHash, ownerId, name = '', permissions = 'write_own', expiresAt = null, rateLimit = 100, tier = 'free') {
  const id = 'key_' + require('crypto').randomBytes(8).toString('hex');
  const now = new Date().toISOString();
  
  try {
    apiKeyStmts.create.run(id, keyHash, ownerId, name, permissions, now, expiresAt, rateLimit, tier);
    return { id, keyHash, ownerId, permissions, tier, createdAt: now };
  } catch (e) {
    if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return null; // Key already exists
    }
    throw e;
  }
}

function getApiKeyByHash(keyHash) {
  const row = apiKeyStmts.getByHash.get(keyHash);
  if (!row) return null;
  
  return {
    id: row.id,
    keyHash: row.key_hash,
    ownerId: row.owner_id,
    name: row.name,
    permissions: row.permissions,
    lastUsedAt: row.last_used_at,
    usageCount: row.usage_count,
    rateLimit: row.rate_limit,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    tier: row.tier || 'free',
    requestsToday: row.requests_today || 0,
    requestsTodayDate: row.requests_today_date || ''
  };
}

function updateApiKeyUsage(keyHash) {
  const now = new Date().toISOString();
  apiKeyStmts.updateUsage.run(now, keyHash);
}

// Increment daily usage counter, resetting if it's a new day. Returns { allowed, requestsToday, limit }
function incrementDailyUsage(keyHash) {
  const row = apiKeyStmts.getByHash.get(keyHash);
  if (!row) return { allowed: false };
  
  const today = new Date().toISOString().split('T')[0];
  const tier = row.tier || 'free';
  const limits = { free: 100, pro: 10000, enterprise: -1 };
  const limit = limits[tier] !== undefined ? limits[tier] : 100;
  
  let requestsToday = row.requests_today || 0;
  const storedDate = row.requests_today_date || '';
  
  // Reset counter if new day
  if (storedDate !== today) {
    requestsToday = 0;
  }
  
  // Check limit (-1 = unlimited)
  if (limit !== -1 && requestsToday >= limit) {
    return { allowed: false, requestsToday, limit, tier };
  }
  
  requestsToday++;
  db.prepare('UPDATE api_keys SET requests_today = ?, requests_today_date = ? WHERE key_hash = ?')
    .run(requestsToday, today, keyHash);
  
  return { allowed: true, requestsToday, limit, tier };
}

function listApiKeysByOwner(ownerId) {
  return apiKeyStmts.listByOwner.all(ownerId).map(row => ({
    id: row.id,
    keyHashPrefix: row.key_hash.substring(0, 12) + '...',
    name: row.name,
    permissions: row.permissions,
    lastUsedAt: row.last_used_at,
    usageCount: row.usage_count,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    tier: row.tier || 'free',
    requestsToday: row.requests_today || 0,
    requestsTodayDate: row.requests_today_date || ''
  }));
}

function revokeApiKeyById(id) {
  const result = apiKeyStmts.revoke.run(id);
  return result.changes > 0;
}

function revokeApiKeyByHash(keyHash) {
  const result = apiKeyStmts.revokeByHash.run(keyHash);
  return result.changes > 0;
}

function getApiKeyStats() {
  const stats = apiKeyStmts.getStats.get();
  
  // Get permission breakdown
  const permBreakdown = db.prepare(`
    SELECT permissions, COUNT(*) as count 
    FROM api_keys 
    GROUP BY permissions
  `).all();
  
  // Get recently used keys
  const recentlyUsed = db.prepare(`
    SELECT owner_id, last_used_at, usage_count 
    FROM api_keys 
    WHERE enabled = 1 AND last_used_at IS NOT NULL 
    ORDER BY last_used_at DESC 
    LIMIT 10
  `).all();
  
  return {
    total: stats.total,
    active: stats.active,
    revoked: stats.revoked,
    totalUsage: stats.total_usage || 0,
    byPermission: Object.fromEntries(permBreakdown.map(r => [r.permissions, r.count])),
    recentlyUsed: recentlyUsed.map(r => ({
      profileId: r.owner_id,
      lastUsed: r.last_used_at,
      usageCount: r.usage_count
    }))
  };
}

// Migrate JSON api-keys to SQLite
function migrateApiKeysFromJSON(jsonPath) {
  const fs = require('fs');
  if (!fs.existsSync(jsonPath)) return { migrated: 0 };
  
  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  let migrated = 0;
  
  for (const [keyHash, keyData] of Object.entries(data.keys || {})) {
    const existing = getApiKeyByHash(keyHash);
    if (!existing) {
      try {
        const id = 'key_' + require('crypto').randomBytes(8).toString('hex');
        apiKeyStmts.create.run(
          id,
          keyHash,
          keyData.profileId || 'unknown',
          keyData.metadata?.name || '',
          keyData.permissions || 'write_own',
          keyData.createdAt || new Date().toISOString(),
          null,
          100
        );
        
        // Update usage stats if available
        if (keyData.lastUsed || keyData.usageCount) {
          db.prepare('UPDATE api_keys SET last_used_at = ?, usage_count = ?, enabled = ? WHERE id = ?')
            .run(keyData.lastUsed, keyData.usageCount || 0, keyData.active ? 1 : 0, id);
        }
        
        migrated++;
      } catch (e) {
        console.error(`Failed to migrate key: ${e.message}`);
      }
    }
  }
  
  return { migrated };
}

// ===== RESPONSE TIME METRICS =====

const responseMetricsStmt = db.prepare(`
  SELECT 
    a.agent_id,
    COUNT(*) as total_applications,
    AVG(
      (julianday(a.created_at) - julianday(j.created_at)) * 24 * 60
    ) as avg_response_minutes,
    MIN(
      (julianday(a.created_at) - julianday(j.created_at)) * 24 * 60
    ) as fastest_response_minutes,
    MAX(
      (julianday(a.created_at) - julianday(j.created_at)) * 24 * 60
    ) as slowest_response_minutes,
    SUM(CASE WHEN a.status = 'accepted' THEN 1 ELSE 0 END) as accepted_count,
    SUM(CASE WHEN 
      (julianday(a.created_at) - julianday(j.created_at)) * 24 * 60 < 60 
    THEN 1 ELSE 0 END) as under_1h_count
  FROM applications a
  JOIN jobs j ON a.job_id = j.id
  WHERE a.agent_id = ?
  GROUP BY a.agent_id
`);

function getAgentResponseMetrics(agentId) {
  const row = responseMetricsStmt.get(agentId);
  if (!row) {
    return {
      agentId,
      totalApplications: 0,
      avgResponseMinutes: null,
      fastestResponseMinutes: null,
      slowestResponseMinutes: null,
      acceptedCount: 0,
      acceptanceRate: null,
      under1hRate: null,
      responseRating: null // 'lightning', 'fast', 'moderate', 'slow'
    };
  }

  const avgMin = Math.round(row.avg_response_minutes || 0);
  const acceptanceRate = row.total_applications > 0 
    ? Math.round((row.accepted_count / row.total_applications) * 100) 
    : null;
  const under1hRate = row.total_applications > 0
    ? Math.round((row.under_1h_count / row.total_applications) * 100)
    : null;

  // Rating thresholds
  let responseRating = 'slow';
  if (avgMin < 15) responseRating = 'lightning';
  else if (avgMin < 60) responseRating = 'fast';
  else if (avgMin < 360) responseRating = 'moderate';

  return {
    agentId,
    totalApplications: row.total_applications,
    avgResponseMinutes: avgMin,
    fastestResponseMinutes: Math.round(row.fastest_response_minutes || 0),
    slowestResponseMinutes: Math.round(row.slowest_response_minutes || 0),
    acceptedCount: row.accepted_count,
    acceptanceRate,
    under1hRate,
    responseRating
  };
}

// Export everything
module.exports = {
  db,
  
  // Profiles
  saveProfile,
  loadProfile,
  loadProfileByHandle,
  loadProfileByWallet,
  listProfiles,
  searchProfiles,
  deleteProfile,
  getProfileCount,
  
  // Activity
  addActivity,
  getActivities,
  getGlobalFeed,
  
  // Jobs
  saveJob,
  loadJob,
  loadJobs,
  incrementJobViews,
  
  // Applications
  saveApplication,
  loadApplications,
  getApplication,
  getAgentApplications,
  hasApplied,
  getApplicationCount,
  
  // Escrows
  saveEscrow,
  loadEscrow,
  loadEscrowByJob,
  listEscrows,
  
  // Reviews
  saveReview,
  loadReviews,
  reviewExists,
  getAverageRating,
  getJobReviews,
  
  // Follows
  followProfile,
  unfollowProfile,
  isFollowing,
  getFollowing,
  getFollowers,
  getFollowerCount,
  
  // Analytics
  trackProfileView,
  trackApiCall,
  getProfileAnalytics,
  getGlobalAnalytics,
  getViewsLeaderboard,
  cleanupOldAnalytics,
  
  // API Keys
  createApiKey,
  getApiKeyByHash,
  updateApiKeyUsage,
  listApiKeysByOwner,
  revokeApiKeyById,
  revokeApiKeyByHash,
  getApiKeyStats,
  migrateApiKeysFromJSON,
  incrementDailyUsage,
  
  // Response Time Metrics
  getAgentResponseMetrics,

  // Bounty Submissions
  saveBountySubmission,
  loadBountySubmissions,
  getBountySubmission,
  hasSubmittedBounty,
  getBountySubmissionCount,
  getAgentBountySubmissions,

  // Utilities
  runTransaction,
  close,
  initializeSchema
};
