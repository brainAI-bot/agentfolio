# ADR 0003: AWS hosting options and monthly planning ranges

Status: options only; provision/spend = none

Assumptions (September 2026 planning): us-east-1, low-volume R1, one application workload, PostgreSQL, 20 GB database storage, 50 GB objects, modest logs/requests, no enterprise support, taxes, NAT Gateway, large egress, WAF, or cross-region DR. Reprice in AWS Pricing Calculator before approval. AWS prices compute by allocated resources and usage; source pages: https://aws.amazon.com/fargate/pricing/ , https://aws.amazon.com/rds/postgresql/pricing/ , https://aws.amazon.com/s3/pricing/ .

| Option | Shape | Estimated monthly range | Isolation/security | Trade-off |
| --- | --- | ---: | --- | --- |
| A. ECS Fargate + RDS PostgreSQL + S3 | 1 always-on 0.5 vCPU/1 GB task, ALB, single-AZ small RDS, S3 | **$85–$145** | Separate task role, private DB subnet, S3 bucket policy/KMS option, security groups | Clearest service boundary; ALB and RDS dominate low-volume cost |
| B. App Runner + RDS PostgreSQL + S3 | 1 small auto-scaled web service, single-AZ small RDS, S3 | **$70–$135** | Separate service role, VPC connector to private DB, isolated bucket | Simpler operations; idle provisioned instance/VPC connector can reduce savings |
| C. Lambda + API Gateway + Aurora Serverless v2 + S3 | request-driven API, minimum Aurora capacity, S3 | **$55–$160** | Per-function role, private data plane, isolated bucket, no persistent host | Best burst scaling; Aurora minimum capacity and connection management add complexity |

Recommendation for qualification: cost-check A and B with measured request/storage assumptions. Do not provision until Hani selects a budget/availability profile. If reliable scale-to-zero PostgreSQL is required, re-evaluate the database choice rather than weakening isolation.
