#!/usr/bin/env bash
set -euo pipefail

PROD_LOCKED_PATH="${PROD_LOCKED_PATH:-/home/ubuntu/agentfolio-prod-locked}"
DEPLOY_REMOTE="${DEPLOY_REMOTE:-origin}"
DEPLOY_REF="${DEPLOY_REF:-origin/main}"
PM2_APP="${PM2_APP:-agentfolio}"
DRY_RUN="${DRY_RUN:-true}"
KEYPAIR_DECISION_CLOSED="${KEYPAIR_DECISION_CLOSED:-no}"

if [[ "${KEYPAIR_DECISION_CLOSED}" != "yes" ]]; then
  echo "Refusing deploy: KEYPAIR_DECISION_CLOSED must be yes." >&2
  exit 2
fi

if [[ ! -d "${PROD_LOCKED_PATH}/.git" ]]; then
  echo "Refusing deploy: ${PROD_LOCKED_PATH} is not a git worktree." >&2
  exit 2
fi

cd "${PROD_LOCKED_PATH}"

tracked_status="$(git status --porcelain --untracked-files=no)"
if [[ -n "${tracked_status}" ]]; then
  echo "Refusing deploy: tracked production worktree changes are present." >&2
  git status --short --untracked-files=no >&2
  exit 2
fi

git fetch --prune "${DEPLOY_REMOTE}"
target_commit="$(git rev-parse --verify "${DEPLOY_REF}^{commit}")"
current_commit="$(git rev-parse HEAD)"

echo "Production worktree: ${PROD_LOCKED_PATH}"
echo "Current commit: ${current_commit}"
echo "Target commit: ${target_commit}"

if [[ "${DRY_RUN}" == "true" ]]; then
  echo "Dry run only. Would fast-forward/check out ${target_commit}, install production dependencies, and reload PM2 app ${PM2_APP}."
  exit 0
fi

current_branch="$(git rev-parse --abbrev-ref HEAD)"
if [[ "${current_branch}" == "HEAD" ]]; then
  git checkout --detach "${target_commit}"
else
  git merge --ff-only "${target_commit}"
fi

npm ci --omit=dev
node -c src/server.js
node -c ecosystem.config.js
pm2 reload ecosystem.config.js --only "${PM2_APP}" --update-env
pm2 save

echo "Deployed ${PM2_APP} at ${target_commit}."
