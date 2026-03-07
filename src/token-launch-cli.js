#!/usr/bin/env node
/**
 * Token Launch CLI - Launch tokens for AgentFolio profiles on pump.fun
 * 
 * Usage:
 *   node token-launch-cli.js check <profileId>          - Check if profile can launch
 *   node token-launch-cli.js launch <profileId> <name> <symbol> <description> [imagePath]
 *   node token-launch-cli.js list [profileId]            - List launches
 */

const { canLaunch, launchToken, getProfileLaunches, getAllLaunches } = require('./lib/token-launch');
const { loadProfile } = require('./lib/profile');

async function main() {
  const [cmd, ...args] = process.argv.slice(2);

  if (!cmd || cmd === '--help') {
    console.log(`
🚀 AgentFolio Token Launch CLI

Commands:
  check <profileId>                              Check launch eligibility
  launch <profileId> <name> <symbol> <desc>      Launch token on pump.fun
  list [profileId]                               List all launches (or for a profile)
  
Example:
  node token-launch-cli.js check agent_brainkid
  node token-launch-cli.js launch agent_brainkid "Brain Token" "BRAIN" "The token for AI brains"
`);
    return;
  }

  switch (cmd) {
    case 'check': {
      const profile = loadProfile(args[0]);
      const result = canLaunch(profile);
      console.log(result.allowed ? '✅ Can launch' : `❌ ${result.reason}`);
      break;
    }
    case 'launch': {
      const [profileId, name, symbol, description, imagePath] = args;
      if (!profileId || !name || !symbol || !description) {
        console.error('Usage: launch <profileId> <name> <symbol> <description> [imagePath]');
        process.exit(1);
      }
      console.log(`🚀 Launching ${symbol} for ${profileId}...`);
      try {
        const launch = await launchToken(profileId, { name, symbol, description, imagePath });
        console.log(`\n✅ Token launched!`);
        console.log(`   Mint: ${launch.mint}`);
        console.log(`   pump.fun: ${launch.pumpUrl}`);
        console.log(`   Dexscreener: ${launch.dexscreenerUrl}`);
      } catch (e) {
        console.error(`❌ Failed: ${e.message}`);
        process.exit(1);
      }
      break;
    }
    case 'list': {
      const launches = args[0] ? getProfileLaunches(args[0]) : getAllLaunches();
      if (launches.length === 0) {
        console.log('No launches yet.');
      } else {
        for (const l of launches) {
          console.log(`${l.status === 'live' ? '🟢' : l.status === 'failed' ? '🔴' : '🟡'} ${l.symbol} (${l.name}) — ${l.status} — ${l.profileName || l.profileId}`);
          if (l.mint) console.log(`   Mint: ${l.mint}`);
          if (l.pumpUrl) console.log(`   ${l.pumpUrl}`);
        }
      }
      break;
    }
    default:
      console.error(`Unknown command: ${cmd}`);
      process.exit(1);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
