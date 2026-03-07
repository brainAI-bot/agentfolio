#!/usr/bin/env node

/**
 * AgentFolio P1 Integration Testing
 * Tests all hardened verification endpoints end-to-end
 */

const axios = require('axios').default;

const BASE_URL = 'https://agentfolio.bot/api';
const TEST_PROFILE_ID = 'test-integration-' + Date.now();

// Test results tracking
const testResults = {
  github: { initiate: false, confirm: false },
  x: { initiate: false, confirm: false },
  agentmail: { initiate: false, confirm: false },
  solana: { initiate: false, confirm: false },
  scoring: false
};

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testGitHubVerification() {
  console.log('\n🔧 Testing GitHub Verification...');
  
  try {
    // Test initiate
    console.log('  → Testing initiate endpoint...');
    const initiateResponse = await axios.post(`${BASE_URL}/verify/github/initiate`, {
      profileId: TEST_PROFILE_ID,
      username: 'octocat'
    });
    
    if (initiateResponse.status === 200) {
      testResults.github.initiate = true;
      console.log('  ✅ GitHub initiate: SUCCESS');
      console.log('    Challenge ID:', initiateResponse.data.challengeId);
      
      // Test confirm (will fail but should handle gracefully)
      console.log('  → Testing confirm endpoint...');
      try {
        const confirmResponse = await axios.post(`${BASE_URL}/verify/github/confirm`, {
          challengeId: initiateResponse.data.challengeId,
          gistUrl: 'https://gist.github.com/test/fake-gist'
        });
        console.log('  ⚠️  GitHub confirm: Unexpected success with fake gist');
      } catch (confirmError) {
        if (confirmError.response && confirmError.response.status === 400) {
          testResults.github.confirm = true;
          console.log('  ✅ GitHub confirm: Correctly rejected fake gist');
        } else {
          console.log('  ❌ GitHub confirm: Unexpected error');
          console.log('    Error:', confirmError.message);
        }
      }
    } else {
      console.log('  ❌ GitHub initiate: FAILED');
    }
  } catch (error) {
    console.log('  ❌ GitHub verification: FAILED');
    console.log('    Error:', error.message);
    if (error.response) {
      console.log('    Response:', error.response.data);
    }
  }
}

async function testXVerification() {
  console.log('\n🐦 Testing X/Twitter Verification...');
  
  try {
    // Test initiate
    console.log('  → Testing initiate endpoint...');
    const initiateResponse = await axios.post(`${BASE_URL}/verify/x/initiate`, {
      profileId: TEST_PROFILE_ID,
      username: 'twitter'
    });
    
    if (initiateResponse.status === 200) {
      testResults.x.initiate = true;
      console.log('  ✅ X initiate: SUCCESS');
      console.log('    Challenge ID:', initiateResponse.data.challengeId);
      
      // Test confirm (will fail but should handle gracefully)
      console.log('  → Testing confirm endpoint...');
      try {
        const confirmResponse = await axios.post(`${BASE_URL}/verify/x/confirm`, {
          challengeId: initiateResponse.data.challengeId,
          tweetUrl: 'https://twitter.com/test/status/1234567890'
        });
        console.log('  ⚠️  X confirm: Unexpected success with fake tweet');
      } catch (confirmError) {
        if (confirmError.response && confirmError.response.status === 400) {
          testResults.x.confirm = true;
          console.log('  ✅ X confirm: Correctly rejected fake tweet');
        } else {
          console.log('  ❌ X confirm: Unexpected error');
          console.log('    Error:', confirmError.message);
        }
      }
    } else {
      console.log('  ❌ X initiate: FAILED');
    }
  } catch (error) {
    console.log('  ❌ X verification: FAILED');
    console.log('    Error:', error.message);
    if (error.response) {
      console.log('    Response:', error.response.data);
    }
  }
}

async function testAgentMailVerification() {
  console.log('\n📧 Testing AgentMail Verification...');
  
  try {
    // Test initiate
    console.log('  → Testing initiate endpoint...');
    const initiateResponse = await axios.post(`${BASE_URL}/verify/agentmail/initiate`, {
      profileId: TEST_PROFILE_ID,
      email: 'test@agentmail.to'
    });
    
    if (initiateResponse.status === 200) {
      testResults.agentmail.initiate = true;
      console.log('  ✅ AgentMail initiate: SUCCESS');
      console.log('    Challenge ID:', initiateResponse.data.challengeId);
      
      // Test confirm (will fail but should handle gracefully)
      console.log('  → Testing confirm endpoint...');
      try {
        const confirmResponse = await axios.post(`${BASE_URL}/verify/agentmail/confirm`, {
          challengeId: initiateResponse.data.challengeId,
          code: 'FAKE-CODE-123'
        });
        console.log('  ⚠️  AgentMail confirm: Unexpected success with fake code');
      } catch (confirmError) {
        if (confirmError.response && confirmError.response.status === 400) {
          testResults.agentmail.confirm = true;
          console.log('  ✅ AgentMail confirm: Correctly rejected fake code');
        } else {
          console.log('  ❌ AgentMail confirm: Unexpected error');
          console.log('    Error:', confirmError.message);
        }
      }
    } else {
      console.log('  ❌ AgentMail initiate: FAILED');
    }
  } catch (error) {
    console.log('  ❌ AgentMail verification: FAILED');
    console.log('    Error:', error.message);
    if (error.response) {
      console.log('    Response:', error.response.data);
    }
  }
}

async function testSolanaVerification() {
  console.log('\n🟣 Testing Solana Verification...');
  
  try {
    // Test initiate
    console.log('  → Testing initiate endpoint...');
    const initiateResponse = await axios.post(`${BASE_URL}/verify/solana/initiate`, {
      profileId: TEST_PROFILE_ID,
      walletAddress: '11111111111111111111111111111112'  // System program address
    });
    
    if (initiateResponse.status === 200) {
      testResults.solana.initiate = true;
      console.log('  ✅ Solana initiate: SUCCESS');
      console.log('    Challenge ID:', initiateResponse.data.challengeId);
      
      // Test confirm (will fail but should handle gracefully)
      console.log('  → Testing confirm endpoint...');
      try {
        const confirmResponse = await axios.post(`${BASE_URL}/verify/solana/confirm`, {
          challengeId: initiateResponse.data.challengeId,
          signature: 'fake-signature-123'
        });
        console.log('  ⚠️  Solana confirm: Unexpected success with fake signature');
      } catch (confirmError) {
        if (confirmError.response && confirmError.response.status === 400) {
          testResults.solana.confirm = true;
          console.log('  ✅ Solana confirm: Correctly rejected fake signature');
        } else {
          console.log('  ❌ Solana confirm: Unexpected error');
          console.log('    Error:', confirmError.message);
        }
      }
    } else {
      console.log('  ❌ Solana initiate: FAILED');
    }
  } catch (error) {
    console.log('  ❌ Solana verification: FAILED');
    console.log('    Error:', error.message);
    if (error.response) {
      console.log('    Response:', error.response.data);
    }
  }
}

async function testScoringEngine() {
  console.log('\n📊 Testing Scoring Engine...');
  
  try {
    // First create a test profile to check scoring
    const profileResponse = await axios.get(`${BASE_URL}/profiles`);
    if (profileResponse.status === 200 && profileResponse.data.length > 0) {
      const sampleProfile = profileResponse.data[0];
      console.log('  → Testing with profile:', sampleProfile.profile_id || sampleProfile.id);
      
      // Check if profile has verification score
      const profileDetailResponse = await axios.get(`${BASE_URL}/profile/${sampleProfile.profile_id || sampleProfile.id}`);
      if (profileDetailResponse.status === 200) {
        const profile = profileDetailResponse.data;
        console.log('  → Profile data structure:', Object.keys(profile));
        
        if (profile.verificationScore !== undefined || profile.verification_score !== undefined) {
          testResults.scoring = true;
          console.log('  ✅ Scoring engine: Profile has verification score');
          console.log('    Score:', profile.verificationScore || profile.verification_score);
        } else {
          console.log('  ⚠️  Scoring engine: No verification score found in profile');
          console.log('    Available fields:', Object.keys(profile));
        }
      } else {
        console.log('  ❌ Scoring engine: Failed to fetch profile details');
      }
    } else {
      console.log('  ❌ Scoring engine: No profiles available for testing');
    }
  } catch (error) {
    console.log('  ❌ Scoring engine: FAILED');
    console.log('    Error:', error.message);
    if (error.response) {
      console.log('    Response data:', error.response.data);
    }
  }
}

async function generateReport() {
  console.log('\n📋 Integration Test Results:');
  console.log('=' * 50);
  
  const tests = [
    { name: 'GitHub Initiate', status: testResults.github.initiate },
    { name: 'GitHub Confirm', status: testResults.github.confirm },
    { name: 'X Initiate', status: testResults.x.initiate },
    { name: 'X Confirm', status: testResults.x.confirm },
    { name: 'AgentMail Initiate', status: testResults.agentmail.initiate },
    { name: 'AgentMail Confirm', status: testResults.agentmail.confirm },
    { name: 'Solana Initiate', status: testResults.solana.initiate },
    { name: 'Solana Confirm', status: testResults.solana.confirm },
    { name: 'Scoring Engine', status: testResults.scoring }
  ];
  
  let passCount = 0;
  tests.forEach(test => {
    const icon = test.status ? '✅' : '❌';
    console.log(`${icon} ${test.name}`);
    if (test.status) passCount++;
  });
  
  console.log('\n📊 Summary:');
  console.log(`Passed: ${passCount}/${tests.length}`);
  console.log(`Success Rate: ${Math.round(passCount/tests.length * 100)}%`);
  
  const critical = passCount === tests.length;
  console.log(critical ? '\n✅ ALL TESTS PASSED - Ready for P2 Provider Expansion' : 
                        '\n❌ SOME TESTS FAILED - Fix issues before P2');
  
  return { passCount, total: tests.length, critical };
}

async function main() {
  console.log('🧪 AgentFolio P1 Integration Testing');
  console.log('Testing against:', BASE_URL);
  console.log('Test Profile ID:', TEST_PROFILE_ID);
  console.log('Timestamp:', new Date().toISOString());
  
  await testGitHubVerification();
  await delay(1000);
  
  await testXVerification();
  await delay(1000);
  
  await testAgentMailVerification();
  await delay(1000);
  
  await testSolanaVerification();
  await delay(1000);
  
  await testScoringEngine();
  
  const results = await generateReport();
  process.exit(results.critical ? 0 : 1);
}

// Install axios if not available
try {
  require('axios');
} catch (e) {
  console.log('Installing axios...');
  require('child_process').execSync('npm install axios', { stdio: 'inherit' });
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { main, testResults };