#!/bin/bash
export AGENTMAIL_API_KEY=REDACTED
export AGENTMAIL_INBOX=brainkid@agentmail.to
cd /home/ubuntu/clawd/brainKID/projects/agent-portfolio
exec node src/server.js
