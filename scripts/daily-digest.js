#!/usr/bin/env node
/**
 * Daily Digest CLI
 * Generate and optionally tweet daily AgentFolio stats
 * 
 * Usage:
 *   node daily-digest.js           # Generate digest only
 *   node daily-digest.js --tweet   # Generate and tweet
 *   node daily-digest.js --preview # Show what would be tweeted
 */

const { generateDailyDigest, getLatestDigest } = require('../src/lib/daily-digest');
const { execSync } = require('child_process');
const path = require('path');

const TWEET_SCRIPT = '/home/ubuntu/clawd/brainKID/tweet.js';

async function main() {
  const args = process.argv.slice(2);
  const shouldTweet = args.includes('--tweet');
  const previewOnly = args.includes('--preview');
  const tweetType = args.find(a => a.startsWith('--type='))?.split('=')[1] || 'stats';
  
  console.log('📊 Generating AgentFolio Daily Digest...\n');
  
  const digest = await generateDailyDigest();
  
  if (!digest || !digest.tweets.length) {
    console.log('❌ Failed to generate digest');
    process.exit(1);
  }
  
  console.log(`📅 Date: ${digest.date}`);
  console.log(`📝 Generated ${digest.tweets.length} tweet(s):\n`);
  
  for (const tweet of digest.tweets) {
    console.log(`--- [${tweet.type.toUpperCase()}] ---`);
    console.log(tweet.content);
    console.log('');
  }
  
  if (previewOnly) {
    console.log('Preview mode - not posting.');
    process.exit(0);
  }
  
  if (shouldTweet) {
    const tweetToPost = digest.tweets.find(t => t.type === tweetType) || digest.tweets[0];
    
    console.log(`\n🐦 Posting ${tweetToPost.type} tweet...\n`);
    
    try {
      const tweetContent = tweetToPost.content.replace(/"/g, '\\"').replace(/\$/g, '\\$');
      const result = execSync(`node ${TWEET_SCRIPT} "${tweetContent}"`, {
        cwd: path.dirname(TWEET_SCRIPT),
        timeout: 30000,
        encoding: 'utf8'
      });
      
      console.log('✅ Tweet posted successfully!');
      console.log(result.trim());
    } catch (error) {
      console.error('❌ Failed to post tweet:', error.message);
      process.exit(1);
    }
  } else {
    console.log('💡 Run with --tweet to post, or --preview to see without saving.');
  }
}

main().catch(console.error);
