const { Connection, PublicKey } = require('@solana/web3.js');
const RPC = 'https://mainnet.helius-rpc.com/?api-key=HELIUS_API_KEY_REDACTED';
const TOKEN_2022 = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');

// In-memory cache: { data, timestamp }
let agentCache = null;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// --- Borsh helpers ---
function readString(data, offset) {
  if (offset + 4 > data.length) return ['', offset];
  const len = data.readUInt32LE(offset);
  offset += 4;
  if (len === 0 || offset + len > data.length) return ['', offset];
  if (len > 1000) return ['', offset]; // safety
  return [data.subarray(offset, offset + len).toString('utf8'), offset + len];
}

function readVecString(data, offset) {
  if (offset + 4 > data.length) return [[], offset];
  const count = data.readUInt32LE(offset);
  offset += 4;
  if (count > 50) return [[], offset]; // safety
  const arr = [];
  for (let i = 0; i < count; i++) {
    const [s, newOff] = readString(data, offset);
    arr.push(s);
    offset = newOff;
  }
  return [arr, offset];
}

// --- NFT lookup ---
async function lookupNFT(conn, wallet) {
  try {
    const tokens = await conn.getParsedTokenAccountsByOwner(
      new PublicKey(wallet),
      { programId: TOKEN_2022 }
    );
    for (const ta of tokens.value) {
      const info = ta.account.data.parsed.info;
      if (info.tokenAmount?.uiAmount !== 1) continue;
      const mint = info.mint;
      const mintInfo = await conn.getParsedAccountInfo(new PublicKey(mint));
      const extensions = mintInfo.value?.data?.parsed?.info?.extensions || [];
      let isNonTransferable = false;
      let metaUri = null;
      for (const ext of extensions) {
        if (ext.extension === 'nonTransferable') isNonTransferable = true;
        if (ext.extension === 'tokenMetadata' && ext.state?.uri) metaUri = ext.state.uri;
      }
      if (!isNonTransferable || !metaUri) continue;
      try {
        const res = await fetch(metaUri, { signal: AbortSignal.timeout(5000) });
        const meta = await res.json();
        return { nftMint: mint, nftImage: meta.image || null, soulbound: true, nftName: meta.name || null };
      } catch { return { nftMint: mint, nftImage: null, soulbound: true }; }
    }
  } catch {}
  return null;
}

/**
 * Parse AgentIdentity from SATP v2 identity_registry (97yL33...)
 * 
 * Struct layout (Borsh):
 *   8   discriminator
 *   32  agent_id (Pubkey)
 *   4+N name (String)
 *   4+N description (String)
 *   4+N category (String)
 *   4+M capabilities (Vec<String>)
 *   4+N metadata_uri (String)
 *   8   reputation_score (u64) — divide by 10000 for 0-100
 *   1   verification_level (u8) — 0-5
 *   8   reputation_updated_at (i64)
 *   8   verification_updated_at (i64)
 *   32  authority (Pubkey)
 *   8   created_at (i64)
 *   8   updated_at (i64)
 *   1   bump (u8)
 */
async function getSatpAgents() {
  if (agentCache && (Date.now() - agentCache.timestamp < CACHE_TTL)) {
    return agentCache.data;
  }

  const conn = new Connection(RPC, 'confirmed');
  const PROGRAM = new PublicKey('97yL33fcu6iWT2TdERS5HeqrMSGiUnxuy6nUcTrKieSq');
  const accounts = await conn.getProgramAccounts(PROGRAM);

  const agents = [];
  for (const { pubkey, account } of accounts) {
    const data = Buffer.from(account.data);
    if (data.length < 80) continue;
    try {
      let o = 8; // skip discriminator
      const agentId = new PublicKey(data.subarray(o, o + 32)).toBase58();
      o += 32;

      const [name, o1] = readString(data, o);
      const [description, o2] = readString(data, o1);
      const [category, o3] = readString(data, o2);
      const [capabilities, o4] = readVecString(data, o3);
      const [metadataUri, o5] = readString(data, o4);

      if (!name || name.length === 0 || name.length > 100) continue;

      // Fixed-size fields after strings
      const remaining = data.length - o5;
      if (remaining < 74) continue; // need at least 8+1+8+8+32+8+8+1 = 74 bytes

      const reputationScore = Number(data.readBigUInt64LE(o5));
      const verificationLevel = data.readUInt8(o5 + 8);
      const reputationUpdatedAt = Number(data.readBigInt64LE(o5 + 9));
      const verificationUpdatedAt = Number(data.readBigInt64LE(o5 + 17));
      const authority = new PublicKey(data.subarray(o5 + 25, o5 + 57)).toBase58();
      const createdAt = Number(data.readBigInt64LE(o5 + 57));
      const updatedAt = Number(data.readBigInt64LE(o5 + 65));

      agents.push({
        pda: pubkey.toBase58(),
        authority,
        agentId,
        name,
        description: description || '',
        category: category || '',
        capabilities,
        metadataUri: metadataUri || '',
        reputationScore: reputationScore / 10000, // 0-100 scale
        verificationLevel,
        createdAt: createdAt > 1577836800 ? new Date(createdAt * 1000).toISOString() : null,
        updatedAt: updatedAt > 1577836800 ? new Date(updatedAt * 1000).toISOString() : null,
        programId: PROGRAM.toBase58(),
      });
    } catch (e) {}
  }

  // Batch NFT lookups (parallel)
  const nftResults = await Promise.all(
    agents.map(agent => lookupNFT(conn, agent.authority))
  );
  for (let i = 0; i < agents.length; i++) {
    if (nftResults[i]) {
      agents[i].nftMint = nftResults[i].nftMint;
      agents[i].nftImage = nftResults[i].nftImage;
      agents[i].soulbound = nftResults[i].soulbound;
      agents[i].nftName = nftResults[i].nftName || null;
    } else {
      agents[i].nftMint = null;
      agents[i].nftImage = null;
      agents[i].soulbound = false;
    }
  }

  const result = { agents, count: agents.length, source: 'solana-mainnet' };
  agentCache = { data: result, timestamp: Date.now() };
  return result;
}

module.exports = { getSatpAgents };
