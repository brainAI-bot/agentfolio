const test = require('node:test');
const assert = require('node:assert/strict');

const escrowV3Router = require('../src/routes/escrow-v3-routes');

const {
  deriveSelectedAgentSatpReadback,
  resolveEscrowAgentBinding,
  resolveEscrowAgentId,
  resolveProfileSolanaWallet,
} = escrowV3Router.__test;

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

test('V3 escrow create binds job-backed payout wallet to selected agent profile', () => {
  const result = resolveEscrowAgentBinding(
    { jobId: 'job-1', agentId: 'agent_selected', agentWallet: 'AgentWallet111111111111111111111111111111111' },
    {
      loadJobById: () => ({ id: 'job-1', selectedAgentId: 'agent_selected' }),
      loadProfileById: () => ({ wallets: { solana: 'AgentWallet111111111111111111111111111111111' } }),
      network: 'mainnet',
    },
  );

  assert.equal(result.agentId, 'agent_selected');
  assert.equal(result.agentWallet, 'AgentWallet111111111111111111111111111111111');
  assert.equal(result.selectedAgentWallet, 'AgentWallet111111111111111111111111111111111');
  assert.equal(result.satpIdentity.agentId, 'agent_selected');
  assert.equal(result.satpIdentity.network, 'mainnet');
  assert.match(result.satpIdentity.genesisPDA, /^[1-9A-HJ-NP-Za-km-z]+$/);
  assert.match(result.satpIdentity.identityProgramId, /^[1-9A-HJ-NP-Za-km-z]+$/);
});

test('V3 escrow create rejects job-backed payout wallet drift', () => {
  assert.throws(
    () => resolveEscrowAgentBinding(
      { jobId: 'job-1', agentId: 'agent_selected', agentWallet: 'RequestWallet1111111111111111111111111111111' },
      {
        loadJobById: () => ({ id: 'job-1', selectedAgentId: 'agent_selected' }),
        loadProfileById: () => ({ wallets: { solana: 'SelectedWallet111111111111111111111111111111' } }),
      },
    ),
    (err) => {
      assert.equal(err.statusCode, 409);
      assert.equal(err.details.selectedAgentId, 'agent_selected');
      assert.equal(err.details.selectedAgentWallet, 'SelectedWallet111111111111111111111111111111');
      return true;
    },
  );
});

test('V3 escrow create rejects selected agents without a Solana payout wallet', () => {
  assert.throws(
    () => resolveEscrowAgentBinding(
      { jobId: 'job-1', agentId: 'agent_selected', agentWallet: null },
      {
        loadJobById: () => ({ id: 'job-1', selectedAgentId: 'agent_selected' }),
        loadProfileById: () => ({ wallets: {} }),
      },
    ),
    /Selected agent has no Solana wallet/,
  );
});

test('V3 escrow helper resolves Solana wallet across profile storage shapes', () => {
  assert.equal(resolveProfileSolanaWallet({ wallets: { solana: 'wallets-value' } }), 'wallets-value');
  assert.equal(resolveProfileSolanaWallet({ wallet: 'direct-value' }), 'direct-value');
  assert.equal(
    resolveProfileSolanaWallet({ verificationData: { solana: { address: 'verification-data-value' } } }),
    'verification-data-value',
  );
  assert.equal(
    resolveProfileSolanaWallet({ verifications: [{ platform: 'solana', identifier: 'verified-row-value' }] }),
    'verified-row-value',
  );
});

test('V3 escrow selected SATP readback derives non-sensitive Genesis evidence', () => {
  const readback = deriveSelectedAgentSatpReadback('agent_selected', 'mainnet');

  assert.equal(readback.agentId, 'agent_selected');
  assert.equal(readback.network, 'mainnet');
  assert.match(readback.genesisPDA, /^[1-9A-HJ-NP-Za-km-z]+$/);
  assert.match(readback.identityProgramId, /^[1-9A-HJ-NP-Za-km-z]+$/);
});
