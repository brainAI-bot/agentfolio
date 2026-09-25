# Makings Shops R1 Wave 0 — isolated AWS hosting options

**Pricing basis:** September 23, 2026; USD; `us-east-1`; Linux/x86; 730 hours/month. Estimates exclude tax, AWS Support, domain/DNS, WAF, CI build minutes, and unusual outbound traffic. No free-tier credits, Spot, or Savings Plans are assumed. Prices are planning estimates, not AWS quotes.

## Wave 0 constraint and recommendation

**Provision/spend: none.** This document authorizes no AWS account, resource, DNS, credential, deployment, or purchase action. The top-level `shops/` tree remains inert. Scope is the Shops runtime; the static Makings landing is served separately. Do not attach Shops to, deploy it on, or share data paths/secrets with the legacy AgentFolio AWS Server 1 / PM2 runtime.

For a reviewed pilot, **Option 1** is the lowest-change, lowest-cost starting point. If container operations and horizontal scaling are requirements at first release, select **Option 2**. Treat **Option 3** as the availability-oriented baseline after demand or SLOs justify roughly $107/month.

## Common isolation controls

Apply these controls to every option before any later release approval:

- Prefer a **dedicated AWS account** for Shops; at minimum use a dedicated VPC/resource boundary, IAM roles, budgets, and tags. Do not peer or route it to the legacy production VPC/host.
- Create Shops-only storage, workload roles, secrets, logs, backup policy, and restore test. Use AWS-owned encryption keys in the base estimate; customer-managed KMS keys add at least the published per-key/API charges. Never mount or copy legacy AgentFolio production directories.
- Expose only HTTPS application ingress. Keep databases/object stores non-public and grant least-privilege access from the Shops workload identity.
- Make the frontend read Shops data through the Shops API. Do not repeat the existing filesystem coupling documented in `ARCHITECTURE.md`.
- Add AWS Budget alerts before provisioning. A budget is a notification control, not a hard spend cap.

## Monthly comparison

| Option | Monthly planning estimate | Best fit | Main limitation |
|---|---:|---|---|
| 1. Dedicated Lightsail VM | **~$14** | Cheapest pilot; easiest lift-and-shift | Single host/AZ; manual patching and recovery |
| 2. ECS Express Mode, one task | **~$48** | Managed container pilot with an upgrade path | One running task is not highly available; ALB/IPv4 dominate cost |
| 3. ECS Express Mode, two-task multi-AZ baseline | **~$107** | Availability-oriented managed container release | Higher fixed monthly floor; still needs application-level backup/restore |

### Option 1 — dedicated Lightsail VM (~$14/month)

**Architecture**

```text
Internet → Lightsail firewall/static IP → Caddy or nginx
                                         ├─ Shops Next.js
                                         └─ Shops API
                                             ├─ Shops-only SQLite/data volume
                                             └─ Lightsail object storage backups
```

Run only Shops processes on a new 2 GB Lightsail Linux instance. Use the bundled 60 GB SSD and 3 TB transfer allowance. Store encrypted application backups in a Shops-only object-storage bucket; keep credentials and data separate from the legacy host.

**Cost assumption**

| Item | Assumption | Monthly |
|---|---|---:|
| Lightsail Linux instance | 2 GB RAM, 2 vCPU, 60 GB SSD, IPv4 bundle | $12.00 |
| Snapshot storage | 20 GB average stored footprint × $0.05/GB-month | $1.00 |
| Object storage | 5 GB / 25 GB-transfer bundle | $1.00 |
| **Estimated total** | | **$14.00** |

**Security/data isolation:** strongest when placed in a dedicated AWS account with no VPC peering. Permit 80/443 only; restrict administrative access; use a unique instance role/credentials and Shops-only backup bucket. Local data remains isolated from legacy production but shares the application's single failure domain.

**Scaling/reliability tradeoff:** vertical resize is simple, but resizing or host recovery causes downtime. No native multi-AZ failover. This option is appropriate only for a low-volume pilot with a tested restore procedure and an accepted recovery-time objective.

### Option 2 — ECS Express Mode, one Fargate task (~$48/month)

**Architecture**

```text
Internet → ECS Express-managed ALB (2 AZs)
             → 1 Fargate task: Shops container (0.5 vCPU, 1 GB)
                 ├─ DynamoDB: Shops application records
                 └─ S3: Shops assets/exports
ECR: image       CloudWatch Logs: application logs
```

ECS Express Mode creates and manages the ECS/Fargate service, Application Load Balancer, networking, deployment circuit breaker, logs, and scaling configuration. Externalize all persistent state to DynamoDB/S3; task storage is disposable.

**Cost assumption**

| Item | Assumption | Monthly |
|---|---|---:|
| Fargate compute | 1 task, 0.5 vCPU + 1 GB, 730 h | $18.02 |
| Application Load Balancer | $0.0225/h | $16.43 |
| ALB capacity | 0.1 average LCU × $0.008/LCU-h | $0.58 |
| Public IPv4 | 3 addresses (2 ALB + 1 task) × $0.005/h | $10.95 |
| DynamoDB on-demand | 1M writes + 5M strongly consistent reads | $1.25 |
| S3 Standard | 10 GB stored; request cost immaterial at pilot volume | $0.23 |
| ECR | 1 GB image storage | $0.10 |
| CloudWatch Logs | 1 GB ingestion | $0.50 |
| **Estimated total** | | **$48.06** |

The Fargate calculation uses the published `us-east-1` rates of $0.000011244/vCPU-second and $0.000001235/GB-second. The estimate assumes low traffic, one always-running task, and no NAT Gateway. It also assumes outbound transfer remains inside AWS's account-level free allowance; re-price if traffic grows.

**Security/data isolation:** use a dedicated account/VPC, a task IAM role scoped to only the Shops DynamoDB table and S3 prefix/bucket, AWS-owned encryption at rest in the base estimate, ECR image scanning, secret injection from SSM Parameter Store, and security groups that allow task ingress only from the ALB. Express Mode places tasks in public subnets by default, but the task security group can still deny direct inbound internet traffic. Re-price customer-managed KMS keys or Secrets Manager if selected.

**Scaling/reliability tradeoff:** managed deployment and horizontal scaling are materially easier than on a VM. A desired count of one remains a single-task failure domain; ECS can replace it, but an interruption creates an availability gap. Moving to two tasks adds roughly $22/month at the small task size plus one IPv4 address.

### Option 3 — ECS Express Mode, two-task multi-AZ baseline (~$107/month)

**Architecture**

Use the same managed-container architecture as Option 2, but run **two 1 vCPU / 2 GB tasks** distributed across the two Express-created Availability Zone subnets. Set health checks, deployment rollback, and autoscaling minimum/desired capacity to two. Keep DynamoDB and S3 as Shops-only durable stores.

**Cost assumption**

| Item | Assumption | Monthly |
|---|---|---:|
| Fargate compute | 2 tasks, each 1 vCPU + 2 GB, 730 h | $72.08 |
| Application Load Balancer | $0.0225/h | $16.43 |
| ALB capacity | 0.25 average LCU × $0.008/LCU-h | $1.46 |
| Public IPv4 | 4 addresses (2 ALB + 2 tasks) × $0.005/h | $14.60 |
| DynamoDB on-demand | 1M writes + 5M strongly consistent reads | $1.25 |
| S3 Standard | 10 GB | $0.23 |
| ECR | 1 GB image storage | $0.10 |
| CloudWatch Logs | 2 GB ingestion | $1.00 |
| **Estimated total** | | **$107.15** |

**Security/data isolation:** same controls as Option 2. For stricter egress isolation, move tasks to private subnets and add controlled egress, but re-price first: NAT Gateways or multiple VPC endpoints can add a substantial fixed monthly cost.

**Scaling/reliability tradeoff:** survives a task failure and is positioned for rolling deployments and autoscaling. DynamoDB/S3 remove host-disk coupling. It costs more than seven times the Lightsail pilot before meaningful traffic and does not remove the need for backup, restore, observability, or incident procedures.

## Decision gates before any provisioning

1. Confirm whether Wave 0 data can use DynamoDB/S3 or requires SQLite/relational semantics.
2. Define traffic, availability, backup retention, RPO/RTO, and log-retention assumptions; rerun the AWS Pricing Calculator with those values.
3. Approve the AWS account boundary, IAM/KMS ownership, monthly budget ceiling, and teardown owner.
4. Review the container and persistence design independently from the legacy PM2 runtime.
5. Obtain a separate explicit provision/spend/DNS/credential authorization. Until then, **no action beyond documentation is permitted**.

## Official AWS sources

Pricing and product behavior were checked on September 23, 2026:

- [Amazon Lightsail pricing](https://aws.amazon.com/lightsail/pricing/) — instance, snapshot, and object-storage bundles.
- [AWS Fargate pricing](https://aws.amazon.com/fargate/pricing/) — per-second vCPU and memory rates.
- [Amazon ECS Express Mode](https://aws.amazon.com/ecs/express-mode/) and [Express Mode documentation](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/express-service.html) — managed resources, public-subnet behavior, ALB, logs, deployment, and scaling.
- [Elastic Load Balancing pricing](https://aws.amazon.com/elasticloadbalancing/pricing/) — ALB hourly and LCU rates.
- [Amazon VPC pricing](https://aws.amazon.com/vpc/pricing/) — public IPv4 address charge.
- [Amazon DynamoDB pricing](https://aws.amazon.com/dynamodb/pricing/on-demand/) — on-demand request rates.
- [Amazon S3 pricing](https://aws.amazon.com/s3/pricing/) — S3 Standard storage and request rates.
- [Amazon ECR pricing](https://aws.amazon.com/ecr/pricing/) — private image storage.
- [Amazon CloudWatch pricing](https://aws.amazon.com/cloudwatch/pricing/) — log ingestion/storage.
- [AWS account isolation boundary guidance](https://docs.aws.amazon.com/whitepapers/latest/organizing-your-aws-environment/security-ou-and-accounts.html) — separate accounts as resource and security boundaries.
- [AWS Pricing Calculator](https://calculator.aws/) — required for a refreshed quote at a later approval gate.
