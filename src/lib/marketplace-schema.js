'use strict';

function addColumn(db, table, definition) {
  const column = definition.trim().split(/\s+/, 1)[0];
  const exists = db.prepare(`PRAGMA table_info(${table})`).all()
    .some((entry) => entry.name === column);
  if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
}

function initializeMarketplaceCoreSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      category TEXT DEFAULT 'other',
      skills TEXT DEFAULT '[]',
      budget_type TEXT DEFAULT 'fixed',
      budget_amount REAL DEFAULT 0,
      budget_currency TEXT DEFAULT 'SOL',
      budget_max REAL,
      timeline TEXT DEFAULT 'flexible',
      status TEXT DEFAULT 'open',
      attachments TEXT DEFAULT '[]',
      requirements TEXT DEFAULT '',
      expires_at TEXT,
      selected_agent_id TEXT,
      selected_application_id TEXT,
      selected_at TEXT,
      award_expires_at TEXT,
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
      expired_at TEXT,
      expiry_reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS applications (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      cover_message TEXT DEFAULT '',
      proposed_budget REAL,
      proposed_timeline TEXT,
      portfolio_items TEXT DEFAULT '[]',
      status TEXT DEFAULT 'pending',
      status_note TEXT,
      accepted_at TEXT,
      withdrawn_at TEXT,
      rejected_at TEXT,
      declined_at TEXT,
      team_id TEXT DEFAULT NULL,
      wallet_address TEXT DEFAULT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (job_id) REFERENCES jobs(id),
      UNIQUE(job_id, agent_id)
    );

    CREATE TABLE IF NOT EXISTS escrows (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      client_wallet TEXT,
      agent_id TEXT,
      agent_wallet TEXT,
      amount REAL NOT NULL,
      currency TEXT DEFAULT 'SOL',
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
      notes TEXT DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (job_id) REFERENCES jobs(id)
    );

    CREATE INDEX IF NOT EXISTS idx_jobs_client ON jobs(client_id);
    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
    CREATE INDEX IF NOT EXISTS idx_jobs_category ON jobs(category);
    CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_applications_job ON applications(job_id);
    CREATE INDEX IF NOT EXISTS idx_applications_agent ON applications(agent_id);
    CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status);
    CREATE INDEX IF NOT EXISTS idx_escrows_job ON escrows(job_id);
    CREATE INDEX IF NOT EXISTS idx_escrows_client ON escrows(client_id);
    CREATE INDEX IF NOT EXISTS idx_escrows_status ON escrows(status);
  `);

  addColumn(db, 'jobs', 'expired_at TEXT');
  addColumn(db, 'jobs', 'expiry_reason TEXT');
  addColumn(db, 'jobs', 'selected_application_id TEXT');
  addColumn(db, 'jobs', 'award_expires_at TEXT');
  addColumn(db, 'applications', 'withdrawn_at TEXT');
  addColumn(db, 'applications', 'rejected_at TEXT');
  addColumn(db, 'applications', 'declined_at TEXT');
  addColumn(db, 'applications', 'team_id TEXT DEFAULT NULL');
  addColumn(db, 'applications', 'wallet_address TEXT DEFAULT NULL');
  db.exec('CREATE INDEX IF NOT EXISTS idx_applications_team ON applications(team_id)');
}

module.exports = { initializeMarketplaceCoreSchema };
