/**
 * Compatibility shim for legacy AgentFolio imports.
 *
 * SATP schemas now live in the extracted @brainai/satp-client package.
 * Do not add protocol semantics here.
 */
module.exports = require('@brainai/satp-client/packages/satp-client/src/schema');
