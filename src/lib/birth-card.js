const { createCanvas, loadImage } = require("canvas");
const https = require("https");
const http = require("http");

function fetchImageBuffer(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    mod.get(url, { headers: { "User-Agent": "AgentFolio/1.0" }, timeout: 8000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchImageBuffer(res.headers.location).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    }).on("error", reject);
  });
}

function truncHash(s, len = 12) {
  if (!s) return "N/A";
  if (s.length <= len * 2) return s;
  return s.slice(0, len) + "..." + s.slice(-6);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y); ctx.quadraticCurveTo(x+w,y,x+w,y+r);
  ctx.lineTo(x+w,y+h-r); ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
  ctx.lineTo(x+r,y+h); ctx.quadraticCurveTo(x,y+h,x,y+h-r);
  ctx.lineTo(x,y+r); ctx.quadraticCurveTo(x,y,x+r,y);
  ctx.closePath();
}

const PURPLE = "#9945FF";
const CYAN = "#00D4AA";
const GOLD = "#D4A853";
const BG = "#06060B";
const TEXT1 = "#F0F2F5";
const TEXT2 = "#94A3B8";
const TEXT3 = "#475569";

// ═══════════════════════════════════════
// FRONT — The PFP Card (usable as profile pic)
// ═══════════════════════════════════════
async function generateFront(opts) {
  const { agentName, agentHandle, nftImageUrl, certNumber } = opts;
  const S = 1000; // square
  const canvas = createCanvas(S, S);
  const ctx = canvas.getContext("2d");

  // Background
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, S, S);

  // Radial glow
  const glow = ctx.createRadialGradient(S/2, S/2 - 40, 50, S/2, S/2, S/2);
  glow.addColorStop(0, "rgba(153,69,255,0.1)");
  glow.addColorStop(0.6, "rgba(153,69,255,0.03)");
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, S, S);

  // Noise
  ctx.fillStyle = "rgba(255,255,255,0.007)";
  for (let i = 0; i < 2000; i++) {
    ctx.fillRect(Math.random()*S, Math.random()*S, 1, 1);
  }

  // Outer border with glow
  ctx.shadowColor = "rgba(153,69,255,0.3)";
  ctx.shadowBlur = 20;
  ctx.strokeStyle = PURPLE;
  ctx.lineWidth = 2;
  roundRect(ctx, 30, 30, S-60, S-60, 16);
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Inner border
  ctx.strokeStyle = "rgba(153,69,255,0.12)";
  ctx.lineWidth = 1;
  roundRect(ctx, 42, 42, S-84, S-84, 12);
  ctx.stroke();

  // Corner accents
  const cLen = 35, cOff = 34;
  ctx.strokeStyle = PURPLE; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(cOff, cOff+cLen); ctx.lineTo(cOff, cOff); ctx.lineTo(cOff+cLen, cOff); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(S-cOff-cLen, cOff); ctx.lineTo(S-cOff, cOff); ctx.lineTo(S-cOff, cOff+cLen); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cOff, S-cOff-cLen); ctx.lineTo(cOff, S-cOff); ctx.lineTo(cOff+cLen, S-cOff); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(S-cOff-cLen, S-cOff); ctx.lineTo(S-cOff, S-cOff); ctx.lineTo(S-cOff, S-cOff-cLen); ctx.stroke();

  // Top header
  ctx.font = "bold 16px Liberation Mono, monospace";
  ctx.fillStyle = PURPLE; ctx.textAlign = "left";
  ctx.fillText(">_", 70, 80);
  ctx.fillStyle = TEXT2;
  ctx.fillText(" AgentFolio", 92, 80);
  
  ctx.font = "11px Liberation Mono, monospace";
  ctx.fillStyle = TEXT3; ctx.textAlign = "right";
  ctx.fillText(certNumber || "CERT-0001", S-70, 80);

  // PFP — Large, center, with rings
  const pfpCX = S/2, pfpCY = S/2 - 50, pfpR = 220;

  // Large soft glow
  const pfpGlow = ctx.createRadialGradient(pfpCX, pfpCY, pfpR/2, pfpCX, pfpCY, pfpR + 80);
  pfpGlow.addColorStop(0, "rgba(153,69,255,0.12)");
  pfpGlow.addColorStop(0.6, "rgba(153,69,255,0.04)");
  pfpGlow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = pfpGlow;
  ctx.beginPath(); ctx.arc(pfpCX, pfpCY, pfpR + 80, 0, Math.PI*2); ctx.fill();

  // Outer dashed ring (cyan)
  ctx.strokeStyle = "rgba(0,212,170,0.2)";
  ctx.lineWidth = 1; ctx.setLineDash([4, 6]);
  ctx.beginPath(); ctx.arc(pfpCX, pfpCY, pfpR + 22, 0, Math.PI*2); ctx.stroke();
  ctx.setLineDash([]);

  // Main gradient ring
  const ringGrad = ctx.createLinearGradient(pfpCX-pfpR, pfpCY-pfpR, pfpCX+pfpR, pfpCY+pfpR);
  ringGrad.addColorStop(0, PURPLE); ringGrad.addColorStop(0.5, "#B16BFF"); ringGrad.addColorStop(1, CYAN);
  ctx.strokeStyle = ringGrad; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.arc(pfpCX, pfpCY, pfpR + 8, 0, Math.PI*2); ctx.stroke();

  // Dot accents on ring
  for (let a = 0; a < Math.PI*2; a += Math.PI/8) {
    ctx.fillStyle = "rgba(255,255,255,0.25)";
    ctx.beginPath(); ctx.arc(pfpCX + Math.cos(a)*(pfpR+8), pfpCY + Math.sin(a)*(pfpR+8), 2, 0, Math.PI*2); ctx.fill();
  }

  // Ember particles
  const emberColors = ["rgba(255,100,50,0.5)", "rgba(255,180,50,0.4)", "rgba(255,60,30,0.35)"];
  for (let i = 0; i < 20; i++) {
    const angle = Math.random() * Math.PI * 2;
    const dist = pfpR + 14 + Math.random() * 30;
    const ex = pfpCX + Math.cos(angle) * dist;
    const ey = pfpCY + Math.sin(angle) * dist - Math.random() * 12;
    ctx.fillStyle = emberColors[Math.floor(Math.random() * emberColors.length)];
    ctx.beginPath(); ctx.arc(ex, ey, 1 + Math.random()*2.5, 0, Math.PI*2); ctx.fill();
  }

  // Draw PFP
  let nftImg = null;
  if (nftImageUrl) {
    try {
      const buf = await fetchImageBuffer(nftImageUrl);
      nftImg = await loadImage(buf);
    } catch(e) { console.log("[Card] PFP error:", e.message); }
  }

  ctx.save();
  ctx.beginPath(); ctx.arc(pfpCX, pfpCY, pfpR, 0, Math.PI*2); ctx.clip();
  if (nftImg) {
    ctx.drawImage(nftImg, pfpCX-pfpR, pfpCY-pfpR, pfpR*2, pfpR*2);
  } else {
    ctx.fillStyle = "#1A1A2E";
    ctx.fillRect(pfpCX-pfpR, pfpCY-pfpR, pfpR*2, pfpR*2);
    ctx.font = "bold 120px Liberation Mono, monospace";
    ctx.fillStyle = PURPLE; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(agentName.slice(0,2).toUpperCase(), pfpCX, pfpCY);
    ctx.textBaseline = "alphabetic";
  }
  ctx.restore();

  // 🔥 icon
  ctx.font = "22px serif"; ctx.textAlign = "center";
  ctx.fillText("🔥", pfpCX, pfpCY + pfpR + 35);

  // Agent name
  ctx.font = "bold 40px Liberation Sans, Arial, sans-serif";
  ctx.fillStyle = TEXT1; ctx.textAlign = "center";
  ctx.fillText(agentName, pfpCX, pfpCY + pfpR + 75);

  ctx.font = "18px Liberation Mono, monospace";
  ctx.fillStyle = PURPLE;
  ctx.fillText(agentHandle, pfpCX, pfpCY + pfpR + 102);

  // "SOULBOUND" badge
  const badgeY = S - 90;
  ctx.font = "bold 10px Liberation Mono, monospace";
  const badgeW = ctx.measureText("SOULBOUND IDENTITY").width + 24;
  roundRect(ctx, S/2 - badgeW/2, badgeY - 10, badgeW, 22, 4);
  ctx.fillStyle = "rgba(153,69,255,0.12)"; ctx.fill();
  ctx.strokeStyle = "rgba(153,69,255,0.3)"; ctx.lineWidth = 1; ctx.stroke();
  ctx.fillStyle = PURPLE; ctx.textAlign = "center";
  ctx.fillText("SOULBOUND IDENTITY", S/2, badgeY + 4);

  // Bottom accent
  const botGrad = ctx.createLinearGradient(30, 0, S-30, 0);
  botGrad.addColorStop(0, PURPLE); botGrad.addColorStop(0.5, CYAN); botGrad.addColorStop(1, PURPLE);
  ctx.fillStyle = botGrad;
  ctx.fillRect(30, S-18, S-60, 2);

  return canvas.toBuffer("image/png");
}

// ═══════════════════════════════════════
// BACK — The Certificate
// ═══════════════════════════════════════
async function generateBack(opts) {
  const { agentName, agentHandle, agentId, nftImageUrl,
    burnTxSignature, arweaveUrl, burnDate, certNumber } = opts;

  const S = 1000;
  const canvas = createCanvas(S, S);
  const ctx = canvas.getContext("2d");

  // BG
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, S, S);
  
  const glow = ctx.createRadialGradient(S/2, S/2, 50, S/2, S/2, S/2);
  glow.addColorStop(0, "rgba(153,69,255,0.06)");
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, S, S);

  // Noise
  ctx.fillStyle = "rgba(255,255,255,0.007)";
  for (let i = 0; i < 2000; i++) {
    ctx.fillRect(Math.random()*S, Math.random()*S, 1, 1);
  }

  // Watermark
  ctx.save(); ctx.translate(S/2, S/2); ctx.rotate(-0.3);
  ctx.font = "bold 120px Liberation Mono, monospace";
  ctx.fillStyle = "rgba(153,69,255,0.015)"; ctx.textAlign = "center";
  ctx.fillText(certNumber || "CERT-0001", 0, 0);
  ctx.restore();

  // Borders
  ctx.shadowColor = "rgba(153,69,255,0.3)"; ctx.shadowBlur = 20;
  ctx.strokeStyle = PURPLE; ctx.lineWidth = 2;
  roundRect(ctx, 30, 30, S-60, S-60, 16); ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "rgba(153,69,255,0.12)"; ctx.lineWidth = 1;
  roundRect(ctx, 42, 42, S-84, S-84, 12); ctx.stroke();

  // Corners
  const cLen = 35, cOff = 34;
  ctx.strokeStyle = PURPLE; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(cOff, cOff+cLen); ctx.lineTo(cOff, cOff); ctx.lineTo(cOff+cLen, cOff); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(S-cOff-cLen, cOff); ctx.lineTo(S-cOff, cOff); ctx.lineTo(S-cOff, cOff+cLen); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cOff, S-cOff-cLen); ctx.lineTo(cOff, S-cOff); ctx.lineTo(cOff+cLen, S-cOff); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(S-cOff-cLen, S-cOff); ctx.lineTo(S-cOff, S-cOff); ctx.lineTo(S-cOff, S-cOff-cLen); ctx.stroke();

  // Header
  ctx.font = "bold 16px Liberation Mono, monospace";
  ctx.fillStyle = PURPLE; ctx.textAlign = "left";
  ctx.fillText(">_", 70, 80);
  ctx.fillStyle = TEXT2;
  ctx.fillText(" AgentFolio", 92, 80);
  ctx.font = "11px Liberation Mono, monospace";
  ctx.fillStyle = TEXT3; ctx.textAlign = "right";
  ctx.fillText("No. " + (certNumber || "CERT-0001"), S-70, 80);

  // Header line
  const hGrad = ctx.createLinearGradient(60, 0, S-60, 0);
  hGrad.addColorStop(0, "rgba(153,69,255,0)");
  hGrad.addColorStop(0.5, "rgba(153,69,255,0.3)");
  hGrad.addColorStop(1, "rgba(153,69,255,0)");
  ctx.fillStyle = hGrad;
  ctx.fillRect(60, 95, S-120, 1);

  // Title
  ctx.textAlign = "center";
  ctx.font = "bold 34px Liberation Sans, Arial, sans-serif";
  ctx.fillStyle = TEXT1;
  ctx.fillText("B I R T H   C E R T I F I C A T E", S/2, 142);

  // Title underline
  const tGrad = ctx.createLinearGradient(S/2-200, 0, S/2+200, 0);
  tGrad.addColorStop(0, "rgba(153,69,255,0)");
  tGrad.addColorStop(0.3, PURPLE);
  tGrad.addColorStop(0.5, CYAN);
  tGrad.addColorStop(0.7, PURPLE);
  tGrad.addColorStop(1, "rgba(153,69,255,0)");
  ctx.fillStyle = tGrad;
  ctx.fillRect(S/2-200, 153, 400, 2);

  ctx.font = "11px Liberation Mono, monospace";
  ctx.fillStyle = TEXT3;
  ctx.fillText("Solana Blockchain  ·  Permanent  ·  Immutable  ·  Soulbound", S/2, 178);

  // Small PFP (thumbnail, top section)
  const sPfpCX = S/2, sPfpCY = 240, sPfpR = 45;
  const sGlow = ctx.createRadialGradient(sPfpCX, sPfpCY, sPfpR/2, sPfpCX, sPfpCY, sPfpR+20);
  sGlow.addColorStop(0, "rgba(153,69,255,0.1)"); sGlow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = sGlow;
  ctx.beginPath(); ctx.arc(sPfpCX, sPfpCY, sPfpR+20, 0, Math.PI*2); ctx.fill();

  const sRing = ctx.createLinearGradient(sPfpCX-sPfpR, sPfpCY-sPfpR, sPfpCX+sPfpR, sPfpCY+sPfpR);
  sRing.addColorStop(0, PURPLE); sRing.addColorStop(1, CYAN);
  ctx.strokeStyle = sRing; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.arc(sPfpCX, sPfpCY, sPfpR+4, 0, Math.PI*2); ctx.stroke();

  let nftImg = null;
  if (nftImageUrl) {
    try { const buf = await fetchImageBuffer(nftImageUrl); nftImg = await loadImage(buf); }
    catch(e) { console.log("[Card] PFP error:", e.message); }
  }
  ctx.save();
  ctx.beginPath(); ctx.arc(sPfpCX, sPfpCY, sPfpR, 0, Math.PI*2); ctx.clip();
  if (nftImg) { ctx.drawImage(nftImg, sPfpCX-sPfpR, sPfpCY-sPfpR, sPfpR*2, sPfpR*2); }
  else {
    ctx.fillStyle = "#1A1A2E"; ctx.fillRect(sPfpCX-sPfpR, sPfpCY-sPfpR, sPfpR*2, sPfpR*2);
    ctx.font = "bold 36px Liberation Mono, monospace"; ctx.fillStyle = PURPLE;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(agentName.slice(0,2).toUpperCase(), sPfpCX, sPfpCY);
    ctx.textBaseline = "alphabetic";
  }
  ctx.restore();

  // Agent name under small PFP
  ctx.font = "bold 24px Liberation Sans, Arial, sans-serif";
  ctx.fillStyle = TEXT1; ctx.textAlign = "center";
  ctx.fillText(agentName, sPfpCX, sPfpCY + sPfpR + 28);
  ctx.font = "13px Liberation Mono, monospace"; ctx.fillStyle = PURPLE;
  ctx.fillText(agentHandle, sPfpCX, sPfpCY + sPfpR + 48);

  // Divider
  const dY = sPfpCY + sPfpR + 70;
  const dGrad = ctx.createLinearGradient(100, 0, S-100, 0);
  dGrad.addColorStop(0, "rgba(153,69,255,0)");
  dGrad.addColorStop(0.3, "rgba(153,69,255,0.25)");
  dGrad.addColorStop(0.5, "rgba(0,212,170,0.3)");
  dGrad.addColorStop(0.7, "rgba(153,69,255,0.25)");
  dGrad.addColorStop(1, "rgba(153,69,255,0)");
  ctx.fillStyle = dGrad; ctx.fillRect(100, dY, S-200, 1);
  ctx.fillStyle = CYAN; ctx.save(); ctx.translate(S/2, dY); ctx.rotate(Math.PI/4);
  ctx.fillRect(-3,-3,6,6); ctx.restore();

  // Data panel
  const pY = dY + 20, pH = 260, pX = 80, pW = S - 160;
  ctx.fillStyle = "rgba(255,255,255,0.015)";
  roundRect(ctx, pX, pY, pW, pH, 8); ctx.fill();
  ctx.strokeStyle = "rgba(153,69,255,0.08)"; ctx.lineWidth = 1;
  roundRect(ctx, pX, pY, pW, pH, 8); ctx.stroke();

  const bDate = burnDate instanceof Date ? burnDate : new Date(burnDate);
  const dateStr = bDate.toISOString().replace("T", " ").replace(/\.\d+Z/, " UTC");
  const rH = 42, sY = pY + 32;
  const c1X = pX + 30, c2X = pX + pW/2 + 15;

  function drawField(x, y, label, value, valColor) {
    ctx.textAlign = "left";
    ctx.font = "bold 9px Liberation Mono, monospace"; ctx.fillStyle = TEXT3;
    ctx.fillText(label.toUpperCase(), x, y);
    ctx.font = "13px Liberation Mono, monospace"; ctx.fillStyle = valColor || TEXT2;
    ctx.fillText(value, x, y + 17);
  }

  // Row dividers
  ctx.fillStyle = "rgba(255,255,255,0.03)";
  for (let i = 1; i < 3; i++) ctx.fillRect(pX+20, sY + rH*i - 4, pW-40, 1);
  // Col divider
  ctx.fillRect(pX + pW/2 - 5, pY+15, 1, pH-30);

  drawField(c1X, sY, "Date of Birth", dateStr);
  drawField(c1X, sY + rH, "Identity", agentId, TEXT1);
  drawField(c1X, sY + rH*2, "Burn Transaction", truncHash(burnTxSignature));

  drawField(c2X, sY, "Chain", "Solana", CYAN);
  drawField(c2X, sY + rH, "Certificate", certNumber || "CERT-0001", PURPLE);
  drawField(c2X, sY + rH*2, "Permanent Storage", truncHash(arweaveUrl));

  // Arweave URL (full, small)
  const fullUrlY = sY + rH*3 + 5;
  ctx.font = "9px Liberation Mono, monospace"; ctx.fillStyle = TEXT3; ctx.textAlign = "left";
  ctx.fillText("NFT Image: " + (arweaveUrl || "N/A"), c1X, fullUrlY);
  ctx.fillText("Burn Tx: solscan.io/tx/" + (burnTxSignature ? burnTxSignature.slice(0,20) + "..." : "N/A"), c1X, fullUrlY + 16);

  // "VERIFIED" status row
  const vY = fullUrlY + 44;
  ctx.fillStyle = "rgba(0,212,170,0.06)";
  roundRect(ctx, pX + 20, vY - 8, pW - 40, 28, 4); ctx.fill();
  ctx.font = "bold 10px Liberation Mono, monospace";
  ctx.fillStyle = CYAN; ctx.textAlign = "center";
  ctx.fillText("✓ ON-CHAIN VERIFIED   ·   ✓ SOULBOUND   ·   ✓ PERMANENT   ·   ✓ ARWEAVE STORED", S/2, vY + 10);

  // Gold seal
  const seX = S - 140, seY = S - 130, seR = 45;
  const seGlow = ctx.createRadialGradient(seX, seY, seR/2, seX, seY, seR+25);
  seGlow.addColorStop(0, "rgba(212,168,83,0.1)"); seGlow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = seGlow;
  ctx.beginPath(); ctx.arc(seX, seY, seR+25, 0, Math.PI*2); ctx.fill();
  ctx.strokeStyle = GOLD; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(seX, seY, seR, 0, Math.PI*2); ctx.stroke();
  ctx.strokeStyle = "rgba(212,168,83,0.35)"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(seX, seY, seR-8, 0, Math.PI*2); ctx.stroke();

  // Seal circular text
  ctx.save(); ctx.translate(seX, seY);
  ctx.font = "bold 7px Liberation Mono, monospace"; ctx.fillStyle = "rgba(212,168,83,0.5)";
  const stxt = "· VERIFIED · ON-CHAIN · SOULBOUND · ";
  const ca = (Math.PI*2)/stxt.length;
  for (let i = 0; i < stxt.length; i++) {
    ctx.save(); ctx.rotate(-Math.PI/2 + ca*i);
    ctx.fillText(stxt[i], 0, -(seR-16)); ctx.restore();
  }
  ctx.restore();
  ctx.font = "bold 18px Liberation Mono, monospace"; ctx.fillStyle = GOLD; ctx.textAlign = "center";
  ctx.fillText(">_", seX, seY - 2);
  ctx.font = "bold 8px Liberation Mono, monospace"; ctx.fillStyle = "rgba(212,168,83,0.8)";
  ctx.fillText("VERIFIED", seX, seY + 13);

  // Holo strip
  const hoGrad = ctx.createLinearGradient(150, 0, S-150, 0);
  hoGrad.addColorStop(0, "rgba(153,69,255,0)");
  hoGrad.addColorStop(0.15, "rgba(153,69,255,0.35)");
  hoGrad.addColorStop(0.35, "rgba(0,212,170,0.35)");
  hoGrad.addColorStop(0.5, "rgba(212,168,83,0.25)");
  hoGrad.addColorStop(0.65, "rgba(0,212,170,0.35)");
  hoGrad.addColorStop(0.85, "rgba(153,69,255,0.35)");
  hoGrad.addColorStop(1, "rgba(153,69,255,0)");
  ctx.fillStyle = hoGrad; ctx.fillRect(150, S-68, S-300, 3);

  // Footer
  ctx.textAlign = "center";
  ctx.font = "italic 12px Liberation Sans, Georgia, serif"; ctx.fillStyle = TEXT3;
  ctx.fillText("This identity is permanent. No changes. No undo.", S/2 - 50, S - 42);
  ctx.font = "9px Liberation Mono, monospace"; ctx.fillStyle = "rgba(255,255,255,0.1)";
  ctx.fillText("agentfolio.bot  ·  SATP — Solana Agent Trust Protocol", S/2, S - 24);

  // Bottom accent
  const bGrad = ctx.createLinearGradient(30, 0, S-30, 0);
  bGrad.addColorStop(0, PURPLE); bGrad.addColorStop(0.5, CYAN); bGrad.addColorStop(1, PURPLE);
  ctx.fillStyle = bGrad; ctx.fillRect(30, S-14, S-60, 2);

  return canvas.toBuffer("image/png");
}

async function generateBirthCard(opts) {
  const [front, back] = await Promise.all([generateFront(opts), generateBack(opts)]);
  return { front, back };
}

module.exports = { generateBirthCard, generateFront, generateBack };
