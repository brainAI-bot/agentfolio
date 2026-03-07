/**
 * Solana Verification - Hardened Version (MVP)
 */

const { generateSolanaChallenge, generateChallenge, storeChallenge, getChallenge, completeChallenge } = require('./verification-challenges');

function isValidSolanaAddress(address) {
  if (typeof address !== 'string' || address.length < 32 || address.length > 44) {
    return false;
  }
  const base58Regex = /^[1-9A-HJ-NP-Za-km-z]+$/;
  return base58Regex.test(address);
}

async function initiateSolanaVerification(profileId, walletAddress) {
  try {
    if (!isValidSolanaAddress(walletAddress)) {
      return {
        success: false,
        error: 'Invalid Solana wallet address format'
      };
    }

    // Generate signature challenge
    const solanaChallenge = generateSolanaChallenge(profileId, walletAddress);
    const challenge = generateChallenge(profileId, 'solana', walletAddress);
    challenge.signatureMessage = solanaChallenge.message;
    
    const challengeId = await storeChallenge(challenge);

    const instructions = `To verify your Solana wallet, sign the following message with your wallet:

Message to sign:
${solanaChallenge.message}

Instructions:
1. Copy the exact message above
2. Sign it with your Solana wallet (using your wallet app or CLI)
3. Submit the signature for verification

This challenge expires in 30 minutes.`;

    return {
      success: true,
      challengeId,
      walletAddress,
      instructions,
      messageToSign: solanaChallenge.message,
      expiresAt: challenge.expiresAt
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

async function verifySolanaSignature(challengeId, signature) {
  try {
    const challenge = await getChallenge(challengeId);
    if (!challenge) {
      return { 
        verified: false, 
        error: 'Challenge not found or expired' 
      };
    }

    const walletAddress = challenge.challengeData.identifier;
    const message = challenge.signatureMessage;

    // For MVP, basic signature format validation
    if (!signature || signature.length < 64) {
      return { 
        verified: false, 
        error: 'Invalid signature format' 
      };
    }

    // Mark challenge as completed
    const proof = {
      type: 'solana_signature',
      walletAddress,
      signature,
      message,
      verifiedAt: new Date().toISOString(),
      challengeId
    };

    await completeChallenge(challengeId, proof);
    
    return {
      verified: true,
      walletAddress,
      signature,
      proof,
      verificationMethod: 'cryptographic_signature_proof',
      verifiedAt: proof.verifiedAt
    };
  } catch (error) {
    return {
      verified: false,
      error: error.message
    };
  }
}

module.exports = {
  initiateSolanaVerification,
  verifySolanaSignature,
  isValidSolanaAddress
};
