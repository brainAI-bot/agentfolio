const { execSync } = require('child_process');
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
    return clean(execSync(`git ${args}`, {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2000,
    }));
  } catch (_) {
    return null;
  }
}

function getCommitSha() {
  return clean(process.env.AGENTFOLIO_COMMIT_SHA)
    || clean(process.env.SOURCE_COMMIT)
    || clean(process.env.GIT_COMMIT)
    || clean(process.env.HEROKU_SLUG_COMMIT)
    || clean(process.env.VERCEL_GIT_COMMIT_SHA)
    || runGit('rev-parse HEAD')
    || 'unknown';
}

function getBuildTime() {
  return clean(process.env.AGENTFOLIO_BUILD_TIME)
    || clean(process.env.BUILD_TIME)
    || clean(process.env.BUILD_TIMESTAMP)
    || clean(process.env.VERCEL_GIT_COMMIT_DATE)
    || STARTED_AT;
}

function getDeployProvenance() {
  const commitSha = getCommitSha();
  return {
    service: 'agentfolio',
    commitSha,
    commit: commitSha,
    shortCommit: commitSha === 'unknown' ? 'unknown' : commitSha.slice(0, 12),
    buildTime: getBuildTime(),
    startedAt: STARTED_AT,
    environment: process.env.NODE_ENV || 'development',
    source: commitSha === 'unknown' ? 'unavailable' : 'runtime',
  };
}

module.exports = {
  getDeployProvenance,
};
