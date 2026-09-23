'use strict';

const express = require('express');
const Database = require('better-sqlite3');
const { liveEscrowGateStatus } = require('./lib/write-surface-gate');
const { registerPublicMarketplaceReadRoutes } = require('./routes/public-marketplace-read-routes');
const { registerMarketplaceJobRoutes } = require('./routes/marketplace-job-routes');
const { registerMarketplaceApplicationRoutes } = require('./routes/marketplace-application-routes');
const { registerMarketplaceDeliveryRoutes } = require('./routes/marketplace-delivery-routes');

function registerMarketplaceV3Routes(app, {
  getDb,
  closeDb = false,
  clock = () => new Date().toISOString(),
  publicReadLimiter,
  expirySweepIntervalMs = 0,
  awardTimeoutSweepIntervalMs = 0,
  autoApprovalSweepIntervalMs = 0,
} = {}) {
  if (typeof getDb !== 'function') throw new TypeError('getDb is required');
  registerPublicMarketplaceReadRoutes(app, { getDb, ...(publicReadLimiter ? { limiter: publicReadLimiter } : {}) });
  registerMarketplaceJobRoutes(app, { getDb, closeDb, clock, expirySweepIntervalMs });
  registerMarketplaceDeliveryRoutes(app, { getDb, closeDb, clock, autoApprovalSweepIntervalMs });
  registerMarketplaceApplicationRoutes(app, { getDb, closeDb, clock, timeoutSweepIntervalMs: awardTimeoutSweepIntervalMs });
  app.get('/api/marketplace/v3/smoke', (_req, res) => {
    const db = getDb();
    try {
      const jobs = db.prepare('SELECT COUNT(*) AS count FROM jobs').get().count;
      const gate = liveEscrowGateStatus(process.env);
      return res.json({
        ok: true,
        mode: 'read_only_staged',
        jobs: Number(jobs) || 0,
        liveEscrowWritesAllowed: gate.enabled,
        gateStatus: gate.status,
        moneyMoved: false,
        customerStateChanged: false,
      });
    } finally {
      if (closeDb) db.close();
    }
  });
}

function createMarketplaceV3Server({
  dbPath,
  clock = () => new Date().toISOString(),
  expirySweepIntervalMs = 0,
  awardTimeoutSweepIntervalMs = 0,
  autoApprovalSweepIntervalMs = 0,
} = {}) {
  if (!dbPath) throw new TypeError('dbPath is required');
  let db;
  const getDb = () => {
    if (!db?.open) {
      db = new Database(dbPath);
      db.pragma('journal_mode = WAL');
      db.pragma('foreign_keys = ON');
    }
    return db;
  };
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '64kb' }));
  registerMarketplaceV3Routes(app, {
    getDb,
    clock,
    expirySweepIntervalMs,
    awardTimeoutSweepIntervalMs,
    autoApprovalSweepIntervalMs,
  });
  return {
    app,
    getDb,
    async listen(port = 0, host = '127.0.0.1') {
      return new Promise((resolve, reject) => {
        const server = app.listen(port, host, () => resolve(server));
        server.once('error', reject);
      });
    },
    close() {
      if (db?.open) db.close();
    },
  };
}

module.exports = {
  createMarketplaceV3Server,
  registerMarketplaceV3Routes,
};
