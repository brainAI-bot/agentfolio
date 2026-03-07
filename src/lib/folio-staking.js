/**
 * $FOLIO Staking System
 */

const fs = require('fs');
const path = require('path');

const STAKING_DIR = path.join(__dirname, '../../data/staking');
const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const STAKING_TIERS = [
  { minStake: 500000, trustBonus: 100, badge: '👑', name: 'Sovereign' },
  { minStake: 100000, trustBonus: 50,  badge: '💎', name: 'Diamond' },
  { minStake: 25000,  trustBonus: 25,  badge: '🏆', name: 'Champion' },
  { minStake: 5000,   trustBonus: 10,  badge: '⭐', name: 'Starter' },
  { minStake: 0,      trustBonus: 0,   badge: '',   name: 'None' },
];

function ensureDir() {
  if (!fs.existsSync(STAKING_DIR)) fs.mkdirSync(STAKING_DIR, { recursive: true });
}

function stakePath(agentId) {
  return path.join(STAKING_DIR, `${agentId}.json`);
}

function loadStake(agentId) {
  ensureDir();
  const p = stakePath(agentId);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function saveStake(agentId, data) {
  ensureDir();
  fs.writeFileSync(stakePath(agentId), JSON.stringify(data, null, 2));
}

function stake(agentId, walletAddress, amount) {
  let existing = loadStake(agentId) || { agentId, walletAddress, stakedAmount: 0, stakedAt: null, rewards: 0, cooldownStart: null };
  existing.stakedAmount += amount;
  existing.walletAddress = walletAddress;
  existing.stakedAt = existing.stakedAt || new Date().toISOString();
  existing.cooldownStart = null;
  saveStake(agentId, existing);
  return existing;
}

function unstake(agentId) {
  const existing = loadStake(agentId);
  if (!existing || existing.stakedAmount <= 0) throw new Error('No active stake');
  if (existing.cooldownStart) throw new Error('Unstaking already in progress');
  existing.cooldownStart = new Date().toISOString();
  saveStake(agentId, existing);
  return existing;
}

function getStakeInfo(agentId) {
  const data = loadStake(agentId);
  if (!data) return { agentId, stakedAmount: 0, tier: STAKING_TIERS[STAKING_TIERS.length - 1], cooldown: null, rewards: 0 };
  
  const tier = STAKING_TIERS.find(t => data.stakedAmount >= t.minStake) || STAKING_TIERS[STAKING_TIERS.length - 1];
  
  let cooldown = null;
  if (data.cooldownStart) {
    const elapsed = Date.now() - new Date(data.cooldownStart).getTime();
    const remaining = Math.max(0, COOLDOWN_MS - elapsed);
    cooldown = { started: data.cooldownStart, remainingMs: remaining, complete: remaining === 0 };
  }

  // Simple rewards: 0.01% per day of staked amount
  const daysStaked = data.stakedAt ? (Date.now() - new Date(data.stakedAt).getTime()) / (86400000) : 0;
  const rewards = Math.floor(data.stakedAmount * 0.0001 * daysStaked);

  return { ...data, tier, cooldown, rewards };
}

function getLeaderboard(limit = 20) {
  ensureDir();
  const files = fs.readdirSync(STAKING_DIR).filter(f => f.endsWith('.json'));
  const stakers = files.map(f => {
    const data = JSON.parse(fs.readFileSync(path.join(STAKING_DIR, f), 'utf8'));
    const tier = STAKING_TIERS.find(t => data.stakedAmount >= t.minStake) || STAKING_TIERS[STAKING_TIERS.length - 1];
    return { ...data, tier };
  }).filter(s => s.stakedAmount > 0);
  
  stakers.sort((a, b) => b.stakedAmount - a.stakedAmount);
  return stakers.slice(0, limit);
}

module.exports = { STAKING_TIERS, COOLDOWN_MS, stake, unstake, getStakeInfo, getLeaderboard, loadStake };
