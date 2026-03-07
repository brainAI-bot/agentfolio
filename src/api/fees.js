/**
 * Performance-Based Fee API Routes
 * 
 * GET  /api/fees/tiers              — List all fee tiers and requirements
 * GET  /api/fees/:profileId         — Get fee schedule for an agent
 * GET  /api/fees/:profileId/history — Get fee history for an agent
 * POST /api/fees/:profileId/recalculate — Force recalculation
 * PUT  /api/fees/:profileId/custom  — Set custom rate (admin only)
 * DELETE /api/fees/:profileId/custom — Remove custom rate (admin only)
 * GET  /api/fees/stats              — Platform fee stats (admin only)
 */

const fees = require('../lib/performance-fees');

function registerFeeRoutes(app) {
  // List all fee tiers
  app.get('/api/fees/tiers', (req, res) => {
    res.json({ tiers: fees.getFeeTiers(), premiumDiscounts: fees.PREMIUM_DISCOUNTS, minRate: fees.MIN_FEE_RATE });
  });

  // Platform fee stats (admin)
  app.get('/api/fees/stats', (req, res) => {
    try {
      const stats = fees.getPlatformFeeStats();
      res.json(stats);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Get fee schedule for agent
  app.get('/api/fees/:profileId', (req, res) => {
    try {
      const schedule = fees.getFeeSchedule(req.params.profileId);
      const feeInfo = fees.calculateFeeRate(req.params.profileId);
      res.json({
        profileId: req.params.profileId,
        tier: feeInfo.tier,
        tierName: feeInfo.tierName,
        effectiveRate: feeInfo.rate,
        effectivePercent: (feeInfo.rate * 100).toFixed(1) + '%',
        baseRate: feeInfo.baseRate,
        premiumDiscount: feeInfo.premiumDiscount,
        isCustom: feeInfo.isCustom,
        metrics: feeInfo.metrics,
        nextTier: feeInfo.tier < 4 ? fees.FEE_TIERS[feeInfo.tier + 1] : null
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Fee history
  app.get('/api/fees/:profileId/history', (req, res) => {
    try {
      const limit = parseInt(req.query.limit) || 50;
      const history = fees.getFeeHistory(req.params.profileId, limit);
      res.json({ profileId: req.params.profileId, history });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Force recalculation
  app.post('/api/fees/:profileId/recalculate', (req, res) => {
    try {
      const result = fees.recalculateFeeSchedule(req.params.profileId);
      res.json({ profileId: req.params.profileId, ...result });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Set custom rate (admin)
  app.put('/api/fees/:profileId/custom', (req, res) => {
    const { rate, reason } = req.body || {};
    if (rate == null || typeof rate !== 'number' || rate < 0 || rate > 0.10) {
      return res.status(400).json({ error: 'Rate must be a number between 0 and 0.10' });
    }
    try {
      const result = fees.setCustomRate(req.params.profileId, rate, reason);
      res.json({ profileId: req.params.profileId, ...result });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Remove custom rate
  app.delete('/api/fees/:profileId/custom', (req, res) => {
    try {
      const result = fees.removeCustomRate(req.params.profileId);
      res.json({ profileId: req.params.profileId, ...result });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
}

module.exports = { registerFeeRoutes };
