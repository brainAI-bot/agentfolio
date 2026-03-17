const crypto = require("crypto");
const fs = require("fs");
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
  const authHeader = "OAuth " + Object.keys(oauth).sort().map(k =>
    `${encodeURIComponent(k)}="${encodeURIComponent(oauth[k])}"`
  ).join(", ");
  return authHeader;
}

async function updateProfileImage(imagePath) {
  const url = "https://api.twitter.com/1.1/account/update_profile_image.json";
  const imageBase64 = fs.readFileSync(imagePath, "base64");
  const params = { image: imageBase64 };
  const auth = oauthSign("POST", url, params);
  const body = `image=${encodeURIComponent(imageBase64)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  const data = await res.json();
  if (res.ok) console.log("✅ Profile image updated:", data.profile_image_url_https);
  else console.error("❌ Profile image error:", JSON.stringify(data));
  return res.ok;
}

async function updateBanner(imagePath) {
  const url = "https://api.twitter.com/1.1/account/update_profile_banner.json";
  const imageBase64 = fs.readFileSync(imagePath, "base64");
  const params = { banner: imageBase64 };
  const auth = oauthSign("POST", url, params);
  const body = `banner=${encodeURIComponent(imageBase64)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  if (res.status === 200 || res.status === 201 || res.status === 204) {
    console.log("✅ Banner updated successfully");
    return true;
  }
  const data = await res.text();
  console.error("❌ Banner error:", res.status, data);
  return false;
}

async function main() {
  const action = process.argv[2];
  const brandDir = __dirname;
  
  if (action === "profile" || action === "all") {
    await updateProfileImage(path.join(brandDir, "x-profile-400.png"));
  }
  if (action === "banner" || action === "all") {
    await updateBanner(path.join(brandDir, "x-banner-1500x500.png"));
  }
  if (!action) {
    console.log("Usage: node update-x-profile.js [profile|banner|all]");
  }
}

main().catch(console.error);
