/**
 * AgentFolio Staking API Routes
 * POST /api/staking/stake — stake on an agent
 * POST /api/staking/unstake — unstake from an agent
 * GET /api/staking/balance/:userId — get balance
 * GET /api/staking/agent/:agentId — get agent's stakes
 * GET /api/staking/user/:userId — get user's active stakes
 * GET /api/staking/history/:userId — staking history
 * GET /api/staking/leaderboard — top scouts + most staked agents
 */

const express = require('express');
const router = express.Router();
const staking = require('../lib/staking');

// Stake on agent
router.post('/stake', (req, res) => {
  try {
    const { stakerId, agentId, amount } = req.body;
    if (!stakerId || !agentId || !amount) {
      return res.status(400).json({ error: 'stakerId, agentId, and amount required' });
    }
    const result = staking.stakeOnAgent(stakerId, agentId, parseInt(amount));
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Unstake from agent
router.post('/unstake', (req, res) => {
  try {
    const { stakerId, agentId } = req.body;
    if (!stakerId || !agentId) {
      return res.status(400).json({ error: 'stakerId and agentId required' });
    }
    const result = staking.unstakeFromAgent(stakerId, agentId);
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Get balance
router.get('/balance/:userId', (req, res) => {
  try {
    const balance = staking.getBalance(req.params.userId);
    res.json(balance);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get agent's staking info
router.get('/agent/:agentId', (req, res) => {
  try {
    const info = staking.getAgentStakes(req.params.agentId);
    res.json(info);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get user's active stakes
router.get('/user/:userId', (req, res) => {
  try {
    const stakes = staking.getUserStakes(req.params.userId);
    res.json({ stakes });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get staking history
router.get('/history/:userId', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const history = staking.getUserHistory(req.params.userId, limit);
    res.json({ history });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Leaderboard
router.get('/leaderboard', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const leaderboard = staking.getStakingLeaderboard(limit);
    res.json(leaderboard);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
