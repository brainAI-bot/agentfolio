'use strict';

const rateLimit = require('express-rate-limit');
const { createMarketplaceAuth } = require('../lib/marketplace-wallet-auth');
const webhooks = require('../lib/webhooks');

const webhookReadLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { code: 'WEBHOOK_RATE_LIMIT', error: 'Too many webhook read requests' },
});

const webhookMutationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { code: 'WEBHOOK_RATE_LIMIT', error: 'Too many webhook mutation requests' },
});

function errorStatus(message) {
  if (/not found/i.test(message)) return 404;
  if (/already registered/i.test(message)) return 409;
  return 400;
}

function registerWebhookRoutes(app, { getDb, closeDb = false, service = webhooks } = {}) {
  if (typeof getDb !== 'function') throw new TypeError('getDb is required');
  const authorize = createMarketplaceAuth({ getDb, closeDb, actorProperty: 'webhookActorId' });
  const auth = (action, resourceId) => authorize({ action, resourceId });

  app.get('/api/webhooks/events', webhookReadLimiter, auth('webhooks:list-events', (_req, actorId) => actorId), (req, res) => {
    res.json({ events: Object.values(service.EVENTS) });
  });

  app.get('/api/webhook/events', webhookReadLimiter, auth('webhooks:list-events', (_req, actorId) => actorId), (req, res) => {
    res.json({ events: Object.values(service.EVENTS) });
  });

  app.post('/api/webhooks', webhookMutationLimiter, auth('webhooks:create', (_req, actorId) => actorId), (req, res) => {
    const result = service.registerWebhook(req.body?.url, req.body?.events, {
      ownerId: req.webhookActorId,
      description: req.body?.description,
    });
    if (result.error) return res.status(errorStatus(result.error)).json({ code: 'WEBHOOK_REGISTRATION_FAILED', error: result.error });
    return res.status(201).json(result);
  });

  app.get('/api/webhooks', webhookReadLimiter, auth('webhooks:list', (_req, actorId) => actorId), (req, res) => {
    res.json({ webhooks: service.listWebhooks(false, req.webhookActorId) });
  });

  app.get('/api/webhooks/dead-letters', webhookReadLimiter, auth('webhooks:dead-letters', (_req, actorId) => actorId), (req, res) => {
    const owned = new Set(service.listWebhooks(false, req.webhookActorId).map((webhook) => webhook.id));
    res.json({ deadLetters: service.getDeadLetters(null, 100).filter((entry) => owned.has(entry.webhookId)) });
  });

  app.delete('/api/webhooks/dead-letters', webhookMutationLimiter, auth('webhooks:clear-dead-letters', (_req, actorId) => actorId), (req, res) => {
    for (const webhook of service.listWebhooks(false, req.webhookActorId)) service.clearDeadLetters(webhook.id);
    res.json({ cleared: true });
  });

  app.get('/api/webhooks/:id', webhookReadLimiter, auth('webhooks:get', (req) => req.params.id), (req, res) => {
    const webhook = service.getWebhook(req.params.id, false, req.webhookActorId);
    if (!webhook) return res.status(404).json({ code: 'WEBHOOK_NOT_FOUND', error: 'Webhook not found' });
    return res.json({ webhook });
  });

  app.patch('/api/webhooks/:id', webhookMutationLimiter, auth('webhooks:update', (req) => req.params.id), (req, res) => {
    const result = service.updateWebhook(req.params.id, req.body || {}, req.webhookActorId);
    if (result.error) return res.status(errorStatus(result.error)).json({ code: 'WEBHOOK_UPDATE_FAILED', error: result.error });
    const { secret: _secret, ...safeWebhook } = result.webhook;
    return res.json({ webhook: { ...safeWebhook, secret: `${result.webhook.secret.slice(0, 12)}...` } });
  });

  app.delete('/api/webhooks/:id', webhookMutationLimiter, auth('webhooks:delete', (req) => req.params.id), (req, res) => {
    const result = service.deleteWebhook(req.params.id, req.webhookActorId);
    if (result.error) return res.status(404).json({ code: 'WEBHOOK_NOT_FOUND', error: result.error });
    return res.json(result);
  });

  app.get('/api/webhooks/:id/logs', webhookReadLimiter, auth('webhooks:logs', (req) => req.params.id), (req, res) => {
    const logs = service.getWebhookLogs(req.params.id, Math.min(Number(req.query.limit) || 20, 100), req.webhookActorId);
    if (!logs) return res.status(404).json({ code: 'WEBHOOK_NOT_FOUND', error: 'Webhook not found' });
    return res.json({ logs });
  });

  app.post('/api/webhooks/:id/test', webhookMutationLimiter, auth('webhooks:test', (req) => req.params.id), async (req, res) => {
    const result = await service.testWebhook(req.params.id, req.webhookActorId);
    if (result.error) return res.status(404).json({ code: 'WEBHOOK_NOT_FOUND', error: result.error });
    const statusCode = Number(result.result?.statusCode) || 0;
    const success = statusCode >= 200 && statusCode < 300;
    return res.status(success ? 200 : 502).json({ statusCode });
  });
}

module.exports = { registerWebhookRoutes };
