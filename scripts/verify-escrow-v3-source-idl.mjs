#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const expectedProgramId = 'HXCUWKR2NvRcZ7rNAJHwPcH6QAAWaLR4bRFbfyuDND6C';

const paths = {
  anchorToml: 'onchain/escrow_v3/Anchor.toml',
  programSource: 'onchain/escrow_v3/programs/escrow_v3/src/lib.rs',
  idl: 'onchain/escrow_v3/target/idl/escrow_v3.json',
};

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function sha256(relativePath) {
  const body = fs.readFileSync(path.join(repoRoot, relativePath));
  return crypto.createHash('sha256').update(body).digest('hex');
}

const anchorToml = read(paths.anchorToml);
const programSource = read(paths.programSource);
const idl = JSON.parse(read(paths.idl));

function sliceBetween(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  if (start === -1 || end === -1 || end <= start) return '';
  return source.slice(start, end);
}

const createEscrowSource = sliceBetween(programSource, 'pub fn create_escrow', 'pub fn submit_work');
const validateIdentitySource = sliceBetween(programSource, 'fn validate_agent_identity', 'fn read_u32_le');
const validateIdentityCall = createEscrowSource.indexOf('validate_agent_identity(');
const escrowFunding = createEscrowSource.indexOf('system_instruction::transfer');
const minVerificationRecord = createEscrowSource.indexOf('escrow.min_verification_level = min_verification_level');
const requireBornRecord = createEscrowSource.indexOf('escrow.require_born = require_born');

const checks = {
  anchorProgramIdMatches: new RegExp(`escrow_v3\\s*=\\s*"${expectedProgramId}"`).test(anchorToml),
  declareIdMatches: programSource.includes(`declare_id!("${expectedProgramId}")`),
  idlAddressMatches: idl.address === expectedProgramId,
  idlNameMatches: idl.metadata?.name === 'escrow_v3',
  createEscrowValidatesIdentityBeforeFunding:
    validateIdentityCall !== -1 && escrowFunding !== -1 && validateIdentityCall < escrowFunding,
  createEscrowValidatesIdentityBeforeRecordingRequirements:
    validateIdentityCall !== -1
    && minVerificationRecord !== -1
    && requireBornRecord !== -1
    && validateIdentityCall < minVerificationRecord
    && validateIdentityCall < requireBornRecord,
  identityPdaBoundToAgentIdHash:
    /Pubkey::find_program_address\(\s*&\[b"genesis", agent_id_hash\]/.test(validateIdentitySource)
    && /require_keys_eq!\(\s*agent_identity\.key\(\),\s*expected_identity,\s*EscrowError::WrongAgentIdentity\s*\)/.test(validateIdentitySource),
  identityOwnedBySatpProgram:
    /require_keys_eq!\(\s*\*agent_identity\.owner,\s*SATP_V3_IDENTITY_PROGRAM_ID,\s*EscrowError::InvalidAgentIdentity\s*\)/.test(validateIdentitySource),
  minVerificationLevelEnforced:
    /verification_level\s*>=\s*min_verification_level/.test(validateIdentitySource)
    && /EscrowError::AgentVerificationTooLow/.test(validateIdentitySource),
  requireBornEnforced:
    /if\s+require_born\s*\{[\s\S]*genesis_record\s*>\s*0[\s\S]*EscrowError::AgentNotBorn[\s\S]*\}/.test(validateIdentitySource),
};

const verified = Object.values(checks).every(Boolean);
const evidence = {
  label: 'escrow_v3_source_idl',
  expectedProgramId,
  status: verified ? 'verified' : 'blocked_source_idl_mismatch',
  checks,
  artifacts: {
    anchorToml: {
      path: paths.anchorToml,
      sha256: sha256(paths.anchorToml),
    },
    programSource: {
      path: paths.programSource,
      sha256: sha256(paths.programSource),
    },
    idl: {
      path: paths.idl,
      address: idl.address,
      sha256: sha256(paths.idl),
    },
  },
};

console.log(JSON.stringify(evidence, null, 2));

if (process.argv.includes('--strict') && !verified) {
  process.exitCode = 1;
}
