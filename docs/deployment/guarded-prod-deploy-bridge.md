# Guarded Production Deploy Bridge

AgentFolio production is an AWS PM2 app served from the locked worktree at `/home/ubuntu/agentfolio-prod-locked`. The bridge in `.github/workflows/guarded-prod-deploy.yml` is manual-only and does not deploy on push.

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

The server-side script refuses to continue if the target path is not a git worktree or if tracked production changes are present. A non-dry-run execution fetches the repo, moves the locked worktree to the selected commit, installs production dependencies, validates the server and PM2 config syntax, reloads the `agentfolio` PM2 app, and saves the PM2 process list.
