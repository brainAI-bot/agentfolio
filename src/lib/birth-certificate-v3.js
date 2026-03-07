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

function truncHash(s, len = 14) {
  if (!s) return "N/A";
  if (s.length <= len * 2) return s;
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

async function generateBirthCertificateV3(opts) {
  const { agentName, agentHandle, agentId, nftImageUrl,
    burnTxSignature, arweaveUrl, burnDate, certNumber } = opts;

  const W = 1400, H = 920;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  const PURPLE = "#9945FF";
  const CYAN = "#00D4AA";
  const GOLD = "#D4A853";
  const BG = "#06060B";
  const TEXT1 = "#F0F2F5";
  const TEXT2 = "#94A3B8";
  const TEXT3 = "#475569";

  // ── BACKGROUND ──
  // Base
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);

  // Radial glow from center-top (behind PFP)
  const bgGlow = ctx.createRadialGradient(W/2, 300, 50, W/2, 300, 500);
  bgGlow.addColorStop(0, "rgba(153,69,255,0.08)");
  bgGlow.addColorStop(0.5, "rgba(153,69,255,0.03)");
  bgGlow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = bgGlow;
  ctx.fillRect(0, 0, W, H);

  // Second glow (cyan tint bottom)
  const bgGlow2 = ctx.createRadialGradient(W/2, H, 50, W/2, H, 500);
  bgGlow2.addColorStop(0, "rgba(0,212,170,0.04)");
  bgGlow2.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = bgGlow2;
  ctx.fillRect(0, 0, W, H);

  // Noise texture simulation (random dots)
  ctx.fillStyle = "rgba(255,255,255,0.008)";
  for (let i = 0; i < 3000; i++) {
    const x = Math.random() * W, y = Math.random() * H;
    ctx.fillRect(x, y, 1, 1);
  }

  // Faint diagonal cert number watermark
  ctx.save();
  ctx.translate(W/2, H/2);
  ctx.rotate(-0.3);
  ctx.font = "bold 140px Liberation Mono, monospace";
  ctx.fillStyle = "rgba(153,69,255,0.018)";
  ctx.textAlign = "center";
  ctx.fillText(certNumber || "CERT-0001", 0, 0);
  ctx.restore();

  // ── BORDERS ──
  // Outer border with glow
  ctx.shadowColor = "rgba(153,69,255,0.25)";
  ctx.shadowBlur = 25;
  ctx.strokeStyle = PURPLE;
  ctx.lineWidth = 1.5;
  roundRect(ctx, 24, 24, W-48, H-48, 10);
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Inner border
  ctx.strokeStyle = "rgba(153,69,255,0.15)";
  ctx.lineWidth = 1;
  roundRect(ctx, 36, 36, W-72, H-72, 6);
  ctx.stroke();

  // Corner accents (L-shaped)
  const cLen = 30, cOff = 28;
  ctx.strokeStyle = PURPLE;
  ctx.lineWidth = 2;
  // TL
  ctx.beginPath(); ctx.moveTo(cOff, cOff + cLen); ctx.lineTo(cOff, cOff); ctx.lineTo(cOff + cLen, cOff); ctx.stroke();
  // TR
  ctx.beginPath(); ctx.moveTo(W-cOff-cLen, cOff); ctx.lineTo(W-cOff, cOff); ctx.lineTo(W-cOff, cOff+cLen); ctx.stroke();
  // BL
  ctx.beginPath(); ctx.moveTo(cOff, H-cOff-cLen); ctx.lineTo(cOff, H-cOff); ctx.lineTo(cOff+cLen, H-cOff); ctx.stroke();
  // BR
  ctx.beginPath(); ctx.moveTo(W-cOff-cLen, H-cOff); ctx.lineTo(W-cOff, H-cOff); ctx.lineTo(W-cOff, H-cOff-cLen); ctx.stroke();

  // ── HEADER ──
  ctx.font = "bold 14px Liberation Mono, monospace";
  ctx.fillStyle = PURPLE;
  ctx.textAlign = "left";
  ctx.fillText(">_", 65, 72);
  ctx.fillStyle = TEXT2;
  ctx.fillText(" AgentFolio", 84, 72);

  ctx.font = "11px Liberation Mono, monospace";
  ctx.fillStyle = TEXT3;
  ctx.textAlign = "right";
  ctx.fillText("No. " + (certNumber || "CERT-0001"), W - 65, 72);

  // Header line
  const hLineGrad = ctx.createLinearGradient(60, 0, W-60, 0);
  hLineGrad.addColorStop(0, "rgba(153,69,255,0)");
  hLineGrad.addColorStop(0.3, "rgba(153,69,255,0.2)");
  hLineGrad.addColorStop(0.5, "rgba(153,69,255,0.3)");
  hLineGrad.addColorStop(0.7, "rgba(153,69,255,0.2)");
  hLineGrad.addColorStop(1, "rgba(153,69,255,0)");
  ctx.fillStyle = hLineGrad;
  ctx.fillRect(60, 85, W-120, 1);

  // ── TITLE ──
  ctx.textAlign = "center";
  ctx.font = "bold 38px Liberation Sans, Arial, sans-serif";
  ctx.letterSpacing = "8px";
  ctx.fillStyle = TEXT1;
  ctx.fillText("B I R T H   C E R T I F I C A T E", W/2, 130);

  // Title underline (purple → cyan gradient)
  const titleLineGrad = ctx.createLinearGradient(W/2 - 250, 0, W/2 + 250, 0);
  titleLineGrad.addColorStop(0, "rgba(153,69,255,0)");
  titleLineGrad.addColorStop(0.2, PURPLE);
  titleLineGrad.addColorStop(0.5, CYAN);
  titleLineGrad.addColorStop(0.8, PURPLE);
  titleLineGrad.addColorStop(1, "rgba(153,69,255,0)");
  ctx.fillStyle = titleLineGrad;
  ctx.fillRect(W/2 - 250, 142, 500, 2);

  // Subtitle
  ctx.font = "11px Liberation Mono, monospace";
  ctx.fillStyle = TEXT3;
  ctx.fillText("Issued on the Solana Blockchain  ·  Permanent  ·  Immutable  ·  Soulbound", W/2, 166);

  // ── PFP SECTION ──
  const pfpCX = W/2, pfpCY = 285, pfpR = 80;

  // Large soft glow
  const pfpGlow = ctx.createRadialGradient(pfpCX, pfpCY, pfpR/2, pfpCX, pfpCY, pfpR + 60);
  pfpGlow.addColorStop(0, "rgba(153,69,255,0.15)");
  pfpGlow.addColorStop(0.5, "rgba(153,69,255,0.06)");
  pfpGlow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = pfpGlow;
  ctx.beginPath(); ctx.arc(pfpCX, pfpCY, pfpR + 60, 0, Math.PI*2); ctx.fill();

  // Outer decorative ring (dashed, cyan)
  ctx.strokeStyle = "rgba(0,212,170,0.25)";
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 5]);
  ctx.beginPath(); ctx.arc(pfpCX, pfpCY, pfpR + 18, 0, Math.PI*2); ctx.stroke();
  ctx.setLineDash([]);

  // Main ring (purple → cyan gradient)
  const ringGrad = ctx.createLinearGradient(pfpCX - pfpR, pfpCY - pfpR, pfpCX + pfpR, pfpCY + pfpR);
  ringGrad.addColorStop(0, PURPLE);
  ringGrad.addColorStop(0.5, "#B16BFF");
  ringGrad.addColorStop(1, CYAN);
  ctx.strokeStyle = ringGrad;
  ctx.lineWidth = 3.5;
  ctx.beginPath(); ctx.arc(pfpCX, pfpCY, pfpR + 6, 0, Math.PI*2); ctx.stroke();

  // Small decorative dots on the ring
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 6) {
    const dx = pfpCX + Math.cos(a) * (pfpR + 6);
    const dy = pfpCY + Math.sin(a) * (pfpR + 6);
    ctx.fillStyle = "rgba(255,255,255,0.3)";
    ctx.beginPath(); ctx.arc(dx, dy, 1.5, 0, Math.PI*2); ctx.fill();
  }

  // Ember particles around ring (fire effect for "burnt")
  const emberColors = ["rgba(255,100,50,0.6)", "rgba(255,180,50,0.5)", "rgba(255,60,30,0.4)", "rgba(255,200,80,0.3)"];
  for (let i = 0; i < 16; i++) {
    const angle = Math.random() * Math.PI * 2;
    const dist = pfpR + 10 + Math.random() * 25;
    const ex = pfpCX + Math.cos(angle) * dist;
    const ey = pfpCY + Math.sin(angle) * dist - Math.random() * 15;
    const eSize = 1 + Math.random() * 2.5;
    ctx.fillStyle = emberColors[Math.floor(Math.random() * emberColors.length)];
    ctx.beginPath(); ctx.arc(ex, ey, eSize, 0, Math.PI*2); ctx.fill();
  }

  // PFP image
  let nftImg = null;
  if (nftImageUrl) {
    try {
      const buf = await fetchImageBuffer(nftImageUrl);
      nftImg = await loadImage(buf);
    } catch (e) { console.log("[BirthCert] PFP load error:", e.message); }
  }

  ctx.save();
  ctx.beginPath(); ctx.arc(pfpCX, pfpCY, pfpR, 0, Math.PI*2); ctx.clip();
  if (nftImg) {
    ctx.drawImage(nftImg, pfpCX - pfpR, pfpCY - pfpR, pfpR*2, pfpR*2);
  } else {
    ctx.fillStyle = "#1A1A2E";
    ctx.fillRect(pfpCX - pfpR, pfpCY - pfpR, pfpR*2, pfpR*2);
    ctx.font = "bold 52px Liberation Mono, monospace";
    ctx.fillStyle = PURPLE;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(agentName.slice(0,2).toUpperCase(), pfpCX, pfpCY);
    ctx.textBaseline = "alphabetic";
  }
  ctx.restore();

  // Small fire icon below PFP
  ctx.font = "18px serif";
  ctx.textAlign = "center";
  ctx.fillText("🔥", pfpCX, pfpCY + pfpR + 28);

  // ── AGENT NAME ──
  ctx.font = "bold 32px Liberation Sans, Arial, sans-serif";
  ctx.fillStyle = TEXT1;
  ctx.textAlign = "center";
  ctx.fillText(agentName, pfpCX, pfpCY + pfpR + 58);

  ctx.font = "15px Liberation Mono, monospace";
  ctx.fillStyle = PURPLE;
  ctx.fillText(agentHandle, pfpCX, pfpCY + pfpR + 80);

  // ── DIVIDER ──
  const divY = pfpCY + pfpR + 100;
  const divGrad = ctx.createLinearGradient(120, 0, W-120, 0);
  divGrad.addColorStop(0, "rgba(153,69,255,0)");
  divGrad.addColorStop(0.2, "rgba(153,69,255,0.25)");
  divGrad.addColorStop(0.5, "rgba(0,212,170,0.3)");
  divGrad.addColorStop(0.8, "rgba(153,69,255,0.25)");
  divGrad.addColorStop(1, "rgba(153,69,255,0)");
  ctx.fillStyle = divGrad;
  ctx.fillRect(120, divY, W-240, 1);

  // Small diamond at center of divider
  ctx.fillStyle = CYAN;
  ctx.save(); ctx.translate(W/2, divY); ctx.rotate(Math.PI/4);
  ctx.fillRect(-3, -3, 6, 6); ctx.restore();

  // ── DATA PANEL ──
  const panelY = divY + 18;
  const panelH = 155;
  const panelX = 130;
  const panelW = W - 260;

  // Panel bg
  ctx.fillStyle = "rgba(255,255,255,0.015)";
  roundRect(ctx, panelX, panelY, panelW, panelH, 8);
  ctx.fill();
  ctx.strokeStyle = "rgba(153,69,255,0.08)";
  ctx.lineWidth = 1;
  roundRect(ctx, panelX, panelY, panelW, panelH, 8);
  ctx.stroke();

  const bDate = burnDate instanceof Date ? burnDate : new Date(burnDate);
  const dateStr = bDate.toISOString().replace("T", " ").replace(/\.\d+Z/, " UTC");

  const col1X = panelX + 35;
  const col2X = panelX + panelW/2 + 20;
  const rowH = 42;
  const startY = panelY + 32;

  function drawField(x, y, label, value, valColor) {
    ctx.textAlign = "left";
    ctx.font = "bold 9px Liberation Mono, monospace";
    ctx.fillStyle = TEXT3;
    ctx.fillText(label.toUpperCase(), x, y);
    ctx.font = "13px Liberation Mono, monospace";
    ctx.fillStyle = valColor || TEXT2;
    ctx.fillText(value, x, y + 17);
  }

  // Row dividers
  ctx.fillStyle = "rgba(255,255,255,0.03)";
  ctx.fillRect(panelX + 20, startY + rowH - 4, panelW - 40, 1);
  ctx.fillRect(panelX + 20, startY + rowH * 2 - 4, panelW - 40, 1);

  // Column divider
  ctx.fillRect(panelX + panelW/2 - 5, panelY + 15, 1, panelH - 30);

  drawField(col1X, startY, "Date of Birth", dateStr);
  drawField(col1X, startY + rowH, "Identity", agentId, TEXT1);
  drawField(col1X, startY + rowH * 2, "Burn Transaction", truncHash(burnTxSignature));

  drawField(col2X, startY, "Chain", "Solana", CYAN);
  drawField(col2X, startY + rowH, "Certificate", certNumber || "CERT-0001", PURPLE);
  drawField(col2X, startY + rowH * 2, "Permanent Storage", truncHash(arweaveUrl));

  // ── GOLD VERIFICATION SEAL ──
  const sealX = W - 175;
  const sealY = H - 145;
  const sealR = 50;

  // Seal glow
  const sealGlow = ctx.createRadialGradient(sealX, sealY, sealR/2, sealX, sealY, sealR + 30);
  sealGlow.addColorStop(0, "rgba(212,168,83,0.12)");
  sealGlow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = sealGlow;
  ctx.beginPath(); ctx.arc(sealX, sealY, sealR + 30, 0, Math.PI*2); ctx.fill();

  // Outer ring
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(sealX, sealY, sealR, 0, Math.PI*2); ctx.stroke();

  // Inner ring
  ctx.strokeStyle = "rgba(212,168,83,0.4)";
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(sealX, sealY, sealR - 9, 0, Math.PI*2); ctx.stroke();

  // Circular text
  ctx.save();
  ctx.translate(sealX, sealY);
  ctx.font = "bold 7px Liberation Mono, monospace";
  ctx.fillStyle = "rgba(212,168,83,0.55)";
  const sealText = "· VERIFIED · ON-CHAIN · PERMANENT · SOULBOUND ";
  const charAngle = (Math.PI * 2) / sealText.length;
  for (let i = 0; i < sealText.length; i++) {
    ctx.save();
    ctx.rotate(-Math.PI/2 + charAngle * i);
    ctx.fillText(sealText[i], 0, -(sealR - 18));
    ctx.restore();
  }
  ctx.restore();

  // Seal center
  ctx.font = "bold 20px Liberation Mono, monospace";
  ctx.fillStyle = GOLD;
  ctx.textAlign = "center";
  ctx.fillText(">_", sealX, sealY - 2);
  ctx.font = "bold 9px Liberation Mono, monospace";
  ctx.fillStyle = "rgba(212,168,83,0.85)";
  ctx.fillText("VERIFIED", sealX, sealY + 14);

  // ── HOLOGRAPHIC STRIP ──
  const stripY = H - 70;
  const stripH = 3;
  const holoGrad = ctx.createLinearGradient(200, 0, W-200, 0);
  holoGrad.addColorStop(0, "rgba(153,69,255,0)");
  holoGrad.addColorStop(0.15, "rgba(153,69,255,0.4)");
  holoGrad.addColorStop(0.35, "rgba(0,212,170,0.4)");
  holoGrad.addColorStop(0.5, "rgba(212,168,83,0.3)");
  holoGrad.addColorStop(0.65, "rgba(0,212,170,0.4)");
  holoGrad.addColorStop(0.85, "rgba(153,69,255,0.4)");
  holoGrad.addColorStop(1, "rgba(153,69,255,0)");
  ctx.fillStyle = holoGrad;
  ctx.fillRect(200, stripY, W-400, stripH);

  // ── FOOTER ──
  ctx.textAlign = "center";
  ctx.font = "italic 13px Liberation Sans, Georgia, serif";
  ctx.fillStyle = TEXT3;
  ctx.fillText("This identity is permanent. No changes. No undo.", W/2 - 70, H - 42);

  ctx.font = "9px Liberation Mono, monospace";
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  ctx.fillText("agentfolio.bot  ·  Powered by SATP — Solana Agent Trust Protocol", W/2, H - 22);

  // ── BOTTOM ACCENT ──
  const botGrad = ctx.createLinearGradient(24, 0, W-24, 0);
  botGrad.addColorStop(0, PURPLE);
  botGrad.addColorStop(0.5, CYAN);
  botGrad.addColorStop(1, PURPLE);
  ctx.fillStyle = botGrad;
  ctx.fillRect(24, H - 12, W - 48, 2);

  return canvas.toBuffer("image/png");
}

module.exports = { generateBirthCertificateV3 };
