const crypto = require("crypto");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const CK = process.env.AGENTFOLIO_X_CONSUMER_KEY;
const CS = process.env.AGENTFOLIO_X_CONSUMER_SECRET;
const AT = process.env.AGENTFOLIO_X_ACCESS_TOKEN;
const AS = process.env.AGENTFOLIO_X_ACCESS_TOKEN_SECRET;

function sign(method, url, params) {
  const o = { oauth_consumer_key: CK, oauth_nonce: crypto.randomBytes(16).toString("hex"), oauth_signature_method: "HMAC-SHA1", oauth_timestamp: Math.floor(Date.now()/1000).toString(), oauth_token: AT, oauth_version: "1.0" };
  const all = { ...o, ...params };
  const sorted = Object.keys(all).sort().map(k=>`${encodeURIComponent(k)}=${encodeURIComponent(all[k])}`).join("&");
  const base = `${method}&${encodeURIComponent(url)}&${encodeURIComponent(sorted)}`;
  o.oauth_signature = crypto.createHmac("sha1", `${encodeURIComponent(CS)}&${encodeURIComponent(AS)}`).update(base).digest("base64");
  return "OAuth " + Object.keys(o).sort().map(k=>`${encodeURIComponent(k)}="${encodeURIComponent(o[k])}"`).join(", ");
}

async function tweet(text, replyTo, quoteTweetId) {
  const url = "https://api.twitter.com/2/tweets";
  const body = { text };
  if (replyTo) body.reply = { in_reply_to_tweet_id: replyTo };
  if (quoteTweetId) body.quote_tweet_id = quoteTweetId;
  const auth = sign("POST", url, {});
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (res.ok) console.log("✅ Posted:", JSON.stringify(data));
  else console.error("❌ Error:", res.status, JSON.stringify(data));
}

const action = process.argv[2];
const id = process.argv[3];
const text = process.argv[4] || process.argv[3];

if (action === "reply") tweet(text, id);
else if (action === "quote") tweet(text, null, id);
else if (action === "tweet") tweet(process.argv[3]);
else console.log("Usage: node tweet-agentfolio.js [tweet|reply|quote] [id] \"text\"");
