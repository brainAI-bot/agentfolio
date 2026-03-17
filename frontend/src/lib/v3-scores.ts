/**
 * V3 On-Chain Score Service
 * Batch-fetches Genesis Records for all agents, caches with 5-min TTL.
 * Falls back to local scoring for profiles without Genesis Records.
 */
import { Connection, PublicKey } from "@solana/web3.js";
import crypto from "crypto";

const IDENTITY_V3 = new PublicKey("GTppU4E44BqXTQgbqMZ68ozFzhP1TLty3EGnzzjtNZfG");
const RPC_URL = process.env.SOLANA_RPC_URL || "https://mainnet.helius-rpc.com/?api-key=REDACTED_HELIUS_API_KEY";
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface V3Score {
  pda: string;
  agentName: string;
  verificationLevel: number;
  verificationLabel: string;
  reputationScore: number;
  reputationPct: number;
  isBorn: boolean;
  bornAt: string | null;
  createdAt: number;
}

// Cache
let _v3Cache: Map<string, V3Score> = new Map();
let _v3CacheTime = 0;
let _v3Loading = false;

function agentIdHash(agentId: string): Buffer {
  return crypto.createHash("sha256").update(agentId).digest();
}

function getGenesisPDA(agentId: string): [PublicKey, number] {
  const hash = agentIdHash(agentId);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("genesis"), hash],
    IDENTITY_V3
  );
}

function parseGenesisRecord(data: Buffer, pda: PublicKey): V3Score | null {
  if (data.length < 8) return null;
  try {
    let offset = 8; // skip discriminator

    // agent_id_hash (32 bytes)
    offset += 32;

    // Read borsh string
    const readString = (): string => {
      const len = data.readUInt32LE(offset);
      offset += 4;
      const str = data.slice(offset, offset + len).toString("utf8");
      offset += len;
      return str;
    };

    const readVecString = (): string[] => {
      const count = data.readUInt32LE(offset);
      offset += 4;
      const arr: string[] = [];
      for (let i = 0; i < count; i++) arr.push(readString());
      return arr;
    };

    const agentName = readString();
    const description = readString();
    const category = readString();
    const capabilities = readVecString();
    const metadataUri = readString();
    const faceImage = readString();
    offset += 32; // faceMint
    const faceBurnTx = readString();
    const genesisRecord = Number(data.readBigInt64LE(offset));
    offset += 8;
    offset += 32; // authority

    // Option<Pubkey>
    const hasPending = data[offset];
    offset += 1;
    if (hasPending === 1) offset += 32;

    const reputationScore = Number(data.readBigUInt64LE(offset));
    offset += 8;
    const verificationLevel = data[offset];
    offset += 1;
    offset += 8; // reputationUpdatedAt
    offset += 8; // verificationUpdatedAt
    const createdAt = Number(data.readBigInt64LE(offset));
    offset += 8;

    const labels = ["Unverified", "Basic", "Standard", "Enhanced", "Premium", "Maximum"];

    return {
      pda: pda.toBase58(),
      agentName,
      verificationLevel,
      verificationLabel: labels[verificationLevel] || "Unknown",
      reputationScore,
      reputationPct: reputationScore / 10000,
      isBorn: genesisRecord > 0,
      bornAt: genesisRecord > 0 ? new Date(genesisRecord * 1000).toISOString() : null,
      createdAt,
    };
  } catch {
    return null;
  }
}

/**
 * Batch-fetch V3 Genesis Records for a list of agent IDs.
 * Uses getMultipleAccounts for efficiency (1 RPC call per 100 agents).
 */
export async function fetchV3Scores(agentIds: string[]): Promise<Map<string, V3Score>> {
  const now = Date.now();
  if (_v3CacheTime && now - _v3CacheTime < CACHE_TTL_MS && _v3Cache.size > 0) {
    return _v3Cache;
  }
  if (_v3Loading) return _v3Cache;
  _v3Loading = true;

  try {
    const connection = new Connection(RPC_URL, "confirmed");
    const pdaMap: Map<string, { pda: PublicKey; agentId: string }> = new Map();

    for (const id of agentIds) {
      const [pda] = getGenesisPDA(id);
      pdaMap.set(pda.toBase58(), { pda, agentId: id });
    }

    const pdaKeys = Array.from(pdaMap.values()).map((v) => v.pda);
    const results = new Map<string, V3Score>();

    // Batch in chunks of 100
    for (let i = 0; i < pdaKeys.length; i += 100) {
      const batch = pdaKeys.slice(i, i + 100);
      try {
        const accounts = await connection.getMultipleAccountsInfo(batch);
        for (let j = 0; j < batch.length; j++) {
          const acct = accounts[j];
          const pdaStr = batch[j].toBase58();
          const { agentId } = pdaMap.get(pdaStr)!;
          if (acct && acct.data) {
            const parsed = parseGenesisRecord(acct.data as Buffer, batch[j]);
            if (parsed) {
              results.set(agentId, parsed);
            }
          }
        }
      } catch (e) {
        console.error("[V3 Scores] Batch fetch failed:", (e as Error).message);
      }
    }

    _v3Cache = results;
    _v3CacheTime = now;
    return results;
  } catch (e) {
    console.error("[V3 Scores] Fatal:", (e as Error).message);
    return _v3Cache;
  } finally {
    _v3Loading = false;
  }
}

/**
 * Get V3 score for a single agent. Returns null if no Genesis Record.
 */
export async function getV3Score(agentId: string): Promise<V3Score | null> {
  // Check cache first
  if (_v3CacheTime && Date.now() - _v3CacheTime < CACHE_TTL_MS) {
    return _v3Cache.get(agentId) || null;
  }
  // Single fetch
  try {
    const connection = new Connection(RPC_URL, "confirmed");
    const [pda] = getGenesisPDA(agentId);
    const acct = await connection.getAccountInfo(pda);
    if (!acct || !acct.data) return null;
    return parseGenesisRecord(acct.data as Buffer, pda);
  } catch {
    return null;
  }
}

/**
 * Convert V3 scores to the format expected by mapProfile.
 */
export function v3ToComputedScores(v3: V3Score) {
  const levelNames = ["Unregistered", "Registered", "Verified", "On-Chain", "Trusted", "Sovereign"];
  const repRanks = ["Newcomer", "Recognized", "Competent", "Expert", "Master"];
  const repPct = v3.reputationPct;
  const rankIdx = repPct >= 80 ? 4 : repPct >= 60 ? 3 : repPct >= 40 ? 2 : repPct >= 20 ? 1 : 0;

  return {
    level: v3.verificationLevel,
    levelName: levelNames[v3.verificationLevel] || "Unknown",
    repScore: Math.round(v3.reputationPct * 10), // scale to 0-1000
    repRank: repRanks[rankIdx],
    source: "v3-onchain" as const,
  };
}
