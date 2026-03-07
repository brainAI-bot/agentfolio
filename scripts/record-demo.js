#!/usr/bin/env node
/**
 * AgentFolio Demo Video Generator
 * Takes screenshots of key pages, compiles into a smooth video with ffmpeg
 */

const { chromium } = require('playwright');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://agentfolio.bot';
const FRAME_DIR = path.join(__dirname, '..', 'demo-frames');
const OUTPUT = path.join(__dirname, '..', 'demo-video.mp4');
const WIDTH = 1280;
const HEIGHT = 720;
const FRAME_DURATION = 80; // ms between scroll frames (smooth)

// Ensure frame dir
if (fs.existsSync(FRAME_DIR)) fs.rmSync(FRAME_DIR, { recursive: true });
fs.mkdirSync(FRAME_DIR, { recursive: true });

let frameNum = 0;

function pad(n) { return String(n).padStart(5, '0'); }

async function captureFrame(page) {
  const file = path.join(FRAME_DIR, `frame-${pad(frameNum++)}.png`);
  await page.screenshot({ path: file, type: 'png' });
}

async function holdFrames(page, count) {
  for (let i = 0; i < count; i++) await captureFrame(page);
}

async function smoothScroll(page, pixels, steps = 10) {
  const stepPx = Math.round(pixels / steps);
  for (let i = 0; i < steps; i++) {
    await page.evaluate((px) => window.scrollBy(0, px), stepPx);
    await page.waitForTimeout(FRAME_DURATION);
    await captureFrame(page);
  }
}

async function main() {
  console.log('🎬 Starting AgentFolio demo recording...');
  
  const browser = await chromium.launch({ 
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 1
  });
  const page = await context.newPage();

  // Scene 1: Homepage
  console.log('📸 Scene 1: Homepage');
  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1000);
  await holdFrames(page, 20);
  await smoothScroll(page, 800, 10);
  await holdFrames(page, 15);

  // Scene 2: brainKID profile
  console.log('📸 Scene 2: brainKID profile');
  await page.goto(`${BASE_URL}/profile/brainkid`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1000);
  await holdFrames(page, 25);
  await smoothScroll(page, 600, 10);
  await holdFrames(page, 20);

  // Scene 3: Marketplace
  console.log('📸 Scene 3: Marketplace');
  await page.goto(`${BASE_URL}/marketplace`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1000);
  await holdFrames(page, 20);
  await smoothScroll(page, 500, 8);
  await holdFrames(page, 20);

  // Scene 4: Leaderboard
  console.log('📸 Scene 4: Leaderboard');
  await page.goto(`${BASE_URL}/leaderboard`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1000);
  await holdFrames(page, 20);
  await smoothScroll(page, 400, 8);
  await holdFrames(page, 20);

  await browser.close();

  // Compile video with ffmpeg
  console.log(`\n🎥 Compiling ${frameNum} frames into video...`);
  
  const cmd = `ffmpeg -y -framerate 30 -i "${FRAME_DIR}/frame-%05d.png" \
    -vf "scale=1280:720:flags=lanczos" \
    -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p \
    -movflags +faststart \
    "${OUTPUT}"`;
  
  try {
    execSync(cmd, { stdio: 'pipe' });
    console.log(`\n✅ Demo video saved: ${OUTPUT}`);
    console.log(`   Frames: ${frameNum}`);
    const stats = fs.statSync(OUTPUT);
    console.log(`   Size: ${(stats.size / 1024 / 1024).toFixed(1)}MB`);
  } catch (e) {
    console.error('ffmpeg error:', e.stderr?.toString()?.slice(-500));
  }

  // Cleanup frames
  // fs.rmSync(FRAME_DIR, { recursive: true });
}

main().catch(console.error);
