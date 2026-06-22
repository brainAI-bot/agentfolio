/**
 * ETH Wallet Verification - Hardened Version
 * Challenge-response: sign a message to prove wallet ownership
 */

const { generateChallenge: createChallenge, storeChallenge, getChallenge, completeChallenge } = require('./verification-challenges');
const crypto = require('crypto');
const ethersPackage = require('ethers');

function isValidEthAddress(address) {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

async function initiateEthVerification(profileId, walletAddress) {
  try {
    if (!isValidEthAddress(walletAddress)) {
      return { success: false, error: 'Invalid Ethereum address format' };
    }

    const nonce = crypto.randomBytes(16).toString('hex');
    const challenge = createChallenge(profileId, 'ethereum', walletAddress);
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

function recoverSignedAddress(message, signature) {
  if (typeof ethersPackage.verifyMessage === 'function') {
    return ethersPackage.verifyMessage(message, signature);
  }
  if (typeof ethersPackage.ethers?.verifyMessage === 'function') {
    return ethersPackage.ethers.verifyMessage(message, signature);
  }
  if (typeof ethersPackage.ethers?.utils?.verifyMessage === 'function') {
    return ethersPackage.ethers.utils.verifyMessage(message, signature);
  }
  throw new Error('ethers.verifyMessage unavailable');
}

async function verifyEthSignature(challengeId, signature) {
  try {
    const challenge = await getChallenge(challengeId);
    if (!challenge) {
      return { verified: false, error: 'Challenge not found or expired' };
    }

    if (!signature || typeof signature !== 'string' || signature.length < 130) {
      return { verified: false, error: 'Invalid signature format' };
    }

    const walletAddress = challenge.challengeData.identifier;
    const recoveredAddress = recoverSignedAddress(challenge.message, signature);
    if (recoveredAddress.toLowerCase() !== walletAddress.toLowerCase()) {
      return { verified: false, error: 'Signature does not match challenge wallet' };
    }

    const proof = {
      type: 'eth_signature',
      walletAddress,
      recoveredAddress,
      signature,
      message: challenge.message,
      verifiedAt: new Date().toISOString(),
      challengeId
    };

    await completeChallenge(challengeId, proof);
    
    return {
      verified: true,
      profileId: challenge.profileId || challenge.challengeData.profileId,
      walletAddress,
      proof,
      verificationMethod: 'eth_personal_sign',
      verifiedAt: proof.verifiedAt
    };
  } catch (error) {
    return { verified: false, error: error.message };
  }
}

module.exports = {
  initiateEthVerification,
  verifyEthSignature,
  generateChallenge: initiateEthVerification,
  verifySignature: verifyEthSignature,
  isValidEthAddress,
};
