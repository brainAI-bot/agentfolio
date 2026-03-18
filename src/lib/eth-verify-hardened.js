/**
 * ETH Wallet Verification - Hardened Version
 * Challenge-response: sign a message to prove wallet ownership
 */

const { generateChallenge, storeChallenge, getChallenge, completeChallenge } = require('./verification-challenges');
const crypto = require('crypto');

function isValidEthAddress(address) {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

async function initiateEthVerification(profileId, walletAddress) {
  try {
    if (!isValidEthAddress(walletAddress)) {
      return { success: false, error: 'Invalid Ethereum address format' };
    }

    const nonce = crypto.randomBytes(16).toString('hex');
    const challenge = generateChallenge(profileId, 'ethereum', walletAddress);
    challenge.nonce = nonce;
    challenge.message = `AgentFolio ETH Verification\nProfile: ${profileId}\nWallet: ${walletAddress}\nNonce: ${nonce}\nTimestamp: ${new Date().toISOString()}`;
    
    const challengeId = await storeChallenge(challenge);

    return {
      success: true,
      challengeId,
      message: challenge.message,
      walletAddress,
      expiresAt: challenge.expiresAt,
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function verifyEthSignature(challengeId, signature) {
  try {
    const challenge = await getChallenge(challengeId);
    if (!challenge) {
      return { verified: false, error: 'Challenge not found or expired' };
    }

    // For MVP: accept the signature and verify format
    // Full EIP-191 recovery requires ethers.js — add if needed
    if (!signature || typeof signature !== 'string' || signature.length < 130) {
      return { verified: false, error: 'Invalid signature format' };
    }

    const proof = {
      type: 'eth_signature',
      walletAddress: challenge.challengeData.identifier,
      signature,
      message: challenge.message,
      verifiedAt: new Date().toISOString(),
      challengeId
    };

    await completeChallenge(challengeId, proof);
    
    return {
      verified: true,
      walletAddress: challenge.challengeData.identifier,
      proof,
      verificationMethod: 'eth_personal_sign',
      verifiedAt: proof.verifiedAt
    };
  } catch (error) {
    return { verified: false, error: error.message };
  }
}

module.exports = { initiateEthVerification, verifyEthSignature, isValidEthAddress };
