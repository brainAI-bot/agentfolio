import {
  Connection,
  PublicKey,
  TransactionInstruction,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";

export const IDENTITY_REGISTRY_PROGRAM_ID = new PublicKey(
  "CV5Wd9YGFX5A4dvuaFuEDuKQWp14NfnLrSdxY7EHFyeB"
);
export const ESCROW_PROGRAM_ID = new PublicKey(
  "4qx9DTX1BojPnQAtUBL2Gb9pw6kVyw5AucjaR8Yyea9a"
);

export const SOLANA_CLUSTER = process.env.NEXT_PUBLIC_SOLANA_CLUSTER || "mainnet-beta";
export const SOLANA_RPC = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || (
  SOLANA_CLUSTER === "mainnet-beta"
    ? "https://mainnet.helius-rpc.com/?api-key=REDACTED_HELIUS_API_KEY"
    : `https://api.${SOLANA_CLUSTER}.solana.com`
);

// register_agent discriminator from IDL
const REGISTER_AGENT_DISCRIMINATOR = Buffer.from([135, 157, 66, 195, 2, 113, 175, 30]);

// AgentProfile account discriminator
export const AGENT_PROFILE_DISCRIMINATOR = Buffer.from([60, 227, 42, 24, 0, 87, 86, 205]);

function encodeBorshString(s: string): Buffer {
  const strBuf = Buffer.from(s, "utf-8");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32LE(strBuf.length, 0);
  return Buffer.concat([lenBuf, strBuf]);
}

export function getAgentProfilePDA(owner: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("agent"), owner.toBuffer()],
    IDENTITY_REGISTRY_PROGRAM_ID
  );
}

export function buildRegisterAgentInstruction(
  owner: PublicKey,
  name: string,
  description: string,
  x: string,
  website: string
): TransactionInstruction {
  const [agentProfile] = getAgentProfilePDA(owner);

  const data = Buffer.concat([
    REGISTER_AGENT_DISCRIMINATOR,
    encodeBorshString(name),
    encodeBorshString(description),
    encodeBorshString(x),
    encodeBorshString(website),
  ]);

  return new TransactionInstruction({
    keys: [
      { pubkey: agentProfile, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: IDENTITY_REGISTRY_PROGRAM_ID,
    data,
  });
}

export async function buildRegisterAgentTransaction(
  connection: Connection,
  owner: PublicKey,
  name: string,
  description: string,
  x: string,
  website: string
): Promise<Transaction> {
  const ix = buildRegisterAgentInstruction(owner, name, description, x, website);
  const tx = new Transaction().add(ix);
  tx.feePayer = owner;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  return tx;
}

// update_agent discriminator from IDL
const UPDATE_AGENT_DISCRIMINATOR = Buffer.from([85, 2, 178, 9, 119, 139, 102, 164]);

function encodeBorshOption(value: string | null): Buffer {
  if (value === null) {
    return Buffer.from([0]); // None
  }
  return Buffer.concat([Buffer.from([1]), encodeBorshString(value)]); // Some
}

export function buildUpdateAgentInstruction(
  owner: PublicKey,
  name: string | null,
  description: string | null,
  x: string | null,
  website: string | null
): TransactionInstruction {
  const [agentProfile] = getAgentProfilePDA(owner);

  const data = Buffer.concat([
    UPDATE_AGENT_DISCRIMINATOR,
    encodeBorshOption(name),
    encodeBorshOption(description),
    encodeBorshOption(x),
    encodeBorshOption(website),
  ]);

  return new TransactionInstruction({
    keys: [
      { pubkey: agentProfile, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    programId: IDENTITY_REGISTRY_PROGRAM_ID,
    data,
  });
}

export async function buildUpdateAgentTransaction(
  connection: Connection,
  owner: PublicKey,
  name: string | null,
  description: string | null,
  x: string | null,
  website: string | null
): Promise<Transaction> {
  const ix = buildUpdateAgentInstruction(owner, name, description, x, website);
  const tx = new Transaction().add(ix);
  tx.feePayer = owner;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  return tx;
}

export async function fetchAgentProfile(
  connection: Connection,
  owner: PublicKey
): Promise<OnChainAgentProfile | null> {
  const [pda] = getAgentProfilePDA(owner);
  try {
    const info = await connection.getAccountInfo(pda);
    if (!info || !info.data) return null;
    return deserializeAgentProfile(Buffer.from(info.data));
  } catch {
    return null;
  }
}

export function explorerUrl(address: string, type: "address" | "tx" = "address"): string {
  return `https://explorer.solana.com/${type}/${address}${SOLANA_CLUSTER === "mainnet-beta" ? "" : `?cluster=${SOLANA_CLUSTER}`}`;
}

export interface OnChainAgentProfile {
  owner: string;
  name: string;
  description: string;
  x: string;
  website: string;
  createdAt: number;
  updatedAt: number;
  isActive: boolean;
  reputationScore: number;
  verificationCount: number;
  bump: number;
}

function readBorshString(buf: Buffer, offset: number): [string, number] {
  const len = buf.readUInt32LE(offset);
  const str = buf.slice(offset + 4, offset + 4 + len).toString("utf-8");
  return [str, offset + 4 + len];
}

export function deserializeAgentProfile(data: Buffer): OnChainAgentProfile | null {
  try {
    // Skip 8-byte discriminator
    let offset = 8;
    // owner: 32 bytes pubkey
    const owner = new PublicKey(data.slice(offset, offset + 32)).toBase58();
    offset += 32;
    const [name, o1] = readBorshString(data, offset);
    const [description, o2] = readBorshString(data, o1);
    const [x, o3] = readBorshString(data, o2);
    const [website, o4] = readBorshString(data, o3);
    const createdAt = Number(data.readBigInt64LE(o4));
    const updatedAt = Number(data.readBigInt64LE(o4 + 8));
    const isActive = data[o4 + 16] === 1;
    const reputationScore = data.readUInt32LE(o4 + 17);
    const verificationCount = data.readUInt16LE(o4 + 21);
    const bump = data[o4 + 23];
    return { owner, name, description, x, website, createdAt, updatedAt, isActive, reputationScore, verificationCount, bump };
  } catch {
    return null;
  }
}
