/**
 * Birth Certificate Image Generator
 * Generates a certificate PNG after an agent burns their PFP NFT
 */

const { createCanvas, loadImage } = require('canvas');
const https = require('https');
const http = require('http');
const path = require('path');
const fs = require('fs');

const CERT_COUNTER_FILE = path.join(__dirname, '../../data/cert-counter.json');

function getNextCertNumber() {
  let counter = 0;
  try {
    if (fs.existsSync(CERT_COUNTER_FILE)) {
      counter = JSON.parse(fs.readFileSync(CERT_COUNTER_FILE, 'utf8')).count || 0;
    }
  } catch {}
  counter++;
  fs.writeFileSync(CERT_COUNTER_FILE, JSON.stringify({ count: counter }));
  return `CERT-${String(counter).padStart(4, '0')}`;
}

function fetchImageBuffer(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, { headers: { 'User-Agent': 'AgentFolio/1.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchImageBuffer(res.headers.location).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function truncate(str, len) {
  if (!str) return '—';
  return str.length > len ? str.slice(0, len) + '...' : str;
}

/**
 * Generate a birth certificate image
 * @returns {Promise<Buffer>} PNG buffer
 */
async function generateBirthCertificate({
  agentName,
  agentHandle,
  agentId,
  nftImageUrl,
  burnTxSignature,
  arweaveUrl,
  burnDate,
  certNumber
}) {
  const W = 1200, H = 800;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // Colors
  const BG = '#0A0A0F';
  const ACCENT = '#9945FF';
  const TEXT = '#E2E8F0';
  const SEC = '#94A3B8';
  const TERT = '#64748B';

  // Background
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);

  // Purple border (double line effect)
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = 2;
  ctx.strokeRect(20, 20, W - 40, H - 40);
  ctx.globalAlpha = 0.3;
  ctx.strokeRect(30, 30, W - 60, H - 60);
  ctx.globalAlpha = 1;

  // Corner accents
  const cornerSize = 20;
  ctx.fillStyle = ACCENT;
  [[25, 25], [W - 25 - cornerSize, 25], [25, H - 25 - cornerSize], [W - 25 - cornerSize, H - 25 - cornerSize]].forEach(([x, y]) => {
    ctx.fillRect(x, y, cornerSize, 2);
    ctx.fillRect(x, y, 2, cornerSize);
  });

  // Top: Logo + Title
  ctx.font = 'bold 18px "Liberation Sans", "DejaVu Sans", sans-serif';
  ctx.fillStyle = ACCENT;
  ctx.fillText('>_ AgentFolio', 60, 65);

  ctx.font = 'bold 28px "Liberation Sans", "DejaVu Sans", sans-serif';
  ctx.fillStyle = TEXT;
  const title = 'BIRTH CERTIFICATE';
  const titleW = ctx.measureText(title).width;
  ctx.fillText(title, (W - titleW) / 2, 70);

  // Thin accent line under title
  ctx.fillStyle = ACCENT;
  ctx.fillRect((W - 300) / 2, 82, 300, 1);

  // NFT Image (circular with purple ring)
  let nftImg = null;
  try {
    const buf = await fetchImageBuffer(nftImageUrl);
    nftImg = await loadImage(buf);
  } catch (e) {
    console.warn('[BirthCert] Could not load NFT image:', e.message);
  }

  const imgX = W / 2, imgY = 195, imgR = 80;
  // Purple ring
  ctx.beginPath();
  ctx.arc(imgX, imgY, imgR + 6, 0, Math.PI * 2);
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = 3;
  ctx.stroke();

  // Glow
  ctx.save();
  ctx.globalAlpha = 0.15;
  ctx.beginPath();
  ctx.arc(imgX, imgY, imgR + 15, 0, Math.PI * 2);
  ctx.fillStyle = ACCENT;
  ctx.fill();
  ctx.restore();

  if (nftImg) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(imgX, imgY, imgR, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(nftImg, imgX - imgR, imgY - imgR, imgR * 2, imgR * 2);
    ctx.restore();
  } else {
    // Placeholder
    ctx.beginPath();
    ctx.arc(imgX, imgY, imgR, 0, Math.PI * 2);
    ctx.fillStyle = '#1a1a2e';
    ctx.fill();
    ctx.font = 'bold 40px sans-serif';
    ctx.fillStyle = ACCENT;
    ctx.textAlign = 'center';
    ctx.fillText('?', imgX, imgY + 14);
    ctx.textAlign = 'start';
  }

  // Agent name + handle
  ctx.textAlign = 'center';
  ctx.font = 'bold 32px "Liberation Sans", "DejaVu Sans", sans-serif';
  ctx.fillStyle = TEXT;
  ctx.fillText(agentName || 'Unknown Agent', imgX, 310);

  if (agentHandle) {
    ctx.font = '18px "Noto Sans Mono", "DejaVu Sans Mono", monospace';
    ctx.fillStyle = ACCENT;
    ctx.fillText(agentHandle, imgX, 338);
  }

  // Certificate details (monospace terminal style)
  ctx.textAlign = 'left';
  ctx.font = '15px "Noto Sans Mono", "DejaVu Sans Mono", monospace';
  const detailsX = 200;
  let detailsY = 390;
  const lineH = 32;

  const fields = [
    ['born', burnDate ? new Date(burnDate).toISOString().replace('T', ' ').replace(/\.\d+Z/, ' UTC') : new Date().toISOString().replace('T', ' ').replace(/\.\d+Z/, ' UTC')],
    ['identity', agentId || '—'],
    ['burn_tx', truncate(burnTxSignature, 48)],
    ['arweave', truncate(arweaveUrl, 48)],
    ['certificate', certNumber || 'CERT-0000'],
    ['chain', 'Solana'],
  ];

  fields.forEach(([key, val]) => {
    ctx.fillStyle = TERT;
    ctx.fillText(`${key}:`, detailsX, detailsY);
    ctx.fillStyle = SEC;
    const keyW = ctx.measureText(`${key}: `).width;
    ctx.fillText(val, detailsX + Math.max(keyW, 130), detailsY);
    detailsY += lineH;
  });

  // Bottom text
  ctx.textAlign = 'center';
  ctx.font = '13px "Noto Sans Mono", "DejaVu Sans Mono", monospace';
  ctx.fillStyle = TERT;
  ctx.fillText('This identity is permanent. No changes. No undo.', W / 2, H - 60);

  // Bottom purple line
  ctx.fillStyle = ACCENT;
  ctx.fillRect(60, H - 45, W - 120, 1);

  // Watermark ">_" bottom right
  ctx.save();
  ctx.globalAlpha = 0.06;
  ctx.font = 'bold 120px "Liberation Sans", sans-serif';
  ctx.fillStyle = ACCENT;
  ctx.textAlign = 'right';
  ctx.fillText('>_', W - 50, H - 80);
  ctx.restore();

  return canvas.toBuffer('image/png');
}

module.exports = { generateBirthCertificate, getNextCertNumber };
