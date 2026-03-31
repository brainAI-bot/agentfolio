#!/bin/bash
# Pre-deploy check — verifies all required routes exist in server source before deploying
# Run: bash /home/ubuntu/agentfolio/scripts/pre-deploy-check.sh

ROUTES_JSON="/home/ubuntu/agentfolio/routes.json"
SERVER_DIR="/home/ubuntu/agentfolio/src"
FAILED=0
TOTAL=0

echo "=== AgentFolio Pre-Deploy Route Check ==="
echo "Checking routes from: ${ROUTES_JSON}"
echo ""

if [ ! -f "$ROUTES_JSON" ]; then
  echo "ERROR: routes.json not found at ${ROUTES_JSON}"
  exit 1
fi

# Check each route path appears in the source files
while IFS= read -r route; do
  TOTAL=$((TOTAL + 1))
  # Escape special chars for grep, replace :param with a pattern
  search_pattern=$(echo "$route" | sed "s/:[a-zA-Z]*/[^\x2f]*/g")
  
  if grep -rq "$route\|$search_pattern" "$SERVER_DIR"/*.js "$SERVER_DIR"/routes/*.js 2>/dev/null; then
    echo "  ✓ $route"
  else
    echo "  ✗ MISSING: $route"
    FAILED=$((FAILED + 1))
  fi
done < <(cat "$ROUTES_JSON" | grep '"path"' | sed 's/.*"path": "//;s/".*//')

echo ""
echo "Result: ${TOTAL} routes checked, ${FAILED} missing"

if [ "$FAILED" -gt 0 ]; then
  echo ""
  echo "⛔ DEPLOY BLOCKED: ${FAILED} required routes are missing from source."
  echo "   Restore them before deploying."
  exit 1
fi

echo "✅ All routes present. Safe to deploy."
exit 0
