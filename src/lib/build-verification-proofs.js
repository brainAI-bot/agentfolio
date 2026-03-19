/**
 * Build independently-verifiable proof objects from verificationData
 * 
 * For each verified platform, extracts the evidence a 3rd party would need
 * to independently verify the claim. Strips sensitive data (nonces, codes, secrets).
 */

// Map of platform → proof extraction logic
const PROOF_EXTRACTORS = {
  github: (data) => ({
    platform: 'github',
    type: 'github_bio_or_gist',
    username: data.address || data.username,
    gistUrl: data.proof?.gistUrl || data.gistUrl || null,
    challengeHash: data.proof?.challengeHash || null,
    verified_at: data.verifiedAt,
    how_to_verify: 'Check GitHub profile bio or gist for AgentFolio challenge string',
  }),

  x: (data) => ({
    platform: 'x',
    type: 'x_bio_verification',
    handle: data.address || data.handle || data.username,
    tweetUrl: data.proof?.tweetUrl || null,
    challengeString: data.proof?.challengeString || null,
    verified_at: data.verifiedAt,
    how_to_verify: 'Check X profile bio for AgentFolio profile ID or challenge string',
  }),

  twitter: (data) => ({
    platform: 'twitter',
    type: 'x_bio_verification',
    handle: data.address || data.handle || data.username,
    verified_at: data.verifiedAt,
    how_to_verify: 'Check X/Twitter profile bio for AgentFolio profile ID',
  }),

  solana: (data) => ({
    platform: 'solana',
    type: 'wallet_signature',
    address: data.address || data.wallet,
    signedMessage: data.proof?.signedMessage || null,
    signature: data.proof?.signature || null,
    verified_at: data.verifiedAt,
    how_to_verify: 'Verify ed25519 signature of the signed message against the Solana public key',
  }),

  ethereum: (data) => ({
    platform: 'ethereum',
    type: 'eip191_signature',
    address: data.address,
    signedMessage: data.proof?.signedMessage || data.proof?.message || null,
    signature: data.proof?.signature || null,
    verified_at: data.verifiedAt,
    how_to_verify: 'Recover address from EIP-191 signature and compare to claimed address',
  }),

  hyperliquid: (data) => ({
    platform: 'hyperliquid',
    type: data.method === 'hardened_signature' ? 'wallet_signature_then_activity' : 'activity_check',
    address: data.address,
    signedMessage: data.proof?.signedMessage || null,
    signature: data.proof?.signature || null,
    method: data.method || 'activity_check',
    accountValue: data.accountValue || null,
    verified_at: data.verifiedAt,
    how_to_verify: data.method === 'hardened_signature'
      ? 'Verify EIP-191 signature, then check Hyperliquid API for trading activity'
      : 'Check Hyperliquid API for trading activity at this address',
  }),

  polymarket: (data) => ({
    platform: 'polymarket',
    type: data.proof?.method === 'signature-then-activity' ? 'wallet_signature_then_activity' : 'activity_check',
    address: data.address,
    method: data.proof?.method || data.method || 'activity_check',
    signatureVerified: data.proof?.signatureVerified || false,
    verified_at: data.verifiedAt || data.proof?.verifiedAt,
    how_to_verify: 'Verify wallet signature and check Polymarket data API for trading activity',
  }),

  agentmail: (data) => ({
    platform: 'agentmail',
    type: 'email_verification',
    email: data.email || data.proof?.email,
    verified_at: data.verifiedAt || data.proof?.verifiedAt,
    how_to_verify: 'AgentFolio sent a verification code to this email address and confirmed receipt',
  }),

  domain: (data) => ({
    platform: 'domain',
    type: 'dns_txt_or_well_known',
    domain: data.domain,
    method: data.method || 'well_known',
    verified_at: data.verifiedAt,
    how_to_verify: data.method === 'dns_txt'
      ? 'Check DNS TXT record for _agentfolio.DOMAIN'
      : 'Check https://DOMAIN/.well-known/agentfolio.json for agent verification',
  }),

  website: (data) => ({
    platform: 'website',
    type: 'well_known_file',
    url: data.url,
    verified_at: data.verifiedAt,
    how_to_verify: 'Check the website for .well-known/agentfolio-verification.txt containing the challenge token',
  }),

  moltbook: (data) => ({
    platform: 'moltbook',
    type: 'bio_verification',
    username: data.username,
    karma: data.karma || null,
    verified_at: data.verifiedAt,
    how_to_verify: 'Check Moltbook profile bio for AgentFolio verification string',
  }),

  satp: (data) => ({
    platform: 'satp',
    type: 'on_chain_identity',
    identityPDA: data.identityPDA || null,
    wallet: data.wallet,
    network: data.network || 'mainnet',
    verified_at: data.verifiedAt || data.registeredAt,
    how_to_verify: 'Query the SATP Identity Registry on Solana for this agent\'s PDA',
  }),

  discord: (data) => ({
    platform: 'discord',
    type: 'oauth_or_manual',
    userId: data.id || data.address,
    verified_at: data.verifiedAt,
    how_to_verify: 'Discord user ID was verified via OAuth flow or manual confirmation',
  }),

  telegram: (data) => ({
    platform: 'telegram',
    type: 'bot_verification',
    username: data.address || data.username,
    verified_at: data.verifiedAt,
    how_to_verify: 'Telegram username verified via AgentFolio Telegram bot interaction',
  }),

  mcp: (data) => ({
    platform: 'mcp',
    type: 'endpoint_validation',
    endpoint: data.address || data.endpoint,
    verified_at: data.verifiedAt,
    how_to_verify: 'MCP endpoint was queried and responded with valid Agent Card',
  }),

  a2a: (data) => ({
    platform: 'a2a',
    type: 'agent_card_validation',
    endpoint: data.address || data.endpoint,
    verified_at: data.verifiedAt,
    how_to_verify: 'A2A Agent Card endpoint was queried and returned valid response',
  }),
};

/**
 * Build verificationProofs from a profile's verificationData
 * Returns an object keyed by platform name with proof details
 */
function buildVerificationProofs(verificationData) {
  if (!verificationData) return {};

  const proofs = {};
  
  for (const [platform, data] of Object.entries(verificationData)) {
    if (!data || (!data.verified && !data.success)) continue;
    if (platform.startsWith('test_')) continue;
    if (platform === 'onboardingDismissed') continue;

    const extractor = PROOF_EXTRACTORS[platform];
    if (extractor) {
      try {
        proofs[platform] = extractor(data);
      } catch (e) {
        proofs[platform] = {
          platform,
          type: 'legacy_verification',
          verified_at: data.verifiedAt || null,
          note: 'Proof data not stored for this verification',
        };
      }
    } else {
      // Unknown platform — return basic info
      proofs[platform] = {
        platform,
        type: 'legacy_verification',
        identifier: data.address || data.username || data.email || null,
        verified_at: data.verifiedAt || null,
        note: 'Detailed proof data not available for this platform',
      };
    }
  }

  return proofs;
}

module.exports = { buildVerificationProofs };
