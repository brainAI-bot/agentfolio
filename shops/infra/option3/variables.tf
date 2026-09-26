variable "aws_region" {
  description = "Fixed Makings region."
  type        = string
  default     = "eu-north-1"

  validation {
    condition     = var.aws_region == "eu-north-1"
    error_message = "Makings Option 3 is approved only for eu-north-1."
  }
}

variable "environment" {
  description = "Protected environment name."
  type        = string
  default     = "production"
}

variable "name_prefix" {
  description = "Deterministic resource prefix."
  type        = string
  default     = "makings-shops"

  validation {
    condition     = can(regex("^makings-[a-z0-9-]+$", var.name_prefix))
    error_message = "name_prefix must remain inside the makings-* namespace."
  }
}

variable "availability_zones" {
  description = "Two account-specific AZ names in eu-north-1."
  type        = list(string)
  default     = ["eu-north-1a", "eu-north-1b"]

  validation {
    condition     = length(var.availability_zones) == 2 && length(distinct(var.availability_zones)) == 2 && alltrue([for az in var.availability_zones : startswith(az, "eu-north-1")])
    error_message = "Exactly two distinct eu-north-1 availability zones are required."
  }
}

variable "public_subnet_cidrs" {
  type    = list(string)
  default = ["10.42.0.0/24", "10.42.1.0/24"]
}

variable "database_subnet_cidrs" {
  type    = list(string)
  default = ["10.42.10.0/24", "10.42.11.0/24"]
}

variable "budget_notification_emails" {
  description = "Principal-controlled recipients for actual and forecast alerts."
  type        = list(string)

  validation {
    condition     = length(var.budget_notification_emails) > 0 && alltrue([for email in var.budget_notification_emails : can(regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", email))])
    error_message = "At least one syntactically valid budget notification email is required."
  }
}

variable "acm_certificate_arn" {
  description = "Existing eu-north-1 ACM certificate. This stack creates no DNS or certificate resources."
  type        = string

  validation {
    condition     = can(regex("^arn:aws:acm:eu-north-1:[0-9]{12}:certificate/", var.acm_certificate_arn))
    error_message = "acm_certificate_arn must identify an eu-north-1 ACM certificate."
  }
}

variable "web_image" {
  description = "Immutable ARM64 image URI, including @sha256 digest."
  type        = string

  validation {
    condition     = can(regex("@sha256:[a-f0-9]{64}$", var.web_image))
    error_message = "web_image must be pinned by sha256 digest."
  }
}

variable "scanner_image" {
  description = "Immutable ARM64 image URI, including @sha256 digest."
  type        = string

  validation {
    condition     = can(regex("@sha256:[a-f0-9]{64}$", var.scanner_image))
    error_message = "scanner_image must be pinned by sha256 digest."
  }
}

variable "permissions_boundary_arn" {
  description = "Principal-created boundary emitted by the separate bootstrap stack."
  type        = string

  validation {
    condition     = can(regex("^arn:aws:iam::[0-9]{12}:policy/makings-", var.permissions_boundary_arn))
    error_message = "The workload permissions boundary must be a makings-* IAM policy."
  }
}

variable "web_container_port" {
  type    = number
  default = 3000
}

variable "web_health_check_path" {
  type    = string
  default = "/api/shops/health"
}

variable "postgres_engine_version" {
  description = "Principal-approved PostgreSQL 16 minor available in eu-north-1."
  type        = string
  default     = "16.4"

  validation {
    condition     = startswith(var.postgres_engine_version, "16.")
    error_message = "The approved major version is PostgreSQL 16."
  }
}
