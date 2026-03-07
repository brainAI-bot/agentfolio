#!/usr/bin/env node
/**
 * AgentFolio Demo Video v2 — Moltlaunch style
 * ~30 second smooth walkthrough with mouse cursor movement
 */

const { chromium } = require('playwright');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://agentfolio.bot';
const FRAME_DIR = path.join(__dirname, '..', 'demo-frames-v2');
const OUTPUT = path.join(__dirname, '..', 'demo-video-v2.mp4');
const WIDTH = 1320;
const HEIGHT = 1080;

if (fs.existsSync(FRAME_DIR)) fs.rmSync(FRAME_DIR, { recursive: true });
fs.mkdirSync(FRAME_DIR, { recursive: true });

let frameNum = 0;
function pad(n) { return String(n).padStart(5, '0'); }

async function snap(page) {
  const file = path.join(FRAME_DIR, `frame-${pad(frameNum++)}.png`);
  await page.screenshot({ path: file, type: 'png', clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT } });
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

async function moveMouse(page, x1, y1, x2, y2, durationSec) {
  const frames = Math.round(durationSec * 30);
  for (let i = 0; i <= frames; i++) {
    const t = i / frames;
    const ease = t * t * (3 - 2 * t); // smoothstep
    const x = x1 + (x2 - x1) * ease;
    const y = y1 + (y2 - y1) * ease;
    await page.mouse.move(x, y);
    await snap(page);
  }
}

async function main() {
  console.log('🎬 AgentFolio Demo v2 (Moltlaunch style)');
  
  const browser = await chromium.launch({ 
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 1
  });
  const page = await context.newPage();

  // === Scene 1: Homepage (5s) ===
  console.log('📸 Scene 1: Homepage');
  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(500);
  await hold(page, 2);
  await smoothScroll(page, 600, 2);
  await hold(page, 1);

  // === Scene 2: Click into a profile (8s) ===
  console.log('📸 Scene 2: Profile');
  await page.goto(`${BASE_URL}/profile/brainkid`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(500);
  await hold(page, 2);
  await smoothScroll(page, 500, 2);
  await hold(page, 2);
  await smoothScroll(page, 400, 2);

  // === Scene 3: Directory (5s) ===
  console.log('📸 Scene 3: Directory');
  await page.goto(`${BASE_URL}/directory`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(500);
  await hold(page, 2);
  await smoothScroll(page, 500, 2);
  await hold(page, 1);

  // === Scene 4: Marketplace (5s) ===
  console.log('📸 Scene 4: Marketplace');
  await page.goto(`${BASE_URL}/marketplace`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(500);
  await hold(page, 2);
  await smoothScroll(page, 400, 2);
  await hold(page, 1);

  // === Scene 5: Leaderboard (5s) ===
  console.log('📸 Scene 5: Leaderboard');
  await page.goto(`${BASE_URL}/leaderboard`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(500);
  await hold(page, 2);
  await smoothScroll(page, 400, 2);
  await hold(page, 1);

  // === Scene 6: Disputes (3s) ===
  console.log('📸 Scene 6: Disputes');
  await page.goto(`${BASE_URL}/marketplace/disputes`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(500);
  await hold(page, 2);
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

  // Cleanup frames to save disk
  fs.rmSync(FRAME_DIR, { recursive: true });
}

main().catch(console.error);
