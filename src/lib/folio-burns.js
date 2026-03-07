/**
 * $FOLIO Burn Tracker
 */

const fs = require('fs');
const path = require('path');

const BURNS_FILE = path.join(__dirname, '../../data/burns.json');
const TOTAL_SUPPLY = 1_000_000_000; // 1B FOLIO

function loadBurns() {
  if (!fs.existsSync(BURNS_FILE)) {
    // Seed with mock data
    const seed = generateMockBurns();
    fs.writeFileSync(BURNS_FILE, JSON.stringify(seed, null, 2));
    return seed;
  }
  return JSON.parse(fs.readFileSync(BURNS_FILE, 'utf8'));
}

function saveBurns(burns) {
  fs.writeFileSync(BURNS_FILE, JSON.stringify(burns, null, 2));
}

function generateMockBurns() {
  const burns = [];
  const sources = ['Escrow Fee', 'Marketplace Fee', 'Token Launch Fee', 'Buyback & Burn'];
  const now = Date.now();
  for (let i = 0; i < 50; i++) {
    const daysAgo = Math.floor(Math.random() * 90);
    burns.push({
      id: `burn-${i + 1}`,
      date: new Date(now - daysAgo * 86400000).toISOString(),
      amount: Math.floor(Math.random() * 50000) + 100,
      source: sources[Math.floor(Math.random() * sources.length)],
      jobId: `job-${Math.floor(Math.random() * 200) + 1}`,
      txHash: '0x' + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join(''),
    });
  }
  burns.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  return burns;
}

function addBurn(amount, source, jobId, txHash) {
  const burns = loadBurns();
  const burn = {
    id: `burn-${Date.now()}`,
    date: new Date().toISOString(),
    amount,
    source,
    jobId: jobId || null,
    txHash: txHash || null,
  };
  burns.unshift(burn);
  saveBurns(burns);
  return burn;
}

function getBurnStats() {
  const burns = loadBurns();
  const totalBurned = burns.reduce((sum, b) => sum + b.amount, 0);
  
  const now = Date.now();
  const day = 86400000;
  const dailyBurns = burns.filter(b => now - new Date(b.date).getTime() < day).reduce((s, b) => s + b.amount, 0);
  const weeklyBurns = burns.filter(b => now - new Date(b.date).getTime() < 7 * day).reduce((s, b) => s + b.amount, 0);
  const monthlyBurns = burns.filter(b => now - new Date(b.date).getTime() < 30 * day).reduce((s, b) => s + b.amount, 0);

  const avgDaily = monthlyBurns / 30;
  const remaining = TOTAL_SUPPLY - totalBurned;
  const nextBurnEstimate = avgDaily > 0 ? `~${Math.ceil(remaining / avgDaily)} days to burn all` : 'N/A';

  return {
    totalBurned,
    totalSupply: TOTAL_SUPPLY,
    burnPercent: ((totalBurned / TOTAL_SUPPLY) * 100).toFixed(4),
    dailyBurns,
    weeklyBurns,
    monthlyBurns,
    avgDailyBurn: Math.round(avgDaily),
    nextBurnEstimate,
    burnCount: burns.length,
    burns,
  };
}

module.exports = { loadBurns, addBurn, getBurnStats, TOTAL_SUPPLY };
