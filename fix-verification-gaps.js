const fs = require('fs');
let c = fs.readFileSync('src/server.js', 'utf8');

// Fix 1: ETH verify - add addVerification after successful verify
const ethOld = `const result = ethVerify.verifySignature(challengeId, signature);
    res.json(result);`;
const ethNew = `const result = ethVerify.verifySignature(challengeId, signature);
    if (result.verified && result.profileId) {
      profileStore.addVerification(result.profileId, 'eth', result.walletAddress, { challengeId, signature: signature.slice(0, 16) + '...', verifiedAt: new Date().toISOString() });
    }
    res.json(result);`;

if (!c.includes(ethOld)) { console.error('ETH old text not found'); process.exit(1); }
c = c.replace(ethOld, ethNew);
console.log('ETH fix applied');

// Fix 2: Discord - add confirm endpoint after initiate
const discordInsertAfter = `app.post('/api/verification/discord/initiate', async (req, res) => {
  const { profileId, discordUsername } = req.body;
  
  if (!profileId || !discordUsername) {
    return res.status(400).json({ error: 'Missing profileId or discordUsername' });
  }

  try {
    const result = await discordVerify.initiateDiscordVerification(profileId, discordUsername);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});`;

const discordConfirmRoute = `app.post('/api/verification/discord/initiate', async (req, res) => {
  const { profileId, discordUsername } = req.body;
  
  if (!profileId || !discordUsername) {
    return res.status(400).json({ error: 'Missing profileId or discordUsername' });
  }

  try {
    const result = await discordVerify.initiateDiscordVerification(profileId, discordUsername);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/verification/discord/verify', async (req, res) => {
  const { challengeId, messageUrl } = req.body;
  if (!challengeId) return res.status(400).json({ error: 'Missing challengeId' });
  try {
    const result = await discordVerify.verifyDiscordChallenge(challengeId, messageUrl);
    if (result.verified && result.discordUsername) {
      const challenge = await require('./verification-challenges').getChallenge(challengeId);
      if (challenge && challenge.profileId) {
        profileStore.addVerification(challenge.profileId, 'discord', result.discordUsername, { challengeId, messageId: result.messageId, verifiedAt: new Date().toISOString() });
      }
    }
    res.json(result);
  } catch (error) { res.status(500).json({ error: error.message }); }
});`;

if (!c.includes(discordInsertAfter)) { console.error('Discord insert point not found'); process.exit(1); }
c = c.replace(discordInsertAfter, discordConfirmRoute);
console.log('Discord confirm route added');

// Fix 3: ENS verify - add addVerification
const ensOld = `const result = await ensVerify.verifyENSOwnership(challengeId, signature);
    res.json(result);`;
const ensNew = `const result = await ensVerify.verifyENSOwnership(challengeId, signature);
    if (result.verified && result.profileId) {
      profileStore.addVerification(result.profileId, 'ens', result.ensName || result.identifier, { challengeId, verifiedAt: new Date().toISOString() });
    }
    res.json(result);`;

if (c.includes(ensOld)) {
  c = c.replace(ensOld, ensNew);
  console.log('ENS fix applied');
} else {
  console.log('ENS old text not found (skipping)');
}

// Fix 4: Farcaster verify - add addVerification  
const fcOld = `const result = await farcasterVerify.verifyCast(challengeId, castHash);
    res.json(result);`;
const fcNew = `const result = await farcasterVerify.verifyCast(challengeId, castHash);
    if (result.verified && result.profileId) {
      profileStore.addVerification(result.profileId, 'farcaster', result.fid || result.identifier, { challengeId, castHash, verifiedAt: new Date().toISOString() });
    }
    res.json(result);`;

if (c.includes(fcOld)) {
  c = c.replace(fcOld, fcNew);
  console.log('Farcaster fix applied');
} else {
  console.log('Farcaster old text not found (skipping)');
}

fs.writeFileSync('src/server.js', c);
console.log('All fixes written to src/server.js');
