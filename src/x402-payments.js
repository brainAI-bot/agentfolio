/**
 * x402 Payment Layer for AgentFolio
 * Integrates x402 protocol for paid API endpoints
 * 
 * Free tier: /api/health, /api/profiles
 * Paid tier: /api/profile/:id/score — $0.01/call
 * Premium tier: /api/leaderboard/scores — $0.05/call
 */

const { paymentMiddleware, x402ResourceServer } = require('@x402/express');
const { HTTPFacilitatorClient } = require('@x402/core/server');
const { ExactSvmScheme } = require('@x402/svm/exact/server');

// Receiving wallet (Solana network)
const PAY_TO_ADDRESS = process.env.X402_PAY_TO || '7A19fhRDYEp6mmAW1VSM4ENENBa37ZpvjogidhxKT7bQ';

// Facilitator — testnet for now, switch to mainnet facilitator when ready
const FACILITATOR_URL = process.env.X402_FACILITATOR_URL || 'https://x402.org/facilitator';

// Network: Solana Devnet for testing, Solana Mainnet = solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp
const NETWORK = process.env.X402_NETWORK || 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1';

function setupX402(app) {
  console.log(`[x402] Initializing payment layer...`);
  console.log(`[x402] Pay-to: ${PAY_TO_ADDRESS}`);
  console.log(`[x402] Network: ${NETWORK}`);
  console.log(`[x402] Facilitator: ${FACILITATOR_URL}`);

  const facilitatorClient = new HTTPFacilitatorClient({
    url: FACILITATOR_URL
  });

  const resourceServer = new x402ResourceServer(facilitatorClient);
  resourceServer.register(NETWORK, new ExactSvmScheme());

  const middleware = paymentMiddleware(
    {
      "GET /api/profile/*/score": {
        accepts: [
          {
            scheme: "exact",
            price: "$0.01",
            network: NETWORK,
            payTo: PAY_TO_ADDRESS,
          },
        ],
        description: "Agent reputation score — detailed scoring breakdown",
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

  // x402 info endpoint (free) — shows pricing info
  app.get('/api/x402/info', (req, res) => {
    res.json({
      protocol: 'x402',
      version: '1.0',
      network: NETWORK,
      facilitator: FACILITATOR_URL,
      payTo: PAY_TO_ADDRESS,
      endpoints: {
        free: [
          { path: '/api/health', description: 'Health check' },
          { path: '/api/profiles', description: 'Profile listing' },
          { path: '/api/x402/info', description: 'Payment info (this endpoint)' },
        ],
        paid: [
          { path: '/api/profile/:id/score', price: '$0.01', description: 'Agent reputation score' },
        ],
        premium: [
          { path: '/api/leaderboard/scores', price: '$0.05', description: 'Full leaderboard with scores' },
        ],
      },
      howToPay: 'Send request with x402 payment header. See https://docs.x402.org for client SDK.',
    });
  });

  console.log(`[x402] ✓ Payment layer active`);
  console.log(`[x402] Free: /api/health, /api/profiles, /api/x402/info`);
  console.log(`[x402] Paid ($0.01): /api/profile/:id/score`);
  console.log(`[x402] Premium ($0.05): /api/leaderboard/scores`);
}

module.exports = { setupX402 };
