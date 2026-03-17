#!/usr/bin/env node
/**
 * Update @AgentFolioHQ X/Twitter profile
 * Usage: node update-agentfolio-profile.js picture <image_path>
 *        node update-agentfolio-profile.js banner <image_path>
 *        node update-agentfolio-profile.js bio "description" [--name "Name"] [--url "https://..."]
 */
require('dotenv').config({ path: __dirname + '/.env' });
const fs = require('fs');
const crypto = require('crypto');
const https = require('https');
const path = require('path');

const consumerKey = process.env.AGENTFOLIO_X_CONSUMER_KEY;
const consumerSecret = process.env.AGENTFOLIO_X_CONSUMER_SECRET;
const accessToken = process.env.AGENTFOLIO_X_ACCESS_TOKEN;
const accessTokenSecret = process.env.AGENTFOLIO_X_ACCESS_TOKEN_SECRET;

function percentEncode(str) {
  return encodeURIComponent(str).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

function oauthSign(method, url, params) {
  const oauthParams = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: accessToken,
    oauth_version: '1.0'
  };
  const allParams = { ...oauthParams, ...params };
  const paramString = Object.keys(allParams).sort()
    .map(k => `${percentEncode(k)}=${percentEncode(allParams[k])}`).join('&');
  const baseString = `${method}&${percentEncode(url)}&${percentEncode(paramString)}`;
  const signingKey = `${percentEncode(consumerSecret)}&${percentEncode(accessTokenSecret)}`;
  const signature = crypto.createHmac('sha1', signingKey).update(baseString).digest('base64');
  oauthParams.oauth_signature = signature;
  return 'OAuth ' + Object.keys(oauthParams).sort()
    .map(k => `${percentEncode(k)}="${percentEncode(oauthParams[k])}"`).join(', ');
}

function apiCall(apiPath, params) {
  const url = `https://api.twitter.com${apiPath}`;
  const auth = oauthSign('POST', url, params);
  const body = Object.keys(params).map(k => `${percentEncode(k)}=${percentEncode(params[k])}`).join('&');
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname: 'api.twitter.com', path: apiPath, method: 'POST', headers: {
      'Authorization': auth, 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body)
    }}, res => {
      let data = ''; res.on('data', c => data += c);
      res.on('end', () => res.statusCode >= 200 && res.statusCode < 300 ? resolve(data) : reject(new Error(`${res.statusCode}: ${data}`)));
    });
    req.write(body); req.end();
  });
}

async function main() {
  const args = process.argv.slice(2);
  const action = args[0];

  if (action === 'picture') {
    const img = fs.readFileSync(path.resolve(args[1])).toString('base64');
    await apiCall('/1.1/account/update_profile_image.json', { image: img });
    console.log('✓ Profile picture updated!');
  } else if (action === 'banner') {
    const img = fs.readFileSync(path.resolve(args[1])).toString('base64');
    await apiCall('/1.1/account/update_profile_banner.json', { banner: img });
    console.log('✓ Banner updated!');
  } else if (action === 'bio') {
    const params = {};
    let i = 1;
    while (i < args.length) {
      if (args[i] === '--name') { params.name = args[++i]; }
      else if (args[i] === '--url') { params.url = args[++i]; }
      else { params.description = args[i]; }
      i++;
    }
    await apiCall('/1.1/account/update_profile.json', params);
    console.log('✓ Profile updated!', params);
  } else {
    console.log('Usage:');
    console.log('  node update-agentfolio-profile.js picture <image_path>');
    console.log('  node update-agentfolio-profile.js banner <image_path>');
    console.log('  node update-agentfolio-profile.js bio "description" [--name "Name"] [--url "URL"]');
    process.exit(1);
  }
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
