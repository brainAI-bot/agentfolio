# Guarded Production Deploy Bridge

AgentFolio production is an AWS PM2 app served from the locked copied tree at `/home/ubuntu/agentfolio-prod-locked`. The bridge in `.github/workflows/guarded-prod-deploy.yml` is manual-only and does not deploy on push.

Required gates before a real deploy:

- GitHub environment approval for `agentfolio-production`.
- `owner_approval` must exactly equal `DEPLOY_AGENTFOLIO_PROD`.
- `keypair_decision_closed` must be `yes`.
- `dry_run` should be run first and defaults to `true`.

Required repository secrets:

- `AWS_PROD_HOST`
- `AWS_PROD_USER` (optional, defaults to `ubuntu`)
- `AWS_PROD_PORT` (optional, defaults to `22`)
- `AWS_PROD_SSH_KEY`

The workflow checks out the requested ref, stages that checkout under `/tmp/agentfolio-guarded-deploy-<sha>` on AWS Server 1, then runs the guarded server-side script and removes the staged checkout afterward. The script refuses to continue unless the owner gates are closed, the staged checkout contains the expected app files, and PM2 reports the `agentfolio` app running from `/home/ubuntu/agentfolio-prod-locked`.

A non-dry-run execution syncs the staged checkout into the locked tree while preserving runtime-only paths (`.env`, `data`, `logs`, and `node_modules`), installs production dependencies, validates the server and PM2 config syntax, reloads the `agentfolio` PM2 app, and saves the PM2 process list.
