const test = require('node:test');
const assert = require('node:assert/strict');

const escrowV3Router = require('../src/routes/escrow-v3-routes');

const { resolveEscrowAgentId } = escrowV3Router.__test;

test('V3 escrow create resolves Genesis lookup agentId from selected_agent_id when jobId is supplied', () => {
  const result = resolveEscrowAgentId(
    { jobId: 'job-1', agentId: 'agent_selected' },
    () => ({ id: 'job-1', selected_agent_id: 'agent_selected' }),
  );

  assert.equal(result.agentId, 'agent_selected');
  assert.equal(result.job.id, 'job-1');
});

test('V3 escrow create rejects request agentId that differs from selected job agent', () => {
  assert.throws(
    () => resolveEscrowAgentId(
      { jobId: 'job-1', agentId: 'wallet-or-display-name' },
      () => ({ id: 'job-1', selectedAgentId: 'agent_selected' }),
    ),
    (err) => {
      assert.equal(err.statusCode, 409);
      assert.equal(err.details.selectedAgentId, 'agent_selected');
      return true;
    },
  );
});

test('V3 escrow create still requires an assigned worker for job-backed escrow', () => {
  assert.throws(
    () => resolveEscrowAgentId(
      { jobId: 'job-1' },
      () => ({ id: 'job-1', selectedAgentId: null }),
    ),
    /Job has no selected agent/,
  );
});
