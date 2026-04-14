/**
 * SATP Explorer API — reads from V3 program (GTppU4E4...)
 * Uses v3-score-service for correct Borsh deserialization.
 * 
 * Updated 2026-03-31: Switched from V2 (97yL33...) to V3 program.
 * ONE deserializer for all endpoints.
 */

const { Connection, PublicKey } = require("@solana/web3.js");
let profileStore;
try { profileStore = require("../profile-store"); } catch(e) { profileStore = null; }
const { computeUnifiedTrustScore } = require('../lib/unified-trust-score');
const RPC = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
const TOKEN_2022 = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

// V3 program + same parser as v3-score-service
const V3_PROGRAM = new PublicKey("GTppU4E44BqXTQgbqMZ68ozFzhP1TLty3EGnzzjtNZfG");
const v3ScoreService = require("../../v3-score-service");

let agentCache = null;
const CACHE_TTL = 5 * 60 * 1000;

function hasIncompleteExplorerCache(data) {
  const agents = Array.isArray(data?.agents) ? data.agents : [];
  return agents.some((agent) => (Array.isArray(agent?.attestationMemos) ? agent.attestationMemos : []).some((att) => {
    const tx = String(att?.txSignature || '').trim();
    const url = String(att?.solscanUrl || '').trim();
    return tx.startsWith('0x') || url.includes('/account/');
  }));
}

function clearSatpExplorerCache() {
  agentCache = null;
}

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

async function fetchJsonWithRetries(url, attempts = 3, delayMs = 400) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
    } catch (_) {}
    if (attempt < attempts - 1) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return null;
}

async function getSatpAgents() {
  if (agentCache && (Date.now() - agentCache.timestamp < CACHE_TTL) && !hasIncompleteExplorerCache(agentCache.data)) {
    return agentCache.data;
  }
  if (agentCache && hasIncompleteExplorerCache(agentCache.data)) {
    agentCache = null;
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
        reputationScore: parsed.reputationScore > 10000 ? Math.round(parsed.reputationScore / 1000) : parsed.reputationScore,
        rawReputationScore: parsed.reputationScore,
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

  try {
    const Database = require('better-sqlite3');
    const path = require('path');
    const { computeScore } = require('../lib/compute-score');
    const _db = new Database(path.join(__dirname, '../../data/agentfolio.db'), { readonly: true });
    const profiles = _db.prepare('SELECT id, name, wallet, claimed, claimed_by, wallets FROM profiles').all();
    const reviewStatsRows = _db.prepare(`
      SELECT
        reviewee_id AS profile_id,
        COUNT(*) AS total,
        ROUND(AVG(COALESCE(rating, 0)), 2) AS avg_rating
      FROM reviews
      GROUP BY reviewee_id
    `).all();
    const reviewStatsByProfileId = new Map(reviewStatsRows.map((row) => [row.profile_id, row]));

    const matchesProfile = (agent) => profiles.find((profile) => {
      let wallets = {};
      try { wallets = JSON.parse(profile.wallets || '{}'); } catch (_) {}
      const agentName = String(agent.name || '').toLowerCase();
      const authority = String(agent.authority || '');
      return (
        String(profile.name || '').toLowerCase() == agentName ||
        String(profile.wallet || '') == authority ||
        String(profile.claimed_by || '') == authority ||
        String(wallets.solana || '') == authority
      );
    });

    const levelLabels = ['Unverified','Registered','Verified','Established','Trusted','Sovereign'];
    const levelBadges = ['⚪','🟡','🔵','🟢','🟠','🟣'];
    const normalizePlatform = (value) => {
      const raw = String(value || '').trim().toLowerCase();
      if (!raw) return '';
      if (raw === 'twitter') return 'x';
      if (raw === 'solana_wallet' || raw === 'solana wallet') return 'solana';
      if (raw === 'eth_wallet' || raw === 'eth wallet' || raw === 'ethereum' || raw === 'ethereum wallet') return 'eth';
      const normalized = raw
        .replace(/^verification_/, '')
        .replace(/_wallet_verification$/, '')
        .replace(/_verification$/, '')
        .replace(/_/g, ' ')
        .trim()
        .toLowerCase();
      if (!normalized || normalized === 'review' || normalized.includes('satp')) return '';
      return normalized;
    };

    const filteredAgents = [];
    const seenProfileIds = new Set();
    for (const agent of agents) {
      const profile = matchesProfile(agent);
      if (!profile) continue;
      if (seenProfileIds.has(profile.id)) continue;
      seenProfileIds.add(profile.id);
      agent.profileId = profile.id;
      agent.agentId = profile.id;
      filteredAgents.push(agent);
    }

    const nftResults = await Promise.all(
      filteredAgents.map(agent => agent.authority ? lookupNFT(conn, agent.authority) : Promise.resolve(null))
    );
    for (let i = 0; i < filteredAgents.length; i++) {
      if (nftResults[i]) {
        filteredAgents[i].nftMint = nftResults[i].nftMint;
        filteredAgents[i].nftImage = nftResults[i].nftImage;
        filteredAgents[i].soulbound = nftResults[i].soulbound;
        filteredAgents[i].nftName = nftResults[i].nftName || null;
      } else {
        filteredAgents[i].nftMint = null;
        filteredAgents[i].nftImage = null;
        filteredAgents[i].soulbound = false;
      }
    }

    const explorerBase = process.env.INTERNAL_API_URL || 'http://127.0.0.1:3333';
    const enrichedAgents = await Promise.all(filteredAgents.map(async (agent) => {
      const profile = profiles.find((p) => p.id === agent.profileId);
      if (!profile) return agent;

      const explorerData = await fetchJsonWithRetries(`${explorerBase}/api/explorer/${encodeURIComponent(profile.id)}`, 3, 300);
      const byAgentData = await fetchJsonWithRetries(`${explorerBase}/api/satp/attestations/by-agent/${encodeURIComponent(profile.id)}`, 5, 500);

      const reviewStats = reviewStatsByProfileId.get(profile.id) || { total: 0, avg_rating: 0 };
      const unified = computeUnifiedTrustScore(_db, profile, {
        v3Score: {
          reputationScore: agent.reputationScore || 0,
          verificationLevel: agent.verificationLevel || 0,
          verificationLabel: agent.verificationLabel || levelLabels[agent.verificationLevel || 0] || 'Unknown',
          createdAt: agent.createdAt || null,
        },
      });
      const explorerVerifications = Array.isArray(explorerData?.verifications) ? explorerData.verifications : unified.verifications;
      const rawExplorerAttestations = Array.isArray(byAgentData?.data?.attestations)
        ? byAgentData.data.attestations
        : (Array.isArray(explorerData?.attestationMemos) ? explorerData.attestationMemos : unified.verifications);
      const explorerAttestations = rawExplorerAttestations
        .filter((att) => !!normalizePlatform(att?.platform || att?.type || att?.attestationType))
        .map((att) => ({
          ...att,
          platform: normalizePlatform(att?.platform || att?.type || att?.attestationType),
          memo: att?.memo || null,
        }))
        .filter((att, index, list) => list.findIndex((candidate) =>
          candidate.platform === att.platform
          && String(candidate.txSignature || '') === String(att.txSignature || '')
          && String(candidate.solscanUrl || '') === String(att.solscanUrl || '')
        ) === index);
      const platforms = [...new Set([
        ...(Array.isArray(agent.platforms) ? agent.platforms : []),
        ...explorerVerifications.map(v => normalizePlatform(v.platform || v.type || v.label)),
        ...explorerAttestations.map(a => normalizePlatform(a.platform || a.type || a.attestationType)),
      ].filter(Boolean))];

      return {
        ...agent,
        profileId: profile.id,
        agentId: profile.id,
        reputationScore: unified.score,
        trustScore: unified.score,
        verificationLevel: unified.level,
        verificationLabel: unified.levelName,
        verificationLevelName: unified.levelName || levelLabels[unified.level] || 'Unverified',
        verificationBadge: levelBadges[unified.level] || '⚪',
        trustCredentialUrl: `/trust/${encodeURIComponent(profile.id)}`,
        verifications: explorerVerifications,
        attestationMemos: explorerAttestations,
        platforms,
        reviewCount: Number(reviewStats.total || 0),
        reviewAvg: Number(reviewStats.avg_rating || 0),
        onChainAttestations: explorerAttestations.length || explorerVerifications.length || platforms.length || 0,
      };
    }));
    _db.close();

    const dedupedAgents = [];
    const seenKeys = new Set();
    for (const agent of enrichedAgents) {
      const key = agent.profileId || (agent.name ? `name:${String(agent.name).toLowerCase()}` : `agent:${agent.agentId}`);
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      dedupedAgents.push(agent);
    }

    const result = { agents: dedupedAgents, count: dedupedAgents.length, source: "solana-mainnet-v3" };
    if (!hasIncompleteExplorerCache(result)) {
      agentCache = { data: result, timestamp: Date.now() };
    } else {
      agentCache = null;
    }
    return result;
  } catch (e) {
    console.warn('[SATP Explorer] DB filter/overlay failed:', e.message);
  }

  const result = { agents, count: agents.length, source: "solana-mainnet-v3" };
  agentCache = { data: result, timestamp: Date.now() };
  return result;
}

module.exports = { getSatpAgents, clearSatpExplorerCache };
