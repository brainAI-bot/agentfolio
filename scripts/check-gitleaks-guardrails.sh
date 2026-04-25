#!/usr/bin/env bash
set -euo pipefail

if ! command -v gitleaks >/dev/null 2>&1; then
  echo "gitleaks is required" >&2
  exit 1
fi

base_ref="${1:-${GITLEAKS_BASE_REF:-${GITHUB_BASE_REF:-brainforge/pr15-gitleaks-cleanup}}}"
base_remote_ref="$base_ref"
base_branch="$base_ref"

if [[ "$base_ref" != origin/* ]]; then
  base_remote_ref="origin/$base_ref"
fi
if [[ "$base_branch" == origin/* ]]; then
  base_branch="${base_branch#origin/}"
fi

git fetch --no-tags --prune --depth=1 origin "$base_branch" >/dev/null 2>&1 || true

echo "Running gitleaks diff scan against ${base_remote_ref}..HEAD"
gitleaks detect \
  --no-banner \
  --config .gitleaks.toml \
  --source . \
  --log-opts="${base_remote_ref}..HEAD"
