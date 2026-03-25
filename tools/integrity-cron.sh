#!/bin/bash
# Integrity Check Cron — runs daily at 06:00 UTC via PM2
# Logs to ~/clawd-brainchain/logs/integrity-check.log
# Alerts to CMD Center (HQ comms) if any FAIL detected

LOG_DIR="$HOME/clawd-brainchain/logs"
LOG_FILE="$LOG_DIR/integrity-check.log"
TOOL_DIR="/home/ubuntu/agentfolio/tools"
HQ_API="https://brainai.bot/hq/api/comms/agent-push"
HQ_KEY="HQ_API_KEY_REDACTED"

mkdir -p "$LOG_DIR"

echo "=== Integrity Check: $(date -u '+%Y-%m-%d %H:%M:%S UTC') ===" >> "$LOG_FILE"

# Run integrity check (JSON output for parsing)
RESULT=$(cd /home/ubuntu/agentfolio && node "$TOOL_DIR/integrity-check.js" --json 2>&1)
EXIT_CODE=$?

# Also append human-readable to log
cd /home/ubuntu/agentfolio && node "$TOOL_DIR/integrity-check.js" >> "$LOG_FILE" 2>&1

# Parse JSON result for alerts
FAIL_COUNT=$(echo "$RESULT" | node -e "
  let data = '';
  process.stdin.on('data', d => data += d);
  process.stdin.on('end', () => {
    try {
      const j = JSON.parse(data);
      console.log(j.summary?.fail || 0);
    } catch { console.log(-1); }
  });
")

PASS_COUNT=$(echo "$RESULT" | node -e "
  let data = '';
  process.stdin.on('data', d => data += d);
  process.stdin.on('end', () => {
    try {
      const j = JSON.parse(data);
      console.log(j.summary?.pass || 0);
    } catch { console.log(0); }
  });
")

TOTAL=$(echo "$RESULT" | node -e "
  let data = '';
  process.stdin.on('data', d => data += d);
  process.stdin.on('end', () => {
    try {
      const j = JSON.parse(data);
      console.log(j.summary?.total || 0);
    } catch { console.log(0); }
  });
")

INTEGRITY=$(echo "$RESULT" | node -e "
  let data = '';
  process.stdin.on('data', d => data += d);
  process.stdin.on('end', () => {
    try {
      const j = JSON.parse(data);
      console.log(j.summary?.integrity || 'UNKNOWN');
    } catch { console.log('ERROR'); }
  });
")

echo "Result: pass=$PASS_COUNT fail=$FAIL_COUNT total=$TOTAL integrity=$INTEGRITY" >> "$LOG_FILE"
echo "" >> "$LOG_FILE"

# Alert to CMD Center if failures detected
if [ "$FAIL_COUNT" -gt 0 ] 2>/dev/null; then
  # Get failed agent names
  FAILED_AGENTS=$(echo "$RESULT" | node -e "
    let data = '';
    process.stdin.on('data', d => data += d);
    process.stdin.on('end', () => {
      try {
        const j = JSON.parse(data);
        const failed = j.agents.filter(a => !a.pass).map(a => a.agentId);
        console.log(failed.join(', '));
      } catch { console.log('unknown'); }
    });
  ")

  ALERT_MSG="🚨 INTEGRITY CHECK FAILED — $FAIL_COUNT/$TOTAL agents have drift: $FAILED_AGENTS. Run: node tools/integrity-check.js"
  
  # Push to HQ dashboard
  curl -s -X POST "$HQ_API" \
    -H 'Content-Type: application/json' \
    -H "X-Agent-Key: $HQ_KEY" \
    -d "{\"agent_id\":\"brainchain\",\"color\":\"#FF0000\",\"text\":\"$ALERT_MSG\"}" > /dev/null 2>&1

  echo "ALERT SENT: $ALERT_MSG" >> "$LOG_FILE"
elif [ "$EXIT_CODE" -ne 0 ]; then
  ALERT_MSG="⚠️ Integrity check script error (exit code $EXIT_CODE). Check logs."
  curl -s -X POST "$HQ_API" \
    -H 'Content-Type: application/json' \
    -H "X-Agent-Key: $HQ_KEY" \
    -d "{\"agent_id\":\"brainchain\",\"color\":\"#FF9800\",\"text\":\"$ALERT_MSG\"}" > /dev/null 2>&1
  echo "ALERT SENT: $ALERT_MSG" >> "$LOG_FILE"
else
  echo "✅ All clean — no alert needed" >> "$LOG_FILE"
fi

# Trim log to last 5000 lines
tail -5000 "$LOG_FILE" > "$LOG_FILE.tmp" && mv "$LOG_FILE.tmp" "$LOG_FILE"
