const crypto = require("crypto");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const CONSUMER_KEY = process.env.AGENTFOLIO_X_CONSUMER_KEY;
const CONSUMER_SECRET = process.env.AGENTFOLIO_X_CONSUMER_SECRET;
const ACCESS_TOKEN = process.env.AGENTFOLIO_X_ACCESS_TOKEN;
const ACCESS_SECRET = process.env.AGENTFOLIO_X_ACCESS_TOKEN_SECRET;

function oauthSign(method, url, params) {
  const oauth = {
    oauth_consumer_key: CONSUMER_KEY,
    oauth_nonce: crypto.randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: ACCESS_TOKEN,
    oauth_version: "1.0",
  };
  const allParams = { ...oauth, ...params };
  const sorted = Object.keys(allParams).sort().map(k =>
    `${encodeURIComponent(k)}=${encodeURIComponent(allParams[k])}`
  ).join("&");
  const base = `${method}&${encodeURIComponent(url)}&${encodeURIComponent(sorted)}`;
  const sigKey = `${encodeURIComponent(CONSUMER_SECRET)}&${encodeURIComponent(ACCESS_SECRET)}`;
  oauth.oauth_signature = crypto.createHmac("sha1", sigKey).update(base).digest("base64");
  return "OAuth " + Object.keys(oauth).sort().map(k =>
    `${encodeURIComponent(k)}="${encodeURIComponent(oauth[k])}"`
  ).join(", ");
}

async function tweet(text, replyTo) {
  const url = "https://api.twitter.com/2/tweets";
  const body = { text };
  if (replyTo) body.reply = { in_reply_to_tweet_id: replyTo };
  const auth = oauthSign("POST", url, {});
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (res.ok || res.status === 201) {
    console.log("✅ Posted:", data.data?.id);
    console.log("   Text:", text.slice(0, 80) + "...");
  } else {
    console.error("❌ Error:", JSON.stringify(data));
  }
}

const [,, action, ...args] = process.argv;
if (action === "reply") tweet(args.slice(1).join(" "), args[0]);
else if (action === "tweet") tweet(args.join(" "));
else console.log("Usage: node tweet-as-agentfolio.js [tweet|reply] [replyToId] text");
