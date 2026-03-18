/**
 * Hardened Verification Routes
 * Cryptographic proof-based verification endpoints
 */

const { loadProfile, saveProfile } = require('./profile');
const { initiateGitHubVerification, verifyGitHubGist } = require('./github-verify-hardened');
const { initiateXVerification, verifyXTweet } = require('./x-verify-hardened');
const { initiateAgentMailVerification, verifyAgentMailCode } = require('./agentmail-verify-hardened');
const { initiateSolanaVerification, verifySolanaSignature } = require('./solana-verify-hardened');
const { initiateDiscordVerification, confirmDiscordVerification } = require('./discord-verify-hardened');
const { initiateEthVerification, verifyEthSignature } = require('./eth-verify-hardened');
const { initiateDomainVerification, verifyDomainOwnership } = require('./domain-verify-hardened');
const { getChallenge } = require('./verification-challenges');

/**
 * Handle hardened verification routes
function handleVerificationRoutes(url, req, res, DATA_DIR) {
 */
function handleVerificationRoutes(url, req, res, DATA_DIR) {
  // POST /api/verify/github/initiate
  if (url.pathname === '/api/verify/github/initiate' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { profileId, username } = JSON.parse(body || '{}');
        if (!profileId || !username) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'profileId and username required' }));
          return;
        }
        
        const result = await initiateGitHubVerification(profileId, username);
        const status = result.success ? 200 : 400;
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return true;
  }

  // POST /api/verify/github/confirm
  if (url.pathname === '/api/verify/github/confirm' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { challengeId, gistUrl } = JSON.parse(body || '{}');
        if (!challengeId || !gistUrl) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'challengeId and gistUrl required' }));
          return;
        }
        
        const result = await verifyGitHubGist(challengeId, gistUrl);
        
        if (result.verified) {
          const challenge = await getChallenge(challengeId);
          if (challenge) {
            const profile = loadProfile(challenge.challengeData.profileId, DATA_DIR);
            if (profile) {
              if (!profile.verificationData) profile.verificationData = {};
              profile.verificationData.github = result;
              saveProfile(profile);
            }
          }
        }
        
        const status = result.verified ? 200 : 400;
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return true;
  }

  // POST /api/verify/x/initiate
  if (url.pathname === '/api/verify/x/initiate' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const data = JSON.parse(body || '{}');
        const { profileId } = data;
        const username = data.username || data.handle; // accept both field names
        if (!profileId || !username) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'profileId and username/handle required' }));
          return;
        }
        
        const result = await initiateXVerification(profileId, username);
        const status = result.success ? 200 : 400;
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return true;
  }

  // POST /api/verify/x/confirm
  if (url.pathname === '/api/verify/x/confirm' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { challengeId, tweetUrl } = JSON.parse(body || '{}');
        if (!challengeId || !tweetUrl) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'challengeId and tweetUrl required' }));
          return;
        }
        
        const result = await verifyXTweet(challengeId, tweetUrl);
        
        if (result.verified) {
          const challenge = await getChallenge(challengeId);
          if (challenge) {
            const profile = loadProfile(challenge.challengeData.profileId, DATA_DIR);
            if (profile) {
              if (!profile.verificationData) profile.verificationData = {};
              profile.verificationData.x = result;
              saveProfile(profile);
            }
          }
        }
        
        const status = result.verified ? 200 : 400;
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return true;
  }

  // POST /api/verify/agentmail/initiate
  if (url.pathname === '/api/verify/agentmail/initiate' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { profileId, email } = JSON.parse(body || '{}');
        if (!profileId || !email) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'profileId and email required' }));
          return;
        }
        
        const result = await initiateAgentMailVerification(profileId, email);
        const status = result.success ? 200 : 400;
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return true;
  }

  // POST /api/verify/agentmail/confirm
  if (url.pathname === '/api/verify/agentmail/confirm' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { challengeId, code } = JSON.parse(body || '{}');
        if (!challengeId || !code) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'challengeId and code required' }));
          return;
        }
        
        const result = await verifyAgentMailCode(challengeId, code);
        
        if (result.verified) {
          const challenge = await getChallenge(challengeId);
          if (challenge) {
            const profile = loadProfile(challenge.challengeData.profileId, DATA_DIR);
            if (profile) {
              if (!profile.verificationData) profile.verificationData = {};
              profile.verificationData.agentmail = result;
              saveProfile(profile);
            }
          }
        }
        
        const status = result.verified ? 200 : 400;
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return true;
  }

  // POST /api/verify/solana/initiate
  if (url.pathname === '/api/verify/solana/initiate' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { profileId, walletAddress } = JSON.parse(body || '{}');
        if (!profileId || !walletAddress) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'profileId and walletAddress required' }));
          return;
        }
        
        const result = await initiateSolanaVerification(profileId, walletAddress);
        const status = result.success ? 200 : 400;
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return true;
  }

  // POST /api/verify/solana/confirm
  if (url.pathname === '/api/verify/solana/confirm' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { challengeId, signature } = JSON.parse(body || '{}');
        if (!challengeId || !signature) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'challengeId and signature required' }));
          return;
        }
        
        const result = await verifySolanaSignature(challengeId, signature);
        
        if (result.verified) {
          const challenge = await getChallenge(challengeId);
          if (challenge) {
            const profile = loadProfile(challenge.challengeData.profileId, DATA_DIR);
            if (profile) {
              if (!profile.verificationData) profile.verificationData = {};
              profile.verificationData.solana = result;
              saveProfile(profile);
            }
          }
        }
        
        const status = result.verified ? 200 : 400;
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return true;
  }


  // POST /api/verify/eth/initiate
  if (url.pathname === '/api/verify/eth/initiate' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { profileId, walletAddress } = JSON.parse(body || '{}');
        if (!profileId || !walletAddress) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'profileId and walletAddress required' }));
          return;
        }
        const result = await initiateEthVerification(profileId, walletAddress);
        res.writeHead(result.success ? 200 : 400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return true;
  }

  // POST /api/verify/eth/verify
  if (url.pathname === '/api/verify/eth/verify' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { challengeId, signature } = JSON.parse(body || '{}');
        if (!challengeId || !signature) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'challengeId and signature required' }));
          return;
        }
        const result = await verifyEthSignature(challengeId, signature);
        if (result.verified) {
          const challenge = await getChallenge(challengeId);
          if (challenge) {
            const profile = loadProfile(challenge.challengeData.profileId, DATA_DIR);
            if (profile) {
              if (!profile.verificationData) profile.verificationData = {};
              profile.verificationData.ethereum = result;
              saveProfile(profile);
            }
          }
        }
        res.writeHead(result.verified ? 200 : 400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return true;
  }

  // POST /api/verify/domain/initiate
  if (url.pathname === '/api/verify/domain/initiate' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { profileId, domain } = JSON.parse(body || '{}');
        if (!profileId || !domain) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'profileId and domain required' }));
          return;
        }
        const result = await initiateDomainVerification(profileId, domain);
        res.writeHead(result.success ? 200 : 400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return true;
  }

  // POST /api/verify/domain/verify
  if (url.pathname === '/api/verify/domain/verify' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { challengeId } = JSON.parse(body || '{}');
        if (!challengeId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'challengeId required' }));
          return;
        }
        const result = await verifyDomainOwnership(challengeId);
        if (result.verified) {
          const challenge = await getChallenge(challengeId);
          if (challenge) {
            const profile = loadProfile(challenge.challengeData.profileId, DATA_DIR);
            if (profile) {
              if (!profile.verificationData) profile.verificationData = {};
              profile.verificationData.domain = result;
              saveProfile(profile);
            }
          }
        }
        res.writeHead(result.verified ? 200 : 400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return true;
  }

  // POST /api/verify/telegram/initiate
  if (url.pathname === '/api/verify/telegram/initiate' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { profileId, username } = JSON.parse(body || '{}');
        if (!profileId || !username) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'profileId and username required' }));
          return;
        }
        // Telegram verification uses same challenge pattern
        const challenge = require('./verification-challenges');
        const ch = challenge.generateChallenge(profileId, 'telegram', username);
        const challengeId = await challenge.storeChallenge(ch);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          challengeId,
          username,
          message: 'Send a DM to @AgentFolioBot with your verification code',
          code: challengeId.slice(0, 8).toUpperCase(),
          expiresAt: ch.expiresAt,
        }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return true;
  }

  // POST /api/verify/telegram/verify
  if (url.pathname === '/api/verify/telegram/verify' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { challengeId } = JSON.parse(body || '{}');
        if (!challengeId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'challengeId required' }));
          return;
        }
        // For now, check if challenge was completed via bot
        const challenge = await getChallenge(challengeId);
        if (!challenge) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ verified: false, error: 'Challenge not found or expired' }));
          return;
        }
        if (challenge.status === 'completed') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ verified: true, username: challenge.challengeData.identifier, verifiedAt: new Date().toISOString() }));
        } else {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ verified: false, error: 'Verification not yet completed. Send code to Telegram bot.' }));
        }
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return true;
  }

  // POST /api/verify/discord/initiate
  if (url.pathname === '/api/verify/discord/initiate' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { profileId, username } = JSON.parse(body || '{}');
        if (!profileId || !username) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'profileId and username required' }));
          return;
        }
        
        const result = await initiateDiscordVerification(profileId, username);
        
        const status = result.success ? 200 : 400;
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return true;
  }

  // POST /api/verify/discord/confirm
  if (url.pathname === '/api/verify/discord/confirm' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { challengeId, discordUserId } = JSON.parse(body || '{}');
        if (!challengeId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'challengeId required' }));
          return;
        }
        
        const result = await confirmDiscordVerification(challengeId, discordUserId);
        
        if (result.verified) {
          const challenge = await getChallenge(challengeId);
          if (challenge) {
            const profile = loadProfile(challenge.challengeData.profileId, DATA_DIR);
            if (profile) {
              if (!profile.verificationData) profile.verificationData = {};
              profile.verificationData.discord = result;
              saveProfile(profile);
            }
          }
        }
        
        const status = result.verified ? 200 : 400;
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return true;
  }

  return false; // Route not handled
}

module.exports = { handleVerificationRoutes };
