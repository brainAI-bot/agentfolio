/**
 * Domain Verification - Hardened Version
 * Challenge-response: add DNS TXT record or .well-known file to prove ownership
 */

const { generateChallenge, storeChallenge, getChallenge, completeChallenge } = require('./verification-challenges');
const crypto = require('crypto');
const dns = require('dns').promises;
const https = require('https');
const http = require('http');

function isValidDomain(domain) {
  return /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z]{2,})+$/.test(domain);
}

async function initiateDomainVerification(profileId, domain) {
  try {
    if (!isValidDomain(domain)) {
      return { success: false, error: 'Invalid domain format' };
    }

    const token = crypto.randomBytes(20).toString('hex');
    const challenge = generateChallenge(profileId, 'domain', domain);
    challenge.verificationToken = token;
    challenge.methods = {
      dns: {
        type: 'TXT',
        host: '_agentfolio',
        value: `agentfolio-verify=${token}`,
        instruction: `Add a DNS TXT record: _agentfolio.${domain} → agentfolio-verify=${token}`
      },
      wellKnown: {
        url: `https://${domain}/.well-known/agentfolio.json`,
        content: { agentfolio: { profileId, token } },
        instruction: `Create https://${domain}/.well-known/agentfolio.json with {"agentfolio":{"profileId":"${profileId}","token":"${token}"}}`
      }
    };

    const challengeId = await storeChallenge(challenge);

    return {
      success: true,
      challengeId,
      domain,
      verificationMethods: challenge.methods,
      expiresAt: challenge.expiresAt,
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function verifyDomainOwnership(challengeId) {
  try {
    const challenge = await getChallenge(challengeId);
    if (!challenge) {
      return { verified: false, error: 'Challenge not found or expired' };
    }

    const domain = challenge.challengeData.identifier;
    const token = challenge.verificationToken;
    let method = null;

    // Method 1: Check DNS TXT record
    try {
      const records = await dns.resolveTxt(`_agentfolio.${domain}`);
      const flat = records.map(r => r.join('')).join('');
      if (flat.includes(`agentfolio-verify=${token}`)) {
        method = 'dns_txt';
      }
    } catch (e) { /* DNS lookup failed, try .well-known */ }

    // Method 2: Check .well-known
    if (!method) {
      try {
        const body = await fetchUrl(`https://${domain}/.well-known/agentfolio.json`);
        const data = JSON.parse(body);
        if (data?.agentfolio?.token === token) {
          method = 'well_known';
        }
      } catch (e) { /* .well-known fetch failed */ }
    }

    if (!method) {
      return {
        verified: false,
        error: 'Verification token not found. Add DNS TXT record or .well-known file and try again.',
        expectedDns: `_agentfolio.${domain} TXT agentfolio-verify=${token}`,
        expectedWellKnown: `https://${domain}/.well-known/agentfolio.json`
      };
    }

    const proof = {
      type: 'domain_ownership',
      domain,
      method,
      verifiedAt: new Date().toISOString(),
      challengeId
    };

    await completeChallenge(challengeId, proof);

    return {
      verified: true,
      domain,
      method,
      proof,
      verifiedAt: proof.verifiedAt
    };
  } catch (error) {
    return { verified: false, error: error.message };
  }
}

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { timeout: 5000 }, (res) => {
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

module.exports = { initiateDomainVerification, verifyDomainOwnership, isValidDomain };
