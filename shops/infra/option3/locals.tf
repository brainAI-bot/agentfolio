data "aws_caller_identity" "current" {}

data "aws_partition" "current" {}

locals {
  required_tags = {
    Project     = "Makings"
    Product     = "Shops"
    Option      = "3"
    Environment = var.environment
    ManagedBy   = "Terraform"
    Repository  = "brainAI-bot/agentfolio"
  }

  az_map = {
    for index, az in var.availability_zones : az => {
      public_cidr   = var.public_subnet_cidrs[index]
      database_cidr = var.database_subnet_cidrs[index]
    }
  }

  bucket_name     = "${var.name_prefix}-${data.aws_caller_identity.current.account_id}-${var.aws_region}"
  db_name         = "shops"
  web_db_user     = "shops_web"
  scanner_db_user = "shops_scanner"
}
