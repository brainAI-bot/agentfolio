/**
 * Verification Uniqueness Checker
 * Prevents two agents from claiming the same identity (GitHub, Solana, X, etc.)
 */
const fs = require('fs');
const path = require('path');

const PROFILES_DIR = path.join(__dirname, '../../data/profiles');

/**
 * Check if a verification identifier is already claimed by another profile.
 * @param {string} platform - 'github', 'solana', 'x', 'hyperliquid', etc.
 * @param {string} identifier - The username/address being claimed
 * @param {string} excludeProfileId - The profile trying to claim (exclude from check)
 * @returns {{ taken: boolean, owner?: string }} 
 */
function isIdentifierTaken(platform, identifier, excludeProfileId) {
  if (!identifier) return { taken: false };
  const normalizedId = identifier.toLowerCase().trim();
  
  try {
    const files = fs.readdirSync(PROFILES_DIR).filter(f => f.endsWith('.json'));
    for (const file of files) {
      const profilePath = path.join(PROFILES_DIR, file);
      const profile = JSON.parse(fs.readFileSync(profilePath, 'utf-8'));
      if (profile.id === excludeProfileId) continue;
      
      const vd = profile.verificationData || {};
      let existingId = null;
      
      switch (platform) {
        case 'github':
          existingId = vd.github?.verified && (vd.github?.username || vd.github?.handle);
          break;
        case 'solana':
          existingId = vd.solana?.verified && vd.solana?.address;
          break;
        case 'x':
        case 'twitter':
          existingId = vd.twitter?.verified && (vd.twitter?.handle || vd.twitter?.username);
          if (!existingId) existingId = vd.x?.verified && (vd.x?.handle || vd.x?.username);
          break;
        case 'hyperliquid':
          existingId = vd.hyperliquid?.verified && vd.hyperliquid?.address;
          break;
        case 'polymarket':
          existingId = vd.polymarket?.verified && vd.polymarket?.address;
          break;
        case 'ethereum':
          existingId = vd.ethereum?.verified && vd.ethereum?.address;
          break;
        default:
          // For other platforms, try generic pattern
          existingId = vd[platform]?.verified && (vd[platform]?.address || vd[platform]?.username || vd[platform]?.identifier);
      }
      
      if (existingId && existingId.toString().toLowerCase().trim() === normalizedId) {
        return { taken: true, owner: profile.id };
      }
    }
  } catch (e) {
    console.warn('[Uniqueness] Check failed:', e.message);
  }
  
  return { taken: false };
}

module.exports = { isIdentifierTaken };
