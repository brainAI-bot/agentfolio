/**
 * AgentFolio SATP client dependency adapter.
 *
 * This is the only package-facing import point for the extracted SATP client.
 * It intentionally has no fallback to AgentFolio-owned embedded SATP source files;
 * SATP protocol exports must resolve from @brainai/satp-client.
 */

function loadSatpClient() {
  return require('@brainai/satp-client');
}

function assertRequiredSatpClientExports(satpClient = loadSatpClient()) {
  const required = ['SATPSDK', 'SATPV3SDK', 'createSATPClient'];
  const missing = required.filter((key) => !(key in satpClient));
  if (missing.length) {
    throw new Error(`@brainai/satp-client missing required exports: ${missing.join(', ')}`);
  }
  return true;
}

module.exports = {
  loadSatpClient,
  assertRequiredSatpClientExports,
};
