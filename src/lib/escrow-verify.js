/**
 * Escrow Deposit Verification
 * Watches for USDC transfers to escrow wallet, verifies on-chain, auto-confirms.
 */

const { Connection, PublicKey } = require('@solana/web3.js');
const { getAssociatedTokenAddressSync, getAccount } = require('@solana/spl-token');

const RPC = process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com';
const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

/**
 * Verify a USDC deposit TX to the escrow wallet
 * @param {string} txSignature - The transaction signature
 * @param {string} escrowWallet - Expected recipient wallet
 * @param {number} expectedAmount - Expected USDC amount (human readable, e.g. 5.0)
 * @returns {object} { verified, amount, sender, error }
 */
async function verifyDeposit(txSignature, escrowWallet, expectedAmount) {
  const connection = new Connection(RPC, 'confirmed');
  
  try {
    const tx = await connection.getTransaction(txSignature, { 
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0 
    });
    
    if (!tx) return { verified: false, error: 'Transaction not found' };
    if (tx.meta.err) return { verified: false, error: 'Transaction failed on-chain' };
    
    // Check token balance changes
    const preBalances = tx.meta.preTokenBalances || [];
    const postBalances = tx.meta.postTokenBalances || [];
    
    // Find USDC transfer to escrow wallet
    let depositAmount = 0;
    let sender = null;
    
    for (const post of postBalances) {
      if (post.mint === USDC_MINT.toBase58() && post.owner === escrowWallet) {
        const pre = preBalances.find(p => p.accountIndex === post.accountIndex);
        const preAmount = pre ? parseFloat(pre.uiTokenAmount.uiAmountString || '0') : 0;
        const postAmount = parseFloat(post.uiTokenAmount.uiAmountString || '0');
        depositAmount = postAmount - preAmount;
      }
      // Find sender (token balance decreased)
      if (post.mint === USDC_MINT.toBase58() && post.owner !== escrowWallet) {
        const pre = preBalances.find(p => p.accountIndex === post.accountIndex);
        if (pre) {
          const preAmt = parseFloat(pre.uiTokenAmount.uiAmountString || '0');
          const postAmt = parseFloat(post.uiTokenAmount.uiAmountString || '0');
          if (postAmt < preAmt) sender = post.owner;
        }
      }
    }
    
    if (depositAmount <= 0) return { verified: false, error: 'No USDC deposit found in transaction' };
    if (depositAmount < expectedAmount) return { verified: false, error: `Deposit ${depositAmount} USDC < expected ${expectedAmount} USDC` };
    
    return { verified: true, amount: depositAmount, sender, txSignature };
  } catch (e) {
    return { verified: false, error: e.message };
  }
}

/**
 * Get current USDC balance of escrow wallet
 */
async function getEscrowBalance(escrowWallet) {
  const connection = new Connection(RPC, 'confirmed');
  try {
    const wallet = new PublicKey(escrowWallet);
    const ata = getAssociatedTokenAddressSync(USDC_MINT, wallet);
    const account = await getAccount(connection, ata);
    return Number(account.amount) / 1e6; // USDC has 6 decimals
  } catch (e) {
    return 0;
  }
}

/**
 * Check if escrow has enough unlocked USDC for a new job
 * @param {string} escrowWallet
 * @param {number} requiredAmount
 * @param {number} totalLocked - sum of all other active job escrows
 */
async function checkAvailableBalance(escrowWallet, requiredAmount, totalLocked) {
  const balance = await getEscrowBalance(escrowWallet);
  const available = balance - totalLocked;
  return {
    balance,
    totalLocked,
    available,
    sufficient: available >= requiredAmount
  };
}

module.exports = { verifyDeposit, getEscrowBalance, checkAvailableBalance };
