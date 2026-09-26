# AgentFolio Shops R1 Wave 0 — reconciled eu-north-1 PostgreSQL hosting options

**Status:** architecture and cost comparison only; provision/spend/deploy = none

**Reconciles and supersedes:** `shops/docs/adr/0003-hosting-options.md` and `shops/docs/AWS-HOSTING-OPTIONS-R1-WAVE0-20260923.md`

**Pricing observation:** 2026-09-25; USD; AWS Europe (Stockholm), `eu-north-1`; 730 hours/month; on-demand Linux/ARM where available.

**Arithmetic reconciliation (2026-09-26):** line-item sums were recalculated while rebuilding this document onto current AgentFolio `main`; corrected totals are $21.88, $64.33, and $127.30, superseding the source draft totals of $21.87, $64.32, and $127.28.

This document replaces the earlier SQLite/DynamoDB comparison. Every option below uses PostgreSQL as the system of record and S3 for quarantined uploads, immutable artifacts, and evidence. It authorizes no AWS account, resource, credential, DNS, organization, purchase, spend, deployment, restart, or production mutation.

## Decision summary

| Option | Planning total/month | Database | Availability profile | Planning recovery profile | Disposition |
|---|---:|---|---|---|---|
| 1. One EC2 host, self-managed PostgreSQL | **$21.88 (~$22)** | PostgreSQL on encrypted gp3 | Lowest cost; one host/AZ | RPO ≤5 min only with continuously verified WAL archive; projected RTO 1–4 h | **Cheapest potentially compliant pilot**; requires the most operational discipline |
| 2. ECS Fargate + single-AZ RDS PostgreSQL | **$64.33 (~$64)** | Managed `db.t4g.micro`, 20 GB gp3 | Managed DB/backups, but DB and each service have a single active instance | Native RDS PITR supports the five-minute RPO; projected RTO 1–4 h for PITR/redeploy | **Cheapest managed-database option** |
| 3. Two-service-pair ECS + Multi-AZ RDS PostgreSQL | **$127.30 (~$127)** | Managed Multi-AZ `db.t4g.small`, 20 GB gp3 | Two web/API tasks, two worker/scanner tasks, DB standby in another AZ | Five-minute PITR plus typical 60–120 s DB failover; projected full restore RTO 1–4 h | Availability-oriented R1 baseline |

**Achieved RTO is not yet available for any option.** No infrastructure may be created under this document, so no restore rehearsal has run. The numbers above are planning objectives, not achieved results. An option is not release-compliant until an isolated restore rehearsal records the database recovery point, elapsed restore time, object inventory/digest match, outbox state, and disabled payment dispatch. The release gate is **measured RPO ≤5 minutes and achieved end-to-end RTO ≤4 hours**.

## Common architecture and isolation contract

All options use the same AWS account selected for AgentFolio, but Shops must remain isolated from the legacy AgentFolio runtime:

- Dedicated Shops VPC in `eu-north-1`, with no peering or route to the legacy production VPC/host.
- Shops-only security groups, resource tags, log groups, backup policy, and IAM roles. Do not reuse instance profiles, task roles, database credentials, or deployment roles.
- Separate workload identities for `shops-web-api` and `shops-worker-scanner`. The web/API role can create quarantine uploads and read published artifacts; the worker/scanner role can read quarantine objects, write artifact/evidence objects, and update scan state. Neither role gets bucket-wide administration.
- PostgreSQL is private and non-public. Application ingress is HTTPS only. Database access is limited to the application security groups/host identity.
- S3 Block Public Access, versioning, encryption at rest, and lifecycle rules are required. Use these key prefixes (prefixes are object-key namespaces, not separate buckets):
  - `quarantine/{upload_id}/source` — write-once incoming bytes; never served to buyers.
  - `artifacts/sha256/{digest}` — immutable validated artifact addressed by digest.
  - `evidence/{order_id}/{event_id}.json` — immutable scan/delivery/reconciliation evidence.
- Promotion is copy-by-digest from `quarantine/` to `artifacts/`; it is not an in-place rename. A database transaction publishes the accepted digest only after the scanner result is committed.
- Create an AWS Budget alert before provisioning, with forecast and actual thresholds set against the approved monthly ceiling. A budget alert is notification/visibility, not a substitute for authorization or an automatic hard cap.
- Daily database base backup/snapshot, retained PITR/WAL coverage, S3 version recovery, and quarterly isolated restore rehearsal are required. Record actual restore evidence; configuration alone does not prove recovery.

## Option 1 — one EC2 host with self-managed PostgreSQL

### Shape

```text
Internet → public IPv4 → Caddy/nginx on EC2 t4g.small
                         ├─ shops-web-api (systemd, dedicated OS user/cgroup)
                         ├─ shops-worker-scanner (systemd, dedicated OS user/cgroup)
                         └─ PostgreSQL on encrypted 30 GB gp3
                                      └─ pgBackRest/WAL archive → S3 backup prefix
web/API → S3 quarantine/
worker/scanner → S3 quarantine/ → artifacts/ + evidence/
```

Use one ARM `t4g.small` (2 vCPU, 2 GiB) only for a low-volume qualification environment. Bind PostgreSQL to localhost/private interface, use separate service users, and isolate the scanner with least privilege, resource limits, a read-only root filesystem/container where practical, and no execution of seller content.

### Backup and recovery

- Run a daily full/base backup and continuously archive PostgreSQL WAL to a versioned S3 backup prefix. Alarm if the latest successfully archived WAL is older than five minutes; without that alarm and a successful restore rehearsal, this option does **not** meet the RPO.
- Instance/EBS snapshots are secondary recovery material and do not by themselves meet a five-minute RPO.
- Planning RTO is 1–4 hours: create replacement compute, restore the latest base backup, replay WAL, reconcile S3 object inventory and outbox/payment state, then enable read traffic. Host failure causes downtime throughout recovery.
- **Achieved RTO:** unmeasured; release gate requires a timed isolated restore ≤4 hours.

### Monthly line items

| Line item | Assumption | Monthly |
|---|---|---:|
| EC2 compute | `t4g.small`, $0.0172/h × 730 h | $12.56 |
| EBS gp3 | 30 GB × $0.0836/GB-month | $2.51 |
| Public IPv4 | 1 × $0.005/h × 730 h | $3.65 |
| S3 Standard | 25 GB × $0.023/GB-month | $0.58 |
| CloudWatch Logs | 2 GB ingest × $0.54/GB | $1.08 |
| Snapshot allowance | 30 GB changed/stored × $0.05/GB-month planning allowance | $1.50 |
| **Estimated total** | Excludes tax, support, DNS, transfer, requests, KMS CMKs, and excess backup storage | **$21.88** |

### Tradeoffs

This is the cheapest shape and the only option without a managed database. It also combines application, scanner, database, and host failure domains; patching, PostgreSQL tuning, WAL verification, failover, and restore are operator-owned. Use it only if the measured restore gate passes and single-host downtime is accepted.

## Option 2 — ECS Fargate services with single-AZ RDS PostgreSQL

### Shape

```text
Internet → ALB (two AZ subnets)
             → ECS service: shops-web-api (1 × 0.25 vCPU / 0.5 GB ARM task)
             → ECS service: shops-worker-scanner (1 × 0.25 vCPU / 0.5 GB ARM task)
Both services → private single-AZ RDS PostgreSQL db.t4g.micro, 20 GB gp3
web/API → S3 quarantine/
worker/scanner → S3 quarantine/ → artifacts/ + evidence/
ECR → task images; CloudWatch Logs → service logs
```

The tasks may use public subnets/public IPv4 for low-cost outbound access, but security groups must allow web/API ingress only from the ALB and no inbound internet traffic to the worker/scanner. RDS remains private. A later move to private tasks requires pricing NAT gateways or the necessary interface endpoints; those fixed costs are not hidden in this estimate.

### Backup and recovery

- Enable RDS automated backups with non-zero retention. RDS uploads transaction logs to S3 every five minutes and supports point-in-time restore, satisfying the planned database RPO when `LatestRestorableTime` monitoring stays within five minutes.
- S3 versioning protects artifact/evidence object history. A restore must select database and object state consistently and must not replay a restored outbox as though historical payment calls were unsent.
- Planning RTO is 1–4 hours for a destructive/corruption event requiring PITR and service cutover. An ordinary failed ECS task is replaced by ECS, but a single task creates an availability gap; a single-AZ DB outage waits for recovery/restore.
- **Achieved RTO:** unmeasured; release gate requires a timed isolated PITR + object reconciliation ≤4 hours.

### Monthly line items

| Line item | Assumption | Monthly |
|---|---|---:|
| Fargate web/API | ARM, 0.25 vCPU + 0.5 GB × 730 h | $7.93 |
| Fargate worker/scanner | ARM, 0.25 vCPU + 0.5 GB × 730 h | $7.93 |
| Application Load Balancer | $0.02394/h × 730 h | $17.48 |
| ALB capacity | 0.1 average LCU × $0.0076/h × 730 h | $0.55 |
| RDS PostgreSQL compute | Single-AZ `db.t4g.micro`, $0.016/h × 730 h | $11.68 |
| RDS gp3 | 20 GB × $0.12/GB-month | $2.40 |
| Public IPv4 | 4 addresses (2 ALB + 2 tasks) × $0.005/h × 730 h | $14.60 |
| S3 Standard | 25 GB × $0.023/GB-month | $0.58 |
| ECR | 1 GB × $0.10/GB-month | $0.10 |
| CloudWatch Logs | 2 GB ingest × $0.54/GB | $1.08 |
| **Estimated total** | Excludes tax, support, DNS, transfer, requests, KMS CMKs, NAT/endpoints, and excess backup storage | **$64.33** |

### Tradeoffs

This is the cheapest managed-database option and removes PostgreSQL patching/WAL transport from the application host. It is not highly available: each service has one active task and the database is single-AZ. The small DB/task sizes are qualification assumptions, not production capacity proof.

## Option 3 — duplicated ECS services with Multi-AZ RDS PostgreSQL

### Shape

Use the Option 2 service boundaries, but run two web/API tasks and two worker/scanner tasks distributed across two Availability Zones. Use a Multi-AZ `db.t4g.small` RDS PostgreSQL deployment and keep minimum/desired task count at two for both services.

### Backup and recovery

- Native RDS PITR provides the same five-minute log-upload recovery point. Multi-AZ additionally provides synchronous standby failover for infrastructure failure; AWS documents typical failover at 60–120 seconds, though workload and recovery conditions can make it longer.
- Task/AZ failure should retain one web/API and one worker/scanner task. Corruption or operator error still requires PITR and object reconciliation; Multi-AZ is not a substitute for backup.
- Planning full-restore RTO remains 1–4 hours. Availability-event failover can be materially shorter, but it must be measured under the application DNS/connection-pool behavior.
- **Achieved RTO:** unmeasured; release gate requires timed failover and isolated PITR exercises, with end-to-end restore ≤4 hours.

### Monthly line items

| Line item | Assumption | Monthly |
|---|---|---:|
| Fargate web/API | 2 ARM tasks, each 0.25 vCPU + 0.5 GB × 730 h | $15.86 |
| Fargate worker/scanner | 2 ARM tasks, each 0.25 vCPU + 0.5 GB × 730 h | $15.86 |
| Application Load Balancer | $0.02394/h × 730 h | $17.48 |
| ALB capacity | 0.2 average LCU × $0.0076/h × 730 h | $1.11 |
| RDS PostgreSQL compute | Multi-AZ `db.t4g.small`, $0.065/h × 730 h | $47.45 |
| RDS gp3 | 20 GB × $0.24/GB-month | $4.80 |
| Public IPv4 | 6 addresses (2 ALB + 4 tasks) × $0.005/h × 730 h | $21.90 |
| S3 Standard | 25 GB × $0.023/GB-month | $0.58 |
| ECR | 1 GB × $0.10/GB-month | $0.10 |
| CloudWatch Logs | 4 GB ingest × $0.54/GB | $2.16 |
| **Estimated total** | Excludes tax, support, DNS, transfer, requests, KMS CMKs, NAT/endpoints, and excess backup storage | **$127.30** |

### Tradeoffs

This is the only listed shape with redundant application tasks and managed database failover across AZs. It has the highest fixed floor and still does not cover a regional outage, application corruption, bad migration, or external payment reconciliation without the restore procedure.

## Recommendation and decision gates

1. Use **Option 1** only for a cheapest qualification pilot after the WAL-age alarm and timed restore prove the recovery contract.
2. Prefer **Option 2** when managed PostgreSQL and native five-minute PITR are worth the ~$42/month premium over Option 1 and single-AZ downtime is acceptable.
3. Prefer **Option 3** when the release requires an AZ-tolerant service/database baseline and accepts the ~$63/month premium over Option 2.
4. Before any provisioning, obtain a separate explicit approval for the monthly ceiling, availability profile, backup retention, account/VPC boundary, IAM/KMS ownership, DNS, credentials, and deployment. Reprice in AWS Pricing Calculator at that gate.

## Official sources and rate evidence

Pricing rates were read from the AWS regional Price List files for `eu-north-1` on 2026-09-25 and cross-checked against the product pricing pages:

- AWS Price List API: https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/price-changes.html
- EC2 and EBS pricing: https://aws.amazon.com/ec2/pricing/on-demand/ and https://aws.amazon.com/ebs/pricing/
- AWS Fargate pricing and supported task sizes: https://aws.amazon.com/fargate/pricing/
- Amazon RDS for PostgreSQL pricing: https://aws.amazon.com/rds/postgresql/pricing/
- RDS point-in-time restore and five-minute transaction-log uploads: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_PIT.html
- RDS Multi-AZ failover behavior and typical 60–120 second interval: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Concepts.MultiAZ.Failover.html
- Application Load Balancer pricing: https://aws.amazon.com/elasticloadbalancing/pricing/
- Public IPv4 pricing ($0.005/address-hour): https://aws.amazon.com/vpc/pricing/
- Amazon S3 pricing: https://aws.amazon.com/s3/pricing/
- S3 prefix-based access control and version recovery: https://docs.aws.amazon.com/AmazonS3/latest/userguide/access-management.html
- Amazon ECR pricing: https://aws.amazon.com/ecr/pricing/
- Amazon CloudWatch pricing: https://aws.amazon.com/cloudwatch/pricing/
- AWS Budgets: https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-managing-costs.html

These are planning estimates, not AWS quotes. Reprice measured traffic, storage, backup growth, requests, logs, data transfer, image scanning, secrets, KMS, NAT/interface endpoints, and support before approval.
