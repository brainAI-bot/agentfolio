import { TwitterApi } from 'x-api-v2';
import fs from 'fs';
import path from 'path';

const client = new TwitterApi({
  appKey: 'REDACTED_APP_KEY',
  appSecret: 'REDACTED_APP_SECRET',
  accessToken: 'REDACTED_ACCESS_TOKEN',
  accessSecret: 'REDACTED_ACCESS_SECRET',
});

const v1 = client.v1;

async function main() {
  const action = process.argv[2];
  
  if (action === 'pfp') {
    const imgPath = process.argv[3] || './agentfolio-pfp.png';
    const buf = fs.readFileSync(imgPath);
    const base64 = buf.toString('base64');
    const result = await v1.updateAccountProfileImage(base64);
    console.log('PFP updated!', result.profile_image_url_https);
  } else if (action === 'banner') {
    const imgPath = process.argv[3] || './agentfolio-banner.png';
    const buf = fs.readFileSync(imgPath);
    const base64 = buf.toString('base64');
    await v1.updateAccountProfileBanner(base64);
    console.log('Banner updated!');
  } else if (action === 'bio') {
    const result = await v1.updateAccountProfile({
      description: process.argv[3] || 'The Trust Layer for AI Agents 🛡️ On-chain identity, verification & reputation on Solana. Built by @0xbrainKID 🧠',
      url: 'https://agentfolio.bot',
    });
    console.log('Bio updated!', result.description);
  } else {
    console.log('Usage: node update-x-profile.mjs [pfp|banner|bio] [path|text]');
  }
}

main().catch(e => console.error(e.message || e));
