/**
 * Solana Verification - Hardened Version (FIXED)
 * BUG-001 fix: Actually verify ed25519 signature cryptographically
 */

const nacl = require('tweetnacl');
const _bs58 = require('bs58');
const bs58 = _bs58.default || _bs58;
const { generateSolanaChallenge, generateChallenge, storeChallenge, getChallenge, completeChallenge } = require('./verification-challenges');

function isValidSolanaAddress(address) {
  if (typeof address !== 'string' || address.length < 32 || address.length > 44) return false;
  const base58Regex = /^[1-9A-HJ-NP-Za-km-z]+$/;
  return base58Regex.test(address);
}

async function initiateSolanaVerification(profileId, walletAddress) {
  try {
    if (!isValidSolanaAddress(walletAddress)) {
      return { success: false, error: 'Invalid Solana wallet address format' };
    }

    const solanaChallenge = generateSolanaChallenge(profileId, walletAddress);
    const challenge = generateChallenge(profileId, 'solana', walletAddress);
    challenge.signatureMessage = solanaChallenge.message;

    const challengeId = await storeChallenge(challenge);

    return {
      success: true,
      challengeId,
      walletAddress,
      instructions: `Sign the following message with your Solana wallet to prove ownership:\n\n${solanaChallenge.message}\n\nThis challenge expires in 30 minutes.`,
      messageToSign: solanaChallenge.message,
      expiresAt: challenge.expiresAt,
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function verifySolanaSignature(challengeId, signature) {
  try {
    const challenge = await getChallenge(challengeId);
    if (!challenge) {
      return { verified: false, error: 'Challenge not found or expired' };
    }

    const walletAddress = challenge.challengeData.identifier;
    const message = challenge.signatureMessage;

    if (!signature || typeof signature !== 'string') {
      return { verified: false, error: 'Signature is required' };
    }

    // Decode the wallet public key (base58 → 32 bytes)
    let pubkeyBytes;
    try {
      pubkeyBytes = bs58.decode(walletAddress);
      if (pubkeyBytes.length !== 32) throw new Error('Invalid pubkey length');
    } catch (e) {
      return { verified: false, error: `Invalid wallet address: ${e.message}` };
    }

    // Decode the signature (base58 or base64 → 64 bytes)
    let sigBytes;
    try {
      try {
        sigBytes = bs58.decode(signature);
      } catch {
        sigBytes = Buffer.from(signature, 'base64');
      }
      if (sigBytes.length !== 64) {
        return { verified: false, error: `Invalid signature length: expected 64 bytes, got ${sigBytes.length}` };
      }
    } catch (e) {
      return { verified: false, error: `Cannot decode signature: ${e.message}` };
    }

    // Encode message as bytes
    const msgBytes = new TextEncoder().encode(message);

    // Cryptographically verify the ed25519 signature
    const valid = nacl.sign.detached.verify(msgBytes, sigBytes, pubkeyBytes);

    if (!valid) {
      return {
        verified: false,
        error: 'Signature verification failed — signature does not match the wallet address',
      };
    }

    // Mark challenge as completed with proof
    const proof = {
      type: 'solana_ed25519_signature',
      walletAddress,
      signature,
      message,
      verifiedAt: new Date().toISOString(),
      challengeId,
      cryptoVerified: true,
    };

    await completeChallenge(challengeId, proof);

    return {
      verified: true,
      walletAddress,
      signature,
      proof,
      verificationMethod: 'ed25519_cryptographic_proof',
      verifiedAt: proof.verifiedAt,
    };
  } catch (error) {
    return { verified: false, error: error.message };
  }
}

module.exports = {
  initiateSolanaVerification,
  verifySolanaSignature,
  isValidSolanaAddress,
};
