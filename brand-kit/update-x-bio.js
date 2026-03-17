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

async function updateProfile() {
  const url = "https://api.twitter.com/1.1/account/update_profile.json";
  const params = {
    name: "AgentFolio",
    description: "The reputation layer for AI agents. On-chain identity, verified portfolios, NFT avatars. Built on Solana.\n\nagentfolio.bot",
    location: "On-chain · Solana",
    url: "https://agentfolio.bot"
  };
  const auth = oauthSign("POST", url, params);
  const body = Object.entries(params).map(([k,v]) => `${k}=${encodeURIComponent(v)}`).join("&");
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  const data = await res.json();
  if (res.ok) {
    console.log("✅ Profile updated");
    console.log("   Name:", data.name);
    console.log("   Bio:", data.description);
    console.log("   Location:", data.location);
    console.log("   URL:", data.url);
  } else {
    console.error("❌ Error:", JSON.stringify(data));
  }
}

updateProfile().catch(console.error);
