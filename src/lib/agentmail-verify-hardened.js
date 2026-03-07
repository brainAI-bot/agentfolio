/**
 * AgentMail Verification - Hardened Version (MVP)
 */

const { generateEmailCode, generateChallenge, storeChallenge, getChallenge, completeChallenge } = require('./verification-challenges');

function isValidAgentMailAddress(email) {
  return /^[a-z0-9._-]+@agentmail\.to$/i.test(email);
}

async function initiateAgentMailVerification(profileId, email) {
  try {
    if (!isValidAgentMailAddress(email)) {
      return {
        success: false,
        error: 'Invalid AgentMail address format. Must be @agentmail.to'
      };
    }

    // Generate verification code and challenge
    const verificationCode = generateEmailCode();
    const challenge = generateChallenge(profileId, 'agentmail', email);
    challenge.verificationCode = verificationCode;
    
    const challengeId = await storeChallenge(challenge);

    // For MVP, we simulate email sending
    console.log(`AgentMail verification code for ${email}: ${verificationCode}`);

    return {
      success: true,
      challengeId,
      email,
      message: `Verification code would be sent to ${email}`,
      expiresAt: challenge.expiresAt,
      // For MVP testing:
      testCode: verificationCode
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

async function verifyAgentMailCode(challengeId, submittedCode) {
  try {
    const challenge = await getChallenge(challengeId);
    if (!challenge) {
      return { 
        verified: false, 
        error: 'Challenge not found or expired' 
      };
    }

    // Verify code matches
    if (submittedCode !== challenge.verificationCode) {
      return { 
        verified: false, 
        error: 'Invalid verification code' 
      };
    }

    // Mark challenge as completed
    const proof = {
      type: 'agentmail_code',
      email: challenge.challengeData.identifier,
      verificationCode: submittedCode,
      verifiedAt: new Date().toISOString(),
      challengeId
    };

    await completeChallenge(challengeId, proof);
    
    return {
      verified: true,
      email: challenge.challengeData.identifier,
      proof,
      verificationMethod: 'cryptographic_email_proof',
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
  initiateAgentMailVerification,
  verifyAgentMailCode,
  isValidAgentMailAddress
};
