'use strict';

const PAID_TRUST_X402_ROUTES = Object.freeze([
  Object.freeze({ method: 'GET', path: '/api/score', matcher: /^\/api\/score\/?$/i }),
  Object.freeze({ method: 'GET', path: '/api/profile/:id/trust-score', matcher: /^\/api\/profile\/[^/]+\/trust-score\/?$/i }),
  Object.freeze({ method: 'GET', path: '/api/leaderboard/scores', matcher: /^\/api\/leaderboard\/scores\/?$/i }),
]);

const ALLOWED_MODES = new Set(['enabled', 'drain', 'disabled']);
const AUTHORIZATION_HEADERS = Object.freeze([
  'payment-signature',
  'x-payment',
  'payment',
  'x-402-payment',
]);

function resolvePaidTrustX402Mode(value = process.env.PAID_TRUST_X402_MODE) {
  if (value == null || String(value).trim() === '') return 'enabled';
  const normalized = String(value).trim().toLowerCase();
  return ALLOWED_MODES.has(normalized) ? normalized : 'invalid';
}

function requestPath(req) {
  const raw = req.path || req.originalUrl || req.url || '';
  return String(raw).split('?')[0];
}

function paidTrustRouteForRequest(req) {
  const method = String(req.method || 'GET').toUpperCase();
  const pathname = requestPath(req);
  return PAID_TRUST_X402_ROUTES.find((route) => route.method === method && route.matcher.test(pathname)) || null;
}

function hasPaymentAuthorization(req) {
  const headers = req.headers || {};
  return AUTHORIZATION_HEADERS.some((name) => {
    const value = headers[name];
    return value != null && String(value).trim() !== '';
  });
}

function sendModeResponse(res, status, code, message) {
  return res.status(status).json({ error: code, code, message });
}

function paidTrustX402ModeGate(req, res, next) {
  if (!paidTrustRouteForRequest(req)) return next();

  const mode = resolvePaidTrustX402Mode();
  if (mode === 'enabled') return next();

  if (mode === 'drain') {
    // A supplied authorization is still verified by the existing x402 middleware.
    // This preserves idempotent receipt replay while suppressing every new challenge.
    if (hasPaymentAuthorization(req)) return next();
    return sendModeResponse(
      res,
      503,
      'PAID_TRUST_DRAINING',
      'Paid trust-score requests are draining; no new payment challenge is available.',
    );
  }

  if (mode === 'disabled') {
    return sendModeResponse(
      res,
      410,
      'PAID_TRUST_RETIRED',
      'Paid trust-score requests are retired.',
    );
  }

  return sendModeResponse(
    res,
    503,
    'PAID_TRUST_MODE_INVALID',
    'Paid trust-score requests are unavailable because the mode is invalid.',
  );
}

function paidTrustPricingEntries(entries, value = process.env.PAID_TRUST_X402_MODE) {
  return resolvePaidTrustX402Mode(value) === 'disabled' ? [] : entries;
}

module.exports = {
  ALLOWED_MODES,
  AUTHORIZATION_HEADERS,
  PAID_TRUST_X402_ROUTES,
  hasPaymentAuthorization,
  paidTrustPricingEntries,
  paidTrustRouteForRequest,
  paidTrustX402ModeGate,
  resolvePaidTrustX402Mode,
};
