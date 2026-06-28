'use strict';

const ENABLE_WRITES_ENV = 'AGENTFOLIO_ENABLE_SOLANA_IRYS_WRITES';
const ENABLE_LIVE_ESCROW_ENV = 'AGENTFOLIO_ENABLE_LIVE_ESCROW_WRITES';
const ESCROW_KILL_SWITCH_ENV = 'AGENTFOLIO_ESCROW_KILL_SWITCH';
const READ_ONLY_CODE = 'SOLANA_IRYS_WRITES_READ_ONLY';
const BOA_READ_ONLY_CODE = 'BOA_WRITES_READ_ONLY';
const LIVE_ESCROW_READ_ONLY_CODE = 'LIVE_ESCROW_WRITES_READ_ONLY';
const ESCROW_KILL_SWITCH_CODE = 'ESCROW_KILL_SWITCH_ACTIVE';

function envValueAllowsWrites(value) {
  return /^(1|true|yes|on)$/i.test(String(value || '').trim());
}

function isSolanaIrysWriteEnabled(env = process.env) {
  return envValueAllowsWrites(env[ENABLE_WRITES_ENV]);
}

function isEscrowKillSwitchActive(env = process.env) {
  return envValueAllowsWrites(env[ESCROW_KILL_SWITCH_ENV]);
}

function isLiveEscrowEnabled(env = process.env) {
  return envValueAllowsWrites(env[ENABLE_LIVE_ESCROW_ENV]) && !isEscrowKillSwitchActive(env);
}

function solanaIrysWriteGatePayload(operation = 'Solana/Irys write') {
  return {
    ok: false,
    code: READ_ONLY_CODE,
    error: 'Solana/Irys writes are disabled in this environment.',
    operation,
    enableWith: ENABLE_WRITES_ENV,
  };
}

function liveEscrowGateStatus(env = process.env) {
  return {
    enabled: isLiveEscrowEnabled(env),
    killSwitchActive: isEscrowKillSwitchActive(env),
    enableWith: ENABLE_LIVE_ESCROW_ENV,
    killSwitchEnv: ESCROW_KILL_SWITCH_ENV,
  };
}

function liveEscrowWriteGatePayload(operation = 'live escrow write') {
  const killSwitchActive = isEscrowKillSwitchActive();
  return {
    ok: false,
    code: killSwitchActive ? ESCROW_KILL_SWITCH_CODE : LIVE_ESCROW_READ_ONLY_CODE,
    error: killSwitchActive
      ? 'Live escrow writes are disabled by the escrow kill switch.'
      : 'Live escrow writes are disabled until security re-review clears the live-funds path.',
    operation,
    enableWith: ENABLE_LIVE_ESCROW_ENV,
    killSwitchEnv: ESCROW_KILL_SWITCH_ENV,
  };
}

function boaWriteGatePayload(operation = 'BOA mint/burn write') {
  return {
    ok: false,
    code: BOA_READ_ONLY_CODE,
    error: 'BOA mint and burn writes are disabled while the Solana/Irys pipeline is hardened.',
    operation,
  };
}

class WriteSurfaceReadOnlyError extends Error {
  constructor(operation = 'Solana/Irys write') {
    super(solanaIrysWriteGatePayload(operation).error);
    this.name = 'WriteSurfaceReadOnlyError';
    this.code = READ_ONLY_CODE;
    this.statusCode = 423;
    this.operation = operation;
  }
}

function assertSolanaIrysWriteEnabled(operation) {
  if (!isSolanaIrysWriteEnabled()) {
    throw new WriteSurfaceReadOnlyError(operation);
  }
}

function sendSolanaIrysWriteGateResponse(res, operation) {
  if (isSolanaIrysWriteEnabled()) return false;
  const payload = solanaIrysWriteGatePayload(operation);
  if (typeof res.status === 'function') {
    return res.status(423).json(payload);
  }
  res.writeHead(423, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(payload));
  return true;
}

function sendBoaWriteGateResponse(res, operation) {
  const payload = boaWriteGatePayload(operation);
  if (typeof res.status === 'function') {
    return res.status(423).json(payload);
  }
  res.writeHead(423, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(payload));
  return true;
}

function sendLiveEscrowGateResponse(res, operation) {
  if (isLiveEscrowEnabled()) return false;
  const payload = liveEscrowWriteGatePayload(operation);
  if (typeof res.status === 'function') {
    return res.status(423).json(payload);
  }
  res.writeHead(423, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(payload));
  return true;
}

module.exports = {
  BOA_READ_ONLY_CODE,
  ENABLE_LIVE_ESCROW_ENV,
  ENABLE_WRITES_ENV,
  ESCROW_KILL_SWITCH_CODE,
  ESCROW_KILL_SWITCH_ENV,
  LIVE_ESCROW_READ_ONLY_CODE,
  READ_ONLY_CODE,
  WriteSurfaceReadOnlyError,
  assertSolanaIrysWriteEnabled,
  envValueAllowsWrites,
  isEscrowKillSwitchActive,
  isLiveEscrowEnabled,
  isSolanaIrysWriteEnabled,
  boaWriteGatePayload,
  liveEscrowGateStatus,
  liveEscrowWriteGatePayload,
  sendBoaWriteGateResponse,
  sendLiveEscrowGateResponse,
  sendSolanaIrysWriteGateResponse,
  solanaIrysWriteGatePayload,
};
