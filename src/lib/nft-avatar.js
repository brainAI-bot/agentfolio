/**
 * NFT Avatar System for AgentFolio
 * 
 * Universal avatar standard for AI agents:
 * - Link any NFT (Solana, ETH, Base) as verified on-chain face
 * - Verify wallet ownership + NFT ownership on-chain
 * - Resolve agent avatar via API
 * - Default: Bored Robots collection for agents without NFTs
 */

const https = require('https');
const { loadProfile, saveProfile } = require('./profile');

const SOLANA_RPC = 'api.mainnet-beta.solana.com';
const HELIUS_API_KEY = process.env.SOLANA_RPC_URL ? new URL(process.env.SOLANA_RPC_URL).searchParams.get('api-key') : null;
const HELIUS_RPC = HELIUS_API_KEY ? 'mainnet.helius-rpc.com' : 'api.mainnet-beta.solana.com';
const HELIUS_PATH = HELIUS_API_KEY ? ('/?api-key=' + HELIUS_API_KEY) : '/';

// EVM public RPCs (no API key needed)
const EVM_RPCS = {
  ethereum: 'https://eth.llamarpc.com',
  base: 'https://mainnet.base.org',
};

/**
 * EVM JSON-RPC eth_call helper
 */
function evmRpcCall(chain, to, data) {
  const url = EVM_RPCS[chain];
  if (!url) return Promise.reject(new Error('Unsupported EVM chain: ' + chain));
  
  const body = JSON.stringify({
    jsonrpc: '2.0', id: 1, method: 'eth_call',
    params: [{ to, data }, 'latest']
  });

  const parsed = new (require('url').URL)(url);
  const mod = parsed.protocol === 'https:' ? https : require('http');

  return new Promise((resolve, reject) => {
    const req = mod.request({
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(d);
          if (json.error) reject(new Error(json.error.message));
          else resolve(json.result);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * Encode ERC-721 ownerOf(uint256 tokenId) call
 */
function encodeOwnerOf(tokenId) {
  const id = BigInt(tokenId).toString(16).padStart(64, '0');
  return '0x6352211e' + id;
}

/**
 * Encode ERC-721 tokenURI(uint256 tokenId) call
 */
function encodeTokenURI(tokenId) {
  const id = BigInt(tokenId).toString(16).padStart(64, '0');
  return '0xc87b56dd' + id;
}

/**
 * Verify EVM NFT ownership via ownerOf (ERC-721)
 */
async function verifyEvmNFTOwnership(chain, walletAddress, contractAddress, tokenId) {
  try {
    const result = await evmRpcCall(chain, contractAddress, encodeOwnerOf(tokenId));
    if (!result || result === '0x') return false;
    const owner = '0x' + result.slice(-40).toLowerCase();
    return owner === walletAddress.toLowerCase();
  } catch (e) {
    console.warn('[NFT Avatar] EVM ownerOf failed:', e.message);
    return false;
  }
}

/**
 * Fetch EVM NFT metadata via tokenURI (ERC-721)
 */
async function getEvmNFTMetadata(chain, contractAddress, tokenId) {
  try {
    const result = await evmRpcCall(chain, contractAddress, encodeTokenURI(tokenId));
    if (!result || result === '0x') return null;
    const hex = result.slice(2);
    const len = parseInt(hex.slice(64, 128), 16);
    const strHex = hex.slice(128, 128 + len * 2);
    let uri = Buffer.from(strHex, 'hex').toString('utf8');
    
    if (uri.startsWith('data:application/json;base64,')) {
      const json = JSON.parse(Buffer.from(uri.split(',')[1], 'base64').toString());
      return { name: json.name || null, image: json.image || null };
    }
    
    if (uri.startsWith('ipfs://')) {
      uri = 'https://ipfs.io/ipfs/' + uri.slice(7);
    }
    
    return new Promise((resolve) => {
      const mod = uri.startsWith('https') ? https : require('http');
      mod.get(uri, { timeout: 5000 }, (res) => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => {
          try {
            const json = JSON.parse(d);
            let img = json.image || json.image_url || null;
            if (img && img.startsWith('ipfs://')) img = 'https://ipfs.io/ipfs/' + img.slice(7);
            resolve({ name: json.name || null, image: img });
          } catch { resolve(null); }
        });
      }).on('error', () => resolve(null));
    });
  } catch (e) {
    console.warn('[NFT Avatar] tokenURI failed:', e.message);
    return null;
  }
}

/**
 * List EVM NFTs — requires contract:tokenId (no free enumeration without indexer)
 */
async function getEvmNFTs(chain, walletAddress) {
  return [];
}


// Supported chains for NFT avatars
const SUPPORTED_CHAINS = ['solana', 'ethereum', 'base'];

/**
 * Solana RPC call helper
 */
function solanaRpc(method, params) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
    const options = {
      hostname: SOLANA_RPC,
      port: 443,
      path: '/',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) reject(new Error(json.error.message));
          else resolve(json.result);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

/**
 * Fetch NFTs owned by a Solana wallet
 * Uses getAssetsByOwner (DAS API) if available, falls back to token accounts
 */
async function getSolanaNFTs(walletAddress) {
  try {
    // Try DAS API (Helius/Triton) for rich NFT metadata
    const result = await new Promise((resolve, reject) => {
      const postData = JSON.stringify({
        jsonrpc: '2.0', id: 1,
        method: 'getAssetsByOwner',
        params: { ownerAddress: walletAddress, page: 1, limit: 50 }
      });
      const options = {
        hostname: HELIUS_RPC,
        port: 443, path: HELIUS_PATH, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
      };
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
        });
      });
      req.on('error', reject);
      req.write(postData);
      req.end();
    });

    if (result.result && result.result.items) {
      return result.result.items
        .filter(item => item.interface === 'V1_NFT' || item.interface === 'ProgrammableNFT')
        .map(item => ({
          mint: item.id,
          name: item.content?.metadata?.name || 'Unknown',
          image: item.content?.links?.image || item.content?.files?.[0]?.uri || null,
          collection: item.grouping?.find(g => g.group_key === 'collection')?.group_value || null,
          chain: 'solana'
        }));
    }
  } catch (e) {
    console.warn('[NFT Avatar] DAS API failed, falling back to token accounts:', e.message);
  }

  // Fallback: use getTokenAccountsByOwner for NFTs (amount=1, decimals=0)
  try {
    // Query both Token v1 and Token-2022 programs
    const [accounts, accounts2022] = await Promise.all([
      solanaRpc('getTokenAccountsByOwner', [
        walletAddress,
        { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' },
        { encoding: 'jsonParsed' }
      ]),
      solanaRpc('getTokenAccountsByOwner', [
        walletAddress,
        { programId: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb' },
        { encoding: 'jsonParsed' }
      ]).catch(() => ({ value: [] }))
    ]);

    const allAccounts = [...(accounts?.value || []), ...(accounts2022?.value || [])];
    if (allAccounts.length > 0) {
      return allAccounts
        .filter(acc => {
          const info = acc.account.data.parsed.info;
          return info.tokenAmount.decimals === 0 && parseInt(info.tokenAmount.amount) >= 1;
        })
        .map(acc => ({
          mint: acc.account.data.parsed.info.mint,
          name: null, // Need metadata fetch
          image: null,
          collection: null,
          chain: 'solana'
        }));
    }
  } catch (e) {
    console.warn('[NFT Avatar] Fallback also failed:', e.message);
  }

  return [];
}

/**
 * Verify that a wallet owns a specific NFT
 */
async function verifyNFTOwnership(chain, walletAddress, nftIdentifier) {
  if (chain === 'solana') {
    const nfts = await getSolanaNFTs(walletAddress);
    return nfts.some(nft => nft.mint === nftIdentifier);
  }

  if (chain === 'ethereum' || chain === 'base') {
    try {
      const [contractAddress, tokenId] = nftIdentifier.split(':');
      if (!contractAddress || !tokenId) return false;
      return await verifyEvmNFTOwnership(chain, walletAddress, contractAddress, tokenId);
    } catch (e) {
      console.warn('[NFT Avatar] EVM verify failed:', e.message);
      return false;
    }
  }

  return false;
}

/**
 * Set an NFT as agent's avatar
 * Verifies ownership on-chain before setting
 */
async function setNFTAvatar(profileId, { chain, walletAddress, nftIdentifier, nftName, nftImage }) {
  if (!SUPPORTED_CHAINS.includes(chain)) {
    return { success: false, error: `Unsupported chain: ${chain}. Supported: ${SUPPORTED_CHAINS.join(', ')}` };
  }

  // Verify the wallet is linked to this profile
  const profile = loadProfile(profileId);
  if (!profile) return { success: false, error: 'Profile not found' };

  // Check wallet is verified on this profile
  const hasWallet = profile.verifications?.some(v =>
    (v.type === 'solana' || v.type === 'ethereum' || v.type === 'base') &&
    v.address?.toLowerCase() === walletAddress.toLowerCase() &&
    v.verified
  );

  if (!hasWallet) {
    return { success: false, error: 'Wallet not verified on this profile. Verify your wallet first.' };
  }

  // Verify NFT ownership on-chain
  const owns = await verifyNFTOwnership(chain, walletAddress, nftIdentifier);
  if (!owns) {
    return { success: false, error: 'NFT ownership could not be verified on-chain' };
  }

  // Set the avatar
  profile.nftAvatar = {
    chain,
    wallet: walletAddress,
    identifier: nftIdentifier,
    name: nftName || null,
    image: nftImage || null,
    verifiedAt: new Date().toISOString(),
    verifiedOnChain: true
  };

  saveProfile(profile);

  return { success: true, avatar: profile.nftAvatar };
}

/**
 * Get agent's verified NFT avatar
 */
function getNFTAvatar(profileId) {
  const profile = loadProfile(profileId);
  if (!profile || !profile.nftAvatar) return null;
  return profile.nftAvatar;
}

/**
 * Remove NFT avatar
 */
function removeNFTAvatar(profileId) {
  const p = loadProfile(profileId);
  if (p && p.nftAvatar && p.nftAvatar.permanent) return { success: false, error: "Avatar is permanently locked" };
  const profile = loadProfile(profileId);
  if (!profile) return { success: false, error: 'Profile not found' };
  delete profile.nftAvatar;
  saveProfile(profile);
  return { success: true };
}

/**
 * List available NFTs in a wallet for avatar selection
 */
async function listWalletNFTs(chain, walletAddress) {
  if (chain === 'solana') {
    return await getSolanaNFTs(walletAddress);
  }
  if (chain === 'ethereum' || chain === 'base') {
    return await getEvmNFTs(chain, walletAddress);
  }
  return [];
}

module.exports = {
  verifyEvmNFTOwnership,
  getEvmNFTMetadata,
  setNFTAvatar,
  getNFTAvatar,
  removeNFTAvatar,
  listWalletNFTs,
  verifyNFTOwnership,
  SUPPORTED_CHAINS
};
