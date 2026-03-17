const { Connection, PublicKey } = require('@solana/web3.js');
const crypto = require('crypto');

// Expected discriminator for AgentProfile account
function calculateDiscriminator(accountName) {
  const hash = crypto.createHash('sha256');
  hash.update();
  return hash.digest().slice(0, 8);
}

async function analyzeProblem() {
  console.log('=== SATP Account Discriminator Analysis ===');
  
  // What we found on-chain
  const onChainDiscriminator = Buffer.from('3ce32a18005756cd', 'hex');
  console.log('On-chain discriminator:', onChainDiscriminator.toString('hex'));
  
  // Expected discriminators for different account types
  const expectedAgentProfile = calculateDiscriminator('AgentProfile');
  console.log('Expected AgentProfile:', expectedAgentProfile.toString('hex'));
  
  const expectedAgentIdentity = calculateDiscriminator('AgentIdentity');  
  console.log('Expected AgentIdentity:', expectedAgentIdentity.toString('hex'));
  
  const expectedAgent = calculateDiscriminator('Agent');
  console.log('Expected Agent:', expectedAgent.toString('hex'));
  
  console.log('');
  console.log('=== Match Analysis ===');
  console.log('Matches AgentProfile:', onChainDiscriminator.equals(expectedAgentProfile));
  console.log('Matches AgentIdentity:', onChainDiscriminator.equals(expectedAgentIdentity));
  console.log('Matches Agent:', onChainDiscriminator.equals(expectedAgent));
  
  // The issue: program expects one account type but finds another
  console.log('');
  console.log('=== Root Cause ===');
  if (!onChainDiscriminator.equals(expectedAgentProfile)) {
    console.log('ISSUE: Account was created with different discriminator than current program expects');
    console.log('SOLUTION: Either migrate account data or update program to handle legacy accounts');
  }
}

analyzeProblem();
