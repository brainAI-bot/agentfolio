#!/usr/bin/env bash

set -euo pipefail

hq_runtime_dir="${HQ_RUNTIME_DIR:-/home/ubuntu/brainai-hq-v4}"
hq_env_file="${HQ_ENV_FILE:-${hq_runtime_dir}/.env}"
hq_cli_bin="${HQ_CLI_BIN:-${hq_runtime_dir}/cli/hq}"

if [[ ! -r "${hq_env_file}" ]]; then
  printf 'HQ environment is not readable: %s\n' "${hq_env_file}" >&2
  exit 66
fi

if [[ ! -x "${hq_cli_bin}" ]]; then
  printf 'HQ CLI is not executable: %s\n' "${hq_cli_bin}" >&2
  exit 66
fi

set -a
# shellcheck disable=SC1090 -- runtime path is supplied by the PM2 config.
source "${hq_env_file}"
set +a

export HQ_URL="${HQ_URL:-http://127.0.0.1:3100}"
export HQ_AGENT_ID="${HQ_AGENT_ID:-brainforge}"

exec "${hq_cli_bin}" "$@"
