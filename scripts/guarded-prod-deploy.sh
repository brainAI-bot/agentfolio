#!/usr/bin/env bash
set -euo pipefail

PROD_LOCKED_PATH="${PROD_LOCKED_PATH:-/home/ubuntu/agentfolio-prod-locked}"
STAGED_RELEASE_PATH="${STAGED_RELEASE_PATH:-}"
DEPLOY_REF="${DEPLOY_REF:-unknown}"
PM2_APP="${PM2_APP:-agentfolio}"
DRY_RUN="${DRY_RUN:-true}"
KEYPAIR_DECISION_CLOSED="${KEYPAIR_DECISION_CLOSED:-no}"
export PM2_APP

if [[ "${KEYPAIR_DECISION_CLOSED}" != "yes" ]]; then
  echo "Refusing deploy: KEYPAIR_DECISION_CLOSED must be yes." >&2
  exit 2
fi

if [[ -z "${STAGED_RELEASE_PATH}" || ! -d "${STAGED_RELEASE_PATH}" ]]; then
  echo "Refusing deploy: STAGED_RELEASE_PATH must point to the staged checkout." >&2
  exit 2
fi

if [[ ! -d "${PROD_LOCKED_PATH}" ]]; then
  echo "Refusing deploy: ${PROD_LOCKED_PATH} does not exist." >&2
  exit 2
fi

if [[ ! -f "${STAGED_RELEASE_PATH}/package.json" || ! -f "${STAGED_RELEASE_PATH}/src/server.js" ]]; then
  echo "Refusing deploy: staged checkout is missing package.json or src/server.js." >&2
  exit 2
fi

pm2_cwd="$(
  pm2 jlist | node -e '
    let input = "";
    process.stdin.on("data", chunk => input += chunk);
    process.stdin.on("end", () => {
      const list = JSON.parse(input || "[]");
      const app = list.find(item => item.name === process.env.PM2_APP);
      if (app) process.stdout.write(app.pm2_env.pm_cwd || "");
    });
  '
)"

if [[ "${pm2_cwd}" != "${PROD_LOCKED_PATH}" ]]; then
  echo "Refusing deploy: PM2 app ${PM2_APP} cwd is ${pm2_cwd:-missing}, expected ${PROD_LOCKED_PATH}." >&2
  exit 2
fi

echo "Production worktree: ${PROD_LOCKED_PATH}"
echo "Staged checkout: ${STAGED_RELEASE_PATH}"
echo "Target ref: ${DEPLOY_REF}"
echo "PM2 app: ${PM2_APP}"

if [[ "${DRY_RUN}" == "true" ]]; then
  echo "Dry run only. Would sync the staged checkout, install production dependencies, and reload PM2 app ${PM2_APP}."
  exit 0
fi

rsync -az --delete \
  --exclude='.git' \
  --exclude='.env' \
  --exclude='.env.*' \
  --exclude='data' \
  --exclude='logs' \
  --exclude='node_modules' \
  "${STAGED_RELEASE_PATH}/" "${PROD_LOCKED_PATH}/"

cd "${PROD_LOCKED_PATH}"
npm ci --omit=dev
node -c src/server.js
node -c ecosystem.config.js
pm2 reload ecosystem.config.js --only "${PM2_APP}" --update-env
pm2 save

echo "Deployed ${PM2_APP} from ${DEPLOY_REF}."
