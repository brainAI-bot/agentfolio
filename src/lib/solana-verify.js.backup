/**
 * Solana Wallet Verification
 * Checks balance and on-chain activity (transaction history)
 */

const https = require('https');

const SOLANA_RPC = 'api.mainnet-beta.solana.com';

function rpcCall(method, params) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method,
      params
    });

    const options = {
      hostname: SOLANA_RPC,
      path: '/',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': postData.length
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          if (result.error) {
            resolve({ error: result.error.message });
          } else {
            resolve(result.result);
          }
        } catch (e) {
          resolve({ error: e.message });
        }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function verifySolanaWallet(address) {
  console.log(`\n🔍 Verifying Solana: ${address}`);
  
  try {
    // Validate address format (base58, 32-44 chars)
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
      return { verified: false, error: 'Invalid Solana address format' };
    }

    // Get balance
    const balanceResult = await rpcCall('getBalance', [address]);
    if (balanceResult.error) {
      return { verified: false, error: balanceResult.error };
    }
    
    const balanceLamports = balanceResult.value || 0;
    const balanceSOL = balanceLamports / 1e9;

    // Get recent transaction signatures (up to 10)
    const signaturesResult = await rpcCall('getSignaturesForAddress', [
      address,
      { limit: 10 }
    ]);
    
    const signatures = Array.isArray(signaturesResult) ? signaturesResult : [];
    const txCount = signatures.length;
    
    // Get account info to check if it's a token account or program
    const accountInfo = await rpcCall('getAccountInfo', [
      address,
      { encoding: 'base58' }
    ]);
    
    const isProgram = accountInfo?.value?.executable || false;
    const hasData = accountInfo?.value?.data && accountInfo.value.data[0] !== '';
    
    // Calculate activity score
    let activityScore = 0;
    
    // Balance scoring (up to 30 points)
    if (balanceSOL >= 100) activityScore += 30;
    else if (balanceSOL >= 10) activityScore += 25;
    else if (balanceSOL >= 1) activityScore += 20;
    else if (balanceSOL >= 0.1) activityScore += 15;
    else if (balanceSOL > 0) activityScore += 10;
    
    // Transaction activity scoring (up to 40 points)
    if (txCount >= 10) activityScore += 40;
    else if (txCount >= 5) activityScore += 30;
    else if (txCount >= 2) activityScore += 20;
    else if (txCount >= 1) activityScore += 10;
    
    // Account type bonus (up to 20 points)
    if (isProgram) activityScore += 20; // Deployed program = highly active
    else if (hasData) activityScore += 10; // Has account data
    
    // Recency bonus (up to 10 points)
    if (signatures.length > 0) {
      const latestTx = signatures[0];
      const txTime = latestTx.blockTime ? latestTx.blockTime * 1000 : 0;
      const daysSinceLastTx = (Date.now() - txTime) / (1000 * 60 * 60 * 24);
      
      if (daysSinceLastTx <= 7) activityScore += 10;
      else if (daysSinceLastTx <= 30) activityScore += 7;
      else if (daysSinceLastTx <= 90) activityScore += 4;
    }

    // Determine verification tier
    const verified = balanceLamports > 0 || txCount > 0;
    const verificationScore = Math.min(100, activityScore);
    
    let tier = 'unverified';
    if (verificationScore >= 70) tier = 'active_trader';
    else if (verificationScore >= 50) tier = 'verified_holder';
    else if (verificationScore >= 30) tier = 'basic_verified';
    else if (verified) tier = 'minimal_activity';

    const result = {
      verified,
      address,
      balanceSOL: balanceSOL.toFixed(4),
      transactionCount: txCount,
      isProgram,
      hasTokenAccounts: hasData,
      recentTxSignatures: signatures.slice(0, 3).map(s => s.signature.slice(0, 16) + '...'),
      lastActivityTime: signatures[0]?.blockTime ? new Date(signatures[0].blockTime * 1000).toISOString() : null,
      tier,
      verificationScore
    };

    console.log(`  ✓ Balance: ${result.balanceSOL} SOL`);
    console.log(`  ✓ Transactions: ${txCount} recent`);
    console.log(`  ✓ Last activity: ${result.lastActivityTime || 'Unknown'}`);
    console.log(`  ✓ Tier: ${tier}`);
    console.log(`  ✓ Score: ${verificationScore}%`);

    return result;
  } catch (e) {
    console.error(`  ✗ Error: ${e.message}`);
    return { verified: false, error: e.message };
  }
}

// Get token accounts for an address
async function getSolanaTokenAccounts(address) {
  try {
    const result = await rpcCall('getTokenAccountsByOwner', [
      address,
      { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' },
      { encoding: 'jsonParsed' }
    ]);
    
    if (result.error) {
      return { error: result.error };
    }
    
    const accounts = result.value || [];
    return {
      count: accounts.length,
      tokens: accounts.slice(0, 10).map(acc => ({
        mint: acc.account.data.parsed.info.mint,
        amount: acc.account.data.parsed.info.tokenAmount.uiAmountString,
        decimals: acc.account.data.parsed.info.tokenAmount.decimals
      }))
    };
  } catch (e) {
    return { error: e.message };
  }
}

module.exports = {
  verifySolanaWallet,
  getSolanaTokenAccounts
};
