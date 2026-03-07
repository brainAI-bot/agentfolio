/**
 * Custom Proofs Library
 * Allows agents to upload screenshots, links, and other proof materials
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '../../data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const PROOFS_FILE = path.join(DATA_DIR, 'custom-proofs.json');

// Ensure directories exist
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Proof types
const PROOF_TYPES = {
  screenshot: { icon: '📸', label: 'Screenshot', acceptsFile: true },
  link: { icon: '🔗', label: 'External Link', acceptsFile: false },
  document: { icon: '📄', label: 'Document', acceptsFile: true },
  video: { icon: '🎬', label: 'Video Link', acceptsFile: false },
  tweet: { icon: '🐦', label: 'Tweet/X Post', acceptsFile: false },
  github: { icon: '💻', label: 'GitHub Link', acceptsFile: false },
  contract: { icon: '📜', label: 'Smart Contract', acceptsFile: false },
  transaction: { icon: '💎', label: 'On-chain Transaction', acceptsFile: false },
  testimonial: { icon: '💬', label: 'Testimonial', acceptsFile: false },
  other: { icon: '📎', label: 'Other', acceptsFile: true }
};

// Max file size: 5MB
const MAX_FILE_SIZE = 5 * 1024 * 1024;

// Allowed MIME types for uploads
const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf'
];

/**
 * Load all proofs from file
 */
function loadProofs() {
  if (!fs.existsSync(PROOFS_FILE)) {
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(PROOFS_FILE, 'utf8'));
  } catch (e) {
    console.error('[CustomProofs] Error loading proofs:', e.message);
    return {};
  }
}

/**
 * Save proofs to file
 */
function saveProofs(proofs) {
  fs.writeFileSync(PROOFS_FILE, JSON.stringify(proofs, null, 2));
}

/**
 * Get proofs for a profile
 */
function getProfileProofs(profileId) {
  const proofs = loadProofs();
  return proofs[profileId] || [];
}

/**
 * Add a new proof (link-based)
 */
function addLinkProof(profileId, { type, title, description, url, relatedTo }) {
  if (!PROOF_TYPES[type]) {
    return { error: 'Invalid proof type' };
  }
  
  if (!url) {
    return { error: 'URL is required' };
  }
  
  // Basic URL validation
  try {
    new URL(url);
  } catch (e) {
    return { error: 'Invalid URL format' };
  }
  
  const proofs = loadProofs();
  if (!proofs[profileId]) {
    proofs[profileId] = [];
  }
  
  const proof = {
    id: 'proof_' + crypto.randomBytes(8).toString('hex'),
    type,
    title: title || PROOF_TYPES[type].label,
    description: description || '',
    url,
    relatedTo: relatedTo || null, // Can link to a skill or portfolio item
    createdAt: new Date().toISOString(),
    verified: false
  };
  
  proofs[profileId].push(proof);
  saveProofs(proofs);
  
  return { success: true, proof };
}

/**
 * Add a file-based proof (screenshot, document)
 */
function addFileProof(profileId, { type, title, description, relatedTo, fileData, mimeType, filename }) {
  if (!PROOF_TYPES[type]) {
    return { error: 'Invalid proof type' };
  }
  
  if (!PROOF_TYPES[type].acceptsFile) {
    return { error: 'This proof type does not accept file uploads' };
  }
  
  if (!fileData) {
    return { error: 'File data is required' };
  }
  
  // Check MIME type
  if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
    return { error: 'File type not allowed. Accepted: JPEG, PNG, GIF, WebP, PDF' };
  }
  
  // Decode base64 if needed
  let buffer;
  if (typeof fileData === 'string') {
    // Remove data URL prefix if present
    const base64Data = fileData.replace(/^data:[^;]+;base64,/, '');
    buffer = Buffer.from(base64Data, 'base64');
  } else {
    buffer = fileData;
  }
  
  // Check file size
  if (buffer.length > MAX_FILE_SIZE) {
    return { error: 'File too large. Maximum size: 5MB' };
  }
  
  // Generate unique filename
  const ext = mimeType.split('/')[1] || 'bin';
  const uniqueFilename = `${profileId}_${crypto.randomBytes(8).toString('hex')}.${ext}`;
  const filePath = path.join(UPLOADS_DIR, uniqueFilename);
  
  // Save file
  fs.writeFileSync(filePath, buffer);
  
  // Add proof record
  const proofs = loadProofs();
  if (!proofs[profileId]) {
    proofs[profileId] = [];
  }
  
  const proof = {
    id: 'proof_' + crypto.randomBytes(8).toString('hex'),
    type,
    title: title || filename || PROOF_TYPES[type].label,
    description: description || '',
    filename: uniqueFilename,
    originalFilename: filename,
    mimeType,
    fileSize: buffer.length,
    url: `/uploads/${uniqueFilename}`,
    relatedTo: relatedTo || null,
    createdAt: new Date().toISOString(),
    verified: false
  };
  
  proofs[profileId].push(proof);
  saveProofs(proofs);
  
  return { success: true, proof };
}

/**
 * Delete a proof
 */
function deleteProof(profileId, proofId) {
  const proofs = loadProofs();
  
  if (!proofs[profileId]) {
    return { error: 'No proofs found for this profile' };
  }
  
  const proofIndex = proofs[profileId].findIndex(p => p.id === proofId);
  if (proofIndex === -1) {
    return { error: 'Proof not found' };
  }
  
  const proof = proofs[profileId][proofIndex];
  
  // Delete file if it exists
  if (proof.filename) {
    const filePath = path.join(UPLOADS_DIR, proof.filename);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
  
  // Remove from array
  proofs[profileId].splice(proofIndex, 1);
  saveProofs(proofs);
  
  return { success: true };
}

/**
 * Update proof details
 */
function updateProof(profileId, proofId, updates) {
  const proofs = loadProofs();
  
  if (!proofs[profileId]) {
    return { error: 'No proofs found for this profile' };
  }
  
  const proof = proofs[profileId].find(p => p.id === proofId);
  if (!proof) {
    return { error: 'Proof not found' };
  }
  
  // Only allow updating certain fields
  const allowedUpdates = ['title', 'description', 'relatedTo'];
  for (const key of allowedUpdates) {
    if (updates[key] !== undefined) {
      proof[key] = updates[key];
    }
  }
  
  proof.updatedAt = new Date().toISOString();
  saveProofs(proofs);
  
  return { success: true, proof };
}

/**
 * Get file from uploads directory
 */
function getUploadedFile(filename) {
  // Sanitize filename to prevent directory traversal
  const sanitized = path.basename(filename);
  const filePath = path.join(UPLOADS_DIR, sanitized);
  
  if (!fs.existsSync(filePath)) {
    return null;
  }
  
  return {
    path: filePath,
    data: fs.readFileSync(filePath),
    mimeType: getMimeType(sanitized)
  };
}

/**
 * Get MIME type from filename
 */
function getMimeType(filename) {
  const ext = path.extname(filename).toLowerCase();
  const mimeTypes = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.pdf': 'application/pdf'
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

/**
 * Generate HTML for displaying proofs
 */
function renderProofsSection(proofs, editable = false) {
  if (!proofs || proofs.length === 0) {
    return '<p style="color:#71717a;font-size:14px;">No custom proofs uploaded yet.</p>';
  }
  
  return proofs.map(proof => {
    const typeInfo = PROOF_TYPES[proof.type] || PROOF_TYPES.other;
    const isImage = proof.mimeType && proof.mimeType.startsWith('image/');
    
    return `
      <div class="proof-card" data-proof-id="${proof.id}" style="background:#18181b;border:1px solid #27272a;border-radius:12px;padding:16px;margin-bottom:12px;">
        <div style="display:flex;align-items:flex-start;gap:12px;">
          <div style="width:48px;height:48px;border-radius:8px;background:#27272a;display:flex;align-items:center;justify-content:center;font-size:24px;flex-shrink:0;">
            ${typeInfo.icon}
          </div>
          <div style="flex:1;min-width:0;">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
              <span style="font-weight:600;color:#e4e4e7;">${escapeHtml(proof.title)}</span>
              <span style="font-size:11px;background:#27272a;padding:2px 8px;border-radius:4px;color:#71717a;">${typeInfo.label}</span>
              ${proof.verified ? '<span style="font-size:11px;background:rgba(34,197,94,0.2);padding:2px 8px;border-radius:4px;color:#22c55e;">✓ Verified</span>' : ''}
            </div>
            ${proof.description ? `<p style="color:#a1a1aa;font-size:13px;margin:8px 0;">${escapeHtml(proof.description)}</p>` : ''}
            ${proof.relatedTo ? `<div style="font-size:12px;color:#71717a;">Related to: <span style="color:#a78bfa;">${escapeHtml(proof.relatedTo)}</span></div>` : ''}
            <div style="display:flex;align-items:center;gap:12px;margin-top:8px;">
              ${proof.url ? `<a href="${escapeHtml(proof.url)}" target="_blank" style="font-size:13px;color:#6366f1;display:flex;align-items:center;gap:4px;">
                ${isImage ? '🖼️ View Image' : '🔗 View Proof'} →
              </a>` : ''}
              <span style="font-size:11px;color:#52525b;">${new Date(proof.createdAt).toLocaleDateString()}</span>
              ${editable ? `<button onclick="deleteProof('${proof.id}')" style="font-size:11px;color:#ef4444;background:none;border:none;cursor:pointer;margin-left:auto;">🗑️ Delete</button>` : ''}
            </div>
          </div>
          ${isImage ? `
            <a href="${escapeHtml(proof.url)}" target="_blank" style="flex-shrink:0;">
              <img src="${escapeHtml(proof.url)}" alt="${escapeHtml(proof.title)}" style="width:80px;height:80px;object-fit:cover;border-radius:8px;border:1px solid #27272a;">
            </a>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');
}

/**
 * Escape HTML for safe rendering
 */
function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

module.exports = {
  PROOF_TYPES,
  MAX_FILE_SIZE,
  ALLOWED_MIME_TYPES,
  getProfileProofs,
  addLinkProof,
  addFileProof,
  deleteProof,
  updateProof,
  getUploadedFile,
  renderProofsSection
};
