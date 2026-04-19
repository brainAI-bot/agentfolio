/**
 * Hardened Verification Demo Server
 * Demonstrates cryptographic proof-based verification working
 */

const http = require('http');
const url = require('url');

// Import the hardened verification modules
const { initiateGitHubVerification, verifyGitHubGist } = require('./src/lib/github-verify');
const { initiateXVerification, verifyXTweet } = require('./src/lib/x-verify');
const { initiateAgentMailVerification, verifyAgentMailCode } = require('./src/lib/agentmail-verify');
const { initiateSolanaVerification, verifySolanaSignature } = require('./src/lib/solana-verify');

const PORT = 8080;

const server = http.createServer((req, res) => {
  const urlParsed = url.parse(req.url, true);
  const pathname = urlParsed.pathname;
  
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }
  
  // Health check
  if (pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
      status: 'ok', 
      message: 'Hardened verification demo server running',
      timestamp: new Date().toISOString()
    }));
    return;
  }
  
  // GitHub verification initiate
  if (pathname === '/verify/github/initiate' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { profileId, username } = JSON.parse(body || '{}');
        console.log(`GitHub verification initiated for ${username}`);
        
        const result = await initiateGitHubVerification(profileId, username);
        const status = result.success ? 200 : 400;
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (e) {
        console.error('GitHub initiate error:', e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }
  
  // GitHub verification confirm
  if (pathname === '/verify/github/confirm' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { challengeId, gistUrl } = JSON.parse(body || '{}');
        console.log(`GitHub verification confirmation for challenge ${challengeId}`);
        
        const result = await verifyGitHubGist(challengeId, gistUrl);
        const status = result.verified ? 200 : 400;
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (e) {
        console.error('GitHub confirm error:', e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }
  
  // API documentation
  if (pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
<!DOCTYPE html>
<html>
<head>
  <title>Hardened Verification Demo</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 800px; margin: 50px auto; padding: 20px; }
    .endpoint { background: #f5f5f5; padding: 15px; margin: 10px 0; border-radius: 5px; }
    .method { color: #0066cc; font-weight: bold; }
    code { background: #eee; padding: 2px 4px; border-radius: 3px; }
    .status { background: #d4edda; border: 1px solid #c3e6cb; color: #155724; padding: 10px; border-radius: 5px; margin: 20px 0; }
  </style>
</head>
<body>
  <h1>🔒 Hardened Verification Demo Server</h1>
  <div class=status>
    <strong>Status:</strong> All cryptographic verification modules loaded and ready for testing.
  </div>
  
  <h2>Available Endpoints</h2>
  
  <div class=endpoint>
    <div class=method>GET /health</div>
    <p>Health check endpoint</p>
  </div>
  
  <div class=endpoint>
    <div class=method>POST /verify/github/initiate</div>
    <p>Start GitHub verification with gist challenge</p>
    <code>{profileId: test123, username: octocat}</code>
  </div>
  
  <div class=endpoint>
    <div class=method>POST /verify/github/confirm</div>
    <p>Complete GitHub verification with gist proof</p>
    <code>{challengeId: abc123, gistUrl: https://gist.github.com/...}</code>
  </div>
  
  <h2>Implementation Notes</h2>
  <ul>
    <li><strong>Cryptographic Proof:</strong> All verifications require challenge-response</li>
    <li><strong>30min Expiry:</strong> Challenges auto-expire for security</li>
    <li><strong>No Write-to-DB:</strong> Claims must be proven, not just submitted</li>
    <li><strong>Modular Design:</strong> Clean integration into main AgentFolio server</li>
  </ul>
  
  <p><em>Demo server running on port ${PORT} - Ready for integration testing</em></p>
</body>
</html>
    `);
    return;
  }
  
  // 404 for unknown routes
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => {
  console.log(`🔒 Hardened Verification Demo Server listening on port ${PORT}`);
  console.log(`📖 Documentation: http://localhost:${PORT}`);
  console.log(`❤️  Health check: http://localhost:${PORT}/health`);
});
