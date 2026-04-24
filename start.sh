#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

export AGENTMAIL_API_KEY="${AGENTMAIL_API_KEY:-}"
export AGENTMAIL_INBOX="${AGENTMAIL_INBOX:-}"

cd "$SCRIPT_DIR"
exec node src/server.js
