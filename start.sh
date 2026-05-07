#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

: "${AGENTMAIL_API_KEY:?AGENTMAIL_API_KEY must be set in the environment}"
: "${AGENTMAIL_INBOX:?AGENTMAIL_INBOX must be set in the environment}"
export AGENTMAIL_API_KEY AGENTMAIL_INBOX

cd "$SCRIPT_DIR"
exec node src/server.js
