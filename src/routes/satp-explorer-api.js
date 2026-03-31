/**
 * SATP Explorer API — reads from V3 program (GTppU4E4...)
 * Uses v3-score-service for correct Borsh deserialization.
 * 
 * Updated 2026-03-31: Switched from V2 (97yL33...) to V3 program.
 * ONE deserializer for all endpoints.
 */

const { Connection, PublicKey } = require("@solana/web3.js");
const RPC = process.env.SOLANA_RPC_URL || "https://mainnet.helius-rpc.com/?api-key=REDACTED_HELIUS_API_KEY";
const TOKEN_2022 = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

// V3 program + same parser as v3-score-service
const V3_PROGRAM = new PublicKey("GTppU4E44BqXTQgbqMZ68ozFzhP1TLty3EGnzzjtNZfG");
const v3ScoreService = require("../../v3-score-service");

let agentCache = null;
const CACHE_TTL = 5 * 60 * 1000;

// NFT lookup (unchanged)
async function lookupNFT(conn, wallet) {
  try {
    const tokens = await conn.getParsedTokenAccountsByOwner(
      new PublicKey(wallet), { programId: TOKEN_2022 }
    );
    for (const ta of tokens.value) {
      const info = ta.account.data.parsed.info;
      if (info.tokenAmount?.uiAmount !== 1) continue;
      const mint = info.mint;
      const mintInfo = await conn.getParsedAccountInfo(new PublicKey(mint));
      const extensions = mintInfo.value?.data?.parsed?.info?.extensions || [];
      let isNonTransferable = false, metaUri = null;
      for (const ext of extensions) {
        if (ext.extension === "nonTransferable") isNonTransferable = true;
        if (ext.extension === "tokenMetadata" && ext.state?.uri) metaUri = ext.state.uri;
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

async function getSatpAgents() {
  if (agentCache && (Date.now() - agentCache.timestamp < CACHE_TTL)) {
    return agentCache.data;
  }

  const conn = new Connection(RPC, "confirmed");

  // Fetch ALL accounts from V3 program
  const accounts = await conn.getProgramAccounts(V3_PROGRAM);
  const agents = [];

  for (const { pubkey, account } of accounts) {
    const data = Buffer.from(account.data);
    if (data.length < 80) continue;

    // Use v3-score-service parser (same one that powers genesis endpoint)
    try {
      const parsed = v3ScoreService.parseGenesisRecord
        ? v3ScoreService.parseGenesisRecord(data)
        : null;

      if (!parsed || !parsed.agentName) continue;

      agents.push({
        pda: pubkey.toBase58(),
        authority: parsed.authority || "",
        agentId: pubkey.toBase58(),
        name: parsed.agentName,
        description: "",
        category: "",
        capabilities: [],
        metadataUri: "",
        reputationScore: parsed.reputationScore,
        verificationLevel: parsed.verificationLevel,
        verificationLabel: parsed.verificationLabel || "",
        isBorn: parsed.isBorn || false,
        faceImage: parsed.faceImage || "",
        faceMint: parsed.faceMint || "",
        createdAt: parsed.createdAt || null,
        updatedAt: parsed.updatedAt || null,
        programId: V3_PROGRAM.toBase58(),
      });
    } catch (e) {}
  }

  // Batch NFT lookups
  const nftResults = await Promise.all(
    agents.filter(a => a.authority).map(agent => lookupNFT(conn, agent.authority))
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

  const result = { agents, count: agents.length, source: "solana-mainnet-v3" };
  agentCache = { data: result, timestamp: Date.now() };
  return result;
}

module.exports = { getSatpAgents };
