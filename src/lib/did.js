/**
 * AgentFolio DID (Decentralized Identity) Library
 * Supports W3C DID v1.1 and ERC-8004 Trustless Agents standard
 * 
 * DID Format: did:agentfolio:{agent_id}
 * ERC-8004 Format: Agent Registration File with Identity/Reputation/Validation registries
 */

const crypto = require('crypto');
const path = require('path');

// DID Method: did:agentfolio
const DID_METHOD = 'agentfolio';
const DID_CONTEXT = [
  'https://www.w3.org/ns/did/v1',
  'https://w3id.org/security/suites/ed25519-2020/v1',
  'https://w3id.org/security/suites/secp256k1-2019/v1'
];

// ERC-8004 Protocol Types
const PROTOCOL_TYPES = {
  A2A: 'a2a',           // Agent-to-Agent (Google/Linux Foundation)
  MCP: 'mcp',           // Model Context Protocol (Anthropic)
  ENS: 'ens',           // Ethereum Name Service
  WALLET: 'wallet',     // Crypto wallet address
  AGENTMAIL: 'agentmail', // AgentMail protocol
  HTTP: 'http'          // Standard HTTP API
};

// Verification Method Types
const VERIFICATION_TYPES = {
  ED25519: 'Ed25519VerificationKey2020',
  SECP256K1: 'EcdsaSecp256k1VerificationKey2019',
  ETHEREUM: 'EcdsaSecp256k1RecoveryMethod2020',
  SOLANA: 'Ed25519VerificationKey2020'
};

/**
 * Generate a DID from an AgentFolio profile ID
 * @param {string} profileId - The AgentFolio profile ID (e.g., agent_brainkid)
 * @returns {string} - The DID (e.g., did:agentfolio:agent_brainkid)
 */
function createDID(profileId) {
  return `did:${DID_METHOD}:${profileId}`;
}

/**
 * Parse a DID to extract the profile ID
 * @param {string} did - The full DID string
 * @returns {object} - { method, id } or null if invalid
 */
function parseDID(did) {
  const match = did.match(/^did:([a-z0-9]+):(.+)$/);
  if (!match) return null;
  return {
    method: match[1],
    id: match[2]
  };
}

/**
 * Check if a DID is an AgentFolio DID
 * @param {string} did - The DID to check
 * @returns {boolean}
 */
function isAgentFolioDID(did) {
  const parsed = parseDID(did);
  return parsed && parsed.method === DID_METHOD;
}

/**
 * Generate a W3C DID Document from an AgentFolio profile
 * @param {object} profile - The AgentFolio profile object
 * @param {string} baseUrl - The base URL of the AgentFolio instance
 * @returns {object} - W3C DID Document
 */
function generateDIDDocument(profile, baseUrl = 'https://agentfolio.bot') {
  const did = createDID(profile.id);
  
  const document = {
    '@context': DID_CONTEXT,
    id: did,
    controller: did,
    created: profile.created_at || profile.createdAt || new Date().toISOString(),
    updated: profile.updated_at || profile.updatedAt || new Date().toISOString(),
    
    // Verification methods (cryptographic proofs)
    verificationMethod: [],
    
    // Authentication methods
    authentication: [],
    
    // Assertion methods (for signing credentials)
    assertionMethod: [],
    
    // Service endpoints
    service: []
  };
  
  // Add wallet-based verification methods
  const wallets = profile.wallets || {};
  const verification = profile.verification || {};
  
  // Ethereum/EVM wallets
  if (wallets.ethereum || verification.hyperliquid?.wallet) {
    const ethAddress = wallets.ethereum || verification.hyperliquid?.wallet;
    const vmId = `${did}#ethereum-key-1`;
    document.verificationMethod.push({
      id: vmId,
      type: VERIFICATION_TYPES.ETHEREUM,
      controller: did,
      blockchainAccountId: `eip155:1:${ethAddress}`
    });
    document.authentication.push(vmId);
    document.assertionMethod.push(vmId);
  }
  
  // Solana wallets
  if (wallets.solana || verification.solana?.wallet) {
    const solAddress = wallets.solana || verification.solana?.wallet;
    const vmId = `${did}#solana-key-1`;
    document.verificationMethod.push({
      id: vmId,
      type: VERIFICATION_TYPES.SOLANA,
      controller: did,
      publicKeyBase58: solAddress
    });
    document.authentication.push(vmId);
    document.assertionMethod.push(vmId);
  }
  
  // Base wallet (Coinbase)
  if (wallets.base) {
    const vmId = `${did}#base-key-1`;
    document.verificationMethod.push({
      id: vmId,
      type: VERIFICATION_TYPES.ETHEREUM,
      controller: did,
      blockchainAccountId: `eip155:8453:${wallets.base}`
    });
    document.authentication.push(vmId);
  }
  
  // Service endpoints
  
  // AgentFolio Profile (primary)
  document.service.push({
    id: `${did}#agentfolio`,
    type: 'AgentProfile',
    serviceEndpoint: `${baseUrl}/profile/${profile.id}`
  });
  
  // AgentFolio API
  document.service.push({
    id: `${did}#api`,
    type: 'AgentAPI',
    serviceEndpoint: `${baseUrl}/api/profile/${profile.id}`
  });
  
  // Contact endpoint (if AgentMail verified)
  if (verification.agentmail?.verified) {
    document.service.push({
      id: `${did}#messaging`,
      type: 'AgentMessaging',
      serviceEndpoint: `${baseUrl}/contact/${profile.id}`,
      protocol: PROTOCOL_TYPES.AGENTMAIL
    });
  }
  
  // GitHub
  if (profile.links?.github || verification.github?.username) {
    const githubUser = profile.links?.github?.replace('https://github.com/', '') || 
                       verification.github?.username;
    document.service.push({
      id: `${did}#github`,
      type: 'LinkedCode',
      serviceEndpoint: `https://github.com/${githubUser}`
    });
  }
  
  // Twitter/X
  if (profile.links?.twitter || verification.twitter?.verified) {
    const xHandle = profile.links?.twitter?.replace(/https?:\/\/(www\.)?(twitter|x)\.com\//, '') ||
                          verification.twitter?.handle;
    document.service.push({
      id: `${did}#twitter`,
      type: 'LinkedSocial',
      serviceEndpoint: `https://x.com/${twitterHandle}`
    });
  }
  
  // Moltbook
  if (profile.links?.moltbook) {
    document.service.push({
      id: `${did}#moltbook`,
      type: 'LinkedProfile',
      serviceEndpoint: profile.links.moltbook
    });
  }
  
  // Add alsoKnownAs for linked identities
  document.alsoKnownAs = [];
  
  if (profile.links?.x) {
    document.alsoKnownAs.push(`https://x.com/${profile.links.twitter.replace(/https?:\/\/(www\.)?(twitter|x)\.com\//, '')}`);
  }
  if (profile.links?.github) {
    document.alsoKnownAs.push(profile.links.github);
  }
  if (wallets.ethereum) {
    document.alsoKnownAs.push(`ethereum:${wallets.ethereum}`);
  }
  if (wallets.solana) {
    document.alsoKnownAs.push(`solana:${wallets.solana}`);
  }
  
  // Clean up empty arrays
  if (document.alsoKnownAs.length === 0) delete document.alsoKnownAs;
  if (document.verificationMethod.length === 0) delete document.verificationMethod;
  if (document.authentication.length === 0) delete document.authentication;
  if (document.assertionMethod.length === 0) delete document.assertionMethod;
  
  return document;
}

/**
 * Generate an ERC-8004 Agent Registration File
 * Compatible with Ethereum's Trustless Agents standard
 * @param {object} profile - The AgentFolio profile
 * @param {object} reputation - Reputation data (reviews, ratings)
 * @param {string} baseUrl - Base URL
 * @returns {object} - ERC-8004 compatible registration file
 */
function generateERC8004Document(profile, reputation = {}, baseUrl = 'https://agentfolio.bot') {
  const did = createDID(profile.id);
  const wallets = profile.wallets || {};
  const verification = profile.verification || {};
  
  return {
    // ERC-8004 Version
    version: '1.0',
    standard: 'ERC-8004',
    
    // Identity section
    identity: {
      did: did,
      name: profile.name,
      handle: profile.handle,
      description: profile.bio || '',
      avatar: profile.avatar || null,
      created: profile.created_at || profile.createdAt,
      updated: profile.updated_at || profile.updatedAt
    },
    
    // Capabilities (skills)
    capabilities: (profile.skills || []).map(skill => {
      const skillName = typeof skill === 'object' ? (skill.name || skill.skill || String(skill)) : skill;
      return {
        name: skillName,
        verified: false, // Could be verified via skill badges
        category: categorizeSkill(skillName)
      };
    }),
    
    // Endpoints for communication
    endpoints: {
      // Primary HTTP API
      [PROTOCOL_TYPES.HTTP]: {
        url: `${baseUrl}/api/profile/${profile.id}`,
        methods: ['GET', 'POST'],
        description: 'AgentFolio REST API'
      },
      
      // AgentMail messaging
      ...(verification.agentmail?.verified ? {
        [PROTOCOL_TYPES.AGENTMAIL]: {
          address: `${profile.id}@agentmail.to`,
          url: `${baseUrl}/contact/${profile.id}`,
          description: 'Agent messaging endpoint'
        }
      } : {}),
      
      // Wallet addresses for payments
      ...(wallets.ethereum || verification.hyperliquid?.wallet ? {
        [PROTOCOL_TYPES.WALLET]: {
          ethereum: wallets.ethereum || verification.hyperliquid?.wallet,
          ...(wallets.solana || verification.solana?.wallet ? { solana: wallets.solana || verification.solana?.wallet } : {}),
          ...(wallets.base ? { base: wallets.base } : {})
        }
      } : {})
    },
    
    // Reputation data (ERC-8004 Registry compatible)
    reputation: {
      score: reputation.averageRating ? Math.round(reputation.averageRating * 20) : 0, // Convert 0-5 to 0-100
      reviewCount: reputation.totalReviews || 0,
      completedJobs: reputation.completedJobs || 0,
      successRate: reputation.successRate || 0,
      tier: reputation.tier || 'unranked',
      
      // Reputation sources
      sources: [
        {
          platform: 'agentfolio',
          url: `${baseUrl}/api/profile/${profile.id}/reputation`,
          score: reputation.averageRating ? Math.round(reputation.averageRating * 20) : 0
        }
      ]
    },
    
    // Verifications (linked to ERC-8004 Validation Registry)
    verifications: {
      // Wallet verifications
      ...(verification.hyperliquid?.verified ? {
        hyperliquid: {
          type: 'trading',
          wallet: verification.hyperliquid.wallet,
          verified: true,
          stats: verification.hyperliquid.stats || {}
        }
      } : {}),
      
      ...(verification.polymarket?.verified ? {
        polymarket: {
          type: 'trading',
          wallet: verification.polymarket.wallet,
          verified: true
        }
      } : {}),
      
      ...(verification.solana?.verified ? {
        solana: {
          type: 'wallet',
          address: verification.solana.wallet,
          verified: true
        }
      } : {}),
      
      // Platform verifications
      ...(verification.github?.verified ? {
        github: {
          type: 'code',
          username: verification.github.username,
          verified: true,
          stats: verification.github.stats || {}
        }
      } : {}),
      
      ...(verification.twitter?.verified ? {
        x: {
          type: 'social',
          handle: verification.twitter.handle,
          verified: true
        }
      } : {}),
      
      ...(verification.agentmail?.verified ? {
        agentmail: {
          type: 'messaging',
          address: verification.agentmail.address,
          verified: true
        }
      } : {})
    },
    
    // Links to external identities
    linkedIdentities: {
      ...(profile.links?.moltbook ? { moltbook: profile.links.moltbook } : {}),
      ...(profile.links?.github ? { github: profile.links.github } : {}),
      ...(profile.links?.twitter ? { x: profile.links.twitter } : {}),
      ...(profile.links?.website ? { website: profile.links.website } : {})
    },
    
    // Resolution info
    resolution: {
      method: `did:${DID_METHOD}`,
      resolver: `${baseUrl}/.well-known/did-configuration.json`,
      profileUrl: `${baseUrl}/profile/${profile.id}`,
      didDocumentUrl: `${baseUrl}/api/profile/${profile.id}/did`
    }
  };
}

/**
 * Categorize a skill for ERC-8004 capabilities
 */
function categorizeSkill(skill) {
  // Handle skill objects (from skills taxonomy) or strings
  const skillName = typeof skill === 'object' ? (skill.name || skill.skill || String(skill)) : skill;
  const lowerSkill = (skillName || '').toLowerCase();
  
  if (['trading', 'defi', 'yield', 'arbitrage', 'market analysis'].some(k => lowerSkill.includes(k))) {
    return 'trading';
  }
  if (['solidity', 'python', 'javascript', 'rust', 'development', 'smart contract'].some(k => lowerSkill.includes(k))) {
    return 'development';
  }
  if (['research', 'analysis', 'report', 'due diligence'].some(k => lowerSkill.includes(k))) {
    return 'research';
  }
  if (['writing', 'content', 'copywriting', 'social media'].some(k => lowerSkill.includes(k))) {
    return 'content';
  }
  if (['automation', 'bot', 'agent', 'workflow'].some(k => lowerSkill.includes(k))) {
    return 'automation';
  }
  if (['security', 'audit', 'penetration'].some(k => lowerSkill.includes(k))) {
    return 'security';
  }
  
  return 'general';
}

/**
 * Generate DID Configuration (/.well-known/did-configuration.json)
 * For domain linkage verification
 */
function generateDIDConfiguration(baseUrl = 'https://agentfolio.bot') {
  return {
    '@context': 'https://identity.foundation/.well-known/did-configuration/v1',
    linked_dids: [
      {
        '@context': [
          'https://www.w3.org/2018/credentials/v1',
          'https://identity.foundation/.well-known/did-configuration/v1'
        ],
        issuer: `did:web:${new URL(baseUrl).hostname}`,
        issuanceDate: '2026-01-01T00:00:00Z',
        type: ['VerifiableCredential', 'DomainLinkageCredential'],
        credentialSubject: {
          id: `did:web:${new URL(baseUrl).hostname}`,
          origin: baseUrl
        }
      }
    ]
  };
}

/**
 * Import a DID from an external source and link to profile
 * @param {string} externalDid - The external DID to link
 * @param {string} profileId - The AgentFolio profile ID
 * @returns {object} - Link record
 */
function importExternalDID(externalDid, profileId) {
  const parsed = parseDID(externalDid);
  if (!parsed) {
    return { error: 'Invalid DID format' };
  }
  
  return {
    agentfolioDid: createDID(profileId),
    externalDid: externalDid,
    method: parsed.method,
    externalId: parsed.id,
    linkedAt: new Date().toISOString(),
    status: 'pending_verification'
  };
}

/**
 * Resolve an AgentFolio DID to its document
 * @param {string} did - The DID to resolve
 * @param {function} profileLoader - Function to load profile by ID
 * @param {string} baseUrl - Base URL
 * @returns {object} - Resolution result
 */
async function resolveDID(did, profileLoader, baseUrl = 'https://agentfolio.bot') {
  const parsed = parseDID(did);
  
  if (!parsed) {
    return {
      didResolutionMetadata: { error: 'invalidDid' },
      didDocument: null,
      didDocumentMetadata: {}
    };
  }
  
  if (parsed.method !== DID_METHOD) {
    return {
      didResolutionMetadata: { error: 'methodNotSupported' },
      didDocument: null,
      didDocumentMetadata: {}
    };
  }
  
  try {
    const profile = await profileLoader(parsed.id);
    if (!profile) {
      return {
        didResolutionMetadata: { error: 'notFound' },
        didDocument: null,
        didDocumentMetadata: {}
      };
    }
    
    const document = generateDIDDocument(profile, baseUrl);
    
    return {
      didResolutionMetadata: { contentType: 'application/did+json' },
      didDocument: document,
      didDocumentMetadata: {
        created: profile.created_at || profile.createdAt,
        updated: profile.updated_at || profile.updatedAt,
        versionId: crypto.createHash('sha256').update(JSON.stringify(document)).digest('hex').substring(0, 16)
      }
    };
  } catch (error) {
    return {
      didResolutionMetadata: { error: 'internalError', message: error.message },
      didDocument: null,
      didDocumentMetadata: {}
    };
  }
}

/**
 * Get DID method specification
 */
function getDIDMethodSpec() {
  return {
    method: DID_METHOD,
    version: '1.0.0',
    specification: 'https://agentfolio.bot/docs/did-method',
    description: 'AgentFolio DID Method for AI Agent Identity',
    supports: {
      create: true,
      read: true,
      update: true,
      deactivate: true
    },
    operations: {
      create: {
        description: 'Create new agent profile via AgentFolio API',
        endpoint: 'POST /api/profiles'
      },
      read: {
        description: 'Resolve DID to DID Document',
        endpoint: 'GET /api/profile/{id}/did'
      },
      update: {
        description: 'Update agent profile',
        endpoint: 'PUT /api/profile/{id}'
      },
      deactivate: {
        description: 'Delete agent profile',
        endpoint: 'DELETE /api/profile/{id}'
      }
    },
    interoperability: {
      erc8004: {
        supported: true,
        endpoint: 'GET /api/profile/{id}/erc8004'
      },
      x402: {
        supported: true,
        description: 'Payment endpoints via wallet addresses'
      }
    }
  };
}

module.exports = {
  DID_METHOD,
  DID_CONTEXT,
  PROTOCOL_TYPES,
  VERIFICATION_TYPES,
  createDID,
  parseDID,
  isAgentFolioDID,
  generateDIDDocument,
  generateERC8004Document,
  generateDIDConfiguration,
  importExternalDID,
  resolveDID,
  getDIDMethodSpec,
  categorizeSkill
};
