const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');

test('marketplace surface regression guard', async (t) => {
  await t.test('api/jobs is backed by the jobs table instead of a placeholder payload', () => {
    assert.match(serverSource, /app\.get\('\/api\/jobs', \(req, res\) => \{/);
    assert.match(serverSource, /SELECT COUNT\(\*\) as c FROM jobs/);
    assert.match(serverSource, /SELECT \* FROM jobs ORDER BY datetime\(created_at\) DESC LIMIT \? OFFSET \?/);
    assert.match(serverSource, /poster: profileMap\.get\(row\.client_id\) \|\| row\.client_id/);
    assert.match(serverSource, /skills_required: skills/);
    assert.doesNotMatch(serverSource, /jobs:\s*\[\],\s*total:\s*0,\s*page:\s*1,\s*message:\s*'Jobs marketplace endpoint active'/);
  });

  await t.test('api/stats includes live job totals instead of hardcoded zeroes', () => {
    assert.match(serverSource, /totalJobs = d\.prepare\('SELECT COUNT\(\*\) as c FROM jobs'\)\.get\(\)\.c/);
    assert.match(serverSource, /totalVolume = d\.prepare\("SELECT COALESCE\(SUM\(COALESCE\(agreed_budget, budget_amount\)\), 0\) as total FROM jobs"\)\.get\(\)\.total \|\| 0/);
    assert.match(serverSource, /marketplace:\s*\{[\s\S]*totalJobs,[\s\S]*openJobs,[\s\S]*inProgress:[\s\S]*completed:/);
    assert.doesNotMatch(serverSource, /totalJobs:\s*0,\s*totalVolume:\s*0/);
  });
});
