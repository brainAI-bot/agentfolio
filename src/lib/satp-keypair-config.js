'use strict';

function getRequiredKeypairPath(envNames, context) {
  const names = Array.isArray(envNames) ? envNames : [envNames];
  for (const name of names) {
    const value = process.env[name];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }
  }

  throw new Error(
    `${names.join(' or ')} is required for ${context}; provide an owner-approved signer path through secret configuration`
  );
}

function getRequiredSatpPlatformKeypairPath(context = 'SATP platform signer') {
  return getRequiredKeypairPath('SATP_PLATFORM_KEYPAIR', context);
}

module.exports = {
  getRequiredKeypairPath,
  getRequiredSatpPlatformKeypairPath,
};
