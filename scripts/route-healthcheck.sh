#!/bin/bash
# Route Healthcheck — curls every required route, alerts on 404
# Add to cron: */10 * * * * /home/ubuntu/agentfolio/scripts/route-healthcheck.sh >> /var/log/agentfolio-healthcheck.log 2>&1

BASE="http://localhost:3000"
FAILED=0
TOTAL=0
FAILURES=""

check_get() {
  TOTAL=$((TOTAL + 1))
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "${BASE}${1}")
  if [ "$code" = "404" ]; then
    FAILED=$((FAILED + 1))
    FAILURES="${FAILURES}\n  404: GET ${1}"
  fi
}

check_post() {
  TOTAL=$((TOTAL + 1))
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 -X POST -H "Content-Type: application/json" -d '{}' "${BASE}${1}")
  if [ "$code" = "404" ]; then
    FAILED=$((FAILED + 1))
    FAILURES="${FAILURES}\n  404: POST ${1}"
  fi
}

# GET routes
check_get "/api/verify/hyperliquid?address=test"
check_get "/api/verify/ethereum?address=0x0000000000000000000000000000000000000001"
check_get "/api/verify/telegram/status?profileId=test"
check_get "/api/verify/telegram/all"
check_get "/api/verify/discord/status"
check_get "/api/verify/discord/all"
check_get "/api/verify/discord/profile?profileId=test"
check_get "/api/verify/discord/callback"
check_get "/api/verify/polymarket/stats?address=test"
check_get "/api/verify/polymarket/challenge?profileId=test"
check_get "/api/verify/moltbook/challenge?profileId=test"
check_get "/api/satp/overview"
check_get "/api/satp-auto/identity/check/test"

# POST routes
check_post "/api/verify/challenge"
check_post "/api/verify/sign"
check_post "/api/verify/discord/headless"
check_post "/api/verify/satp/headless"
check_post "/api/verify/satp"
check_post "/api/verify/telegram/start"
check_post "/api/verify/telegram/confirm"
check_post "/api/verify/discord/start"
check_post "/api/verify/polymarket"
check_post "/api/verify/kalshi"
check_post "/api/verify/moltbook"
check_post "/api/verify/mcp"
check_post "/api/verify/a2a"
check_post "/api/verify/website/challenge"
check_post "/api/verify/website/confirm"
check_post "/api/satp-auto/identity/create"
check_post "/api/satp-auto/identity/confirm"
check_post "/api/satp/genesis/prepare"

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Checked ${TOTAL} routes: ${FAILED} failures"

if [ "$FAILED" -gt 0 ]; then
  echo "ALERT: ${FAILED} routes returning 404!"
  echo -e "$FAILURES"
  # Could add alerting here (e.g., curl to Telegram, webhook, etc.)
  exit 1
fi

exit 0
