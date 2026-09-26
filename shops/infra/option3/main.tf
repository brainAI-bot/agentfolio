resource "aws_budgets_budget" "makings" {
  name         = "${var.name_prefix}-monthly"
  budget_type  = "COST"
  limit_amount = "150"
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  cost_filter {
    name   = "TagKeyValue"
    values = ["user:Project$Makings"]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = var.budget_notification_emails
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = var.budget_notification_emails
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = var.budget_notification_emails
  }

  tags = local.required_tags
}

resource "aws_vpc" "shops" {
  cidr_block           = "10.42.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = merge(local.required_tags, { Name = "${var.name_prefix}-vpc" })

  depends_on = [aws_budgets_budget.makings]
}

resource "aws_internet_gateway" "shops" {
  vpc_id = aws_vpc.shops.id
  tags   = merge(local.required_tags, { Name = "${var.name_prefix}-igw" })
}

resource "aws_subnet" "public" {
  for_each = local.az_map

  vpc_id                  = aws_vpc.shops.id
  availability_zone       = each.key
  cidr_block              = each.value.public_cidr
  map_public_ip_on_launch = true

  tags = merge(local.required_tags, {
    Name = "${var.name_prefix}-public-${each.key}"
    Tier = "public-app"
  })
}

resource "aws_subnet" "database" {
  for_each = local.az_map

  vpc_id                  = aws_vpc.shops.id
  availability_zone       = each.key
  cidr_block              = each.value.database_cidr
  map_public_ip_on_launch = false

  tags = merge(local.required_tags, {
    Name = "${var.name_prefix}-database-${each.key}"
    Tier = "isolated-database"
  })
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.shops.id
  tags   = merge(local.required_tags, { Name = "${var.name_prefix}-public" })
}

resource "aws_route" "public_ipv4" {
  route_table_id         = aws_route_table.public.id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.shops.id
}

resource "aws_route_table_association" "public" {
  for_each = aws_subnet.public

  subnet_id      = each.value.id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table" "database" {
  vpc_id = aws_vpc.shops.id
  tags   = merge(local.required_tags, { Name = "${var.name_prefix}-database-isolated" })
}

resource "aws_route_table_association" "database" {
  for_each = aws_subnet.database

  subnet_id      = each.value.id
  route_table_id = aws_route_table.database.id
}

resource "aws_security_group" "alb" {
  name        = "${var.name_prefix}-alb"
  description = "Public HTTPS ingress to the Makings Shops ALB"
  vpc_id      = aws_vpc.shops.id

  ingress {
    description      = "HTTPS from the internet"
    from_port        = 443
    to_port          = 443
    protocol         = "tcp"
    cidr_blocks      = ["0.0.0.0/0"]
    ipv6_cidr_blocks = ["::/0"]
  }

  egress {
    description = "Forward only to the web container port inside the dedicated Shops VPC"
    from_port   = var.web_container_port
    to_port     = var.web_container_port
    protocol    = "tcp"
    cidr_blocks = [aws_vpc.shops.cidr_block]
  }

  tags = merge(local.required_tags, { Name = "${var.name_prefix}-alb" })
}

resource "aws_security_group" "web" {
  name        = "${var.name_prefix}-web"
  description = "Web API tasks; ingress only from ALB"
  vpc_id      = aws_vpc.shops.id

  ingress {
    description     = "ALB to web container"
    from_port       = var.web_container_port
    to_port         = var.web_container_port
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  egress {
    description = "TLS outbound for AWS APIs and approved dependencies"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.required_tags, { Name = "${var.name_prefix}-web" })
}

resource "aws_security_group" "scanner" {
  name        = "${var.name_prefix}-scanner"
  description = "Scanner tasks have no inbound rules"
  vpc_id      = aws_vpc.shops.id

  egress {
    description = "TLS outbound for ECR, S3, logs, and scanning dependencies"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.required_tags, { Name = "${var.name_prefix}-scanner-no-ingress" })
}

resource "aws_security_group" "database" {
  name        = "${var.name_prefix}-database"
  description = "Private PostgreSQL reachable only from Makings task groups"
  vpc_id      = aws_vpc.shops.id

  ingress {
    description     = "PostgreSQL from web tasks"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.web.id]
  }

  ingress {
    description     = "PostgreSQL from scanner tasks"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.scanner.id]
  }

  tags = merge(local.required_tags, { Name = "${var.name_prefix}-database" })
}

# Keep broad internet egress limited to TLS while permitting the exact database
# flow required by both task definitions. Standalone rules avoid a security-
# group dependency cycle.
resource "aws_vpc_security_group_egress_rule" "web_database" {
  security_group_id            = aws_security_group.web.id
  referenced_security_group_id = aws_security_group.database.id
  description                  = "PostgreSQL from web tasks to the Shops database"
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
}

resource "aws_vpc_security_group_egress_rule" "scanner_database" {
  security_group_id            = aws_security_group.scanner.id
  referenced_security_group_id = aws_security_group.database.id
  description                  = "PostgreSQL from scanner tasks to the Shops database"
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
}

resource "aws_s3_bucket" "shops" {
  bucket = local.bucket_name

  tags = merge(local.required_tags, { Name = local.bucket_name })

  depends_on = [aws_budgets_budget.makings]
}

resource "aws_s3_bucket_public_access_block" "shops" {
  bucket = aws_s3_bucket.shops.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "shops" {
  bucket = aws_s3_bucket.shops.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_versioning" "shops" {
  bucket = aws_s3_bucket.shops.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "shops" {
  bucket = aws_s3_bucket.shops.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "shops" {
  bucket = aws_s3_bucket.shops.id

  rule {
    id     = "quarantine-retention"
    status = "Enabled"

    filter { prefix = "quarantine/" }

    expiration { days = 30 }
    noncurrent_version_expiration { noncurrent_days = 30 }
    abort_incomplete_multipart_upload { days_after_initiation = 7 }
  }

  rule {
    id     = "immutable-prefix-history"
    status = "Enabled"

    filter { prefix = "artifacts/" }

    noncurrent_version_expiration { noncurrent_days = 365 }
    abort_incomplete_multipart_upload { days_after_initiation = 7 }
  }

  rule {
    id     = "evidence-history"
    status = "Enabled"

    filter { prefix = "evidence/" }

    noncurrent_version_expiration { noncurrent_days = 365 }
    abort_incomplete_multipart_upload { days_after_initiation = 7 }
  }

  depends_on = [aws_s3_bucket_versioning.shops]
}

resource "aws_s3_bucket_policy" "shops" {
  bucket = aws_s3_bucket.shops.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "DenyInsecureTransport"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource  = [aws_s3_bucket.shops.arn, "${aws_s3_bucket.shops.arn}/*"]
        Condition = { Bool = { "aws:SecureTransport" = "false" } }
      },
      {
        Sid       = "DenyArtifactAndEvidenceDeletion"
        Effect    = "Deny"
        Principal = "*"
        Action    = ["s3:DeleteObject", "s3:DeleteObjectVersion"]
        Resource = [
          "${aws_s3_bucket.shops.arn}/artifacts/sha256/*",
          "${aws_s3_bucket.shops.arn}/evidence/*"
        ]
      }
    ]
  })
}

resource "aws_ecr_repository" "web" {
  name                 = "${var.name_prefix}-web"
  image_tag_mutability = "IMMUTABLE"
  force_delete         = false

  image_scanning_configuration { scan_on_push = true }
  encryption_configuration { encryption_type = "AES256" }

  tags       = local.required_tags
  depends_on = [aws_budgets_budget.makings]
}

resource "aws_ecr_repository" "scanner" {
  name                 = "${var.name_prefix}-scanner"
  image_tag_mutability = "IMMUTABLE"
  force_delete         = false

  image_scanning_configuration { scan_on_push = true }
  encryption_configuration { encryption_type = "AES256" }

  tags       = local.required_tags
  depends_on = [aws_budgets_budget.makings]
}

resource "aws_ecr_lifecycle_policy" "web" {
  repository = aws_ecr_repository.web.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Expire old untagged images"
      selection = {
        tagStatus   = "untagged"
        countType   = "sinceImagePushed"
        countUnit   = "days"
        countNumber = 30
      }
      action = { type = "expire" }
    }]
  })
}

resource "aws_ecr_lifecycle_policy" "scanner" {
  repository = aws_ecr_repository.scanner.name
  policy     = aws_ecr_lifecycle_policy.web.policy
}

resource "aws_cloudwatch_log_group" "web" {
  name              = "/makings/shops/web"
  retention_in_days = 30
  tags              = local.required_tags

  depends_on = [aws_budgets_budget.makings]
}

resource "aws_cloudwatch_log_group" "scanner" {
  name              = "/makings/shops/scanner"
  retention_in_days = 30
  tags              = local.required_tags

  depends_on = [aws_budgets_budget.makings]
}

resource "aws_db_subnet_group" "shops" {
  name       = "${var.name_prefix}-database"
  subnet_ids = [for subnet in aws_subnet.database : subnet.id]
  tags       = local.required_tags
}

resource "aws_db_parameter_group" "shops" {
  name   = "${var.name_prefix}-postgres16"
  family = "postgres16"

  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }

  tags = local.required_tags
}

resource "aws_db_instance" "shops" {
  identifier = "${var.name_prefix}-postgres"

  engine         = "postgres"
  engine_version = var.postgres_engine_version
  instance_class = "db.t4g.small"

  allocated_storage     = 20
  max_allocated_storage = 100
  storage_type          = "gp3"
  storage_encrypted     = true
  multi_az              = true
  publicly_accessible   = false

  db_name  = local.db_name
  username = "shops_admin"

  manage_master_user_password         = true
  backup_retention_period             = 14
  backup_window                       = "01:00-02:00"
  maintenance_window                  = "sun:03:00-sun:04:00"
  auto_minor_version_upgrade          = true
  iam_database_authentication_enabled = true

  db_subnet_group_name   = aws_db_subnet_group.shops.name
  parameter_group_name   = aws_db_parameter_group.shops.name
  vpc_security_group_ids = [aws_security_group.database.id]

  deletion_protection       = true
  skip_final_snapshot       = false
  final_snapshot_identifier = "${var.name_prefix}-postgres-final"
  copy_tags_to_snapshot     = true

  enabled_cloudwatch_logs_exports = ["postgresql", "upgrade"]

  tags = local.required_tags

  lifecycle {
    prevent_destroy = true
  }
}

locals {
  ecs_assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
      Condition = {
        StringEquals = { "aws:SourceAccount" = data.aws_caller_identity.current.account_id }
        ArnLike      = { "aws:SourceArn" = "arn:${data.aws_partition.current.partition}:ecs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:*" }
      }
    }]
  })
}

resource "aws_iam_role" "web_execution" {
  name                 = "${var.name_prefix}-web-execution"
  path                 = "/makings/shops/workload/"
  assume_role_policy   = local.ecs_assume_role_policy
  permissions_boundary = var.permissions_boundary_arn
  tags                 = local.required_tags

  depends_on = [aws_budgets_budget.makings]
}

resource "aws_iam_role" "scanner_execution" {
  name                 = "${var.name_prefix}-scanner-execution"
  path                 = "/makings/shops/workload/"
  assume_role_policy   = local.ecs_assume_role_policy
  permissions_boundary = var.permissions_boundary_arn
  tags                 = local.required_tags

  depends_on = [aws_budgets_budget.makings]
}

resource "aws_iam_role" "web_task" {
  name                 = "${var.name_prefix}-web-task"
  path                 = "/makings/shops/workload/"
  assume_role_policy   = local.ecs_assume_role_policy
  permissions_boundary = var.permissions_boundary_arn
  tags                 = local.required_tags

  depends_on = [aws_budgets_budget.makings]
}

resource "aws_iam_role" "scanner_task" {
  name                 = "${var.name_prefix}-scanner-task"
  path                 = "/makings/shops/workload/"
  assume_role_policy   = local.ecs_assume_role_policy
  permissions_boundary = var.permissions_boundary_arn
  tags                 = local.required_tags

  depends_on = [aws_budgets_budget.makings]
}

resource "aws_iam_role_policy" "web_execution" {
  name = "web-image-and-logs"
  role = aws_iam_role.web_execution.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = "ecr:GetAuthorizationToken", Resource = "*" },
      { Effect = "Allow", Action = ["ecr:BatchCheckLayerAvailability", "ecr:GetDownloadUrlForLayer", "ecr:BatchGetImage"], Resource = aws_ecr_repository.web.arn },
      { Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"], Resource = "${aws_cloudwatch_log_group.web.arn}:*" }
    ]
  })
}

resource "aws_iam_role_policy" "scanner_execution" {
  name = "scanner-image-and-logs"
  role = aws_iam_role.scanner_execution.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = "ecr:GetAuthorizationToken", Resource = "*" },
      { Effect = "Allow", Action = ["ecr:BatchCheckLayerAvailability", "ecr:GetDownloadUrlForLayer", "ecr:BatchGetImage"], Resource = aws_ecr_repository.scanner.arn },
      { Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"], Resource = "${aws_cloudwatch_log_group.scanner.arn}:*" }
    ]
  })
}

resource "aws_iam_role_policy" "web_task" {
  name = "web-quarantine-and-artifact-read"
  role = aws_iam_role.web_task.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:AbortMultipartUpload", "s3:ListMultipartUploadParts"]
        Resource = "${aws_s3_bucket.shops.arn}/quarantine/*/source"
      },
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:GetObjectVersion"]
        Resource = "${aws_s3_bucket.shops.arn}/artifacts/sha256/*"
      },
      {
        Effect    = "Allow"
        Action    = "s3:ListBucket"
        Resource  = aws_s3_bucket.shops.arn
        Condition = { StringLike = { "s3:prefix" = ["quarantine/*", "artifacts/sha256/*"] } }
      },
      {
        Effect   = "Allow"
        Action   = "rds-db:connect"
        Resource = "arn:${data.aws_partition.current.partition}:rds-db:${var.aws_region}:${data.aws_caller_identity.current.account_id}:dbuser:${aws_db_instance.shops.resource_id}/${local.web_db_user}"
      }
    ]
  })
}

resource "aws_iam_role_policy" "scanner_task" {
  name = "scanner-quarantine-read-and-promotion-write"
  role = aws_iam_role.scanner_task.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:GetObjectVersion"]
        Resource = "${aws_s3_bucket.shops.arn}/quarantine/*/source"
      },
      {
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:AbortMultipartUpload", "s3:ListMultipartUploadParts"]
        Resource = ["${aws_s3_bucket.shops.arn}/artifacts/sha256/*", "${aws_s3_bucket.shops.arn}/evidence/*"]
      },
      {
        Effect    = "Allow"
        Action    = "s3:ListBucket"
        Resource  = aws_s3_bucket.shops.arn
        Condition = { StringLike = { "s3:prefix" = ["quarantine/*", "artifacts/sha256/*", "evidence/*"] } }
      },
      {
        Effect   = "Allow"
        Action   = "rds-db:connect"
        Resource = "arn:${data.aws_partition.current.partition}:rds-db:${var.aws_region}:${data.aws_caller_identity.current.account_id}:dbuser:${aws_db_instance.shops.resource_id}/${local.scanner_db_user}"
      }
    ]
  })
}

resource "aws_ecs_cluster" "shops" {
  name = var.name_prefix

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags       = local.required_tags
  depends_on = [aws_budgets_budget.makings]
}

resource "aws_ecs_cluster_capacity_providers" "shops" {
  cluster_name       = aws_ecs_cluster.shops.name
  capacity_providers = ["FARGATE"]

  default_capacity_provider_strategy {
    capacity_provider = "FARGATE"
    weight            = 1
  }
}

resource "aws_ecs_task_definition" "web" {
  family                   = "${var.name_prefix}-web"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "256"
  memory                   = "512"
  execution_role_arn       = aws_iam_role.web_execution.arn
  task_role_arn            = aws_iam_role.web_task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64"
  }

  container_definitions = jsonencode([{
    name                   = "shops-web-api"
    image                  = var.web_image
    essential              = true
    readonlyRootFilesystem = true
    user                   = "10001"
    portMappings           = [{ containerPort = var.web_container_port, hostPort = var.web_container_port, protocol = "tcp" }]
    environment = [
      { name = "AWS_REGION", value = var.aws_region },
      { name = "SHOPS_BUCKET", value = aws_s3_bucket.shops.id },
      { name = "DATABASE_HOST", value = aws_db_instance.shops.address },
      { name = "DATABASE_NAME", value = local.db_name },
      { name = "DATABASE_USER", value = local.web_db_user },
      { name = "DATABASE_AUTH_MODE", value = "iam" }
    ]
    linuxParameters = { capabilities = { drop = ["ALL"] } }
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.web.name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "web"
      }
    }
  }])

  tags = local.required_tags
}

resource "aws_ecs_task_definition" "scanner" {
  family                   = "${var.name_prefix}-scanner"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "256"
  memory                   = "512"
  execution_role_arn       = aws_iam_role.scanner_execution.arn
  task_role_arn            = aws_iam_role.scanner_task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64"
  }

  container_definitions = jsonencode([{
    name                   = "shops-worker-scanner"
    image                  = var.scanner_image
    essential              = true
    readonlyRootFilesystem = true
    user                   = "10002"
    environment = [
      { name = "AWS_REGION", value = var.aws_region },
      { name = "SHOPS_BUCKET", value = aws_s3_bucket.shops.id },
      { name = "DATABASE_HOST", value = aws_db_instance.shops.address },
      { name = "DATABASE_NAME", value = local.db_name },
      { name = "DATABASE_USER", value = local.scanner_db_user },
      { name = "DATABASE_AUTH_MODE", value = "iam" }
    ]
    linuxParameters = { capabilities = { drop = ["ALL"] } }
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.scanner.name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "scanner"
      }
    }
  }])

  tags = local.required_tags
}

resource "aws_lb" "web" {
  name                       = "makings-shops-web"
  internal                   = false
  load_balancer_type         = "application"
  security_groups            = [aws_security_group.alb.id]
  subnets                    = [for subnet in aws_subnet.public : subnet.id]
  enable_deletion_protection = true
  drop_invalid_header_fields = true

  tags = local.required_tags
}

resource "aws_lb_target_group" "web" {
  name        = "makings-shops-web"
  port        = var.web_container_port
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = aws_vpc.shops.id

  health_check {
    enabled             = true
    path                = var.web_health_check_path
    protocol            = "HTTP"
    matcher             = "200-399"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    interval            = 30
    timeout             = 5
  }

  tags = local.required_tags
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.web.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.acm_certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.web.arn
  }
}

resource "aws_ecs_service" "web" {
  name            = "shops-web-api"
  cluster         = aws_ecs_cluster.shops.id
  task_definition = aws_ecs_task_definition.web.arn
  desired_count   = 2
  launch_type     = "FARGATE"

  deployment_minimum_healthy_percent = 50
  deployment_maximum_percent         = 200
  enable_execute_command             = false
  propagate_tags                     = "SERVICE"

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    subnets          = [for subnet in aws_subnet.public : subnet.id]
    security_groups  = [aws_security_group.web.id]
    assign_public_ip = true
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.web.arn
    container_name   = "shops-web-api"
    container_port   = var.web_container_port
  }

  tags       = local.required_tags
  depends_on = [aws_lb_listener.https]
}

resource "aws_ecs_service" "scanner" {
  name            = "shops-worker-scanner"
  cluster         = aws_ecs_cluster.shops.id
  task_definition = aws_ecs_task_definition.scanner.arn
  desired_count   = 2
  launch_type     = "FARGATE"

  deployment_minimum_healthy_percent = 50
  deployment_maximum_percent         = 200
  enable_execute_command             = false
  propagate_tags                     = "SERVICE"

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    subnets          = [for subnet in aws_subnet.public : subnet.id]
    security_groups  = [aws_security_group.scanner.id]
    assign_public_ip = true
  }

  tags = local.required_tags
}
