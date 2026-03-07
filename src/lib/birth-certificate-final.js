const { createCanvas, loadImage } = require("canvas");
const https = require("https");
const http = require("http");
const path = require("path");
const fs = require("fs");

const CERT_COUNTER_FILE = path.join(__dirname, "../../data/cert-counter.json");

function getNextCertNumber() {
  let counter = 0;
  try {
    if (fs.existsSync(CERT_COUNTER_FILE)) {
      counter = JSON.parse(fs.readFileSync(CERT_COUNTER_FILE, "utf8")).count || 0;
    }
  } catch {}
  counter++;
  fs.writeFileSync(CERT_COUNTER_FILE, JSON.stringify({ count: counter }));
  return `CERT-${String(counter).padStart(4, "0")}`;
}

function fetchImageBuffer(url) {
  return new Promise((resolve, reject) => {
    if (!url || !url.startsWith("http")) return reject(new Error("Invalid URL"));
    const mod = url.startsWith("https") ? https : http;
    mod.get(url, { headers: { "User-Agent": "AgentFolio/1.0" }, timeout: 10000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchImageBuffer(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error("HTTP " + res.statusCode));
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    }).on("error", reject);
  });
}

function truncHash(s, len = 16) {
  if (!s) return "N/A";
  if (s.length <= len + 6) return s;
  return s.slice(0, len) + "..." + s.slice(-6);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function hexToRgba(hex, a) {
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${a})`;
}

const S = 1080;
const PURPLE = "#9945FF";
const CYAN = "#14F195";
const MAGENTA = "#FF2D78";
const BG = "#05050A";
const TEXT1 = "#E8ECF1";
const TEXT2 = "#8B95A5";
const TEXT3 = "#3D4654";

async function generateCardFront(opts) {
  const { agentName, nftImageUrl } = opts;
  const W = S, H = S;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  let nftImg = null;
  if (nftImageUrl) {
    try { nftImg = await loadImage(await fetchImageBuffer(nftImageUrl)); }
    catch (e) { console.log("[CardFront] PFP load error:", e.message); }
  }
  if (nftImg) {
    const aspect = nftImg.width / nftImg.height;
    let sw = W, sh = H;
    if (aspect > 1) sw = H * aspect; else sh = W / aspect;
    ctx.drawImage(nftImg, (W - sw) / 2, (H - sh) / 2, sw, sh);
  } else {
    ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H);
    const glow = ctx.createRadialGradient(W/2, H/2, 50, W/2, H/2, 400);
    glow.addColorStop(0, "rgba(153,69,255,0.15)"); glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
    ctx.font = "bold 280px monospace"; ctx.fillStyle = PURPLE;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText((agentName || "??").slice(0, 2).toUpperCase(), W/2, H/2);
    ctx.textBaseline = "alphabetic";
  }
  return canvas.toBuffer("image/png");
}

async function generateCardBack(opts) {
  const { agentName, agentHandle, agentId, nftImageUrl,
    burnTxSignature, arweaveUrl, burnDate, certNumber } = opts;

  const W = S, H = S;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  // BG
  ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H);

  // Hex grid
  ctx.strokeStyle = "rgba(153,69,255,0.018)"; ctx.lineWidth = 0.5;
  const hexSize = 28;
  for (let row = 0; row < H / (hexSize * 1.5) + 1; row++) {
    for (let col = 0; col < W / (hexSize * Math.sqrt(3)) + 1; col++) {
      const cx = col * hexSize * Math.sqrt(3) + (row % 2 ? hexSize * Math.sqrt(3) / 2 : 0);
      const cy = row * hexSize * 1.5;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = Math.PI / 3 * i - Math.PI / 6;
        const px = cx + hexSize * Math.cos(a), py = cy + hexSize * Math.sin(a);
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.closePath(); ctx.stroke();
    }
  }

  // Scanlines
  ctx.fillStyle = "rgba(255,255,255,0.006)";
  for (let y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 1);

  // Ambient glows
  function addGlow(x, y, hex, alpha) {
    const g = ctx.createRadialGradient(x, y, 20, x, y, 320);
    g.addColorStop(0, hexToRgba(hex, alpha));
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  addGlow(180, 150, PURPLE, 0.06);
  addGlow(W - 120, H - 150, CYAN, 0.035);
  addGlow(W / 2, 500, MAGENTA, 0.015);

  // Noise
  ctx.fillStyle = "rgba(255,255,255,0.01)";
  for (let i = 0; i < 2000; i++) ctx.fillRect(Math.random()*W, Math.random()*H, Math.random()<0.1?2:1, 1);

  // Outer frame with glow
  ctx.shadowColor = "rgba(153,69,255,0.3)"; ctx.shadowBlur = 25;
  ctx.strokeStyle = PURPLE; ctx.lineWidth = 1;
  roundRect(ctx, 16, 16, W-32, H-32, 4); ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "rgba(153,69,255,0.12)"; ctx.lineWidth = 1;
  roundRect(ctx, 28, 28, W-56, H-56, 3); ctx.stroke();

  // HUD corner brackets
  const bLen = 35, bOff = 18;
  ctx.strokeStyle = CYAN; ctx.lineWidth = 2;
  [[bOff,bOff+bLen, bOff,bOff, bOff+bLen,bOff],
   [W-bOff-bLen,bOff, W-bOff,bOff, W-bOff,bOff+bLen],
   [bOff,H-bOff-bLen, bOff,H-bOff, bOff+bLen,H-bOff],
   [W-bOff-bLen,H-bOff, W-bOff,H-bOff, W-bOff,H-bOff-bLen]
  ].forEach(([x1,y1,x2,y2,x3,y3]) => {
    ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.lineTo(x3,y3); ctx.stroke();
  });

  // Header bar
  const hdrY = 42;
  ctx.fillStyle = "rgba(153,69,255,0.04)";
  ctx.fillRect(36, hdrY, W-72, 32);
  ctx.strokeStyle = "rgba(153,69,255,0.12)"; ctx.lineWidth = 1;
  ctx.strokeRect(36, hdrY, W-72, 32);
  ctx.font = "bold 13px monospace"; ctx.textAlign = "left";
  ctx.fillStyle = CYAN; ctx.fillText(">_", 50, hdrY+21);
  ctx.fillStyle = TEXT2; ctx.fillText(" AGENTFOLIO", 68, hdrY+21);
  ctx.fillStyle = TEXT3; ctx.fillText(" // IDENTITY PROTOCOL", 173, hdrY+21);
  ctx.font = "11px monospace"; ctx.fillStyle = PURPLE; ctx.textAlign = "right";
  ctx.fillText(certNumber || "CERT-0001", W-50, hdrY+21);

  // Title with glitch
  ctx.textAlign = "center"; ctx.font = "bold 28px monospace";
  ctx.fillStyle = "rgba(255,45,120,0.15)"; ctx.fillText("GENESIS RECORD", W/2+2, 118);
  ctx.fillStyle = "rgba(20,241,149,0.15)"; ctx.fillText("GENESIS RECORD", W/2-2, 118);
  ctx.fillStyle = TEXT1; ctx.fillText("GENESIS RECORD", W/2, 118);

  // Title underline
  const tg = ctx.createLinearGradient(W/2-220, 0, W/2+220, 0);
  tg.addColorStop(0, "rgba(153,69,255,0)"); tg.addColorStop(0.15, MAGENTA);
  tg.addColorStop(0.5, CYAN); tg.addColorStop(0.85, PURPLE); tg.addColorStop(1, "rgba(153,69,255,0)");
  ctx.fillStyle = tg; ctx.fillRect(W/2-220, 130, 440, 2);

  ctx.font = "10px monospace"; ctx.fillStyle = TEXT3;
  ctx.fillText("[ SOLANA ]  \u00b7  PERMANENT  \u00b7  IMMUTABLE  \u00b7  SOULBOUND", W/2, 150);

  // Avatar
  const pfpCX = W/2, pfpCY = 232, pfpR = 52;
  ctx.strokeStyle = "rgba(153,69,255,0.2)"; ctx.lineWidth = 1;
  ctx.setLineDash([8, 6]);
  ctx.beginPath(); ctx.arc(pfpCX, pfpCY, pfpR+16, 0, Math.PI*2); ctx.stroke();
  ctx.setLineDash([]);
  ctx.strokeStyle = "rgba(20,241,149,0.3)"; ctx.lineWidth = 1.5;
  [0, Math.PI/2, Math.PI, Math.PI*1.5].forEach(a => {
    const gap = pfpR+7;
    ctx.beginPath();
    ctx.moveTo(pfpCX+Math.cos(a)*gap, pfpCY+Math.sin(a)*gap);
    ctx.lineTo(pfpCX+Math.cos(a)*(gap+9), pfpCY+Math.sin(a)*(gap+9));
    ctx.stroke();
  });
  const ringGrad = ctx.createLinearGradient(pfpCX-pfpR, pfpCY-pfpR, pfpCX+pfpR, pfpCY+pfpR);
  ringGrad.addColorStop(0, PURPLE); ringGrad.addColorStop(0.5, CYAN); ringGrad.addColorStop(1, MAGENTA);
  ctx.strokeStyle = ringGrad; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.arc(pfpCX, pfpCY, pfpR+3, 0, Math.PI*2); ctx.stroke();

  let nftImg = null;
  if (nftImageUrl) {
    try { nftImg = await loadImage(await fetchImageBuffer(nftImageUrl)); }
    catch (e) { console.log("[CardBack] PFP load error:", e.message); }
  }
  ctx.save();
  ctx.beginPath(); ctx.arc(pfpCX, pfpCY, pfpR, 0, Math.PI*2); ctx.clip();
  if (nftImg) { ctx.drawImage(nftImg, pfpCX-pfpR, pfpCY-pfpR, pfpR*2, pfpR*2); }
  else {
    ctx.fillStyle = "#0D0D1A"; ctx.fillRect(pfpCX-pfpR, pfpCY-pfpR, pfpR*2, pfpR*2);
    ctx.font = "bold 40px monospace"; ctx.fillStyle = PURPLE;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText((agentName||"??").slice(0,2).toUpperCase(), pfpCX, pfpCY);
    ctx.textBaseline = "alphabetic";
  }
  ctx.restore();

  // Name
  ctx.font = "bold 24px monospace"; ctx.fillStyle = TEXT1; ctx.textAlign = "center";
  ctx.fillText(agentName || "Unknown Agent", pfpCX, pfpCY+pfpR+28);
  if (agentHandle) {
    ctx.font = "13px monospace"; ctx.fillStyle = CYAN;
    ctx.fillText(agentHandle, pfpCX, pfpCY+pfpR+46);
  }

  // Divider 1
  const div1Y = pfpCY + pfpR + 62;
  const dg1 = ctx.createLinearGradient(60, 0, W-60, 0);
  dg1.addColorStop(0, "rgba(153,69,255,0)"); dg1.addColorStop(0.3, "rgba(153,69,255,0.2)");
  dg1.addColorStop(0.5, "rgba(20,241,149,0.25)"); dg1.addColorStop(0.7, "rgba(153,69,255,0.2)");
  dg1.addColorStop(1, "rgba(153,69,255,0)");
  ctx.fillStyle = dg1; ctx.fillRect(60, div1Y, W-120, 1);

  // Data panel
  const panelY = div1Y + 14;
  const panelX = 50, panelW = W-100, panelH = 200;
  ctx.fillStyle = "rgba(10,10,20,0.5)";
  roundRect(ctx, panelX, panelY, panelW, panelH, 6); ctx.fill();
  ctx.strokeStyle = "rgba(153,69,255,0.08)"; ctx.lineWidth = 1;
  roundRect(ctx, panelX, panelY, panelW, panelH, 6); ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,0.004)";
  for (let y = panelY; y < panelY+panelH; y += 2) ctx.fillRect(panelX, y, panelW, 1);

  const bDate = burnDate ? new Date(burnDate) : new Date();
  const dateStr = bDate.toISOString().replace("T"," ").replace(/\.\d+Z/," UTC");
  const col1X = panelX+24, col2X = panelX+panelW/2+10, rowH = 52, startY = panelY+28;

  function drawField(x, y, label, value, valColor) {
    ctx.textAlign = "left"; ctx.font = "bold 9px monospace"; ctx.fillStyle = TEXT3;
    ctx.fillText("\u250c " + label.toUpperCase(), x, y);
    ctx.font = "13px monospace"; ctx.fillStyle = valColor || TEXT2;
    ctx.fillText("  " + value, x, y+17);
  }
  ctx.fillStyle = "rgba(153,69,255,0.05)";
  ctx.fillRect(panelX+panelW/2-1, panelY+10, 1, panelH-20);
  ctx.fillStyle = "rgba(255,255,255,0.02)";
  ctx.fillRect(panelX+12, startY+rowH-10, panelW-24, 1);
  ctx.fillRect(panelX+12, startY+rowH*2-10, panelW-24, 1);

  drawField(col1X, startY, "Date of Genesis", dateStr);
  drawField(col2X, startY, "Network", "Solana Mainnet", CYAN);
  drawField(col1X, startY+rowH, "Agent ID", agentId||"N/A", TEXT1);
  drawField(col2X, startY+rowH, "Certificate", certNumber||"CERT-0001", PURPLE);
  drawField(col1X, startY+rowH*2, "Burn TX", truncHash(burnTxSignature, 20));
  drawField(col2X, startY+rowH*2, "Arweave", truncHash(arweaveUrl, 18));

  // Hash fingerprint
  const hashY = panelY + panelH + 18;
  const hashStr = (burnTxSignature||"0".repeat(64)).replace(/[^a-zA-Z0-9]/g,"").slice(0,64).padEnd(64,"0");
  ctx.font = "7px monospace"; ctx.textAlign = "center"; ctx.fillStyle = "rgba(153,69,255,0.1)";
  ctx.fillText("HASH  " + hashStr.slice(0,32), W/2, hashY);
  ctx.fillText("      " + hashStr.slice(32,64), W/2, hashY+11);

  // Divider 2
  const div2Y = hashY + 26;
  ctx.fillStyle = dg1; ctx.fillRect(60, div2Y, W-120, 1);

  // Quote block (left) + Seal (right)
  const qY = div2Y + 26;
  ctx.fillStyle = "rgba(10,10,20,0.4)";
  roundRect(ctx, 50, qY-10, 420, 56, 4); ctx.fill();
  ctx.strokeStyle = "rgba(153,69,255,0.06)"; ctx.lineWidth = 1;
  roundRect(ctx, 50, qY-10, 420, 56, 4); ctx.stroke();
  ctx.fillStyle = PURPLE; ctx.fillRect(50, qY-10, 3, 56);
  ctx.textAlign = "left"; ctx.font = "13px monospace"; ctx.fillStyle = TEXT3;
  ctx.fillText("// This identity is permanent.", 68, qY+8);
  ctx.fillText("// No changes. No undo.", 68, qY+28);

  // Hex seal
  const sealX = W-130, sealY = qY+14, sealR = 34;
  ctx.strokeStyle = CYAN; ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = Math.PI/3*i - Math.PI/2;
    i===0 ? ctx.moveTo(sealX+sealR*Math.cos(a), sealY+sealR*Math.sin(a)) : ctx.lineTo(sealX+sealR*Math.cos(a), sealY+sealR*Math.sin(a));
  }
  ctx.closePath(); ctx.stroke();
  ctx.strokeStyle = "rgba(20,241,149,0.2)"; ctx.lineWidth = 0.5;
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = Math.PI/3*i - Math.PI/2;
    i===0 ? ctx.moveTo(sealX+(sealR-7)*Math.cos(a), sealY+(sealR-7)*Math.sin(a)) : ctx.lineTo(sealX+(sealR-7)*Math.cos(a), sealY+(sealR-7)*Math.sin(a));
  }
  ctx.closePath(); ctx.stroke();
  const sg = ctx.createRadialGradient(sealX, sealY, 5, sealX, sealY, sealR+12);
  sg.addColorStop(0, "rgba(20,241,149,0.06)"); sg.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(sealX, sealY, sealR+12, 0, Math.PI*2); ctx.fill();
  ctx.font = "bold 15px monospace"; ctx.fillStyle = CYAN; ctx.textAlign = "center";
  ctx.fillText("\u2713", sealX, sealY+2);
  ctx.font = "bold 7px monospace"; ctx.fillStyle = "rgba(20,241,149,0.7)";
  ctx.fillText("VERIFIED", sealX, sealY+15);

  // Circuit traces (fill remaining space)
  const traceY = qY + 66;
  const traceEnd = H - 90;
  const traceCount = Math.floor((traceEnd - traceY) / 18);
  const seed = [0.12,0.87,0.34,0.56,0.92,0.23,0.71,0.45,0.68,0.15,0.83,0.37];
  for (let i = 0; i < traceCount; i++) {
    const y = traceY + i * 18;
    const s = seed[i % seed.length];
    const xStart = 55 + s * 60;
    const xEnd = W - 55 - (1 - s) * 60;
    const mid1 = xStart + (xEnd - xStart) * (0.2 + s * 0.15);
    const mid2 = xStart + (xEnd - xStart) * (0.6 + s * 0.15);
    const yOff = (s - 0.5) * 16;

    // Main trace
    ctx.strokeStyle = hexToRgba(i % 3 === 0 ? CYAN : PURPLE, 0.06);
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(xStart, y);
    ctx.lineTo(mid1, y); ctx.lineTo(mid1, y + yOff); ctx.lineTo(mid2, y + yOff); ctx.lineTo(mid2, y); ctx.lineTo(xEnd, y);
    ctx.stroke();

    // Circuit nodes (brighter)
    if (s > 0.2) {
      ctx.fillStyle = hexToRgba(CYAN, 0.08);
      ctx.beginPath(); ctx.arc(mid1, y, 3, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = hexToRgba(PURPLE, 0.08);
      ctx.beginPath(); ctx.arc(mid2, y+yOff, 3, 0, Math.PI*2); ctx.fill();
    }
    // End caps
    ctx.fillStyle = hexToRgba(MAGENTA, 0.06);
    ctx.beginPath(); ctx.arc(xStart, y, 1.5, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(xEnd, y, 1.5, 0, Math.PI*2); ctx.fill();
  }

  // Status bar
  const statusY = H - 80;
  ctx.fillStyle = "rgba(10,10,20,0.4)";
  roundRect(ctx, 50, statusY, W-100, 30, 4); ctx.fill();
  ctx.strokeStyle = "rgba(153,69,255,0.06)"; ctx.lineWidth = 1;
  roundRect(ctx, 50, statusY, W-100, 30, 4); ctx.stroke();

  ctx.font = "9px monospace"; ctx.textAlign = "left";
  const statuses = ["IDENTITY", "ON-CHAIN", "SOULBOUND", "PERMANENT", "ARWEAVE"];
  const spacing = (W - 140) / statuses.length;
  statuses.forEach((s, i) => {
    const x = 70 + i * spacing;
    ctx.fillStyle = CYAN;
    ctx.beginPath(); ctx.arc(x, statusY+15, 3, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = TEXT3;
    ctx.fillText(s, x + 8, statusY+18);
  });

  // Bottom neon strip
  const stripY = H - 38;
  const neonGrad = ctx.createLinearGradient(36, 0, W-36, 0);
  neonGrad.addColorStop(0, "rgba(153,69,255,0)"); neonGrad.addColorStop(0.1, MAGENTA);
  neonGrad.addColorStop(0.3, PURPLE); neonGrad.addColorStop(0.5, CYAN);
  neonGrad.addColorStop(0.7, PURPLE); neonGrad.addColorStop(0.9, MAGENTA);
  neonGrad.addColorStop(1, "rgba(153,69,255,0)");
  ctx.fillStyle = neonGrad; ctx.fillRect(36, stripY, W-72, 2);
  ctx.fillStyle = "rgba(20,241,149,0.02)"; ctx.fillRect(36, stripY+2, W-72, 10);

  // Footer
  ctx.textAlign = "center"; ctx.font = "9px monospace"; ctx.fillStyle = TEXT3;
  ctx.fillText("agentfolio.bot  //  Powered by SATP  //  Solana", W/2, H-18);

  return canvas.toBuffer("image/png");
}

async function generateBirthCertificate(opts) { return generateCardBack(opts); }
async function generateGenesisRecord(opts) { return generateCardBack(opts); }
async function generateBirthCard(opts) {
  const [front, back] = await Promise.all([generateCardFront(opts), generateCardBack(opts)]);
  return { front, back };
}
async function generateGenesisCard(opts) { return generateBirthCard(opts); }

module.exports = { generateBirthCertificate, generateGenesisRecord, generateBirthCard, generateGenesisCard, generateCardFront, generateCardBack, getNextCertNumber };
