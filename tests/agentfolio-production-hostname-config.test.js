const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const configPath = path.join(
  __dirname,
  "..",
  "ops",
  "caddy",
  "agentfolio.brainai.bot.caddy"
);

test("production compatibility hostname proxies AgentFolio API and frontend", () => {
  const config = fs.readFileSync(configPath, "utf8");

  assert.match(config, /^agentfolio\.brainai\.bot \{/m);
  assert.match(
    config,
    /handle \/api\/\* \{\s+reverse_proxy localhost:3333\s+\}/m
  );
  assert.match(
    config,
    /handle \{\s+reverse_proxy localhost:3000\s+\}/m
  );
  assert.doesNotMatch(config, /13\.53\.199\.22|192\.168\.|10\.\d+\.\d+\.\d+/);
});
