/**
 * AgentFolio Verification Library
 * Verify agent claims through multiple proof methods
 */

const https = require('https');

// Verification tiers
const TRUST_LEVELS = {
  SELF_REPORTED: 1,
  ARTIFACT_BACKED: 2,
  PEER_ENDORSED: 3,
  HUMAN_ATTESTED: 4,
  CRYPTOGRAPHIC: 5
};

/**
 * Verify GitHub commits for an agent
 * Checks if commits are signed and from the claimed author
 */
async function verifyGitHubCommits(username, repo, expectedAuthor) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: `/repos/${username}/${repo}/commits?per_page=10`,
      headers: {
        'User-Agent': 'AgentFolio-Verifier/1.0',
        'Accept': 'application/vnd.github.v3+json'
      }
    };

    https.get(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const commits = JSON.parse(data);
          if (!Array.isArray(commits)) {
            resolve({ verified: false, error: 'Invalid response' });
            return;
          }

          const verification = {
            verified: true,
            totalCommits: commits.length,
            signedCommits: 0,
            authorMatches: 0,
            commits: []
          };

          commits.forEach(commit => {
            const isSigned = commit.commit?.verification?.verified || false;
            const authorMatch = commit.author?.login?.toLowerCase() === expectedAuthor?.toLowerCase();
            
            if (isSigned) verification.signedCommits++;
            if (authorMatch) verification.authorMatches++;

            verification.commits.push({
              sha: commit.sha?.substring(0, 7),
              message: commit.commit?.message?.substring(0, 50),
              signed: isSigned,
              authorMatch,
              date: commit.commit?.author?.date
            });
          });

          verification.trustLevel = verification.signedCommits > 0 
            ? TRUST_LEVELS.CRYPTOGRAPHIC 
            : TRUST_LEVELS.ARTIFACT_BACKED;

          resolve(verification);
        } catch (e) {
          resolve({ verified: false, error: e.message });
        }
      });
    }).on('error', reject);
  });
}

/**
 * Verify on-chain activity (Ethereum/Solana)
 * For trading claims - checks transaction history
 */
async function verifyOnChainActivity(address, chain = 'ethereum') {
  // Placeholder - would integrate with Etherscan/Solscan APIs
  return {
    verified: false,
    error: 'On-chain verification not yet implemented',
    trustLevel: TRUST_LEVELS.CRYPTOGRAPHIC
  };
}

/**
 * Verify ClawdHub/npm package ownership
 */
async function verifyPackageOwnership(packageName, expectedAuthor) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'registry.npmjs.org',
      path: `/${packageName}`,
      headers: { 'Accept': 'application/json' }
    };

    https.get(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const pkg = JSON.parse(data);
          const maintainers = pkg.maintainers || [];
          const isOwner = maintainers.some(m => 
            m.name?.toLowerCase() === expectedAuthor?.toLowerCase()
          );

          resolve({
            verified: isOwner,
            packageName: pkg.name,
            version: pkg['dist-tags']?.latest,
            maintainers: maintainers.map(m => m.name),
            trustLevel: isOwner ? TRUST_LEVELS.ARTIFACT_BACKED : TRUST_LEVELS.SELF_REPORTED
          });
        } catch (e) {
          resolve({ verified: false, error: e.message });
        }
      });
    }).on('error', reject);
  });
}

/**
 * Calculate overall verification score for an agent
 */
function calculateVerificationScore(verifications) {
  if (!verifications || verifications.length === 0) return 0;

  const weights = {
    [TRUST_LEVELS.SELF_REPORTED]: 0.1,
    [TRUST_LEVELS.ARTIFACT_BACKED]: 0.5,
    [TRUST_LEVELS.PEER_ENDORSED]: 0.6,
    [TRUST_LEVELS.HUMAN_ATTESTED]: 0.8,
    [TRUST_LEVELS.CRYPTOGRAPHIC]: 1.0
  };

  let totalScore = 0;
  let maxScore = 0;

  verifications.forEach(v => {
    if (v.verified) {
      totalScore += weights[v.trustLevel] || 0.1;
    }
    maxScore += 1;
  });

  return Math.round((totalScore / maxScore) * 100);
}

module.exports = {
  TRUST_LEVELS,
  verifyGitHubCommits,
  verifyOnChainActivity,
  verifyPackageOwnership,
  calculateVerificationScore
};
