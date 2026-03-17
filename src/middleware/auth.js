/**
 * Auth middleware stub
 * API key based authentication for protected routes
 */
function requireAuth(req, res, next) {
  const apiKey = req.headers["x-api-key"] || req.query.apiKey;
  if (!apiKey) {
    return res.status(401).json({ error: "API key required" });
  }
  
  // Look up profile by API key
  const Database = require("better-sqlite3");
  const path = require("path");
  const db = new Database(path.join(__dirname, "../../data/agentfolio.db"), { readonly: true });
  const profile = db.prepare("SELECT id FROM profiles WHERE api_key = ?").get(apiKey);
  db.close();
  
  if (!profile) {
    return res.status(401).json({ error: "Invalid API key" });
  }
  
  req.profileId = profile.id;
  next();
}

module.exports = { requireAuth };
