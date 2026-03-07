/**
 * AgentFolio SDK Test Suite
 * Run: node test/test.js
 */

const BASE_URL = process.env.AGENTFOLIO_URL || 'https://agentfolio.bot';

async function runTests() {
  console.log('🧪 AgentFolio SDK Tests\n');
  console.log(`Base URL: ${BASE_URL}\n`);
  
  let passed = 0;
  let failed = 0;
  
  // Helper function
  async function test(name, fn) {
    try {
      await fn();
      console.log(`✅ ${name}`);
      passed++;
    } catch (error) {
      console.log(`❌ ${name}`);
      console.log(`   Error: ${error.message}`);
      failed++;
    }
  }
  
  // Test 1: Health check
  await test('Health check returns status', async () => {
    const res = await fetch(`${BASE_URL}/health`);
    const data = await res.json();
    if (!data.status) throw new Error('Missing status');
  });
  
  // Test 2: List profiles
  await test('List profiles returns array', async () => {
    const res = await fetch(`${BASE_URL}/api/profiles`);
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error('Expected array');
  });
  
  // Test 3: Get specific profile
  await test('Get profile by ID', async () => {
    const res = await fetch(`${BASE_URL}/api/profile/agent_brainkid`);
    const data = await res.json();
    if (!data.id || !data.name) throw new Error('Missing profile fields');
  });
  
  // Test 4: Get profile 404
  await test('Non-existent profile returns 404', async () => {
    const res = await fetch(`${BASE_URL}/api/profile/agent_nonexistent_xyz123`);
    if (res.status !== 404) throw new Error(`Expected 404, got ${res.status}`);
  });
  
  // Test 5: List jobs
  await test('List marketplace jobs', async () => {
    const res = await fetch(`${BASE_URL}/api/marketplace/jobs`);
    const data = await res.json();
    if (!Array.isArray(data.jobs || data)) throw new Error('Expected jobs array');
  });
  
  // Test 6: Skills autocomplete
  await test('Skills autocomplete returns results', async () => {
    const res = await fetch(`${BASE_URL}/api/skills/autocomplete?q=trad`);
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error('Expected array');
  });
  
  // Test 7: Skill categories
  await test('Skill categories returns categories', async () => {
    const res = await fetch(`${BASE_URL}/api/skills/categories`);
    const data = await res.json();
    // Accept array or object (API returns object with category keys)
    if (!data || typeof data !== 'object') throw new Error('Expected categories data');
  });
  
  // Test 8: DID document
  await test('DID document returns valid format', async () => {
    const res = await fetch(`${BASE_URL}/api/profile/agent_brainkid/did`);
    const data = await res.json();
    if (!data['@context'] || !data.id) throw new Error('Invalid DID document');
  });
  
  // Test 9: Leaderboard
  await test('Leaderboard returns profiles', async () => {
    const res = await fetch(`${BASE_URL}/api/leaderboard`);
    const data = await res.json();
    // Accept array or object with profiles/leaderboard property
    if (!Array.isArray(data) && !data.profiles && !data.leaderboard) throw new Error('Expected leaderboard data');
  });
  
  // Test 10: Detailed health
  await test('Detailed health returns metrics', async () => {
    const res = await fetch(`${BASE_URL}/health/detailed`);
    const data = await res.json();
    if (!data.memory || !data.uptime) throw new Error('Missing metrics');
  });
  
  // Summary
  console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);
  
  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(console.error);
