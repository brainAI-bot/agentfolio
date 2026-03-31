#!/bin/bash
# Pre-deploy checklist — run before ANY pm2 restart
# If any check fails, DO NOT deploy

PASS=0
FAIL=0

check() {
  local name="$1"
  local result="$2"
  if [ "$result" -eq 0 ]; then
    echo "✅ $name"
    PASS=$((PASS+1))
  else
    echo "❌ $name"
    FAIL=$((FAIL+1))
  fi
}

echo '=== AGENTFOLIO PRE-DEPLOY CHECK ==='
echo ''

# 1. API responds
CODE=$(curl -s -o /dev/null -w '%{http_code}' 'https://agentfolio.bot/api/profiles?limit=1')
[ "$CODE" = "200" ] && check "API responds 200" 0 || check "API responds 200 (got $CODE)" 1

# 2. Profile page doesn't crash
BODY=$(curl -s 'https://agentfolio.bot/profile/agent_brainkid' | head -500)
echo "$BODY" | grep -q 'Application error' && check "Profile page loads" 1 || check "Profile page loads" 0

# 3. Leaderboard scores sane (< 10000)
MAX_SCORE=$(curl -s 'https://agentfolio.bot/api/profiles?limit=10' | python3 -c "
import json,sys
d=json.load(sys.stdin)
scores = [p.get('score',0) or 0 for p in d.get('profiles',[])]
print(int(max(scores)) if scores else 0)
" 2>/dev/null)
[ "$MAX_SCORE" -lt 10000 ] 2>/dev/null && check "Max leaderboard score < 10000 (got $MAX_SCORE)" 0 || check "Max leaderboard score < 10000 (got $MAX_SCORE)" 1

# 4. Key verification routes exist (not 404)
for route in verify/solana/challenge verify/eth/initiate verify/github/challenge verify/x/challenge; do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "https://agentfolio.bot/api/$route" -H 'Content-Type: application/json' -d '{}')
  [ "$CODE" != "404" ] && check "Route /api/$route not 404 (got $CODE)" 0 || check "Route /api/$route not 404 (got $CODE)" 1
done

# 5. Genesis API works
GENESIS=$(curl -s 'https://agentfolio.bot/api/profile/agent_brainkid/genesis' | python3 -c "
import json,sys
g=json.load(sys.stdin).get('genesis',{})
print(g.get('reputationScore',0))
" 2>/dev/null)
[ "$GENESIS" -gt 0 ] 2>/dev/null && check "Genesis returns score (got $GENESIS)" 0 || check "Genesis returns score (got $GENESIS)" 1

echo ''
echo "Results: $PASS passed, $FAIL failed"
if [ $FAIL -gt 0 ]; then
  echo '🚨 DO NOT DEPLOY — checks failed'
  exit 1
else
  echo '✅ All checks passed — safe to deploy'
  exit 0
fi
