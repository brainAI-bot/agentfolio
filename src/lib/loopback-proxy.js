'use strict';

const LOOPBACK_PROXY_ADDRESSES = new Set([
  '127.0.0.1',
  '::1',
  '::ffff:127.0.0.1',
]);

/**
 * Trust exactly one reverse-proxy hop, and only when that hop connects over
 * loopback. Express stops at the first untrusted address, so client-supplied
 * entries farther left in X-Forwarded-For cannot become req.ip.
 */
function trustLoopbackProxyHop(address, hop) {
  return hop === 0 && LOOPBACK_PROXY_ADDRESSES.has(address);
}

module.exports = { trustLoopbackProxyHop };
