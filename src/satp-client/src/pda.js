/**
 * Compatibility shim for legacy AgentFolio imports.
 *
 * SATP PDA helpers now live in the extracted @brainai/satp-client package.
 * Do not add protocol semantics here.
 */
module.exports = require('@brainai/satp-client/src/pda.js');
