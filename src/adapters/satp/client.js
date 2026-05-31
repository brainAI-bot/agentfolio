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
  const required = [
    'SATPSDK',
    'SATPV3SDK',
    'createSATPClient',
    'getV3ProgramIds',
    'hashAgentId',
    'getGenesisPDA',
    'prepareIdentityAttestationRequest',
  ];
  const missing = required.filter((key) => !(key in satpClient));
  if (missing.length) {
    throw new Error(`@brainai/satp-client missing required exports: ${missing.join(', ')}`);
  }
  return true;
}

function getSatpClientExport(exportName, satpClient = loadSatpClient()) {
  if (!(exportName in satpClient)) {
    throw new Error(`@brainai/satp-client missing required export: ${exportName}`);
  }
  return satpClient[exportName];
}

function loadSatpV3SDK() {
  return getSatpClientExport('SATPV3SDK');
}

function createSatpClient(options) {
  return getSatpClientExport('createSATPClient')(options);
}

module.exports = {
  loadSatpClient,
  assertRequiredSatpClientExports,
  getSatpClientExport,
  loadSatpV3SDK,
  createSatpClient,
};
