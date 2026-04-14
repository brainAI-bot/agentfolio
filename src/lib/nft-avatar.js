/**
 * NFT Avatar System for AgentFolio
 * 
 * Universal avatar standard for AI agents:
 * - Link any NFT (Solana, ETH, Base) as verified on-chain face
 * - Verify wallet ownership + NFT ownership on-chain
 * - Resolve agent avatar via API
 * - Default: Burned-Out Agents collection for agents without NFTs
 */

const https = require('https');
const { getDb } = require('../profile-store');

function parseJson(value, fallback = null) {
  if (value == null || value === '') return fallback;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch (_) { return fallback; }
}

function loadProfileRow(profileId) {
  const db = getDb();
  return db.prepare('SELECT * FROM profiles WHERE id = ?').get(profileId) || null;
}

const SOLANA_RPC = 'api.mainnet-beta.solana.com';
const DEFAULT_HELIUS_API_KEY = null;
let HELIUS_API_KEY = process.env.HELIUS_API_KEY || null;
if (!HELIUS_API_KEY && process.env.SOLANA_RPC_URL) {
  try {
    HELIUS_API_KEY = new URL(process.env.SOLANA_RPC_URL).searchParams.get('api-key') || null;
  } catch (_) {}
}
HELIUS_API_KEY = HELIUS_API_KEY || DEFAULT_HELIUS_API_KEY || null;
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
        params: {
          ownerAddress: walletAddress,
          page: 1,
          limit: 50,
          displayOptions: { showFungible: false, showNativeBalance: false }
        }
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
        .filter(item => {
          const iface = String(item.interface || '');
          if (iface === 'FungibleToken' || iface === 'FungibleAsset') return false;
          return iface === 'V1_NFT' || iface === 'ProgrammableNFT' || iface === 'MplCoreAsset';
        })
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

  const profile = loadProfileRow(profileId);
  if (!profile) return { success: false, error: 'Profile not found' };

  const vd = parseJson(profile.verification_data, {});
  const wallets = parseJson(profile.wallets, {});
  const normalWallet = String(walletAddress || '').toLowerCase();
  const hasWallet =
    (vd.solana?.address?.toLowerCase() === normalWallet && vd.solana?.verified) ||
    (vd.eth?.address?.toLowerCase() === normalWallet && vd.eth?.verified) ||
    (vd.ethereum?.address?.toLowerCase() === normalWallet && vd.ethereum?.verified) ||
    (wallets.solana?.toLowerCase() === normalWallet) ||
    (wallets.ethereum?.toLowerCase() === normalWallet) ||
    (String(profile.wallet || '').toLowerCase() === normalWallet);

  if (!hasWallet) {
    return { success: false, error: 'Wallet not verified on this profile. Verify your wallet first.' };
  }

  const owns = await verifyNFTOwnership(chain, walletAddress, nftIdentifier);
  if (!owns) {
    return { success: false, error: 'NFT ownership could not be verified on-chain' };
  }

  const avatar = {
    chain,
    wallet: walletAddress,
    identifier: nftIdentifier,
    name: nftName || null,
    image: nftImage || null,
    verifiedAt: new Date().toISOString(),
    verifiedOnChain: true
  };

  getDb().prepare('UPDATE profiles SET nft_avatar = ?, updated_at = ? WHERE id = ?').run(
    JSON.stringify(avatar),
    new Date().toISOString(),
    profileId
  );

  return { success: true, avatar };
}

/**
 * Get agent's verified NFT avatar
 */
function getNFTAvatar(profileId) {
  const profile = loadProfileRow(profileId);
  if (!profile) return null;
  const avatar = parseJson(profile.nft_avatar, null);
  return avatar && typeof avatar === 'object' ? avatar : null;
}

/**
 * Remove NFT avatar
 */
function removeNFTAvatar(profileId) {
  const avatar = getNFTAvatar(profileId);
  if (avatar && avatar.permanent) return { success: false, error: "Avatar is permanently locked" };
  const profile = loadProfileRow(profileId);
  if (!profile) return { success: false, error: 'Profile not found' };
  getDb().prepare('UPDATE profiles SET nft_avatar = NULL, updated_at = ? WHERE id = ?').run(
    new Date().toISOString(),
    profileId
  );
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
