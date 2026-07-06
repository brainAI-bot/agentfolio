#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const expectedProgramId = '4qx9DTX1BojPnQAtUBL2Gb9pw6kVyw5AucjaR8Yyea9a';

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

const checks = {
  anchorProgramIdMatches: new RegExp(`escrow_v3\\s*=\\s*"${expectedProgramId}"`).test(anchorToml),
  declareIdMatches: programSource.includes(`declare_id!("${expectedProgramId}")`),
  idlAddressMatches: idl.address === expectedProgramId,
  idlNameMatches: idl.metadata?.name === 'escrow_v3',
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
