#!/usr/bin/env node
'use strict';

const satpClient = require('@brainai/satp-client');
const {
  getEscrowV3AuthorityReadback,
} = require('../src/lib/escrow-v3-authority');

const strict = process.argv.includes('--strict');
const readback = getEscrowV3AuthorityReadback({ satpClient });

console.log(JSON.stringify(readback, null, 2));

if (strict && readback.status !== 'verified') {
  process.exitCode = 1;
}
