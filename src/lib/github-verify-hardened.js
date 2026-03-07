/**
 * GitHub Verification - Hardened Version
 * Extends existing github-verify.js with cryptographic proof capabilities
 */

// Import original functions
const originalGithub = require('./github-verify');
const { generateChallenge, storeChallenge, getChallenge, completeChallenge } = require('./verification-challenges');

/**
 * STEP 1: Generate verification challenge for GitHub
 */
async function initiateGitHubVerification(profileId, username) {
  try {
    // Validate username exists using original function
    await originalGithub.fetchGitHubUser(username);
    
    // Generate challenge
    const challenge = generateChallenge(profileId, 'github', username);
    const challengeId = await storeChallenge(challenge);
    
    const instructions = `To verify your GitHub account, create a public gist with the following content:

Filename: agentfolio-verification.md
Content:
${challenge.challengeString}

Instructions:
1. Go to https://gist.github.com
2. Create a new public gist  
3. Set filename: agentfolio-verification.md
4. Paste the exact challenge content above
5. Create the gist
6. Copy the gist URL and submit it for verification

This challenge expires in 30 minutes.`;

    return {
      success: true,
      challengeId,
      username,
      instructions,
      challengeString: challenge.challengeString,
      expiresAt: challenge.expiresAt
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * STEP 2: Verify gist contains correct challenge
 */
async function verifyGitHubGist(challengeId, gistUrl) {
  try {
    const challenge = await getChallenge(challengeId);
    if (!challenge) {
      return { 
        verified: false, 
        error: 'Challenge not found or expired' 
      };
    }

    // Extract gist ID from URL
    const gistIdMatch = gistUrl.match(/gist\.github\.com\/[^\/]+\/([a-f0-9]+)/);
    if (!gistIdMatch) {
      return { 
        verified: false, 
        error: 'Invalid gist URL format' 
      };
    }

    const gistId = gistIdMatch[1];
    
    // Fetch gist content using original function pattern
    const https = require('https');
    const gist = await new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.github.com',
        path: `/gists/${gistId}`,
        headers: {
          'User-Agent': 'AgentFolio/1.0',
          'Accept': 'application/vnd.github.v3+json'
        }
      };

      https.get(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode === 200) {
            resolve(JSON.parse(data));
          } else {
            reject(new Error(`GitHub API error: ${res.statusCode}`));
          }
        });
      }).on('error', reject);
    });
    
    // Verify gist owner matches challenge username
    if (gist.owner.login.toLowerCase() !== challenge.challengeData.identifier.toLowerCase()) {
      return { 
        verified: false, 
        error: 'Gist owner does not match verification username' 
      };
    }

    // Check if any file contains the challenge
    const expectedChallenge = challenge.challengeString;
    let found = false;
    
    for (const [filename, file] of Object.entries(gist.files)) {
      if (file.content && file.content.trim() === expectedChallenge.trim()) {
        found = true;
        break;
      }
    }

    if (!found) {
      return { 
        verified: false, 
        error: 'Gist does not contain the correct challenge content' 
      };
    }

    // Mark challenge as completed
    const proof = {
      type: 'github_gist',
      gistUrl,
      gistId,
      username: gist.owner.login,
      verifiedAt: new Date().toISOString(),
      gistCreatedAt: gist.created_at
    };

    await completeChallenge(challengeId, proof);

    // Get user stats using original function
    const userStats = await originalGithub.getGitHubStats(challenge.challengeData.identifier);
    
    return {
      verified: true,
      username: gist.owner.login,
      proof,
      verificationMethod: 'cryptographic_gist_proof',
      stats: userStats,
      verifiedAt: proof.verifiedAt
    };
  } catch (error) {
    return {
      verified: false,
      error: error.message
    };
  }
}

// Re-export all original functions
module.exports = {
  ...originalGithub,
  // Override with hardened versions
  initiateGitHubVerification,
  verifyGitHubGist
};
