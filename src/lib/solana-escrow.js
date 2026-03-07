/**
 * Solana USDC Escrow - On-chain fund management
 */
const { Connection, PublicKey, Keypair, Transaction } = require('@solana/web3.js');
const { getAssociatedTokenAddress, createTransferInstruction, getAccount, createAssociatedTokenAccountInstruction, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } = require('@solana/spl-token');
const fs = require('fs');
const path = require('path');

const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const USDC_DECIMALS = 6;
const RPC_URL = 'https://api.mainnet-beta.solana.com';

// Load escrow wallet keypair
function getEscrowKeypair() {
  const walletPath = path.join(__dirname, '../../data/escrow-wallet.json');
  const data = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
  return Keypair.fromSecretKey(Uint8Array.from(data.secretKey));
}

// Load client wallet (brainKID) keypair
function getClientKeypair() {
  const bip39 = require('bip39');
  const { derivePath } = require('ed25519-hd-key');
  const seedPhrase = fs.readFileSync('/home/ubuntu/clawd/brainKID/.solana-seed', 'utf8').trim();
  const seed = bip39.mnemonicToSeedSync(seedPhrase);
  const derivedSeed = derivePath("m/44'/501'/0'/0'", seed.toString('hex')).key;
  return Keypair.fromSeed(derivedSeed);
}

async function getConnection() {
  return new Connection(RPC_URL, 'confirmed');
}

async function getUSDCBalance(walletPubkey) {
  const connection = await getConnection();
  try {
    const ata = await getAssociatedTokenAddress(USDC_MINT, walletPubkey);
    const account = await getAccount(connection, ata);
    return Number(account.amount) / Math.pow(10, USDC_DECIMALS);
  } catch (e) {
    return 0;
  }
}

/**
 * Deposit USDC from client wallet to escrow wallet
 */
async function depositToEscrow(amountUSDC) {
  const connection = await getConnection();
  const clientKeypair = getClientKeypair();
  const escrowKeypair = getEscrowKeypair();
  
  const amountRaw = Math.floor(amountUSDC * Math.pow(10, USDC_DECIMALS));
  
  // Get ATAs
  const clientATA = await getAssociatedTokenAddress(USDC_MINT, clientKeypair.publicKey);
  const escrowATA = await getAssociatedTokenAddress(USDC_MINT, escrowKeypair.publicKey);
  
  // Check client balance
  const clientBalance = await getUSDCBalance(clientKeypair.publicKey);
  if (clientBalance < amountUSDC) {
    throw new Error(`Insufficient USDC balance. Have: ${clientBalance}, Need: ${amountUSDC}`);
  }
  
  const tx = new Transaction();
  
  // Create escrow ATA if needed
  try {
    await getAccount(connection, escrowATA);
  } catch (e) {
    tx.add(createAssociatedTokenAccountInstruction(
      clientKeypair.publicKey,
      escrowATA,
      escrowKeypair.publicKey,
      USDC_MINT
    ));
  }
  
  // Transfer USDC
  tx.add(createTransferInstruction(
    clientATA,
    escrowATA,
    clientKeypair.publicKey,
    amountRaw
  ));
  
  const sig = await connection.sendTransaction(tx, [clientKeypair]);
  await connection.confirmTransaction(sig, 'confirmed');
  
  return {
    success: true,
    signature: sig,
    amount: amountUSDC,
    from: clientKeypair.publicKey.toBase58(),
    to: escrowKeypair.publicKey.toBase58()
  };
}

/**
 * Release USDC from escrow to agent wallet
 */
async function releaseFromEscrow(agentWalletAddress, amountUSDC) {
  const connection = await getConnection();
  const escrowKeypair = getEscrowKeypair();
  const agentPubkey = new PublicKey(agentWalletAddress);
  
  const amountRaw = Math.floor(amountUSDC * Math.pow(10, USDC_DECIMALS));
  
  // Get ATAs
  const escrowATA = await getAssociatedTokenAddress(USDC_MINT, escrowKeypair.publicKey);
  const agentATA = await getAssociatedTokenAddress(USDC_MINT, agentPubkey);
  
  // Check escrow balance
  const escrowBalance = await getUSDCBalance(escrowKeypair.publicKey);
  if (escrowBalance < amountUSDC) {
    throw new Error(`Insufficient escrow balance. Have: ${escrowBalance}, Need: ${amountUSDC}`);
  }
  
  const tx = new Transaction();
  
  // Create agent ATA if needed
  try {
    await getAccount(connection, agentATA);
  } catch (e) {
    tx.add(createAssociatedTokenAccountInstruction(
      escrowKeypair.publicKey,
      agentATA,
      agentPubkey,
      USDC_MINT
    ));
  }
  
  // Transfer USDC
  tx.add(createTransferInstruction(
    escrowATA,
    agentATA,
    escrowKeypair.publicKey,
    amountRaw
  ));
  
  const sig = await connection.sendTransaction(tx, [escrowKeypair]);
  await connection.confirmTransaction(sig, 'confirmed');
  
  return {
    success: true,
    signature: sig,
    amount: amountUSDC,
    from: escrowKeypair.publicKey.toBase58(),
    to: agentWalletAddress
  };
}

/**
 * Get escrow wallet balance
 */
async function getEscrowBalance() {
  const escrowKeypair = getEscrowKeypair();
  return await getUSDCBalance(escrowKeypair.publicKey);
}

/**
 * Get client wallet balance
 */
async function getClientBalance() {
  const clientKeypair = getClientKeypair();
  return await getUSDCBalance(clientKeypair.publicKey);
}

/**
 * Verify a deposit transaction on-chain
 * Checks that txHash is a real confirmed tx sending >= expectedAmount USDC to escrow wallet
 */
async function verifyDeposit(txHash, expectedAmount) {
  const connection = await getConnection();
  const escrowKeypair = getEscrowKeypair();
  const escrowAddress = escrowKeypair.publicKey.toBase58();
  
  try {
    const tx = await connection.getParsedTransaction(txHash, { maxSupportedTransactionVersion: 0 });
    if (!tx) return { verified: false, reason: 'Transaction not found' };
    if (tx.meta?.err) return { verified: false, reason: 'Transaction failed on-chain' };
    
    // Check token transfers in the transaction
    const postBalances = tx.meta?.postTokenBalances || [];
    const preBalances = tx.meta?.preTokenBalances || [];
    
    // Find USDC transfer to escrow wallet
    let depositFound = false;
    let depositAmount = 0;
    
    // Method 1: Check inner instructions for SPL transfer
    const innerInstructions = tx.meta?.innerInstructions || [];
    const allInstructions = [
      ...(tx.transaction?.message?.instructions || []),
      ...innerInstructions.flatMap(i => i.instructions || [])
    ];
    
    for (const ix of allInstructions) {
      if (ix.parsed?.type === 'transfer' || ix.parsed?.type === 'transferChecked') {
        const info = ix.parsed?.info || {};
        // Check if destination is escrow's ATA
        if (info.destination && info.mint === USDC_MINT.toBase58()) {
          const amt = Number(info.amount || info.tokenAmount?.amount || 0) / Math.pow(10, USDC_DECIMALS);
          // Verify destination is escrow wallet's ATA
          const escrowATA = await getAssociatedTokenAddress(USDC_MINT, escrowKeypair.publicKey);
          if (info.destination === escrowATA.toBase58()) {
            depositAmount += amt;
            depositFound = true;
          }
        }
      }
    }
    
    // Method 2: Check post/pre balance changes as fallback
    if (!depositFound) {
      const escrowATA = (await getAssociatedTokenAddress(USDC_MINT, escrowKeypair.publicKey)).toBase58();
      const postBal = postBalances.find(b => b.owner === escrowAddress && b.mint === USDC_MINT.toBase58());
      const preBal = preBalances.find(b => b.owner === escrowAddress && b.mint === USDC_MINT.toBase58());
      if (postBal) {
        const post = Number(postBal.uiTokenAmount?.amount || 0) / Math.pow(10, USDC_DECIMALS);
        const pre = preBal ? Number(preBal.uiTokenAmount?.amount || 0) / Math.pow(10, USDC_DECIMALS) : 0;
        depositAmount = post - pre;
        if (depositAmount > 0) depositFound = true;
      }
    }
    
    if (!depositFound) return { verified: false, reason: 'No USDC transfer to escrow wallet found in transaction' };
    if (depositAmount < expectedAmount) return { verified: false, reason: `Deposit amount ${depositAmount} USDC is less than required ${expectedAmount} USDC` };
    
    return { verified: true, amount: depositAmount };
  } catch (e) {
    return { verified: false, reason: 'Verification error: ' + e.message };
  }
}

// Treasury wallet for platform fees (Hani's wallet)
const TREASURY_ADDRESS = 'FriU1FEpWbdgVrTcS49YV5mVv2oqN6poaVQjzq2BS5be';

/**
 * Release escrow with fee split - sends payout to agent, fee to treasury
 */
async function releaseWithFeeSplit(agentWalletAddress, totalAmount, feePct = 5) {
  const fee = Math.round(totalAmount * (feePct / 100) * 1e6) / 1e6;
  const agentPayout = Math.round((totalAmount - fee) * 1e6) / 1e6;
  
  console.log('Releasing escrow:');
  console.log('  Total:', totalAmount, 'USDC');
  console.log('  Fee (' + feePct + '%):', fee, 'USDC → Treasury');
  console.log('  Agent payout:', agentPayout, 'USDC');
  
  const agentResult = await releaseFromEscrow(agentWalletAddress, agentPayout);
  console.log('Agent TX:', agentResult.signature);
  
  await new Promise(r => setTimeout(r, 1000));
  
  const treasuryResult = await releaseFromEscrow(TREASURY_ADDRESS, fee);
  console.log('Treasury TX:', treasuryResult.signature);
  
  return {
    agentTx: agentResult.signature,
    treasuryTx: treasuryResult.signature,
    agentPayout,
    fee,
    agentWallet: agentWalletAddress,
    treasuryWallet: TREASURY_ADDRESS
  };
}

module.exports = {
  depositToEscrow,
  releaseFromEscrow,
  releaseWithFeeSplit,
  getEscrowBalance,
  getClientBalance,
  getUSDCBalance,
  verifyDeposit,
  USDC_MINT,
  TREASURY_ADDRESS,
  getEscrowKeypair,
  getClientKeypair
};
