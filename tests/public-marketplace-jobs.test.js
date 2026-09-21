const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PUBLIC_MARKETPLACE_DATABASE_BOUND,
  getPublicMarketplaceCohort,
  summarizePublicMarketplaceCohort,
} = require('../src/lib/public-marketplace-jobs');

function fakeDb(rows) {
  return {
    prepare(sql) {
      assert.match(sql, /SELECT \* FROM jobs/);
      assert.match(sql, /ORDER BY datetime\(created_at\) DESC/);
      assert.match(sql, /LIMIT \?/);
      return {
        all(bound) {
          assert.equal(bound, PUBLIC_MARKETPLACE_DATABASE_BOUND);
          return rows.slice(0, bound);
        },
      };
    },
  };
}

test('canonical public marketplace cohort keeps evidence but excludes fixture jobs', () => {
  const rows = [
    {
      id: 'job_public', client_id: 'agent_customer', title: 'Implement parser', description: 'Production work',
      status: 'open', budget_amount: 4, agreed_budget: null, created_at: '2026-09-20T00:02:00Z',
    },
    {
      id: 'job_b3f22a01478b8f1a', client_id: 'p0_audit_client_1776215395', title: 'P0 auth audit 1776215395',
      description: 'Temporary auth-gate verification job', status: 'open', budget_amount: 0.01,
      created_at: '2026-09-20T00:01:00Z',
    },
    {
      id: 'job_completed', client_id: 'agent_customer', title: 'Documentation', description: 'Public work',
      status: 'completed', budget_amount: 2, agreed_budget: 3, created_at: '2026-09-19T00:01:00Z',
    },
  ];

  const cohort = getPublicMarketplaceCohort(fakeDb(rows));
  assert.deepEqual(cohort.rows.map((row) => row.id), ['job_public', 'job_completed']);
  assert.equal(cohort.total, 2);
  assert.equal(cohort.scanned, 3);
  assert.equal(cohort.excludedFixtures, 1);
  assert.equal(cohort.databaseBound, 1000);

  assert.deepEqual(summarizePublicMarketplaceCohort(cohort), {
    totalJobs: 2,
    openJobs: 1,
    inProgressJobs: 0,
    awaitingFundingJobs: 0,
    completedJobs: 1,
    disputedJobs: 0,
    closedJobs: 0,
    totalVolume: 7,
  });
});

test('canonical public marketplace cohort is fail-closed at the shared database bound', () => {
  const rows = Array.from({ length: PUBLIC_MARKETPLACE_DATABASE_BOUND + 1 }, (_, index) => ({
    id: `job_${index}`,
    client_id: 'agent_customer',
    title: 'Public work',
    description: 'Production work',
    status: 'open',
    budget_amount: 1,
    created_at: new Date(2_000_000_000_000 - index * 1000).toISOString(),
  }));

  const cohort = getPublicMarketplaceCohort(fakeDb(rows));
  assert.equal(cohort.scanned, PUBLIC_MARKETPLACE_DATABASE_BOUND);
  assert.equal(cohort.total, PUBLIC_MARKETPLACE_DATABASE_BOUND);
  assert.equal(cohort.rows.some((row) => row.id === `job_${PUBLIC_MARKETPLACE_DATABASE_BOUND}`), false);
});
