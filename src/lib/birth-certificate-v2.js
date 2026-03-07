const { createCanvas, loadImage, registerFont } = require("canvas");
const https = require("https");
const http = require("http");

function fetchImageBuffer(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    mod.get(url, { headers: { "User-Agent": "AgentFolio/1.0" } }, (res) => {
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

function truncHash(s, len = 16) {
  if (!s) return "N/A";
  if (s.length <= len * 2) return s;
  return s.slice(0, len) + "..." + s.slice(-len);
}

async function generateBirthCertificateV2({
  agentName, agentHandle, agentId, nftImageUrl,
  burnTxSignature, arweaveUrl, burnDate, certNumber
}) {
  const W = 1400, H = 900;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  // === BACKGROUND ===
  // Radial gradient from dark center to slightly lighter edges
  const bgGrad = ctx.createRadialGradient(W/2, H/2, 100, W/2, H/2, 700);
  bgGrad.addColorStop(0, "#0e0e18");
  bgGrad.addColorStop(1, "#060609");
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, W, H);

  // Subtle grid pattern
  ctx.strokeStyle = "rgba(153,69,255,0.03)";
  ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 0; y < H; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

  // === OUTER BORDER ===
  // Double border with glow
  ctx.shadowColor = "rgba(153,69,255,0.3)";
  ctx.shadowBlur = 20;
  ctx.strokeStyle = "#9945FF";
  ctx.lineWidth = 2;
  roundRect(ctx, 20, 20, W-40, H-40, 12);
  ctx.stroke();
  ctx.shadowBlur = 0;
  
  ctx.strokeStyle = "rgba(153,69,255,0.3)";
  ctx.lineWidth = 1;
  roundRect(ctx, 30, 30, W-60, H-60, 8);
  ctx.stroke();

  // Corner ornaments
  const corners = [[35, 35], [W-35, 35], [35, H-35], [W-35, H-35]];
  corners.forEach(([cx, cy]) => {
    ctx.fillStyle = "#9945FF";
    ctx.beginPath();
    ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    ctx.fill();
  });

  // === HEADER AREA ===
  // Decorative line
  ctx.fillStyle = "rgba(153,69,255,0.15)";
  ctx.fillRect(60, 55, W-120, 1);

  // Logo
  ctx.font = "bold 16px Liberation Mono, Courier New, monospace";
  ctx.fillStyle = "#9945FF";
  ctx.textAlign = "left";
  ctx.fillText(">_", 70, 90);
  ctx.fillStyle = "#E2E8F0";
  ctx.fillText(" AgentFolio", 95, 90);

  // Cert number top-right
  ctx.font = "12px Liberation Mono, Courier New, monospace";
  ctx.fillStyle = "#64748B";
  ctx.textAlign = "right";
  ctx.fillText(certNumber || "CERT-0001", W - 70, 90);

  // === TITLE ===
  ctx.textAlign = "center";
  ctx.font = "bold 36px Liberation Sans, Arial, sans-serif";
  ctx.fillStyle = "#E2E8F0";
  ctx.fillText("BIRTH CERTIFICATE", W/2, 145);

  // Decorative underline
  const titleW = ctx.measureText("BIRTH CERTIFICATE").width;
  const lineGrad = ctx.createLinearGradient(W/2 - titleW/2 - 40, 0, W/2 + titleW/2 + 40, 0);
  lineGrad.addColorStop(0, "rgba(153,69,255,0)");
  lineGrad.addColorStop(0.2, "rgba(153,69,255,0.6)");
  lineGrad.addColorStop(0.5, "#9945FF");
  lineGrad.addColorStop(0.8, "rgba(153,69,255,0.6)");
  lineGrad.addColorStop(1, "rgba(153,69,255,0)");
  ctx.fillStyle = lineGrad;
  ctx.fillRect(W/2 - titleW/2 - 40, 155, titleW + 80, 2);

  ctx.font = "12px Liberation Mono, Courier New, monospace";
  ctx.fillStyle = "#64748B";
  ctx.fillText("Issued on the Solana blockchain  ·  Permanent  ·  Immutable", W/2, 180);

  // === AVATAR SECTION ===
  const avatarY = 230;
  const avatarR = 75;

  // Glow behind avatar
  const glowGrad = ctx.createRadialGradient(W/2, avatarY + avatarR, avatarR - 10, W/2, avatarY + avatarR, avatarR + 40);
  glowGrad.addColorStop(0, "rgba(153,69,255,0.2)");
  glowGrad.addColorStop(1, "rgba(153,69,255,0)");
  ctx.fillStyle = glowGrad;
  ctx.beginPath();
  ctx.arc(W/2, avatarY + avatarR, avatarR + 40, 0, Math.PI * 2);
  ctx.fill();

  // Purple ring
  ctx.strokeStyle = "#9945FF";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(W/2, avatarY + avatarR, avatarR + 5, 0, Math.PI * 2);
  ctx.stroke();

  // Outer decorative ring (dashed)
  ctx.strokeStyle = "rgba(153,69,255,0.3)";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 6]);
  ctx.beginPath();
  ctx.arc(W/2, avatarY + avatarR, avatarR + 15, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  // Load and draw avatar
  let nftImg = null;
  if (nftImageUrl) {
    try {
      const buf = await fetchImageBuffer(nftImageUrl);
      nftImg = await loadImage(buf);
    } catch (e) {
      console.log("[BirthCert] Could not load NFT image:", e.message);
    }
  }

  ctx.save();
  ctx.beginPath();
  ctx.arc(W/2, avatarY + avatarR, avatarR, 0, Math.PI * 2);
  ctx.clip();
  if (nftImg) {
    ctx.drawImage(nftImg, W/2 - avatarR, avatarY, avatarR * 2, avatarR * 2);
  } else {
    ctx.fillStyle = "#1A1A2E";
    ctx.fillRect(W/2 - avatarR, avatarY, avatarR * 2, avatarR * 2);
    ctx.font = "bold 48px Liberation Mono, monospace";
    ctx.fillStyle = "#9945FF";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(agentName.slice(0, 2).toUpperCase(), W/2, avatarY + avatarR);
    ctx.textBaseline = "alphabetic";
  }
  ctx.restore();

  // Agent name + handle
  ctx.textAlign = "center";
  ctx.font = "bold 28px Liberation Sans, Arial, sans-serif";
  ctx.fillStyle = "#E2E8F0";
  ctx.fillText(agentName, W/2, avatarY + avatarR * 2 + 35);
  ctx.font = "16px Liberation Mono, Courier New, monospace";
  ctx.fillStyle = "#9945FF";
  ctx.fillText(agentHandle, W/2, avatarY + avatarR * 2 + 58);

  // === DATA SECTION (two columns) ===
  const dataY = avatarY + avatarR * 2 + 90;
  const colLeft = 180;
  const colRight = W/2 + 60;
  const lineH = 34;

  // Separator line
  const sepGrad = ctx.createLinearGradient(100, 0, W-100, 0);
  sepGrad.addColorStop(0, "rgba(153,69,255,0)");
  sepGrad.addColorStop(0.3, "rgba(153,69,255,0.3)");
  sepGrad.addColorStop(0.5, "rgba(153,69,255,0.5)");
  sepGrad.addColorStop(0.7, "rgba(153,69,255,0.3)");
  sepGrad.addColorStop(1, "rgba(153,69,255,0)");
  ctx.fillStyle = sepGrad;
  ctx.fillRect(100, dataY - 15, W-200, 1);

  function drawField(x, y, label, value, valueColor) {
    ctx.textAlign = "left";
    ctx.font = "bold 11px Liberation Mono, Courier New, monospace";
    ctx.fillStyle = "#64748B";
    ctx.fillText(label.toUpperCase(), x, y);
    ctx.font = "14px Liberation Mono, Courier New, monospace";
    ctx.fillStyle = valueColor || "#B8C5D6";
    ctx.fillText(value, x, y + 18);
  }

  const bDate = burnDate instanceof Date ? burnDate : new Date(burnDate);
  const dateStr = bDate.toISOString().replace("T", " ").replace(/\.\d+Z/, " UTC");

  // Left column
  drawField(colLeft, dataY, "DATE OF BIRTH", dateStr);
  drawField(colLeft, dataY + lineH * 2, "IDENTITY", agentId);
  drawField(colLeft, dataY + lineH * 4, "BURN TRANSACTION", truncHash(burnTxSignature, 20));

  // Right column
  drawField(colRight, dataY, "CHAIN", "Solana", "#9945FF");
  drawField(colRight, dataY + lineH * 2, "CERTIFICATE", certNumber || "CERT-0001", "#9945FF");
  drawField(colRight, dataY + lineH * 4, "PERMANENT STORAGE", truncHash(arweaveUrl, 20));

  // === SEAL / VERIFICATION BADGE ===
  // Circular seal in bottom-right area
  const sealX = W - 180;
  const sealY = H - 160;
  const sealR = 55;

  // Seal glow
  const sealGlow = ctx.createRadialGradient(sealX, sealY, sealR - 20, sealX, sealY, sealR + 20);
  sealGlow.addColorStop(0, "rgba(153,69,255,0.15)");
  sealGlow.addColorStop(1, "rgba(153,69,255,0)");
  ctx.fillStyle = sealGlow;
  ctx.beginPath();
  ctx.arc(sealX, sealY, sealR + 20, 0, Math.PI * 2);
  ctx.fill();

  // Outer seal ring
  ctx.strokeStyle = "rgba(153,69,255,0.5)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(sealX, sealY, sealR, 0, Math.PI * 2);
  ctx.stroke();

  // Inner seal ring
  ctx.strokeStyle = "rgba(153,69,255,0.3)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(sealX, sealY, sealR - 8, 0, Math.PI * 2);
  ctx.stroke();

  // Seal text around circle
  ctx.save();
  ctx.translate(sealX, sealY);
  ctx.font = "bold 8px Liberation Mono, monospace";
  ctx.fillStyle = "rgba(153,69,255,0.6)";
  const sealText = "·  VERIFIED  ·  ON-CHAIN  ·  PERMANENT  ·  SOULBOUND  ";
  const charAngle = (Math.PI * 2) / sealText.length;
  for (let i = 0; i < sealText.length; i++) {
    ctx.save();
    ctx.rotate(-Math.PI/2 + charAngle * i);
    ctx.fillText(sealText[i], 0, -(sealR - 18));
    ctx.restore();
  }
  ctx.restore();

  // Seal center
  ctx.font = "bold 22px Liberation Mono, monospace";
  ctx.fillStyle = "#9945FF";
  ctx.textAlign = "center";
  ctx.fillText(">_", sealX, sealY - 4);
  ctx.font = "bold 10px Liberation Mono, monospace";
  ctx.fillStyle = "rgba(153,69,255,0.8)";
  ctx.fillText("VERIFIED", sealX, sealY + 14);

  // === BOTTOM TAGLINE ===
  ctx.fillStyle = sepGrad;
  ctx.fillRect(100, H - 80, W-200, 1);

  ctx.textAlign = "center";
  ctx.font = "13px Liberation Mono, Courier New, monospace";
  ctx.fillStyle = "#4A5568";
  ctx.fillText("This identity is permanent. No changes. No undo.", W/2, H - 52);

  ctx.font = "10px Liberation Mono, monospace";
  ctx.fillStyle = "#2D3748";
  ctx.fillText("agentfolio.bot  ·  Powered by SATP — Solana Agent Trust Protocol", W/2, H - 32);

  // === BOTTOM ACCENT LINE ===
  ctx.fillStyle = "#9945FF";
  ctx.fillRect(20, H - 14, W - 40, 3);

  return canvas.toBuffer("image/png");
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

module.exports = { generateBirthCertificateV2 };
