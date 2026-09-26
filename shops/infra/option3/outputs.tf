output "budget_name" {
  value = aws_budgets_budget.makings.name
}

output "vpc_id" {
  value = aws_vpc.shops.id
}

output "alb_dns_name" {
  value = aws_lb.web.dns_name
}

output "ecs_cluster_arn" {
  value = aws_ecs_cluster.shops.arn
}

output "web_ecr_repository_url" {
  value = aws_ecr_repository.web.repository_url
}

output "scanner_ecr_repository_url" {
  value = aws_ecr_repository.scanner.repository_url
}

output "shops_bucket_arn" {
  value = aws_s3_bucket.shops.arn
}

output "rds_endpoint" {
  value = aws_db_instance.shops.address
}

output "rds_master_secret_arn" {
  value     = try(aws_db_instance.shops.master_user_secret[0].secret_arn, null)
  sensitive = true
}

output "web_task_role_arn" {
  value = aws_iam_role.web_task.arn
}

output "scanner_task_role_arn" {
  value = aws_iam_role.scanner_task.arn
}
