#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Connection, PublicKey } from '@solana/web3.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const registryPath = path.join(repoRoot, 'frontend/src/lib/satp-mainnet-programs.ts');
const expectedOwner = 'BPFLoaderUpgradeab1e11111111111111111111111';
const args = new Set(process.argv.slice(2));
const strictMode = args.has('--strict');
const ciMode = Boolean(process.env.CI);
const allowEnvOverrides = args.has('--allow-env-overrides') && !strictMode && !ciMode;
const rpcUrl =
  process.env.SOLANA_RPC_URL
  || process.env.SOLANA_MAINNET_RPC_URL
  || process.env.RPC_URL
  || 'https://api.mainnet-beta.solana.com';

function loadRegistry() {
  const source = fs.readFileSync(registryPath, 'utf8');
  const match = source.match(/export\s+const\s+SATP_MAINNET_PROGRAMS\s*=\s*\{([\s\S]*?)\}\s+as\s+const\s*;/);
  if (!match) {
    throw new Error('SATP_MAINNET_PROGRAMS export not found');
  }

  const rows = [...match[1].matchAll(/^\s*([A-Z0-9_]+):\s*"([^"]+)"\s*,?\s*$/gm)]
    .map(([, name, registryAddress]) => {
      const envKey = `SATP_MAINNET_${name}_PROGRAM_ID`;
      const override = process.env[envKey];
      return {
        name,
        id: allowEnvOverrides && override ? override : registryAddress,
        provenance: allowEnvOverrides && override ? envKey : 'frontend/src/lib/satp-mainnet-programs.ts',
        overrideEnvKey: override ? envKey : null,
      };
    });

  if (rows.length === 0) {
    throw new Error('SATP_MAINNET_PROGRAMS contains no parseable program ids');
  }

  return rows;
}

async function readProgram(connection, program) {
  let publicKey;
  try {
    publicKey = new PublicKey(program.id);
  } catch (error) {
    return {
      ...program,
      slot: null,
      exists: false,
      executable: false,
      owner: null,
      status: 'invalid_public_key',
      error: error.message,
    };
  }

  const { context, value } = await connection.getAccountInfoAndContext(publicKey, {
    commitment: 'confirmed',
  });

  return {
    ...program,
    slot: context.slot,
    exists: Boolean(value),
    executable: Boolean(value?.executable),
    owner: value?.owner?.toBase58() || null,
    status: value
      && value.executable
      && value.owner.toBase58() === expectedOwner
      ? 'verified'
      : 'blocked_onchain_program_mismatch',
  };
}

function readFixture() {
  if (!process.env.AGENTFOLIO_SATP_PROGRAM_VERIFY_FIXTURE) return null;
  return JSON.parse(fs.readFileSync(process.env.AGENTFOLIO_SATP_PROGRAM_VERIFY_FIXTURE, 'utf8'));
}

async function main() {
  const programs = loadRegistry();
  const overrideEnvKeys = programs
    .filter((program) => program.overrideEnvKey)
    .map((program) => program.overrideEnvKey);

  if ((strictMode || ciMode) && overrideEnvKeys.length > 0) {
    console.log(JSON.stringify({
      label: 'satp_mainnet_program_registry_onchain',
      registryPath: 'frontend/src/lib/satp-mainnet-programs.ts',
      network: 'mainnet-beta',
      expectedOwner,
      status: 'blocked_env_override_in_strict_mode',
      mode: {
        strict: strictMode,
        ci: ciMode,
        allowEnvOverrides: false,
      },
      overrideEnvKeys,
      programs: programs.map((program) => ({
        name: program.name,
        id: program.id,
        provenance: program.provenance,
      })),
    }, null, 2));
    process.exitCode = 1;
    return;
  }

  const fixture = readFixture();
  const results = fixture
    ? programs.map((program) => ({ ...program, ...fixture[program.name] }))
    : await Promise.all(programs.map((program) => readProgram(new Connection(rpcUrl, 'confirmed'), program)));

  const verified = results.every((program) => (
    program.exists === true
    && program.executable === true
    && program.owner === expectedOwner
  ));

  const evidence = {
    label: 'satp_mainnet_program_registry_onchain',
    registryPath: 'frontend/src/lib/satp-mainnet-programs.ts',
    network: 'mainnet-beta',
    expectedOwner,
    status: verified ? 'verified' : 'blocked_onchain_program_mismatch',
    mode: {
      strict: strictMode,
      ci: ciMode,
      allowEnvOverrides,
    },
    programs: results.map((program) => ({
      name: program.name,
      id: program.id,
      provenance: program.provenance,
      slot: program.slot ?? null,
      owner: program.owner ?? null,
      exists: program.exists === true,
      executable: program.executable === true,
      status: program.status,
    })),
  };

  console.log(JSON.stringify(evidence, null, 2));

  if (strictMode && !verified) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(JSON.stringify({
    label: 'satp_mainnet_program_registry_onchain',
    status: 'blocked_verifier_error',
    error: error.message,
  }, null, 2));
  process.exitCode = 1;
});
