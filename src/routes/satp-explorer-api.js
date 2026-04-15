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
  return agents.some((agent) => {
    const platforms = Array.isArray(agent?.platforms) ? agent.platforms : [];
    if (platforms.some((platform) => String(platform || '').trim().toLowerCase() === 'evm')) return true;
    return (Array.isArray(agent?.attestationMemos) ? agent.attestationMemos : []).some((att) => {
      const tx = String(att?.txSignature || '').trim();
      const url = String(att?.solscanUrl || '').trim();
      const platform = String(att?.platform || '').trim().toLowerCase();
      return tx.startsWith('0x') || url.includes('/account/') || platform === 'evm';
    });
  });
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
    const _db = new Database(path.join(__dirname, '../../data/agentfolio.db'), { readonly: true });
    const profileRows = _db.prepare('SELECT * FROM profiles').all();
    const reviewStatsRows = _db.prepare(`
      SELECT
        reviewee_id AS profile_id,
        COUNT(*) AS total,
        ROUND(AVG(COALESCE(rating, 0)), 2) AS avg_rating
      FROM reviews
      GROUP BY reviewee_id
    `).all();
    const reviewStatsByProfileId = new Map(reviewStatsRows.map((row) => [row.profile_id, row]));

    const parseJsonField = (value, fallback) => {
      if (value == null || value === '') return fallback;
      if (typeof value !== 'string') return value;
      try {
        const parsed = JSON.parse(value);
        return parsed == null ? fallback : parsed;
      } catch (_) {
        return fallback;
      }
    };

    const profiles = profileRows.map((profile) => ({
      ...profile,
      wallets: parseJsonField(profile.wallets, {}),
      tags: Array.isArray(parseJsonField(profile.tags, [])) ? parseJsonField(profile.tags, []) : [],
      skills: Array.isArray(parseJsonField(profile.skills, [])) ? parseJsonField(profile.skills, []) : [],
      portfolio: Array.isArray(parseJsonField(profile.portfolio, [])) ? parseJsonField(profile.portfolio, []) : [],
      links: parseJsonField(profile.links, {}),
      metadata: parseJsonField(profile.metadata, {}),
      verification_data: parseJsonField(profile.verification_data, {}),
      nft_avatar: parseJsonField(profile.nft_avatar, null),
    }));
    const profileIndex = new Map(profiles.map((profile) => [profile.id, profile]));


const levelLabels = ['Unverified','Registered','Verified','Established','Trusted','Sovereign'];
const levelBadges = ['⚪','🟡','🔵','🟢','🟠','🟣'];
const chainCache = require('../lib/chain-cache');
const attestationRowsStmt = _db.prepare('SELECT platform, tx_signature, created_at FROM attestations WHERE profile_id = ? AND tx_signature IS NOT NULL ORDER BY created_at DESC');
const verificationRowsStmt = _db.prepare('SELECT platform, proof, verified_at FROM verifications WHERE profile_id = ? ORDER BY verified_at DESC');
const normalizePlatform = (value) => {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  if (raw === 'twitter') return 'x';
  if (raw === 'solana_wallet' || raw === 'solana wallet') return 'solana';
  if (raw === 'eth_wallet' || raw === 'eth wallet' || raw === 'ethereum' || raw === 'ethereum wallet' || raw === 'evm') return 'eth';
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
const isPublicPlatform = (value) => !!normalizePlatform(value);
const isLikelySolanaTxSignature = (value) => /^[1-9A-HJ-NP-Za-km-z]{60,120}$/.test(String(value || '').trim());

const normalizeProfileKey = (value) => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
const deriveProfileIdFromName = (name) => {
  const normalized = normalizeProfileKey(name);
  return normalized ? `agent_${normalized}` : '';
};
const getProfileAuthorityCandidates = (profile) => [profile?.wallet, profile?.claimed_by, profile?.wallets?.solana]
  .map((value) => String(value || '').trim().toLowerCase())
  .filter(Boolean);
const addProfileCandidate = (map, key, profile) => {
  if (!key || !profile?.id) return;
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(profile);
};
const profilesByAuthority = new Map();
const profilesByName = new Map();
for (const profile of profiles) {
  for (const authorityKey of getProfileAuthorityCandidates(profile)) {
    addProfileCandidate(profilesByAuthority, authorityKey, profile);
  }
  const nameKey = normalizeProfileKey(profile.name || profile.handle || profile.id || '');
  if (nameKey) addProfileCandidate(profilesByName, nameKey, profile);
}
const pickBestProfileForAgent = (parsedAgent) => {
  if (!parsedAgent) return { profile: null, score: 0 };
  const derivedProfileId = String(deriveProfileIdFromName(parsedAgent.name || '') || '').trim().toLowerCase();
  const authorityKey = String(parsedAgent.authority || '').trim().toLowerCase();
  const nameKey = normalizeProfileKey(parsedAgent.name || '');
  const candidates = new Map();
  const registerCandidate = (profile) => {
    if (!profile?.id) return;
    candidates.set(profile.id, profile);
  };
  if (derivedProfileId && profileIndex.has(derivedProfileId)) registerCandidate(profileIndex.get(derivedProfileId));
  for (const profile of profilesByAuthority.get(authorityKey) || []) registerCandidate(profile);
  for (const profile of profilesByName.get(nameKey) || []) registerCandidate(profile);
  if (!candidates.size) return { profile: null, score: 0 };

  const rankProfile = (profile) => {
    let score = 0;
    const profileId = String(profile.id || '').trim().toLowerCase();
    const profileNameKey = normalizeProfileKey(profile.name || profile.handle || '');
    const authorityCandidates = getProfileAuthorityCandidates(profile);
    const verificationCount = Object.keys(profile.verification_data || {}).length;
    if (derivedProfileId && profileId === derivedProfileId) score += 1000;
    if (authorityKey && authorityCandidates.includes(authorityKey)) score += 500;
    if (nameKey && profileNameKey === nameKey) score += 100;
    if (profileId.startsWith('agent_')) score += 25;
    if (profile.nft_avatar?.image || profile.nft_avatar?.arweaveUrl || profile.avatar) score += 10;
    score += Math.min(verificationCount, 25);
    score += Math.min(Array.isArray(profile.skills) ? profile.skills.length : 0, 10);
    const updatedTs = Date.parse(profile.updated_at || profile.created_at || 0) || 0;
    return { profile, score, updatedTs };
  };

  const ranked = Array.from(candidates.values())
    .map(rankProfile)
    .sort((a, b) => b.score - a.score || b.updatedTs - a.updatedTs || String(a.profile.id).localeCompare(String(b.profile.id)));
  return ranked[0] || { profile: null, score: 0 };
};
const filteredAgents = agents.map((v3) => {
  if (!v3 || !v3.name) return null;
  const matched = pickBestProfileForAgent(v3);
  const profile = matched.profile;
  const fallbackProfileId = deriveProfileIdFromName(v3.name) || v3.agentId || v3.pda;
  const authority = String(v3.authority || profile?.wallet || profile?.claimed_by || profile?.wallets?.solana || '');
  return {
    pda: v3.pda,
    authority,
    agentId: profile?.id || fallbackProfileId,
    profileId: profile?.id || null,
    profileMatchScore: Number(matched.score || 0),
    name: v3.name || profile?.name || fallbackProfileId,
    description: v3.description || '',
    category: v3.category || '',
    capabilities: Array.isArray(v3.capabilities) ? v3.capabilities : [],
    metadataUri: v3.metadataUri || '',
    reputationScore: v3.reputationScore > 10000 ? Math.round(v3.reputationScore / 1000) : v3.reputationScore,
    rawReputationScore: v3.rawReputationScore || v3.reputationScore || 0,
    verificationLevel: Number(v3.verificationLevel || 0),
    verificationLabel: v3.verificationLabel || levelLabels[Number(v3.verificationLevel || 0)] || 'Unknown',
    isBorn: !!v3.isBorn,
    faceImage: v3.faceImage || '',
    faceMint: v3.faceMint || '',
    createdAt: v3.createdAt || null,
    updatedAt: v3.updatedAt || null,
    programId: V3_PROGRAM.toBase58(),
  };
}).filter(Boolean);


for (const agent of filteredAgents) {
  const profile = profileIndex.get(agent.profileId);
  const profileNFTAvatar = profile?.nft_avatar || null;
  const profileAvatar = profileNFTAvatar?.image || profileNFTAvatar?.arweaveUrl || profile?.avatar || null;

  if (profileAvatar) {
    agent.nftMint = profileNFTAvatar?.soulboundMint || profileNFTAvatar?.identifier || agent.faceMint || null;
    agent.nftImage = profileAvatar;
    agent.soulbound = !!(profileNFTAvatar?.soulboundMint || profileNFTAvatar?.permanent || agent.isBorn);
    agent.nftName = profileNFTAvatar?.name || agent.name || null;
    continue;
  }

  if (agent.faceImage) {
    agent.nftMint = agent.faceMint || null;
    agent.nftImage = agent.faceImage;
    agent.soulbound = !!agent.isBorn;
    agent.nftName = agent.name || null;
    continue;
  }

  if (!agent.authority) {
    agent.nftMint = null;
    agent.nftImage = null;
    agent.soulbound = false;
    agent.nftName = null;
    continue;
  }

  const nft = await lookupNFT(conn, agent.authority);
  if (nft) {
    agent.nftMint = nft.nftMint;
    agent.nftImage = nft.nftImage;
    agent.soulbound = nft.soulbound;
    agent.nftName = nft.nftName || null;
  } else {
    agent.nftMint = null;
    agent.nftImage = null;
    agent.soulbound = false;
    agent.nftName = null;
  }
}

const enrichedAgents = [];
for (const agent of filteredAgents) {
  const profile = profileIndex.get(agent.profileId);
  if (!profile) {
    enrichedAgents.push(agent);
    continue;
  }

  const profileNFTAvatar = profile.nft_avatar || null;
  const profileAvatar = profileNFTAvatar?.image || profileNFTAvatar?.arweaveUrl || profile.avatar || null;
  const reviewStats = reviewStatsByProfileId.get(profile.id) || { total: 0, avg_rating: 0 };
  const unified = computeUnifiedTrustScore(_db, profile, {
    v3Score: {
      reputationScore: agent.rawReputationScore || agent.reputationScore || 0,
      verificationLevel: agent.verificationLevel || 0,
      verificationLabel: agent.verificationLabel || levelLabels[agent.verificationLevel || 0] || 'Unknown',
      createdAt: agent.createdAt || null,
    },
  });

  const txHints = new Map();
  const addTxHint = (platform, txSignature, timestamp = null, solscanUrl = null) => {
    const normalized = normalizePlatform(platform);
    if (!normalized || !isLikelySolanaTxSignature(txSignature) || txHints.has(normalized)) return;
    txHints.set(normalized, {
      platform: normalized,
      txSignature,
      timestamp,
      solscanUrl: solscanUrl || `https://solana.fm/tx/${txSignature}`,
    });
  };

  for (const row of attestationRowsStmt.all(profile.id)) {
    addTxHint(row.platform, row.tx_signature, row.created_at || null);
  }
  for (const row of verificationRowsStmt.all(profile.id)) {
    let proof = {};
    try { proof = typeof row.proof === 'string' ? JSON.parse(row.proof) : (row.proof || {}); } catch (_) {}
    addTxHint(row.platform, proof.txSignature || proof.signature || proof.transactionSignature || null, row.verified_at || null);
  }
  for (const [platform, value] of Object.entries(profile.verification_data || {})) {
    const txSignature = value && typeof value === 'object' ? (value.txSignature || value.signature || value.transactionSignature || null) : null;
    const timestamp = value && typeof value === 'object' ? (value.verifiedAt || value.timestamp || null) : null;
    addTxHint(platform, txSignature, timestamp);
  }

  const chainAttestations = (chainCache.getVerifications(profile.id, profile.created_at) || []).map((att) => ({ ...att }));
  if (typeof chainCache.resolveAttestationTxHintByPda === 'function') {
    for (const att of chainAttestations) {
      const currentTx = att?.txSignature || att?.tx_signature || null;
      if (!att?.pda || isLikelySolanaTxSignature(currentTx)) continue;
      try {
        const createdAtUnix = att?.timestamp ? Math.floor(new Date(att.timestamp).getTime() / 1000) : null;
        const hint = await chainCache.resolveAttestationTxHintByPda(att.pda, createdAtUnix);
        if (hint?.txSignature) {
          att.txSignature = hint.txSignature;
          att.solscanUrl = hint.solscanUrl || att.solscanUrl || (`https://solana.fm/tx/${hint.txSignature}`);
          addTxHint(att.platform || att.attestationType, hint.txSignature, att.timestamp || null, att.solscanUrl || null);
        }
      } catch (_) {}
    }
  }

  const explorerVerifications = (Array.isArray(unified.verifications) ? unified.verifications : [])
    .filter((verification) => isPublicPlatform(verification?.platform || verification?.type || verification?.label))
    .map((verification) => {
      const platform = normalizePlatform(verification?.platform || verification?.type || verification?.label);
      const hinted = txHints.get(platform) || null;
      const txSignature = hinted?.txSignature || verification?.txSignature || null;
      return {
        ...verification,
        platform,
        txSignature,
        solscanUrl: hinted?.solscanUrl || (isLikelySolanaTxSignature(txSignature) ? `https://solana.fm/tx/${txSignature}` : null),
        timestamp: verification?.timestamp || hinted?.timestamp || null,
      };
    });

  const explorerAttestations = [];
  const seenAttestationPlatforms = new Set();
  for (const att of chainAttestations) {
    const platform = normalizePlatform(att?.platform || att?.type || att?.attestationType);
    if (!platform || seenAttestationPlatforms.has(platform)) continue;
    seenAttestationPlatforms.add(platform);
    const hinted = txHints.get(platform) || null;
    const txSignature = att?.txSignature || att?.tx_signature || hinted?.txSignature || null;
    const rawMemo = typeof att?.memo === 'string' ? att.memo.trim() : null;
    explorerAttestations.push({
      ...att,
      platform,
      memo: rawMemo && !/^ATTESTATION\|/i.test(rawMemo) ? rawMemo : null,
      txSignature,
      timestamp: att?.timestamp || hinted?.timestamp || null,
      solscanUrl: att?.solscanUrl || hinted?.solscanUrl || (isLikelySolanaTxSignature(txSignature) ? `https://solana.fm/tx/${txSignature}` : null),
    });
  }
  for (const [platform, hinted] of txHints.entries()) {
    if (seenAttestationPlatforms.has(platform)) continue;
    seenAttestationPlatforms.add(platform);
    explorerAttestations.push({
      platform,
      memo: null,
      txSignature: hinted.txSignature,
      timestamp: hinted.timestamp || null,
      solscanUrl: hinted.solscanUrl,
    });
  }

  const platforms = [...new Set([
    ...(Array.isArray(agent.platforms) ? agent.platforms : []),
    ...explorerVerifications.map((v) => normalizePlatform(v.platform || v.type || v.label)),
    ...explorerAttestations.map((a) => normalizePlatform(a.platform || a.type || a.attestationType)),
  ].filter(Boolean))];

  enrichedAgents.push({
    ...agent,
    profileId: profile.id,
    agentId: profile.id,
    score: unified.score,
    reputationScore: unified.score,
    trustScore: unified.score,
    level: unified.level,
    tier: unified.levelName,
    levelName: unified.levelName,
    verificationLevel: unified.level,
    verificationLabel: unified.levelName,
    verificationLevelName: unified.levelName || levelLabels[unified.level] || 'Unverified',
    verificationBadge: levelBadges[unified.level] || '⚪',
    trustCredentialUrl: `/trust/${encodeURIComponent(profile.id)}`,
    avatar: profileAvatar || agent.nftImage || null,
    nftImage: profileAvatar || agent.nftImage || null,
    nftAvatar: profileNFTAvatar,
    verifications: explorerVerifications,
    attestationMemos: explorerAttestations,
    platforms,
    reviewCount: Number(reviewStats.total || 0),
    reviewAvg: Number(reviewStats.avg_rating || 0),
    onChainAttestations: explorerAttestations.length || explorerVerifications.length || platforms.length || 0,
  });
}
    _db.close();

    const dedupedAgents = [];
    const seenKeys = new Set();
    const rankedAgents = [...enrichedAgents].sort((a, b) => {
      const aHasProfile = !!a?.profileId;
      const bHasProfile = !!b?.profileId;
      if (aHasProfile !== bHasProfile) return aHasProfile ? -1 : 1;
      const scoreDelta = Number(b?.profileMatchScore || 0) - Number(a?.profileMatchScore || 0);
      if (scoreDelta !== 0) return scoreDelta;
      const updatedDelta = (Date.parse(b?.updatedAt || 0) || 0) - (Date.parse(a?.updatedAt || 0) || 0);
      if (updatedDelta !== 0) return updatedDelta;
      return String(a?.pda || '').localeCompare(String(b?.pda || ''));
    });
    for (const agent of rankedAgents) {
      const key = agent.profileId ? `profile:${agent.profileId}` : (agent.pda || agent.authority || (agent.name ? `name:${String(agent.name).toLowerCase()}` : `agent:${agent.agentId}`));
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      dedupedAgents.push(agent);
    }

    const sanitizedAgents = dedupedAgents.map((agent) => {
      const attestationMemos = [];
      const seenAttestationKeys = new Set();
      for (const att of Array.isArray(agent.attestationMemos) ? agent.attestationMemos : []) {
        const platform = normalizePlatform(att?.platform || att?.type || att?.attestationType);
        if (!platform) continue;
        const key = `${platform}|${String(att?.txSignature || '').trim()}|${String(att?.pda || '').trim()}`;
        if (seenAttestationKeys.has(key)) continue;
        seenAttestationKeys.add(key);
        attestationMemos.push({ ...att, platform });
      }
      const platforms = [...new Set([
        ...(Array.isArray(agent.platforms) ? agent.platforms : []),
        ...attestationMemos.map((att) => att.platform),
      ].map((value) => normalizePlatform(value)).filter(Boolean))];
      return {
        ...agent,
        attestationMemos,
        platforms,
        onChainAttestations: attestationMemos.length || agent.onChainAttestations || platforms.length || 0,
      };
    });
    const result = { agents: sanitizedAgents, count: sanitizedAgents.length, source: "solana-mainnet-v3" };
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


