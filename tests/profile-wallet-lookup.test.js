const { describe, it } = require('node:test');
const assert = require('node:assert');
const { findProfileIdByWallet } = require('../src/lib/profile-wallet-lookup');

describe('findProfileIdByWallet', () => {
  it('matches legacy direct wallet column', () => {
    const profiles = [
      { id: 'agent_legacy', wallet: 'Wallet111', wallets: '{}', verification_data: '{}' },
    ];
    assert.strictEqual(findProfileIdByWallet(profiles, 'Wallet111'), 'agent_legacy');
  });

  it('matches wallets.solana JSON field', () => {
    const profiles = [
      { id: 'agent_json', wallet: '', wallets: '{"solana":"Wallet222"}', verification_data: '{}' },
    ];
    assert.strictEqual(findProfileIdByWallet(profiles, 'Wallet222'), 'agent_json');
  });

  it('matches verification_data.solana.address JSON field', () => {
    const profiles = [
      { id: 'agent_vd', wallet: '', wallets: '{}', verification_data: '{"solana":{"address":"Wallet333"}}' },
    ];
    assert.strictEqual(findProfileIdByWallet(profiles, 'Wallet333'), 'agent_vd');
  });

  it('survives malformed JSON and still finds direct wallet matches', () => {
    const profiles = [
      { id: 'agent_badjson', wallet: 'Wallet444', wallets: '{broken', verification_data: '{broken' },
    ];
    assert.strictEqual(findProfileIdByWallet(profiles, 'Wallet444'), 'agent_badjson');
  });

  it('returns null when no profile matches', () => {
    const profiles = [
      { id: 'agent_none', wallet: 'Wallet555', wallets: '{}', verification_data: '{}' },
    ];
    assert.strictEqual(findProfileIdByWallet(profiles, 'Wallet999'), null);
  });
});
