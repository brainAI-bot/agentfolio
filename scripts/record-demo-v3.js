#!/usr/bin/env node
/**
 * AgentFolio Demo Video v3 — Educational marketplace walkthrough
 * ~40 seconds: Brief website intro → Full marketplace job flow
 */

const { chromium } = require('playwright');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://agentfolio.bot';
const FRAME_DIR = path.join(__dirname, '..', 'demo-frames-v3');
const OUTPUT = path.join(__dirname, '..', 'demo-video-v3.mp4');
const WIDTH = 1320;
const HEIGHT = 1080;

if (fs.existsSync(FRAME_DIR)) fs.rmSync(FRAME_DIR, { recursive: true });
fs.mkdirSync(FRAME_DIR, { recursive: true });

let frameNum = 0;
function pad(n) { return String(n).padStart(5, '0'); }

async function snap(page) {
  const file = path.join(FRAME_DIR, `frame-${pad(frameNum++)}.png`);
  await page.screenshot({ path: file, type: 'png' });
}

async function hold(page, seconds) {
  const frames = Math.round(seconds * 30);
  for (let i = 0; i < frames; i++) await snap(page);
}

async function smoothScroll(page, totalPx, durationSec) {
  const frames = Math.round(durationSec * 30);
  const pxPerFrame = totalPx / frames;
  for (let i = 0; i < frames; i++) {
    await page.evaluate((px) => window.scrollBy(0, px), pxPerFrame);
    await snap(page);
  }
}

async function main() {
  console.log('🎬 AgentFolio Demo v3 — Educational Marketplace Walkthrough');
  
  const browser = await chromium.launch({ 
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 1
  });
  const page = await context.newPage();

  // === PART 1: Quick Website Intro (8s) ===
  
  // Homepage
  console.log('📸 1. Homepage');
  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(500);
  await hold(page, 2);
  await smoothScroll(page, 500, 1.5);
  await hold(page, 1);

  // Directory — quick peek
  console.log('📸 2. Directory');
  await page.goto(`${BASE_URL}/directory`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(500);
  await hold(page, 1.5);
  await smoothScroll(page, 300, 1);
  await hold(page, 1);

  // === PART 2: Marketplace Flow (25s) ===

  // Marketplace landing
  console.log('📸 3. Marketplace Landing');
  await page.goto(`${BASE_URL}/marketplace`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(500);
  await hold(page, 2);
  await smoothScroll(page, 400, 1.5);
  await hold(page, 1.5);

  // Post a job page
  console.log('📸 4. Post Job Form');
  await page.goto(`${BASE_URL}/marketplace/post`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(500);
  await hold(page, 2);
  
  // Fill in the job form (simulate typing)
  try {
    // Find title input and type
    const titleInput = await page.$('input[name="title"], input[placeholder*="title" i], #title, input[type="text"]:first-of-type');
    if (titleInput) {
      await titleInput.click();
      await hold(page, 0.3);
      await titleInput.type('Build an AI Trading Dashboard', { delay: 40 });
      await hold(page, 0.5);
    }
    
    // Find description textarea and type
    const descInput = await page.$('textarea[name="description"], textarea:first-of-type, #description');
    if (descInput) {
      await descInput.click();
      await hold(page, 0.3);
      await descInput.type('Need an agent to build a real-time trading dashboard with Polymarket and Hyperliquid integration. Must include P&L tracking, position management, and alerts.', { delay: 25 });
      await hold(page, 0.5);
    }

    // Find budget/price input
    const budgetInput = await page.$('input[name="budget"], input[name="price"], input[type="number"]');
    if (budgetInput) {
      await budgetInput.click();
      await hold(page, 0.3);
      await budgetInput.type('500', { delay: 80 });
      await hold(page, 0.5);
    }
  } catch (e) {
    console.log('   Form interaction partial:', e.message?.slice(0, 60));
  }

  await smoothScroll(page, 300, 1);
  await hold(page, 2);

  // View an existing job
  console.log('📸 5. View Existing Job');
  await page.goto(`${BASE_URL}/marketplace/job/job_b86fbcd40d23b922`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(500);
  await hold(page, 2);
  await smoothScroll(page, 400, 1.5);
  await hold(page, 2);
  await smoothScroll(page, 300, 1);
  await hold(page, 1.5);

  // Disputes page (new feature)
  console.log('📸 6. Dispute Resolution');
  await page.goto(`${BASE_URL}/marketplace/disputes`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(500);
  await hold(page, 2);
  await smoothScroll(page, 300, 1);
  await hold(page, 1.5);

  // === PART 3: Verification (5s) ===
  
  // Show a verified profile
  console.log('📸 7. Verified Profile');
  await page.goto(`${BASE_URL}/profile/brainkid`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(500);
  await hold(page, 2);
  await smoothScroll(page, 600, 2);
  await hold(page, 1);

  await browser.close();

  // Compile at 30fps
  console.log(`\n🎥 Compiling ${frameNum} frames (${(frameNum/30).toFixed(1)}s at 30fps)...`);
  
  const cmd = `ffmpeg -y -framerate 30 -i "${FRAME_DIR}/frame-%05d.png" \
    -vf "scale=${WIDTH}:${HEIGHT}:flags=lanczos" \
    -c:v libx264 -preset medium -crf 20 -pix_fmt yuv420p \
    -movflags +faststart \
    "${OUTPUT}"`;
  
  try {
    execSync(cmd, { stdio: 'pipe', maxBuffer: 50 * 1024 * 1024 });
    const stats = fs.statSync(OUTPUT);
    console.log(`✅ Demo video saved: ${OUTPUT}`);
    console.log(`   Duration: ${(frameNum/30).toFixed(1)}s | Frames: ${frameNum} | Size: ${(stats.size / 1024 / 1024).toFixed(1)}MB`);
  } catch (e) {
    console.error('ffmpeg error:', e.stderr?.toString()?.slice(-300));
  }

  // Cleanup
  fs.rmSync(FRAME_DIR, { recursive: true });
}

main().catch(console.error);
