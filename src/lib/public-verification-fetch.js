'use strict';

const dns = require('node:dns');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const { isPublicVerificationHostname, isPublicVerificationUrl } = require('./canonical-verification-providers');

const MAX_RESPONSE_BYTES = 64 * 1024;

async function resolvePublicAddresses(hostname, lookup = dns.promises.lookup) {
  const normalized = String(hostname || '').replace(/^\[|\]$/g, '');
  const ipVersion = net.isIP(normalized);
  const records = ipVersion
    ? [{ address: normalized, family: ipVersion }]
    : await lookup(normalized, { all: true, verbatim: true });

  if (!Array.isArray(records) || records.length === 0) {
    throw new Error('Verification hostname did not resolve');
  }
  for (const record of records) {
    if (!record || !isPublicVerificationHostname(record.address)) {
      throw new Error('Verification hostname resolves to a non-public address');
    }
  }
  return records.map((record) => ({ address: record.address, family: Number(record.family) }));
}

function createPinnedLookup(records) {
  let cursor = 0;
  return (_hostname, options, callback) => {
    const settings = typeof options === 'number' ? { family: options } : (options || {});
    const family = Number(settings.family || 0);
    const candidates = family ? records.filter((record) => record.family === family) : records;
    if (candidates.length === 0) {
      const error = new Error(`No validated address for family ${family}`);
      error.code = 'ENOTFOUND';
      callback(error);
      return;
    }
    if (settings.all) {
      callback(null, candidates.map((record) => ({ ...record })));
      return;
    }
    const selected = candidates[cursor % candidates.length];
    cursor += 1;
    callback(null, selected.address, selected.family);
  };
}

async function fetchPublicVerificationText(value, options = {}) {
  if (!isPublicVerificationUrl(value)) {
    throw new Error('Website verification URL must use a public hostname');
  }
  const parsed = new URL(value);
  const records = await resolvePublicAddresses(parsed.hostname, options.lookup);
  const requestImpl = options.request || (parsed.protocol === 'https:' ? https.request : http.request);

  return new Promise((resolve, reject) => {
    const request = requestImpl(parsed, {
      method: 'GET',
      headers: options.headers || {},
      lookup: createPinnedLookup(records),
      signal: options.signal,
    }, (response) => {
      const status = Number(response.statusCode || 0);
      if (status >= 300 && status < 400) {
        response.resume();
        reject(new Error('Verification redirects are not allowed'));
        return;
      }

      const chunks = [];
      let size = 0;
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_RESPONSE_BYTES) {
          request.destroy(new Error('Verification response exceeds 64 KiB'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        resolve({
          ok: status >= 200 && status < 300,
          status,
          text: async () => Buffer.concat(chunks).toString('utf8'),
        });
      });
    });
    request.on('error', reject);
    request.end();
  });
}

module.exports = {
  createPinnedLookup,
  fetchPublicVerificationText,
  resolvePublicAddresses,
};
