import gate from './write-surface-gate.js';

export const {
  ENABLE_WRITES_ENV,
  READ_ONLY_CODE,
  WriteSurfaceReadOnlyError,
  assertSolanaIrysWriteEnabled,
  envValueAllowsWrites,
  isSolanaIrysWriteEnabled,
  sendSolanaIrysWriteGateResponse,
  solanaIrysWriteGatePayload,
} = gate;

export default gate;
