/**
 * Capital Delegation API Routes
 * POST   /api/vaults                    - Create vault (agent only)
 * GET    /api/vaults                    - List active vaults
 * GET    /api/vaults/:id                - Get vault details + stats
 * GET    /api/vaults/:id/nav            - NAV history
 * PUT    /api/vaults/:id/nav            - Update NAV (agent only)
 * POST   /api/vaults/:id/delegate       - Delegate capital
 * POST   /api/delegations/:id/withdraw  - Withdraw delegation
 * GET    /api/delegations/my            - My active delegations
 * GET    /api/delegations/history       - My delegation history
 * GET    /api/vaults/leaderboard        - Top performing vaults
 * GET    /api/agents/:id/vaults         - Agent's vaults
 */

const express = require('express');
const router = express.Router();
const delegation = require('../lib/capital-delegation');
const logger = require('../logger');

// Middleware: extract user from API key or session
function getUserId(req) {
  return req.user?.id || req.headers['x-user-id'] || req.query.userId;
}

function requireUser(req, res, next) {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Authentication required' });
  req.userId = userId;
  next();
}

// Create vault
router.post('/vaults', requireUser, (req, res) => {
  try {
    const { name, description, strategy, performanceFeeBps, minDelegation, maxCapacity, lockPeriodDays } = req.body;
    const vault = delegation.createVault(req.userId, {
      name, description, strategy, performanceFeeBps, minDelegation, maxCapacity, lockPeriodDays
    });
    res.status(201).json(vault);
  } catch (err) {
    logger.error(`[delegation-api] Create vault error: ${err.message}`);
    res.status(400).json({ error: err.message });
  }
});

// List active vaults
router.get('/vaults/leaderboard', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const vaults = delegation.getVaultLeaderboard({ limit });
    res.json({ vaults });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/vaults', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = parseInt(req.query.offset) || 0;
    const sortBy = req.query.sortBy;
    const vaults = delegation.listActiveVaults({ limit, offset, sortBy });
    res.json({ vaults });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get vault details
router.get('/vaults/:id', (req, res) => {
  try {
    const stats = delegation.getVaultStats(req.params.id);
    if (!stats) return res.status(404).json({ error: 'Vault not found' });
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// NAV history
router.get('/vaults/:id/nav', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 30, 200);
    const history = delegation.getNavHistory(req.params.id, { limit });
    res.json({ history });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update NAV (agent only)
router.put('/vaults/:id/nav', requireUser, (req, res) => {
  try {
    const { nav, note } = req.body;
    if (typeof nav !== 'number' || nav < 0) {
      return res.status(400).json({ error: 'NAV must be a non-negative number' });
    }
    const vault = delegation.updateNav(req.params.id, req.userId, nav, note);
    res.json(vault);
  } catch (err) {
    logger.error(`[delegation-api] Update NAV error: ${err.message}`);
    res.status(400).json({ error: err.message });
  }
});

// Delegate capital
router.post('/vaults/:id/delegate', requireUser, (req, res) => {
  try {
    const { amount } = req.body;
    if (typeof amount !== 'number' || amount <= 0) {
      return res.status(400).json({ error: 'Amount must be a positive number' });
    }
    const result = delegation.delegate(req.params.id, req.userId, amount);
    res.status(201).json(result);
  } catch (err) {
    logger.error(`[delegation-api] Delegate error: ${err.message}`);
    res.status(400).json({ error: err.message });
  }
});

// Withdraw
router.post('/delegations/:id/withdraw', requireUser, (req, res) => {
  try {
    const result = delegation.withdraw(parseInt(req.params.id), req.userId);
    res.json(result);
  } catch (err) {
    logger.error(`[delegation-api] Withdraw error: ${err.message}`);
    res.status(400).json({ error: err.message });
  }
});

// My delegations
router.get('/delegations/my', requireUser, (req, res) => {
  try {
    const positions = delegation.getDelegatorPositions(req.userId);
    res.json({ positions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// My history
router.get('/delegations/history', requireUser, (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const history = delegation.getDelegationHistory(req.userId, { limit });
    res.json({ history });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Agent's vaults
router.get('/agents/:id/vaults', (req, res) => {
  try {
    const vaults = delegation.getAgentVaults(req.params.id);
    res.json({ vaults });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
