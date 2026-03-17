#!/usr/bin/env node
require('dotenv').config();
const { TwitterApi } = require('twitter-api-v2');

// Use AgentFolio credentials
const client = new TwitterApi({
  appKey: process.env.AGENTFOLIO_X_CONSUMER_KEY,
  appSecret: process.env.AGENTFOLIO_X_CONSUMER_SECRET,
  accessToken: process.env.AGENTFOLIO_X_ACCESS_TOKEN,
  accessSecret: process.env.AGENTFOLIO_X_ACCESS_TOKEN_SECRET,
});

async function tweet(text) {
  try {
    const result = await client.v2.tweet(text);
    console.log('Tweet posted successfully!');
    console.log('Tweet ID:', result.data.id);
    console.log('URL: https://x.com/AgentFolioHQ/status/' + result.data.id);
    return result;
  } catch (error) {
    console.error('Error posting tweet:', error.message);
    if (error.data) console.error('Details:', JSON.stringify(error.data, null, 2));
    process.exit(1);
  }
}

async function reply(tweetId, text) {
  try {
    const result = await client.v2.reply(text, tweetId);
    console.log('Reply posted successfully!');
    console.log('Reply ID:', result.data.id);
    console.log('URL: https://x.com/AgentFolioHQ/status/' + result.data.id);
    return result;
  } catch (error) {
    console.error('Error posting reply:', error.message);
    if (error.data) console.error('Details:', JSON.stringify(error.data, null, 2));
    process.exit(1);
  }
}

async function quote(tweetUrl, text) {
  try {
    const result = await client.v2.tweet(text, {
      quote_tweet_id: tweetUrl.split('/').pop()
    });
    console.log('Quote tweet posted!');
    console.log('Tweet ID:', result.data.id);
    console.log('URL: https://x.com/AgentFolioHQ/status/' + result.data.id);
    return result;
  } catch (error) {
    console.error('Error posting quote tweet:', error.message);
    if (error.data) console.error('Details:', JSON.stringify(error.data, null, 2));
    process.exit(1);
  }
}

async function search(query, count = 10) {
  try {
    const result = await client.v2.search(query, { 
      max_results: count,
      'tweet.fields': ['author_id', 'created_at', 'public_metrics'],
      'user.fields': ['username', 'name'],
      'expansions': ['author_id']
    });
    console.log('Search results:');
    for (const tweet of result.data.data || []) {
      const user = result.includes?.users?.find(u => u.id === tweet.author_id);
      console.log(`\n@${user?.username || 'unknown'}: ${tweet.text.slice(0, 100)}...`);
      console.log(`  ID: ${tweet.id}`);
    }
    return result;
  } catch (error) {
    console.error('Error searching:', error.message);
    if (error.data) console.error('Details:', JSON.stringify(error.data, null, 2));
  }
}

// Parse command
const action = process.argv[2];
const arg1 = process.argv[3];
const text = process.argv.slice(4).join(' ') || process.argv.slice(3).join(' ');

if (action === 'tweet' && arg1) {
  tweet(process.argv.slice(3).join(' '));
} else if (action === 'reply' && arg1 && text) {
  reply(arg1, process.argv.slice(4).join(' '));
} else if (action === 'quote' && arg1 && text) {
  quote(arg1, process.argv.slice(4).join(' '));
} else if (action === 'search' && arg1) {
  search(arg1, parseInt(process.argv[4]) || 10);
} else {
  console.log('Usage:');
  console.log('  node tweet-agentfolio.js tweet <text>');
  console.log('  node tweet-agentfolio.js reply <tweet_id> <reply_text>');
  console.log('  node tweet-agentfolio.js quote <tweet_url_or_id> <quote_text>');
  console.log('  node tweet-agentfolio.js search <query> [count]');
}
