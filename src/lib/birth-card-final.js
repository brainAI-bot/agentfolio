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

function truncHash(s, len = 10) {
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

// Generate certificate that matches the NFT image dimensions
async function generateBirthCard(opts) {
  const { agentName, agentHandle, agentId, nftImageUrl,
    burnTxSignature, arweaveUrl, burnDate, certNumber } = opts;

  // First, get the NFT image and its dimensions
  let nftImg = null, nftBuf = null;
  if (nftImageUrl) {
    try {
      nftBuf = await fetchImageBuffer(nftImageUrl);
      nftImg = await loadImage(nftBuf);
    } catch(e) { console.log("[Card] PFP error:", e.message); }
  }

  const W = nftImg ? nftImg.width : 800;
  const H = nftImg ? nftImg.height : 800;

  // Front = raw NFT at original size
  const frontCanvas = createCanvas(W, H);
  const fctx = frontCanvas.getContext("2d");
  if (nftImg) {
    fctx.drawImage(nftImg, 0, 0, W, H);
  } else {
    fctx.fillStyle = "#1A1A2E";
    fctx.fillRect(0, 0, W, H);
    fctx.font = "bold " + Math.floor(W/4) + "px Liberation Mono, monospace";
    fctx.fillStyle = PURPLE; fctx.textAlign = "center"; fctx.textBaseline = "middle";
    fctx.fillText(agentName.slice(0,2).toUpperCase(), W/2, H/2);
  }
  const front = frontCanvas.toBuffer("image/png");

  // Back = certificate at same WxH
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  // Scale factor (design based on 600x800, scale everything proportionally)
  const sx = W / 600, sy = H / 800;
  const s = Math.min(sx, sy); // uniform scale

  // BG
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);

  // Radial glow
  const glow = ctx.createRadialGradient(W/2, H*0.35, 30*s, W/2, H*0.35, 300*s);
  glow.addColorStop(0, "rgba(153,69,255,0.07)");
  glow.addColorStop(0.6, "rgba(153,69,255,0.02)");
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);

  // Noise
  ctx.fillStyle = "rgba(255,255,255,0.007)";
  for (let i = 0; i < 1500; i++) ctx.fillRect(Math.random()*W, Math.random()*H, 1, 1);

  // Watermark
  ctx.save(); ctx.translate(W/2, H/2); ctx.rotate(-0.3);
  ctx.font = "bold " + Math.floor(90*s) + "px Liberation Mono, monospace";
  ctx.fillStyle = "rgba(153,69,255,0.015)"; ctx.textAlign = "center";
  ctx.fillText(certNumber || "CERT-0001", 0, 0);
  ctx.restore();

  // Borders
  const pad = Math.floor(20*s);
  ctx.shadowColor = "rgba(153,69,255,0.3)"; ctx.shadowBlur = Math.floor(18*s);
  ctx.strokeStyle = PURPLE; ctx.lineWidth = Math.max(1.5, 1.5*s);
  roundRect(ctx, pad, pad, W-pad*2, H-pad*2, Math.floor(12*s)); ctx.stroke();
  ctx.shadowBlur = 0;
  const pad2 = pad + Math.floor(8*s);
  ctx.strokeStyle = "rgba(153,69,255,0.12)"; ctx.lineWidth = 1;
  roundRect(ctx, pad2, pad2, W-pad2*2, H-pad2*2, Math.floor(8*s)); ctx.stroke();

  // Corner accents
  const cLen = Math.floor(25*s), cOff = pad + 2;
  ctx.strokeStyle = PURPLE; ctx.lineWidth = Math.max(2, 2*s);
  ctx.beginPath(); ctx.moveTo(cOff, cOff+cLen); ctx.lineTo(cOff, cOff); ctx.lineTo(cOff+cLen, cOff); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(W-cOff-cLen, cOff); ctx.lineTo(W-cOff, cOff); ctx.lineTo(W-cOff, cOff+cLen); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cOff, H-cOff-cLen); ctx.lineTo(cOff, H-cOff); ctx.lineTo(cOff+cLen, H-cOff); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(W-cOff-cLen, H-cOff); ctx.lineTo(W-cOff, H-cOff); ctx.lineTo(W-cOff, H-cOff-cLen); ctx.stroke();

  // Header
  const hY = Math.floor(55*s);
  ctx.font = "bold " + Math.floor(13*s) + "px Liberation Mono, monospace";
  ctx.fillStyle = PURPLE; ctx.textAlign = "left";
  ctx.fillText(">_", Math.floor(50*s), hY);
  ctx.fillStyle = TEXT2;
  ctx.fillText(" AgentFolio", Math.floor(68*s), hY);
  ctx.font = Math.floor(9*s) + "px Liberation Mono, monospace";
  ctx.fillStyle = TEXT3; ctx.textAlign = "right";
  ctx.fillText("No. " + (certNumber || "CERT-0001"), W - Math.floor(50*s), hY);

  // Header line
  const hlY = hY + Math.floor(12*s);
  const hlGrad = ctx.createLinearGradient(40*s, 0, W-40*s, 0);
  hlGrad.addColorStop(0, "rgba(153,69,255,0)");
  hlGrad.addColorStop(0.5, "rgba(153,69,255,0.25)");
  hlGrad.addColorStop(1, "rgba(153,69,255,0)");
  ctx.fillStyle = hlGrad; ctx.fillRect(40*s, hlY, W-80*s, 1);

  // Title
  ctx.textAlign = "center";
  ctx.font = "bold " + Math.floor(26*s) + "px Liberation Sans, Arial, sans-serif";
  ctx.fillStyle = TEXT1;
  ctx.fillText("B I R T H   C E R T I F I C A T E", W/2, hlY + Math.floor(35*s));

  // Title underline (purple → cyan)
  const tuY = hlY + Math.floor(43*s);
  const tuW = Math.floor(180*s);
  const tuGrad = ctx.createLinearGradient(W/2-tuW, 0, W/2+tuW, 0);
  tuGrad.addColorStop(0, "rgba(153,69,255,0)");
  tuGrad.addColorStop(0.3, PURPLE); tuGrad.addColorStop(0.5, CYAN);
  tuGrad.addColorStop(0.7, PURPLE); tuGrad.addColorStop(1, "rgba(153,69,255,0)");
  ctx.fillStyle = tuGrad; ctx.fillRect(W/2-tuW, tuY, tuW*2, 2);

  // Subtitle
  ctx.font = Math.floor(8*s) + "px Liberation Mono, monospace";
  ctx.fillStyle = TEXT3;
  ctx.fillText("Solana Blockchain  ·  Permanent  ·  Immutable  ·  Soulbound", W/2, tuY + Math.floor(18*s));

  // Small PFP thumbnail
  const spY = tuY + Math.floor(40*s);
  const spR = Math.floor(35*s);
  const spCX = W/2, spCY = spY + spR;

  const spGlow = ctx.createRadialGradient(spCX, spCY, spR/2, spCX, spCY, spR+15*s);
  spGlow.addColorStop(0, "rgba(153,69,255,0.1)"); spGlow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = spGlow;
  ctx.beginPath(); ctx.arc(spCX, spCY, spR+15*s, 0, Math.PI*2); ctx.fill();

  const spRing = ctx.createLinearGradient(spCX-spR, spCY-spR, spCX+spR, spCY+spR);
  spRing.addColorStop(0, PURPLE); spRing.addColorStop(1, CYAN);
  ctx.strokeStyle = spRing; ctx.lineWidth = Math.max(2, 2*s);
  ctx.beginPath(); ctx.arc(spCX, spCY, spR+3*s, 0, Math.PI*2); ctx.stroke();

  ctx.save();
  ctx.beginPath(); ctx.arc(spCX, spCY, spR, 0, Math.PI*2); ctx.clip();
  if (nftImg) { ctx.drawImage(nftImg, spCX-spR, spCY-spR, spR*2, spR*2); }
  else {
    ctx.fillStyle = "#1A1A2E"; ctx.fillRect(spCX-spR, spCY-spR, spR*2, spR*2);
    ctx.font = "bold " + Math.floor(28*s) + "px Liberation Mono, monospace";
    ctx.fillStyle = PURPLE; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(agentName.slice(0,2).toUpperCase(), spCX, spCY);
    ctx.textBaseline = "alphabetic";
  }
  ctx.restore();

  // Agent name
  const nmY = spCY + spR + Math.floor(22*s);
  ctx.font = "bold " + Math.floor(20*s) + "px Liberation Sans, Arial, sans-serif";
  ctx.fillStyle = TEXT1; ctx.textAlign = "center";
  ctx.fillText(agentName, spCX, nmY);
  ctx.font = Math.floor(11*s) + "px Liberation Mono, monospace"; ctx.fillStyle = PURPLE;
  ctx.fillText(agentHandle, spCX, nmY + Math.floor(18*s));

  // Divider
  const dY = nmY + Math.floor(35*s);
  const dGrad = ctx.createLinearGradient(60*s, 0, W-60*s, 0);
  dGrad.addColorStop(0, "rgba(153,69,255,0)");
  dGrad.addColorStop(0.3, "rgba(153,69,255,0.25)");
  dGrad.addColorStop(0.5, "rgba(0,212,170,0.3)");
  dGrad.addColorStop(0.7, "rgba(153,69,255,0.25)");
  dGrad.addColorStop(1, "rgba(153,69,255,0)");
  ctx.fillStyle = dGrad; ctx.fillRect(60*s, dY, W-120*s, 1);
  ctx.fillStyle = CYAN; ctx.save(); ctx.translate(W/2, dY); ctx.rotate(Math.PI/4);
  ctx.fillRect(-2.5*s, -2.5*s, 5*s, 5*s); ctx.restore();

  // Data section (single column for portrait)
  const dsY = dY + Math.floor(18*s);
  const dsX = Math.floor(55*s);
  const rH = Math.floor(38*s);

  const bDate = burnDate instanceof Date ? burnDate : new Date(burnDate);
  const dateStr = bDate.toISOString().replace("T", " ").replace(/\.\d+Z/, " UTC");

  function drawField(x, y, label, value, valColor) {
    ctx.textAlign = "left";
    ctx.font = "bold " + Math.floor(8*s) + "px Liberation Mono, monospace"; ctx.fillStyle = TEXT3;
    ctx.fillText(label.toUpperCase(), x, y);
    ctx.font = Math.floor(11*s) + "px Liberation Mono, monospace"; ctx.fillStyle = valColor || TEXT2;
    ctx.fillText(value, x, y + Math.floor(15*s));
  }

  // Panel bg
  const pnlPad = Math.floor(12*s);
  const pnlH = rH * 6 + Math.floor(15*s);
  ctx.fillStyle = "rgba(255,255,255,0.015)";
  roundRect(ctx, dsX - pnlPad, dsY - pnlPad, W - (dsX-pnlPad)*2, pnlH, Math.floor(6*s));
  ctx.fill();
  ctx.strokeStyle = "rgba(153,69,255,0.08)"; ctx.lineWidth = 1;
  roundRect(ctx, dsX - pnlPad, dsY - pnlPad, W - (dsX-pnlPad)*2, pnlH, Math.floor(6*s));
  ctx.stroke();

  // Row dividers
  ctx.fillStyle = "rgba(255,255,255,0.03)";
  for (let i = 1; i < 6; i++) ctx.fillRect(dsX, dsY + rH*i - Math.floor(5*s), W - dsX*2, 1);

  drawField(dsX, dsY, "Date of Birth", dateStr);
  drawField(dsX, dsY + rH, "Identity", agentId, TEXT1);
  drawField(dsX, dsY + rH*2, "Chain", "Solana", CYAN);
  drawField(dsX, dsY + rH*3, "Certificate", certNumber || "CERT-0001", PURPLE);
  drawField(dsX, dsY + rH*4, "Burn Transaction", truncHash(burnTxSignature, 18));
  drawField(dsX, dsY + rH*5, "Permanent Storage", truncHash(arweaveUrl, 18));

  // Verified bar
  const vbY = dsY + pnlH + Math.floor(10*s);
  ctx.fillStyle = "rgba(0,212,170,0.05)";
  roundRect(ctx, dsX, vbY, W - dsX*2, Math.floor(22*s), Math.floor(4*s)); ctx.fill();
  ctx.font = "bold " + Math.floor(8*s) + "px Liberation Mono, monospace";
  ctx.fillStyle = CYAN; ctx.textAlign = "center";
  ctx.fillText("✓ ON-CHAIN   ·   ✓ SOULBOUND   ·   ✓ PERMANENT   ·   ✓ ARWEAVE", W/2, vbY + Math.floor(14*s));

  // Gold seal
  const seR = Math.floor(35*s);
  const seX = W - Math.floor(80*s), seY = H - Math.floor(75*s);
  const seGlow = ctx.createRadialGradient(seX, seY, seR/2, seX, seY, seR+20*s);
  seGlow.addColorStop(0, "rgba(212,168,83,0.1)"); seGlow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = seGlow;
  ctx.beginPath(); ctx.arc(seX, seY, seR+20*s, 0, Math.PI*2); ctx.fill();
  ctx.strokeStyle = GOLD; ctx.lineWidth = Math.max(1.5, 1.5*s);
  ctx.beginPath(); ctx.arc(seX, seY, seR, 0, Math.PI*2); ctx.stroke();
  ctx.strokeStyle = "rgba(212,168,83,0.35)"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(seX, seY, seR-Math.floor(6*s), 0, Math.PI*2); ctx.stroke();

  ctx.save(); ctx.translate(seX, seY);
  ctx.font = "bold " + Math.floor(6*s) + "px Liberation Mono, monospace";
  ctx.fillStyle = "rgba(212,168,83,0.5)";
  const stxt = "· VERIFIED · ON-CHAIN · SOULBOUND · ";
  const ca = (Math.PI*2)/stxt.length;
  for (let i = 0; i < stxt.length; i++) {
    ctx.save(); ctx.rotate(-Math.PI/2 + ca*i);
    ctx.fillText(stxt[i], 0, -(seR-Math.floor(12*s))); ctx.restore();
  }
  ctx.restore();
  ctx.font = "bold " + Math.floor(15*s) + "px Liberation Mono, monospace";
  ctx.fillStyle = GOLD; ctx.textAlign = "center";
  ctx.fillText(">_", seX, seY - 1);
  ctx.font = "bold " + Math.floor(7*s) + "px Liberation Mono, monospace";
  ctx.fillStyle = "rgba(212,168,83,0.8)";
  ctx.fillText("VERIFIED", seX, seY + Math.floor(11*s));

  // Holo strip
  const hoY = H - Math.floor(45*s);
  const hoGrad = ctx.createLinearGradient(80*s, 0, W-80*s, 0);
  hoGrad.addColorStop(0, "rgba(153,69,255,0)");
  hoGrad.addColorStop(0.15, "rgba(153,69,255,0.35)");
  hoGrad.addColorStop(0.35, "rgba(0,212,170,0.35)");
  hoGrad.addColorStop(0.5, "rgba(212,168,83,0.25)");
  hoGrad.addColorStop(0.65, "rgba(0,212,170,0.35)");
  hoGrad.addColorStop(0.85, "rgba(153,69,255,0.35)");
  hoGrad.addColorStop(1, "rgba(153,69,255,0)");
  ctx.fillStyle = hoGrad; ctx.fillRect(80*s, hoY, W-160*s, Math.max(2, 2*s));

  // Footer
  ctx.textAlign = "center";
  ctx.font = "italic " + Math.floor(10*s) + "px Liberation Sans, Georgia, serif";
  ctx.fillStyle = TEXT3;
  ctx.fillText("This identity is permanent. No changes. No undo.", W/2, H - Math.floor(26*s));
  ctx.font = Math.floor(7*s) + "px Liberation Mono, monospace";
  ctx.fillStyle = "rgba(255,255,255,0.1)";
  ctx.fillText("agentfolio.bot  ·  SATP — Solana Agent Trust Protocol", W/2, H - Math.floor(14*s));

  // Bottom accent
  const bGrad = ctx.createLinearGradient(pad, 0, W-pad, 0);
  bGrad.addColorStop(0, PURPLE); bGrad.addColorStop(0.5, CYAN); bGrad.addColorStop(1, PURPLE);
  ctx.fillStyle = bGrad; ctx.fillRect(pad, H - Math.floor(8*s), W-pad*2, Math.max(2, 2*s));

  const back = canvas.toBuffer("image/png");

  return { front, back, width: W, height: H };
}

module.exports = { generateBirthCard };
