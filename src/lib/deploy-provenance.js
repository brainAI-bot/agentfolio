const { execFileSync } = require('child_process');
const path = require('path');

const STARTED_AT = new Date().toISOString();
const REPO_ROOT = path.resolve(__dirname, '../..');

function clean(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function runGit(args) {
  try {
    return clean(execFileSync('git', args, {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2000,
    }));
  } catch (_) {
    return null;
  }
}

function firstClean(values) {
  for (const value of values) {
    const cleaned = clean(value);
    if (cleaned) return cleaned;
  }
  return null;
}

const BUILD_COMMIT_SHA = firstClean([
  process.env.AGENTFOLIO_COMMIT_SHA,
  process.env.SOURCE_COMMIT,
  process.env.GIT_COMMIT,
  process.env.HEROKU_SLUG_COMMIT,
  process.env.VERCEL_GIT_COMMIT_SHA,
]);
const CHECKOUT_HEAD = runGit(['rev-parse', 'HEAD']);
const COMMIT_SHA = BUILD_COMMIT_SHA || CHECKOUT_HEAD || 'unknown';
const BUILD_TIME = firstClean([
  process.env.AGENTFOLIO_BUILD_TIME,
  process.env.BUILD_TIME,
  process.env.BUILD_TIMESTAMP,
  process.env.VERCEL_GIT_COMMIT_DATE,
]) || STARTED_AT;
const SOURCE = BUILD_COMMIT_SHA ? 'build' : (CHECKOUT_HEAD ? 'checkout' : 'unavailable');

function getDeployProvenance() {
  return {
    service: 'agentfolio',
    commitSha: COMMIT_SHA,
    commit: COMMIT_SHA,
    runningCommitSha: COMMIT_SHA,
    shortCommit: COMMIT_SHA === 'unknown' ? 'unknown' : COMMIT_SHA.slice(0, 12),
    buildCommitSha: BUILD_COMMIT_SHA,
    checkoutHead: CHECKOUT_HEAD,
    buildTime: BUILD_TIME,
    startedAt: STARTED_AT,
    environment: process.env.NODE_ENV || 'development',
    source: SOURCE,
  };
}

module.exports = {
  getDeployProvenance,
};
