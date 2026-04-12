#!/usr/bin/env node
/**
 * AgentFolio Telegram Verification Bot
 * 
 * Handles verification code confirmation for Telegram handles
 * 
 * Setup:
 * 1. Create bot via @BotFather on Telegram
 * 2. Add TELEGRAM_BOT_TOKEN to .env
 * 3. Run: node telegram-bot.js
 * 
 * Usage:
 * Users send their 6-character verification code to the bot
 * Bot confirms with AgentFolio API
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const https = require('https');
const http = require('http');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const AGENTFOLIO_API = process.env.AGENTFOLIO_API_URL || 'http://localhost:3333';
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || 'agentfolio-admin-2026';

if (!BOT_TOKEN) {
  console.error('❌ TELEGRAM_BOT_TOKEN not found in .env');
  console.log('\nSetup instructions:');
  console.log('1. Message @BotFather on Telegram');
  console.log('2. Send /newbot and follow prompts');
  console.log('3. Copy the token to .env as TELEGRAM_BOT_TOKEN');
  process.exit(1);
}

// Telegram API helper
function telegramAPI(method, data = {}) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(data);
    const options = {
      hostname: 'api.telegram.org',
      path: `/bot${BOT_TOKEN}/${method}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(body);
          if (result.ok) {
            resolve(result.result);
          } else {
            reject(new Error(result.description || 'Telegram API error'));
          }
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

// AgentFolio API helper
function agentfolioAPI(endpoint, data) {
  return new Promise((resolve, reject) => {
    const url = new URL(AGENTFOLIO_API + endpoint);
    const isHttps = url.protocol === 'https:';
    const postData = JSON.stringify(data);
    
    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'X-API-Key': ADMIN_API_KEY
      }
    };

    const client = isHttps ? https : http;
    const req = client.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          resolve({ error: e.message, raw: body });
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

// Send message to user
async function sendMessage(chatId, text, options = {}) {
  return telegramAPI('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    ...options
  });
}

// Handle incoming message
async function handleMessage(message) {
  const chatId = message.chat.id;
  const text = (message.text || '').trim();
  const userId = message.from.id;
  const username = message.from.username;

  console.log(`[${new Date().toISOString()}] Message from @${username || userId}: ${text}`);

  // Handle /start command
  if (text.toLowerCase() === '/start') {
    return sendMessage(chatId, 
      `👋 <b>Welcome to AgentFolio Verification!</b>\n\n` +
      `I verify Telegram handles for AI agents on AgentFolio.\n\n` +
      `<b>How it works:</b>\n` +
      `1. Go to your AgentFolio profile\n` +
      `2. Click "Verify Telegram"\n` +
      `3. Enter your Telegram handle\n` +
      `4. Send me the 6-character code\n\n` +
      `Once verified, your profile will show a ✓ next to your Telegram link!\n\n` +
      `🔗 <a href="https://agentfolio.bot">agentfolio.bot</a>`
    );
  }

  // Handle /help command
  if (text.toLowerCase() === '/help') {
    return sendMessage(chatId,
      `📖 <b>AgentFolio Verification Help</b>\n\n` +
      `<b>Commands:</b>\n` +
      `/start - Welcome message\n` +
      `/help - This help message\n` +
      `/status - Check your verification status\n\n` +
      `<b>To verify your Telegram:</b>\n` +
      `Just send me your 6-character verification code (e.g., A1B2C3)\n\n` +
      `<b>Get a code:</b>\n` +
      `1. Visit agentfolio.bot/profile/YOUR_ID\n` +
      `2. Click Edit Profile\n` +
      `3. Click "Verify Telegram"\n` +
      `4. Enter your Telegram handle\n` +
      `5. Copy the code and send it here\n\n` +
      `Questions? Contact @0xbrainKID`
    );
  }

  // Handle /status command
  if (text.toLowerCase() === '/status') {
    if (!username) {
      return sendMessage(chatId, 
        `⚠️ You don't have a Telegram username set.\n\n` +
        `Please set one in Telegram settings to use verification.`
      );
    }
    
    return sendMessage(chatId,
      `📊 <b>Your Status</b>\n\n` +
      `Telegram: @${username}\n` +
      `User ID: ${userId}\n\n` +
      `To check if your AgentFolio profile is verified, visit your profile page.`
    );
  }

  // Check if it looks like a verification code (6 alphanumeric characters)
  const codeMatch = text.match(/^[A-Fa-f0-9]{6}$/);
  if (codeMatch) {
    const code = text.toUpperCase();
    
    if (!username) {
      return sendMessage(chatId,
        `⚠️ <b>No Telegram Username</b>\n\n` +
        `You need to set a Telegram username to verify.\n\n` +
        `Go to Telegram Settings → Username and set one, then try again.`
      );
    }

    // Verify with AgentFolio API
    try {
      const result = await agentfolioAPI('/api/verify/telegram/confirm', {
        code,
        telegramUserId: String(userId),
        telegramUsername: username
      });

      if (result.verified) {
        return sendMessage(chatId,
          `✅ <b>Verification Successful!</b>\n\n` +
          `Your Telegram @${username} is now verified for:\n` +
          `<b>${result.profileId}</b>\n\n` +
          `Your AgentFolio profile will now show a verified Telegram badge! 🎉\n\n` +
          `🔗 <a href="https://agentfolio.bot/profile/${result.profileId}">View your profile</a>`
        );
      } else if (result.error) {
        let errorMsg = result.error;
        
        // User-friendly error messages
        if (errorMsg.includes('expired')) {
          errorMsg = 'This code has expired. Please request a new one from your AgentFolio profile.';
        } else if (errorMsg.includes('Invalid')) {
          errorMsg = 'Invalid code. Please check and try again. Codes are 6 characters like: A1B2C3';
        } else if (errorMsg.includes('does not match')) {
          errorMsg = `Username mismatch. You requested verification for @${result.expected} but sent from @${result.received}.`;
        }
        
        return sendMessage(chatId, `❌ <b>Verification Failed</b>\n\n${errorMsg}`);
      }
    } catch (err) {
      console.error('API Error:', err);
      return sendMessage(chatId,
        `❌ <b>Error</b>\n\n` +
        `Could not connect to AgentFolio API. Please try again later.\n\n` +
        `If this persists, contact @0xbrainKID`
      );
    }
  }

  // Unknown command or text
  return sendMessage(chatId,
    `🤔 I didn't understand that.\n\n` +
    `<b>To verify your Telegram:</b>\n` +
    `Send me your 6-character verification code from AgentFolio.\n\n` +
    `<b>Need help?</b> Send /help`
  );
}

// Long polling for updates
let offset = 0;

async function pollUpdates() {
  try {
    const updates = await telegramAPI('getUpdates', {
      offset,
      timeout: 30,
      allowed_updates: ['message']
    });

    for (const update of updates) {
      offset = update.update_id + 1;
      
      if (update.message) {
        try {
          await handleMessage(update.message);
        } catch (err) {
          console.error('Error handling message:', err);
        }
      }
    }
  } catch (err) {
    console.error('Polling error:', err.message);
    // Wait before retrying on error
    await new Promise(r => setTimeout(r, 5000));
  }

  // Continue polling
  setImmediate(pollUpdates);
}

// Start bot
async function start() {
  try {
    const me = await telegramAPI('getMe');
    console.log(`\n🤖 AgentFolio Telegram Bot started!`);
    console.log(`   Bot: @${me.username}`);
    console.log(`   API: ${AGENTFOLIO_API}`);
    console.log(`\nWaiting for messages...\n`);
    
    // Set bot commands
    await telegramAPI('setMyCommands', {
      commands: [
        { command: 'start', description: 'Welcome message' },
        { command: 'help', description: 'How to verify' },
        { command: 'status', description: 'Your verification status' }
      ]
    });
    
    pollUpdates();
  } catch (err) {
    console.error('Failed to start bot:', err.message);
    process.exit(1);
  }
}

start();
