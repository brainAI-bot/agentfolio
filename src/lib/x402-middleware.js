/**
 * x402 Payment Middleware for AgentFolio (raw Node HTTP)
 * 
 * Simple, direct implementation:
 * - No payment header → 402 Payment Required
 * - With payment header → verify via facilitator → serve resource
 */

const { x402HTTPResourceServer, HTTPFacilitatorClient } = require('@x402/core/server');

// Treasury wallet
const PAY_TO_ADDRESS = process.env.X402_PAY_TO || 'FriU1FEpWbdgVrTcS49YV5mVv2oqN6poaVQjzq2BS5be';
const FACILITATOR_URL = process.env.X402_FACILITATOR_URL || 'https://x402.org/facilitator';
const NETWORK = process.env.X402_NETWORK || 'base';

// Paid route configuration
const PAID_ROUTES = {
  'GET /api/profile/:id/trust-score': {
    price: '$0.01',
    description: 'Detailed SATP trust score with on-chain verification level and reputation breakdown',
  },
};

let _resourceServer = null;

function initX402() {
  if (_resourceServer) return _resourceServer;
  try {
    const facilitator = new HTTPFacilitatorClient({ url: FACILITATOR_URL });
    
    // Build route config for x402 resource server
    const routeConfig = {};
    for (const [route, config] of Object.entries(PAID_ROUTES)) {
      routeConfig[route] = {
        accepts: [{
          scheme: 'exact',
          price: config.price,
          network: NETWORK,
          payTo: PAY_TO_ADDRESS,
        }],
        description: config.description,
        mimeType: 'application/json',
      };
    }
    
    _resourceServer = new x402HTTPResourceServer(facilitator, routeConfig);

    // Register payment schemes
    try {
      const { ExactEvmScheme } = require('@x402/evm/exact/server');
      _resourceServer.registerPaywallProvider(NETWORK, new ExactEvmScheme());
      console.log(`[x402] EVM scheme registered for ${NETWORK}`);
    } catch (e) {
      console.warn(`[x402] EVM scheme not available: ${e.message}`);
    }

    console.log(`[x402] ✓ Payment middleware initialized`);
    console.log(`[x402] Pay-to: ${PAY_TO_ADDRESS}`);
    console.log(`[x402] Network: ${NETWORK}`);
    console.log(`[x402] Facilitator: ${FACILITATOR_URL}`);
    console.log(`[x402] Paid routes: ${Object.keys(PAID_ROUTES).join(', ')}`);
    return _resourceServer;
  } catch (e) {
    console.error(`[x402] Failed to initialize: ${e.message}`);
    return null;
  }
}

/**
 * x402 gate for raw HTTP handler.
 * Returns true if 402 was sent (request handled). 
 * Returns false if request should proceed normally (free or paid+verified).
 */
async function x402Gate(method, pathname, req, res) {
  // Normalize path for route matching
  const normalizedPath = pathname.replace(/\/api\/profile\/([^/]+)\//, '/api/profile/:id/');
  const routeKey = `${method} ${normalizedPath}`;

  // Not a paid route → pass through
  if (!PAID_ROUTES[routeKey]) return false;

  // Browser users get free access
  const accept = req.headers['accept'] || '';
  if (accept.includes('text/html') && !accept.includes('application/json')) return false;

  // API key holders get free access
  if (req.headers['x-api-key']) return false;

  const paymentHeader = req.headers['x-payment'] || req.headers['payment'] || req.headers['x-402-payment'];

  if (!paymentHeader) {
    // No payment → return 402 Payment Required
    const config = PAID_ROUTES[routeKey];
    const paymentRequired = {
      x402Version: 1,
      accepts: [{
        scheme: 'exact',
        network: NETWORK,
        maxAmountRequired: config.price.replace('$', ''),
        resource: pathname,
        description: config.description,
        mimeType: 'application/json',
        payTo: PAY_TO_ADDRESS,
        maxTimeoutSeconds: 300,
        outputSchema: null,
      }],
    };

    res.writeHead(402, {
      'Content-Type': 'application/json',
      'X-Payment-Required': JSON.stringify(paymentRequired),
    });
    res.end(JSON.stringify({
      error: 'Payment Required',
      protocol: 'x402',
      version: 1,
      price: config.price,
      network: NETWORK,
      payTo: PAY_TO_ADDRESS,
      description: config.description,
      how_to_pay: 'Include X-Payment header with signed USDC payment. See https://docs.x402.org',
      accepts: paymentRequired.accepts,
    }, null, 2));
    return true;
  }

  // Has payment header → verify via facilitator
  try {
    const server = initX402();
    if (!server) {
      // Fail open if x402 not available
      req._x402Paid = false;
      return false;
    }

    const result = await server.processHTTPRequest(req, normalizedPath);
    if (result && result.status === 200) {
      req._x402Paid = true;
      req._x402Settlement = result.settlement;
      return false; // Continue to serve resource
    }
    
    // Payment verification failed
    res.writeHead(402, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Payment verification failed', details: result }));
    return true;
  } catch (e) {
    console.error(`[x402] Payment verification error: ${e.message}`);
    // Fail open
    req._x402Paid = false;
    return false;
  }
}

function getX402Info() {
  return {
    protocol: 'x402',
    version: 1,
    network: NETWORK,
    facilitator: FACILITATOR_URL,
    payTo: PAY_TO_ADDRESS,
    endpoints: {
      paid: Object.entries(PAID_ROUTES).map(([route, config]) => ({
        route,
        price: config.price,
        description: config.description,
      })),
    },
    how_to_pay: 'Include X-Payment header with signed USDC payment. Use @x402/fetch or @x402/client SDK.',
    docs: 'https://docs.x402.org',
  };
}

module.exports = { x402Gate, getX402Info, initX402, PAID_ROUTES };
