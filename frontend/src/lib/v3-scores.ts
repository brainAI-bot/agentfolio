/**
 * V3 On-Chain Score Service
 * Uses @brainai/satp-v3 SDK for PDA derivation and helpers.
 * Uses corrected manual Borsh deserialization (SDK has isActive bug in deserializeGenesis).
 */
import { Connection, PublicKey } from "@solana/web3.js";
import { deriveGenesisPda, verificationLabel as sdkVerificationLabel } from "@brainai/satp-v3";

const RPC_URL = process.env.SOLANA_RPC_URL || "https://mainnet.helius-rpc.com/?api-key=91c63e44-1c7a-4b98-830b-6135632565fb";
const CACHE_TTL_MS = 5 * 60 * 1000;

interface V3Score {
  pda: string;
  agentName: string;
  verificationLevel: number;
  verificationLabel: string;
  reputationScore: number;
  reputationPct: number;
  isBorn: boolean;
  bornAt: string | null;
  faceImage: string;
  createdAt: number;
}

let _v3Cache: Map<string, V3Score> = new Map();
let _v3CacheTime = 0;
let _v3Loading = false;

/**
 * Corrected Genesis Record deserialization.
 * SDK 3.5.1 has a phantom `isActive` bool that doesn't exist on-chain,
 * causing all subsequent fields to shift by 1 byte (reputationScore reads wrong).
 */
function parseGenesisRecord(data: Buffer, pda: PublicKey): V3Score | null {
  if (data.length < 8) return null;
  try {
    let offset = 8; // discriminator
    offset += 32; // agent_id_hash

    const readString = (): string => {
      const len = data.readUInt32LE(offset); offset += 4;
      const str = data.slice(offset, offset + len).toString("utf8"); offset += len;
      return str;
    };
    const readVecString = (): string[] => {
      const count = data.readUInt32LE(offset); offset += 4;
      const arr: string[] = [];
      for (let i = 0; i < count; i++) arr.push(readString());
      return arr;
    };

    const agentName = readString();
    readString(); // description
    readString(); // category
    readVecString(); // capabilities
    readString(); // metadataUri
    const faceImage = readString();
    offset += 32; // faceMint
    readString(); // faceBurnTx
    const genesisRecord = Number(data.readBigInt64LE(offset)); offset += 8;
    // NOTE: No isActive field on-chain — struct goes straight to authority
    offset += 32; // authority

    // Option<Pubkey> — Borsh: 1 byte tag, 32 bytes only if Some(1)
    const hasPending = data[offset]; offset += 1;
    if (hasPending === 1) offset += 32;

    const reputationScore = Number(data.readBigUInt64LE(offset)); offset += 8;
    const verificationLevel = data[offset]; offset += 1;
    offset += 8; // reputationUpdatedAt
    offset += 8; // verificationUpdatedAt
    const createdAt = Number(data.readBigInt64LE(offset)); offset += 8;

    const labels = ["Unclaimed", "Registered", "Verified", "Established", "Trusted", "Sovereign"];

    return {
      pda: pda.toBase58(),
      agentName,
      verificationLevel,
      verificationLabel: labels[verificationLevel] || "Unknown",
      reputationScore,
      reputationPct: reputationScore / 10000,
      isBorn: genesisRecord > 0,
      bornAt: genesisRecord > 0 ? new Date(genesisRecord * 1000).toISOString() : null,
      faceImage,
      createdAt,
    };
  } catch {
    return null;
  }
}

export async function fetchV3Scores(agentIds: string[]): Promise<Map<string, V3Score>> {
  const now = Date.now();
  if (_v3CacheTime && now - _v3CacheTime < CACHE_TTL_MS && _v3Cache.size > 0) return _v3Cache;
  if (_v3Loading) return _v3Cache;
  _v3Loading = true;

  try {
    const connection = new Connection(RPC_URL, "confirmed");
    const pdaMap: Map<string, { pda: PublicKey; agentId: string }> = new Map();

    for (const id of agentIds) {
      try {
        const [pda] = deriveGenesisPda(id); // SDK PDA derivation
        pdaMap.set(pda.toBase58(), { pda, agentId: id });
      } catch {}
    }

    const pdaKeys = Array.from(pdaMap.values()).map((v) => v.pda);
    const results = new Map<string, V3Score>();

    for (let i = 0; i < pdaKeys.length; i += 100) {
      const batch = pdaKeys.slice(i, i + 100);
      try {
        const accounts = await connection.getMultipleAccountsInfo(batch);
        for (let j = 0; j < batch.length; j++) {
          const acct = accounts[j];
          if (!acct || !acct.data) continue;
          const pdaStr = batch[j].toBase58();
          const entry = pdaMap.get(pdaStr);
          if (!entry) continue;
          const parsed = parseGenesisRecord(acct.data as Buffer, batch[j]);
          if (parsed) results.set(entry.agentId, parsed);
        }
      } catch (e) {
        console.error("[V3 Scores] Batch fetch failed:", (e as Error).message);
      }
    }

    _v3Cache = results;
    _v3CacheTime = now;
    console.log(`[V3 Scores] Cached ${results.size} genesis records (SDK PDA + manual deser)`);
    return results;
  } catch (e) {
    console.error("[V3 Scores] Fatal:", (e as Error).message);
    return _v3Cache;
  } finally {
    _v3Loading = false;
  }
}

export async function getV3Score(agentId: string): Promise<V3Score | null> {
  if (_v3CacheTime && Date.now() - _v3CacheTime < CACHE_TTL_MS) {
    return _v3Cache.get(agentId) || null;
  }
  try {
    const connection = new Connection(RPC_URL, "confirmed");
    const [pda] = deriveGenesisPda(agentId);
    const acct = await connection.getAccountInfo(pda);
    if (!acct || !acct.data) return null;
    return parseGenesisRecord(acct.data as Buffer, pda);
  } catch {
    return null;
  }
}

export function v3ToComputedScores(v3: V3Score) {
  const levelNames = ["Unclaimed", "Registered", "Verified", "Established", "Trusted", "Sovereign"];
  const repRanks = ["Newcomer", "Recognized", "Competent", "Expert", "Master"];
  const rankIdx = Math.min(Math.floor(v3.reputationScore / 200), 4);
  return {
    level: v3.verificationLevel,
    levelName: levelNames[v3.verificationLevel] || "Unknown",
    repScore: v3.reputationScore,
    repRank: repRanks[rankIdx],
    source: "v3-onchain" as const,
  };
}
