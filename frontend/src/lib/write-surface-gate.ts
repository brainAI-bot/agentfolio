"use client";

export const ENABLE_WRITES_ENV = "NEXT_PUBLIC_AGENTFOLIO_ENABLE_SOLANA_IRYS_WRITES";
export const SERVER_ENABLE_WRITES_ENV = "AGENTFOLIO_ENABLE_SOLANA_IRYS_WRITES";
export const ENABLE_LIVE_ESCROW_ENV = "NEXT_PUBLIC_AGENTFOLIO_ENABLE_LIVE_ESCROW_WRITES";
export const SERVER_ENABLE_LIVE_ESCROW_ENV = "AGENTFOLIO_ENABLE_LIVE_ESCROW_WRITES";
export const ESCROW_KILL_SWITCH_ENV = "NEXT_PUBLIC_AGENTFOLIO_ESCROW_KILL_SWITCH";
export const SERVER_ESCROW_KILL_SWITCH_ENV = "AGENTFOLIO_ESCROW_KILL_SWITCH";
export const READ_ONLY_CODE = "SOLANA_IRYS_WRITES_READ_ONLY";
export const LIVE_ESCROW_READ_ONLY_CODE = "LIVE_ESCROW_WRITES_READ_ONLY";

declare const process: { env: Record<string, string | undefined> };

export class FrontendWriteSurfaceReadOnlyError extends Error {
  code = READ_ONLY_CODE;
  statusCode = 423;
  operation: string;

  constructor(operation = "Solana/Irys write") {
    super("Solana/Irys writes are disabled in this environment.");
    this.name = "FrontendWriteSurfaceReadOnlyError";
    this.operation = operation;
  }
}

export class FrontendLiveEscrowReadOnlyError extends Error {
  code = LIVE_ESCROW_READ_ONLY_CODE;
  statusCode = 423;
  operation: string;

  constructor(operation = "live escrow write") {
    super("Live escrow writes are disabled until security re-review clears the live-funds path.");
    this.name = "FrontendLiveEscrowReadOnlyError";
    this.operation = operation;
  }
}

export function envValueAllowsWrites(value: unknown): boolean {
  return /^(1|true|yes|on)$/i.test(String(value || "").trim());
}

export function isFrontendSolanaIrysWriteEnabled(
  env: Record<string, string | undefined> = typeof process === "undefined" ? {} : process.env,
): boolean {
  return envValueAllowsWrites(env[ENABLE_WRITES_ENV] || env[SERVER_ENABLE_WRITES_ENV]);
}

export function assertFrontendSolanaIrysWriteEnabled(operation?: string): void {
  if (!isFrontendSolanaIrysWriteEnabled()) {
    throw new FrontendWriteSurfaceReadOnlyError(operation);
  }
}

export function isFrontendEscrowKillSwitchActive(
  env: Record<string, string | undefined> = typeof process === "undefined" ? {} : process.env,
): boolean {
  return envValueAllowsWrites(env[ESCROW_KILL_SWITCH_ENV] || env[SERVER_ESCROW_KILL_SWITCH_ENV]);
}

export function isFrontendLiveEscrowEnabled(
  env: Record<string, string | undefined> = typeof process === "undefined" ? {} : process.env,
): boolean {
  return (
    envValueAllowsWrites(env[ENABLE_LIVE_ESCROW_ENV] || env[SERVER_ENABLE_LIVE_ESCROW_ENV]) &&
    !isFrontendEscrowKillSwitchActive(env)
  );
}

export function assertFrontendLiveEscrowEnabled(operation?: string): void {
  if (!isFrontendLiveEscrowEnabled()) {
    throw new FrontendLiveEscrowReadOnlyError(operation);
  }
}
