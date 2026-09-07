#!/usr/bin/env bash

set -euo pipefail

hq_runtime_dir="${HQ_RUNTIME_DIR:-/home/ubuntu/brainai-hq-v4}"
hq_cli_bin="${HQ_CLI_BIN:-${hq_runtime_dir}/cli/hq}"
hq_agent_home="${HQ_AGENT_HOME:-/home/ubuntu}"
hq_agent_token_file="${hq_agent_home}/.config/hq/agent-token"
hq_url="${HQ_URL:-http://127.0.0.1:3100}"
hq_agent_id="${HQ_AGENT_ID:-brainforge}"

if [[ ! -x "${hq_cli_bin}" ]]; then
  printf 'HQ CLI is not executable: %s\n' "${hq_cli_bin}" >&2
  exit 66
fi

if [[ ! -r "${hq_agent_token_file}" ]]; then
  printf 'HQ scoped agent token is not readable: %s\n' "${hq_agent_token_file}" >&2
  exit 66
fi

# The HQ CLI reads the scoped agent token (and optional bootstrap cache) from
# HOME/.config/hq. Start it with an allowlisted environment so a master
# HQ_API_KEY or unrelated runtime secret can never leak in from PM2.
exec env -i \
  HOME="${hq_agent_home}" \
  PATH="${PATH:-/usr/local/bin:/usr/bin:/bin}" \
  HQ_URL="${hq_url}" \
  HQ_AGENT_ID="${hq_agent_id}" \
  "${hq_cli_bin}" "$@"
