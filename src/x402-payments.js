/**
 * x402 Payment Layer for AgentFolio
 * Integrates x402 protocol for paid API endpoints
 * 
 * Free tier: /api/health, /api/profiles, /api/profile/:id, /api/leaderboard
 * Paid trust-score contract: /api/score and /api/profile/:id/trust-score — $0.01/call
 * Premium tier: /api/leaderboard/scores — $0.05/call
 */

const { paymentMiddleware, x402ResourceServer } = require('@x402/express');
const { HTTPFacilitatorClient } = require('@x402/core/server');
const { ExactEvmScheme } = require('@x402/evm/exact/server');

// Receiving wallet. Keep these defaults aligned with src/server.js.
const PAY_TO_ADDRESS = process.env.X402_RECEIVE_ADDRESS || process.env.X402_PAY_TO || '0xEE13776767542F3a8d67d9fAd723fc43213052Bd';

const FACILITATOR_URL = process.env.X402_FACILITATOR || process.env.X402_FACILITATOR_URL || 'https://x402.org/facilitator';

// Base Sepolia testnet by default; switch to Base mainnet when the facilitator supports it.
const NETWORK = process.env.X402_NETWORK || 'eip155:84532';

function setupX402(app) {
  console.log(`[x402] Initializing payment layer...`);
  console.log(`[x402] Pay-to: ${PAY_TO_ADDRESS}`);
  console.log(`[x402] Network: ${NETWORK}`);
  console.log(`[x402] Facilitator: ${FACILITATOR_URL}`);

  const facilitatorClient = new HTTPFacilitatorClient({
    url: FACILITATOR_URL
  });

  const resourceServer = new x402ResourceServer(facilitatorClient);
  resourceServer.register('eip155:*', new ExactEvmScheme());

  const middleware = paymentMiddleware(
    {
      "GET /api/score": {
        accepts: [
          {
            scheme: "exact",
            price: "$0.01",
            network: NETWORK,
            payTo: PAY_TO_ADDRESS,
          },
        ],
        description: "Agent reputation score lookup (Level + breakdown). Pass ?id=<profileId>",
        mimeType: "application/json",
      },
      "GET /api/profile/[id]/trust-score": {
        accepts: [
          {
            scheme: "exact",
            price: "$0.01",
            network: NETWORK,
            payTo: PAY_TO_ADDRESS,
          },
        ],
        description: "Direct profile trust score lookup (Level + breakdown)",
        mimeType: "application/json",
      },
      "GET /api/leaderboard/scores": {
        accepts: [
          {
            scheme: "exact",
            price: "$0.05",
            network: NETWORK,
            payTo: PAY_TO_ADDRESS,
          },
        ],
        description: "Full agent leaderboard with reputation scores",
        mimeType: "application/json",
      },
    },
    resourceServer,
  );

  app.use(middleware);

  // x402 pricing endpoint (free) — shows pricing info
  app.get('/api/x402/pricing', (req, res) => {
    res.json({
      protocol: 'x402',
      network: NETWORK,
      currency: 'USDC',
      facilitator: FACILITATOR_URL,
      receivingAddress: PAY_TO_ADDRESS,
      endpoints: {
        free: [
          { path: '/api/health', method: 'GET', price: 'free', description: 'Health check' },
          { path: '/api/profiles', method: 'GET', price: 'free', description: 'Profile listing' },
          { path: '/api/profile/:id', method: 'GET', price: 'free', description: 'Public profile lookup' },
          { path: '/api/leaderboard', method: 'GET', price: 'free', description: 'Public ranked leaderboard' },
          { path: '/api/x402/pricing', method: 'GET', price: 'free', description: 'Payment pricing catalog' },
        ],
        paid: [
          { path: '/api/score?id=<profileId>', method: 'GET', price: '$0.01', description: 'Agent reputation score' },
          { path: '/api/profile/:id/trust-score', method: 'GET', price: '$0.01', description: 'Direct profile trust score alias' },
          { path: '/api/leaderboard/scores', method: 'GET', price: '$0.05', description: 'Full scored leaderboard' },
        ],
      },
      howToPay: 'Send request with x402 payment header. See https://docs.x402.org for client SDK.',
    });
  });

  console.log(`[x402] ✓ Payment layer active`);
  console.log(`[x402] Free: /api/health, /api/profiles, /api/profile/:id, /api/leaderboard, /api/x402/pricing`);
  console.log(`[x402] Paid ($0.01): /api/score?id=<profileId>, /api/profile/:id/trust-score`);
  console.log(`[x402] Premium ($0.05): /api/leaderboard/scores`);
}

module.exports = { setupX402 };
