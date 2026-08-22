import crypto from 'node:crypto';

export function allocatedPayloadInvariant(bytes, expected) {
  const observedSha256 = crypto.createHash('sha256').update(bytes).digest('hex');

  return {
    allocatedBinaryLengthMatches: bytes.length === expected.length,
    allocatedBinarySha256Matches: observedSha256 === expected.sha256,
  };
}
