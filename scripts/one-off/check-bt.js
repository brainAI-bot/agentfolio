const Database = require("better-sqlite3");
const db = new Database("./data/agentfolio.db", {readonly:true});

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = ?").all("table");
console.log("Tables:", tables.map(t=>t.name).join(", "));

const cols = db.pragma("table_info(profiles)");
console.log("\nAll profile columns:", cols.map(c=>c.name).join(", "));

const bt = db.prepare("SELECT * FROM profiles WHERE id = ?").get("agent_braintrade");
if (bt) {
  console.log("\n=== brainTrade profile ===");
  for (const [k,v] of Object.entries(bt)) {
    if (v && String(v).length < 200)
      console.log(k + ": " + v);
  }
}

for (const t of tables) {
  if (t.name.includes("burn") || t.name.includes("nft") || t.name.includes("avatar") || t.name.includes("collection")) {
    console.log("\n=== " + t.name + " ===");
    const rows = db.prepare("SELECT * FROM " + t.name + " LIMIT 5").all();
    rows.forEach(r => console.log(JSON.stringify(r)));
  }
}

db.close();
