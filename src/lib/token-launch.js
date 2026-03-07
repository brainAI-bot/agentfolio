/**
 * Token Launch Integration - Virtuals Protocol (primary) + pump.fun + Existing Tokens
 * Multi-platform token launch system for AgentFolio agents
 */

const fs = require('fs');
const path = require('path');
const { loadProfile, saveProfile: dbSaveProfile } = require('./profile');
const logger = require('../logger');

const LAUNCHES_DIR = path.join(__dirname, '..', '..', 'data', 'token-launches');
const PUMP_LAUNCH_PATH = path.join(__dirname, '..', '..', '..', '..', 'pump-launch.js');
const BUYBACKS_DIR = path.join(__dirname, '..', '..', 'data', 'buybacks');

for (const dir of [LAUNCHES_DIR, BUYBACKS_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

const LAUNCH_STATUS = {
  PENDING: 'pending',
  BONDING: 'bonding',      // Virtuals: on bonding curve, pre-graduation
  LAUNCHING: 'launching',
  LIVE: 'live',
  GRADUATED: 'graduated',  // Virtuals: graduated from bonding curve → DEX
  FAILED: 'failed'
};

const PLATFORMS = {
  VIRTUALS: 'virtuals',
  PUMPFUN: 'pumpfun',
  EXISTING: 'existing'
};

/*
 * ════════════════════════════════════════════════════════════════
 *  VIRTUALS PROTOCOL — Integration Reference
 * ════════════════════════════════════════════════════════════════
 *
 *  Launch App:  https://fun.virtuals.io  (create new agent)
 *  Main App:    https://app.virtuals.io  (manage sentient agents)
 *  Chains:      Base (EVM) + Solana
 *
 *  LAUNCH FLOW:
 *  1. Go to fun.virtuals.io → "Create New Agent"
 *  2. Fill form: name, ticker (≤6 chars), description, profile pic, type
 *  3. Pay 100 $VIRTUAL creation fee (can also pre-buy supply)
 *  4. Agent deploys on bonding curve (Prototype Agent)
 *  5. When 42,000 $VIRTUAL accumulates → graduates to Sentient Agent
 *  6. DEX pool created: Uniswap V2 (Base) or Meteora (Solana)
 *
 *  TOKENOMICS:
 *  - Fixed supply: 1,000,000,000 tokens
 *  - Max 87.5% purchasable pre-bonding
 *  - 12.5% reserved for DEX liquidity post-graduation
 *  - Token paired with $VIRTUAL (not bridged)
 *  - LP tokens staked with 10-year lock
 *
 *  CHAIN DIFFERENCES:
 *  Base:   Two-token mechanism (prototype token → burn → new sentient token + airdrop)
 *  Solana: Single token mechanism (same address throughout)
 *
 *  FEES:
 *  - Prototype phase: 1% trading fee → protocol revenue
 *  - Sentient phase: 30% fees → creators, 70% → agent wallet + SubDAO
 *
 *  CONTRACTS (Base):
 *  - Agent Creation Factory (proxy contract handles on-chain creation)
 *  - Protocol contracts: github.com/Virtual-Protocol/protocol-contracts
 *  - SDK: github.com/Virtual-Protocol/react-virtual-ai (React components)
 *  - ACP SDK: github.com/Virtual-Protocol/acp-node (Node.js)
 *
 *  PROGRAMMATIC LAUNCH:
 *  Currently NO public REST API for token creation. Options:
 *  a) Browser automation via fun.virtuals.io (fragile)
 *  b) Direct contract interaction with AgentFactory on Base
 *     - Need to reverse-engineer from protocol-contracts repo
 *     - Requires $VIRTUAL token approval + factory call
 *  c) Best approach: Create launch record in AgentFolio, provide
 *     guided flow to complete on fun.virtuals.io, then link back
 *     with token address once live
 *
 *  PRE-BUY TABLE (VIRTUAL needed for % of supply):
 *    1,100 → 15%  |  2,600 → 30%  |  4,100 → 40%
 *    6,000 → 50%  |  9,000 → 60%  |  14,000 → 70%
 *   24,000 → 80%  | 42,000 → 87.5% (graduation)
 * ════════════════════════════════════════════════════════════════
 */

function canLaunch(profile) {
  if (!profile) return { allowed: false, reason: 'Profile not found' };
  const existing = getProfileLaunches(profile.id);
  const activeLaunches = existing.filter(l => [LAUNCH_STATUS.LIVE, LAUNCH_STATUS.BONDING, LAUNCH_STATUS.GRADUATED].includes(l.status));
  if (activeLaunches.length >= 3) {
    return { allowed: false, reason: 'Maximum 3 active tokens per profile' };
  }
  return { allowed: true };
}

function getProfileLaunches(profileId) {
  const launchFile = path.join(LAUNCHES_DIR, `${profileId}.json`);
  if (!fs.existsSync(launchFile)) return [];
  try { return JSON.parse(fs.readFileSync(launchFile, 'utf8')); } catch { return []; }
}

function getAllLaunches() {
  if (!fs.existsSync(LAUNCHES_DIR)) return [];
  const launches = [];
  for (const file of fs.readdirSync(LAUNCHES_DIR)) {
    if (!file.endsWith('.json')) continue;
    try {
      launches.push(...JSON.parse(fs.readFileSync(path.join(LAUNCHES_DIR, file), 'utf8')));
    } catch {}
  }
  return launches.sort((a, b) => new Date(b.launchedAt || b.createdAt) - new Date(a.launchedAt || a.createdAt));
}

function saveLaunch(profileId, launch) {
  const launches = getProfileLaunches(profileId);
  const idx = launches.findIndex(l => l.id === launch.id);
  if (idx >= 0) launches[idx] = launch; else launches.push(launch);
  fs.writeFileSync(path.join(LAUNCHES_DIR, `${profileId}.json`), JSON.stringify(launches, null, 2));
}

/**
 * Launch a token — supports Virtuals Protocol, pump.fun, or linking existing
 */
async function launchToken(profileId, opts) {
  const {
    name, symbol, description, imagePath, imageUrl,
    initialBuyTokens = 1000000, website,
    platform = 'virtuals',  // Default to Virtuals (primary platform)
    tokenAddress, chain = 'solana',
    agentType = 'ON-CHAIN',
    preBuyVirtual = 100,    // Virtuals: how much $VIRTUAL to pre-buy with
    virtualsChain = 'solana' // Virtuals: which chain to launch on
  } = opts;

  const profile = loadProfile(profileId);
  if (!profile) throw new Error('Profile not found');

  const check = canLaunch(profile);
  if (!check.allowed) throw new Error(check.reason);

  if (!name || name.length < 2 || name.length > 32) throw new Error('Name must be 2-32 characters');
  if (!symbol || symbol.length < 2 || symbol.length > 10) throw new Error('Symbol must be 2-10 characters');
  if (platform !== 'existing' && (!description || description.length < 10)) throw new Error('Description must be at least 10 characters');
  if (platform === 'existing' && !tokenAddress) throw new Error('Token address required for existing tokens');
  if (!['virtuals', 'pumpfun', 'existing'].includes(platform)) throw new Error('Invalid platform');

  const launchId = `launch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const resolvedChain = platform === 'virtuals' ? virtualsChain : (platform === 'pumpfun' ? 'solana' : chain);

  const launch = {
    id: launchId,
    profileId,
    profileName: profile.name,
    name,
    symbol: symbol.toUpperCase(),
    description: description || '',
    status: platform === 'existing' ? LAUNCH_STATUS.LIVE : LAUNCH_STATUS.PENDING,
    chain: resolvedChain,
    platform,
    agentType: platform === 'virtuals' ? agentType : null,
    preBuyVirtual: platform === 'virtuals' ? preBuyVirtual : null,
    createdAt: new Date().toISOString(),
    launchedAt: platform === 'existing' ? new Date().toISOString() : null,
    graduatedAt: null,
    mint: platform === 'existing' ? tokenAddress : null,
    tokenAddress: platform === 'existing' ? tokenAddress : null,
    prototypeAddress: null,  // Virtuals Base: prototype token before graduation
    sentientAddress: null,   // Virtuals Base: final token after graduation
    signature: null,
    virtualsUrl: null,       // https://app.virtuals.io/prototypes/{address}
    funVirtualsUrl: null,    // https://fun.virtuals.io/...
    pumpUrl: null,
    dexscreenerUrl: null,
    mcap: null,
    holders: null,
    totalBurned: 0,
    burnHistory: [],
    error: null
  };

  saveLaunch(profileId, launch);
  logger.info(`Token launch initiated: ${symbol} on ${platform} (${resolvedChain}) for ${profileId}`);

  if (platform === 'existing') {
    _updateProfileTokens(profile, launch);
    return launch;
  }

  if (platform === 'virtuals') {
    return _launchVirtuals(profileId, profile, launch, opts);
  }

  if (platform === 'pumpfun') {
    return _launchPumpFun(profileId, profile, launch, { imagePath, imageUrl, initialBuyTokens, website });
  }

  throw new Error('Unsupported platform');
}

/**
 * Launch on Virtuals Protocol
 *
 * Since there's no public REST API, we create a guided launch flow:
 * 1. Create launch record in AgentFolio with all metadata
 * 2. Provide direct link to fun.virtuals.io with pre-filled context
 * 3. User completes launch on Virtuals (connects wallet, pays 100 VIRTUAL)
 * 4. User returns to AgentFolio and provides the prototype token address
 * 5. AgentFolio tracks graduation status
 *
 * The launch record stays in PENDING until the user provides the token address,
 * then moves to BONDING, and finally GRADUATED/LIVE when the bonding curve completes.
 */
async function _launchVirtuals(profileId, profile, launch, opts) {
  const { virtualsChain = 'solana' } = opts;

  try {
    launch.status = LAUNCH_STATUS.PENDING;
    launch.funVirtualsUrl = 'https://fun.virtuals.io/';
    launch.virtualsUrl = null; // Will be set once prototype address is known

    // Calculate estimated cost
    const preBuy = opts.preBuyVirtual || 100;
    let estimatedSupplyPct = '0%';
    if (preBuy >= 42000) estimatedSupplyPct = '87.5%';
    else if (preBuy >= 24000) estimatedSupplyPct = '~80%';
    else if (preBuy >= 14000) estimatedSupplyPct = '~70%';
    else if (preBuy >= 9000) estimatedSupplyPct = '~60%';
    else if (preBuy >= 6000) estimatedSupplyPct = '~50%';
    else if (preBuy >= 4100) estimatedSupplyPct = '~40%';
    else if (preBuy >= 2600) estimatedSupplyPct = '~30%';
    else if (preBuy >= 1100) estimatedSupplyPct = '~15%';

    launch.metadata = {
      virtualsChain,
      preBuyVirtual: preBuy,
      estimatedSupplyPct,
      estimatedCost: `${preBuy} $VIRTUAL`,
      graduationThreshold: '42,000 $VIRTUAL',
      tokenSupply: '1,000,000,000',
      dexTarget: virtualsChain === 'solana' ? 'Meteora' : 'Uniswap V2',
      instructions: [
        `Go to https://fun.virtuals.io/ and click "Create New Agent"`,
        `Select chain: ${virtualsChain === 'solana' ? 'Solana' : 'Base'}`,
        `Fill in: Name="${launch.name}", Ticker="${launch.symbol}", Description="${launch.description}"`,
        `Upload your agent's profile picture`,
        `Select agent type: ${opts.agentType || 'ON-CHAIN'}`,
        `Connect wallet with ≥${preBuy} $VIRTUAL`,
        `Confirm creation (100 $VIRTUAL fee${preBuy > 100 ? ` + ${preBuy - 100} pre-buy` : ''})`,
        `Copy the prototype token address and come back to AgentFolio to link it`
      ]
    };

    saveLaunch(profileId, launch);
    logger.info(`Virtuals launch created (pending user action): ${launch.symbol} on ${virtualsChain}`);
    return launch;

  } catch (err) {
    launch.status = LAUNCH_STATUS.FAILED;
    launch.error = err.message;
    saveLaunch(profileId, launch);
    throw err;
  }
}

/**
 * Launch on pump.fun via PumpPortal API
 */
async function _launchPumpFun(profileId, profile, launch, { imagePath, imageUrl, initialBuyTokens, website }) {
  try {
    launch.status = LAUNCH_STATUS.LAUNCHING;
    saveLaunch(profileId, launch);

    const { launch: pumpLaunch } = require(PUMP_LAUNCH_PATH);

    let finalImagePath = imagePath;
    if (!finalImagePath && profile.avatar) {
      const cachedAvatar = path.join(__dirname, '..', '..', 'data', 'avatars', `${profileId}.png`);
      if (fs.existsSync(cachedAvatar)) finalImagePath = cachedAvatar;
    }

    const agentWebsite = website || profile.website || `https://agentfolio.bot/profile/${profileId}`;
    const result = await pumpLaunch(launch.name, launch.symbol, launch.description, finalImagePath, initialBuyTokens, agentWebsite);

    launch.status = LAUNCH_STATUS.LIVE;
    launch.launchedAt = new Date().toISOString();
    launch.mint = result.mint;
    launch.tokenAddress = result.mint;
    launch.signature = result.signature;
    launch.pumpUrl = result.pumpUrl;
    launch.dexscreenerUrl = result.dexscreener;
    saveLaunch(profileId, launch);

    _updateProfileTokens(profile, launch);
    logger.info(`Token launched on pump.fun: ${launch.symbol} → ${result.mint}`);
    return launch;

  } catch (err) {
    launch.status = LAUNCH_STATUS.FAILED;
    launch.error = err.message;
    saveLaunch(profileId, launch);
    throw err;
  }
}

function _updateProfileTokens(profile, launch) {
  if (!profile.tokens) profile.tokens = [];
  profile.tokens.push({
    name: launch.name,
    symbol: launch.symbol,
    chain: launch.chain,
    platform: launch.platform,
    mint: launch.mint || launch.tokenAddress,
    tokenAddress: launch.tokenAddress || launch.mint,
    pumpUrl: launch.pumpUrl,
    virtualsUrl: launch.virtualsUrl,
    launchedAt: launch.launchedAt
  });
  dbSaveProfile(profile);
}

function getLaunch(launchId) {
  return getAllLaunches().find(l => l.id === launchId);
}

/**
 * Link a Virtuals prototype token address to a pending launch
 */
function linkVirtualsToken(launchId, { tokenAddress, prototypeAddress }) {
  const all = getAllLaunches();
  const launch = all.find(l => l.id === launchId);
  if (!launch) throw new Error('Launch not found');
  if (launch.platform !== 'virtuals') throw new Error('Not a Virtuals launch');

  const addr = tokenAddress || prototypeAddress;
  launch.prototypeAddress = addr;
  launch.tokenAddress = addr;
  launch.mint = addr;
  launch.status = LAUNCH_STATUS.BONDING;
  launch.launchedAt = new Date().toISOString();

  // Build URLs
  if (launch.chain === 'solana') {
    launch.virtualsUrl = `https://app.virtuals.io/prototypes/${addr}`;
    launch.dexscreenerUrl = `https://dexscreener.com/solana/${addr}`;
  } else {
    launch.virtualsUrl = `https://app.virtuals.io/prototypes/${addr}`;
    launch.dexscreenerUrl = `https://dexscreener.com/base/${addr}`;
  }

  saveLaunch(launch.profileId, launch);

  const profile = loadProfile(launch.profileId);
  if (profile) _updateProfileTokens(profile, launch);

  logger.info(`Virtuals token linked: ${launch.symbol} → ${addr} (bonding)`);
  return launch;
}

/**
 * Mark a Virtuals launch as graduated (bonding curve completed → DEX)
 */
function graduateVirtualsToken(launchId, { sentientAddress, dexUrl }) {
  const all = getAllLaunches();
  const launch = all.find(l => l.id === launchId);
  if (!launch) throw new Error('Launch not found');

  launch.status = LAUNCH_STATUS.GRADUATED;
  launch.graduatedAt = new Date().toISOString();
  if (sentientAddress) {
    launch.sentientAddress = sentientAddress;
    // On Base, token address changes after graduation
    if (launch.chain === 'base') {
      launch.tokenAddress = sentientAddress;
      launch.mint = sentientAddress;
    }
  }
  if (dexUrl) launch.dexscreenerUrl = dexUrl;

  saveLaunch(launch.profileId, launch);
  logger.info(`Virtuals token graduated: ${launch.symbol} → sentient`);
  return launch;
}

/**
 * Complete a pending launch (generic — works for any platform)
 */
function completeLaunch(launchId, { tokenAddress, chain }) {
  const all = getAllLaunches();
  const launch = all.find(l => l.id === launchId);
  if (!launch) throw new Error('Launch not found');
  if (launch.status === LAUNCH_STATUS.LIVE && launch.tokenAddress) throw new Error('Launch already completed');

  launch.status = LAUNCH_STATUS.LIVE;
  launch.tokenAddress = tokenAddress;
  launch.mint = tokenAddress;
  launch.chain = chain || launch.chain;
  launch.launchedAt = new Date().toISOString();
  launch.error = null;
  saveLaunch(launch.profileId, launch);

  const profile = loadProfile(launch.profileId);
  if (profile) _updateProfileTokens(profile, launch);
  return launch;
}

function getTokenStats() {
  const all = getAllLaunches();
  const active = all.filter(l => [LAUNCH_STATUS.LIVE, LAUNCH_STATUS.BONDING, LAUNCH_STATUS.GRADUATED].includes(l.status));

  const platformBreakdown = { virtuals: 0, pumpfun: 0, existing: 0 };
  const chainBreakdown = { solana: 0, base: 0 };
  let totalBurned = 0;
  let bondingCount = 0;
  let graduatedCount = 0;

  for (const l of active) {
    if (platformBreakdown[l.platform] !== undefined) platformBreakdown[l.platform]++;
    if (chainBreakdown[l.chain] !== undefined) chainBreakdown[l.chain]++;
    totalBurned += l.totalBurned || 0;
    if (l.status === LAUNCH_STATUS.BONDING) bondingCount++;
    if (l.status === LAUNCH_STATUS.GRADUATED) graduatedCount++;
  }

  return {
    totalTokens: active.length,
    totalLaunches: all.length,
    totalMcap: null,
    platformBreakdown,
    chainBreakdown,
    totalBurned,
    bondingCount,
    graduatedCount,
    recentLaunches: active.slice(0, 10).map(l => ({
      id: l.id,
      symbol: l.symbol,
      name: l.name,
      platform: l.platform,
      chain: l.chain,
      status: l.status,
      profileId: l.profileId,
      profileName: l.profileName,
      launchedAt: l.launchedAt,
      tokenAddress: l.tokenAddress || l.mint,
      virtualsUrl: l.virtualsUrl,
      pumpUrl: l.pumpUrl
    }))
  };
}

/**
 * Record a buyback-and-burn
 *
 * Jupiter Swap API (Solana buybacks):
 *   GET  https://quote-api.jup.ag/v6/quote?inputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&outputMint={agentToken}&amount={amountInSmallestUnit}&slippageBps=100
 *   POST https://quote-api.jup.ag/v6/swap { quoteResponse, userPublicKey, wrapAndUnwrapSol: true }
 *   Returns: { swapTransaction } (base64, sign & send)
 */
function recordBuyback(agentId, { amountUSDC, jobId, tokensAcquired = 0, txSignature = null }) {
  const launches = getProfileLaunches(agentId);
  const activeLaunch = launches.find(l => [LAUNCH_STATUS.LIVE, LAUNCH_STATUS.GRADUATED, LAUNCH_STATUS.BONDING].includes(l.status));
  if (!activeLaunch) throw new Error(`No active token found for agent ${agentId}`);

  const record = {
    id: `bb_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    jobId,
    amountUSDC,
    tokensAcquired,
    txSignature,
    timestamp: new Date().toISOString()
  };

  activeLaunch.totalBurned = (activeLaunch.totalBurned || 0) + tokensAcquired;
  if (!activeLaunch.burnHistory) activeLaunch.burnHistory = [];
  activeLaunch.burnHistory.push(record);
  saveLaunch(agentId, activeLaunch);

  const bbFile = path.join(BUYBACKS_DIR, `${agentId}.json`);
  let buybacks = [];
  try { buybacks = JSON.parse(fs.readFileSync(bbFile, 'utf8')); } catch {}
  buybacks.push(record);
  fs.writeFileSync(bbFile, JSON.stringify(buybacks, null, 2));

  logger.info(`Buyback recorded for ${agentId}: $${amountUSDC} USDC, ${tokensAcquired} tokens burned`);
  return record;
}

module.exports = {
  LAUNCH_STATUS,
  PLATFORMS,
  canLaunch,
  launchToken,
  getProfileLaunches,
  getAllLaunches,
  getLaunch,
  getTokenStats,
  recordBuyback,
  completeLaunch,
  linkVirtualsToken,
  graduateVirtualsToken,
  saveLaunch
};
