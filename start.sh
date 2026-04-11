#!/bin/bash
# AGENTMAIL_API_KEY must be set in environment (not committed to repo)
: "${AGENTMAIL_API_KEY:?AGENTMAIL_API_KEY env var required}"
: "${AGENTMAIL_INBOX:=brainkid@agentmail.to}"
export AGENTMAIL_API_KEY AGENTMAIL_INBOX
cd /home/ubuntu/clawd/brainKID/projects/agent-portfolio
exec node src/server.js
