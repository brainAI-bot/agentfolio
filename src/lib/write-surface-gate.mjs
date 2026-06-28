import gate from './write-surface-gate.js';

export const {
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
  liveEscrowGateStatus,
  liveEscrowWriteGatePayload,
  sendLiveEscrowGateResponse,
  sendSolanaIrysWriteGateResponse,
  solanaIrysWriteGatePayload,
} = gate;

export default gate;
