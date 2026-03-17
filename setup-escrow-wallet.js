const { Keypair, Connection } = require('@solana/web3.js');
const fs = require('fs');
const path = require('path');

// Generate new keypair for escrow wallet
const escrowKeypair = Keypair.generate();

// Save keypair to secure location
const walletData = {
  publicKey: escrowKeypair.publicKey.toBase58(),
  secretKey: Array.from(escrowKeypair.secretKey),
  created: new Date().toISOString(),
  purpose: 'AgentFolio Escrow Wallet'
};

const walletPath = path.join(__dirname, 'data', 'escrow-wallet.json');
fs.writeFileSync(walletPath, JSON.stringify(walletData, null, 2));

console.log('✅ Escrow wallet created!');
console.log('Address:', escrowKeypair.publicKey.toBase58());
console.log('Saved to:', walletPath);
