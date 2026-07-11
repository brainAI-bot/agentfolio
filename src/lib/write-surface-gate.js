'use strict';

const ENABLE_WRITES_ENV = 'AGENTFOLIO_ENABLE_SOLANA_IRYS_WRITES';
const ENABLE_LIVE_ESCROW_ENV = 'AGENTFOLIO_ENABLE_LIVE_ESCROW_WRITES';
const ESCROW_KILL_SWITCH_ENV = 'AGENTFOLIO_ESCROW_KILL_SWITCH';
const READ_ONLY_CODE = 'SOLANA_IRYS_WRITES_READ_ONLY';
const BOA_READ_ONLY_CODE = 'BOA_WRITES_READ_ONLY';
const LIVE_ESCROW_READ_ONLY_CODE = 'LIVE_ESCROW_WRITES_READ_ONLY';
const ESCROW_KILL_SWITCH_CODE = 'ESCROW_KILL_SWITCH_ACTIVE';
const CUSTODIAL_ESCROW_DISABLED_CODE = 'CUSTODIAL_ESCROW_DISABLED';
const LEGACY_ESCROW_ROUTE_DISABLED_CODE = 'LEGACY_ESCROW_ROUTE_DISABLED';

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
  const enabled = isLiveEscrowEnabled(env);
  const killSwitchActive = isEscrowKillSwitchActive(env);
  return {
    enabled,
    killSwitchActive,
    status: enabled
      ? 'live_funds_enabled_by_environment'
      : killSwitchActive
        ? 'live_funds_blocked_by_kill_switch'
        : 'live_funds_gated_pending_security_review',
    liveFundsCleared: enabled,
    verifiedRuntime: {
      network: 'devnet',
      pdaDerive: 'verified',
    },
    runtimeNetwork: 'devnet',
    mainnetLiveFundsCleared: enabled,
    publicCopy: enabled
      ? 'Live escrow writes are enabled by deployment environment.'
      : 'Devnet-safe escrow runtime smoke is verified; mainnet/live-funds escrow remains gated pending security re-review.',
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
    liveEscrow: liveEscrowGateStatus(),
    enableWith: ENABLE_LIVE_ESCROW_ENV,
    killSwitchEnv: ESCROW_KILL_SWITCH_ENV,
  };
}

function custodialEscrowDisabledPayload(operation = 'custodial escrow write') {
  return {
    ok: false,
    code: CUSTODIAL_ESCROW_DISABLED_CODE,
    error: 'Custodial escrow writes are permanently disabled. Use SATP V3 identity-gated unsigned transaction routes after release-gate clearance.',
    operation,
    liveEscrow: liveEscrowGateStatus(),
  };
}

function legacyEscrowRouteDisabledPayload(operation = 'legacy escrow write') {
  return {
    ok: false,
    code: LEGACY_ESCROW_ROUTE_DISABLED_CODE,
    error: 'Legacy escrow transaction builders are disabled because they bypass SATP V3 identity-gated escrow checks.',
    operation,
    liveEscrow: liveEscrowGateStatus(),
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

class LiveEscrowReadOnlyError extends Error {
  constructor(operation = 'live escrow write') {
    const payload = liveEscrowWriteGatePayload(operation);
    super(payload.error);
    this.name = 'LiveEscrowReadOnlyError';
    this.code = payload.code;
    this.statusCode = 423;
    this.operation = operation;
    this.liveEscrow = payload.liveEscrow;
  }
}

function assertSolanaIrysWriteEnabled(operation) {
  if (!isSolanaIrysWriteEnabled()) {
    throw new WriteSurfaceReadOnlyError(operation);
  }
}

function assertLiveEscrowWriteEnabled(operation) {
  if (!isLiveEscrowEnabled()) {
    throw new LiveEscrowReadOnlyError(operation);
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

function sendCustodialEscrowDisabledResponse(res, operation) {
  const payload = custodialEscrowDisabledPayload(operation);
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

function sendLegacyEscrowRouteDisabledResponse(res, operation) {
  const payload = legacyEscrowRouteDisabledPayload(operation);
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
  CUSTODIAL_ESCROW_DISABLED_CODE,
  ENABLE_LIVE_ESCROW_ENV,
  ENABLE_WRITES_ENV,
  ESCROW_KILL_SWITCH_CODE,
  ESCROW_KILL_SWITCH_ENV,
  LEGACY_ESCROW_ROUTE_DISABLED_CODE,
  LIVE_ESCROW_READ_ONLY_CODE,
  LiveEscrowReadOnlyError,
  READ_ONLY_CODE,
  WriteSurfaceReadOnlyError,
  assertLiveEscrowWriteEnabled,
  assertSolanaIrysWriteEnabled,
  envValueAllowsWrites,
  isEscrowKillSwitchActive,
  isLiveEscrowEnabled,
  isSolanaIrysWriteEnabled,
  boaWriteGatePayload,
  custodialEscrowDisabledPayload,
  legacyEscrowRouteDisabledPayload,
  liveEscrowGateStatus,
  liveEscrowWriteGatePayload,
  sendBoaWriteGateResponse,
  sendCustodialEscrowDisabledResponse,
  sendLegacyEscrowRouteDisabledResponse,
  sendLiveEscrowGateResponse,
  sendSolanaIrysWriteGateResponse,
  solanaIrysWriteGatePayload,
};
