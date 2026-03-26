/**
 * Additional handlers for self-serve burnToBecome (birth).
 * Agents with rotated authority sign client-side.
 */
const { buildBurnToBecomeForWallet, parseGenesisAuthority, getGenesisPDA } = require('./prepare-birth-endpoint');
const { Connection } = require('@solana/web3.js');

function handleBirthEndpoints(req, res, url) {
  const sendJson = (code, data) => {
    res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(data));
  };

  // POST /api/burn-to-become/prepare-birth — build unsigned burnToBecome TX
  if (url.pathname === '/api/burn-to-become/prepare-birth' && req.method === 'POST') {
    if (!req.body) {
      let bodyStr = '';
      req.on('data', chunk => bodyStr += chunk);
      req.on('end', () => {
        try { req.body = JSON.parse(bodyStr); } catch { req.body = {}; }
        handleBirthEndpoints(req, res, url);
      });
      return true;
    }

    (async () => {
      try {
        const { agentId, faceImage, faceMint, faceBurnTx } = req.body || {};
        if (!agentId || !faceImage || !faceMint || !faceBurnTx) {
          return sendJson(400, { error: 'agentId, faceImage, faceMint, faceBurnTx all required' });
        }
        const result = await buildBurnToBecomeForWallet(agentId, faceImage, faceMint, faceBurnTx);
        console.log('[Birth] Prepared burnToBecome for ' + agentId + ', authority: ' + result.authority);
        sendJson(200, result);
      } catch (e) {
        console.error('[Birth] prepare error:', e.message);
        sendJson(500, { error: e.message });
      }
    })();
    return true;
  }

  // POST /api/burn-to-become/submit-birth — submit signed burnToBecome TX
  if (url.pathname === '/api/burn-to-become/submit-birth' && req.method === 'POST') {
    if (!req.body) {
      let bodyStr = '';
      req.on('data', chunk => bodyStr += chunk);
      req.on('end', () => {
        try { req.body = JSON.parse(bodyStr); } catch { req.body = {}; }
        handleBirthEndpoints(req, res, url);
      });
      return true;
    }

    (async () => {
      try {
        const { signedTransaction } = req.body || {};
        if (!signedTransaction) return sendJson(400, { error: 'signedTransaction required (base64)' });
        
        const RPC = process.env.SOLANA_RPC_URL || 'https://mainnet.helius-rpc.com/?api-key=REDACTED_HELIUS_API_KEY';
        const conn = new Connection(RPC, 'confirmed');
        const txBuf = Buffer.from(signedTransaction, 'base64');
        const sig = await conn.sendRawTransaction(txBuf, { skipPreflight: false });
        await conn.confirmTransaction(sig, 'confirmed');
        
        console.log('[Birth] burnToBecome TX confirmed:', sig);
        sendJson(200, { success: true, signature: sig, solscan: 'https://solscan.io/tx/' + sig });
      } catch (e) {
        console.error('[Birth] submit error:', e.message);
        sendJson(500, { error: e.message });
      }
    })();
    return true;
  }

  return false;
}

module.exports = { handleBirthEndpoints };
