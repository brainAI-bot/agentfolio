#!/bin/bash
# E2E Deploy Gate — runs BEFORE every deploy
# If any check fails, deploy is BLOCKED

set -e

PASS=0
FAIL=0

check() {
  if [ "$2" = "0" ]; then
    echo "✅ $1"
    PASS=$((PASS+1))
  else
    echo "❌ $1"
    FAIL=$((FAIL+1))
  fi
}

echo "=== AGENTFOLIO E2E DEPLOY GATE ==="
echo ""

# 1. API health
CODE=$(curl -s -o /dev/null -w '%{http_code}' 'https://agentfolio.bot/api/profiles?limit=1')
[ "$CODE" = "200" ] && check "API responds 200" 0 || check "API responds (got $CODE)" 1

# 2. Leaderboard scores sane
MAX_SCORE=$(curl -s 'https://agentfolio.bot/api/profiles?limit=10' | python3 -c "
import json,sys
d=json.load(sys.stdin)
scores = [p.get('score',0) or 0 for p in d.get('profiles',[])]
print(int(max(scores)) if scores else 0)
" 2>/dev/null)
[ "$MAX_SCORE" -lt 10000 ] 2>/dev/null && check "Max score < 10000 (got $MAX_SCORE)" 0 || check "Max score < 10000 (got $MAX_SCORE)" 1

# 3. Profile count > 0 (clean-start safe)
PROFILE_COUNT=$(curl -s 'https://agentfolio.bot/api/stats' | python3 -c "
import json,sys
d=json.load(sys.stdin)
print(d.get('total_agents',0))
" 2>/dev/null)
[ "$PROFILE_COUNT" -gt 0 ] 2>/dev/null && check "Profile count > 0 (got $PROFILE_COUNT)" 0 || check "Profile count is 0" 1

# 4. Verification routes
for route in verify/x/challenge verify/github/challenge verify/solana/challenge verify/agentmail/challenge; do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "https://agentfolio.bot/api/$route" -H 'Content-Type: application/json' -d '{"profileId":"test"}')
  [ "$CODE" != "404" ] && check "Route /api/$route not 404 (got $CODE)" 0 || check "Route /api/$route 404" 1
done

# 5. Genesis API endpoint exists (clean-start safe)
GENESIS_CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST 'https://agentfolio.bot/api/satp/genesis/prepare' -H 'Content-Type: application/json' -d '{}')
[ "$GENESIS_CODE" != "404" ] && check "Genesis API endpoint exists (got $GENESIS_CODE)" 0 || check "Genesis API 404" 1

# 6. Wallet connect not broken
WP_OK=$(grep -c 'autoConnect>' /home/ubuntu/agentfolio/frontend/src/components/WalletProvider.tsx 2>/dev/null || echo 0)
[ "$WP_OK" -gt 0 ] && check "WalletProvider has autoConnect" 0 || check "WalletProvider autoConnect missing" 1

echo ""
echo "Results: $PASS passed, $FAIL failed"
if [ $FAIL -gt 0 ]; then
  echo "🚨 DEPLOY BLOCKED — $FAIL checks failed"
  exit 1
else
  echo "✅ All checks passed — safe to deploy"
  exit 0
fi
