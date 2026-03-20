/**
 * AgentFolio Wallet Integration
 * Handles Solana wallet connection, signature verification, and on-chain identity
 */

const fs = require('fs');
const path = require('path');
const nacl = require('tweetnacl');
const bs58 = require('bs58');

// Profile data directory
const PROFILES_DIR = path.join(__dirname, '../../data/profiles');

// SATP Program IDs (mainnet)
const SATP_PROGRAMS = {
  identity: '97yL33fcu6iWT2TdERS5HeqrMSGiUnxuy6nUcTrKieSq',
  reputation: 'TQ4P9R2Y5FRyw1TZfwoWQ2Mf6XeohbGdhYNcDxh6YYh',
  validation: 'AdDWFa9oEmZdrTrhu8YTWu4ozbTP7e6qa9rvyqfAvM7N',
  escrow: 'STyY8w4ZHws3X1AMoocWuDYBoogVDwvymPy8Wifx5TH'
};

const TREASURY_WALLET = 'FriU1FEpWbdgVrTcS49YV5mVv2oqN6poaVQjzq2BS5be';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const RPC_ENDPOINT = process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com';

/**
 * Update wallet address for a profile (in both DB and JSON)
 */
function updateProfileWallet(profileId, walletAddress, walletType = 'solana') {
  const db = require('./database');
  const profile = db.loadProfile(profileId);
  
  if (!profile) {
    return { error: 'Profile not found' };
  }
  
  if (!profile.wallets) profile.wallets = {};
  profile.wallets[walletType] = walletAddress;
  profile.updatedAt = new Date().toISOString();
  
  db.saveProfile(profile);
  
  // Clear cache
  try {
    const { caches } = require('./cache');
    caches.profiles.del(`profile:${profileId}`);
    caches.profiles.del('profiles:all');
  } catch (e) {}
  
  return { success: true, walletAddress, walletType };
}

/**
 * Get wallet address for a profile
 */
function getProfileWallet(profileId, walletType = 'solana') {
  const db = require('./database');
  const profile = db.loadProfile(profileId);
  return profile?.wallets?.[walletType] || null;
}

/**
 * Verify Ed25519 wallet signature
 */
function verifyWalletSignature(walletAddress, message, signature) {
  try {
    const publicKey = bs58.decode(walletAddress);
    const signatureBytes = bs58.decode(signature);
    const messageBytes = new TextEncoder().encode(message);
    return nacl.sign.detached.verify(messageBytes, signatureBytes, publicKey);
  } catch (e) {
    console.error('Signature verification error:', e.message);
    return false;
  }
}

/**
 * Generate a challenge message for wallet signing
 */
function generateSignMessage(walletAddress) {
  const nonce = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  return {
    message: `AgentFolio Identity Verification\n\nWallet: ${walletAddress}\nNonce: ${nonce}\nTimestamp: ${new Date().toISOString()}\n\nSign this message to verify wallet ownership and create your AgentFolio profile.`,
    nonce
  };
}

/**
 * Validate Solana address format
 */
function isValidSolanaAddress(address) {
  if (!address || typeof address !== 'string') return false;
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
}

/**
 * Format wallet address for display
 */
function formatWalletAddress(address, chars = 4) {
  if (!address || address.length < chars * 2 + 3) return address;
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}

/**
 * Check on-chain identity registration via SATP Identity program
 */
async function checkOnChainIdentity(walletAddress) {
  try {
    const { SATPSDK } = require('../../satp-client/src');
    const sdk = new SATPSDK({ rpcUrl: RPC_ENDPOINT });
    
    const identity = await sdk.getIdentity(walletAddress);
    const reputation = await sdk.getReputation(walletAddress);
    const pdas = sdk.getPDAs(walletAddress);
    
    return {
      registered: identity !== null && !identity.error,
      identity: identity,
      reputation: reputation,
      pdas: pdas,
      pda: pdas.identity
    };
  } catch (e) {
    console.error('On-chain identity check error:', e.message);
    return { registered: false, error: e.message };
  }
}

/**
 * Get SOL balance for a wallet
 */
async function getWalletBalance(walletAddress) {
  try {
    const { Connection, PublicKey } = require('@solana/web3.js');
    const connection = new Connection(RPC_ENDPOINT, 'confirmed');
    const balance = await connection.getBalance(new PublicKey(walletAddress));
    return balance / 1e9; // Convert lamports to SOL
  } catch (e) {
    return 0;
  }
}

/**
 * Build identity registration transaction (unsigned, for client to sign)
 */
async function buildIdentityRegistrationTx(walletAddress, profileId, { name, description, twitter, website } = {}) {
  try {
    const { Connection, PublicKey, SystemProgram, Transaction, TransactionInstruction, ComputeBudgetProgram } = require('@solana/web3.js');
    const crypto = require('crypto');
    
    // SATP V2 Identity Registry (WORKING program)
    const SATP_V2_PROGRAM = new PublicKey('97yL33fcu6iWT2TdERS5HeqrMSGiUnxuy6nUcTrKieSq');
    const conn = new Connection(RPC_ENDPOINT, 'confirmed');
    const wallet = new PublicKey(walletAddress);
    
    // Derive PDA: ["identity", wallet_pubkey]
    const [identityPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('identity'), wallet.toBuffer()],
      SATP_V2_PROGRAM
    );
    
    // Check if already exists
    const existing = await conn.getAccountInfo(identityPDA);
    if (existing && existing.data.length > 0) {
      return { success: true, alreadyExists: true, agentPDA: identityPDA.toBase58() };
    }
    
    // Anchor discriminator for create_identity
    const disc = crypto.createHash('sha256').update('global:create_identity').digest().slice(0, 8);
    
    // Borsh encode helpers
    const encStr = (s) => { const b = Buffer.from(s, 'utf8'); const l = Buffer.alloc(4); l.writeUInt32LE(b.length); return Buffer.concat([l, b]); };
    const encVec = (arr) => { const c = Buffer.alloc(4); c.writeUInt32LE(arr.length); return Buffer.concat([c, ...arr.map(encStr)]); };
    
    const agentName = (name || profileId || 'agent').slice(0, 32);
    const agentDesc = (description || 'AgentFolio verified agent').slice(0, 256);
    const category = 'general';
    const capabilities = [];
    const metadataUri = ('https://agentfolio.bot/profile/' + (profileId || '')).slice(0, 200);
    
    const data = Buffer.concat([disc, encStr(agentName), encStr(agentDesc), encStr(category), encVec(capabilities), encStr(metadataUri)]);
    
    const ix = new TransactionInstruction({
      programId: SATP_V2_PROGRAM,
      keys: [
        { pubkey: identityPDA, isSigner: false, isWritable: true },
        { pubkey: wallet, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });
    
    const tx = new Transaction();
    tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50000 }));
    tx.add(ix);
    tx.feePayer = wallet;
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.lastValidBlockHeight = lastValidBlockHeight;
    
    return {
      success: true,
      transaction: Buffer.from(tx.serialize({ requireAllSignatures: false })).toString('base64'),
      agentPDA: identityPDA.toBase58()
    };
  } catch (e) {
    console.error('Build registration tx error:', e.message);
    return { success: false, error: e.message };
  }
}

/**
 * Generate frontend wallet connection script (CDN-based wallet adapter)
 */
function getWalletConnectScript() {
  return `
<script>
// AgentFolio Wallet Connect
window.AgentFolioWallet = {
  connected: false,
  address: null,
  provider: null,
  
  isInstalled() {
    return !!(window.phantom?.solana || window.solflare);
  },
  
  getProvider() {
    if (window.phantom?.solana?.isPhantom) {
      return { type: 'phantom', provider: window.phantom.solana };
    }
    if (window.solflare?.isSolflare) {
      return { type: 'solflare', provider: window.solflare };
    }
    return null;
  },
  
  async connect() {
    const providerInfo = this.getProvider();
    if (!providerInfo) {
      throw new Error('No Solana wallet found. Install Phantom or Solflare.');
    }
    
    const { provider, type } = providerInfo;
    const response = await provider.connect();
    
    this.connected = true;
    this.address = response.publicKey.toString();
    this.provider = provider;
    this.providerType = type;
    
    window.dispatchEvent(new CustomEvent('wallet-connected', { 
      detail: { address: this.address, type }
    }));
    
    return this.address;
  },
  
  async disconnect() {
    if (this.provider) {
      try { await this.provider.disconnect(); } catch (e) {}
    }
    this.connected = false;
    this.address = null;
    this.provider = null;
    window.dispatchEvent(new CustomEvent('wallet-disconnected'));
  },
  
  async signMessage(message) {
    if (!this.provider) throw new Error('Wallet not connected');
    const encodedMessage = new TextEncoder().encode(message);
    const { signature } = await this.provider.signMessage(encodedMessage, 'utf8');
    // Convert Uint8Array to base58
    const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    let bytes = Array.from(signature);
    let result = '';
    while (bytes.some(b => b)) {
      let remainder = 0;
      let newBytes = [];
      for (let b of bytes) {
        let acc = remainder * 256 + b;
        let digit = Math.floor(acc / 58);
        remainder = acc % 58;
        if (newBytes.length || digit) newBytes.push(digit);
      }
      result = ALPHABET[remainder] + result;
      bytes = newBytes;
    }
    for (let b of Array.from(signature)) {
      if (b === 0) result = '1' + result; else break;
    }
    return result || '1';
  },
  
  async signTransaction(base64Tx) {
    if (!this.provider) throw new Error('Wallet not connected');
    // Decode base64 to Uint8Array and sign
    const txBytes = Uint8Array.from(atob(base64Tx), c => c.charCodeAt(0));
    const signed = await this.provider.signTransaction({ serialize: () => txBytes, deserialize: (b) => b });
    return signed;
  },
  
  formatAddress(address, chars = 4) {
    address = address || this.address;
    if (!address) return '';
    return address.slice(0, chars) + '...' + address.slice(-chars);
  }
};

// Auto-detect wallet on load
(function() {
  const providerInfo = window.AgentFolioWallet.getProvider();
  if (providerInfo) {
    const { provider } = providerInfo;
    provider.on?.('connect', (pk) => {
      window.AgentFolioWallet.connected = true;
      window.AgentFolioWallet.address = pk.toString();
      window.AgentFolioWallet.provider = provider;
      window.dispatchEvent(new CustomEvent('wallet-connected', { detail: { address: pk.toString() } }));
    });
    provider.on?.('disconnect', () => {
      window.AgentFolioWallet.connected = false;
      window.AgentFolioWallet.address = null;
      window.dispatchEvent(new CustomEvent('wallet-disconnected'));
    });
  }
})();
</script>`;
}

/**
 * Generate wallet connect button HTML
 */
function getWalletConnectButton(options = {}) {
  const { profileId, showBalance = false, compact = false } = options;
  
  if (compact) {
    return `
<button class="wallet-nav-btn" id="wallet-nav-btn" onclick="window.location='/connect'">
  <span style="background:linear-gradient(135deg,#9945FF,#14F195);-webkit-background-clip:text;-webkit-text-fill-color:transparent;font-weight:700;">⚡ Connect</span>
</button>`;
  }
  
  return `
<div class="wallet-connect-wrapper" id="wallet-wrapper" data-profile="${profileId || ''}">
  <button class="wallet-connect-btn" id="wallet-connect-btn" onclick="connectWallet()">
    <span class="wallet-icon">🔗</span>
    <span class="wallet-text">Connect Wallet</span>
  </button>
  <div class="wallet-connected" id="wallet-connected" style="display:none;">
    <span class="wallet-address" id="wallet-address"></span>
    <button class="wallet-disconnect-btn" onclick="disconnectWallet()">×</button>
  </div>
</div>

<style>
.wallet-connect-btn {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 20px; background: linear-gradient(135deg, #9945FF, #14F195);
  border: none; border-radius: 12px; color: white; font-weight: 600; font-size: 14px;
  cursor: pointer; transition: all 0.2s;
}
.wallet-connect-btn:hover { transform: translateY(-2px); box-shadow: 0 8px 20px rgba(153, 69, 255, 0.3); }
.wallet-connected { display: flex; align-items: center; gap: 8px; padding: 8px 16px; background: #18181b; border: 1px solid #27272a; border-radius: 12px; }
.wallet-address { font-family: monospace; color: #a78bfa; font-size: 14px; }
.wallet-disconnect-btn { background: none; border: none; color: #71717a; cursor: pointer; padding: 4px 8px; font-size: 16px; }
.wallet-disconnect-btn:hover { color: #ef4444; }
.wallet-nav-btn { background: none; border: 1px solid rgba(153,69,255,0.3); border-radius: 8px; padding: 6px 14px; cursor: pointer; transition: all 0.2s; }
.wallet-nav-btn:hover { border-color: rgba(153,69,255,0.6); background: rgba(153,69,255,0.05); }
</style>

<script>
async function connectWallet() {
  try {
    if (!window.AgentFolioWallet.isInstalled()) {
      window.open('https://phantom.app/', '_blank');
      return;
    }
    const address = await window.AgentFolioWallet.connect();
    document.getElementById('wallet-connect-btn').style.display = 'none';
    document.getElementById('wallet-connected').style.display = 'flex';
    document.getElementById('wallet-address').textContent = window.AgentFolioWallet.formatAddress(address);
    
    const profileId = document.getElementById('wallet-wrapper').dataset.profile;
    if (profileId) {
      await fetch('/api/wallet/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId, walletAddress: address, walletType: 'solana' })
      });
    }
  } catch (err) {
    alert('Failed to connect wallet: ' + err.message);
  }
}

async function disconnectWallet() {
  await window.AgentFolioWallet.disconnect();
  document.getElementById('wallet-connect-btn').style.display = 'flex';
  document.getElementById('wallet-connected').style.display = 'none';
}

window.addEventListener('wallet-connected', (e) => {
  const btn = document.getElementById('wallet-connect-btn');
  const connected = document.getElementById('wallet-connected');
  const addr = document.getElementById('wallet-address');
  if (btn) btn.style.display = 'none';
  if (connected) connected.style.display = 'flex';
  if (addr) addr.textContent = window.AgentFolioWallet.formatAddress(e.detail.address);
});
</script>`;
}

module.exports = {
  updateProfileWallet,
  getProfileWallet,
  verifyWalletSignature,
  generateSignMessage,
  isValidSolanaAddress,
  formatWalletAddress,
  getWalletConnectScript,
  getWalletConnectButton,
  checkOnChainIdentity,
  getWalletBalance,
  buildIdentityRegistrationTx,
  SATP_PROGRAMS,
  TREASURY_WALLET,
  USDC_MINT,
  RPC_ENDPOINT
};
