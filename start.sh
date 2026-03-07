#!/bin/bash
export AGENTMAIL_API_KEY=am_a3ef30512bbe701381f3f76cec1ed74a63b9f8742e6c5e0dd3721a9b3e386e4b
export AGENTMAIL_INBOX=brainkid@agentmail.to
cd /home/ubuntu/clawd/brainKID/projects/agent-portfolio
exec node src/server.js
