# Makings Option 3 infrastructure as code

This directory implements the repository-only infrastructure artifact selected by `TASK-28bb5fe8`. It does **not** authorize or perform an AWS plan against a live account, apply, resource creation, IAM creation, DNS change, spend, image push, deployment, restart, or production mutation.

## State boundaries

- `bootstrap/` is principal-owned. It defines the GitHub Actions OIDC provider, exact protected-environment trust, the deployer role, and its permissions boundary. The principal imports an existing account-wide GitHub provider instead of creating a duplicate when necessary.
- `option3/` is the Makings workload stack. It consumes the principal-created permissions-boundary ARN and cannot change the OIDC provider, deployer trust, or boundary.
- Remote state storage and locking are principal-owned and deliberately not created here.

## Architecture

- Dedicated `10.42.0.0/16` VPC in `eu-north-1`; no peering, transit gateway, legacy VPC route, or shared role.
- Public ALB across two AZs, HTTPS only, with an existing regional ACM certificate. This stack creates no DNS records or certificates.
- Two ARM64 `shops-web-api` Fargate tasks and two ARM64 `shops-worker-scanner` tasks, each `0.25 vCPU / 0.5 GB`.
- The scanner has no ingress rule and no load-balancer attachment. Tasks use public ENIs for outbound access to match the approved Option 3 cost model; security groups do not permit inbound internet access to either task service.
- Private, non-public, encrypted, Multi-AZ PostgreSQL 16 on `db.t4g.small`, 20 GB gp3, 14-day backups, deletion protection, TLS enforcement, RDS-managed master password, and separate IAM database identities for web and scanner.
- Private S3 bucket with Block Public Access, bucket-owner enforcement, AES256 service-managed encryption, versioning, lifecycle rules, and the required `quarantine/`, `artifacts/sha256/`, and `evidence/` namespaces.
- Separate web/scanner execution and task roles. Web can create quarantine sources and read published artifacts. Scanner can read quarantine and create digest artifacts/evidence. Neither workload role can delete objects or administer the bucket.
- Immutable ECR repositories and 30-day CloudWatch log groups using AWS-managed encryption.
- A USD 150 monthly AWS Budget graph prerequisite with 80% actual, 100% actual, and 100% forecast alerts. A budget is visibility, not a hard spending cap.

## Resource inventory

| Area | Resources |
| --- | --- |
| Cost | one monthly AWS Budget with actual and forecast notifications |
| Network | VPC, internet gateway, two public application subnets, two isolated database subnets, route tables, four security groups |
| Edge | one two-AZ ALB, HTTPS listener, target group |
| Compute | ECS cluster, two ARM64 task definitions, two services at desired count 2 |
| Images/logs | two immutable ECR repositories and lifecycle policies; two CloudWatch log groups |
| Data | one private Multi-AZ RDS PostgreSQL instance and subnet/parameter groups; one versioned encrypted S3 bucket |
| Identity | four split ECS roles and four least-privilege inline policies |
| Bootstrap | GitHub OIDC provider, exact-environment deployment role, Makings workload permissions boundary, tagged-resource deployment policy |

## Document-derived monthly cost

The checked-in configuration preserves the planning assumptions in `shops/docs/AWS-HOSTING-OPTIONS-R1-WAVE0-20260925.md`:

| Item | Monthly |
| --- | ---: |
| Two web/API Fargate tasks | $15.86 |
| Two worker/scanner Fargate tasks | $15.86 |
| Application Load Balancer | $17.48 |
| 0.2 average ALB LCU | $1.11 |
| Multi-AZ `db.t4g.small` | $47.45 |
| 20 GB Multi-AZ gp3 | $4.80 |
| Six public IPv4 addresses | $21.90 |
| 25 GB S3 Standard | $0.58 |
| 1 GB ECR | $0.10 |
| 4 GB CloudWatch log ingestion | $2.16 |
| **Planning total** | **$127.30/month** |

The USD 150 alert leaves $22.70 planning headroom. The estimate excludes tax, support, DNS, transfer, requests, Secrets Manager, excess backups/logs, image scanning, and other unpriced usage. Repricing and explicit principal approval are required before any apply.

## OIDC bootstrap contract

AWS trust is exactly:

```text
aud = sts.amazonaws.com
sub = repo:brainAI-bot/agentfolio:environment:makings-production
```

GitHub environment subjects replace branch subjects. Therefore the principal must configure `makings-production` as a protected environment whose deployment branch policy allows only `main` **and must configure the principal as a required reviewer**. That approval is mandatory before every apply; merges to `main` do not bypass it. Adding a separate `repo:brainAI-bot/agentfolio:ref:refs/heads/main` subject would create an OR and bypass the environment requirement, so it is intentionally absent.

The deployer policy excludes Route 53, ACM creation, customer-managed KMS keys, Organizations/account administration, and mutation of its own trust, boundary, or the OIDC provider. AWS APIs with incomplete resource-level authorization are constrained by exact action lists, `eu-north-1`, the `makings-*` namespace, required `Project=Makings` request/resource tags, and the `/makings/shops/` IAM path.

## Validation (credentials not required)

```bash
tofu fmt -check -recursive shops/infra
tofu -chdir=shops/infra/bootstrap init -backend=false
tofu -chdir=shops/infra/bootstrap validate
tofu -chdir=shops/infra/option3 init -backend=false
tofu -chdir=shops/infra/option3 validate
node --test shops/infra/tests/infra-contract.test.mjs
git diff --check
```

The contract test includes insecure mutations and proves they are rejected. Validation does not prove AWS quotas, certificate ownership, image existence/architecture, cost-allocation tag activation, engine availability, or recovery objectives.

## Principal-only apply prerequisites

1. Reprice and explicitly approve the monthly ceiling and exclusions.
2. Configure/protect the GitHub `makings-production` environment for `main` only and require the principal as a reviewer for every deployment.
3. Apply/import `bootstrap/` personally and configure principal-owned remote state.
4. Confirm account-specific AZ mapping and existing ACM certificate.
5. Build and push both ARM64 images, then replace examples with immutable digests.
6. Bootstrap separate `shops_web` and `shops_scanner` PostgreSQL users with only their required grants and IAM authentication.
7. Review an exact-head Mode-2 PR through 0xbrainCLAUDE.
8. Give a separate explicit apply/deploy/DNS/spend go. None is implied by merging this PR.
9. After deployment, measure failover and isolated PITR/object reconciliation. Configuration alone does not prove RPO <=5 minutes or RTO <=4 hours.
